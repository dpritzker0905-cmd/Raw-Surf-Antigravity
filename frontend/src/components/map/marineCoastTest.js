/**
 * marineCoastTest.js — does a box contain any coastline, read from the map's own land polygons (D3, 2026-11-01).
 *
 * The coarse preview (marineColdVeil.js) must never paint at a coast. Its first rules (the 19 pilot boxes; a land / no-data node of the
 * 2-deg grid) were measured on real CDN frames and the second rarely fires: the published world frame carries values on the land nodes
 * next to coasts (0 such nodes within one cell of Cocoa z9 or Baja z8). This reads the land the engine itself masks with: the Natural
 * Earth polygons MapPage fetches (getSharedLandGeoJSON: ne_50m, ne_110m fallback) and passes to setWaveData (engine._landGeoJSON).
 *
 * coastInBox(land, [w, s, e, n]) -> true when any land-ring vertex lies in the box or any ring edge crosses it; false when no ring
 * touches it (open water, or a box wholly inside one landmass); null when there is no land data (the caller fails closed).
 * Each ring's bounding box is computed once per GeoJSON object (WeakMap), so a test is a bbox prefilter plus the rings that overlap.
 */
const _index = new WeakMap();

function indexOf(land) {
  let ix = _index.get(land);
  if (ix) return ix;
  ix = [];
  for (const f of land.features || []) {
    const g = f && f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : []);
    for (const poly of polys || []) {
      for (const ring of poly || []) {
        if (!Array.isArray(ring) || ring.length < 2) continue;
        let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
        for (const p of ring) { const x = p[0]; const y = p[1]; if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
        ix.push({ ring, w, s, e, n });
      }
    }
  }
  _index.set(land, ix);
  return ix;
}

/** Liang-Barsky: does the segment a-b meet the box? */
function segmentHitsBox(a, b, w, s, e, n) {
  let t0 = 0; let t1 = 1;
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const edges = [[-dx, a[0] - w], [dx, e - a[0]], [-dy, a[1] - s], [dy, n - a[1]]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1;
}

export function coastInBox(land, box) {
  if (!land || !Array.isArray(land.features)) return null;
  const [w, s, e, n] = box;
  for (const r of indexOf(land)) {
    if (r.e < w || r.w > e || r.n < s || r.s > n) continue;
    const ring = r.ring;
    for (let i = 0; i < ring.length; i++) {
      const x = ring[i][0]; const y = ring[i][1];
      if (x >= w && x <= e && y >= s && y <= n) return true;
      if (i > 0 && segmentHitsBox(ring[i - 1], ring[i], w, s, e, n)) return true;
    }
  }
  return false;
}
