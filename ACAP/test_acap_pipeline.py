import requests
import json
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

host = "https://195.60.68.14:42130"
auth = requests.auth.HTTPDigestAuth("VLTuser", "aE6_RJGfguOaao")

endpoints = [
    "/local/camai_acap/detections.json",
    "/local/camai_acap/telemetry.json",
    "/local/camai_acap/detections.cgi",
    "/local/camai_acap/index.html",
]

print("=== TESTING AXIS CAMERA ACAP ENDPOINTS ===")
for ep in endpoints:
    url = host + ep
    try:
        r = requests.get(url, auth=auth, verify=False, timeout=5)
        print(f"\n[+] Testing Endpoint: {ep}")
        print(f"    Status: {r.status_code}")
        print(f"    Content-Type: {r.headers.get('content-type', 'N/A')}")
        if r.status_code == 200:
            if "json" in ep:
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
                    print(f"    JSON Parse Error: {je}")
                    print(f"    Raw text snippet: {r.text[:200]}")
            else:
                print(f"    Response length: {len(r.text)} bytes")
    except Exception as e:
        print(f"[!] Error accessing {ep}: {e}")

print("\n=== PIPELINE TEST COMPLETE ===")
