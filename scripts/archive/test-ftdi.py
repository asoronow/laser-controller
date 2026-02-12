#!/usr/bin/env python3
"""Test SoundSwitch Micro DMX via FTDI D2XX / pyftdi
The device has VID 0x15E4, PID 0x0053.
SoundSwitch app uses libftd2xx which communicates via IOKit on macOS.
pyftdi wraps libusb but handles FTDI devices with proper endpoint mapping.

Run: python3 scripts/test-ftdi.py
IMPORTANT: Unplug+replug adapter, close SoundSwitch first!
"""

import sys
import time

# First, try pyftdi which understands FTDI protocol
print("=== Test 1: pyftdi (FTDI protocol layer) ===\n")
try:
    from pyftdi.ftdi import Ftdi

    # Add custom VID/PID so pyftdi recognizes it
    Ftdi.add_custom_vendor(0x15E4, "SoundSwitch")
    Ftdi.add_custom_product(0x15E4, 0x0053, "Micro DMX")

    # List devices
    print("Scanning for FTDI devices...")
    devices = Ftdi.list_devices()
    print(f"  Found {len(devices)} device(s)")
    for d in devices:
        print(f"  {d}")

    if devices:
        # Try to open
        ftdi = Ftdi()
        print("\nOpening device...")
        ftdi.open(0x15E4, 0x0053)
        print("  OK!")

        # Configure for DMX512: 250000 baud, 8N2
        print("Configuring for DMX512 (250000 baud, 8N2)...")
        ftdi.set_baudrate(250000)
        ftdi.set_line_property(8, 2, 'N')  # 8 data, 2 stop, no parity
        ftdi.set_flowctrl('')  # no flow control
        ftdi.set_latency_timer(2)
        ftdi.purge_buffers()
        print("  OK!")

        # Send DMX frames
        print("\nSending DMX frames for 5 seconds... WATCH THE LASER!")
        frame = bytes([0x00] + [0] * 512)  # start code + 512 channels
        # Set CH1=255 (dimmer), CH2=225 (manual), CH5=255 (red)
        dmx = bytearray(frame)
        dmx[1] = 255   # CH1
        dmx[2] = 225   # CH2 manual mode
        dmx[5] = 255   # CH5 red

        for i in range(200):
            # Send break
            ftdi.set_break(True)
            time.sleep(0.001)  # 1ms break
            ftdi.set_break(False)
            time.sleep(0.001)  # 1ms MAB

            # Send DMX frame
            ftdi.write_data(bytes(dmx))
            time.sleep(0.020)  # ~50Hz

            if i == 0:
                print("  First frame sent!")

        print("  Done!")

        # Blackout
        print("Blackout...")
        ftdi.set_break(True)
        time.sleep(0.001)
        ftdi.set_break(False)
        time.sleep(0.001)
        ftdi.write_data(bytes(513))

        ftdi.close()
        print("Device closed.")
    else:
        print("  No FTDI devices found via pyftdi")

except Exception as e:
    print(f"  pyftdi error: {e}")

# Test 2: Try pyusb with direct endpoint access
print("\n=== Test 2: pyusb direct bulk transfer to EP 0x02 ===\n")
try:
    import usb.core
    import usb.util

    dev = usb.core.find(idVendor=0x15E4, idProduct=0x0053)
    if dev is None:
        print("  Device not found (may be claimed by previous test)")
        sys.exit(0)

    print(f"  Found: {dev.manufacturer} - {dev.product}")
    print(f"  Serial: {dev.serial_number}")

    # Set configuration
    dev.set_configuration(1)
    print("  set_configuration(1): OK")

    # Claim interface
    cfg = dev.get_active_configuration()
    intf = cfg[(0, 0)]
    print(f"  Interface: class={intf.bInterfaceClass} endpoints={intf.bNumEndpoints}")

    # List endpoints
    for ep in intf:
        print(f"    EP 0x{ep.bEndpointAddress:02x} {'IN' if ep.bEndpointAddress & 0x80 else 'OUT'} "
              f"type={ep.bmAttributes & 0x03} maxPacket={ep.wMaxPacketSize}")

    # Try set_interface_altsetting
    dev.set_interface_altsetting(interface=0, alternate_setting=0)
    print("  set_interface_altsetting(0, 0): OK")

    # Re-check endpoints
    cfg = dev.get_active_configuration()
    intf = cfg[(0, 0)]
    for ep in intf:
        print(f"    EP 0x{ep.bEndpointAddress:02x} {'IN' if ep.bEndpointAddress & 0x80 else 'OUT'} "
              f"type={ep.bmAttributes & 0x03} maxPacket={ep.wMaxPacketSize}")

    # DMX frame
    dmx = bytearray(514)
    dmx[0] = 255   # CH1 dimmer
    dmx[1] = 225   # CH2 manual
    dmx[4] = 255   # CH5 red
    dmx[512] = 0xFF  # LED
    dmx[513] = 0xFF  # LED

    # Try writing to EP 0x01
    print("\n  Writing 514 bytes to EP 0x01...")
    try:
        for i in range(100):
            dev.write(0x01, bytes(dmx))
            time.sleep(0.01)
            if i == 0: print("    OK, sending for 3 sec...")
        print("    Done")
    except Exception as e:
        print(f"    Error: {e}")

    # Try writing to EP 0x02 (what SoundSwitch uses)
    print("\n  Writing 514 bytes to EP 0x02...")
    try:
        for i in range(100):
            dev.write(0x02, bytes(dmx))
            time.sleep(0.01)
            if i == 0: print("    OK, sending for 3 sec... WATCH LASER!")
        print("    Done")
    except Exception as e:
        print(f"    Error: {e}")

    # Try writing 512 bytes to EP 0x02
    print("\n  Writing 512 bytes to EP 0x02...")
    try:
        dev.write(0x02, bytes(dmx[:512]))
        print("    OK!")
    except Exception as e:
        print(f"    Error: {e}")

    usb.util.dispose_resources(dev)
    print("\nDone.")

except Exception as e:
    print(f"  pyusb error: {e}")
