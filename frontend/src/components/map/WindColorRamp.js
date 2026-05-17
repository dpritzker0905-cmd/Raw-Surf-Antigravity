/**
 * WindColorRamp.js — Color LUT for WebGL Wind Visualization
 *
 * Generates a 1D texture lookup table (LUT) that maps wind speed → color.
 * Used by WebGLWindEngine's draw fragment shader.
 *
 * RULES:
 *   - NO import-time side effects
 *   - NO DOM or React dependency
 *   - Pure color math + GL texture creation
 */

/**
 * v3.11.3: Scientific wind speed color ramp (meteorological convention).
 * Each stop: [speed_ms, r, g, b, a]
 * Speed in m/s. Calm winds are nearly transparent so terrain shows through.
 * Alpha ramps nonlinearly — only moderate+ winds visually dominate.
 * Colors follow Beaufort/Ventusky convention: blue→cyan→green→yellow→red→purple.
 */
var DEFAULT_WIND_RAMP = [
  [0,    0.60, 0.70, 0.85, 0.30],  // Calm — light blue-white, clearly visible
  [2,    0.50, 0.65, 0.88, 0.38],  // Light air — bright blue
  [5,    0.35, 0.72, 0.90, 0.45],  // Light breeze — cyan
  [8,    0.20, 0.78, 0.70, 0.52],  // Gentle breeze — teal
  [12,   0.35, 0.82, 0.35, 0.58],  // Moderate — green
  [16,   0.75, 0.85, 0.15, 0.63],  // Fresh — yellow-green
  [20,   0.95, 0.72, 0.08, 0.67],  // Strong — amber
  [25,   0.95, 0.42, 0.06, 0.70],  // Near gale — orange (MAX alpha)
  [30,   0.90, 0.18, 0.10, 0.70],  // Gale — red
  [40,   0.78, 0.05, 0.30, 0.70],  // Storm — magenta
  [50,   0.55, 0.00, 0.45, 0.70],  // Hurricane — purple
];

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
 * @param {number} speed - wind speed in m/s
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
 * @param {number} maxSpeed - max wind speed in m/s (typically 50)
 * @param {number[][]} [ramp] - custom color ramp, or defaults
 * @returns {Uint8Array} 256 × 1 RGBA data (1024 bytes)
 */
export function generateRampData(maxSpeed, ramp) {
  var stops = ramp || DEFAULT_WIND_RAMP;
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
