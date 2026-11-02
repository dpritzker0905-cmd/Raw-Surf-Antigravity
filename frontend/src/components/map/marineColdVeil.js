/**
 * marineColdVeil.js — the cold-activation veil, applied per frame, and what it means for the status line (D3, 2026-11-01).
 *
 * THE VEIL (marineEngineDecisions.resolveColdVeil, 2026-07-18): on a COLD commit (nothing resident: a first activation, or the first
 * commit after a model-switch clear) the first frame is usually the instant 2-deg world CDN frame. At a coastal viewport (< 15 deg)
 * one 2-deg cell spans the whole view, so its colour is an offshore mean (firstpaint-lab: 6.0 ft world cell vs 1.6 ft regional at
 * Cocoa z9). The veil holds the heatmap at opacity 0 until the detailed resident lands, or for a bounded grace (4 s).
 *
 * D3 (the lead's offline fuzzer, 2026-10-27): the heatmap was fully transparent for ~3.9 s after the first frame (219 episodes, 105
 * of 126 sequences) while the status line said "Showing …" — or nothing at all — about a frame that was not on screen. The house rule
 * (drawnFrameReadout): never describe a field the map does not show. So while the veil hides the heatmap, the status line says
 * "Loading the detailed forecast…" (a pending line, aria-busy, polite). Kill: window.__RAW_DISABLE_VEIL_WORDS__ = true (the line
 * describes the drawn record again, as before).
 *
 * The engine calls applyColdVeil once per heatmap pass (it was an inline block in WebGLMarineEngine.render; moved here so the engine,
 * a grandfathered file that may only shrink, does not grow). It returns the opacity multiplier, keeps __RAW_GPU__.coldVeil as before,
 * and publishes the veil's PHASE to the status line only when it changes:
 *   'hidden' — the veil holds the heatmap at 0 this frame (the detailed forecast is still on its way);
 *   null     — no veil, or it is lifting (the 350 ms reveal, from its first frame drawn above 0: the drawn record then describes it).
 * clearColdVeil() (the engine's resident clear) publishes null, so a cleared layer never leaves the words behind.
 */
import { useSyncExternalStore } from 'react';
import { resolveColdVeil, isCoarseGlobalGrid } from './marineEngineDecisions';

const W = () => (typeof window !== 'undefined' ? window : {});
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const VEIL_WORDS = 'Loading the detailed forecast…';
export const veilWordsOn = (win) => (win || W()).__RAW_DISABLE_VEIL_WORDS__ !== true;

const NONE = Object.freeze({ phase: null });
let _state = NONE;
const _listeners = new Set();
function publish(next) {
  if (next.phase === _state.phase) return;
  _state = next.phase ? Object.freeze({ ...next, t: now() }) : NONE;
  _listeners.forEach((fn) => { try { fn(); } catch (e) { /* a broken listener must not break the render pass */ } });
}
export const getColdVeilState = () => _state;
export function subscribeColdVeil(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
export function useColdVeilState() { return useSyncExternalStore(subscribeColdVeil, getColdVeilState, getColdVeilState); }
/** The engine cleared its resident (layer off, model-switch clear): no veil is on screen. */
export function clearColdVeil() { publish(NONE); }
export function _resetColdVeilForTest() { _state = NONE; _listeners.clear(); }

const lonSpan = (vb) => ((vb[2] < vb[0]) ? (vb[2] + 360 - vb[0]) : (vb[2] - vb[0]));

/**
 * The veil for this frame: the multiplier on the composed heatmap opacity (1 = no veil). `o` = { residentCoarseGlobal, vb (the
 * viewport [w, s, e, n]), isRating, debugIsolate, nowMs? }. Mutates engine._coldVeil exactly as the inline block did.
 */
/**
 * The cold commit itself (setWaveData's veil stamp): when the engine already knows its viewport, the phase is published in the
 * same task as the upload (and the drawn record), so the line never says "Showing …" for the frames between the upload and the
 * first heatmap pass. Decided exactly as the first render will (on a copy of the veil: nothing is stamped here).
 */
export function noteColdVeilStamp(engine, grid, win) {
  const w = win || W();
  const vb = engine && engine._lastViewportBounds;
  if (!engine || !engine._coldVeil || !Array.isArray(vb) || !grid) return;
  const r = resolveColdVeil({ ...engine._coldVeil }, {
    residentCoarseGlobal: isCoarseGlobalGrid(grid), viewportSpanDeg: lonSpan(vb), isRating: !!grid.ratingMode,
    debugIsolate: w.__WEATHER_DEBUG_ISOLATE_OVERLAY__ === true,
  }, now(), w);
  if (r.veil && !r.veil.liftT0) publish({ phase: 'hidden' });
}

export function applyColdVeil(engine, o, win) {
  const w = win || W();
  const t = Number.isFinite(o.nowMs) ? o.nowMs : now();
  const vb = o.vb || [-180, -80, 180, 85];
  const r = resolveColdVeil(engine._coldVeil, {
    residentCoarseGlobal: o.residentCoarseGlobal, viewportSpanDeg: lonSpan(vb), isRating: !!o.isRating, debugIsolate: o.debugIsolate === true,
  }, t, w);
  engine._coldVeil = r.veil;
  const hidden = !!(r.veil && !r.veil.liftT0);
  if (w.__RAW_GPU__) {
    w.__RAW_GPU__.coldVeil = r.veil ? { mult: +r.mult.toFixed(3), lifted: !!r.veil.liftT0, reason: r.veil.reason || null } : null;
  }
  // The reveal's first frame still draws at 0 (smoothstep from 0): the words wait for a frame that shows the field.
  publish(hidden || (r.veil && r.mult === 0) ? { phase: 'hidden' } : NONE);
  return r.mult;
}

/** The status line while the veil hides the heatmap, or null. A pending line: the detailed forecast is on its way. */
export function describeColdVeil(state, { layer } = {}, win) {
  if (!state || !state.phase || !veilWordsOn(win)) return null;
  if (layer && !['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(layer)) return null;
  if (state.phase === 'hidden') return { state: 'pending', veil: 'hidden', text: VEIL_WORDS };
  return null;
}
