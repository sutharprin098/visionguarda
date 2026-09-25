#!/bin/sh
echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo "Pragma: no-cache"
echo "Expires: 0"
echo "Access-Control-Allow-Origin: *"
echo ""
if [ -f /tmp/camai/latest_detections.json ] && [ -s /tmp/camai/latest_detections.json ]; then
    cat /tmp/camai/latest_detections.json
else
    echo '{"type":"telemetry","status":"ok","count":0,"detections":[],"alerts":[]}'
fi
