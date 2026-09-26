#!/bin/sh
# ==============================================================================
# CamAI ACAP Real Vision Engine Daemon — AWS Cloud Inference Architecture
# ==============================================================================
# Architecture:
#   1. Native Hardware Video: Browser streams directly from /axis-cgi/mjpg/video.cgi?fps=25
#      (Zero CPU load, zero process forks, rock-solid continuous 30 FPS).
#   2. Background AI Worker: Pure in-memory Python worker captures snapshots at 3-4 FPS,
#      POSTs to AWS /api/detect, and atomically updates /tmp/camai/latest_telemetry.json.
#   3. Zero Mock Detections: All telemetry and bounding boxes come 100% from AWS.
# ==============================================================================

logger -t "camai_acap" "CamAI Real Vision Engine starting..."
echo "[VIDEO] STREAM_START $(date -u +%Y-%m-%dT%H:%M:%SZ)"

STATE_DIR="/tmp/camai"
mkdir -p "$STATE_DIR"
touch "$STATE_DIR/current_frame.jpg"
touch "$STATE_DIR/latest_telemetry.json"
touch "$STATE_DIR/latest_detections.json"

SCRIPT_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd || dirname "$0")

# Symlink static telemetry into webroot for Apache zero-fork direct file serving
for webdir in "/usr/html/local/camai_acap" "$SCRIPT_DIR/html" "$SCRIPT_DIR"; do
    if [ -d "$webdir" ]; then
        ln -sf "$STATE_DIR/latest_telemetry.json" "$webdir/telemetry.json" 2>/dev/null || true
        ln -sf "$STATE_DIR/latest_detections.json" "$webdir/detections.json" 2>/dev/null || true
    fi
done

# Check if Python (python3 or python) is available on Axis OS
if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
    PY_BIN=$(command -v python3 || command -v python)
    logger -t "camai_acap" "Starting 10-Agent CamAI Real-Time Processing System ($PY_BIN)"
    
    SCRIPT_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd || dirname "$0")
    for cand in "$SCRIPT_DIR/camai_acap_multi_agent.py" "./camai_acap_multi_agent.py" "/usr/html/local/camai_acap/camai_acap_multi_agent.py"; do
        if [ -f "$cand" ]; then
            exec $PY_BIN "$cand"
        fi
    done
fi

# Fallback POSIX shell loop if python is not present
logger -t "camai_acap" "Python not found, running fallback curl worker"
AWS_URL="http://13.203.71.14:8000/api/detect"
SNAP_URL="http://127.0.0.1/axis-cgi/jpg/image.cgi"
AUTH="VLTuser:wM1_hTNvkrdkuY"
COOKIE_JAR="$STATE_DIR/cookie_jar.txt"
FRAME_ID=0

while true; do
    FRAME_ID=$(( (FRAME_ID + 1) % 1000000 ))
    TMP_JPEG="$STATE_DIR/snap_$$.jpg"
    
    curl -s --max-time 2 --connect-timeout 2 \
        -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
        -u "$AUTH" --digest \
        -o "$TMP_JPEG" \
        "$SNAP_URL" 2>/dev/null || curl -s --max-time 2 -o "$TMP_JPEG" "$SNAP_URL" 2>/dev/null || true

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
            printf '","frame_id":%s,"zone_profile":"%s","camera_id":"axis-local-cam"' "$FRAME_ID" "$PROFILE" >> "$PAYLOAD_FILE"

            # Attach active config (modules, profile_features, zones, lines, rules) if available
            if [ -f "$STATE_DIR/config.json" ] && [ -s "$STATE_DIR/config.json" ]; then
                printf ',"config":' >> "$PAYLOAD_FILE"
                cat "$STATE_DIR/config.json" >> "$PAYLOAD_FILE"
            fi
            printf '}' >> "$PAYLOAD_FILE"
            rm -f "$B64_FILE"
            
            RESP=$(curl -s --max-time 3 --connect-timeout 2 \
                -H "Content-Type: application/json" \
                -X POST \
                -d @"$PAYLOAD_FILE" \
                "$AWS_URL" 2>/dev/null || echo "")
            rm -f "$PAYLOAD_FILE"
            
            if echo "$RESP" | grep -q '"detections"' 2>/dev/null; then
                printf "%s" "$RESP" > "$STATE_DIR/latest_telemetry.json.tmp" 2>/dev/null || true
                mv -f "$STATE_DIR/latest_telemetry.json.tmp" "$STATE_DIR/latest_telemetry.json" 2>/dev/null || true
                cp "$STATE_DIR/latest_telemetry.json" "$STATE_DIR/latest_detections.json" 2>/dev/null || true
                for webdir in "/usr/html/local/camai_acap" "$SCRIPT_DIR/html" "$SCRIPT_DIR"; do
                    if [ -d "$webdir" ]; then
                        printf "%s" "$RESP" > "$webdir/telemetry.json.tmp" 2>/dev/null || true
                        mv -f "$webdir/telemetry.json.tmp" "$webdir/telemetry.json" 2>/dev/null || true
                    fi
                done
            fi
        fi
    else
        rm -f "$TMP_JPEG"
    fi
    sleep 1
done
