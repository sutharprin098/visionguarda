#!/bin/sh
echo "Status: 302 Found"
echo "Location: /axis-cgi/mjpg/video.cgi?resolution=800x450&compression=25&fps=25"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo "Access-Control-Allow-Origin: *"
echo ""
