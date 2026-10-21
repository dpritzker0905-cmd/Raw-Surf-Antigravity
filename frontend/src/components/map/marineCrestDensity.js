// CREST DENSITY at mid-to-close zoom where the surf is big (owner 2026-10-20: "reduce the wave animation density ... only at areas
// where there are bigger surf ..., because bigger animations take over the screen"). A crest's area grows ~4x from 1 m to 4 m
// (DRAW_VS: halfLength 18 -> 40 px, halfThickness 3 -> 8 px by smoothstep(0.1, 4.0, h)) while the engine holds a constant on-screen
// seed count, so big seas fill the screen. This removes the share cut x smoothstep(2 m, 4 m, h) of the crests DRAW_VS keeps: nothing
// changes under 2 m, the full cut applies from 4 m.
// WHICH crests go is decided by a hash of its own (crestCutHash, Dave Hoskins' "hash without sine" over the particle's texel), not
// by lowering DRAW_VS's density threshold. That threshold is compared with particleHash = fract(sin(index x 12.9898) x 43758.5453),
// whose sine argument reaches ~1e6 for 296^2 particles: GPUs range-reduce it in float32, so the hash collapses onto a few hundred
// values (881 in a float32 emulation, one level holding 11% of the kept crests, ~5% of them exactly 0). Lowering the threshold
// therefore removed crests in steps: measured 2026-10-21 at z9 (scn_density_sweep.js, one session, beach and dark alike), seed
// cuts 0.22-0.28 all read -7% coverage, 0.31 read -18%, 0.34-0.45 all -22%; and where the steps fall moves with the threshold,
// i.e. with zoom and screen size. The second hash removes the asked share on any screen (emulated: 0.125 -> 0.125 +- 0.005 over
// random on-screen subsets, 0.11-0.15 within each level, so the crest-size mix, which follows particleHash, is kept). A removed
// crest's threshold goes negative, so it goes even where particleHash is exactly 0.
// Zooms where each theme's cut is full, read from the real basemaps (offline-backend/scn_label_zoom.js, 2026-10-20):
//   light (navigation-day-v1)   z5: state names spelled out in full (state-label steps from "CALIF." to "CALIFORNIA" at z5)
//   beach (outdoors-v11)        z6: the local coastal towns fill in (Santa Cruz, Salinas, San Luis Obispo, Santa Barbara)
//   dark  (navigation-night-v1) z8: two zooms closer than beach
// Each ramps in over the half zoom before it (no pop). Kill, set before page load: window.__RAW_DISABLE_CREST_DENSITY_ZOOM__ = true
// draws DRAW_VS byte for byte as before and sets no cut.
const WIN = typeof window === 'undefined' ? {} : window;
export const CREST_DENSITY_ZOOM_ON = WIN.__RAW_DISABLE_CREST_DENSITY_ZOOM__ !== true;
// cut: the share by which big-surf crests should cover LESS of the screen (owner: light 15-20%, beach 10-15%, dark as beach; the
// middle of each range), "as the eye sees it" (owner pick 2026-10-21: "Ship #428's density cut as the eye sees it
// (coverage-calibrated), fitted per theme").
export const CREST_DENSITY_CUT = { dark: { from: 8, cut: 0.125 }, light: { from: 5, cut: 0.175 }, beach: { from: 6, cut: 0.125 } };
export const CREST_DENSITY_HEIGHTS = [2.0, 4.0];   // metres: the cut ramps in from 2 m and is full from 4 m (crest size saturates at 4 m)
const THEMES = ['dark', 'light', 'beach'];          // the engine's themeVal: 0 dark, 1 light, 2 beach

// Crests overlap, so removing a share of them uncovers less of the screen than that share, and less where they already stack several
// deep (coverage ~ 1 - exp(-k (1 - cut)): small cuts barely move a saturated view, then bite faster). The cut that lowers each
// theme's crest coverage by its share, measured per theme and zoom in the real engine over the synthetic storm's big seas
// (scn_density_sweep.js + crest_coverage.py, 2026-10-21, cuts 0 / 0.1 / 0.2 / 0.3 / 0.4 / 0 in one session per theme, 20 s after
// each zoom jump, each cut against the no-cut coverage interpolated to its time): read off the measured curve between the cuts
// either side of the target (light z9, -15.0% at 0.4, extrapolated on its 0.3-0.4 slope; the overlap model says 0.46). z9 needs the
// most in every theme: there the storm's crests stack deepest (91-93% coverage, against 87-89% at z10.5 and 74-75% at z7.4). Each
// row's first point (the ramp's start) is the overlap model at ~70% big-surf coverage. Linear in zoom between points, held past the
// ends.
export const CREST_DENSITY_SEED_CUT = {
  light: [[5, 0.28], [7.4, 0.29], [9, 0.45], [10.5, 0.37]],
  beach: [[6, 0.22], [7.4, 0.23], [9, 0.32], [10.5, 0.26]],
  dark: [[8, 0.26], [8.25, 0.27], [9, 0.33], [10.5, 0.28]],
};

const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
/** The theme's seed cut at this zoom, from its measured row (linear between points, held at both ends). */
export function seedCutAt(theme, zoom) {
  const row = CREST_DENSITY_SEED_CUT[theme];
  if (zoom <= row[0][0]) return row[0][1];
  for (let i = 1; i < row.length; i++) {
    const [z1, s1] = row[i];
    if (zoom <= z1) { const [z0, s0] = row[i - 1]; return s0 + ((s1 - s0) * (zoom - z0)) / (z1 - z0); }
  }
  return row[row.length - 1][1];
}

/** The share of big-surf seeds to remove at this zoom, for the engine's themeVal (0 when off, or below the theme's ramp). */
export function crestDensityCut(themeVal, zoom, on = CREST_DENSITY_ZOOM_ON) {
  const theme = THEMES[Math.round(themeVal)], c = CREST_DENSITY_CUT[theme];
  if (!on || !c || !Number.isFinite(zoom)) return 0;
  const ramp = smoothstep(c.from - 0.5, c.from, zoom);
  // Measurement and tuning knob, read live each frame (like __RAW_PART_TARGET__): window.__RAW_CREST_DENSITY_SEED_CUT__ = 0.3
  // removes that share of big-surf seeds wherever the theme's ramp is on (scn_density_sweep.js calibrates with it).
  const live = WIN.__RAW_CREST_DENSITY_SEED_CUT__;
  if (typeof live === 'number' && Number.isFinite(live)) return Math.min(0.9, Math.max(0, live)) * ramp;
  return seedCutAt(theme, zoom) * ramp;
}

// DRAW_VS's two touch points: the uniform and the cut's hash (joined onto u_densityBase's line, global scope), and a term after the
// density threshold's clamp that drops a big-surf crest when its cut hash falls under the cut. Under the kill both are the shader's
// text from before, byte for byte.
const [H0, H1] = CREST_DENSITY_HEIGHTS.map((h) => h.toFixed(2));
export const CREST_CUT_HASH_GLSL = 'float crestCutHash(vec2 p) { vec3 p3 = fract(p.xyx * 0.1031); p3 = p3 + dot(p3, p3.yzx + 33.33); '
  + 'return fract((p3.x + p3.y) * p3.z); }';
export const crestDensityGlsl = (on = CREST_DENSITY_ZOOM_ON) => ({
  decl: on ? ` uniform float u_densityCut; ${CREST_CUT_HASH_GLSL}` : '',
  drop: on ? ` - 2.0 * (1.0 - step(u_densityCut * smoothstep(${H0}, ${H1}, waveHeight), crestCutHash(vec2(col, row))))` : '',
});
/** crestCutHash as the GPU computes it (float32 throughout): the share of crests a cut removes, for the tests and the docs. */
export function crestCutHash(col, row) {
  const f = Math.fround, fr = (x) => f(x - Math.floor(x));
  let [a, b, c] = [fr(f(col * f(0.1031))), fr(f(row * f(0.1031))), fr(f(col * f(0.1031)))];
  const d = f(f(f(a * f(b + f(33.33))) + f(b * f(c + f(33.33)))) + f(c * f(a + f(33.33))));
  [a, b, c] = [f(a + d), f(b + d), f(c + d)];
  return fr(f(f(a + b) * c));
}
export const CREST_DENSITY_GLSL = crestDensityGlsl();
