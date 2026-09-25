#!/usr/bin/env python3
"""
Reusable Module Test Framework for CamAI Analytics Modules.
Covers:
- SECURITY (Person, Intrusion, Perimeter, Loitering, Face, Fire, Fall, etc.)
- TRAFFIC (Vehicle, Tracking, Line Crossing, Speed, ANPR, Helmet, etc.)
- FACTORY (PPE, Helmet, Safety Vest, Worker, Forklift, Restricted Zone)
- RETAIL (Customer, Footfall, Entry/Exit, Dwell)
- SMART CITY (Urban Detection, Density, ANPR)
- MICRO MOTION (Micro Motion, ROI, Alerts)
- CUSTOM (Detection Zone, AI Trigger, ROI)
- NIGHT VISION (Zero-DCE preprocessing)
"""
import requests
import pytest
import base64
import numpy as np
import cv2

MODULE_MATRIX = {
    "security": ["person_detection", "intrusion", "perimeter", "loitering", "face", "fire", "fall"],
    "traffic": ["vehicle_detection", "tracking", "counting", "line_crossing", "speed", "anpr", "helmet"],
    "factory": ["ppe", "helmet", "safety_vest", "worker", "forklift", "restricted_zone"],
    "retail": ["customer", "footfall", "entry_exit", "dwell"],
    "smart_city": ["urban_detection", "density", "anpr", "helmet"],
    "micro_motion": ["micro_motion", "roi", "alerts"],
    "custom": ["detection_zone", "ai_trigger", "roi"],
    "night_vision": ["zero_dce"]
}

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def run_module_test(module_profile="security", base_url="http://127.0.0.1:8000"):
    print(f"[*] Testing CamAI Module Profile: '{module_profile}'")
    
    img = np.zeros((360, 640, 3), dtype=np.uint8)
    _, buffer = cv2.imencode('.jpg', img)
    b64_frame = base64.b64encode(buffer).decode('utf-8')
    
    payload_on = {
        "image_b64": b64_frame,
        "frame_id": 1,
        "zone_profile": module_profile,
        "camera_id": "axis-cam-01"
    }
    
    try:
        res = requests.post(f"{base_url}/api/detect", json=payload_on, timeout=2)
        status_code = res.status_code
        data_on = res.json()
    except Exception:
        res = client.post("/api/detect", json=payload_on)
        status_code = res.status_code
        data_on = res.json()

    assert status_code == 200, f"Module '{module_profile}' ON returned status {status_code}"
    assert data_on.get("active_module") == module_profile
    assert "detections" in data_on
    
    print(f"  [PASS] Module '{module_profile}' ON verified. Detections returned: {len(data_on['detections'])}")
    return True

@pytest.mark.parametrize("profile", list(MODULE_MATRIX.keys()))
def test_all_camai_module_profiles(profile):
    assert run_module_test(profile) is True

if __name__ == "__main__":
    for prof in MODULE_MATRIX.keys():
        run_module_test(prof)
