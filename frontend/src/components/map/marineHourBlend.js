/**
 * THE HOUR BLEND for the marine colour field (waves, swell_1, swell_2, wind_waves). 2026-11-15.
 *
 * A step replaces the engine's ONE wave texture: another hour written into it in place (the commit's updateTexture, the
 * scrub's pool copy / byte upload), or another GRID allocated in its place (a coarse world grid, a finer one, a regional
 * one). The next drawn frame showed the new texture whole: a pop. Now the outgoing field is KEPT for CREST_BLEND_MS: copied
 * on the GPU before an in-place write, or simply not freed when a grid is replaced. The colour shader reads it at ITS OWN
 * place on the map (its own bounds, registration and height scale), mixes the two fields' VALUES (direction, height in
 * metres, period) and colours the result as before. At rest exactly one served field is drawn and the shader does not read
 * the earlier one. Display only: no byte of any frame changes and no served number is touched.
 *
 * OFF BY DEFAULT (the owner, 2026-11-15: "it stays OFF until" the hidden-hour test on real frames and his blinded look are
 * done). It runs only with window.__RAW_ENABLE_HOUR_BLEND__ === true set BEFORE the app loads (the shader text is added at
 * load: marineHourBlendGLSL.js). One opt-in name for the marine and the wind blend: one behaviour. Merging turns nothing on.
 *
 * No blend (the hard swap, as before) when: the opt-in is not set; the kill is set; the visitor prefers reduced motion; the model or the layer
 * changes; ratings are drawn (the score texture is not blended); the scrub shows a frame whose land / no-data mask differs
 * (its exact-mask path); the same hour is committed again on the same grid.
 *
 * Several steps before one drawn frame keep the field that is ON SCREEN. A step that lands inside a running blend restarts
 * it from the field being replaced (the part of the older one still showing is dropped in one frame).
 *
 * Kill: window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true.
 * Lab only: window.__RAW_CREST_BLEND_MS__ (duration), window.__RAW_CREST_BLEND_HOLD__ (0..1: hold a started blend at that
 * progress, to photograph it). Telemetry: window.__RAW_CREST_HOUR_BLEND__.
 * Gate and results: docs/weather-program/log/2026-11-15-fable-crest-hour-blend.md.
 */
import { createTexture } from './WebGLMarineTextureState';
import { safeDeleteTexture } from './WebGLWindUtils';
import { heightScaleOf } from './marineHeightEncoding';
import { gridPointReg } from './gridPointRegistration';
import { resolveLandAwareFetch } from './marineLandAwareFetch';
import { hourBlendEnabled, hourBlendShaderLoaded } from './marineHourBlendGLSL';

export const CREST_BLEND_MS = 160;   // the same as the own-frame rasters (ownRasterLayer BLEND_MS): every layer steps alike
export const HOUR_BLEND_UNIT = 7;    // the colour program's texture unit for the earlier field (0-4 are in use there)

const W = () => (typeof window !== 'undefined' ? window : {});
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** The blend's duration in ms; 0 = no blend. */
export function crestBlendMs(w = W()) {
  if (!hourBlendEnabled(w) || !hourBlendShaderLoaded()) return 0;   // opt-in, and only with the blend's shader text loaded
  try { if (w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0; } catch (e) { /* no matchMedia */ }
  const o = Number(w.__RAW_CREST_BLEND_MS__);
  return w.__RAW_CREST_BLEND_MS__ != null && Number.isFinite(o) && o >= 0 ? o : CREST_BLEND_MS;
}

/** Progress 0..1 eased (smoothstep: no velocity jump at either end). */
export function crestBlendEase(t) { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); }

const tel = () => {
  const w = W();
  return w.__RAW_CREST_HOUR_BLEND__ || (w.__RAW_CREST_HOUR_BLEND__ = { starts: 0, gridSwaps: 0, restarts: 0, kept: 0, ends: 0, errors: 0, skips: {}, mix: 0, last: null });
};
const skip = (why) => { const t = tel(); t.skips[why] = (t.skips[why] || 0) + 1; return why; };

const sameBounds = (a, b) => !!a && !!b && a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north;
export const sameGrid = (old, next) => !!old && !!next && old.cols === next.cols && old.rows === next.rows && sameBounds(old.bounds, next.bounds);

/**
 * Why this replacement must NOT be blended, or null when it may. Pure.
 * `old` is the grid on screen (engine._waveData.waveGrid); `next` describes what is about to replace it:
 * { cols, rows, bounds, model, layer, validTime, rating, maskDiffers }.
 */
export function hourBlendVerdict(old, next, oldRating) {
  if (!old || !next || !old.bounds || !next.bounds) return 'no_grid';
  if ((old.__sourceModel || 'GFS') !== (next.model || 'GFS')) return 'model_differs';
  if ((old.__componentLayer || 'waves') !== (next.layer || 'waves')) return 'layer_differs';
  if (oldRating || next.rating) return 'rating';
  if (next.maskDiffers) return 'mask_differs';
  if (sameGrid(old, next)) {
    const was = old.served_valid_time ?? old.valid_time ?? old.hourOffset; const is = next.validTime;
    if (was == null || is == null || String(was) === String(is)) return 'same_hour';
  }
  return null;
}

/** Free a kept (adopted) texture and forget the earlier field. */
function releasePrev(engine, gl) {
  const p = engine && engine._hourPrev;
  if (!p) return;
  engine._hourPrev = null;                                    // first: the veto in safeDeleteTexture reads it
  if (p.adopted) { try { safeDeleteTexture(gl, p.wave, null); } catch (e) { /* a lost context */ } }
}

/** Drop a running blend. The earlier field's texture is freed at the next frame or the next step. */
export function cancelHourBlend(engine) {
  if (engine && engine._hourBlend) { engine._hourBlend = null; tel().mix = 0; }
}

/** Free everything (teardown, context loss). */
export function disposeHourBlend(engine, gl) {
  if (!engine) return;
  engine._hourBlend = null; tel().mix = 0;
  releasePrev(engine, gl);
  if (engine._hourCopyTex) {
    try { safeDeleteTexture(gl, engine._hourCopyTex, null); } catch (e) { /* a lost context */ }
    engine._hourCopyTex = null; engine._hourCopyDims = null;
  }
}

/** What the shader needs to draw the outgoing field at its own place: taken from the engine BEFORE the replacement. */
function metaOf(engine) {
  const wd = engine._waveData; const g = wd.waveGrid;
  const la = resolveLandAwareFetch(g);
  return { cols: g.cols, rows: g.rows, bounds: { ...g.bounds }, reg: gridPointReg(g), scale: heightScaleOf(wd), landAware: !!la.on,
    validTime: String(g.served_valid_time ?? g.valid_time ?? g.hourOffset) };   // which hour is kept (read by the lab)
}

/** Shared entry: may this replacement be blended? Returns the reason it may not, 'keep' (the field on screen is already kept), or null. */
function gate(engine, gl, next, t) {
  const ms = crestBlendMs();
  if (!ms) { cancelHourBlend(engine); return skip('off'); }
  const wd = engine && engine._waveData; const tex = engine && engine._residentWaveTex;
  if (!gl || !wd || !tex || wd.u_waveTexture !== tex || !wd.waveGrid) { cancelHourBlend(engine); return skip('no_resident'); }
  const why = hourBlendVerdict(wd.waveGrid, next, !!wd.u_waveScoreTexture);
  if (why) { cancelHourBlend(engine); return skip(why); }
  // Several replacements before one drawn frame (a +3 h step is three commits): the resident was never drawn, so the field
  // that is ON SCREEN, already kept, stays as the earlier one.
  if (engine._hourBlend && !engine._hourBlend.t0 && engine._hourPrev) { t.kept += 1; return 'keep'; }
  return null;
}
const begin = (engine, t, next, ms, gridSwap) => {
  if (engine._hourBlend) t.restarts += 1;
  engine._hourBlend = { t0: 0, ms };   // the clock starts at the first frame that draws the new field
  t.starts += 1; if (gridSwap) t.gridSwaps += 1;
  t.last = { layer: next.layer || 'waves', model: next.model || 'GFS', to: String(next.validTime), ms, gridSwap: !!gridSwap };
};

/**
 * Call just BEFORE the resident wave texture is overwritten IN PLACE (same size). Copies the texture as it is (the field on
 * screen) into the earlier-field texture and starts the blend. Returns true when the step will blend. Never throws, and
 * leaves the GL state as it found it: on any doubt the step is the hard swap it was.
 */
export function beforeWaveOverwrite(engine, gl, next) {
  const t = tel();
  try {
    const g = gate(engine, gl, next, t);
    if (g === 'keep') return true;
    if (g) return false;
    const meta = metaOf(engine); const cols = meta.cols; const rows = meta.rows;
    if (engine._hourCopyTex && (!engine._hourCopyDims || engine._hourCopyDims.cols !== cols || engine._hourCopyDims.rows !== rows)) {
      safeDeleteTexture(gl, engine._hourCopyTex, null); engine._hourCopyTex = null;
    }
    if (!engine._hourCopyTex) {
      engine._hourCopyTex = createTexture(gl, gl.LINEAR, null, cols, rows);
      if (!engine._hourCopyTex) { cancelHourBlend(engine); skip('no_texture'); return false; }
      engine._hourCopyDims = { cols, rows };
    }
    const fb0 = gl.getParameter(gl.FRAMEBUFFER_BINDING); const tex0 = gl.getParameter(gl.TEXTURE_BINDING_2D);
    let ok = false;
    try {
      if (!engine._hourBlendFbo) engine._hourBlendFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, engine._hourBlendFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, engine._residentWaveTex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        gl.bindTexture(gl.TEXTURE_2D, engine._hourCopyTex);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cols, rows);   // the field on screen -> the earlier-field texture
        ok = true;
      }
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb0 || null); gl.bindTexture(gl.TEXTURE_2D, tex0 || null);
    }
    if (!ok) { cancelHourBlend(engine); skip('copy_failed'); return false; }
    releasePrev(engine, gl);
    // the land-flag texture is overwritten with the wave texture, so the copy keeps water-only weights only on an unchanged grid
    engine._hourPrev = { wave: engine._hourCopyTex, adopted: false, ...meta, landAware: meta.landAware && sameGrid(meta, next) };
    begin(engine, t, next, crestBlendMs(), !sameGrid(meta, next));
    return true;
  } catch (e) {
    t.errors += 1; cancelHourBlend(engine);
    return false;
  }
}

/**
 * Call just BEFORE the resident wave texture is FREED because a grid of another size replaces it. The texture is kept (not
 * copied) as the earlier field; safeDeleteTexture leaves it alone while it is kept. Returns true when the swap will blend.
 */
export function beforeWaveRealloc(engine, gl, next) {
  const t = tel();
  try {
    const g = gate(engine, gl, next, t);
    if (g === 'keep') return true;
    if (g) { releasePrev(engine, gl); return false; }
    const meta = metaOf(engine); const wave = engine._residentWaveTex;
    releasePrev(engine, gl);
    engine._hourPrev = { wave, adopted: true, ...meta, landAware: false };   // its land flags go with the old grid: plain fetch
    begin(engine, t, next, crestBlendMs(), true);
    return true;
  } catch (e) {
    t.errors += 1; cancelHourBlend(engine);
    return false;
  }
}

/**
 * For the colour pass, each frame: how much of the EARLIER field to draw, 1 (all of it) falling to 0 (none: the path drawn
 * before this change). Starts the clock on its first call after a step and ends the blend when it is over.
 */
export function hourBlendPrevMix(engine, at = nowMs()) {
  const b = engine && engine._hourBlend;
  if (!b || !engine._hourPrev) return 0;
  const t = tel();
  if (!crestBlendMs()) { engine._hourBlend = null; t.mix = 0; return 0; }   // the kill or reduced motion, set while a blend ran
  const hold = W().__RAW_CREST_BLEND_HOLD__;
  if (hold != null && Number.isFinite(Number(hold))) { t.mix = 1 - Math.min(1, Math.max(0, Number(hold))); return t.mix; }
  if (!b.t0) b.t0 = at;
  const p = (at - b.t0) / b.ms;
  if (!(p < 1)) { engine._hourBlend = null; t.ends += 1; t.mix = 0; return 0; }
  t.mix = 1 - crestBlendEase(p);
  return t.mix;
}

/** The colour pass, each frame: set the mix and, while a step blends, bind the earlier field and say where it lies. */
export function setHourBlendUniforms(gl, engine, program, uniformLoc, bindTexture) {
  const wd = engine._waveData;
  const mix = (wd && wd.u_waveScoreTexture) ? 0 : hourBlendPrevMix(engine);
  gl.uniform1f(uniformLoc(gl, program, 'u_hourPrevMix'), mix);
  const p = engine._hourPrev;
  if (mix > 0 && p) {
    bindTexture(gl, p.wave, HOUR_BLEND_UNIT);
    gl.uniform1i(uniformLoc(gl, program, 'u_wavePrevTexture'), HOUR_BLEND_UNIT);
    gl.uniform2f(uniformLoc(gl, program, 'u_prevBounds_min'), p.bounds.west, p.bounds.south);
    gl.uniform2f(uniformLoc(gl, program, 'u_prevBounds_max'), p.bounds.east, p.bounds.north);
    gl.uniform4f(uniformLoc(gl, program, 'u_prev_reg'), p.reg[0], p.reg[1], p.reg[2], p.reg[3]);
    gl.uniform2f(uniformLoc(gl, program, 'u_prevTexel'), p.landAware ? 1 / p.cols : 0, p.landAware ? 1 / p.rows : 0);
    gl.uniform1f(uniformLoc(gl, program, 'u_prevHeightRatio'), p.scale / heightScaleOf(wd));   // heights are mixed in metres
  } else if (p && !engine._hourBlend) {
    releasePrev(engine, gl);   // the blend is over: a kept grid's texture is freed here
  }
}
