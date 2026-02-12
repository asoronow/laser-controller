#!/usr/bin/env node
/**
 * diagnose-access.mjs — Test USB access to SoundSwitch device via multiple paths
 *
 * Tests:
 * 1. libusb (via `usb` npm package) — can it open and communicate?
 * 2. D2XX — detailed error from FT_Open
 * 3. IOKit direct — can we read descriptors?
 */

import { usb } from 'usb';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const VID = 0x15E4;
const PID = 0x0053;

console.log('=== SoundSwitch USB Access Diagnostics ===\n');

// ─── Test 1: libusb enumeration and access ───
console.log('── Test 1: libusb (usb npm package) ──');
try {
  const devices = usb.getDeviceList();
  const dev = devices.find(
    d => d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID
  );

  if (!dev) {
    console.log('  Device NOT found via libusb\n');
  } else {
    console.log('  Device found via libusb');
    console.log('  VID: 0x' + dev.deviceDescriptor.idVendor.toString(16));
    console.log('  PID: 0x' + dev.deviceDescriptor.idProduct.toString(16));
    console.log('  Bus:', dev.busNumber, 'Address:', dev.deviceAddress);

    // Try to open
    try {
      dev.open();
      console.log('  ✓ dev.open() succeeded!');

      // Try to read string descriptors
      try {
        const manufacturer = await new Promise((res, rej) => {
          dev.getStringDescriptor(dev.deviceDescriptor.iManufacturer, (err, val) => err ? rej(err) : res(val));
        });
        console.log('  ✓ Manufacturer:', manufacturer);
      } catch (e) {
        console.log('  ✗ getStringDescriptor(manufacturer):', e.message);
      }

      try {
        const product = await new Promise((res, rej) => {
          dev.getStringDescriptor(dev.deviceDescriptor.iProduct, (err, val) => err ? rej(err) : res(val));
        });
        console.log('  ✓ Product:', product);
      } catch (e) {
        console.log('  ✗ getStringDescriptor(product):', e.message);
      }

      // Try to claim interface
      const iface = dev.interface(0);
      try {
        if (iface.isKernelDriverActive()) {
          console.log('  Kernel driver active on interface 0, detaching...');
          iface.detachKernelDriver();
        }
      } catch (e) {
        console.log('  Note: isKernelDriverActive check:', e.message);
      }

      try {
        iface.claim();
        console.log('  ✓ interface.claim() succeeded!');

        // List endpoints
        for (const ep of iface.endpoints) {
          console.log(`  Endpoint 0x${ep.address.toString(16).padStart(2, '0')} dir=${ep.direction} type=${ep.transferType}`);
        }

        // Try a simple FTDI control transfer: read latency timer
        // bmRequestType=0xC0 (vendor, device-to-host), bRequest=0x0A (GET_LATENCY_TIMER), wValue=0, wIndex=0
        try {
          const latencyBuf = await new Promise((res, rej) => {
            dev.controlTransfer(0xC0, 0x0A, 0, 0, 1, (err, buf) => err ? rej(err) : res(buf));
          });
          console.log('  ✓ FTDI GET_LATENCY_TIMER:', latencyBuf[0], 'ms');
        } catch (e) {
          console.log('  ✗ FTDI control transfer:', e.message);
        }

        // Try a bulk write (1 byte test)
        const outEp = iface.endpoints.find(e => e.direction === 'out');
        if (outEp) {
          try {
            await new Promise((res, rej) => {
              outEp.timeout = 1000;
              outEp.transfer(Buffer.from([0x00]), err => err ? rej(err) : res());
            });
            console.log('  ✓ Bulk OUT write succeeded (1 byte)');
          } catch (e) {
            console.log('  ✗ Bulk OUT write:', e.message);
          }
        }

        iface.release(() => {});
      } catch (e) {
        console.log('  ✗ interface.claim():', e.message);
      }

      dev.close();
      console.log('  Device closed');
    } catch (e) {
      console.log('  ✗ dev.open():', e.message);
    }
  }
} catch (e) {
  console.log('  Error:', e.message);
}

console.log('');

// ─── Test 2: D2XX access ───
console.log('── Test 2: D2XX (libftd2xx via koffi) ──');
try {
  const koffi = require('koffi');
  const fs = require('fs');

  const LIB_PATHS = [
    '/Applications/SoundSwitch.app/Contents/Frameworks/libftd2xx.1.4.24.dylib',
    '/usr/local/lib/libftd2xx.dylib',
  ];

  let libPath = null;
  for (const p of LIB_PATHS) {
    if (fs.existsSync(p)) { libPath = p; break; }
  }

  if (!libPath) {
    console.log('  D2XX library not found');
  } else {
    console.log('  Library:', libPath);
    const lib = koffi.load(libPath);

    const FT_SetVIDPID = lib.func('uint32 FT_SetVIDPID(uint32, uint32)');
    const FT_CreateDeviceInfoList = lib.func('uint32 FT_CreateDeviceInfoList(_Out_ uint32 *)');
    const FT_GetDeviceInfoDetail = lib.func(
      'uint32 FT_GetDeviceInfoDetail(uint32 index, _Out_ uint32 *flags, _Out_ uint32 *type, _Out_ uint32 *id, _Out_ uint32 *locId, void *serial, void *desc, _Out_ void **handle)'
    );
    const FT_Open = lib.func('uint32 FT_Open(int, _Out_ void **)');
    const FT_OpenEx = lib.func('uint32 FT_OpenEx(void *arg, uint32 flags, _Out_ void **)');
    const FT_Close = lib.func('uint32 FT_Close(void *)');
    const FT_GetDriverVersion = lib.func('uint32 FT_GetDriverVersion(void *, _Out_ uint32 *)');
    const FT_GetLibraryVersion = lib.func('uint32 FT_GetLibraryVersion(_Out_ uint32 *)');

    // Check library version
    const libVer = [0];
    const lvSt = FT_GetLibraryVersion(libVer);
    if (lvSt === 0) {
      const v = libVer[0];
      console.log(`  Library version: ${(v >> 16) & 0xFF}.${(v >> 8) & 0xFF}.${v & 0xFF}`);
    }

    // Register custom VID/PID
    let st = FT_SetVIDPID(VID, PID);
    console.log('  FT_SetVIDPID(0x15E4, 0x0053):', st === 0 ? 'OK' : `FAILED (${st})`);

    // Enumerate
    const numDevs = [0];
    st = FT_CreateDeviceInfoList(numDevs);
    console.log('  FT_CreateDeviceInfoList:', st === 0 ? `OK, ${numDevs[0]} device(s)` : `FAILED (${st})`);

    if (numDevs[0] > 0) {
      const flags = [0], dtype = [0], devId = [0], locId = [0];
      const serialBuf = Buffer.alloc(64, 0);
      const descBuf = Buffer.alloc(64, 0);
      const infoHandle = [null];

      st = FT_GetDeviceInfoDetail(0, flags, dtype, devId, locId, serialBuf, descBuf, infoHandle);
      const serial = serialBuf.toString('utf-8').replace(/\0/g, '');
      const desc = descBuf.toString('utf-8').replace(/\0/g, '');

      console.log('  FT_GetDeviceInfoDetail:', st === 0 ? 'OK' : `FAILED (${st})`);
      console.log('    Flags:  ', '0x' + flags[0].toString(16),
        flags[0] & 1 ? '(OPENED)' : '(CLOSED)',
        flags[0] & 2 ? 'HISPEED' : 'FULLSPEED');
      console.log('    Type:   ', dtype[0]);
      console.log('    ID:     ', '0x' + devId[0].toString(16).padStart(8, '0'));
      console.log('    LocID:  ', '0x' + locId[0].toString(16).padStart(8, '0'));
      console.log('    Serial: ', JSON.stringify(serial));
      console.log('    Desc:   ', JSON.stringify(desc));

      // Try all open methods
      console.log('\n  Attempting FT_Open(0)...');
      const handle = [null];
      st = FT_Open(0, handle);
      console.log('    FT_Open(0):', st === 0 ? 'OK!' : `FAILED (status ${st})`);

      if (st !== 0) {
        // Try by serial from IOKit (not D2XX - we know D2XX returns empty)
        const ioKitSerial = '002E00215056430B20333639';
        console.log(`\n  Attempting FT_OpenEx(serial="${ioKitSerial}")...`);
        st = FT_OpenEx(Buffer.from(ioKitSerial + '\0'), 1, handle);
        console.log('    FT_OpenEx(serial):', st === 0 ? 'OK!' : `FAILED (status ${st})`);
      }

      if (st !== 0) {
        const ioKitDesc = 'SoundSwitch DMX Micro Interface';
        console.log(`\n  Attempting FT_OpenEx(desc="${ioKitDesc}")...`);
        st = FT_OpenEx(Buffer.from(ioKitDesc + '\0'), 2, handle);
        console.log('    FT_OpenEx(desc):', st === 0 ? 'OK!' : `FAILED (status ${st})`);
      }

      if (st === 0 && handle[0]) {
        console.log('\n  ✓ DEVICE OPENED SUCCESSFULLY');
        FT_Close(handle[0]);
      }
    }
  }
} catch (e) {
  console.log('  Error:', e.message);
  if (e.stack) console.log('  Stack:', e.stack.split('\n').slice(1, 3).join('\n'));
}

console.log('');

// ─── Test 3: Try D2XX with NO FT_SetVIDPID (baseline) ───
console.log('── Test 3: D2XX WITHOUT FT_SetVIDPID (baseline) ──');
try {
  const koffi = require('koffi');
  // Load a fresh instance by loading from a different resolved path
  const lib = koffi.load('/Applications/SoundSwitch.app/Contents/Frameworks/libftd2xx.1.4.24.dylib');
  const FT_CreateDeviceInfoList = lib.func('uint32 FT_CreateDeviceInfoList(_Out_ uint32 *)');

  const numDevs = [0];
  const st = FT_CreateDeviceInfoList(numDevs);
  console.log('  Without FT_SetVIDPID:', st === 0 ? `${numDevs[0]} device(s)` : `FAILED (${st})`);
  console.log('  (Expected 0 — standard FTDI VID 0x0403 only)');
} catch (e) {
  console.log('  Error:', e.message);
}

console.log('\n=== Done ===');
