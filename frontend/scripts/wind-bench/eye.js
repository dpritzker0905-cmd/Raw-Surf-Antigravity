/**
 * Wind bench, EYE mode: what the engine draws for a hurricane eye, measured. Pure, no DOM, no GL.
 *
 * The page draws ONE heatmap frame through the real engine with its colour LUT swapped for a
 * threshold ramp (white below T knots, black above), so the readback is the eye's T-kn contour
 * exactly as the shader samples it: point registration, bilinear filtering, the base+fine
 * composite and its feather. This module turns grids into the engine's shape and that readback
 * into geometry. Tested by src/components/map/windBenchEye.test.js.
 */
const { windAt } = require('./field');

const KM_PER_DEG = 111.32;

/** A fixture ({bounds, cols, rows, u[], v[]} row-major from the south-west) as an engine grid. */
function gridFromFixture(fx, id) {
  const { bounds, cols, rows } = fx;
  const dx = (bounds.east - bounds.west) / (cols - 1), dy = (bounds.north - bounds.south) / (rows - 1);
  const vectors = fx.u.map((u, k) => {
    const v = fx.v[k];
    return { lat: bounds.south + Math.floor(k / cols) * dy, lng: bounds.west + (k % cols) * dx, u, v, speed: Math.hypot(u, v), is_valid: true };
  });
  return engineGrid(vectors, bounds, cols, rows, 'regional', id || fx.product_id || 'fixture', fx.valid_time);
}

function engineGrid(vectors, bounds, cols, rows, scope, id, validTime) {
  const valid = validTime || '2026-10-09T15:00:00Z';
  return {
    vectors, bounds: { ...bounds }, cols, rows, stale: false, source: 'GFS', provider: 'open-meteo', renderable: true,
    nonzeroCount: vectors.length, coverage_scope: scope, product_id: id, productId: id, valid_time: valid, hourOffset: 0,
    truthTag: { model: 'GFS', layer: 'wind', domain: 'wind', provider: 'open-meteo', cols, rows, coverage_scope: scope, valid_time: valid },
  };
}

/** Grid value nearest to (lng, lat) when a node sits within 1e-6 deg of it, else null. */
function nodeAt(grid, lng, lat) {
  const b = grid.bounds;
  const fx = (lng - b.west) / (b.east - b.west) * (grid.cols - 1), fy = (lat - b.south) / (b.north - b.south) * (grid.rows - 1);
  const i = Math.round(fx), j = Math.round(fy);
  if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows || Math.abs(fx - i) > 1e-6 || Math.abs(fy - j) > 1e-6) return null;
  return grid.vectors[j * grid.cols + i];
}

/**
 * The world base: 2 deg over -180..180 / -80..84 like the app's world grid. Each node takes the
 * first fixture that has a node there (the served data, decimated exactly), else the bench
 * climatology without its synthetic storm.
 */
function worldBase(fixtureGrids, validTime) {
  const step = 2, west = -180, south = -80, cols = 181, rows = 83, vectors = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const lng = west + i * step, lat = south + j * step;
      const hit = fixtureGrids.map((g) => nodeAt(g, lng, lat)).find(Boolean);
      const [u, v] = hit ? [hit.u, hit.v] : windAt(lng, lat, null);
      vectors.push({ lat, lng, u, v, speed: Math.hypot(u, v), is_valid: true });
    }
  }
  return engineGrid(vectors, { west, east: 180, south, north: 84 }, cols, rows, 'global', 'bench_world_2deg', validTime);
}

/** The nodes of `grid` inside `box` (snapped to its lattice), as a new regional grid. */
function cropGrid(grid, box, id) {
  const b = grid.bounds, dx = (b.east - b.west) / (grid.cols - 1), dy = (b.north - b.south) / (grid.rows - 1);
  const i0 = Math.ceil((box.west - b.west) / dx - 1e-9), i1 = Math.floor((box.east - b.west) / dx + 1e-9);
  const j0 = Math.ceil((box.south - b.south) / dy - 1e-9), j1 = Math.floor((box.north - b.south) / dy + 1e-9);
  const vectors = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) vectors.push({ ...grid.vectors[j * grid.cols + i] });
  const bounds = { west: b.west + i0 * dx, east: b.west + i1 * dx, south: b.south + j0 * dy, north: b.south + j1 * dy };
  return engineGrid(vectors, bounds, i1 - i0 + 1, j1 - j0 + 1, 'regional', id || `${grid.product_id}_crop`, grid.valid_time);
}

/** Every `step`-th node of `grid` (step in nodes): the same data at a coarser lattice. */
function decimateGrid(grid, step, id) {
  const cols = Math.floor((grid.cols - 1) / step) + 1, rows = Math.floor((grid.rows - 1) / step) + 1, vectors = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) vectors.push({ ...grid.vectors[j * step * grid.cols + i * step] });
  const b = grid.bounds, dx = (b.east - b.west) / (grid.cols - 1), dy = (b.north - b.south) / (grid.rows - 1);
  const bounds = { west: b.west, east: b.west + (cols - 1) * step * dx, south: b.south, north: b.south + (rows - 1) * step * dy };
  return engineGrid(vectors, bounds, cols, rows, 'regional', id || `${grid.product_id}_x${step}`, grid.valid_time);
}

/** Bilinear [u, v] of a point-registered grid at (lng, lat); null outside its bounds. */
function sampleUV(grid, lng, lat) {
  const b = grid.bounds;
  const fx = (lng - b.west) / (b.east - b.west) * (grid.cols - 1), fy = (lat - b.south) / (b.north - b.south) * (grid.rows - 1);
  if (!(fx >= -1e-9 && fy >= -1e-9 && fx <= grid.cols - 1 + 1e-9 && fy <= grid.rows - 1 + 1e-9)) return null;
  const i0 = Math.max(0, Math.min(grid.cols - 2, Math.floor(fx))), j0 = Math.max(0, Math.min(grid.rows - 2, Math.floor(fy)));
  const tx = fx - i0, ty = fy - j0;
  let u = 0, v = 0;
  for (const [di, dj, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const q = grid.vectors[(j0 + dj) * grid.cols + i0 + di];
    u += q.u * w; v += q.v * w;
  }
  return [u, v];
}

/**
 * LADDER mode's truth: one continuous field every tier is sampled from. Inside `tile` (the finest served grid) it is
 * the tile itself, bilinear between nodes and exact at them; within `taperDeg` of the tile's edge it blends into `wide`
 * (a coarser grid of the same hour that covers the boxes), which it equals beyond. The storm core is served data; only
 * the surround past the tile is a stand-in, and it is the same for every arm.
 */
function truthField(tile, wide, taperDeg = 1) {
  const b = tile.bounds;
  return (lng, lat) => {
    const far = sampleUV(wide, lng, lat) || windAt(lng, lat, null);
    const near = sampleUV(tile, lng, lat);
    if (!near) return far;
    const d = Math.min(lng - b.west, b.east - lng, lat - b.south, b.north - lat) / taperDeg;
    const w = d >= 1 ? 1 : d <= 0 ? 0 : d * d * (3 - 2 * d);
    return [far[0] + (near[0] - far[0]) * w, far[1] + (near[1] - far[1]) * w];
  };
}

/** `truth` point-sampled at every `step` degrees over `box` (whole multiples of `step`): one served tier. */
function latticeGrid(truth, box, step, id, validTime) {
  const cols = Math.round((box.east - box.west) / step) + 1, rows = Math.round((box.north - box.south) / step) + 1, vectors = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const lng = box.west + i * step, lat = box.south + j * step, [u, v] = truth(lng, lat);
      vectors.push({ lat, lng, u, v, speed: Math.hypot(u, v), is_valid: true });
    }
  }
  const bounds = { west: box.west, south: box.south, east: box.west + (cols - 1) * step, north: box.south + (rows - 1) * step };
  return engineGrid(vectors, bounds, cols, rows, 'regional', id || `tier_${step}`, validTime);
}

/**
 * The same tier as an AREA MEAN: each node is the mean of `truth` over its own step x step cell, read at `fineStep`
 * (trapezoid weights, so a cell edge shared by two nodes counts half for each). The "resample the finer tier
 * consistently" option; u and v are averaged as vectors, which is what any such resampling of a wind field does.
 */
function meanGrid(truth, box, step, fineStep, id, validTime) {
  const k = Math.round(step / fineStep / 2), grid = latticeGrid(truth, box, step, id || `mean_${step}`, validTime);
  for (const q of grid.vectors) {
    let su = 0, sv = 0, sw = 0;
    for (let b = -k; b <= k; b++) {
      for (let a = -k; a <= k; a++) {
        const w = (Math.abs(a) === k ? 0.5 : 1) * (Math.abs(b) === k ? 0.5 : 1), [u, v] = truth(q.lng + a * fineStep, q.lat + b * fineStep);
        su += u * w; sv += v * w; sw += w;
      }
    }
    q.u = su / sw; q.v = sv / sw; q.speed = Math.hypot(q.u, q.v);
  }
  return grid;
}

/**
 * How two drawn fields differ over one view. `a` and `b` are bin maps from the page (per sampled pixel, the number of
 * `binKn`-wide thresholds the drawn speed is below): mean |difference| in knots, and the share of the view that is
 * `bigBins` bins or more apart.
 */
function binDiff(a, b, binKn, bigBins = 2) {
  if (a.length !== b.length) throw new Error('bin maps differ in size');
  let sum = 0, big = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d >= bigBins) big++; }
  return { meanKn: +(sum / a.length * binKn).toFixed(2), bigShare: +(big / a.length).toFixed(4) };
}

/**
 * A 256-texel RGBA ramp, white where the engine's LUT convention (texel i = i/255 * maxSpeed kn,
 * WindColorRamp.generateRampData) is below `thresholdKn`, black above.
 */
function thresholdRamp(maxSpeed, thresholdKn) {
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const on = (i / 255) * maxSpeed < thresholdKn ? 255 : 0;
    data.set([on, on, on, 255], i * 4);
  }
  return data;
}

/** 4-connected components of a boolean mask (row 0 = top). Returns {labels, comps[{n, touchesEdge}]}. */
function components(mask, W, H) {
  const labels = new Int32Array(W * H).fill(-1), comps = [], stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || labels[s] >= 0) continue;
    const id = comps.length, c = { id, n: 0, touchesEdge: false };
    comps.push(c);
    labels[s] = id; stack.push(s);
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p - x) / W;
      c.n++;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) c.touchesEdge = true;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
        if (q >= 0 && mask[q] && labels[q] < 0) { labels[q] = id; stack.push(q); }
      }
    }
  }
  return { labels, comps };
}

/**
 * The eye at one threshold: the enclosed (not edge-touching) below-T component whose centroid is
 * nearest `ref` (within `maxDistKm`). `pxToLngLat(x, y)` maps a mask pixel to degrees; `pxKm` is a
 * pixel's ground size (Mercator is conformal: square pixels on the ground at the local scale).
 * Returns null when the eye is OPEN at T (its low air connects to the outside) or absent.
 * Components under `minPx` pixels are particle sprites, not air, and are skipped.
 */
function eyeGeometry(mask, W, H, pxToLngLat, pxKm, ref, maxDistKm = 200, minPx = 200) {
  const { labels, comps } = components(mask, W, H);
  const acc = comps.map(() => ({ sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 }));
  for (let p = 0; p < W * H; p++) {
    const id = labels[p];
    if (id < 0 || comps[id].touchesEdge) continue;
    const x = p % W, y = (p - x) / W, a = acc[id];
    a.sx += x; a.sy += y; a.sxx += x * x; a.syy += y * y; a.sxy += x * y;
  }
  const cosRef = Math.cos(ref.lat * Math.PI / 180);
  let best = null;
  comps.forEach((c, id) => {
    if (c.touchesEdge || c.n < minPx) return;
    const a = acc[id], mx = a.sx / c.n, my = a.sy / c.n;
    const ll = pxToLngLat(mx, my);
    const distKm = Math.hypot((ll.lng - ref.lng) * cosRef, ll.lat - ref.lat) * KM_PER_DEG;
    if (distKm > maxDistKm || (best && distKm >= best.distKm)) return;
    const cxx = a.sxx / c.n - mx * mx, cyy = a.syy / c.n - my * my, cxy = a.sxy / c.n - mx * my;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(tr / 2 - disc, 1e-9);
    const areaKm2 = c.n * pxKm * pxKm;
    best = {
      lng: +ll.lng.toFixed(3), lat: +ll.lat.toFixed(3), distKm: +distKm.toFixed(1),
      areaKm2: Math.round(areaKm2), rKm: +Math.sqrt(areaKm2 / Math.PI).toFixed(1), aspect: +Math.sqrt(l1 / l2).toFixed(2),
    };
  });
  return best;
}

/** Centroid distance (km) and area ratio between two eyes; null when either is missing. */
function eyeShift(a, b) {
  if (!a || !b) return null;
  const cos = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return { shiftKm: +(Math.hypot((a.lng - b.lng) * cos, a.lat - b.lat) * KM_PER_DEG).toFixed(1), areaRatio: +(b.areaKm2 / a.areaKm2).toFixed(2) };
}

/**
 * One eye from a sweep of ascending thresholds ({T: eye|null}):
 *   firstT  the lowest T with a closed eye: its centroid is ~the drawn wind minimum (`centre`);
 *   closeT  the highest T it stays closed to without a gap: the eyewall's weakest point;
 *   at      the eye at closeT (radius, aspect). All null when no T closes an eye.
 * `nested` (ladder mode) also requires each next contour to be the SAME eye grown: no smaller than the one before
 * and centred within its own radius of it. Without it, once the eye opens at T, a closed pocket elsewhere near the
 * storm counts as "the eye at T" (the 0.25-deg lane tile: the eye opens at 40 kn, a 9-km pocket 100 km north closes).
 */
function eyeSummary(eyes, thresholds, { nested = false } = {}) {
  const Ts = [...thresholds].sort((a, b) => a - b);
  const i0 = Ts.findIndex((T) => eyes[T]);
  if (i0 < 0) return { firstT: null, closeT: null, centre: null, at: null };
  let i1 = i0;
  const grown = (a, b) => !nested || (b.areaKm2 >= a.areaKm2 * 0.98 && eyeShift(a, b).shiftKm <= b.rKm);
  while (i1 + 1 < Ts.length && eyes[Ts[i1 + 1]] && grown(eyes[Ts[i1]], eyes[Ts[i1 + 1]])) i1++;
  const first = eyes[Ts[i0]];
  return { firstT: Ts[i0], closeT: Ts[i1], centre: { lng: first.lng, lat: first.lat }, at: eyes[Ts[i1]] };
}

/** How eye summary `b` differs from `a`: centre shift (km), weakest-wall change (kn), area ratio at the common closeT. */
function compareSummaries(a, b, eyesA, eyesB) {
  if (!a.centre || !b.centre) return { closed: [!!a.centre, !!b.centre], shiftKm: null, dCloseKn: null, areaRatio: null };
  const T = Math.min(a.closeT, b.closeT);
  const s = eyeShift({ ...a.centre, areaKm2: 1 }, { ...b.centre, areaKm2: 1 });
  const ratio = eyesA[T] && eyesB[T] ? +(eyesB[T].areaKm2 / eyesA[T].areaKm2).toFixed(2) : null;
  return { closed: [true, true], shiftKm: s.shiftKm, dCloseKn: b.closeT - a.closeT, areaRatio: ratio, atT: T };
}

/** True when two summaries describe the same drawn eye within `tol` ({shiftKm, closeKn, areaRatio}). */
function sameEye(cmp, tol) {
  if (cmp.closed[0] !== cmp.closed[1]) return false;
  if (!cmp.closed[0]) return true;                               // open in both: the same (absent) eye
  return cmp.shiftKm <= tol.shiftKm && Math.abs(cmp.dCloseKn) <= tol.closeKn && cmp.areaRatio != null && Math.abs(cmp.areaRatio - 1) <= tol.areaRatio;
}

module.exports = {
  KM_PER_DEG, gridFromFixture, worldBase, cropGrid, decimateGrid, thresholdRamp, components, eyeGeometry, eyeShift, nodeAt,
  eyeSummary, compareSummaries, sameEye, sampleUV, truthField, latticeGrid, meanGrid, binDiff,
};
