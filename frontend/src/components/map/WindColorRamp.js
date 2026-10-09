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
// SLOW-WIND VISIBILITY RAISE (2026-07-20, user bar: "ALL wind must be visible on all three
// themes" — NDBC truth: 71% of the Gulf's live wind was <12 kn). The 0/3/6 kn stops were
// re-derived TOGETHER with the raised field alphas (HEATMAP_FS v3.22: dark baseAlpha 0.44 +
// 5 kn ramp, light 0.42, beach unchanged) — a stop is only right AT its alpha, because the
// composite hue/visibility depend on ink x alpha vs the basemap's own chroma. Grid-searched
// (hue step 2°, S x L dense) under: composite adjacent gaps >=18° below 10 kn, monotone wheel
// advance, visΔ floors (>=12 @0kn, >=20 @3kn — achieved 25-45 @0kn), composite sat floors,
// >=18° wheel clearance from the 75 kn stop, haze guard <=0.55*opacity. Pinned by
// windFieldLut.test.js (composite gaps + visibility floors at the NEW alphas).
// LIGHT + BEACH REDESIGN (2026-10-09, owner: "light mode needs color corrections" / "beach mode colors seem off ... use
// artistic skill" / "careful not to completely block land mass"; slow wind: owner chose the MIDDLE GROUND). Supersedes the
// 07-20 saturated-calm stops (hot pink / electric violet washed every calm landmass) together with the field tint and the
// speed-coloured premultiplied marks (WebGLWindUtils.v2FieldTint / v2SpeedPremul). Designed in OKLCH on the 13 Beaufort
// anchors, checked in CIEDE2000 under the multiply tint over the measured basemaps:
//  - calm (0 kn) is ~colourless (dE <= ~1 on water and land): no wind, no wash;
//  - light air is a soft visible tint (3 kn dE ~9-10), a breeze clear colour (6 kn dE ~15) — the owner's middle ground;
//  - adjacent bands >= 9.5 dE apart (>= 4.9 deuteranope-simulated); lightness falls calm -> storm except one capped dip
//    at 10 kn (needed for slow wind to show on cyan water); all stops in sRGB gamut.
// BEACH "sea -> sunset -> dusk": sand-white, seafoam, aqua-green, sea-teal, lagoon, sea green, palm gold, sunset gold,
// apricot, coral, hibiscus, sunset magenta, dusk violet.
var BEACH_WIND_RAMP = [
  [0,  0.973, 0.953, 0.911, 0.75], // Calm: sand white (L* 95.9)
  [3,  0.471, 0.891, 0.712, 0.78], // Light air: seafoam (L* 83.2)
  [6,  0.027, 0.780, 0.643, 0.81], // Light breeze: aqua-green (L* 71.9)
  [10, 0.361, 0.680, 0.704, 0.83], // Gentle: sea-teal (L* 66.2)
  [16, 0.005, 0.758, 0.954, 0.85], // Moderate: lagoon blue (L* 72.7; +7 C*, 3° off the water — the mid-band refine below)
  [21, 0.284, 0.748, 0.574, 0.87], // Fresh: sea green (L* 69.9)
  [27, 0.635, 0.707, 0.283, 0.88], // Strong: palm gold-green (L* 70.1)
  [33, 0.825, 0.650, 0.124, 0.90], // Near gale: sunset gold (L* 70.2)
  [40, 0.862, 0.455, 0.068, 0.91], // Gale: apricot (L* 59.6)
  [47, 0.822, 0.325, 0.239, 0.92], // Strong gale: coral (L* 52.0)
  [55, 0.739, 0.212, 0.305, 0.93], // Storm: hibiscus (L* 44.2)
  [63, 0.582, 0.149, 0.411, 0.94], // Violent storm: sunset magenta (L* 35.5)
  [75, 0.322, 0.173, 0.514, 0.95], // Hurricane: dusk violet (L* 27.4)
];

// LIGHT "dawn sky -> storm": cloud white, lavender, periwinkle, cerulean, teal, spring green, yellow-green, gold, orange,
// red-orange, red, crimson, plum. (Lavender/periwinkle, not sky blue, open the ramp: blue on the pale-cyan water is invisible.)
var LIGHT_WIND_RAMP = [
  [0,  0.942, 0.964, 0.987, 0.72], // Calm: cloud white (L* 96.6)
  [3,  0.803, 0.757, 0.982, 0.75], // Light air: lavender (L* 80.8)
  [6,  0.612, 0.688, 0.897, 0.78], // Light breeze: periwinkle (L* 71.9)
  [10, 0.103, 0.701, 0.825, 0.80], // Gentle: cerulean (L* 67.3; +0.9 L* — the mid-band refine below)
  [16, 0.304, 0.786, 0.738, 0.82], // Moderate: teal (L* 74.0; +2 C*)
  [21, 0.415, 0.764, 0.520, 0.84], // Fresh: spring green (L* 72.0)
  [27, 0.615, 0.706, 0.267, 0.86], // Strong: yellow-green (L* 69.6)
  [33, 0.802, 0.643, 0.099, 0.87], // Near gale: gold (L* 69.1)
  [40, 0.842, 0.436, 0.014, 0.88], // Gale: orange (L* 57.9)
  [47, 0.825, 0.317, 0.104, 0.90], // Strong gale: red-orange (L* 51.5)
  [55, 0.752, 0.167, 0.184, 0.91], // Storm: red (L* 42.9)
  [63, 0.608, 0.084, 0.311, 0.93], // Violent storm: crimson (L* 34.2)
  [75, 0.395, 0.104, 0.440, 0.95], // Hurricane: plum (L* 25.8)
];

var DARK_WIND_RAMP = [
  // ROUND 3 (2026-07-20 slow-wind raise): dark was chroma-bound at baseAlpha 0.28 — round 2's
  // magenta-violet reached visΔ 10.4 and the user still called the calm band under-visible.
  // The alpha raise (0.44 + 5 kn ramp) is what unlocked these stops: at a 0.211 calm veil the
  // vivid magenta->blue->azure run composites to 269°/234°/200° with visΔ 26.3/42.3/37.4 —
  // 2.5x round 2 — while staying 80% of the haze ceiling.
  [0,  0.90, 0.00, 1.00, 0.80], // Calm: vivid magenta (composite 269°, visΔ 26.3 @ baseA 0.44)
  [3,  0.03, 0.00, 1.00, 0.83], // Light air: pure blue (composite 234°, visΔ 42.3)
  [6,  0.00, 0.67, 1.00, 0.85], // Light breeze: azure (composite 200°, visΔ 37.4)
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

// FIELD RAMPS (2026-10-09, owner: "I like this transparency and animation level [dark], can we match this with light and
// beach but keep ... seeing the land mass ... keep the colors"). Dark's field carries a FLAT strength per band (bench dE76,
// basemap vs field: 6 kn 23 · 10 kn 29.5 · 16 kn 32 · 21 kn 31.5 · 27 kn 30 · 33 kn 28.5 · 40 kn 26 · 47+ kn ~24-25). With the
// particle palettes as the field, light's storm bands ran up to 2x that (dark ink on a white map) and beach's 10-27 kn ~2/3.
// Re-tuning the SHARED ramp would have made light's hurricane PARTICLES pastel, so the tinted themes give the field its
// own ramp: same hues (OKLCH h fixed), L/C re-solved per band so the multiply tint carries dark's measured strength
// (model = the GPU blend on encoded sRGB at the owner's +5-point strengths). 0 and 3 kn keep the middle-ground stops.
// The particles keep THEME_RAMPS. Kill: __RAW_DISABLE_WIND_FIELD_RAMP__ (the field samples THEME_RAMPS again).
// MID-BAND REFINE (2026-10-09, owner: "around 15kts is blending in with the color of the map itself ... refine this very
// slightly"; reports/Wind particle color basemap contrast.md). Measured on the composite over the basemap WATER (light
// 168,214,222 · beach 150,190,200): the 10-16 kn interpolation passes THROUGH the water's hue (light ~12-13 kn, beach ~13 and
// ~17 kn, 0-4° gap), a cyan multiply over cyan water keeps only 0.51-0.68 of its over-land strength, and the 2-3 arcmin
// streaks sat just +1.5 to +5.3 L* above their own tint (light 10 kn +6% Weber, under the ~8-11% "just usable" floor for a
// thin line). Hue cannot fix a crossing speed and thin marks are seen by LIGHTNESS, so each layer gets the lever that works
// on its own ground: FIELD stops darken 3-4 L* (light 10 kn; beach 10 + 16 kn, beach 16 also 6° off the water), PARTICLE
// (legend) stops hold their lightness within ±1.1 L* and gain chroma (beach 16 kn +7.5 C*, 3° off the water). Solved by a
// maximin over 10-21 kn on water (streak vs its tint dL*/4, tint vs water dE00/14, streak vs water dE00/14) with this file's
// windFieldLut gates hard, dark parity kept, land tint <= +0.2 dE76, no hue turned toward the water, every stop <= 2 CSS
// JND (dE_OK <= 0.04); legend swatches shift <= 3.3 dE00. Result over water, 10-21 kn: light streak vs its tint +1.5..+4.2
// -> +3.8..+4.0 L* (worst ~6% -> ~15% Weber); beach 12-17 kn streak vs water 10.2-10.7 -> 11.7-12.7 dE00, tint vs water
// +0.6..+1.1. Full parity with 6/21 kn (>= 18 dE00) needs a palette-character change at the hue crossing, not a refine.
// Kill: __RAW_DISABLE_WIND_MIDBAND_REFINE__ (the stops listed below revert on the next ramp build: theme change or reload).
var PRE_MIDBAND_STOPS = {
  particle: { light: { 3: [10, 0.116, 0.690, 0.811, 0.80], 4: [16, 0.332, 0.785, 0.749, 0.82], 5: [21, 0.409, 0.758, 0.514, 0.84] },
    beach: { 4: [16, 0.308, 0.764, 0.906, 0.85] } },
  field: { light: { 3: [10, 0.276, 0.688, 0.789, 0.80] },
    beach: { 3: [10, 0.008, 0.746, 0.788, 0.83], 4: [16, 0.008, 0.788, 0.967, 0.85] } },
};
function midbandRefined(ramp, kind, theme, w) {
  var pre = PRE_MIDBAND_STOPS[kind][theme];
  if (!pre || !w || w.__RAW_DISABLE_WIND_MIDBAND_REFINE__ !== true) return ramp;
  return ramp.map(function(stop, i) { return pre[i] ? pre[i].slice() : stop; });
}
var LIGHT_FIELD_RAMP = [
  [0,  0.942, 0.964, 0.987, 0.72], [3,  0.803, 0.757, 0.982, 0.75], [6,  0.628, 0.701, 0.901, 0.78],
  [10, 0.289, 0.646, 0.736, 0.80], [16, 0.228, 0.803, 0.762, 0.82], [21, 0.455, 0.763, 0.543, 0.84],
  [27, 0.628, 0.692, 0.432, 0.86], [33, 0.740, 0.657, 0.431, 0.87], [40, 0.753, 0.588, 0.478, 0.88],
  [47, 0.824, 0.613, 0.540, 0.90], [55, 0.858, 0.618, 0.596, 0.91], [63, 0.816, 0.601, 0.656, 0.93],
  [75, 0.736, 0.616, 0.753, 0.95],
];
var BEACH_FIELD_RAMP = [
  [0,  0.973, 0.953, 0.911, 0.75], [3,  0.471, 0.891, 0.712, 0.78], [6,  0.237, 0.790, 0.664, 0.81],
  [10, 0.000, 0.698, 0.738, 0.83], [16, 0.006, 0.747, 0.964, 0.85], [21, 0.016, 0.811, 0.637, 0.87],
  [27, 0.618, 0.702, 0.000, 0.88], [33, 0.839, 0.654, 0.027, 0.90], [40, 0.843, 0.457, 0.124, 0.91],
  [47, 0.809, 0.388, 0.311, 0.92], [55, 0.638, 0.335, 0.364, 0.93], [63, 0.497, 0.330, 0.414, 0.94],
  [75, 0.441, 0.381, 0.553, 0.95],
];
export var FIELD_RAMPS = { light: LIGHT_FIELD_RAMP, beach: BEACH_FIELD_RAMP };

/** The field's stops for `theme` (null = no field ramp), honouring the mid-band refine kill. */
export function resolveFieldRamp(theme, win) {
  var w = win || (typeof window !== 'undefined' ? window : {});
  return FIELD_RAMPS[theme] ? midbandRefined(FIELD_RAMPS[theme], 'field', theme, w) : null;
}

/** The field's own LUT texture for `theme` (null = the field samples the particle ramp). Restores the texture binding. */
export function buildFieldRampTexture(gl, maxSpeed, theme, win) {
  var w = win || (typeof window !== 'undefined' ? window : {});
  if (!gl || !FIELD_RAMPS[theme] || w.__RAW_DISABLE_WIND_FIELD_RAMP__ === true) return null;
  var data = generateRampData(maxSpeed || 50, resolveFieldRamp(theme, w)), prev = gl.getParameter(gl.TEXTURE_BINDING_2D), tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.bindTexture(gl.TEXTURE_2D, prev);
  return tex;
}

// KILL SWITCH for the low-band respread (added late — shipping palette constants without one
// violated the every-lever-kill-switched rule): __RAW_DISABLE_WIND_LOWBAND_RESPREAD__ = true
// restores the pre-respread low stops (effective on the next ramp regeneration: theme change or
// reload). Only the rows that changed are listed.
var LEGACY_LOW_STOPS = {
  beach: { 0: [0, 1.00, 0.35, 0.75, 0.75] },
  light: { 0: [0, 0.16, 0.10, 0.42, 0.72], 1: [3, 0.06, 0.20, 0.48, 0.75] },
  dark: { 0: [0, 0.35, 0.45, 1.00, 0.80] },
};

export function resolveThemeRamp(theme) {
  var ramp = midbandRefined(THEME_RAMPS[theme] || DEFAULT_WIND_RAMP, 'particle', theme, typeof window !== 'undefined' ? window : null);
  var killed = typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_LOWBAND_RESPREAD__ === true;
  if (!killed) return ramp;
  var legacy = LEGACY_LOW_STOPS[theme] || LEGACY_LOW_STOPS.dark;
  return ramp.map(function(stop, i) { return legacy[i] ? legacy[i].slice() : stop; });
}

/**
 * LEGEND, DERIVED FROM THE SHIPPED RAMP (2026-08-09, R11-11 item 2).
 *
 * ⛔ THE DEFECT THIS DELETES: MapWeatherControls carried a hand-maintained CSS duplicate of this
 * table, one gradient per theme. Measured 2026-08-09, the dark one was a BYTE-EXACT copy of the
 * legacy 8-stop 0-50 kn `DEFAULT_WIND_RAMP` — `[0,.60,.85,1.00,.85]` -> `rgba(153,217,255,0.85)`
 * and all seven siblings — even though `DEFAULT_WIND_RAMP = DARK_WIND_RAMP` (13 Beaufort stops to
 * 75 kn) replaced it in the Beaufort rework. Its comment claimed "Gradient matches WindColorRamp.js
 * stops" while it had not for weeks.
 * ★★★ THE CONSEQUENCE WAS AN INVERTED READING, not a cosmetic drift: the shipped dark ramp paints
 * CALM as vivid magenta (0.90, 0.00, 1.00), and magenta on the stale legend sat at the far-right
 * HURRICANE end. A user seeing magenta read the legend and concluded hurricane while looking at
 * dead calm. A duplicate of a palette is a second source of truth, and the copy loses silently
 * because nothing renders it side by side.
 *
 * Positions are VALUE-PROPORTIONAL (kn / max), because the bar is drawn with equal-width CSS stops
 * otherwise — R11-11 item 3, the same defect one level down.
 */
export function windLegendGradientCSS(theme) {
  var ramp = resolveThemeRamp(theme);
  var max = ramp[ramp.length - 1][0] || 1;
  var css = ramp.map(function (s) {
    return 'rgba(' + Math.round(s[1] * 255) + ',' + Math.round(s[2] * 255) + ','
      + Math.round(s[3] * 255) + ',' + s[4] + ') ' + ((s[0] / max) * 100).toFixed(1) + '%';
  });
  return 'linear-gradient(to right, ' + css.join(', ') + ')';
}

/**
 * Tick labels at EQUAL VALUE INTERVALS, because the row that renders them is `justify-between` —
 * equally spaced on screen. The old list was ['0','5','15','30','50+']: unequal values under equal
 * spacing, so every interior label sat over the wrong colour, and the scale ended at 50 while the
 * ramp runs to 75 (hurricane force was unlabelled entirely).
 */
export function windLegendStops(theme, count) {
  var ramp = resolveThemeRamp(theme);
  var max = ramp[ramp.length - 1][0] || 1;
  var n = Math.max(2, count || 6);
  var out = [];
  for (var i = 0; i < n; i++) {
    var v = Math.round((max * i) / (n - 1));
    out.push(i === n - 1 ? v + '+' : String(v));
  }
  return out;
}

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
  var stops = ramp || (theme ? resolveThemeRamp(theme) : DEFAULT_WIND_RAMP);
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
