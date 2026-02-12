import type { UsbDeviceInfo, UsbResponse } from "@/app/lib/types";

const USB_CLASS_LABELS: Record<number, string> = {
  0: "Composite",
  1: "Audio",
  2: "CDC (Serial)",
  3: "HID",
  5: "Physical",
  6: "Image",
  7: "Printer",
  8: "Mass Storage",
  9: "Hub",
  10: "CDC-Data",
  11: "Smart Card",
  13: "Content Security",
  14: "Video",
  15: "Personal Healthcare",
  16: "Audio/Video",
  220: "Diagnostic",
  224: "Wireless Controller",
  239: "Miscellaneous",
  254: "Application Specific",
  255: "Vendor Specific",
};

export async function POST() {
  try {
    const { usb } = await import("usb");
    const devices = usb.getDeviceList();

    const results: UsbDeviceInfo[] = devices.map((device) => {
      const desc = device.deviceDescriptor;
      let manufacturer: string | null = null;
      let product: string | null = null;
      let serialNumber: string | null = null;

      // String descriptor reading requires opening the device and uses callbacks.
      // Skip it for the scan — VID/PID and class are the important data.
      // The manufacturer/product fields will be null unless we enhance later.

      return {
        vendorId: desc.idVendor,
        productId: desc.idProduct,
        deviceClass: desc.bDeviceClass,
        deviceSubClass: desc.bDeviceSubClass,
        deviceProtocol: desc.bDeviceProtocol,
        manufacturer,
        product,
        serialNumber,
        busNumber: device.busNumber,
        deviceAddress: device.deviceAddress,
        classLabel: USB_CLASS_LABELS[desc.bDeviceClass] || `Unknown (${desc.bDeviceClass})`,
      };
    });

    const response: UsbResponse = { devices: results };
    return Response.json(response);
  } catch (err) {
    return Response.json(
      { error: `Failed to enumerate USB: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
