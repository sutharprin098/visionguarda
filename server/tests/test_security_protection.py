import pytest
import hmac
import time
from fastapi.testclient import TestClient
from app.main import app
from app.ai.stream_resolver import blocked_source_reason

client = TestClient(app)

def test_dns_rebinding_protection():
    """Verify that requests with unauthorized Host headers are rejected with HTTP 421."""
    # Authorized host header (localhost)
    res_valid = client.get("/api/status", headers={"Host": "127.0.0.1"})
    assert res_valid.status_code == 200

    # Foreign/Attacker host header
    res_attacker = client.get("/api/status", headers={"Host": "attacker.com"})
    assert res_attacker.status_code == 421
    assert "Invalid Host header" in res_attacker.json()["detail"]


def test_ssrf_source_validation():
    """Verify SSRF validation blocks malicious loopback, cloud metadata, and unsafe schemes."""
    # Safe RTSP / HTTP media sources
    assert blocked_source_reason("rtsp://admin:pass@192.168.1.100:554/h264") is None
    assert blocked_source_reason("https://www.youtube.com/watch?v=dQw4w9WgXcQ") is None

    # Blocked dangerous sources (returns non-None refusal explanation string)
    assert blocked_source_reason("http://169.254.169.254/latest/meta-data/") is not None
    assert blocked_source_reason("http://127.0.0.1:8000/internal") is not None
    assert blocked_source_reason("file:///etc/passwd") is not None


def test_control_token_authentication(monkeypatch):
    """Verify X-CamAI-Token authentication protects configuration endpoints."""
    # Set a test API token
    monkeypatch.setattr("app.main.API_TOKEN", "secret-test-token-12345")

    # Invalid token -> 403 Forbidden
    res_bad = client.post(
        "/api/detection/confidence",
        json={"confidence": 0.4},
        headers={"X-CamAI-Token": "wrong-token"}
    )
    assert res_bad.status_code == 403
    assert "restricted to the CamAI application" in res_bad.json()["detail"]

    # Valid token -> 200 OK
    res_good = client.post(
        "/api/detection/confidence",
        json={"confidence": 0.4},
        headers={"X-CamAI-Token": "secret-test-token-12345"}
    )
    assert res_good.status_code == 200
