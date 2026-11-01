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
 *
 * THE LABELLED COARSE PREVIEW (DARK, for the owner's side-by-side A/B; opt in with window.__RAW_COLD_PREVIEW__ = true).
 * Instead of a blank sea, the veil window paints the 2-deg field at the blend-base wash strength (__RAW_BLEND_BASE_WASH__, 0.72, the
 * faint coarse under-wash BLEND BOTH draws beneath a regional tile), says so in words, and cross-fades to the detail with the veil's
 * own 350 ms smoothstep, from the preview's strength instead of from 0 (non-blocking: nothing waits on it). Phase 'preview'. Words:
 * "Coarse 2° preview, not nearshore · detailed forecast loading · <model> <valid time> (<run> run)".
 * NEVER NEARSHORE TRUTH (Reflection's review): a 2-deg cell is ~120 nm, so near a coast its colour is an offshore mean (6.0 ft vs
 * 1.6 ft at Cocoa). The preview is SUPPRESSED (the blank veil and its loading words stay) when the view, padded by one coarse cell,
 *   (a) touches one of the 19 pilot boxes (staticRegional.PILOT_BOXES: the coastal surf regions; they also hold the CDN bundles, so
 *       the detail lands fastest there), or
 *   (b) holds a land / no-data node of the coarse grid itself (real products mark land; any coast the grid can see).
 * So it shows over open water only. window.__RAW_COLD_PREVIEW_COAST__ = 'show' lifts the suppression (the owner's A/B at Cocoa only).
 * The strength follows __RAW_BLEND_BASE_WASH__ (0..1).
 */
import { useSyncExternalStore } from 'react';
import { resolveColdVeil, gridCellDeg, isCoarseGlobalGrid } from './marineEngineDecisions';
import { PILOT_BOXES } from './staticRegional';
import { formatInstant } from './drawnFrameReadout';

const W = () => (typeof window !== 'undefined' ? window : {});
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const VEIL_WORDS = 'Loading the detailed forecast…';
export const veilWordsOn = (win) => (win || W()).__RAW_DISABLE_VEIL_WORDS__ !== true;

const NONE = Object.freeze({ phase: null });
let _state = NONE;
const _listeners = new Set();
const keyOf = (s) => (s.phase ? `${s.phase}|${s.model || ''}|${s.dataMs || ''}|${s.runMs || ''}|${s.deg || ''}` : '');
function publish(next) {
  if (keyOf(next) === keyOf(_state)) return;
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

export const previewOn = (win) => (win || W()).__RAW_COLD_PREVIEW__ === true;
export function previewStrength(win) {
  const v = (win || W()).__RAW_BLEND_BASE_WASH__;
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : 0.72;
}
const isLandNode = (v) => !v || v.is_valid === false || v.isOcean === false || !!(v.waves && v.waves.is_valid === false);
/** Why the preview may not paint this view ('pilot_box' | 'land_node'), or null (open water). `vb` = [w, s, e, n]. */
export function previewCoastal(grid, vb, win) {
  if ((win || W()).__RAW_COLD_PREVIEW_COAST__ === 'show') return null;
  const deg = gridCellDeg(grid) || 2;
  const parts = vb[2] < vb[0] ? [[vb[0], vb[1], 180, vb[3]], [-180, vb[1], vb[2], vb[3]]] : [vb];
  for (const [w0, s0, e0, n0] of parts) {
    const w = w0 - deg; const s = s0 - deg; const e = e0 + deg; const n = n0 + deg;
    if (PILOT_BOXES.some(([, bw, bs, be, bn]) => w < be && e > bw && s < bn && n > bs)) return 'pilot_box';
    const b = grid && grid.bounds; const vec = grid && grid.vectors; const cols = grid && grid.cols; const rows = grid && grid.rows;
    if (!b || !Array.isArray(vec) || !(cols > 1) || !(rows > 1)) continue;
    const dx = (b.east - b.west) / (cols - 1); const dy = (b.north - b.south) / (rows - 1);   // row 0 = south, column 0 = west
    const c0 = Math.max(0, Math.floor((w - b.west) / dx)); const c1 = Math.min(cols - 1, Math.ceil((e - b.west) / dx));
    const r0 = Math.max(0, Math.floor((s - b.south) / dy)); const r1 = Math.min(rows - 1, Math.ceil((n - b.south) / dy));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (isLandNode(vec[r * cols + c])) return 'land_node';
  }
  return null;
}
const runOf = (g) => Date.parse((g.model_run_time_status === 'known' && g.model_run_time) || g.__readoutModelRun || g.run_time || '') || null;
const dataOf = (g) => Date.parse(g.served_valid_time || g.__readoutServedTime || g.valid_time || '') || null;

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
  if (r.veil && !r.veil.liftT0) publish(hiddenPhase(grid, vb, w).next);
}

/** While the veil is up: the preview's phase over open water (flag on), else 'hidden'; and why the preview was suppressed. */
function hiddenPhase(grid, vb, w) {
  if (!previewOn(w)) return { next: { phase: 'hidden' }, why: null, show: false };
  const why = previewCoastal(grid, vb, w);
  if (why) return { next: { phase: 'hidden' }, why, show: false };
  const g = grid || {};
  return { next: { phase: 'preview', model: g.__sourceModel || 'GFS', dataMs: dataOf(g), runMs: runOf(g), deg: Math.round(gridCellDeg(g) || 2) }, why: null, show: true };
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
  let mult = r.mult; let next = hidden ? { phase: 'hidden' } : NONE;
  if (r.veil && previewOn(w)) {
    if (hidden) {
      const h = hiddenPhase(o.grid, vb, w);
      r.veil.previewWhy = h.why; next = h.next;
      if (h.show) mult = previewStrength(w);
      r.veil.previewMult = mult;                                   // what this frame drew: the lift ramps on from it
    } else if (r.veil.previewMult > 0) {
      mult = r.veil.previewMult + (1 - r.veil.previewMult) * r.mult;   // the cross-fade: the veil's smoothstep, from the preview
    }
  }
  if (w.__RAW_GPU__) {
    w.__RAW_GPU__.coldVeil = r.veil ? { mult: +mult.toFixed(3), lifted: !!r.veil.liftT0, reason: r.veil.reason || null,
      ...(previewOn(w) ? { preview: next.phase === 'preview' || (!hidden && r.veil.previewMult > 0), previewWhy: r.veil.previewWhy || null } : {}) } : null;
  }
  // The reveal's first frame of a blank veil still draws at 0 (smoothstep from 0): the words wait for a frame that shows the field.
  publish(!hidden && r.veil && mult === 0 ? { phase: 'hidden' } : next);
  return mult;
}

/** The status line while the veil hides the heatmap, or null. A pending line: the detailed forecast is on its way. */
export function describeColdVeil(state, { layer } = {}, win) {
  if (!state || !state.phase || !veilWordsOn(win)) return null;
  if (layer && !['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(layer)) return null;
  if (state.phase === 'hidden') return { state: 'pending', veil: 'hidden', text: VEIL_WORDS };
  if (state.phase === 'preview') return { state: 'pending', veil: 'preview', text: previewWords(state) };
  return null;
}

/** "Coarse 2° preview, not nearshore · detailed forecast loading · GFS Sun 3 PM (Sun 8 AM run)". */
export function previewWords({ model, dataMs, runMs, deg } = {}) {
  const when = Number.isFinite(dataMs) ? ` ${formatInstant(dataMs)}` : '';
  const run = Number.isFinite(runMs) ? ` (${formatInstant(runMs)} run)` : '';
  return `Coarse ${deg || 2}° preview, not nearshore · detailed forecast loading · ${model || 'GFS'}${when}${run}`;
}
