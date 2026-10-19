/**
 * marineDrawnFrame.js — what the marine engine ACTUALLY drew, published at the upload (W-1, scrub audit 2026-10-18).
 *
 * The timeline label is the REQUESTED hour; the heatmap is whatever frame the engine holds (a nearest 3-hourly frame, the
 * previous layer while a switch loads, an estimate). Until now the only way a UI line could learn the drawn identity was
 * polling window diagnostics every 500 ms (ForecastTimeStatus), which lagged a transition behind (T-05). WebGLMarineLayer
 * calls publishMarineDrawn() right after a successful upload; React reads it with useMarineDrawnFrame() in the same frame.
 */
import { useSyncExternalStore } from 'react';

let current = null;
const listeners = new Set();

/** Called by WebGLMarineLayer after engine.setWaveData succeeded for `grid`. */
export function publishMarineDrawn(grid, fallback = {}) {
  if (!grid) return;
  const basis = grid.estimate_basis || null;
  current = {
    hour: Number.isFinite(grid.hourOffset) ? grid.hourOffset : (Number.isFinite(fallback.hour) ? fallback.hour : null),
    layer: grid.__componentLayer || fallback.layer || null,
    model: grid.__sourceModel || fallback.model || null,
    validTime: grid.served_valid_time || grid.valid_time || null,
    // The DATA instant: served_valid_time is the truth; a /grid valid_time only echoes the request (C-12), a series frame's is its own.
    dataMs: Date.parse(grid.served_valid_time || (grid.__fromSeries ? grid.valid_time : '') || '') || null,
    estimated: !!(grid.is_estimated || grid.isEstimated),
    basisType: basis && basis.type ? basis.type : null,
    provider: grid.__gridProvider || grid.provider || null,
    ts: Date.now(),
  };
  if (typeof window !== 'undefined') window.__MARINE_DRAWN__ = current;   // instruments (visual lab, TruthOverlay) read this
  listeners.forEach((fn) => { try { fn(); } catch (e) { /* a broken listener must not break the upload */ } });
}

export function getMarineDrawn() { return current; }

export function subscribeMarineDrawn(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React: the latest drawn-frame record (re-renders on every publish). */
export function useMarineDrawnFrame() {
  return useSyncExternalStore(subscribeMarineDrawn, getMarineDrawn, getMarineDrawn);
}

export function _resetMarineDrawnForTest() { current = null; listeners.clear(); windCurrent = null; windListeners.clear(); }

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
