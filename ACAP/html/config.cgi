#!/bin/sh
printf "Content-Type: application/json\r\n\r\n"
cat > /usr/local/packages/camai_acap/html/state/config.json
printf '{"status": "ok"}'
