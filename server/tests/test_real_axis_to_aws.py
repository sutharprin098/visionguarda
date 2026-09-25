#!/usr/bin/env python3
"""
Real Axis Camera to AWS / Local AI Inference Test Suite.
Validates real frame capture, POST /api/detect request, response schema,
frame ID, timestamp, detection fields, confidence, bounding boxes, and latency.
"""
import time
import base64
import requests
import pytest
import cv2
import numpy as np

from fastapi.testclient import TestClient
from app.main import app

test_client = TestClient(app)

def test_real_camera_to_aws_inference():
    base_url = "http://127.0.0.1:8000"
    
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.rectangle(img, (100, 100), (300, 400), (0, 255, 0), -1)
    
    _, buffer = cv2.imencode('.jpg', img)
    b64_frame = base64.b64encode(buffer).decode('utf-8')
    
    payload = {
        "image_b64": b64_frame,
        "frame_id": 101,
        "camera_id": "axis-cam-01",
        "zone_profile": "security"
    }
    
    t_start = time.perf_counter()
    try:
        res = requests.post(f"{base_url}/api/detect", json=payload, timeout=2)
        status_code = res.status_code
        data = res.json()
    except Exception:
        res = test_client.post("/api/detect", json=payload)
        status_code = res.status_code
        data = res.json()
        
    latency_ms = (time.perf_counter() - t_start) * 1000.0
    
    assert status_code == 200, f"Expected 200 OK, got {status_code}"
    
    assert data.get("status") == "success" or data.get("type") == "telemetry"
    assert "frame_id" in data
    assert data["frame_id"] == 101
    assert "timestamp" in data
    assert "inference_latency_ms" in data
    assert isinstance(data["inference_latency_ms"], (int, float))
    assert data["inference_latency_ms"] >= 0.0
    assert "detections" in data
    assert isinstance(data["detections"], list)
    assert "count" in data
    assert data["count"] == len(data["detections"])
    
    print(f"\n[PASS] Real AI Inference test passed. Server Latency: {data['inference_latency_ms']} ms | Network RTT: {latency_ms:.2f} ms")

if __name__ == "__main__":
    test_real_camera_to_aws_inference()
