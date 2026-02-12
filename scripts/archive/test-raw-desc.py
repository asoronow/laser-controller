#!/usr/bin/env python3
"""Dump raw USB config descriptor and try EP 0x02 after proper init."""
import usb.core
import usb.util
import usb.backend.libusb1
import time
import sys

dev = usb.core.find(idVendor=0x15E4, idProduct=0x0053)
if not dev:
    print("Device not found!")
    sys.exit(1)

print(f"Device: {dev.manufacturer} - {dev.product}")
print(f"Serial: {dev.serial_number}")
print(f"bDeviceClass: {dev.bDeviceClass}")
print(f"bNumConfigurations: {dev.bNumConfigurations}")

# Dump raw config descriptor
print("\n=== Raw Config Descriptor ===")
try:
    # GET_DESCRIPTOR for config (type=2, index=0)
    raw = dev.ctrl_transfer(0x80, 0x06, 0x0200, 0, 256)
    print(f"  Length: {len(raw)} bytes")
    print(f"  Hex: {raw.tobytes().hex()}")
    # Parse key fields
    print(f"  bLength: {raw[0]}")
    print(f"  bDescriptorType: {raw[1]}")
    total_len = raw[2] | (raw[3] << 8)
    print(f"  wTotalLength: {total_len}")
    print(f"  bNumInterfaces: {raw[4]}")
    print(f"  bConfigurationValue: {raw[5]}")

    # Walk through descriptors
    i = raw[0]  # skip config descriptor
    while i < len(raw):
        dlen = raw[i]
        dtype = raw[i+1] if i+1 < len(raw) else 0
        if dlen == 0:
            break
        desc_bytes = raw[i:i+dlen]
        if dtype == 4:  # Interface
            print(f"\n  Interface Descriptor @ offset {i}:")
            print(f"    bInterfaceNumber: {desc_bytes[2]}")
            print(f"    bAlternateSetting: {desc_bytes[3]}")
            print(f"    bNumEndpoints: {desc_bytes[4]}")
            print(f"    bInterfaceClass: {desc_bytes[5]}")
            print(f"    bInterfaceSubClass: {desc_bytes[6]}")
            print(f"    bInterfaceProtocol: {desc_bytes[7]}")
        elif dtype == 5:  # Endpoint
            print(f"  Endpoint Descriptor @ offset {i}:")
            ep_addr = desc_bytes[2]
            ep_attr = desc_bytes[3]
            ep_maxpkt = desc_bytes[4] | (desc_bytes[5] << 8)
            ep_dir = "IN" if ep_addr & 0x80 else "OUT"
            ep_type = ["Control", "Isochronous", "Bulk", "Interrupt"][ep_attr & 3]
            print(f"    bEndpointAddress: 0x{ep_addr:02x} ({ep_dir})")
            print(f"    bmAttributes: 0x{ep_attr:02x} ({ep_type})")
            print(f"    wMaxPacketSize: {ep_maxpkt}")
        else:
            print(f"  Unknown Descriptor @ offset {i}: type={dtype} len={dlen} data={desc_bytes.tobytes().hex()}")
        i += dlen
except Exception as e:
    print(f"  Error: {e}")

# Try to detach kernel driver if any
print("\n=== Detach kernel driver ===")
for iface in range(2):
    try:
        if dev.is_kernel_driver_active(iface):
            dev.detach_kernel_driver(iface)
            print(f"  Detached kernel driver from interface {iface}")
        else:
            print(f"  No kernel driver on interface {iface}")
    except Exception as e:
        print(f"  Interface {iface}: {e}")

# Set configuration
print("\n=== Init sequence (matching SoundSwitch) ===")
try:
    dev.set_configuration(1)
    print("  set_configuration(1): OK")
except Exception as e:
    print(f"  set_configuration(1): {e}")

# Claim and set alt setting
cfg = dev.get_active_configuration()
print(f"  Active config: {cfg.bConfigurationValue}")
print(f"  Num interfaces: {cfg.bNumInterfaces}")

for iface in cfg:
    print(f"\n  Interface {iface.bInterfaceNumber} alt {iface.bAlternateSetting}:")
    print(f"    Class: {iface.bInterfaceClass}")
    print(f"    Endpoints: {iface.bNumEndpoints}")
    for ep in iface:
        print(f"    EP 0x{ep.bEndpointAddress:02x}: {usb.util.endpoint_type(ep.bmAttributes)} maxPkt={ep.wMaxPacketSize}")

try:
    usb.util.claim_interface(dev, 0)
    print("\n  claim_interface(0): OK")
except Exception as e:
    print(f"\n  claim_interface(0): {e}")

try:
    dev.set_interface_altsetting(0, 0)
    print("  set_interface_altsetting(0, 0): OK")
except Exception as e:
    print(f"  set_interface_altsetting(0, 0): {e}")

# Re-read config after alt setting
print("\n=== Re-read after alt setting ===")
time.sleep(0.1)
cfg2 = dev.get_active_configuration()
for iface in cfg2:
    print(f"  Interface {iface.bInterfaceNumber} alt {iface.bAlternateSetting}:")
    for ep in iface:
        print(f"    EP 0x{ep.bEndpointAddress:02x}: maxPkt={ep.wMaxPacketSize}")

# Try raw control transfer to get descriptor again
print("\n=== Re-read raw config descriptor ===")
try:
    raw2 = dev.ctrl_transfer(0x80, 0x06, 0x0200, 0, 256)
    print(f"  Length: {len(raw2)} bytes")
    print(f"  Hex: {raw2.tobytes().hex()}")
except Exception as e:
    print(f"  Error: {e}")

# Try writing to EP 0x02 directly
print("\n=== Try writes ===")
dmx = bytearray(514)
dmx[0] = 255   # CH1 dimmer
dmx[1] = 225   # CH2 manual mode
dmx[4] = 255   # CH5 red
dmx[512] = 0xFF  # LED byte 1
dmx[513] = 0xFF  # LED byte 2

for ep_addr in [0x01, 0x02]:
    try:
        written = dev.write(ep_addr, dmx, timeout=1000)
        print(f"  EP 0x{ep_addr:02x}: wrote {written} bytes OK")
    except Exception as e:
        print(f"  EP 0x{ep_addr:02x}: {e}")

# Try sending multiple frames to EP 0x01
print("\n=== Sending 50 frames to EP 0x01 (watch laser!) ===")
for i in range(50):
    try:
        dev.write(0x01, dmx, timeout=500)
    except:
        print(f"  Frame {i} failed")
        break
    time.sleep(0.025)
print("  Done.")

usb.util.dispose_resources(dev)
print("\nDone!")
