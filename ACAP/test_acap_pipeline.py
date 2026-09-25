import sys
import requests
import json
import base64
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

host = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
auth = requests.auth.HTTPDigestAuth("VLTuser", "aE6_RJGfguOaao")

endpoints = [
    "/local/camai_acap/detections.json",
    "/local/camai_acap/telemetry.json",
    "/local/camai_acap/detections.cgi",
    "/local/camai_acap/telemetry.cgi",
    "/local/camai_acap/index.html",
]

print(f"=== TESTING AXIS CAMERA ACAP ENDPOINTS ({host}) ===")
for ep in endpoints:
    url = host + ep
    try:
        r = requests.get(url, auth=auth, verify=False, timeout=5)
        if r.status_code == 401 or r.status_code == 404:
            # Fallback without digest auth if 401/404
            r = requests.get(url, verify=False, timeout=5)
        print(f"\n[+] Testing Endpoint: {ep}")
        print(f"    Status: {r.status_code}")
        print(f"    Content-Type: {r.headers.get('content-type', 'N/A')}")
        if r.status_code == 200:
            if "json" in ep or "cgi" in ep:
                try:
                    data = r.json()
                    print(f"    JSON Parsed Successfully:")
                    print(f"    - type: {data.get('type')}")
                    print(f"    - frame_id: {data.get('frame_id')}")
                    print(f"    - fps: {data.get('fps')}")
                    print(f"    - input_fps: {data.get('input_fps')}")
                    print(f"    - ai_fps: {data.get('ai_fps')}")
                    print(f"    - latency: {data.get('inference_latency_ms')} ms")
                    print(f"    - active_module: {data.get('active_module')}")
                    print(f"    - detections count: {len(data.get('detections', []))}")
                    if data.get('detections'):
                        print(f"    - sample detection: {data['detections'][0]}")
                except Exception as je:
                    print(f"    Raw text snippet: {r.text[:200]}")
            else:
                print(f"    Response length: {len(r.text)} bytes")
    except Exception as e:
        print(f"[!] Error accessing {ep}: {e}")

# Test POST /api/detect
print("\n[+] Testing POST /api/detect Endpoint")
try:
    dummy_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    r = requests.post(f"{host}/api/detect", json={"image_b64": dummy_b64, "frame_id": 1, "zone_profile": "security"}, timeout=5)
    print(f"    Status: {r.status_code}")
    if r.status_code == 200:
        print(f"    Response: {r.json()}")
except Exception as e:
    print(f"[!] POST /api/detect error: {e}")

print("\n=== PIPELINE TEST COMPLETE ===")

