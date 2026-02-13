# Laser Controller

A web-based DMX controller for the **U'King ZQ05031 RGB Animation Laser**, built with Next.js. Features a music-reactive show mode that syncs laser effects to audio input via real-time beat detection, a scene fuzzer for random pattern generation, and a full channel editor for manual control.

Connects to the laser via a **SoundSwitch Micro DMX** USB adapter using a reverse-engineered JLS1 protocol.

## Features

- **Channel Editor** -- Direct control of all 34 DMX channels with preset buttons and live hardware output at 30Hz
- **Scene Library** -- 8 built-in presets plus save/load custom scenes to localStorage
- **Scene Fuzzer** -- Structured random scene generator with configurable pattern pools, color modes, and effect intensity
- **Show Mode** -- Music-reactive light show driven by microphone input:
  - Spectral flux beat detection (Web Audio API)
  - Per-band energy analysis (bass / mids / treble) with adjustable gain
  - Punch/momentum spring-damper physics model for smooth dynamics
  - Probabilistic scene advancement synced to musical phrases
  - Beat-synced color temperature drift through color families
  - Attack/release envelope controls
  - Scene crossfade with mode-aware channel snapping
  - Channel locks to freeze specific parameters
  - Show recording and playback
- **LAN Access** -- Run on a PC, control from your phone on the same WiFi

## Hardware

### Laser Fixture

**U'King ZQ05031 RGB Animation Laser** in 34-channel extended DMX mode:

| Channels | Function |
|----------|----------|
| CH1 | Laser ON/OFF (Auto / Sound / Save) |
| CH2 | Pattern Size (Cross / Reentry / Blank) |
| CH3 | Group Select (Beams 0-223 / Animations 244-255) |
| CH4 | Pattern Selection (~140 beams + ~20 animations) |
| CH5 | Zoom (Static / Zoom Out / Zoom In / In-Out / Rotate) |
| CH6 | Rotation (Static / 2-Circle / 1-Circle / CW / CCW) |
| CH7-8 | Pan / Tilt movement |
| CH9-10 | X/Y distortion |
| CH11-12 | Fixed color / Color change |
| CH13 | Dots (Original / No Dots / Sweep) |
| CH14-15 | Drawing parameters |
| CH16 | Twist |
| CH17 | Grating |
| CH18-34 | Group B (mirrors CH1-17 for second laser group) |

### DMX Adapter

**SoundSwitch Micro DMX** (USB VID `0x15E4`, PID `0x0053`)

This is NOT an FTDI device. It uses a custom STM32-based firmware with a proprietary **JLS1 protocol** over USB bulk transfers. The protocol was reverse-engineered by sniffing the SoundSwitch desktop app via lldb.

Key protocol details:
- USB Full Speed (12 Mbps), single OUT endpoint (EP 0x01)
- Packet format: `[magic "sTRt" 0x73545274] [cmd LE16] [len LE16] [payload]`
- Must call `setConfiguration(1)` before `claimInterface(0)`
- DMX frames: 522-byte packets at 40Hz (8-byte header + 514-byte payload)
- DMX channels start at payload offset 2

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **SoundSwitch Micro DMX** adapter plugged in via USB
- **macOS** or **Linux** (Windows may work but USB driver support is untested)

### Install & Run

```bash
git clone https://github.com/asoronow/laser-controller.git
cd laser-controller
npm install
npm run dev
```

Open [http://localhost:3000/simulate](http://localhost:3000/simulate) in your browser.

### Production Build

```bash
npm run build
npm run start
```

### LAN Access (Control from Phone)

Use the included start script to bind to all network interfaces and display your LAN URL:

```bash
./start.sh
```

Or on Windows:
```
start.bat
```

This will print something like:
```
  Laser Controller
  Local:  http://localhost:3000/simulate
  LAN:    http://192.168.1.42:3000/simulate

  Open the LAN URL on your phone (same WiFi)
```

You can also use `npm run serve` to start on all interfaces without the auto-detection.

## Usage

### Connecting the Laser

1. Plug in the SoundSwitch Micro DMX adapter
2. Go to the **Setup** tab
3. Click **Probe** to detect and initialize the device
4. Once connected, toggle **Send DMX** to start outputting at 30Hz

### Tabs

**Scenes** -- Browse and apply preset scenes. Click a scene to load its channel values. Save custom scenes from the Channels or Fuzzer tabs.

**Channels** -- Direct slider control of all 34 DMX channels. Each channel shows its preset ranges (e.g., Zoom: Static / Zoom Out / Zoom In / In-Out). Click Save to store the current configuration as a named scene.

**Fuzzer** -- Generate random scenes with structured constraints:
- **Pattern Pool**: Filter by category (geometry, stars, waves, concentric, dots, compound, novelty, animations)
- **Color Mode**: Warm / Cool / Cycling / Any
- **Effect Intensity**: Probability of activating zoom, distortion, drawing, twist, grating
- **Movement**: Probability of dynamic pan/tilt
- **Mutate**: Small perturbations of the current scene for iterative refinement

**Show** -- Music-reactive auto-pilot mode:
- Select **Playlist** (cycle through selected scenes) or **Generate** (random scenes from a pattern pool)
- Adjust beat sensitivity, per-band gains (bass/mids/treble), and BPM multiplier
- Tune **Attack** (0% = punchy snaps, 100% = smooth swells) and **Release** (0% = staccato, 100% = lingering)
- Set **Crossfade** duration for smooth scene transitions
- Choose a style: Pulse (beat-snapped), Sweep (smooth sinusoidal), Chaos (multi-frequency)
- Lock individual channels to prevent the effects engine from modifying them
- Record shows for playback

**Setup** -- Device connection, port selection, and DMX test panel.

## Project Structure

```
app/
  api/                    # Server-side API routes (Node.js)
    probe/                # Device detection & JLS1 initialization
    dmx/send/             # Send DMX frames to hardware
    dmx/blackout/         # Zero all channels
    status/               # Connection status
    usb/                  # USB device enumeration
    ports/                # Serial port enumeration
  components/
    ShowMode.tsx           # Music-reactive show orchestrator
    ChannelGrid.tsx        # DMX channel slider grid
    SceneFuzzer.tsx        # Random scene generator UI
    SceneLibrary.tsx       # Scene browser with save/load
    ShowTimeline.tsx       # Real-time audio waveform display
    DriverProbe.tsx        # Hardware connection UI
    ...
  lib/
    audio-engine.ts        # Web Audio beat detection (spectral flux)
    show-effects.ts        # Effects engine (punch, momentum, breakdown)
    scene-fuzzer.ts        # Structured random scene generation
    scenes.ts              # 8 built-in scene presets
    channels.ts            # 34-channel DMX definitions with presets
    soundswitch-driver.ts  # JLS1 USB protocol driver
    dmx-state.ts           # Global DMX buffer (process memory)
    ...
  simulate/page.tsx        # Main controller page
  explore/page.tsx         # Device exploration/debugging page
scripts/                   # Reverse engineering & debug scripts
  sniff.sh                 # lldb-based USB packet sniffer
  replay-exact.mjs         # Byte-level protocol replay test
  test-offset.mjs          # DMX payload offset probe
  ...
```

## How the Show Mode Works

The show mode runs three concurrent systems:

1. **Audio Engine** (Web Audio API): Captures microphone input, computes per-band energy (bass / mids / treble) via FFT, and detects beats using spectral flux onset detection. Beats are classified by relative strength (weak / normal / strong).

2. **Effects Engine** (60fps requestAnimationFrame): Computes channel overrides every frame based on audio state. Uses a spring-damper momentum model that builds during loud sections and overshoots on drops. Punch level snaps on beats and decays exponentially. Beat-synced phases (using the golden ratio for non-repeating offsets) drive rotation direction, movement patterns, and effect modulation.

3. **Beat Callbacks**: On each detected beat, immediately snap rotation speed, zoom level, and color based on beat strength. Strong beats get full treatment (color family drift, zoom punch, rotation bump); weak beats get subtle accents.

A breakdown detector watches for sustained silence (~1.5s with bass below 10%) and strips effects down to gentle ambient drift, then recovers when energy returns.

## License

MIT
