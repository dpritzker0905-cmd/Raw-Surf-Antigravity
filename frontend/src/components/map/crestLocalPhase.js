/**
 * crestLocalPhase.js: the wave-train band (crest envelope, foam roll, orbital pitch) in LOCAL coordinates with a fixed period
 * bank. ON by default; kill window.__RAW_DISABLE_CREST_LOCAL_PHASE__ = true draws DRAW_VS's old phase exactly.
 *
 * THE DEFECT (L4, 2026-11-02, WebGLMarineParticleShaders.js DRAW_VS): phase = fract(dot(p, d(p)) F(T(p)) - t m / T(p)) with p the
 * ABSOLUTE Mercator position (0..1 across the world) and t the seconds since load. Its gradient is
 *     grad phase = F d + (p.d) grad F + F (grad d)^T p - t m grad(1/T),
 * so wherever the period or the heading varies the last three terms swamp the first: on a real GFS-Wave North Pacific field
 * |grad phase| / F was p50 4.2 (p90 15.5), 37 deg (p50) off the swell, and the time term added 5.9 F after a minute and 59 F after
 * ten (the bands shear, then shimmer). #404's "band speed = T/10 at every zoom" held only in uniform fields (its tests).
 *
 * THE FIX:
 * - p - c, with c the particle tile's centre (the camera-centred advection tile, when it is narrower than the world), or a view
 *   anchor (z <= 4, where the tile is the world: the camera centre, re-anchored when it drifts half of 2^-(floor z - 1) away).
 *   x is wrapped to the nearest copy, so the antimeridian no longer cuts the phase in half. When c moves (a re-anchor, which also
 *   reseeds the particles) the envelope cross-fades from the old anchor to the new one over CREST_ANCHOR_FADE_S.
 * - A bank of fixed period classes T_j = 4 s * 2^(j/4), j = 0..10 (4 to 22.6 s). A crest draws the two classes either side of
 *   its period, cross-faded by where T sits between them. Within a class F and T are constants, so the grad F and grad(1/T) terms
 *   are gone: |grad phase| = F_j |d + (grad d)^T (p - c)|, and no time shear can build up.
 * - Each class's time phase theta_j = integral of m dt / max(2, T_j) is integrated on the CPU (double precision) and wrapped to
 *   [0, 1), so it stays bounded and a zoom (which changes m) changes the band SPEED, not its position.
 * - #404's proportional zoom factor is kept: F_j = waveSetFreq(T_j, view width) (waveSetScreenBound.js), so spacing stays
 *   proportional to T^2 and band speed to T in every view: the period cue.
 */
import { uniformLoc } from './glUniformCache';

export const CREST_LOCAL_PHASE_KILL = '__RAW_DISABLE_CREST_LOCAL_PHASE__';
export const CREST_CLASS_T0 = 4;           // s, the shortest class
export const CREST_CLASSES_PER_OCTAVE = 4;
export const CREST_CLASS_COUNT = 11;       // 4 s .. 22.6 s (the GPU period encoding tops out at 20 s)
export const CREST_ANCHOR_FADE_S = 1.5;
export const crestClassPeriod = (j) => CREST_CLASS_T0 * 2 ** (j / CREST_CLASSES_PER_OCTAVE);

// Set before the map loads, the kill leaves DRAW_VS's text exactly as before (CREST_PHASE_SPLICE); set later, u_crestLocal = 0.
const WIN = typeof window === 'undefined' ? {} : window;
export const CREST_LOCAL_AT_LOAD = WIN[CREST_LOCAL_PHASE_KILL] !== true;
const winOf = (w) => (w !== undefined ? w : (typeof window !== 'undefined' ? window : null));
export function crestLocalPhaseOn(win) { const w = winOf(win); return CREST_LOCAL_AT_LOAD && !(w && w[CREST_LOCAL_PHASE_KILL] === true); }

const N = CREST_CLASS_COUNT, NM1 = (N - 1).toFixed(1), NM2 = (N - 2).toFixed(1);
// GLSL, spliced into DRAW_VS after WAVE_SET_GLSL (it calls waveSetFreq). Returns (band 0..1, phase 0..1).
const LOCAL_GLSL = ` uniform float u_crestLocal; uniform vec4 u_crestAnchor; uniform float u_crestAnchorMix; uniform float u_crestClassPhase[${N}];
float crestBandOf(float ph) { return 1.0 - smoothstep(0.08, 0.30, abs(fract(ph) - 0.5)); }
vec2 crestLocalOf(vec2 p, vec2 c) { vec2 d = p - c; d.x = d.x - floor(d.x + 0.5); return d; }
vec2 crestLocalBand(vec2 p, vec2 dir, float T, float w) {
  float j = clamp(log2(max(T, 1.0) / ${CREST_CLASS_T0.toFixed(1)}) * ${CREST_CLASSES_PER_OCTAVE.toFixed(1)}, 0.0, ${NM1});
  float j0 = min(floor(j), ${NM2}); float a = j - j0; int i0 = int(j0);
  float f0 = waveSetFreq(${CREST_CLASS_T0.toFixed(1)} * exp2(j0 / ${CREST_CLASSES_PER_OCTAVE.toFixed(1)}), w);
  float f1 = waveSetFreq(${CREST_CLASS_T0.toFixed(1)} * exp2((j0 + 1.0) / ${CREST_CLASSES_PER_OCTAVE.toFixed(1)}), w);
  float th0 = u_crestClassPhase[i0]; float th1 = u_crestClassPhase[i0 + 1];
  float sc = dot(crestLocalOf(p, u_crestAnchor.xy), dir); float sp = dot(crestLocalOf(p, u_crestAnchor.zw), dir);
  float bc = mix(crestBandOf(sc * f0 - th0), crestBandOf(sc * f1 - th1), a);
  float bp = mix(crestBandOf(sp * f0 - th0), crestBandOf(sp * f1 - th1), a);
  return vec2(mix(bp, bc, u_crestAnchorMix), a < 0.5 ? fract(sc * f0 - th0) : fract(sc * f1 - th1));
}`;
const VIEW_W = '(u_viewport.x / dpr) / (512.0 * exp2(u_zoom))';
const ON = CREST_LOCAL_AT_LOAD;
/** DRAW_VS's splice points (on: the local band; killed at load: the old text verbatim). */
export const CREST_PHASE_SPLICE = {
  decl: ON ? LOCAL_GLSL : '',
  dir0: ON ? ' vec2 dir0 = dir;   // dir0: the swell heading, before any jitter (crestLocalPhase.js)' : '',
  orbPhase: ON ? `mix(fract(dot(global_pos, dir) * sf - ts), crestLocalBand(global_pos, dir0, pv, ${VIEW_W}).y, step(0.5, u_crestLocal))`
    : 'fract(dot(global_pos, dir) * sf - ts)',
  vPhase: ON ? `  vec2 localBand = crestLocalBand(global_pos, dir0, periodVal, ${VIEW_W});   // local coords + period bank (crestLocalPhase.js)
`
    + '  v_phase = u_crestLocal > 0.5 ? localBand.y : trainPhase;' : '  v_phase = trainPhase;',
  crestBand: ON ? '  float crestBand = u_crestLocal > 0.5 ? localBand.x : 1.0 - smoothstep(0.08, 0.30, abs(train - 0.5));'
    : '  float crestBand = 1.0 - smoothstep(0.08, 0.30, abs(train - 0.5));',
};
export const CREST_LOCAL_PHASE_GLSL = CREST_PHASE_SPLICE.decl;

export function createCrestPhaseState() {
  return { theta: new Float64Array(N), lastT: null, cur: null, prev: null, fadeStart: -Infinity, mix: 1 };
}
const wrapDx = (dx) => dx - Math.round(dx);

/** The anchor for this frame: the particle tile's centre when the tile is narrower than the world, else a view anchor. */
export function crestAnchorFor(state, { tileCenter, tileWidth, cx, cy, zoom }) {
  if (tileCenter && Number.isFinite(tileCenter[0]) && tileWidth < 1) return [tileCenter[0], tileCenter[1]];
  const s = 2 ** -Math.max(0, Math.floor(zoom || 0) - 1), cur = state.cur;
  if (cur && Math.abs(wrapDx(cx - cur[0])) <= s / 2 && Math.abs(cy - cur[1]) <= s / 2) return cur;
  return [cx, cy];
}

/** Advance the class phases by this frame's dt (clamped: a hidden tab does not jump the bands) and track the anchor. */
export function stepCrestPhase(state, nowSec, motionScale, anchor) {
  const dt = state.lastT === null ? 0 : Math.min(0.25, Math.max(0, nowSec - state.lastT));
  state.lastT = nowSec;
  const m = Number.isFinite(motionScale) ? motionScale : 1;
  for (let j = 0; j < N; j++) state.theta[j] = (state.theta[j] + (dt * m) / Math.max(2, crestClassPeriod(j))) % 1;
  if (!state.cur) { state.cur = anchor; state.prev = anchor; }
  else if (anchor[0] !== state.cur[0] || anchor[1] !== state.cur[1]) {
    if (state.mix >= 0.5) state.prev = state.cur;   // mid-fade, the weaker anchor is replaced
    state.cur = anchor; state.fadeStart = nowSec;
  }
  const t = Math.min(1, Math.max(0, (nowSec - state.fadeStart) / CREST_ANCHOR_FADE_S));
  state.mix = t * t * (3 - 2 * t);
  return state;
}

/** Per draw, from the engine: steps the state kept on the engine and sets the uniforms CREST_LOCAL_PHASE_GLSL reads. */
export function applyCrestPhaseUniforms(gl, program, engine, frame) {
  const on = crestLocalPhaseOn();
  gl.uniform1f(uniformLoc(gl, program, 'u_crestLocal'), on ? 1 : 0);
  if (!on) return null;
  const s = engine._crestPhase || (engine._crestPhase = createCrestPhaseState());
  stepCrestPhase(s, frame.time, frame.motionScale, crestAnchorFor(s, frame));
  gl.uniform4f(uniformLoc(gl, program, 'u_crestAnchor'), s.cur[0], s.cur[1], s.prev[0], s.prev[1]);
  gl.uniform1f(uniformLoc(gl, program, 'u_crestAnchorMix'), s.mix);
  gl.uniform1fv(uniformLoc(gl, program, 'u_crestClassPhase[0]') || uniformLoc(gl, program, 'u_crestClassPhase'), Float32Array.from(s.theta));
  return s;
}

/** JS mirrors (tests, docs). waveSetFreq is passed in so this module does not depend on the screen-bound one. */
export function legacyCrestPhase(p, dir, T, t, m, freq) {
  return (p[0] * dir[0] + p[1] * dir[1]) * freq(T) - (t * m) / Math.max(2, T);
}
export function localCrestBand(p, dir, T, state, freq) {
  const j = Math.min(N - 1, Math.max(0, Math.log2(Math.max(T, 1) / CREST_CLASS_T0) * CREST_CLASSES_PER_OCTAVE));
  const j0 = Math.min(Math.floor(j), N - 2), a = j - j0;
  const band = (ph) => { const x = Math.abs((ph - Math.floor(ph)) - 0.5); const u = Math.min(1, Math.max(0, (x - 0.08) / 0.22)); return 1 - u * u * (3 - 2 * u); };
  const at = (c) => { let dx = p[0] - c[0]; dx -= Math.floor(dx + 0.5); const s = dx * dir[0] + (p[1] - c[1]) * dir[1]; return s; };
  const f0 = freq(crestClassPeriod(j0)), f1 = freq(crestClassPeriod(j0 + 1));
  const sc = at(state.cur), sp = at(state.prev);
  const bc = (1 - a) * band(sc * f0 - state.theta[j0]) + a * band(sc * f1 - state.theta[j0 + 1]);
  const bp = (1 - a) * band(sp * f0 - state.theta[j0]) + a * band(sp * f1 - state.theta[j0 + 1]);
  return { band: (1 - state.mix) * bp + state.mix * bc, phase: a < 0.5 ? sc * f0 - state.theta[j0] : sc * f1 - state.theta[j0 + 1], j0, a };
}
