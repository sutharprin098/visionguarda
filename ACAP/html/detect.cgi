#!/bin/sh
printf "Content-Type: application/json\r\n\r\n"
curl -s -m 4 -H "Content-Type: application/json" -X POST --data-binary @- "http://13.203.71.14:8000/api/detect" 2>/dev/null || printf '{"status":"error","message":"AWS unreachable","detections":[]}'
