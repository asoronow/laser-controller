#!/usr/bin/env python3
"""Fuzz SoundSwitch Micro DMX STM32 - find activation sequence."""
import usb.core
import usb.util
import struct
import time
import sys

dev = usb.core.find(idVendor=0x15E4, idProduct=0x0053)
if not dev:
    print("Device not found! Replug adapter, close SoundSwitch.")
    sys.exit(1)

print(f"Found: {dev.manufacturer} - {dev.product}")

# Detach kernel driver
try:
    if dev.is_kernel_driver_active(0):
        dev.detach_kernel_driver(0)
        print("Detached kernel driver")
except:
    pass

dev.set_configuration(1)
usb.util.claim_interface(dev, 0)
dev.set_interface_altsetting(0, 0)
print("Configured: config=1, iface=0, alt=0\n")

def ep_write(ep, data, label=""):
    try:
        n = dev.write(ep, data, timeout=300)
        if label:
            print(f"  OK {label}: {n}B written")
        return True
    except Exception as e:
        if label:
            print(f"  FAIL {label}: {e}")
        return False

def ctrl_out(bmReq, bReq, wVal, wIdx, data=None, label=""):
    try:
        r = dev.ctrl_transfer(bmReq, bReq, wVal, wIdx, data, timeout=200)
        if label:
            print(f"  OK {label}: {r}")
        return True
    except Exception as e:
        if label:
            print(f"  FAIL {label}: {e}")
        return False

def ctrl_in(bmReq, bReq, wVal, wIdx, length=64, label=""):
    try:
        r = dev.ctrl_transfer(bmReq | 0x80, bReq, wVal, wIdx, length, timeout=200)
        if label:
            print(f"  OK {label}: {bytes(r).hex()}")
        return bytes(r)
    except Exception as e:
        if label:
            print(f"  FAIL {label}: {e}")
        return None

# Standard DMX frame for testing response
dmx513 = bytearray(513)
dmx513[0] = 0x00   # start code
dmx513[1] = 255    # CH1 dimmer
dmx513[2] = 225    # CH2 manual mode
dmx513[5] = 255    # CH5 red

dmx514 = bytearray(514)
dmx514[0] = 255    # CH1
dmx514[1] = 225    # CH2
dmx514[4] = 255    # CH5
dmx514[512] = 0xFF # LED1
dmx514[513] = 0xFF # LED2

# ============================================================
print("=== 1. Vendor control transfers (activate device?) ===")
for req in range(16):
    for val in [0, 1, 2, 0xFF]:
        ctrl_out(0x40, req, val, 0, label=f"vendor req={req} val=0x{val:x}")

# ============================================================
print("\n=== 2. CDC class requests ===")
# SET_LINE_CODING (0x20) - configure serial port
line_250k = struct.pack('<IBBB', 250000, 2, 0, 8)
ctrl_out(0x21, 0x20, 0, 0, data=line_250k, label="SET_LINE_CODING 250000/8N2")

line_9600 = struct.pack('<IBBB', 9600, 0, 0, 8)
ctrl_out(0x21, 0x20, 0, 0, data=line_9600, label="SET_LINE_CODING 9600/8N1")

# GET_LINE_CODING (0x21)
ctrl_in(0xA1, 0x21, 0, 0, 7, label="GET_LINE_CODING")

# SET_CONTROL_LINE_STATE (0x22) - DTR/RTS
ctrl_out(0x21, 0x22, 0x00, 0, label="SET_CTRL_LINE_STATE DTR=0 RTS=0")
ctrl_out(0x21, 0x22, 0x01, 0, label="SET_CTRL_LINE_STATE DTR=1")
ctrl_out(0x21, 0x22, 0x02, 0, label="SET_CTRL_LINE_STATE RTS=1")
ctrl_out(0x21, 0x22, 0x03, 0, label="SET_CTRL_LINE_STATE DTR=1 RTS=1")

# SEND_BREAK (0x23)
ctrl_out(0x21, 0x23, 0, 0, label="SEND_BREAK(0)")
ctrl_out(0x21, 0x23, 100, 0, label="SEND_BREAK(100us)")
ctrl_out(0x21, 0x23, 0xFFFF, 0, label="SEND_BREAK(infinite)")

# ============================================================
print("\n=== 3. Read from device (any IN endpoint?) ===")
for ep in [0x81, 0x82, 0x83]:
    try:
        data = dev.read(ep, 64, timeout=200)
        print(f"  EP 0x{ep:02x}: {len(data)}B = {bytes(data).hex()}")
    except Exception as e:
        print(f"  EP 0x{ep:02x}: {e}")

# ============================================================
print("\n=== 4. Magic activation bytes on EP 0x01 ===")
tests = [
    ("single 0x00", bytes([0x00])),
    ("single 0x01", bytes([0x01])),
    ("single 0xFF", bytes([0xFF])),
    ("UART sync 0x55", bytes([0x55])),
    ("STM32 boot 0x7F", bytes([0x7F])),
    ("2B enable", bytes([0x01, 0x01])),
    ("DMX\\0 header", b"DMX\x00"),
    ("SSDMX header", b"SSDMX"),
    ("SS activate", b"SS\x01\x00"),
    ("4B all FF", bytes([0xFF, 0xFF, 0xFF, 0xFF])),
    ("0xBEEF cmd", bytes([0xBE, 0xEF, 0x01, 0x00])),
    ("0xA55A sync", bytes([0xA5, 0x5A, 0x01])),
    ("init 0xDEAD", bytes([0xDE, 0xAD, 0x00, 0x01])),
    ("len+data 2+512", struct.pack('<H', 512) + bytes([0xFF]*512)),
    ("Enttec Pro 0x7E", bytes([0x7E, 0x06]) + struct.pack('<H', 513) + bytes(513) + bytes([0xE7])),
]
for name, data in tests:
    ep_write(0x01, data, label=f"{name} ({len(data)}B)")

# ============================================================
print("\n=== 5. Activate then send DMX frames ===")
print("  (Watch the laser/LED after each init sequence!)")

activate_then_dmx = [
    ("after 0x01 init", [bytes([0x01])]),
    ("after 0xFF init", [bytes([0xFF])]),
    ("after 0x00 init", [bytes([0x00])]),
    ("after 64B zeros", [bytes(64)]),
    ("after 64B 0xFF", [bytes([0xFF]*64)]),
    ("after 3x 0x00", [bytes([0x00]), bytes([0x00]), bytes([0x00])]),
    ("after CDC DTR+RTS then DMX", None),  # special
]

for name, init_pkts in activate_then_dmx:
    if init_pkts is None:
        # Try CDC init then DMX
        ctrl_out(0x21, 0x22, 0x03, 0)  # DTR+RTS
        time.sleep(0.01)
    else:
        for pkt in init_pkts:
            if len(pkt) > 0:
                ep_write(0x01, pkt)
            time.sleep(0.005)

    # Send 30 DMX frames
    for i in range(30):
        ep_write(0x01, dmx514)
        time.sleep(0.025)
    print(f"  Sent: {name} + 30 DMX frames")
    time.sleep(0.1)

# ============================================================
print("\n=== 6. Different DMX frame sizes/formats ===")
sizes_formats = [
    ("1 byte", bytearray([0xFF])),
    ("2 bytes", bytearray([0xFF, 0xFF])),
    ("64 bytes (maxpkt)", bytearray([0xFF]*64)),
    ("128 bytes", bytearray([0xFF]*128)),
    ("256 bytes", bytearray([0xFF]*256)),
    ("512 bytes (no start code)", bytearray([0xFF]*512)),
    ("513 bytes (with start code)", dmx513),
    ("514 bytes (SS format)", dmx514),
    ("576 bytes (SS buffer size)", bytearray([0xFF]*576)),
    ("64B with CH1=255 only", bytearray([255]) + bytearray(63)),
]
for name, data in sizes_formats:
    for i in range(10):
        ep_write(0x01, data)
        time.sleep(0.025)
    print(f"  Sent 10x: {name}")

# ============================================================
print("\n=== 7. Try EP 0x02 direct (may fail) ===")
ep_write(0x02, dmx514, label="EP 0x02 514B")
ep_write(0x02, dmx513, label="EP 0x02 513B")
ep_write(0x02, bytes([0xFF]*64), label="EP 0x02 64B")

# ============================================================
print("\n=== 8. Continuous send test (10 seconds) ===")
print("  Sending 514B frames to EP 0x01 for 10 seconds...")
print("  >>> WATCH THE LASER AND LED <<<")
start = time.time()
count = 0
while time.time() - start < 10:
    ep_write(0x01, dmx514)
    count += 1
    time.sleep(0.005)  # 5ms like SoundSwitch
print(f"  Sent {count} frames in 10 seconds")

# Cleanup
usb.util.dispose_resources(dev)
print("\nDone! Did anything happen?")
