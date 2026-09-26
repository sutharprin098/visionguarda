#!/bin/sh
STATE_DIR="/tmp/camai"
mkdir -p "$STATE_DIR"

# Preflight
if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    echo "Status: 204 No Content"
    echo "Access-Control-Allow-Origin: *"
    echo "Access-Control-Allow-Methods: GET, POST, OPTIONS"
    echo "Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-CamAI-Token"
    echo ""
    exit 0
fi

# 1. Parse profile directly from query string (immediate, 0-latency, 100% reliable)
if [ -n "$QUERY_STRING" ]; then
    PROF_Q=$(echo "$QUERY_STRING" | sed -n 's/.*profile=\([^&]*\).*/\1/p' | sed 's/%20/ /g')
    if [ -n "$PROF_Q" ]; then
        printf "%s" "$PROF_Q" > "$STATE_DIR/active_profile.txt" 2>/dev/null || true
    fi
fi

if [ "$REQUEST_METHOD" = "POST" ]; then
    TMP_CFG="$STATE_DIR/cfg_in_$$.json"
    # Read POST body safely without ever hanging on pipe
    if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
        head -c "$CONTENT_LENGTH" > "$TMP_CFG" 2>/dev/null || dd bs="$CONTENT_LENGTH" count=1 > "$TMP_CFG" 2>/dev/null
    else
        # Bounded read to avoid hanging on HTTP/2 streams
        dd bs=32768 count=1 > "$TMP_CFG" 2>/dev/null
    fi

    if [ -s "$TMP_CFG" ]; then
        mv "$TMP_CFG" "$STATE_DIR/config.json" 2>/dev/null || rm -f "$TMP_CFG"
        PROF_BODY=$(sed -n 's/.*"zone_profile"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STATE_DIR/config.json" 2>/dev/null | head -n 1)
        if [ -n "$PROF_BODY" ]; then
            printf "%s" "$PROF_BODY" > "$STATE_DIR/active_profile.txt" 2>/dev/null || true
        fi
    else
        rm -f "$TMP_CFG"
    fi

    # Output headers AFTER processing is done so Apache HTTP/2 stream is clean
    echo "Status: 200 OK"
    echo "Content-Type: application/json"
    echo "Cache-Control: no-cache, no-store, must-revalidate"
    echo "Access-Control-Allow-Origin: *"
    echo ""
    echo '{"status":"ok"}'
    exit 0
fi

# GET request: return existing config or default
echo "Status: 200 OK"
echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo "Access-Control-Allow-Origin: *"
echo ""
if [ -f "$STATE_DIR/config.json" ] && [ -s "$STATE_DIR/config.json" ]; then
    cat "$STATE_DIR/config.json"
else
    echo '{"zone_profile":"traffic","profile_features":{},"zones":[],"lines":[]}'
fi
