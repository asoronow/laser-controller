/**
 * SoundSwitch Micro DMX — FTDI D2XX Driver
 *
 * Uses FTDI's proprietary D2XX library (libftd2xx) via koffi FFI to communicate
 * with the SoundSwitch Micro DMX Interface (VID:0x15E4, PID:0x0053).
 *
 * The device is an FTDI FT232R with reprogrammed VID/PID. SoundSwitch uses the
 * D2XX library with Enttec Open DMX compatible protocol. The class hierarchy in
 * SoundSwitch is: SSV1DMX → EnttecCompatible → Ftd2xxDevice.
 *
 * Configuration sequence matched from SoundSwitch binary analysis:
 *   1. FT_SetVIDPID to register custom VID/PID
 *   2. Reset + purge
 *   3. "Configure as UART": 250000 baud, 8N2, no flow control
 *   4. "Configure as Enttec compatible": ClrRts, ClrDtr, purge
 *   5. DMX loop: break on → break off → write 513 bytes (0x00 + 512 channels)
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const koffi = require("koffi");
import { execSync } from "child_process";

const VID = 0x15e4;
const PID = 0x0053;
const FT_OK = 0;
const DMX_REFRESH_HZ = 40;

// SoundSwitch API key — extracted from Ghidra disassembly of
// hardware::interface::EnttecCompatible::Private::configureFtDevice
// The device firmware ignores all DMX data until it receives this handshake.
const SS_API_KEY = Buffer.from([0xc9, 0xa4, 0x03, 0xe4]);

// D2XX library search paths (prefer SoundSwitch's bundled copy)
const LIB_PATHS = [
  "/Applications/SoundSwitch.app/Contents/Frameworks/libftd2xx.1.4.24.dylib",
  "/usr/local/lib/libftd2xx.dylib",
  "/opt/homebrew/lib/libftd2xx.dylib",
];

// FT_OpenEx flags
const FT_OPEN_BY_SERIAL_NUMBER = 1;
const FT_OPEN_BY_DESCRIPTION = 2;

// Lazy-loaded bindings
let d2xx: ReturnType<typeof loadD2XX> | null = null;

function findLibrary(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs");
  for (const path of LIB_PATHS) {
    if (fs.existsSync(path)) return path;
  }
  throw new Error(
    `libftd2xx not found. Searched:\n  ${LIB_PATHS.join("\n  ")}\n` +
      "Install SoundSwitch or download from ftdichip.com"
  );
}

function loadD2XX() {
  const libPath = findLibrary();
  const lib = koffi.load(libPath);

  return {
    path: libPath,
    // Device enumeration
    FT_SetVIDPID: lib.func("uint32 FT_SetVIDPID(uint32, uint32)"),
    FT_CreateDeviceInfoList: lib.func(
      "uint32 FT_CreateDeviceInfoList(_Out_ uint32 *)"
    ),
    FT_GetDeviceInfoDetail: lib.func(
      "uint32 FT_GetDeviceInfoDetail(uint32 index, _Out_ uint32 *flags, _Out_ uint32 *type, _Out_ uint32 *id, _Out_ uint32 *locId, void *serial, void *desc, _Out_ void **handle)"
    ),
    // Device open/close
    FT_Open: lib.func("uint32 FT_Open(int, _Out_ void **)"),
    FT_OpenEx: lib.func(
      "uint32 FT_OpenEx(void *arg, uint32 flags, _Out_ void **handle)"
    ),
    FT_Close: lib.func("uint32 FT_Close(void *)"),
    // Configuration
    FT_ResetDevice: lib.func("uint32 FT_ResetDevice(void *)"),
    FT_SetBaudRate: lib.func("uint32 FT_SetBaudRate(void *, uint32)"),
    FT_SetDataCharacteristics: lib.func(
      "uint32 FT_SetDataCharacteristics(void *, uint8, uint8, uint8)"
    ),
    FT_SetFlowControl: lib.func(
      "uint32 FT_SetFlowControl(void *, uint16, uint8, uint8)"
    ),
    FT_SetTimeouts: lib.func(
      "uint32 FT_SetTimeouts(void *, uint32, uint32)"
    ),
    FT_SetLatencyTimer: lib.func(
      "uint32 FT_SetLatencyTimer(void *, uint8)"
    ),
    FT_SetUSBParameters: lib.func(
      "uint32 FT_SetUSBParameters(void *, uint32, uint32)"
    ),
    // Modem control
    FT_ClrRts: lib.func("uint32 FT_ClrRts(void *)"),
    FT_SetRts: lib.func("uint32 FT_SetRts(void *)"),
    FT_ClrDtr: lib.func("uint32 FT_ClrDtr(void *)"),
    FT_SetDtr: lib.func("uint32 FT_SetDtr(void *)"),
    // Buffer control
    FT_Purge: lib.func("uint32 FT_Purge(void *, uint32)"),
    // DMX break signal
    FT_SetBreakOn: lib.func("uint32 FT_SetBreakOn(void *)"),
    FT_SetBreakOff: lib.func("uint32 FT_SetBreakOff(void *)"),
    // Data transfer
    FT_Write: lib.func(
      "uint32 FT_Write(void *, void *, uint32, _Out_ uint32 *)"
    ),
    FT_Read: lib.func(
      "uint32 FT_Read(void *, void *, uint32, _Out_ uint32 *)"
    ),
    FT_GetQueueStatus: lib.func(
      "uint32 FT_GetQueueStatus(void *, _Out_ uint32 *)"
    ),
  };
}

function getD2XX() {
  if (!d2xx) d2xx = loadD2XX();
  return d2xx;
}

function check(name: string, status: number): void {
  if (status !== FT_OK) {
    throw new Error(`${name} failed with FT_STATUS ${status}`);
  }
}

export interface D2XXDriverOptions {
  refreshRate?: number;
}

export class D2XXDriver {
  private handle: unknown = null;
  private channels: Buffer = Buffer.alloc(512, 0);
  private interval: ReturnType<typeof setInterval> | null = null;
  private refreshRate: number;
  private sending = false;
  ready = false;
  error: string | null = null;

  constructor(options?: D2XXDriverOptions) {
    this.refreshRate = options?.refreshRate ?? DMX_REFRESH_HZ;
  }

  async init(): Promise<void> {
    this.killSoundSwitch();

    const lib = getD2XX();

    // Register custom VID/PID so D2XX can find our device
    check("FT_SetVIDPID", lib.FT_SetVIDPID(VID, PID));

    // Enumerate devices
    const numDevs = [0];
    check("FT_CreateDeviceInfoList", lib.FT_CreateDeviceInfoList(numDevs));

    if (numDevs[0] === 0) {
      throw new Error(
        "SoundSwitch Micro DMX not found. Is it plugged in? Is the blue LED on?"
      );
    }

    // Get device info for diagnostics and fallback open strategies
    const flags = [0],
      dtype = [0],
      devId = [0],
      locId = [0];
    const serialBuf = Buffer.alloc(64, 0);
    const descBuf = Buffer.alloc(64, 0);
    const infoHandle = [null];
    lib.FT_GetDeviceInfoDetail(
      0,
      flags,
      dtype,
      devId,
      locId,
      serialBuf,
      descBuf,
      infoHandle
    );

    // Open device — try index first, then serial, then description
    const handle = [null];
    let st = lib.FT_Open(0, handle);

    if (st !== FT_OK) {
      const serial = serialBuf.toString("utf-8").replace(/\0/g, "");
      if (serial) {
        st = lib.FT_OpenEx(
          Buffer.from(serial + "\0"),
          FT_OPEN_BY_SERIAL_NUMBER,
          handle
        );
      }
    }

    if (st !== FT_OK) {
      const desc = descBuf.toString("utf-8").replace(/\0/g, "");
      if (desc) {
        st = lib.FT_OpenEx(
          Buffer.from(desc + "\0"),
          FT_OPEN_BY_DESCRIPTION,
          handle
        );
      }
    }

    if (st !== FT_OK || !handle[0]) {
      throw new Error(
        `Failed to open SoundSwitch device (FT_STATUS ${st}). ` +
          "Try unplugging and replugging the adapter."
      );
    }

    this.handle = handle[0];

    // Configure for DMX512 — matching SoundSwitch's exact sequence
    this.configureDMX();

    // Activate device — send API key handshake
    // Without this, the device ignores all DMX data
    await this.activateDevice();

    // Start sending DMX frames
    this.interval = setInterval(
      () => this.sendFrame(),
      1000 / this.refreshRate
    );
    this.ready = true;
    this.error = null;
  }

  /**
   * Configure the FTDI chip for DMX512 output.
   * Matches SoundSwitch's EnttecCompatible::configureFtDevice:
   *   Phase 1: Reset + purge
   *   Phase 2: "Configure as UART" (baud, data format, flow, timeouts, latency, USB params)
   *   Phase 3: "Configure as Enttec compatible" (RTS LOW, DTR LOW, final purge)
   */
  private configureDMX(): void {
    const lib = getD2XX();
    const h = this.handle;

    // Phase 1: Reset and initial purge
    check("FT_ResetDevice", lib.FT_ResetDevice(h));
    check("FT_Purge", lib.FT_Purge(h, 3)); // 3 = purge RX + TX

    // Phase 2: Configure as UART
    check("FT_SetBaudRate", lib.FT_SetBaudRate(h, 250000));
    check(
      "FT_SetDataCharacteristics",
      lib.FT_SetDataCharacteristics(h, 8, 2, 0)
    ); // 8N2
    check("FT_SetFlowControl", lib.FT_SetFlowControl(h, 0, 0, 0)); // none
    check("FT_SetTimeouts", lib.FT_SetTimeouts(h, 500, 500));
    check("FT_SetLatencyTimer", lib.FT_SetLatencyTimer(h, 2)); // 2ms
    check("FT_SetUSBParameters", lib.FT_SetUSBParameters(h, 4096, 4096));

    // Phase 3: Configure as Enttec compatible
    // CRITICAL: Both RTS and DTR must be LOW for the RS-485 transceiver
    check("FT_ClrRts", lib.FT_ClrRts(h));
    check("FT_ClrDtr", lib.FT_ClrDtr(h));
    check("FT_Purge", lib.FT_Purge(h, 3)); // final purge after config
  }

  /**
   * Build an Enttec Pro-style packet: [0x7E] [label] [len_lo] [len_hi] [data...] [0xE7]
   * This is the framing used by SoundSwitch's sendFtPacket().
   */
  private buildEnttecPacket(label: number, data: Buffer): Buffer {
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

  private ftWrite(data: Buffer): void {
    const lib = getD2XX();
    const written = [0];
    const st = lib.FT_Write(this.handle, data, data.length, written);
    if (st !== FT_OK) {
      throw new Error(`FT_Write failed: FT_STATUS ${st}`);
    }
  }

  /**
   * Activate the SoundSwitch device with API key handshake.
   * From Ghidra disassembly of configureFtDevice:
   *   1. Send API key: label=0x0D, data=[0xC9, 0xA4, 0x03, 0xE4]
   *   2. Wait 200ms, read device response
   *   3. Send enable: label=0x93, data=[0x01, 0x01]
   */
  private async activateDevice(): Promise<void> {
    const lib = getD2XX();

    // Send API key
    const apiPacket = this.buildEnttecPacket(0x0d, SS_API_KEY);
    this.ftWrite(apiPacket);

    // Wait 200ms for device to process
    await new Promise((r) => setTimeout(r, 200));

    // Read any response
    const rxCount = [0];
    lib.FT_GetQueueStatus(this.handle, rxCount);
    if (rxCount[0] > 0) {
      const rxBuf = Buffer.alloc(rxCount[0]);
      const rxRead = [0];
      lib.FT_Read(this.handle, rxBuf, rxCount[0], rxRead);
    }

    // Send enable output command
    const enablePacket = this.buildEnttecPacket(
      0x93,
      Buffer.from([0x01, 0x01])
    );
    this.ftWrite(enablePacket);

    await new Promise((r) => setTimeout(r, 50));
  }

  private killSoundSwitch(): void {
    try {
      const pids = execSync(
        "pgrep -f 'SoundSwitch.app/Contents/MacOS/SoundSwitch$' 2>/dev/null",
        { encoding: "utf-8" }
      ).trim();
      if (pids) {
        const mainPid = pids.split("\n")[0].trim();
        execSync(`kill ${mainPid} 2>/dev/null`);
        execSync("sleep 1");
      }
    } catch {
      // Not running
    }
  }

  private sendFrame(): void {
    if (!this.handle || this.sending) return;
    this.sending = true;

    try {
      // Build DMX data: start code (0x00) + 512 channel values
      const dmxData = Buffer.alloc(513);
      dmxData[0] = 0x00;
      this.channels.copy(dmxData, 1);

      // Wrap in Enttec Pro framing (label 6 = Send DMX Packet)
      const packet = this.buildEnttecPacket(0x06, dmxData);
      this.ftWrite(packet);
      this.error = null;
    } catch (err) {
      this.error = `DMX write error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.sending = false;
    }
  }

  setChannel(ch: number, value: number): void {
    if (ch >= 1 && ch <= 512) {
      this.channels[ch - 1] = Math.max(0, Math.min(255, value));
    }
  }

  setChannels(channels: Record<number, number>): void {
    for (const [ch, val] of Object.entries(channels)) {
      this.setChannel(parseInt(ch), val);
    }
  }

  setAll(buf: Buffer): void {
    buf.copy(this.channels, 0, 0, Math.min(buf.length, 512));
  }

  blackout(): void {
    this.channels.fill(0);
  }

  close(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this.handle) {
      // Send one last blackout frame
      try {
        this.channels.fill(0);
        this.sendFrame();
      } catch {
        // ignore
      }

      try {
        const lib = getD2XX();
        lib.FT_Close(this.handle);
      } catch {
        // ignore
      }
      this.handle = null;
    }

    this.ready = false;
  }

  getChannels(): Buffer {
    return Buffer.from(this.channels);
  }

  static isDevicePresent(): boolean {
    try {
      const lib = getD2XX();
      check("FT_SetVIDPID", lib.FT_SetVIDPID(VID, PID));
      const numDevs = [0];
      const st = lib.FT_CreateDeviceInfoList(numDevs);
      return st === FT_OK && numDevs[0] > 0;
    } catch {
      return false;
    }
  }
}
