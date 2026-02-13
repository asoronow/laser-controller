/**
 * Show Effects Engine — music-reactive modulation with punch, momentum, and weighted randomness
 *
 * Key concepts:
 * - Punch: snap to max on beat, variable decay based on beat strength
 * - Momentum: spring-damper model — builds during loud sections with overshoot on drops
 * - Color temperature: drifts through color families with runs and occasional jumps
 * - Probabilistic scene advance: stochastic timing, gated to strong beats only
 * - Beat-synced phases: spatial modulation follows musical rhythm, not wall-clock time
 */

export type ShowStyle = "pulse" | "sweep" | "chaos";

export interface ShowEffectsConfig {
  intensity: number; // 0-1, master modulation depth
  style: ShowStyle;
  colorLock: boolean;
  gratingEnabled: boolean;
  attack: number; // 0-1: 0 = instant snap (punchy), 1 = slow fade in (smooth swell)
  release: number; // 0-1: 0 = instant decay (staccato), 1 = slow decay (lingering)
}

export interface AudioState {
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
  bpm: number;
}

export interface EffectOverrides {
  patternSize?: number;
  zoom?: number;
  rotation?: number;
  xMove?: number;
  yMove?: number;
  xZoom?: number;
  yZoom?: number;
  colorChange?: number;
  dots?: number;
  drawing2?: number;
  twist?: number;
  grating?: number;
}

// ── Mutable show state (persists across frames, mutated in place) ──

export interface ShowState {
  momentum: number; // 0-1, builds during loud sections
  momentumVelocity: number; // spring-damper velocity for momentum
  punchLevel: number; // 0-1, snaps to 1 on beat, decays exponentially
  punchDecayRate: number; // per-beat decay rate (varies by beat strength)
  colorTemp: number; // 0-4, current color family index
  beatsSinceScene: number; // beats since last scene change
  lastBassEnergy: number; // previous frame's bass for drop detection
  highEnergyStreak: number; // consecutive high-energy frames
  lowEnergyFrames: number; // consecutive frames with bass < 0.1 (for breakdown detection)
  gratingBeatCounter: number; // for beat-synced grating toggling
  beatPhase: number; // accumulated beat-synced phase (advances on beats, not clock)
  lastBeatTimeMs: number; // timestamp of most recent beat
  phraseJitter: number; // randomized sigmoid center for scene advance (4-8 range)
}

export function createShowState(): ShowState {
  return {
    momentum: 0,
    momentumVelocity: 0,
    punchLevel: 0,
    punchDecayRate: 0.90,
    colorTemp: 0,
    beatsSinceScene: 0,
    lastBassEnergy: 0,
    highEnergyStreak: 0,
    lowEnergyFrames: 0,
    gratingBeatCounter: 0,
    beatPhase: 0,
    lastBeatTimeMs: 0,
    phraseJitter: 6,
  };
}

// ── Color system: families with weighted drift ──

const COLOR_FAMILIES = [
  [8, 16, 48], // warm: red, yellow, pink
  [24, 32, 40], // cool: green, cyan, blue
  [56, 64, 96], // bright: white, RGB cycle, YCP cycle
  [128, 160], // multi-cycling: RGBYCPW, 7-color
  [192, 224], // chasing: sine, cosine
];

/** Pick a beat color using temperature drift — creates pleasing runs with variety */
export function pickBeatColor(state: ShowState, energy: number): number {
  const temp = state.colorTemp;

  // Drift the color temperature
  const roll = Math.random();
  if (roll < 0.08) {
    // 8%: jump to any family (surprise!)
    state.colorTemp = Math.floor(Math.random() * COLOR_FAMILIES.length);
  } else if (roll < 0.30) {
    // 22%: drift to adjacent family
    const dir = Math.random() < 0.5 ? -1 : 1;
    state.colorTemp = Math.max(
      0,
      Math.min(COLOR_FAMILIES.length - 1, temp + dir)
    );
  }
  // 70%: stay in current family

  // Energy bias: high energy pushes toward cycling/chasing families (3-4)
  if (energy > 0.6 && Math.random() < energy * 0.5) {
    state.colorTemp = Math.max(3, state.colorTemp);
  }

  // Pick from current family
  const family = COLOR_FAMILIES[state.colorTemp];
  return family[Math.floor(Math.random() * family.length)];
}

/** Probabilistic scene advance — stochastic timing, gated to strong beats */
export function shouldAdvanceScene(
  state: ShowState,
  energy: number,
  relativeStrength: number
): boolean {
  const beats = state.beatsSinceScene;

  // Only advance on strong-ish beats (prevents scene changes on ghost notes)
  if (relativeStrength < 1.0) return false;

  // Probability ramps up with randomized center (phraseJitter: 4-8 range)
  const timePressure = 1 / (1 + Math.exp(-(beats - state.phraseJitter) * 0.5));

  // Energy bonus: strong beats push harder, scaled by relative strength
  const energyBonus = energy * state.momentum * relativeStrength * 0.2;

  const probability = Math.min(0.95, timePressure + energyBonus);
  return Math.random() < probability;
}

/** Called from ShowMode on each beat — updates punch, phase, and beat counters */
export function onShowBeat(
  state: ShowState,
  energy: number,
  relativeStrength: number,
  attack: number = 0,
  release: number = 0.5
): void {
  // Attack scales the punch snap: 0 = full snap (punchy), 1 = reduced snap (smooth)
  const snapScale = 1 - attack * 0.7; // 1.0 down to 0.3
  state.punchLevel = Math.min(1, energy * 2.5 * snapScale);

  // Release controls base decay rate: 0 = fast (0.75), 1 = slow (0.97)
  const baseDecay = 0.75 + release * 0.22;
  // Beat strength still modifies the decay rate
  if (relativeStrength > 1.3) {
    state.punchDecayRate = Math.min(0.97, baseDecay + 0.05); // strong: slower
  } else if (relativeStrength < 0.7) {
    state.punchDecayRate = Math.max(0.70, baseDecay - 0.08); // weak: faster
  } else {
    state.punchDecayRate = baseDecay; // normal
  }

  // Advance beat-synced phase — increment varies with energy
  const energyWarp = 0.7 + energy * 0.6; // 0.7-1.3
  const jitter = (Math.random() - 0.5) * 0.1;
  state.beatPhase += PHI * energyWarp + jitter;

  state.lastBeatTimeMs = performance.now();
  state.beatsSinceScene++;
  state.gratingBeatCounter++;
}

/** Called from ShowMode when scene actually changes */
export function onSceneAdvanced(state: ShowState): void {
  state.beatsSinceScene = 0;
  // Randomize next scene advance timing (sigmoid center 4-8)
  state.phraseJitter = 4 + Math.random() * 4;
}

// ── Golden ratio for non-repeating phase offsets ──
const PHI = 1.618033988749895;

/** Compute per-frame channel overrides — mutates state in place */
export function computeEffects(
  audio: AudioState,
  config: ShowEffectsConfig,
  _sceneBase: Record<string, number>,
  timeMs: number,
  state: ShowState
): EffectOverrides {
  const { intensity, style, colorLock, gratingEnabled } = config;
  const { bassEnergy, midEnergy, trebleEnergy, bpm } = audio;
  const overrides: EffectOverrides = {};

  if (intensity === 0) return overrides;

  // ── Update momentum: spring-damper model with overshoot ──
  const momentumTarget = bassEnergy > 0.15 ? bassEnergy : -0.15;
  const momentumDelta = momentumTarget - state.momentum;
  const springForce = momentumDelta * 0.08;
  const dampingForce = -state.momentumVelocity * 0.15;
  state.momentumVelocity += springForce + dampingForce;
  state.momentum += state.momentumVelocity;
  state.momentum = Math.max(0, Math.min(1, state.momentum));

  // ── Decay punch level (variable rate per beat classification) ──
  const bpmFactor = Math.max(1, bpm / 120);
  state.punchLevel *= Math.pow(state.punchDecayRate, bpmFactor);
  if (state.punchLevel < 0.01) state.punchLevel = 0;

  // ── Track energy streaks ──
  if (bassEnergy > 0.35) {
    state.highEnergyStreak = Math.min(120, state.highEnergyStreak + 1);
  } else {
    state.highEnergyStreak = Math.max(0, state.highEnergyStreak - 2);
  }

  // ── Track sustained silence for breakdown detection ──
  if (bassEnergy < 0.1) {
    state.lowEnergyFrames++;
  } else {
    state.lowEnergyFrames = 0;
  }

  // ── Derived values ──
  const punch = state.punchLevel;
  const mom = state.momentum;
  // Breakdown requires ~1.5s (90 frames) of sustained silence, not just a brief dip
  const isBreakdown = state.lowEnergyFrames > 90 && mom > 0.2;

  // ── Beat-synced phases with slow clock fallback ──
  // If no beat for >2s, advance phase slowly at estimated BPM rate
  const timeSinceLastBeat = timeMs - state.lastBeatTimeMs;
  if (state.lastBeatTimeMs > 0 && timeSinceLastBeat > 2000 && bpm > 0) {
    const beatsPerMs = bpm / 60000;
    state.beatPhase += beatsPerMs * 16.67 * PHI * 0.3; // ~1 frame at 60fps, gentle drift
  }

  const phase1 = state.beatPhase;
  const phase2 = state.beatPhase * PHI;
  const phase3 = state.beatPhase * 0.7;

  // ── BREAKDOWN: gentle ambient during sustained energy void ──
  if (isBreakdown) {
    overrides.zoom = 80; // static, medium
    overrides.patternSize = 30; // guarantee visible pattern size
    // Slow drift within 2 CIRC mode (128-159)
    overrides.rotation =
      128 + Math.round(Math.abs(Math.sin(phase1 * 0.3)) * 31);
    // Slow figure-8 drift instead of dead center
    overrides.xMove = 64 + Math.round(Math.sin(phase1 * 0.15) * 20);
    overrides.yMove = 64 + Math.round(Math.cos(phase1 * 0.11) * 20);
    state.lastBassEnergy = bassEnergy;
    return overrides;
  }

  // ── Pattern Size (CH2): scales visual footprint with energy ──
  // Clamped to 0-49 (CROSS range) — values >=50 enter REENTRY/BLANK modes
  if (punch > 0.3) {
    overrides.patternSize = Math.round(punch * 49); // 0-49
  } else {
    overrides.patternSize = Math.round((0.3 + mom * 0.7) * 49); // 15-49
  }

  // ── Zoom (CH5): always responds to momentum, punchy snaps on beats ──
  const punchZoom = punch * intensity;
  const bassZoom = bassEnergy * intensity * mom;
  const zoomDrive = Math.max(punchZoom, bassZoom);
  if (zoomDrive < 0.08) {
    overrides.zoom = 55 + Math.round(mom * 45); // 55-100 static range
  } else if (punch > bassZoom) {
    overrides.zoom = 160 + Math.round(punchZoom * 31); // zoom IN, punchy snap
  } else {
    overrides.zoom = 192 + Math.round(bassZoom * 31); // IN/OUT, flowing
  }

  // ── Rotation (CH6): momentum-scaled with direction drift ──
  const rotPhase = Math.sin(phase1 * 0.21);
  const rotBase = rotPhase > 0 ? 192 : 224; // CW / CCW
  const rotMomentum = 0.3 + mom * 0.7; // 0.3-1.0
  const baseRotSpeed = midEnergy * intensity * rotMomentum;
  const punchRotSpeed = punch * intensity * 0.8;
  const rotSpeed = Math.max(baseRotSpeed, punchRotSpeed) * 31;
  overrides.rotation = rotBase + Math.round(Math.min(rotSpeed, 31));

  // ── X Movement / Pan (CH7): style + momentum-scaled ──
  const moveAmp = (0.2 + mom * 0.8) * intensity;
  if (style === "pulse") {
    const moveSnap = Math.min(punch * 50 * intensity, 31); // clamp to mode width
    if (moveSnap > 5) {
      const moveDir = Math.sin(phase2 * 1.7) > 0 ? 128 : 192;
      overrides.xMove = moveDir + Math.round(moveSnap);
    }
  } else if (style === "sweep") {
    const sinVal = Math.sin(phase3 * 0.4);
    const sweepRange = moveAmp * 40;
    overrides.xMove =
      128 + Math.round(sinVal * sweepRange) + Math.round(midEnergy * 15);
  } else {
    const chaos =
      Math.sin(phase1 * 2.3) * 0.5 +
      Math.sin(phase2 * 3.7) * 0.3 +
      trebleEnergy * 0.5;
    overrides.xMove = 128 + Math.round(chaos * 60 * moveAmp);
  }

  // ── Y Movement / Tilt (CH8): offset from X for circular/lissajous paths ──
  if (style === "pulse") {
    const moveSnap = Math.min(punch * 50 * intensity, 31); // clamp to mode width
    if (moveSnap > 5) {
      const moveDir = Math.cos(phase2 * 1.7) > 0 ? 128 : 192;
      overrides.yMove = moveDir + Math.round(moveSnap);
    }
  } else if (style === "sweep") {
    const cosVal = Math.cos(phase3 * 0.4);
    const sweepRange = moveAmp * 40;
    overrides.yMove =
      128 + Math.round(cosVal * sweepRange) + Math.round(midEnergy * 15);
  } else {
    const chaos =
      Math.cos(phase1 * 2.3) * 0.5 +
      Math.cos(phase2 * 3.7) * 0.3 +
      midEnergy * 0.5;
    overrides.yMove = 128 + Math.round(chaos * 60 * moveAmp);
  }

  // Clamp movement to dynamic range (128-255) — below 128 is STATIC (movement stops)
  if (overrides.xMove !== undefined)
    overrides.xMove = Math.max(128, Math.min(255, overrides.xMove));
  if (overrides.yMove !== undefined)
    overrides.yMove = Math.max(128, Math.min(255, overrides.yMove));

  // ── X Distortion (CH9): treble + punch warp ──
  const distDrive = Math.max(trebleEnergy, punch * 0.6) * intensity;
  if (distDrive > 0.15) {
    const distPhase = Math.sin(phase1 * 0.33);
    const distBase = distPhase > 0 ? 128 : 192; // UP_DIST vs IN/OUT
    overrides.xZoom = distBase + Math.round(distDrive * 31);
  }

  // ── Y Distortion (CH10): asymmetric from X ──
  if (distDrive > 0.15) {
    const distPhase = Math.sin(phase2 * 0.27);
    const distBase = distPhase > 0 ? 128 : 192;
    overrides.yZoom = distBase + Math.round(distDrive * 31);
  }

  // ── Color Change (CH12): momentum-driven mode selection ──
  if (!colorLock) {
    const totalEnergy = (bassEnergy + midEnergy + trebleEnergy) / 3;
    if (mom > 0.5 && totalEnergy > 0.35) {
      const chasePhase = Math.sin(phase1 * 0.17);
      const chaseBase = chasePhase > 0 ? 192 : 224; // sine vs cosine
      overrides.colorChange =
        chaseBase + Math.round(totalEnergy * intensity * 25);
    }
  }

  // ── Dots (CH13): punch-reactive sweep bursts ──
  const dotsThreshold = 0.3 * (1.2 - intensity);
  if (punch > dotsThreshold || trebleEnergy > dotsThreshold + 0.1) {
    const dotsDrive = Math.max(punch, trebleEnergy) * intensity;
    overrides.dots = 128 + Math.round(dotsDrive * 31); // SWEEP mode
  }

  // ── Drawing2 (CH15): momentum-gated dynamic modes ──
  if (mom > 0.25 && midEnergy > 0.15) {
    const drawIdx = Math.floor(phase1 * 0.13) % 4;
    const drawBase = 128 + drawIdx * 32; // A, B, C, D
    const drawSpeed = Math.round(midEnergy * intensity * mom * 31);
    overrides.drawing2 = drawBase + Math.min(drawSpeed, 31);
  }

  // ── Twist (CH16): punch-driven snap with slow undulation ──
  const twistBase = Math.sin(phase2 * 0.09) * 60 + 80; // 20-140 slow drift
  const twistPunch = punch * intensity * 120; // snap on beat
  if (punch > 0.1 || mom > 0.3) {
    overrides.twist = Math.round(
      Math.max(0, Math.min(255, twistBase + twistPunch))
    );
  }

  // ── Grating (CH17): beat-synced toggling ──
  if (gratingEnabled) {
    const gratingCycle = Math.floor(state.gratingBeatCounter * PHI) % 5;
    if (gratingCycle < 2 && mom > 0.2) {
      const gratingGroup = Math.floor(phase1 * 0.07) % 5;
      overrides.grating = 20 + gratingGroup * 40; // 20, 60, 100, 140, 180
    } else {
      overrides.grating = 0;
    }
  }

  state.lastBassEnergy = bassEnergy;
  return overrides;
}
