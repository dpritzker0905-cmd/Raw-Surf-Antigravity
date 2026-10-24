/**
 * isobarContours.js — isobars and H/L centres from one pressure frame (2026-10-24, per-model pressure; the lead: "the colour
 * field plus labelled isobars every 4 hPa (bold every 20) plus H/L markers; compute contours in a worker per frame and cache
 * them, never on the scrub path; not colour-only"). PURE (no DOM, no GL): isobarWorker.js runs it off the main thread, and the
 * tests run it directly.
 *
 * Input: the frame's field as ownRasterFrames.toField makes it: { cols, rows, bounds, values } with row 0 = SOUTH, column 0 =
 * WEST, bounds = the outer cell CENTRES, MISSING (< 0) for no data. A global grid wraps in longitude (no repeated column).
 *  - smoothField: one 3 x 3 box pass (wrapping in longitude), for the LINES and the centres only: at 0.5 degrees the raw MSLP
 *    over steep terrain draws saw-tooth isobars; the colour field keeps the raw values.
 *  - isobars: marching squares per level (every `step` hPa), segments stitched into lines, as GeoJSON LineStrings in lon/lat
 *    with { hpa, major } (major = every `major` hPa); a global grid's lines close across the antimeridian.
 *  - pressureCentres: H and L where a cell is the max / min of its neighbourhood (a 2-degree lattice, radius ~10 degrees) and
 *    stands at least `prominence` hPa from the neighbourhood's mean; |lat| <= 80.
 */
export const DEFAULTS = { step: 4, major: 20, prominence: 4, radiusDeg: 10, maxLat: 80 };

const isGlobal = (f) => {
  const dLon = (f.bounds.east - f.bounds.west) / (f.cols - 1);
  return Math.abs(f.cols * dLon - 360) < dLon * 0.01;
};

/** One 3 x 3 box pass; missing cells (< 0) stay missing and are left out of their neighbours' means. */
export function smoothField(f) {
  const { cols, rows, values } = f;
  const wrap = isGlobal(f);
  const out = new Float32Array(values.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!(values[i] >= 0)) { out[i] = values[i]; continue; }
      let s = 0; let n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          let cc = c + dc;
          if (cc < 0 || cc >= cols) { if (!wrap) continue; cc = (cc + cols) % cols; }
          const v = values[rr * cols + cc];
          if (v >= 0) { s += v; n += 1; }
        }
      }
      out[i] = s / n;
    }
  }
  return { ...f, values: out };
}

/** The levels to draw: multiples of `step` from the field's min to max. */
export function contourLevels(values, step = DEFAULTS.step) {
  let lo = Infinity; let hi = -Infinity;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (v >= 0) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  if (!(hi >= lo)) return [];
  const out = [];
  for (let l = Math.ceil(lo / step) * step; l <= hi; l += step) out.push(l);
  return out;
}

// Marching squares over the grid (x = column, y = row; a global grid adds the wrap column x = cols, which is column 0 again), ONE
// pass over the cells for ALL levels: a cell only meets the levels between its corners' min and max (a level step is 4 hPa; most
// cells meet none or one). Each crossing point is keyed by the EDGE it sits on (a number: horizontal edges even, vertical odd),
// so the two cells sharing an edge produce the same key and stitching is exact.
export function segmentsAll(f, levels) {
  const { cols, rows, values } = f;
  const xs = isGlobal(f) ? cols : cols - 1;
  const out = new Map(levels.map((l) => [l, []]));
  if (!levels.length) return out;
  const step = levels.length > 1 ? levels[1] - levels[0] : 1;
  const l0 = levels[0];
  const hKey = (x, y) => (y * cols + (x % cols)) * 2;
  const vKey = (x, y) => (y * cols + (x % cols)) * 2 + 1;
  for (let y = 0; y < rows - 1; y++) {
    const r0 = y * cols; const r1 = (y + 1) * cols;
    for (let x = 0; x < xs; x++) {
      const x1 = (x + 1) % cols;
      const a = values[r0 + x]; const b = values[r0 + x1]; const c = values[r1 + x1]; const d = values[r1 + x];
      if (!(a >= 0 && b >= 0 && c >= 0 && d >= 0)) continue;
      const lo = Math.min(a, b, c, d); const hi = Math.max(a, b, c, d);
      let k = Math.max(0, Math.ceil((lo - l0) / step));
      for (; k < levels.length; k++) {
        const level = levels[k];
        if (level > hi) break;
        const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const segs = out.get(level);
        const S = () => ({ k: hKey(x, y), x: x + (level - a) / (b - a), y });
        const E = () => ({ k: vKey(x + 1, y), x: x + 1, y: y + (level - b) / (c - b) });
        const N = () => ({ k: hKey(x, y + 1), x: x + (level - d) / (c - d), y: y + 1 });
        const Wd = () => ({ k: vKey(x, y), x, y: y + (level - a) / (d - a) });
        switch (code) {
          case 1: case 14: segs.push([S(), Wd()]); break;
          case 2: case 13: segs.push([S(), E()]); break;
          case 3: case 12: segs.push([Wd(), E()]); break;
          case 4: case 11: segs.push([E(), N()]); break;
          case 6: case 9: segs.push([S(), N()]); break;
          case 7: case 8: segs.push([Wd(), N()]); break;
          case 5: case 10: {                           // a saddle: decide by the cell's mean
            const mid = (a + b + c + d) / 4 > level;
            if ((code === 5) === mid) { segs.push([S(), E()]); segs.push([N(), Wd()]); } else { segs.push([S(), Wd()]); segs.push([E(), N()]); }
            break;
          }
          default: break;
        }
      }
    }
  }
  return out;
}

/** Join segments that share an end (same edge key) into polylines of grid points. */
export function stitch(segs) {
  const byKey = new Map();
  segs.forEach((s, i) => { for (const p of s) { const l = byKey.get(p.k); if (l) l.push(i); else byKey.set(p.k, [i]); } });
  const used = new Uint8Array(segs.length);
  const lines = [];
  const other = (i, k) => (segs[i][0].k === k ? segs[i][1] : segs[i][0]);
  const walk = (start, line) => {
    let cur = start;
    for (;;) {
      const l = byKey.get(cur.k);
      let next;
      if (l) for (const j of l) if (!used[j]) { next = j; break; }
      if (next === undefined) break;
      used[next] = 1;
      cur = other(next, cur.k);
      line.push(cur);
    }
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const fwd = [segs[i][0], segs[i][1]];
    walk(segs[i][1], fwd);
    const back = [];
    walk(segs[i][0], back);
    lines.push(back.reverse().concat(fwd));
  }
  return lines;
}

/** GeoJSON FeatureCollection of isobars for a field (smooth it first). */
export function isobars(f, { step = DEFAULTS.step, major = DEFAULTS.major } = {}) {
  const dLon = (f.bounds.east - f.bounds.west) / (f.cols - 1);
  const dLat = (f.bounds.north - f.bounds.south) / (f.rows - 1);
  const features = [];
  const levels = contourLevels(f.values, step);
  const all = segmentsAll(f, levels);
  for (const level of levels) {
    for (const line of stitch(all.get(level))) {
      if (line.length < 4) continue;                  // specks
      const coords = [];
      let prevLon = null;
      for (const p of line) {
        let lon = f.bounds.west + p.x * dLon;
        // keep a line continuous across the antimeridian (MapLibre draws longitudes past 180 on the next world copy)
        if (prevLon !== null) { while (lon - prevLon > 180) lon -= 360; while (lon - prevLon < -180) lon += 360; }
        prevLon = lon;
        coords.push([Math.round(lon * 1000) / 1000, Math.round((f.bounds.south + p.y * dLat) * 1000) / 1000]);
      }
      features.push({ type: 'Feature', properties: { hpa: level, major: level % major === 0 }, geometry: { type: 'LineString', coordinates: coords } });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** H / L centres as GeoJSON points { kind: 'H' | 'L', hpa }. */
export function pressureCentres(f, { prominence = DEFAULTS.prominence, radiusDeg = DEFAULTS.radiusDeg, maxLat = DEFAULTS.maxLat } = {}) {
  const dLon = (f.bounds.east - f.bounds.west) / (f.cols - 1);
  const dLat = (f.bounds.north - f.bounds.south) / (f.rows - 1);
  const k = Math.max(1, Math.round(2 / dLat));        // a 2-degree lattice
  const cols = Math.floor(f.cols / k); const rows = Math.floor((f.rows - 1) / k) + 1;
  const g = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) g[r * cols + c] = f.values[(r * k) * f.cols + c * k];
  const rad = Math.max(1, Math.round(radiusDeg / (k * dLat)));
  const wrap = isGlobal(f);
  const features = [];
  for (let r = rad; r < rows - rad; r++) {
    const lat = f.bounds.south + r * k * dLat;
    if (Math.abs(lat) > maxLat) continue;
    for (let c = 0; c < cols; c++) {
      const v = g[r * cols + c];
      if (!(v >= 0)) continue;
      let isMax = true; let isMin = true; let s = 0; let n = 0;
      for (let dr = -rad; dr <= rad && (isMax || isMin); dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (!dr && !dc) continue;
          let cc = c + dc;
          if (cc < 0 || cc >= cols) { if (!wrap) continue; cc = (cc + cols) % cols; }
          const w = g[(r + dr) * cols + cc];
          if (!(w >= 0)) continue;
          if (w >= v) isMax = false;
          if (w <= v) isMin = false;
          s += w; n += 1;
        }
      }
      if (!n || !(isMax || isMin)) continue;
      const mean = s / n;
      if (isMax && v - mean >= prominence) features.push(point('H', v, f.bounds.west + c * k * dLon, lat));
      if (isMin && mean - v >= prominence) features.push(point('L', v, f.bounds.west + c * k * dLon, lat));
    }
  }
  return { type: 'FeatureCollection', features };
}

function point(kind, v, lon, lat) {
  return { type: 'Feature', properties: { kind, hpa: Math.round(v), label: `${kind}\n${Math.round(v)}` }, geometry: { type: 'Point', coordinates: [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100] } };
}

/** Everything the map draws for one frame. */
export function isobarProducts(field, opts = {}) {
  const s = smoothField(field);
  return { lines: isobars(s, opts), centres: pressureCentres(s, opts) };
}
