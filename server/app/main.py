import asyncio
import time
import uuid
from pathlib import PurePosixPath
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Optional
import cv2

from app.config import HOST, PORT, RECORDINGS_DIR, UPLOADS_DIR
from app.storage import (
    init_db, get_all_cameras, get_camera, save_camera, delete_camera,
    get_recent_alerts, clear_all_alerts, get_history, clear_all_history,
    get_all_recordings
)
from app.camera_manager import manager

app = FastAPI(title="CamAI CCTV Analytics Platform")

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep socket alive and listen for client inputs (like manual triggers or subscriptions)
            data = await websocket.receive_text()
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
        ws_manager.disconnect(websocket)
    except Exception as e:
        print(f"[WS] Exception: {e}")
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

class CameraAnalyticsPayload(BaseModel):
    zones: str
    lines: str

class CameraDisplayPayload(BaseModel):
    max_width: Optional[int] = None
    quality: Optional[int] = None

class CameraRecordingPayload(BaseModel):
    enabled: bool

# --- REST APIs ---

class ModelSelectPayload(BaseModel):
    model_name: str

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
            "counters": thread.latest_telemetry.get("counters", {"in": 0, "out": 0})
        }
        
    # Recommendation logic:
    # If active model is yolo11m-seg.pt or yolo11s-seg.pt, and we're on CPU, recommend a lighter model
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    recommendation = {
        "should_switch": False,
        "message": "",
        "suggested_model": ""
    }
    
    if device == "cpu":
        if manager.selected_model_name == "yolo11m-seg.pt":
            recommendation = {
                "should_switch": True,
                "message": "Performance Warning: YOLO11m Seg is active on CPU. Inference latency is high. We recommend switching to a lighter model (YOLO11s Seg or YOLO11n Seg) for real-time performance.",
                "suggested_model": "yolo11s-seg.pt"
            }
        elif manager.selected_model_name == "yolo11s-seg.pt":
            # Check if latency is high
            running_threads = [t for t in manager.camera_threads.values() if t.running]
            avg_latency = sum(t.latest_telemetry.get("latency", 0) for t in running_threads) / len(running_threads) if running_threads else 0
            if avg_latency > 250.0:
                recommendation = {
                    "should_switch": True,
                    "message": "Performance Warning: YOLO11s Seg is experiencing high latency on CPU. We recommend switching to the ultra-lightweight YOLO11n Seg model.",
                    "suggested_model": "yolo11n-seg.pt"
                }
        
    return {
        "server": "online",
        "uptime": round(time.time() - startup_time),
        "modelLoaded": manager.yolo_model is not None,
        "cameraThreadsActive": len(manager.camera_threads),
        "cameras": camera_states,
        "selectedModel": manager.selected_model_name,
        "benchmark": manager.benchmark_results,
        "recommendation": recommendation
    }

@app.post("/api/model/select")
def select_model(payload: ModelSelectPayload):
    valid_models = ["yolo11n-seg.pt", "yolo11s-seg.pt", "yolo11m-seg.pt"]
    if payload.model_name not in valid_models:
        raise HTTPException(status_code=400, detail="Invalid model name. Choose from: " + ", ".join(valid_models))
    success = manager.hot_swap_model(payload.model_name)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to hot-swap to selected model.")
    return {"success": True, "message": f"Successfully swapped active model to {payload.model_name}"}

# Cameras
@app.get("/api/cameras")
def list_cameras():
    return get_all_cameras()

ALLOWED_UPLOAD_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}

@app.post("/api/cameras/upload")
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

@app.post("/api/cameras")
def add_or_update_camera(payload: CameraConfigPayload):
    save_camera(
        payload.id,
        payload.name,
        payload.type,
        payload.source,
        1 if payload.is_active else 0,
        payload.zones,
        payload.lines
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

@app.delete("/api/cameras/{camera_id}")
def remove_camera(camera_id: str):
    manager.stop_camera_thread(camera_id)
    delete_camera(camera_id)
    return {"success": True, "message": "Camera removed successfully"}

@app.post("/api/cameras/{camera_id}/config")
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
        payload.lines
    )
    
    # Update live thread on-the-fly
    manager.update_camera_analytics_config(camera_id, payload.zones, payload.lines)
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
def get_mjpeg_stream(camera_id: str):
    thread = manager.camera_threads.get(camera_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Camera thread not running or inactive")

    def mjpeg_generator():
        last_jpeg = None
        while thread.running:
            jpeg_bytes = getattr(thread, "current_jpeg_bytes", None)
            if jpeg_bytes is not None and jpeg_bytes is not last_jpeg:
                last_jpeg = jpeg_bytes
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + jpeg_bytes + b'\r\n')
            time.sleep(0.01)  # High frequency polling, extremely low CPU load

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

if __name__ == "__main__":
    import uvicorn
    import sys
    from app.config import HOST, PORT
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=True)

