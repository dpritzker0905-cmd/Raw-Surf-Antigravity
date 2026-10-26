/**
 * marineDrawnFrame.js — what the marine engine ACTUALLY drew, published at the upload (W-1, scrub audit 2026-10-18).
 *
 * The timeline label is the REQUESTED hour; the heatmap is whatever frame the engine holds (a nearest 3-hourly frame, the
 * previous layer while a switch loads, an estimate). Until now the only way a UI line could learn the drawn identity was
 * polling window diagnostics every 500 ms (ForecastTimeStatus), which lagged a transition behind (T-05). WebGLMarineLayer
 * calls publishMarineDrawn() right after a successful upload; React reads it with useMarineDrawnFrame() in the same frame.
 */
import { useSyncExternalStore } from 'react';
import { formatInstant } from './drawnFrameReadout';

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

/** Called by WebGLMarineLayer after engine.setWaveData took `grid` (and by the frame store's shows). */
export function publishMarineDrawn(grid, fallback = {}) {
  if (!grid) return;
  publishedGrid = grid;
  const basis = grid.estimate_basis || null;
  const served = grid.served_valid_time || (killed('DRAWN_SERVED_TIME') ? '' : grid.__readoutServedTime) || '';
  current = {
    hour: Number.isFinite(grid.hourOffset) ? grid.hourOffset : (Number.isFinite(fallback.hour) ? fallback.hour : null),
    layer: grid.__componentLayer || fallback.layer || null,
    model: grid.__sourceModel || fallback.model || null,
    validTime: served || grid.valid_time || null,
    // The DATA instant: the served time is the truth; a /grid valid_time only echoes the request (C-12), a series frame's is its own.
    dataMs: Date.parse(served || (grid.__fromSeries ? grid.valid_time : '') || '') || null,
    estimated: !!(grid.is_estimated || grid.isEstimated),
    basisType: basis && basis.type ? basis.type : null,
    provider: grid.__gridProvider || grid.provider || null,
    store: !!grid.__fromFrameStore,   // the GPU frame store put it there (field telemetry's hit/miss)
    ts: Date.now(),
  };
  if (typeof window !== 'undefined') window.__MARINE_DRAWN__ = current;   // instruments (visual lab, TruthOverlay) read this
  listeners.forEach((fn) => { try { fn(); } catch (e) { /* a broken listener must not break the upload */ } });
}

export function getMarineDrawn() { return current; }

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
    basisType: grid.time_blend ? 'wind_time_blend' : null,
    // Clip B (windTimeBlend.js, opt-in): a blended field names both stored frames it came from.
    blendText: grid.time_blend
      ? `interpolated between ${formatInstant(Date.parse(grid.time_blend.from))} and ${formatInstant(Date.parse(grid.time_blend.to))}` : null,
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
