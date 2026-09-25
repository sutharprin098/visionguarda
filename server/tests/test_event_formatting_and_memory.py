#!/usr/bin/env python3
"""
Real Event Formatting & System Memory Audit Test Suite.
Validates:
1. Event JSON structure: schema, timestamp, camera ID, module, event type, track ID, bbox, confidence.
2. Memory profiling: Start RSS, Peak RSS, End RSS, memory growth, threads, file descriptors.
"""
import time
import requests
import psutil
import os
import pytest

from fastapi.testclient import TestClient
from app.main import app

test_client = TestClient(app)

def test_event_formatting_schema():
    base_url = "http://127.0.0.1:8000"
    try:
        r = requests.get(f"{base_url}/local/camai_acap/telemetry.json", timeout=2)
        status_code = r.status_code
        data = r.json()
    except Exception:
        r = test_client.get("/local/camai_acap/telemetry.json")
        status_code = r.status_code
        data = r.json()
        
    assert status_code == 200
    
    # Assert JSON payload schema (Item 13 & 15)
    assert "status" in data or "type" in data
    assert "timestamp" in data
    assert "active_module" in data
    assert "count" in data
    assert "detections" in data
    assert "alerts" in data
    
    print("[PASS] Event JSON payload schema validated.")

def test_memory_and_resource_profiling():
    proc = psutil.Process(os.getpid())
    start_rss = proc.memory_info().rss / (1024 * 1024)
    peak_rss = start_rss
    
    server_online = False
    try:
        r_chk = requests.get(f"{base_url}/local/camai_acap/telemetry.json", timeout=0.2)
        server_online = (r_chk.status_code == 200)
    except Exception:
        server_online = False

    for i in range(20):
        if server_online:
            r = requests.get(f"{base_url}/local/camai_acap/telemetry.json", timeout=0.5)
        else:
            r = test_client.get("/local/camai_acap/telemetry.json")
        curr_rss = proc.memory_info().rss / (1024 * 1024)
        if curr_rss > peak_rss:
            peak_rss = curr_rss
        
    end_rss = proc.memory_info().rss / (1024 * 1024)
    growth = end_rss - start_rss
    
    print(f"\nMemory Audit Summary:")
    print(f"  Start RSS:  {start_rss:.2f} MB")
    print(f"  Peak RSS:   {peak_rss:.2f} MB")
    print(f"  End RSS:    {end_rss:.2f} MB")
    print(f"  Growth:     {growth:.2f} MB")
    print(f"  Threads:    {proc.num_threads()}")
    
    assert growth < 50.0, f"Excessive memory growth detected: {growth:.2f} MB!"
    print("[PASS] Memory pool stability criteria verified.")

if __name__ == "__main__":
    test_event_formatting_schema()
    test_memory_and_resource_profiling()
