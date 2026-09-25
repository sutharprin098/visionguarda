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
SNAP_URL="http://127.0.0.1/axis-cgi/jpg/image.cgi?resolution=640x360&compression=50"

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
            # Atomic consume: move to worker workspace so new capture doesn't overwrite mid-read
            WORK_JPEG="$STATE_DIR/worker_$$.jpg"
            mv "$FRAME_SRC" "$WORK_JPEG" 2>/dev/null || true

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

                    T_START=$(date +%s)
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
        sleep 0.05
    done
}

# Start the AWS Worker in the background so it CANNOT block camera frame capture
aws_worker_loop &
WORKER_PID=$!

trap "kill $WORKER_PID 2>/dev/null; exit 0" INT TERM EXIT

# ── Primary Camera Frame Capture Loop ─────────────────────────────────────────
# Captures at ~3 FPS with HTTP Keep-Alive and cookie jar to prevent web server socket starvation
logger -t "camai_acap" "Camera capture loop starting..."
CAPTURE_FRAME=0

while true; do
    CAPTURE_FRAME=$(( (CAPTURE_FRAME + 1) % 1000000 ))
    TEMP_JPEG="$STATE_DIR/capture_tmp_$$.jpg"

    # Capture frame locally using persistent auth session (no Connection: close)
    curl -s --max-time 2 --connect-timeout 1 \
        -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
        -u "$AUTH" --digest \
        -o "$TEMP_JPEG" \
        "$SNAP_URL" 2>/dev/null || true

    if [ -f "$TEMP_JPEG" ] && [ -s "$TEMP_JPEG" ]; then
        # Atomic update of latest frame buffer (latest frame always replaces older)
        mv "$TEMP_JPEG" "$STATE_DIR/current_frame.jpg" 2>/dev/null || rm -f "$TEMP_JPEG"
    else
        rm -f "$TEMP_JPEG"
    fi

    # 350ms sleep = ~3 FPS capture rate. Leaves 95%+ CPU and socket resources free for live MJPEG stream
    sleep 0.35
done

