#!/bin/sh
printf "Content-Type: application/json\r\n\r\n"
cat /tmp/camai/latest_telemetry.json 2>/dev/null || printf '{"type":"telemetry","count":0,"detections":[]}'
