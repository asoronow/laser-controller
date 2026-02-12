export interface Scene {
  name: string;
  description: string;
  values: Record<string, number>;
}

// Scene presets for U'King ZQ05031
// Channel names match SoundSwitch profile:
//   laserOnOff, patternSize, groupSelect, pattern, zoom, rotation,
//   xMove (Pan), yMove (Tilt), xZoom, yZoom, fixedColor, colorChange,
//   dots, drawing1, drawing2, twist, grating

export const SCENES: Scene[] = [
  {
    name: "SS MATCH",
    description: "Exact SoundSwitch working values",
    values: {
      laserOnOff: 100,      // Sound active (confirmed working)
      groupSelect: 255,     // Group 0 (animations)
      pattern: 28,          // Pattern 28
      fixedColor: 152,      // Color change per dot
      drawing2: 217,        // Dynamic C effects
    },
  },
  {
    name: "CIRCLE RED",
    description: "Red circle, slow rotation",
    values: {
      laserOnOff: 100,      // Sound active (like SoundSwitch)
      groupSelect: 0,       // Group 1 (beams)
      pattern: 0,           // Circle
      zoom: 80,             // Static, large
      rotation: 200,        // CW slow
      colorChange: 8,       // Red
    },
  },
  {
    name: "STAR BURST",
    description: "Fan beams with 7-color cycling",
    values: {
      laserOnOff: 100,      // Sound active
      groupSelect: 0,       // Group 1
      pattern: 24,          // Fan beams
      zoom: 100,            // Static, full size
      rotation: 210,        // CW medium
      colorChange: 160,     // 7 color cycle
    },
  },
  {
    name: "LISSAJOUS",
    description: "Lissajous curves, dynamic zoom",
    values: {
      laserOnOff: 100,      // Sound active
      groupSelect: 0,       // Group 1
      pattern: 29,          // Lissajous 2:3
      zoom: 200,            // Dynamic zoom IN/OUT
      rotation: 195,        // CW slow
      xMove: 145,           // Pan wave
      yMove: 175,           // Tilt wave
      colorChange: 32,      // Cyan
    },
  },
  {
    name: "TUNNEL",
    description: "Concentric circles, zoom pulsing",
    values: {
      laserOnOff: 100,      // Sound active
      groupSelect: 0,       // Group 1
      pattern: 60,          // Concentric circles
      zoom: 200,            // Dynamic IN/OUT
      rotation: 225,        // CCW slow
      xZoom: 200,           // X distortion
      yZoom: 200,           // Y distortion
      colorChange: 40,      // Blue
    },
  },
  {
    name: "GRATING",
    description: "Star through grating grid",
    values: {
      laserOnOff: 100,      // Sound active
      groupSelect: 0,       // Group 1
      pattern: 20,          // 5-point star
      zoom: 64,             // Static, mid
      rotation: 200,        // CW
      grating: 60,          // Grating group 3
      colorChange: 24,      // Green
    },
  },
  {
    name: "HEART",
    description: "Heart shape, color cycling",
    values: {
      laserOnOff: 100,      // Sound active
      groupSelect: 0,       // Group 1
      pattern: 33,          // Heart
      zoom: 90,             // Static, large
      colorChange: 192,     // Sine chasing color
    },
  },
  {
    name: "ANIMATION",
    description: "Morphing animated patterns",
    values: {
      laserOnOff: 100,      // Sound active
      groupSelect: 250,     // Group 0 (animations)
      pattern: 50,          // Animation pattern
      zoom: 90,             // Static, large
      colorChange: 160,     // 7 color cycle
    },
  },
];
