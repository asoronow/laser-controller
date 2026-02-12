// debug-init.mjs — Find the initialization sequence the device needs
// After USB reset, the device stops accepting bulk writes (timeout).
// This means there's an init handshake. Let's find it.
//
// Run: node scripts/debug-init.mjs

import { usb } from 'usb';

const VID = 0x15E4;
const PID = 0x0053;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ctrlIn(dev, bmReq, bReq, wVal, wIdx, len, timeout = 1000) {
  return new Promise((resolve, reject) => {
    dev.timeout = timeout;
    dev.controlTransfer(bmReq, bReq, wVal, wIdx, len, (err, buf) => {
      if (err) reject(err);
      else resolve(buf);
    });
  });
}

function ctrlOut(dev, bmReq, bReq, wVal, wIdx, data, timeout = 1000) {
  return new Promise((resolve, reject) => {
    dev.timeout = timeout;
    dev.controlTransfer(bmReq, bReq, wVal, wIdx, data, (err, buf) => {
      if (err) reject(err);
      else resolve(buf);
    });
  });
}

function bulkWrite(ep, data) {
  return new Promise((resolve, reject) => {
    ep.timeout = 1000;
    ep.transfer(data, (err) => { if (err) reject(err); else resolve(); });
  });
}

async function main() {
  console.log('=== Device Initialization Discovery ===\n');

  const devices = usb.getDeviceList();
  const dev = devices.find(
    (d) => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );
  if (!dev) { console.error('Device not found'); process.exit(1); }

  dev.open();

  // Read ALL USB string descriptors - device might have protocol info
  console.log('--- USB String Descriptors ---');
  const dd = dev.deviceDescriptor;
  for (const idx of [dd.iManufacturer, dd.iProduct, dd.iSerialNumber]) {
    if (idx === 0) continue;
    try {
      const str = await new Promise((resolve, reject) => {
        dev.getStringDescriptor(idx, (err, str) => {
          if (err) reject(err);
          else resolve(str);
        });
      });
      console.log(`  Descriptor ${idx}: "${str}"`);
    } catch (e) {
      console.log(`  Descriptor ${idx}: ${e.message}`);
    }
  }

  // Read raw descriptor bytes for all indices 0-10
  console.log('\n--- Raw Descriptors ---');
  for (let idx = 0; idx <= 10; idx++) {
    try {
      const buf = await ctrlIn(dev, 0x80, 0x06, (0x03 << 8) | idx, 0x0409, 255);
      if (buf && buf.length > 2) {
        const str = buf.slice(2).toString('utf16le');
        console.log(`  String ${idx}: "${str}" (raw: ${buf.toString('hex')})`);
      }
    } catch {
      // Normal for non-existent indices
    }
  }

  // Try standard USB requests that might reveal device capabilities
  console.log('\n--- Standard USB Requests ---');

  // GET_STATUS
  try {
    const status = await ctrlIn(dev, 0x80, 0x00, 0, 0, 2);
    console.log('  GET_STATUS (device):', status.toString('hex'));
  } catch (e) { console.log('  GET_STATUS (device):', e.message); }

  // GET_STATUS on interface
  try {
    const status = await ctrlIn(dev, 0x81, 0x00, 0, 0, 2);
    console.log('  GET_STATUS (interface):', status.toString('hex'));
  } catch (e) { console.log('  GET_STATUS (interface):', e.message); }

  // GET_STATUS on endpoint 1
  try {
    const status = await ctrlIn(dev, 0x82, 0x00, 0, 0x01, 2);
    console.log('  GET_STATUS (EP 0x01):', status.toString('hex'));
  } catch (e) { console.log('  GET_STATUS (EP 0x01):', e.message); }

  // Try GET_DESCRIPTOR for device qualifier
  try {
    const qual = await ctrlIn(dev, 0x80, 0x06, 0x0600, 0, 10);
    console.log('  Device qualifier:', qual.toString('hex'));
  } catch (e) { console.log('  Device qualifier:', e.message); }

  // Try BOS descriptor (USB 3.0+)
  try {
    const bos = await ctrlIn(dev, 0x80, 0x06, 0x0F00, 0, 64);
    console.log('  BOS descriptor:', bos.toString('hex'));
  } catch (e) { console.log('  BOS descriptor:', e.message); }

  // Now claim interface
  const iface = dev.interface(0);
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch {}
  iface.claim();
  const ep = iface.endpoints.find(e => e.direction === 'out');
  ep.timeout = 1000;

  // Try various vendor-specific control transfers (IN direction, reading from device)
  console.log('\n--- Vendor Control Transfers (IN - reading) ---');
  for (const req of [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x0A, 0x0B, 0x10, 0x20, 0x30, 0xFF]) {
    try {
      const buf = await ctrlIn(dev, 0xC0, req, 0, 0, 64, 500);
      console.log(`  Vendor IN req=0x${req.toString(16).padStart(2,'0')}: ${buf.toString('hex')}`);
    } catch (e) {
      // silent - most will fail
    }
  }

  // Try class-specific control transfers
  console.log('\n--- Class Control Transfers (IN) ---');
  for (const req of [0x00, 0x01, 0x02, 0x03, 0x20, 0x21, 0x22, 0xFE, 0xFF]) {
    try {
      const buf = await ctrlIn(dev, 0xA1, req, 0, 0, 64, 500);
      console.log(`  Class IN req=0x${req.toString(16).padStart(2,'0')}: ${buf.toString('hex')}`);
    } catch (e) {
      // silent
    }
  }

  // Try DFU-like requests (STM32 often has DFU)
  console.log('\n--- DFU/STM32 Requests ---');
  try {
    // DFU GETSTATUS
    const buf = await ctrlIn(dev, 0xA1, 0x03, 0, 0, 6, 500);
    console.log('  DFU GETSTATUS:', buf.toString('hex'));
  } catch (e) { /* expected */ }

  try {
    // DFU GETSTATE
    const buf = await ctrlIn(dev, 0xA1, 0x05, 0, 0, 1, 500);
    console.log('  DFU GETSTATE:', buf.toString('hex'));
  } catch (e) { /* expected */ }

  // Now: test if a CLEAR_FEATURE (endpoint halt) on EP 0x01 helps
  console.log('\n--- Clear endpoint halt ---');
  try {
    await ctrlOut(dev, 0x02, 0x01, 0x00, 0x01, Buffer.alloc(0));
    console.log('  CLEAR_FEATURE (HALT) on EP 0x01: OK');
  } catch (e) { console.log('  CLEAR_FEATURE:', e.message); }

  // Test bulk write
  console.log('\n--- Bulk write test after init ---');
  const frame = Buffer.alloc(512, 0);
  frame[0] = 255;
  frame[1] = 225;
  frame[4] = 255;
  try {
    await bulkWrite(ep, frame);
    console.log('  Bulk write OK');
  } catch (e) {
    console.log('  Bulk write:', e.message);
  }

  // Try reading from the IN endpoint
  console.log('\n--- IN endpoint read test ---');
  try {
    const inEp = iface.endpoint(0x81);
    if (inEp) {
      inEp.timeout = 1000;
      const data = await new Promise((resolve, reject) => {
        inEp.transfer(64, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });
      console.log('  IN data:', data.toString('hex'));
    }
  } catch (e) {
    console.log('  IN read:', e.message);
  }

  // Maybe the device needs a specific SETUP packet first
  // Try SET_INTERFACE
  console.log('\n--- SET_INTERFACE ---');
  try {
    await ctrlOut(dev, 0x01, 0x0B, 0, 0, Buffer.alloc(0));
    console.log('  SET_INTERFACE(0,0): OK');
  } catch (e) { console.log('  SET_INTERFACE:', e.message); }

  // Maybe a CDC SET_LINE_CODING? (Even though interface class is 0)
  console.log('\n--- CDC requests (speculative) ---');
  // SET_LINE_CODING: 250000 baud, 8N2
  const lineCoding = Buffer.alloc(7);
  lineCoding.writeUInt32LE(250000, 0); // baud rate
  lineCoding[4] = 2; // 2 stop bits
  lineCoding[5] = 0; // no parity
  lineCoding[6] = 8; // 8 data bits
  try {
    await ctrlOut(dev, 0x21, 0x20, 0, 0, lineCoding);
    console.log('  SET_LINE_CODING (250k 8N2): OK!');

    // Try SET_CONTROL_LINE_STATE (DTR on)
    await ctrlOut(dev, 0x21, 0x22, 0x0003, 0, Buffer.alloc(0));
    console.log('  SET_CONTROL_LINE_STATE (DTR+RTS): OK!');

    // Now try bulk write again
    console.log('  Testing bulk write after CDC init...');
    for (let i = 0; i < 200; i++) {
      await sleep(5);
      await bulkWrite(ep, frame);
      if (i === 0) console.log('  Sending for 5 seconds - WATCH LASER!');
    }
    console.log('  Done');
  } catch (e) {
    console.log('  CDC init:', e.message);
  }

  // Cleanup
  console.log('\nDone.');
  iface.release(() => { dev.close(); process.exit(0); });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
