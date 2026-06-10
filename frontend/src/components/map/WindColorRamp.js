/**
 * WindColorRamp.js Color LUT for WebGL Wind Visualization
 *
 * Generates a 1D texture lookup table (LUT) that maps wind speed color.
 * Used by WebGLWindEngine's draw fragment shader.
 *
 * RULES:
 *   - NO import-time side effects
 *   - NO DOM or React dependency
 *   - Pure color math + GL texture creation
 */

/**
 * v3.11.3: Scientific wind speed color ramp (meteorological convention).
 * Each stop: [speed_kn, r, g, b, a]
 * Speed in knots. Calm winds are nearly transparent so terrain shows through.
 * Alpha ramps nonlinearly — only moderate+ winds visually dominate.
 * Default (dark) follows Beaufort/Ventusky convention: blue→cyan→green→yellow→red→purple.
 */
var DEFAULT_WIND_RAMP = [
  [0,  0.65, 0.75, 0.85, 0.05], // Calm: highly transparent light blue-white
  [2,  0.55, 0.70, 0.88, 0.10], // Light air: bright blue, very transparent
  [5,  0.38, 0.75, 0.88, 0.18], // Light breeze: cyan
  [8,  0.22, 0.80, 0.72, 0.24], // Gentle breeze: teal
  [12, 0.38, 0.82, 0.38, 0.30], // Moderate: soft green
  [16, 0.78, 0.82, 0.20, 0.35], // Fresh: yellow-green
  [20, 0.95, 0.68, 0.15, 0.40], // Strong: soft amber
  [25, 0.95, 0.45, 0.10, 0.45], // Near gale: soft orange
  [30, 0.90, 0.22, 0.15, 0.48], // Gale: soft red
  [40, 0.75, 0.10, 0.35, 0.50], // Storm: soft magenta
  [50, 0.55, 0.05, 0.50, 0.50], // Hurricane: soft purple
];

/**
 * Theme-specific wind ramps matching the HEATMAP_FS shader palettes.
 * Beach: warm teal → cyan → amber → cream (tropical vibes)
 * Light: cool blue → indigo → white (clean visibility on light backgrounds)
 * Dark: default cyan → magenta → white ramp (high contrast on dark maps)
 */
var BEACH_WIND_RAMP = [
  [0,  0.04, 0.45, 0.40, 0.08],
  [3,  0.05, 0.60, 0.55, 0.18],
  [6,  0.05, 0.78, 0.70, 0.30],
  [10, 0.20, 0.85, 0.72, 0.40],
  [15, 0.65, 0.82, 0.45, 0.50],
  [20, 1.00, 0.68, 0.30, 0.60],
  [25, 1.00, 0.55, 0.22, 0.70],
  [30, 1.00, 0.40, 0.15, 0.78],
  [40, 1.00, 0.90, 0.78, 0.85],
  [50, 1.00, 0.95, 0.86, 0.90],
];

var LIGHT_WIND_RAMP = [
  [0,  0.78, 0.88, 0.95, 0.08],
  [3,  0.60, 0.82, 0.95, 0.18],
  [6,  0.25, 0.70, 0.95, 0.30],
  [10, 0.20, 0.55, 0.92, 0.40],
  [15, 0.18, 0.42, 0.90, 0.50],
  [20, 0.18, 0.38, 0.90, 0.60],
  [25, 0.22, 0.30, 0.85, 0.70],
  [30, 0.55, 0.40, 0.90, 0.78],
  [40, 0.85, 0.82, 0.95, 0.85],
  [50, 0.96, 0.98, 1.00, 0.90],
];

var DARK_WIND_RAMP = [
  [0,  0.00, 0.08, 0.15, 0.08],
  [3,  0.00, 0.30, 0.55, 0.18],
  [6,  0.00, 0.60, 0.85, 0.30],
  [10, 0.00, 0.85, 1.00, 0.40],
  [15, 0.30, 0.90, 0.90, 0.50],
  [20, 0.70, 0.65, 0.95, 0.60],
  [25, 0.95, 0.12, 0.80, 0.70],
  [30, 1.00, 0.30, 0.50, 0.78],
  [40, 1.00, 0.85, 0.85, 0.85],
  [50, 1.00, 1.00, 1.00, 0.90],
];

export var THEME_RAMPS = {
  beach: BEACH_WIND_RAMP,
  light: LIGHT_WIND_RAMP,
  dark: DARK_WIND_RAMP
};

/**
 * Interpolate between two color stops.
 * @param {number[]} a - [speed, r, g, b, a]
 * @param {number[]} b - [speed, r, g, b, a]
 * @param {number} t - interpolation factor [0, 1]
 * @returns {number[]} [r, g, b, a]
 */
function lerpStop(a, b, t) {
  return [
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
    a[4] + (b[4] - a[4]) * t,
  ];
}

/**
 * Sample the color ramp at a given wind speed.
 * @param {number[][]} ramp
 * @param {number} speed - wind speed in knots
 * @returns {number[]} [r, g, b, a] in [0, 1]
 */
export function sampleRamp(ramp, speed) {
  if (speed <= ramp[0][0]) return [ramp[0][1], ramp[0][2], ramp[0][3], ramp[0][4]];
  for (var i = 1; i < ramp.length; i++) {
    if (speed <= ramp[i][0]) {
      var t = (speed - ramp[i - 1][0]) / (ramp[i][0] - ramp[i - 1][0]);
      return lerpStop(ramp[i - 1], ramp[i], t);
    }
  }
  var last = ramp[ramp.length - 1];
  return [last[1], last[2], last[3], last[4]];
}

/**
 * Generate a 256-pixel 1D color ramp texture (RGBA8).
 * Maps normalized speed [0, 1] → color, where 1.0 = maxSpeed.
 *
 * @param {number} maxSpeed - max wind speed in knots (typically 50)
 * @param {number[][]} [ramp] - custom color ramp, or auto-select by theme
 * @param {string} [theme] - 'dark', 'light', or 'beach' — selects themed ramp
 * @returns {Uint8Array} 256×1 RGBA data (1024 bytes)
 */
export function generateRampData(maxSpeed, ramp, theme) {
  var stops = ramp || THEME_RAMPS[theme] || DEFAULT_WIND_RAMP;
  var data = new Uint8Array(256 * 4);

  for (var i = 0; i < 256; i++) {
    var speed = (i / 255) * maxSpeed;
    var color = sampleRamp(stops, speed);
    data[i * 4 + 0] = Math.round(color[0] * 255);
    data[i * 4 + 1] = Math.round(color[1] * 255);
    data[i * 4 + 2] = Math.round(color[2] * 255);
    data[i * 4 + 3] = Math.round(color[3] * 255);
  }

  return data;
}

/**
 * Create a WebGL 1D texture from the color ramp.
 *
 * @param {WebGLRenderingContext} gl
 * @param {number} maxSpeed
 * @param {number[][]} [ramp]
 * @returns {{ texture: WebGLTexture, maxSpeed: number }}
 */
export function createRampTexture(gl, maxSpeed, ramp) {
  var data = generateRampData(maxSpeed || 50, ramp);
  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return { texture: tex, maxSpeed: maxSpeed || 50 };
}

/**
 * GLSL fragment shader snippet for color ramp lookup.
 * Replaces the fixed dark color in WebGLWindEngine's DRAW_FS.
 */
export var COLOR_RAMP_DRAW_FS = [
  'precision mediump float;',
  'varying float v_speed;',
  'uniform sampler2D u_color_ramp;',
  'uniform float u_max_speed;',
  'void main() {',
  '  float normalizedSpeed = clamp(v_speed / u_max_speed, 0.0, 1.0);',
  '  vec4 color = texture2D(u_color_ramp, vec2(normalizedSpeed, 0.5));',
  '  gl_FragColor = color;',
  '}',
].join('\n');

/** @returns {number[][]} A copy of the default ramp for customization */
export function getDefaultRamp() {
  return DEFAULT_WIND_RAMP.map(function(stop) { return stop.slice(); });
}

/**
 * v3.12.3: Convenience wrapper sample default ramp at a given speed.
 * Used by WindParticleOverlay for Canvas2D rendering.
 * @param {number} speed - wind speed in m/s
 * @returns {number[]} [r, g, b, a] in [0, 1]
 */
export function sampleColorRamp(speed) {
  return sampleRamp(DEFAULT_WIND_RAMP, speed);
}
