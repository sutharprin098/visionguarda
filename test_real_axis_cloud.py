#!/usr/bin/env python3
"""
CamAI REAL AXIS → AWS End-to-End Test Script
=============================================

Tests the COMPLETE REAL pipeline:

  Real Axis Camera
      ↓
  REAL JPEG frame (HTTP snapshot API)
      ↓
  AWS /api/detect
      ↓
  REAL MODEL inference (YOLOX)
      ↓
  REAL detection JSON
      ↓
  Validate bbox, class, confidence
      ↓
  FPS + latency measurement
      ↓
  Save debug image with bounding boxes

Usage:
    python test_real_axis_cloud.py \\
        --camera 192.168.1.100 \\
        --camera-user root \\
        --camera-pass <password> \\
        --aws http://13.203.71.14:8000 \\
        --frames 20 \\
        --min-confidence 0.25

Requirements:
    pip install requests opencv-python numpy Pillow

DO NOT put a person in front of the camera yet — first run with
    --frames 1 --no-repeat
to verify connectivity, then add a person and run again.
"""

import sys
import os
import time
import base64
import json
import math
import argparse
import struct
from collections import deque
from datetime import datetime

try:
    import requests
except ImportError:
    print("[ERROR] requests not installed: pip install requests")
    sys.exit(1)

try:
    import cv2
    import numpy as np
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False
    print("[WARN] opencv-python not installed — debug image saving disabled")

# ── ANSI colors ───────────────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
BLUE   = "\033[94m"
RESET  = "\033[0m"
BOLD   = "\033[1m"


def log(tag, msg, color=RESET):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{ts}] {color}{tag}{RESET} {msg}")


def PASS(msg): log("PASS", msg, GREEN)
def FAIL(msg): log("FAIL", msg, RED)
def INFO(msg): log("INFO", msg, BLUE)
def WARN(msg): log("WARN", msg, YELLOW)


def capture_axis_jpeg(camera_ip, username, password, timeout=5):
    """
    Capture a REAL JPEG frame from the Axis camera's snapshot HTTP API.
    Returns (jpeg_bytes, width, height) or raises on error.
    """
    # Primary: full resolution 1080p
    for resolution in ["1920x1080", "1280x720", "640x480"]:
        url = f"http://{camera_ip}/axis-cgi/jpg/image.cgi?resolution={resolution}&compression=30"
        try:
            r = requests.get(
                url,
                auth=(username, password),
                timeout=timeout,
                stream=True
            )
            if r.status_code == 200 and len(r.content) > 1000:
                jpeg_bytes = r.content
                
                # Decode to verify and get dimensions
                if HAS_CV2:
                    np_arr = np.frombuffer(jpeg_bytes, np.uint8)
                    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                    if frame is not None:
                        h, w = frame.shape[:2]
                        return jpeg_bytes, w, h, frame
                else:
                    # Try to read JPEG dimensions from header
                    w, h = read_jpeg_dimensions(jpeg_bytes)
                    return jpeg_bytes, w, h, None
                    
        except requests.exceptions.ConnectionError:
            raise ConnectionError(f"Cannot connect to camera at {camera_ip}")
        except requests.exceptions.Timeout:
            raise TimeoutError(f"Camera {camera_ip} did not respond within {timeout}s")
        except Exception as e:
            WARN(f"Snapshot at {resolution} failed: {e}")
    
    raise RuntimeError("All resolutions failed — camera snapshot unavailable")


def read_jpeg_dimensions(jpeg_bytes):
    """Extract width/height from JPEG SOF marker without OpenCV."""
    try:
        i = 0
        while i < len(jpeg_bytes) - 4:
            while i < len(jpeg_bytes) and jpeg_bytes[i] != 0xFF:
                i += 1
            while i < len(jpeg_bytes) and jpeg_bytes[i] == 0xFF:
                i += 1
            if i >= len(jpeg_bytes):
                break
            marker = jpeg_bytes[i]
            i += 1
            if marker in (0xC0, 0xC1, 0xC2, 0xC3):  # SOF markers
                length, = struct.unpack('>H', jpeg_bytes[i:i+2])
                precision = jpeg_bytes[i+2]
                height, = struct.unpack('>H', jpeg_bytes[i+3:i+5])
                width,  = struct.unpack('>H', jpeg_bytes[i+5:i+7])
                return width, height
            else:
                if i + 2 <= len(jpeg_bytes):
                    length, = struct.unpack('>H', jpeg_bytes[i:i+2])
                    i += length
    except Exception:
        pass
    return 0, 0


def send_to_aws(aws_url, jpeg_bytes, frame_id, timestamp_ms, timeout=15):
    """
    POST the JPEG to AWS /api/detect.
    Returns (response_json, latency_ms) or raises on error.
    """
    # Base64-encode the JPEG
    image_b64 = base64.b64encode(jpeg_bytes).decode('utf-8')
    
    payload = {
        "image_b64": image_b64,
        "frame_id": frame_id,
        "timestamp_ms": timestamp_ms
    }
    
    url = aws_url.rstrip('/') + '/api/detect'
    t_start = time.perf_counter()
    
    r = requests.post(
        url,
        json=payload,
        timeout=timeout,
        headers={"Content-Type": "application/json"}
    )
    
    latency_ms = round((time.perf_counter() - t_start) * 1000, 1)
    
    if r.status_code != 200:
        raise RuntimeError(f"AWS returned HTTP {r.status_code}: {r.text[:200]}")
    
    try:
        data = r.json()
    except Exception:
        raise RuntimeError(f"AWS response is not valid JSON: {r.text[:200]}")
    
    return data, latency_ms


def validate_detection(d, frame_w, frame_h):
    """Validate a single detection from the AWS response. Returns list of issues."""
    issues = []
    
    # class
    if not d.get('class'):
        issues.append("missing 'class' field")
    
    # confidence
    conf = d.get('confidence', None)
    if conf is None:
        issues.append("missing 'confidence'")
    elif not isinstance(conf, (int, float)) or conf < 0 or conf > 1.0:
        issues.append(f"invalid confidence: {conf}")
    
    # bbox
    bbox = d.get('bbox', {})
    if not bbox:
        issues.append("missing 'bbox'")
    else:
        x1, y1, x2, y2 = bbox.get('x1', None), bbox.get('y1', None), bbox.get('x2', None), bbox.get('y2', None)
        for name, v in [('x1', x1), ('y1', y1), ('x2', x2), ('y2', y2)]:
            if v is None:
                issues.append(f"bbox missing '{name}'")
            elif math.isnan(v) or math.isinf(v):
                issues.append(f"bbox {name} is NaN/Inf")
            elif not (0.0 <= v <= 1.0):
                issues.append(f"bbox {name}={v} out of [0,1] range")
        if x1 is not None and x2 is not None and x2 <= x1:
            issues.append(f"bbox inverted: x2({x2}) <= x1({x1})")
        if y1 is not None and y2 is not None and y2 <= y1:
            issues.append(f"bbox inverted: y2({y2}) <= y1({y1})")
    
    return issues


def draw_detections(frame, detections, frame_w, frame_h):
    """Draw bounding boxes on the frame. Returns annotated frame."""
    if not HAS_CV2 or frame is None:
        return frame
    
    annotated = frame.copy()
    
    COLORS = {
        'person': (0, 255, 0),
        'car': (255, 128, 0),
        'truck': (255, 0, 0),
        'bus': (0, 128, 255),
        'motorcycle': (255, 0, 255),
    }
    DEFAULT_COLOR = (0, 200, 255)
    
    for d in detections:
        cls = d.get('class', 'object')
        conf = d.get('confidence', 0.0)
        track_id = d.get('track_id', None)
        bbox = d.get('bbox', {})
        
        x1 = int(bbox.get('x1', 0) * frame_w)
        y1 = int(bbox.get('y1', 0) * frame_h)
        x2 = int(bbox.get('x2', 1) * frame_w)
        y2 = int(bbox.get('y2', 1) * frame_h)
        
        color = COLORS.get(cls.lower(), DEFAULT_COLOR)
        
        # Draw box
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
        
        # Label
        label = f"{cls} {conf:.2f}"
        if track_id is not None:
            label += f" #{track_id}"
        
        # Label background
        (label_w, label_h), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        cv2.rectangle(annotated, (x1, y1 - label_h - 10), (x1 + label_w, y1), color, -1)
        cv2.putText(annotated, label, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    
    return annotated


def run_single_test(camera_ip, username, password, aws_url, frame_id, save_debug=True, debug_dir="."):
    """
    Run a single end-to-end test cycle.
    Returns dict with results.
    """
    result = {
        'frame_id': frame_id,
        'camera_ok': False,
        'aws_ok': False,
        'detections': [],
        'latency_ms': None,
        'width': 0,
        'height': 0,
        'error': None
    }
    
    # Step 1: Capture JPEG
    try:
        t_capture = time.time()
        jpeg_bytes, width, height, cv_frame = capture_axis_jpeg(camera_ip, username, password)
        capture_ms = round((time.time() - t_capture) * 1000, 1)
        
        result['camera_ok'] = True
        result['width'] = width
        result['height'] = height
        result['jpeg_size'] = len(jpeg_bytes)
        
        log("FRAME_RECEIVED", f"{frame_id} size={len(jpeg_bytes)}B resolution={width}x{height} capture={capture_ms}ms", GREEN)
        
    except Exception as e:
        result['error'] = f"Camera capture failed: {e}"
        FAIL(f"Camera capture: {e}")
        return result
    
    # Step 2: Send to AWS
    try:
        timestamp_ms = int(time.time() * 1000)
        log("AWS_REQUEST", f"{frame_id} payload_size={len(jpeg_bytes)}B → {aws_url}/api/detect", BLUE)
        
        response, latency_ms = send_to_aws(aws_url, jpeg_bytes, frame_id, timestamp_ms)
        
        result['aws_ok'] = True
        result['latency_ms'] = latency_ms
        result['aws_status'] = response.get('status')
        result['dimensions'] = response.get('dimensions', {})
        
        log("AWS_RESPONSE", f"{frame_id} latency={latency_ms}ms status={response.get('status')}", GREEN)
        
    except Exception as e:
        result['error'] = f"AWS inference failed: {e}"
        FAIL(f"AWS: {e}")
        return result
    
    # Step 3: Parse detections
    raw_dets = response.get('detections', [])
    dims = response.get('dimensions', {})
    resp_w = dims.get('width', width)
    resp_h = dims.get('height', height)
    
    log("AWS_RESPONSE", f"{frame_id} detections={len(raw_dets)}", GREEN if raw_dets else YELLOW)
    
    valid_dets = []
    for i, d in enumerate(raw_dets):
        issues = validate_detection(d, resp_w, resp_h)
        if issues:
            WARN(f"Detection #{i} has issues: {issues}")
            continue
        
        cls = d.get('class', 'object')
        conf = d.get('confidence', 0.0)
        bbox = d.get('bbox', {})
        track_id = d.get('track_id', None)
        
        log("DETECTION",
            f"{cls.upper()} conf={conf:.3f} "
            f"bbox=[{bbox.get('x1',0):.3f},{bbox.get('y1',0):.3f},{bbox.get('x2',0):.3f},{bbox.get('y2',0):.3f}] "
            f"track_id={track_id}",
            GREEN)
        
        valid_dets.append(d)
    
    result['detections'] = valid_dets
    
    # Step 4: Draw debug image
    if save_debug and HAS_CV2 and cv_frame is not None:
        annotated = draw_detections(cv_frame, valid_dets, width, height)
        debug_path = os.path.join(debug_dir, f"debug_frame_{frame_id:04d}.jpg")
        cv2.imwrite(debug_path, annotated, [cv2.IMWRITE_JPEG_QUALITY, 90])
        log("DEBUG_IMAGE", f"Saved: {debug_path}", BLUE)
        result['debug_image'] = debug_path
    
    return result


def run_continuous_test(
    camera_ip, username, password, aws_url,
    num_frames=20, min_confidence=0.25,
    save_debug=True, debug_dir="."
):
    """
    Run continuous end-to-end test.
    """
    print(f"\n{'='*60}")
    print(f"  {BOLD}CAMAI REAL AXIS → AWS TEST{RESET}")
    print(f"{'='*60}")
    print(f"  Camera:     {camera_ip}")
    print(f"  AWS:        {aws_url}/api/detect")
    print(f"  Frames:     {num_frames}")
    print(f"  Min conf:   {min_confidence}")
    print(f"  Debug dir:  {debug_dir}")
    print(f"{'='*60}\n")
    
    os.makedirs(debug_dir, exist_ok=True)
    
    # Check camera connectivity
    INFO(f"Testing camera connectivity at {camera_ip}...")
    try:
        r = requests.get(f"http://{camera_ip}/axis-cgi/jpg/image.cgi?resolution=640x480",
                        auth=(username, password), timeout=5)
        if r.status_code == 200 and len(r.content) > 100:
            PASS(f"Camera CONNECTED — snapshot size={len(r.content)}B")
        else:
            FAIL(f"Camera returned HTTP {r.status_code}")
            sys.exit(1)
    except Exception as e:
        FAIL(f"Cannot connect to camera: {e}")
        sys.exit(1)
    
    # Check AWS connectivity
    INFO(f"Testing AWS connectivity at {aws_url}...")
    try:
        r = requests.get(f"{aws_url}/health", timeout=5)
        if r.status_code == 200:
            data = r.json()
            PASS(f"AWS CONNECTED — backend_ready={data.get('backend_ready')} device={data.get('device','?')}")
        else:
            WARN(f"AWS /health returned HTTP {r.status_code} — will still try inference")
    except Exception as e:
        WARN(f"AWS /health failed: {e} — will still try inference")
    
    # Run frames
    latencies = deque(maxlen=30)
    frame_timestamps = deque(maxlen=30)
    total_detections = 0
    class_counts = {}
    frame_success = 0
    
    print(f"\n--- Starting {num_frames} frame test ---\n")
    
    for frame_id in range(1, num_frames + 1):
        t_frame_start = time.time()
        
        result = run_single_test(
            camera_ip, username, password, aws_url,
            frame_id, save_debug=save_debug, debug_dir=debug_dir
        )
        
        if result['aws_ok'] and result['latency_ms'] is not None:
            latencies.append(result['latency_ms'])
            frame_timestamps.append(time.time())
            frame_success += 1
        
        for d in result['detections']:
            cls = d.get('class', 'object')
            conf = d.get('confidence', 0.0)
            if conf >= min_confidence:
                total_detections += 1
                class_counts[cls] = class_counts.get(cls, 0) + 1
        
        # Calculate real FPS
        if len(frame_timestamps) > 1:
            dt = frame_timestamps[-1] - frame_timestamps[0]
            fps = round((len(frame_timestamps) - 1) / max(0.001, dt), 1)
        else:
            fps = 0.0
        
        avg_latency = round(sum(latencies) / max(1, len(latencies)), 1) if latencies else 0.0
        
        print(f"  Frame {frame_id:3d}/{num_frames}  "
              f"camera={'OK' if result['camera_ok'] else 'FAIL'}  "
              f"aws={'OK' if result['aws_ok'] else 'FAIL'}  "
              f"detections={len(result['detections'])}  "
              f"latency={result.get('latency_ms', '?')}ms  "
              f"fps={fps}")
        
        if result.get('error'):
            FAIL(f"  Error: {result['error']}")
        
        # Brief pause between frames
        elapsed = time.time() - t_frame_start
        if elapsed < 0.5:
            time.sleep(0.5 - elapsed)
    
    # Summary
    print(f"\n{'='*60}")
    print(f"  {BOLD}RESULTS SUMMARY{RESET}")
    print(f"{'='*60}")
    
    if len(frame_timestamps) > 1:
        dt = frame_timestamps[-1] - frame_timestamps[0]
        final_fps = round((len(frame_timestamps) - 1) / max(0.001, dt), 1)
    else:
        final_fps = 0.0
    
    avg_lat = round(sum(latencies) / max(1, len(latencies)), 1) if latencies else 0
    sorted_lat = sorted(latencies)
    p95_lat = sorted_lat[int(len(sorted_lat) * 0.95)] if sorted_lat else 0
    
    print(f"  Camera:          CONNECTED")
    print(f"  Resolution:      {result.get('width', '?')}x{result.get('height', '?')}")
    print(f"")
    print(f"  Frames sent:     {num_frames}")
    print(f"  Frames success:  {frame_success}")
    print(f"  Cloud FPS:       {final_fps}")
    print(f"  Average latency: {avg_lat}ms")
    print(f"  P95 latency:     {p95_lat}ms")
    print(f"")
    print(f"  Total detections: {total_detections}")
    
    if class_counts:
        print(f"  Classes detected:")
        for cls, count in sorted(class_counts.items(), key=lambda x: -x[1]):
            print(f"    {cls:20s} {count}")
    else:
        print(f"  {YELLOW}No detections! Ensure a person/vehicle is in frame.{RESET}")
        print(f"  If camera and AWS are both OK but no detections:")
        print(f"    1. Put a PERSON clearly in front of the camera")
        print(f"    2. Check AWS model: expected YOLOX-tiny (COCO-80)")
        print(f"    3. Lower confidence: --min-confidence 0.10")
    
    # Pass/Fail
    print(f"\n{'='*60}")
    passed = frame_success == num_frames and total_detections > 0
    if frame_success == num_frames:
        PASS(f"All {num_frames} frames reached AWS successfully")
    else:
        FAIL(f"Only {frame_success}/{num_frames} frames reached AWS")
    
    if total_detections > 0:
        PASS(f"Real detections returned: {total_detections}")
    else:
        FAIL("Zero detections — put a person in front of the camera and re-run")
    
    status = f"{GREEN}PASS{RESET}" if passed else f"{RED}FAIL{RESET}"
    print(f"\n  OVERALL: {status}")
    print(f"{'='*60}\n")
    
    return passed


def main():
    parser = argparse.ArgumentParser(description="CamAI Real Axis → AWS End-to-End Test")
    parser.add_argument("--camera", default="192.168.1.100",
                       help="Axis camera IP address")
    parser.add_argument("--camera-user", default="root",
                       help="Camera username")
    parser.add_argument("--camera-pass", default="",
                       help="Camera password")
    parser.add_argument("--aws", default="http://13.203.71.14:8000",
                       help="AWS cloud node base URL")
    parser.add_argument("--frames", type=int, default=20,
                       help="Number of frames to test (default: 20)")
    parser.add_argument("--min-confidence", type=float, default=0.25,
                       help="Minimum confidence for detection counting")
    parser.add_argument("--no-debug", action="store_true",
                       help="Skip saving debug images")
    parser.add_argument("--debug-dir", default="camai_debug",
                       help="Directory to save debug images")
    parser.add_argument("--single", action="store_true",
                       help="Run single frame test only")
    args = parser.parse_args()
    
    if args.single:
        args.frames = 1
    
    success = run_continuous_test(
        camera_ip=args.camera,
        username=args.camera_user,
        password=args.camera_pass,
        aws_url=args.aws,
        num_frames=args.frames,
        min_confidence=args.min_confidence,
        save_debug=not args.no_debug,
        debug_dir=args.debug_dir
    )
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
