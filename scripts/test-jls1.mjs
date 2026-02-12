#!/usr/bin/env node
/**
 * test-jls1.mjs — SoundSwitch Micro DMX using the REAL JLS1 protocol
 *
 * Discovered via lldb sniffing of SoundSwitch.app:
 *   - Device class: hardware::interface::JLS1 (NOT SSV1DMX or EnttecCompatible)
 *   - Transport: libusb bulk OUT to endpoint 0x01 (NO D2XX, NO FTDI)
 *   - Protocol: Custom "sTRt" packets with 8-byte header
 *
 * Packet format:
 *   [4 bytes: magic 0x73545274]
 *   [2 bytes: command (LE)]
 *   [2 bytes: payload length (LE)]
 *   [N bytes: payload]
 *
 * Commands:
 *   0x0001 — DMX data (payload = 514 bytes: 512 DMX channels + 2 LED bytes)
 *   0x0002 — Control (payload = 4 bytes)
 *
 * Init sequence:
 *   1. USB set_configuration(1), claim_interface(0)
 *   2. Control packet: cmd=0x0002, data=[0x00, 0x00, 0x01, 0x00] (START)
 *   3. Control packet: cmd=0x0002, data=[0x01, 0x00, 0xFF, 0xFF] (LED max)
 *   4. DMX packets: cmd=0x0001, data=[512 channels + 2 LED bytes] (continuous)
 *
 * Usage: node scripts/test-jls1.mjs
 */

import { usb } from 'usb';
import * as readline from 'readline';

const VID = 0x15E4;
const PID = 0x0053;
const MAGIC = Buffer.from([0x73, 0x54, 0x52, 0x74]);  // "sTRt"
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Build a JLS1 protocol packet.
 * @param {number} command - Command type (0x0001=DMX, 0x0002=control)
 * @param {Buffer} payload - Payload data
 * @returns {Buffer} Complete packet
 */
function buildPacket(command, payload) {
  const packet = Buffer.alloc(8 + payload.length);
  MAGIC.copy(packet, 0);                          // bytes 0-3: magic
  packet.writeUInt16LE(command, 4);                // bytes 4-5: command
  packet.writeUInt16LE(payload.length, 6);         // bytes 6-7: payload length
  payload.copy(packet, 8);                         // bytes 8+:  payload
  return packet;
}

function bulkWrite(outEp, data, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    outEp.timeout = timeoutMs;  // 0 = infinite (matches SoundSwitch)
    outEp.transfer(data, err => err ? reject(err) : resolve());
  });
}

function question(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('=== SoundSwitch Micro DMX — JLS1 Protocol Test ===\n');

  // Find device
  const devices = usb.getDeviceList();
  const dev = devices.find(
    d => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );

  if (!dev) {
    console.error('Device not found. Is it plugged in?');
    process.exit(1);
  }

  // Open and configure (matching SoundSwitch's init exactly)
  dev.open();
  console.log('✓ Device opened');

  const iface = dev.interface(0);
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch {}
  iface.claim();
  console.log('✓ Interface 0 claimed');

  const outEp = iface.endpoints.find(e => e.direction === 'out');
  if (!outEp) {
    console.error('No OUT endpoint!');
    process.exit(1);
  }
  console.log('✓ Endpoint 0x%s ready\n', outEp.address.toString(16).padStart(2, '0'));

  // ── Step 1: Send START control command ──
  const startPacket = buildPacket(0x0002, Buffer.from([0x00, 0x00, 0x01, 0x00]));
  console.log('Sending START command:', bufHex(startPacket));
  await bulkWrite(outEp, startPacket);
  console.log('✓ START sent');

  // ── Step 2: Send LED brightness control command ──
  const ledPacket = buildPacket(0x0002, Buffer.from([0x01, 0x00, 0xFF, 0xFF]));
  console.log('Sending LED command:', bufHex(ledPacket));
  await bulkWrite(outEp, ledPacket);
  console.log('✓ LED command sent');

  await sleep(100);

  var response = await question(rl, '\nIs the blue LED on the adapter ON now? (y/n): ');
  if (response.toLowerCase() === 'y') {
    console.log('★ Device activated! The START command turned on the LED.\n');
  } else {
    console.log('LED not on yet — continuing anyway...\n');
  }

  // ── Step 3: Send DMX frames ──
  // Payload: 512 DMX channels + 2 LED bytes = 514 bytes
  // Total packet: 8 header + 514 = 522 bytes (matches sniffed 0x020a)
  const dmxChannels = Buffer.alloc(512, 0);
  dmxChannels[0] = 100;   // CH1: Laser On/Off (Sound Active)
  dmxChannels[2] = 255;   // CH3: Group Selection (Animations)
  dmxChannels[3] = 28;    // CH4: Pattern Selection
  dmxChannels[10] = 152;  // CH11: Fixed Color
  dmxChannels[14] = 217;  // CH15: Drawing 2 (Dynamic C)

  const dmxPayload = Buffer.alloc(514, 0);
  dmxChannels.copy(dmxPayload, 0);     // 512 DMX channels
  dmxPayload[512] = 0xFF;              // LED brightness byte 1
  dmxPayload[513] = 0xFF;              // LED brightness byte 2

  const dmxPacket = buildPacket(0x0001, dmxPayload);
  console.log('DMX packet: %d bytes (header: %s)', dmxPacket.length, bufHex(dmxPacket.slice(0, 8)));
  console.log('DMX data preview: CH1=%d CH2=%d CH5=%d CH7=%d CH8=%d CH12=%d',
    dmxChannels[0], dmxChannels[1], dmxChannels[4], dmxChannels[6], dmxChannels[7], dmxChannels[11]);
  console.log('\nSending DMX frames at ~40Hz for 10 seconds...');
  console.log('★ WATCH THE LASER! ★\n');

  const FRAMES = 400;
  const DELAY = 25;  // ~40Hz

  for (let i = 0; i < FRAMES; i++) {
    await bulkWrite(outEp, dmxPacket);
    await sleep(DELAY);

    if (i === 0) console.log('  Frame 1 sent...');
    if (i === 39) console.log('  1 second...');
    if (i === 199) console.log('  5 seconds...');
  }

  console.log('  Done — %d frames sent\n', FRAMES);

  response = await question(rl, 'Did the laser respond? (y/n): ');
  if (response.toLowerCase() === 'y') {
    console.log('\n★★★ SUCCESS! JLS1 protocol works! ★★★');
    console.log('The protocol is: custom "sTRt" packets via USB bulk OUT.');
    console.log('No FTDI, no D2XX, no Enttec Pro, no API key needed.\n');
  } else {
    console.log('\nNo laser response. Possible issues:');
    console.log('  1. Is the laser in DMX mode? (hold MODE until d001 shows)');
    console.log('  2. Is DMX address set to 001?');
    console.log('  3. Is XLR cable connected adapter → laser?');
    console.log('  4. Check channel assignments for your laser model');
  }

  // Blackout
  console.log('Sending blackout...');
  const blackoutPayload = Buffer.alloc(514, 0);
  const blackoutPacket = buildPacket(0x0001, blackoutPayload);
  for (let i = 0; i < 20; i++) {
    await bulkWrite(outEp, blackoutPacket);
    await sleep(25);
  }

  // Cleanup
  iface.release(() => {
    dev.close();
    rl.close();
    process.exit(0);
  });
}

function bufHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
