#!/usr/bin/env node
/**
 * test-steal.mjs — Let SoundSwitch activate the device, then take over
 *
 * Strategy:
 *   1. Wait for SoundSwitch to be running (user opens it)
 *   2. Confirm the blue LED is on (device activated)
 *   3. Kill SoundSwitch
 *   4. Immediately claim device via libusb
 *   5. Try all DMX packet formats to find the one that works
 *
 * Additionally: probe ALL vendor control transfers (0x00-0xFF) to find
 * the device's own command protocol.
 *
 * Usage: node scripts/test-steal.mjs
 */

import { usb } from 'usb';
import { execSync } from 'child_process';
import * as readline from 'readline';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function buildEnttecPacket(label, data) {
  const len = data.length;
  const packet = Buffer.alloc(len + 5);
  packet[0] = 0x7E;
  packet[1] = label;
  packet[2] = len & 0xFF;
  packet[3] = (len >> 8) & 0xFF;
  data.copy(packet, 4);
  packet[len + 4] = 0xE7;
  return packet;
}

function bulkWrite(outEp, data, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    outEp.timeout = timeoutMs;
    outEp.transfer(data, err => err ? reject(err) : resolve());
  });
}

function controlTransfer(dev, bmReq, bReq, wVal, wIdx, dataOrLen) {
  return new Promise((resolve, reject) => {
    dev.controlTransfer(bmReq, bReq, wVal, wIdx, dataOrLen, (err, buf) => {
      if (err) reject(err);
      else resolve(buf);
    });
  });
}

function question(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('=== SoundSwitch Device Steal Test ===\n');
  console.log('This test lets SoundSwitch activate the device, then takes over.\n');

  // Step 1: Check if SoundSwitch is running
  let ssPid = null;
  try {
    ssPid = execSync("pgrep -f 'SoundSwitch.app/Contents/MacOS/SoundSwitch$' 2>/dev/null", { encoding: 'utf-8' }).trim().split('\n')[0];
  } catch {}

  if (!ssPid) {
    console.log('SoundSwitch is NOT running.');
    console.log('Please:');
    console.log('  1. Open /Applications/SoundSwitch.app');
    console.log('  2. Wait for the blue LED on the adapter to turn on');
    console.log('  3. Press Enter here');
    await question(rl, '\nPress Enter when LED is on... ');

    try {
      ssPid = execSync("pgrep -f 'SoundSwitch.app/Contents/MacOS/SoundSwitch$' 2>/dev/null", { encoding: 'utf-8' }).trim().split('\n')[0];
    } catch {}
  }

  if (!ssPid) {
    console.log('WARNING: SoundSwitch process not found. Continuing anyway...');
  } else {
    console.log('SoundSwitch PID:', ssPid);
  }

  var response = await question(rl, 'Is the blue LED on the adapter ON? (y/n): ');
  if (response.toLowerCase() !== 'y') {
    console.log('The device needs to be activated first. Try opening SoundSwitch and waiting.');
    rl.close();
    process.exit(1);
  }

  // Step 2: Kill SoundSwitch
  if (ssPid) {
    console.log('\nKilling SoundSwitch (PID %s)...', ssPid);
    try {
      execSync(`kill ${ssPid} 2>/dev/null`);
    } catch {}
    // Wait for it to die
    for (let i = 0; i < 10; i++) {
      await sleep(300);
      try {
        execSync(`kill -0 ${ssPid} 2>/dev/null`);
      } catch {
        console.log('  SoundSwitch terminated');
        break;
      }
    }
    await sleep(500); // Extra wait for USB release
  }

  // Step 3: Open device via libusb
  console.log('\nOpening device via libusb...');
  const devices = usb.getDeviceList();
  const dev = devices.find(
    d => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );

  if (!dev) {
    console.error('Device not found! It may have disconnected when SoundSwitch was killed.');
    rl.close();
    process.exit(1);
  }

  dev.open();
  console.log('Device opened');

  const iface = dev.interface(0);
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch {}
  iface.claim();
  console.log('Interface 0 claimed');

  try {
    await new Promise((res, rej) => iface.setAltSetting(0, err => err ? rej(err) : res()));
  } catch {}

  const outEp = iface.endpoints.find(e => e.direction === 'out');
  if (!outEp) {
    console.error('No OUT endpoint!');
    rl.close();
    process.exit(1);
  }
  console.log('OUT endpoint: 0x%s\n', outEp.address.toString(16).padStart(2, '0'));

  response = await question(rl, 'Is the blue LED STILL on? (y/n): ');
  const ledStillOn = response.toLowerCase() === 'y';
  console.log(ledStillOn ? '  Great — device stayed active!' : '  LED turned off — device deactivated when SoundSwitch died.');

  // Step 4: Probe vendor control transfers with SHORT timeout
  console.log('\n── Probing vendor control transfers (200ms timeout each) ──');

  // Set short timeout on device
  dev.timeout = 200;

  const workingRequests = [];

  // Test write (0x40) and read (0xC0) with a few key request codes
  const probeRequests = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x09, 0x0A, 0x0B, 0x0D, 0x10, 0x20, 0x40, 0x80, 0x93, 0xFF];

  console.log('  Host-to-device (0x40):');
  for (const req of probeRequests) {
    try {
      await controlTransfer(dev, 0x40, req, 0, 0, Buffer.alloc(0));
      console.log('    ✓ 0x%s — OK', req.toString(16).padStart(2, '0'));
      workingRequests.push({ dir: 'out', req });
    } catch (e) {
      const msg = e.message;
      if (msg.includes('PIPE') || msg.includes('STALL')) {
        console.log('    ✗ 0x%s — STALL (device rejected)', req.toString(16).padStart(2, '0'));
      }
      // Skip timeout silently
    }
  }

  console.log('  Device-to-host (0xC0):');
  for (const req of probeRequests) {
    try {
      const buf = await controlTransfer(dev, 0xC0, req, 0, 0, 64);
      const hex = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log('    ✓ 0x%s — data: %s', req.toString(16).padStart(2, '0'), hex);
      workingRequests.push({ dir: 'in', req, data: buf });
    } catch (e) {
      const msg = e.message;
      if (msg.includes('PIPE') || msg.includes('STALL')) {
        console.log('    ✗ 0x%s — STALL', req.toString(16).padStart(2, '0'));
      }
    }
  }

  console.log('  Result: %d working control transfer(s)', workingRequests.length);
  dev.timeout = 1000;  // restore

  // Step 5: Test DMX output formats
  const dmxChannels = Buffer.alloc(512, 0);
  dmxChannels[0] = 100;   // CH1: Laser On/Off (Sound Active)
  dmxChannels[2] = 255;   // CH3: Group Selection (Animations)
  dmxChannels[3] = 28;    // CH4: Pattern Selection
  dmxChannels[10] = 152;  // CH11: Fixed Color
  dmxChannels[14] = 217;  // CH15: Drawing 2 (Dynamic C)

  const FRAMES = 200;
  const DELAY = 25;

  const tests = [
    {
      name: 'Raw 514 bytes (toDMX512Packet)',
      build: () => {
        const f = Buffer.alloc(514, 0);
        dmxChannels.copy(f, 0);
        f[512] = 0xFF; f[513] = 0xFF;
        return f;
      }
    },
    {
      name: 'Enttec Pro API key + enable + DMX (label 6)',
      setup: async () => {
        await bulkWrite(outEp, buildEnttecPacket(0x0D, Buffer.from([0xC9, 0xA4, 0x03, 0xE4])));
        await sleep(200);
        await bulkWrite(outEp, buildEnttecPacket(0x93, Buffer.from([0x01, 0x01])));
        await sleep(50);
      },
      build: () => {
        const d = Buffer.alloc(513, 0);
        d[0] = 0x00;
        dmxChannels.copy(d, 1);
        return buildEnttecPacket(0x06, d);
      }
    },
    {
      name: 'Raw 512 bytes (just channel data)',
      build: () => Buffer.from(dmxChannels)
    },
    {
      name: 'Raw 513 bytes (start code + channels)',
      build: () => {
        const f = Buffer.alloc(513, 0);
        f[0] = 0x00;
        dmxChannels.copy(f, 1);
        return f;
      }
    },
    {
      name: 'API key (raw, no Enttec framing) + raw 514',
      setup: async () => {
        // Try API key as raw bytes, not Enttec-framed
        await bulkWrite(outEp, Buffer.from([0xC9, 0xA4, 0x03, 0xE4]));
        await sleep(200);
        await bulkWrite(outEp, Buffer.from([0x01, 0x01]));
        await sleep(50);
      },
      build: () => {
        const f = Buffer.alloc(514, 0);
        dmxChannels.copy(f, 0);
        f[512] = 0xFF; f[513] = 0xFF;
        return f;
      }
    },
  ];

  for (let t = 0; t < tests.length; t++) {
    const test = tests[t];
    console.log('\n═══ TEST %d: %s ═══', t + 1, test.name);

    try {
      if (test.setup) await test.setup();

      const packet = test.build();
      console.log('  Packet size: %d bytes', packet.length);
      console.log('  First 16 bytes: %s', Array.from(packet.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      console.log('  Sending %d frames at %dHz...', FRAMES, 1000 / DELAY);

      for (let i = 0; i < FRAMES; i++) {
        await sleep(DELAY);
        await bulkWrite(outEp, packet);
        if (i === 0) console.log('  Writing... WATCH THE LASER');
      }
      console.log('  Done');
    } catch (e) {
      console.log('  Error:', e.message);
    }

    response = await question(rl, '\n  Did anything happen? (y/n): ');
    if (response.toLowerCase() === 'y') {
      console.log('\n  ★ TEST %d WORKS! Format: %s', t + 1, test.name);
      await cleanup(dev, iface, rl);
      return;
    }
  }

  console.log('\n  No test produced visible output.');
  console.log('\n  Debugging info:');
  console.log('    - LED was %s after taking over from SoundSwitch', ledStillOn ? 'ON' : 'OFF');
  console.log('    - Working control transfers:', workingRequests.length);
  console.log('    - If LED turned off, the device lost its activated state');
  console.log('    - Next step: USB packet capture while SoundSwitch is running');

  await cleanup(dev, iface, rl);
}

async function cleanup(dev, iface, rl) {
  console.log('\nCleaning up...');
  try {
    iface.release(() => {
      try { dev.close(); } catch {}
      rl.close();
      process.exit(0);
    });
  } catch {
    rl.close();
    process.exit(0);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
