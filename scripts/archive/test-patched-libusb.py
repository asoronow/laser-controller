#!/usr/bin/env python3
"""Test with PATCHED libusb that maps EP 0x02 → pipe 1 (EP 0x01).
This simulates what SoundSwitch does: write to EP 0x02.
"""
import ctypes
import time
import sys

# Load our PATCHED libusb (not the system one!)
PATCHED_LIB = "/tmp/libusb-patched/libusb/.libs/libusb-1.0.0.dylib"
usb = ctypes.CDLL(PATCHED_LIB)
print(f"Loaded PATCHED libusb: {PATCHED_LIB}")

# Function prototypes
usb.libusb_init.argtypes = [ctypes.POINTER(ctypes.c_void_p)]
usb.libusb_init.restype = ctypes.c_int
usb.libusb_exit.argtypes = [ctypes.c_void_p]
usb.libusb_open_device_with_vid_pid.argtypes = [ctypes.c_void_p, ctypes.c_uint16, ctypes.c_uint16]
usb.libusb_open_device_with_vid_pid.restype = ctypes.c_void_p
usb.libusb_close.argtypes = [ctypes.c_void_p]
usb.libusb_detach_kernel_driver.argtypes = [ctypes.c_void_p, ctypes.c_int]
usb.libusb_detach_kernel_driver.restype = ctypes.c_int
usb.libusb_set_configuration.argtypes = [ctypes.c_void_p, ctypes.c_int]
usb.libusb_set_configuration.restype = ctypes.c_int
usb.libusb_claim_interface.argtypes = [ctypes.c_void_p, ctypes.c_int]
usb.libusb_claim_interface.restype = ctypes.c_int
usb.libusb_set_interface_alt_setting.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
usb.libusb_set_interface_alt_setting.restype = ctypes.c_int
usb.libusb_release_interface.argtypes = [ctypes.c_void_p, ctypes.c_int]
usb.libusb_release_interface.restype = ctypes.c_int
usb.libusb_bulk_transfer.argtypes = [ctypes.c_void_p, ctypes.c_ubyte, ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.c_uint]
usb.libusb_bulk_transfer.restype = ctypes.c_int
usb.libusb_control_transfer.argtypes = [ctypes.c_void_p, ctypes.c_uint8, ctypes.c_uint8, ctypes.c_uint16, ctypes.c_uint16, ctypes.c_void_p, ctypes.c_uint16, ctypes.c_uint]
usb.libusb_control_transfer.restype = ctypes.c_int
usb.libusb_error_name.argtypes = [ctypes.c_int]
usb.libusb_error_name.restype = ctypes.c_char_p

# Init
ctx = ctypes.c_void_p()
assert usb.libusb_init(ctypes.byref(ctx)) == 0

# Open
handle = usb.libusb_open_device_with_vid_pid(ctx, 0x15E4, 0x0053)
if not handle:
    print("Device not found!")
    usb.libusb_exit(ctx)
    sys.exit(1)
print("Device opened")

# Setup (matching SoundSwitch SSV1DMX::configure)
usb.libusb_detach_kernel_driver(handle, 0)
rc = usb.libusb_set_configuration(handle, 1)
print(f"set_config(1): {rc}")
rc = usb.libusb_claim_interface(handle, 0)
print(f"claim(0): {rc}")
rc = usb.libusb_set_interface_alt_setting(handle, 0, 0)
print(f"set_alt(0,0): {rc}")

def bulk_write(ep, data, timeout=0):
    buf = (ctypes.c_ubyte * len(data))(*data)
    actual = ctypes.c_int(0)
    rc = usb.libusb_bulk_transfer(handle, ctypes.c_ubyte(ep), buf, len(data), ctypes.byref(actual), timeout)
    return rc, actual.value

# SoundSwitch format: 514 bytes (512 DMX + 2 LED)
dmx = bytearray(514)
dmx[0] = 255    # CH1: dimmer
dmx[1] = 225    # CH2: manual mode
dmx[4] = 255    # CH5: red
dmx[8] = 128    # CH9: x pos
dmx[9] = 128    # CH10: y pos
dmx[512] = 0xFF # LED1
dmx[513] = 0xFF # LED2

# Test EP 0x01 (should work as before)
rc, actual = bulk_write(0x01, dmx, 500)
err = usb.libusb_error_name(rc).decode() if rc != 0 else "OK"
print(f"\nEP 0x01: rc={rc} ({err}) actual={actual}")

# Test EP 0x02 (should now be mapped to pipe 1 by our patch!)
rc, actual = bulk_write(0x02, dmx, 500)
err = usb.libusb_error_name(rc).decode() if rc != 0 else "OK"
print(f"EP 0x02: rc={rc} ({err}) actual={actual}")

if rc == 0:
    print("\n>>> EP 0x02 WORKS via patched libusb! <<<")
    print(">>> Sending DMX for 10 seconds (matching SoundSwitch protocol) <<<")
    print(">>> WATCH THE LASER AND LED! <<<\n")
    start = time.time()
    count = 0
    while time.time() - start < 10:
        time.sleep(0.005)  # 5ms delay like SoundSwitch
        rc, _ = bulk_write(0x02, dmx, 0)  # timeout=0 like SoundSwitch
        if rc != 0:
            print(f"  Frame {count} failed: {usb.libusb_error_name(rc).decode()}")
            break
        count += 1
    print(f"  Sent {count} frames to EP 0x02 via patched libusb")

# Blackout
bl = bytearray(514)
for _ in range(10):
    time.sleep(0.005)
    bulk_write(0x02 if rc == 0 else 0x01, bl, 100)

# Cleanup
usb.libusb_release_interface(handle, 0)
usb.libusb_close(handle)
usb.libusb_exit(ctx)
print("\nDone! Did the laser/LED respond?")
