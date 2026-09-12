import { FloatArrayConstructor } from './WebGLMarineFieldMath';
import { resolveMarineFields } from './marineFieldResolver';
import { MARINE_ZOOMED_OUT_MAX_ZOOM } from './marineZoomThresholds';

const MAX_CELLS = 50000;
const EPS = 1e-7; // Coordinate arithmetic only; resolved field values must agree exactly.
const text = v => typeof v === 'string' && v.trim().length > 0;
const instant = v => text(v) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;

function source(grid, explicit, adapter) {
  const a = grid[explicit], b = grid[adapter];
  if (a != null && !text(a) || b != null && !text(b)) return null;
  if (a != null && b != null && a !== b) return null;
  return a || b || null;
}

function identity(grid) {
  if (!grid || grid.ratingMode !== false || grid.is_estimated !== false || grid.__renderable === false ||
      grid.model_run_time_status !== 'known' || !text(grid.__sourceModel) || !text(grid.__componentLayer) ||
      !Number.isFinite(grid.hourOffset) || grid.frame_offset_hours !== 0 || grid.frame_substituted !== false) return null;
  const cycle = instant(grid.model_run_time), served = instant(grid.served_valid_time);
  const provider = source(grid, 'upstream_provider', '__upstreamProvider');
  const dataset = source(grid, 'source_dataset', '__sourceDataset');
  if (cycle === null || served === null || !provider || !dataset) return null;
  return JSON.stringify([grid.__sourceModel, grid.__componentLayer, grid.hourOffset, cycle, served, provider, dataset]);
}

// Strict row-major node lattice. Unknown geometry never authorizes a new exception.
function lattice(grid) {
  const { cols, rows, bounds: b, vectors } = grid;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 ||
      cols * rows > MAX_CELLS || !Array.isArray(vectors) || vectors.length !== cols * rows || !b ||
      ![b.west, b.south, b.east, b.north].every(Number.isFinite) ||
      b.west < -180 || b.east > 180 || b.south < -90 || b.north > 90 || b.east <= b.west || b.north <= b.south) return null;
  const dx = (b.east - b.west) / (cols - 1), dy = (b.north - b.south) / (rows - 1);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    if (!v || !Number.isFinite(v.lng) || !Number.isFinite(v.lat) ||
        Math.abs(v.lng - (b.west + (i % cols) * dx)) > EPS ||
        Math.abs(v.lat - (b.south + Math.floor(i / cols) * dy)) > EPS) return null;
  }
  return { dx, dy };
}

function fields(vectors, layer) {
  const N = vectors.length;
  const f = Object.fromEntries(['uArr', 'vArr', 'hArr', 'pArr', 'confArr'].map(k => [k, new FloatArrayConstructor(N)]));
  f.oceanArr = new Uint8Array(N); f.motionArr = null; f.hPhys = null;
  resolveMarineFields(vectors, layer, N, f);
  return [f.uArr, f.vArr, f.hArr, f.pArr, f.oceanArr, f.confArr];
}

// A narrow exception to the historical 40-degree storm-detail ceiling. Used in BOTH directions:
// promote a subcovering regional crop, and retain that global when the same crop arrives again.
// It proves equality of sampled encoder inputs, not forecast skill or general pixel equivalence.
// No identity cache: an incoming grid, coordinates or fields may have been mutated since last use.
export function sameFieldSubcover(regional, global, zoom, viewport, ctx = {}) {
  if (ctx.sameFieldBridgeDisabled || !Number.isFinite(zoom) || !Array.isArray(viewport) || viewport.length !== 4 ||
      !viewport.every(Number.isFinite)) return false;
  const [w, s, e, n] = viewport;
  if (e <= w || n <= s) return false;
  const zMax = ctx.zoomedOutMaxZoom ?? MARINE_ZOOMED_OUT_MAX_ZOOM;
  if (!(zoom <= zMax || e - w > 15 || n - s > 15)) return false;
  const rb = regional?.bounds, gb = global?.bounds;
  if (!rb || !gb || gb.east - gb.west < 359 || (gb.east - gb.west) / global.cols <= 1 ||
      rb.east - rb.west >= 340 || rb.west < gb.west || rb.east > gb.east || rb.south < gb.south || rb.north > gb.north) return false;
  const cover = Math.max(0, Math.min(rb.east, e) - Math.max(rb.west, w)) *
    Math.max(0, Math.min(rb.north, n) - Math.max(rb.south, s)) / ((e - w) * (n - s));
  if (!(cover < (ctx.coverFrac ?? 0.6))) return false;
  const globalCover = Math.max(0, Math.min(gb.east, e) - Math.max(gb.west, w)) *
    Math.max(0, Math.min(gb.north, n) - Math.max(gb.south, s)) / ((e - w) * (n - s));
  if (!(globalCover >= (ctx.coverFrac ?? 0.6))) return false;
  const a = identity(regional), b = identity(global);
  if (!a || a !== b) return false;
  const r = lattice(regional), g = lattice(global);
  if (!r || !g || Math.abs(r.dx - g.dx) > EPS || Math.abs(r.dy - g.dy) > EPS) return false;
  const selected = [];
  for (const v of regional.vectors) {
    const col = Math.round((v.lng - gb.west) / g.dx), row = Math.round((v.lat - gb.south) / g.dy);
    const node = global.vectors[row * global.cols + col];
    if (col < 0 || col >= global.cols || row < 0 || row >= global.rows || !node ||
        Math.abs(v.lng - node.lng) > EPS || Math.abs(v.lat - node.lat) > EPS) return false;
    selected.push(node);
  }
  const rf = fields(regional.vectors, regional.__componentLayer), gf = fields(selected, global.__componentLayer);
  return rf.every((values, k) => values.every((v, i) => Number.isFinite(v) && v === gf[k][i]));
}
