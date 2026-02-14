export interface Scene {
  name: string;
  description: string;
  values: Record<string, number>;
}

// Scene presets for U'King ZQ05031 (34CH extended mode)
// Channel keys: laserOnOff, boundary, groupSelect, pattern, zoom, rotation,
//   xMove, yMove, xZoom, yZoom, fixedColor, colorChange,
//   dots, drawing1, drawing2, twist, grating
// NOTE: Pattern numbers are not named in the manual. Names below are
// based on observed output and may not match across firmware versions.

export const SCENES: Scene[] = [
  {
    name: "SS MATCH",
    description: "Exact SoundSwitch working values",
    values: {
      laserOnOff: 100,      // Sound active (confirmed working)
      groupSelect: 255,     // Group 0 (animations)
      pattern: 28,
      fixedColor: 152,      // Color change per dot
      drawing2: 217,        // Dynamic C effects
    },
  },
  {
    name: "PRESET A",
    description: "Pattern #0, red, slow CW rotation",
    values: {
      laserOnOff: 100,      // Sound active
      groupSelect: 0,       // Group 1 (beams)
      pattern: 0,
      zoom: 80,             // Static, large
      rotation: 200,        // CW slow
      colorChange: 8,       // Red
    },
  },
  {
    name: "PRESET B",
    description: "Pattern #24, 7-color cycling, CW rotation",
    values: {
      laserOnOff: 100,      // Sound active
      groupSelect: 0,       // Group 1
      pattern: 24,
      zoom: 100,            // Static, full size
      rotation: 210,        // CW medium
      colorChange: 160,     // 7 color cycle
    },
  },
  {
    name: "PRESET C",
    description: "Pattern #29, dynamic zoom, X/Y movement, cyan",
    values: {
      laserOnOff: 100,      // Sound active
      groupSelect: 0,       // Group 1
      pattern: 29,
      zoom: 200,            // Dynamic zoom IN/OUT
      rotation: 195,        // CW slow
      xMove: 145,           // Dynamic UP wave
      yMove: 175,           // Dynamic LEFT wave
      colorChange: 32,      // Cyan
    },
  },
  {
    name: "PRESET D",
    description: "Pattern #60, zoom pulsing, X/Y distortion, blue",
    values: {
      laserOnOff: 100,      // Sound active
      groupSelect: 0,       // Group 1
      pattern: 60,
      zoom: 200,            // Dynamic IN/OUT
      rotation: 225,        // CCW slow
      xZoom: 200,           // X distortion IN/OUT
      yZoom: 200,           // Y distortion IN/OUT
      colorChange: 40,      // Blue
    },
  },
  {
    name: "GRATING",
    description: "Pattern #20, grating group 4, green",
    values: {
      laserOnOff: 100,      // Sound active
      groupSelect: 0,       // Group 1
      pattern: 20,
      zoom: 64,             // Static, mid
      rotation: 200,        // CW
      grating: 60,          // Grating group 4 (60-79)
      colorChange: 24,      // Green
    },
  },
  {
    name: "PRESET E",
    description: "Pattern #33, sine chasing color",
    values: {
      laserOnOff: 100,      // Sound active
      groupSelect: 0,       // Group 1
      pattern: 33,
      zoom: 90,             // Static, large
      colorChange: 192,     // Sine chasing color
    },
  },
  {
    name: "ANIMATION",
    description: "Group 0, pattern #50, 7-color cycle",
    values: {
      laserOnOff: 100,      // Sound active
      groupSelect: 250,     // Group 0 (animations)
      pattern: 50,
      zoom: 90,             // Static, large
      colorChange: 160,     // 7 color cycle
    },
  },
];
