import { describe, it, expect } from "vitest";
import {
  generateRandomScene,
  mutateScene,
  DEFAULT_FUZZ_CONFIG,
  type PatternPool,
} from "./scene-fuzzer";

describe("scene-fuzzer.ts", () => {
  describe("generateRandomScene", () => {
    it("generates scenes with required fields", () => {
      const scene = generateRandomScene(DEFAULT_FUZZ_CONFIG);
      expect(scene.name).toMatch(/^FUZZ \d+$/);
      expect(scene.description).toBeTruthy();
      expect(scene.values.laserOnOff).toBe(100);
      expect(scene.values.groupSelect).toBeDefined();
      expect(scene.values.pattern).toBeDefined();
    });

    it("respects beams-low pool (patterns 0-84)", () => {
      for (let i = 0; i < 30; i++) {
        const scene = generateRandomScene({
          ...DEFAULT_FUZZ_CONFIG,
          patternPool: "beams-low",
        });
        expect(scene.values.groupSelect).toBe(0);
        expect(scene.values.pattern).toBeGreaterThanOrEqual(0);
        expect(scene.values.pattern).toBeLessThanOrEqual(84);
      }
    });

    it("respects beams-mid pool (patterns 85-169)", () => {
      for (let i = 0; i < 30; i++) {
        const scene = generateRandomScene({
          ...DEFAULT_FUZZ_CONFIG,
          patternPool: "beams-mid",
        });
        expect(scene.values.groupSelect).toBe(0);
        expect(scene.values.pattern).toBeGreaterThanOrEqual(85);
        expect(scene.values.pattern).toBeLessThanOrEqual(169);
      }
    });

    it("respects beams-high pool (patterns 170-255)", () => {
      for (let i = 0; i < 30; i++) {
        const scene = generateRandomScene({
          ...DEFAULT_FUZZ_CONFIG,
          patternPool: "beams-high",
        });
        expect(scene.values.groupSelect).toBe(0);
        expect(scene.values.pattern).toBeGreaterThanOrEqual(170);
        expect(scene.values.pattern).toBeLessThanOrEqual(255);
      }
    });

    it("respects animations pool (Group 0)", () => {
      for (let i = 0; i < 30; i++) {
        const scene = generateRandomScene({
          ...DEFAULT_FUZZ_CONFIG,
          patternPool: "animations",
        });
        expect(scene.values.groupSelect).toBe(250);
      }
    });

    it("clamps boundary to CROSS range (0-49)", () => {
      for (let i = 0; i < 100; i++) {
        const scene = generateRandomScene({
          ...DEFAULT_FUZZ_CONFIG,
          effectIntensity: 1.0,
        });
        if (scene.values.boundary !== undefined) {
          expect(scene.values.boundary).toBeGreaterThanOrEqual(0);
          expect(scene.values.boundary).toBeLessThanOrEqual(49);
        }
      }
    });

    it("never generates values outside 0-255", () => {
      for (let i = 0; i < 200; i++) {
        const scene = generateRandomScene({
          ...DEFAULT_FUZZ_CONFIG,
          effectIntensity: 1.0,
          movementIntensity: 1.0,
        });
        for (const [key, val] of Object.entries(scene.values)) {
          expect(val, key).toBeGreaterThanOrEqual(0);
          expect(val, key).toBeLessThanOrEqual(255);
        }
      }
    });

    it("does not have deprecated pool names", () => {
      const invalidPools = [
        "geometry",
        "stars",
        "waves",
        "concentric",
        "dots",
        "compound",
        "novelty",
      ] as unknown as PatternPool[];

      for (const pool of invalidPools) {
        expect(() =>
          generateRandomScene({ ...DEFAULT_FUZZ_CONFIG, patternPool: pool })
        ).toThrow();
      }
    });
  });

  describe("mutateScene", () => {
    it("preserves laserOnOff=100", () => {
      const base = generateRandomScene(DEFAULT_FUZZ_CONFIG);
      for (let i = 0; i < 20; i++) {
        const mutated = mutateScene(base, 0.8);
        expect(mutated.values.laserOnOff).toBe(100);
      }
    });

    it("keeps pattern within 0-255", () => {
      const base = generateRandomScene(DEFAULT_FUZZ_CONFIG);
      for (let i = 0; i < 50; i++) {
        const mutated = mutateScene(base, 1.0);
        expect(mutated.values.pattern).toBeGreaterThanOrEqual(0);
        expect(mutated.values.pattern).toBeLessThanOrEqual(255);
      }
    });

    it("never generates values outside 0-255", () => {
      const base = generateRandomScene({
        ...DEFAULT_FUZZ_CONFIG,
        effectIntensity: 1.0,
        movementIntensity: 1.0,
      });
      for (let i = 0; i < 100; i++) {
        const mutated = mutateScene(base, 1.0);
        for (const [key, val] of Object.entries(mutated.values)) {
          expect(val, key).toBeGreaterThanOrEqual(0);
          expect(val, key).toBeLessThanOrEqual(255);
        }
      }
    });
  });
});
