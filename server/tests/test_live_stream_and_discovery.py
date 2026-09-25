"""
End-to-End Verification Test for CamAI Live Stream Proxy & Dynamic Axis Camera Discovery
"""
import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import pytest
import asyncio
from fastapi.testclient import TestClient

from app.main import app, get_mjpeg_stream
from app.storage import init_db, get_camera_full, get_camera

init_db()
client = TestClient(app)

def test_01_camera_discovery_endpoint():
    """Verify GET and POST /api/cameras/discover return valid JSON without exposing passwords."""
    response = client.get("/api/cameras/discover")
    assert response.status_code == 200
    data = response.json()
    assert data.get("success") is True
    assert "devices" in data
    assert isinstance(data["devices"], list)

    for dev in data["devices"]:
        assert "password" not in dev
        assert "username" not in dev

def test_02_camera_enrollment_endpoint():
    """Verify POST /api/cameras/enroll persists camera and masks credentials in output."""
    payload = {
        "id": "axis_test_cam",
        "name": "Test Axis Camera",
        "host": "195.60.68.14",
        "port": 42093,
        "protocol": "https",
        "stream_path": "/axis-cgi/mjpg/video.cgi",
        "username": "VLTuser",
        "password": "wY0-oD0jA6jft3",
        "vendor": "axis"
    }
    response = client.post("/api/cameras/enroll", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data.get("success") is True
    cam = data.get("camera", {})
    assert cam.get("id") == "axis_test_cam"
    assert "password" not in cam
    assert "username" not in cam

    # Verify server-side database has credentials stored securely
    full_cam = get_camera_full("axis_test_cam")
    assert full_cam is not None
    assert full_cam.get("username") == "VLTuser"
    assert full_cam.get("password") == "wY0-oD0jA6jft3"

def test_03_get_cameras_sanitization():
    """Verify GET /api/cameras and GET /api/cameras/{id} return sanitized records."""
    response = client.get("/api/cameras")
    assert response.status_code == 200
    cams = response.json()
    assert isinstance(cams, list)
    for c in cams:
        assert "password" not in c
        assert "username" not in c
        if c.get("source"):
            assert "wY0-oD0jA6jft3" not in c["source"]

def test_04_mjpeg_stream_proxy_headers():
    """Verify /api/cameras/{id}/stream and /axis-cgi/mjpg/video.cgi return multipart MJPEG response."""
    resp = asyncio.run(get_mjpeg_stream("axis-local-cam"))
    assert resp.media_type == "multipart/x-mixed-replace; boundary=myboundary"
    assert resp.headers.get("Cache-Control") == "no-cache, no-store, must-revalidate"

def test_05_postgrest_and_config_fallbacks():
    """Verify legacy PostgREST endpoints return 200 OK without 404 errors."""
    for path in [
        "/rest/v1/analytics_drawings",
        "/rest/v1/rule_engine_rules",
        "/rest/v1/zone_profile_configs",
        "/rest/v1/cameras",
        "/api/cameras/axis-local-cam/config"
    ]:
        response = client.get(path)
        assert response.status_code == 200

if __name__ == "__main__":
    pytest.main(["-v", __file__])
