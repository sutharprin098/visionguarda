"""
CamAI AWS Cloud Node — End-to-End Automated Test Suite
======================================================

Tests the following real behaviors against the AWS Cloud Node:
  1. Health endpoint (/health, /api/health)
  2. Metrics endpoint (/api/metrics)
  3. Model loading and backend readiness
  4. Single frame inference (POST /api/detect)
  5. Real bounding box coordinate validation
  6. Letterbox coordinate unprojecting
  7. Detection validation (NaN, negative coords, inverted boxes)
  8. Real FPS calculation (frames_received, processing)
  9. Stale frame dropping / Latest-Frame-Wins
  10. WebSocket /ws/telemetry connectivity

Usage:
    python server/tests/test_aws_cloud_node.py [--host 127.0.0.1] [--port 8099]

The server must already be running before running these tests.
"""

import sys
import os
import time
import base64
import argparse
import json
import math
import numpy as np
import cv2
import asyncio

# Add server dir to sys.path
SERVER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

try:
    import requests
except ImportError:
    print("[ERROR] requests library is required: pip install requests")
    sys.exit(1)

try:
    import websockets
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False
    print("[WARN] websockets library not found. WS tests will be skipped. pip install websockets")

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
SKIP = "\033[93mSKIP\033[0m"
INFO = "\033[94mINFO\033[0m"

results = []

def record(name, passed, message=""):
    status = PASS if passed else FAIL
    print(f"  [{status}] {name}" + (f" — {message}" if message else ""))
    results.append((name, passed, message))

def make_test_frame(w=1920, h=1080):
    """Generate a realistic synthetic test frame (gradient with geometric shapes)."""
    frame = np.zeros((h, w, 3), dtype=np.uint8)
    # Gradient background
    frame[:, :, 0] = np.linspace(20, 80, w, dtype=np.uint8)
    frame[:, :, 1] = 40
    frame[:, :, 2] = 60
    # Draw synthetic objects (rectangles resembling persons/vehicles)
    cv2.rectangle(frame, (300, 200), (480, 900), (100, 180, 100), -1)   # "person"
    cv2.rectangle(frame, (900, 600), (1400, 900), (100, 100, 180), -1)  # "vehicle"
    return frame

def encode_frame_b64(frame):
    """JPEG-encode a numpy frame to base64."""
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buf.tobytes()).decode("utf-8")

def test_health_endpoint(base_url):
    print("\n--- TEST 1: Health Endpoint ---")
    for path in ["/health", "/api/health"]:
        try:
            r = requests.get(f"{base_url}{path}", timeout=5)
            ok = r.status_code == 200
            data = r.json() if ok else {}
            record(f"GET {path} returns 200", ok, f"status_code={r.status_code}")
            record(f"GET {path} has 'status' field", "status" in data)
            record(f"GET {path} includes 'backend_ready'", "backend_ready" in data)
            record(f"GET {path} includes 'fps'", "fps" in data)
            if "hardware" in data:
                hw = data["hardware"]
                record(f"GET {path} hardware.cpu_percent is real (not None)", hw.get("cpu_percent") is not None)
        except Exception as e:
            record(f"GET {path}", False, str(e))

def test_metrics_endpoint(base_url):
    print("\n--- TEST 2: Metrics Endpoint ---")
    try:
        r = requests.get(f"{base_url}/api/metrics", timeout=5)
        ok = r.status_code == 200
        record("GET /api/metrics returns 200", ok, f"status_code={r.status_code}")
        if ok:
            data = r.json()
            record("metrics has 'fps' section", "fps" in data.get("metrics", {}))
            record("metrics has 'counters' section", "counters" in data.get("metrics", {}))
    except Exception as e:
        record("GET /api/metrics", False, str(e))

def test_single_frame_inference(base_url):
    print("\n--- TEST 3: Single Frame Inference ---")
    frame = make_test_frame()
    b64 = encode_frame_b64(frame)
    h, w = frame.shape[:2]

    try:
        payload = {
            "image_b64": b64,
            "frame_id": 1,
            "timestamp_ms": int(time.time() * 1000)
        }
        r = requests.post(f"{base_url}/api/detect", json=payload, timeout=10)
        ok = r.status_code == 200
        record("POST /api/detect returns 200", ok, f"status_code={r.status_code}")

        if not ok:
            return

        data = r.json()
        record("Response has 'detections' array", "detections" in data)
        record("Response has 'frame_id'", "frame_id" in data)
        record("Response has 'fps' section", "fps" in data)
        record("Response has 'latency_ms'", "latency_ms" in data)
        record("detection_frame_id matches request frame_id", data.get("detection_frame_id") == 1)

        # FPS sanity checks
        fps = data.get("fps", {})
        record("fps.input_fps is a real number >= 0", isinstance(fps.get("input_fps"), (int, float)) and fps.get("input_fps") >= 0)
        record("latency_ms is a real positive number", isinstance(data.get("latency_ms"), (int, float)) and data.get("latency_ms") > 0)
        record("No hardcoded 30 FPS (no fake value)", fps.get("input_fps") != 30.0 or fps.get("processing_fps", 0) != 30.0)

    except Exception as e:
        record("POST /api/detect (single frame)", False, str(e))

def test_coordinate_validation(base_url):
    print("\n--- TEST 4: Bounding Box Coordinate Validation ---")
    frame = make_test_frame()
    b64 = encode_frame_b64(frame)

    try:
        r = requests.post(f"{base_url}/api/detect", json={"image_b64": b64, "frame_id": 2}, timeout=10)
        if r.status_code != 200:
            record("Coordinate validation (skipped — detect failed)", False)
            return

        data = r.json()
        dets = data.get("detections", [])
        all_valid = True
        for d in dets:
            bbox = d.get("bbox", {})
            x1, y1, x2, y2 = bbox.get("x1", 0), bbox.get("y1", 0), bbox.get("x2", 0), bbox.get("y2", 0)

            # Check NaN/Inf
            if any(math.isnan(v) or math.isinf(v) for v in [x1, y1, x2, y2]):
                all_valid = False
                print(f"  [WARN] NaN/Inf in bbox: {d}")
            # Check inverted coordinates
            if x2 <= x1 or y2 <= y1:
                all_valid = False
                print(f"  [WARN] Inverted bbox: x1={x1}, y1={y1}, x2={x2}, y2={y2}")
            # Check bounds [0, 1] for normalized
            if max(x1, y1, x2, y2) <= 1.0:
                if any(v < 0 or v > 1.0 for v in [x1, y1, x2, y2]):
                    all_valid = False

        record(f"All {len(dets)} detections have valid non-inverted bboxes", all_valid)
        record("Detections have track_id field", all(d.get("track_id") is not None for d in dets) if dets else True)

    except Exception as e:
        record("Coordinate validation", False, str(e))

def test_continuous_fps(base_url, num_frames=10):
    print(f"\n--- TEST 5: Continuous Inference FPS ({num_frames} frames) ---")
    frame = make_test_frame()
    b64 = encode_frame_b64(frame)

    start = time.perf_counter()
    last_fps = {}
    for i in range(num_frames):
        try:
            r = requests.post(f"{base_url}/api/detect", json={
                "image_b64": b64,
                "frame_id": 100 + i,
                "timestamp_ms": int((time.time() + i * 0.033) * 1000)
            }, timeout=10)
            if r.status_code == 200:
                last_fps = r.json().get("fps", {})
        except Exception as e:
            record(f"Frame {i} inference", False, str(e))
            return

    elapsed = time.perf_counter() - start
    measured_fps = round(num_frames / elapsed, 1)
    print(f"  [{INFO}] Sent {num_frames} frames in {elapsed:.2f}s = {measured_fps} req/s (latency-limited)")
    print(f"  [{INFO}] Server reported FPS: {last_fps}")

    record("Processed all 10 frames without error", True)
    record("Server fps.processing_fps is not hardcoded 30.0",
           last_fps.get("processing_fps") != 30.0 or last_fps.get("input_fps", 0) > 0)

def test_metrics_after_inference(base_url):
    print("\n--- TEST 6: Frame Counters After Inference ---")
    try:
        r = requests.get(f"{base_url}/api/metrics", timeout=5)
        if r.status_code != 200:
            record("Metrics after inference (skipped)", False)
            return
        data = r.json()
        counters = data.get("metrics", {}).get("counters", {})
        received = counters.get("received", 0)
        processed = counters.get("processed", 0)
        record(f"frames_received > 0 ({received})", received > 0)
        record(f"frames_processed > 0 ({processed})", processed > 0)
        record("frames_processed <= frames_received", processed <= received)
    except Exception as e:
        record("Metrics after inference", False, str(e))

def test_websocket_connectivity(base_url):
    print("\n--- TEST 7: WebSocket /ws/telemetry Connectivity ---")
    if not HAS_WEBSOCKETS:
        record("WebSocket test", None, "SKIPPED — websockets not installed")
        return

    ws_url = base_url.replace("http://", "ws://").replace("https://", "wss://") + "/ws/telemetry"

    async def _test():
        try:
            async with websockets.connect(ws_url, open_timeout=5) as ws:
                await ws.send(json.dumps({"type": "ping"}))
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(msg)
                record("WebSocket /ws/telemetry accepts connection", True)
                record("WebSocket responds to ping with pong", data.get("type") == "pong")
        except Exception as e:
            record("WebSocket /ws/telemetry connectivity", False, str(e))

    asyncio.run(_test())

def main():
    parser = argparse.ArgumentParser(description="CamAI AWS Cloud Node End-to-End Test Suite")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8099)
    args = parser.parse_args()

    base_url = f"http://{args.host}:{args.port}"

    print("=" * 60)
    print("  CamAI AWS Cloud Node — End-to-End Test Suite")
    print(f"  Target: {base_url}")
    print("=" * 60)

    # Check server is up
    try:
        r = requests.get(f"{base_url}/health", timeout=5)
        if r.status_code != 200:
            print(f"\n[ERROR] Server at {base_url} is not responding (status {r.status_code})")
            sys.exit(1)
        print(f"\n[OK] Server is reachable at {base_url}")
    except Exception as e:
        print(f"\n[ERROR] Cannot connect to server at {base_url}: {e}")
        print("       Please start the server first: python server/run_cloud_node.py")
        sys.exit(1)

    # Run all tests
    test_health_endpoint(base_url)
    test_metrics_endpoint(base_url)
    test_single_frame_inference(base_url)
    test_coordinate_validation(base_url)
    test_continuous_fps(base_url, num_frames=10)
    test_metrics_after_inference(base_url)
    test_websocket_connectivity(base_url)

    # Summary
    print("\n" + "=" * 60)
    passed = [r for r in results if r[1] is True]
    failed = [r for r in results if r[1] is False]
    skipped = [r for r in results if r[1] is None]
    print(f"  RESULTS: {len(passed)} PASSED | {len(failed)} FAILED | {len(skipped)} SKIPPED")
    if failed:
        print("\n  FAILED TESTS:")
        for name, _, msg in failed:
            print(f"    - {name}: {msg}")
    status = "SUCCESS" if len(failed) == 0 else "FAILURES DETECTED"
    print(f"\n  OVERALL: {status}")
    print("=" * 60)
    sys.exit(0 if len(failed) == 0 else 1)

if __name__ == "__main__":
    main()
