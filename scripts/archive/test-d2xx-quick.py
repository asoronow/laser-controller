#!/usr/bin/env python3
"""Quick D2XX test - fast fail, no hanging."""
import ctypes, sys, time

LIB = "/Applications/SoundSwitch.app/Contents/Frameworks/libftd2xx.1.4.24.dylib"
d2xx = ctypes.CDLL(LIB)
DWORD = ctypes.c_ulong
HANDLE = ctypes.c_void_p
UCHAR = ctypes.c_ubyte
USHORT = ctypes.c_ushort

# Register VID/PID
d2xx.FT_SetVIDPID(DWORD(0x15E4), DWORD(0x0053))

# Enumerate
n = DWORD(0)
d2xx.FT_CreateDeviceInfoList(ctypes.byref(n))
print(f"Devices found: {n.value}")
if n.value == 0:
    print("No device. Plug in adapter and close SoundSwitch.")
    sys.exit(1)

# Device info
flags = DWORD(0)
dtype = DWORD(0)
did = DWORD(0)
lid = DWORD(0)
serial = ctypes.create_string_buffer(64)
desc = ctypes.create_string_buffer(64)
h = HANDLE(0)
d2xx.FT_GetDeviceInfoDetail(DWORD(0), ctypes.byref(flags), ctypes.byref(dtype),
    ctypes.byref(did), ctypes.byref(lid), serial, desc, ctypes.byref(h))
print(f"Flags: 0x{flags.value:x}  Type: {dtype.value}  Serial: {serial.value}  Desc: {desc.value}")
if flags.value & 1:
    print("ERROR: Device already opened by another process! Close SoundSwitch and replug.")
    sys.exit(1)

# Open
handle = HANDLE(0)
st = d2xx.FT_Open(DWORD(0), ctypes.byref(handle))
if st != 0:
    print(f"FT_Open FAILED: {st}")
    sys.exit(1)
print(f"Opened! handle={handle.value}")

# Configure DMX: 250k 8N2
d2xx.FT_ResetDevice(handle)
d2xx.FT_SetBaudRate(handle, DWORD(250000))
d2xx.FT_SetDataCharacteristics(handle, UCHAR(8), UCHAR(2), UCHAR(0))
d2xx.FT_SetFlowControl(handle, USHORT(0), UCHAR(0), UCHAR(0))
d2xx.FT_ClrRts(handle)
d2xx.FT_SetDtr(handle)
d2xx.FT_Purge(handle, DWORD(3))
d2xx.FT_SetLatencyTimer(handle, UCHAR(2))
d2xx.FT_SetTimeouts(handle, DWORD(500), DWORD(500))
print("Configured: 250000 8N2")

# Send 100 DMX frames - standard format with break
dmx = bytearray(513)
dmx[0] = 0x00   # start code
dmx[1] = 255    # CH1 dimmer
dmx[2] = 225    # CH2 manual mode
dmx[5] = 255    # CH5 red
written = DWORD(0)

print("\n>>> SENDING 100 DMX FRAMES - WATCH LASER <<<")
for i in range(100):
    d2xx.FT_SetBreakOn(handle)
    time.sleep(0.0001)
    d2xx.FT_SetBreakOff(handle)
    time.sleep(0.000012)
    buf = (ctypes.c_ubyte * len(dmx))(*dmx)
    st = d2xx.FT_Write(handle, buf, DWORD(len(dmx)), ctypes.byref(written))
    if i == 0:
        print(f"  Frame 0: status={st} written={written.value}")
    if st != 0:
        print(f"  Frame {i} FAILED: {st}")
        break
    time.sleep(0.025)
print("Done sending.")

# Blackout + close
bl = (ctypes.c_ubyte * 513)(*bytearray(513))
d2xx.FT_SetBreakOn(handle)
time.sleep(0.0001)
d2xx.FT_SetBreakOff(handle)
time.sleep(0.000012)
d2xx.FT_Write(handle, bl, DWORD(513), ctypes.byref(written))
d2xx.FT_Close(handle)
print("Closed. Did the laser respond?")
