/**
 * marineFrameStoreCrop.js — the GPU frame store's CROP show (2026-10-22, the mid-zoom instant scrub).
 *
 * WHY. At the zooms people scrub (about z4.5-7 on a desktop, z3.5-5 on a small window) the resident wave grid is a viewport CLIP
 * of the 2-degree global_mid (27 x 20 on the owner's console), now served from the static frame itself (staticFrameCrop.js). The
 * store's fast path (marineFrameStoreRuntime.tryShowStoredFrame) only knew world-sized residents: noteCommitted recorded
 * `dims_differ` and every step missed with `resident_not_this_set`, so a step waited for the normal path (a fixed 150 ms debounce
 * plus the fetch; measured offline 190-200 ms p95, seconds live while the backend answered).
 *
 * WHAT. When the resident grid is a window of the pinned frame's lattice, a step shows that SAME window of the stepped-to frame:
 *   - the window is read from the committed grid (before the engine's dead-edge trim, which the pack repeats exactly);
 *   - its bytes are PACKED from the frame's parsed planes with marineFramePack.packStaticFrame on the window alone. Not a copy of
 *     the world texture: land extrapolation and direction dilation read neighbours, and a world texture's sub-rectangle differs from
 *     the encoded clip in 6.7 % of texels, up to 2 cells inside its edge (measured on the real frame, 295 windows). Packed on the
 *     window, the bytes are the encoder's own for the clip (marineFrameStoreCrop.test.js pins them on both static lanes);
 *   - packs are built as frames are parsed (the store's prefetch and fill, #422's own loads) while a window is resident, and on a
 *     miss through the shared loader (HTTP-cached bytes); a small LRU holds them (a 27 x 20 window is 2 KB).
 * Kill: window.__RAW_DISABLE_FRAME_STORE_CROP__ = true (the store shows world-sized residents only, as before). Read per call.
 */
import { packStaticFrame } from './marineFramePack';

const CROP_LRU_MAX = 160;              // packs kept: every frame of a run (GFS/ICON 113) for one window, plus a previous window's tail

export const cropShowOn = () => (typeof window === 'undefined' || window.__RAW_DISABLE_FRAME_STORE_CROP__ !== true);

/**
 * The window of the frame lattice `ig` ({ bounds, cols, rows }, row 0 = south, column 0 = west) that `grid` (the committed grid,
 * before the engine's trim) occupies, or null when it is not an exact sub-block of that lattice (another product, a world grid,
 * a regional tile, a crossing box). Returns { c0, r0, cols, rows, key }.
 */
export function frameWindowOf(grid, ig) {
  const b = grid && grid.bounds; const g = ig && ig.bounds;
  if (!b || !g || !(grid.cols >= 2) || !(grid.rows >= 2) || !(ig.cols >= 2) || !(ig.rows >= 2)) return null;
  if (grid.cols === ig.cols && grid.rows === ig.rows) return null;                     // the world frame itself: not a crop
  const dLng = (g.east - g.west) / (ig.cols - 1); const dLat = (g.north - g.south) / (ig.rows - 1);
  if (!(dLng > 0) || !(dLat > 0)) return null;
  const c0 = Math.round((b.west - g.west) / dLng); const r0 = Math.round((b.south - g.south) / dLat);
  const cols = grid.cols; const rows = grid.rows;
  if (c0 < 0 || r0 < 0 || c0 + cols > ig.cols || r0 + rows > ig.rows) return null;
  const near = (a, x) => Math.abs(a - x) < 1e-6;
  if (!near(g.west + c0 * dLng, b.west) || !near(g.west + (c0 + cols - 1) * dLng, b.east)
    || !near(g.south + r0 * dLat, b.south) || !near(g.south + (r0 + rows - 1) * dLat, b.north)) return null;
  // The lattice travels with the window: a frame on another lattice is never sliced by it (packWindow refuses).
  return { c0, r0, cols, rows, key: `${c0},${r0},${cols},${rows}@${ig.cols}x${ig.rows}`, lattice: { cols: ig.cols, rows: ig.rows, bounds: { ...g } } };
}

/** The validity cells a crop show tolerates: the world's 64 (0.4 % of 15,023) scaled to the window, at least 1. */
export function cropToleranceCells(cells, worldTolerance = 64) {
  return Math.min(worldTolerance, Math.max(1, Math.ceil(0.004 * cells)));
}

/** packStaticFrame on the window's planes only: the encoder's bytes for the clip, trimmed as the engine trims it. Null when the
 *  frame is not on the window's lattice. */
export function packWindow(parsed, win, opts) {
  if (!parsed || !win || !parsed.fields) return null;
  const L = win.lattice;
  const same = (a, x) => Math.abs(a - x) < 1e-6;
  if (L && (parsed.cols !== L.cols || parsed.rows !== L.rows
    || !['west', 'south', 'east', 'north'].every((k) => same(parsed.bounds[k], L.bounds[k])))) return null;
  const { cols: C, bounds: B } = parsed;
  const dLng = (B.east - B.west) / (parsed.cols - 1); const dLat = (B.north - B.south) / (parsed.rows - 1);
  const fields = {};
  for (const [id, plane] of Object.entries(parsed.fields)) {
    if (!plane) continue;
    const out = new Float64Array(win.cols * win.rows);
    let k = 0;
    for (let r = win.r0; r < win.r0 + win.rows; r++) {
      const base = r * C;
      for (let c = win.c0; c < win.c0 + win.cols; c++) out[k++] = plane[base + c];
    }
    fields[id] = out;
  }
  const bounds = { west: B.west + win.c0 * dLng, east: B.west + (win.c0 + win.cols - 1) * dLng,
    south: B.south + win.r0 * dLat, north: B.south + (win.r0 + win.rows - 1) * dLat };
  return packStaticFrame({ ...parsed, cols: win.cols, rows: win.rows, bounds, fields }, opts);
}

/** A small LRU of crop packs keyed by set, valid time and window. */
export function createCropPacks(max = CROP_LRU_MAX) {
  const m = new Map();
  const id = (setKey, validTime, winKey) => `${setKey}|${validTime}|${winKey}`;
  return {
    get(setKey, validTime, winKey, signature) {
      const k = id(setKey, validTime, winKey); const hit = m.get(k);
      if (!hit || hit.signature !== signature) return null;
      m.delete(k); m.set(k, hit);
      return hit;
    },
    put(setKey, validTime, winKey, pack) {
      const k = id(setKey, validTime, winKey);
      m.delete(k); m.set(k, pack);
      while (m.size > max) m.delete(m.keys().next().value);
    },
    has: (setKey, validTime, winKey) => m.has(id(setKey, validTime, winKey)),
    size: () => m.size,
    clear: () => m.clear(),
  };
}
