// debug-format.mjs — Test various packet formats based on toDMX512Packet disassembly
// The disassembly showed it copies 512 bytes into a buffer, then sets bytes at
// offset 0x200 (512) and 0x201 (513) from the original struct.
// This suggests a 514-byte packet with 2 trailing control bytes.
// It also initializes a Blob, zeros it, then copies the 512+2 data in.
//
// Run: node scripts/debug-format.mjs

import { usb } from 'usb';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('=== Packet Format Debug ===\n');

  const devices = usb.getDeviceList();
  const dev = devices.find(
    (d) => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );
  if (!dev) { console.error('Device not found'); process.exit(1); }

  dev.open();

  // Set configuration first (matching SoundSwitch)
  try {
    await new Promise((resolve, reject) => {
      dev.__setConfiguration(1, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  } catch {}

  const iface = dev.interface(0);
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch {}
  iface.claim();

  const ep = iface.endpoints.find(e => e.direction === 'out');
  ep.timeout = 2000;

  async function sendFrames(label, makeFrame, count = 200, delayMs = 25) {
    console.log(`--- ${label} ---`);
    try {
      for (let i = 0; i < count; i++) {
        await sleep(5); // 5ms pre-delay like SoundSwitch
        await new Promise((resolve, reject) => {
          ep.transfer(makeFrame(), (err) => { if (err) reject(err); else resolve(); });
        });
        if (i === 0) console.log('  Sending for ~5 seconds... WATCH THE LASER');
      }
      console.log('  Done\n');
    } catch (e) {
      console.log('  Error:', e.message, '\n');
    }
  }

  // Test 1: 514 bytes (512 DMX channels + 2 control bytes)
  // Based on toDMX512Packet: 512 bytes data + 2 bytes appended
  await sendFrames('Test 1: 514 bytes (512 + 2 trailing)', () => {
    const f = Buffer.alloc(514, 0);
    f[0] = 255;  // CH1 dimmer
    f[1] = 225;  // CH2 manual mode
    f[4] = 255;  // CH5 red
    // Last 2 bytes could be checksum/flags
    f[512] = 0x00;
    f[513] = 0x00;
    return f;
  });

  // Test 2: 514 bytes with 0xCA 0xFE magic footer
  await sendFrames('Test 2: 514 bytes with 0x55 0xAA footer', () => {
    const f = Buffer.alloc(514, 0);
    f[0] = 255;
    f[1] = 225;
    f[4] = 255;
    f[512] = 0x55;
    f[513] = 0xAA;
    return f;
  });

  // Test 3: Start code prefix + 512 + 2 = 515 bytes
  await sendFrames('Test 3: 515 bytes (start code + 512 + 2)', () => {
    const f = Buffer.alloc(515, 0);
    f[0] = 0x00; // start code
    f[1] = 255;  // CH1
    f[2] = 225;  // CH2
    f[5] = 255;  // CH5
    return f;
  });

  // Test 4: Just 64 bytes (maxPacketSize) with DMX data
  await sendFrames('Test 4: 64 bytes (EP max packet size)', () => {
    const f = Buffer.alloc(64, 0);
    f[0] = 255;  // CH1
    f[1] = 225;  // CH2
    f[4] = 255;  // CH5
    return f;
  });

  // Test 5: Maybe device needs auto/sound mode instead of manual
  await sendFrames('Test 5: 513 bytes, AUTO mode (CH2=25)', () => {
    const f = Buffer.alloc(513, 0);
    f[0] = 0x00;
    f[1] = 255;  // CH1 dim
    f[2] = 25;   // CH2 AUTO mode
    return f;
  });

  // Test 6: Try with CH2=75 (sound mode)
  await sendFrames('Test 6: 513 bytes, SOUND mode (CH2=75)', () => {
    const f = Buffer.alloc(513, 0);
    f[0] = 0x00;
    f[1] = 255;
    f[2] = 75;
    return f;
  });

  // Test 7: Maybe it's not DMX channels at all — try a known command byte pattern
  // Some STM32 DMX adapters use a 1-byte command prefix
  await sendFrames('Test 7: [0x01] + 512 bytes (command prefix)', () => {
    const f = Buffer.alloc(513, 0);
    f[0] = 0x01; // command: "send DMX"
    f[1] = 255;  // CH1
    f[2] = 225;  // CH2
    f[5] = 255;  // CH5
    return f;
  });

  // Test 8: USB-DMX512 common format: [length_hi, length_lo, start_code, ...data...]
  await sendFrames('Test 8: [len_hi, len_lo, start_code] + 512 data', () => {
    const f = Buffer.alloc(515, 0);
    f[0] = 0x02; // length high (512 = 0x0200)
    f[1] = 0x00; // length low
    f[2] = 0x00; // start code
    f[3] = 255;  // CH1
    f[4] = 225;  // CH2
    f[7] = 255;  // CH5
    return f;
  });

  // Test 9: Maybe it needs the raw libusb_bulk_transfer with endpoint 2
  // Use raw control transfer to send data
  console.log('--- Test 9: Raw libusb bulk to address 0x02 ---');
  try {
    const WebUSB = usb.WebUSB;
    // Actually try transferOut which is lower level
    // This won't work through node-usb abstraction the same way
    // Let's try sending via control transfer endpoint 0 with vendor request
    console.log('  Trying vendor control transfer with DMX data...');
    const frame = Buffer.alloc(64);
    frame[0] = 255; frame[1] = 225; frame[4] = 255;
    await new Promise((resolve, reject) => {
      dev.controlTransfer(
        0x40,  // vendor, host-to-device
        0x01,  // request 1
        0x0000, // value
        0x0000, // index
        frame,
        (err, buf) => { if (err) reject(err); else resolve(buf); }
      );
    });
    console.log('  OK!');
  } catch (e) {
    console.log('  Error:', e.message);
  }

  // Blackout
  console.log('\n--- Blackout ---');
  try {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve, reject) => {
        ep.transfer(Buffer.alloc(513, 0), (err) => { if (err) reject(err); else resolve(); });
      });
      await sleep(25);
    }
  } catch {}

  console.log('\nWhich test (1-9) made the laser respond?');

  iface.release(() => { dev.close(); process.exit(0); });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
