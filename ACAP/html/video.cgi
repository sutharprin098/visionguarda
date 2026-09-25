#!/bin/sh
echo "HTTP/1.1 200 OK"
echo "Content-Type: multipart/x-mixed-replace; boundary=--myboundary"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo "Pragma: no-cache"
echo "Access-Control-Allow-Origin: *"
echo "Connection: close"
echo ""
while true; do
    if [ -f /tmp/camai/current_frame.jpg ] && [ -s /tmp/camai/current_frame.jpg ]; then
        echo "--myboundary"
        echo "Content-Type: image/jpeg"
        echo ""
        cat /tmp/camai/current_frame.jpg
        echo ""
    fi
    usleep 33000 2>/dev/null || sleep 1
done
