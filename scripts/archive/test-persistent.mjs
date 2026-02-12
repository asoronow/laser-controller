// test-persistent.mjs — Slow ramp test you can observe in real-time
// Keeps running until Ctrl+C. Prints current values as it goes.
// Run: node scripts/test-persistent.mjs

import { usb } from 'usb';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
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
  } catch {}

  const iface = dev.interface(0);
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch {}
  iface.claim();
  const ep = iface.endpoints.find(e => e.direction === 'out');
  ep.timeout = 2000;

  // Try sending to the IN endpoint first to see if device sends any init data
  console.log('Checking if device sends any data on IN endpoint 0x81...');
  try {
    const inEp = iface.endpoint(0x81);
    inEp.timeout = 1000;
    const data = await new Promise((resolve, reject) => {
      inEp.transfer(64, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    console.log('Received from device:', data.toString('hex'));
  } catch (e) {
    console.log('IN endpoint:', e.message, '(normal if no data pending)');
  }

  console.log('\n=== Persistent DMX Test ===');
  console.log('Sending DMX frames continuously. Watch the laser and device LED.');
  console.log('Trying different frame sizes: 512, 513, 514 bytes');
  console.log('Press Ctrl+C to stop.\n');

  // Cleanup on exit
  process.on('SIGINT', () => {
    console.log('\nBlackout and cleanup...');
    try {
      ep.transfer(Buffer.alloc(514, 0), () => {
        iface.release(() => { dev.close(); process.exit(0); });
      });
    } catch {
      process.exit(0);
    }
  });

  let frameCount = 0;
  const startTime = Date.now();

  while (true) {
    // Slowly cycle through brightness values
    const elapsed = (Date.now() - startTime) / 1000;
    const dimmer = Math.round((Math.sin(elapsed * 0.5) * 0.5 + 0.5) * 255);
    const red = Math.round((Math.sin(elapsed * 0.3) * 0.5 + 0.5) * 255);
    const green = Math.round((Math.sin(elapsed * 0.4 + 2) * 0.5 + 0.5) * 255);
    const blue = Math.round((Math.sin(elapsed * 0.6 + 4) * 0.5 + 0.5) * 255);

    // Send 514-byte frame
    const f = Buffer.alloc(514, 0);
    f[0] = dimmer;   // CH1 master dimmer
    f[1] = 225;      // CH2 manual mode
    f[2] = 0;        // CH3 pattern (circle)
    f[4] = red;      // CH5 red
    f[5] = green;    // CH6 green
    f[6] = blue;     // CH7 blue
    f[512] = 0xFF;   // LED byte 1
    f[513] = 0xFF;   // LED byte 2

    try {
      await sleep(5);
      await new Promise((resolve, reject) => {
        ep.transfer(f, (err) => { if (err) reject(err); else resolve(); });
      });
      frameCount++;

      if (frameCount % 40 === 0) {
        const fps = frameCount / elapsed;
        process.stdout.write(
          `\rFrame ${frameCount} | ${fps.toFixed(1)} fps | DIM=${dimmer} R=${red} G=${green} B=${blue}    `
        );
      }
    } catch (e) {
      console.log('\nWrite error:', e.message);
      await sleep(100);
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
