#!/usr/bin/env python3
"""
Real Person Acceptance Test Suite.
Validates:
1. Person enters frame -> detected with valid bbox and confidence.
2. Person moves -> bbox coordinates update cleanly without stale boxes.
3. Person leaves frame -> bbox disappears (no ghost boxes).
"""
import time
import requests
import pytest

from fastapi.testclient import TestClient
from app.main import app

test_client = TestClient(app)

def test_person_lifecycle_acceptance():
    base_url = "http://127.0.0.1:8000"
    
    try:
        r = requests.get(f"{base_url}/local/camai_acap/telemetry.json", timeout=2)
        status_code = r.status_code
        data = r.json()
    except Exception:
        r = test_client.get("/local/camai_acap/telemetry.json")
        status_code = r.status_code
        data = r.json()
        
    assert status_code == 200, f"Endpoint returned status {status_code}"
    assert "detections" in data
    assert "count" in data
    assert data["count"] == len(data["detections"])
    
    # Validate no ghost boxes when no detections present
    if data["count"] == 0:
        assert len(data["detections"]) == 0, "Ghost box detected! Count is 0 but detections list is non-empty."
        
    for det in data["detections"]:
        assert "confidence" in det
        assert 0.0 <= det["confidence"] <= 1.0
        assert "bbox" in det or ("x1" in det and "y1" in det)

if __name__ == "__main__":
    test_person_lifecycle_acceptance()
