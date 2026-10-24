/**
 * rasterDrawnFrame.js: what a RASTER layer shows against what the app asked it to show, in words (P2, 2026-10-22).
 *
 * Measured (raster lab, 2026-10-22): while a raster hour loads, the map holds the previous hour (that is the design: never a
 * blank), but nothing said so. The status line under the timeline (ForecastTimeStatus) read only the marine drawn-frame record,
 * so every slow raster step showed an older hour under the new label in silence (85-380 frames per step; thousands per layer
 * over the matrix). The marine side already speaks: "Loading <selected>... still showing <drawn>" (W-1, #454). This file gives
 * the raster layers the same words:
 *  - the URL hook publishes, per commit, the SHOWN slot's om:// URL and the TARGET slot's URL (the hour, model and variable the
 *    app resolved for the selection, so the deliberate GFS stand-ins, e.g. water temp on ICON, are never called "loading");
 *  - radar publishes the frame on screen and the frame asked for (radarFrameHold.js);
 *  - describeRasterFrame turns the pair into the marine readout's states: pending (shown != wanted), nearest (EURO's 3- and
 *    6-hourly steps), or nothing. The line waits PENDING_QUIET_MS before it appears (the instant contract: no loading words
 *    under ~300 ms), so an instant step never flashes text.
 * Kill: window.__RAW_DISABLE_RASTER_DRAWN_READOUT__ = true (no raster line, as before). Instruments: window.__RASTER_DRAWN__.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { MODEL_METADATA_CACHE } from './LayerRegistry';
import { getEngaged } from './ownRasterFrames';
import { ESTIMATE_WORDS } from './drawnFrameReadout';

const W = () => (typeof window !== 'undefined' ? window : {});
export const PENDING_QUIET_MS = 300;
export const RASTER_STATUS_LAYERS = new Set(['rain', 'radar', 'satellite', 'pressure', 'temperature', 'water_temp', 'fog']);
export const RASTER_NAMES = { rain: 'Precip', radar: 'Radar', satellite: 'Satellite', pressure: 'Pressure', temperature: 'Air Temp',
  water_temp: 'Water Temp', fog: 'Fog' };
export const rasterReadoutKilled = () => W().__RAW_DISABLE_RASTER_DRAWN_READOUT__ === true;

// PER LAYER (2026-10-24): one record per layer, each written only by the layer's own publisher (the .om pairs, radar, or a layer
// drawn from our own frames). With one shared record, two raster layers on at once (pressure from our frames + rain from .om,
// or pressure + air temperature both from our frames) overwrote each other, and the line under the timeline went blank for
// whichever layer it describes. `current` stays as the latest record of any layer (getRasterDrawn() with no layer).
let current = null;
let byLayer = Object.freeze({});
const listeners = new Set();
const sameEnd = (a, b) => (a && b ? a.url === b.url && a.dataMs === b.dataMs : a === b);
const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* never break a commit */ } });
/** Publish { layer, shown, want } (each { url, dataMs, model, nearestMaxHours }) for its layer; null clears the latest record
 *  (and its layer's entry). A layer that stops drawing calls clearRasterDrawn(layer). */
export function publishRasterDrawn(rec) {
  if (!rec) { if (current) clearRasterDrawn(current.layer); return; }
  const had = byLayer[rec.layer];
  if (had && sameEnd(rec.shown, had.shown) && sameEnd(rec.want, had.want)) return;
  current = { ...rec, ts: Date.now() };
  byLayer = Object.freeze({ ...byLayer, [rec.layer]: current });
  W().__RASTER_DRAWN__ = current;
  notify();
}
/** Drop one layer's record (it no longer draws). */
export function clearRasterDrawn(layer) {
  if (!byLayer[layer] && !(current && current.layer === layer)) return;
  const next = { ...byLayer }; delete next[layer];
  byLayer = Object.freeze(next);
  if (current && current.layer === layer) { current = null; W().__RASTER_DRAWN__ = null; }
  notify();
}
/** The latest record of any layer, or (with a layer) that layer's record. */
export function getRasterDrawn(layer) { return layer === undefined ? current : (byLayer[layer] || null); }
export function subscribeRasterDrawn(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function useRasterDrawnFrame(layer) {
  const get = () => getRasterDrawn(layer);
  return useSyncExternalStore(subscribeRasterDrawn, get, get);
}
export function _resetRasterDrawnForTest() { current = null; byLayer = Object.freeze({}); omLast = null; listeners.clear(); }

const modelOfFolder = (f) => (/gfs/.test(f) ? 'GFS' : /ecmwf|ifs/.test(f) ? 'EURO' : /dwd|icon/.test(f) ? 'ICON' : f);
/** One end of the pair for an om:// slot URL: its data instant on the model's own axis, and half the axis gap there. */
export function omEnd(url, cache = MODEL_METADATA_CACHE) {
  const m = typeof url === 'string' ? url.match(/data_spatial\/([^/]+)\/latest\.json\?time_step=valid_times_(\d+)/) : null;
  if (!m) return null;
  const vt = cache[m[1]] && cache[m[1]].validTimes;
  const idx = Number(m[2]);
  const dataMs = vt && vt[idx] ? Date.parse(vt[idx]) : NaN;
  if (!Number.isFinite(dataMs)) return null;
  const at = (i) => (vt[i] ? Date.parse(vt[i]) : NaN);
  const gaps = [at(idx) - at(idx - 1), at(idx + 1) - at(idx)].filter((g) => Number.isFinite(g) && g > 0);
  const gapH = gaps.length ? Math.max(...gaps) / 3600000 : 1;
  return { url, dataMs, model: modelOfFolder(m[1]), nearestMaxHours: Math.floor(gapH / 2) };
}

let omLast = null;              // the .om layer this publisher wrote last
/** Hook for useOpenMeteoTileUrls: publish the first active raster layer's shown and target slots after every commit. */
export function useRasterDrawnPublisher(activeLayers, activeSlots, omTileUrls, targetSlotsRef) {
  useEffect(() => {
    if (rasterReadoutKilled()) return;
    const layer = (activeLayers || []).find((k) => RASTER_STATUS_LAYERS.has(k) && k !== 'radar');
    // This publisher owns only the .om layer it last wrote: a layer drawn from our own frames publishes its own record
    // (useOwnRasterFrames) and radar its own (radarFrameHold), so neither is ever cleared from here.
    if (omLast && omLast !== layer && !getEngaged()[omLast]) clearRasterDrawn(omLast);
    omLast = layer || null;
    if (!layer) return;
    const shownSlot = activeSlots ? activeSlots[layer] : undefined;
    const targetSlot = targetSlotsRef && targetSlotsRef.current ? targetSlotsRef.current[layer] : undefined;
    const shown = Number.isInteger(shownSlot) && shownSlot >= 0 ? omEnd(omTileUrls[`${layer}-slot-${shownSlot}`]) : null;
    const want = Number.isInteger(targetSlot) ? omEnd(omTileUrls[`${layer}-slot-${targetSlot}`]) : null;
    publishRasterDrawn({ layer, shown, want });
  }, [activeLayers, activeSlots, omTileUrls, targetSlotsRef]);
}

const fmtHour = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' });
const fmtClock = (ms) => new Date(ms).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });

/**
 * Words for the pair, in the marine readout's states. `requestedMs` = the selected instant (now + hour; radar: its frame).
 * Returns null when the layer shows what was asked (or the readout is killed).
 */
export function describeRasterFrame(rec, layer, requestedMs) {
  if (rasterReadoutKilled() || !rec || rec.layer !== layer) return null;
  const name = RASTER_NAMES[layer] || layer;
  const fmt = layer === 'radar' ? fmtClock : fmtHour;
  const { shown, want } = rec;
  if (!want) return null;
  if (!shown) return { state: 'pending', text: `Loading ${name} ${fmt(want.dataMs)}…` };
  if (shown.url !== want.url) {
    const models = shown.model && want.model && shown.model !== want.model;
    return { state: 'pending', text: models
      ? `Loading ${want.model} ${name}… still showing ${shown.model} ${name}`
      : `Loading ${fmt(want.dataMs)}… still showing ${fmt(shown.dataMs)}` };
  }
  // A stand-in past the picked model's range (own frames: GFS beyond EURO's 240 h / ICON's 180 h): the wave layers' words.
  if (shown.estimated) return { state: 'estimated', text: `Estimated forecast: ${ESTIMATE_WORDS[shown.estimated] || 'estimated'}` };
  if (layer !== 'radar' && Number.isFinite(requestedMs)) {
    const dh = Math.round((shown.dataMs - requestedMs) / 3600000);
    if (dh !== 0 && Math.abs(dh) <= (shown.nearestMaxHours || 0)) return { state: 'nearest', text: `Showing ${fmt(shown.dataMs)}: the nearest stored forecast` };
  }
  return null;
}
