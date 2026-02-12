// debug-ep2-direct.mjs — Use endpoint(0x02) object directly after setAltSetting
// IMPORTANT: Unplug and replug the adapter before running!
// Run: node scripts/debug-ep2-direct.mjs

import { usb } from 'usb';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('=== EP 0x02 Direct Access Test ===\n');

  const devices = usb.getDeviceList();
  const dev = devices.find(
    (d) => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );
  if (!dev) { console.error('Device not found. Unplug+replug first!'); process.exit(1); }

  dev.open();

  // Exact SoundSwitch init
  try {
    await new Promise((r, j) => { dev.__setConfiguration(1, e => e ? j(e) : r()); });
    console.log('setConfiguration(1): OK');
  } catch (e) { console.log('setConfig:', e.message); }

  const iface = dev.interface(0);
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch {}
  iface.claim();
  console.log('claim(0): OK');

  await new Promise((r, j) => { iface.setAltSetting(0, e => e ? j(e) : r()); });
  console.log('setAltSetting(0): OK');

  // Dump ALL info about endpoints
  console.log('\niface.endpoints array:');
  for (const ep of iface.endpoints) {
    console.log(`  address=0x${ep.address.toString(16)} dir=${ep.direction} type=${ep.transferType} descriptor:`, ep.descriptor);
  }

  // Try to get endpoint(0x02) directly
  console.log('\nTrying iface.endpoint(0x02):');
  let ep2;
  try {
    ep2 = iface.endpoint(0x02);
    if (ep2) {
      console.log('  Got EP object:', {
        address: ep2.address,
        direction: ep2.direction,
        transferType: ep2.transferType,
        descriptor: ep2.descriptor,
      });
    } else {
      console.log('  returned null/undefined');
    }
  } catch (e) {
    console.log('  Error:', e.message);
  }

  // Get EP 0x01
  const ep1 = iface.endpoints.find(e => e.direction === 'out');
  console.log('\nEP 0x01:', {
    address: ep1.address,
    direction: ep1.direction,
    transferType: ep1.transferType,
  });

  // DMX frame
  const frame = Buffer.alloc(514, 0);
  frame[0] = 255;    // CH1 dimmer
  frame[1] = 225;    // CH2 manual
  frame[4] = 255;    // CH5 red
  frame[512] = 0xFF;
  frame[513] = 0xFF;

  // Test 1: EP 0x01 with timeout=0 (like SoundSwitch)
  console.log('\n--- Test 1: EP 0x01, timeout=0, 514 bytes ---');
  ep1.timeout = 0;
  try {
    for (let i = 0; i < 200; i++) {
      await sleep(5);
      await new Promise((r, j) => { ep1.transfer(frame, e => e ? j(e) : r()); });
      if (i === 0) console.log('  Writing... WATCH LASER AND LED');
    }
    console.log('  Done');
  } catch (e) { console.log('  Error:', e.message); }

  // Test 2: If ep2 exists, try it
  if (ep2 && ep2.transfer) {
    console.log('\n--- Test 2: EP 0x02 object direct, 514 bytes ---');
    ep2.timeout = 0;
    try {
      for (let i = 0; i < 200; i++) {
        await sleep(5);
        await new Promise((r, j) => { ep2.transfer(frame, e => e ? j(e) : r()); });
        if (i === 0) console.log('  Writing via EP 0x02... WATCH LASER!');
      }
      console.log('  Done');
    } catch (e) { console.log('  Error:', e.message); }
  }

  // Test 3: Try using the WebUSB API which handles endpoints differently
  console.log('\n--- Test 3: WebUSB API transferOut ---');
  try {
    const webDev = await usb.WebUSB.prototype;
    console.log('  WebUSB not easily available from low-level API');
  } catch {}

  // Test 4: Try device-level control transfer to write bulk data
  // Some devices accept data via control endpoint as a fallback
  console.log('\n--- Test 4: Try sending DMX data via control EP 0 ---');
  for (const [reqType, req, val, idx] of [
    [0x40, 0x01, 0x0000, 0x0000],  // Vendor OUT, request 1
    [0x40, 0x02, 0x0000, 0x0000],  // Vendor OUT, request 2
    [0x21, 0x09, 0x0200, 0x0000],  // HID SET_REPORT class request
    [0x21, 0x20, 0x0000, 0x0000],  // CDC SET_LINE_CODING
  ]) {
    try {
      await new Promise((r, j) => {
        dev.controlTransfer(reqType, req, val, idx, frame.slice(0, 64), (e) => {
          if (e) j(e); else r();
        });
      });
      console.log(`  Control 0x${reqType.toString(16)}/0x${req.toString(16)}: OK! Testing more...`);
      // If this worked, try sending full frames
      for (let i = 0; i < 100; i++) {
        await sleep(10);
        await new Promise((r, j) => {
          dev.controlTransfer(reqType, req, val, idx, frame.slice(0, 64), (e) => {
            if (e) j(e); else r();
          });
        });
        if (i === 0) console.log('  Sending via control... WATCH LASER!');
      }
      break;
    } catch {}
  }

  // Cleanup
  console.log('\nDone.');
  iface.release(() => { dev.close(); process.exit(0); });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
