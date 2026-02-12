// debug-exact.mjs — Exactly replicate SoundSwitch's initialization sequence
// From ARM64 disassembly:
//   1. SSV1DMX::configure():
//      a. UsbDevice::setConfig(1)         → libusb_set_configuration(handle, 1)
//      b. UsbDevice::claimInterface(0, 0) → libusb_claim_interface(handle, 0)
//                                          → libusb_set_interface_alt_setting(handle, 0, 0)
//   2. SSV1DMX::consumePacket(data, len):
//      a. sleepForMilliseconds(5)
//      b. UsbDevice::write(0x02, data, len, 0) → libusb_bulk_transfer(handle, 0x02, data, len, &actual, 0)
//
// IMPORTANT: Unplug and replug the adapter before running!
// Run: node scripts/debug-exact.mjs

import { usb } from 'usb';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('=== Exact SoundSwitch Init Replica ===\n');

  const devices = usb.getDeviceList();
  const dev = devices.find(
    (d) => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );
  if (!dev) { console.error('Device not found. Is it plugged in?'); process.exit(1); }

  console.log('Step 1: Open device');
  dev.open();
  console.log('  OK');

  // Step 2: setConfig(1) → libusb_set_configuration(handle, 1)
  console.log('Step 2: libusb_set_configuration(1)');
  try {
    await new Promise((resolve, reject) => {
      dev.__setConfiguration(1, (err) => { if (err) reject(err); else resolve(); });
    });
    console.log('  OK');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // Step 3: libusb_claim_interface(handle, 0)
  console.log('Step 3: libusb_claim_interface(0)');
  const iface = dev.interface(0);
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch {}
  iface.claim();
  console.log('  OK');

  // Step 4: libusb_set_interface_alt_setting(handle, 0, 0)
  // THIS IS THE KEY STEP WE WERE MISSING
  console.log('Step 4: libusb_set_interface_alt_setting(0, 0)');
  try {
    await new Promise((resolve, reject) => {
      iface.setAltSetting(0, (err) => { if (err) reject(err); else resolve(); });
    });
    console.log('  OK');
  } catch (e) {
    console.log('  Error:', e.message);
  }

  // Check endpoints after alt setting
  console.log('\nEndpoints after full init:');
  for (const ep of iface.endpoints) {
    console.log(`  EP 0x${ep.address.toString(16).padStart(2,'0')} dir=${ep.direction} type=${ep.transferType}`);
  }

  // After setAltSetting, try to use EP 0x02 (what SoundSwitch uses)
  // Use EP 0x01 from the descriptor but hack its address to 0x02
  let outEp = iface.endpoints.find(e => e.direction === 'out');

  if (!outEp) {
    console.error('No OUT endpoint found!');
    process.exit(1);
  }
  console.log('  Using EP 0x' + outEp.address.toString(16) + ', will also test as 0x02');

  // Step 5: Send DMX frames exactly like SoundSwitch
  // consumePacket: sleep(5), then libusb_bulk_transfer(handle, 0x02, data, len, &actual, 0)
  // toDMX512Packet output: 512 DMX bytes + 2 LED bytes = 514 bytes

  console.log('\n--- Sending DMX frames (EP 0x%s) ---', outEp.address.toString(16));

  const frame = Buffer.alloc(514, 0);
  frame[0] = 255;    // CH1 master dimmer
  frame[1] = 225;    // CH2 manual mode
  frame[4] = 255;    // CH5 red
  frame[512] = 0xFF; // LED brightness byte 1
  frame[513] = 0xFF; // LED brightness byte 2

  // Also try with hacked EP address to 0x02
  const origAddr = outEp.address;

  console.log('\nTest A: Write to EP 0x%s (5 seconds)', outEp.address.toString(16));
  outEp.timeout = 0; // SoundSwitch uses timeout=0 (infinite)
  try {
    for (let i = 0; i < 200; i++) {
      await sleep(5);
      await new Promise((r, j) => { outEp.transfer(frame, e => e ? j(e) : r()); });
      if (i === 0) console.log('  Writing... WATCH LASER AND LED');
    }
    console.log('  Done');
  } catch (e) {
    console.log('  Error:', e.message);
  }

  console.log('\nTest B: Write to EP 0x02 (hacked address, 5 seconds)');
  outEp.address = 0x02;
  outEp.timeout = 0;
  try {
    for (let i = 0; i < 200; i++) {
      await sleep(5);
      await new Promise((r, j) => { outEp.transfer(frame, e => e ? j(e) : r()); });
      if (i === 0) console.log('  Writing to EP 0x02... WATCH LASER AND LED');
    }
    console.log('  Done');
  } catch (e) {
    console.log('  Error:', e.message);
  }
  outEp.address = origAddr;

  // Also try 512 bytes (just DMX, no LED bytes) to EP 0x02
  console.log('\nTest C: 512 bytes to EP 0x02 (5 seconds)');
  const frame512 = Buffer.alloc(512, 0);
  frame512[0] = 255;
  frame512[1] = 225;
  frame512[4] = 255;
  outEp.address = 0x02;
  outEp.timeout = 0;
  try {
    for (let i = 0; i < 200; i++) {
      await sleep(5);
      await new Promise((r, j) => { outEp.transfer(frame512, e => e ? j(e) : r()); });
      if (i === 0) console.log('  Writing 512 bytes to EP 0x02...');
    }
    console.log('  Done');
  } catch (e) {
    console.log('  Error:', e.message);
  }
  outEp.address = origAddr;

  // Blackout
  console.log('\n--- Blackout ---');
  try {
    for (let i = 0; i < 10; i++) {
      await new Promise((r, j) => { outEp.transfer(Buffer.alloc(514, 0), e => e ? j(e) : r()); });
      await sleep(25);
    }
  } catch {}

  console.log('\nDone. Did ANYTHING happen on the laser or device LED?');
  iface.release(() => { dev.close(); process.exit(0); });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
