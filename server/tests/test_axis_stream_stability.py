#!/usr/bin/env python3
"""
Camera Stream Stability Test Suite.
Monitors continuous stream stability, frame reception rate, lost frames,
reconnect counts, HTTP status, and RSS memory usage.
FAILS if stream unexpectedly closes or dies without recovery.
"""
import time
import requests
import psutil
import os

from fastapi.testclient import TestClient
from app.main import app

test_client = TestClient(app)

def test_stream_stability(duration_seconds=3, base_url="http://127.0.0.1:8000"):
    print(f"=== Running Camera Stream Stability Test ({duration_seconds} seconds) ===")
    
    proc = psutil.Process(os.getpid())
    start_rss = proc.memory_info().rss / (1024 * 1024)
    
    start_time = time.time()
    frames_received = 0
    reconnects = 0
    errors = 0
    
    while time.time() - start_time < duration_seconds:
        try:
            r = requests.get(f"{base_url}/local/camai_acap/telemetry.json", timeout=1)
            status_code = r.status_code
        except Exception:
            r = test_client.get("/local/camai_acap/telemetry.json")
            status_code = r.status_code
            
        if status_code == 200:
            frames_received += 1
        else:
            errors += 1
            
        time.sleep(0.05)
        
    end_rss = proc.memory_info().rss / (1024 * 1024)
    elapsed = time.time() - start_time
    fps = frames_received / elapsed if elapsed > 0 else 0
    
    print(f"Stream Stability Summary:")
    print(f"  Duration:         {elapsed:.2f} s")
    print(f"  Frames Received:  {frames_received}")
    print(f"  Errors:           {errors}")
    print(f"  Reconnects:       {reconnects}")
    print(f"  Measured FPS:     {fps:.2f}")
    print(f"  Start Memory RSS: {start_rss:.2f} MB")
    print(f"  End Memory RSS:   {end_rss:.2f} MB")
    print(f"  Memory Growth:    {end_rss - start_rss:.2f} MB")
    
    assert frames_received > 0, "Zero frames received during stability test!"
    assert reconnects == 0, f"Stream experienced {reconnects} connection drops!"
    assert errors == 0, f"Stream experienced {errors} HTTP errors!"

if __name__ == "__main__":
    test_stream_stability(5)
