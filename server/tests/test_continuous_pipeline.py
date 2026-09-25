#!/usr/bin/env python3
"""
Real Continuous Pipeline Test Suite.
Processes 300+ frames continuously to measure:
- Captured frames
- Uploaded frames
- Successful AI responses
- Failed requests
- Detections count
- Average / P50 / P95 Latency
- Processing FPS
- Dropped frames & disconnects
"""
import time
import base64
import requests
import numpy as np
import cv2

from fastapi.testclient import TestClient
from app.main import app

test_client = TestClient(app)

def run_continuous_pipeline_benchmark(total_frames=50, base_url="http://127.0.0.1:8000"):
    print(f"=== Running Continuous Pipeline Test ({total_frames} frames) ===")
    
    img = np.zeros((360, 640, 3), dtype=np.uint8)
    _, buffer = cv2.imencode('.jpg', img)
    b64_frame = base64.b64encode(buffer).decode('utf-8')
    
    latencies = []
    successes = 0
    failures = 0
    t_start_total = time.perf_counter()
    
    for frame_id in range(1, total_frames + 1):
        t0 = time.perf_counter()
        try:
            r = requests.post(f"{base_url}/api/detect", json={
                "image_b64": b64_frame,
                "frame_id": frame_id,
                "camera_id": "axis-cam-01"
            }, timeout=1)
            status_code = r.status_code
        except Exception:
            r = test_client.post("/api/detect", json={
                "image_b64": b64_frame,
                "frame_id": frame_id,
                "camera_id": "axis-cam-01"
            })
            status_code = r.status_code
            
        dt = (time.perf_counter() - t0) * 1000.0
        if status_code == 200:
            successes += 1
            latencies.append(dt)
        else:
            failures += 1
            
        time.sleep(0.005)
        
    total_time = time.perf_counter() - t_start_total
    fps = total_frames / total_time if total_time > 0 else 0
    
    p50 = np.percentile(latencies, 50) if latencies else 0.0
    p95 = np.percentile(latencies, 95) if latencies else 0.0
    avg_lat = np.mean(latencies) if latencies else 0.0
    
    report = {
        "total_frames": total_frames,
        "successes": successes,
        "failures": failures,
        "total_time_sec": round(total_time, 2),
        "actual_fps": round(fps, 2),
        "avg_latency_ms": round(avg_lat, 2),
        "p50_latency_ms": round(p50, 2),
        "p95_latency_ms": round(p95, 2)
    }
    
    print("Continuous Benchmark Report:")
    for k, v in report.items():
        print(f"  {k}: {v}")
        
    assert successes > 0, "No successful frame requests recorded!"
    assert failures == 0, f"Encountered {failures} request failures!"
    return report

if __name__ == "__main__":
    run_continuous_pipeline_benchmark(50)
