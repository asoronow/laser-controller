#!/usr/bin/env node
/**
 * test-libusb.mjs — Test SoundSwitch Micro DMX via libusb
 *
 * The device is NOT an FTDI chip despite SoundSwitch's class hierarchy.
 * Evidence: only 1 endpoint (EP 0x01 OUT), bInterfaceClass=0, FTDI vendor
 * control transfers time out. D2XX cannot open the device.
 *
 * This script tests communication via libusb with multiple protocol variants:
 *   Test 1: Raw 514-byte packets (toDMX512Packet format from disassembly)
 *   Test 2: Enttec Pro framing with API key activation
 *   Test 3: Raw 513-byte DMX packets (start code + 512 channels)
 *   Test 4: Enttec Pro framing WITHOUT API key
 *
 * Usage: node scripts/test-libusb.mjs
 *        Ensure laser is in DMX mode, address 001, and SoundSwitch app is closed.
 */

import { usb } from 'usb';
import * as readline from 'readline';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// SoundSwitch API key — from Ghidra disassembly of configureFtDevice
const SS_API_KEY = Buffer.from([0xC9, 0xA4, 0x03, 0xE4]);

function buildEnttecPacket(label, data) {
  const len = data.length;
  const packet = Buffer.alloc(len + 5);
  packet[0] = 0x7E;              // start
  packet[1] = label;
  packet[2] = len & 0xFF;        // length low
  packet[3] = (len >> 8) & 0xFF; // length high
  data.copy(packet, 4);
  packet[len + 4] = 0xE7;        // end
  return packet;
}

function bulkWrite(outEp, data, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    outEp.timeout = timeoutMs;
    outEp.transfer(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function question(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('=== SoundSwitch Micro DMX — libusb Protocol Test ===\n');

  // Find device
  const devices = usb.getDeviceList();
  const dev = devices.find(
    d => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );

  if (!dev) {
    console.error('Device not found. Is it plugged in?');
    process.exit(1);
  }

  console.log('Device found: VID=0x%s PID=0x%s', VID.toString(16), PID.toString(16));

  // Open device
  dev.open();
  console.log('Device opened');

  // Read string descriptors
  try {
    const product = await new Promise((res, rej) => {
      dev.getStringDescriptor(dev.deviceDescriptor.iProduct, (err, val) => err ? rej(err) : res(val));
    });
    console.log('Product:', product);
  } catch {}

  try {
    const serial = await new Promise((res, rej) => {
      dev.getStringDescriptor(dev.deviceDescriptor.iSerialNumber, (err, val) => err ? rej(err) : res(val));
    });
    console.log('Serial:', serial);
  } catch {}

  // Claim interface (matching SSV1DMX::configure)
  const iface = dev.interface(0);
  try {
    if (iface.isKernelDriverActive()) iface.detachKernelDriver();
  } catch {}
  iface.claim();
  console.log('Interface 0 claimed');

  // Set alt setting (SSV1DMX::configure calls setAltSetting(0,0))
  try {
    await new Promise((res, rej) => {
      iface.setAltSetting(0, err => err ? rej(err) : res());
    });
    console.log('Alt setting 0 set');
  } catch (e) {
    console.log('setAltSetting:', e.message);
  }

  // Find OUT endpoint
  const outEp = iface.endpoints.find(e => e.direction === 'out');
  if (!outEp) {
    console.error('No OUT endpoint found!');
    process.exit(1);
  }
  console.log('OUT endpoint: 0x%s (type=%d)\n', outEp.address.toString(16).padStart(2, '0'), outEp.transferType);

  // ── Pre-test: Try FTDI write control transfers ──
  // The diagnostic showed READ (0xC0) times out, but WRITE (0x40) might work.
  // If these succeed, the device has FTDI-like control interface.
  console.log('── Pre-test: FTDI control transfer probe ──');

  function controlTransfer(bmReq, bReq, wVal, wIdx, dataOrLen) {
    return new Promise((resolve, reject) => {
      dev.controlTransfer(bmReq, bReq, wVal, wIdx, dataOrLen, (err, buf) => {
        if (err) reject(err);
        else resolve(buf);
      });
    });
  }

  // Try FTDI SET operations (host-to-device, 0x40)
  const ftdiTests = [
    { name: 'RESET',        req: 0x00, val: 0x0000, idx: 0 },
    { name: 'SET_BAUDRATE',  req: 0x03, val: 12,     idx: 0 },  // 250000 baud (divisor=12)
    { name: 'SET_DATA 8N2',  req: 0x04, val: 0x1008, idx: 0 },  // 8 data + 2 stop
    { name: 'SET_FLOW NONE', req: 0x02, val: 0,      idx: 0 },
    { name: 'SET_LATENCY 2', req: 0x09, val: 2,      idx: 0 },
    { name: 'MODEM_CTRL (DTR/RTS low)', req: 0x01, val: 0x0300, idx: 0 },  // bits: DTR=0, RTS=0
  ];

  let ftdiWorks = false;
  for (const t of ftdiTests) {
    try {
      await controlTransfer(0x40, t.req, t.val, t.idx, Buffer.alloc(0));
      console.log('  ✓ FTDI %s — OK', t.name);
      ftdiWorks = true;
    } catch (e) {
      console.log('  ✗ FTDI %s — %s', t.name, e.message);
      break;  // If first one fails, skip rest
    }
  }

  if (ftdiWorks) {
    console.log('  → FTDI write control transfers WORK! Device may be FTDI after all.');
    console.log('  → Purging buffers...');
    try {
      await controlTransfer(0x40, 0x00, 1, 0, Buffer.alloc(0));  // purge RX
      await controlTransfer(0x40, 0x00, 2, 0, Buffer.alloc(0));  // purge TX
      console.log('  ✓ Purge complete');
    } catch (e) {
      console.log('  ✗ Purge:', e.message);
    }
  } else {
    console.log('  → FTDI control transfers do NOT work. Device is not FTDI.');
  }
  console.log('');

  // Check: did the LED turn on after FTDI config?
  var response = await question(rl, '  Is the blue LED on the adapter ON now? (y/n): ');
  if (response.toLowerCase() === 'y') {
    console.log('  → FTDI configuration activated the device!');
  }
  console.log('');

  // ── Build test DMX data ──
  // Set master dimmer, manual mode, and RED pattern for visibility
  const dmxChannels = Buffer.alloc(512, 0);
  dmxChannels[0] = 100;   // CH1: Laser On/Off (Sound Active)
  dmxChannels[2] = 255;   // CH3: Group Selection (Animations)
  dmxChannels[3] = 28;    // CH4: Pattern Selection
  dmxChannels[10] = 152;  // CH11: Fixed Color
  dmxChannels[14] = 217;  // CH15: Drawing 2 (Dynamic C)

  const FRAME_COUNT = 200;     // frames per test
  const FRAME_DELAY_MS = 25;   // 40Hz

  // ════════════════════════════════════════════
  // TEST 1: Raw 514 bytes (toDMX512Packet)
  // From disassembly: 512 DMX bytes + 2 LED bytes
  // ════════════════════════════════════════════
  console.log('═══ TEST 1: Raw 514-byte packets (toDMX512Packet format) ═══');
  console.log('  Format: [CH1..CH512][LED_hi][LED_lo]');
  console.log('  Endpoint: 0x%s', outEp.address.toString(16).padStart(2, '0'));
  console.log('  Sending %d frames at %dHz...', FRAME_COUNT, 1000 / FRAME_DELAY_MS);

  try {
    const frame514 = Buffer.alloc(514, 0);
    dmxChannels.copy(frame514, 0);
    frame514[512] = 0xFF;  // LED brightness high
    frame514[513] = 0xFF;  // LED brightness low

    for (let i = 0; i < FRAME_COUNT; i++) {
      await sleep(FRAME_DELAY_MS);
      await bulkWrite(outEp, frame514);
      if (i === 0) console.log('  Writing... WATCH THE LASER');
    }
    console.log('  Done (no errors)');
  } catch (e) {
    console.log('  Error:', e.message);
  }

  response = await question(rl, '\n  Did anything happen? (y/n/skip to next): ');
  if (response.toLowerCase() === 'y') {
    console.log('\n  ★ TEST 1 WORKS! Raw 514-byte format is correct.');
    await cleanup(dev, iface, rl);
    return;
  }

  // ════════════════════════════════════════════
  // TEST 2: Enttec Pro framing WITH API key activation
  // From Ghidra: configureFtDevice sends API key then enable
  // ════════════════════════════════════════════
  console.log('\n═══ TEST 2: Enttec Pro framing WITH API key activation ═══');
  console.log('  Step 1: Send API key (label 0x0D)');

  try {
    const apiPacket = buildEnttecPacket(0x0D, SS_API_KEY);
    console.log('    Packet:', bufHex(apiPacket));
    await bulkWrite(outEp, apiPacket);
    console.log('    Sent. Waiting 200ms...');
    await sleep(200);

    console.log('  Step 2: Send enable output (label 0x93)');
    const enablePacket = buildEnttecPacket(0x93, Buffer.from([0x01, 0x01]));
    console.log('    Packet:', bufHex(enablePacket));
    await bulkWrite(outEp, enablePacket);
    await sleep(50);

    console.log('  Step 3: Sending DMX frames (label 0x06)...');
    const dmxData = Buffer.alloc(513, 0);
    dmxData[0] = 0x00;  // start code
    dmxChannels.copy(dmxData, 1);
    const dmxPacket = buildEnttecPacket(0x06, dmxData);
    console.log('    Packet size: %d bytes', dmxPacket.length);

    for (let i = 0; i < FRAME_COUNT; i++) {
      await sleep(FRAME_DELAY_MS);
      await bulkWrite(outEp, dmxPacket);
      if (i === 0) console.log('    Writing... WATCH THE LASER');
    }
    console.log('  Done (no errors)');
  } catch (e) {
    console.log('  Error:', e.message);
  }

  response = await question(rl, '\n  Did anything happen? (y/n/skip to next): ');
  if (response.toLowerCase() === 'y') {
    console.log('\n  ★ TEST 2 WORKS! Enttec Pro + API key is correct.');
    await cleanup(dev, iface, rl);
    return;
  }

  // ════════════════════════════════════════════
  // TEST 3: Raw 513 bytes (start code + 512 channels)
  // Standard Enttec Open DMX format without framing
  // ════════════════════════════════════════════
  console.log('\n═══ TEST 3: Raw 513-byte DMX packets (start code + channels) ═══');
  console.log('  Format: [0x00][CH1..CH512]');

  try {
    const frame513 = Buffer.alloc(513, 0);
    frame513[0] = 0x00;
    dmxChannels.copy(frame513, 1);

    for (let i = 0; i < FRAME_COUNT; i++) {
      await sleep(FRAME_DELAY_MS);
      await bulkWrite(outEp, frame513);
      if (i === 0) console.log('  Writing... WATCH THE LASER');
    }
    console.log('  Done (no errors)');
  } catch (e) {
    console.log('  Error:', e.message);
  }

  response = await question(rl, '\n  Did anything happen? (y/n/skip to next): ');
  if (response.toLowerCase() === 'y') {
    console.log('\n  ★ TEST 3 WORKS! Raw 513-byte format is correct.');
    await cleanup(dev, iface, rl);
    return;
  }

  // ════════════════════════════════════════════
  // TEST 4: Enttec Pro framing WITHOUT API key
  // Maybe this device doesn't need activation
  // ════════════════════════════════════════════
  console.log('\n═══ TEST 4: Enttec Pro framing WITHOUT API key ═══');

  try {
    const dmxData = Buffer.alloc(513, 0);
    dmxData[0] = 0x00;
    dmxChannels.copy(dmxData, 1);
    const dmxPacket = buildEnttecPacket(0x06, dmxData);

    for (let i = 0; i < FRAME_COUNT; i++) {
      await sleep(FRAME_DELAY_MS);
      await bulkWrite(outEp, dmxPacket);
      if (i === 0) console.log('  Writing... WATCH THE LASER');
    }
    console.log('  Done (no errors)');
  } catch (e) {
    console.log('  Error:', e.message);
  }

  response = await question(rl, '\n  Did anything happen? (y/n/skip to next): ');
  if (response.toLowerCase() === 'y') {
    console.log('\n  ★ TEST 4 WORKS! Enttec Pro without API key.');
    await cleanup(dev, iface, rl);
    return;
  }

  // ════════════════════════════════════════════
  // TEST 5: API key + Raw 514 bytes (hybrid)
  // Maybe activation is needed but data format is raw
  // ════════════════════════════════════════════
  console.log('\n═══ TEST 5: API key activation + Raw 514-byte packets ═══');

  try {
    // Send activation via Enttec Pro framing
    const apiPacket = buildEnttecPacket(0x0D, SS_API_KEY);
    await bulkWrite(outEp, apiPacket);
    await sleep(200);
    const enablePacket = buildEnttecPacket(0x93, Buffer.from([0x01, 0x01]));
    await bulkWrite(outEp, enablePacket);
    await sleep(50);
    console.log('  Activation sent. Now sending raw 514-byte frames...');

    const frame514 = Buffer.alloc(514, 0);
    dmxChannels.copy(frame514, 0);
    frame514[512] = 0xFF;
    frame514[513] = 0xFF;

    for (let i = 0; i < FRAME_COUNT; i++) {
      await sleep(FRAME_DELAY_MS);
      await bulkWrite(outEp, frame514);
      if (i === 0) console.log('  Writing... WATCH THE LASER');
    }
    console.log('  Done (no errors)');
  } catch (e) {
    console.log('  Error:', e.message);
  }

  response = await question(rl, '\n  Did anything happen? (y/n/skip to next): ');
  if (response.toLowerCase() === 'y') {
    console.log('\n  ★ TEST 5 WORKS! API key + raw 514-byte format.');
    await cleanup(dev, iface, rl);
    return;
  }

  // ════════════════════════════════════════════
  // TEST 6: FTDI break-based Open DMX (if FTDI control transfers worked)
  // This is the classic Enttec Open DMX protocol with break signal
  // ════════════════════════════════════════════
  if (ftdiWorks) {
    console.log('\n═══ TEST 6: FTDI break-based Open DMX (break signal + raw 513 bytes) ═══');
    console.log('  This uses FTDI control transfers for break signal, then bulk data');

    try {
      const lineProps = 0x1008;  // 8N2
      const BREAK_ON = 0x4000;
      const BREAK_OFF = 0x0000;

      const frame513 = Buffer.alloc(513, 0);
      frame513[0] = 0x00;
      dmxChannels.copy(frame513, 1);

      for (let i = 0; i < FRAME_COUNT; i++) {
        // Break ON
        await controlTransfer(0x40, 0x04, lineProps | BREAK_ON, 0, Buffer.alloc(0));
        // Break OFF (USB round-trip >= 1ms, well above 88us minimum)
        await controlTransfer(0x40, 0x04, lineProps | BREAK_OFF, 0, Buffer.alloc(0));
        // Send DMX frame
        await bulkWrite(outEp, frame513);
        if (i === 0) console.log('  Writing with break signal... WATCH THE LASER');
        await sleep(FRAME_DELAY_MS);
      }
      console.log('  Done (no errors)');
    } catch (e) {
      console.log('  Error:', e.message);
    }

    response = await question(rl, '\n  Did anything happen? (y/n/skip to next): ');
    if (response.toLowerCase() === 'y') {
      console.log('\n  ★ TEST 6 WORKS! FTDI break-based Open DMX.');
      await cleanup(dev, iface, rl);
      return;
    }
  }

  // ════════════════════════════════════════════
  // TEST 7: Try EP 0x02 (SoundSwitch disassembly says EP 0x02)
  // Even though descriptor says EP 0x01
  // ════════════════════════════════════════════
  console.log('\n═══ TEST 7: Force EP 0x02 (from SoundSwitch disassembly) ═══');
  console.log('  SoundSwitch uses UsbDevice::write(0x02, ...) but descriptor shows EP 0x01');

  try {
    // Hack the endpoint address
    const origAddr = outEp.address;
    outEp.address = 0x02;

    // Full sequence: API key + enable + DMX via Enttec Pro
    const apiPacket = buildEnttecPacket(0x0D, SS_API_KEY);
    await bulkWrite(outEp, apiPacket);
    await sleep(200);
    const enablePacket = buildEnttecPacket(0x93, Buffer.from([0x01, 0x01]));
    await bulkWrite(outEp, enablePacket);
    await sleep(50);

    const dmxData = Buffer.alloc(513, 0);
    dmxData[0] = 0x00;
    dmxChannels.copy(dmxData, 1);
    const dmxPacket = buildEnttecPacket(0x06, dmxData);

    for (let i = 0; i < FRAME_COUNT; i++) {
      await sleep(FRAME_DELAY_MS);
      await bulkWrite(outEp, dmxPacket);
      if (i === 0) console.log('  Writing to EP 0x02... WATCH THE LASER');
    }
    console.log('  Done (no errors)');
    outEp.address = origAddr;
  } catch (e) {
    console.log('  Error:', e.message);
    outEp.address = 0x01;  // restore
  }

  response = await question(rl, '\n  Did anything happen? (y/n/skip to next): ');
  if (response.toLowerCase() === 'y') {
    console.log('\n  ★ TEST 7 WORKS! EP 0x02 with Enttec Pro framing.');
    await cleanup(dev, iface, rl);
    return;
  }

  // ════════════════════════════════════════════
  // TEST 8: EP 0x02 with raw 514-byte + API key
  // ════════════════════════════════════════════
  console.log('\n═══ TEST 8: EP 0x02 + API key + raw 514 bytes ═══');

  try {
    const origAddr = outEp.address;
    outEp.address = 0x02;

    const apiPacket = buildEnttecPacket(0x0D, SS_API_KEY);
    await bulkWrite(outEp, apiPacket);
    await sleep(200);
    const enablePacket = buildEnttecPacket(0x93, Buffer.from([0x01, 0x01]));
    await bulkWrite(outEp, enablePacket);
    await sleep(50);

    const frame514 = Buffer.alloc(514, 0);
    dmxChannels.copy(frame514, 0);
    frame514[512] = 0xFF;
    frame514[513] = 0xFF;

    for (let i = 0; i < FRAME_COUNT; i++) {
      await sleep(FRAME_DELAY_MS);
      await bulkWrite(outEp, frame514);
      if (i === 0) console.log('  Writing... WATCH THE LASER');
    }
    console.log('  Done (no errors)');
    outEp.address = origAddr;
  } catch (e) {
    console.log('  Error:', e.message);
    outEp.address = 0x01;
  }

  response = await question(rl, '\n  Did anything happen? (y/n): ');
  if (response.toLowerCase() === 'y') {
    console.log('\n  ★ TEST 8 WORKS!');
    await cleanup(dev, iface, rl);
    return;
  }

  console.log('\n  No test produced visible output.');
  console.log('  Checklist:');
  console.log('    1. Is the laser in DMX mode? (Hold MODE until display shows d001)');
  console.log('    2. Is the DMX start address set to 001?');
  console.log('    3. Is the XLR cable connected from adapter to laser?');
  console.log('    4. Is the blue LED on the SoundSwitch adapter lit?');

  await cleanup(dev, iface, rl);
}

async function cleanup(dev, iface, rl) {
  console.log('\nBlacking out and closing...');
  try {
    const outEp = iface.endpoints.find(e => e.direction === 'out');
    if (outEp) {
      // Send a few blackout frames
      const blackout = Buffer.alloc(514, 0);
      for (let i = 0; i < 5; i++) {
        await bulkWrite(outEp, blackout).catch(() => {});
        await sleep(25);
      }
    }
  } catch {}

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

function bufHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
