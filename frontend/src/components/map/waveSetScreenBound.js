/**
 * Screen-bounded wave sets (2026-10-19, the nightly's SETTLED_STEP, owner: "fix the flicker at settled high zoom").
 *
 * The crest shader's wave-train envelope (and the foam roll and orbital pitch that share its phase) is
 *   fract(dot(global_pos, dir) * spatialFreq - t / T),   spatialFreq = clamp(800 / T^2, floor, 25)   per Mercator world unit,
 * so one set spans a fixed fraction of the WORLD. Zoomed in (z 12-15 the view is 0.2-0.02 deg wide) the whole view sits inside
 * one set, every crest on screen fades between 0.25 and 1.0 alpha together with the swell period, and the screen pulses: the
 * live probe measured a smooth 120 <-> 200 luminance oscillation with a ~10 s period at z 14 (#397).
 *
 * #397 held >= WAVE_SET_MIN_IN_VIEW sets across the view PER PERIOD: spatialFreq = max(f(T), minSets / viewWorldWidth). That
 * stopped the pulse but, from z 4, gave every period the same spacing, so the band speed 1 / (T * spatialFreq) went as 1/T:
 * chop raced and groundswell crawled (relative to a 10 s swell: 1.67 at 6 s down to 0.50 at 20 s; deep water says 0.60..2.00).
 *
 * Proportional sets (2026-10-20): ONE zoom factor for every period,
 *   spatialFreq = clamp(800 / T^2, F_FLOOR, 25) * k,   k = max(1, minSets / (viewWorldWidth * F_FLOOR)),
 * with F_FLOOR = 800 / T_MAX^2, the spacing of the longest period kept in order (T_MAX = 20 s, also the ceiling of the GPU
 * period encoding, waveData.a * 20). The clamp never binds inside 6-20 s, so spacing stays proportional to T^2 and band speed
 * to T in every view; k only rescales the whole family so the longest period still shows >= minSets sets (the anti-pulse
 * bound holds for every period, since shorter periods show more). The old floor 3 (= at least 3 sets per WORLD) flattened
 * 16.3-20 s even at world zoom; the on-screen minimum it stood in for now lives in k, per view.
 * Where k = 1 (a view at least minSets / F_FLOOR = 1.5 worlds wide) periods up to 16.3 s are byte-identical to before.
 *
 * Kills (set before the map loads, or before the next draw):
 *   window.__RAW_DISABLE_PROPORTIONAL_WAVE_SETS__ = true   -> #397 exactly (per-period max, floor 3)
 *   window.__RAW_DISABLE_SCREEN_BOUNDED_WAVE_SETS__ = true -> no screen bound (k = 1; with both set, pre-#397 exactly)
 */
import { uniformLoc } from './glUniformCache';
export const WAVE_SET_MIN_IN_VIEW = 3;
export const WAVE_SET_T_MAX = 20;                                      // s, longest period whose spacing/speed stay in order
export const WAVE_SET_F_K = 800;                                       // spatialFreq = F_K / T^2 per world unit
export const WAVE_SET_F_CAP = 25;                                      // shortest set = 1/25 world (T < 5.66 s share it)
export const WAVE_SET_F_FLOOR = WAVE_SET_F_K / (WAVE_SET_T_MAX * WAVE_SET_T_MAX);   // 2.0: the set spacing of T_MAX
const LEGACY_F_FLOOR = 3;                                              // #397 and before

const glslNum = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
// GLSL, spliced into DRAW_VS's uniform block. viewWorldWidth = CSS viewport width / (512 * 2^zoom) Mercator units.
export const WAVE_SET_GLSL = 'uniform float u_minSetsInView; uniform float u_proportionalSets; '
  + 'float waveSetFreq(float T, float viewWorldWidth) { '
  + `float f = ${glslNum(WAVE_SET_F_K)} / max(36.0, T * T); float w = max(viewWorldWidth, 1e-7); `
  // k = max(1, minSets / (w * floor)) is already 1 when the screen bound is killed (minSets = 0)
  + `if (u_proportionalSets > 0.5) return clamp(f, ${glslNum(WAVE_SET_F_FLOOR)}, ${glslNum(WAVE_SET_F_CAP)})`
  + ` * max(1.0, u_minSetsInView / (w * ${glslNum(WAVE_SET_F_FLOOR)})); `
  + `f = clamp(f, ${glslNum(LEGACY_F_FLOOR)}, ${glslNum(WAVE_SET_F_CAP)}); `
  + 'return u_minSetsInView > 0.0 ? max(f, u_minSetsInView / w) : f; }';

const flag = (name) => typeof window !== 'undefined' && window[name] === true;
export function minSetsInView() { return flag('__RAW_DISABLE_SCREEN_BOUNDED_WAVE_SETS__') ? 0 : WAVE_SET_MIN_IN_VIEW; }
export function proportionalSets() { return !flag('__RAW_DISABLE_PROPORTIONAL_WAVE_SETS__'); }
/** Both wave-set uniforms for the draw program (read per draw, so a kill takes effect on the next frame). */
export function applyWaveSetUniforms(gl, program) {
  gl.uniform1f(uniformLoc(gl, program, 'u_minSetsInView'), minSetsInView());
  gl.uniform1f(uniformLoc(gl, program, 'u_proportionalSets'), proportionalSets() ? 1 : 0);
}

/** JS mirror of the GLSL, for tests and diagnostics. */
export function viewWorldWidth(cssWidth, zoom) { return cssWidth / (512 * 2 ** zoom); }
export function screenBoundedSetFreq(f, worldWidth, minSets = WAVE_SET_MIN_IN_VIEW) {   // #397's per-period bound
  return minSets > 0 ? Math.max(f, minSets / Math.max(worldWidth, 1e-7)) : f;
}
export function waveSetZoomFactor(worldWidth, minSets = WAVE_SET_MIN_IN_VIEW) {
  return Math.max(1, minSets / (Math.max(worldWidth, 1e-7) * WAVE_SET_F_FLOOR));   // 1 when the bound is off (minSets = 0)
}
export function waveSetFreq(T, worldWidth, { minSets = WAVE_SET_MIN_IN_VIEW, proportional = true } = {}) {
  const f = WAVE_SET_F_K / Math.max(36, T * T);
  if (proportional) return Math.min(Math.max(f, WAVE_SET_F_FLOOR), WAVE_SET_F_CAP) * waveSetZoomFactor(worldWidth, minSets);
  return screenBoundedSetFreq(Math.min(Math.max(f, LEGACY_F_FLOOR), WAVE_SET_F_CAP), worldWidth, minSets);
}
/** Band speed in world units per second of shader time (phase = x * f - t / T). */
export function waveSetBandSpeed(T, worldWidth, opts) { return 1 / (T * waveSetFreq(T, worldWidth, opts)); }
