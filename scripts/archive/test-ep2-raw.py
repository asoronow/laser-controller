#!/usr/bin/env python3
"""Bypass pyusb endpoint validation - write to EP 0x02 via raw libusb ctypes.
pyusb's dev.write() validates EP against descriptor. We bypass that here.
"""
import ctypes
import ctypes.util
import time
import sys

# Find and load libusb
lib_path = ctypes.util.find_library("usb-1.0")
if not lib_path:
    import glob
    paths = glob.glob("/opt/homebrew/lib/libusb-1.0*dylib") + glob.glob("/usr/local/lib/libusb-1.0*dylib")
    lib_path = paths[0] if paths else None
if not lib_path:
    print("libusb not found!")
    sys.exit(1)

usb = ctypes.CDLL(lib_path)
print(f"libusb: {lib_path}")

# Set up function prototypes
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
rc = usb.libusb_init(ctypes.byref(ctx))
assert rc == 0, f"init failed: {rc}"

# Open device
handle = usb.libusb_open_device_with_vid_pid(ctx, 0x15E4, 0x0053)
if not handle:
    print("Device not found!")
    usb.libusb_exit(ctx)
    sys.exit(1)
print("Device opened")

# Setup
usb.libusb_detach_kernel_driver(handle, 0)
rc = usb.libusb_set_configuration(handle, 1)
print(f"set_configuration(1): {rc}")
rc = usb.libusb_claim_interface(handle, 0)
print(f"claim_interface(0): {rc}")
rc = usb.libusb_set_interface_alt_setting(handle, 0, 0)
print(f"set_alt_setting(0,0): {rc}")

def bulk_write(ep, data, timeout=500):
    buf = (ctypes.c_ubyte * len(data))(*data)
    actual = ctypes.c_int(0)
    rc = usb.libusb_bulk_transfer(handle, ctypes.c_ubyte(ep), buf, len(data), ctypes.byref(actual), timeout)
    return rc, actual.value

def send_break(duration):
    return usb.libusb_control_transfer(handle, 0x21, 0x23, duration, 0, None, 0, 200)

def set_dtr_rts(dtr, rts):
    val = (1 if dtr else 0) | (2 if rts else 0)
    return usb.libusb_control_transfer(handle, 0x21, 0x22, val, 0, None, 0, 200)

# DMX frame
dmx = bytearray(513)
dmx[0] = 0x00
dmx[1] = 255    # CH1 dimmer
dmx[2] = 225    # CH2 manual mode
dmx[5] = 255    # CH5 red

# =============================================
print("\n=== RAW libusb EP 0x02 bulk transfer ===")
# This bypasses ALL pyusb/node-usb validation!
# =============================================

# Test EP 0x01 first as baseline
rc, actual = bulk_write(0x01, dmx)
err = usb.libusb_error_name(rc).decode() if rc != 0 else "OK"
print(f"EP 0x01 (513B): rc={rc} ({err}) actual={actual}")

# Now try EP 0x02!
rc, actual = bulk_write(0x02, dmx)
err = usb.libusb_error_name(rc).decode() if rc != 0 else "OK"
print(f"EP 0x02 (513B): rc={rc} ({err}) actual={actual}")

# Try EP 0x02 with different sizes
for size in [64, 512, 514]:
    data = bytearray(size)
    data[0] = 0xFF
    if size > 1: data[1] = 225
    rc, actual = bulk_write(0x02, data)
    err = usb.libusb_error_name(rc).decode() if rc != 0 else "OK"
    print(f"EP 0x02 ({size}B): rc={rc} ({err}) actual={actual}")

# If EP 0x02 works, send continuous frames!
if True:
    print("\n=== Sending to EP 0x02 with BREAK (if it works) ===")
    set_dtr_rts(True, False)

    success_count = 0
    for i in range(50):
        send_break(0xFFFF)
        time.sleep(0.0001)
        send_break(0)
        time.sleep(0.000012)
        rc, actual = bulk_write(0x02, dmx, timeout=200)
        if rc == 0:
            success_count += 1
        elif i == 0:
            err = usb.libusb_error_name(rc).decode()
            print(f"  EP 0x02 failed: {err}")
            break
        time.sleep(0.023)
    if success_count > 0:
        print(f"  EP 0x02: {success_count}/50 frames sent!")

# Try EP 0x01 with BREAK (in case previous CDC test worked but we didn't wait)
print("\n=== EP 0x01 with CDC BREAK - 5 second test ===")
set_dtr_rts(True, False)
time.sleep(0.01)

print(">>> WATCH THE LASER AND LED FOR 5 SECONDS <<<")
start = time.time()
count = 0
while time.time() - start < 5:
    send_break(0xFFFF)
    time.sleep(0.0001)
    send_break(0)
    time.sleep(0.000012)
    bulk_write(0x01, dmx, timeout=200)
    count += 1
    time.sleep(0.023)
print(f"  Sent {count} frames with BREAK to EP 0x01")

# Cleanup
usb.libusb_release_interface(handle, 0)
usb.libusb_close(handle)
usb.libusb_exit(ctx)
print("\nDone!")
