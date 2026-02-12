#!/usr/bin/env python3
"""Use macOS IOKit USB API directly to bypass libusb endpoint validation.
IOKit's IOUSBDeviceInterface has WritePipeTO which takes a pipe ref,
and we can try to directly access pipe 2.
"""
import ctypes
import ctypes.util
import struct
import time
import sys

# Load IOKit framework
iokit = ctypes.CDLL("/System/Library/Frameworks/IOKit.framework/IOKit")
cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")

# Constants
kIOUSBFindInterfaceDontCare = 0xFFFF
kIOReturnSuccess = 0
kUSBOut = 0
kUSBBulk = 2

# IOKit matching
kCFAllocatorDefault = None
kIOMainPortDefault = 0  # Renamed from kIOMasterPortDefault

# Types
mach_port_t = ctypes.c_uint
io_object_t = ctypes.c_uint
io_iterator_t = ctypes.c_uint
io_service_t = ctypes.c_uint
kern_return_t = ctypes.c_int
IOReturn = ctypes.c_int

# Set up function signatures
iokit.IOServiceMatching.restype = ctypes.c_void_p
iokit.IOServiceMatching.argtypes = [ctypes.c_char_p]

iokit.IOServiceGetMatchingServices.restype = kern_return_t
iokit.IOServiceGetMatchingServices.argtypes = [mach_port_t, ctypes.c_void_p, ctypes.POINTER(io_iterator_t)]

iokit.IOIteratorNext.restype = io_object_t
iokit.IOIteratorNext.argtypes = [io_iterator_t]

iokit.IOObjectRelease.restype = kern_return_t
iokit.IOObjectRelease.argtypes = [io_object_t]

iokit.IORegistryEntryGetName.restype = kern_return_t
iokit.IORegistryEntryGetName.argtypes = [io_service_t, ctypes.c_char_p]

# CFNumber helpers
cf.CFNumberGetValue.restype = ctypes.c_bool
cf.CFNumberGetValue.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]

iokit.IORegistryEntryCreateCFProperty.restype = ctypes.c_void_p
iokit.IORegistryEntryCreateCFProperty.argtypes = [io_service_t, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint]

cf.CFStringCreateWithCString.restype = ctypes.c_void_p
cf.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint]

cf.CFRelease.argtypes = [ctypes.c_void_p]

print("=== IOKit USB Direct Access ===")

# Find USB devices matching our VID/PID
matching = iokit.IOServiceMatching(b"IOUSBHostDevice")
if not matching:
    print("Failed to create matching dict")
    sys.exit(1)

# Add VID/PID to matching dict (via CF)
kCFStringEncodingASCII = 0x0600
vid_key = cf.CFStringCreateWithCString(None, b"idVendor", kCFStringEncodingASCII)
pid_key = cf.CFStringCreateWithCString(None, b"idProduct", kCFStringEncodingASCII)

# Create CFNumber for VID and PID
kCFNumberSInt32Type = 3
vid_val = ctypes.c_int32(0x15E4)
vid_cf = cf.CFNumberCreate(None, kCFNumberSInt32Type, ctypes.byref(vid_val))
pid_val = ctypes.c_int32(0x0053)
pid_cf = cf.CFNumberCreate(None, kCFNumberSInt32Type, ctypes.byref(pid_val))

cf.CFNumberCreate = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p)

# Just iterate all USB devices and find ours
iterator = io_iterator_t()
result = iokit.IOServiceGetMatchingServices(0, matching, ctypes.byref(iterator))
if result != 0:
    print(f"IOServiceGetMatchingServices failed: {result}")
    sys.exit(1)

target_service = None
name_buf = ctypes.create_string_buffer(128)
while True:
    service = iokit.IOIteratorNext(iterator)
    if not service:
        break
    iokit.IORegistryEntryGetName(service, name_buf)
    name = name_buf.value.decode()

    # Get idVendor
    vid_key_cf = cf.CFStringCreateWithCString(None, b"idVendor", 0x0600)
    vid_prop = iokit.IORegistryEntryCreateCFProperty(service, vid_key_cf, None, 0)
    cf.CFRelease(vid_key_cf)

    if vid_prop:
        vid = ctypes.c_int32()
        cf.CFNumberGetValue(vid_prop, 3, ctypes.byref(vid))
        cf.CFRelease(vid_prop)

        if vid.value == 0x15E4:
            print(f"Found device: {name} (VID=0x{vid.value:04x})")
            target_service = service
            continue

    iokit.IOObjectRelease(service)

if not target_service:
    print("Device not found!")
    sys.exit(1)

# Get the IOUSBHostDevice interface
# We need to create a plugin interface to the device
# This requires IOCreatePlugInInterfaceForService

# Define the UUID for IOUSBDeviceInterface
# kIOUSBDeviceUserClientTypeID = "9dc7b780-9ec0-11d4-a54f-000a27052861"
# kIOCFPlugInInterfaceID = "C244E858-109C-11D4-91D4-0050E4C6426F"

# For simplicity, let's just use IOKit to check device properties
# and try to find if there's a way to submit transfers

# Check all properties
print("\nDevice properties:")
for prop_name in [b"idVendor", b"idProduct", b"USB Product Name", b"kUSBCurrentConfiguration",
                   b"bDeviceClass", b"bNumConfigurations", b"locationID"]:
    key = cf.CFStringCreateWithCString(None, prop_name, 0x0600)
    val = iokit.IORegistryEntryCreateCFProperty(target_service, key, None, 0)
    cf.CFRelease(key)
    if val:
        # Try to read as number
        num = ctypes.c_int64()
        if cf.CFNumberGetValue(val, 4, ctypes.byref(num)):  # kCFNumberSInt64Type
            print(f"  {prop_name.decode()}: {num.value} (0x{num.value:x})")
        cf.CFRelease(val)

# Check children (interfaces/endpoints)
print("\nLooking for child interfaces...")
child_iterator = io_iterator_t()
result = iokit.IORegistryEntryGetChildIterator(target_service, b"IOService", ctypes.byref(child_iterator))

iokit.IORegistryEntryGetChildIterator.restype = kern_return_t
iokit.IORegistryEntryGetChildIterator.argtypes = [io_service_t, ctypes.c_char_p, ctypes.POINTER(io_iterator_t)]

result = iokit.IORegistryEntryGetChildIterator(target_service, b"IOService", ctypes.byref(child_iterator))
if result == 0:
    while True:
        child = iokit.IOIteratorNext(child_iterator)
        if not child:
            break
        iokit.IORegistryEntryGetName(child, name_buf)
        print(f"  Child: {name_buf.value.decode()}")

        # Look for endpoint info
        for prop in [b"bInterfaceNumber", b"bAlternateSetting", b"bNumEndpoints",
                     b"bInterfaceClass", b"Preferred Configuration"]:
            key = cf.CFStringCreateWithCString(None, prop, 0x0600)
            val = iokit.IORegistryEntryCreateCFProperty(child, key, None, 0)
            cf.CFRelease(key)
            if val:
                num = ctypes.c_int64()
                if cf.CFNumberGetValue(val, 4, ctypes.byref(num)):
                    print(f"    {prop.decode()}: {num.value}")
                cf.CFRelease(val)

        # Check for grandchildren (endpoints)
        gc_iterator = io_iterator_t()
        result2 = iokit.IORegistryEntryGetChildIterator(child, b"IOService", ctypes.byref(gc_iterator))
        if result2 == 0:
            while True:
                gc = iokit.IOIteratorNext(gc_iterator)
                if not gc:
                    break
                iokit.IORegistryEntryGetName(gc, name_buf)
                print(f"      Endpoint: {name_buf.value.decode()}")

                for prop in [b"bEndpointAddress", b"bmAttributes", b"wMaxPacketSize"]:
                    key = cf.CFStringCreateWithCString(None, prop, 0x0600)
                    val = iokit.IORegistryEntryCreateCFProperty(gc, key, None, 0)
                    cf.CFRelease(key)
                    if val:
                        num = ctypes.c_int64()
                        if cf.CFNumberGetValue(val, 4, ctypes.byref(num)):
                            print(f"        {prop.decode()}: {num.value} (0x{num.value:x})")
                        cf.CFRelease(val)

                iokit.IOObjectRelease(gc)

        iokit.IOObjectRelease(child)

iokit.IOObjectRelease(target_service)
print("\nDone!")
