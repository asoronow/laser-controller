import { SerialPort } from "serialport";
import { setState } from "@/app/lib/dmx-state";
import { SoundSwitchDriver } from "@/app/lib/soundswitch-driver";
import type { ProbeRequest, ProbeResponse } from "@/app/lib/types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeSoundSwitch(testFrame: boolean): Promise<ProbeResponse> {
  const start = Date.now();

  try {
    const driver = new SoundSwitchDriver();
    await driver.init();

    if (testFrame) {
      // Send SoundSwitch-matching values (confirmed working)
      driver.setChannel(1, 100);   // Laser On/Off = Sound Active
      driver.setChannel(3, 255);   // Group Selection = Animations
      driver.setChannel(4, 28);    // Pattern Selection = 28
      driver.setChannel(11, 152);  // Fixed Color
      driver.setChannel(15, 217);  // Drawing 2 = Dynamic C effects
      await sleep(500); // let ~20 frames send
    }

    setState({
      connected: true,
      simulation: false,
      driver: "soundswitch",
      port: "USB (VID:0x15E4 PID:0x0053)",
      adapterName: "SoundSwitch Micro DMX",
      error: null,
      serialPort: driver,
    });

    return {
      success: true,
      method: "soundswitch",
      port: "USB direct (JLS1 protocol)",
      details: testFrame
        ? "SoundSwitch Micro DMX connected via JLS1 protocol. Test frame sent (CH1=255)."
        : "SoundSwitch Micro DMX connected via JLS1 protocol. Sending DMX at 40Hz.",
      error: null,
      timing: Date.now() - start,
      portInfo: null,
    };
  } catch (err) {
    return {
      success: false,
      method: "soundswitch",
      port: "USB (VID:0x15E4 PID:0x0053)",
      details: "SoundSwitch Micro DMX probe failed.",
      error: err instanceof Error ? err.message : String(err),
      timing: Date.now() - start,
      portInfo: null,
    };
  }
}

async function probeEnttecOpen(
  portPath: string,
  testFrame: boolean
): Promise<ProbeResponse> {
  const start = Date.now();
  try {
    const { EnttecOpenDMXUSBDevice } = await import("enttec-open-dmx-usb");
    const device = new EnttecOpenDMXUSBDevice(portPath);

    if (testFrame) {
      device.setChannels({ 1: 255 });
    }

    // Store the device for later use
    setState({
      connected: true,
      simulation: false,
      driver: "enttec-open",
      port: portPath,
      adapterName: `Enttec Open DMX @ ${portPath}`,
      error: null,
      serialPort: device,
    });

    return {
      success: true,
      method: "enttec-open",
      port: portPath,
      details: testFrame
        ? "Port opened with Enttec Open DMX protocol. Test frame sent (CH1=255)."
        : "Port opened successfully with Enttec Open DMX protocol.",
      error: null,
      timing: Date.now() - start,
      portInfo: { baudRate: 250000, dataBits: 8, stopBits: 2, parity: "none" },
    };
  } catch (err) {
    return {
      success: false,
      method: "enttec-open",
      port: portPath,
      details: `Enttec Open DMX protocol failed`,
      error: err instanceof Error ? err.message : String(err),
      timing: Date.now() - start,
      portInfo: null,
    };
  }
}

async function probeEnttecPro(
  portPath: string,
  testFrame: boolean
): Promise<ProbeResponse> {
  const start = Date.now();
  // Enttec Pro uses a framed packet format:
  // [0x7E] [label] [len_lo] [len_hi] [data...] [0xE7]
  // Label 6 = Output DMX, data = start code + channels
  try {
    const port = new SerialPort({
      path: portPath,
      baudRate: 57600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      port.open((err) => (err ? reject(err) : resolve()));
    });

    try {
      if (testFrame) {
        // Enttec Pro DMX Output packet (label 6)
        const dmxData = Buffer.alloc(513, 0); // start code + 512
        dmxData[1] = 100; // CH1 = Laser On/Off (Sound Active)
        const len = dmxData.length;
        const header = Buffer.from([
          0x7e, // start
          6, // label: Output DMX
          len & 0xff, // length low
          (len >> 8) & 0xff, // length high
        ]);
        const footer = Buffer.from([0xe7]);
        const packet = Buffer.concat([header, dmxData, footer]);
        port.write(packet);
        await new Promise<void>((resolve, reject) => {
          port.drain((err) => (err ? reject(err) : resolve()));
        });
      }

      setState({
        connected: true,
        simulation: false,
        driver: "enttec-pro",
        port: portPath,
        adapterName: `Enttec Pro @ ${portPath}`,
        error: null,
        serialPort: port,
      });

      return {
        success: true,
        method: "enttec-pro",
        port: portPath,
        details: testFrame
          ? "Port opened with Enttec Pro protocol (57600 baud). Test frame sent."
          : "Port opened successfully with Enttec Pro protocol.",
        error: null,
        timing: Date.now() - start,
        portInfo: { baudRate: 57600, dataBits: 8, stopBits: 1, parity: "none" },
      };
    } catch (err) {
      port.close();
      throw err;
    }
  } catch (err) {
    return {
      success: false,
      method: "enttec-pro",
      port: portPath,
      details: `Enttec Pro protocol failed`,
      error: err instanceof Error ? err.message : String(err),
      timing: Date.now() - start,
      portInfo: null,
    };
  }
}

async function probeRawSerial(
  portPath: string,
  testFrame: boolean
): Promise<ProbeResponse> {
  const start = Date.now();
  try {
    const port = new SerialPort({
      path: portPath,
      baudRate: 250000,
      dataBits: 8,
      stopBits: 2,
      parity: "none",
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      port.open((err) => (err ? reject(err) : resolve()));
    });

    try {
      if (testFrame) {
        // Generate DMX break + frame
        port.set({ brk: true });
        await sleep(1); // ~1ms break (spec minimum 88us)
        port.set({ brk: false });
        await sleep(0.1); // mark after break

        const frame = Buffer.alloc(513, 0); // start code + 512 channels
        frame[1] = 100; // CH1 = Laser On/Off (Sound Active)
        port.write(frame);
        await new Promise<void>((resolve, reject) => {
          port.drain((err) => (err ? reject(err) : resolve()));
        });
      }

      setState({
        connected: true,
        simulation: false,
        driver: "raw-serial",
        port: portPath,
        adapterName: `Raw Serial DMX @ ${portPath}`,
        error: null,
        serialPort: port,
      });

      return {
        success: true,
        method: "raw-serial",
        port: portPath,
        details: testFrame
          ? "Wrote 513-byte DMX frame with break signal. Check if laser CH1 lit up!"
          : "Port opened at 250000 baud 8N2. Ready for DMX frames.",
        error: null,
        timing: Date.now() - start,
        portInfo: { baudRate: 250000, dataBits: 8, stopBits: 2, parity: "none" },
      };
    } catch (err) {
      port.close();
      throw err;
    }
  } catch (err) {
    return {
      success: false,
      method: "raw-serial",
      port: portPath,
      details: `Raw serial DMX failed`,
      error: err instanceof Error ? err.message : String(err),
      timing: Date.now() - start,
      portInfo: null,
    };
  }
}

async function probeRaw250k(portPath: string): Promise<ProbeResponse> {
  const start = Date.now();
  try {
    const port = new SerialPort({
      path: portPath,
      baudRate: 250000,
      dataBits: 8,
      stopBits: 2,
      parity: "none",
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      port.open((err) => (err ? reject(err) : resolve()));
    });

    // Just test if 250k baud is accepted, then close
    const details = "Port opened at 250000 baud 8N2 — DMX-compatible!";
    port.close();

    return {
      success: true,
      method: "raw-250k",
      port: portPath,
      details,
      error: null,
      timing: Date.now() - start,
      portInfo: { baudRate: 250000, dataBits: 8, stopBits: 2, parity: "none" },
    };
  } catch (err) {
    return {
      success: false,
      method: "raw-250k",
      port: portPath,
      details: `Port rejected 250000 baud`,
      error: err instanceof Error ? err.message : String(err),
      timing: Date.now() - start,
      portInfo: null,
    };
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProbeRequest;
    const { port, method, testFrame = false } = body;

    if (!port || !method) {
      return Response.json(
        { error: "Missing required fields: port, method" },
        { status: 400 }
      );
    }

    let result: ProbeResponse;

    switch (method) {
      case "soundswitch":
        result = await probeSoundSwitch(testFrame);
        break;
      case "enttec-open":
        result = await probeEnttecOpen(port, testFrame);
        break;
      case "enttec-pro":
        result = await probeEnttecPro(port, testFrame);
        break;
      case "raw-serial":
        result = await probeRawSerial(port, testFrame);
        break;
      case "raw-250k":
        result = await probeRaw250k(port);
        break;
      default:
        return Response.json({ error: `Unknown method: ${method}` }, { status: 400 });
    }

    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: `Probe failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
