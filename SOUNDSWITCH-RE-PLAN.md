# SoundSwitch Micro DMX — USB Protocol Reverse Engineering Plan

## Goal

Reverse engineer the USB communication protocol between SoundSwitch desktop software and the Micro DMX Interface hardware, then build a minimal open driver that can send arbitrary 512-byte DMX universes from our own code. This eliminates the SoundSwitch subscription dependency and lets our laser controller send DMX directly through hardware we already own.

---

## Confirmed Device Identity

From `ioreg -p IOUSB` probing on macOS:

| Field | Value | Analysis |
|---|---|---|
| **USB Vendor Name** | `SoundSwitch` | InMusic Brands subsidiary |
| **idVendor (VID)** | `0x15E4` (5604 decimal) | Custom registered VID — NOT a rebranded FTDI/CH340 |
| **Product String** | `SoundSwitch DMX Micro Interface` | Confirmed identity |
| **USB Serial Number** | `002E00215056430B20333639` | 24 hex chars = 96-bit STM32 unique device ID |
| **Device Speed** | `1` (Full Speed, 12 Mbps) | Typical for STM32 USB-FS peripheral |
| **kUSBAddress** | `1` | USB device address on current bus |

**Key insight:** The 96-bit serial number is the smoking gun for an **STM32 microcontroller**. STM32 chips expose their factory-burned unique ID (at flash address `0x1FFF7A10` on F1/F4 series) as the USB serial string. This means the firmware is custom but running on well-documented, commodity hardware.

**Why this matters:** STM32 USB implementations follow predictable patterns. The device will present as one of: CDC (virtual serial port), HID, or vendor-specific bulk. All three are straightforward to reverse engineer. There is essentially zero chance of encrypted authentication — STM32 USB stacks don't do that.

---

## Critical Discovery: macOS Visibility

The device does NOT appear in `system_profiler SPUSBDataType` but DOES appear in `ioreg -p IOUSB`. This means one of:

1. **SoundSwitch ships a DriverKit/DEXT or codeless kext** that matches on VID `0x15E4` and claims the device before the system USB driver can enumerate it into the standard profile. The device exists on the bus but is hidden from the default macOS USB tree.
2. **A user-space driver (via IOKit)** opens the device directly using `IOServiceGetMatchingServices` with the VID:PID, which gives it exclusive access.

Either way, `ioreg` is our ground-truth tool on macOS. All commands in this plan use `ioreg` instead of `system_profiler`.

---

## What We Still Need: PID & Interface Descriptors

We have the VID but NOT the PID or interface class codes. These determine which access method we use. The next diagnostic step is critical.

### Run these commands and record all output:

```bash
# COMMAND 1: Full device descriptor with PID and interfaces
ioreg -p IOUSB -l -w 0 | grep -A 30 "SoundSwitch DMX Micro"

# COMMAND 2: Full IORegistry entry including driver info
ioreg -r -c IOUSBHostDevice -l | grep -A 50 "SoundSwitch"

# COMMAND 3: Check what driver (if any) macOS has loaded for it
ioreg -r -c IOUSBHostDevice -l | grep -B 5 -A 20 "15e4"

# COMMAND 4: Check for SoundSwitch DriverKit extensions
systemextensionsctl list 2>/dev/null

# COMMAND 5: Check for legacy kexts
kextstat 2>/dev/null | grep -i "sound\|inmusic\|denon\|dmx"
ls /Library/Extensions/ 2>/dev/null | grep -i "sound\|dmx\|inmusic"

# COMMAND 6: Check if any process currently has the device open
sudo lsof 2>/dev/null | grep -i "usb\|iousb\|hid" | grep -v "kernel"
```

The output from **COMMAND 1** will contain `idProduct` (the PID) and interface descriptor fields. These go directly into the decision tree in Phase 1.

---

## Phase 1 — Complete the Identification

**Time estimate:** 10 minutes  
**Risk:** None  
**What we learn:** The PID, device class, interface types, endpoint addresses

### 1.1 — Get the PID

From COMMAND 1 output, find `idProduct`. Record it alongside the known VID:

```json
{
  "vid": "0x15E4",
  "pid": "0x????",
  "manufacturer": "SoundSwitch",
  "product": "SoundSwitch DMX Micro Interface",
  "serial": "002E00215056430B20333639",
  "speed": "Full Speed (12 Mbps)",
  "chip": "STM32 (inferred from 96-bit serial)"
}
```

### 1.2 — Get the interface descriptors

From COMMAND 1 or COMMAND 2 output, look for fields like:
- `bInterfaceClass`
- `bInterfaceSubClass`  
- `bInterfaceProtocol`
- `bNumEndpoints`
- Endpoint addresses and transfer types

If `ioreg` doesn't show full interface descriptors, use the Node.js probe to dump them programmatically:

```javascript
// probe-detailed.mjs — run with: node probe-detailed.mjs
// npm install usb
import { usb } from 'usb';

const VID = 0x15E4;
const devices = usb.getDeviceList().filter(d => d.deviceDescriptor.idVendor === VID);

if (devices.length === 0) {
  console.log('Device not found via libusb. Trying WebUSB backend...');
  // On macOS, libusb may not see it if a kext has claimed it.
  // In that case, we need to use IOKit directly (see Phase 1.4)
} else {
  const dev = devices[0];
  const desc = dev.deviceDescriptor;
  console.log(`\nVID: 0x${desc.idVendor.toString(16)} PID: 0x${desc.idProduct.toString(16)}`);
  console.log(`Device Class: ${desc.bDeviceClass} SubClass: ${desc.bDeviceSubClass} Protocol: ${desc.bDeviceProtocol}`);
  console.log(`Num Configurations: ${desc.bNumConfigurations}`);
  
  dev.open();
  const config = dev.configDescriptor;
  console.log(`\nConfiguration ${config.bConfigurationValue}:`);
  
  for (const iface of config.interfaces) {
    for (const alt of iface) {
      console.log(`\n  Interface ${alt.bInterfaceNumber} Alt ${alt.bAlternateSetting}:`);
      console.log(`    Class: ${alt.bInterfaceClass} SubClass: ${alt.bInterfaceSubClass} Protocol: ${alt.bInterfaceProtocol}`);
      console.log(`    Endpoints: ${alt.endpoints.length}`);
      for (const ep of alt.endpoints) {
        const dir = ep.direction === 'in' ? 'IN' : 'OUT';
        const type = ['CONTROL', 'ISOCHRONOUS', 'BULK', 'INTERRUPT'][ep.transferType];
        console.log(`      EP 0x${ep.address.toString(16)}: ${dir} ${type} maxPacket=${ep.packetSize} interval=${ep.interval}`);
      }
    }
  }
  dev.close();
}
```

### 1.3 — Decision tree based on interface class

Once you have the interface class code:

```
Interface class from descriptor
│
├─ Class 0x02 + 0x0A (CDC ACM — Virtual Serial Port)
│  ├─ This is the BEST case. The STM32 is running USB-CDC firmware.
│  ├─ It should appear as /dev/tty.usbmodem* on macOS
│  ├─ Check: ls /dev/tty.usbmodem* (with device plugged in)
│  ├─ If visible: open with serialport at various baud rates and listen
│  ├─ If not visible: SoundSwitch driver is intercepting. Use IOKit or
│  │   libusb to detach the driver and claim the interface ourselves.
│  └─ → Skip to Phase 4A (Serial Protocol)
│
├─ Class 0x03 (HID — Human Interface Device)  
│  ├─ Common for simple USB-DMX devices that want driverless operation
│  ├─ DMX data packed into HID output reports (64-byte chunks)
│  ├─ 512 bytes = 8 reports with sequential report IDs, or
│  │   chunked with a report ID + offset scheme
│  ├─ Use node-hid to enumerate and open by VID:PID
│  └─ → Skip to Phase 4B (HID Protocol)
│
├─ Class 0xFF (Vendor-Specific)
│  ├─ Custom bulk endpoint protocol — most likely for an STM32
│  ├─ Will have 1-2 bulk OUT endpoints and possibly 1 bulk IN endpoint
│  ├─ Full Wireshark capture needed to determine framing
│  └─ → Proceed to Phase 2 (Traffic Capture), then Phase 4C (Bulk Protocol)
│
└─ libusb can't see the device at all
   ├─ A macOS driver/kext has exclusive claim
   ├─ → Go to Phase 1.4 (Driver Investigation) to find and neutralize it
   └─ Then restart from Phase 1.2
```

### 1.4 — Investigate the macOS driver claim (if device is invisible to libusb)

If `node-usb` or `libusb` cannot see the device, a macOS driver has claimed it exclusively. We need to find that driver and either remove it, unload it, or work around it.

```bash
# Find what's claiming the device in the IORegistry
ioreg -r -c IOUSBHostDevice -l -w 0 | grep -A 100 "SoundSwitch" | head -120

# Look for IOService objects attached to the device — these are the drivers
# The key fields are:
#   "CFBundleIdentifier" — the kext/dext claiming it
#   "IOClass" — the driver class name
#   "IOProviderClass" — what it's attached to

# Check for a DriverKit extension
systemextensionsctl list 2>/dev/null | grep -i "sound\|inmusic"

# Check for installed kexts
kextfind -b -s "sound\|inmusic\|dmx" 2>/dev/null

# Check inside the SoundSwitch app bundle for drivers
find /Applications/SoundSwitch*.app -name "*.kext" -o -name "*.dext" -o -name "*.plugin" -o -name "*.driver" 2>/dev/null

# On modern macOS, also check for user-space IOKit claim
# The SoundSwitch process itself might be using IOKit API to claim the device
# This would release when SoundSwitch quits:
# 1. Quit SoundSwitch completely
# 2. Re-run the libusb probe
# If it now appears → SoundSwitch user-space driver, not a kernel driver
```

**If SoundSwitch user-space claims the device:**  
Simply ensure SoundSwitch is not running when our driver opens the device. Our driver and SoundSwitch cannot run simultaneously (which is fine — we're replacing it).

**If a kext/dext claims the device:**  
We can temporarily unload it:
```bash
# For a kext (legacy):
sudo kextunload -b com.inmusic.soundswitch.driver  # (use actual bundle ID from discovery)

# For a DriverKit extension (modern):
# These are harder to unload. May need to:
# 1. Remove the extension
# 2. Or use libusb's auto_detach_kernel_driver feature
```

**In the Node.js driver, always call auto-detach:**
```javascript
device.open();
const iface = device.interface(0);
if (process.platform === 'darwin') {
  // On macOS, automatically detach kernel driver if attached
  iface.detachKernelDriver();
}
iface.claim();
```

---

## Phase 2 — Traffic Capture (macOS)

**Time estimate:** 30-60 minutes  
**Risk:** Low (passive observation only)  
**What we learn:** The exact bytes SoundSwitch sends to the device

**Only needed if:** Phase 1 determined vendor-specific class (0xFF) or you need to decode the exact frame format for CDC/HID.

### 2.1 — Choose your capture method

macOS USB capture is trickier than Linux/Windows. Here are three approaches in order of preference:

**Method A: macOS native (if SIP allows)**
```bash
# Check if the XHC interface exists
ifconfig -l | tr ' ' '\n' | grep XHC

# If XHC20 exists, enable it:
sudo ifconfig XHC20 up

# Then capture in Wireshark on the XHC20 interface
# Filter: usb.idVendor == 0x15e4
```

Note: macOS Catalina+ with SIP enabled blocks this. If it doesn't work, use Method B or C.

**Method B: Linux VM with USB passthrough (most reliable)**
1. Install VirtualBox or UTM
2. Create a minimal Ubuntu VM
3. In VM settings, add a USB device filter for VID `0x15E4`
4. Boot the VM, the SoundSwitch will be passed through
5. In the VM: `sudo modprobe usbmon && sudo wireshark`
6. Install SoundSwitch in the VM (or use the macOS host — see note below)

Note: USB passthrough means the HOST macOS loses the device. SoundSwitch must run in the VM too, or you need to use Method C.

**Method C: Programmatic capture with Node.js (no Wireshark needed)**

This is the most practical approach — we write a script that watches the USB traffic from within our own code. This works even when a driver has claimed the device, because we can use the SoundSwitch software as the sender and just observe what the device receives by monitoring the USB bus.

However, the simpler approach is: **quit SoundSwitch, claim the device ourselves, and just start sending test frames** directly (skip to Phase 4). We only need Wireshark if we can't figure out the protocol from the interface descriptors alone.

### 2.2 — Quick capture without Wireshark (recommended)

Instead of full Wireshark capture, use this targeted approach that's easier on macOS:

**Step 1:** While SoundSwitch is running and connected to the device, use `dtrace` to watch USB I/O:

```bash
# Watch all USB I/O operations from SoundSwitch
sudo dtrace -n 'syscall::write:entry /execname == "SoundSwitch"/ { printf("fd=%d len=%d", arg0, arg2); }' 2>/dev/null

# Or watch IOKit calls
sudo dtrace -n 'pid$target::IOConnectCallMethod:entry { printf("selector=%d", arg1); }' -p $(pgrep SoundSwitch)
```

**Step 2:** If SoundSwitch uses libusb internally, check its dynamic libraries:

```bash
# What libraries does SoundSwitch link against?
otool -L /Applications/SoundSwitch.app/Contents/MacOS/SoundSwitch 2>/dev/null | grep -i "usb\|hid\|serial\|iokit"

# Does it use IOKit directly?
nm -gU /Applications/SoundSwitch.app/Contents/MacOS/SoundSwitch 2>/dev/null | grep -i "USB\|IOKit\|HID"
```

This tells us the exact API layer SoundSwitch uses, which dictates how the protocol works.

### 2.3 — If Wireshark is needed: Full capture procedure

If you do get Wireshark working on the USB bus (via any method):

**Capture A — Handshake (cold start):**
1. Unplug the SoundSwitch adapter
2. Start Wireshark on USB bus, filter: `usb.idVendor == 0x15e4`
3. Plug in the adapter
4. Launch SoundSwitch software, wait for it to connect
5. Wait 10 seconds, stop capture
6. Save as `capture-handshake.pcapng`

**Capture B — Known DMX patterns:**
1. Start capture
2. In SoundSwitch, use Static Looks or color overrides to create known states:
   - Full blackout (all zeros)
   - Single fixture full brightness (all 255)
   - Toggle between the two with 5-second gaps
3. Stop capture after 30 seconds
4. Save as `capture-patterns.pcapng`

**Capture C — Idle refresh:**
1. Leave SoundSwitch running, no changes
2. Capture 10 seconds
3. Save as `capture-idle.pcapng`

### 2.4 — What to look for in captures

At 37Hz refresh, expect ~37 outbound transfers per second. Key signatures:

| Transfer Size | Likely Meaning |
|---|---|
| 8 bytes | Control transfer setup packet (handshake) |
| 64 bytes | HID report (if HID class) |
| 512-520 bytes | Raw DMX universe (512 channels + small header) |
| 513 bytes | DMX with start code byte prepended |
| 577 bytes | 1-byte cmd + 512 data + 64-byte padding to USB packet boundary |

**Diffing technique for pattern captures:** Export the raw bytes of a packet during blackout and during full-brightness. XOR them:
- All-zero XOR result = identical (both in header region)
- `0xFF` result bytes = these are the DMX channel positions
- The first non-zero byte in the XOR output = first DMX channel = header ends here

---

## Phase 3 — Protocol Analysis

**Time estimate:** 1-3 hours (only needed for vendor-specific class)  
**Risk:** None  
**What we learn:** The exact frame format

### 3.1 — STM32-specific protocol patterns

Since we know this is an STM32, the firmware almost certainly uses one of the standard STM32 USB libraries (HAL, LL, or libopencm3). These have predictable patterns:

**If CDC (most likely for STM32 USB-DMX):**
- STM32 CDC firmware typically accepts raw bytes on the bulk OUT endpoint
- No special framing — just write 512 bytes and the firmware parses them
- The STM32 converts incoming USB bytes to UART at 250kbaud with DMX timing
- Possible thin header: 1-2 byte command prefix to distinguish between "send DMX" and "configure"

**If HID:**
- STM32 HID uses 64-byte reports (USB Full Speed max HID packet)
- 512 bytes = 8 reports
- Likely format: `[report_id] [chunk_index] [32 or 62 bytes of DMX data]`
- Or: `[report_id] [start_channel_hi] [start_channel_lo] [count] [data...]`

**If vendor-specific bulk:**
- Direct bulk transfers to endpoint
- Header likely includes: command byte, universe number, length
- Common STM32 patterns:
  ```
  0x00 [512 bytes]           — minimal, start code + data
  0x06 0x01 0x00 0x02 [512]  — cmd=6, universe=1, len=512 (LE), data
  0x7E 0x06 0x00 0x02 [512] 0xE7  — Enttec Pro compatible framing
  ```

### 3.2 — Shortcut: Binary analysis of SoundSwitch app

This can reveal the protocol without any USB capture:

```bash
# Check if SoundSwitch is Electron (game over if yes — readable JS source)
ls /Applications/SoundSwitch.app/Contents/Resources/app.asar 2>/dev/null && echo "ELECTRON APP!"

# If Electron, extract and search:
cd /tmp
npx asar extract /Applications/SoundSwitch.app/Contents/Resources/app.asar ss-src
grep -r "0x15e4\|15E4\|5604\|bulk\|endpoint\|transfer\|dmx.*write\|send.*dmx\|universe.*send" ss-src/
grep -r "0x7[eE]\|0x06\|startCode\|DMX_HEADER\|FRAME_START\|sendFrame\|writeFrame" ss-src/

# If NOT Electron, use strings on the binary:
strings /Applications/SoundSwitch.app/Contents/MacOS/SoundSwitch | grep -i "dmx\|universe\|frame\|bulk\|endpoint\|channel\|15e4"

# Check for embedded libusb or hidapi
strings /Applications/SoundSwitch.app/Contents/MacOS/SoundSwitch | grep -i "libusb\|hidapi\|ftdi\|serial\|cdc\|baud"

# Look at dynamic library dependencies
otool -L /Applications/SoundSwitch.app/Contents/MacOS/SoundSwitch

# Check for property lists with USB matching info
find /Applications/SoundSwitch.app -name "*.plist" -exec grep -l "15e4\|idVendor\|USB" {} \;
```

**If it's an Electron app:** We can extract the complete JavaScript source and read the exact protocol implementation. This would make Phases 2-3 unnecessary — we'd have the header format, handshake sequence, and framing directly from the source code.

### 3.3 — Shortcut: Watch file descriptors at runtime

```bash
# Launch SoundSwitch, find its PID
open /Applications/SoundSwitch.app
sleep 3
SS_PID=$(pgrep -f SoundSwitch | head -1)
echo "SoundSwitch PID: $SS_PID"

# Check what device files it has open
lsof -p $SS_PID 2>/dev/null | grep -i "usb\|hid\|tty\|dev/"

# If it opens /dev/tty.usbmodem* → it's using serial/CDC
# If it opens /dev/hidraw* or IOHIDDevice → it's using HID
# If it opens IOUSBHostInterface → it's using vendor-specific bulk via IOKit

# On macOS, also check IOKit services in use:
sudo lsof -p $SS_PID 2>/dev/null | grep IOUSBHost
```

### 3.4 — Document the protocol

Once determined, create `protocol.md`:

```markdown
## SoundSwitch Micro DMX USB Protocol

### Device Identity
- VID: 0x15E4
- PID: 0x____ (fill in)
- Chip: STM32 (confirmed via 96-bit serial)
- Speed: Full Speed (12 Mbps)
- Class: ____ (fill in)

### Handshake Sequence
(fill in from capture or source code analysis)

### DMX Frame Format
Total packet size: ___ bytes
| Offset | Length | Field | Value | Description |
|--------|--------|-------|-------|-------------|
| 0      | ?      | header| ?     | ?           |
| ?      | 512    | data  | 0-255 | DMX ch 1-512|

### Timing
- Refresh rate: 37 Hz (27ms between frames)
- No explicit keepalive — continuous frame stream serves as keepalive
```

---

## Phase 4 — Build the Driver

**Time estimate:** 2-4 hours  
**Risk:** Low

Three paths depending on Phase 1 results. The driver API is the same for all three — only the transport layer changes.

### 4A — CDC Serial Path

If the device presents as CDC class (`0x02` + `0x0A`) or you found a `/dev/tty.usbmodem*` device:

```javascript
// soundswitch-driver-serial.mjs
import { SerialPort } from 'serialport';

const VID = '15E4';

export class SoundSwitchDriver {
  constructor() {
    this.port = null;
    this.channels = Buffer.alloc(512, 0);
    this.interval = null;
    this.ready = false;
  }

  async init() {
    // Find the SoundSwitch serial port by VID
    const ports = await SerialPort.list();
    const ssPort = ports.find(p =>
      p.vendorId && p.vendorId.toLowerCase() === VID.toLowerCase()
    );

    if (!ssPort) {
      // macOS might hide it. Try known patterns:
      const modemPorts = ports.filter(p => p.path.includes('usbmodem'));
      if (modemPorts.length === 0) throw new Error('SoundSwitch not found as serial device');
      // Try the first usbmodem port
      console.log('Trying usbmodem port:', modemPorts[0].path);
      this.port = new SerialPort({
        path: modemPorts[0].path,
        baudRate: 250000, // Standard DMX baud rate
        dataBits: 8,
        stopBits: 2,
        parity: 'none',
      });
    } else {
      this.port = new SerialPort({
        path: ssPort.path,
        baudRate: 250000,
        dataBits: 8,
        stopBits: 2,
        parity: 'none',
      });
    }

    await new Promise((resolve, reject) => {
      this.port.on('open', resolve);
      this.port.on('error', reject);
    });

    // Start sending DMX frames at 37Hz
    this.interval = setInterval(() => this._sendFrame(), 1000 / 37);
    this.ready = true;
    console.log('SoundSwitch CDC driver initialized');
  }

  _sendFrame() {
    if (!this.port || !this.port.isOpen) return;

    // Try multiple frame formats — comment out the ones that don't work:

    // Format 1: Raw DMX (start code + 512 channels)
    // const frame = Buffer.concat([Buffer.from([0x00]), this.channels]);

    // Format 2: Enttec Pro compatible
    // const frame = Buffer.concat([
    //   Buffer.from([0x7E, 0x06, 0x01, 0x02]), // header: start, cmd=6, len=513 LE
    //   Buffer.from([0x00]),                     // DMX start code
    //   this.channels,                           // 512 channel values
    //   Buffer.from([0xE7]),                     // end byte
    // ]);

    // Format 3: Minimal header (common for STM32 CDC-DMX)
    // const frame = Buffer.concat([
    //   Buffer.from([0x06]),  // command: "send DMX"
    //   this.channels,        // 512 channel values
    // ]);

    // Format 4: Just raw 512 bytes, no header at all
    const frame = this.channels;

    this.port.write(frame);
  }

  setChannel(ch, value) {
    if (ch >= 1 && ch <= 512) this.channels[ch - 1] = Math.max(0, Math.min(255, value));
  }

  setAll(buf) {
    buf.copy(this.channels, 0, 0, Math.min(buf.length, 512));
  }

  blackout() {
    this.channels.fill(0);
  }

  close() {
    if (this.interval) clearInterval(this.interval);
    this.blackout();
    if (this.port && this.port.isOpen) {
      this._sendFrame(); // one last blackout
      setTimeout(() => this.port.close(), 100);
    }
    this.ready = false;
  }
}
```

**Testing CDC:** Try each frame format one at a time. Set CH1=255 (master dimmer) and see if the laser responds. If format 4 (raw bytes) doesn't work, try format 1 (with start code), then format 2 (Enttec framing), then format 3 (command prefix).

Also try alternate baud rates if 250000 doesn't work: `115200`, `500000`, `1000000`. The STM32 CDC might use a virtual baud rate that doesn't correspond to the actual UART speed (since the STM32 firmware controls the UART independently).

### 4B — HID Path

If the device presents as HID class (`0x03`):

```javascript
// soundswitch-driver-hid.mjs
import HID from 'node-hid';

const VID = 0x15E4;

export class SoundSwitchDriver {
  constructor() {
    this.device = null;
    this.channels = Buffer.alloc(512, 0);
    this.interval = null;
    this.ready = false;
  }

  async init() {
    // Find the SoundSwitch HID device
    const devices = HID.devices().filter(d => d.vendorId === VID);
    if (devices.length === 0) throw new Error('SoundSwitch not found as HID device');

    console.log('Found HID device:', devices[0]);
    this.device = new HID.HID(devices[0].path);

    // Start sending DMX frames at 37Hz
    this.interval = setInterval(() => this._sendFrame(), 1000 / 37);
    this.ready = true;
    console.log('SoundSwitch HID driver initialized');
  }

  _sendFrame() {
    if (!this.device) return;

    // HID reports are max 64 bytes on Full Speed USB.
    // 512 bytes of DMX = 8 chunks of 64 bytes, or more commonly:
    // 9 chunks of 62 bytes (report_id + chunk_index + 62 data bytes = 64 total)

    // Strategy 1: Single large feature report (if device supports it)
    // try {
    //   const report = Buffer.alloc(513);
    //   report[0] = 0x00; // report ID
    //   this.channels.copy(report, 1);
    //   this.device.sendFeatureReport(Array.from(report));
    //   return;
    // } catch (e) {}

    // Strategy 2: Chunked output reports
    const CHUNK_DATA_SIZE = 62; // 64 - reportId(1) - chunkIndex(1)
    const numChunks = Math.ceil(512 / CHUNK_DATA_SIZE); // 9 chunks

    for (let i = 0; i < numChunks; i++) {
      const offset = i * CHUNK_DATA_SIZE;
      const remaining = Math.min(CHUNK_DATA_SIZE, 512 - offset);
      const report = Buffer.alloc(64, 0);
      report[0] = 0x00;  // report ID (may need to adjust)
      report[1] = i;      // chunk index
      this.channels.copy(report, 2, offset, offset + remaining);

      try {
        this.device.write(Array.from(report));
      } catch (e) {
        console.error('HID write error:', e.message);
      }
    }
  }

  setChannel(ch, value) {
    if (ch >= 1 && ch <= 512) this.channels[ch - 1] = Math.max(0, Math.min(255, value));
  }

  setAll(buf) {
    buf.copy(this.channels, 0, 0, Math.min(buf.length, 512));
  }

  blackout() {
    this.channels.fill(0);
  }

  close() {
    if (this.interval) clearInterval(this.interval);
    this.blackout();
    if (this.device) {
      this._sendFrame();
      setTimeout(() => this.device.close(), 100);
    }
    this.ready = false;
  }
}
```

### 4C — Vendor-Specific Bulk Path

If the device presents as vendor-specific class (`0xFF`) with bulk endpoints:

```javascript
// soundswitch-driver-bulk.mjs
import usb from 'usb';

const VID = 0x15E4;
// PID will be filled in from Phase 1
let PID = 0x0000; // ← FILL THIS IN

export class SoundSwitchDriver {
  constructor(pid) {
    if (pid) PID = pid;
    this.device = null;
    this.iface = null;
    this.outEndpoint = null;
    this.channels = Buffer.alloc(512, 0);
    this.interval = null;
    this.ready = false;
  }

  async init() {
    this.device = usb.findByIds(VID, PID);
    if (!this.device) throw new Error(`SoundSwitch not found (VID:0x${VID.toString(16)} PID:0x${PID.toString(16)})`);

    this.device.open();

    // Claim the first interface
    this.iface = this.device.interface(0);

    // On macOS, detach kernel driver if it has claimed the device
    try {
      if (this.iface.isKernelDriverActive()) {
        this.iface.detachKernelDriver();
      }
    } catch (e) {
      console.log('Note: Could not detach kernel driver:', e.message);
    }

    this.iface.claim();

    // Find the OUT bulk endpoint
    this.outEndpoint = this.iface.endpoints.find(
      ep => ep.direction === 'out' && ep.transferType === usb.LIBUSB_TRANSFER_TYPE_BULK
    );

    if (!this.outEndpoint) {
      // Try interrupt endpoint as fallback
      this.outEndpoint = this.iface.endpoints.find(
        ep => ep.direction === 'out' && ep.transferType === usb.LIBUSB_TRANSFER_TYPE_INTERRUPT
      );
    }

    if (!this.outEndpoint) {
      throw new Error('No OUT endpoint found on SoundSwitch device');
    }

    console.log(`Using endpoint 0x${this.outEndpoint.address.toString(16)} (${['ctrl','iso','bulk','intr'][this.outEndpoint.transferType]})`);

    // Replay handshake if needed (fill in from capture analysis)
    await this._handshake();

    // Start sending DMX frames at 37Hz
    this.interval = setInterval(() => this._sendFrame(), 1000 / 37);
    this.ready = true;
    console.log('SoundSwitch bulk driver initialized');
  }

  async _handshake() {
    // FILL IN FROM WIRESHARK CAPTURE OR SOURCE ANALYSIS
    // Common handshake patterns for STM32 USB-DMX:

    // Pattern 1: Simple "enable DMX output" control transfer
    // await this._controlTransfer(0x40, 0x01, 0x0001, 0x0000, Buffer.alloc(0));

    // Pattern 2: Set universe and channel count
    // await this._controlTransfer(0x40, 0x02, 0x0200, 0x0001, Buffer.alloc(0));
    // (wValue=512 channels, wIndex=universe 1)

    // Pattern 3: No handshake needed — just start sending frames
    // (most common for simple STM32 bulk implementations)

    console.log('Handshake: sending test frame...');
  }

  _controlTransfer(bmRequestType, bRequest, wValue, wIndex, data) {
    return new Promise((resolve, reject) => {
      this.device.controlTransfer(bmRequestType, bRequest, wValue, wIndex, data, (err, buf) => {
        if (err) reject(err); else resolve(buf);
      });
    });
  }

  _sendFrame() {
    if (!this.outEndpoint) return;

    // Build the frame — try these formats in order:

    // Format 1: Raw 512 bytes
    // const frame = this.channels;

    // Format 2: Start code + 512 bytes (standard DMX framing)
    // const frame = Buffer.concat([Buffer.from([0x00]), this.channels]);

    // Format 3: Command header + 512 bytes
    // const frame = Buffer.concat([
    //   Buffer.from([0x06, 0x00, 0x00, 0x02]), // cmd=6, universe=0, length=512 LE
    //   this.channels
    // ]);

    // Format 4: Enttec Pro framing (very common clone format)
    const frame = Buffer.concat([
      Buffer.from([0x7E, 0x06, 0x01, 0x02]), // start=0x7E, cmd=6, len=513 (LE)
      Buffer.from([0x00]),                     // DMX start code
      this.channels,                           // 512 bytes
      Buffer.from([0xE7]),                     // end=0xE7
    ]);

    this.outEndpoint.transfer(frame, (err) => {
      if (err && err.errno !== usb.LIBUSB_TRANSFER_TIMED_OUT) {
        console.error('Bulk transfer error:', err.message);
      }
    });
  }

  setChannel(ch, value) {
    if (ch >= 1 && ch <= 512) this.channels[ch - 1] = Math.max(0, Math.min(255, value));
  }

  setAll(buf) {
    buf.copy(this.channels, 0, 0, Math.min(buf.length, 512));
  }

  blackout() {
    this.channels.fill(0);
  }

  close() {
    if (this.interval) clearInterval(this.interval);
    this.blackout();
    if (this.outEndpoint) {
      // Send final blackout frame synchronously
      const blackFrame = Buffer.concat([
        Buffer.from([0x7E, 0x06, 0x01, 0x02]),
        Buffer.alloc(513, 0),
        Buffer.from([0xE7]),
      ]);
      this.outEndpoint.transfer(blackFrame, () => {
        this.iface.release(() => this.device.close());
      });
    }
    this.ready = false;
  }
}
```

---

## Phase 4D — Universal Auto-Detect Driver

This wrapper tries all three approaches automatically:

```javascript
// soundswitch-driver.mjs
// Auto-detecting driver that tries CDC → HID → Bulk in order

import { SerialPort } from 'serialport';

const VID_HEX = '15E4';
const VID_NUM = 0x15E4;

export async function createSoundSwitchDriver() {
  console.log('Probing SoundSwitch Micro DMX...');

  // ── Attempt 1: CDC Serial ──
  try {
    const ports = await SerialPort.list();
    const ssPort = ports.find(p =>
      p.vendorId && p.vendorId.toUpperCase() === VID_HEX
    ) || ports.find(p => p.path.includes('usbmodem'));

    if (ssPort) {
      console.log(`Found serial port: ${ssPort.path}`);
      const { SoundSwitchDriver } = await import('./soundswitch-driver-serial.mjs');
      const driver = new SoundSwitchDriver();
      await driver.init();
      return driver;
    }
  } catch (e) {
    console.log('CDC probe failed:', e.message);
  }

  // ── Attempt 2: HID ──
  try {
    const HID = (await import('node-hid')).default;
    const devices = HID.devices().filter(d => d.vendorId === VID_NUM);
    if (devices.length > 0) {
      console.log(`Found HID device: ${devices[0].product}`);
      const { SoundSwitchDriver } = await import('./soundswitch-driver-hid.mjs');
      const driver = new SoundSwitchDriver();
      await driver.init();
      return driver;
    }
  } catch (e) {
    console.log('HID probe failed:', e.message);
  }

  // ── Attempt 3: Raw USB / Bulk ──
  try {
    const usbLib = (await import('usb')).default;
    const device = usbLib.getDeviceList().find(d => d.deviceDescriptor.idVendor === VID_NUM);
    if (device) {
      const pid = device.deviceDescriptor.idProduct;
      console.log(`Found USB device: VID:0x${VID_HEX} PID:0x${pid.toString(16)}`);
      const { SoundSwitchDriver } = await import('./soundswitch-driver-bulk.mjs');
      const driver = new SoundSwitchDriver(pid);
      await driver.init();
      return driver;
    }
  } catch (e) {
    console.log('Bulk USB probe failed:', e.message);
  }

  throw new Error(
    'SoundSwitch Micro DMX not found via any method.\n' +
    'Ensure the device is plugged in, the blue LED is on,\n' +
    'and SoundSwitch desktop software is CLOSED (it claims exclusive access).'
  );
}
```

---

## Phase 5 — Verification & Testing

**Time estimate:** 30-60 minutes

### 5.1 — Smoke test

```javascript
// test-soundswitch.mjs
import { createSoundSwitchDriver } from './soundswitch-driver.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const driver = await createSoundSwitchDriver();
  console.log('Driver ready! Running smoke tests...\n');

  // Test 1: Blackout
  console.log('Test 1: Blackout (2s)');
  driver.blackout();
  await sleep(2000);

  // Test 2: Master dimmer full
  console.log('Test 2: CH1 = 255 (master dimmer full, 2s)');
  driver.setChannel(1, 255);
  await sleep(2000);

  // Test 3: Mode change
  console.log('Test 3: CH2 = 100 (mode change, 2s)');
  driver.setChannel(2, 100);
  await sleep(2000);

  // Test 4: Smooth ramp on CH1
  console.log('Test 4: Ramping CH1 0→255 over 3s');
  for (let i = 0; i <= 255; i++) {
    driver.setChannel(1, i);
    await sleep(12);
  }

  // Test 5: RGB color cycle
  console.log('Test 5: RGB cycle (3s)');
  driver.setChannel(1, 255); // master on
  driver.setChannel(2, 200); // manual mode
  for (let hue = 0; hue < 360; hue += 4) {
    const r = Math.round(Math.max(0, Math.cos((hue) * Math.PI / 180) * 127 + 128));
    const g = Math.round(Math.max(0, Math.cos((hue - 120) * Math.PI / 180) * 127 + 128));
    const b = Math.round(Math.max(0, Math.cos((hue - 240) * Math.PI / 180) * 127 + 128));
    driver.setChannel(5, r);
    driver.setChannel(6, g);
    driver.setChannel(7, b);
    await sleep(33);
  }

  // Cleanup
  console.log('\nBlackout and close');
  driver.close();
  await sleep(500);
  console.log('Done!');
  process.exit(0);
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
```

### 5.2 — Frame format discovery (if no laser response)

If the smoke test connects but the laser doesn't respond, the frame format is wrong. Use this systematic approach:

```javascript
// brute-format-test.mjs
// Tries every common DMX frame format and waits for you to observe the laser
import { createSoundSwitchDriver } from './soundswitch-driver.mjs';
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));

// Define frame formats to try — edit _sendFrame() in the driver for each
const formats = [
  'Raw 512 bytes (no header)',
  'Start code (0x00) + 512 bytes',
  'Enttec Pro framing (0x7E...0xE7)',
  'Command byte (0x06) + 512 bytes',
  'Length-prefixed: [0x00, 0x02] + 512 bytes',
  '2-byte header [universe=0, cmd=6] + 512 bytes',
];

console.log('Frame format discovery');
console.log('For each format, CH1 (master) will be set to 255.');
console.log('Watch the laser — does it respond?\n');

for (let i = 0; i < formats.length; i++) {
  console.log(`\n--- Format ${i + 1}: ${formats[i]} ---`);
  console.log('(Edit _sendFrame() in the driver to match, then restart)');
  const answer = await ask('Did the laser respond? (y/n/skip): ');
  if (answer.toLowerCase() === 'y') {
    console.log(`\n✓ FORMAT FOUND: ${formats[i]}`);
    break;
  }
}

rl.close();
```

### 5.3 — Integration with bridge.js

Once a working format is confirmed, add to `bridge.js` adapter detection:

```javascript
// In bridge.js, add to the DRIVER_PRIORITY list:
const DRIVER_PRIORITY = [
  { name: 'soundswitch', detect: () => detectSoundSwitch() },
  { name: 'enttec-usb-dmx-pro' },
  { name: 'enttec-open-usb-dmx' },
  { name: 'dmx4all' },
];

async function detectSoundSwitch() {
  try {
    const driver = await createSoundSwitchDriver();
    return driver; // Returns the driver instance if found
  } catch {
    return null;
  }
}
```

---

## Recommended Execution Order

Given what we know (STM32, macOS, VID confirmed, PID needed):

```
Step 1 (5 min)    Run the ioreg commands from "What We Still Need" section
                   → Get PID and interface class
                   → Determines which Phase 4 path (A, B, or C)

Step 2 (10 min)   Run the SoundSwitch binary analysis (Phase 3.2)
                   → Check if Electron app (instant protocol revelation)
                   → strings search for frame headers and command bytes

Step 3 (5 min)    Quit SoundSwitch, run the Node.js probe (Phase 1.2)
                   → Confirms device is accessible to libusb/HID/serial
                   → Gets full endpoint descriptor

Step 4 (15 min)   Run lsof while SoundSwitch is connected (Phase 3.3)
                   → Reveals whether CDC, HID, or vendor-specific

Step 5 (30 min)   Build and test the driver (Phase 4, path based on results)
                   → Auto-detect driver tries all three methods

Step 6 (30 min)   Frame format discovery if needed (Phase 5.2)
                   → Systematic format testing against live laser

Step 7 (15 min)   Integration with bridge.js (Phase 5.3)
                   → Drop-in replacement for Enttec drivers
```

**Total estimated time: 2-4 hours** (previously 7 hours — narrowed by STM32 identification)

**Wireshark is now OPTIONAL.** Between the binary analysis, lsof probing, and systematic frame format testing, we can likely crack the protocol without capturing a single USB packet. Wireshark becomes a fallback if the brute-force format test doesn't find the right framing.

---

## Risk Assessment (Updated)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ~~Device uses encrypted auth~~ | ~~Very Low~~ | ~~Blocks project~~ | **Eliminated.** STM32 USB stacks don't implement crypto handshakes. |
| macOS driver claims exclusive access | Medium | Adds 30 min | Quit SoundSwitch first; or use `detachKernelDriver()` in libusb |
| Frame format not obvious | Medium | Adds 30 min | Systematic brute-force of 6 common formats |
| Device needs specific handshake | Low | Adds 1-2 hours | Wireshark capture + replay |
| SoundSwitch is Electron app | ~40% chance | Eliminates all guesswork | Extract JS source, read protocol directly |
| We brick the device | Near Zero | $30 loss | STM32 USB has hardware protection; worst case = unplug and replug |
| $15 FTDI cable still needed | Low | Fallback always available | Order one preemptively if you want zero risk |

---

## Deliverables

1. **`device-identity.json`** — Complete USB descriptor (VID `0x15E4`, PID, interface class, endpoints)
2. **`protocol.md`** — Documented frame format, handshake (if any), timing
3. **`soundswitch-driver-serial.mjs`** — CDC serial path driver
4. **`soundswitch-driver-hid.mjs`** — HID path driver
5. **`soundswitch-driver-bulk.mjs`** — Vendor-specific bulk path driver
6. **`soundswitch-driver.mjs`** — Auto-detect wrapper that tries all three
7. **`test-soundswitch.mjs`** — Smoke test and frame format discovery
8. **Updated `bridge.js`** — SoundSwitch as first-priority adapter in detection chain
