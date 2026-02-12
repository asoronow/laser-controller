// debug-protocol.mjs — Figure out the SoundSwitch Micro DMX frame format
// Run: node scripts/debug-protocol.mjs
// IMPORTANT: Close SoundSwitch app first!

import { usb } from 'usb';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bulkTransfer(endpoint, data) {
  return new Promise((resolve, reject) => {
    endpoint.timeout = 1000;
    endpoint.transfer(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function main() {
  console.log('=== SoundSwitch Protocol Discovery ===\n');

  const devices = usb.getDeviceList();
  const dev = devices.find(
    (d) => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );
  if (!dev) { console.error('Device not found'); process.exit(1); }

  dev.open();
  const iface = dev.interface(0);
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch {}
  iface.claim();

  const outEp = iface.endpoints.find((ep) => ep.direction === 'out');
  if (!outEp) { console.error('No OUT endpoint'); process.exit(1); }

  // Check for IN endpoint too - device might send status back
  const inEp = iface.endpoints.find((ep) => ep.direction === 'in');
  if (inEp) {
    console.log('Found IN endpoint 0x' + inEp.address.toString(16));
  } else {
    console.log('No IN endpoint (write-only device)');

    // Check if there's a hidden IN endpoint at 0x81
    try {
      const ep81 = iface.endpoint(0x81);
      console.log('Found hidden IN endpoint at 0x81');
    } catch {
      console.log('No hidden IN endpoint at 0x81 either');
    }
  }

  console.log('\n--- Test 1: Raw 513-byte DMX frame (start code + 512 ch) ---');
  console.log('Sending CH1=255 (master dimmer) for 5 seconds...');
  console.log('>>> LOOK AT THE LASER — does anything happen?\n');

  const frame513 = Buffer.alloc(513, 0);
  frame513[0] = 0x00; // start code
  frame513[1] = 255;  // CH1 = master dimmer

  for (let i = 0; i < 200; i++) {
    await bulkTransfer(outEp, frame513);
    await sleep(25);
  }

  console.log('--- Test 2: Raw 512-byte frame (no start code) ---');
  console.log('Sending CH1=255 for 5 seconds...\n');

  const frame512 = Buffer.alloc(512, 0);
  frame512[0] = 255;  // CH1 = master dimmer

  for (let i = 0; i < 200; i++) {
    await bulkTransfer(outEp, frame512);
    await sleep(25);
  }

  console.log('--- Test 3: Enttec Pro packet format ---');
  console.log('Sending CH1=255 wrapped in Enttec Pro header for 5 seconds...\n');

  const dmxData = Buffer.alloc(513, 0);
  dmxData[0] = 0x00; // start code
  dmxData[1] = 255;  // CH1
  const len = dmxData.length;
  const enttecPro = Buffer.concat([
    Buffer.from([0x7E, 6, len & 0xFF, (len >> 8) & 0xFF]),
    dmxData,
    Buffer.from([0xE7])
  ]);

  for (let i = 0; i < 200; i++) {
    await bulkTransfer(outEp, enttecPro);
    await sleep(25);
  }

  console.log('--- Test 4: Short frames —  just a few channels ---');
  console.log('Sending 2-byte frame [0x00, 0xFF] for 3 seconds...\n');

  for (let i = 0; i < 120; i++) {
    await bulkTransfer(outEp, Buffer.from([0x00, 0xFF]));
    await sleep(25);
  }

  console.log('--- Test 5: Just 1 byte [0xFF] for 3 seconds ---\n');

  for (let i = 0; i < 120; i++) {
    await bulkTransfer(outEp, Buffer.from([0xFF]));
    await sleep(25);
  }

  console.log('--- Test 6: 513 bytes with CH1=255, CH2=225 (manual mode) ---');
  console.log('Full DMX universe, manual mode, for 5 seconds...\n');

  const frameManual = Buffer.alloc(513, 0);
  frameManual[0] = 0x00; // start code
  frameManual[1] = 255;  // CH1 master dimmer
  frameManual[2] = 225;  // CH2 manual mode

  for (let i = 0; i < 200; i++) {
    await bulkTransfer(outEp, frameManual);
    await sleep(25);
  }

  console.log('--- Test 7: RGB test (CH1=255 CH2=225 CH5=255 CH6=0 CH7=0) ---');
  console.log('Red only, for 5 seconds...\n');

  const frameRGB = Buffer.alloc(513, 0);
  frameRGB[0] = 0x00;  // start code
  frameRGB[1] = 255;   // CH1 master
  frameRGB[2] = 225;   // CH2 manual
  frameRGB[5] = 255;   // CH5 red
  frameRGB[6] = 0;     // CH6 green
  frameRGB[7] = 0;     // CH7 blue

  for (let i = 0; i < 200; i++) {
    await bulkTransfer(outEp, frameRGB);
    await sleep(25);
  }

  console.log('--- Test 8: Dimmer ramp 0→255 over 5 seconds ---\n');

  for (let v = 0; v <= 255; v++) {
    const f = Buffer.alloc(513, 0);
    f[0] = 0x00;
    f[1] = v;     // CH1 dimmer
    f[2] = 225;   // CH2 manual
    f[5] = 255;   // red
    await bulkTransfer(outEp, f);
    await sleep(20);
  }

  // Blackout
  console.log('\n--- Blackout ---\n');
  for (let i = 0; i < 10; i++) {
    await bulkTransfer(outEp, Buffer.alloc(513, 0));
    await sleep(25);
  }

  console.log('All tests complete. Which test made the laser respond?');
  console.log('  Test 1: 513 bytes (start code + 512)');
  console.log('  Test 2: 512 bytes (no start code)');
  console.log('  Test 3: Enttec Pro wrapped');
  console.log('  Test 4: 2 bytes [0x00, 0xFF]');
  console.log('  Test 5: 1 byte [0xFF]');
  console.log('  Test 6: 513 bytes with manual mode');
  console.log('  Test 7: RGB red test');
  console.log('  Test 8: Dimmer ramp');

  iface.release(() => {
    dev.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
