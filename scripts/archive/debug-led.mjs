// debug-led.mjs — Test SSV1DMX protocol: 512 DMX bytes + 2 LED brightness bytes
// From disassembly:
//   toDMX512Packet: copies 512 DMX bytes, then appends 2 bytes from setLedBrightnessLevel
//   setLedBrightnessLevel(uint16_t): takes high byte, writes to both trailing bytes
//   consumePacket: sleeps 5ms, then writes to EP via UsbDevice::write(0x02, data, len, 0)
//   getLatency: returns 10ms
//
// Run: node scripts/debug-led.mjs

import { usb } from 'usb';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('=== SSV1DMX Protocol Test: 514 bytes (512 + 2 LED) ===\n');

  const devices = usb.getDeviceList();
  const dev = devices.find(
    (d) => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );
  if (!dev) { console.error('Device not found'); process.exit(1); }

  dev.open();
  try {
    await new Promise((resolve, reject) => {
      dev.__setConfiguration(1, (err) => { if (err) reject(err); else resolve(); });
    });
  } catch (e) {
    console.log('setConfig note:', e.message);
  }

  const iface = dev.interface(0);
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch {}
  iface.claim();

  const ep = iface.endpoints.find(e => e.direction === 'out');
  ep.timeout = 2000;

  async function sendFrames(label, makeFrame, count = 200) {
    console.log(`--- ${label} ---`);
    try {
      for (let i = 0; i < count; i++) {
        await sleep(5); // Match SoundSwitch's 5ms pre-delay
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

  // The LED brightness byte = 0xFF means full brightness on the LED
  // This might also signal "device active" or "output enabled"
  const LED_ON = 0xFF;
  const LED_OFF = 0x00;

  // Test 1: 514 bytes, LED=0xFF, CH1=255 dimmer, CH2=225 manual, CH5=255 red
  await sendFrames('Test 1: 514 bytes with LED=0xFF (full power indicator)', () => {
    const f = Buffer.alloc(514, 0);
    f[0] = 255;    // CH1 master dimmer
    f[1] = 225;    // CH2 manual mode
    f[4] = 255;    // CH5 red
    f[512] = LED_ON;   // LED byte 1
    f[513] = LED_ON;   // LED byte 2
    return f;
  });

  // Test 2: Same but with CH2=25 (auto mode)
  await sendFrames('Test 2: 514 bytes, LED=0xFF, AUTO mode', () => {
    const f = Buffer.alloc(514, 0);
    f[0] = 255;
    f[1] = 25;    // auto mode
    f[512] = LED_ON;
    f[513] = LED_ON;
    return f;
  });

  // Test 3: All channels max + LED on
  await sendFrames('Test 3: 514 bytes, ALL channels=255, LED=0xFF', () => {
    const f = Buffer.alloc(514, 255);
    return f;
  });

  // Test 4: Maybe LED bytes go FIRST (as a header, not footer)
  await sendFrames('Test 4: 2 LED header bytes + 512 DMX bytes = 514', () => {
    const f = Buffer.alloc(514, 0);
    f[0] = LED_ON;    // LED header byte 1
    f[1] = LED_ON;    // LED header byte 2
    f[2] = 255;       // CH1 dimmer
    f[3] = 225;       // CH2 manual
    f[6] = 255;       // CH5 red
    return f;
  });

  // Test 5: Try with start code: [0x00, 512 DMX, 2 LED] = 515 bytes
  await sendFrames('Test 5: 515 bytes [start_code, 512 DMX, 2 LED]', () => {
    const f = Buffer.alloc(515, 0);
    f[0] = 0x00;      // start code
    f[1] = 255;       // CH1
    f[2] = 225;       // CH2
    f[5] = 255;       // CH5
    f[513] = LED_ON;
    f[514] = LED_ON;
    return f;
  });

  // Test 6: Maybe LED header + start code + 512: [LED, LED, 0x00, 512] = 515
  await sendFrames('Test 6: 515 bytes [2 LED, start_code, 512 DMX]', () => {
    const f = Buffer.alloc(515, 0);
    f[0] = LED_ON;
    f[1] = LED_ON;
    f[2] = 0x00;      // start code
    f[3] = 255;       // CH1
    f[4] = 225;       // CH2
    f[7] = 255;       // CH5
    return f;
  });

  // Test 7: Maybe the device doesn't care about DMX values — just test LED control
  // Send zeros for DMX but LED=0xFF — does the BLUE LED on the device change?
  await sendFrames('Test 7: All DMX=0, LED=0xFF (check if blue LED changes)', () => {
    const f = Buffer.alloc(514, 0);
    f[512] = LED_ON;
    f[513] = LED_ON;
    return f;
  }, 100);

  // Test 8: Just 2 bytes — only the LED control
  await sendFrames('Test 8: Just 2 bytes [0xFF, 0xFF]', () => {
    return Buffer.from([LED_ON, LED_ON]);
  }, 100);

  // Test 9: 10ms delay (getLatency returns 10) instead of 5ms
  console.log('--- Test 9: 10ms delay, 514 bytes, LED=0xFF ---');
  try {
    for (let i = 0; i < 200; i++) {
      await sleep(10);
      const f = Buffer.alloc(514, 0);
      f[0] = 255; f[1] = 225; f[4] = 255;
      f[512] = LED_ON; f[513] = LED_ON;
      await new Promise((resolve, reject) => {
        ep.transfer(f, (err) => { if (err) reject(err); else resolve(); });
      });
      if (i === 0) console.log('  Sending for ~5 seconds...');
    }
    console.log('  Done\n');
  } catch (e) {
    console.log('  Error:', e.message, '\n');
  }

  // Blackout
  console.log('--- Blackout ---');
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve, reject) => {
      ep.transfer(Buffer.alloc(514, 0), (err) => { if (err) reject(err); else resolve(); });
    });
    await sleep(25);
  }

  console.log('\nDid ANY test cause:');
  console.log('  1. The blue LED on the device to change?');
  console.log('  2. The laser to emit light?');

  iface.release(() => { dev.close(); process.exit(0); });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
