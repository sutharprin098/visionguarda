import pytest
import os
from fastapi.testclient import TestClient
from app.main import app, _acap_mjpeg_generator

def test_acap_full_ui_index():
    client = TestClient(app)
    response = client.get("/local/camai_acap/index.html")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert '<div id="root">' in response.text
    assert "./assets/" in response.text

def test_acap_assets_served():
    client = TestClient(app)
    response = client.get("/local/camai_acap/assets/index-Bg4FUlwq.css")
    assert response.status_code == 200

def test_acap_config_cgi():
    client = TestClient(app)
    response = client.get("/local/camai_acap/config.cgi")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"

def test_acap_mjpeg_generator():
    gen = _acap_mjpeg_generator()
    frame = next(gen)
    assert b"--frame" in frame
    assert b"Content-Type: image/jpeg" in frame

def test_acap_edge_functions():
    client = TestClient(app)
    r1 = client.post("/functions/v1/report-camera-health", json={"cameras": []})
    assert r1.status_code == 200
    assert r1.json()["status"] == "ok"

    r2 = client.post("/functions/v1/decrypt-camera", json={"camera_id": "axis-cam-01"})
    assert r2.status_code == 200
    assert r2.json()["status"] == "ok"

def test_acap_detect_tracking():
    import base64
    import numpy as np
    import cv2
    client = TestClient(app)
    
    # Create synthetic test frame (blue image with white circle)
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.circle(img, (320, 240), 50, (255, 255, 255), -1)
    _, buf = cv2.imencode(".jpg", img)
    b64_frame = base64.b64encode(buf).decode("utf-8")

    response = client.post("/api/detect", json={"image_b64": b64_frame, "frame_id": 1})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "detections" in data

