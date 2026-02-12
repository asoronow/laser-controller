#!/usr/bin/env python3
"""Use libftd2xx's INTERNAL libusb (not system libusb) to write to EP 0x02.
SoundSwitch imports libusb from libftd2xx.dylib, which has a PATCHED version
that bypasses macOS IOKit endpoint validation!
"""
import ctypes
import time
import sys

# Load libftd2xx which contains its OWN patched libusb
LIB = "/Applications/SoundSwitch.app/Contents/Frameworks/libftd2xx.1.4.24.dylib"
lib = ctypes.CDLL(LIB)
print(f"Loaded: {LIB}")

# Set up function prototypes for libusb functions INSIDE libftd2xx
lib.libusb_init.argtypes = [ctypes.POINTER(ctypes.c_void_p)]
lib.libusb_init.restype = ctypes.c_int

lib.libusb_exit.argtypes = [ctypes.c_void_p]

lib.libusb_get_device_list.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))]
lib.libusb_get_device_list.restype = ctypes.c_ssize_t

lib.libusb_free_device_list.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_int]

lib.libusb_open_device_with_vid_pid.argtypes = [ctypes.c_void_p, ctypes.c_uint16, ctypes.c_uint16]
lib.libusb_open_device_with_vid_pid.restype = ctypes.c_void_p

lib.libusb_close.argtypes = [ctypes.c_void_p]

lib.libusb_detach_kernel_driver.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.libusb_detach_kernel_driver.restype = ctypes.c_int

lib.libusb_set_configuration.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.libusb_set_configuration.restype = ctypes.c_int

lib.libusb_claim_interface.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.libusb_claim_interface.restype = ctypes.c_int

lib.libusb_set_interface_alt_setting.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
lib.libusb_set_interface_alt_setting.restype = ctypes.c_int

lib.libusb_release_interface.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.libusb_release_interface.restype = ctypes.c_int

lib.libusb_bulk_transfer.argtypes = [ctypes.c_void_p, ctypes.c_ubyte, ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.c_uint]
lib.libusb_bulk_transfer.restype = ctypes.c_int

lib.libusb_control_transfer.argtypes = [ctypes.c_void_p, ctypes.c_uint8, ctypes.c_uint8, ctypes.c_uint16, ctypes.c_uint16, ctypes.c_void_p, ctypes.c_uint16, ctypes.c_uint]
lib.libusb_control_transfer.restype = ctypes.c_int

lib.libusb_error_name.argtypes = [ctypes.c_int]
lib.libusb_error_name.restype = ctypes.c_char_p

# Also register custom VID/PID with D2XX layer
lib.FT_SetVIDPID.argtypes = [ctypes.c_ulong, ctypes.c_ulong]
lib.FT_SetVIDPID.restype = ctypes.c_ulong

# Register VID/PID with D2XX
st = lib.FT_SetVIDPID(0x15E4, 0x0053)
print(f"FT_SetVIDPID: {st}")

# Init libusb (inside libftd2xx)
ctx = ctypes.c_void_p()
rc = lib.libusb_init(ctypes.byref(ctx))
print(f"libusb_init: {rc}")
assert rc == 0

# Open device
handle = lib.libusb_open_device_with_vid_pid(ctx, 0x15E4, 0x0053)
if not handle:
    print("Device not found!")
    lib.libusb_exit(ctx)
    sys.exit(1)
print(f"Device opened! handle={handle}")

# Detach kernel driver
lib.libusb_detach_kernel_driver(handle, 0)

# Configure (matching SoundSwitch SSV1DMX::configure())
rc = lib.libusb_set_configuration(handle, 1)
print(f"set_configuration(1): {rc}")

rc = lib.libusb_claim_interface(handle, 0)
print(f"claim_interface(0): {rc}")

rc = lib.libusb_set_interface_alt_setting(handle, 0, 0)
print(f"set_alt_setting(0,0): {rc}")

def bulk_write(ep, data, timeout=500):
    buf = (ctypes.c_ubyte * len(data))(*data)
    actual = ctypes.c_int(0)
    rc = lib.libusb_bulk_transfer(handle, ctypes.c_ubyte(ep), buf, len(data), ctypes.byref(actual), timeout)
    return rc, actual.value

# DMX frame
dmx = bytearray(514)
dmx[0] = 255    # CH1: master dimmer
dmx[1] = 225    # CH2: manual mode
dmx[4] = 255    # CH5: red
dmx[8] = 128    # CH9: x pos
dmx[9] = 128    # CH10: y pos
dmx[512] = 0xFF # LED1
dmx[513] = 0xFF # LED2

# Test EP 0x01 first
print("\n=== EP 0x01 test ===")
rc, actual = bulk_write(0x01, dmx)
err = lib.libusb_error_name(rc).decode() if rc != 0 else "OK"
print(f"EP 0x01 (514B): rc={rc} ({err}) actual={actual}")

# Now the BIG test: EP 0x02 via FTDI's patched libusb!
print("\n=== EP 0x02 test (via libftd2xx's libusb!) ===")
rc, actual = bulk_write(0x02, dmx)
err = lib.libusb_error_name(rc).decode() if rc != 0 else "OK"
print(f"EP 0x02 (514B): rc={rc} ({err}) actual={actual}")

if rc == 0:
    print("\n!!! EP 0x02 WORKS via libftd2xx's libusb! !!!")
    print(">>> SENDING DMX TO EP 0x02 FOR 10 SECONDS - WATCH LASER <<<")
    start = time.time()
    count = 0
    while time.time() - start < 10:
        # Match SoundSwitch: sleep(5ms) then write
        time.sleep(0.005)
        rc, _ = bulk_write(0x02, dmx, timeout=0)  # timeout=0 like SoundSwitch
        if rc != 0:
            print(f"  Write failed at frame {count}: {lib.libusb_error_name(rc).decode()}")
            break
        count += 1
    print(f"  Sent {count} frames to EP 0x02")
else:
    print(f"\n  EP 0x02 failed. Trying EP 0x01 with SoundSwitch timing...")
    print(">>> SENDING DMX TO EP 0x01 FOR 10 SECONDS - WATCH LASER <<<")
    start = time.time()
    count = 0
    while time.time() - start < 10:
        time.sleep(0.005)
        bulk_write(0x01, dmx, timeout=0)
        count += 1
    print(f"  Sent {count} frames to EP 0x01")

# Blackout
print("\n=== Blackout ===")
blackout = bytearray(514)
for _ in range(10):
    bulk_write(0x02 if rc == 0 else 0x01, blackout, timeout=100)
    time.sleep(0.005)

# Cleanup
lib.libusb_release_interface(handle, 0)
lib.libusb_close(handle)
lib.libusb_exit(ctx)
print("\nDone!")
