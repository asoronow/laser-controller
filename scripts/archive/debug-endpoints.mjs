// debug-endpoints.mjs — Test writing to different endpoints
// Run: node scripts/debug-endpoints.mjs

import { usb } from 'usb';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bulkWrite(dev, epAddr, data, timeout = 2000) {
  return new Promise((resolve, reject) => {
    dev.controlTransfer(
      // Not using control - use libusb_bulk_transfer via endpoint
      0x40, 0, 0, 0, Buffer.alloc(0), () => {}
    );
    // Actually, node-usb wraps this differently. Let's use the interface endpoint
  });
}

async function main() {
  console.log('=== Endpoint & Configuration Debug ===\n');

  const devices = usb.getDeviceList();
  const dev = devices.find(
    (d) => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );
  if (!dev) { console.error('Device not found'); process.exit(1); }

  // Step 1: Check configuration BEFORE opening
  console.log('Device descriptor:');
  console.log('  bNumConfigurations:', dev.deviceDescriptor.bNumConfigurations);

  dev.open();

  // Step 2: Check current configuration
  console.log('\nConfig descriptor:');
  const config = dev.configDescriptor;
  console.log('  bConfigurationValue:', config.bConfigurationValue);
  console.log('  bNumInterfaces:', config.bNumInterfaces);

  // From the disassembly, SoundSwitch calls setConfig(1) first
  // Let's try explicitly setting configuration
  console.log('\nStep 1: Setting USB configuration to 1 (like SoundSwitch does)...');
  try {
    await new Promise((resolve, reject) => {
      dev.__setConfiguration(1, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log('  OK: Configuration set to 1');
  } catch (e) {
    console.log('  Note:', e.message, '(may already be set)');
  }

  // Step 3: Claim interface
  const iface = dev.interface(0);
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch {}
  iface.claim();
  console.log('  OK: Interface 0 claimed');

  // Step 4: List endpoints again after config
  console.log('\nEndpoints after configuration:');
  for (const ep of iface.endpoints) {
    console.log(`  EP 0x${ep.address.toString(16).padStart(2,'0')} dir=${ep.direction} type=${ep.transferType}`);
  }

  // Step 5: The disassembly shows write to endpoint 0x02
  // But descriptor says 0x01. Let's try BOTH.
  // First, the actual endpoint from the descriptor
  const ep1 = iface.endpoints.find(e => e.direction === 'out');

  // DMX frame: start code + 512 channels
  const frame = Buffer.alloc(513, 0);
  frame[0] = 0x00; // start code
  frame[1] = 255;  // CH1 master dimmer
  frame[2] = 225;  // CH2 manual mode
  frame[5] = 255;  // CH5 red

  console.log('\n--- Test A: Write to descriptor endpoint (0x%s) ---', ep1 ? ep1.address.toString(16) : 'none');
  if (ep1) {
    try {
      ep1.timeout = 2000;
      for (let i = 0; i < 200; i++) {
        await new Promise((resolve, reject) => {
          ep1.transfer(frame, (err) => { if (err) reject(err); else resolve(); });
        });
        await sleep(25);
        if (i === 0) console.log('  First write OK, sending for 5 seconds...');
      }
      console.log('  Done');
    } catch (e) {
      console.log('  Error:', e.message);
    }
  }

  // Try endpoint 0x02 directly (what SoundSwitch uses)
  console.log('\n--- Test B: Write to EP 0x02 (what SoundSwitch binary uses) ---');
  try {
    const ep2 = iface.endpoint(0x02);
    console.log('  EP 0x02 exists: dir=%s type=%d', ep2.direction, ep2.transferType);
    ep2.timeout = 2000;
    for (let i = 0; i < 200; i++) {
      await new Promise((resolve, reject) => {
        ep2.transfer(frame, (err) => { if (err) reject(err); else resolve(); });
      });
      await sleep(25);
      if (i === 0) console.log('  First write OK, sending for 5 seconds...');
    }
    console.log('  Done');
  } catch (e) {
    console.log('  Error:', e.message);
  }

  // Try with just 512 bytes (no start code)
  console.log('\n--- Test C: 512 bytes without start code to EP 0x01 ---');
  const frame512 = Buffer.alloc(512, 0);
  frame512[0] = 255;  // CH1
  frame512[1] = 225;  // CH2
  frame512[4] = 255;  // CH5 red
  if (ep1) {
    try {
      ep1.timeout = 2000;
      for (let i = 0; i < 200; i++) {
        await new Promise((resolve, reject) => {
          ep1.transfer(frame512, (err) => { if (err) reject(err); else resolve(); });
        });
        await sleep(25);
        if (i === 0) console.log('  First write OK, sending for 5 seconds...');
      }
      console.log('  Done');
    } catch (e) {
      console.log('  Error:', e.message);
    }
  }

  // Try with the 5ms delay like SoundSwitch does (consumePacket sleeps 5ms)
  console.log('\n--- Test D: With 5ms pre-delay (matching SoundSwitch timing) to EP 0x01 ---');
  if (ep1) {
    try {
      ep1.timeout = 2000;
      for (let i = 0; i < 150; i++) {
        await sleep(5); // SoundSwitch does sleepForMilliseconds(5) before each write
        await new Promise((resolve, reject) => {
          ep1.transfer(frame, (err) => { if (err) reject(err); else resolve(); });
        });
        if (i === 0) console.log('  First write OK, sending for 5 seconds...');
      }
      console.log('  Done');
    } catch (e) {
      console.log('  Error:', e.message);
    }
  }

  // Blackout
  console.log('\n--- Blackout ---');
  const blackout = Buffer.alloc(513, 0);
  if (ep1) {
    try {
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve, reject) => {
          ep1.transfer(blackout, (err) => { if (err) reject(err); else resolve(); });
        });
        await sleep(25);
      }
    } catch {}
  }

  console.log('\nWhich test made the laser respond? (A, B, C, or D)');

  iface.release(() => { dev.close(); process.exit(0); });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
