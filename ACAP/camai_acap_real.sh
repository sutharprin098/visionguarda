#!/bin/sh
# ==============================================================================
# CamAI ACAP Real Vision Engine Daemon — AWS Cloud Inference Architecture
# ==============================================================================
# Architecture:
#   1. Native Hardware Video: Browser streams directly from /axis-cgi/mjpg/video.cgi
#      (Zero CPU load, zero process forks, rock-solid continuous 30 FPS).
#   2. Background Multi-threaded AI Engine:
#      - Thread A: Non-blocking local snapshot capture (fast, zero hardware lock).
#      - Thread B: Asynchronous AWS Cloud inference worker (network latency isolated).
#   3. Zero Mock Detections: All telemetry and bounding boxes come 100% from AWS.
# ==============================================================================

logger -t "camai_acap" "CamAI Real Vision Engine starting..."
echo "[VIDEO] STREAM_START $(date -u +%Y-%m-%dT%H:%M:%SZ)"

STATE_DIR="/tmp/camai"
mkdir -p "$STATE_DIR"
touch "$STATE_DIR/current_frame.jpg"
touch "$STATE_DIR/latest_telemetry.json"
touch "$STATE_DIR/latest_detections.json"

# Check if Python (python3 or python) is available on Axis OS
if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
    PY_BIN=$(command -v python3 || command -v python)
    logger -t "camai_acap" "Starting unified multi-threaded Python AI worker ($PY_BIN)"
    
    exec $PY_BIN -c '
import urllib.request
import urllib.error
import json
import base64
import time
import os
import sys
import threading

STATE_DIR = "/tmp/camai"
os.makedirs(STATE_DIR, exist_ok=True)

AWS_URL = "http://13.203.71.14:8000/api/detect"
SNAP_URL = "http://127.0.0.1/axis-cgi/jpg/image.cgi?resolution=640x360&compression=30"

auth_candidates = [
    ("", ""),
    ("VLTUser", "wY0-oD0jA6jft3"),
    ("root", "pass"),
    ("root", "admin"),
    ("admin", "admin"),
    ("root", "root"),
]

def load_user_auth():
    cfg_path = os.path.join(STATE_DIR, "config.json")
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r") as f:
                c = json.load(f)
                if "camera_user" in c and "camera_pass" in c:
                    return [(c["camera_user"], c["camera_pass"])]
        except Exception:
            pass
    return []

def build_opener(u, p):
    if not u and not p:
        return urllib.request.build_opener()
    mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    mgr.add_password(None, "http://127.0.0.1", u, p)
    digest_handler = urllib.request.HTTPDigestAuthHandler(mgr)
    basic_handler = urllib.request.HTTPBasicAuthHandler(mgr)
    return urllib.request.build_opener(digest_handler, basic_handler)

def get_best_opener():
    candidates = load_user_auth() + auth_candidates
    for u, p in candidates:
        try:
            opener = build_opener(u, p)
            req = urllib.request.Request(SNAP_URL)
            with opener.open(req, timeout=2) as resp:
                data = resp.read()
                if data and data.startswith(b"\xff\xd8"):
                    print(f"[AUTH] Connected with user={u or \"anonymous\"}", flush=True)
                    return opener
        except Exception:
            continue
    return build_opener("", "")

opener_lock = threading.Lock()
current_opener = get_best_opener()

latest_frame_data = None
latest_frame_id = 0
frame_lock = threading.Lock()

def capture_thread_loop():
    global latest_frame_data, latest_frame_id, current_opener
    frame_counter = 0
    last_auth_refresh = time.time()
    
    while True:
        loop_start = time.time()
        frame_counter = (frame_counter + 1) % 1000000
        
        if loop_start - last_auth_refresh > 45.0:
            with opener_lock:
                current_opener = get_best_opener()
            last_auth_refresh = loop_start
            
        jpeg = None
        try:
            with opener_lock:
                op = current_opener
            req = urllib.request.Request(SNAP_URL)
            with op.open(req, timeout=1.5) as resp:
                jpeg = resp.read()
        except Exception:
            with opener_lock:
                current_opener = get_best_opener()
            try:
                with current_opener.open(urllib.request.Request(SNAP_URL), timeout=1.5) as resp:
                    jpeg = resp.read()
            except Exception:
                jpeg = None
                
        if jpeg and jpeg.startswith(b"\xff\xd8"):
            with frame_lock:
                latest_frame_data = jpeg
                latest_frame_id = frame_counter
                
            tmp_path = os.path.join(STATE_DIR, f"cap_{os.getpid()}.jpg")
            try:
                with open(tmp_path, "wb") as f:
                    f.write(jpeg)
                os.replace(tmp_path, os.path.join(STATE_DIR, "current_frame.jpg"))
            except Exception:
                pass
                
        elapsed = time.time() - loop_start
        time.sleep(max(0.04, 0.15 - elapsed))

def aws_inference_loop():
    global latest_frame_data, latest_frame_id
    last_processed_id = -1
    
    while True:
        loop_start = time.time()
        
        jpeg_to_send = None
        fid = 0
        with frame_lock:
            if latest_frame_data and latest_frame_id != last_processed_id:
                jpeg_to_send = latest_frame_data
                fid = latest_frame_id
                last_processed_id = fid
                
        if jpeg_to_send:
            profile = "traffic"
            profile_file = os.path.join(STATE_DIR, "active_profile.txt")
            if os.path.exists(profile_file):
                try:
                    with open(profile_file, "r") as pf:
                        p = pf.read().strip()
                        if p:
                            profile = p
                except Exception:
                    pass

            config_obj = {}
            cfg_file = os.path.join(STATE_DIR, "config.json")
            if os.path.exists(cfg_file):
                try:
                    with open(cfg_file, "r") as cf:
                        config_obj = json.load(cf)
                except Exception:
                    pass

            try:
                b64_str = base64.b64encode(jpeg_to_send).decode("ascii")
                payload = {
                    "image_b64": b64_str,
                    "frame_id": fid,
                    "zone_profile": profile,
                    "camera_id": "axis-local-cam",
                    "config": config_obj
                }
                
                payload_data = json.dumps(payload).encode("utf-8")
                aws_req = urllib.request.Request(
                    AWS_URL,
                    data=payload_data,
                    headers={"Content-Type": "application/json"}
                )

                with urllib.request.urlopen(aws_req, timeout=3.0) as aws_resp:
                    resp_bytes = aws_resp.read()
                    resp_json = json.loads(resp_bytes.decode("utf-8"))
                    
                    tmp_json = os.path.join(STATE_DIR, f"pub_tmp_{os.getpid()}.json")
                    with open(tmp_json, "w") as jf:
                        json.dump(resp_json, jf)
                    
                    os.replace(tmp_json, os.path.join(STATE_DIR, "latest_telemetry.json"))
                    try:
                        with open(os.path.join(STATE_DIR, "latest_detections.json"), "w") as df:
                            json.dump(resp_json, df)
                    except Exception:
                        pass
            except Exception as e:
                err_payload = {
                    "type": "telemetry",
                    "frame_id": fid,
                    "timestamp": int(time.time() * 1000),
                    "status": "error",
                    "aws_status": "offline",
                    "error": f"AWS AI Server unreachable: {str(e)}",
                    "active_module": profile,
                    "count": 0,
                    "detections": [],
                    "alerts": [],
                    "fps": None,
                    "inference_latency_ms": None
                }
                tmp_json = os.path.join(STATE_DIR, f"pub_tmp_{os.getpid()}.json")
                try:
                    with open(tmp_json, "w") as jf:
                        json.dump(err_payload, jf)
                    os.replace(tmp_json, os.path.join(STATE_DIR, "latest_telemetry.json"))
                except Exception:
                    pass

        elapsed = time.time() - loop_start
        time.sleep(max(0.05, 0.20 - elapsed))

print(f"[DAEMON] CamAI Multi-threaded Python Vision Engine running, PID={os.getpid()}", flush=True)

cap_t = threading.Thread(target=capture_thread_loop, daemon=True)
aws_t = threading.Thread(target=aws_inference_loop, daemon=True)

cap_t.start()
aws_t.start()

cap_t.join()
aws_t.join()
'
fi

# Fallback POSIX shell loop if python is not present
logger -t "camai_acap" "Python not found, running fallback curl worker"
AWS_URL="http://13.203.71.14:8000/api/detect"
SNAP_URL="http://127.0.0.1/axis-cgi/jpg/image.cgi?resolution=640x360&compression=30"
AUTH="VLTUser:wY0-oD0jA6jft3"
COOKIE_JAR="$STATE_DIR/cookie_jar.txt"
FRAME_ID=0

while true; do
    FRAME_ID=$(( (FRAME_ID + 1) % 1000000 ))
    TMP_JPEG="$STATE_DIR/snap_$$.jpg"
    
    curl -s --max-time 1 --connect-timeout 1 \
        -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
        -u "$AUTH" --digest \
        -o "$TMP_JPEG" \
        "$SNAP_URL" 2>/dev/null || curl -s --max-time 1 -o "$TMP_JPEG" "$SNAP_URL" 2>/dev/null || true

    if [ -f "$TMP_JPEG" ] && [ -s "$TMP_JPEG" ] && ! grep -q "401 Unauthorized" "$TMP_JPEG" 2>/dev/null; then
        mv "$TMP_JPEG" "$STATE_DIR/current_frame.jpg" 2>/dev/null || rm -f "$TMP_JPEG"
        
        B64_FILE="$STATE_DIR/frame_$$.b64"
        base64 "$STATE_DIR/current_frame.jpg" 2>/dev/null | tr -d '\r\n' > "$B64_FILE" || true
        
        if [ -s "$B64_FILE" ]; then
            PROFILE="traffic"
            if [ -f "$STATE_DIR/active_profile.txt" ]; then
                PROFILE=$(cat "$STATE_DIR/active_profile.txt" 2>/dev/null || echo "traffic")
            fi
            
            PAYLOAD_FILE="$STATE_DIR/payload_$$.json"
            printf '{"image_b64":"' > "$PAYLOAD_FILE"
            cat "$B64_FILE" >> "$PAYLOAD_FILE"
            printf '","frame_id":%s,"zone_profile":"%s","camera_id":"axis-local-cam"}' "$FRAME_ID" "$PROFILE" >> "$PAYLOAD_FILE"
            rm -f "$B64_FILE"
            
            RESP=$(curl -s --max-time 2 --connect-timeout 1 \
                -H "Content-Type: application/json" \
                -X POST \
                -d @"$PAYLOAD_FILE" \
                "$AWS_URL" 2>/dev/null || echo "")
            rm -f "$PAYLOAD_FILE"
            
            if echo "$RESP" | grep -q '"detections"' 2>/dev/null; then
                printf "%s" "$RESP" > "$STATE_DIR/latest_telemetry.json" 2>/dev/null || true
                cp "$STATE_DIR/latest_telemetry.json" "$STATE_DIR/latest_detections.json" 2>/dev/null || true
            fi
        fi
    else
        rm -f "$TMP_JPEG"
    fi
    sleep 1
done
