/**
 * THE HOUR BLEND for the marine colour field (waves, swell_1, swell_2, wind_waves). 2026-11-15.
 *
 * An hour step overwrites the engine's ONE wave texture in place (the commit's updateTexture, the scrub's pool copy / byte
 * upload), so the next drawn frame showed the new hour whole: the hour pop. Now, just before that overwrite, the texture is
 * copied on the GPU into a second texture (the earlier hour), and for CREST_BLEND_MS the colour shader mixes the two hours'
 * VALUES (direction, height, period) and colours the result as before. At rest exactly one served hour is drawn and the
 * shader does not read the second texture. Display only: no byte of any frame changes and no served number is touched.
 *
 * No blend (the hard swap, as before) when: the kill is set; the visitor prefers reduced motion; the two hours are not on the
 * same grid; they differ in model or layer; the land / no-data mask differs (the scrub's exact-mask path); ratings are drawn
 * (the score texture is not blended); the same hour is committed again.
 *
 * A step that lands INSIDE a running blend restarts it from the hour being replaced (the screen was a mix; the part of the
 * older hour still showing is dropped in one frame, which is never more than the hard swap dropped).
 *
 * Kill: window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true.
 * Lab only: window.__RAW_CREST_BLEND_MS__ (duration), window.__RAW_CREST_BLEND_HOLD__ (0..1: hold a started blend at that
 * progress, to photograph it). Telemetry: window.__RAW_CREST_HOUR_BLEND__.
 * Gate and results: docs/weather-program/log/2026-11-15-fable-crest-hour-blend.md.
 */
import { createTexture } from './WebGLMarineTextureState';
import { safeDeleteTexture } from './WebGLWindUtils';

export const CREST_BLEND_MS = 160;   // the same as the own-frame rasters (ownRasterLayer BLEND_MS): every layer steps alike
export const HOUR_BLEND_UNIT = 7;    // the colour program's texture unit for the earlier hour (0-4 are in use there)

const W = () => (typeof window !== 'undefined' ? window : {});
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** The blend's duration in ms; 0 = no blend. */
export function crestBlendMs(w = W()) {
  if (!w || w.__RAW_DISABLE_CREST_HOUR_BLEND__ === true) return 0;
  try { if (w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0; } catch (e) { /* no matchMedia */ }
  const o = Number(w.__RAW_CREST_BLEND_MS__);
  return w.__RAW_CREST_BLEND_MS__ != null && Number.isFinite(o) && o >= 0 ? o : CREST_BLEND_MS;
}

/** Progress 0..1 eased (smoothstep: no velocity jump at either end). */
export function crestBlendEase(t) { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); }

const tel = () => {
  const w = W();
  return w.__RAW_CREST_HOUR_BLEND__ || (w.__RAW_CREST_HOUR_BLEND__ = { starts: 0, restarts: 0, ends: 0, errors: 0, skips: {}, prevTextures: 0, mix: 0, last: null });
};
const skip = (why) => { const t = tel(); t.skips[why] = (t.skips[why] || 0) + 1; return why; };

const sameBounds = (a, b) => !!a && !!b && a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north;

/**
 * Why this overwrite must NOT be blended, or null when it may. Pure.
 * `old` is the grid on screen (engine._waveData.waveGrid); `next` describes the hour about to be written:
 * { cols, rows, bounds, model, layer, validTime, rating, maskDiffers }.
 */
export function hourBlendVerdict(old, next, oldRating) {
  if (!old || !next) return 'no_grid';
  if (old.cols !== next.cols || old.rows !== next.rows || !sameBounds(old.bounds, next.bounds)) return 'grid_differs';
  if ((old.__sourceModel || 'GFS') !== (next.model || 'GFS')) return 'model_differs';
  if ((old.__componentLayer || 'waves') !== (next.layer || 'waves')) return 'layer_differs';
  if (oldRating || next.rating) return 'rating';
  if (next.maskDiffers) return 'mask_differs';
  const was = old.served_valid_time ?? old.valid_time ?? old.hourOffset; const is = next.validTime;
  if (was == null || is == null || String(was) === String(is)) return 'same_hour';
  return null;
}

/** Drop a running blend (the texture stays for the next one). */
export function cancelHourBlend(engine) {
  if (engine && engine._hourBlend) { engine._hourBlend = null; tel().mix = 0; }
}

/** Free the earlier hour's texture (teardown, context loss, a resident of another size). */
export function disposeHourBlend(engine, gl) {
  if (!engine) return;
  engine._hourBlend = null;
  tel().mix = 0;
  if (engine._hourPrevTex) {
    try { safeDeleteTexture(gl, engine._hourPrevTex, null); } catch (e) { /* a lost context */ }
    engine._hourPrevTex = null; engine._hourPrevDims = null; tel().prevTextures = 0;
  }
}

/**
 * Call just BEFORE the resident wave texture is overwritten in place with another hour. Copies the texture as it is (the
 * hour on screen) into the earlier-hour texture and starts the blend. Returns true when a blend was started. Never throws,
 * and leaves the GL state as it found it: on any doubt the step is the hard swap it was.
 */
export function beforeWaveOverwrite(engine, gl, next) {
  const t = tel();
  try {
    const ms = crestBlendMs();
    if (!ms) { cancelHourBlend(engine); skip('off'); return false; }
    const wd = engine && engine._waveData; const tex = engine && engine._residentWaveTex;
    if (!gl || !wd || !tex || wd.u_waveTexture !== tex) { cancelHourBlend(engine); skip('no_resident'); return false; }
    const why = hourBlendVerdict(wd.waveGrid, next, !!wd.u_waveScoreTexture);
    if (why) { cancelHourBlend(engine); skip(why); return false; }
    const cols = next.cols; const rows = next.rows;
    // Several steps before one drawn frame (a +3 h step is three commits): the resident is an hour that was never drawn, so the
    // earlier-hour texture, which still holds the hour ON SCREEN, is kept as it is.
    if (engine._hourBlend && !engine._hourBlend.t0 && engine._hourPrevTex && engine._hourPrevDims
      && engine._hourPrevDims.cols === cols && engine._hourPrevDims.rows === rows) {
      t.kept = (t.kept || 0) + 1; t.last = { layer: next.layer || 'waves', model: next.model || 'GFS', to: String(next.validTime), ms };
      return true;
    }
    if (engine._hourPrevTex && (!engine._hourPrevDims || engine._hourPrevDims.cols !== cols || engine._hourPrevDims.rows !== rows)) disposeHourBlend(engine, gl);
    if (!engine._hourPrevTex) {
      engine._hourPrevTex = createTexture(gl, gl.LINEAR, null, cols, rows);
      if (!engine._hourPrevTex) { skip('no_texture'); return false; }
      engine._hourPrevDims = { cols, rows }; t.prevTextures = 1;
    }
    const fb0 = gl.getParameter(gl.FRAMEBUFFER_BINDING); const tex0 = gl.getParameter(gl.TEXTURE_BINDING_2D);
    let ok = false;
    try {
      if (!engine._hourBlendFbo) engine._hourBlendFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, engine._hourBlendFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        gl.bindTexture(gl.TEXTURE_2D, engine._hourPrevTex);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cols, rows);   // the hour on screen -> the earlier-hour texture
        ok = true;
      }
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb0 || null); gl.bindTexture(gl.TEXTURE_2D, tex0 || null);
    }
    if (!ok) { cancelHourBlend(engine); skip('copy_failed'); return false; }
    if (engine._hourBlend) t.restarts += 1;
    engine._hourBlend = { t0: 0, ms };   // the clock starts at the first frame that draws the new hour
    t.starts += 1; t.last = { layer: next.layer || 'waves', model: next.model || 'GFS', to: String(next.validTime), ms };
    return true;
  } catch (e) {
    t.errors += 1; cancelHourBlend(engine);
    return false;
  }
}

/**
 * For the colour pass, each frame: how much of the EARLIER hour to draw, 1 (all of it) falling to 0 (none: the path drawn
 * before this change). Starts the clock on its first call after a step and ends the blend when it is over.
 */
export function hourBlendPrevMix(engine, at = nowMs()) {
  const b = engine && engine._hourBlend;
  if (!b || !engine._hourPrevTex) return 0;
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

/** The colour pass, each frame: set the mix and, while a step blends, bind the earlier hour. Ratings are never blended. */
export function setHourBlendUniforms(gl, engine, program, uniformLoc, bindTexture) {
  const mix = (engine._waveData && engine._waveData.u_waveScoreTexture) ? 0 : hourBlendPrevMix(engine);
  gl.uniform1f(uniformLoc(gl, program, 'u_hourPrevMix'), mix);
  if (mix > 0) {
    bindTexture(gl, engine._hourPrevTex, HOUR_BLEND_UNIT);
    gl.uniform1i(uniformLoc(gl, program, 'u_wavePrevTexture'), HOUR_BLEND_UNIT);
  }
}
