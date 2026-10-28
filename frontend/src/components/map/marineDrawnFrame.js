/**
 * marineDrawnFrame.js — what the marine engine ACTUALLY drew, published at the upload (W-1, scrub audit 2026-10-18).
 *
 * The timeline label is the REQUESTED hour; the heatmap is whatever frame the engine holds (a nearest 3-hourly frame, the
 * previous layer while a switch loads, an estimate). Until now the only way a UI line could learn the drawn identity was
 * polling window diagnostics every 500 ms (ForecastTimeStatus), which lagged a transition behind (T-05). WebGLMarineLayer
 * calls publishMarineDrawn() right after a successful upload; React reads it with useMarineDrawnFrame() in the same frame.
 */
import { useSyncExternalStore } from 'react';
import { getSeriesAnchorMs } from './backendWeatherServiceClient';
import { deriveResolutionDeg } from './backendWeatherServiceClientDiag';
import { getCachedManifest } from './backendWeatherServiceClientCoverage';

let current = null;
let publishedGrid = null;   // the grid object the record describes (syncDrawnToEngine compares the engine's resident with it)
const listeners = new Set();

// DRAWN TRUTH (2026-10-24; the verify matrix's step-to-h2 frame: a stored frame drawn under the selected hour with no status
// line). Two gaps let the record describe something other than the screen:
//  - SERVED TIME: the useMarineWindData conform drops served_valid_time (#444 keeps it dark there: the commit rules read it), and a
//    /grid valid_time only echoes the ask, so a /grid frame had NO data instant and the status line compared hour LABELS: a
//    nearest-stored stand-in labelled with the selected hour read as exact. The conform now also carries the served time under a
//    readout-only name (__readoutServedTime) that only this record reads. Kill: window.__RAW_DISABLE_DRAWN_SERVED_TIME__ = true.
//  - ENGINE TRUTH: WebGLMarineLayer published every grid it handed to setWaveData, including one the engine REFUSED (the
//    no-downgrade stash, the null-encode guard) while the old resident stayed on screen; and the engine's own swaps (the stash's
//    self-heal accept, the zoom-out bridge) published nothing, so the line kept saying "Loading" over the selected hour. The record
//    now follows what the engine HOLDS. Kill: window.__RAW_DISABLE_DRAWN_ENGINE_TRUTH__ = true.
const killed = (name) => typeof window !== 'undefined' && window[`__RAW_DISABLE_${name}__`] === true;
// The frame's MODEL RUN, its verified cycle (2026-10-27): the status line's lattice rule reads the model step from it
// (drawnFrameReadout.latticeNearestMaxHours). A grid naming a 'known' cycle gives it; a store show's comes from its frame-set index
// (verified cycles only, backend frame_set.py), never from the resident it was spread over; a /grid or series frame's through the
// conform under a readout-only name (useMarineWindData: __readoutModelRun). Null when none is named: the rule keeps the timeline hour.
const runMsOf = (g) => Date.parse((g.model_run_time_status === 'known' || g.__fromFrameStore ? g.model_run_time : null)
  || (g.__fromFrameStore ? null : g.__readoutModelRun) || '') || null;
/** The conform's readout-only cycle: a series frame names its verified cycle on the grid or its wrapper, a /grid frame in its
 *  receipt (marineFrameReceipt.modelRunTime); never the ingest clock `run_time`. Null when no cycle is known. */
export function readoutModelRun(marineData) {
  const g = (marineData && marineData.grid) || {};
  const known = (x) => (x && x.model_run_time_status === 'known' && x.model_run_time) || null;
  const r = g.frameReceipt;
  return known(g) || known(marineData) || (r && r.modelRunTimeStatus === 'known' && r.modelRunTime) || null;
}

// A readout-only field must never break the upload that publishes it: on any throw it is simply unknown (null).
const softly = (fn) => { try { const v = fn(); return Number.isFinite(v) ? v : null; } catch (e) { return null; } };

/** Called by WebGLMarineLayer after engine.setWaveData took `grid` (and by the frame store's shows). */
export function publishMarineDrawn(grid, fallback = {}) {
  if (!grid) return;
  publishedGrid = grid;
  const basis = grid.estimate_basis || null;
  const served = grid.served_valid_time || (killed('DRAWN_SERVED_TIME') ? '' : grid.__readoutServedTime) || '';
  // A RATING frame's estimate is the surf model, not the forecast (2026-10-28, the lead's 10-26/10-27 live rounds): the surf
  // transform stamps every rating grid is_estimated=True whatever the hour (backend grid_resolver_surf.py), so the line read
  // "Estimated forecast: estimated" over GFS hour 0, and for ~1.9 s after band OFF over a native EURO hour. With no basis of its
  // own the forecast under it is native. Kill: window.__RAW_DISABLE_DRAWN_ESTIMATE_WORDS__ = true (the flag is read as served).
  const surfOnlyEstimate = !!grid.ratingMode && !(basis && basis.type) && !killed('DRAWN_ESTIMATE_WORDS');
  current = {
    hour: Number.isFinite(grid.hourOffset) ? grid.hourOffset : (Number.isFinite(fallback.hour) ? fallback.hour : null),
    layer: grid.__componentLayer || fallback.layer || null,
    model: grid.__sourceModel || fallback.model || null,
    validTime: served || grid.valid_time || null,
    // The DATA instant: the served time is the truth; a /grid valid_time only echoes the request (C-12), a series frame's is its own.
    dataMs: Date.parse(served || (grid.__fromSeries ? grid.valid_time : '') || '') || null,
    estimated: !!(grid.is_estimated || grid.isEstimated) && !surfOnlyEstimate,
    basisType: basis && basis.type ? basis.type : null,
    // A far-edge hold's held frame time (estimate_basis.held_from): the status line names it even when no served time arrived.
    heldFromMs: basis && basis.held_from ? (Date.parse(basis.held_from) || null) : null,
    runMs: runMsOf(grid),
    // The clock the hour was drawn on (2026-10-28): after a long idle the selection's anchor moves on while the record keeps its
    // hour label; the line then names that, not "beyond <model>’s range" (drawnFrameReadout: holdReason).
    anchorMs: softly(() => getSeriesAnchorMs()),
    // The drawn grid's node spacing by the TruthOverlay HUD's own rule (deriveResolutionDeg, the coarser axis): EURO swells at z9
    // are a 10.313-degree grid and only the HUD said so (drawnFrameReadout.describeCoarseGrid).
    resolutionDeg: softly(() => deriveResolutionDeg(grid.bounds || null, grid.cols, grid.rows)),
    provider: grid.__gridProvider || grid.provider || null,
    store: !!grid.__fromFrameStore,   // the GPU frame store put it there (field telemetry's hit/miss)
    ts: Date.now(),
  };
  if (typeof window !== 'undefined') window.__MARINE_DRAWN__ = current;   // instruments (visual lab, TruthOverlay) read this
  listeners.forEach((fn) => { try { fn(); } catch (e) { /* a broken listener must not break the upload */ } });
}

export function getMarineDrawn() { return current; }

/**
 * The newest VERIFIED model cycle the cached manifest names for {model, layer} (marine), or null (2026-10-28). The status line
 * compares the drawn frame's cycle with it to say "from an older <model> run". Verified cycles only (model_run_time_status
 * 'known'), never the ingest clock. One scan per manifest object and key.
 */
const _latestRun = new WeakMap();
export function latestKnownRunMs(model, layer) {
  const manifest = getCachedManifest();
  if (!manifest || !Array.isArray(manifest.products) || !model || !layer) return null;
  let byKey = _latestRun.get(manifest);
  if (!byKey) { byKey = new Map(); _latestRun.set(manifest, byKey); }
  const key = `${String(model).toUpperCase()}|${layer}`;
  if (byKey.has(key)) return byKey.get(key);
  let best = null;
  for (const p of manifest.products) {
    if (!p || String(p.model || '').toUpperCase() !== key.split('|')[0] || p.layer !== layer) continue;
    if ((p.domain || 'marine') !== 'marine' || p.model_run_time_status !== 'known') continue;
    const ms = Date.parse(p.model_run_time || '');
    if (Number.isFinite(ms) && (best == null || ms > best)) best = ms;
  }
  byKey.set(key, best);
  return best;
}

/** Did the engine take `grid`? (false when setWaveData stashed it as a refused downgrade or dropped it as a degenerate encode) */
export function engineHoldsGrid(engine, grid) {
  if (killed('DRAWN_ENGINE_TRUTH')) return true;
  return !!(engine && engine._waveData && engine._waveData.waveGrid === grid);
}

/** Per rendered frame: publish what the engine HOLDS when it is not what the record describes (a swap inside the engine). */
export function syncDrawnToEngine(engine, fallback = {}) {
  if (killed('DRAWN_ENGINE_TRUTH')) return;
  const g = engine && engine._waveData && engine._waveData.waveGrid;
  if (g && g !== publishedGrid) publishMarineDrawn(g, fallback);
}

export function subscribeMarineDrawn(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React: the latest drawn-frame record (re-renders on every publish). */
export function useMarineDrawnFrame() {
  return useSyncExternalStore(subscribeMarineDrawn, getMarineDrawn, getMarineDrawn);
}

export function _resetMarineDrawnForTest() { current = null; publishedGrid = null; listeners.clear(); windCurrent = null; windListeners.clear(); }

// ---- WIND: what the wind engine drew, published at the layer's handoff (WebGLWindLayer) ----
let windCurrent = null;
const windListeners = new Set();
export function publishWindDrawn(grid, fallback = {}) {
  if (!grid) return;
  windCurrent = {
    hour: Number.isFinite(grid.hourOffset) ? grid.hourOffset : (Number.isFinite(fallback.hour) ? fallback.hour : null),
    layer: 'wind',
    model: grid.model || grid.source || (grid.truthTag && grid.truthTag.model) || fallback.model || null,
    validTime: grid.served_valid_time || grid.valid_time || null,
    dataMs: Date.parse(grid.served_valid_time || (grid.__fromSeries ? grid.valid_time : '') || '') || null,
    estimated: !!(grid.is_estimated || grid.isEstimated),
    basisType: null,
    runMs: Date.parse((grid.model_run_time_status === 'known' && grid.model_run_time) || '') || null,   // its verified cycle (runMsOf)
    provider: grid.provider || null,
    ts: Date.now(),
  };
  if (typeof window !== 'undefined') window.__WIND_DRAWN__ = windCurrent;
  windListeners.forEach((fn) => { try { fn(); } catch (e) { /* never break the upload */ } });
}
export function clearWindDrawn() {   // wind cleared (outside coverage, unrenderable, layer off): nothing drawn, nothing to describe
  if (windCurrent === null) return;
  windCurrent = null;
  if (typeof window !== 'undefined') window.__WIND_DRAWN__ = null;
  windListeners.forEach((fn) => { try { fn(); } catch (e) { /* never break the clear */ } });
}
export function getWindDrawn() { return windCurrent; }
export function subscribeWindDrawn(fn) { windListeners.add(fn); return () => windListeners.delete(fn); }
export function useWindDrawnFrame() { return useSyncExternalStore(subscribeWindDrawn, getWindDrawn, getWindDrawn); }
