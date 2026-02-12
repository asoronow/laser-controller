# DMX Adapter Explorer & Simulator — Implementation Spec

## Purpose

Two goals, one app:

1. **Determine if the user's SoundSwitch Micro DMX adapter can be driven by generic serial/DMX libraries.** The adapter is proprietary but the XLR output is standard DMX512. We need to probe the USB side to see if it exposes a usable serial interface.

2. **Provide a full DMX simulator** so the laser controller UI can be developed and tested without physical hardware. The simulator visualizes what the laser would be doing based on the 29 DMX channel values in real time.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Next.js 16 App (frontend + API routes)                   │
│                                                           │
│  ┌─────────────────┐  ┌──────────────────────────────┐   │
│  │  /explore        │  │  /simulate                    │  │
│  │  Adapter Explorer │  │  DMX Laser Simulator          │  │
│  │                   │  │                                │  │
│  │  - List USB ports │  │  - 29 channel sliders          │  │
│  │  - Show VID/PID   │  │  - Scene presets               │  │
│  │  - Try drivers    │  │  - Canvas laser visualization  │  │
│  │  - Send test DMX  │  │  - Beat sync engine            │  │
│  │  - Show results   │  │  - Audio analyzer (mic)        │  │
│  └────────┬──────────┘  └──────────┬─────────────────────┘  │
│           │                        │                         │
│  ┌────────▼────────────────────────▼─────────────────────┐  │
│  │  API Routes (Node.js, server-side)                     │  │
│  │                                                         │  │
│  │  POST /api/ports          — list serial ports           │  │
│  │  POST /api/probe          — try a driver on a port      │  │
│  │  POST /api/dmx/send       — send DMX frame to hardware  │  │
│  │  POST /api/dmx/blackout   — all channels to 0           │  │
│  │  GET  /api/status         — current adapter state        │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

Everything runs in a single Next.js app. No separate backend process. The API routes handle all serial/DMX communication server-side. The frontend is two pages: the adapter explorer and the simulator.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| Serial port access | `serialport` npm package (server-side only, in API routes) |
| DMX output | `enttec-open-dmx-usb` or raw serial write (server-side only) |
| Laser visualization | HTML Canvas 2D |
| Audio analysis | Web Audio API (client-side) |
| State management | React Context + useReducer |

### Key Dependency Notes

```json
{
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "serialport": "^12.0.0",
    "enttec-open-dmx-usb": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tailwindcss": "^4.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0"
  }
}
```

`serialport` and `enttec-open-dmx-usb` are Node.js native modules. They MUST only be imported in API routes (server-side). Never import them in client components.

---

## Project Structure

```
laser-explorer/
├── app/
│   ├── layout.tsx                 # Root layout: dark theme, viewport meta, font imports
│   ├── page.tsx                   # Landing page: links to /explore and /simulate
│   │
│   ├── explore/
│   │   └── page.tsx               # Adapter Explorer page (client component)
│   │
│   ├── simulate/
│   │   └── page.tsx               # DMX Simulator page (client component)
│   │
│   ├── api/
│   │   ├── ports/
│   │   │   └── route.ts           # POST: list serial ports
│   │   ├── probe/
│   │   │   └── route.ts           # POST: try driver on port
│   │   ├── dmx/
│   │   │   ├── send/
│   │   │   │   └── route.ts       # POST: send DMX channel values
│   │   │   └── blackout/
│   │   │       └── route.ts       # POST: all channels to 0
│   │   └── status/
│   │       └── route.ts           # GET: current adapter connection state
│   │
│   ├── components/
│   │   ├── PortList.tsx            # Table of detected serial ports
│   │   ├── DriverProbe.tsx         # Driver test UI with results log
│   │   ├── DMXTestPanel.tsx        # Manual DMX send for hardware verification
│   │   ├── LaserCanvas.tsx         # Canvas-based laser simulator visualization
│   │   ├── ChannelPanel.tsx        # All 29 DMX channel sliders organized by group
│   │   ├── SceneGrid.tsx           # Scene preset buttons
│   │   ├── BeatEngine.tsx          # BPM tap, multiplier, sync toggle
│   │   ├── AudioAnalyzer.tsx       # Mic input, FFT bars
│   │   ├── Slider.tsx              # Reusable range slider component
│   │   ├── PresetButtons.tsx       # Discrete value toggle row
│   │   ├── StatusBadge.tsx         # Connection status indicator
│   │   └── BlackoutButton.tsx      # Floating emergency blackout
│   │
│   └── lib/
│       ├── channels.ts             # DMX channel map constant (29 channels)
│       ├── scenes.ts               # Scene presets with beat maps
│       ├── types.ts                # Shared TypeScript interfaces
│       └── dmx-state.ts            # Server-side singleton for adapter state
│
├── tailwind.config.ts
├── tsconfig.json
├── next.config.ts                  # serverExternalPackages: ['serialport', 'enttec-open-dmx-usb']
└── package.json
```

---

## Critical Next.js Configuration

### next.config.ts

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['serialport', 'enttec-open-dmx-usb'],
  // Required: these are native Node modules with C++ bindings.
  // Without this, Next.js tries to bundle them and fails.
};

export default nextConfig;
```

### Server-Side Singleton Pattern

Native serial port connections must persist across API route invocations. Use a module-level singleton:

```typescript
// app/lib/dmx-state.ts
// This file is ONLY imported by API routes (server-side)

import { SerialPort } from 'serialport';

interface AdapterState {
  connected: boolean;
  simulation: boolean;
  driver: string | null;
  port: string | null;
  adapterName: string;
  error: string | null;
  serialPort: any | null;      // active serial port instance
  dmxBuffer: number[];         // 512 channel values
}

// Module-level state survives across API calls in the same server process
let state: AdapterState = {
  connected: false,
  simulation: true,
  driver: null,
  port: null,
  adapterName: 'Not connected',
  error: null,
  serialPort: null,
  dmxBuffer: new Array(513).fill(0),  // DMX is 1-indexed, slot 0 is start code
};

export function getState(): AdapterState { return state; }
export function setState(updates: Partial<AdapterState>) { state = { ...state, ...updates }; }
export function getDmxBuffer(): number[] { return state.dmxBuffer; }
export function setDmxChannels(channels: Record<number, number>) {
  Object.entries(channels).forEach(([ch, val]) => {
    const idx = parseInt(ch);
    if (idx >= 1 && idx <= 512) {
      state.dmxBuffer[idx] = Math.max(0, Math.min(255, val));
    }
  });
}
```

---

## API Routes Specification

### POST /api/ports

Scans for all serial ports and categorizes them.

**Request:** Empty body or `{}`

**Response:**
```typescript
interface PortsResponse {
  ports: {
    path: string;
    manufacturer: string | null;
    vendorId: string | null;
    productId: string | null;
    serialNumber: string | null;
    category: 'ftdi' | 'soundswitch' | 'unknown';
    categoryReason: string;
  }[];
  summary: {
    total: number;
    ftdi: number;
    soundswitch: number;
    unknown: number;
  };
}
```

**Implementation:**

```typescript
import { SerialPort } from 'serialport';

export async function POST() {
  const ports = await SerialPort.list();

  const classified = ports.map(p => {
    const mfr = (p.manufacturer || '').toLowerCase();
    const vid = (p.vendorId || '').toLowerCase();
    const prod = (p.product || p.pnpId || '').toLowerCase();

    let category: 'ftdi' | 'soundswitch' | 'unknown' = 'unknown';
    let categoryReason = 'No matching identifiers';

    if (vid === '0403' || mfr.includes('ftdi') || mfr.includes('future technology')) {
      category = 'ftdi';
      categoryReason = vid === '0403' ? 'FTDI vendor ID (0x0403)' : `Manufacturer: ${p.manufacturer}`;
    } else if (mfr.includes('soundswitch') || mfr.includes('inmusic') || mfr.includes('denon') || prod.includes('soundswitch')) {
      category = 'soundswitch';
      categoryReason = `Identified as SoundSwitch hardware: ${p.manufacturer || p.product || p.pnpId}`;
    }

    return {
      path: p.path,
      manufacturer: p.manufacturer || null,
      vendorId: p.vendorId || null,
      productId: p.productId || null,
      serialNumber: p.serialNumber || null,
      category,
      categoryReason,
    };
  });

  return Response.json({
    ports: classified,
    summary: {
      total: classified.length,
      ftdi: classified.filter(p => p.category === 'ftdi').length,
      soundswitch: classified.filter(p => p.category === 'soundswitch').length,
      unknown: classified.filter(p => p.category === 'unknown').length,
    },
  });
}
```

### POST /api/probe

Attempts to open a serial port with a specific driver/baud rate and optionally send a DMX test frame.

**Request:**
```typescript
interface ProbeRequest {
  port: string;           // serial port path e.g. "/dev/tty.usbmodem14101"
  method: 'enttec-open' | 'enttec-pro' | 'raw-serial' | 'raw-250k';
  testFrame?: boolean;    // if true, send a test DMX frame (CH1=255, others=0)
}
```

**Response:**
```typescript
interface ProbeResponse {
  success: boolean;
  method: string;
  port: string;
  details: string;          // human-readable result
  error: string | null;
  timing: number;           // ms elapsed
  portInfo: {               // what the OS reports about this port once opened
    baudRate?: number;
    dataBits?: number;
    stopBits?: number;
    parity?: string;
  } | null;
}
```

**Implementation for each method:**

#### Method: `enttec-open`

Uses the `enttec-open-dmx-usb` npm package. This is the standard Open DMX protocol: open serial at 250000 baud, 8N2, send break, then 513 bytes (start code + 512 channels) at ~44Hz.

```typescript
import { EnttecOpenDMXUSBDevice } from 'enttec-open-dmx-usb';

// Try to instantiate with the given port path
const device = new EnttecOpenDMXUSBDevice(portPath);
// If this doesn't throw, the port opened successfully
if (testFrame) {
  device.setChannels({ 1: 255 }); // master dimmer on
}
```

#### Method: `enttec-pro`

The Enttec Pro protocol uses a framed packet format over serial. Unlikely to work with SoundSwitch but worth trying.

```typescript
// Use the dmx npm package's enttec-usb-dmx-pro driver
import DMX from 'dmx';
const dmx = new DMX();
const universe = dmx.addUniverse('test', 'enttec-usb-dmx-pro', portPath);
if (testFrame) {
  universe.update({ 1: 255 });
}
```

#### Method: `raw-serial`

Opens the port as a raw serial connection at 250000 baud, 8N2 (DMX512 spec), and writes a raw DMX frame manually. This bypasses any driver abstraction and tests whether the hardware will accept raw serial data.

```typescript
import { SerialPort } from 'serialport';

const port = new SerialPort({
  path: portPath,
  baudRate: 250000,
  dataBits: 8,
  stopBits: 2,
  parity: 'none',
  autoOpen: false,
});

await new Promise<void>((resolve, reject) => {
  port.open((err) => err ? reject(err) : resolve());
});

if (testFrame) {
  // DMX frame: break (low for 88µs), mark-after-break (high for 8µs),
  // then start code (0x00) + 512 channel bytes
  // The break is handled by sending a 0x00 at a lower baud rate,
  // or by using port.set({ brk: true }) then port.set({ brk: false })
  
  port.set({ brk: true });
  await sleep(1); // ~1ms break (spec minimum 88µs)
  port.set({ brk: false });
  await sleep(0.1); // mark after break
  
  const frame = Buffer.alloc(513, 0); // start code + 512 channels
  frame[1] = 255; // CH1 = master dimmer full
  port.write(frame);
}
```

#### Method: `raw-250k`

Same as raw-serial but tries to detect if the port even supports 250000 baud (some USB-serial chips don't). Opens, queries, closes.

```typescript
// Same as raw-serial but focused on whether 250k baud is accepted
const port = new SerialPort({
  path: portPath,
  baudRate: 250000,
  dataBits: 8,
  stopBits: 2,
  parity: 'none',
  autoOpen: false,
});

try {
  await new Promise<void>((resolve, reject) => {
    port.open((err) => err ? reject(err) : resolve());
  });
  // If we got here, the port accepted 250000 baud
  details = 'Port opened at 250000 baud 8N2 — DMX-compatible!';
  success = true;
} catch (err) {
  details = `Port rejected 250000 baud: ${err.message}`;
  success = false;
} finally {
  if (port.isOpen) port.close();
}
```

### POST /api/dmx/send

Sends DMX channel values through the currently connected adapter. Used by both the explorer (test frame) and the simulator (live output).

**Request:**
```typescript
interface DMXSendRequest {
  channels: Record<number, number>;  // { 1: 255, 2: 200, 5: 128, ... }
}
```

**Response:**
```typescript
interface DMXSendResponse {
  success: boolean;
  simulation: boolean;     // true if no hardware — values accepted but not output
  channelsSent: number;    // count of channels updated
}
```

Uses the singleton state from `dmx-state.ts`. Always updates the internal buffer. If a real adapter is connected, also writes to hardware.

### POST /api/dmx/blackout

Convenience endpoint. Sets all 512 channels to 0 and writes to hardware if connected.

### GET /api/status

Returns the current adapter connection state from the singleton.

**Response:**
```typescript
interface StatusResponse {
  connected: boolean;
  simulation: boolean;
  driver: string | null;
  port: string | null;
  adapterName: string;
  error: string | null;
}
```

---

## Page 1: Adapter Explorer (`/explore`)

### Purpose

Give the user a clear, step-by-step interface to:
1. See what USB serial devices are connected
2. Identify the SoundSwitch adapter
3. Try multiple communication methods against it
4. See detailed results of each attempt
5. If something works, send a test DMX frame and verify the laser responds

### Layout

Full-width, dark theme, designed to be used on a laptop screen (not phone-optimized — the user needs to see their USB ports).

#### Section 1: Port Scanner

- "Scan Ports" button that calls `POST /api/ports`
- Results displayed in a table:

| Port | VID:PID | Manufacturer | Category | Status |
|------|---------|-------------|----------|--------|
| /dev/tty.usbmodem14101 | 0403:6001 | FTDI | ✅ FTDI | — |
| /dev/tty.usbmodem14201 | 1234:5678 | inMusic | ⚠️ SoundSwitch | — |

- Each row is clickable/selectable
- Category column is color-coded: green for FTDI, yellow for SoundSwitch, gray for unknown

#### Section 2: Driver Probe

Only active after a port is selected from the table above.

- Four buttons, one per probe method:
  - **[Try Enttec Open]** — `enttec-open`
  - **[Try Enttec Pro]** — `enttec-pro`  
  - **[Try Raw Serial 250k]** — `raw-250k`
  - **[Try Raw DMX Frame]** — `raw-serial` with `testFrame: true`
- A **"Run All"** button that executes all four sequentially
- Results appear in a scrollable log panel below, newest at top:

```
[12:34:05] Probing /dev/tty.usbmodem14201 with enttec-open...
[12:34:05] ✗ FAILED (52ms): Error: Could not open port — access denied
[12:34:06] Probing /dev/tty.usbmodem14201 with raw-250k...
[12:34:06] ✓ SUCCESS (23ms): Port opened at 250000 baud 8N2 — DMX-compatible!
[12:34:07] Probing /dev/tty.usbmodem14201 with raw-serial (test frame)...
[12:34:07] ✓ SUCCESS (31ms): Wrote 513-byte DMX frame — check if laser CH1 lit up!
```

- Each log entry is color-coded: green for success, red for failure, yellow for warnings
- Success entries are expandable to show port info (baud, data bits, etc.)

#### Section 3: DMX Test Panel

Only active after a successful probe.

- "Connected to: /dev/tty.usbmodem14201 via raw-serial" status bar
- **CH1 Master Dimmer** slider (0-255) with a large "SEND" button
- **CH2 Mode** preset buttons: AUTO (25) / SOUND (75) / MANUAL (225)
- **CH5/6/7 RGB** sliders
- A "Blackout" button
- Live feedback: "Last sent: CH1=255 CH2=225 — 2ms ago"

This is intentionally minimal — just enough to verify the hardware chain works. The full controller UI is in the simulator.

#### Section 4: Verdict Panel

Always visible at the bottom. Summarizes what happened:

- If a probe succeeded: green box — "✅ Your SoundSwitch adapter works! Method: raw-serial @ /dev/tty.usbmodem14201. You can use this for the full controller."
- If all probes failed: red box — "❌ The SoundSwitch adapter could not be driven by any generic method. It requires a proprietary protocol. Recommended: buy a generic FTDI USB-DMX cable ($15 on Amazon, search 'USB DMX 512 FTDI FT232'). Your full controller UI will work in simulation mode in the meantime."
- If no ports found: gray box — "🔌 No USB serial devices detected. Plug in your DMX adapter and click Scan."

---

## Page 2: DMX Simulator (`/simulate`)

### Purpose

A fully functional laser controller that visualizes what the laser would do, regardless of whether hardware is connected. If hardware IS connected (from a successful probe on the explorer page), it simultaneously outputs real DMX.

### Layout

Phone-optimized (max-width 480px, centered). Same structure as the main controller spec (see the full LASER-DMX-CONTROLLER-SPEC.md), but with a laser visualization canvas added at the top.

#### Laser Visualization Canvas

A `<canvas>` element (full-width, 200px tall) that renders a simulated laser projection:

**What to visualize based on DMX channel values:**

| Channel(s) | Visual Effect |
|-------------|--------------|
| CH1 (dimmer) | Global opacity/brightness of all drawn elements |
| CH3 (pattern) | Cycle through geometric shapes: circle, triangle, square, star, spiral, line grid, etc. Map 0-255 to ~16 shape variations |
| CH4 (strobe) | When >10, flash the canvas between visible and black at a rate proportional to value |
| CH5/6/7 (RGB) | Color of drawn shapes. Mix into a single RGB fill/stroke color |
| CH8 (color preset) | Override RGB with preset colors when active |
| CH10/12 (X/Y pos) | Translate the drawn shape on the canvas. Map 0-255 to canvas coordinates |
| CH14 (zoom) | Scale the drawn shape. 0=tiny, 255=fills canvas |
| CH17 (Z angle) | Rotate the drawn shape |
| CH19/20 (auto move) | Animate position automatically (sine wave drift) |
| CH21 (auto zoom) | Animate scale (pulse, grow, shrink) |
| CH24 (Z rotate) | Animate rotation continuously |
| CH26/27 (X/Y wave) | Apply sine wave distortion to shape vertices |
| CH29 (display FX) | 0-63: solid lines, 64-127: brighter glow, 128-191: dashed lines, 192-255: dots only |

**Rendering approach:**

- Black background (simulating a dark room)
- Shapes drawn with `strokeStyle` set to the RGB color, with `shadowBlur` and `shadowColor` for laser glow effect
- Line width ~2px with `globalCompositeOperation: 'lighter'` for additive blending (simulates laser brightness stacking)
- Render at 60fps using `requestAnimationFrame`
- Each frame reads the current DMX channel state and computes transforms

**Pattern library (mapped to CH3 value):**

Divide 0-255 into ~16 bands of 16 values each. Each band selects a shape drawn with Canvas path operations:

| CH3 Range | Shape |
|-----------|-------|
| 0-15 | Circle |
| 16-31 | Dotted circle |
| 32-47 | Horizontal line |
| 48-63 | Vertical line |
| 64-79 | Cross (+) |
| 80-95 | X shape |
| 96-111 | Triangle |
| 112-127 | Square |
| 128-143 | Star (5-point) |
| 144-159 | Spiral |
| 160-175 | Wave line |
| 176-191 | Grid (4×4) |
| 192-207 | Concentric circles |
| 208-223 | Lissajous curve |
| 224-239 | Fan beams |
| 240-255 | Random scatter dots |

These don't need to match the real laser's 160 patterns exactly — they're a simulation to give visual feedback.

#### Channel Panel (below canvas)

Tabbed interface, identical to the full controller spec:

- **SCENES** tab: 6 scene preset buttons + master dim/mode/pattern/strobe sliders
- **COLOR** tab: RGB sliders, color presets, quick palette
- **MOTION** tab: position, zoom, rotation, auto-move macros
- **FX** tab: waves, draw macros, display effects
- **SETUP** tab: connection status, adapter info (pulled from `/api/status`)

Every slider change:
1. Updates local React state immediately (for responsive UI)
2. Calls `POST /api/dmx/send` to update the server-side buffer
3. If hardware is connected, the API route writes to the real adapter
4. The canvas re-renders on the next animation frame using local state

#### Beat Engine & Audio Analyzer

Client-side only (no API calls). Same implementation as the full controller spec:

- Tap tempo: store last 8 taps, compute average interval
- BPM range: 40-300
- Multiplier: ÷4, ÷2, ×1, ×2, ×4
- Audio: `getUserMedia` → `AudioContext` → `AnalyserNode` → bass/mid/high/rms at 30fps
- Beat sync: when enabled, modulate channels per the active scene's `beatMap` at 30fps
- Audio bars: 4 vertical bars in the header

#### Blackout Button

Floating at bottom center, always visible. Toggles CH1 between 0 and 255. Also calls `POST /api/dmx/blackout` when activating blackout.

---

## DMX Channel Map (for `channels.ts`)

Identical to the full controller spec. Here's the compact definition:

```typescript
export interface ChannelDef {
  ch: number;
  key: string;
  label: string;
  min: number;
  max: number;
  color?: string;
  presets?: { label: string; range: [number, number] }[];
  group: 'core' | 'color' | 'position' | 'automation' | 'wave' | 'display';
}

export const CHANNELS: ChannelDef[] = [
  // Core
  { ch: 1,  key: 'dimming',      label: 'Master Dim',    min: 0, max: 255, group: 'core' },
  { ch: 2,  key: 'mode',         label: 'Mode',          min: 0, max: 255, group: 'core',
    presets: [
      { label: 'AUTO', range: [0, 49] },
      { label: 'SOUND', range: [50, 99] },
      { label: 'SEQUENCE', range: [100, 149] },
      { label: 'SINGLE', range: [150, 199] },
      { label: 'MANUAL', range: [200, 255] },
    ] },
  { ch: 3,  key: 'program',      label: 'Pattern',       min: 0, max: 255, group: 'core' },
  { ch: 4,  key: 'strobe',       label: 'Strobe',        min: 0, max: 255, group: 'core' },

  // Color
  { ch: 5,  key: 'red',          label: 'Red',           min: 0, max: 255, color: '#ff2222', group: 'color' },
  { ch: 6,  key: 'green',        label: 'Green',         min: 0, max: 255, color: '#22ff44', group: 'color' },
  { ch: 7,  key: 'blue',         label: 'Blue',          min: 0, max: 255, color: '#4488ff', group: 'color' },
  { ch: 8,  key: 'colorPreset',  label: 'Color Preset',  min: 0, max: 255, group: 'color',
    presets: [
      { label: 'WHITE', range: [0, 16] },
      { label: 'RED', range: [17, 33] },
      { label: 'GREEN', range: [34, 50] },
      { label: 'BLUE', range: [51, 67] },
      { label: 'YELLOW', range: [68, 84] },
      { label: 'PURPLE', range: [85, 101] },
      { label: 'CYAN', range: [102, 118] },
      { label: '7-COLOR', range: [153, 169] },
      { label: 'SND CLR', range: [238, 255] },
    ] },

  // Position & Geometry
  { ch: 9,  key: 'boundary',     label: 'Boundary FX',   min: 0, max: 255, group: 'position',
    presets: [
      { label: 'CUT', range: [0, 49] },
      { label: 'WRAP', range: [50, 99] },
      { label: 'BOUNCE', range: [100, 149] },
      { label: 'COMPRESS', range: [150, 255] },
    ] },
  { ch: 10, key: 'xPos',         label: 'X Position',    min: 0, max: 255, group: 'position' },
  { ch: 11, key: 'xFine',        label: 'X Fine',        min: 0, max: 255, group: 'position' },
  { ch: 12, key: 'yPos',         label: 'Y Position',    min: 0, max: 255, group: 'position' },
  { ch: 13, key: 'yFine',        label: 'Y Fine',        min: 0, max: 255, group: 'position' },
  { ch: 14, key: 'zoom',         label: 'Zoom',          min: 0, max: 255, group: 'position' },
  { ch: 15, key: 'xAngle',       label: 'X Angle',       min: 0, max: 255, group: 'position' },
  { ch: 16, key: 'yAngle',       label: 'Y Angle',       min: 0, max: 255, group: 'position' },
  { ch: 17, key: 'zAngle',       label: 'Z Rotation',    min: 0, max: 255, group: 'position' },
  { ch: 18, key: 'drawing',      label: 'Draw FX',       min: 0, max: 255, group: 'position' },

  // Automation Macros
  { ch: 19, key: 'xMove',        label: 'X Auto Move',   min: 0, max: 255, group: 'automation',
    presets: [
      { label: 'MANUAL', range: [0, 1] },
      { label: 'R→L', range: [2, 100] },
      { label: 'L→R', range: [101, 200] },
      { label: 'BOUNCE', range: [201, 245] },
      { label: 'SOUND', range: [246, 255] },
    ] },
  { ch: 20, key: 'yMove',        label: 'Y Auto Move',   min: 0, max: 255, group: 'automation',
    presets: [
      { label: 'MANUAL', range: [0, 1] },
      { label: 'B→T', range: [2, 100] },
      { label: 'T→B', range: [101, 200] },
      { label: 'BOUNCE', range: [201, 245] },
      { label: 'SOUND', range: [246, 255] },
    ] },
  { ch: 21, key: 'autoZoom',     label: 'Auto Zoom',     min: 0, max: 255, group: 'automation',
    presets: [
      { label: 'MANUAL', range: [0, 10] },
      { label: 'GROW', range: [11, 80] },
      { label: 'SHRINK', range: [81, 160] },
      { label: 'PULSE', range: [161, 255] },
    ] },
  { ch: 22, key: 'xFlip',        label: 'X Auto Flip',   min: 0, max: 255, group: 'automation' },
  { ch: 23, key: 'yFlip',        label: 'Y Auto Flip',   min: 0, max: 255, group: 'automation' },
  { ch: 24, key: 'zRotate',      label: 'Z Auto Rotate', min: 0, max: 255, group: 'automation' },
  { ch: 25, key: 'drawMacro',    label: 'Draw Macro',    min: 0, max: 255, group: 'automation',
    presets: [
      { label: 'MANUAL', range: [0, 74] },
      { label: 'FADE IN', range: [75, 104] },
      { label: 'FADE OUT', range: [105, 144] },
      { label: 'LOOP', range: [145, 184] },
      { label: 'E2E +', range: [185, 224] },
      { label: 'E2E -', range: [225, 255] },
    ] },

  // Wave & Display
  { ch: 26, key: 'xWave',        label: 'X Wave',        min: 0, max: 255, group: 'wave',
    presets: [
      { label: 'OFF', range: [0, 10] },
      { label: 'SMALL', range: [11, 69] },
      { label: 'MED', range: [70, 129] },
      { label: 'LARGE', range: [130, 189] },
      { label: 'MAX', range: [190, 255] },
    ] },
  { ch: 27, key: 'yWave',        label: 'Y Wave',        min: 0, max: 255, group: 'wave',
    presets: [
      { label: 'OFF', range: [0, 10] },
      { label: 'SMALL', range: [11, 69] },
      { label: 'MED', range: [70, 129] },
      { label: 'LARGE', range: [130, 189] },
      { label: 'MAX', range: [190, 255] },
    ] },
  { ch: 28, key: 'waveSize',     label: 'Wave Size',     min: 0, max: 255, group: 'wave' },
  { ch: 29, key: 'displayFx',    label: 'Display FX',    min: 0, max: 255, group: 'display',
    presets: [
      { label: 'NORMAL', range: [0, 63] },
      { label: 'GLOW', range: [64, 127] },
      { label: 'SEGMENT', range: [128, 191] },
      { label: 'DOTS', range: [192, 255] },
    ] },
];
```

---

## Scene Presets (for `scenes.ts`)

```typescript
export interface Scene {
  name: string;
  description: string;
  values: Record<string, number>;
  beatMap: Record<string, number>;
}

export const SCENES: Scene[] = [
  {
    name: '🔥 DROP',
    description: 'Full power, zoom pulse, fast rotation',
    values: { dimming: 255, mode: 225, program: 0, red: 255, green: 40, blue: 0, autoZoom: 220, zRotate: 200, xWave: 140, yWave: 140, displayFx: 0 },
    beatMap: { zoom: 0.8, red: 0.3, strobe: 0.5 },
  },
  {
    name: '🌊 CHILL',
    description: 'Slow drift, cool colors, gentle waves',
    values: { dimming: 180, mode: 225, program: 30, red: 0, green: 120, blue: 255, xMove: 60, yMove: 60, autoZoom: 40, zRotate: 80, xWave: 60, yWave: 60, displayFx: 0 },
    beatMap: { blue: 0.4, yPos: 0.2 },
  },
  {
    name: '⚡ STROBE',
    description: 'Hard strobe, pattern cycling',
    values: { dimming: 255, mode: 120, strobe: 180, red: 255, green: 255, blue: 255, autoZoom: 200, zRotate: 240, displayFx: 128 },
    beatMap: { strobe: 0.9, program: 0.6, xPos: 0.4 },
  },
  {
    name: '🌀 VORTEX',
    description: 'Spinning with wave distortion',
    values: { dimming: 240, mode: 225, program: 80, red: 180, green: 0, blue: 255, zRotate: 255, xWave: 200, yWave: 200, waveSize: 128, autoZoom: 180, displayFx: 0 },
    beatMap: { zAngle: 0.7, waveSize: 0.5, zoom: 0.3 },
  },
  {
    name: '💎 CRYSTAL',
    description: 'Dot display, bouncing geometry',
    values: { dimming: 255, mode: 225, program: 10, red: 100, green: 255, blue: 255, boundary: 120, xMove: 220, yMove: 220, autoZoom: 160, displayFx: 210 },
    beatMap: { zoom: 0.6, xPos: 0.4, green: 0.3 },
  },
  {
    name: '🎵 FOLLOW',
    description: 'Sound-reactive mode, laser handles sync',
    values: { dimming: 255, mode: 75, colorPreset: 245, xMove: 250, yMove: 250, autoZoom: 200, displayFx: 0 },
    beatMap: {},
  },
];
```

---

## UI Design Guidelines

- **Dark theme throughout**: background `#06060e`, cards `#0d0d1a`, borders `#1a1a2e`
- **Accent colors**: green `#00ffaa` for success/connected, red `#ff4444` for errors/blackout, orange `#ffaa00` for warnings, blue `#44aaff` for info
- **Monospace for all data values**: port paths, channel numbers, hex IDs, timing
- **System font stack for UI text**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- **Mobile viewport**: `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />`
- **Slider thumb**: large enough for touch (min 24px height)
- **All buttons**: min 44px touch target
- **Transitions**: 150ms on all interactive elements
- **Laser canvas glow**: use `shadowBlur: 15, shadowColor: currentRGBColor` for neon laser aesthetic

---

## Build & Run

```bash
npx create-next-app@latest laser-explorer --typescript --tailwind --app
cd laser-explorer
npm install serialport enttec-open-dmx-usb
```

Add to `next.config.ts`:
```typescript
const nextConfig = {
  serverExternalPackages: ['serialport', 'enttec-open-dmx-usb'],
};
```

```bash
npm run dev
# Open http://localhost:3000/explore on laptop to probe adapter
# Open http://localhost:3000/simulate on phone for controller + simulator
```

---

## Testing Checklist

### Adapter Explorer
- [ ] Port scan returns all connected USB serial devices
- [ ] SoundSwitch adapter is correctly categorized (if it appears as a serial device)
- [ ] Each probe method runs without crashing the server (failures are caught and reported)
- [ ] Probe results show clear success/failure with timing and details
- [ ] If raw-serial succeeds, the test DMX frame is sent and the laser responds (CH1=255)
- [ ] Verdict panel correctly summarizes the overall result
- [ ] If no ports found, clear message displayed

### Simulator
- [ ] Canvas renders shapes that respond to channel changes
- [ ] Pattern slider (CH3) cycles through different shapes
- [ ] RGB sliders change the shape color in real time
- [ ] X/Y position sliders move the shape on canvas
- [ ] Zoom slider scales the shape
- [ ] Z rotation slider rotates the shape
- [ ] Wave channels distort the shape vertices
- [ ] Strobe channel flashes the canvas
- [ ] Display FX changes rendering style (solid/glow/dashed/dots)
- [ ] Dimmer channel controls overall opacity
- [ ] Scene presets apply and canvas updates immediately
- [ ] Beat sync modulates channels visibly
- [ ] Tap tempo detects BPM from 4+ taps
- [ ] Mic audio analyzer shows frequency bars
- [ ] Blackout button kills the canvas and sends blackout to API
- [ ] If hardware is connected (from explorer), DMX values are simultaneously output

### Integration
- [ ] Navigating between /explore and /simulate preserves adapter connection state
- [ ] A successful probe on /explore makes /simulate output real DMX
- [ ] Server doesn't crash when adapter is unplugged mid-session
