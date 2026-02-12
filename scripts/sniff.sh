#!/usr/bin/env bash
# sniff.sh — Capture SoundSwitch USB init + DMX traffic via lldb
#
# Launches the debug copy of SoundSwitch under lldb to capture
# the ENTIRE initialization sequence from the very first USB call.
#
# Usage:
#   1. First run: ./scripts/sniff-resign.sh (if not done already)
#   2. Make sure SoundSwitch is NOT running
#   3. Run: ./scripts/sniff.sh
#   4. Wait ~20 seconds for init + DMX frames
#   5. Ctrl+C to stop, output is in /tmp/soundswitch-sniff.log

set -euo pipefail

APP="/tmp/SoundSwitch-debug.app/Contents/MacOS/SoundSwitch"

if [ ! -f "$APP" ]; then
  echo "Debug copy not found. Run ./scripts/sniff-resign.sh first."
  exit 1
fi

# Kill any running SoundSwitch
pkill -f 'SoundSwitch' 2>/dev/null || true
sleep 1

echo "=== SoundSwitch USB Sniffer ==="
echo "Launching debug copy under lldb..."
echo "Output: /tmp/soundswitch-sniff.log"
echo "Wait for blue LED + ~10 seconds of DMX, then Ctrl+C"
echo ""

CMDS=$(mktemp /tmp/lldb-sniff-XXXX.txt)
cat > "$CMDS" << 'LLDB'
settings set auto-confirm true
settings set target.x86-disassembly-flavor intel

# Target the debug copy
target create /tmp/SoundSwitch-debug.app/Contents/MacOS/SoundSwitch

# ── Breakpoint 1: libusb_bulk_transfer ──
# Args (ARM64): x0=handle, x1=endpoint, x2=data, x3=length, x4=actual, x5=timeout
# Capture 528 bytes (132 x 4-byte words) to see full 522-byte DMX packet
breakpoint set -n libusb_bulk_transfer -G true
breakpoint command add 1
register read x1 x3
memory read --force -fx -c 132 $x2
DONE

# ── Breakpoint 2: libusb_control_transfer ──
# Args: x0=handle, x1=bmRequestType, x2=bRequest, x3=wValue, x4=wIndex, x5=data, x6=wLength
breakpoint set -n libusb_control_transfer -G true
breakpoint command add 2
register read x1 x2 x3 x4 x6
DONE

# ── Breakpoint 3: libusb_set_configuration ──
breakpoint set -n libusb_set_configuration -G true
breakpoint command add 3
register read x1
DONE

# ── Breakpoint 4: libusb_claim_interface ──
breakpoint set -n libusb_claim_interface -G true
breakpoint command add 4
register read x1
DONE

# ── Breakpoint 5: libusb_set_interface_alt_setting ──
breakpoint set -n libusb_set_interface_alt_setting -G true
breakpoint command add 5
register read x1 x2
DONE

# ── Breakpoint 6: FT_Write ──
# Args: x0=handle, x1=buffer, x2=length, x3=bytesWritten
breakpoint set -n FT_Write -G true
breakpoint command add 6
register read x2
memory read --force -fx -c 16 $x1
DONE

# ── Breakpoint 7: FT_SetBreakOn ──
breakpoint set -n FT_SetBreakOn -G true

# ── Breakpoint 8: FT_SetBreakOff ──
breakpoint set -n FT_SetBreakOff -G true

# ── Breakpoint 9: FT_Open ──
breakpoint set -n FT_Open -G true
breakpoint command add 9
register read x0
DONE

# ── Breakpoint 10: FT_SetVIDPID ──
breakpoint set -n FT_SetVIDPID -G true
breakpoint command add 10
register read x0 x1
DONE

# ── Breakpoint 11: FT_SetBaudRate ──
breakpoint set -n FT_SetBaudRate -G true
breakpoint command add 11
register read x1
DONE

# ── Breakpoint 12: FT_SetDataCharacteristics ──
breakpoint set -n FT_SetDataCharacteristics -G true
breakpoint command add 12
register read x1 x2 x3
DONE

# ── Breakpoint 13: FT_ResetDevice ──
breakpoint set -n FT_ResetDevice -G true

# ── Breakpoint 14: FT_Purge ──
breakpoint set -n FT_Purge -G true
breakpoint command add 14
register read x1
DONE

# ── Breakpoint 15: FT_SetFlowControl ──
breakpoint set -n FT_SetFlowControl -G true

# ── Breakpoint 16: FT_SetTimeouts ──
breakpoint set -n FT_SetTimeouts -G true
breakpoint command add 16
register read x1 x2
DONE

# ── Breakpoint 17: FT_SetLatencyTimer ──
breakpoint set -n FT_SetLatencyTimer -G true
breakpoint command add 17
register read x1
DONE

# ── Breakpoint 18: FT_SetUSBParameters ──
breakpoint set -n FT_SetUSBParameters -G true
breakpoint command add 18
register read x1 x2
DONE

# ── Breakpoint 19: FT_ClrDtr / FT_SetDtr / FT_ClrRts / FT_SetRts ──
breakpoint set -n FT_ClrDtr -G true
breakpoint set -n FT_SetDtr -G true
breakpoint set -n FT_ClrRts -G true
breakpoint set -n FT_SetRts -G true

# ── Breakpoint 23: FT_Close ──
breakpoint set -n FT_Close -G true

# ── Breakpoint 24: FT_Read ──
breakpoint set -n FT_Read -G true
breakpoint command add 24
register read x2
DONE

# ── Breakpoint 25: FT_GetQueueStatus ──
breakpoint set -n FT_GetQueueStatus -G true

# ── Breakpoint 26: FT_CreateDeviceInfoList ──
breakpoint set -n FT_CreateDeviceInfoList -G true

# Launch the app
run
LLDB

lldb -s "$CMDS" 2>&1 | tee /tmp/soundswitch-sniff.log

rm -f "$CMDS"
