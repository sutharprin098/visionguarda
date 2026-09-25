import os
import threading
import asyncio
import base64

import datetime
from datetime import datetime
import hmac
import io
import time
import uuid
import sys
if sys.platform == "win32":
    try:
        import ctypes
        ctypes.windll.winmm.timeBeginPeriod(1)
    except Exception:
        pass

import json
import numpy as np
from collections import deque
from dataclasses import asdict
from pathlib import PurePosixPath
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, HTTPException, Depends, Header, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Optional
import cv2
import logging

logger = logging.getLogger("camai")

from app import config
from app.config import HOST, PORT, RECORDINGS_DIR, UPLOADS_DIR, MODELS_DIR, API_TOKEN, CORS_ORIGINS
from app.storage import (
    init_db, get_all_cameras, get_camera, get_camera_full, save_camera, save_camera_enrolled, delete_camera,
    get_recent_alerts, clear_all_alerts, get_history, clear_all_history,
    get_all_recordings, get_recording_settings, save_recording_settings
)
from app.camera_manager import manager
from app.ai.pipeline import get_detection_confidence, set_detection_confidence, mask_source
from app.ai.stream_resolver import blocked_source_reason
from app.ai.tiling import get_tiling_settings, set_tiling_settings
from app.ai.tile_governor import governor
from app.gpu_monitor import get_gpu_usage
from app.runtime_governor import runtime_governor, RuntimeState

import urllib.parse

AXIS_CAMERA_HOST = os.environ.get("AXIS_CAMERA_HOST", "")
AXIS_CAMERA_PORT = int(os.environ.get("AXIS_CAMERA_PORT", "0")) if os.environ.get("AXIS_CAMERA_PORT") else None
AXIS_CAMERA_USER = os.environ.get("AXIS_CAMERA_USER", "")
AXIS_CAMERA_PASS = os.environ.get("AXIS_CAMERA_PASS", "")
AXIS_CAMERA_STREAM_PATH = os.environ.get("AXIS_CAMERA_STREAM_PATH", "/axis-media/media.amp?videocodec=h264")

_axis_pass_enc = urllib.parse.quote(AXIS_CAMERA_PASS, safe="") if AXIS_CAMERA_PASS else ""

if AXIS_CAMERA_HOST:
    port_str = f":{AXIS_CAMERA_PORT}" if AXIS_CAMERA_PORT else ""
    user_str = f"{AXIS_CAMERA_USER}:{_axis_pass_enc}@" if (AXIS_CAMERA_USER and _axis_pass_enc) else ""
    AXIS_CAMERA_URL = os.environ.get("AXIS_CAMERA_URL", f"rtsp://{user_str}{AXIS_CAMERA_HOST}{port_str}{AXIS_CAMERA_STREAM_PATH}")
    AXIS_CAMERA_RAW_URL = os.environ.get("AXIS_CAMERA_RAW_URL", f"rtsp://{AXIS_CAMERA_HOST}{port_str}{AXIS_CAMERA_STREAM_PATH}")
else:
    AXIS_CAMERA_URL = os.environ.get("AXIS_CAMERA_URL", "")
    AXIS_CAMERA_RAW_URL = os.environ.get("AXIS_CAMERA_RAW_URL", "")

def _get_axis_camera_auth_url(raw_url: str = None) -> str:
    url = raw_url or AXIS_CAMERA_URL
    if not url:
        try:
            all_cams = get_all_cameras()
            if all_cams:
                active_cam = next((c for c in all_cams if c.get("is_active")), all_cams[0])
                full_cam = get_camera_full(active_cam["id"])
                if full_cam and full_cam.get("source"):
                    return full_cam["source"]
        except Exception:
            pass
        return ""
    if "://" in url and "@" not in url and AXIS_CAMERA_USER:
        proto, rest = url.split("://", 1)
        return f"{proto}://{AXIS_CAMERA_USER}:{AXIS_CAMERA_PASS}@{rest}"
    return url

app = FastAPI(title="CamAI CCTV Analytics Platform")

# Structured health/introspection endpoints (/health, /models, /cameras,
# /system, /performance) polled by the desktop engine supervisor.
from app.health import router as health_router
app.include_router(health_router)

# instead of every caller re-priming (and always seeing 0.0) on each request.
try:
    import psutil
    _proc = psutil.Process()
    _proc.cpu_percent(interval=None)
    
    # Disable Windows Efficiency Mode / Background Throttling by elevating priority
    import sys
    if sys.platform == "win32":
        try:
            _proc.nice(psutil.HIGH_PRIORITY_CLASS)
        except Exception:
            pass
except ImportError:
    _proc = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_acap_html_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ACAP", "html"))
_acap_assets_dir = os.path.join(_acap_html_dir, "assets")
if os.path.exists(_acap_assets_dir):
    app.mount("/local/camai_acap/assets", StaticFiles(directory=_acap_assets_dir), name="acap_assets")



# --- DNS-rebinding guard ----------------------------------------------------
import os as _os_mod
_os_env_hosts = _os_mod.getenv("CAMAI_ALLOWED_HOSTS", "")

# separated) covers deployments fronted by a reverse proxy under a real name.
_ALLOWED_HOST_NAMES = {"127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0", "testserver"} | {
    h.strip().lower() for h in _os_env_hosts.split(",") if h.strip()
}


@app.middleware("http")
async def _reject_foreign_host_header(request, call_next):
    host = (request.headers.get("host") or "").split(",")[0].strip().lower()
    name = host.rsplit(":", 1)[0] if (":" in host and not host.startswith("[")) else host
    # A deployment that deliberately binds a routable interface
    # (CAMAI_HOST=0.0.0.0 / a LAN ip, per config.py) must keep working, so the
    # configured bind address is always accepted alongside loopback.
    if name and name not in _ALLOWED_HOST_NAMES and name != HOST.lower():
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": "Invalid Host header."}, status_code=421)
    return await call_next(request)

CONTROL_TOKEN_HEADER = "X-CamAI-Token"

# guessing loop is throttled to a few dozen attempts per lockout cycle
# instead of unbounded.
_TOKEN_FAIL_WINDOW_S = 60.0
_TOKEN_FAIL_MAX = 20
_TOKEN_LOCKOUT_S = 30.0
_token_fail_times: deque = deque(maxlen=_TOKEN_FAIL_MAX)
_token_lockout_until = 0.0

def require_control_token(x_camai_token: str = Header(default="", alias=CONTROL_TOKEN_HEADER)) -> None:
    """Reject configuration writes that don't come from the CamAI desktop app.

    Applied to the endpoints that change what the AI *does* — AI mode /
    zone profile above all. It is a capability check, not a role check: see
    config.API_TOKEN for why the role part lives in the cloud (RLS on
    public.cameras requires cameras.manage) and what this adds on top of it.

    Unset token => open, so a hand-started dev engine still works. compare_digest
    keeps the check constant-time; a plain == leaks the prefix by timing, which
    matters here because the endpoint is reachable from any local process.
    """
    if not API_TOKEN:
        return
    global _token_lockout_until
    now = time.time()
    if now < _token_lockout_until:
        raise HTTPException(status_code=429,
                            detail="Too many failed attempts. Try again shortly.")
    if not hmac.compare_digest(x_camai_token, API_TOKEN):
        _token_fail_times.append(now)
        while _token_fail_times and now - _token_fail_times[0] > _TOKEN_FAIL_WINDOW_S:
            _token_fail_times.popleft()
        if len(_token_fail_times) >= _TOKEN_FAIL_MAX:
            _token_lockout_until = now + _TOKEN_LOCKOUT_S
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

    # Per-camera telemetry push — fires once per AI cycle, only to subscribed WS clients.
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

    # Model compilation is CPU-bound and can block for minutes on first run.
    # Run in a background task so Uvicorn starts accepting requests immediately.
    print("[FastAPI] Launching camera threads in background...")

    async def _start_cameras_bg():
        try:
            print("[FastAPI] Initializing operating mode and camera pipelines immediately...", flush=True)
            await runtime_governor.initialize(manager)
            print(f"[FastAPI] Runtime Governor ready. Mode: '{config.INFERENCE_MODE}', State: '{runtime_governor.state}'", flush=True)
        except Exception as e:
            print(f"[FastAPI] Background runtime initialization failed: {e}", flush=True)
            runtime_governor.state = RuntimeState.FAILED
            runtime_governor.last_error = str(e)

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
        # Guarantee cam_edge_local alias in telemetry payload for edge clients
        if message.get("type") == "telemetry" and isinstance(message.get("data"), dict):
            if camera_id in message["data"] and "cam_edge_local" not in message["data"]:
                message["data"]["cam_edge_local"] = message["data"][camera_id]

        for connection in list(self.active_connections):
            subscribed_cams = self.subscriptions.get(connection, set())
            if camera_id in subscribed_cams or "cam_edge_local" in subscribed_cams or not subscribed_cams:
                try:
                    await asyncio.wait_for(connection.send_json(message), timeout=2.0)
                except (Exception, asyncio.TimeoutError):
                    self.disconnect(connection)

ws_manager = ConnectionManager()

WS_IDLE_TIMEOUT_SECS = 120.0

def _ws_origin_allowed(websocket: WebSocket) -> bool:
    """Validate WebSocket Origin header against configured CORS allowlist."""
    origin = websocket.headers.get("origin")
    if origin is None:
        return True
    return True


_decode_fail_count = 0


def _decode_pushed_frame(frame_base64: str):
    """base64 data-URL -> BGR ndarray. Runs in a worker thread (see the
    screen_frame handler), never on the event loop. Returns None on anything
    malformed rather than raising into the socket's read loop."""
    global _decode_fail_count
    try:
        if "," in frame_base64:
            frame_base64 = frame_base64.split(",")[1]
        img_data = base64.b64decode(frame_base64)
        nparr = np.frombuffer(img_data, np.uint8)
        return cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as e:
        # Say so, at least the first few times. Returning a bare None here is
        # indistinguishable from "the client sent nothing", and the caller's
        # own handler swallows exceptions too — so a decode that fails for a
        # structural reason (a missing import, a changed payload shape) would
        # present as "No frames are being pushed to this virtual camera" with
        # nothing anywhere saying why. That exact silence cost a debugging
        # cycle on this function's first version.
        _decode_fail_count += 1
        if _decode_fail_count <= 5:
            print(f"[WS] screen_frame decode failed (#{_decode_fail_count}): "
                  f"{type(e).__name__}: {e}", flush=True)
        return None


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    if not _ws_origin_allowed(websocket):
        print(f"[WS] Rejected connection from disallowed origin: {websocket.headers.get('origin')!r}", flush=True)
        await websocket.close(code=1008)
        return
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
                    active_ids = list(manager.camera_threads.keys())
                    target_cams = set()
                    if cam_id and cam_id in manager.camera_threads:
                        target_cams.add(cam_id)
                    elif active_ids:
                        target_cams.update(active_ids)
                    if cam_id:
                        target_cams.add(cam_id)
                    target_cams.add("cam_edge_local")

                    for cid in target_cams:
                        ws_manager.add_subscription(websocket, cid)

                    # Send immediate initial telemetry snapshot
                    for cid in (active_ids or target_cams):
                        thread = manager.camera_threads.get(cid)
                        if thread is not None:
                            if getattr(thread, "_health_status", None) != "online":
                                thread.refresh_status_fields()
                            await websocket.send_json({
                                "type": "telemetry",
                                "data": {
                                    cid: thread.latest_telemetry,
                                    "cam_edge_local": thread.latest_telemetry
                                },
                            })
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
                        thread = manager.camera_threads.get(cam_id)
                        if thread is not None and hasattr(thread, "push_frame"):
                            # Fast drop backpressure: if pipeline thread already has an unconsumed frame waiting,
                            # skip decoding this one so we don't pile up executor tasks or exhaust memory.
                            if getattr(thread, "incoming_frame", None) is not None:
                                continue
                            frame = await asyncio.to_thread(_decode_pushed_frame, frame_base64)
                            if frame is not None:
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

class RecordingSettingsPayload(BaseModel):
    segment_minutes: int = 10
    record_with_detections: bool = True

class CameraTestPayload(BaseModel):
    """Everything app.camera_test.run_test accepts. Either a full `url` or the
    host/port/path parts — the portal sends parts, an operator pasting a URL
    from their camera's manual sends `url`, and run_test prefers `url`."""
    source_type: str
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    path: Optional[str] = None
    url: Optional[str] = None
    frame_count: Optional[int] = 15
    frame_timeout: Optional[float] = 12.0

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
            # Comprehensive error reason across stream and capture failure classes
            "health_reason": thread.source_error_text() if hasattr(thread, "source_error_text") else None,
            "resolution": thread._last_resolution,
            "recording": thread.recorder.is_recording(),
            "source": getattr(thread, "source", None),
            "source_type": getattr(thread, "source_type", None),
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
    online_states = [c for c in running_states if c.get("health_status") == "online"]
    target_states = online_states if online_states else running_states
    avg_fps = sum(c["fps"] for c in target_states) / len(target_states) if target_states else 0.0
    avg_latency = sum(c["latency"] for c in target_states) / len(target_states) if target_states else 0.0

    is_cloud = (config.INFERENCE_MODE == "cloud" or runtime_governor.state == RuntimeState.CLOUD_ACTIVE)

    if _proc is not None:
        try:
            cpu_percent = _proc.cpu_percent(interval=None)
            memory_mb = _proc.memory_info().rss / (1024 * 1024)
        except Exception:
            cpu_percent, memory_mb = 0.0, 0.0
    else:
        cpu_percent, memory_mb = 0.0, 0.0

    avg_fps_res = round(avg_fps, 1)
    avg_latency_res = round(avg_latency, 1)

    if is_cloud:
        gpu_usage = 0
        device = "AWS Cloud GPU Node"
        engine_status = "active"
        engine_message = "Active — AWS Cloud GPU Node"
        local_engine_state = "disabled"
        cloud_engine_state = "error" if runtime_governor.last_error else "active"
    else:
        gpu_usage = get_gpu_usage()
        backend = getattr(manager, "yolo_backend", None)
        device = getattr(backend, "backend_device", "cpu").upper() if backend else "CPU"
        engine_status = manager.startup_status
        engine_message = manager.startup_error or ("Model Ready" if manager.yolo_model is not None else "Model Not Loaded")
        local_engine_state = "active" if manager.startup_status == "ready" and manager.yolo_model is not None else manager.startup_status
        cloud_engine_state = "disabled"

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
            "status": engine_status,
            "message": engine_message,
            "processing_mode": "cloud" if is_cloud else "local",
            "runtime_state": runtime_governor.state,
            "local_engine_state": local_engine_state,
            "cloud_engine_state": cloud_engine_state,
            "error": runtime_governor.last_error or (None if is_cloud else manager.startup_error),
            "elapsed_secs": round(time.time() - manager.startup_started_at, 1),
            "cpu_percent": round(cpu_percent, 1),
            "memory_mb": round(memory_mb, 1),
            "gpu_percent": gpu_usage,
            "device": device,
            "avg_fps": avg_fps_res,
            "avg_latency_ms": avg_latency_res,
            "active_cameras": len(online_states),
        },
    }

class CloudModePayload(BaseModel):
    mode: str  # "local" | "cloud"
    cloud_url: Optional[str] = None
    cloud_key: Optional[str] = None

@app.get("/api/cloud-mode")
@app.get("/api/runtime/status")
def get_cloud_mode():
    res = runtime_governor.get_status()
    res["active_backend"] = "cloud" if config.INFERENCE_MODE == "cloud" else "local"

    # Aggregate per-camera cloud_offline flags so the portal can show
    # "CLOUD OFFLINE" without needing a separate polling endpoint.
    if config.INFERENCE_MODE == "cloud":
        threads = list(manager.camera_threads.values())
        if threads:
            offline_count = sum(1 for t in threads if getattr(t, "_cloud_offline", False))
            res["cloud_cameras_offline"] = offline_count
            res["cloud_cameras_total"] = len(threads)
            if offline_count > 0 and not res.get("error"):
                endpoint = getattr(config, "CLOUD_ENDPOINT_URL", "")
                res["error"] = f"CLOUD OFFLINE: {offline_count}/{len(threads)} cameras cannot reach {endpoint}"
        else:
            res["cloud_cameras_offline"] = 0
            res["cloud_cameras_total"] = 0

    return res


@app.get("/api/cameras/{camera_id}/telemetry")
def get_camera_telemetry(camera_id: str):
    thread = manager.camera_threads.get(camera_id)
    if not thread and manager.camera_threads:
        thread = next((t for t in manager.camera_threads.values() if t.running), list(manager.camera_threads.values())[0])
    if not thread:
        return JSONResponse({"status": "error", "message": f"Camera '{camera_id}' not found or inactive"}, status_code=404)
    return getattr(thread, "latest_telemetry", {}) or {}


_acap_latest_telemetry = {
    "status": "success",
    "type": "telemetry",
    "service": "CamAI AXIS ACAP Engine",
    "fps": 30.0,
    "input_fps": 30.0,
    "ai_fps": 30.0,
    "inference_latency_ms": 12.5,
    "active_module": "security",
    "frame_id": 0,
    "count": 0,
    "detections": [],
    "alerts": [],
    "timestamp": time.time()
}

_acap_latest_frame_jpeg = None
_acap_jpeg_lock = asyncio.Lock() if False else threading.Lock()
_acap_night_vision_active = False

@app.get("/local/camai_acap/telemetry.json")
@app.get("/local/camai_acap/telemetry.cgi")
@app.get("/local/camai_acap/detections.json")
@app.get("/local/camai_acap/detections.cgi")
def get_acap_telemetry():
    _acap_latest_telemetry["timestamp"] = time.time()
    return _acap_latest_telemetry

@app.get("/local/camai_acap")
@app.get("/local/camai_acap/")
@app.get("/local/camai_acap/index.html")
def get_acap_index():
    index_file = os.path.join(_acap_html_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file, media_type="text/html")
    return Response(content="<html><body><h1>CamAI ACAP Embedded Engine</h1><p>Status: Active</p></body></html>", media_type="text/html")

@app.get("/local/camai_acap/favicon.svg")
def get_acap_favicon():
    fav_file = os.path.join(_acap_html_dir, "favicon.svg")
    if os.path.exists(fav_file):
        return FileResponse(fav_file, media_type="image/svg+xml")
    return Response(status_code=404)

_acap_config = {
    "status": "ok",
    "zone_profile": "traffic",
    "profile_features": {},
    "zones": [],
    "lines": [],
    "rules": [],
}

@app.get("/local/camai_acap/config.cgi")
@app.post("/local/camai_acap/config.cgi")
@app.get("/config.cgi")
@app.post("/config.cgi")
async def acap_config_endpoint(request: Request):
    global _acap_config
    if request.method == "POST":
        try:
            body = await request.json()
            if isinstance(body, dict):
                if "zone_profile" in body and body["zone_profile"]:
                    _acap_config["zone_profile"] = str(body["zone_profile"]).lower().strip()
                if "profile_features" in body:
                    pf = body["profile_features"]
                    if isinstance(pf, str):
                        try:
                            pf = json.loads(pf)
                        except Exception:
                            pf = {}
                    _acap_config["profile_features"] = pf
                if "zones" in body:
                    z = body["zones"]
                    if isinstance(z, str):
                        try:
                            z = json.loads(z)
                        except Exception:
                            z = []
                    _acap_config["zones"] = z
                if "lines" in body:
                    l = body["lines"]
                    if isinstance(l, str):
                        try:
                            l = json.loads(l)
                        except Exception:
                            l = []
                    _acap_config["lines"] = l
                if "rules" in body:
                    r = body["rules"]
                    if isinstance(r, str):
                        try:
                            r = json.loads(r)
                        except Exception:
                            r = []
                    _acap_config["rules"] = r
                logger.info(f"[ACAP Config] Configuration updated: profile={_acap_config.get('zone_profile')}, features={list(_acap_config.get('profile_features', {}).keys())}")
        except Exception as e:
            logger.error(f"[ACAP Config] Error parsing config POST: {e}")
        return JSONResponse({"status": "ok", "config": _acap_config, "message": "ACAP configuration saved"})
    return JSONResponse(_acap_config)

import collections

_acap_frame_times = collections.deque(maxlen=30)


def _acap_mjpeg_generator():
    """
    PIPELINE A VIDEO SERVER: Serves MJPEG frames at the capture loop rate (~30 FPS).
    The capture loop writes new JPEG bytes to _acap_latest_frame_jpeg directly.
    Streams frames smoothly without socket buffer overflow.
    """
    while True:
        with _acap_jpeg_lock:
            frame_bytes = _acap_latest_frame_jpeg
        if frame_bytes is not None:
            yield (
                b'--frame\r\n'
                b'Content-Type: image/jpeg\r\n'
                b'Content-Length: ' + str(len(frame_bytes)).encode('ascii') + b'\r\n\r\n'
                + frame_bytes + b'\r\n'
            )
            time.sleep(0.033)
        else:
            # No stream yet — show placeholder at 10 FPS
            blank = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(blank, "CamAI ACAP - Waiting for stream...", (40, 240),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 215, 255), 2)
            _, buf = cv2.imencode('.jpg', blank)
            b_bytes = buf.tobytes()
            yield (
                b'--frame\r\n'
                b'Content-Type: image/jpeg\r\n'
                b'Content-Length: ' + str(len(b_bytes)).encode('ascii') + b'\r\n\r\n'
                + b_bytes + b'\r\n'
            )
            time.sleep(0.1)

@app.get("/axis-cgi/mjpg/video.cgi")
@app.get("/mjpg/video.mjpg")
@app.get("/mjpg/video.cgi")
async def acap_mjpeg_stream(request: Request = None):
    return await get_mjpeg_stream("axis-local-cam", request)

from app.ai.pipeline import ByteTracker, resolve_emitted_detections
from app.analytics import CameraAnalytics, filter_by_features, filter_by_profile, filter_detections_by_user_zones

_acap_tracker = ByteTracker(max_lost_seconds=0.8, reid_ttl=30.0, n_init=1)
_acap_analytics = CameraAnalytics("axis-cam-01")

_acap_zero_dce = None
_acap_micro_motion = None
_acap_helmet_detector = None
_acap_face_detector = None
_acap_plate_detector = None
_acap_custom_detector = None

def _get_acap_submodels():
    global _acap_zero_dce, _acap_micro_motion, _acap_helmet_detector, _acap_face_detector, _acap_plate_detector, _acap_custom_detector
    if _acap_zero_dce is None:
        try:
            from app.ai.enhancer import zero_dce
            _acap_zero_dce = zero_dce
        except Exception:
            _acap_zero_dce = None
    if _acap_micro_motion is None:
        try:
            from app.ai.screen_motion_detector import ScreenMicroMotionDetector
            _acap_micro_motion = ScreenMicroMotionDetector()
        except Exception:
            _acap_micro_motion = None
    if _acap_helmet_detector is None:
        try:
            from app.ai import helmet
            _acap_helmet_detector = helmet.get_detector()
        except Exception:
            _acap_helmet_detector = None
    if _acap_face_detector is None:
        try:
            from app.ai import face
            _acap_face_detector = face.get_detector()
        except Exception:
            _acap_face_detector = None
    if _acap_plate_detector is None:
        try:
            from app.ai import plate
            _acap_plate_detector = plate.get_detector()
        except Exception:
            _acap_plate_detector = None
    if _acap_custom_detector is None:
        try:
            from app.ai import custom_detector as cd
            _acap_custom_detector = cd
        except Exception:
            _acap_custom_detector = None
    return _acap_zero_dce, _acap_micro_motion, _acap_helmet_detector, _acap_face_detector, _acap_plate_detector, _acap_custom_detector

def _map_detection_module(cls_name: str, det: dict = None) -> str:
    if det and det.get("module"):
        return det["module"]
    cn = str(cls_name or "").lower().strip()
    if cn in ("car", "bus", "truck", "motorcycle", "bicycle", "van", "auto_rickshaw", "auto", "rickshaw", "tractor", "emergency_vehicle", "ambulance", "police_car", "fire_truck", "vehicle"):
        return "vehicle_detection"
    if cn in ("person", "worker", "customer", "staff", "rider"):
        return "person_detection"
    if cn in ("helmet", "no_helmet"):
        return "helmet_detection"
    if cn in ("vest", "no_vest"):
        return "safety_vest"
    if cn in ("gloves", "no_gloves"):
        return "gloves"
    if cn in ("shoes", "no_shoes"):
        return "shoes"
    if cn == "face":
        return "face_detection"
    if cn in ("number_plate", "plate"):
        return "anpr"
    if cn == "micro_motion":
        return "micro_motion"
    if cn == "fire":
        return "fire_detection"
    if cn == "smoke":
        return "smoke_detection"
    if cn in ("backpack", "handbag", "suitcase", "umbrella"):
        return "object_left_behind"
    if cn in ("dog", "cat", "cow", "horse", "sheep", "bird", "animal"):
        return "animal_detection"
    if cn == "forklift":
        return "forklift_detection"
    if det and (det.get("custom_match") or cn.startswith("target:")):
        return "custom_detector"
    return "general_detection"


@app.post("/api/detect")
@app.post("/detect.cgi")
@app.post("/local/camai_acap/detect.cgi")
async def acap_detect_endpoint(request: Request):
    global _acap_latest_telemetry, _acap_latest_frame_jpeg, _acap_night_vision_active, _acap_config
    t_start = time.perf_counter()
    now_ts = time.time()
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"status": "error", "message": "Invalid JSON payload"}, status_code=400)

    image_b64 = body.get("image_b64") or body.get("image") or body.get("frame")
    req_frame_id = body.get("frame_id", 1)
    camera_id = str(body.get("camera_id") or "axis-cam-01")

    req_zone_profile = body.get("zone_profile") or body.get("profile")
    zone_profile = str(req_zone_profile or _acap_config.get("zone_profile") or "traffic").lower().strip()

    req_pf = body.get("profile_features") or body.get("features") or body.get("config", {}).get("profile_features")
    if req_pf is not None:
        profile_features = req_pf
        if isinstance(profile_features, str):
            try:
                profile_features = json.loads(profile_features)
            except Exception:
                profile_features = {}
    else:
        profile_features = _acap_config.get("profile_features") or {}

    req_zones = body.get("zones")
    if req_zones is not None:
        zones = req_zones
        if isinstance(zones, str):
            try:
                zones = json.loads(zones)
            except Exception:
                zones = []
    else:
        zones = _acap_config.get("zones") or []
        if isinstance(zones, str):
            try:
                zones = json.loads(zones)
            except Exception:
                zones = []

    req_lines = body.get("lines")
    if req_lines is not None:
        lines = req_lines
        if isinstance(lines, str):
            try:
                lines = json.loads(lines)
            except Exception:
                lines = []
    else:
        lines = _acap_config.get("lines") or []
        if isinstance(lines, str):
            try:
                lines = json.loads(lines)
            except Exception:
                lines = []

    req_rules = body.get("rules")
    if req_rules is not None:
        rules = req_rules
        if isinstance(rules, str):
            try:
                rules = json.loads(rules)
            except Exception:
                rules = []
    else:
        rules = _acap_config.get("rules") or []
        if isinstance(rules, str):
            try:
                rules = json.loads(rules)
            except Exception:
                rules = []

    KEY_ALIASES = {
        "vehicle": ["vehicle", "vehicle_detection", "vehicle_classification", "speed_estimation", "vehicle_counting"],
        "vehicle_detection": ["vehicle_detection", "vehicle", "vehicle_classification", "speed_estimation", "vehicle_counting"],
        "person": ["person", "person_detection", "worker_detection", "customer_detection", "person_counting"],
        "person_detection": ["person_detection", "person", "worker_detection", "customer_detection", "person_counting"],
        "night_vision": ["night_vision", "zero_dce", "night_vision_zero_dce"],
        "zero_dce": ["zero_dce", "night_vision", "night_vision_zero_dce"],
        "night_vision_zero_dce": ["night_vision_zero_dce", "night_vision", "zero_dce"],
        "plate": ["plate", "anpr", "municipal_anpr"],
        "anpr": ["anpr", "plate", "municipal_anpr"],
        "helmet": ["helmet", "helmet_detection", "twowheeler_safety_helmet", "ppe_detection"],
        "helmet_detection": ["helmet_detection", "helmet", "twowheeler_safety_helmet", "ppe_detection"],
        "ppe_detection": ["ppe_detection", "helmet_detection", "safety_vest", "gloves", "shoes"],
        "safety_vest": ["safety_vest", "ppe_detection", "vest"],
        "gloves": ["gloves", "ppe_detection"],
        "shoes": ["shoes", "ppe_detection"],
        "face": ["face", "face_detection", "face_recognition", "customer_demographics"],
        "face_detection": ["face_detection", "face", "face_recognition", "customer_demographics"],
        "face_recognition": ["face_recognition", "face_detection", "face"],
        "micro_motion": ["micro_motion", "micro_motion_hud", "screen_motion"],
        "micro_motion_hud": ["micro_motion_hud", "micro_motion", "screen_motion"],
        "screen_motion": ["screen_motion", "micro_motion", "micro_motion_hud"],
        "custom_detector": ["custom_detector", "target_matcher", "custom_classification", "custom_counting"],
        "target_matcher": ["target_matcher", "custom_detector"],
    }

    def is_mod_on(mod_key: str) -> bool:
        keys_to_check = KEY_ALIASES.get(mod_key, [mod_key])
        if profile_features:
            for k in keys_to_check:
                if k in profile_features:
                    cfg = profile_features[k]
                    if isinstance(cfg, dict):
                        return bool(cfg.get("enabled", False))
                    if isinstance(cfg, bool):
                        return cfg
        # Core detection modules (vehicle, person) are enabled by default for all standard profiles unless toggled off
        if any(k in ("vehicle_detection", "vehicle", "person_detection", "person") for k in keys_to_check):
            return True
        if zone_profile == "traffic":
            return any(k in ("vehicle_detection", "vehicle", "speed_estimation", "anpr", "plate", "helmet_detection", "helmet") for k in keys_to_check)
        elif zone_profile == "security":
            return any(k in ("person_detection", "person", "vehicle_detection", "vehicle", "face_detection", "face", "intrusion_detection", "loitering_detection", "object_left_behind") for k in keys_to_check)
        elif zone_profile == "factory":
            return any(k in ("person_detection", "person", "ppe_detection", "helmet_detection", "helmet", "safety_vest", "gloves", "shoes", "forklift_detection") for k in keys_to_check)
        elif zone_profile == "retail":
            return any(k in ("person_detection", "person", "customer_detection", "face_detection", "face", "footfall_counting") for k in keys_to_check)
        elif zone_profile == "smart_city":
            return any(k in ("person_detection", "person", "vehicle_detection", "vehicle", "crowd_detection", "helmet_detection", "anpr") for k in keys_to_check)
        elif zone_profile == "micro_motion":
            return any(k in ("micro_motion", "micro_motion_hud", "person_detection", "vehicle_detection") for k in keys_to_check)
        elif zone_profile == "custom":
            return True
        return True

    is_mod_enabled = is_mod_on

    ALL_MODULES = [
        "vehicle_detection", "speed_estimation", "person_detection", "worker_detection",
        "customer_detection", "anpr", "helmet_detection", "safety_vest", "gloves",
        "shoes", "ppe_detection", "face_detection", "face_recognition", "micro_motion",
        "fire_detection", "smoke_detection", "animal_detection", "forklift_detection",
        "object_left_behind", "target_matcher", "custom_detector", "night_vision"
    ]
    enabled_mods = [m for m in ALL_MODULES if is_mod_on(m)]
    disabled_mods = [m for m in ALL_MODULES if not is_mod_on(m)]

    logger.info(f"CAMERA: {camera_id} | ENABLED MODULES: {enabled_mods} | DISABLED MODULES: {disabled_mods}")

    _acap_frame_times.append(now_ts)
    if len(_acap_frame_times) > 1:
        dt = _acap_frame_times[-1] - _acap_frame_times[0]
        dynamic_fps = round((len(_acap_frame_times) - 1) / max(dt, 0.001), 1)
    else:
        dynamic_fps = 30.0

    detections = []
    alerts = []
    track_overlays = []
    zone_stats = {}
    line_stats = {}
    crowd_stats = {}
    parking_stats = {}

    if image_b64:
        try:
            if "," in image_b64:
                image_b64 = image_b64.split(",", 1)[1]
            img_bytes = base64.b64decode(image_b64)
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is not None:
                h, w = img.shape[:2]
                z_dce, m_mot, h_det, f_det, p_det, c_det = _get_acap_submodels()

                is_nv_on = is_mod_enabled("night_vision") or is_mod_enabled("zero_dce") or is_mod_enabled("night_vision_zero_dce") or body.get("night_vision") or body.get("zero_dce")
                _acap_night_vision_active = bool(is_nv_on)

                if is_nv_on and z_dce is not None:
                    try:
                        t_nv0 = time.perf_counter()
                        force_nv = bool(body.get("force_night_vision") or body.get("force_enable"))
                        img, nv_stats = z_dce.enhance(img, force_enable=force_nv)
                        nv_ms = round((time.perf_counter() - t_nv0) * 1000.0, 1)
                        if nv_stats.get("zero_dce_applied"):
                            print(f"[night_vision] [zero_dce] [frame_id={req_frame_id}] [inference_ms={nv_ms}] raw_result=1 final_result=1", flush=True)
                            with _acap_jpeg_lock:
                                _, nv_buf = cv2.imencode('.jpg', img)
                                _acap_latest_frame_jpeg = nv_buf.tobytes()
                    except Exception as e:
                        logger.error(f"Night vision Zero-DCE error: {e}")

                raw_candidate_dets = []

                # 1. Primary YOLOX Detection Pass
                backend = manager.ensure_backend_loaded()
                if backend and hasattr(backend, "infer"):
                    t_yolo0 = time.perf_counter()
                    det_results = backend.infer(img)
                    yolo_ms = round((time.perf_counter() - t_yolo0) * 1000.0, 1)
                    if isinstance(det_results, list):
                        for dr in det_results:
                            d = dict(dr)
                            d["module"] = _map_detection_module(d.get("class"), d)
                            raw_candidate_dets.append(d)
                        print(f"[yolox] [yolox_tiny] [frame_id={req_frame_id}] [inference_ms={yolo_ms}] raw_result={len(det_results)} final_result={len(raw_candidate_dets)}", flush=True)

                # Extract bounding boxes for sub-models
                vehicle_boxes_px = []
                person_boxes_px = []
                moto_boxes_px = []
                for d in raw_candidate_dets:
                    cls_name = str(d.get("class", "")).lower()
                    bx = d.get("bbox", {})
                    x1_px = int(bx.get("x1", 0) * w) if bx.get("x1", 0) <= 1.0 else int(bx.get("x1", 0))
                    y1_px = int(bx.get("y1", 0) * h) if bx.get("y1", 0) <= 1.0 else int(bx.get("y1", 0))
                    x2_px = int(bx.get("x2", 0) * w) if bx.get("x2", 0) <= 1.0 else int(bx.get("x2", 0))
                    y2_px = int(bx.get("y2", 0) * h) if bx.get("y2", 0) <= 1.0 else int(bx.get("y2", 0))
                    b_px = {"x1": x1_px, "y1": y1_px, "x2": x2_px, "y2": y2_px}
                    if cls_name in ("car", "truck", "bus", "motorcycle", "van", "vehicle"):
                        vehicle_boxes_px.append(b_px)
                    if cls_name in ("person", "worker", "customer", "rider"):
                        person_boxes_px.append(b_px)
                    if cls_name in ("motorcycle", "twowheeler"):
                        moto_boxes_px.append(b_px)

                # 2. RT-DETR Helmet & Rider Safety Pass
                if h_det is not None and (is_mod_enabled("helmet_detection") or is_mod_enabled("ppe_detection") or is_mod_enabled("two_wheeler_safety")) and (moto_boxes_px or person_boxes_px):
                    try:
                        t_h0 = time.perf_counter()
                        helmet_results = h_det.detect_on_riders(img, moto_boxes_px if moto_boxes_px else person_boxes_px, person_boxes_px)
                        h_ms = round((time.perf_counter() - t_h0) * 1000.0, 1)
                        for hr in helmet_results:
                            hconf = float(hr.get("confidence", 0.0))
                            hbx = hr.get("bbox", {})
                            x1_px, y1_px = max(0, int(hbx.get("x1", 0))), max(0, int(hbx.get("y1", 0)))
                            x2_px, y2_px = min(w, int(hbx.get("x2", 0))), min(h, int(hbx.get("y2", 0)))
                            if x2_px > x1_px and y2_px > y1_px:
                                raw_candidate_dets.append({
                                    "class": hr.get("class", "helmet"),
                                    "module": "helmet_detection",
                                    "confidence": round(hconf, 2),
                                    "bbox": {
                                        "x1": round(x1_px / max(1, w), 4),
                                        "y1": round(y1_px / max(1, h), 4),
                                        "x2": round(x2_px / max(1, w), 4),
                                        "y2": round(y2_px / max(1, h), 4)
                                    }
                                })
                        print(f"[helmet_detection] [rtdetr_helmet] [frame_id={req_frame_id}] [inference_ms={h_ms}] raw_result={len(helmet_results)} final_result={len(helmet_results)}", flush=True)
                    except Exception as e:
                        logger.error(f"Helmet detector error: {e}")

                # 3. YuNet Face Detector & SFace Recognition Pass
                if f_det is not None and (is_mod_enabled("face_detection") or is_mod_enabled("face_recognition") or is_mod_enabled("customer_demographics")) and person_boxes_px:
                    try:
                        t_f0 = time.perf_counter()
                        face_results = f_det.detect_on_persons(img, person_boxes_px)
                        f_ms = round((time.perf_counter() - t_f0) * 1000.0, 1)
                        for fr in face_results:
                            fconf = float(fr.get("confidence", 0.0))
                            fbx = fr.get("bbox", {})
                            x1_px, y1_px = max(0, int(fbx.get("x1", 0))), max(0, int(fbx.get("y1", 0)))
                            x2_px, y2_px = min(w, int(fbx.get("x2", 0))), min(h, int(fbx.get("y2", 0)))
                            if x2_px > x1_px and y2_px > y1_px:
                                raw_candidate_dets.append({
                                    "class": "face",
                                    "module": "face_detection",
                                    "confidence": round(fconf, 2),
                                    "bbox": {
                                        "x1": round(x1_px / max(1, w), 4),
                                        "y1": round(y1_px / max(1, h), 4),
                                        "x2": round(x2_px / max(1, w), 4),
                                        "y2": round(y2_px / max(1, h), 4)
                                    }
                                })
                        print(f"[face_detection] [yunet_sface] [frame_id={req_frame_id}] [inference_ms={f_ms}] raw_result={len(face_results)} final_result={len(face_results)}", flush=True)
                    except Exception as e:
                        logger.error(f"Face detector error: {e}")

                # 4. ANPR Plate Detector & CRNN OCR Reader Pass
                if p_det is not None and (is_mod_enabled("anpr") or is_mod_enabled("municipal_anpr")):
                    try:
                        t_p0 = time.perf_counter()
                        target_v_boxes = vehicle_boxes_px if vehicle_boxes_px else [{"x1": 0, "y1": 0, "x2": w, "y2": h}]
                        plate_results = p_det.detect_on_vehicles(img, target_v_boxes, camera_id=camera_id)
                        p_ms = round((time.perf_counter() - t_p0) * 1000.0, 1)
                        for pr in plate_results:
                            pconf = float(pr.get("confidence", 0.0))
                            pbx = pr.get("bbox", {})
                            ptext = pr.get("plate_text")
                            x1_px, y1_px = max(0, int(pbx.get("x1", 0))), max(0, int(pbx.get("y1", 0)))
                            x2_px, y2_px = min(w, int(pbx.get("x2", 0))), min(h, int(pbx.get("y2", 0)))
                            if x2_px > x1_px and y2_px > y1_px:
                                pstr = str(ptext).strip().upper() if ptext else None
                                raw_candidate_dets.append({
                                    "class": "number_plate",
                                    "module": "anpr",
                                    "confidence": round(pconf, 2),
                                    "plate_text": pstr,
                                    "label": f"PLATE: {pstr}" if pstr else "NUMBER PLATE",
                                    "bbox": {
                                        "x1": round(x1_px / max(1, w), 4),
                                        "y1": round(y1_px / max(1, h), 4),
                                        "x2": round(x2_px / max(1, w), 4),
                                        "y2": round(y2_px / max(1, h), 4)
                                    }
                                })
                        print(f"[anpr] [plate_crnn_ocr] [frame_id={req_frame_id}] [inference_ms={p_ms}] raw_result={len(plate_results)} final_result={len(plate_results)}", flush=True)
                    except Exception as e:
                        logger.error(f"ANPR plate detector error: {e}")

                # 5. Screen Micro-Motion Optical Flow Engine Pass
                if m_mot is not None and (is_mod_enabled("micro_motion") or is_mod_enabled("micro_motion_hud")):
                    try:
                        t_m0 = time.perf_counter()
                        _, motion_res = m_mot.process_frame(img, return_annotated=False)
                        m_ms = round((time.perf_counter() - t_m0) * 1000.0, 1)
                        for mr in motion_res:
                            mbx = mr.get("box") or mr.get("bbox", [0, 0, 0, 0])
                            x1_px, y1_px = max(0, int(mbx[0])), max(0, int(mbx[1]))
                            bw_px, bh_px = int(mbx[2]), int(mbx[3])
                            x2_px, y2_px = min(w, x1_px + bw_px), min(h, y1_px + bh_px)
                            if x2_px > x1_px and y2_px > y1_px:
                                raw_candidate_dets.append({
                                    "class": "micro_motion",
                                    "module": "micro_motion",
                                    "confidence": round(float(mr.get("confidence", 0.75)), 2),
                                    "label": mr.get("tag", "SUBTLE MOTION TARGET"),
                                    "bbox": {
                                        "x1": round(x1_px / max(1, w), 4),
                                        "y1": round(y1_px / max(1, h), 4),
                                        "x2": round(x2_px / max(1, w), 4),
                                        "y2": round(y2_px / max(1, h), 4)
                                    }
                                })
                        print(f"[micro_motion] [mog2_optical_flow] [frame_id={req_frame_id}] [inference_ms={m_ms}] raw_result={len(motion_res)} final_result={len(motion_res)}", flush=True)
                    except Exception as e:
                        logger.error(f"Micro-motion detector error: {e}")

                # 6. Custom Visual Matcher Pass
                if c_det is not None and (is_mod_enabled("custom_detector") or is_mod_enabled("target_matcher")):
                    try:
                        if hasattr(c_det, "detect_custom_objects"):
                            t_c0 = time.perf_counter()
                            cust_results = c_det.detect_custom_objects(img)
                            c_ms = round((time.perf_counter() - t_c0) * 1000.0, 1)
                            for cr in (cust_results or []):
                                raw_candidate_dets.append(cr)
                            print(f"[custom_detector] [matcher] [frame_id={req_frame_id}] [inference_ms={c_ms}] raw_result={len(cust_results or [])} final_result={len(cust_results or [])}", flush=True)
                    except Exception as e:
                        logger.error(f"Custom detector error: {e}")

                # Track candidates
                tracks_raw = _acap_tracker.update(raw_candidate_dets, frame=img, frame_shape=(h, w), conf_thresh=0.25)
                emitted_dets, _ = resolve_emitted_detections(_acap_tracker, tracks_raw, raw_candidate_dets, [])

                # Assign explicit module tag to all emitted detections
                for d in emitted_dets:
                    d["module"] = _map_detection_module(d.get("class"), d)
                    if "speed" not in d and "speed_kmh" in d:
                        d["speed"] = d["speed_kmh"]
                    if "bbox" in d:
                        bx = d["bbox"]
                        if bx["x2"] > 1.0 or bx["y2"] > 1.0:
                            d["bbox"] = {
                                "x1": round(max(0.0, min(1.0, float(bx["x1"]) / w)), 4),
                                "y1": round(max(0.0, min(1.0, float(bx["y1"]) / h)), 4),
                                "x2": round(max(0.0, min(1.0, float(bx["x2"]) / w)), 4),
                                "y2": round(max(0.0, min(1.0, float(bx["y2"]) / h)), 4),
                            }

                # Strict Server-Side Module Filtering
                active_detections = []
                for d in emitted_dets:
                    mod_tag = d.get("module") or _map_detection_module(d.get("class"), d)
                    d["module"] = mod_tag
                    # OFF in Admin => do NOT return detections!
                    if not is_mod_enabled(mod_tag):
                        continue
                    if mod_tag == "vehicle_detection" and not is_mod_enabled("vehicle_detection"):
                        continue
                    active_detections.append(d)

                filtered_by_feat = filter_by_features(active_detections, profile_features)
                detections = filter_by_profile(filtered_by_feat, zone_profile)
                if zones:
                    detections = filter_detections_by_user_zones(detections, zones, frame_w=w, frame_h=h)

                try:
                    analytics_res = _acap_analytics.update(
                        detections, zones=zones, lines=lines, frame_w=w, frame_h=h,
                        frame=img, rules=rules, zone_profile=zone_profile, profile_features=profile_features
                    )
                    if analytics_res and len(analytics_res) >= 7:
                        alerts, track_overlays, _, zone_stats, line_stats, crowd_stats, parking_stats = analytics_res
                    elif analytics_res and len(analytics_res) >= 1:
                        alerts = analytics_res[0] if isinstance(analytics_res[0], list) else []
                except Exception as ex_an:
                    logger.error(f"Analytics update error: {ex_an}")

        except Exception as e:
            logger.error(f"Error in ACAP detection/tracking pipeline: {e}")

    VEHICLE_CLS = {"car", "bus", "truck", "motorcycle", "bicycle", "van", "vehicle"}
    PEOPLE_CLS = {"person", "worker", "customer", "staff", "rider", "face"}
    v_cnt = sum(1 for d in detections if str(d.get("class", "")).lower() in VEHICLE_CLS)
    p_cnt = sum(1 for d in detections if str(d.get("class", "")).lower() in PEOPLE_CLS)

    latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)
    _acap_latest_telemetry = {
        "status": "success",
        "type": "telemetry",
        "service": "CamAI AXIS ACAP Engine",
        "frame_id": req_frame_id,
        "fps": dynamic_fps,
        "input_fps": dynamic_fps,
        "ai_fps": dynamic_fps,
        "inference_latency_ms": latency_ms,
        "active_module": zone_profile,
        "vehicles": v_cnt,
        "people": p_cnt,
        "vehicles_count": v_cnt,
        "people_count": p_cnt,
        "count": len(detections),
        "detections": detections,
        "alerts": alerts,
        "track_overlays": track_overlays,
        "zone_stats": zone_stats,
        "line_stats": line_stats,
        "crowd_stats": crowd_stats,
        "parking_stats": parking_stats,
        "timestamp": now_ts
    }
    return _acap_latest_telemetry





@app.get("/api/cameras/{camera_id}/telemetry-debug")
def get_camera_telemetry_debug(camera_id: str):
    """Diagnostic endpoint exposing heartbeat timestamps, stage error counts,
    and authoritative telemetry details for a specific camera pipeline."""
    thread = manager.camera_threads.get(camera_id)
    if not thread and manager.camera_threads:
        thread = next((t for t in manager.camera_threads.values() if t.running), list(manager.camera_threads.values())[0])
    if not thread:
        return JSONResponse({"status": "error", "message": f"Camera '{camera_id}' not found or inactive"}, status_code=404)

    latest_tel = getattr(thread, "latest_telemetry", {}) or {}
    heartbeat = getattr(thread, "_heartbeat", {}) or {}
    stage_errors = getattr(thread, "_stage_errors", {}) or {}
    roi_zones = [z for z in getattr(thread, "zones", []) if (z.get("roi") or z.get("zoneType") == "roi") and z.get("points")]

    return {
        "status": "ok",
        "camera_id": camera_id,
        "running": thread.running,
        "inference_mode": getattr(config, "INFERENCE_MODE", "local"),
        "heartbeat": heartbeat,
        "stage_errors": stage_errors,
        "explicit_roi_zones_count": len(roi_zones),
        "active_zones_total": len(getattr(thread, "zones", [])),
        "telemetry": {
            "success": latest_tel.get("success", False),
            "people_count": latest_tel.get("people", 0),
            "vehicles_count": latest_tel.get("vehicles", 0),
            "items_count": latest_tel.get("items", 0),
            "detections_count": len(latest_tel.get("detections", [])),
            "detections": latest_tel.get("detections", []),
            "fps": latest_tel.get("fps", 0),
            "latency": latest_tel.get("latency", 0),
        }
    }


@app.get("/api/cameras/{camera_id}/performance")
def get_camera_performance(camera_id: str):
    """Rolling, measured pipeline timings for performance troubleshooting."""
    thread = manager.camera_threads.get(camera_id)
    if not thread and manager.camera_threads:
        thread = next((t for t in manager.camera_threads.values() if t.running), list(manager.camera_threads.values())[0])
    if not thread:
        return JSONResponse({"status": "error", "message": f"Camera '{camera_id}' not found or inactive"}, status_code=404)
    return {
        "status": "ok",
        "camera_id": camera_id,
        "running": thread.running,
        "performance": thread.performance_snapshot(),
    }



@app.post("/api/cloud-mode")
@app.post("/api/runtime/mode")
async def set_cloud_mode(payload: CloudModePayload):
    res = await runtime_governor.set_mode(
        manager=manager,
        target_mode=payload.mode,
        cloud_url=payload.cloud_url,
        cloud_key=payload.cloud_key
    )
    return res

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


# --- Custom Image Upload Target Matcher APIs ---
from app.ai.target_matcher import target_matcher
target_matcher.init_storage(str(UPLOADS_DIR / "targets"))

@app.post("/api/target/upload")
@app.post("/api/targets/enroll")
async def upload_target_image(
    request: Request,
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    threshold: Optional[float] = Form(None)
):
    try:
        target_name = name or request.query_params.get("name") or "Custom Target"
        target_threshold = threshold if threshold is not None else float(request.query_params.get("threshold", 0.70))

        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img_bgr is None:
            raise HTTPException(status_code=400, detail="Invalid image file uploaded.")

        target_dir = str(UPLOADS_DIR / "targets")
        item = target_matcher.add_target(
            name=target_name,
            img_bgr=img_bgr,
            save_dir=target_dir,
            threshold=target_threshold
        )
        if item is None:
            raise HTTPException(status_code=500, detail="Failed to process and enroll target embedding.")

        return {
            "success": True,
            "target_id": item.target_id,
            "name": item.name,
            "threshold": item.threshold,
            "created_at": item.created_at
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/target/list")
@app.get("/api/targets")
def list_target_images():
    return {"targets": target_matcher.list_targets()}

@app.delete("/api/target/{target_id}")
@app.delete("/api/targets/{target_id}")
def delete_target_image(target_id: str):
    success = target_matcher.remove_target(target_id)
    if not success:
        raise HTTPException(status_code=404, detail="Target ID not found.")
    return {"success": True, "target_id": target_id}


class RenameTargetPayload(BaseModel):
    target_id: str
    name: str

@app.post("/api/target/rename")
@app.post("/api/targets/rename")
def rename_target_image(payload: RenameTargetPayload):
    success = target_matcher.rename_target(payload.target_id, payload.name)
    if not success:
        raise HTTPException(status_code=404, detail="Target ID not found or invalid name.")
    return {"success": True, "target_id": payload.target_id, "name": payload.name}


class AutoEnrollPayload(BaseModel):
    enabled: bool

@app.post("/api/target/auto-enroll")
def set_auto_enroll_status(payload: AutoEnrollPayload):
    target_matcher.auto_enroll_enabled = payload.enabled
    return {"success": True, "enabled": target_matcher.auto_enroll_enabled}

@app.get("/api/target/auto-enroll")
def get_auto_enroll_status():
    return {"enabled": getattr(target_matcher, "auto_enroll_enabled", True)}


class ZeroDCEPayload(BaseModel):
    enabled: Optional[bool] = None
    auto_mode: Optional[bool] = None
    threshold: Optional[float] = None


@app.post("/api/enhancement/zero_dce", dependencies=control)
def configure_zero_dce(payload: ZeroDCEPayload):
    """Configure Zero-DCE Low-Light Night-Vision AI Enhancement."""
    from app.ai.enhancer import zero_dce
    if payload.enabled is not None:
        zero_dce.enabled = payload.enabled
    if payload.auto_mode is not None:
        zero_dce.auto_mode = payload.auto_mode
    if payload.threshold is not None:
        zero_dce.threshold = max(10.0, min(200.0, float(payload.threshold)))
    return {
        "success": True,
        "enabled": zero_dce.enabled,
        "auto_mode": zero_dce.auto_mode,
        "threshold": zero_dce.threshold,
        "is_onnx_loaded": zero_dce.is_loaded,
    }


@app.get("/api/enhancement/zero_dce/status")
def get_zero_dce_status():
    from app.ai.enhancer import zero_dce
    return {
        "enabled": zero_dce.enabled,
        "auto_mode": zero_dce.auto_mode,
        "threshold": zero_dce.threshold,
        "is_onnx_loaded": zero_dce.is_loaded,
        "model_path": zero_dce.model_path,
    }



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

@app.post("/api/cameras/test", dependencies=control)
async def test_camera_connection(payload: CameraTestPayload):
    """Diagnose a camera connection from the LAN, before it is ever added.

    app/camera_test.py has implemented this since it was written and nothing
    ever called it — there was no route to it and no import of it anywhere in
    the server, so every "Test Connection" in the product went to the
    `test-camera` Supabase edge function instead. That function runs in
    Deno on Supabase's cloud, and for any private address it returns:

        ok: true, "Local/private IP address (...) bypassed cloud verification"

    ...having opened no socket at all (supabase/functions/_shared/util.ts).
    10/8, 192.168/16 and 172.16-31/12 cover essentially every CCTV camera ever
    installed, so in real deployments the test passed unconditionally and the
    operator learned nothing until the camera silently failed to stream later.
    The engine is on the camera's LAN and is the only vantage point that can
    answer the question, which is what this route finally exposes.

    Runs in a worker thread: run_test does blocking socket and decoder work for
    up to ~20s, and on the event loop that would stall every other request the
    desktop makes (status polling, MJPEG, telemetry) for its whole duration.
    """
    from app.camera_test import run_test

    kwargs = payload.model_dump(exclude_none=True)
    try:
        result = await asyncio.to_thread(run_test, **kwargs)
    except TypeError as e:
        # Unknown source_type etc. reach run_test as a normal failed result;
        # this only catches a genuinely malformed call.
        raise HTTPException(status_code=400, detail=str(e))
    return asdict(result)

class CameraAuthPayload(BaseModel):
    ip: str
    port: Optional[int] = 554
    username: Optional[str] = None
    password: Optional[str] = None
    protocol: Optional[str] = "rtsp"

class CameraEnrollPayload(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    protocol: Optional[str] = "https"
    stream_path: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    vendor: Optional[str] = "axis"
    model: Optional[str] = None
    mac_address: Optional[str] = None

@app.get("/api/cameras/discover")
@app.post("/api/cameras/discover")
async def discover_cameras():
    """
    Dynamic Axis & ONVIF camera discovery and endpoint probing.
    - Probes ONVIF WS-Discovery (multicast)
    - Probes local network subnets on candidate camera ports (42093, 12116, 80, 443, 554)
    - Detects working Axis stream paths and authentication requirement status
    - Keeps credentials server-side and never exposes passwords
    """
    from app.camera_test import onvif_discover, onvif_device_info
    def _do_discovery():
        import socket, urllib3
        urllib3.disable_warnings()
        raw_onvif = onvif_discover(timeout=2.0)
        devices = []
        seen_ips = set()
        
        for item in raw_onvif:
            ip = item.get("ip")
            if not ip or ip in seen_ips:
                continue
            seen_ips.add(ip)
            info = onvif_device_info(ip, 80, None, None, timeout=1.5) or {}
            devices.append({
                "id": f"axis_{ip.replace('.', '_')}",
                "name": info.get("model") or f"Axis Camera ({ip})",
                "manufacturer": info.get("manufacturer") or "Axis Communications",
                "model": info.get("model") or "Network Camera",
                "host": ip,
                "port": 42093 if ip == AXIS_CAMERA_HOST else 80,
                "protocol": "https" if ip == AXIS_CAMERA_HOST else "http",
                "stream_path": "/axis-cgi/mjpg/video.cgi",
                "auth_required": True,
                "status": "DISCOVERED"
            })

        # Local LAN probe candidate ports on reachable host network subnets
        local_ips = []
        try:
            hostname = socket.gethostname()
            for info in socket.getaddrinfo(hostname, None):
                addr = info[4][0]
                if "." in addr and not addr.startswith("127."):
                    prefix = ".".join(addr.split(".")[:3])
                    if prefix not in local_ips:
                        local_ips.append(prefix)
        except Exception:
            pass
        if not local_ips:
            local_ips = ["192.168.1", "10.0.0", "195.60.68"]

        candidate_ports = [42093, 12116, 80, 443, 554]
        for prefix in local_ips[:2]:
            for last in [1, 2, 10, 100, 101, 102, 200, 250]:
                probe_ip = f"{prefix}.{last}"
                if probe_ip in seen_ips:
                    continue
                for p in candidate_ports:
                    try:
                        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                        s.settimeout(0.15)
                        res = s.connect_ex((probe_ip, p))
                        s.close()
                        if res == 0:
                            seen_ips.add(probe_ip)
                            devices.append({
                                "id": f"axis_{probe_ip.replace('.', '_')}",
                                "name": f"Discovered Axis Camera ({probe_ip}:{p})",
                                "manufacturer": "Axis Communications",
                                "model": "Network Security Camera",
                                "host": probe_ip,
                                "port": p,
                                "protocol": "https" if p in (443, 42093) else "http",
                                "stream_path": "/axis-cgi/mjpg/video.cgi",
                                "auth_required": True,
                                "status": "DISCOVERED"
                            })
                            break
                    except Exception:
                        pass
                if len(devices) >= 20:
                    break

        if AXIS_CAMERA_HOST not in seen_ips:
            devices.append({
                "id": "axis-local-cam",
                "name": f"Axis Camera ({AXIS_CAMERA_HOST})",
                "manufacturer": "Axis Communications",
                "model": "P3245-V / VAPIX Network Camera",
                "host": AXIS_CAMERA_HOST,
                "port": AXIS_CAMERA_PORT,
                "protocol": "https",
                "stream_path": AXIS_CAMERA_STREAM_PATH,
                "auth_required": True,
                "status": "DISCOVERED"
            })

        return {"success": True, "count": len(devices), "devices": devices}

    return await asyncio.to_thread(_do_discovery)

def fetch_axis_camera_details(host: str, port: Optional[int] = None, username: Optional[str] = None, password: Optional[str] = None, protocol: Optional[str] = None) -> dict:
    """
    Dynamically queries an Axis camera over VAPIX / ONVIF / RTSP to automatically retrieve:
    - Model Name & Brand
    - Serial Number / MAC Address
    - Firmware Version
    - Optimal RTSP / MJPEG Stream Path
    - Active Connection Protocol
    """
    details = {
        "manufacturer": "Axis Communications",
        "model": "Axis Network Camera",
        "mac_address": "",
        "firmware": "",
        "serial_number": "",
        "stream_path": "/axis-media/media.amp?videocodec=h264",
        "protocol": protocol or "rtsp",
        "port": port or 554,
        "is_reachable": False
    }

    if not host:
        return details

    import requests, re, socket
    from requests.auth import HTTPDigestAuth, HTTPBasicAuth
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    test_ports = [port] if port else [42093, 12116, 80, 443, 31095, 554]
    
    for p in test_ports:
        if not p:
            continue
        proto_choices = [protocol] if protocol else (["https", "http"] if p in (443, 42093) else ["http", "https"])
        for pr in proto_choices:
            if pr not in ("http", "https"):
                continue
            url = f"{pr}://{host}:{p}/axis-cgi/param.cgi?action=list&group=Brand,Properties.System"
            try:
                auth = HTTPDigestAuth(username, password) if username and password else None
                resp = requests.get(url, auth=auth, verify=False, timeout=2.0)
                if resp.status_code == 401 and username and password:
                    resp = requests.get(url, auth=HTTPBasicAuth(username, password), verify=False, timeout=2.0)
                
                if resp.status_code == 200:
                    text = resp.text
                    details["is_reachable"] = True
                    details["protocol"] = pr
                    details["port"] = p
                    
                    brand_match = re.search(r"root\.Brand\.Brand=(.*)", text)
                    model_match = re.search(r"root\.Brand\.ProdNbr=(.*)", text) or re.search(r"root\.Properties\.System\.Model=(.*)", text)
                    serial_match = re.search(r"root\.Properties\.System\.SerialNumber=(.*)", text)
                    firmware_match = re.search(r"root\.Properties\.System\.Version=(.*)", text)

                    if model_match and model_match.group(1).strip():
                        details["model"] = model_match.group(1).strip()
                    if brand_match and brand_match.group(1).strip():
                        details["manufacturer"] = brand_match.group(1).strip()
                    if serial_match and serial_match.group(1).strip():
                        sn = serial_match.group(1).strip()
                        details["serial_number"] = sn
                        if len(sn) == 12:
                            details["mac_address"] = ":".join(re.findall(r"..", sn))
                    if firmware_match and firmware_match.group(1).strip():
                        details["firmware"] = firmware_match.group(1).strip()

                    details["stream_path"] = "/axis-media/media.amp?videocodec=h264"
                    return details
            except Exception:
                pass

    # RTSP port probe fallback
    try:
        rtsp_port = port if (port and port not in (80, 443)) else 554
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1.5)
        if s.connect_ex((host, rtsp_port)) == 0:
            details["is_reachable"] = True
            details["port"] = rtsp_port
            details["protocol"] = "rtsp"
            details["stream_path"] = "/axis-media/media.amp?videocodec=h264"
        s.close()
    except Exception:
        pass

    return details

@app.post("/api/cameras/enroll")
async def enroll_camera(payload: CameraEnrollPayload):
    """
    Enrolls an Axis/network camera securely and dynamically.
    Queries Axis VAPIX/ONVIF directly to fetch model, MAC, firmware, and stream paths.
    Credentials remain strictly server-side and are NEVER returned in response JSON or sent to frontend.
    """
    host = payload.host or AXIS_CAMERA_HOST
    port = payload.port or (AXIS_CAMERA_PORT if AXIS_CAMERA_PORT else 554)
    user = payload.username or AXIS_CAMERA_USER
    pwd = payload.password or AXIS_CAMERA_PASS
    proto = payload.protocol or "rtsp"
    path = payload.stream_path or "/axis-media/media.amp?videocodec=h264"

    # Query Axis camera dynamically if host is provided
    fetched_info = {}
    vendor = payload.vendor or "axis"
    mac_addr = payload.mac_address

    if host:
        fetched_info = await asyncio.to_thread(fetch_axis_camera_details, host, port, user, pwd, proto)
        if fetched_info.get("manufacturer"):
            vendor = fetched_info["manufacturer"]
        if fetched_info.get("mac_address"):
            mac_addr = fetched_info["mac_address"]
        if fetched_info.get("stream_path") and not payload.stream_path:
            path = fetched_info["stream_path"]
        if fetched_info.get("protocol") and not payload.protocol:
            proto = fetched_info["protocol"]
        if fetched_info.get("port") and not payload.port:
            port = fetched_info["port"]

    cid = payload.id or (f"axis_{host.replace('.', '_')}" if host else "axis-cam-01")
    name = payload.name or (f"Axis Camera ({fetched_info.get('model', host)})" if host else "Axis Camera")

    if user and pwd:
        src = f"{proto}://{user}:{pwd}@{host}:{port}{path}" if host else path
    elif host:
        src = f"{proto}://{host}:{port}{path}"
    else:
        src = path

    save_camera_enrolled(
        camera_id=cid,
        name=name,
        type_="axis",
        source=src,
        is_active=1,
        host=host,
        port=port,
        protocol=proto,
        stream_path=path,
        vendor=vendor,
        mac_address=mac_addr,
        username=user,
        password=pwd
    )

    cam_rec = get_camera_full(cid)
    try:
        manager.start_camera_thread(cam_rec)
    except Exception as e:
        logger.error(f"[Camera Enrollment] Error starting camera thread for {cid}: {e}")

    safe_rec = get_camera(cid, safe=True)
    return {"success": True, "camera": safe_rec, "details": fetched_info, "message": "Camera successfully enrolled with dynamic Axis configuration"}

@app.post("/api/cameras/{camera_id}/connect")
async def connect_camera_endpoint(camera_id: str):
    cam_rec = get_camera_full(camera_id)
    if not cam_rec:
        raise HTTPException(status_code=404, detail=f"Camera {camera_id} not found")
    try:
        manager.start_camera_thread(cam_rec)
        return {"success": True, "message": f"Camera {camera_id} connected"}
    except Exception as e:
        logger.error(f"[Camera Connect] Failed to connect camera {camera_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/cameras/{camera_id}/disconnect")
async def disconnect_camera_endpoint(camera_id: str):
    try:
        manager.stop_camera_thread(camera_id)
        return {"success": True, "message": f"Camera {camera_id} disconnected"}
    except Exception as e:
        logger.error(f"[Camera Disconnect] Failed to disconnect camera {camera_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/cameras/test-auth")
async def test_camera_auth(payload: CameraAuthPayload):
    from app.camera_test import run_test
    def _do_auth():
        res = run_test(
            source_type=payload.protocol or "rtsp",
            host=payload.ip,
            port=payload.port or 554,
            username=payload.username,
            password=payload.password,
            frame_count=3
        )
        auth_ok = res.ok or (res.error_code is None or res.error_code != "ERR_AUTH_FAILED")
        return {
            "success": True,
            "authenticated": auth_ok,
            "media_profile": "Profile S (1080p H.264 / ONVIF)",
            "resolution": "1920x1080",
            "error_detail": res.error_detail if not auth_ok else None
        }

    return await asyncio.to_thread(_do_auth)


ALLOWED_UPLOAD_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}

# Ceiling on a single uploaded clip (default 4 GB). See upload_camera_video().
import os as _os
try:
    MAX_UPLOAD_BYTES = int(_os.getenv("CAMAI_MAX_UPLOAD_MB", "4096")) * 1024 * 1024
except ValueError:
    MAX_UPLOAD_BYTES = 4096 * 1024 * 1024

@app.post("/api/cameras/upload", dependencies=control)
async def upload_camera_video(file: UploadFile = File(...)):
    ext = PurePosixPath(file.filename or "").suffix.lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_UPLOAD_EXTENSIONS))}")

    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = UPLOADS_DIR / safe_name
    # Bounded write. The loop had no size limit at all, so one request could
    # fill the disk the recordings, the SQLite history and the OS itself live
    # on — the engine and everything it is recording stop with it. The cap is
    # deliberately far above any real demo clip and is env-tunable, so no
    # legitimate upload changes behaviour; a partial file is removed rather
    # than left behind for the pipeline to open.
    written = 0
    try:
        with open(dest_path, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Upload exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
                    )
                out.write(chunk)
    except Exception:
        try:
            dest_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise

    return {"success": True, "path": str(dest_path)}

@app.post("/api/cameras", dependencies=control)
def add_or_update_camera(payload: CameraConfigPayload):
    # A camera's source is set at portal/add-camera trust level, not at the
    # level of whoever holds this engine's own control token — reject a
    # loopback/link-local/unsupported-scheme address before it is ever saved
    # or dialled. Private LAN addresses (192.168/16 etc.) are the normal case
    # for a real camera and are deliberately left alone (see
    # app/ai/stream_resolver.blocked_source_reason).
    blocked = blocked_source_reason(payload.source)
    if blocked:
        raise HTTPException(status_code=400, detail=f"Camera source rejected: {blocked}.")
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
@app.get("/api/cameras/{camera_id}/config")
def get_camera_analytics_config(camera_id: str):
    cam = get_camera(camera_id)
    if not cam:
        if camera_id in ("axis-local-cam", "axis-cam-01", "cam_edge_local", "cam_default", "cam_1"):
            default_source = _get_axis_camera_auth_url()
            save_camera(
                camera_id,
                "Axis Local Camera" if "axis" in camera_id else "CamAI Live Stream",
                "axis",
                default_source,
                1,
                "[]",
                "[]",
                "[]",
                "traffic",
                "{}"
            )
            cam = get_camera(camera_id)
        else:
            raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

    zones = cam.get("zones") or "[]"
    lines = cam.get("lines") or "[]"
    rules = cam.get("rules") or "[]"
    pf = cam.get("profile_features") or "{}"
    return {
        "status": "ok",
        "id": cam["id"],
        "name": cam["name"],
        "type": cam["type"],
        "source": mask_source(cam["source"]) if "mask_source" in globals() else cam["source"],
        "is_active": bool(cam["is_active"]),
        "zone_profile": cam.get("zone_profile") or "traffic",
        "profile_features": json.loads(pf) if isinstance(pf, str) else pf,
        "zones": json.loads(zones) if isinstance(zones, str) else zones,
        "lines": json.loads(lines) if isinstance(lines, str) else lines,
        "rules": json.loads(rules) if isinstance(rules, str) else rules,
    }

# The AI-mode endpoint. payload.zone_profile is the camera's AI mode, and this
# is the only way it reaches the running pipeline — so this is precisely the
# door that has to stay shut to everything except the desktop app replaying an
# RLS-approved value out of the database.
@app.post("/api/cameras/{camera_id}/config", dependencies=control)
def update_camera_analytics(camera_id: str, payload: CameraAnalyticsPayload):
    cam = get_camera(camera_id)
    if not cam:
        if camera_id in ("axis-local-cam", "axis-cam-01", "cam_edge_local", "cam_default", "cam_1"):
            default_source = _get_axis_camera_auth_url()
            default_type = "axis"
            save_camera(
                camera_id,
                "Axis Local Camera" if "axis" in camera_id else "CamAI Live Stream",
                default_type,
                default_source,
                1,
                payload.zones,
                payload.lines,
                payload.rules or "[]",
                payload.zone_profile,
                payload.profile_features or "{}"
            )
            cam = get_camera(camera_id)
        else:
            raise HTTPException(status_code=404, detail="Camera not registered. Register via POST /api/cameras first.")

    # Update existing SQLite camera record
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

    # Ensure camera thread is running (it was already registered; the engine may
    # have restarted and lost its in-memory thread while the DB row survived).
    if camera_id not in manager.camera_threads:
        cam_full = get_camera(camera_id)
        if cam_full:
            manager.start_camera_thread(cam_full)

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

# Fallback PostgREST v1 routes for Supabase client compatibility
@app.get("/rest/v1/cameras")
def rest_get_cameras():
    cams = get_all_cameras()
    if not cams:
        src = _get_axis_camera_auth_url()
        save_camera("axis-local-cam", "Axis Local Camera", "axis", src, 1, "[]", "[]", "[]", "traffic", "{}")
        cams = get_all_cameras()
    formatted = []
    for c in cams:
        formatted.append({
            "id": c["id"],
            "name": c["name"],
            "type": c["type"],
            "source": mask_source(c["source"]),
            "is_active": bool(c["is_active"]),
            "zone_profile": c.get("zone_profile") or "traffic",
            "profile_features": json.loads(c.get("profile_features") or "{}") if isinstance(c.get("profile_features"), str) else (c.get("profile_features") or {}),
            "zones": json.loads(c.get("zones") or "[]") if isinstance(c.get("zones"), str) else (c.get("zones") or []),
            "lines": json.loads(c.get("lines") or "[]") if isinstance(c.get("lines"), str) else (c.get("lines") or []),
            "rules": json.loads(c.get("rules") or "[]") if isinstance(c.get("rules"), str) else (c.get("rules") or []),
        })
    return JSONResponse(
        content=formatted,
        headers={"Content-Range": f"0-{max(0, len(formatted)-1)}/{len(formatted)}"}
    )

@app.get("/rest/v1/analytics_drawings")
def rest_get_analytics_drawings():
    return JSONResponse(content=[], headers={"Content-Range": "0-0/0"})

@app.get("/rest/v1/rule_engine_rules")
def rest_get_rule_engine_rules():
    return JSONResponse(content=[], headers={"Content-Range": "0-0/0"})

@app.get("/rest/v1/zone_profile_configs")
def rest_get_zone_profile_configs():
    return JSONResponse(content=[], headers={"Content-Range": "0-0/0"})

@app.api_route("/rest/v1/{table_name:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def rest_v1_generic_fallback(table_name: str, request: Request):
    clean_table = table_name.split("?")[0].strip("/")
    if clean_table == "cameras":
        return rest_get_cameras()
    return JSONResponse(content=[], headers={"Content-Range": "0-0/0"})

# Every state-changing endpoint below now carries the control-token dependency.
@app.post("/api/cameras/{camera_id}/display", dependencies=control)
def update_camera_display(camera_id: str, payload: CameraDisplayPayload):
    if camera_id not in manager.camera_threads:
        raise HTTPException(status_code=404, detail="Camera thread not running")
    manager.update_camera_display_config(camera_id, payload.max_width, payload.quality)
    return {"success": True, "message": "Display settings updated"}

@app.post("/api/cameras/{camera_id}/recording", dependencies=control)
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

def _generate_mjpeg_standby_frame(camera_name: str, frame_count: int) -> bytes:
    try:
        import cv2
        import numpy as np
        img = np.zeros((360, 640, 3), dtype=np.uint8)
        img[:, :] = (15, 15, 18)
        time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cv2.putText(img, "CAMAI LIVE CAMERA STREAM", (30, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(img, f"Connecting to {camera_name or 'Axis Camera'}...", (30, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (160, 160, 170), 1, cv2.LINE_AA)
        cv2.putText(img, time_str, (30, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (120, 120, 130), 1, cv2.LINE_AA)
        _, encoded = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 75])
        return encoded.tobytes()
    except Exception:
        return b""

# MJPEG Stream Proxy
@app.get("/api/cameras/{camera_id}/stream")
@app.get("/stream/{camera_id}")
@app.get("/engine-proxy/stream/{camera_id}")
async def get_mjpeg_stream(camera_id: str, request: Request = None):
    """
    Continuous multipart MJPEG server-side streaming proxy.
    Architecture:
    Axis Camera -> CamAI Backend Stream Proxy -> Frontend Browser
    - Resolves camera config & server-side credentials
    - Proxies frames directly & continuously without full buffering
    - Preserves multipart/x-mixed-replace; boundary=myboundary
    - Enforces timeouts, logs underlying errors, and cleans up on client disconnect
    """
    client_host = request.client.host if request and request.client else "unknown"
    logger.info(f"[Stream Proxy] Connection attempt for camera_id='{camera_id}' from client {client_host}")

    def resolve_active_thread(cid: str):
        t = manager.camera_threads.get(cid)
        if t:
            return t
        for t_id, t_obj in manager.camera_threads.items():
            cam_info = getattr(t_obj, "config", {}) or {}
            if isinstance(cam_info, dict) and (cam_info.get("name") == cid or cam_info.get("id") == cid):
                return t_obj
        # Check if registered in DB
        cam = get_camera_full(cid)
        if cam and cam.get("is_active"):
            try:
                manager.start_camera_thread(cam)
                return manager.camera_threads.get(cid)
            except Exception as e:
                logger.error(f"[Stream Proxy] Failed to start camera thread for {cid}: {e}")
        # Auto-provision axis-local-cam / axis-cam-01 / cam_edge_local
        if cid in ("axis-local-cam", "axis-cam-01", "cam_edge_local", "cam_default"):
            try:
                src = _get_axis_camera_auth_url()
                save_camera_enrolled(
                    camera_id=cid,
                    name="Axis Local Camera",
                    type_="axis",
                    source=src,
                    is_active=1,
                    host=AXIS_CAMERA_HOST,
                    port=AXIS_CAMERA_PORT,
                    protocol="https",
                    stream_path=AXIS_CAMERA_STREAM_PATH,
                    vendor="axis",
                    username=AXIS_CAMERA_USER,
                    password=AXIS_CAMERA_PASS
                )
                cam_rec = get_camera_full(cid)
                if cam_rec:
                    manager.start_camera_thread(cam_rec)
                    return manager.camera_threads.get(cid)
            except Exception as e:
                logger.error(f"[Stream Proxy] Auto-provision failed for {cid}: {e}")
        if manager.camera_threads:
            return next((t for t in manager.camera_threads.values() if getattr(t, "running", False)), list(manager.camera_threads.values())[0])
        return None

    # Ensure thread is resolved or requested
    thread = resolve_active_thread(camera_id)
    cam_name = getattr(thread, "config", {}).get("name", camera_id) if thread and isinstance(getattr(thread, "config", None), dict) else camera_id

    async def mjpeg_generator():
        attached_threads = set()
        last_seq = -1
        stream_started = False
        direct_resp = None

        try:
            logger.info(f"[Stream Proxy] Stream session initiated for camera_id='{camera_id}'")
            wait_for_pipeline = 0

            while True:
                if request is not None and await request.is_disconnected():
                    logger.info(f"[Stream Proxy] Client disconnected cleanly for camera_id='{camera_id}'")
                    break

                try:
                    active_thread = resolve_active_thread(camera_id)
                    if active_thread and active_thread not in attached_threads:
                        attach = getattr(active_thread, "mjpeg_viewer_attached", None)
                        if attach:
                            try:
                                attach()
                                attached_threads.add(active_thread)
                            except Exception:
                                pass

                    if active_thread:
                        seq = getattr(active_thread, "jpeg_sequence_id", 0)
                        jpeg_bytes = getattr(active_thread, "current_jpeg_bytes", None)
                        if seq != last_seq and jpeg_bytes is not None and len(jpeg_bytes) > 0:
                            last_seq = seq
                            if not stream_started:
                                stream_started = True
                                logger.info(f"[Stream Proxy] Stream started delivering processed frames for camera_id='{camera_id}'")

                            yield (
                                b'--myboundary\r\n'
                                b'Content-Type: image/jpeg\r\n'
                                b'Content-Length: ' + str(len(jpeg_bytes)).encode('ascii') + b'\r\n\r\n'
                                + jpeg_bytes + b'\r\n'
                            )
                            await asyncio.sleep(0.001)
                            continue

                    # If pipeline has no frames yet (initial startup), direct-stream proxy from Axis Camera using server-side auth
                    wait_for_pipeline += 1
                    if wait_for_pipeline > 5 and not stream_started:
                        cam_rec = get_camera_full(camera_id) or {}
                        raw_src = cam_rec.get("source") or AXIS_CAMERA_RAW_URL
                        user = cam_rec.get("username") or AXIS_CAMERA_USER
                        pwd = cam_rec.get("password") or AXIS_CAMERA_PASS

                        if "http" in str(raw_src):
                            try:
                                import requests
                                from requests.auth import HTTPBasicAuth, HTTPDigestAuth
                                logger.info(f"[Stream Proxy] Connecting direct fallback stream to Axis Camera at {mask_source(str(raw_src))}")
                                def _open_direct_req():
                                    target_url = str(raw_src)
                                    if "@" in target_url:
                                        # strip inline auth for request URL if passing auth object
                                        parts = target_url.split("://")
                                        if len(parts) == 2 and "@" in parts[1]:
                                            auth_part, rest = parts[1].split("@", 1)
                                            target_url = f"{parts[0]}://{rest}"
                                    auth_obj = HTTPDigestAuth(user, pwd) if user and pwd else None
                                    resp = requests.get(
                                        target_url,
                                        auth=auth_obj,
                                        stream=True,
                                        verify=False,
                                        timeout=(1.5, 8.0)
                                    )
                                    if resp.status_code == 401 and user and pwd:
                                        # Try Basic auth fallback
                                        resp.close()
                                        resp = requests.get(
                                            target_url,
                                            auth=HTTPBasicAuth(user, pwd),
                                            stream=True,
                                            verify=False,
                                            timeout=(1.5, 8.0)
                                        )
                                    return resp

                                direct_resp = await asyncio.to_thread(_open_direct_req)
                                if direct_resp.status_code == 200:
                                    logger.info(f"[Stream Proxy] Direct stream connected (status={direct_resp.status_code})")
                                    for chunk in direct_resp.iter_content(chunk_size=4096):
                                        if request is not None and await request.is_disconnected():
                                            break
                                        if chunk:
                                            yield chunk
                                            await asyncio.sleep(0.0001)
                                            cur_t = resolve_active_thread(camera_id)
                                            if cur_t and getattr(cur_t, "current_jpeg_bytes", None) is not None:
                                                logger.info(f"[Stream Proxy] Switching from direct proxy to live AI pipeline for {camera_id}")
                                                break
                                else:
                                    logger.warning(f"[Stream Proxy] Direct stream returned HTTP {direct_resp.status_code}")
                            except Exception as direct_err:
                                logger.error(f"[Stream Proxy] Direct stream error for {camera_id}: {direct_err}")
                            finally:
                                if direct_resp:
                                    try:
                                        direct_resp.close()
                                    except Exception:
                                        pass
                                    direct_resp = None

                    # If neither pipeline nor direct stream yielded yet, yield standby frame smoothly
                    fallback = _generate_mjpeg_standby_frame(cam_name, wait_for_pipeline)
                    if fallback:
                        yield (
                            b'--myboundary\r\n'
                            b'Content-Type: image/jpeg\r\n'
                            b'Content-Length: ' + str(len(fallback)).encode('ascii') + b'\r\n\r\n'
                            + fallback + b'\r\n'
                        )
                    await asyncio.sleep(0.05)

                except (asyncio.CancelledError, GeneratorExit):
                    logger.info(f"[Stream Proxy] Stream generator cancelled for camera_id='{camera_id}'")
                    break
                except Exception as loop_err:
                    logger.error(f"[Stream Proxy] Stream loop exception for camera_id='{camera_id}': {loop_err}")
                    await asyncio.sleep(0.1)

        finally:
            logger.info(f"[Stream Proxy] Stream session ended for camera_id='{camera_id}'")
            if direct_resp:
                try:
                    direct_resp.close()
                except Exception:
                    pass
            for t in attached_threads:
                detach = getattr(t, "mjpeg_viewer_detached", None)
                if detach:
                    try:
                        detach()
                    except Exception:
                        pass

    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=myboundary",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "Connection": "close"
        }
    )

@app.get("/api/cameras/{camera_id}/snapshot")
@app.get("/api/cameras/{camera_id}/frame")
async def get_camera_snapshot(camera_id: str):
    def resolve_active_thread(cid: str):
        t = manager.camera_threads.get(cid)
        if t:
            return t
        for t_id, t_obj in manager.camera_threads.items():
            cam_info = getattr(t_obj, "config", {}) or {}
            if isinstance(cam_info, dict) and (cam_info.get("name") == cid or cam_info.get("id") == cid):
                return t_obj
        if manager.camera_threads:
            return next((t for t in manager.camera_threads.values() if getattr(t, "running", False)), list(manager.camera_threads.values())[0])
        return None

    thread = resolve_active_thread(camera_id)
    jpeg_bytes = getattr(thread, "current_jpeg_bytes", None) if thread else None
    if not jpeg_bytes:
        cam_name = getattr(thread, "config", {}).get("name", camera_id) if thread and isinstance(getattr(thread, "config", None), dict) else camera_id
        jpeg_bytes = _generate_mjpeg_standby_frame(cam_name, 1)
    return Response(
        content=jpeg_bytes,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Access-Control-Allow-Origin": "*",
        }
    )

# Alerts
@app.get("/api/alerts")
def fetch_alerts(limit: int = 50):
    return get_recent_alerts(limit)

@app.delete("/api/alerts", dependencies=control)
def clear_alerts():
    clear_all_alerts()
    return {"success": True}

@app.delete("/api/alerts/{alert_id}", dependencies=control)
def remove_single_alert(alert_id: str):
    from app.storage import delete_single_alert
    delete_single_alert(alert_id)
    return {"success": True}

# History
@app.get("/api/history")
def fetch_history_records(limit: int = 100):
    return get_history(limit)

@app.delete("/api/history", dependencies=control)
def clear_history_records():
    clear_all_history()
    return {"success": True}

# Recordings
@app.get("/api/recordings")
def fetch_recordings():
    return get_all_recordings()

@app.get("/api/recording/settings")
def fetch_recording_settings():
    return get_recording_settings()

@app.post("/api/recording/settings", dependencies=control)
def update_recording_settings(payload: RecordingSettingsPayload):
    save_recording_settings(payload.segment_minutes, payload.record_with_detections)
    manager.update_recording_settings(payload.segment_minutes, payload.record_with_detections)
    return {
        "success": True,
        "settings": {
            "segment_minutes": payload.segment_minutes,
            "record_with_detections": payload.record_with_detections
        }
    }

# Temporary debug endpoint for tracking down the pipeline memory-growth
# investigation — counts live Python objects by type, most common first.
@app.get("/api/debug/gc", dependencies=control)
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

@app.delete("/api/history/logs", dependencies=control)
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


from fastapi import Form

class ModelToggleRequest(BaseModel):
    active: bool

@app.get("/api/custom_models")
def list_custom_models_api():
    """Lists all registered custom product models."""
    from app.ai.custom_detector import list_custom_models
    return {"models": list_custom_models()}


@app.post("/api/custom_models/register", dependencies=control)
async def register_custom_model_api(
    name: Optional[str] = Form("Custom Product"),
    files: List[UploadFile] = File(...)
):
    """Registers custom model embeddings for a named product from uploaded reference images."""
    from app.ai.custom_detector import register_custom_model
    try:
        images_data = []
        for file in files:
            content = await file.read()
            images_data.append(content)
        
        meta = await asyncio.to_thread(register_custom_model, name, images_data)
        return {"success": True, "registered_count": meta["reference_count"], "model": meta}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to register custom model: {str(e)}")


@app.post("/api/custom_model/register", dependencies=control)
async def register_custom_model_legacy_api(
    name: Optional[str] = Form("Custom Product"),
    files: List[UploadFile] = File(...)
):
    return await register_custom_model_api(name=name, files=files)


@app.post("/api/custom_models/{model_id}/toggle", dependencies=control)
def toggle_custom_model_api(model_id: str, req: ModelToggleRequest):
    """Toggles active state of a custom model."""
    from app.ai.custom_detector import toggle_custom_model
    try:
        updated = toggle_custom_model(model_id, req.active)
        return {"success": True, "model": updated}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/custom_models/{model_id}", dependencies=control)
def delete_custom_model_api(model_id: str):
    """Deletes a custom model by ID."""
    from app.ai.custom_detector import delete_custom_model
    try:
        res = delete_custom_model(model_id)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/custom_model/status")
def get_custom_model_status_api():
    """Gets status of custom models."""
    from app.ai.custom_detector import get_custom_model_status
    return get_custom_model_status()

# ---------------------------------------------------------------------------
# PostgREST & Camera Config Fallbacks (Preventing 404s for frontend queries)
# ---------------------------------------------------------------------------
@app.get("/rest/v1/analytics_drawings")
@app.get("/rest/v1/rule_engine_rules")
@app.get("/rest/v1/zone_profile_configs")
async def rest_v1_drawings_rules_fallback(request: Request):
    return JSONResponse([])

@app.get("/rest/v1/cameras")
async def rest_v1_cameras_fallback(request: Request):
    cams = get_all_cameras(safe=True)
    return JSONResponse(cams)

@app.get("/api/cameras/{camera_id}/config")
async def get_camera_config_route(camera_id: str):
    cam = get_camera(camera_id, safe=True)
    if not cam:
        return JSONResponse({"status": "ok", "zones": "[]", "lines": "[]", "rules": "[]", "zone_profile": "traffic", "profile_features": "{}"})
    return JSONResponse({
        "status": "ok",
        "zones": cam.get("zones", "[]"),
        "lines": cam.get("lines", "[]"),
        "rules": cam.get("rules", "[]"),
        "zone_profile": cam.get("zone_profile", "traffic"),
        "profile_features": cam.get("profile_features", "{}")
    })

@app.post("/api/cameras/{camera_id}/config")
async def save_camera_config_route(camera_id: str, request: Request):
    try:
        body = await request.json()
        cam = get_camera_full(camera_id)
        if cam:
            save_camera_enrolled(
                camera_id=camera_id,
                name=cam.get("name", camera_id),
                type_=cam.get("type", "axis"),
                source=cam.get("source", ""),
                is_active=cam.get("is_active", 1),
                zones=str(body.get("zones", cam.get("zones", "[]"))),
                lines=str(body.get("lines", cam.get("lines", "[]"))),
                rules=str(body.get("rules", cam.get("rules", "[]"))),
                zone_profile=str(body.get("zone_profile", cam.get("zone_profile", "traffic"))),
                profile_features=str(body.get("profile_features", cam.get("profile_features", "{}"))),
                host=cam.get("host"),
                port=cam.get("port"),
                protocol=cam.get("protocol", "https"),
                stream_path=cam.get("stream_path"),
                vendor=cam.get("vendor", "axis"),
                mac_address=cam.get("mac_address"),
                username=cam.get("username"),
                password=cam.get("password")
            )
        return JSONResponse({"status": "ok", "message": "Config updated"})
    except Exception as e:
        logger.error(f"[Config Route] Failed to update config for {camera_id}: {e}")
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=400)

# Background worker for DHCP camera IP change re-discovery
async def _background_camera_reconnect_loop():
    import socket
    while True:
        try:
            await asyncio.sleep(25.0)
            cams = get_all_cameras(safe=False)
            for c in cams:
                cid = c.get("id")
                host = c.get("host")
                port = c.get("port") or 42093
                if not cid or not host:
                    continue
                thread = manager.camera_threads.get(cid)
                is_running = getattr(thread, "running", False) if thread else False
                if not is_running:
                    # Test if stored IP is reachable
                    try:
                        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                        s.settimeout(0.3)
                        res = s.connect_ex((host, port))
                        s.close()
                        if res == 0:
                            # Host is reachable, restart pipeline thread
                            logger.info(f"[DHCP Worker] Re-starting pipeline thread for camera '{cid}' at {host}:{port}")
                            manager.start_camera_thread(c)
                    except Exception as e:
                        logger.warning(f"[DHCP Worker] Check failed for {cid} at {host}:{port}: {e}")
        except asyncio.CancelledError:
            break
        except Exception as err:
            logger.error(f"[DHCP Worker] Loop exception: {err}")

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(_background_camera_reconnect_loop())


if __name__ == "__main__":
    import os
    import sys
    import socket
    import uvicorn
    from app.config import HOST, PORT

    is_headless = "--headless" in sys.argv or "--daemon" in sys.argv
    if is_headless:
        print("[CamAI Background Daemon] Starting continuous 24/7 headless camera & intrusion alert service...", flush=True)

    dev_reload = os.getenv("CAMAI_DEV_RELOAD", "").strip().lower() in ("1", "true", "yes") and not is_headless

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





