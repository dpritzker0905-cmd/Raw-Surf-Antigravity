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
/**
 * BEAUFORT-ANCHORED THEME RAMPS (2026-07-18 EVE-3 round 3).
 *
 * WHY THE RANGE WAS SHORT. The LUT is built by walking 0..maxSpeed KNOTS and sampling these stops
 * (generateRampData), and `_maxWindSpeed` is data-driven, clamped [10, 80]. The old ramps' last
 * stop was 50 kn and sampleRamp() returns the FINAL colour for anything above it — so whenever a
 * field contained storm winds, everything from 50 to 80 kn rendered as ONE FLAT COLOUR: up to 38%
 * of the LUT with zero discrimination, across exactly the hurricane range. Eight stops also left
 * the 0-30 kn band — where nearly all surf-relevant weather lives — very coarsely graded.
 *
 * WHY BEAUFORT. Stop positions are no longer arbitrary: each is a Beaufort force boundary (kn), so
 * a colour change on screen means a named change in sea state rather than an aesthetic step. 13
 * bands instead of 8, carried through hurricane force (64+).
 *   0 calm · 3 light air · 6 light breeze · 10 gentle · 16 moderate · 21 fresh · 27 strong
 *   33 near gale · 40 gale · 47 strong gale · 55 storm · 63 violent storm · 75 hurricane
 *
 * COLOUR RULES APPLIED TO ALL THREE THEMES:
 *  - each theme keeps its established hue identity (dark = luminous neon, light = dark inks on a
 *    pale basemap, beach = tropical sunset);
 *  - hue advances monotonically around the wheel so adjacent bands stay separable;
 *  - alpha rises with force, so calm air stays unobtrusive and storms dominate;
 *  - LIGHT deliberately holds LOW luminance across the whole ramp — it is drawn on a pale basemap,
 *    so its legibility comes from being dark, not from being colourful.
 * Per-stop contrast for every stop x every theme is enforced by windParticleContrast.test.js; the
 * particle casing adapts per colour, so added stops cannot silently cost mark legibility.
 */
// SLOW-BAND HUE SPREAD (2026-07-19, user: "spectrum sensitivity must extend better into the
// slower winds"). Measured composited over each theme's basemap: dark's 0-3-6 kn gaps were
// 12/10/11 deg (one cyan family — indistinguishable) while its fast bands got 37-41; light's low
// gaps were 7/12. The low stops now spread across more of each theme's wheel — every adjacent
// gap below 21 kn is >=18 deg (pinned by windFieldLut.test.js) — while each theme keeps its hue
// identity, monotone advance, and its 27+ kn stops untouched.
// COMPOSITE-SPACE RESPREAD (2026-07-19 late, the 07-20 final-pass correction upheld): the >=18°
// LUT-space pins above proved INSUFFICIENT — post-alpha, over each theme's REAL basemap, hue
// gaps compress ~4x (light's 0kn and 3kn both composited to the IDENTICAL hue 206°: light air in
// light mode was literally "slightly darker basemap"). The composite hue only moves if ink
// CHROMA x ALPHA competes with the basemap's own chroma, so the low stops are now saturated
// far-side hues (light: vivid violet -> ultramarine; dark: violet calm; beach: +sat rose),
// grid-searched so every adjacent composite gap below 21 kn is >=12° over the measured basemaps
// (dark 93,117,126 · light 168,214,222 · beach 150,190,200) at the SHIPPED alpha — no alpha
// change needed. Pinned by windFieldLut.test.js's composite-space gate. Stops >= 6 kn untouched.
var BEACH_WIND_RAMP = [
  [0,  1.00, 0.20, 0.72, 0.75], // Calm: saturated magenta-rose (composite delta was marginal)
  [3,  1.00, 0.48, 0.42, 0.78], // Light air: coral
  [6,  1.00, 0.60, 0.20, 0.81], // Light breeze: orange
  [10, 0.95, 0.82, 0.06, 0.83], // Gentle: yellow-gold
  [16, 0.72, 0.90, 0.12, 0.85], // Moderate: lime
  [21, 0.35, 0.88, 0.25, 0.87], // Fresh: green
  [27, 0.10, 0.88, 0.55, 0.88], // Strong: spring green
  [33, 0.00, 0.86, 0.80, 0.90], // Near gale: turquoise
  [40, 0.00, 0.72, 0.92, 0.91], // Gale: cyan-blue
  [47, 0.10, 0.55, 0.95, 0.92], // Strong gale: royal blue
  [55, 0.35, 0.35, 0.93, 0.93], // Storm: indigo
  [63, 0.60, 0.25, 0.90, 0.94], // Violent storm: violet
  [75, 0.88, 0.20, 0.88, 0.95], // Hurricane: magenta
];

var LIGHT_WIND_RAMP = [
  [0,  0.50, 0.00, 0.70, 0.72], // Calm: vivid violet (composite 233° vs the basemap's cyan 189°)
  [3,  0.10, 0.20, 0.68, 0.75], // Light air: ultramarine (composite 215°)
  [6,  0.02, 0.33, 0.48, 0.78], // Light breeze: deep teal
  [10, 0.03, 0.42, 0.40, 0.80], // Gentle: pine teal
  [16, 0.08, 0.46, 0.20, 0.82], // Moderate: forest green
  [21, 0.30, 0.47, 0.10, 0.84], // Fresh: olive
  [27, 0.52, 0.44, 0.03, 0.86], // Strong: dark gold
  [33, 0.65, 0.38, 0.02, 0.87], // Near gale: bronze
  [40, 0.72, 0.28, 0.04, 0.88], // Gale: burnt orange
  [47, 0.75, 0.18, 0.08, 0.90], // Strong gale: brick
  [55, 0.70, 0.08, 0.22, 0.91], // Storm: crimson
  [63, 0.58, 0.05, 0.38, 0.93], // Violent storm: wine
  [75, 0.40, 0.02, 0.45, 0.95], // Hurricane: deep violet
];

var DARK_WIND_RAMP = [
  [0,  0.55, 0.25, 1.00, 0.80], // Calm: violet (high R+B against the slate basemap's low R)
  [3,  0.25, 0.65, 1.00, 0.83], // Light air: azure
  [6,  0.15, 0.90, 0.95, 0.85], // Light breeze: neon cyan
  [10, 0.20, 0.95, 0.70, 0.87], // Gentle: aqua-green
  [16, 0.38, 0.95, 0.40, 0.88], // Moderate: spring green
  [21, 0.62, 0.92, 0.30, 0.89], // Fresh: yellow-green
  [27, 0.85, 0.85, 0.20, 0.90], // Strong: chartreuse
  [33, 0.97, 0.72, 0.15, 0.91], // Near gale: amber
  [40, 0.99, 0.55, 0.12, 0.92], // Gale: orange
  [47, 0.98, 0.35, 0.15, 0.93], // Strong gale: vermilion
  [55, 0.95, 0.20, 0.30, 0.94], // Storm: hot red
  [63, 0.92, 0.30, 0.65, 0.95], // Violent storm: rose
  [75, 1.00, 0.75, 0.95, 0.95], // Hurricane: white-magenta
];

// DEFAULT_WIND_RAMP above was byte-identical to the dark ramp before the Beaufort rework; keep
// that invariant so the no-theme fallback path (sampleColorRamp / createRampTexture's default)
// gains the same 13-band range instead of silently keeping the old 50-kn-capped 8-stop table.
DEFAULT_WIND_RAMP = DARK_WIND_RAMP;

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
