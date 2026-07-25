import asyncio
import hmac
import io
import time
import uuid
from dataclasses import asdict
from pathlib import PurePosixPath
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Header, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Optional
import cv2

from app.config import HOST, PORT, RECORDINGS_DIR, UPLOADS_DIR, MODELS_DIR, API_TOKEN, CORS_ORIGINS
from app.storage import (
    init_db, get_all_cameras, get_camera, save_camera, delete_camera,
    get_recent_alerts, clear_all_alerts, get_history, clear_all_history,
    get_all_recordings
)
from app.camera_manager import manager
from app.ai.pipeline import get_detection_confidence, set_detection_confidence
from app.ai.tiling import get_tiling_settings, set_tiling_settings
from app.ai.tile_governor import governor
from app.gpu_monitor import get_gpu_usage

app = FastAPI(title="CamAI CCTV Analytics Platform")

# Structured health/introspection endpoints (/health, /models, /cameras,
# /system, /performance) polled by the desktop engine supervisor.
from app.health import router as health_router
app.include_router(health_router)

# Primed once at import time — psutil's cpu_percent() reports 0.0 on its
# first call for a given Process object (it needs a prior sample to diff
# against) and /api/status is polled on an interval, so a module-level
# instance naturally gets a real reading from the second poll onward
# instead of every caller re-priming (and always seeing 0.0) on each request.
try:
    import psutil
    _proc = psutil.Process()
    _proc.cpu_percent(interval=None)
except ImportError:
    _proc = None

# CORS Setup. Not "*" any more: a wildcard let any page the user happened to
# have open preflight-and-POST the control endpoints below. The allowlist is
# config.CORS_ORIGINS (override with CAMAI_CORS_ORIGINS).
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CONTROL_TOKEN_HEADER = "X-CamAI-Token"

def require_control_token(x_camai_token: str = Header(default="", alias=CONTROL_TOKEN_HEADER)) -> None:
    """Reject configuration writes that don't come from the CamAI desktop app.

    Applied to the endpoints that change what the AI *does* — AI mode /
    zone profile above all. It is a capability check, not a role check: see
    config.API_TOKEN for why the role part lives in the cloud (RLS on
    public.cameras requires cameras.manage) and what this adds on top of it.

    Unset token => open, so a hand-started dev engine still works. compare_digest
    keeps the check constant-time; a plain == leaks the prefix by timing, which
    matters here because the endpoint is reachable from any local process and can
    be probed without limit.
    """
    if not API_TOKEN:
        return
    if not hmac.compare_digest(x_camai_token, API_TOKEN):
        raise HTTPException(status_code=403, detail="Engine configuration is restricted to the CamAI application.")

# Endpoints carrying this reject unauthorised callers before the handler runs.
control = [Depends(require_control_token)]

# Mount recordings directory so they can be played back in browser
app.mount("/history/recordings", StaticFiles(directory=str(RECORDINGS_DIR)), name="recordings")

# --- Startup & Shutdown ---

startup_time = time.time()

@app.on_event("startup")
async def on_startup():
    print("[FastAPI] Initializing SQLite database...")
    init_db()

    # Configure thread-safe callback to push telemetry in real-time.
    # This is the ONLY telemetry distribution path — it fires once per AI
    # cycle per camera and only reaches clients subscribed to that camera_id.
    # (A second fixed-10Hz broadcast-to-everyone loop used to run alongside
    # this and was removed: it duplicated every push, ignored subscriptions,
    # and pushed full detections/masks/heatmap for every camera to every
    # client regardless of whether they were viewing it.)
    loop = asyncio.get_running_loop()
    def send_telemetry(telemetry_data):
        for camera_id, data in telemetry_data.items():
            asyncio.run_coroutine_threadsafe(
                ws_manager.send_to_subscribed(
                    camera_id,
                    {
                        "type": "telemetry",
                        "data": {camera_id: data}
                    }
                ),
                loop
            )
    manager.telemetry_callback = send_telemetry

    # Initialize active subscriptions set on manager
    manager.active_subscriptions = set()

    # manager.start_cameras() synchronously compiles the YOLO backend
    # (OpenVINO/ONNX model compilation), which is CPU-bound and can take
    # anywhere from tens of seconds to several minutes on first run.
    # Running it directly inside this coroutine would block the single
    # asyncio event loop for that entire duration, during which Uvicorn
    # cannot finish its startup/serve transition — every API route,
    # the WebSocket endpoint, and the Vite dev proxy sitting in front of
    # them all see connection refused/timeouts until it's done. Run it in
    # a worker thread instead so the server starts accepting requests
    # immediately; /api/status already reports modelLoaded=false and an
    # empty camera list while this is still in progress.
    print("[FastAPI] Launching camera threads in background...")

    async def _start_cameras_bg():
        try:
            await asyncio.to_thread(manager.start_cameras)
            print("[FastAPI] Camera threads + AI backend ready.", flush=True)
        except Exception as e:
            print(f"[FastAPI] Background camera/model startup failed: {e}", flush=True)

    asyncio.create_task(_start_cameras_bg())

@app.on_event("shutdown")
async def on_shutdown():
    print("[FastAPI] Stopping camera threads...")
    manager.stop_all()

# --- WebSocket Connection Manager ---

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.subscriptions: Dict[WebSocket, set] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.subscriptions[websocket] = set()
        print(f"[WS] Client connected. Total active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        if websocket in self.subscriptions:
            del self.subscriptions[websocket]
        self.update_global_subscriptions()
        print(f"[WS] Client disconnected. Total active: {len(self.active_connections)}")

    def add_subscription(self, websocket: WebSocket, camera_id: str):
        if websocket in self.subscriptions:
            self.subscriptions[websocket].add(camera_id)
        self.update_global_subscriptions()
        print(f"[WS] Client subscribed to camera: {camera_id}")

    def remove_subscription(self, websocket: WebSocket, camera_id: str):
        if websocket in self.subscriptions:
            self.subscriptions[websocket].discard(camera_id)
        self.update_global_subscriptions()
        print(f"[WS] Client unsubscribed from camera: {camera_id}")

    def update_global_subscriptions(self):
        active = set()
        for subs in self.subscriptions.values():
            active.update(subs)
        manager.active_subscriptions = active

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

    async def send_to_subscribed(self, camera_id: str, message: dict):
        for connection in list(self.active_connections):
            subscribed_cams = self.subscriptions.get(connection, set())
            if camera_id in subscribed_cams:
                try:
                    # A stalled/slow client (dead TCP peer, backed-up buffer)
                    # would otherwise block send_json() indefinitely on the
                    # single shared event loop, delaying telemetry delivery to
                    # every other connected client too. Bound it and drop the
                    # client instead of letting one bad connection create a
                    # WS backlog for everyone.
                    await asyncio.wait_for(connection.send_json(message), timeout=2.0)
                except (Exception, asyncio.TimeoutError):
                    self.disconnect(connection)

ws_manager = ConnectionManager()

# A well-behaved client (see desktop/src/lib/mediaShare.ts) pings on a
# cadence well inside this window; a connection that's gone idle past it is
# almost always a half-open socket the OS hasn't torn down yet (sleep,
# network-adapter swap, dead peer with no FIN/RST ever seen) rather than a
# legitimately quiet client — closing it lets the client's own reconnect
# logic take over immediately instead of pushing frames into a socket that
# looks open but is actually dead.
WS_IDLE_TIMEOUT_SECS = 30.0

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=WS_IDLE_TIMEOUT_SECS)
            except asyncio.TimeoutError:
                print(f"[WS] Client idle > {WS_IDLE_TIMEOUT_SECS}s, closing.", flush=True)
                try:
                    await websocket.close()
                except Exception:
                    pass
                break
            try:
                import json
                import base64
                import numpy as np
                payload = json.loads(data)
                msg_type = payload.get("type")
                if msg_type == "subscribe":
                    cam_id = payload.get("camera_id")
                    if cam_id:
                        ws_manager.add_subscription(websocket, cam_id)
                elif msg_type == "unsubscribe":
                    cam_id = payload.get("camera_id")
                    if cam_id:
                        ws_manager.remove_subscription(websocket, cam_id)
                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong", "ts": payload.get("ts")})
                elif msg_type == "screen_frame":
                    cam_id = payload.get("camera_id")
                    frame_base64 = payload.get("frame")
                    if cam_id and frame_base64:
                        if "," in frame_base64:
                            frame_base64 = frame_base64.split(",")[1]
                        img_data = base64.b64decode(frame_base64)
                        nparr = np.frombuffer(img_data, np.uint8)
                        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                        if frame is not None:
                            thread = manager.camera_threads.get(cam_id)
                            if thread and hasattr(thread, "push_frame"):
                                thread.push_frame(frame)
            except Exception:
                pass
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] Exception: {e}")
    finally:
        ws_manager.disconnect(websocket)

# --- Pydantic Schemas ---

class CameraConfigPayload(BaseModel):
    id: str
    name: str
    type: str  # 'webcam', 'usb', 'rtsp'
    source: str
    is_active: bool
    zones: Optional[str] = "[]"
    lines: Optional[str] = "[]"
    rules: Optional[str] = "[]"
    zone_profile: Optional[str] = None
    profile_features: Optional[str] = "{}"

class CameraAnalyticsPayload(BaseModel):
    zones: str
    lines: str
    rules: Optional[str] = "[]"
    zone_profile: Optional[str] = None
    profile_features: Optional[str] = "{}"

class CameraDisplayPayload(BaseModel):
    max_width: Optional[int] = None
    quality: Optional[int] = None

class CameraRecordingPayload(BaseModel):
    enabled: bool

# --- REST APIs ---

class ModelSelectPayload(BaseModel):
    model_name: str

class ConfidencePayload(BaseModel):
    confidence: float

# Status
@app.get("/api/status")
def get_system_status():
    camera_states = {}
    for cam_id, thread in manager.camera_threads.items():
        camera_states[cam_id] = {
            "name": thread.name,
            "running": thread.running,
            "fps": thread.latest_telemetry.get("fps", 0),
            "latency": thread.latest_telemetry.get("latency", 0),
            "counters": thread.latest_telemetry.get("counters", {"in": 0, "out": 0}),
            "health_status": thread._health_status,
            "resolution": thread._last_resolution,
            "recording": thread.recorder.continuous_writer is not None,
        }
        
    # Recommendation logic:
    # If a heavier model is active and we're on CPU, recommend a lighter one.
    # Device is read from the loaded backend rather than probed via torch:
    # torch is not a runtime dependency (nothing in server-requirements.txt
    # pulls it in), so a torch probe reported "cpu" even on machines where the
    # engine was really running on an Intel GPU through OpenVINO.
    backend = manager.yolo_backend
    backend_device = getattr(backend, "backend_device", None) if backend else None
    device = "cpu" if backend_device in (None, "CPU", "cpu") else backend_device.lower()

    recommendation = {
        "should_switch": False,
        "message": "",
        "suggested_model": ""
    }

    if device == "cpu":
        if manager.selected_model_name == "yolox_m":
            recommendation = {
                "should_switch": True,
                "message": "Performance Warning: YOLOX-M is active on CPU. Inference latency is high. We recommend switching to a lighter model (YOLOX-S or YOLOX-Tiny) for real-time performance.",
                "suggested_model": "yolox_s"
            }
        elif manager.selected_model_name == "yolox_s":
            # Check if latency is high
            running_threads = [t for t in manager.camera_threads.values() if t.running]
            avg_latency = sum(t.latest_telemetry.get("latency", 0) for t in running_threads) / len(running_threads) if running_threads else 0
            if avg_latency > 250.0:
                recommendation = {
                    "should_switch": True,
                    "message": "Performance Warning: YOLOX-S is experiencing high latency on CPU. We recommend switching to the ultra-lightweight YOLOX-Tiny model.",
                    "suggested_model": "yolox_tiny"
                }


    running_states = [c for c in camera_states.values() if c["running"]]
    avg_fps = sum(c["fps"] for c in running_states) / len(running_states) if running_states else 0.0
    avg_latency = sum(c["latency"] for c in running_states) / len(running_states) if running_states else 0.0

    if _proc is not None:
        try:
            cpu_percent = _proc.cpu_percent(interval=None)
            memory_mb = _proc.memory_info().rss / (1024 * 1024)
        except Exception:
            cpu_percent, memory_mb = 0.0, 0.0
    else:
        cpu_percent, memory_mb = 0.0, 0.0

    return {
        "server": "online",
        "uptime": round(time.time() - startup_time),
        "modelLoaded": manager.yolo_model is not None,
        "cameraThreadsActive": len(manager.camera_threads),
        "cameras": camera_states,
        "selectedModel": manager.selected_model_name,
        "benchmark": manager.benchmark_results,
        "recommendation": recommendation,
        "engine": {
            "status": manager.startup_status,
            "error": manager.startup_error,
            "elapsed_secs": round(time.time() - manager.startup_started_at, 1),
            "cpu_percent": round(cpu_percent, 1),
            "memory_mb": round(memory_mb, 1),
            "gpu_percent": get_gpu_usage(),
            "device": device,
            "avg_fps": round(avg_fps, 1),
            "avg_latency_ms": round(avg_latency, 1),
            "active_cameras": len(running_states),
        },
    }

@app.post("/api/model/select", dependencies=control)
def select_model(payload: ModelSelectPayload):
    target_path = None
    model_name = payload.model_name
    
    # 1. Check if model exists in custom models directory
    custom_path = MODELS_DIR / model_name
    if custom_path.exists():
        target_path = str(custom_path)
    # 2. Check if model exists in base directory
    elif model_name in ["yolox_tiny", "yolox_s", "yolox_m"]:
        target_path = model_name
    else:
        # Check if the name is an absolute path that exists
        from pathlib import Path
        p = Path(model_name)
        if p.exists() and p.is_file():
            target_path = str(p)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Model file '{model_name}' not found locally or in {MODELS_DIR}."
            )
            
    success = manager.hot_swap_model(target_path)
    if not success:
        raise HTTPException(status_code=500, detail=f"Failed to hot-swap to selected model '{model_name}'.")
    return {"success": True, "message": f"Successfully swapped active model to {model_name}"}

@app.get("/api/detection/confidence")
def read_detection_confidence():
    return {"confidence": get_detection_confidence()}

@app.post("/api/detection/confidence", dependencies=control)
def set_confidence(payload: ConfidencePayload):
    """Set the detection confidence floor for every running camera.

    Process-wide and applied live: each camera's AI loop reads the value at the
    top of its next cycle, so this takes effect within one frame with no restart
    and no re-registration.

    The APPLIED value is returned rather than the requested one, because it is
    clamped (see pipeline.MIN/MAX_CONFIDENCE) — a caller that echoes its own
    request back to an admin would show a number the detector isn't using.
    """
    applied = set_detection_confidence(payload.confidence)
    return {"success": True, "confidence": applied}


class TilingPayload(BaseModel):
    """Invisible AI Zoom Engine knobs. Every field optional — a request patches
    only what it sends, so a UI with one slider need not round-trip the rest."""
    enabled: Optional[bool] = None
    max_grid: Optional[int] = None
    overlap: Optional[float] = None
    max_tiles: Optional[int] = None
    latency_budget_ms: Optional[float] = None
    workers: Optional[int] = None
    motion_threshold: Optional[float] = None
    cache_ttl_s: Optional[float] = None
    small_object_frac: Optional[float] = None
    fusion_iou: Optional[float] = None
    fusion_containment: Optional[float] = None
    roi_boost: Optional[bool] = None
    roi_boost_max: Optional[int] = None
    second_pass_conf: Optional[float] = None
    discovery_interval_s: Optional[float] = None
    # v2 — each optimization independently switchable (Feature 15)
    adaptive_layout: Optional[bool] = None
    min_grid: Optional[int] = None
    governor_mode: Optional[str] = None          # "auto" | "latency" | "off"
    gpu_utilization_limit: Optional[float] = None
    max_latency_ms: Optional[float] = None
    zoom_enabled: Optional[bool] = None
    zoom_max_depth: Optional[int] = None
    zoom_min_object_px: Optional[int] = None
    zoom_conf_stable_delta: Optional[float] = None
    multi_resolution: Optional[bool] = None
    max_imgsz_cap: Optional[int] = None
    priority_enabled: Optional[bool] = None
    priority_zone_weight: Optional[float] = None
    priority_alert_weight: Optional[float] = None
    priority_motion_weight: Optional[float] = None
    priority_object_weight: Optional[float] = None
    edge_expansion: Optional[bool] = None
    edge_expansion_max: Optional[int] = None
    lighting_guard: Optional[bool] = None
    lighting_delta: Optional[float] = None
    temporal_enabled: Optional[bool] = None
    temporal_history_s: Optional[float] = None
    temporal_max_carry: Optional[int] = None
    temporal_smoothing: Optional[float] = None
    temporal_iou: Optional[float] = None
    verify_enabled: Optional[bool] = None
    verify_accept_conf: Optional[float] = None
    verify_second_pass_conf: Optional[float] = None
    verify_history_conf: Optional[float] = None
    verify_min_hits: Optional[int] = None
    fp_motion_validation: Optional[bool] = None
    fp_neighbour_agreement: Optional[bool] = None


@app.get("/api/detection/tiling")
def read_tiling_settings():
    """Current adaptive-tile settings, plus each running camera's live view of
    what the engine is actually doing (chosen grid, tiles inferred vs served
    from cache, budget). Admin diagnostics: none of this reaches an operator's
    live view, which shows the unmodified camera feed either way."""
    s = get_tiling_settings()
    runtime = {
        cam_id: thread.latest_telemetry.get("zoom_engine", {})
        for cam_id, thread in manager.camera_threads.items()
        if thread.running
    }
    # Governor state is process-wide (device pressure, per-camera shares) and
    # is the first thing to look at when an operator asks why tiling "stopped
    # working" — usually it did not stop, it was throttled for a stated reason.
    return {"settings": asdict(s), "cameras": runtime, "governor": governor.snapshot()}


@app.post("/api/detection/tiling", dependencies=control)
def update_tiling_settings(payload: TilingPayload):
    """Patch the tile engine live, for every running camera.

    Same contract as the confidence endpoint: process-wide, picked up on each
    camera's next AI cycle with no restart, and the APPLIED (clamped) settings
    are returned rather than the requested ones — an admin must see the values
    the engine is really using. Setting enabled=false (or max_tiles=0) returns
    every camera to plain single-pass full-frame inference immediately.
    """
    applied = set_tiling_settings(**payload.model_dump(exclude_unset=True))
    return {"success": True, "settings": asdict(applied)}

# Cameras
@app.get("/api/cameras")
def list_cameras():
    return get_all_cameras()

ALLOWED_UPLOAD_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}

@app.post("/api/cameras/upload", dependencies=control)
async def upload_camera_video(file: UploadFile = File(...)):
    ext = PurePosixPath(file.filename or "").suffix.lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_UPLOAD_EXTENSIONS))}")

    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = UPLOADS_DIR / safe_name
    with open(dest_path, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            out.write(chunk)

    return {"success": True, "path": str(dest_path)}

@app.post("/api/cameras", dependencies=control)
def add_or_update_camera(payload: CameraConfigPayload):
    save_camera(
        payload.id,
        payload.name,
        payload.type,
        payload.source,
        1 if payload.is_active else 0,
        payload.zones,
        payload.lines,
        payload.rules or "[]",
        payload.zone_profile,
        payload.profile_features or "{}"
    )
    # Restart or start the camera thread
    if payload.is_active:
        cameras = get_all_cameras()
        cam = next((c for c in cameras if c["id"] == payload.id), None)
        if cam:
            manager.start_camera_thread(cam)
    else:
        manager.stop_camera_thread(payload.id)
        
    return {"success": True, "message": "Camera saved successfully"}

@app.delete("/api/cameras/{camera_id}", dependencies=control)
def remove_camera(camera_id: str):
    manager.stop_camera_thread(camera_id)
    delete_camera(camera_id)
    return {"success": True, "message": "Camera removed successfully"}

# The AI-mode endpoint. payload.zone_profile is the camera's AI mode, and this
# is the only way it reaches the running pipeline — so this is precisely the
# door that has to stay shut to everything except the desktop app replaying an
# RLS-approved value out of the database.
@app.post("/api/cameras/{camera_id}/config", dependencies=control)
def update_camera_analytics(camera_id: str, payload: CameraAnalyticsPayload):
    cam = get_camera(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
        
    # Update SQLite
    save_camera(
        cam["id"],
        cam["name"],
        cam["type"],
        cam["source"],
        cam["is_active"],
        payload.zones,
        payload.lines,
        payload.rules or "[]",
        payload.zone_profile,
        payload.profile_features or "{}"
    )
    
    # Update live thread on-the-fly
    manager.update_camera_analytics_config(
        camera_id, 
        payload.zones, 
        payload.lines, 
        payload.rules or "[]", 
        payload.zone_profile, 
        payload.profile_features or "{}"
    )
    return {"success": True, "message": "Analytics config updated"}

@app.post("/api/cameras/{camera_id}/display")
def update_camera_display(camera_id: str, payload: CameraDisplayPayload):
    if camera_id not in manager.camera_threads:
        raise HTTPException(status_code=404, detail="Camera thread not running")
    manager.update_camera_display_config(camera_id, payload.max_width, payload.quality)
    return {"success": True, "message": "Display settings updated"}

@app.post("/api/cameras/{camera_id}/recording")
def set_camera_recording(camera_id: str, payload: CameraRecordingPayload):
    ok = manager.set_camera_recording(camera_id, payload.enabled)
    if not ok:
        raise HTTPException(status_code=404, detail="Camera thread not running")
    return {"success": True, "message": f"Recording {'resumed' if payload.enabled else 'paused'}"}

# Per-camera detailed telemetry (for profiling and diagnostics)
@app.get("/api/cameras/{camera_id}/telemetry")
def get_camera_telemetry(camera_id: str):
    thread = manager.camera_threads.get(camera_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Camera thread not running")
    return thread.latest_telemetry

# MJPEG Stream
@app.get("/api/cameras/{camera_id}/stream")
async def get_mjpeg_stream(camera_id: str):
    thread = manager.camera_threads.get(camera_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Camera thread not running or inactive")

    async def mjpeg_generator():
        last_jpeg = None
        while thread.running:
            jpeg_bytes = getattr(thread, "current_jpeg_bytes", None)
            if jpeg_bytes is not None and jpeg_bytes is not last_jpeg:
                last_jpeg = jpeg_bytes
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + jpeg_bytes + b'\r\n')
            await asyncio.sleep(0.03)

    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

# Alerts
@app.get("/api/alerts")
def fetch_alerts(limit: int = 50):
    return get_recent_alerts(limit)

@app.delete("/api/alerts")
def clear_alerts():
    clear_all_alerts()
    return {"success": True}

@app.delete("/api/alerts/{alert_id}")
def remove_single_alert(alert_id: str):
    from app.storage import delete_single_alert
    delete_single_alert(alert_id)
    return {"success": True}

# History
@app.get("/api/history")
def fetch_history_records(limit: int = 100):
    return get_history(limit)

@app.delete("/api/history")
def clear_history_records():
    clear_all_history()
    return {"success": True}

# Recordings
@app.get("/api/recordings")
def fetch_recordings():
    return get_all_recordings()

# Temporary debug endpoint for tracking down the pipeline memory-growth
# investigation — counts live Python objects by type, most common first.
@app.get("/api/debug/gc")
def debug_gc_counts(top: int = 25):
    import gc
    import collections
    gc.collect()
    counts = collections.Counter()
    sizes = collections.Counter()
    import sys as _sys
    for obj in gc.get_objects():
        t = type(obj).__name__
        counts[t] += 1
        try:
            sizes[t] += _sys.getsizeof(obj)
        except Exception:
            pass
    by_count = counts.most_common(top)
    by_size = sizes.most_common(top)
    return {
        "total_objects": sum(counts.values()),
        "by_count": by_count,
        "by_approx_size_bytes": by_size,
    }

# Fallback API Logs (for UI logs compatibility)
@app.get("/api/history/logs")
def fetch_api_logs():
    return {"count": 0, "logs": []}

@app.delete("/api/history/logs")
def clear_api_logs():
    return {"success": True}

# --- Enterprise Vehicle Speed Detection & Analytics APIs ---

class SpeedConfigPayload(BaseModel):
    camera_id: str
    speed_limit: Optional[float] = 50.0
    pixel_to_meter_scale: Optional[float] = 0.05
    camera_angle: Optional[float] = 30.0
    lane_width: Optional[float] = 3.5
    road_direction: Optional[str] = "both"
    src_points: Optional[List[List[float]]] = None
    dst_points: Optional[List[List[float]]] = None

@app.get("/api/traffic/speed-dashboard")
def get_traffic_speed_dashboard(camera_id: Optional[str] = None):
    from app.storage import get_speed_dashboard_stats
    return get_speed_dashboard_stats(camera_id)

@app.get("/api/traffic/speed-logs")
def get_traffic_speed_logs(camera_id: Optional[str] = None, limit: int = 100, is_overspeed: Optional[bool] = None):
    from app.storage import get_vehicle_speed_logs
    return get_vehicle_speed_logs(camera_id=camera_id, limit=limit, is_overspeed=is_overspeed)

@app.post("/api/traffic/speed-config", dependencies=control)
def update_traffic_speed_config(payload: SpeedConfigPayload):
    cam = get_camera(payload.camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    pf = json.loads(cam.get("profile_features") or "{}")
    pf["speed_detection"] = {
        "enabled": True,
        "speed_limit": payload.speed_limit,
        "pixel_to_meter_scale": payload.pixel_to_meter_scale,
        "camera_angle": payload.camera_angle,
        "lane_width": payload.lane_width,
        "road_direction": payload.road_direction,
        "src_points": payload.src_points,
        "dst_points": payload.dst_points,
    }
    
    pf_str = json.dumps(pf)
    save_camera(
        cam["id"], cam["name"], cam["type"], cam["source"], cam["is_active"],
        cam["zones"], cam["lines"], cam["rules"], cam["zone_profile"], pf_str
    )
    manager.update_camera_analytics_config(
        cam["id"], cam["zones"], cam["lines"], cam["rules"], cam["zone_profile"], pf_str
    )
    return {"success": True, "message": "Speed configuration saved successfully"}

@app.get("/api/traffic/export")
def export_traffic_logs(format: str = "csv", camera_id: Optional[str] = None, is_overspeed: Optional[bool] = None):
    from app.storage import get_vehicle_speed_logs
    logs = get_vehicle_speed_logs(camera_id=camera_id, limit=500, is_overspeed=is_overspeed)
    
    fmt = format.lower()
    if fmt == "pdf":
        lines = [
            "==================================================",
            "        CAMAI ENTERPRISE SPEED ANALYTICS REPORT    ",
            "==================================================",
            f"Generated At: {time.strftime('%Y-%m-%d %H:%M:%S')}",
            f"Total Logged Vehicles: {len(logs)}",
            "--------------------------------------------------",
            "Track ID | Vehicle Type | Speed (km/h) | Limit | Lane | Timestamp",
            "--------------------------------------------------"
        ]
        for l in logs:
            lines.append(f"#{l['track_id']:02d} | {l['vehicle_type']} | {l['speed_kmh']} km/h | {l['speed_limit_kmh']} km/h | {l.get('lane') or 'Main'} | {l['timestamp']}")
        lines.append("--------------------------------------------------")
        content = "\n".join(lines)
        return StreamingResponse(
            io.BytesIO(content.encode("utf-8")),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=speed_report_{int(time.time())}.pdf"}
        )
    elif fmt in ("excel", "xlsx", "tsv"):
        output = io.StringIO()
        output.write("Track ID\tVehicle Type\tSpeed (km/h)\tSpeed Limit\tIs Overspeed\tLane\tTimestamp\tCamera\n")
        for l in logs:
            output.write(f"{l['track_id']}\t{l['vehicle_type']}\t{l['speed_kmh']}\t{l['speed_limit_kmh']}\t{l['is_overspeed']}\t{l.get('lane') or 'Main'}\t{l['timestamp']}\t{l.get('camera_name') or l['camera_id']}\n")
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode("utf-8")),
            media_type="application/vnd.ms-excel",
            headers={"Content-Disposition": f"attachment; filename=speed_logs_{int(time.time())}.xls"}
        )
    else:  # csv
        output = io.StringIO()
        output.write("track_id,vehicle_type,speed_kmh,speed_limit_kmh,is_overspeed,lane,timestamp,camera_id\n")
        for l in logs:
            output.write(f"{l['track_id']},{l['vehicle_type']},{l['speed_kmh']},{l['speed_limit_kmh']},{l['is_overspeed']},{l.get('lane') or 'Main'},{l['timestamp']},{l['camera_id']}\n")
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode("utf-8")),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=speed_logs_{int(time.time())}.csv"}
        )



if __name__ == "__main__":
    import os
    import sys
    import socket
    import uvicorn
    from app.config import HOST, PORT

    dev_reload = os.getenv("CAMAI_DEV_RELOAD", "").strip().lower() in ("1", "true", "yes")

    # Wait if socket is temporarily busy in TIME_WAIT
    for attempt in range(1, 6):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            res = s.connect_ex((HOST, PORT))
            if res != 0:
                break
            print(f"[FastAPI] Port {PORT} is busy, waiting 2s for release... (attempt {attempt}/5)")
            time.sleep(2.0)

    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=dev_reload)





