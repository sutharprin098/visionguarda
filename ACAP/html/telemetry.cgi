#!/bin/sh
echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo "Access-Control-Allow-Origin: *"
echo ""
if [ -f /tmp/camai/latest_telemetry.json ] && [ -s /tmp/camai/latest_telemetry.json ]; then
    cat /tmp/camai/latest_telemetry.json
else
    echo '{"type":"telemetry","status":"ok","count":0,"detections":[],"alerts":[]}'
fi
