#!/usr/bin/env python3
"""Test DMX over CDC protocol - using SEND_BREAK for DMX break signal.
DISCOVERY: The device handles CDC SET_CONTROL_LINE_STATE and SEND_BREAK!
This means DMX break should be via control transfer, not inline data.

Run: python3 scripts/test-cdc-dmx.py
"""
import usb.core
import usb.util
import time
import sys

dev = usb.core.find(idVendor=0x15E4, idProduct=0x0053)
if not dev:
    print("Device not found!")
    sys.exit(1)

print(f"Found: {dev.product}")

try:
    if dev.is_kernel_driver_active(0):
        dev.detach_kernel_driver(0)
except:
    pass

dev.set_configuration(1)
usb.util.claim_interface(dev, 0)
dev.set_interface_altsetting(0, 0)

# CDC control transfer helpers
def set_line_state(dtr, rts):
    val = (1 if dtr else 0) | (2 if rts else 0)
    dev.ctrl_transfer(0x21, 0x22, val, 0, timeout=200)

def send_break(duration_ms=0):
    """CDC SEND_BREAK: duration in ms. 0=end break, 0xFFFF=until told to stop."""
    dev.ctrl_transfer(0x21, 0x23, duration_ms, 0, timeout=200)

# DMX frame: 513 bytes (start code + 512 channels)
dmx = bytearray(513)
dmx[0] = 0x00   # DMX start code
dmx[1] = 255    # CH1: master dimmer
dmx[2] = 225    # CH2: manual mode
dmx[5] = 255    # CH5: red
dmx[9] = 128    # CH9: x position center
dmx[10] = 128   # CH10: y position center

# Same but 512 bytes (no start code)
dmx_nosc = dmx[1:]

# SoundSwitch format: 514 bytes (512 DMX + 2 LED bytes)
dmx_ss = bytearray(514)
dmx_ss[0] = 255    # CH1: master dimmer
dmx_ss[1] = 225    # CH2: manual mode
dmx_ss[4] = 255    # CH5: red
dmx_ss[8] = 128    # CH9: x pos
dmx_ss[9] = 128    # CH10: y pos
dmx_ss[512] = 0xFF # LED1
dmx_ss[513] = 0xFF # LED2

print("\n=== Protocol 1: SEND_BREAK(start) → data → SEND_BREAK(stop) ===")
print("    Like a UART break: assert break, release, send data")
set_line_state(True, False)  # DTR on
time.sleep(0.01)

for frame_num in range(200):
    # Start break (hold line low)
    send_break(0xFFFF)  # infinite break
    time.sleep(0.000100)  # 100us break
    # End break (MAB)
    send_break(0)
    time.sleep(0.000012)  # 12us MAB
    # Send DMX data
    dev.write(0x01, dmx, timeout=500)
    time.sleep(0.023)  # ~40Hz
    if frame_num == 0:
        print("  First frame sent! >>> WATCH LASER (5 sec) <<<")
print("  Done (200 frames)")

print("\n=== Protocol 2: SEND_BREAK(1ms) then data ===")
print("    Timed break: 1ms break, then immediate data")
for frame_num in range(200):
    send_break(1)  # 1ms break
    time.sleep(0.001)  # wait for break to complete
    dev.write(0x01, dmx, timeout=500)
    time.sleep(0.023)
    if frame_num == 0:
        print("  First frame sent! >>> WATCH LASER <<<")
print("  Done (200 frames)")

print("\n=== Protocol 3: No start code, BREAK between frames ===")
for frame_num in range(200):
    send_break(0xFFFF)
    time.sleep(0.0001)
    send_break(0)
    time.sleep(0.000012)
    dev.write(0x01, dmx_nosc, timeout=500)
    time.sleep(0.023)
    if frame_num == 0:
        print("  First frame sent! >>> WATCH LASER <<<")
print("  Done (200 frames)")

print("\n=== Protocol 4: SoundSwitch 514B format with BREAK ===")
for frame_num in range(200):
    send_break(0xFFFF)
    time.sleep(0.0001)
    send_break(0)
    time.sleep(0.000012)
    dev.write(0x01, dmx_ss, timeout=500)
    time.sleep(0.023)
    if frame_num == 0:
        print("  First frame sent! >>> WATCH LASER <<<")
print("  Done (200 frames)")

print("\n=== Protocol 5: DTR toggle as break ===")
for frame_num in range(200):
    set_line_state(False, False)  # DTR off = break
    time.sleep(0.0001)
    set_line_state(True, False)   # DTR on = mark
    time.sleep(0.000012)
    dev.write(0x01, dmx, timeout=500)
    time.sleep(0.023)
    if frame_num == 0:
        print("  First frame sent! >>> WATCH LASER <<<")
print("  Done (200 frames)")

print("\n=== Protocol 6: RTS toggle as break ===")
for frame_num in range(200):
    set_line_state(True, True)   # RTS on = break
    time.sleep(0.0001)
    set_line_state(True, False)  # RTS off = mark
    time.sleep(0.000012)
    dev.write(0x01, dmx, timeout=500)
    time.sleep(0.023)
    if frame_num == 0:
        print("  First frame sent! >>> WATCH LASER <<<")
print("  Done (200 frames)")

print("\n=== Protocol 7: Continuous data only (5ms gaps like SoundSwitch) ===")
print("    No break signal at all - maybe break is automatic?")
set_line_state(True, True)
for frame_num in range(200):
    dev.write(0x01, dmx_ss, timeout=500)
    time.sleep(0.005)
    if frame_num == 0:
        print("  First frame sent! >>> WATCH LASER <<<")
print("  Done (200 frames)")

print("\n=== Protocol 8: BREAK on, wait, data, BREAK off ===")
print("    Reversed order: break AFTER data")
set_line_state(True, False)
for frame_num in range(200):
    dev.write(0x01, dmx, timeout=500)
    send_break(0xFFFF)
    time.sleep(0.0001)
    send_break(0)
    time.sleep(0.023)
    if frame_num == 0:
        print("  First frame sent! >>> WATCH LASER <<<")
print("  Done (200 frames)")

# Blackout
print("\n=== Blackout ===")
blackout = bytearray(513)
for _ in range(10):
    send_break(0xFFFF)
    time.sleep(0.0001)
    send_break(0)
    time.sleep(0.000012)
    dev.write(0x01, blackout, timeout=500)
    time.sleep(0.025)

usb.util.dispose_resources(dev)
print("\nDone! Did any protocol make the laser/LED respond?")
