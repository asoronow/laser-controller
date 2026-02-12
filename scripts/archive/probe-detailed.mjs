// probe-detailed.mjs — Detailed USB probe for SoundSwitch Micro DMX
// Run: node scripts/probe-detailed.mjs
// IMPORTANT: Close SoundSwitch app first! It holds exclusive USB access.

import { usb } from 'usb';
import { SerialPort } from 'serialport';

const VID = 0x15E4;
const PID = 0x0053;

console.log('=== SoundSwitch Micro DMX — Detailed USB Probe ===\n');

// Step 1: Check serial ports
console.log('--- Serial Ports ---');
try {
  const ports = await SerialPort.list();
  if (ports.length === 0) {
    console.log('No serial ports found.');
  } else {
    for (const p of ports) {
      const vid = p.vendorId || '????';
      const pid = p.productId || '????';
      const match = vid.toLowerCase() === '15e4' ? ' <<<< SOUNDSWITCH!' : '';
      console.log(`  ${p.path}  VID:${vid} PID:${pid}  ${p.manufacturer || ''}${match}`);
    }
  }
} catch (e) {
  console.log('  Serial port scan failed:', e.message);
}

// Step 2: USB device enumeration
console.log('\n--- USB Devices ---');
const devices = usb.getDeviceList();
const ssDevices = devices.filter(d => d.deviceDescriptor.idVendor === VID);

if (ssDevices.length === 0) {
  console.log(`No device found with VID 0x${VID.toString(16)}.`);
  console.log('Is the SoundSwitch Micro plugged in?');
  console.log('Is the SoundSwitch desktop app closed? (It claims exclusive access)');

  // Show all devices for debugging
  console.log('\nAll USB devices on bus:');
  for (const d of devices) {
    const desc = d.deviceDescriptor;
    console.log(`  VID:0x${desc.idVendor.toString(16).padStart(4,'0')} PID:0x${desc.idProduct.toString(16).padStart(4,'0')} Class:${desc.bDeviceClass} Bus:${d.busNumber} Addr:${d.deviceAddress}`);
  }
  process.exit(1);
}

const dev = ssDevices[0];
const desc = dev.deviceDescriptor;

console.log(`\nFound SoundSwitch Micro DMX!`);
console.log(`  VID: 0x${desc.idVendor.toString(16).padStart(4,'0')}`);
console.log(`  PID: 0x${desc.idProduct.toString(16).padStart(4,'0')}`);
console.log(`  Device Class: ${desc.bDeviceClass} (${desc.bDeviceClass === 0 ? 'Composite' : 'Unknown'})`);
console.log(`  USB Version: ${(desc.bcdUSB >> 8)}.${desc.bcdUSB & 0xff}`);
console.log(`  Max Packet Size: ${desc.bMaxPacketSize0}`);
console.log(`  Num Configurations: ${desc.bNumConfigurations}`);

// Step 3: Open device and dump descriptors
console.log('\n--- Interface Descriptors ---');
try {
  dev.open();

  const config = dev.configDescriptor;
  console.log(`Configuration ${config.bConfigurationValue}:`);
  console.log(`  Num Interfaces: ${config.interfaces.length}`);

  for (const iface of config.interfaces) {
    for (const alt of iface) {
      console.log(`\n  Interface ${alt.bInterfaceNumber} (Alt ${alt.bAlternateSetting}):`);
      console.log(`    Class: ${alt.bInterfaceClass} SubClass: ${alt.bInterfaceSubClass} Protocol: ${alt.bInterfaceProtocol}`);

      const classNames = {
        0: 'Reserved/Composite', 2: 'CDC (Serial)', 3: 'HID',
        8: 'Mass Storage', 255: 'Vendor Specific'
      };
      console.log(`    Class Name: ${classNames[alt.bInterfaceClass] || 'Unknown'}`);
      console.log(`    Endpoints: ${alt.endpoints.length}`);

      for (const ep of alt.endpoints) {
        const dir = ep.direction === 'in' ? 'IN' : 'OUT';
        const types = ['CONTROL', 'ISOCHRONOUS', 'BULK', 'INTERRUPT'];
        const type = types[ep.transferType] || 'UNKNOWN';
        console.log(`      EP 0x${ep.address.toString(16).padStart(2,'0')}: ${dir} ${type} maxPacket=${ep.packetSize} interval=${ep.interval}`);
      }
    }
  }

  // Step 4: Try to read string descriptors
  console.log('\n--- String Descriptors ---');
  const readString = (idx) => new Promise((resolve) => {
    if (!idx) return resolve(null);
    dev.getStringDescriptor(idx, (err, str) => {
      resolve(err ? `<error: ${err.message}>` : str);
    });
  });

  const manufacturer = await readString(desc.iManufacturer);
  const product = await readString(desc.iProduct);
  const serial = await readString(desc.iSerialNumber);

  console.log(`  Manufacturer: ${manufacturer}`);
  console.log(`  Product: ${product}`);
  console.log(`  Serial: ${serial}`);

  dev.close();
} catch (e) {
  console.log(`  Failed to open device: ${e.message}`);
  console.log('  This usually means SoundSwitch app has exclusive access.');
  console.log('  Close SoundSwitch and try again.');
}

// Step 5: Analysis
console.log('\n--- Analysis ---');
console.log('Device Identity: SoundSwitch Micro DMX Interface');
console.log(`  VID:0x${VID.toString(16)} PID:0x${PID.toString(16)}`);
console.log('  Chip: FTDI (confirmed via libftd2xx.dylib in SoundSwitch.app)');
console.log('  Protocol: Enttec Open DMX compatible (confirmed via EnttecCompatible class)');
console.log('  Access: FTDI D2XX direct (bypasses OS serial driver)');
console.log('');
console.log('To use this device:');
console.log('  1. Close SoundSwitch desktop app');
console.log('  2. Use libusb to claim the FTDI device directly');
console.log('  3. Send DMX frames using Enttec Open DMX protocol');
console.log('     (250000 baud, 8N2, break signal, start code 0x00 + 512 channels)');

process.exit(0);
