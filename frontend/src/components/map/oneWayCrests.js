/**
 * oneWayCrests.js: every marine dash moves WITH its swell (2026-11-12, the layer animation lane).
 *
 * THE REPORT. The owner, 2026-11-11: "I'm seeing opposing wave animations in all the marine layers". The diagnosis
 * (log 2026-11-11-claude-marine-motion-direction.md, marineMotionDirection.test.js section 4): no sign error anywhere. The
 * ORBITAL PITCH (window.__RAW_ORBITAL_PITCH__, 2.5 px, the default since 2026-07-01) swayed each dash forward under a crest and
 * BACKWARD under a trough at 0.7-2 px/s, faster than the dash's own drift (0.03-0.5 px/s), so 41-49 % of the dashes on screen
 * moved against the swell at any moment, in every marine layer and theme.
 *
 * NOW. The pitch default is 0 (NATURAL_ANIM_DEFAULTS, marineEngineDecisions.js): the DRAW_VS sway branch is skipped
 * (`if (u_orbitalPitch > 0.0001)`), the shader text is unchanged, and a dash's only along-swell motion is its drift and the
 * wave-train band sweeping over it, both toward FROM + 180. Nothing else moves: the band, the foam roll, the trochoidal
 * shape, the heading jitter, density, colours and every served number are as before.
 * Kill: window.__RAW_DISABLE_ONE_WAY_CRESTS__ = true (the 2.5 px sway, as before). An explicit window.__RAW_ORBITAL_PITCH__
 * number (the tuner's slider, the console) still wins, and window.__RAW_ANIM_LEGACY__ still reads 0.
 *
 * REDUCED MOTION (PR #786's checklist, item 8). prefers-reduced-motion already damped the dash DRIFT to 0.15x
 * (WebGLMarineEngine, 2026-07-03). The wave-train BAND kept its full speed, and the foam roll and (under the kill) the sway
 * ride the band's phase. The band's phase rate now takes the same 0.15x, so all four slow together.
 * Kill: window.__RAW_DISABLE_REDUCED_MOTION_BAND__ = true (the band at full speed under reduced motion, as before).
 * Not covered: with the local crest phase killed (__RAW_DISABLE_CREST_LOCAL_PHASE__) the legacy band reads u_time directly.
 *
 * WHAT THE SPEEDS ARE (checklist items 6, 11, 12; named here because the shader text is pinned byte for byte).
 *  - The BAND is the crest motion: one set spacing per T / m seconds, a phase-speed-like cue that scales with the peak period
 *    (waveSetScreenBound.waveSetFreq). It is a SCREEN rate, not c = gT / 2 pi in metres per second, and it carries no depth
 *    term: read it as a deep-water cue only.
 *  - The DASH DRIFT (ADVECT_FS: waveVec * min(H, 3 m) * 0.1 / cos(lat) * u_speed_scale) is a VISUAL rate that grows with
 *    height up to a cap. It is neither the group speed c_g nor the Stokes drift, and no label should call it either.
 */
import { resolveAnimValue } from './marineEngineDecisions';

export const ORBITAL_SWAY_PX = 2.5;            // the sway the kill restores (the 2026-07-01 Natural value)
export const REDUCED_MOTION_SCALE = 0.15;      // the drift's reduced-motion factor (WebGLMarineEngine), reused for the band
const PITCH = '__RAW_ORBITAL_PITCH__';
const W = () => (typeof window !== 'undefined' ? window : null);

export const oneWayCrestsOn = () => { const w = W(); return !(w && w.__RAW_DISABLE_ONE_WAY_CRESTS__ === true); };
export const reducedMotionBandOn = () => { const w = W(); return !(w && w.__RAW_DISABLE_REDUCED_MOTION_BAND__ === true); };

/** The orbital pitch (CSS px) the engine applies this frame. */
export function resolveOrbitalPitch() {
  const w = W();
  const value = resolveAnimValue(PITCH);
  if (oneWayCrestsOn() || !w) return value;
  // Killed: the old resolution order exactly (explicit number -> legacy 0 -> the 2.5 px Natural sway).
  if (typeof w[PITCH] === 'number' || w.__RAW_ANIM_LEGACY__ === true) return value;
  return ORBITAL_SWAY_PX;
}

let _mql = null;
/** prefers-reduced-motion, live (the MediaQueryList is kept; `.matches` follows the OS setting). Test override:
 *  window.__RAW_REDUCED_MOTION__ = true | false, the same override the engine's drift damp reads. */
export function prefersReducedMotion() {
  const w = W();
  if (!w) return false;
  if (typeof w.__RAW_REDUCED_MOTION__ === 'boolean') return w.__RAW_REDUCED_MOTION__;
  try {
    if (!_mql && typeof w.matchMedia === 'function') _mql = w.matchMedia('(prefers-reduced-motion: reduce)');
    return !!(_mql && _mql.matches);
  } catch (e) { return false; }
}

/** The motion scale the wave-train band's phase steps by: the engine's, damped under reduced motion. */
export function bandMotionScale(motionScale) {
  return reducedMotionBandOn() && prefersReducedMotion() ? motionScale * REDUCED_MOTION_SCALE : motionScale;
}

export function _resetOneWayCrestsForTest() { _mql = null; }
