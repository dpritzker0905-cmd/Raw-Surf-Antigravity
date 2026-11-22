/**
 * CURRENT PARTICLES (2026-11-22, David via the director: "Make the Currents map layer animate: particles flow along the ocean
 * current, the same house look as the Wind layer, in light, dark and beach, on desktop and mobile").
 *
 * Design: ONE particle engine. With Currents picked (and neither Wind nor Gusts), the WIND engine (WebGLWindEngine) is handed a
 * wind-shaped grid built from the currents frame ON SCREEN, so its marks move along the current's own u / v (the frame's speed
 * plus the one-byte flow direction the publisher now writes, backend frame_binary.FLOW_DIR_BYTE). Whatever currents set is on
 * screen drives it (Copernicus today; RTOFS / GIOPS when their sets land): the grid is built from the shown field, never a
 * named source.
 *
 * SCALE. The engine is tuned in wind knots (motion per knot, keep rates, dash, calm-air fade, the ramp), and ocean currents run
 * 0.1-3 kn. Every speed is multiplied by ONE gain, CURRENT_SPEED_GAIN, before it reaches the engine: 1 kn of water moves and
 * draws like 12 kn of air, a 3 kn Gulf Stream core like 36 kn, and still water (< 0.2 kn) falls into the engine's calm band,
 * where marks barely move or fade. The direction is never touched; only the visual speed is exaggerated (as every animated
 * current map does). Readouts and the legend stay in real knots: this grid is never published as wind (WebGLWindLayer).
 * The field under the marks is the Currents raster itself, so the engine's own heatmap pass is skipped (the gust colour path,
 * windGustColour.js, with `sea` set: marks over no-data cells, i.e. land, are not drawn). No current frame for the hour = no
 * grid = nothing drawn; the raster's status line says why.
 *
 * Kill: window.__RAW_DISABLE_CURRENT_PARTICLES__ = true (Currents back to the static raster alone). Off under
 * prefers-reduced-motion (the raster still shows the speed).
 */
import { useEffect, useState } from 'react';
import { isHandheldDevice } from './deviceTier';

export const CURRENT_SPEED_GAIN = 12;
/** The mark ramp's top in engine knots: the currents palette's 4 kn top (currentsPalette.CURRENTS_LUT), scaled. */
export const CURRENT_RAMP_MAX = 4 * CURRENT_SPEED_GAIN;
/** Degrees per direction code (one byte, the publisher's FLOW_DIR_BYTE step). */
export const DIR_STEP_DEG = 360 / 256;

const W = () => (typeof window !== 'undefined' ? window : null);

export function currentParticlesOn(win = W()) {
  if (win && win.__RAW_DISABLE_CURRENT_PARTICLES__ === true) return false;
  try { if (win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) { /* no media queries */ }
  return true;
}

/** True when the wind engine should flow on the current: Currents picked, Wind and Gusts not (they own the particles then). */
export function currentFlowMode(activeLayers, win = W()) {
  const a = Array.isArray(activeLayers) ? activeLayers : [];
  return a.includes('currents') && !a.includes('wind') && !a.includes('gusts') && currentParticlesOn(win);
}

// ── the hand-off: useOwnRasterFrames publishes the currents field it has ON SCREEN, the particle layer reads it ──────────────
let shown = null;
const subs = new Set();

/** The currents field on screen ({cols, rows, bounds, values (kn, very negative = no data), dirCodes?, validMs, source}) or null. */
export function getShownCurrentField() { return shown; }

export function setShownCurrentField(field, source) {
  const next = field && field.values && field.cols > 1 && field.rows > 1 && field.bounds ? { field, source: source || null } : null;
  if ((next && shown && next.field === shown.field && next.source === shown.source) || next === shown) return;
  shown = next;
  subs.forEach((fn) => { try { fn(shown); } catch (e) { /* a subscriber's own failure */ } });
}

export function subscribeCurrentField(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** The set a frame path belongs to ('v1/cmems/marine/currents/global_0p25/<run>/<frame>.bin' -> 'cmems/marine/currents/global_0p25';
 *  backend frame_set.set_prefix). A model picker change (CMEMS -> RTOFS) changes it, and the engine reseeds on a new source. */
export function setOfPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts[0] === 'v1') parts.shift();
  return parts.length >= 6 ? parts.slice(0, 4).join('/') : (parts.length ? parts.join('/') : null);
}

/** The publisher writes one direction per FLOW_DIR_STRIDE x FLOW_DIR_STRIDE block, at the block's first cell (backend
 *  frame_binary.flow_dir_anchors: the block's vector mean, 5.625-deg steps); every other cell is 0. */
export const FLOW_DIR_STRIDE = 2;

/**
 * The wind-shaped grid the engine advects on, in engine knots (x CURRENT_SPEED_GAIN), south-first rows and west-first columns
 * (the wind texture's own orientation). One node per `stride` x `stride` cells (stride = a multiple of the anchor spacing: on the
 * world sets 2 = 0.5 deg, 4 = 1 deg; on a native box set 1 = 1/12 deg), at its first cell: the vector mean, over the direction anchors in its block that have water, of
 * (the mean band speed of the anchor's own block) x (the anchor's direction). Land / no data = u = v = 0. Returns null without
 * a direction (a frame published before the direction byte) or without water. PURE apart from the arrays it allocates.
 */
export function buildCurrentGrid(field, source, stride = FLOW_DIR_STRIDE) {
  if (!field || !field.values || !field.dirCodes || !(field.cols > 1) || !(field.rows > 1) || !field.bounds) return null;
  const { cols, rows, values, dirCodes, bounds } = field;
  // The anchor spacing: one direction per 2 x 2 block on the world sets; every cell on the native 1/12-deg box sets
  // (currentNative.js sets field.dirStride from the index's grid.flow_dir_stride).
  const A = Math.max(1, Math.round(Number(field.dirStride) || FLOW_DIR_STRIDE));
  const k = Math.max(1, Math.round((Number(stride) || A) / A)); const s = A * k;
  const oc = Math.ceil(cols / s); const or = Math.ceil(rows / s);
  const dLon = (bounds.east - bounds.west) / (cols - 1);
  const dLat = (bounds.north - bounds.south) / (rows - 1);
  const vectors = new Array(oc * or);
  let wet = 0;
  for (let r = 0; r < or; r++) {
    for (let c = 0; c < oc; c++) {
      let su = 0; let sv = 0; let na = 0;
      for (let ar = r * s; ar < Math.min(rows, r * s + s); ar += A) {
        for (let ac = c * s; ac < Math.min(cols, c * s + s); ac += A) {
          let sum = 0; let n = 0;   // the anchor's own block: its water's mean speed
          for (let rr = ar; rr < Math.min(rows, ar + A); rr++) {
            for (let cc = ac; cc < Math.min(cols, ac + A); cc++) {
              const kn = values[rr * cols + cc];
              if (kn >= 0 && Number.isFinite(kn)) { sum += kn; n += 1; }   // no data (MISSING) is far below zero
            }
          }
          if (!n) continue;
          const rad = dirCodes[ar * cols + ac] * DIR_STEP_DEG * Math.PI / 180;   // TOWARD: u = +s sin d (east), v = +s cos d
          su += (sum / n) * Math.sin(rad); sv += (sum / n) * Math.cos(rad); na += 1;
        }
      }
      const u = na ? (su / na) * CURRENT_SPEED_GAIN : 0; const v = na ? (sv / na) * CURRENT_SPEED_GAIN : 0;
      if (na) wet += 1;
      vectors[r * oc + c] = { u, v, speed: Math.sqrt(u * u + v * v) };
    }
  }
  if (!wet) return null;
  const validTime = Number.isFinite(field.validMs) ? new Date(field.validMs).toISOString() : null;
  const src = `currents:${source || 'unknown'}`;
  return {
    vectors, cols: oc, rows: or,
    bounds: { west: bounds.west, south: bounds.south, east: bounds.west + (oc - 1) * s * dLon, north: bounds.south + (or - 1) * s * dLat },
    coverage_scope: 'global', source: src, valid_time: validTime, product_id: `${src}@${validTime}`,
    truthTag: { model: src, layer: 'currents', product: `${src}@${validTime}` },
    isCurrentFlow: true,
    colourField: field,   // the colour / sea texture travels WITH the grid (WebGLWindLayer): marks and coastline from one field
  };
}

/**
 * The colour / sea texture for the engine (windGustColour.setGustField's `encoded`): one byte a cell of the FULL frame,
 * byte = 1 + round(min(kn x gain, top) / top x 254), 0 = no data (the shader then hides the mark: ocean only).
 */
export function encodeCurrentColour(field, top = CURRENT_RAMP_MAX) {
  if (!field || !field.values) return null;
  const { cols, rows, values } = field;
  const n = cols * rows; const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    bytes[i] = Number.isFinite(v) && v >= 0 ? 1 + Math.round(Math.min(v * CURRENT_SPEED_GAIN, top) / top * 254) : 0;
  }
  return { bytes, cols, rows, maxKn: top, bounds: field.bounds };
}

const _grids = new WeakMap();
/** The grid for a field, built once per field and set (a scrub back to a frame, or a prewarmed frame, reuses it). */
function gridOf(field, source) {
  const hit = _grids.get(field);
  if (hit && hit.source === source) return hit.grid;
  let handheld = false; try { handheld = !!isHandheldDevice(); } catch (e) { /* no device tier */ }
  const grid = buildCurrentGrid(field, source, handheld ? 4 : 2);   // 0.5 deg (1 deg on phones): 260k / 65k nodes
  _grids.set(field, { source, grid });
  return grid;
}

/**
 * PREWARM (advisor limit (b) on #1137): a grid build walks the whole 1440 x 721 frame on the main thread (measured on a desktop:
 * 22 ms at 0.5 deg, 14 ms at 1 deg; a mid phone is ~4x). ownRasterFrames calls this when it decodes a currents frame (the shown
 * one AND the scrub-ahead window), so the build runs in idle time and the scrub step that shows the frame reads the cache.
 * Kill: window.__RAW_DISABLE_CURRENT_GRID_PREWARM__ = true (built when shown, as before).
 */
export function prewarmCurrentGrid(field, source, win = W()) {
  if (!field || !field.dirCodes || !currentParticlesOn(win)) return false;
  if (win && win.__RAW_DISABLE_CURRENT_GRID_PREWARM__ === true) return false;
  const run = () => { try { gridOf(field, source); } catch (e) { /* the shown path builds it */ } };
  if (win && typeof win.requestIdleCallback === 'function') win.requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 0);
  return true;
}

/** The grid for a shown record (and the page's read-back, window.__RAW_CURRENT_PARTICLES__). */
export function gridForShown(rec) {
  if (!rec || !rec.field) return null;
  const grid = gridOf(rec.field, rec.source);
  const w = W();
  if (w) w.__RAW_CURRENT_PARTICLES__ = { at: Date.now(), source: rec.source, validMs: rec.field.validMs,
    state: grid ? 'flowing' : (rec.field.dirCodes ? 'no_water' : 'no_direction'), cols: grid ? grid.cols : 0, rows: grid ? grid.rows : 0 };
  return grid;
}

/** React: the current grid on screen while `on` (null otherwise, or with no current frame / no direction for the hour). */
export function useShownCurrentGrid(on) {
  const [grid, setGrid] = useState(() => (on ? gridForShown(getShownCurrentField()) : null));
  useEffect(() => {
    if (!on) { setGrid(null); return undefined; }
    setGrid(gridForShown(getShownCurrentField()));
    return subscribeCurrentField((rec) => setGrid(gridForShown(rec)));
  }, [on]);
  return grid;
}
