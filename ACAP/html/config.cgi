#!/bin/sh
echo "Status: 200 OK"
echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo "Pragma: no-cache"
echo "Expires: 0"
echo "Access-Control-Allow-Origin: *"
echo "Access-Control-Allow-Methods: GET, POST, OPTIONS"
echo "Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-CamAI-Token"
echo ""
if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    exit 0
fi
STATE_DIR="/tmp/camai"
mkdir -p "$STATE_DIR"
if [ "$REQUEST_METHOD" = "POST" ]; then
    TMP_CFG="$STATE_DIR/cfg_in_$$.json"
    if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
        dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null > "$TMP_CFG" || head -c "$CONTENT_LENGTH" 2>/dev/null > "$TMP_CFG" || cat > "$TMP_CFG" 2>/dev/null
    else
        cat > "$TMP_CFG" 2>/dev/null || true
    fi
    if [ -s "$TMP_CFG" ]; then
        mv "$TMP_CFG" "$STATE_DIR/config.json" 2>/dev/null || rm -f "$TMP_CFG"
        PROF=$(sed -n 's/.*"zone_profile"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STATE_DIR/config.json" 2>/dev/null | head -n 1)
        if [ -n "$PROF" ]; then
            printf "%s" "$PROF" > "$STATE_DIR/active_profile.txt" 2>/dev/null || true
        fi
    else
        rm -f "$TMP_CFG"
    fi
    echo '{"status":"ok"}'
    exit 0
fi
if [ -f "$STATE_DIR/config.json" ] && [ -s "$STATE_DIR/config.json" ]; then
    cat "$STATE_DIR/config.json"
else
    echo '{"zone_profile":"traffic","profile_features":{},"zones":[],"lines":[]}'
fi
