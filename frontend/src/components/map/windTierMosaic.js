/**
 * ONE PICTURE FROM TWO TIERS (2026-10-09, owner: the hurricane eye must keep its place and shape across zoom-in and
 * zoom-out tier changes).
 *
 * The server answers each view with its own sampling lattice: 1 deg for a box up to 400 deg2, 0.5 deg up to 100, 0.25
 * deg up to 25 (route_helpers.choose_adaptive_resolution), every box snapped to whole degrees, so the lattices NEST and
 * the tiers agree at their shared nodes (wind-bench fixtures: 0.25 vs 0.5 deg, mean |dV| 0.009 kn over 405 nodes). The
 * engine holds ONE fine overlay, so on a zoom-out the covering 0.5 or 1-deg box REPLACED the 0.25-deg box and the eye was
 * redrawn from every 2nd or 4th node (ladder bench: the eye moves and its area grows by a multiple at each such step).
 *
 * Instead of replacing, file a MOSAIC: the incoming coarser box resampled onto the resident fine lattice (bilinear u/v,
 * exactly what the shader draws from that box when the lattices nest), with the fine nodes kept where the two overlap
 * and blended over `featherCells` cells at the fine box's inner edges, as the shader blends a fine box into the base.
 * One texture, no shader change: the eye keeps the nodes it was drawn from, the rest of the view keeps the incoming box.
 * No served number moves; a zoom-in still files the finer box as before.
 * Kill: window.__RAW_DISABLE_WIND_TIER_MOSAIC__ (a coarser covering box replaces the finer one again).
 */
import { windBoundsContain } from './WebGLWindUtils';

export const TIER_MOSAIC = Object.freeze({ coarserBy: 1.3, minInnerCells: 4, featherCells: 2, maxNodes: 40000, maxInnerOlderMs: 30 * 60 * 1000 });

/** The truly fine grid a resident overlay carries: a mosaic's inner box, else the grid itself. */
export const tierInner = (g) => (g && g.__tierMosaic ? g.__tierMosaic.inner : g);
/** The served product a resident overlay was last filed from: a mosaic's outer box, else the grid itself. */
export const tierOuter = (g) => (g && g.__tierMosaic ? g.__tierMosaic.outer : g);
/** The bounds of the truly fine nodes a resident overlay DRAWS: the window a mosaic kept, else the grid's own bounds. */
export const tierKept = (g) => (g && g.__tierMosaic ? g.__tierMosaic.kept : (g && g.bounds) || null);

const lngCell = (g) => (g && g.bounds && g.cols > 1 ? (g.bounds.west > g.bounds.east ? g.bounds.east + 360 - g.bounds.west : g.bounds.east - g.bounds.west) / (g.cols - 1) : Infinity);
/**
 * NEVER DOWNGRADE THE VIEW, mosaic or not (the engine asks this of a grid clearly coarser than the resident overlay's
 * lattice). True when `incoming` adds nothing: it lies inside the fine nodes the overlay draws, or it lies inside the
 * overlay and is clearly coarser than the SERVED box around those nodes too. For a plain overlay both are the engine's
 * pre-mosaic rule (coarser than the resident and inside it).
 */
export function tierKeepsOver(resident, incoming) {
  if (!resident || !resident.bounds || !incoming || !incoming.bounds) return false;
  if (windBoundsContain(tierKept(resident), incoming.bounds)) return true;
  const outer = tierOuter(resident);
  return outer !== resident && lngCell(incoming) > lngCell(outer) * TIER_MOSAIC.coarserBy && windBoundsContain(resident.bounds, incoming.bounds);
}

const plain = (g) => !!(g && g.bounds && g.cols > 1 && g.rows > 1 && g.bounds.west < g.bounds.east && g.bounds.south < g.bounds.north
  && Array.isArray(g.vectors) && g.vectors.length === g.cols * g.rows);
const cellOf = (g) => [(g.bounds.east - g.bounds.west) / (g.cols - 1), (g.bounds.north - g.bounds.south) / (g.rows - 1)];
const modelOf = (g) => g.source || (g.truthTag && g.truthTag.model) || null;
// The frame a grid really carries. /grid echoes the REQUESTED hour in `valid_time` and names a nearest-frame stand-in
// in `served_valid_time` (grid_resolver.stamp_frame_honesty): a stored 3-hourly tile can sit 1.5 h from the asked hour.
const frameOf = (g) => Date.parse(g.served_valid_time || g.valid_time || g.validTime || '');
const builtOf = (g) => Date.parse(g.run_time || '');
const laneOf = (g) => (g.wind_lane ? `${g.wind_lane.lane || ''}|${g.wind_lane.hrrr_cycle || ''}` : null);
// The model CYCLE a grid verifiably names. Never `run_time`: on a dynamic box that is the legacy INGEST stamp
// (normalizer.py: `run_time = ingested_at`), one per built box, so two boxes of one cycle never share it.
const runOf = (g) => (g.model_run_time && g.model_run_time_status === 'known' ? g.model_run_time : null);

/**
 * The same air: one model, one asked hour, one SERVED frame, one model cycle and one wind lane (HRRR cycle) when both
 * name them. And never older data inside a newer box: not a stale fine grid inside a fresh one, nor a fine grid BUILT
 * more than 30 minutes before the box (the server rebuilds a dynamic box it has held that long, viewport_helper.py, and
 * Open-Meteo boxes do not name their cycle, so the build clock is the only bound on a cycle change).
 */
export function tierSameAir(outer, inner) {
  if (!modelOf(outer) || modelOf(outer) !== modelOf(inner)) return false;
  if ((outer.hourOffset || 0) !== (inner.hourOffset || 0)) return false;
  const fo = frameOf(outer), fi = frameOf(inner);
  if (!isFinite(fo) || fo !== fi) return false;
  if (runOf(outer) && runOf(inner) && runOf(outer) !== runOf(inner)) return false;
  if (laneOf(outer) && laneOf(inner) && laneOf(outer) !== laneOf(inner)) return false;
  const bo = builtOf(outer), bi = builtOf(inner);
  if (isFinite(bo) && isFinite(bi) && bo - bi > TIER_MOSAIC.maxInnerOlderMs) return false;
  return !(inner.stale === true && outer.stale !== true);
}

/** Bilinear (u, v) of a point-registered grid at a point inside its bounds; null when a corner is not a finite vector. */
function bilinearUV(g, lng, lat, dx, dy) {
  const fx = Math.min(g.cols - 1, Math.max(0, (lng - g.bounds.west) / dx)), fy = Math.min(g.rows - 1, Math.max(0, (lat - g.bounds.south) / dy));
  const i0 = Math.min(g.cols - 2, Math.floor(fx)), j0 = Math.min(g.rows - 2, Math.floor(fy)), tx = fx - i0, ty = fy - j0;
  const a = g.vectors[j0 * g.cols + i0], b = g.vectors[j0 * g.cols + i0 + 1], c = g.vectors[(j0 + 1) * g.cols + i0], d = g.vectors[(j0 + 1) * g.cols + i0 + 1];
  const u = (a.u * (1 - tx) + b.u * tx) * (1 - ty) + (c.u * (1 - tx) + d.u * tx) * ty;
  const v = (a.v * (1 - tx) + b.v * tx) * (1 - ty) + (c.v * (1 - tx) + d.v * tx) * ty;
  return isFinite(u) && isFinite(v) ? [u, v] : null;
}

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const r6 = (x) => +x.toFixed(6);

/**
 * The mosaic of `incoming` (a coarser box) around the fine grid `resident` carries, or null when there is nothing to
 * keep: the kill switch, other air (tierSameAir), an incoming grid that is not a coarser tier, a fine box that no
 * longer overlaps it by `minInnerCells` cells, an antimeridian box, or a lattice above `maxNodes` nodes.
 */
export function tierMosaic(incoming, resident, win = (typeof window !== 'undefined' ? window : null)) {
  if (win && win.__RAW_DISABLE_WIND_TIER_MOSAIC__ === true) return null;
  const inner = tierInner(resident);
  if (!plain(incoming) || !plain(inner) || !tierSameAir(incoming, inner)) return null;
  const [dx, dy] = cellOf(inner), [ox, oy] = cellOf(incoming), ib = inner.bounds, ob = incoming.bounds, eps = 1e-6;
  if (!(ox >= dx * TIER_MOSAIC.coarserBy && oy >= dy * TIER_MOSAIC.coarserBy)) return null;
  // The inner grid's own lattice, extended over the incoming box (indices relative to the inner grid's south-west node).
  const i0 = Math.ceil((ob.west - ib.west) / dx - eps), i1 = Math.floor((ob.east - ib.west) / dx + eps);
  const j0 = Math.ceil((ob.south - ib.south) / dy - eps), j1 = Math.floor((ob.north - ib.south) / dy + eps);
  const a0 = Math.max(i0, 0), a1 = Math.min(i1, inner.cols - 1), b0 = Math.max(j0, 0), b1 = Math.min(j1, inner.rows - 1);
  if (a1 - a0 < TIER_MOSAIC.minInnerCells || b1 - b0 < TIER_MOSAIC.minInnerCells) return null;
  const cols = i1 - i0 + 1, rows = j1 - j0 + 1, F = TIER_MOSAIC.featherCells;
  if (cols * rows > TIER_MOSAIC.maxNodes) return null;
  const vectors = new Array(cols * rows);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const lng = ib.west + i * dx, lat = ib.south + j * dy;
      const o = bilinearUV(incoming, lng, lat, ox, oy);
      if (!o) return null;
      let [u, v] = o;
      if (i >= a0 && i <= a1 && j >= b0 && j <= b1) {
        // Cells to the nearest fine-box edge that lies INSIDE the mosaic (an edge on its rim meets the base, not this box).
        const d = Math.min(i0 < 0 ? i : Infinity, i1 > inner.cols - 1 ? inner.cols - 1 - i : Infinity, j0 < 0 ? j : Infinity, j1 > inner.rows - 1 ? inner.rows - 1 - j : Infinity);
        const f = inner.vectors[j * inner.cols + i], w = smooth(d / F);
        if (!f || !isFinite(f.u) || !isFinite(f.v)) return null;
        u += (f.u - u) * w; v += (f.v - v) * w;
      }
      vectors[(j - j0) * cols + (i - i0)] = { lat: r6(lat), lng: r6(lng), u, v, speed: Math.hypot(u, v), is_valid: true };
    }
  }
  const bounds = { west: r6(ib.west + i0 * dx), south: r6(ib.south + j0 * dy), east: r6(ib.west + i1 * dx), north: r6(ib.south + j1 * dy) };
  const kept = { west: r6(ib.west + a0 * dx), south: r6(ib.south + b0 * dy), east: r6(ib.west + a1 * dx), north: r6(ib.south + b1 * dy) };
  const mosaic = {
    ...incoming, vectors, bounds, cols, rows, nonzeroCount: vectors.length,
    truthTag: incoming.truthTag ? { ...incoming.truthTag, cols, rows } : incoming.truthTag,
    __tierMosaic: { outer: incoming, inner, kept, outerCell: r6(ox), innerCell: r6(dx) },
  };
  if (win) {
    const d = win.__WIND_TIER_MOSAIC__ || (win.__WIND_TIER_MOSAIC__ = { built: 0, last: null });
    d.built += 1;
    d.last = { outer: `${incoming.cols}x${incoming.rows} @ ${r6(ox)} deg`, inner: `${inner.cols}x${inner.rows} @ ${r6(dx)} deg`, kept, cols, rows };
  }
  return mosaic;
}
