#!/usr/bin/env node
/**
 * test-dmx-data.mjs — DMX data encoding diagnostic
 *
 * Sends DMX data via the SoundSwitch Micro DMX adapter and prints the
 * exact bytes on the wire. Tests both the captured SoundSwitch values
 * and our own scene values to identify encoding issues.
 *
 * Usage: node scripts/test-dmx-data.mjs
 */

import { usb } from 'usb';
import * as readline from 'readline';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function bufHex(buf, maxLen = 40) {
  const bytes = Array.from(buf.slice(0, maxLen))
    .map(b => b.toString(16).padStart(2, '0'));
  const suffix = buf.length > maxLen ? ` ... (${buf.length} bytes total)` : '';
  return bytes.join(' ') + suffix;
}

function buildPacket(command, payload) {
  const packet = Buffer.alloc(8 + payload.length);
  // Magic "sTRt"
  packet[0] = 0x73; packet[1] = 0x54; packet[2] = 0x52; packet[3] = 0x74;
  // Command (LE16)
  packet.writeUInt16LE(command, 4);
  // Payload length (LE16)
  packet.writeUInt16LE(payload.length, 6);
  // Payload
  payload.copy(packet, 8);
  return packet;
}

function buildDmxPacket(channelValues) {
  // channelValues: { chNumber: value } where chNumber is 1-indexed
  const channels = Buffer.alloc(512, 0);
  for (const [ch, val] of Object.entries(channelValues)) {
    const idx = parseInt(ch) - 1; // 1-indexed to 0-indexed
    if (idx >= 0 && idx < 512) {
      channels[idx] = Math.max(0, Math.min(255, val));
    }
  }

  const payload = Buffer.alloc(514, 0);
  channels.copy(payload, 0);
  payload[512] = 0xFF; // LED byte 1
  payload[513] = 0xFF; // LED byte 2

  return { packet: buildPacket(0x0001, payload), channels };
}

function printChannelDump(channels, label) {
  console.log(`\n  ${label}:`);
  const nonZero = [];
  for (let i = 0; i < 512; i++) {
    if (channels[i] !== 0) {
      nonZero.push(`    CH${i + 1} (buf[${i}]) = ${channels[i]} (0x${channels[i].toString(16).padStart(2, '0')})`);
    }
  }
  if (nonZero.length === 0) {
    console.log('    (all zeros — blackout)');
  } else {
    nonZero.forEach(l => console.log(l));
  }
}

function bulkWrite(outEp, data) {
  return new Promise((resolve, reject) => {
    outEp.timeout = 0;
    outEp.transfer(data, err => err ? reject(err) : resolve());
  });
}

function setConfiguration(dev, config) {
  return new Promise((resolve, reject) => {
    dev.__setConfiguration(config, err => err ? reject(err) : resolve());
  });
}

function question(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function sendFrames(outEp, packet, count, hz) {
  const delay = 1000 / hz;
  for (let i = 0; i < count; i++) {
    await bulkWrite(outEp, packet);
    await sleep(delay);
  }
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          DMX Data Encoding Diagnostic                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── Define test scenes ──

  // Test 1: Exact captured SoundSwitch frame (known working from replay-exact.mjs)
  const capturedChannels = Buffer.alloc(512, 0);
  capturedChannels[2]  = 0x8d;  // 141 → DMX CH3 (Group Selection)
  capturedChannels[5]  = 0xff;  // 255 → DMX CH6 (Pattern Rotation)
  capturedChannels[6]  = 0x04;  // 4   → DMX CH7 (Pan)
  capturedChannels[9]  = 0x20;  // 32  → DMX CH10 (Y Zoom)
  capturedChannels[19] = 0xff;  // 255 → DMX CH20 (Group B: No Function)
  const capturedPayload = Buffer.alloc(514, 0);
  capturedChannels.copy(capturedPayload, 0);
  capturedPayload[512] = 0xFF;
  capturedPayload[513] = 0xFF;
  const capturedPacket = buildPacket(0x0001, capturedPayload);

  // Test 2: SS MATCH scene (SoundSwitch screenshot values)
  const ssMatch = buildDmxPacket({
    1: 100,    // CH1: Laser On/Off = Sound Active
    3: 255,    // CH3: Group Selection = Animations
    4: 28,     // CH4: Pattern Selection = Pattern 28
    11: 152,   // CH11: Fixed Color = color per dot
    15: 217,   // CH15: Drawing 2 = Dynamic C effects
  });

  // Test 3: SS MATCH + default zoom (what our webpage actually sends)
  const ssMatchWithDefaults = buildDmxPacket({
    1: 100,    // CH1: Laser On/Off = Sound Active
    2: 0,      // CH2: Pattern Size = 0
    3: 255,    // CH3: Group Selection = Animations
    4: 28,     // CH4: Pattern Selection = Pattern 28
    5: 64,     // CH5: Pattern Zoom = 64 (our default)
    6: 0,      // CH6: Pattern Rotation = 0
    7: 0,      // CH7: Pan = 0
    8: 0,      // CH8: Tilt = 0
    9: 0,      // CH9: X Zoom = 0
    10: 0,     // CH10: Y Zoom = 0
    11: 152,   // CH11: Fixed Color = 152
    12: 0,     // CH12: Color Change = 0
    13: 0,     // CH13: Dots = 0
    14: 0,     // CH14: Drawing = 0
    15: 217,   // CH15: Drawing 2 = 217
    16: 0,     // CH16: Twist = 0
    17: 0,     // CH17: Grating = 0
  });

  // Test 4: Simple circle red
  const circleRed = buildDmxPacket({
    1: 100,    // CH1: Laser On/Off = Sound Active
    3: 0,      // CH3: Group Selection = Group 1 (beams)
    4: 0,      // CH4: Pattern Selection = first pattern
    5: 80,     // CH5: Pattern Zoom = static large
    6: 200,    // CH6: Pattern Rotation = CW slow
    12: 8,     // CH12: Color Change = Red
  });

  // Test 5: Minimal — just laser on
  const minimalOn = buildDmxPacket({
    1: 100,    // CH1: Laser On/Off = Sound Active
  });

  // ── Print hex comparison ──
  console.log('=== PACKET COMPARISON ===\n');

  console.log('Header format: [sTRt magic] [cmd LE16] [len LE16] [payload...]');
  console.log('Expected:      73 54 52 74  01 00      02 02      [514 bytes]\n');

  console.log('1. CAPTURED SoundSwitch frame (known working):');
  console.log('   Header: ' + bufHex(capturedPacket.slice(0, 8)));
  printChannelDump(capturedChannels, 'Non-zero channels');

  console.log('\n2. SS MATCH scene (SoundSwitch screenshot values):');
  console.log('   Header: ' + bufHex(ssMatch.packet.slice(0, 8)));
  printChannelDump(ssMatch.channels, 'Non-zero channels');

  console.log('\n3. SS MATCH + page defaults (what webpage sends):');
  console.log('   Header: ' + bufHex(ssMatchWithDefaults.packet.slice(0, 8)));
  printChannelDump(ssMatchWithDefaults.channels, 'Non-zero channels');

  console.log('\n4. CIRCLE RED scene:');
  console.log('   Header: ' + bufHex(circleRed.packet.slice(0, 8)));
  printChannelDump(circleRed.channels, 'Non-zero channels');

  console.log('\n5. MINIMAL — just laser on (CH1=100):');
  console.log('   Header: ' + bufHex(minimalOn.packet.slice(0, 8)));
  printChannelDump(minimalOn.channels, 'Non-zero channels');

  // ── Key difference analysis ──
  console.log('\n=== KEY DIFFERENCE ===');
  console.log('Captured frame has CH1=0 (OFF!) yet worked.');
  console.log('Our frames have CH1=100 (SOUND ACTIVE).');
  console.log('This suggests either:');
  console.log('  a) The laser ignores CH1 in DMX mode');
  console.log('  b) The laser has a DMX start address offset');
  console.log('  c) The captured snapshot was mid-transition\n');

  // ── Connect and test ──
  const resp = await question(rl, 'Connect to device and send test frames? (y/n): ');
  if (resp.toLowerCase() !== 'y') {
    console.log('Exiting without sending.');
    rl.close();
    return;
  }

  // Find device
  const devices = usb.getDeviceList();
  const dev = devices.find(
    d => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );
  if (!dev) {
    console.error('Device not found! Is SoundSwitch Micro DMX plugged in?');
    rl.close();
    return;
  }

  console.log('\nOpening device...');
  dev.open();
  try { await setConfiguration(dev, 1); } catch (e) {
    console.log('  setConfiguration warning: ' + e.message);
  }

  const iface = dev.interface(0);
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch {}
  iface.claim();

  const outEp = iface.endpoints.find(e => e.direction === 'out');
  if (!outEp) { console.error('No OUT endpoint!'); process.exit(1); }

  // Init sequence
  console.log('Sending init sequence...');
  await bulkWrite(outEp, buildPacket(0x0002, Buffer.from([0x00, 0x00, 0x01, 0x00])));
  await bulkWrite(outEp, buildPacket(0x0002, Buffer.from([0x01, 0x00, 0xFF, 0xFF])));
  await sleep(200);

  // Blackout first
  console.log('Sending blackout (20 frames)...');
  const blackout = buildPacket(0x0001, Buffer.alloc(514, 0));
  // Set LED bytes in blackout too
  blackout[520] = 0xFF;
  blackout[521] = 0xFF;
  await sendFrames(outEp, blackout, 20, 40);

  // ── Test each scene ──
  const tests = [
    { name: '1. CAPTURED SoundSwitch frame', packet: capturedPacket },
    { name: '2. SS MATCH (SoundSwitch values)', packet: ssMatch.packet },
    { name: '3. SS MATCH + page defaults', packet: ssMatchWithDefaults.packet },
    { name: '4. CIRCLE RED', packet: circleRed.packet },
    { name: '5. MINIMAL (CH1=100 only)', packet: minimalOn.packet },
  ];

  for (const test of tests) {
    console.log(`\n── ${test.name} ──`);
    console.log(`   Sending 160 frames (4 sec @ 40Hz)...`);
    await sendFrames(outEp, test.packet, 160, 40);

    const result = await question(rl, '   Did the laser respond? (y/n/skip): ');
    if (result.toLowerCase() === 'skip') break;

    // Brief blackout between tests
    console.log('   Blackout...');
    await sendFrames(outEp, blackout, 20, 40);
    await sleep(200);
  }

  // Final blackout
  console.log('\nFinal blackout...');
  await sendFrames(outEp, blackout, 20, 40);

  // Cleanup
  iface.release(() => {
    dev.close();
    rl.close();
    console.log('Done.');
    process.exit(0);
  });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
