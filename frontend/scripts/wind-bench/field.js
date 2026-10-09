/**
 * Wind bench: the synthetic wind field (knots). Pure, no DOM, no GL.
 *
 * A climatology (trades, westerlies, polar easterlies and smooth perturbations) plus one
 * Holland-profile hurricane. Every grid is POINT-REGISTERED (the first column sits on `west`, the
 * last on `east`), the same convention as the served /grid payloads, so the engine samples it
 * exactly as it samples real data.
 *
 * The numbers are the ones the 2026-10-08 bench used for PR #281. Changing any of them changes
 * every result, so a change here starts a new baseline (say so in the PR).
 */

const HURRICANE = Object.freeze({ lng: -89.5, lat: 25.5, vmax: 52, rm: 0.45, B: 1.6 });
const VALID_TIME = '2026-10-09T03:00:00Z';
const RUN_TIME = '2026-10-09T00:00:00Z';

/** [u, v] in knots at (lng, lat). */
function windAt(lng, lat, storm = HURRICANE) {
  const al = Math.abs(lat);
  let u = -12 * Math.exp(-(((al - 15) / 12) ** 2)) + 20 * Math.exp(-(((al - 45) / 10) ** 2)) - 6 * Math.exp(-(((al - 70) / 8) ** 2));
  let v = 4 * Math.sin(lng * Math.PI / 60) * Math.cos(lat * Math.PI / 90);
  u += 5 * Math.sin(lng * 0.17 + lat * 0.11) + 3 * Math.cos(lng * 0.05 - lat * 0.23);
  v += 4 * Math.cos(lng * 0.13 - lat * 0.07) + 2 * Math.sin(lng * 0.31 + lat * 0.19);
  if (!storm) return [u, v];
  const dx = (lng - storm.lng) * Math.cos(storm.lat * Math.PI / 180);
  const dy = lat - storm.lat;
  const r = Math.hypot(dx, dy) + 1e-6;
  const x = Math.pow(storm.rm / r, storm.B);
  const V = storm.vmax * Math.sqrt(x * Math.exp(1 - x));             // Holland (1980) gradient wind
  const inflow = 20 * Math.PI / 180;
  const tu = -dy / r, tv = dx / r;                                    // counter-clockwise (NH)
  const cu = tu * Math.cos(inflow) - (dx / r) * Math.sin(inflow);
  const cv = tv * Math.cos(inflow) - (dy / r) * Math.sin(inflow);
  const wv = Math.exp(-((r / 6) ** 2));                               // the vortex dominates within ~6 deg
  u = u * (1 - wv) + (V * cu + 3) * wv;                               // +3/+4 kn: storm translation
  v = v * (1 - wv) + (V * cv + 4) * wv;
  return [u, v];
}

/** A wind grid in the shape `WebGLWindEngine.setWindData` takes. */
function buildGrid(west, east, south, north, step, opts = {}) {
  const storm = opts.storm === undefined ? HURRICANE : opts.storm;
  const cols = Math.round((east - west) / step) + 1;
  const rows = Math.round((north - south) / step) + 1;
  const vectors = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const lng = west + i * step, lat = south + j * step;
      const [u, v] = windAt(lng, lat, storm);
      vectors.push({ lat, lng, u, v, speed: Math.hypot(u, v), direction: (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360, is_valid: true });
    }
  }
  const scope = 'regional';
  const id = 'bench_' + step + '_' + west;
  const truthTag = { model: 'GFS', layer: 'wind', domain: 'wind', provider: 'open-meteo', cols, rows, coverage_scope: scope, valid_time: VALID_TIME };
  return {
    vectors, bounds: { west, east, south, north }, cols, rows, stale: false, source: 'GFS', provider: 'open-meteo', renderable: true,
    nonzeroCount: vectors.length, coverage_scope: scope, truthTag, productId: id, product_id: id, valid_time: VALID_TIME, run_time: RUN_TIME, hourOffset: 0,
  };
}

/**
 * The three grids every bench view is built from:
 *   world: 2 deg over -180..180 / -80..84 (181 x 83), always loaded first, as the app does;
 *   fine:  0.25 deg over the storm box -100..-78 / 16..36;
 *   clip2: the same box at 2 deg, to separate "fine grid" effects from "regional grid" effects.
 */
function benchGrids(opts) {
  return {
    world: buildGrid(-180, 180, -80, 84, 2, opts),
    fine: buildGrid(-100, -78, 16, 36, 0.25, opts),
    clip2: buildGrid(-100, -78, 16, 36, 2, opts),
  };
}

/** Bilinear wind SPEED from a point-registered grid; null outside it. */
function sampleSpeed(grid, lng, lat) {
  const b = grid.bounds;
  const fx = (lng - b.west) / (b.east - b.west) * (grid.cols - 1);
  const fy = (lat - b.south) / (b.north - b.south) * (grid.rows - 1);
  if (!(fx >= 0 && fy >= 0 && fx <= grid.cols - 1 && fy <= grid.rows - 1)) return null;
  const i0 = Math.min(grid.cols - 2, Math.floor(fx)), j0 = Math.min(grid.rows - 2, Math.floor(fy));
  const tx = fx - i0, ty = fy - j0;
  let u = 0, v = 0;
  for (const [di, dj, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const q = grid.vectors[(j0 + dj) * grid.cols + i0 + di];
    u += q.u * w; v += q.v * w;
  }
  return Math.hypot(u, v);
}

module.exports = { HURRICANE, windAt, buildGrid, benchGrids, sampleSpeed };
