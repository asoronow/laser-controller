#!/usr/bin/env node
// discover-device.mjs — Find the SoundSwitch Micro DMX USB hardware
// Run: node scripts/discover-device.mjs
//
// Discovers the raw USB device through three independent methods:
// 1. ioreg (macOS IORegistry) — works even if SoundSwitch has the device
// 2. libusb enumeration — gets full descriptors if device is unclaimed
// 3. Process check — reports if SoundSwitch app is blocking access

import { execSync } from "child_process";
import { usb } from "usb";

const VID = 0x15e4;
const PID = 0x0053;

const result = {
  found: false,
  claimed_by: null,
  vid: null,
  pid: null,
  serial: null,
  product: null,
  speed: null,
  endpoints: [],
  interface_class: null,
  recommended_action: null,
};

// ── Method 1: ioreg ──
console.log("=== Method 1: ioreg (IORegistry) ===\n");
try {
  const ioreg = execSync("ioreg -p IOUSB -l -w 0", { encoding: "utf-8" });
  const lines = ioreg.split("\n");

  let inDevice = false;
  let deviceBlock = [];

  for (const line of lines) {
    if (line.includes("SoundSwitch") || line.includes("0x15e4") || line.includes("15E4")) {
      inDevice = true;
    }
    if (inDevice) {
      deviceBlock.push(line);
      if (line.includes("}")) {
        inDevice = false;
      }
    }
  }

  if (deviceBlock.length > 0) {
    const block = deviceBlock.join("\n");
    result.found = true;

    const vidMatch = block.match(/"idVendor"\s*=\s*(\d+)/);
    const pidMatch = block.match(/"idProduct"\s*=\s*(\d+)/);
    const serialMatch = block.match(/"USB Serial Number"\s*=\s*"([^"]+)"/);
    const productMatch = block.match(/"USB Product Name"\s*=\s*"([^"]+)"/);
    const speedMatch = block.match(/"USBSpeed"\s*=\s*(\d+)/);

    if (vidMatch) result.vid = `0x${parseInt(vidMatch[1]).toString(16).padStart(4, "0")}`;
    if (pidMatch) result.pid = `0x${parseInt(pidMatch[1]).toString(16).padStart(4, "0")}`;
    if (serialMatch) result.serial = serialMatch[1];
    if (productMatch) result.product = productMatch[1];
    if (speedMatch) {
      const speeds = { 0: "Low (1.5 Mbps)", 1: "Full (12 Mbps)", 2: "High (480 Mbps)", 3: "Super (5 Gbps)" };
      result.speed = speeds[parseInt(speedMatch[1])] || `Unknown (${speedMatch[1]})`;
    }

    console.log(`  Product:  ${result.product}`);
    console.log(`  VID:      ${result.vid}`);
    console.log(`  PID:      ${result.pid}`);
    console.log(`  Serial:   ${result.serial}`);
    console.log(`  Speed:    ${result.speed}`);
  } else {
    console.log("  Device NOT found in ioreg. Is it plugged in?");
  }
} catch (e) {
  console.log(`  ioreg failed: ${e.message}`);
}

// ── Method 2: libusb enumeration ──
console.log("\n=== Method 2: libusb enumeration ===\n");
try {
  const devices = usb.getDeviceList();
  const ssDev = devices.find(
    (d) => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );

  if (!ssDev) {
    console.log("  Device not visible to libusb.");
    if (result.found) {
      console.log("  (ioreg sees it — another process likely has exclusive access)");
    }
  } else {
    result.found = true;
    const desc = ssDev.deviceDescriptor;
    console.log(`  VID: 0x${desc.idVendor.toString(16).padStart(4, "0")}`);
    console.log(`  PID: 0x${desc.idProduct.toString(16).padStart(4, "0")}`);
    console.log(`  Device Class: ${desc.bDeviceClass}`);
    console.log(`  Max Packet Size: ${desc.bMaxPacketSize0}`);

    try {
      ssDev.open();
      const config = ssDev.configDescriptor;
      console.log(`\n  Configuration ${config.bConfigurationValue}:`);

      for (const iface of config.interfaces) {
        for (const alt of iface) {
          const classNames = {
            0: "Composite/Per-Interface",
            2: "CDC (Serial)",
            3: "HID",
            255: "Vendor Specific",
          };
          result.interface_class = alt.bInterfaceClass;
          console.log(`    Interface ${alt.bInterfaceNumber} (Alt ${alt.bAlternateSetting}):`);
          console.log(`      Class: ${alt.bInterfaceClass} (${classNames[alt.bInterfaceClass] || "Unknown"})`);
          console.log(`      SubClass: ${alt.bInterfaceSubClass}  Protocol: ${alt.bInterfaceProtocol}`);

          if (alt.endpoints && alt.endpoints.length > 0) {
            for (const ep of alt.endpoints) {
              const dir = ep.direction === "in" ? "IN" : "OUT";
              const types = ["CONTROL", "ISOCHRONOUS", "BULK", "INTERRUPT"];
              const type = types[ep.transferType] || "UNKNOWN";
              const epInfo = {
                address: `0x${ep.address.toString(16).padStart(2, "0")}`,
                direction: dir,
                type,
                maxPacket: ep.packetSize,
              };
              result.endpoints.push(epInfo);
              console.log(`      EP ${epInfo.address}: ${dir} ${type} maxPacket=${ep.packetSize}`);
            }
          } else {
            console.log("      (no endpoints exposed in descriptor)");
          }
        }
      }

      // Read string descriptors
      const readString = (idx) =>
        new Promise((resolve) => {
          if (!idx) return resolve(null);
          ssDev.getStringDescriptor(idx, (err, str) => resolve(err ? null : str));
        });

      const mfr = await readString(desc.iManufacturer);
      const prod = await readString(desc.iProduct);
      const ser = await readString(desc.iSerialNumber);
      if (mfr) console.log(`\n  Manufacturer: ${mfr}`);
      if (prod) console.log(`  Product: ${prod}`);
      if (ser) console.log(`  Serial: ${ser}`);

      ssDev.close();
    } catch (e) {
      console.log(`  Cannot open device: ${e.message}`);
      if (e.message.includes("BUSY") || e.message.includes("ACCESS")) {
        console.log("  (Device is claimed by another process)");
      }
    }
  }
} catch (e) {
  console.log(`  libusb failed: ${e.message}`);
}

// ── Method 3: Process check ──
console.log("\n=== Method 3: Process check ===\n");
try {
  const ps = execSync("pgrep -f 'SoundSwitch.app/Contents/MacOS/SoundSwitch$' 2>/dev/null", { encoding: "utf-8" }).trim();
  if (ps) {
    const pid = ps.split("\n")[0].trim();
    result.claimed_by = `SoundSwitch (PID ${pid})`;
    console.log(`  SoundSwitch is RUNNING (PID ${pid})`);
    console.log(`  This process has exclusive USB access.`);
    console.log(`  Kill it with: kill ${pid}`);
  }
} catch {
  console.log("  SoundSwitch is NOT running. Device should be available.");
}

// ── Summary ──
console.log("\n=== Summary ===\n");

if (result.found) {
  if (result.claimed_by) {
    result.recommended_action = `Kill SoundSwitch first: kill $(pgrep -f SoundSwitch)`;
  } else {
    result.recommended_action = "Device is available. Run test-dmx-d2xx.mjs to send DMX.";
  }
} else {
  result.recommended_action = "Plug in the SoundSwitch Micro DMX adapter and check the blue LED.";
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.found ? 0 : 1);
