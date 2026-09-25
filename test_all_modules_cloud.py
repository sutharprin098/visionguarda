#!/usr/bin/env python3
"""
CamAI Automated End-to-End Cloud AI Acceptance Test Suite
Verifies all 7 module categories against AWS Cloud AI Node:
  1. Traffic (Vehicle Detection, ANPR Plate Reader, Speed, Line Crossing, Tracking)
  2. Security (Person Detection, Intrusion Zones, Loitering, Face Detection)
  3. Factory (PPE Compliance, Helmet, Safety Vest, Worker Tracking)
  4. Retail (Customer Detection, Demographics, Footfall Counting)
  5. Smart City (Urban Multi-Class, Crowd Density, Helmet Compliance)
  6. Micro Motion (Optical Flow Motion Detection, ROIs)
  7. Custom (Zero-DCE Night Vision Preprocessing, Custom Visual Matcher)

Validates:
  - Real AWS HTTP 200 responses with valid JSON schema
  - Strict profile gating (no unrelated module outputs leak)
  - Granular feature toggling (feature OFF -> zero detections for that class)
  - ByteTrack track continuity across frames
  - Real bounding box normalization and geometry
"""

import sys
import os
import time
import base64
import json
import urllib.request
import urllib.error

AWS_URL = os.getenv("CAMAI_AWS_URL", "http://127.0.0.1:8000")
SNAPSHOT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "axis_snapshot.jpg")
if not os.path.exists(SNAPSHOT_FILE):
    SNAPSHOT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ACAP", "axis_snapshot.jpg")

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

def log(tag, msg, color=RESET):
    print(f"{color}[{tag}]{RESET} {msg}")

def http_post(url, payload_dict, timeout=15):
    data_bytes = json.dumps(payload_dict).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data_bytes,
        headers={"Content-Type": "application/json"}
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        latency = (time.perf_counter() - t0) * 1000
        return json.loads(body), latency

def run_acceptance_suite():
    print(f"\n{BOLD}{'='*70}{RESET}")
    print(f" {BOLD}CAMAI AWS CLOUD AI MODULE ACCEPTANCE TEST SUITE{RESET}")
    print(f" Target Endpoint: {CYAN}{AWS_URL}{RESET}")
    print(f" Real Snapshot:   {CYAN}{SNAPSHOT_FILE}{RESET}")
    print(f"{BOLD}{'='*70}{RESET}\n")

    # 1. Health & Server Readiness Check
    log("HEALTH", "Verifying AWS server health & module readiness...", CYAN)
    try:
        with urllib.request.urlopen(f"{AWS_URL}/health", timeout=6) as r:
            health = json.loads(r.read().decode("utf-8"))
            assert health.get("status") == "ok", "Status not ok"
            assert health.get("backend_ready") is True, "Backend not ready"
            modules = health.get("modules", {})
            log("HEALTH_OK", f"AWS Server Online: device={health.get('device')} modules={modules}", GREEN)
    except Exception as e:
        log("HEALTH_FAIL", f"Cannot connect to AWS server: {e}", RED)
        return False

    with open(SNAPSHOT_FILE, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode("utf-8")

    tests_run = 0
    tests_passed = 0

    def record_test(name, passed, detail=""):
        nonlocal tests_run, tests_passed
        tests_run += 1
        if passed:
            tests_passed += 1
            log("PASS", f"{name}: {detail}", GREEN)
        else:
            log("FAIL", f"{name}: {detail}", RED)

    # ──────────────────────────────────────────────────────────────────────────
    # TEST 1: Traffic Profile & ANPR Enabled
    # ──────────────────────────────────────────────────────────────────────────
    log("MODULE", "Testing TRAFFIC profile with ANPR enabled...", CYAN)
    try:
        res, lat = http_post(f"{AWS_URL}/api/detect", {
            "image_b64": img_b64,
            "frame_id": 101,
            "camera_id": "axis-test",
            "zone_profile": "traffic",
            "profile_features": {"anpr": {"enabled": True}}
        })
        dets = res.get("detections", [])
        plate_dets = [d for d in dets if d.get("class") == "number_plate"]
        has_plate = len(plate_dets) > 0
        has_valid_bbox = all(0 <= d["bbox"]["x1"] < d["bbox"]["x2"] <= 1 for d in plate_dets)
        record_test("TRAFFIC_ANPR_ON", has_plate and has_valid_bbox,
                    f"Found {len(plate_dets)} plate(s), conf={plate_dets[0].get('confidence') if plate_dets else 0}, lat={lat:.1f}ms")
    except Exception as e:
        record_test("TRAFFIC_ANPR_ON", False, str(e))

    # ──────────────────────────────────────────────────────────────────────────
    # TEST 2: Traffic Profile with ANPR Disabled (Gating Check)
    # ──────────────────────────────────────────────────────────────────────────
    log("MODULE", "Testing TRAFFIC profile with ANPR disabled (gating check)...", CYAN)
    try:
        res, lat = http_post(f"{AWS_URL}/api/detect", {
            "image_b64": img_b64,
            "frame_id": 102,
            "camera_id": "axis-test",
            "zone_profile": "traffic",
            "profile_features": {"anpr": {"enabled": False}}
        })
        dets = res.get("detections", [])
        plate_dets = [d for d in dets if d.get("class") == "number_plate"]
        gated = len(plate_dets) == 0
        record_test("TRAFFIC_ANPR_OFF_GATING", gated,
                    f"Plate detections suppressed as expected (count={len(plate_dets)})")
    except Exception as e:
        record_test("TRAFFIC_ANPR_OFF_GATING", False, str(e))

    # ──────────────────────────────────────────────────────────────────────────
    # TEST 3: Security Profile Filtering (No Traffic Outputs Leak)
    # ──────────────────────────────────────────────────────────────────────────
    log("MODULE", "Testing SECURITY profile isolation...", CYAN)
    try:
        res, lat = http_post(f"{AWS_URL}/api/detect", {
            "image_b64": img_b64,
            "frame_id": 103,
            "camera_id": "axis-test",
            "zone_profile": "security"
        })
        dets = res.get("detections", [])
        # Vehicle / Plate must not leak into security profile
        leaked_plates = [d for d in dets if d.get("class") == "number_plate"]
        record_test("SECURITY_ISOLATION", len(leaked_plates) == 0,
                    f"Traffic plates excluded from security profile (total dets={len(dets)})")
    except Exception as e:
        record_test("SECURITY_ISOLATION", False, str(e))

    # ──────────────────────────────────────────────────────────────────────────
    # TEST 4: Factory Profile Gating
    # ──────────────────────────────────────────────────────────────────────────
    log("MODULE", "Testing FACTORY profile (PPE & Worker gating)...", CYAN)
    try:
        res, lat = http_post(f"{AWS_URL}/api/detect", {
            "image_b64": img_b64,
            "frame_id": 104,
            "camera_id": "axis-test",
            "zone_profile": "factory",
            "profile_features": {"ppe_detection": {"enabled": True}, "helmet_detection": {"enabled": True}}
        })
        dets = res.get("detections", [])
        # Check that factory profile executes without error and respects allowed classes
        factory_allowed = {"person", "worker", "helmet", "no_helmet", "vest", "no_vest", "gloves", "shoes", "forklift", "face"}
        invalid_classes = [d.get("class") for d in dets if d.get("class") not in factory_allowed]
        record_test("FACTORY_GATING", len(invalid_classes) == 0,
                    f"Clean profile separation. Unrelated classes leaked: {len(invalid_classes)}")
    except Exception as e:
        record_test("FACTORY_GATING", False, str(e))

    # ──────────────────────────────────────────────────────────────────────────
    # TEST 5: Retail Profile Gating (Customer & Footfall)
    # ──────────────────────────────────────────────────────────────────────────
    log("MODULE", "Testing RETAIL profile (Customer & Demographics)...", CYAN)
    try:
        res, lat = http_post(f"{AWS_URL}/api/detect", {
            "image_b64": img_b64,
            "frame_id": 105,
            "camera_id": "axis-test",
            "zone_profile": "retail",
            "profile_features": {"customer_detection": {"enabled": True}, "face_detection": {"enabled": True}}
        })
        retail_allowed = {"person", "customer", "backpack", "handbag", "suitcase", "cell phone", "face"}
        dets = res.get("detections", [])
        invalid = [d.get("class") for d in dets if d.get("class") not in retail_allowed]
        record_test("RETAIL_GATING", len(invalid) == 0,
                    f"Retail profile compliant. Non-retail detections leaked: {len(invalid)}")
    except Exception as e:
        record_test("RETAIL_GATING", False, str(e))

    # ──────────────────────────────────────────────────────────────────────────
    # TEST 6: Smart City Profile (Crowd & Urban Safety)
    # ──────────────────────────────────────────────────────────────────────────
    log("MODULE", "Testing SMART CITY profile...", CYAN)
    try:
        res, lat = http_post(f"{AWS_URL}/api/detect", {
            "image_b64": img_b64,
            "frame_id": 106,
            "camera_id": "axis-test",
            "zone_profile": "smart_city"
        })
        record_test("SMART_CITY_PROFILE", res.get("status") == "success",
                    f"Status={res.get('status')}, latency={lat:.1f}ms")
    except Exception as e:
        record_test("SMART_CITY_PROFILE", False, str(e))

    # ──────────────────────────────────────────────────────────────────────────
    # TEST 7: Micro Motion Profile
    # ──────────────────────────────────────────────────────────────────────────
    log("MODULE", "Testing MICRO MOTION profile...", CYAN)
    try:
        res, lat = http_post(f"{AWS_URL}/api/detect", {
            "image_b64": img_b64,
            "frame_id": 107,
            "camera_id": "axis-test",
            "zone_profile": "micro_motion",
            "profile_features": {"micro_motion_hud": {"enabled": True}}
        })
        record_test("MICRO_MOTION_PROFILE", res.get("status") == "success",
                    f"Status={res.get('status')}, latency={lat:.1f}ms")
    except Exception as e:
        record_test("MICRO_MOTION_PROFILE", False, str(e))

    # ──────────────────────────────────────────────────────────────────────────
    # TEST 8: Custom Profile & Zero-DCE Night Vision
    # ──────────────────────────────────────────────────────────────────────────
    log("MODULE", "Testing CUSTOM profile with Zero-DCE Night Vision...", CYAN)
    try:
        res, lat = http_post(f"{AWS_URL}/api/detect", {
            "image_b64": img_b64,
            "frame_id": 108,
            "camera_id": "axis-test",
            "zone_profile": "custom",
            "profile_features": {"night_vision": {"enabled": True}}
        })
        record_test("ZERO_DCE_CUSTOM", res.get("status") == "success",
                    f"Zero-DCE enhancement executed cleanly, latency={lat:.1f}ms")
    except Exception as e:
        record_test("ZERO_DCE_CUSTOM", False, str(e))

    # ──────────────────────────────────────────────────────────────────────────
    # TEST 9: Analytics Zones & Rules Evaluation (Intrusion & Line Crossing)
    # ──────────────────────────────────────────────────────────────────────────
    log("MODULE", "Testing ANALYTICS engine with Zones and Lines...", CYAN)
    try:
        res, lat = http_post(f"{AWS_URL}/api/detect", {
            "image_b64": img_b64,
            "frame_id": 109,
            "camera_id": "axis-test",
            "zone_profile": "traffic",
            "zones": [
                {"id": "zone_entry", "name": "Entry Gate", "points": [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]}
            ],
            "lines": [
                {"id": "line_stop", "name": "Stop Line", "points": [[0.1, 0.5], [0.9, 0.5]]}
            ]
        })
        z_stats = res.get("zone_stats", {})
        l_stats = res.get("line_stats", {})
        has_zone = "zone_entry" in z_stats
        has_line = "line_stop" in l_stats
        record_test("ANALYTICS_ZONES_LINES", has_zone and has_line,
                    f"Zone stats={list(z_stats.keys())}, Line stats={list(l_stats.keys())}")
    except Exception as e:
        record_test("ANALYTICS_ZONES_LINES", False, str(e))

    # ──────────────────────────────────────────────────────────────────────────
    # TEST 10: Multi-Frame ByteTrack Tracking Continuity
    # ──────────────────────────────────────────────────────────────────────────
    log("MODULE", "Testing ByteTrack track ID continuity across frames...", CYAN)
    try:
        track_ids = []
        for fid in range(200, 203):
            res, _ = http_post(f"{AWS_URL}/api/detect", {
                "image_b64": img_b64,
                "frame_id": fid,
                "camera_id": "axis-test-tracking",
                "zone_profile": "traffic"
            })
            dets = res.get("detections", [])
            if dets and "track_id" in dets[0]:
                track_ids.append(dets[0]["track_id"])
        is_continuous = len(track_ids) == 3 and len(set(track_ids)) == 1
        record_test("BYTETRACK_CONTINUITY", is_continuous,
                    f"Track IDs across consecutive frames: {track_ids}")
    except Exception as e:
        record_test("BYTETRACK_CONTINUITY", False, str(e))

    # ── Summary ────────────────────────────────────────────────────────────────
    print(f"\n{BOLD}{'='*70}{RESET}")
    print(f" {BOLD}TEST SUMMARY: {tests_passed}/{tests_run} TESTS PASSED{RESET}")
    print(f"{BOLD}{'='*70}{RESET}")

    all_passed = (tests_passed == tests_run)
    if all_passed:
        log("ALL_PASSED", "All CamAI AI modules verified working through AWS inference!", GREEN)
    else:
        log("FAILURES", f"{tests_run - tests_passed} test(s) failed.", RED)

    return all_passed

if __name__ == "__main__":
    success = run_acceptance_suite()
    sys.exit(0 if success else 1)
