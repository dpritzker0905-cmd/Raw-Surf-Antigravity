/**
 * Screen-bounded wave sets (2026-10-19, the nightly's SETTLED_STEP, owner: "fix the flicker at settled high zoom").
 *
 * The crest shader's wave-train envelope (and the foam roll and orbital pitch that share its phase) is
 *   fract(dot(global_pos, dir) * spatialFreq - t / T),   spatialFreq = clamp(800 / T^2, 3, 25)   per Mercator world unit,
 * so one set spans 1/25 to 1/3 of the WORLD (14-120 deg of longitude). Zoomed out, a view holds many sets and the envelope
 * reads as organised sets. Zoomed in (z 12-15 the view is 0.2-0.02 deg wide) the whole view sits inside one set, every crest
 * on screen fades between 0.25 and 1.0 alpha together with the swell period, and the screen pulses: the live probe measured a
 * smooth 120 <-> 200 luminance oscillation with a ~10 s period at z 14, no grid, mask or overlay change involved.
 *
 * Fix: hold at least WAVE_SET_MIN_IN_VIEW sets across the view (the same constant-screen-density principle the crest
 * density cull already follows). Where the view would hold fewer, the set frequency rises to minSets / viewWorldWidth. The
 * temporal period at a point stays T, so the motion keeps its character; only the spatial phase now varies across the screen.
 * Zoomed out (>= 3 sets in view) the look is byte-identical. Kill: window.__RAW_DISABLE_SCREEN_BOUNDED_WAVE_SETS__ = true.
 */
export const WAVE_SET_MIN_IN_VIEW = 3;

// GLSL, spliced into DRAW_VS's uniform block. viewWorldWidth = CSS viewport width / (512 * 2^zoom) Mercator units.
export const WAVE_SET_GLSL = 'uniform float u_minSetsInView; float screenBoundedSetFreq(float f, float viewWorldWidth) { return u_minSetsInView > 0.0 ? max(f, u_minSetsInView / max(viewWorldWidth, 1e-7)) : f; }';

export function minSetsInView() {
  return typeof window !== 'undefined' && window.__RAW_DISABLE_SCREEN_BOUNDED_WAVE_SETS__ === true ? 0 : WAVE_SET_MIN_IN_VIEW;
}

/** JS mirror of the GLSL, for tests and diagnostics. */
export function viewWorldWidth(cssWidth, zoom) { return cssWidth / (512 * 2 ** zoom); }
export function screenBoundedSetFreq(f, worldWidth, minSets = WAVE_SET_MIN_IN_VIEW) {
  return minSets > 0 ? Math.max(f, minSets / Math.max(worldWidth, 1e-7)) : f;
}
