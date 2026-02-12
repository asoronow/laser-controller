#!/usr/bin/env node
/**
 * test-offset.mjs — Probe DMX payload byte offset
 *
 * The captured SoundSwitch frame works but our values don't.
 * This tests whether there's a byte offset in the 514-byte payload —
 * i.e., the DMX channels might not start at payload[0].
 *
 * Captured working frame payload positions (0-indexed within 514-byte payload):
 *   [2]=141, [5]=255, [6]=4, [9]=32, [19]=255
 *
 * If offset=0 (our current assumption):
 *   CH1=0(OFF), CH3=141, CH6=255, CH7=4, CH10=32, CH20=255
 *   Problem: CH1=0 means Laser OFF, yet the laser responds!
 *
 * If offset=2 (DMX starts at payload[2]):
 *   CH1=141(SOUND!), CH4=255, CH5=4, CH8=32, CH18=255
 *   This makes CH1 in Sound Active range (100-199) — laser ON!
 *
 * This script tests offsets 0, 1, and 2 to find which one works.
 */

import { usb } from 'usb';
import * as readline from 'readline';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function buildPacket(command, payload) {
  const packet = Buffer.alloc(8 + payload.length);
  packet[0] = 0x73; packet[1] = 0x54; packet[2] = 0x52; packet[3] = 0x74;
  packet.writeUInt16LE(command, 4);
  packet.writeUInt16LE(payload.length, 6);
  payload.copy(packet, 8);
  return packet;
}

function buildDmxWithOffset(channelValues, offset) {
  // channelValues: { chNumber: value } where chNumber is 1-indexed
  const payload = Buffer.alloc(514, 0);

  for (const [ch, val] of Object.entries(channelValues)) {
    const idx = offset + (parseInt(ch) - 1);
    if (idx >= 0 && idx < 512) {
      payload[idx] = Math.max(0, Math.min(255, val));
    }
  }

  // LED bytes at end of payload
  payload[512] = 0xFF;
  payload[513] = 0xFF;

  return buildPacket(0x0001, payload);
}

function bufHex(buf, maxLen = 30) {
  return Array.from(buf.slice(0, maxLen)).map(b => b.toString(16).padStart(2, '0')).join(' ');
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
  console.log('║         DMX Payload Byte Offset Probe                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // The SS MATCH values from SoundSwitch screenshot
  const ssValues = {
    1: 100,    // Laser On/Off = Sound Active
    3: 255,    // Group Selection = Animations
    4: 28,     // Pattern Selection = 28
    11: 152,   // Fixed Color
    15: 217,   // Drawing 2 = Dynamic C
  };

  // Show what each offset does
  console.log('=== OFFSET ANALYSIS ===\n');
  for (const offset of [0, 1, 2]) {
    console.log(`Offset ${offset}: DMX CH1 goes to payload[${offset}]`);
    const payload = Buffer.alloc(514, 0);
    for (const [ch, val] of Object.entries(ssValues)) {
      const idx = offset + (parseInt(ch) - 1);
      payload[idx] = val;
    }
    payload[512] = 0xFF;
    payload[513] = 0xFF;

    const nonZero = [];
    for (let i = 0; i < 30; i++) {
      if (payload[i] !== 0) {
        nonZero.push(`  payload[${i}]=${payload[i]} (0x${payload[i].toString(16).padStart(2, '0')})`);
      }
    }
    nonZero.forEach(l => console.log(l));

    // Compare with captured frame
    console.log('  vs captured: payload[2]=141 [5]=255 [6]=4 [9]=32 [19]=255');
    console.log('');
  }

  console.log('The captured frame has CH1-equivalent at payload[2]=141 (Sound Active range).');
  console.log('Offset=2 would put our CH1=100 at payload[2] — matching the pattern!\n');

  // Connect
  const resp = await question(rl, 'Connect and test all offsets? (y/n): ');
  if (resp.toLowerCase() !== 'y') {
    rl.close();
    return;
  }

  const devices = usb.getDeviceList();
  const dev = devices.find(d =>
    d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );
  if (!dev) {
    console.error('Device not found!');
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

  // Init
  console.log('Init sequence...');
  await bulkWrite(outEp, buildPacket(0x0002, Buffer.from([0x00, 0x00, 0x01, 0x00])));
  await bulkWrite(outEp, buildPacket(0x0002, Buffer.from([0x01, 0x00, 0xFF, 0xFF])));
  await sleep(200);

  const blackout = buildPacket(0x0001, Buffer.alloc(514, 0));
  blackout[520] = 0xFF; blackout[521] = 0xFF;

  // Blackout first
  console.log('Blackout...\n');
  await sendFrames(outEp, blackout, 20, 40);

  // Test each offset
  for (const offset of [0, 1, 2]) {
    const packet = buildDmxWithOffset(ssValues, offset);

    console.log(`── OFFSET ${offset}: CH1 at payload[${offset}] ──`);
    console.log(`   Payload bytes 0-20: ${bufHex(Buffer.from(packet.slice(8, 28)))}`);
    console.log(`   Sending 160 frames (4 sec)...`);
    await sendFrames(outEp, packet, 160, 40);

    const result = await question(rl, `   Did the laser respond? (y/n): `);
    if (result.toLowerCase() === 'y') {
      console.log(`\n   *** OFFSET ${offset} WORKS! ***`);
      console.log(`   DMX channels start at payload byte ${offset}.`);
      if (offset > 0) {
        console.log(`   The driver needs to write CH1 at buffer position ${offset}, not 0.`);
        console.log(`   Payload format: [${offset} header byte(s)] [512 DMX channels] [LED bytes]`);
      }
      console.log('');
    }

    // Blackout between tests
    console.log('   Blackout...');
    await sendFrames(outEp, blackout, 20, 40);
    await sleep(300);
  }

  // Also test: what if first 2 bytes are LED and DMX follows?
  console.log('\n── BONUS: First 2 bytes = LED brightness, then 512 DMX channels ──');
  const bonusPayload = Buffer.alloc(514, 0);
  bonusPayload[0] = 0xFF; // LED byte 1
  bonusPayload[1] = 0xFF; // LED byte 2
  // DMX channels start at offset 2
  bonusPayload[2] = 100;  // CH1: Laser On/Off
  bonusPayload[4] = 255;  // CH3: Group Selection
  bonusPayload[5] = 28;   // CH4: Pattern Selection
  bonusPayload[12] = 152; // CH11: Fixed Color
  bonusPayload[16] = 217; // CH15: Drawing 2
  // No LED bytes at end in this model
  const bonusPacket = buildPacket(0x0001, bonusPayload);
  console.log(`   Payload bytes 0-20: ${bufHex(Buffer.from(bonusPacket.slice(8, 28)))}`);
  console.log('   Sending 160 frames (4 sec)...');
  await sendFrames(outEp, bonusPacket, 160, 40);
  const bonusResult = await question(rl, '   Did the laser respond? (y/n): ');
  if (bonusResult.toLowerCase() === 'y') {
    console.log('\n   *** LED-first format works! ***');
    console.log('   Payload: [2 LED bytes] [512 DMX channels]');
  }

  // Final blackout
  console.log('\nFinal blackout...');
  await sendFrames(outEp, blackout, 20, 40);

  iface.release(() => {
    dev.close();
    rl.close();
    console.log('Done.');
    process.exit(0);
  });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
