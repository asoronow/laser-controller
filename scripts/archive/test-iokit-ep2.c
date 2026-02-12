/*
 * Direct IOKit USB bulk transfer to EP 0x02.
 * Uses IOUSBDeviceInterface + IOUSBInterfaceInterface to try
 * submitting a bulk transfer with endpoint address 0x02.
 *
 * Compile: clang -o test-iokit-ep2 scripts/test-iokit-ep2.c -framework IOKit -framework CoreFoundation
 * Run: ./test-iokit-ep2
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <IOKit/IOKitLib.h>
#include <IOKit/usb/IOUSBLib.h>
#include <IOKit/IOCFPlugIn.h>
#include <CoreFoundation/CoreFoundation.h>

#define VID 0x15E4
#define PID 0x0053

int main(void) {
    kern_return_t kr;
    io_iterator_t iterator;
    io_service_t usbDevice;
    IOCFPlugInInterface **plugInInterface = NULL;
    IOUSBDeviceInterface **deviceInterface = NULL;
    IOUSBInterfaceInterface **interfaceInterface = NULL;
    SInt32 score;
    HRESULT result;

    printf("=== IOKit Direct USB EP 0x02 Test ===\n\n");

    /* Find the USB device */
    CFMutableDictionaryRef matchingDict = IOServiceMatching(kIOUSBDeviceClassName);
    if (!matchingDict) {
        printf("Can't create matching dict\n");
        return 1;
    }

    CFDictionarySetValue(matchingDict, CFSTR(kUSBVendorID),
        CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &(SInt32){VID}));
    CFDictionarySetValue(matchingDict, CFSTR(kUSBProductID),
        CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &(SInt32){PID}));

    kr = IOServiceGetMatchingServices(kIOMainPortDefault, matchingDict, &iterator);
    if (kr != KERN_SUCCESS) {
        printf("IOServiceGetMatchingServices failed: 0x%x\n", kr);
        return 1;
    }

    usbDevice = IOIteratorNext(iterator);
    IOObjectRelease(iterator);
    if (!usbDevice) {
        printf("Device not found!\n");
        return 1;
    }
    printf("Found device\n");

    /* Get device interface */
    kr = IOCreatePlugInInterfaceForService(usbDevice, kIOUSBDeviceUserClientTypeID,
        kIOCFPlugInInterfaceID, &plugInInterface, &score);
    IOObjectRelease(usbDevice);
    if (kr != KERN_SUCCESS || !plugInInterface) {
        printf("IOCreatePlugInInterface failed: 0x%x\n", kr);
        return 1;
    }

    result = (*plugInInterface)->QueryInterface(plugInInterface,
        CFUUIDGetUUIDBytes(kIOUSBDeviceInterfaceID),
        (LPVOID *)&deviceInterface);
    (*plugInInterface)->Release(plugInInterface);
    if (result || !deviceInterface) {
        printf("QueryInterface failed\n");
        return 1;
    }
    printf("Got device interface\n");

    /* Open device */
    kr = (*deviceInterface)->USBDeviceOpen(deviceInterface);
    if (kr != kIOReturnSuccess) {
        printf("USBDeviceOpen failed: 0x%x\n", kr);
        /* Try exclusive access */
        kr = (*deviceInterface)->USBDeviceOpenSeize(deviceInterface);
        if (kr != kIOReturnSuccess) {
            printf("USBDeviceOpenSeize also failed: 0x%x\n", kr);
            (*deviceInterface)->Release(deviceInterface);
            return 1;
        }
    }
    printf("Device opened\n");

    /* Set configuration */
    kr = (*deviceInterface)->SetConfiguration(deviceInterface, 1);
    printf("SetConfiguration(1): 0x%x\n", kr);

    /* Find interface */
    IOUSBFindInterfaceRequest request;
    request.bInterfaceClass = kIOUSBFindInterfaceDontCare;
    request.bInterfaceSubClass = kIOUSBFindInterfaceDontCare;
    request.bInterfaceProtocol = kIOUSBFindInterfaceDontCare;
    request.bAlternateSetting = kIOUSBFindInterfaceDontCare;

    kr = (*deviceInterface)->CreateInterfaceIterator(deviceInterface, &request, &iterator);
    if (kr != kIOReturnSuccess) {
        printf("CreateInterfaceIterator failed: 0x%x\n", kr);
        (*deviceInterface)->USBDeviceClose(deviceInterface);
        (*deviceInterface)->Release(deviceInterface);
        return 1;
    }

    io_service_t usbInterface = IOIteratorNext(iterator);
    IOObjectRelease(iterator);
    if (!usbInterface) {
        printf("No interface found!\n");
        (*deviceInterface)->USBDeviceClose(deviceInterface);
        (*deviceInterface)->Release(deviceInterface);
        return 1;
    }

    /* Get interface interface */
    kr = IOCreatePlugInInterfaceForService(usbInterface, kIOUSBInterfaceUserClientTypeID,
        kIOCFPlugInInterfaceID, &plugInInterface, &score);
    IOObjectRelease(usbInterface);
    if (kr != kIOReturnSuccess) {
        printf("IOCreatePlugIn for interface failed: 0x%x\n", kr);
        (*deviceInterface)->USBDeviceClose(deviceInterface);
        (*deviceInterface)->Release(deviceInterface);
        return 1;
    }

    result = (*plugInInterface)->QueryInterface(plugInInterface,
        CFUUIDGetUUIDBytes(kIOUSBInterfaceInterfaceID),
        (LPVOID *)&interfaceInterface);
    (*plugInInterface)->Release(plugInInterface);
    if (result || !interfaceInterface) {
        printf("QueryInterface for interface failed\n");
        (*deviceInterface)->USBDeviceClose(deviceInterface);
        (*deviceInterface)->Release(deviceInterface);
        return 1;
    }
    printf("Got interface interface\n");

    /* Open interface */
    kr = (*interfaceInterface)->USBInterfaceOpen(interfaceInterface);
    printf("USBInterfaceOpen: 0x%x\n", kr);

    /* Get endpoint info */
    UInt8 numEndpoints;
    kr = (*interfaceInterface)->GetNumEndpoints(interfaceInterface, &numEndpoints);
    printf("NumEndpoints: %d (kr=0x%x)\n", numEndpoints, kr);

    for (UInt8 i = 1; i <= numEndpoints; i++) {
        UInt8 direction, number, transferType, interval;
        UInt16 maxPacketSize;
        kr = (*interfaceInterface)->GetPipeProperties(interfaceInterface, i,
            &direction, &number, &transferType, &maxPacketSize, &interval);
        printf("  Pipe %d: direction=%d number=%d type=%d maxPkt=%d (kr=0x%x)\n",
            i, direction, number, transferType, maxPacketSize, kr);
    }

    /* Try writing to pipe 1 (EP 0x01) */
    UInt8 dmx[514];
    memset(dmx, 0, sizeof(dmx));
    dmx[0] = 255;    /* CH1: dimmer */
    dmx[1] = 225;    /* CH2: manual mode */
    dmx[4] = 255;    /* CH5: red */
    dmx[512] = 0xFF; /* LED1 */
    dmx[513] = 0xFF; /* LED2 */

    printf("\n--- Writing to pipe 1 (EP 0x01) ---\n");
    kr = (*interfaceInterface)->WritePipe(interfaceInterface, 1, dmx, sizeof(dmx));
    printf("WritePipe(1): 0x%x (%s)\n", kr, kr == kIOReturnSuccess ? "OK" : "FAIL");

    /* Try writing to pipe 2 (doesn't exist but let's see what happens) */
    printf("\n--- Writing to pipe 2 (EP 0x02 - doesn't exist) ---\n");
    kr = (*interfaceInterface)->WritePipe(interfaceInterface, 2, dmx, sizeof(dmx));
    printf("WritePipe(2): 0x%x (%s)\n", kr, kr == kIOReturnSuccess ? "OK" : "FAIL");

    /* Try writing continuously to pipe 1 */
    printf("\n--- Sending 200 frames to pipe 1 (5 sec) ---\n");
    printf(">>> WATCH THE LASER AND LED <<<\n");
    for (int i = 0; i < 200; i++) {
        kr = (*interfaceInterface)->WritePipe(interfaceInterface, 1, dmx, sizeof(dmx));
        if (kr != kIOReturnSuccess && i == 0) {
            printf("  WritePipe failed: 0x%x\n", kr);
            break;
        }
        usleep(25000); /* 25ms = 40Hz */
    }
    printf("  Done\n");

    /* Cleanup */
    (*interfaceInterface)->USBInterfaceClose(interfaceInterface);
    (*interfaceInterface)->Release(interfaceInterface);
    (*deviceInterface)->USBDeviceClose(deviceInterface);
    (*deviceInterface)->Release(deviceInterface);

    printf("\nDone!\n");
    return 0;
}
