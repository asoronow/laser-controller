#!/usr/bin/env node
/**
 * replay-exact.mjs — Exact byte replay of captured SoundSwitch USB traffic
 *
 * Replays the EXACT bytes captured from lldb sniffing of SoundSwitch.app.
 * Key difference from test-jls1.mjs: calls setConfiguration(1) before claiming interface.
 *
 * NOTE: Only ~256 bytes of each 522-byte USB transfer were captured via lldb
 * memory read. The first 34 DMX channels (all we need) are within this window,
 * but bytes beyond ~256 may have been missed.
 *
 * Captured init sequence from SoundSwitch:
 *   1. libusb_set_configuration(1)
 *   2. libusb_claim_interface(0)
 *   3. 6x GET_DESCRIPTOR control transfers (standard, handled by OS)
 *   4. Bulk OUT EP 0x01, 12 bytes: START command
 *   5. Bulk OUT EP 0x01, 12 bytes: LED command
 *   6. Bulk OUT EP 0x01, 522 bytes: DMX frames (continuous)
 */

import { usb } from 'usb';
import * as readline from 'readline';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Exact captured packets from SoundSwitch (lldb memory read, LE word → byte order) ──

// Transfer 1: START command (12 bytes)
// Memory: 0x74525473 0x00040002 0x00010000
// Bytes:  73 54 52 74 02 00 04 00 00 00 01 00
const INIT_START = Buffer.from([
  0x73, 0x54, 0x52, 0x74,   // "sTRt" magic
  0x02, 0x00,               // command = 0x0002 (control)
  0x04, 0x00,               // payload length = 4
  0x00, 0x00, 0x01, 0x00    // payload: START
]);

// Transfer 2: LED command (12 bytes)
// Memory: 0x74525473 0x00040002 0xffff0001
// Bytes:  73 54 52 74 02 00 04 00 01 00 ff ff
const INIT_LED = Buffer.from([
  0x73, 0x54, 0x52, 0x74,   // "sTRt" magic
  0x02, 0x00,               // command = 0x0002 (control)
  0x04, 0x00,               // payload length = 4
  0x01, 0x00, 0xFF, 0xFF    // payload: LED max brightness
]);

// DMX blackout frame (522 bytes) — exact header from capture
// Memory: 0x74525473 0x02020001 0x00000000 ...
// Bytes:  73 54 52 74 01 00 02 02 00 00 00 00 ...
// Payload format: [2 header bytes] [512 DMX channels] = 514 bytes
// DMX channels start at payload offset 2 (confirmed via offset probe)
function buildDmxFrame(channels) {
  const packet = Buffer.alloc(522, 0);
  // Header (8 bytes)
  packet[0] = 0x73;  // 's'
  packet[1] = 0x54;  // 'T'
  packet[2] = 0x52;  // 'R'
  packet[3] = 0x74;  // 't'
  packet[4] = 0x01;  // command low byte
  packet[5] = 0x00;  // command high byte (cmd = 0x0001 = DMX)
  packet[6] = 0x02;  // payload length low byte
  packet[7] = 0x02;  // payload length high byte (len = 0x0202 = 514)
  // Payload[0..1] = 0x00 (protocol header bytes)
  // Payload[2..513] = DMX CH1..CH512
  if (channels) {
    channels.copy(packet, 10, 0, Math.min(channels.length, 512));  // offset 10 = 8 header + 2 payload header
  }
  return packet;
}

// Active DMX frame from capture (the one SoundSwitch sent with non-zero data)
// Memory dump at +8: 0x008d0000 0x0004ff00 0x00002000 ... 0xff000000
// Bytes at +8:        00 00 8d 00 00 ff 04 00 00 20 00 00 ... 00 00 00 ff
// With 2-byte payload header, raw payload positions map to DMX channels:
//   payload[2]=CH1, payload[5]=CH4, payload[6]=CH5, payload[9]=CH8, payload[19]=CH18
function buildCapturedActiveFrame() {
  const channels = Buffer.alloc(512, 0);
  // DMX channel values (raw payload position - 2 = channel index)
  channels[0]  = 0x8d;  // 141 → CH1: Laser On/Off (Sound Active range)
  channels[3]  = 0xff;  // 255 → CH4: Pattern Selection
  channels[4]  = 0x04;  // 4   → CH5: Pattern Zoom
  channels[7]  = 0x20;  // 32  → CH8: Tilt
  channels[17] = 0xff;  // 255 → CH18: Group B Laser On/Off
  return buildDmxFrame(channels);
}

function bulkWrite(outEp, data) {
  return new Promise((resolve, reject) => {
    outEp.timeout = 0;  // infinite timeout (matches SoundSwitch)
    outEp.transfer(data, err => err ? reject(err) : resolve());
  });
}

function setConfiguration(dev, config) {
  return new Promise((resolve, reject) => {
    dev.__setConfiguration(config, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function question(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function bufHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('=== Exact Byte Replay of SoundSwitch USB Traffic ===\n');

  // Find device
  const devices = usb.getDeviceList();
  const dev = devices.find(
    d => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );

  if (!dev) {
    console.error('Device not found (VID=%s PID=%s). Is it plugged in?',
      VID.toString(16), PID.toString(16));
    process.exit(1);
  }

  console.log('Found device: VID=%s PID=%s',
    VID.toString(16).padStart(4, '0'), PID.toString(16).padStart(4, '0'));

  // ── Step 0: Open device ──
  dev.open();
  console.log('  dev.open() OK');

  // ── Step 1: Set configuration (SoundSwitch calls libusb_set_configuration(1)) ──
  try {
    await setConfiguration(dev, 1);
    console.log('  setConfiguration(1) OK');
  } catch (e) {
    console.log('  setConfiguration(1) failed: %s (continuing anyway)', e.message);
  }

  // ── Step 2: Claim interface 0 (SoundSwitch calls libusb_claim_interface(0)) ──
  const iface = dev.interface(0);
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch {}
  iface.claim();
  console.log('  claim_interface(0) OK');

  // Find OUT endpoint
  const outEp = iface.endpoints.find(e => e.direction === 'out');
  if (!outEp) {
    console.error('No OUT endpoint found!');
    process.exit(1);
  }
  console.log('  OUT endpoint: 0x%s\n', outEp.address.toString(16).padStart(2, '0'));

  // ── Step 3: Send EXACT init packets ──
  console.log('Phase 1: Init sequence');
  console.log('  Sending START (%d bytes): %s', INIT_START.length, bufHex(INIT_START));
  await bulkWrite(outEp, INIT_START);
  console.log('  OK');

  console.log('  Sending LED   (%d bytes): %s', INIT_LED.length, bufHex(INIT_LED));
  await bulkWrite(outEp, INIT_LED);
  console.log('  OK');

  await sleep(200);

  var response = await question(rl, '\nIs the blue LED on the adapter ON? (y/n): ');
  if (response.toLowerCase() === 'y') {
    console.log('  LED activated!\n');
  } else {
    console.log('  LED not on — continuing anyway\n');
  }

  // ── Step 4: Send blackout frames (matches SoundSwitch's initial ~411 blackout frames) ──
  console.log('Phase 2: Blackout frames (50 frames @ 40Hz)');
  const blackoutFrame = buildDmxFrame(null);
  console.log('  Frame header: %s', bufHex(blackoutFrame.slice(0, 12)));
  console.log('  Frame size: %d bytes', blackoutFrame.length);
  for (let i = 0; i < 50; i++) {
    await bulkWrite(outEp, blackoutFrame);
    await sleep(25);
  }
  console.log('  50 blackout frames sent\n');

  // ── Step 5: Send the exact captured active frame ──
  console.log('Phase 3: Active DMX frames (captured values)');
  const activeFrame = buildCapturedActiveFrame();
  console.log('  Frame header+data: %s ...', bufHex(activeFrame.slice(0, 28)));
  console.log('  Non-zero channels: ch3=0x8d ch6=0xff ch7=0x04 ch10=0x20 ch20=0xff');
  console.log('  Sending 200 frames @ 40Hz (5 seconds)...');
  for (let i = 0; i < 200; i++) {
    await bulkWrite(outEp, activeFrame);
    await sleep(25);
    if (i === 39) console.log('    1 second...');
    if (i === 119) console.log('    3 seconds...');
  }
  console.log('  Done\n');

  // ── Step 6: Send SoundSwitch-matching values ──
  console.log('Phase 4: SoundSwitch-matching values (CH1=100 Sound, CH3=255 Anim, CH4=28 Pattern, CH11=152 Color, CH15=217 Draw2)');
  const ourChannels = Buffer.alloc(512, 0);
  ourChannels[0] = 100;   // CH1: Laser On/Off (Sound Active)
  ourChannels[2] = 255;   // CH3: Group Selection (Animations)
  ourChannels[3] = 28;    // CH4: Pattern Selection
  ourChannels[10] = 152;  // CH11: Fixed Color
  ourChannels[14] = 217;  // CH15: Drawing 2 (Dynamic C)
  const ourFrame = buildDmxFrame(ourChannels);
  console.log('  Frame header+data: %s ...', bufHex(ourFrame.slice(0, 20)));
  console.log('  Sending 200 frames @ 40Hz (5 seconds)...');
  for (let i = 0; i < 200; i++) {
    await bulkWrite(outEp, ourFrame);
    await sleep(25);
    if (i === 39) console.log('    1 second...');
    if (i === 119) console.log('    3 seconds...');
  }
  console.log('  Done\n');

  response = await question(rl, 'Did the laser respond during any phase? (y/n): ');
  if (response.toLowerCase() === 'y') {
    console.log('\nSUCCESS! Which phase? Check the channel mapping.\n');
  } else {
    console.log('\nNo response. Next steps:');
    console.log('  1. Run sniff.sh with MORE data capture (128+ bytes per transfer)');
    console.log('  2. Check if laser is in DMX mode (hold MODE until d001)');
    console.log('  3. Compare exact byte sequences between our writes and SoundSwitch\n');
  }

  // ── Blackout + cleanup ──
  console.log('Sending blackout...');
  for (let i = 0; i < 20; i++) {
    await bulkWrite(outEp, blackoutFrame);
    await sleep(25);
  }

  iface.release(() => {
    dev.close();
    rl.close();
    process.exit(0);
  });
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
