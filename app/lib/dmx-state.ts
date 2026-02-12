import type { AdapterState } from "./types";

const initialState: AdapterState = {
  connected: false,
  simulation: true,
  driver: null,
  port: null,
  adapterName: "Not connected",
  error: null,
  serialPort: null,
  dmxBuffer: new Array(513).fill(0), // DMX is 1-indexed, slot 0 is start code
};

// Attach to globalThis so state survives HMR during development
const globalForDmx = globalThis as unknown as { __dmxState: AdapterState };
if (!globalForDmx.__dmxState) {
  globalForDmx.__dmxState = { ...initialState };
}

export function getState(): AdapterState {
  return globalForDmx.__dmxState;
}

export function setState(updates: Partial<AdapterState>) {
  globalForDmx.__dmxState = { ...globalForDmx.__dmxState, ...updates };
}

export function getDmxBuffer(): number[] {
  return globalForDmx.__dmxState.dmxBuffer;
}

export function setDmxChannels(channels: Record<number, number>) {
  const buf = globalForDmx.__dmxState.dmxBuffer;
  for (const [ch, val] of Object.entries(channels)) {
    const idx = parseInt(ch);
    if (idx >= 1 && idx <= 512) {
      buf[idx] = Math.max(0, Math.min(255, val));
    }
  }
}
