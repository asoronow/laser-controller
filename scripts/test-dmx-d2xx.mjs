#!/usr/bin/env node
// test-dmx-d2xx.mjs — Interactive DMX test using FTDI D2XX library
// Run: node scripts/test-dmx-d2xx.mjs
//
// This script:
// 1. Kills SoundSwitch if running
// 2. Opens the device via D2XX (bypasses libusb endpoint issue)
// 3. Runs DMX test patterns
// 4. Asks if the laser responded

import koffi from "koffi";
import { execSync } from "child_process";
import { existsSync } from "fs";
import readline from "readline";

const VID = 0x15e4;
const PID = 0x0053;
const FT_OK = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

// ── Find and load D2XX library ──

const LIB_PATHS = [
  "/Applications/SoundSwitch.app/Contents/Frameworks/libftd2xx.1.4.24.dylib",
  "/usr/local/lib/libftd2xx.dylib",
  "/opt/homebrew/lib/libftd2xx.dylib",
];

const libPath = LIB_PATHS.find((p) => existsSync(p));
if (!libPath) {
  console.error("ERROR: libftd2xx not found. Searched:");
  LIB_PATHS.forEach((p) => console.error(`  ${p}`));
  process.exit(1);
}
console.log(`Loading D2XX from: ${libPath}\n`);

const lib = koffi.load(libPath);

const FT_SetVIDPID = lib.func("uint32 FT_SetVIDPID(uint32, uint32)");
const FT_CreateDeviceInfoList = lib.func("uint32 FT_CreateDeviceInfoList(_Out_ uint32 *)");
const FT_GetDeviceInfoDetail = lib.func(
  "uint32 FT_GetDeviceInfoDetail(uint32 index, _Out_ uint32 *flags, _Out_ uint32 *type, _Out_ uint32 *id, _Out_ uint32 *locId, void *serial, void *desc, _Out_ void **handle)"
);
const FT_Open = lib.func("uint32 FT_Open(int, _Out_ void **)");
const FT_OpenEx = lib.func("uint32 FT_OpenEx(void *arg, uint32 flags, _Out_ void **handle)");
const FT_Close = lib.func("uint32 FT_Close(void *)");
const FT_ResetDevice = lib.func("uint32 FT_ResetDevice(void *)");
const FT_SetBaudRate = lib.func("uint32 FT_SetBaudRate(void *, uint32)");
const FT_SetDataCharacteristics = lib.func("uint32 FT_SetDataCharacteristics(void *, uint8, uint8, uint8)");
const FT_SetFlowControl = lib.func("uint32 FT_SetFlowControl(void *, uint16, uint8, uint8)");
const FT_ClrRts = lib.func("uint32 FT_ClrRts(void *)");
const FT_SetDtr = lib.func("uint32 FT_SetDtr(void *)");
const FT_ClrDtr = lib.func("uint32 FT_ClrDtr(void *)");
const FT_Purge = lib.func("uint32 FT_Purge(void *, uint32)");
const FT_SetUSBParameters = lib.func("uint32 FT_SetUSBParameters(void *, uint32, uint32)");
const FT_SetLatencyTimer = lib.func("uint32 FT_SetLatencyTimer(void *, uint8)");
const FT_SetTimeouts = lib.func("uint32 FT_SetTimeouts(void *, uint32, uint32)");
const FT_SetBreakOn = lib.func("uint32 FT_SetBreakOn(void *)");
const FT_SetBreakOff = lib.func("uint32 FT_SetBreakOff(void *)");
const FT_Write = lib.func("uint32 FT_Write(void *, void *, uint32, _Out_ uint32 *)");
const FT_Read = lib.func("uint32 FT_Read(void *, void *, uint32, _Out_ uint32 *)");
const FT_GetQueueStatus = lib.func("uint32 FT_GetQueueStatus(void *, _Out_ uint32 *)");

// FT_OpenEx flags
const FT_OPEN_BY_SERIAL_NUMBER = 1;
const FT_OPEN_BY_DESCRIPTION = 2;
const FT_OPEN_BY_LOCATION = 4;

// SoundSwitch API key — extracted from Ghidra disassembly of
// hardware::interface::EnttecCompatible::Private::configureFtDevice
const SS_API_KEY = Buffer.from([0xc9, 0xa4, 0x03, 0xe4]);

function check(name, status) {
  if (status !== FT_OK) {
    throw new Error(`${name} failed with FT_STATUS ${status}`);
  }
}

/**
 * Build an Enttec Pro-style packet: [0x7E] [label] [len_lo] [len_hi] [data...] [0xE7]
 * This is the framing format used by SoundSwitch's sendFtPacket().
 */
function buildEnttecPacket(label, data) {
  const len = data.length;
  const packet = Buffer.alloc(len + 5);
  packet[0] = 0x7e; // start
  packet[1] = label;
  packet[2] = len & 0xff; // length low byte
  packet[3] = (len >> 8) & 0xff; // length high byte
  data.copy(packet, 4);
  packet[len + 4] = 0xe7; // end
  return packet;
}

function ftWrite(handle, data) {
  const written = [0];
  const st = FT_Write(handle, data, data.length, written);
  return { status: st, written: written[0] };
}

/**
 * Send DMX frame using Enttec Pro label 6 (Send DMX Packet).
 * Frame: [0x7E] [0x06] [len_lo] [len_hi] [0x00 start_code] [512 channels] [0xE7]
 */
function sendDMXFrame(handle, channels) {
  const dmxData = Buffer.alloc(513);
  dmxData[0] = 0x00; // DMX start code
  channels.copy(dmxData, 1, 0, Math.min(channels.length, 512));
  const packet = buildEnttecPacket(0x06, dmxData);
  return ftWrite(handle, packet);
}

/**
 * Activate the SoundSwitch device.
 * From Ghidra disassembly: configureFtDevice sends:
 *   1. API key: label=0x0D, data=[0xC9, 0xA4, 0x03, 0xE4]
 *   2. Wait 200ms, read response
 *   3. Enable output: label=0x93, data=[0x01, 0x01]
 */
async function activateDevice(handle) {
  console.log("Sending API key (label=0x0D)...");
  const apiPacket = buildEnttecPacket(0x0d, SS_API_KEY);
  const r1 = ftWrite(handle, apiPacket);
  check("API key write", r1.status);
  console.log(`  Sent ${r1.written} bytes: ${apiPacket.toString("hex")}`);

  // Wait 200ms for device to process (matches SoundSwitch's sleep_for(200ms))
  await sleep(200);

  // Read any response from the device
  const rxCount = [0];
  FT_GetQueueStatus(handle, rxCount);
  if (rxCount[0] > 0) {
    const rxBuf = Buffer.alloc(rxCount[0]);
    const rxRead = [0];
    FT_Read(handle, rxBuf, rxCount[0], rxRead);
    console.log(`  Device response (${rxRead[0]} bytes): ${rxBuf.toString("hex")}`);
  } else {
    console.log("  No response from device (may be OK)");
  }

  console.log("Sending enable output (label=0x93)...");
  const enablePacket = buildEnttecPacket(0x93, Buffer.from([0x01, 0x01]));
  const r2 = ftWrite(handle, enablePacket);
  check("Enable output write", r2.status);
  console.log(`  Sent ${r2.written} bytes: ${enablePacket.toString("hex")}`);

  await sleep(50);
  console.log("Device activated!\n");
}

// ── Main ──

async function main() {
  console.log("=== SoundSwitch Micro DMX — D2XX Test ===\n");

  // Step 1: Kill SoundSwitch
  try {
    const pid = execSync("pgrep -f SoundSwitch.app 2>/dev/null", { encoding: "utf-8" }).trim();
    if (pid) {
      console.log(`SoundSwitch is running (PID ${pid}). Killing...`);
      execSync(`kill ${pid}`);
      await sleep(1500);
      console.log("Killed. Waiting for USB release...\n");
    }
  } catch {
    console.log("SoundSwitch is not running.\n");
  }

  // Step 2: Open device
  check("FT_SetVIDPID", FT_SetVIDPID(VID, PID));

  const numDevs = [0];
  check("FT_CreateDeviceInfoList", FT_CreateDeviceInfoList(numDevs));
  console.log(`D2XX devices found: ${numDevs[0]}`);

  if (numDevs[0] === 0) {
    console.error("\nNo device found. Check:");
    console.error("  - Is the adapter plugged in?");
    console.error("  - Is the blue LED on?");
    console.error("  - Try unplugging and replugging.");
    process.exit(1);
  }

  // Get device info for diagnostics
  const flags = [0], dtype = [0], devId = [0], locId = [0];
  const serialBuf = Buffer.alloc(64, 0);
  const descBuf = Buffer.alloc(64, 0);
  const infoHandle = [null];
  const infoSt = FT_GetDeviceInfoDetail(0, flags, dtype, devId, locId, serialBuf, descBuf, infoHandle);
  if (infoSt === FT_OK) {
    const serial = serialBuf.toString("utf-8").replace(/\0/g, "");
    const desc = descBuf.toString("utf-8").replace(/\0/g, "");
    console.log(`  Flags:    0x${flags[0].toString(16)} ${flags[0] & 1 ? "(OPENED by another process!)" : "(available)"}`);
    console.log(`  Type:     ${dtype[0]}`);
    console.log(`  ID:       0x${devId[0].toString(16)}`);
    console.log(`  LocID:    0x${locId[0].toString(16)}`);
    console.log(`  Serial:   "${serial}"`);
    console.log(`  Desc:     "${desc}"`);
  }

  // Try multiple open strategies
  const handle = [null];
  let h = null;
  let openMethod = "";

  // Strategy 1: FT_Open by index
  let st = FT_Open(0, handle);
  if (st === FT_OK) {
    h = handle[0];
    openMethod = "FT_Open(index=0)";
  } else {
    console.log(`\nFT_Open(0) failed: status ${st}`);

    // Strategy 2: FT_OpenEx by serial number
    const serial = serialBuf.toString("utf-8").replace(/\0/g, "");
    if (serial) {
      console.log(`Trying FT_OpenEx by serial "${serial}"...`);
      st = FT_OpenEx(Buffer.from(serial + "\0"), FT_OPEN_BY_SERIAL_NUMBER, handle);
      if (st === FT_OK) {
        h = handle[0];
        openMethod = `FT_OpenEx(serial="${serial}")`;
      } else {
        console.log(`FT_OpenEx(serial) failed: status ${st}`);
      }
    }

    // Strategy 3: FT_OpenEx by description
    if (!h) {
      const desc = descBuf.toString("utf-8").replace(/\0/g, "");
      if (desc) {
        console.log(`Trying FT_OpenEx by description "${desc}"...`);
        st = FT_OpenEx(Buffer.from(desc + "\0"), FT_OPEN_BY_DESCRIPTION, handle);
        if (st === FT_OK) {
          h = handle[0];
          openMethod = `FT_OpenEx(desc="${desc}")`;
        } else {
          console.log(`FT_OpenEx(desc) failed: status ${st}`);
        }
      }
    }

    // Strategy 4: FT_OpenEx by location
    if (!h && locId[0]) {
      console.log(`Trying FT_OpenEx by location 0x${locId[0].toString(16)}...`);
      // Location ID needs to be passed as a uint32 value, not string
      const locBuf = Buffer.alloc(4);
      locBuf.writeUInt32LE(locId[0]);
      st = FT_OpenEx(locBuf, FT_OPEN_BY_LOCATION, handle);
      if (st === FT_OK) {
        h = handle[0];
        openMethod = `FT_OpenEx(loc=0x${locId[0].toString(16)})`;
      } else {
        console.log(`FT_OpenEx(loc) failed: status ${st}`);
      }
    }
  }

  if (!h) {
    console.error("\nAll open strategies failed.");
    console.error("The D2XX library can see the device but cannot claim it.");
    console.error("\nTry these steps:");
    console.error("  1. Unplug the adapter, wait 3 seconds, plug it back in");
    console.error("  2. Check if any process holds the USB device:");
    console.error("     lsof | grep -i usb");
    console.error("  3. Check for AppleUSBFTDI kext:");
    console.error("     kextstat | grep -i ftdi");
    console.error("  4. Run the Python test that previously worked:");
    console.error("     python3 scripts/archive/test-d2xx-quick.py");
    process.exit(1);
  }

  console.log(`Device opened via ${openMethod}!\n`);

  // Step 3: Configure for DMX512
  // Matches SoundSwitch's EnttecCompatible::configureFtDevice sequence:
  //   1. Reset + initial purge
  //   2. "Configure as UART" (baud, data, flow, timeouts, latency, USB params)
  //   3. "Configure as Enttec compatible" (RTS/DTR, final purge)
  console.log("Configuring: 250000 baud, 8N2, no flow control...");

  // Reset and initial purge
  check("FT_ResetDevice", FT_ResetDevice(h));
  check("FT_Purge", FT_Purge(h, 3)); // purge RX+TX

  // Configure as UART
  check("FT_SetBaudRate", FT_SetBaudRate(h, 250000));
  check("FT_SetDataCharacteristics", FT_SetDataCharacteristics(h, 8, 2, 0)); // 8N2
  check("FT_SetFlowControl", FT_SetFlowControl(h, 0, 0, 0)); // no flow control
  check("FT_SetTimeouts", FT_SetTimeouts(h, 500, 500));
  check("FT_SetLatencyTimer", FT_SetLatencyTimer(h, 2));
  check("FT_SetUSBParameters", FT_SetUSBParameters(h, 4096, 4096)); // USB transfer buffer sizes

  // Configure as Enttec compatible
  // CRITICAL FIX: SoundSwitch uses ClrRts + ClrDtr (both LOW)
  // Previous version used SetDtr (HIGH) which likely disables the RS-485 transmitter
  check("FT_ClrRts", FT_ClrRts(h));
  check("FT_ClrDtr", FT_ClrDtr(h));  // was FT_SetDtr — THIS IS THE KEY FIX
  check("FT_Purge", FT_Purge(h, 3)); // second purge after config

  console.log("UART configured! (DTR=LOW, RTS=LOW)\n");

  // Step 4: Activate device — send API key + enable output
  // This is the critical step we were missing! The device firmware
  // ignores all DMX data until it receives the API key handshake.
  await activateDevice(h);

  const channels = Buffer.alloc(512, 0);

  // ── Test patterns ──

  // Test 1: Blackout
  console.log("--- Test 1: Blackout (all zeros, 2s) ---");
  console.log("    Laser should be OFF.");
  channels.fill(0);
  for (let i = 0; i < 80; i++) {
    sendDMXFrame(h, channels);
    await sleep(25);
  }
  const a1 = await ask("    Is the laser off? (y/n): ");
  console.log();

  // Test 2: All channels 255
  console.log("--- Test 2: ALL 512 channels at 255 (3s) ---");
  console.log("    This detects if your DMX start address is wrong.");
  console.log("    Laser should do SOMETHING if the adapter works.");
  channels.fill(255);
  for (let i = 0; i < 120; i++) {
    sendDMXFrame(h, channels);
    await sleep(25);
  }
  const a2 = await ask("    Did the laser respond? (y/n): ");
  console.log();

  // Test 3: CH1 only
  console.log("--- Test 3: CH1=255 (master dimmer only, 3s) ---");
  channels.fill(0);
  channels[0] = 255; // CH1
  for (let i = 0; i < 120; i++) {
    sendDMXFrame(h, channels);
    await sleep(25);
  }
  const a3 = await ask("    Did the laser respond? (y/n): ");
  console.log();

  // Test 4: Manual mode + red
  console.log("--- Test 4: CH1=255 CH2=225 CH5=255 (manual+red, 3s) ---");
  channels.fill(0);
  channels[0] = 100; // CH1: Laser On/Off (Sound Active)
  channels[2] = 255; // CH3: Group Selection (Animations)
  channels[3] = 28;  // CH4: Pattern Selection
  for (let i = 0; i < 120; i++) {
    sendDMXFrame(h, channels);
    await sleep(25);
  }
  const a4 = await ask("    Did the laser show red? (y/n): ");
  console.log();

  // Test 5: Smooth ramp
  console.log("--- Test 5: CH1 ramp 0->255 over 3s ---");
  channels.fill(0);
  channels[1] = 225; // keep manual mode
  channels[4] = 255; // keep red
  for (let v = 0; v <= 255; v++) {
    channels[0] = v;
    sendDMXFrame(h, channels);
    await sleep(12);
  }
  const a5 = await ask("    Did brightness ramp up? (y/n): ");
  console.log();

  // ── Results ──
  console.log("=== Results ===\n");
  const tests = [
    { name: "Blackout", answer: a1 },
    { name: "All 255", answer: a2 },
    { name: "CH1 dimmer", answer: a3 },
    { name: "Manual+red", answer: a4 },
    { name: "Ramp", answer: a5 },
  ];

  let anyWorked = false;
  for (const t of tests) {
    const ok = t.answer.toLowerCase().startsWith("y");
    if (ok) anyWorked = true;
    console.log(`  ${ok ? "PASS" : "FAIL"}: ${t.name}`);
  }

  if (anyWorked) {
    console.log("\nDMX output is WORKING via D2XX!");
    console.log("The D2XX driver can control your laser.");
  } else {
    console.log("\nNo test produced a visible response.");
    console.log("Troubleshooting:");
    console.log("  1. Is the laser powered on?");
    console.log("  2. Is the XLR cable connected adapter -> laser?");
    console.log("  3. Is the laser's DMX start address set to 1?");
    console.log("  4. Try: Set laser to its built-in sound mode to verify it works at all.");
  }

  // Blackout and close
  channels.fill(0);
  for (let i = 0; i < 5; i++) {
    sendDMXFrame(h, channels);
    await sleep(25);
  }
  FT_Close(h);
  console.log("\nDevice closed.");

  rl.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  rl.close();
  process.exit(1);
});
