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
  [0,  0.60, 0.85, 1.00, 0.85], // Calm: ice-blue
  [3,  0.45, 0.90, 0.95, 0.88], // Light air: electric cyan-blue
  [6,  0.20, 0.95, 0.90, 0.90], // Light breeze: neon cyan
  [12, 0.10, 0.98, 0.80, 0.92], // Moderate: bright minty green-cyan
  [21, 0.40, 0.85, 0.45, 0.92], // Strong: green-yellow
  [29, 0.95, 0.72, 0.15, 0.92], // Gale: amber
  [39, 0.95, 0.25, 0.18, 0.95], // Storm: hot red
  [50, 1.00, 0.80, 0.90, 0.95], // Hurricane: white-magenta
];

/**
 * Theme-specific wind ramps matching the HEATMAP_FS shader palettes.
 * Beach: tropical hot pink → coral orange → sun yellow → lime green → turquoise → royal blue → sunset purple (sunset vibes, high contrast over sand/teal water)
 * Light: deep navy → steel blue → deep teal → forest green → rich gold → crimson red → deep purple → violet (highly visible dark lines on light background)
 * Dark: ice blue → electric cyan → neon cyan → minty green-cyan → green-yellow → amber → hot red → white-magenta (luminous neon glow on dark navy background)
 */
var BEACH_WIND_RAMP = [
  [0,  1.00, 0.40, 0.65, 0.88], // Calm: bright electric rose/pink
  [3,  1.00, 0.50, 0.30, 0.90], // Light air: bright coral-orange
  [6,  0.95, 0.75, 0.10, 0.92], // Light breeze: vibrant sun yellow
  [12, 0.20, 0.90, 0.35, 0.92], // Moderate: bright lime green
  [21, 0.00, 0.88, 0.80, 0.95], // Strong: electric turquoise
  [29, 0.00, 0.55, 0.95, 0.95], // Gale: royal blue
  [39, 0.55, 0.20, 0.90, 0.95], // Storm: deep purple
  [50, 0.90, 0.10, 0.90, 0.95], // Hurricane: hot orchid/magenta
];

var LIGHT_WIND_RAMP = [
  [0,  0.08, 0.18, 0.36, 0.75], // Calm: deep rich navy blue
  [3,  0.05, 0.25, 0.45, 0.78], // Light air: deep steel blue
  [6,  0.02, 0.38, 0.48, 0.80], // Light breeze: deep teal
  [12, 0.05, 0.50, 0.30, 0.82], // Moderate: forest green
  [21, 0.65, 0.45, 0.00, 0.85], // Strong: rich gold/amber
  [29, 0.75, 0.20, 0.05, 0.88], // Gale: crimson red
  [39, 0.55, 0.05, 0.40, 0.90], // Storm: deep purple
  [50, 0.35, 0.00, 0.45, 0.95], // Hurricane: deep violet
];

var DARK_WIND_RAMP = [
  [0,  0.60, 0.85, 1.00, 0.85], // Calm: ice-blue
  [3,  0.45, 0.90, 0.95, 0.88], // Light air: electric cyan-blue
  [6,  0.20, 0.95, 0.90, 0.90], // Light breeze: neon cyan
  [12, 0.10, 0.98, 0.80, 0.92], // Moderate: bright minty green-cyan
  [21, 0.40, 0.85, 0.45, 0.92], // Strong: green-yellow
  [29, 0.95, 0.72, 0.15, 0.92], // Gale: amber
  [39, 0.95, 0.25, 0.18, 0.95], // Storm: hot red
  [50, 1.00, 0.80, 0.90, 0.95], // Hurricane: white-magenta
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
