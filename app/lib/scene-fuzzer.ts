/**
 * Scene Fuzzer — structured random generation of visually pleasing DMX scenes
 *
 * Generates scenes that respect DMX channel semantics (mode ranges, valid
 * combinations) rather than picking arbitrary 0-255 values. Supports
 * mutation of existing scenes for iterative refinement.
 */

import type { Scene } from "./scenes";

// Pattern pools use numeric ranges only — the manual provides no pattern names
export type PatternPool =
  | "all"
  | "beams-low"
  | "beams-mid"
  | "beams-high"
  | "animations";

export type ColorMode = "warm" | "cool" | "cycling" | "any";

export interface FuzzConfig {
  patternPool: PatternPool;
  effectIntensity: number; // 0-1, probability of activating effect channels
  movementIntensity: number; // 0-1, probability of dynamic movement modes
  colorMode: ColorMode;
}

export const DEFAULT_FUZZ_CONFIG: FuzzConfig = {
  patternPool: "all",
  effectIntensity: 0.4,
  movementIntensity: 0.3,
  colorMode: "any",
};

// ── Pattern pools: map pool names to [groupSelect, patternRange] ──

interface PatternRange {
  groupSelect: number; // 0 for beams (Group 1), 250 for animations (Group 0)
  min: number;
  max: number;
}

const PATTERN_POOLS: Record<PatternPool, PatternRange[]> = {
  "beams-low": [{ groupSelect: 0, min: 0, max: 84 }],
  "beams-mid": [{ groupSelect: 0, min: 85, max: 169 }],
  "beams-high": [{ groupSelect: 0, min: 170, max: 255 }],
  animations: [{ groupSelect: 250, min: 0, max: 255 }],
  all: [
    { groupSelect: 0, min: 0, max: 255 },
    { groupSelect: 250, min: 0, max: 255 },
  ],
};

// ── Color options by mode ──

const COLOR_OPTIONS: Record<ColorMode, number[]> = {
  warm: [8, 16, 48], // red, yellow, pink
  cool: [24, 32, 40], // green, cyan, blue
  cycling: [64, 96, 128, 160, 192, 224], // RGB, YCP, RGBYCPW, 7-color, sine, cosine
  any: [8, 16, 24, 32, 40, 48, 56, 64, 96, 128, 160, 192, 224],
};

// ── Zoom mode weights (mode range start, range size) ──

interface ModeRange {
  start: number;
  size: number;
  weight: number; // relative probability
}

const ZOOM_MODES: ModeRange[] = [
  { start: 50, size: 78, weight: 3 }, // static mid-to-full (50-127)
  { start: 128, size: 32, weight: 1 }, // zoom out
  { start: 160, size: 32, weight: 2 }, // zoom in
  { start: 192, size: 32, weight: 2 }, // in/out
];

const ROTATION_MODES: ModeRange[] = [
  { start: 64, size: 64, weight: 1 }, // static (mid range)
  { start: 192, size: 20, weight: 4 }, // CW slow (192-211)
  { start: 224, size: 20, weight: 2 }, // CCW slow (224-243)
];

// ── Helpers ──

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick(modes: ModeRange[]): number {
  const totalWeight = modes.reduce((s, m) => s + m.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const mode of modes) {
    roll -= mode.weight;
    if (roll <= 0) {
      return mode.start + Math.floor(Math.random() * mode.size);
    }
  }
  const last = modes[modes.length - 1];
  return last.start + Math.floor(Math.random() * last.size);
}

let fuzzCounter = 0;

/** Generate a random scene respecting DMX channel semantics */
export function generateRandomScene(config: FuzzConfig): Scene {
  const { patternPool, effectIntensity, movementIntensity, colorMode } = config;

  // Pick pattern from pool (weighted by range size for variety)
  const ranges = PATTERN_POOLS[patternPool];
  const totalPatterns = ranges.reduce((s, r) => s + (r.max - r.min + 1), 0);
  let roll = Math.random() * totalPatterns;
  let range = ranges[0];
  for (const r of ranges) {
    roll -= r.max - r.min + 1;
    if (roll <= 0) {
      range = r;
      break;
    }
  }
  const pattern = randInt(range.min, range.max);
  const groupSelect = range.groupSelect;

  const values: Record<string, number> = {
    laserOnOff: 100, // sound active mode
    groupSelect,
    pattern,
  };

  // Zoom — weighted by effect intensity
  if (Math.random() < 0.3 + effectIntensity * 0.5) {
    values.zoom = weightedPick(ZOOM_MODES);
  } else {
    values.zoom = randInt(60, 100); // safe static range
  }

  // Rotation — usually on
  if (Math.random() < 0.8) {
    values.rotation = weightedPick(ROTATION_MODES);
  }

  // Color
  values.colorChange = pick(COLOR_OPTIONS[colorMode]);

  // Movement — probability based on movementIntensity
  if (Math.random() < movementIntensity) {
    // Dynamic X movement
    const xMode = pick([128, 160, 192, 224]); // UP, DOWN, LEFT, RIGHT base
    values.xMove = xMode + randInt(0, 20);
  }
  if (Math.random() < movementIntensity * 0.7) {
    // Dynamic Y movement (slightly less likely)
    const yMode = pick([128, 160, 192, 224]);
    values.yMove = yMode + randInt(0, 20);
  }

  // Distortion — low probability, high impact
  if (Math.random() < effectIntensity * 0.4) {
    const xDistMode = pick([128, 160, 192, 224]);
    values.xZoom = xDistMode + randInt(0, 20);
  }
  if (Math.random() < effectIntensity * 0.3) {
    const yDistMode = pick([128, 160, 192, 224]);
    values.yZoom = yDistMode + randInt(0, 20);
  }

  // Drawing2 — dynamic modes add procedural variation
  if (Math.random() < effectIntensity * 0.5) {
    const drawBase = pick([128, 160, 192, 224]); // DYN A, B, C, D
    values.drawing2 = drawBase + randInt(0, 25);
  }

  // Twist — subtle distortion
  if (Math.random() < effectIntensity * 0.35) {
    values.twist = randInt(40, 180);
  }

  // Grating — multiplies pattern into grid
  if (Math.random() < effectIntensity * 0.3) {
    values.grating = pick([20, 60, 100, 140, 180]);
  }

  // Dots — sweep effect
  if (Math.random() < effectIntensity * 0.2) {
    values.dots = 128 + randInt(0, 31); // SWEEP mode
  }

  // Boundary — stay in CROSS range (0-49); >=50 enters REENTRY/BLANK
  if (Math.random() < 0.3) {
    values.boundary = randInt(10, 49);
  }

  fuzzCounter++;
  const name = `FUZZ ${fuzzCounter}`;
  const desc = buildDescription(values);

  return { name, description: desc, values };
}

/** Mutate an existing scene with small perturbations */
export function mutateScene(base: Scene, strength: number = 0.3): Scene {
  const values = { ...base.values };

  // Pattern: small chance to change
  if (Math.random() < strength * 0.3) {
    const current = values.pattern ?? 0;
    // Adjacent pattern (±1-5)
    const delta = randInt(1, 5) * (Math.random() < 0.5 ? -1 : 1);
    values.pattern = Math.max(0, Math.min(139, current + delta));
  }

  // Zoom: nudge within current mode boundary or small chance to change mode
  if (values.zoom !== undefined && Math.random() < strength) {
    if (Math.random() < 0.2) {
      // Change mode entirely
      values.zoom = weightedPick(ZOOM_MODES);
    } else {
      // Nudge within current mode boundaries (STATIC 0-127, OUT 128-159, IN 160-191, IN/OUT 192-223)
      const z = values.zoom;
      const [lo, hi] =
        z < 128 ? [0, 127] : z < 160 ? [128, 159] : z < 192 ? [160, 191] : z < 224 ? [192, 223] : [224, 255];
      values.zoom = Math.max(lo, Math.min(hi, z + randInt(-15, 15)));
    }
  }

  // Rotation: nudge within current mode boundary
  if (values.rotation !== undefined && Math.random() < strength * 0.5) {
    const r = values.rotation;
    const [lo, hi] =
      r < 128 ? [0, 127] : r < 160 ? [128, 159] : r < 192 ? [160, 191] : r < 224 ? [192, 223] : [224, 255];
    values.rotation = Math.max(lo, Math.min(hi, r + randInt(-10, 10)));
  }

  // Color: chance to shift
  if (Math.random() < strength * 0.4) {
    const allColors = COLOR_OPTIONS.any;
    values.colorChange = pick(allColors);
  }

  // Toggle effects on/off
  const effectKeys = ["twist", "grating", "drawing2", "dots", "xZoom", "yZoom"];
  for (const key of effectKeys) {
    if (Math.random() < strength * 0.15) {
      if (values[key] !== undefined && values[key] > 0) {
        // Turn off
        delete values[key];
      } else {
        // Turn on with random value
        switch (key) {
          case "twist":
            values[key] = randInt(40, 180);
            break;
          case "grating":
            values[key] = pick([20, 60, 100, 140, 180]);
            break;
          case "drawing2":
            values[key] = pick([128, 160, 192, 224]) + randInt(0, 25);
            break;
          case "dots":
            values[key] = 128 + randInt(0, 31);
            break;
          case "xZoom":
          case "yZoom":
            values[key] = pick([128, 160, 192, 224]) + randInt(0, 20);
            break;
        }
      }
    }
  }

  // Movement: chance to add/remove/nudge within mode boundaries
  for (const key of ["xMove", "yMove"]) {
    if (Math.random() < strength * 0.2) {
      if (values[key] !== undefined) {
        if (Math.random() < 0.3) {
          delete values[key]; // remove movement
        } else {
          // Nudge within current mode boundary (32-value blocks starting at 128)
          const v = values[key];
          const [lo, hi] =
            v < 128 ? [0, 127] : v < 160 ? [128, 159] : v < 192 ? [160, 191] : v < 224 ? [192, 223] : [224, 255];
          values[key] = Math.max(lo, Math.min(hi, v + randInt(-10, 10)));
        }
      } else {
        const mode = pick([128, 160, 192, 224]);
        values[key] = mode + randInt(0, 20);
      }
    }
  }

  // Ensure scene isn't blank
  if (!values.laserOnOff || values.laserOnOff === 0) {
    values.laserOnOff = 100;
  }

  fuzzCounter++;
  const name = `FUZZ ${fuzzCounter}`;
  const desc = buildDescription(values);

  return { name, description: desc, values };
}

function buildDescription(values: Record<string, number>): string {
  const parts: string[] = [];
  if (values.groupSelect >= 244) {
    parts.push(`anim #${values.pattern}`);
  } else {
    parts.push(`pattern #${values.pattern}`);
  }
  if (values.zoom !== undefined) {
    if (values.zoom <= 127) parts.push("static zoom");
    else if (values.zoom <= 159) parts.push("zoom out");
    else if (values.zoom <= 191) parts.push("zoom in");
    else if (values.zoom <= 223) parts.push("in/out");
  }
  if (values.rotation !== undefined && values.rotation > 127) {
    if (values.rotation <= 223) parts.push("CW");
    else parts.push("CCW");
  }
  if (values.grating) parts.push("grating");
  if (values.twist) parts.push("twist");
  if (values.drawing2) parts.push("drawing2");
  if (values.xMove || values.yMove) parts.push("movement");
  if (values.xZoom || values.yZoom) parts.push("distortion");
  return parts.join(", ");
}
