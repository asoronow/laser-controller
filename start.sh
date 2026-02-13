#!/usr/bin/env bash
set -e

# Install deps if needed
[ -d node_modules ] || npm install

# Build if needed
[ -d .next ] || npm run build

# Find LAN IP (macOS or Linux)
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null \
  || hostname -I 2>/dev/null | awk '{print $1}' \
  || echo "localhost")
PORT=${PORT:-3000}

echo ""
echo "  Laser Controller"
echo "  Local:  http://localhost:$PORT/simulate"
echo "  LAN:    http://$LAN_IP:$PORT/simulate"
echo ""
echo "  Open the LAN URL on your phone (same WiFi)"
echo ""

npx next start -H 0.0.0.0 -p "$PORT"
