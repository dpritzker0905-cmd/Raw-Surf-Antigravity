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
export const TIER_MOSAIC = Object.freeze({ coarserBy: 1.3, minInnerCells: 4, featherCells: 2, maxNodes: 40000 });

/** The truly fine grid a resident overlay carries: a mosaic's inner box, else the grid itself. */
export const tierInner = (g) => (g && g.__tierMosaic ? g.__tierMosaic.inner : g);
/** The served product a resident overlay was last filed from: a mosaic's outer box, else the grid itself. */
export const tierOuter = (g) => (g && g.__tierMosaic ? g.__tierMosaic.outer : g);

const plain = (g) => !!(g && g.bounds && g.cols > 1 && g.rows > 1 && g.bounds.west < g.bounds.east && g.bounds.south < g.bounds.north
  && Array.isArray(g.vectors) && g.vectors.length === g.cols * g.rows);
const cellOf = (g) => [(g.bounds.east - g.bounds.west) / (g.cols - 1), (g.bounds.north - g.bounds.south) / (g.rows - 1)];
const modelOf = (g) => g.source || (g.truthTag && g.truthTag.model) || null;
const validOf = (g) => Date.parse(g.valid_time || g.validTime || '');
const runOf = (g) => g.run_time || g.runTime || g.model_run_time || null;

/** The same air: one model, one hour, one valid time, one model run when both say; never stale data inside a fresh box. */
export function tierSameAir(outer, inner) {
  if (!modelOf(outer) || modelOf(outer) !== modelOf(inner)) return false;
  if ((outer.hourOffset || 0) !== (inner.hourOffset || 0)) return false;
  const vo = validOf(outer), vi = validOf(inner);
  if (!isFinite(vo) || vo !== vi) return false;
  if (runOf(outer) && runOf(inner) && runOf(outer) !== runOf(inner)) return false;
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
 * keep: the kill switch, another model / hour / run, an incoming grid that is not a coarser tier, a fine box that no
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
