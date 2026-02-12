// debug-usb.mjs — Pinpoint where LIBUSB_TRANSFER_TIMED_OUT occurs
// Run: node scripts/debug-usb.mjs
// IMPORTANT: Close SoundSwitch app first!

import { usb } from 'usb';

const VID = 0x15E4;
const PID = 0x0053;

function controlTransfer(device, bmRequestType, bRequest, wValue, wIndex, timeout = 5000) {
  return new Promise((resolve, reject) => {
    // Set device timeout before transfer
    device.timeout = timeout;
    device.controlTransfer(bmRequestType, bRequest, wValue, wIndex, Buffer.alloc(0), (err, buf) => {
      if (err) reject(err);
      else resolve(buf);
    });
  });
}

function bulkTransfer(endpoint, data, timeout = 5000) {
  return new Promise((resolve, reject) => {
    endpoint.timeout = timeout;
    endpoint.transfer(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function main() {
  console.log('=== SoundSwitch USB Debug ===\n');

  // Step 1: Find device
  console.log('Step 1: Finding device...');
  const devices = usb.getDeviceList();
  const dev = devices.find(
    (d) => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );

  if (!dev) {
    console.error('  FAIL: Device not found');
    process.exit(1);
  }
  console.log('  OK: Found VID=0x%s PID=0x%s', VID.toString(16), PID.toString(16));

  // Step 2: Open device
  console.log('\nStep 2: Opening device...');
  try {
    dev.open();
    console.log('  OK: Device opened');
  } catch (e) {
    console.error('  FAIL:', e.message);
    process.exit(1);
  }

  // Step 3: Dump all interfaces and endpoints
  console.log('\nStep 3: USB descriptor dump...');
  const config = dev.configDescriptor;
  if (config) {
    console.log('  Configuration:', config.bConfigurationValue);
    console.log('  Interfaces:', config.interfaces.length);
    for (let i = 0; i < config.interfaces.length; i++) {
      const alts = config.interfaces[i];
      for (const alt of alts) {
        console.log(`  Interface ${i} alt ${alt.bAlternateSetting}:`);
        console.log(`    Class: ${alt.bInterfaceClass} SubClass: ${alt.bInterfaceSubClass} Protocol: ${alt.bInterfaceProtocol}`);
        console.log(`    Endpoints: ${alt.endpoints.length}`);
        for (const ep of alt.endpoints) {
          const dir = ep.bEndpointAddress & 0x80 ? 'IN' : 'OUT';
          const type = ['Control', 'Isochronous', 'Bulk', 'Interrupt'][ep.bmAttributes & 0x03];
          console.log(`      EP 0x${ep.bEndpointAddress.toString(16).padStart(2, '0')} ${dir} ${type} maxPacket=${ep.wMaxPacketSize}`);
        }
      }
    }
  } else {
    console.log('  WARNING: No config descriptor available');
  }

  // Step 4: Claim interface
  console.log('\nStep 4: Claiming interface 0...');
  const iface = dev.interface(0);
  try {
    if (iface.isKernelDriverActive()) {
      console.log('  Detaching kernel driver...');
      iface.detachKernelDriver();
    }
  } catch (e) {
    // OK on macOS
  }
  try {
    iface.claim();
    console.log('  OK: Interface claimed');
  } catch (e) {
    console.error('  FAIL:', e.message);
    dev.close();
    process.exit(1);
  }

  // Step 5: Find endpoints
  console.log('\nStep 5: Finding endpoints...');
  let outEp = null;
  let inEp = null;
  for (const ep of iface.endpoints) {
    console.log(`  Found EP: 0x${ep.address.toString(16)} direction=${ep.direction} transferType=${ep.transferType}`);
    if (ep.direction === 'out') outEp = ep;
    if (ep.direction === 'in') inEp = ep;
  }

  if (!outEp) {
    console.log('  No OUT endpoint found via enumeration, trying 0x02 directly...');
    try {
      outEp = iface.endpoint(0x02);
      console.log(`  Manual EP 0x02: direction=${outEp.direction} transferType=${outEp.transferType}`);
    } catch (e) {
      console.error('  FAIL: Cannot get endpoint 0x02:', e.message);
    }
  }

  if (!outEp) {
    console.error('  FAIL: No OUT endpoint available');
    iface.release(() => dev.close());
    process.exit(1);
  }
  console.log(`  Using OUT endpoint: 0x${outEp.address.toString(16)}`);

  // Step 6: Test control transfers (FTDI reset)
  console.log('\nStep 6: Testing FTDI control transfers...');

  const tests = [
    { name: 'RESET', req: 0x00, val: 0, idx: 0 },
    { name: 'SET_BAUDRATE (250k)', req: 0x03, val: 12, idx: 0 },
    { name: 'SET_DATA (8N2)', req: 0x04, val: 8 | 0x1000, idx: 0 },
    { name: 'SET_FLOW_CTRL (off)', req: 0x02, val: 0, idx: 0 },
    { name: 'SET_LATENCY (2ms)', req: 0x09, val: 2, idx: 0 },
    { name: 'PURGE_RX', req: 0x00, val: 1, idx: 0 },
    { name: 'PURGE_TX', req: 0x00, val: 2, idx: 0 },
  ];

  for (const t of tests) {
    const start = Date.now();
    try {
      await controlTransfer(dev, 0x40, t.req, t.val, t.idx);
      console.log(`  OK: ${t.name} (${Date.now() - start}ms)`);
    } catch (e) {
      console.error(`  FAIL: ${t.name} (${Date.now() - start}ms): ${e.message}`);
      // If basic FTDI commands fail, device may not be FTDI
      if (t.name === 'RESET') {
        console.error('\n  >>> FTDI RESET failed — this device may not use FTDI protocol!');
        console.error('  >>> Trying alternative: maybe it uses a raw bulk protocol without FTDI configuration.');
      }
    }
  }

  // Step 7: Test break signal
  console.log('\nStep 7: Testing FTDI break signal...');
  const lineProps = 8 | 0x1000; // 8N2
  try {
    const s1 = Date.now();
    await controlTransfer(dev, 0x40, 0x04, lineProps | 0x4000, 0); // break ON
    console.log(`  OK: Break ON (${Date.now() - s1}ms)`);

    const s2 = Date.now();
    await controlTransfer(dev, 0x40, 0x04, lineProps | 0x0000, 0); // break OFF
    console.log(`  OK: Break OFF (${Date.now() - s2}ms)`);
  } catch (e) {
    console.error(`  FAIL: Break signal: ${e.message}`);
  }

  // Step 8: Test small bulk transfer
  console.log('\nStep 8: Testing small bulk transfer (4 bytes)...');
  try {
    const start = Date.now();
    await bulkTransfer(outEp, Buffer.from([0x00, 0xff, 0x00, 0x00]));
    console.log(`  OK: Small bulk transfer (${Date.now() - start}ms)`);
  } catch (e) {
    console.error(`  FAIL: Small bulk transfer: ${e.message}`);
    console.error('  >>> This suggests the endpoint cannot accept bulk data.');
    console.error('  >>> Possible causes:');
    console.error('  >>>   1. Endpoint is halted — try clearing halt');
    console.error('  >>>   2. Wrong endpoint address');
    console.error('  >>>   3. Device uses a different protocol (HID reports?)');

    // Try clearing halt
    console.log('\n  Attempting to clear halt on endpoint...');
    try {
      await new Promise((resolve, reject) => {
        outEp.clearHalt((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      console.log('  OK: Halt cleared, retrying transfer...');
      try {
        const start = Date.now();
        await bulkTransfer(outEp, Buffer.from([0x00, 0xff, 0x00, 0x00]));
        console.log(`  OK: Bulk transfer after clear halt (${Date.now() - start}ms)`);
      } catch (e2) {
        console.error(`  FAIL: Still fails after clear halt: ${e2.message}`);
      }
    } catch (e3) {
      console.error(`  FAIL: Clear halt failed: ${e3.message}`);
    }
  }

  // Step 9: Test full DMX frame
  console.log('\nStep 9: Testing full DMX frame (513 bytes)...');
  try {
    const frame = Buffer.alloc(513, 0);
    frame[0] = 0x00; // start code
    frame[1] = 0xff; // CH1 = 255
    const start = Date.now();
    await bulkTransfer(outEp, frame);
    console.log(`  OK: Full DMX frame (${Date.now() - start}ms)`);
  } catch (e) {
    console.error(`  FAIL: Full DMX frame: ${e.message}`);
  }

  // Step 10: Try alternative — maybe device uses interrupt transfers?
  if (inEp) {
    console.log('\nStep 10: Checking IN endpoint for device response...');
    try {
      inEp.timeout = 1000;
      const data = await new Promise((resolve, reject) => {
        inEp.transfer(64, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });
      console.log(`  Received ${data.length} bytes:`, data.toString('hex'));
    } catch (e) {
      console.log(`  IN transfer: ${e.message} (expected if no data pending)`);
    }
  }

  // Cleanup
  console.log('\nCleaning up...');
  iface.release(() => {
    dev.close();
    console.log('Done.');
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
