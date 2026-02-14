import { describe, it, expect, beforeEach } from "vitest";
import {
  computeEffects,
  createShowState,
  pickBeatColor,
  shouldAdvanceScene,
  onShowBeat,
  onSceneAdvanced,
  type ShowState,
} from "./show-effects";

describe("show-effects.ts", () => {
  let state: ShowState;

  beforeEach(() => {
    state = createShowState();
  });

  describe("computeEffects", () => {
    const config = {
      intensity: 0.8,
      style: "pulse" as const,
      colorLock: false,
      gratingEnabled: true,
      attack: 0,
      release: 0.5,
    };

    it("returns empty overrides when intensity=0", () => {
      const audio = { bassEnergy: 0.5, midEnergy: 0.5, trebleEnergy: 0.5, bpm: 120 };
      const overrides = computeEffects(
        audio,
        { ...config, intensity: 0 },
        {},
        0,
        state
      );
      expect(Object.keys(overrides)).toHaveLength(0);
    });

    it("returns 'boundary' key (not 'patternSize')", () => {
      state.punchLevel = 0.5;
      state.momentum = 0.5;
      const audio = { bassEnergy: 0.5, midEnergy: 0.5, trebleEnergy: 0.5, bpm: 120 };
      const overrides = computeEffects(audio, config, {}, 0, state);
      expect(overrides.boundary).toBeDefined();
      expect((overrides as Record<string, unknown>).patternSize).toBeUndefined();
    });

    it("clamps boundary to CROSS range 0-49", () => {
      for (let i = 0; i < 100; i++) {
        state.punchLevel = Math.random();
        state.momentum = Math.random();
        const audio = {
          bassEnergy: Math.random(),
          midEnergy: Math.random(),
          trebleEnergy: Math.random(),
          bpm: 120,
        };
        const overrides = computeEffects(audio, config, {}, i * 100, state);
        if (overrides.boundary !== undefined) {
          expect(overrides.boundary).toBeGreaterThanOrEqual(0);
          expect(overrides.boundary).toBeLessThanOrEqual(49);
        }
      }
    });

    it("clamps xMove and yMove to 128-255 (dynamic range)", () => {
      state.momentum = 0.8;
      for (const style of ["pulse", "sweep", "chaos"] as const) {
        for (let i = 0; i < 50; i++) {
          state.punchLevel = Math.random();
          state.beatPhase = Math.random() * 100;
          const audio = {
            bassEnergy: Math.random(),
            midEnergy: Math.random(),
            trebleEnergy: Math.random(),
            bpm: 140,
          };
          const overrides = computeEffects(
            audio,
            { ...config, style },
            {},
            i * 100,
            state
          );
          if (overrides.xMove !== undefined) {
            expect(overrides.xMove, `xMove (${style})`).toBeGreaterThanOrEqual(128);
            expect(overrides.xMove, `xMove (${style})`).toBeLessThanOrEqual(255);
          }
          if (overrides.yMove !== undefined) {
            expect(overrides.yMove, `yMove (${style})`).toBeGreaterThanOrEqual(128);
            expect(overrides.yMove, `yMove (${style})`).toBeLessThanOrEqual(255);
          }
        }
      }
    });

    it("keeps all override values in 0-255 under extreme inputs", () => {
      state.punchLevel = 1.0;
      state.momentum = 1.0;
      state.highEnergyStreak = 120;
      for (let i = 0; i < 200; i++) {
        state.beatPhase = Math.random() * 1000;
        const audio = {
          bassEnergy: 1.0,
          midEnergy: 1.0,
          trebleEnergy: 1.0,
          bpm: 180,
        };
        const overrides = computeEffects(
          audio,
          { ...config, intensity: 1.0, style: "chaos" },
          {},
          i * 100,
          state
        );
        for (const [key, val] of Object.entries(overrides)) {
          if (val !== undefined) {
            expect(val, `${key} at frame ${i}`).toBeGreaterThanOrEqual(0);
            expect(val, `${key} at frame ${i}`).toBeLessThanOrEqual(255);
          }
        }
      }
    });

    it("produces gentle output during breakdown (sustained silence)", () => {
      state.lowEnergyFrames = 100; // >90 = breakdown
      state.momentum = 0.5;       // >0.2 required
      const audio = { bassEnergy: 0.0, midEnergy: 0.0, trebleEnergy: 0.0, bpm: 120 };
      const overrides = computeEffects(audio, config, {}, 1000, state);

      // Breakdown should set static zoom and gentle boundary
      expect(overrides.zoom).toBe(80);
      expect(overrides.boundary).toBe(30);
      expect(overrides.rotation).toBeDefined();
      // Movement should be in static range (0-127) for positioning
      if (overrides.xMove !== undefined) {
        expect(overrides.xMove).toBeLessThanOrEqual(127);
      }
    });
  });

  describe("onShowBeat", () => {
    it("updates punchLevel on beat", () => {
      expect(state.punchLevel).toBe(0);
      onShowBeat(state, 0.8, 1.5);
      expect(state.punchLevel).toBeGreaterThan(0);
    });

    it("advances beatPhase", () => {
      const initial = state.beatPhase;
      onShowBeat(state, 0.5, 1.0);
      expect(state.beatPhase).toBeGreaterThan(initial);
    });

    it("increments beatsSinceScene", () => {
      expect(state.beatsSinceScene).toBe(0);
      onShowBeat(state, 0.5, 1.0);
      expect(state.beatsSinceScene).toBe(1);
      onShowBeat(state, 0.5, 1.0);
      expect(state.beatsSinceScene).toBe(2);
    });
  });

  describe("onSceneAdvanced", () => {
    it("resets beatsSinceScene to 0", () => {
      state.beatsSinceScene = 10;
      onSceneAdvanced(state);
      expect(state.beatsSinceScene).toBe(0);
    });

    it("randomizes phraseJitter in 4-8 range", () => {
      for (let i = 0; i < 50; i++) {
        onSceneAdvanced(state);
        expect(state.phraseJitter).toBeGreaterThanOrEqual(4);
        expect(state.phraseJitter).toBeLessThan(8);
      }
    });
  });

  describe("shouldAdvanceScene", () => {
    it("never advances on weak beats (relativeStrength < 1.0)", () => {
      state.beatsSinceScene = 100;
      state.momentum = 1.0;
      for (let i = 0; i < 100; i++) {
        expect(shouldAdvanceScene(state, 0.9, 0.9)).toBe(false);
      }
    });

    it("has increasing probability with more beats", () => {
      const trials = 2000;
      let earlyCount = 0;
      let lateCount = 0;

      for (let i = 0; i < trials; i++) {
        const early = createShowState();
        early.beatsSinceScene = 2;
        early.momentum = 0.5;
        if (shouldAdvanceScene(early, 0.7, 1.2)) earlyCount++;

        const late = createShowState();
        late.beatsSinceScene = 12;
        late.momentum = 0.5;
        if (shouldAdvanceScene(late, 0.7, 1.2)) lateCount++;
      }

      expect(lateCount).toBeGreaterThan(earlyCount);
    });
  });

  describe("pickBeatColor", () => {
    it("returns valid DMX color values from CH12 presets", () => {
      const validColors = [8, 16, 24, 32, 40, 48, 56, 64, 96, 128, 160, 192, 224];
      for (let i = 0; i < 200; i++) {
        const color = pickBeatColor(state, Math.random());
        expect(validColors).toContain(color);
      }
    });
  });
});
