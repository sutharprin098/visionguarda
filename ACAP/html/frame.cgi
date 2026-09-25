#!/bin/sh
echo "Content-Type: image/jpeg"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo "Access-Control-Allow-Origin: *"
echo ""
if [ -f /tmp/camai/current_frame.jpg ] && [ -s /tmp/camai/current_frame.jpg ]; then
    cat /tmp/camai/current_frame.jpg
elif [ -f /tmp/camai/live_frame.jpg ]; then
    cat /tmp/camai/live_frame.jpg
fi
