#!/bin/sh
# CamAI ACAP Real Vision Engine Daemon — AWS Cloud Inference Architecture
# =======================================================================
# Architecture:
#   Camera Capture Loop (Task 1) -> Frame Buffer (/tmp/camai/current_frame.jpg)
#         ↓
#         ├── Live Video (Independent, unblocked by AWS)
#         └── AWS Worker Loop (Task 2)
#
# If AWS times out/errors, Live Camera CONTINUES uninterrupted.

logger -t "camai_acap" "CamAI Real Vision Engine starting..."

STATE_DIR="/tmp/camai"
mkdir -p "$STATE_DIR"

AWS_URL="http://13.203.71.14:8000/api/detect"
AUTH="VLTUser:wY0-oD0jA6jft3"
COOKIE_JAR="$STATE_DIR/cookie_jar.txt"
SNAP_URL="http://127.0.0.1/axis-cgi/jpg/image.cgi?resolution=800x450&compression=40"

# Portable subsecond sleep mechanism for Axis OS / BusyBox Linux
if command -v usleep >/dev/null 2>&1; then
    SLEEP_MODE="usleep"
elif python3 -c 'import time' >/dev/null 2>&1; then
    SLEEP_MODE="python3"
elif python -c 'import time' >/dev/null 2>&1; then
    SLEEP_MODE="python"
else
    SLEEP_MODE="integer"
fi

msleep() {
    MS="$1"
    [ -z "$MS" ] && return
    case "$SLEEP_MODE" in
        usleep)
            usleep $(( MS * 1000 )) 2>/dev/null || sleep 1
            ;;
        python3)
            python3 -c "import time; time.sleep($MS/1000.0)" 2>/dev/null || sleep 1
            ;;
        python)
            python -c "import time; time.sleep($MS/1000.0)" 2>/dev/null || sleep 1
            ;;
        *)
            IS=$(( (MS + 999) / 1000 ))
            [ "$IS" -lt 1 ] && IS=1
            sleep "$IS" 2>/dev/null || true
            ;;
    esac
}

publish() {
    CONTENT="$1"
    [ -z "$CONTENT" ] && return
    TMP_PUB="$STATE_DIR/pub_$$.json"
    printf "%s" "$CONTENT" > "$TMP_PUB" 2>/dev/null || true
    if [ -s "$TMP_PUB" ]; then
        mv "$TMP_PUB" "$STATE_DIR/latest_telemetry.json" 2>/dev/null || rm -f "$TMP_PUB"
        cp "$STATE_DIR/latest_telemetry.json" "$STATE_DIR/latest_detections.json" 2>/dev/null || true
        for d in /usr/html/local/camai_acap /usr/local/packages/camai_acap/html /var/spool/storage/SD_DISK/local/camai_acap ./html .; do
            if [ -d "$d" ]; then
                cp "$STATE_DIR/latest_telemetry.json" "$d/telemetry.json" 2>/dev/null || true
                cp "$STATE_DIR/latest_telemetry.json" "$d/detections.json" 2>/dev/null || true
            fi
        done
    else
        rm -f "$TMP_PUB"
    fi
}

# ── Background AWS Worker Loop ───────────────────────────────────────────────
aws_worker_loop() {
    logger -t "camai_acap" "AWS worker thread started"
    WORKER_FRAME=0

    while true; do
        FRAME_SRC="$STATE_DIR/current_frame.jpg"
        if [ -f "$FRAME_SRC" ] && [ -s "$FRAME_SRC" ]; then
            # Non-destructive copy: live video retains current_frame.jpg continuously
            WORK_JPEG="$STATE_DIR/worker_$$.jpg"
            cp "$FRAME_SRC" "$WORK_JPEG" 2>/dev/null || true

            if [ -f "$WORK_JPEG" ] && [ -s "$WORK_JPEG" ]; then
                WORKER_FRAME=$(( (WORKER_FRAME + 1) % 1000000 ))
                NOW_MS=$(date +%s)000

                B64_FILE="$STATE_DIR/frame_$$.b64"
                base64 "$WORK_JPEG" 2>/dev/null | tr -d '\r\n' > "$B64_FILE" || true
                rm -f "$WORK_JPEG"

                if [ -s "$B64_FILE" ]; then
                    PROFILE="traffic"
                    if [ -f "$STATE_DIR/active_profile.txt" ]; then
                        PROFILE=$(cat "$STATE_DIR/active_profile.txt" 2>/dev/null || echo "traffic")
                    fi

                    CONFIG_JSON="{}"
                    if [ -f "$STATE_DIR/config.json" ] && [ -s "$STATE_DIR/config.json" ]; then
                        CONFIG_JSON=$(cat "$STATE_DIR/config.json" 2>/dev/null || echo "{}")
                    fi

                    PAYLOAD_FILE="$STATE_DIR/payload_$$.json"
                    printf "{\"image_b64\":\"" > "$PAYLOAD_FILE"
                    cat "$B64_FILE" >> "$PAYLOAD_FILE"
                    printf "\",\"frame_id\":%s,\"zone_profile\":\"%s\",\"camera_id\":\"axis-cam-01\",\"config\":%s}" "$WORKER_FRAME" "$PROFILE" "$CONFIG_JSON" >> "$PAYLOAD_FILE"
                    rm -f "$B64_FILE"

                    RESP=$(curl -s --max-time 4 --connect-timeout 2 \
                        -H "Content-Type: application/json" \
                        -X POST \
                        -d @"$PAYLOAD_FILE" \
                        "$AWS_URL" 2>/dev/null || echo "")
                    rm -f "$PAYLOAD_FILE"

                    if echo "$RESP" | grep -q '"detections"' 2>/dev/null; then
                        publish "$RESP"
                    else
                        # Real error state — NEVER output fake FPS or fake detections
                        ERROR_JSON="{\"type\":\"telemetry\",\"frame_id\":$WORKER_FRAME,\"timestamp\":$NOW_MS,\"status\":\"error\",\"aws_status\":\"offline\",\"error\":\"AWS AI Server Offline / Unreachable\",\"active_module\":\"$PROFILE\",\"count\":0,\"detections\":[],\"alerts\":[],\"fps\":null,\"inference_latency_ms\":null}"
                        publish "$ERROR_JSON"
                    fi
                fi
            fi
        fi
        msleep 100
    done
}

# Start the AWS Worker in the background so it CANNOT block camera frame capture
aws_worker_loop &
WORKER_PID=$!

trap "kill $WORKER_PID 2>/dev/null; exit 0" INT TERM EXIT

# ── Primary Camera Frame Capture Loop ─────────────────────────────────────────
logger -t "camai_acap" "Camera capture loop starting..."

if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
    PY_BIN=$(command -v python3 || command -v python)
    logger -t "camai_acap" "Using Python persistent HTTP Keep-Alive capture worker ($PY_BIN)"
    $PY_BIN -c '
import urllib.request, time, os

state_dir = "/tmp/camai"
os.makedirs(state_dir, exist_ok=True)
url = "http://127.0.0.1/axis-cgi/mjpg/video.cgi?resolution=800x450&fps=25"
auth = "VLTUser:wY0-oD0jA6jft3"

mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
if ":" in auth:
    u, p = auth.split(":", 1)
    mgr.add_password(None, "http://127.0.0.1", u, p)

opener = urllib.request.build_opener(urllib.request.HTTPDigestAuthHandler(mgr))

fail_count = 0
while True:
    try:
        req = urllib.request.Request(url, headers={"Connection": "keep-alive"})
        with opener.open(req, timeout=8) as stream:
            buf = bytearray()
            while True:
                chunk = stream.read(8192)
                if not chunk:
                    break
                buf.extend(chunk)
                soi = buf.find(b"\xff\xd8")
                eoi = buf.find(b"\xff\xd9", soi + 2) if soi != -1 else -1
                if soi != -1 and eoi != -1:
                    jpeg = buf[soi:eoi+2]
                    del buf[:eoi+2]
                    tmp_path = f"{state_dir}/capture_tmp_{os.getpid()}.jpg"
                    with open(tmp_path, "wb") as f:
                        f.write(jpeg)
                    os.replace(tmp_path, f"{state_dir}/current_frame.jpg")
                    fail_count = 0
    except Exception:
        fail_count += 1
        # Fallback to single snapshot if continuous MJPEG loopback drops
        try:
            snap_url = "http://127.0.0.1/axis-cgi/jpg/image.cgi?resolution=800x450&compression=40"
            snap_req = urllib.request.Request(snap_url)
            with opener.open(snap_req, timeout=2) as snap_resp:
                s_data = snap_resp.read()
                if s_data and s_data.startswith(b"\xff\xd8"):
                    tmp_path = f"{state_dir}/capture_tmp_{os.getpid()}.jpg"
                    with open(tmp_path, "wb") as f:
                        f.write(s_data)
                    os.replace(tmp_path, f"{state_dir}/current_frame.jpg")
        except Exception:
            pass
        time.sleep(0.5 if fail_count < 5 else 1.5)
' 2>/dev/null || true
fi

# Fallback shell capture worker (runs if python is not available)
CAPTURE_FRAME=0
FAIL_COUNT=0

while true; do
    CAPTURE_FRAME=$(( (CAPTURE_FRAME + 1) % 1000000 ))
    TEMP_JPEG="$STATE_DIR/capture_tmp_$$.jpg"

    # Try local capture without auth first (most Axis cameras allow loopback 127.0.0.1)
    curl -s --max-time 1 --connect-timeout 1 \
        -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
        -H "Connection: keep-alive" \
        -o "$TEMP_JPEG" \
        "$SNAP_URL" 2>/dev/null || true

    # If empty or unauthorized, attempt digest authentication
    if [ ! -s "$TEMP_JPEG" ] || grep -q "401 Unauthorized" "$TEMP_JPEG" 2>/dev/null; then
        rm -f "$TEMP_JPEG"
        curl -s --max-time 1 --connect-timeout 1 \
        -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
        -H "Connection: keep-alive" \
        -u "$AUTH" --digest \
        -o "$TEMP_JPEG" \
        "$SNAP_URL" 2>/dev/null || true
    fi

    if [ -f "$TEMP_JPEG" ] && [ -s "$TEMP_JPEG" ] && ! grep -q "401 Unauthorized" "$TEMP_JPEG" 2>/dev/null; then
        mv "$TEMP_JPEG" "$STATE_DIR/current_frame.jpg" 2>/dev/null || rm -f "$TEMP_JPEG"
        FAIL_COUNT=0
    else
        rm -f "$TEMP_JPEG"
        FAIL_COUNT=$(( FAIL_COUNT + 1 ))
    fi

    if [ "$FAIL_COUNT" -gt 5 ]; then
        msleep 1000
    else
        msleep 80
    fi
done
