#!/usr/bin/env bash
# sniff-resign.sh — Create a debug-friendly copy of SoundSwitch
#
# Strips hardened runtime so lldb/dtrace can attach.
# Does NOT modify the original app.
#
# Usage:
#   1. Run: ./scripts/sniff-resign.sh
#   2. Open the modified copy (it will launch automatically)
#   3. Wait for the blue LED
#   4. Run: ./scripts/sniff.sh
#      (which will now be able to attach via lldb)

set -euo pipefail

SRC="/Applications/SoundSwitch.app"
DST="/tmp/SoundSwitch-debug.app"

if [ ! -d "$SRC" ]; then
  echo "ERROR: SoundSwitch not found at $SRC"
  exit 1
fi

echo "=== Creating debug-friendly SoundSwitch copy ==="
echo ""

# Kill any running SoundSwitch first
pkill -f 'SoundSwitch.app/Contents/MacOS/SoundSwitch$' 2>/dev/null || true
sleep 1

# Remove old copy
rm -rf "$DST"

echo "Step 1: Copying SoundSwitch.app to /tmp/ ..."
cp -R "$SRC" "$DST"
echo "  Done ($(du -sh "$DST" | cut -f1))"

echo ""
echo "Step 2: Stripping code signature..."
codesign --remove-signature "$DST/Contents/MacOS/SoundSwitch" 2>/dev/null || true
# Also strip signatures from frameworks
find "$DST/Contents/Frameworks" -name "*.dylib" -exec codesign --remove-signature {} \; 2>/dev/null || true
echo "  Done"

echo ""
echo "Step 3: Re-signing with ad-hoc signature (no hardened runtime)..."
# Sign without hardened runtime or library validation
codesign -s - --force --deep "$DST" 2>/dev/null || true
echo "  Done"

echo ""
echo "Step 4: Removing quarantine attribute..."
xattr -rd com.apple.quarantine "$DST" 2>/dev/null || true
echo "  Done"

echo ""
echo "=== Ready! ==="
echo ""
echo "Now run these steps:"
echo "  1. Open the debug copy:"
echo "     open /tmp/SoundSwitch-debug.app"
echo ""
echo "  2. Wait for the blue LED on the adapter"
echo ""
echo "  3. In another terminal, run the sniffer:"
echo "     ./scripts/sniff.sh"
echo "     (it will find the debug copy's process)"
echo ""
echo "  4. Let it capture for 10-20 seconds, then Ctrl+C + quit"
echo ""
