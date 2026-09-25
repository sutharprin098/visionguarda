#!/bin/sh
printf "Status: 200 OK\r\n"
printf "Content-Type: application/json\r\n"
printf "Cache-Control: no-cache, no-store, must-revalidate\r\n"
printf "Access-Control-Allow-Origin: *\r\n\r\n"
if [ -f /tmp/camai/latest_detections.json ] && [ -s /tmp/camai/latest_detections.json ]; then
    cat /tmp/camai/latest_detections.json
else
    printf '{"type":"telemetry","status":"ok","count":0,"detections":[],"alerts":[]}'
fi
printf "\n"
