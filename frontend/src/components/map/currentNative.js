/**
 * NATIVE 1/12-DEG CURRENTS ON THE SURF BOXES (2026-11-22; DARK). The director's assignment from the research lead's Q3 note
 * (docs/weather-program/research/q3-surface-current-source-skill-2026-11-22.md, red flag 1): the world Currents set averages
 * Copernicus GLO-PHY onto 0.25 deg, which throws away its 1/12-deg coastal detail. The publisher now writes that model's own
 * cells on each surf box (backend frame_set_raster_currents_native.py: CMEMS/marine/currents/<box>_0p083, speed band + the flow
 * direction byte at EVERY cell, grid.flow_dir_stride = 1 in the index).
 *
 * WHAT THIS DOES. With Currents flowing (currentParticles.js) on the Copernicus set, and the WHOLE view inside one box, the
 * particles advect on that box's native frame for the same hour (and the marks' colour / ocean mask come from it too, so the
 * coastline the marks respect is the 1/12-deg one). Anywhere else, or with any doubt (no box frame for the hour, another ocean
 * model on screen, a failed load), the world grid flows as before. The raster under the marks is unchanged (the world set).
 * Nothing here is labelled as better: it is the same model at its own resolution (Q3: no skill claim before the check).
 *
 * DARK: on only with window.__RAW_CURRENTS_NATIVE__ = true (or localStorage '__RAW_CURRENTS_NATIVE__' = '1' on a phone).
 * Kill: window.__RAW_DISABLE_CURRENTS_NATIVE__ = true. Off with the Currents particles (their kill, prefers-reduced-motion).
 * Read-back: window.__RAW_CURRENT_NATIVE__ = { box, state, cols, rows, validMs }.
 */
import { useEffect, useState } from 'react';
import { fetchFrameBytes, getPinnedIndex, staticFramesBase } from './staticFrames';
import { decodeOwnField } from './ownRasterDecode';
import { CURRENT_BAND_FIELD, FLOW_DIR_BYTE_FIELD, MISSING, SPEED_FIELD } from './ownRasterFrames';
import { buildCurrentGrid, currentParticlesOn, useShownCurrentGrid } from './currentParticles';
import { isHandheldDevice } from './deviceTier';

/** Each box as published (west, south, east, north), snapped inward to the 1/12-deg lattice: backend
 *  frame_set_raster_currents_native.box_window over pilot_regions (pinned by tests/test_frame_set_raster_currents_native.py). */
export const NATIVE_BOXES = Object.freeze({
  florida_east_coast: [-85.0, 24.0, -79.0, 31.0],
  us_west_coast_socal: [-125.0, 30.0, -115.0, 38.0],
  hawaii: [-161.0, 18.0, -154.0, 23.0],
  iberia_west: [-11.0, 36.0, -6.0, 44.0],
  uk_ireland: [-11.0, 49.0, 1.0, 59.0],
  east_australia: [150.0, -38.0, 156.0, -25.0],
  indonesia: [98.0, -11.0, 120.0, 2.0],
  brazil_east: [-49.0, -27.0, -34.0, -3.0],
  south_africa: [17.0, -35.0, 28.0, -31.0],
  mexico_centralamerica_pac: [-106.0, 8.0, -84.0, 21.0],
  us_southeast_midatlantic: [-82.0, 31.0, -74.4167, 37.5],
  azores: [-29.75, 36.0, -24.0, 40.0833],
  us_northeast: [-76.0833, 37.5, -69.0, 44.5833],
  france_biscay: [-6.0, 42.5, 1.0, 48.75],
});
/** The world grid's source whose model the box sets refine (currentParticles.buildCurrentGrid's `currents:<set>`). */
export const NATIVE_REFINES = 'currents:cmems/marine/currents/global_0p25';
export const nativeKey = (box) => `CMEMS/marine/currents/${box}_0p083`;

const W = () => (typeof window !== 'undefined' ? window : null);

export function currentsNativeOn(win = W()) {
  if (!win || win.__RAW_DISABLE_CURRENTS_NATIVE__ === true || !currentParticlesOn(win)) return false;
  let lever = win.__RAW_CURRENTS_NATIVE__;
  if (lever === undefined || lever === null) {
    try { lever = win.localStorage ? win.localStorage.getItem('__RAW_CURRENTS_NATIVE__') : null; } catch (e) { lever = null; }
  }
  return lever === true || lever === '1' || lever === 'true';
}

/** The box that holds the WHOLE view ({west, south, east, north}), the smallest if several; null otherwise. PURE.
 *  A view on a wrapped world copy (MapLibre's getBounds gives e.g. west -520) is shifted by the multiple of 360 that brings its
 *  centre into -180..180 first; a view whose west is not below its east is no box. */
export function boxFor(raw) {
  if (!raw || ![raw.west, raw.south, raw.east, raw.north].every(Number.isFinite) || !(raw.west < raw.east)) return null;
  const shift = 360 * Math.round(((raw.west + raw.east) / 2) / 360);
  const view = { west: raw.west - shift, east: raw.east - shift, south: raw.south, north: raw.north };
  let best = null; let area = Infinity;
  for (const [box, [w, s, e, n]] of Object.entries(NATIVE_BOXES)) {
    if (view.west >= w && view.east <= e && view.south >= s && view.north <= n) {
      const a = (e - w) * (n - s);
      if (a < area) { best = box; area = a; }
    }
  }
  return best;
}

function viewOf(map) {
  try {
    const b = map.getBounds();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  } catch (e) { return null; }
}

const note = (rec) => { const w = W(); if (w) w.__RAW_CURRENT_NATIVE__ = { at: Date.now(), ...rec }; };

// One decoded field per frame path (a scrub back reuses it); small, the box frames are 3-70 kB.
const _fields = new Map();
const _inflight = new Map();
const FIELDS_KEPT = 8;

/** The box's decoded native field for the hour (exact valid time), or null (no index, no frame for the hour, a failed load). */
export async function loadNativeField(box, validMs) {
  const index = await getPinnedIndex(nativeKey(box)).catch(() => null);
  const frame = index && Array.isArray(index.frames)
    ? index.frames.find((f) => f && f.path && Math.abs(Date.parse(f.valid_time) - validMs) < 1000) : null;
  if (!frame) return null;
  if (_fields.has(frame.path)) return _fields.get(frame.path);
  if (!_inflight.has(frame.path)) {
    _inflight.set(frame.path, (async () => {
      const got = await fetchFrameBytes(frame.url || staticFramesBase() + frame.path, undefined, 'low');
      if (!got || got.error) return null;
      const field = await decodeOwnField(got.buffer, [CURRENT_BAND_FIELD, SPEED_FIELD], MISSING, [FLOW_DIR_BYTE_FIELD]).catch(() => null);
      if (!field || !field.dirCodes || Math.abs(field.validMs - validMs) > 1000) return null;
      delete field.offThread;
      field.dirStride = (index.grid && Number(index.grid.flow_dir_stride)) || 1;
      _fields.set(frame.path, field);
      while (_fields.size > FIELDS_KEPT) _fields.delete(_fields.keys().next().value);
      return field;
    })().catch(() => null).finally(() => _inflight.delete(frame.path)));
  }
  return _inflight.get(frame.path);
}

const _grids = new WeakMap();
/** The particle grid on a native box field: every 1/12-deg cell (every second on a phone). Built once per field. */
export function nativeGridOf(field, box) {
  if (!field) return null;
  if (!_grids.has(field)) {
    let handheld = false; try { handheld = !!isHandheldDevice(); } catch (e) { /* no device tier */ }
    _grids.set(field, buildCurrentGrid(field, `cmems/marine/currents/${box}_0p083`, handheld ? 2 : 1));
  }
  return _grids.get(field);
}

/**
 * React: the grid the Currents particles flow on. The world grid (useShownCurrentGrid) unless the native sets are on, the world
 * grid is Copernicus, and the whole view sits in one box with a native frame for the shown hour: then that box's native grid.
 * While the next hour's box frame loads, the previous native grid stays (no reseed flash); a miss falls back to the world grid.
 */
export function useCurrentFlowGrid(on, mapInstance) {
  const world = useShownCurrentGrid(on);
  const [box, setBox] = useState(null);
  const [native, setNative] = useState(null);

  useEffect(() => {
    if (!on || !mapInstance) { setBox(null); return undefined; }
    // The lever and its kill are read on every move, so either takes effect at the next pan or zoom without a reload.
    const update = () => setBox(currentsNativeOn() ? boxFor(viewOf(mapInstance)) : null);
    update();
    mapInstance.on('moveend', update);
    return () => { try { mapInstance.off('moveend', update); } catch (e) { /* map gone */ } };
  }, [on, mapInstance]);

  const validMs = world && world.valid_time ? Date.parse(world.valid_time) : NaN;
  const wanted = !!(box && world && world.source === NATIVE_REFINES && Number.isFinite(validMs));
  useEffect(() => {
    if (!wanted) { setNative(null); note({ box, state: box ? 'world_not_copernicus' : 'outside' }); return undefined; }
    let alive = true;
    loadNativeField(box, validMs).then((field) => {
      if (!alive) return;
      const grid = nativeGridOf(field, box);
      setNative(grid ? { box, grid } : null);
      note({ box, validMs, state: grid ? 'flowing' : 'no_frame', cols: grid ? grid.cols : 0, rows: grid ? grid.rows : 0 });
    });
    return () => { alive = false; };
  }, [wanted, box, validMs]);

  return wanted && native && native.box === box ? native.grid : world;
}

export function _resetCurrentNativeForTest() { _fields.clear(); _inflight.clear(); }
