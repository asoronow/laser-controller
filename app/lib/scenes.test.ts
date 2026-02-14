import { describe, it, expect } from "vitest";
import { SCENES } from "./scenes";
import { CHANNEL_BY_KEY } from "./channels";

describe("scenes.ts", () => {
  it("has at least 8 preset scenes", () => {
    expect(SCENES.length).toBeGreaterThanOrEqual(8);
  });

  it("all values are in 0-255 range", () => {
    for (const scene of SCENES) {
      for (const [key, val] of Object.entries(scene.values)) {
        expect(val, `${scene.name}.${key}`).toBeGreaterThanOrEqual(0);
        expect(val, `${scene.name}.${key}`).toBeLessThanOrEqual(255);
      }
    }
  });

  it("does not use deprecated 'patternSize' key", () => {
    for (const scene of SCENES) {
      expect(
        scene.values.patternSize,
        `${scene.name} uses patternSize`
      ).toBeUndefined();
    }
  });

  it("every scene has laserOnOff > 0", () => {
    for (const scene of SCENES) {
      expect(scene.values.laserOnOff).toBeGreaterThan(0);
    }
  });

  it("all channel keys reference valid channels", () => {
    for (const scene of SCENES) {
      for (const key of Object.keys(scene.values)) {
        expect(CHANNEL_BY_KEY[key], `Unknown key '${key}' in ${scene.name}`).toBeDefined();
      }
    }
  });

  it("groupSelect uses valid values (0-223 for Group 1, 244-255 for Group 0)", () => {
    for (const scene of SCENES) {
      const gs = scene.values.groupSelect;
      if (gs === undefined) continue;
      const valid = (gs >= 0 && gs <= 223) || (gs >= 244 && gs <= 255);
      expect(valid, `${scene.name} groupSelect=${gs} is in undefined range 224-243`).toBe(true);
    }
  });
});
