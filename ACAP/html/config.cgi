#!/bin/sh
echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo "Access-Control-Allow-Origin: *"
echo "Access-Control-Allow-Methods: GET, POST, OPTIONS"
echo "Access-Control-Allow-Headers: Content-Type"
echo ""
mkdir -p /tmp/camai
if [ "$REQUEST_METHOD" = "POST" ]; then
    cat > /tmp/camai/config.json 2>/dev/null || true
    sed -n 's/.*"zone_profile":"\([^"]*\)".*/\1/p' /tmp/camai/config.json > /tmp/camai/active_profile.txt 2>/dev/null || true
    echo '{"status":"ok"}'
else
    if [ -f /tmp/camai/config.json ] && [ -s /tmp/camai/config.json ]; then
        cat /tmp/camai/config.json
    else
        echo '{"zone_profile":"traffic","profile_features":{},"zones":[],"lines":[]}'
    fi
fi
