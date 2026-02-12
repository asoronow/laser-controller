/**
 * SoundSwitch Micro DMX — JLS1 Protocol Driver
 *
 * Drives the SoundSwitch Micro DMX Interface (VID:0x15E4, PID:0x0053)
 * using the proprietary JLS1 protocol discovered via lldb sniffing.
 *
 * The device is NOT FTDI — it uses a custom STM32-based firmware that
 * speaks the "sTRt" packet protocol over USB bulk OUT endpoint 0x01.
 *
 * Protocol:
 *   - 4-byte magic: 0x73 0x54 0x52 0x74 ("sTRt")
 *   - 2-byte command (little-endian): 0x0001=DMX, 0x0002=control
 *   - 2-byte payload length (little-endian)
 *   - N bytes payload
 *
 * Init sequence:
 *   1. USB setConfiguration(1), claimInterface(0)
 *   2. Control packet: cmd=0x0002, payload=[0x00,0x00,0x01,0x00] (START)
 *   3. Control packet: cmd=0x0002, payload=[0x01,0x00,0xFF,0xFF] (LED max)
 *   4. DMX packets: cmd=0x0001, payload=[512 channels + 2 LED bytes] (continuous)
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const usbLib = require("usb");

const VID = 0x15e4;
const PID = 0x0053;
const MAGIC = Buffer.from([0x73, 0x54, 0x52, 0x74]); // "sTRt"
const DMX_REFRESH_HZ = 40;

export interface SoundSwitchDriverOptions {
  refreshRate?: number;
}

function buildPacket(command: number, payload: Buffer): Buffer {
  const packet = Buffer.alloc(8 + payload.length);
  MAGIC.copy(packet, 0); // bytes 0-3: magic
  packet.writeUInt16LE(command, 4); // bytes 4-5: command
  packet.writeUInt16LE(payload.length, 6); // bytes 6-7: payload length
  payload.copy(packet, 8); // bytes 8+: payload
  return packet;
}

export class SoundSwitchDriver {
  private device: typeof usbLib.Device | null = null;
  private iface: typeof usbLib.Interface | null = null;
  private outEndpoint: typeof usbLib.OutEndpoint | null = null;
  private channels: Buffer = Buffer.alloc(512, 0);
  private interval: ReturnType<typeof setInterval> | null = null;
  private refreshRate: number;
  private sending = false;
  ready = false;
  error: string | null = null;

  constructor(options?: SoundSwitchDriverOptions) {
    this.refreshRate = options?.refreshRate ?? DMX_REFRESH_HZ;
  }

  async init(): Promise<void> {
    const devices = usbLib.usb.getDeviceList();
    const ssDev = devices.find(
      (d: { deviceDescriptor: { idVendor: number; idProduct: number } }) =>
        d.deviceDescriptor.idVendor === VID &&
        d.deviceDescriptor.idProduct === PID
    );

    if (!ssDev) {
      throw new Error(
        "SoundSwitch Micro DMX not found. Is it plugged in?"
      );
    }

    this.device = ssDev;

    try {
      this.device.open();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("BUSY") || msg.includes("ACCESS")) {
        throw new Error(
          "SoundSwitch Micro DMX is in use. Close the SoundSwitch desktop app first."
        );
      }
      throw new Error(`Failed to open USB device: ${msg}`);
    }

    // Set configuration BEFORE claiming interface (critical for JLS1)
    await this.setConfiguration(1);

    // Claim interface 0
    this.iface = this.device.interface(0);
    try {
      if (this.iface.isKernelDriverActive()) {
        this.iface.detachKernelDriver();
      }
    } catch {
      // May not be supported on all platforms
    }

    try {
      this.iface.claim();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Failed to claim USB interface: ${msg}. Is SoundSwitch desktop closed?`
      );
    }

    // Find bulk OUT endpoint (should be EP 0x01)
    this.outEndpoint = this.iface.endpoints.find(
      (ep: { direction: string }) => ep.direction === "out"
    );

    if (!this.outEndpoint) {
      throw new Error("No OUT endpoint found on SoundSwitch device");
    }

    // Send JLS1 init sequence
    await this.sendInit();

    // Start continuous DMX output
    this.interval = setInterval(
      () => this.sendFrame(),
      1000 / this.refreshRate
    );
    this.ready = true;
    this.error = null;
  }

  private setConfiguration(config: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.device!.__setConfiguration(config, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private bulkWrite(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.outEndpoint!.timeout = 0; // infinite timeout (matches SoundSwitch)
      this.outEndpoint!.transfer(data, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Send the JLS1 initialization sequence:
   *   1. START command (activates the device, turns on blue LED)
   *   2. LED brightness command
   */
  private async sendInit(): Promise<void> {
    // START: cmd=0x0002, payload=[0x00, 0x00, 0x01, 0x00]
    const startPacket = buildPacket(
      0x0002,
      Buffer.from([0x00, 0x00, 0x01, 0x00])
    );
    await this.bulkWrite(startPacket);

    // LED brightness: cmd=0x0002, payload=[0x01, 0x00, 0xFF, 0xFF]
    const ledPacket = buildPacket(
      0x0002,
      Buffer.from([0x01, 0x00, 0xff, 0xff])
    );
    await this.bulkWrite(ledPacket);

    // Brief pause for device to initialize
    await new Promise((r) => setTimeout(r, 100));
  }

  /**
   * Build and send a DMX frame using JLS1 protocol.
   * Payload: 2 header bytes + 512 DMX channels = 514 bytes.
   * DMX channels start at payload offset 2 (confirmed via offset probe).
   * Total packet: 8 header + 514 = 522 bytes.
   */
  private async sendFrame(): Promise<void> {
    if (!this.outEndpoint || this.sending) return;
    this.sending = true;

    try {
      const payload = Buffer.alloc(514, 0);
      // payload[0..1] = 0x00 (protocol header bytes)
      // payload[2..513] = DMX CH1..CH512
      this.channels.copy(payload, 2, 0, 512);

      const packet = buildPacket(0x0001, payload);
      await this.bulkWrite(packet);
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

    if (this.outEndpoint && this.device) {
      // Send blackout
      try {
        this.channels.fill(0);
        const payload = Buffer.alloc(514, 0);
        const packet = buildPacket(0x0001, payload);
        this.outEndpoint.timeout = 1000;
        this.outEndpoint.transfer(packet, () => {});
      } catch {
        // ignore
      }

      try {
        this.iface?.release(() => {
          try {
            this.device?.close();
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
    }

    this.ready = false;
  }

  getChannels(): Buffer {
    return Buffer.from(this.channels);
  }

  static isDevicePresent(): boolean {
    try {
      const devices = usbLib.usb.getDeviceList();
      return devices.some(
        (d: { deviceDescriptor: { idVendor: number; idProduct: number } }) =>
          d.deviceDescriptor.idVendor === VID &&
          d.deviceDescriptor.idProduct === PID
      );
    } catch {
      return false;
    }
  }
}
