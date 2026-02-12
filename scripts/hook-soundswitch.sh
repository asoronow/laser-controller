#!/usr/bin/env bash
# hook-soundswitch.sh — Capture all D2XX function calls from SoundSwitch
#
# Usage:
#   1. Plug in the SoundSwitch Micro DMX adapter
#   2. Open SoundSwitch desktop app
#   3. Run: sudo ./scripts/hook-soundswitch.sh
#
# This uses dtrace to intercept calls to the libftd2xx.dylib library,
# logging every FT_* function with its arguments. This gives us the
# exact configuration sequence SoundSwitch uses to initialize the device.
#
# Requires: SIP partially disabled or dtrace entitlements
#   To disable SIP for dtrace only:
#   1. Boot into Recovery Mode (hold Cmd+R on Intel, or power button on Apple Silicon)
#   2. Open Terminal from Utilities menu
#   3. Run: csrutil enable --without dtrace
#   4. Reboot

set -euo pipefail

# Find SoundSwitch PID
SS_PID=$(pgrep -f 'SoundSwitch.app/Contents/MacOS/SoundSwitch$' 2>/dev/null | head -1)

if [ -z "$SS_PID" ]; then
  echo "ERROR: SoundSwitch is not running."
  echo "  1. Plug in the Micro DMX adapter"
  echo "  2. Open /Applications/SoundSwitch.app"
  echo "  3. Wait for it to detect the adapter"
  echo "  4. Run this script again with sudo"
  exit 1
fi

echo "=== SoundSwitch D2XX Hook ==="
echo "PID: $SS_PID"
echo "Tracing all FT_* calls... Press Ctrl+C to stop."
echo ""

# The D2XX library is at:
#   @executable_path/../Frameworks/libftd2xx.dylib
# Which resolves to:
#   /Applications/SoundSwitch.app/Contents/Frameworks/libftd2xx.1.4.24.dylib
#
# dtrace pid provider format: pid<PID>::<function>:<probe>
# We use the library name pattern to match functions in libftd2xx

sudo dtrace -n '
/* ── Device Enumeration ── */
pid$target::FT_SetVIDPID:entry {
  printf("FT_SetVIDPID(vid=0x%x, pid=0x%x)", arg1, arg2);
}
pid$target::FT_CreateDeviceInfoList:entry {
  printf("FT_CreateDeviceInfoList()");
}
pid$target::FT_CreateDeviceInfoList:return {
  printf("  → status=%d", arg1);
}
pid$target::FT_GetDeviceInfoList:entry {
  printf("FT_GetDeviceInfoList()");
}
pid$target::FT_GetDeviceInfoDetail:entry {
  printf("FT_GetDeviceInfoDetail(index=%d)", arg0);
}

/* ── Device Open/Close ── */
pid$target::FT_Open:entry {
  printf("FT_Open(index=%d)", arg0);
}
pid$target::FT_Open:return {
  printf("  → status=%d", arg1);
}
pid$target::FT_OpenEx:entry {
  printf("FT_OpenEx(flags=%d)", arg1);
}
pid$target::FT_OpenEx:return {
  printf("  → status=%d", arg1);
}
pid$target::FT_Close:entry {
  printf("FT_Close(handle=%p)", arg0);
}

/* ── Device Configuration ── */
pid$target::FT_ResetDevice:entry {
  printf("FT_ResetDevice(handle=%p)", arg0);
}
pid$target::FT_SetBaudRate:entry {
  printf("FT_SetBaudRate(handle=%p, baud=%d)", arg0, arg1);
}
pid$target::FT_SetDivisor:entry {
  printf("FT_SetDivisor(handle=%p, divisor=%d)", arg0, arg1);
}
pid$target::FT_SetDataCharacteristics:entry {
  printf("FT_SetDataCharacteristics(handle=%p, bits=%d, stops=%d, parity=%d)", arg0, arg1, arg2, arg3);
}
pid$target::FT_SetFlowControl:entry {
  printf("FT_SetFlowControl(handle=%p, flow=%d, xon=0x%x, xoff=0x%x)", arg0, arg1, arg2, arg3);
}
pid$target::FT_SetTimeouts:entry {
  printf("FT_SetTimeouts(handle=%p, read=%d, write=%d)", arg0, arg1, arg2);
}
pid$target::FT_SetLatencyTimer:entry {
  printf("FT_SetLatencyTimer(handle=%p, latency=%d)", arg0, arg1);
}
pid$target::FT_SetUSBParameters:entry {
  printf("FT_SetUSBParameters(handle=%p, inSize=%d, outSize=%d)", arg0, arg1, arg2);
}
pid$target::FT_SetChars:entry {
  printf("FT_SetChars(handle=%p, event=0x%x, eventEn=%d, error=0x%x, errorEn=%d)", arg0, arg1, arg2, arg3, arg4);
}

/* ── Modem Control (DTR/RTS) ── */
pid$target::FT_SetDtr:entry {
  printf("FT_SetDtr(handle=%p)  ← DTR HIGH", arg0);
}
pid$target::FT_ClrDtr:entry {
  printf("FT_ClrDtr(handle=%p)  ← DTR LOW", arg0);
}
pid$target::FT_SetRts:entry {
  printf("FT_SetRts(handle=%p)  ← RTS HIGH", arg0);
}
pid$target::FT_ClrRts:entry {
  printf("FT_ClrRts(handle=%p)  ← RTS LOW", arg0);
}

/* ── Buffer Control ── */
pid$target::FT_Purge:entry {
  printf("FT_Purge(handle=%p, mask=0x%x)  [1=RX 2=TX 3=BOTH]", arg0, arg1);
}
pid$target::FT_ResetPort:entry {
  printf("FT_ResetPort(handle=%p)", arg0);
}

/* ── DMX Break Signal ── */
pid$target::FT_SetBreakOn:entry {
  printf("FT_SetBreakOn(handle=%p)  ← DMX BREAK START", arg0);
}
pid$target::FT_SetBreakOff:entry {
  printf("FT_SetBreakOff(handle=%p)  ← DMX BREAK END", arg0);
}

/* ── Data Transfer ── */
pid$target::FT_Write:entry {
  printf("FT_Write(handle=%p, len=%d)", arg0, arg2);
  /* Print first 16 bytes of the data buffer */
  printf("  data[0..15]: %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x",
    *(uint8_t*)copyin(arg1, 16),
    *(uint8_t*)copyin(arg1+1, 1),
    *(uint8_t*)copyin(arg1+2, 1),
    *(uint8_t*)copyin(arg1+3, 1),
    *(uint8_t*)copyin(arg1+4, 1),
    *(uint8_t*)copyin(arg1+5, 1),
    *(uint8_t*)copyin(arg1+6, 1),
    *(uint8_t*)copyin(arg1+7, 1),
    *(uint8_t*)copyin(arg1+8, 1),
    *(uint8_t*)copyin(arg1+9, 1),
    *(uint8_t*)copyin(arg1+10, 1),
    *(uint8_t*)copyin(arg1+11, 1),
    *(uint8_t*)copyin(arg1+12, 1),
    *(uint8_t*)copyin(arg1+13, 1),
    *(uint8_t*)copyin(arg1+14, 1),
    *(uint8_t*)copyin(arg1+15, 1)
  );
}
pid$target::FT_Write:return {
  printf("  → status=%d", arg1);
}
pid$target::FT_Read:entry {
  printf("FT_Read(handle=%p, len=%d)", arg0, arg2);
}
pid$target::FT_GetQueueStatus:entry {
  printf("FT_GetQueueStatus(handle=%p)", arg0);
}
pid$target::FT_GetModemStatus:entry {
  printf("FT_GetModemStatus(handle=%p)", arg0);
}

/* ── Bit Bang Mode ── */
pid$target::FT_SetBitMode:entry {
  printf("FT_SetBitMode(handle=%p, mask=0x%x, mode=%d)", arg0, arg1, arg2);
}

/* ── Vendor Commands ── */
pid$target::FT_VendorCmdSet:entry {
  printf("FT_VendorCmdSet(handle=%p, req=%d, buf=%p, len=%d)", arg0, arg1, arg2, arg3);
}
pid$target::FT_VendorCmdGet:entry {
  printf("FT_VendorCmdGet(handle=%p, req=%d, buf=%p, len=%d)", arg0, arg1, arg2, arg3);
}
' -p "$SS_PID"
