#!/usr/bin/env bash
# sniff-soundswitch.sh — Capture ALL USB communication from SoundSwitch
#
# Hooks at multiple levels:
#   1. FT_* D2XX functions (if SoundSwitch uses D2XX)
#   2. libusb functions (if statically linked in D2XX or used directly)
#   3. IOKit USB functions (lowest level)
#
# Usage:
#   1. Open SoundSwitch and wait for blue LED
#   2. Run: sudo ./scripts/sniff-soundswitch.sh
#   3. Watch the output — every USB write will be logged
#   4. Press Ctrl+C to stop
#
# Note: Requires SIP disabled for dtrace, or at minimum:
#   csrutil enable --without dtrace
# Check with: csrutil status

set -euo pipefail

# Find SoundSwitch PID
SS_PID=$(pgrep -f 'SoundSwitch.app/Contents/MacOS/SoundSwitch$' 2>/dev/null | head -1)

if [ -z "$SS_PID" ]; then
  echo "ERROR: SoundSwitch is not running."
  echo "  1. Open /Applications/SoundSwitch.app"
  echo "  2. Wait for blue LED on adapter"
  echo "  3. Run this script again with sudo"
  exit 1
fi

echo "=== SoundSwitch USB Sniffer ==="
echo "PID: $SS_PID"
echo ""

# Check SIP status
if csrutil status 2>/dev/null | grep -q "enabled"; then
  echo "WARNING: SIP is enabled. dtrace may not work."
  echo "  To fix: boot to Recovery Mode, run: csrutil enable --without dtrace"
  echo "  Or: csrutil disable (less secure)"
  echo ""
  echo "Trying anyway..."
  echo ""
fi

echo "Tracing USB activity... Press Ctrl+C to stop."
echo "═══════════════════════════════════════════════"
echo ""

sudo dtrace -n '
/* ═══ D2XX layer (FT_* functions from libftd2xx) ═══ */

pid$target::FT_SetVIDPID:entry {
  printf("[D2XX] FT_SetVIDPID(vid=0x%x, pid=0x%x)", arg0, arg1);
}

pid$target::FT_Open:entry {
  printf("[D2XX] FT_Open(index=%d)", arg0);
}
pid$target::FT_Open:return {
  printf("[D2XX]   → FT_Open returned %d", arg1);
}

pid$target::FT_OpenEx:entry {
  printf("[D2XX] FT_OpenEx(flags=%d)", arg1);
}
pid$target::FT_OpenEx:return {
  printf("[D2XX]   → FT_OpenEx returned %d", arg1);
}

pid$target::FT_Close:entry {
  printf("[D2XX] FT_Close()");
}

pid$target::FT_ResetDevice:entry {
  printf("[D2XX] FT_ResetDevice()");
}

pid$target::FT_SetBaudRate:entry {
  printf("[D2XX] FT_SetBaudRate(%d)", arg1);
}

pid$target::FT_SetDataCharacteristics:entry {
  printf("[D2XX] FT_SetDataCharacteristics(bits=%d, stops=%d, parity=%d)", arg1, arg2, arg3);
}

pid$target::FT_SetFlowControl:entry {
  printf("[D2XX] FT_SetFlowControl(flow=%d)", arg1);
}

pid$target::FT_SetTimeouts:entry {
  printf("[D2XX] FT_SetTimeouts(read=%d, write=%d)", arg1, arg2);
}

pid$target::FT_SetLatencyTimer:entry {
  printf("[D2XX] FT_SetLatencyTimer(%d)", arg1);
}

pid$target::FT_SetUSBParameters:entry {
  printf("[D2XX] FT_SetUSBParameters(in=%d, out=%d)", arg1, arg2);
}

pid$target::FT_SetDtr:entry {
  printf("[D2XX] FT_SetDtr() ← DTR HIGH");
}
pid$target::FT_ClrDtr:entry {
  printf("[D2XX] FT_ClrDtr() ← DTR LOW");
}
pid$target::FT_SetRts:entry {
  printf("[D2XX] FT_SetRts() ← RTS HIGH");
}
pid$target::FT_ClrRts:entry {
  printf("[D2XX] FT_ClrRts() ← RTS LOW");
}

pid$target::FT_Purge:entry {
  printf("[D2XX] FT_Purge(mask=0x%x)", arg1);
}

pid$target::FT_SetBreakOn:entry {
  printf("[D2XX] FT_SetBreakOn() ← BREAK START");
}
pid$target::FT_SetBreakOff:entry {
  printf("[D2XX] FT_SetBreakOff() ← BREAK END");
}

pid$target::FT_Write:entry {
  self->write_buf = arg1;
  self->write_len = arg2;
  printf("[D2XX] FT_Write(len=%d) data[0..15]: %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x",
    arg2,
    *(uint8_t*)copyin(arg1, 1),
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
  printf("[D2XX]   → FT_Write returned %d", arg1);
}

pid$target::FT_Read:entry {
  printf("[D2XX] FT_Read(len=%d)", arg2);
}
pid$target::FT_Read:return {
  printf("[D2XX]   → FT_Read returned %d", arg1);
}

pid$target::FT_GetQueueStatus:entry {
  printf("[D2XX] FT_GetQueueStatus()");
}

pid$target::FT_CreateDeviceInfoList:entry {
  printf("[D2XX] FT_CreateDeviceInfoList()");
}
pid$target::FT_CreateDeviceInfoList:return {
  printf("[D2XX]   → returned %d", arg1);
}

pid$target::FT_SetBitMode:entry {
  printf("[D2XX] FT_SetBitMode(mask=0x%x, mode=%d)", arg1, arg2);
}

/* ═══ libusb layer (may be statically linked in libftd2xx) ═══ */

pid$target::libusb_bulk_transfer:entry {
  printf("[LIBUSB] bulk_transfer(ep=0x%02x, len=%d, timeout=%d)",
    arg1, arg3, arg4);
  /* Print first 16 bytes of data */
  printf("[LIBUSB]   data: %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x",
    *(uint8_t*)copyin(arg2, 1),
    *(uint8_t*)copyin(arg2+1, 1),
    *(uint8_t*)copyin(arg2+2, 1),
    *(uint8_t*)copyin(arg2+3, 1),
    *(uint8_t*)copyin(arg2+4, 1),
    *(uint8_t*)copyin(arg2+5, 1),
    *(uint8_t*)copyin(arg2+6, 1),
    *(uint8_t*)copyin(arg2+7, 1),
    *(uint8_t*)copyin(arg2+8, 1),
    *(uint8_t*)copyin(arg2+9, 1),
    *(uint8_t*)copyin(arg2+10, 1),
    *(uint8_t*)copyin(arg2+11, 1),
    *(uint8_t*)copyin(arg2+12, 1),
    *(uint8_t*)copyin(arg2+13, 1),
    *(uint8_t*)copyin(arg2+14, 1),
    *(uint8_t*)copyin(arg2+15, 1)
  );
}
pid$target::libusb_bulk_transfer:return {
  printf("[LIBUSB]   → returned %d", arg1);
}

pid$target::libusb_control_transfer:entry {
  printf("[LIBUSB] control_transfer(bmReqType=0x%02x, bReq=0x%02x, wVal=0x%04x, wIdx=0x%04x, len=%d)",
    arg1, arg2, arg3, arg4, arg5);
}
pid$target::libusb_control_transfer:return {
  printf("[LIBUSB]   → returned %d", arg1);
}

pid$target::libusb_open:entry {
  printf("[LIBUSB] libusb_open()");
}

pid$target::libusb_claim_interface:entry {
  printf("[LIBUSB] claim_interface(iface=%d)", arg1);
}

pid$target::libusb_set_configuration:entry {
  printf("[LIBUSB] set_configuration(config=%d)", arg1);
}

pid$target::libusb_set_interface_alt_setting:entry {
  printf("[LIBUSB] set_alt_setting(iface=%d, alt=%d)", arg1, arg2);
}

pid$target::libusb_release_interface:entry {
  printf("[LIBUSB] release_interface(iface=%d)", arg1);
}

/* ═══ IOKit layer (lowest level USB access) ═══ */

pid$target::IOUSBInterfaceOpen:entry {
  printf("[IOKIT] IOUSBInterfaceOpen()");
}

pid$target::IOUSBDeviceOpen:entry {
  printf("[IOKIT] IOUSBDeviceOpen()");
}

pid$target::IOConnectCallMethod:entry {
  printf("[IOKIT] IOConnectCallMethod(selector=%d, inputCnt=%d, inputStructCnt=%d)",
    arg1, arg3, arg5);
}

' -p "$SS_PID" 2>&1
