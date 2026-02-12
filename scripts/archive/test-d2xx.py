#!/usr/bin/env python3
"""Test SoundSwitch Micro DMX using FTDI D2XX driver directly via ctypes.
This uses the EXACT same libftd2xx.dylib that SoundSwitch bundles,
communicating via IOKit (not libusb), which is how SoundSwitch actually works.

Run: python3 scripts/test-d2xx.py
IMPORTANT: Close SoundSwitch first! Unplug+replug adapter if needed.
"""

import ctypes
import ctypes.util
import time
import sys

# D2XX constants
FT_OK = 0
FT_OPEN_BY_SERIAL_NUMBER = 1
FT_OPEN_BY_DESCRIPTION = 2
FT_BITS_8 = 8
FT_STOP_BITS_2 = 2
FT_PARITY_NONE = 0
FT_FLOW_NONE = 0x0000
FT_PURGE_RX = 1
FT_PURGE_TX = 2

# Load the D2XX library from SoundSwitch's frameworks
LIB_PATH = "/Applications/SoundSwitch.app/Contents/Frameworks/libftd2xx.1.4.24.dylib"

print("=== FTDI D2XX Direct Test (via SoundSwitch's libftd2xx) ===\n")

try:
    d2xx = ctypes.CDLL(LIB_PATH)
    print(f"Loaded: {LIB_PATH}")
except OSError as e:
    print(f"Failed to load library: {e}")
    sys.exit(1)

# Set up function signatures
FT_HANDLE = ctypes.c_void_p
FT_STATUS = ctypes.c_ulong
DWORD = ctypes.c_ulong
UCHAR = ctypes.c_ubyte
USHORT = ctypes.c_ushort
ULONG = ctypes.c_ulong

# Register custom VID/PID
print("\n--- Step 1: Register VID/PID ---")
status = d2xx.FT_SetVIDPID(DWORD(0x15E4), DWORD(0x0053))
print(f"  FT_SetVIDPID(0x15E4, 0x0053): status={status} {'OK' if status == FT_OK else 'FAIL'}")

# Create device info list
print("\n--- Step 2: Enumerate devices ---")
num_devs = DWORD(0)
status = d2xx.FT_CreateDeviceInfoList(ctypes.byref(num_devs))
print(f"  FT_CreateDeviceInfoList: status={status}, devices={num_devs.value}")

if num_devs.value == 0:
    print("  No devices found! Is the adapter plugged in? Is SoundSwitch closed?")
    sys.exit(1)

# Get device info
for i in range(num_devs.value):
    flags = DWORD(0)
    dev_type = DWORD(0)
    dev_id = DWORD(0)
    loc_id = DWORD(0)
    serial = ctypes.create_string_buffer(64)
    description = ctypes.create_string_buffer(64)
    handle = FT_HANDLE(0)

    status = d2xx.FT_GetDeviceInfoDetail(
        DWORD(i), ctypes.byref(flags), ctypes.byref(dev_type),
        ctypes.byref(dev_id), ctypes.byref(loc_id),
        serial, description, ctypes.byref(handle)
    )
    if status == FT_OK:
        print(f"  Device {i}:")
        print(f"    Flags: 0x{flags.value:08x}")
        print(f"    Type: {dev_type.value}")
        print(f"    ID: 0x{dev_id.value:08x}")
        print(f"    LocId: 0x{loc_id.value:08x}")
        print(f"    Serial: {serial.value.decode('utf-8', errors='replace')}")
        print(f"    Description: {description.value.decode('utf-8', errors='replace')}")

# Open device
print("\n--- Step 3: Open device ---")
handle = FT_HANDLE(0)

# Try open by index first
status = d2xx.FT_Open(DWORD(0), ctypes.byref(handle))
print(f"  FT_Open(0): status={status} {'OK' if status == FT_OK else 'FAIL'}")

if status != FT_OK:
    # Try by serial number
    serial_bytes = b"002E00215056430B20333639"
    status = d2xx.FT_OpenEx(serial_bytes, DWORD(FT_OPEN_BY_SERIAL_NUMBER), ctypes.byref(handle))
    print(f"  FT_OpenEx(serial): status={status} {'OK' if status == FT_OK else 'FAIL'}")

if status != FT_OK:
    # Try by description
    desc_bytes = b"SoundSwitch DMX Micro Interface"
    status = d2xx.FT_OpenEx(desc_bytes, DWORD(FT_OPEN_BY_DESCRIPTION), ctypes.byref(handle))
    print(f"  FT_OpenEx(description): status={status} {'OK' if status == FT_OK else 'FAIL'}")

if status != FT_OK:
    print("  FAILED to open device!")
    sys.exit(1)

print(f"  Handle: {handle.value}")

# Configure for DMX512
print("\n--- Step 4: Configure for DMX512 ---")

# Reset device
status = d2xx.FT_ResetDevice(handle)
print(f"  FT_ResetDevice: status={status}")

# Set baud rate: 250000 for DMX512
status = d2xx.FT_SetBaudRate(handle, DWORD(250000))
print(f"  FT_SetBaudRate(250000): status={status}")

# Set data characteristics: 8 data bits, 2 stop bits, no parity
status = d2xx.FT_SetDataCharacteristics(handle, UCHAR(FT_BITS_8), UCHAR(FT_STOP_BITS_2), UCHAR(FT_PARITY_NONE))
print(f"  FT_SetDataCharacteristics(8,2,N): status={status}")

# No flow control
status = d2xx.FT_SetFlowControl(handle, USHORT(FT_FLOW_NONE), UCHAR(0), UCHAR(0))
print(f"  FT_SetFlowControl(NONE): status={status}")

# Clear RTS (DMX doesn't use hardware flow control)
status = d2xx.FT_ClrRts(handle)
print(f"  FT_ClrRts: status={status}")

# Set DTR (some interfaces need this for TX enable)
status = d2xx.FT_SetDtr(handle)
print(f"  FT_SetDtr: status={status}")

# Purge buffers
status = d2xx.FT_Purge(handle, DWORD(FT_PURGE_RX | FT_PURGE_TX))
print(f"  FT_Purge: status={status}")

# Set latency timer (low for DMX)
status = d2xx.FT_SetLatencyTimer(handle, UCHAR(2))
print(f"  FT_SetLatencyTimer(2): status={status}")

# Set USB parameters (larger transfer size)
status = d2xx.FT_SetUSBParameters(handle, DWORD(65536), DWORD(65536))
print(f"  FT_SetUSBParameters: status={status}")

# Set timeouts
status = d2xx.FT_SetTimeouts(handle, DWORD(1000), DWORD(1000))
print(f"  FT_SetTimeouts(1000,1000): status={status}")


# Send DMX frames!
print("\n--- Step 5: Send DMX frames (WATCH THE LASER!) ---")

# DMX frame: start code (0x00) + 512 channels
# CH1=255 (dimmer), CH2=225 (manual mode), CH5=255 (red)
dmx_data = bytearray(513)
dmx_data[0] = 0x00  # DMX start code
dmx_data[1] = 255   # CH1: master dimmer
dmx_data[2] = 225   # CH2: manual mode
dmx_data[5] = 255   # CH5: red

bytes_written = DWORD(0)

print("  Sending 200 DMX frames (5 seconds)...")
for i in range(200):
    # DMX Break: set break on, wait, set break off
    status = d2xx.FT_SetBreakOn(handle)
    if status != FT_OK and i == 0:
        print(f"  WARNING: FT_SetBreakOn failed: status={status}")
    time.sleep(0.000100)  # 100us break (DMX spec: 88us min)

    status = d2xx.FT_SetBreakOff(handle)
    if status != FT_OK and i == 0:
        print(f"  WARNING: FT_SetBreakOff failed: status={status}")
    time.sleep(0.000012)  # 12us MAB (DMX spec: 8us min)

    # Send DMX frame
    data_buf = (ctypes.c_ubyte * len(dmx_data))(*dmx_data)
    status = d2xx.FT_Write(handle, data_buf, DWORD(len(dmx_data)), ctypes.byref(bytes_written))

    if i == 0:
        print(f"  First frame: status={status}, bytes_written={bytes_written.value}")
        if status == FT_OK:
            print("  >>> SENDING FOR 5 SECONDS - WATCH THE LASER! <<<")

    if status != FT_OK:
        print(f"  Frame {i} FAILED: status={status}")
        break

    time.sleep(0.023)  # ~40Hz DMX refresh

print("  Done sending.")

# Now try the SoundSwitch format: 514 bytes (512 DMX + 2 LED bytes)
print("\n--- Step 6: SoundSwitch format (514 bytes) ---")
ss_data = bytearray(514)
ss_data[0] = 255    # CH1: master dimmer
ss_data[1] = 225    # CH2: manual mode
ss_data[4] = 255    # CH5: red (0-indexed in 512-byte block)
ss_data[512] = 0xFF # LED byte 1
ss_data[513] = 0xFF # LED byte 2

print("  Sending 200 frames with SoundSwitch format...")
for i in range(200):
    # SoundSwitch consumePacket: sleep(5ms) then write
    time.sleep(0.005)

    data_buf = (ctypes.c_ubyte * len(ss_data))(*ss_data)
    status = d2xx.FT_Write(handle, data_buf, DWORD(len(ss_data)), ctypes.byref(bytes_written))

    if i == 0:
        print(f"  First frame: status={status}, bytes_written={bytes_written.value}")
        if status == FT_OK:
            print("  >>> SENDING - WATCH THE LASER AND LED! <<<")

    if status != FT_OK:
        print(f"  Frame {i} FAILED: status={status}")
        break

print("  Done sending.")

# Try with break signal + SoundSwitch format
print("\n--- Step 7: Break + SoundSwitch format (514 bytes) ---")
print("  Sending 200 frames...")
for i in range(200):
    d2xx.FT_SetBreakOn(handle)
    time.sleep(0.000100)
    d2xx.FT_SetBreakOff(handle)
    time.sleep(0.000012)

    data_buf = (ctypes.c_ubyte * len(ss_data))(*ss_data)
    status = d2xx.FT_Write(handle, data_buf, DWORD(len(ss_data)), ctypes.byref(bytes_written))

    if i == 0:
        print(f"  First frame: status={status}, bytes_written={bytes_written.value}")
        if status == FT_OK:
            print("  >>> SENDING - WATCH LASER! <<<")

    if status != FT_OK:
        print(f"  Frame {i} FAILED: status={status}")
        break

    time.sleep(0.020)

print("  Done sending.")

# Blackout
print("\n--- Blackout ---")
blackout = bytearray(514)
for _ in range(10):
    d2xx.FT_SetBreakOn(handle)
    time.sleep(0.0001)
    d2xx.FT_SetBreakOff(handle)
    time.sleep(0.000012)
    data_buf = (ctypes.c_ubyte * len(blackout))(*blackout)
    d2xx.FT_Write(handle, data_buf, DWORD(len(blackout)), ctypes.byref(bytes_written))
    time.sleep(0.025)

# Close
print("\n--- Cleanup ---")
status = d2xx.FT_Close(handle)
print(f"  FT_Close: status={status}")

print("\nDone! Did anything happen on the laser or LED?")
