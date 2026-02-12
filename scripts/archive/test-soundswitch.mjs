// test-soundswitch.mjs — Smoke test for SoundSwitch Micro DMX driver
// Run: node scripts/test-soundswitch.mjs
// IMPORTANT: Close SoundSwitch app first!

// We need to import the compiled TS, so use a direct approach
import { usb } from 'usb';

const VID = 0x15E4;
const PID = 0x0053;

// FTDI control request codes
const FTDI_SIO_RESET = 0x00;
const FTDI_SIO_SET_BAUDRATE = 0x03;
const FTDI_SIO_SET_DATA = 0x04;
const FTDI_SIO_SET_FLOW_CTRL = 0x02;
const FTDI_SIO_SET_LATENCY_TIMER = 0x09;
const FTDI_SIO_RESET_SIO = 0;
const FTDI_SIO_RESET_PURGE_RX = 1;
const FTDI_SIO_RESET_PURGE_TX = 2;
const FTDI_BITS_8 = 8;
const FTDI_STOP_BITS_2 = 0x1000;
const FTDI_PARITY_NONE = 0;
const FTDI_BREAK_ON = 0x4000;
const FTDI_BREAK_OFF = 0x0000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function controlTransfer(device, bmRequestType, bRequest, wValue, wIndex) {
  return new Promise((resolve, reject) => {
    device.controlTransfer(bmRequestType, bRequest, wValue, wIndex, Buffer.alloc(0), (err, buf) => {
      if (err) reject(err);
      else resolve(buf);
    });
  });
}

function bulkTransfer(endpoint, data) {
  return new Promise((resolve, reject) => {
    endpoint.timeout = 1000; // 1s timeout
    endpoint.transfer(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function sendDMXFrame(device, outEndpoint, channels) {
  const lineProps = FTDI_BITS_8 | FTDI_PARITY_NONE | FTDI_STOP_BITS_2;

  // Break ON
  await controlTransfer(device, 0x40, FTDI_SIO_SET_DATA, lineProps | FTDI_BREAK_ON, 0);
  // The USB round-trip provides the break duration (~1ms >> 88us minimum)

  // Break OFF
  await controlTransfer(device, 0x40, FTDI_SIO_SET_DATA, lineProps | FTDI_BREAK_OFF, 0);

  // Send DMX frame: start code + channels
  const frame = Buffer.alloc(513, 0);
  frame[0] = 0x00; // DMX start code
  for (let i = 0; i < Math.min(channels.length, 512); i++) {
    frame[i + 1] = channels[i];
  }

  await bulkTransfer(outEndpoint, frame);
}

async function main() {
  console.log('=== SoundSwitch Micro DMX — Smoke Test ===\n');

  // Find device
  const devices = usb.getDeviceList();
  const ssDev = devices.find(
    (d) => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );

  if (!ssDev) {
    console.error('ERROR: SoundSwitch Micro DMX not found!');
    console.error('Is it plugged in? Is the blue LED on?');
    process.exit(1);
  }

  console.log('Found device. Opening...');

  try {
    ssDev.open();
  } catch (e) {
    console.error(`ERROR: Cannot open device: ${e.message}`);
    console.error('Close the SoundSwitch desktop app and try again.');
    process.exit(1);
  }

  const iface = ssDev.interface(0);

  try {
    if (iface.isKernelDriverActive()) {
      iface.detachKernelDriver();
    }
  } catch (e) {
    // OK on macOS
  }

  try {
    iface.claim();
  } catch (e) {
    console.error(`ERROR: Cannot claim interface: ${e.message}`);
    console.error('Close the SoundSwitch desktop app and try again.');
    ssDev.close();
    process.exit(1);
  }

  // Find OUT endpoint
  let outEndpoint = iface.endpoints.find((ep) => ep.direction === 'out');
  if (!outEndpoint) {
    // Try standard FTDI OUT endpoint address
    try {
      outEndpoint = iface.endpoint(0x02);
    } catch {
      console.error('ERROR: No OUT endpoint found');
      iface.release(() => ssDev.close());
      process.exit(1);
    }
  }

  console.log(`Using endpoint 0x${outEndpoint.address.toString(16)}`);

  // Configure FTDI for DMX512
  console.log('Configuring FTDI for DMX512 (250000 baud, 8N2)...');
  try {
    await controlTransfer(ssDev, 0x40, FTDI_SIO_RESET, FTDI_SIO_RESET_SIO, 0);
    await controlTransfer(ssDev, 0x40, FTDI_SIO_SET_BAUDRATE, 12, 0); // 3000000/250000 = 12
    await controlTransfer(ssDev, 0x40, FTDI_SIO_SET_DATA, FTDI_BITS_8 | FTDI_PARITY_NONE | FTDI_STOP_BITS_2, 0);
    await controlTransfer(ssDev, 0x40, FTDI_SIO_SET_FLOW_CTRL, 0, 0);
    await controlTransfer(ssDev, 0x40, FTDI_SIO_SET_LATENCY_TIMER, 2, 0);
    await controlTransfer(ssDev, 0x40, FTDI_SIO_RESET, FTDI_SIO_RESET_PURGE_RX, 0);
    await controlTransfer(ssDev, 0x40, FTDI_SIO_RESET, FTDI_SIO_RESET_PURGE_TX, 0);
    console.log('FTDI configured successfully!\n');
  } catch (e) {
    console.error(`ERROR configuring FTDI: ${e.message}`);
    iface.release(() => ssDev.close());
    process.exit(1);
  }

  const channels = new Uint8Array(512);

  // Helper to set a channel and send
  const setAndSend = async (ch, val) => {
    channels[ch - 1] = val;
    await sendDMXFrame(ssDev, outEndpoint, channels);
  };

  try {
    // Test 1: Blackout
    console.log('Test 1: Blackout (2s)');
    channels.fill(0);
    await sendDMXFrame(ssDev, outEndpoint, channels);
    await sleep(2000);

    // Test 2: Master dimmer full
    console.log('Test 2: CH1 = 255 (master dimmer ON, 3s)');
    console.log('  >>> Look at the laser — does it turn on?');
    await setAndSend(1, 255);
    // Keep sending frames
    for (let i = 0; i < 120; i++) {
      await sendDMXFrame(ssDev, outEndpoint, channels);
      await sleep(25);
    }

    // Test 3: Set to manual mode + full brightness
    console.log('Test 3: CH1=255 CH2=225 (manual mode, 3s)');
    channels[1] = 225; // mode = manual
    for (let i = 0; i < 120; i++) {
      await sendDMXFrame(ssDev, outEndpoint, channels);
      await sleep(25);
    }

    // Test 4: Dimmer ramp 0→255
    console.log('Test 4: Ramping CH1 0→255 over 3s');
    for (let v = 0; v <= 255; v++) {
      channels[0] = v;
      await sendDMXFrame(ssDev, outEndpoint, channels);
      await sleep(12);
    }

    // Test 5: RGB color cycle
    console.log('Test 5: RGB cycle (3s)');
    channels[0] = 255; // master on
    channels[1] = 225; // manual mode
    for (let hue = 0; hue < 360; hue += 4) {
      const r = Math.round(Math.max(0, Math.cos((hue * Math.PI) / 180) * 127 + 128));
      const g = Math.round(Math.max(0, Math.cos(((hue - 120) * Math.PI) / 180) * 127 + 128));
      const b = Math.round(Math.max(0, Math.cos(((hue - 240) * Math.PI) / 180) * 127 + 128));
      channels[4] = r; // CH5 red
      channels[5] = g; // CH6 green
      channels[6] = b; // CH7 blue
      await sendDMXFrame(ssDev, outEndpoint, channels);
      await sleep(33);
    }

    // Cleanup: blackout
    console.log('\nBlackout...');
    channels.fill(0);
    for (let i = 0; i < 5; i++) {
      await sendDMXFrame(ssDev, outEndpoint, channels);
      await sleep(25);
    }

    console.log('Done! Closing device.');
  } catch (e) {
    console.error(`Test error: ${e.message}`);
  }

  iface.release(() => {
    ssDev.close();
    console.log('Device closed.');
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
