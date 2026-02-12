#!/bin/bash
# sniff-soundswitch.sh — Capture USB traffic from SoundSwitch app using dtrace
# Run: sudo bash scripts/sniff-soundswitch.sh
# Then launch SoundSwitch app normally.

echo "=== SoundSwitch USB Traffic Sniffer ==="
echo "This traces libusb calls made by SoundSwitch."
echo "1. Start this script first (needs sudo)"
echo "2. Then launch SoundSwitch app"
echo "3. Connect the adapter and trigger some DMX output"
echo "4. Press Ctrl+C to stop"
echo ""

# Find SoundSwitch PID if already running
SS_PID=$(pgrep -f "SoundSwitch.app" | head -1)
if [ -n "$SS_PID" ]; then
    echo "SoundSwitch already running (PID: $SS_PID)"
    echo "Attaching to existing process..."
else
    echo "SoundSwitch not running. Waiting for it to start..."
    echo "Launch SoundSwitch now."
    while [ -z "$SS_PID" ]; do
        sleep 1
        SS_PID=$(pgrep -f "SoundSwitch.app" | head -1)
    done
    echo "SoundSwitch started (PID: $SS_PID)"
    sleep 2
fi

echo ""
echo "Tracing USB calls... (Ctrl+C to stop)"
echo "======================================="

# Use dtrace to trace libusb function calls in the SoundSwitch process
# Key functions: libusb_bulk_transfer, libusb_control_transfer, libusb_open,
# libusb_claim_interface, libusb_set_configuration, libusb_set_interface_alt_setting
sudo dtrace -n '
pid$1::libusb_bulk_transfer:entry {
    printf("BULK_TRANSFER: handle=%p endpoint=0x%02x data=%p length=%d timeout=%d",
        arg0, arg1, arg2, arg3, arg4);
    /* Print first 32 bytes of data */
    tracemem(copyin(arg2, arg3 < 64 ? arg3 : 64), 64);
}

pid$1::libusb_bulk_transfer:return {
    printf("BULK_TRANSFER returned: %d", arg1);
}

pid$1::libusb_control_transfer:entry {
    printf("CONTROL_TRANSFER: handle=%p bmRequestType=0x%02x bRequest=0x%02x wValue=0x%04x wIndex=0x%04x wLength=%d",
        arg0, arg1, arg2, arg3, arg4, arg5);
}

pid$1::libusb_control_transfer:return {
    printf("CONTROL_TRANSFER returned: %d", arg1);
}

pid$1::libusb_open:entry {
    printf("OPEN: device=%p", arg0);
}

pid$1::libusb_open:return {
    printf("OPEN returned: %d", arg1);
}

pid$1::libusb_claim_interface:entry {
    printf("CLAIM_INTERFACE: handle=%p interface=%d", arg0, arg1);
}

pid$1::libusb_set_configuration:entry {
    printf("SET_CONFIGURATION: handle=%p config=%d", arg0, arg1);
}

pid$1::libusb_set_interface_alt_setting:entry {
    printf("SET_ALT_SETTING: handle=%p interface=%d alt=%d", arg0, arg1, arg2);
}

pid$1::libusb_release_interface:entry {
    printf("RELEASE_INTERFACE: handle=%p interface=%d", arg0, arg1);
}

pid$1::libusb_close:entry {
    printf("CLOSE: handle=%p", arg0);
}

pid$1::libusb_reset_device:entry {
    printf("RESET_DEVICE: handle=%p", arg0);
}

pid$1::libusb_clear_halt:entry {
    printf("CLEAR_HALT: handle=%p endpoint=0x%02x", arg0, arg1);
}
' "$SS_PID"
