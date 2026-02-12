// debug-ep2.mjs — Force write to endpoint 0x02 using low-level USB access
// SoundSwitch binary calls libusb_bulk_transfer with endpoint=0x02
// but the descriptor only shows EP 0x01. Let's try EP 0x02 directly.
//
// Run: node scripts/debug-ep2.mjs

import { usb } from 'usb';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('=== Force EP 0x02 Write Test ===\n');

  const devices = usb.getDeviceList();
  const dev = devices.find(
    (d) => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );
  if (!dev) { console.error('Device not found'); process.exit(1); }

  dev.open();

  // setConfig(1) like SoundSwitch
  try {
    await new Promise((resolve, reject) => {
      dev.__setConfiguration(1, (err) => { if (err) reject(err); else resolve(); });
    });
    console.log('setConfiguration(1): OK');
  } catch (e) {
    console.log('setConfiguration(1):', e.message);
  }

  const iface = dev.interface(0);
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch {}
  iface.claim();
  console.log('Interface 0 claimed');

  // Try different alt settings first
  console.log('\nTrying alternate settings...');
  for (let alt = 0; alt <= 3; alt++) {
    try {
      await new Promise((resolve, reject) => {
        iface.setAltSetting(alt, (err) => { if (err) reject(err); else resolve(); });
      });
      console.log(`  Alt setting ${alt}: OK`);
      // Check endpoints after alt setting change
      console.log('  Endpoints:', iface.endpoints.map(e =>
        `0x${e.address.toString(16)} ${e.direction} type=${e.transferType}`
      ));
    } catch (e) {
      console.log(`  Alt setting ${alt}: ${e.message}`);
      break;
    }
  }

  // Reset back to alt 0
  try {
    await new Promise((resolve, reject) => {
      iface.setAltSetting(0, (err) => { if (err) reject(err); else resolve(); });
    });
  } catch {}

  // The node-usb library's OutEndpoint wraps libusb_bulk_transfer
  // The endpoint address used is stored in endpoint.address
  // We can hack it by getting the EP 0x01 object and changing its address
  const ep1 = iface.endpoints.find(e => e.direction === 'out');

  const frame = Buffer.alloc(514, 0);
  frame[0] = 255;  // CH1 dimmer
  frame[1] = 225;  // CH2 manual
  frame[4] = 255;  // CH5 red
  frame[512] = 0xFF;
  frame[513] = 0xFF;

  // Test 1: Write to EP 0x01 (what we've been doing)
  console.log('\n--- Test 1: Normal write to EP 0x01 (5 sec) ---');
  ep1.timeout = 2000;
  try {
    for (let i = 0; i < 200; i++) {
      await sleep(5);
      await new Promise((r, j) => { ep1.transfer(frame, e => e ? j(e) : r()); });
      if (i === 0) console.log('  Writing...');
    }
    console.log('  Done - did LED change?');
  } catch (e) { console.log('  Error:', e.message); }

  // Test 2: Hack the endpoint address to 0x02
  console.log('\n--- Test 2: Hacked EP address to 0x02 (5 sec) ---');
  const origAddr = ep1.address;
  ep1.address = 0x02;  // Override the address
  try {
    for (let i = 0; i < 200; i++) {
      await sleep(5);
      await new Promise((r, j) => { ep1.transfer(frame, e => e ? j(e) : r()); });
      if (i === 0) console.log('  Writing to EP 0x02...');
    }
    console.log('  Done - did LED change?');
  } catch (e) { console.log('  Error:', e.message); }
  ep1.address = origAddr;

  // Test 3: Try EP 0x03 just in case
  console.log('\n--- Test 3: Hacked EP address to 0x03 (3 sec) ---');
  ep1.address = 0x03;
  try {
    for (let i = 0; i < 120; i++) {
      await sleep(5);
      await new Promise((r, j) => { ep1.transfer(frame, e => e ? j(e) : r()); });
      if (i === 0) console.log('  Writing to EP 0x03...');
    }
    console.log('  Done');
  } catch (e) { console.log('  Error:', e.message); }
  ep1.address = origAddr;

  // Test 4: Try USB reset then write
  console.log('\n--- Test 4: USB device reset then write to EP 0x01 (5 sec) ---');
  try {
    // Release, reset, re-claim
    await new Promise((r, j) => { iface.release(e => e ? j(e) : r()); });
    await new Promise((r, j) => { dev.reset(e => e ? j(e) : r()); });
    console.log('  Device reset OK');

    // Re-configure after reset
    try {
      await new Promise((r, j) => { dev.__setConfiguration(1, e => e ? j(e) : r()); });
    } catch {}

    const iface2 = dev.interface(0);
    try { if (iface2.isKernelDriverActive()) iface2.detachKernelDriver(); } catch {}
    iface2.claim();
    console.log('  Re-claimed interface');

    const ep = iface2.endpoints.find(e => e.direction === 'out');
    ep.timeout = 2000;

    // Check endpoints after reset
    console.log('  Endpoints after reset:', iface2.endpoints.map(e =>
      `0x${e.address.toString(16)} ${e.direction} type=${e.transferType}`
    ));

    for (let i = 0; i < 200; i++) {
      await sleep(5);
      await new Promise((r, j) => { ep.transfer(frame, e => e ? j(e) : r()); });
      if (i === 0) console.log('  Writing after reset...');
    }
    console.log('  Done - did LED change?');

    // Also try EP 0x02 after reset
    console.log('\n--- Test 5: After reset, write to EP 0x02 (5 sec) ---');
    ep.address = 0x02;
    for (let i = 0; i < 200; i++) {
      await sleep(5);
      await new Promise((r, j) => { ep.transfer(frame, e => e ? j(e) : r()); });
      if (i === 0) console.log('  Writing to EP 0x02 after reset...');
    }
    console.log('  Done - did LED change?');
    ep.address = origAddr;

    // Cleanup
    iface2.release(() => { dev.close(); });
  } catch (e) {
    console.log('  Error:', e.message);
    try { dev.close(); } catch {}
  }

  console.log('\nAll tests complete.');
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
