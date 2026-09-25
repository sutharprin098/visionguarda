#!/bin/sh
printf "Status: 200 OK\r\n"
printf "Content-Type: application/json\r\n"
printf "Cache-Control: no-cache, no-store, must-revalidate\r\n"
printf "Access-Control-Allow-Origin: *\r\n\r\n"
mkdir -p /tmp/camai
cat > /tmp/camai/config.json
sed -n 's/.*"zone_profile":"\([^"]*\)".*/\1/p' /tmp/camai/config.json > /tmp/camai/active_profile.txt 2>/dev/null || true
printf '{"status":"ok"}'
printf "\n"
