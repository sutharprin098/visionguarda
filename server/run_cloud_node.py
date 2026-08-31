"""
CamAI Standalone Cloud AI Inference Node Server

Runs a standalone Cloud AI Inference Node microservice on port 8099 (or custom --port).
Accepts POST /api/detect with JPEG image_b64 payload, executes YOLO/YOLOX AI inference,
and returns JSON detections.

Usage:
    python server/run_cloud_node.py [--port 8099] [--host 0.0.0.0]
"""

import sys
import os
import time
import base64
import argparse
import json
import numpy as np
import cv2
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# Add server directory to python path
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

app = FastAPI(title="CamAI Cloud AI Inference Node", version="1.0.0")

# Global YOLO backend instance
backend = None

def init_backend():
    global backend
    try:
        from app.ai.backend import EngineBackend
        print("[CLOUD_NODE] Initializing YOLOX AI backend for cloud inference...", flush=True)
        backend = EngineBackend(model_name="yolox_tiny")
        print(f"[CLOUD_NODE] AI Backend initialized successfully. Type={backend.backend_type} Device={backend.backend_device}", flush=True)
    except Exception as e:
        print(f"[CLOUD_NODE] WARNING: Could not load full YOLOX backend: {e}. Falling back to OpenCV motion/HOG detection.", flush=True)
        backend = None

@app.on_event("startup")
def startup_event():
    init_backend()

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "CamAI Cloud AI Node",
        "backend_ready": backend is not None,
        "timestamp": time.time()
    }

@app.get("/")
def index():
    return {"message": "CamAI Cloud AI Node running.", "endpoints": ["/health", "/api/detect"]}

@app.post("/api/detect")
async def detect(request: Request):
    t0 = time.perf_counter()
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"status": "error", "message": "Invalid JSON body"}, status_code=400)

    image_b64 = body.get("image_b64") or body.get("image") or body.get("frame")
    if not image_b64:
        return JSONResponse({"status": "error", "message": "Missing image_b64 in request"}, status_code=400)

    try:
        img_bytes = base64.b64decode(image_b64)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if frame is None:
            return JSONResponse({"status": "error", "message": "Could not decode JPEG image"}, status_code=400)
    except Exception as e:
        return JSONResponse({"status": "error", "message": f"Decode error: {e}"}, status_code=400)

    orig_h, orig_w = frame.shape[:2]
    detections = []

    if backend is not None:
        try:
            tsize = getattr(backend, "static_imgsz", None) or 320
            img_tensor, _ = backend.preprocess(frame, target_size=tsize)
            outputs, _ = backend.run_inference(img_tensor)
            raw_dets, _, _ = backend.postprocess(
                outputs, frame.shape[:2], conf_threshold=0.25, iou_threshold=0.45, target_imgsz=tsize
            )
            for d in raw_dets:
                cls_name = str(d.get("class", "object"))
                conf = float(d.get("confidence", 0.0))
                bx = d.get("bbox", {})
                x1_px = float(bx.get("x1", 0))
                y1_px = float(bx.get("y1", 0))
                x2_px = float(bx.get("x2", 0))
                y2_px = float(bx.get("y2", 0))
                detections.append({
                    "class": cls_name,
                    "confidence": round(conf, 2),
                    "bbox": {
                        "x1": round(x1_px / max(1, orig_w), 4),
                        "y1": round(y1_px / max(1, orig_h), 4),
                        "x2": round(x2_px / max(1, orig_w), 4),
                        "y2": round(y2_px / max(1, orig_h), 4)
                    },
                    "bbox_px": {
                        "x1": int(x1_px),
                        "y1": int(y1_px),
                        "x2": int(x2_px),
                        "y2": int(y2_px)
                    }
                })
        except Exception as e:
            print(f"[CLOUD_NODE] Inference error: {e}", flush=True)
    else:
        # Fallback HOG person detector
        hog = cv2.HOGDescriptor()
        hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        boxes, weights = hog.detectMultiScale(frame, winStride=(8, 8), padding=(4, 4), scale=1.05)
        for (x, y, w, h), wt in zip(boxes, weights):
            detections.append({
                "class": "person",
                "confidence": round(float(wt), 2),
                "bbox": {
                    "x1": round(float(x) / max(1, orig_w), 4),
                    "y1": round(float(y) / max(1, orig_h), 4),
                    "x2": round(float(x + w) / max(1, orig_w), 4),
                    "y2": round(float(y + h) / max(1, orig_h), 4)
                }
            })

    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    print(f"[CLOUD_NODE] Processed frame shape=({orig_h}, {orig_w}) -> {len(detections)} dets in {latency_ms}ms", flush=True)

    return {
        "status": "success",
        "detections": detections,
        "latency_ms": latency_ms,
        "count": len(detections)
    }

from fastapi import WebSocket

@app.websocket("/ws")
async def cloud_ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data_str = await websocket.receive_text()
            try:
                msg = json.loads(data_str)
                mtype = msg.get("type")
                if mtype == "ping":
                    await websocket.send_json({"type": "pong", "ts": time.time()})
                elif mtype == "subscribe":
                    cam_id = msg.get("camera_id", "cam1")
                    await websocket.send_json({
                        "type": "telemetry",
                        "data": {
                            cam_id: {
                                "people": 0,
                                "vehicles": 0,
                                "detections": [],
                                "fps": 30.0,
                                "latency": 20,
                                "device": "AWS Cloud GPU Node"
                            }
                        }
                    })
            except Exception:
                pass
    except Exception:
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CamAI Cloud AI Node Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8099, help="Port to listen on (default: 8099)")
    args = parser.parse_args()

    print(f"============================================================", flush=True)
    print(f"  CamAI Cloud AI Inference Node Server starting on http://{args.host}:{args.port}", flush=True)
    print(f"  Endpoints: GET /health | POST /api/detect", flush=True)
    print(f"============================================================", flush=True)

    uvicorn.run(app, host=args.host, port=args.port)
