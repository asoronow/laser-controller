import { describe, it, expect } from "vitest";
import { CHANNELS, CHANNEL_BY_KEY } from "./channels";

describe("channels.ts", () => {
  it("has exactly 34 channels", () => {
    expect(CHANNELS).toHaveLength(34);
    expect(CHANNELS[0].ch).toBe(1);
    expect(CHANNELS[33].ch).toBe(34);
  });

  it("uses 'boundary' key for CH2 (not patternSize)", () => {
    expect(CHANNEL_BY_KEY.boundary).toBeDefined();
    expect(CHANNEL_BY_KEY.boundary.ch).toBe(2);
    expect(CHANNEL_BY_KEY.boundary.label).toBe("Out of Bounds / Size");
    expect(CHANNEL_BY_KEY.patternSize).toBeUndefined();
  });

  it("uses correct labels for movement channels", () => {
    expect(CHANNEL_BY_KEY.xMove.label).toBe("X Moving");
    expect(CHANNEL_BY_KEY.yMove.label).toBe("Y Moving");
  });

  it("has min=0 and max=255 for all channels", () => {
    for (const ch of CHANNELS) {
      expect(ch.min).toBe(0);
      expect(ch.max).toBe(255);
    }
  });

  describe("CH2 Boundary presets (manual p.6)", () => {
    it("has 5 presets covering full range", () => {
      const ch = CHANNEL_BY_KEY.boundary;
      expect(ch.presets).toHaveLength(5);
      expect(ch.presets![0]).toEqual({ label: "CROSS", range: [0, 49] });
      expect(ch.presets![1]).toEqual({ label: "REENTRY", range: [50, 99] });
      expect(ch.presets![2]).toEqual({ label: "BLANK", range: [100, 149] });
      expect(ch.presets![3]).toEqual({ label: "ZOOM+BLK", range: [150, 199] });
      expect(ch.presets![4]).toEqual({ label: "SAVE", range: [200, 255] });
    });
  });

  describe("CH11 Fixed Color presets (manual p.7)", () => {
    it("has both ORIGINAL and COLOR/DOT modes", () => {
      const ch = CHANNEL_BY_KEY.fixedColor;
      expect(ch.presets).toHaveLength(2);
      expect(ch.presets![0]).toEqual({ label: "ORIGINAL", range: [0, 0] });
      expect(ch.presets![1]).toEqual({ label: "COLOR/DOT", range: [1, 255] });
    });
  });

  describe("CH12 Color Change presets (manual p.7)", () => {
    it("has 14 color presets", () => {
      const ch = CHANNEL_BY_KEY.colorChange;
      expect(ch.presets).toHaveLength(14);
      expect(ch.presets![0]).toEqual({ label: "ORIGINAL", range: [0, 7] });
      expect(ch.presets![1]).toEqual({ label: "RED", range: [8, 15] });
      expect(ch.presets![7]).toEqual({ label: "WHITE", range: [56, 63] });
      expect(ch.presets![13]).toEqual({ label: "COSINE", range: [224, 255] });
    });
  });

  describe("CH17 Grating presets (manual p.7)", () => {
    it("has 13 grating groups", () => {
      const ch = CHANNEL_BY_KEY.grating;
      expect(ch.presets).toHaveLength(13);
      expect(ch.presets![0]).toEqual({ label: "GROUP 1", range: [0, 19] });
      expect(ch.presets![12]).toEqual({ label: "GROUP 13", range: [240, 255] });
    });

    it("has contiguous coverage from 0-255", () => {
      const ch = CHANNEL_BY_KEY.grating;
      for (let i = 0; i < ch.presets!.length - 1; i++) {
        expect(ch.presets![i + 1].range[0]).toBe(ch.presets![i].range[1] + 1);
      }
      expect(ch.presets![0].range[0]).toBe(0);
      expect(ch.presets![ch.presets!.length - 1].range[1]).toBe(255);
    });
  });

  describe("No overlapping preset ranges", () => {
    it("presets are ordered and non-overlapping within each channel", () => {
      for (const ch of CHANNELS) {
        if (!ch.presets || ch.presets.length < 2) continue;
        for (let i = 0; i < ch.presets.length - 1; i++) {
          const cur = ch.presets[i];
          const next = ch.presets[i + 1];
          expect(cur.range[1]).toBeLessThan(next.range[0]);
        }
      }
    });
  });

  describe("Group B mirrors Group A presets", () => {
    const pairs: [string, string][] = [
      ["xMove", "xMoveB"],
      ["yMove", "yMoveB"],
      ["xZoom", "xZoomB"],
      ["yZoom", "yZoomB"],
      ["fixedColor", "fixedColorB"],
      ["colorChange", "colorChangeB"],
      ["dots", "dotsB"],
      ["drawing2", "drawingB"],
      ["grating", "gratingB"],
    ];

    for (const [aKey, bKey] of pairs) {
      it(`${bKey} presets match ${aKey}`, () => {
        const a = CHANNEL_BY_KEY[aKey];
        const b = CHANNEL_BY_KEY[bKey];
        expect(b.presets).toEqual(a.presets);
      });
    }
  });

  describe("CH19 Group B boundary differs from CH2 (manual p.8)", () => {
    it("has SAVE starting at 150 (not ZOOM+BLK)", () => {
      const ch = CHANNEL_BY_KEY.boundaryB;
      expect(ch.presets).toHaveLength(4);
      expect(ch.presets![3]).toEqual({ label: "SAVE", range: [150, 255] });
    });
  });
});
