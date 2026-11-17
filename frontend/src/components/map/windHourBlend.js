/**
 * THE HOUR BLEND for the wind field. 2026-11-15 (the owner: "Yes, blend them").
 *
 * An hour step replaced the engine's base wind texture: the old one was freed, the new hour encoded in its place, and the next
 * frame drew the new hour whole. Now the outgoing base texture is KEPT for WIND_BLEND_MS with its own bounds, point
 * registration and u/v range, and the three shaders that read the base (the particle advection, the particle draw, the colour
 * field) mix the u/v VECTORS of the two fields, each decoded with its own range. The particles are advected through the mixed
 * field; nothing is cross-faded in colour and no trail is touched. At rest exactly one served hour is read and the earlier
 * texture is freed. Display only: no byte of any frame changes.
 *
 * This is NOT the base / fine-overlay rule (windGridsCompatible: "never blend two hours or two models"), which stands: a base
 * and an overlay of different hours never composite. It is a short blend between the OUTGOING base and the NEW base.
 *
 * OFF BY DEFAULT (the owner, 2026-11-15: "it stays OFF until" the real-frame hidden-hour test and his blinded look are done).
 * It runs only with window.__RAW_ENABLE_HOUR_BLEND__ === true set before the app loads (one name for the marine and the wind
 * blend: one behaviour). Merging this turns nothing on.
 * No blend (the hard swap, as before) when: the opt-in is not set; the kill is set; the visitor prefers reduced motion; the
 * device is below the blend's texture limits or its driver refused the blended shaders (the plain shaders are compiled, and
 * it is counted: fallbacks); the model changes; there was no base; the same hour is committed again on the same grid.
 * Several commits before one drawn frame keep the field that is ON SCREEN. A step inside a running blend restarts it from the
 * field being replaced.
 *
 * Kill: window.__RAW_DISABLE_WIND_HOUR_BLEND__ = true (set before the shaders load, they are the text they were:
 * windHourBlendGLSL.js). Lab only: window.__RAW_WIND_BLEND_MS__, window.__RAW_WIND_BLEND_HOLD__ (0..1).
 * Telemetry: window.__RAW_WIND_HOUR_BLEND__. Gate: docs/weather-program/log/2026-11-15-fable-wind-hour-blend.md.
 */
import { gridPointReg } from './gridPointRegistration';
import { windHourBlendEnabled } from './windHourBlendGLSL';

export const WIND_BLEND_MS = 160;      // the rasters' and the marine blend's: every layer steps alike
export const FRAME_MS = 8;             // calls closer than this belong to one drawn frame (half a 60 Hz frame)
export const WIND_PREV_UNIT = 7;       // the earlier field's texture unit in all three programs (0-3 are in use there)

const W = () => (typeof window !== 'undefined' ? window : {});
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** The blend's duration in ms; 0 = no blend. */
export function windBlendMs(w = W()) {
  if (!windHourBlendEnabled(w)) return 0;
  try { if (w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0; } catch (e) { /* no matchMedia */ }
  const o = Number(w.__RAW_WIND_BLEND_MS__);
  return w.__RAW_WIND_BLEND_MS__ != null && Number.isFinite(o) && o >= 0 ? o : WIND_BLEND_MS;
}

/** Progress 0..1 eased (smoothstep). */
export function windBlendEase(t) { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); }

const tel = () => {
  const w = W();
  return w.__RAW_WIND_HOUR_BLEND__ || (w.__RAW_WIND_HOUR_BLEND__ = { starts: 0, gridSwaps: 0, restarts: 0, kept: 0, ends: 0, errors: 0, fallbacks: 0, fallbackWhy: null, skips: {}, mix: 0, last: null });
};
const skip = (why) => { const t = tel(); t.skips[why] = (t.skips[why] || 0) + 1; return why; };

const modelOf = (g) => (g && (g.source || (g.truthTag && g.truthTag.model))) || null;   // as WebGLWindEngine.windGridModel
const timeOf = (g) => (g ? String(g.valid_time || g.validTime || g.hourOffset || 0) : '');
const sameBounds = (a, b) => !!a && !!b && a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north;
const sameGrid = (a, b) => !!a && !!b && a.cols === b.cols && a.rows === b.rows && sameBounds(a.bounds, b.bounds);

/** Why this base replacement must NOT be blended, or null when it may. Pure. `old` and `next` are wind grids. */
export function windBlendVerdict(old, next) {
  if (!old || !next || !old.bounds || !next.bounds) return 'no_grid';
  const mo = modelOf(old); const mn = modelOf(next);
  if (!mo || !mn || mo !== mn) return 'model_differs';
  if (sameGrid(old, next) && timeOf(old) === timeOf(next)) return 'same_hour';
  return null;
}

export const WIND_BLEND_VERTEX_UNITS = 4;   // the particle draw's VERTEX shader samples particles, base, overlay and the earlier base

/**
 * Why this device cannot run the blended shaders, or null when it can. Unit WIND_PREV_UNIT must exist, and the particle
 * draw samples WIND_BLEND_VERTEX_UNITS textures in its vertex shader (WebGL2 guarantees 16 vertex units; WebGL1 may have 0).
 */
export function windBlendDeviceVerdict(gl) {
  try {
    const combined = Number(gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS));
    const vertex = Number(gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS));
    if (!(combined > WIND_PREV_UNIT)) return 'combined_units';
    if (!(vertex >= WIND_BLEND_VERTEX_UNITS)) return 'vertex_units';
    return null;
  } catch (e) { return 'limits_unreadable'; }
}

/** The engine compiled the PLAIN shaders although the blend was asked for: count it, with the reason. */
export function noteWindBlendFallback(why) { const t = tel(); t.fallbacks += 1; t.fallbackWhy = why; }

/** Free the kept texture and forget the earlier field. */
export function releaseWindPrev(engine, gl) {
  const p = engine && engine._windPrev;
  if (!p) return;
  engine._windPrev = null;
  try { if (gl && p.texture) gl.deleteTexture(p.texture); } catch (e) { /* a lost context */ }
}

/** Teardown, an emptied layer, a lost context: no blend and no kept texture. */
export function disposeWindBlend(engine, gl) {
  if (!engine) return;
  engine._windBlend = null; tel().mix = 0;
  releaseWindPrev(engine, gl);
}

/**
 * Call where the base wind texture is about to be FREED because another grid replaces it. Returns true when the texture has
 * been KEPT as the earlier field (the caller must then not delete it), false when the step is the hard swap it was.
 * Never throws.
 */
export function keepOutgoingWindBase(engine, gl, nextGrid) {
  const t = tel();
  try {
    const ms = windBlendMs();
    const old = engine && engine._windData;
    if (!ms) { engine._windBlend = null; t.mix = 0; skip('off'); return false; }
    if (engine._windBlendShaders !== true) { engine._windBlend = null; t.mix = 0; skip('no_shaders'); return false; }   // the plain shaders are compiled
    if (!gl || !old || !old.texture || !old.windGrid) { disposeWindBlend(engine, gl); skip('no_base'); return false; }
    const why = windBlendVerdict(old.windGrid, nextGrid);
    if (why) { engine._windBlend = null; t.mix = 0; skip(why); return false; }
    // Several commits before one drawn frame: the base being replaced was never drawn, so the field ON SCREEN, already kept,
    // stays as the earlier one and this texture is freed by the caller as before.
    if (engine._windBlend && !engine._windBlend.t0 && engine._windPrev) { t.kept += 1; return false; }
    releaseWindPrev(engine, gl);
    const g = old.windGrid;
    engine._windPrev = { texture: old.texture, uMin: old.uMin, uMax: old.uMax, bounds: { ...old.bounds }, cols: g.cols, rows: g.rows, reg: gridPointReg(g), validTime: timeOf(g) };
    if (engine._windBlend) t.restarts += 1;
    engine._windBlend = { t0: 0, ms };   // the clock starts at the first frame that draws the new field
    t.starts += 1; if (!sameGrid(g, nextGrid)) t.gridSwaps += 1;
    t.last = { model: modelOf(nextGrid), from: timeOf(g), to: timeOf(nextGrid), ms, gridSwap: !sameGrid(g, nextGrid) };
    return true;
  } catch (e) {
    t.errors += 1; if (engine) engine._windBlend = null;
    return false;
  }
}

/** How much of the EARLIER field to draw this frame: 1 falling to 0. Starts the clock on its first call after a step. */
export function windPrevMix(engine, at = nowMs()) {
  const b = engine && engine._windBlend;
  if (!b || !engine._windPrev) return 0;
  const t = tel();
  if (!windBlendMs()) { engine._windBlend = null; t.mix = 0; return 0; }
  const hold = W().__RAW_WIND_BLEND_HOLD__;
  if (hold != null && Number.isFinite(Number(hold))) { t.mix = 1 - Math.min(1, Math.max(0, Number(hold))); return t.mix; }
  if (!b.t0) b.t0 = at;
  // ONE weight per frame (2026-11-16, the gate's read-back): the three passes of a frame each call this, a fraction of a
  // millisecond apart, and each got its own weight, so the particles moved through a field a hair different from the one
  // coloured. A call within FRAME_MS of the last computed weight reuses it.
  if (b.at != null && at >= b.at && at - b.at < FRAME_MS) return b.mix;
  const p = (at - b.t0) / b.ms;
  if (!(p < 1)) { engine._windBlend = null; t.ends += 1; t.mix = 0; return 0; }
  b.at = at; b.mix = 1 - windBlendEase(p);
  t.mix = b.mix;
  return t.mix;
}

const span = (b) => (b.east < b.west ? b.east + 360 : b.east) - b.west;
/** [scale.x, scale.y, offset.x, offset.y]: this grid's uv -> the earlier grid's uv (both are linear in longitude and latitude). */
export function windPrevUvMap(cur, prev) {
  const cs = span(cur); const ps = span(prev); const cv = cur.north - cur.south; const pv = prev.north - prev.south;
  if (!(cs > 0) || !(ps > 0) || !(cv > 0) || !(pv > 0)) return [1, 1, 0, 0];
  return [cs / ps, cv / pv, (cur.west - prev.west) / ps, (cur.south - prev.south) / pv];
}

/**
 * One of the three passes that read the BASE field, each frame: set the mix and, while a step blends, bind the earlier field
 * and say where it lies and how it is scaled. `mix` may be forced (the fine overlay's own pass draws with 0).
 */
export function setWindBlendUniforms(gl, engine, program, forceMix) {
  if (engine._windBlendShaders !== true) return;   // the plain shaders: no such uniforms, nothing kept
  const p = engine._windPrev; const base = engine._windData;
  const mix = forceMix != null ? forceMix : (p && base ? windPrevMix(engine) : 0);
  gl.uniform1f(gl.getUniformLocation(program, 'u_windPrevMix'), mix);
  if (mix > 0 && p && base) {
    gl.activeTexture(gl.TEXTURE0 + WIND_PREV_UNIT); gl.bindTexture(gl.TEXTURE_2D, p.texture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_windPrev'), WIND_PREV_UNIT);
    gl.uniform2f(gl.getUniformLocation(program, 'u_windPrev_min'), p.uMin[0], p.uMin[1]);
    gl.uniform2f(gl.getUniformLocation(program, 'u_windPrev_max'), p.uMax[0], p.uMax[1]);
    const m = windPrevUvMap(base.bounds, p.bounds);
    gl.uniform4f(gl.getUniformLocation(program, 'u_windPrevMap'), m[0], m[1], m[2], m[3]);
    gl.uniform4f(gl.getUniformLocation(program, 'u_windPrev_reg'), p.reg[0], p.reg[1], p.reg[2], p.reg[3]);
  } else if (forceMix == null && p && !engine._windBlend) {
    releaseWindPrev(engine, gl);   // the blend is over: the kept texture is freed here
  }
}
