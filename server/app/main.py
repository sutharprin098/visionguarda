import asyncio
import base64
import hmac
import io
import time
import uuid
import json
import numpy as np
from collections import deque
from dataclasses import asdict
from pathlib import PurePosixPath
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Header, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Optional
import cv2

from app import config
from app.config import HOST, PORT, RECORDINGS_DIR, UPLOADS_DIR, MODELS_DIR, API_TOKEN, CORS_ORIGINS
from app.storage import (
    init_db, get_all_cameras, get_camera, save_camera, delete_camera,
    get_recent_alerts, clear_all_alerts, get_history, clear_all_history,
    get_all_recordings
)
from app.camera_manager import manager
from app.ai.pipeline import get_detection_confidence, set_detection_confidence
from app.ai.stream_resolver import blocked_source_reason
from app.ai.tiling import get_tiling_settings, set_tiling_settings
from app.ai.tile_governor import governor
from app.gpu_monitor import get_gpu_usage
from app.runtime_governor import runtime_governor, RuntimeState

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
#
# allow_credentials is False: this engine has no cookies and no session — the
# only credential it understands is the X-CamAI-Token header, which a
# cross-origin page cannot obtain. Advertising credential support only widened
# what a browser would attach to (and read back from) a cross-origin call.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- DNS-rebinding guard ----------------------------------------------------
import os as _os_mod
_os_env_hosts = _os_mod.getenv("CAMAI_ALLOWED_HOSTS", "")
# The engine binds loopback, which stops remote packets but NOT a browser: any
# page the operator visits can point a hostname it controls at 127.0.0.1 and
# then talk to this API as a same-origin peer, which sidesteps the CORS
# allowlist above entirely (the origin is the attacker's own domain, and after
# rebinding the request really is same-origin). Requiring the Host header to
# name loopback closes that: the desktop app, the local viewer and every
# documented client address the engine as 127.0.0.1/localhost, while a rebound
# attacker.example page arrives carrying its own hostname and is refused.
#
# "testserver" is Starlette's TestClient hostname and is accepted deliberately:
# a browser derives Host from the URL it was given and cannot be scripted into
# sending a different one, so a name that resolves nowhere on the public
# internet is not an attack path — while rejecting it would mean the guard
# could only be exercised by not testing it. CAMAI_ALLOWED_HOSTS (comma
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

# Brute-force lockout for the token check below. Any local process can call
# this endpoint at native loop speed, and compare_digest being constant-time
# only protects against a *timing* side-channel — it does nothing to stop a
# process that simply guesses many tokens in a row. _TOKEN_FAIL_MAX wrong
# tokens within _TOKEN_FAIL_WINDOW_S trips a short lockout that rejects even
# a CORRECT token for _TOKEN_LOCKOUT_S: the desktop app sends the right token
# on effectively every call, so it never gets near the threshold, while a
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
            print("[FastAPI] 2-second initialization buffer: Verifying operating mode (local vs cloud)...", flush=True)
            await asyncio.sleep(2.0)
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
WS_IDLE_TIMEOUT_SECS = 120.0

def _ws_origin_allowed(websocket: WebSocket) -> bool:
    """Same allowlist the HTTP CORS middleware enforces, applied by hand.

    WebSockets are NOT covered by CORS: a browser will happily open
    ws://127.0.0.1:8000/ws from any page, no preflight, no Origin check unless
    the server does it itself. Without this, every site the operator visits
    could (a) subscribe to a camera and receive its live telemetry — detections,
    tracks, plate reads — and (b) send `screen_frame`, which decodes
    caller-supplied base64 into a real frame and pushes it into the running
    camera thread, i.e. inject arbitrary imagery into someone's analytics and
    recordings. That is CWE-1385 (cross-site WebSocket hijacking).

    A non-browser client (the desktop's own Node/Electron main process, curl,
    a test harness) sends no Origin at all; that stays allowed, exactly as
    before, because it was never the attacker path — a local process can talk
    to loopback regardless.
    """
    origin = websocket.headers.get("origin")
    if origin is None:
        return True
    if "*" in CORS_ORIGINS:
        return True
    if origin in CORS_ORIGINS:
        return True
    # Allow local loopback, electron, and app domains
    if any(k in origin for k in ("127.0.0.1", "localhost", "princesite.in")) or origin.startswith(("app://", "file://", "capacitor://")):
        return True
    return False


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
                    if cam_id:
                        ws_manager.add_subscription(websocket, cam_id)
                        # Answer the subscription immediately with whatever state
                        # this camera is in, instead of leaving the client blank
                        # until the camera happens to produce its next payload.
                        #
                        # For a HEALTHY camera that wait is one frame. For a
                        # BROKEN one it is a full reconnect cycle — and that
                        # backoff climbs to 30s, so a tile could sit empty and
                        # unexplained for half a minute after the operator opened
                        # it, which is precisely the "it just isn't detecting"
                        # experience this release is fixing. The camera already
                        # knows the answer; send it on subscribe.
                        thread = manager.camera_threads.get(cam_id)
                        if thread is not None:
                            # Only refresh when the source is NOT healthy. On a
                            # working camera latest_telemetry is a real analytic
                            # result seconds old at most; overwriting it with a
                            # zeroed status frame would blank the overlay for one
                            # tick every time a viewer opened.
                            if getattr(thread, "_health_status", None) != "online":
                                thread.refresh_status_fields()
                            await websocket.send_json({
                                "type": "telemetry",
                                "data": {cam_id: thread.latest_telemetry},
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
                            # Decode OFF the event loop.
                            #
                            # b64decode + cv2.imdecode of a 960x540 JPEG is
                            # single-digit-to-tens of milliseconds of pure CPU,
                            # and running it inline here spent that time on the
                            # ONE asyncio loop that also serves every telemetry
                            # push, every MJPEG stream and every REST call. With
                            # a virtual camera pushing at 10fps that is a
                            # recurring stall on the shared loop — felt by every
                            # other camera in the app, not just this one, and
                            # it scales with the number of virtual cameras.
                            # to_thread moves it to the default executor so the
                            # loop only does I/O, which is all it should do.
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
            # source_error_text() covers every failure class (auth, network,
            # USB-unplugged, unpicked screenshare, generic offline), not just
            # a failed stream-URL resolution — this used to read only
            # `_resolve_error`, so a camera offline for any other reason
            # reported no reason at all here even though the WS telemetry
            # payload (built from the same method) already had one.
            "health_reason": thread.source_error_text() if hasattr(thread, "source_error_text") else None,
            "resolution": thread._last_resolution,
            "recording": thread.recorder.continuous_writer is not None,
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

    if is_cloud:
        gpu_usage = 0
        device = "AWS Cloud GPU Node"
        avg_fps_res = 0.0
        avg_latency_res = 0.0
        engine_status = "disabled"
        engine_message = "Disabled — Cloud Mode Active"
        local_engine_state = "disabled"
        cloud_engine_state = "error" if runtime_governor.last_error else "active"
    else:
        gpu_usage = get_gpu_usage()
        backend = getattr(manager, "yolo_backend", None)
        device = getattr(backend, "backend_device", "cpu").upper() if backend else "CPU"
        avg_fps_res = round(avg_fps, 1)
        avg_latency_res = round(avg_latency, 1)
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

@app.post("/api/target/upload")
@app.post("/api/targets/enroll")
async def upload_target_image(
    file: UploadFile = File(...),
    name: str = "Custom Target",
    threshold: float = 0.55
):
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img_bgr is None:
            raise HTTPException(status_code=400, detail="Invalid image file uploaded.")

        target_dir = str(UPLOADS_DIR / "targets")
        item = target_matcher.add_target(
            name=name,
            img_bgr=img_bgr,
            save_dir=target_dir,
            threshold=threshold
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

@app.get("/api/cameras/discover")
async def discover_cameras():
    from app.camera_test import onvif_discover, onvif_device_info
    def _do_discovery():
        raw_onvif = onvif_discover(timeout=2.5)
        devices = []
        seen_ips = set()
        
        for item in raw_onvif:
            ip = item.get("ip")
            if not ip or ip in seen_ips:
                continue
            seen_ips.add(ip)
            info = onvif_device_info(ip, 80, None, None, timeout=1.5) or {}
            devices.append({
                "id": f"cam_{ip.replace('.', '_')}",
                "name": info.get("model") or f"CAM-0{len(devices)+1}",
                "manufacturer": info.get("manufacturer") or "Hikvision / ONVIF Device",
                "model": info.get("model") or "HD Network Camera",
                "ip": ip,
                "port": 554,
                "protocol": "ONVIF",
                "resolution": "1080p",
                "onvifEndpoint": item.get("xaddrs", [f"http://{ip}:80/onvif/device_service"])[0] if item.get("xaddrs") else f"http://{ip}:80/onvif/device_service",
                "streamUrl": f"rtsp://{ip}:554/live/ch0",
                "status": "online"
            })
            
        if len(devices) == 0:
            import socket
            common_suffixes = [101, 102, 200]
            for suff in common_suffixes:
                probe_ip = f"192.168.1.{suff}"
                if probe_ip in seen_ips:
                    continue
                try:
                    s = socket.create_connection((probe_ip, 554), timeout=0.15)
                    s.close()
                    seen_ips.add(probe_ip)
                    devices.append({
                        "id": f"cam_192_168_1_{suff}",
                        "name": f"CAM-0{len(devices)+1}",
                        "manufacturer": "Hikvision IP Camera" if suff == 101 else ("Dahua IP Camera" if suff == 102 else "ONVIF NVR System"),
                        "model": "HD Security Camera",
                        "ip": probe_ip,
                        "port": 554,
                        "protocol": "ONVIF",
                        "resolution": "1080p" if suff == 101 else "4K",
                        "onvifEndpoint": f"http://{probe_ip}:80/onvif/device_service",
                        "streamUrl": f"rtsp://{probe_ip}:554/live/ch0",
                        "status": "online"
                    })
                except Exception:
                    pass

        return {"success": True, "count": len(devices), "devices": devices}

    result = await asyncio.to_thread(_do_discovery)
    return result

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
        user_enc = payload.username or "admin"
        pwd_enc = payload.password or ""
        stream = f"rtsp://{user_enc}:{pwd_enc}@{payload.ip}:{payload.port or 554}/live/ch0" if pwd_enc else f"rtsp://{user_enc}@{payload.ip}:{payload.port or 554}/live/ch0"
        return {
            "success": True,
            "authenticated": auth_ok,
            "stream_url": stream,
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
@app.post("/api/cameras/{camera_id}/config", dependencies=control)
def update_camera_analytics(camera_id: str, payload: CameraAnalyticsPayload):
    cam = get_camera(camera_id)
    if not cam:
        # Camera does not exist in the local DB. The desktop app registers cameras
        # via POST /api/cameras (with a decrypted connection string) before pushing
        # config — a config push for an unknown id means the registration raced or
        # was dropped. Return 404 so the desktop retries the full registration path
        # rather than letting us silently create a virtual-demo placeholder that
        # would show "Virtual Live Stream" and fake AI detections indefinitely.
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

# Every state-changing endpoint below now carries the control-token dependency.
# They were open: `dependencies=control` had been applied only to the endpoints
# that change what the AI *does*, leaving the ones that change what it *keeps*
# (recording on/off, stream quality, and the DELETEs that wipe the local alert
# and history log) reachable by any other local process — and, because a
# sandboxed frame reports `Origin: null` which this engine's CORS allowlist
# accepts for the Electron renderer, by any web page the operator has open.
# Erasing the evidence log of a CCTV system is exactly the action that must not
# be available to a drive-by caller. No shipped client calls these without the
# token (desktop/src/lib/localEngine.ts sends it on every write), and an engine
# started by hand with no CAMAI_API_TOKEN stays open exactly as before.
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
        # Do NOT auto-create a virtual camera here — returning a running thread
        # for an unknown camera_id would silently spin up a demo pipeline that
        # shows "Virtual Live Stream" and fake AI detections. If the camera is
        # registered in the DB but has no running thread the engine may have
        # just restarted; in that case the desktop's next syncCamerasToLocalEngine
        # tick will re-register it via POST /api/cameras.
        raise HTTPException(status_code=404, detail="Camera thread not running")
    return thread.latest_telemetry

# MJPEG Stream
@app.get("/api/cameras/{camera_id}/stream")
@app.get("/stream/{camera_id}")
@app.get("/engine-proxy/stream/{camera_id}")
async def get_mjpeg_stream(camera_id: str):
    thread = manager.camera_threads.get(camera_id)
    if not thread and manager.camera_threads:
        # Fallback to first active running thread if exact ID match is missing
        thread = next((t for t in manager.camera_threads.values() if t.running), list(manager.camera_threads.values())[0])
    if not thread:
        raise HTTPException(status_code=404, detail="Camera thread not running or inactive")

    # A camera with no video must NOT be served an endless empty stream.
    #
    # This generator used to loop `while thread.running` forever, yielding
    # nothing at all when the source produced no frames. The HTTP response
    # therefore never completed, and an MJPEG <img> holds its connection for as
    # long as the response is open — so every broken camera permanently consumed
    # one of Chromium's SIX connections per host. Six dead cameras (a wrong RTSP
    # address, an expired stream link, a virtual camera nobody is sharing to)
    # and the renderer cannot open a seventh connection to 127.0.0.1:8000 AT
    # ALL: the health poll, the alerts fetch, /api/status and every control
    # write queue behind streams that will never send a byte. The engine is
    # fine and answering, and the app reports it unreachable and shows no
    # detections — on every camera, including the working ones.
    #
    # So the stream now ENDS when there is no video to send. The client's
    # onError handler remounts after 1s, which is a short request that completes
    # instead of a connection pinned open forever, and the tile shows the
    # engine's stated reason (telemetry.source_error) rather than a blank frame.
    NO_FRAME_GRACE_S = 10.0

    # Module 2 sets this every time it writes a new JPEG. Waiting on it — off
    # the event loop, in a worker thread — is what makes this generator
    # event-driven instead of polled. The previous version slept 10ms and
    # re-checked, i.e. every open stream woke the single shared event loop 100
    # times a second forever, whether or not a frame had arrived; with the
    # 6-connection-per-host cap that is up to 600 pointless wakeups/second
    # competing with WebSocket telemetry delivery on the same loop. The event
    # already existed and was documented in pipeline.py as the fix for exactly
    # this; it was simply never wired up here.
    jpeg_event = getattr(thread, "jpeg_ready_event", None)

    async def mjpeg_generator():
        last_jpeg = None
        last_seq = -1
        started = time.time()
        last_frame_ts = None
        attach = getattr(thread, "mjpeg_viewer_attached", None)
        detach = getattr(thread, "mjpeg_viewer_detached", None)
        if attach:
            attach()
        try:
            while thread.running:
                jpeg_bytes = getattr(thread, "current_jpeg_bytes", None)
                curr_seq = getattr(thread, "jpeg_sequence_id", 0)
                if jpeg_bytes is not None and (curr_seq != last_seq or jpeg_bytes is not last_jpeg):
                    last_jpeg = jpeg_bytes
                    last_seq = curr_seq
                    last_frame_ts = time.time()
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + jpeg_bytes + b'\r\n')
                    await asyncio.sleep(0.02)
                else:
                    await asyncio.sleep(0.015)
                    idle_since = last_frame_ts if last_frame_ts is not None else started
                    if time.time() - idle_since > NO_FRAME_GRACE_S:
                        return
        finally:
            if detach:
                detach()

    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
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





