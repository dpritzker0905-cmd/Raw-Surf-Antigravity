/**
 * staticRatedMosaic.js — the Surf Rating band for a viewport that OVERHANGS a pilot box, from the CDN (2026-11-15, rating band SOTA lane).
 *
 * WHY (measured offline, scn_band_zoom_stability.js, the production flags): a rated regional bundle answered a surf ask only when ONE
 * pilot box CONTAINED the whole viewport (staticRegional.pickRegionalTile). A z8 desktop view of the Florida coast (-82.6..-78.3) overhangs
 * florida_east_coast (east edge -79), so every such ask went to /grid?surf=1 on the 1-CPU box (1.7 s offline, 4-22 s live), the server
 * answered a partial tile and then "sharpened" it with the dynamic lane (another lattice: different nodes, different colours), and the
 * edge leg held the band off while it waited. `__RAW_STATIC_FRAMES_RATED__` showed ZERO rated asks served from the CDN all session.
 *
 * WHAT: the viewport on the regional lattice (0.25 deg, every pilot box's), each node taken from the rated bundle of a box that holds it
 * (the SAME vectors the regional seam serves, so the SAME scores /grid?surf=1 rates on the stored tile: parity 0 bad, item 10). A node no
 * box holds is padded ONLY where the server masks it anyway: `bathymetry.is_coastal` false there (the baked coast mask below, exact on
 * this lattice); the pad carries the nearest world node's honest sea, invalid (no band), exactly what the server serves for open ocean. Any doubt (a coast, land, an unbuilt or mismatched frame, an off-lattice box, a cap) returns null and the
 * caller asks /grid as before. Zoom changes resolution only: every zoom reads the same nodes from the same frames.
 *
 * KILL: window.__RAW_DISABLE_RATED_MOSAIC__ = true (the single-box regional seam and /grid stay exactly as before).
 */
import { PILOT_BOXES, regionalSetKey } from './staticRegional';
import { gridJsonFromFrame, pickIndexFrame, ratingCounts } from './staticFrameCodec';

export const MOSAIC_STEP = 0.25;
export const MOSAIC_MAX_SPAN = 15.5;          // pick_surf_regional_override's 15 deg plus margin: wider views are not regional
export const MOSAIC_MAX_CELLS = 12000;
const EPS = 1e-6;
const W = () => (typeof window !== 'undefined' ? window : {});

export const ratedMosaicOn = () => W().__RAW_DISABLE_RATED_MOSAIC__ !== true;

const overlaps = (a, b) => Math.min(a.east, b.east) > Math.max(a.west, b.west) + EPS && Math.min(a.north, b.north) > Math.max(a.south, b.south) + EPS;
const holds = (b, lat, lng) => lng >= b.west - EPS && lng <= b.east + EPS && lat >= b.south - EPS && lat <= b.north + EPS;
const onStep = (x) => Math.abs(x / MOSAIC_STEP - Math.round(x / MOSAIC_STEP)) < EPS;

/** The rated pilot boxes a viewport box overlaps (GFS only: the publisher bakes rated bundles for GFS alone). No I/O. */
export function mosaicBoxes({ model, layer, bbox, suffix = '_rated' }) {
  if (!bbox || String(model || 'GFS').toUpperCase() !== 'GFS') return [];
  if (!(bbox.west < bbox.east) || !(bbox.south < bbox.north)) return [];
  if (bbox.east - bbox.west > MOSAIC_MAX_SPAN || bbox.north - bbox.south > MOSAIC_MAX_SPAN) return [];
  return PILOT_BOXES
    .map(([id, west, south, east, north]) => ({ id, bounds: { west, south, east, north } }))
    .filter((b) => overlaps(b.bounds, bbox))
    .map((b) => ({ ...b, key: regionalSetKey('GFS', layer, b.id) + suffix }));
}

/** The 0.25-deg lattice over a box, snapped outward. Null past the cell cap. */
export function mosaicLattice(bbox) {
  const west = Math.floor(bbox.west / MOSAIC_STEP + EPS) * MOSAIC_STEP;
  const south = Math.floor(bbox.south / MOSAIC_STEP + EPS) * MOSAIC_STEP;
  const east = Math.ceil(bbox.east / MOSAIC_STEP - EPS) * MOSAIC_STEP;
  const north = Math.ceil(bbox.north / MOSAIC_STEP - EPS) * MOSAIC_STEP;
  const cols = Math.round((east - west) / MOSAIC_STEP) + 1;
  const rows = Math.round((north - south) / MOSAIC_STEP) + 1;
  if (cols < 2 || rows < 2 || cols * rows > MOSAIC_MAX_CELLS) return null;
  return { bounds: { west, south, east, north }, cols, rows };
}

/** A box frame's grid is on the mosaic lattice (0.25-deg spacing, nodes on 0.25 multiples). */
export function onMosaicLattice(grid) {
  if (!grid || !grid.bounds || !(grid.cols > 1) || !(grid.rows > 1)) return false;
  const b = grid.bounds;
  const dx = (b.east - b.west) / (grid.cols - 1);
  const dy = (b.north - b.south) / (grid.rows - 1);
  return Math.abs(dx - MOSAIC_STEP) < EPS && Math.abs(dy - MOSAIC_STEP) < EPS && onStep(b.west) && onStep(b.south);
}

/** The node at (lat, lng) of a south-first row-major frame (staticFrameCodec.buildVectors), or null. */
function nodeAt(grid, vectors, lat, lng) {
  const b = grid.bounds;
  const dx = (b.east - b.west) / (grid.cols - 1);
  const dy = (b.north - b.south) / (grid.rows - 1);
  const c = Math.round((lng - b.west) / dx);
  const r = Math.round((lat - b.south) / dy);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return null;
  return vectors[r * grid.cols + c] || null;
}

// THE COAST TEST (exact, not a heuristic): the server masks every node athymetry.is_coastalathymetry.is_coastal calls non-coastal (rating_transform_grid's
// coastal_fn), and that function is geography only. backend/scripts/build_coastal_node_mask.py bakes it on the 0.25-deg lattice into
// /data/coastal-nodes-025.bin (parity: backend/tests/test_coastal_node_mask.py). Bit 1 = coastal (the band may paint: ask the server).
export const COAST_MASK_URL = '/data/coastal-nodes-025.bin';
const MASK_COLS = 1440; const MASK_ROWS = 721;
let _mask = null; let _maskLoad = null;
export function coastMaskFromBuffer(buf) {
  const u8 = new Uint8Array(buf);
  if (u8.length < 16 || u8[0] !== 82 || u8[1] !== 83 || u8[2] !== 67 || u8[3] !== 78) return null;      // "RSCN"
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint16(6, true) !== MASK_COLS || dv.getUint16(8, true) !== MASK_ROWS) return null;
  if (u8.length < 16 + Math.ceil((MASK_COLS * MASK_ROWS) / 8)) return null;
  return u8.subarray(16);
}
/** The loaded mask, or null (and the load starts: the first overhanging ask asks /grid, the next one is served). */
export function coastMask() {
  if (_mask || typeof fetch !== 'function') return _mask;
  if (!_maskLoad) {
    _maskLoad = fetch(COAST_MASK_URL, { credentials: 'omit' }).then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => { _mask = b ? coastMaskFromBuffer(b) : null; if (!_mask) _maskLoad = null; return _mask; })
      .catch(() => { _maskLoad = null; return null; });
  }
  return _mask;
}
export const loadCoastMask = () => (coastMask() || _maskLoad || Promise.resolve(null));
export const _setCoastMaskForTest = (m) => { _mask = m; _maskLoad = null; };
/** Is this lattice node coastal (the server may rate it)? true / false, or null when the mask is not loaded. */
export function coastalNode(mask, lat, lng) {
  if (!mask) return null;
  const r = Math.round((lat + 90) / MOSAIC_STEP);
  const c = ((Math.round((lng + 180) / MOSAIC_STEP) % MASK_COLS) + MASK_COLS) % MASK_COLS;
  if (r < 0 || r >= MASK_ROWS) return true;
  const i = r * MASK_COLS + c;
  return ((mask[i >> 3] >> (i & 7)) & 1) === 1;
}

/** The honest sea under a padded node: the nearest rated WORLD node (2 deg) when it is sea, else a calm invalid node. */
export function padNode(world, lat, lng) {
  const calm = { lat, lng, speed: 0, direction: 0, u: 0, v: 0, period: null, gust: null, value: null, is_valid: false, dir_confidence: null };
  if (!world) return calm;
  const g = world.grid; const b = g.bounds;
  const c = Math.round((lng - b.west) / ((b.east - b.west) / (g.cols - 1)));
  const r = Math.round((lat - b.south) / ((b.north - b.south) / (g.rows - 1)));
  const v = c >= 0 && r >= 0 && c < g.cols && r < g.rows ? world.vectors[r * g.cols + c] : null;
  return v && (v.phys_speed != null || v.is_valid) ? { ...v, lat, lng, is_valid: false } : calm;
}

/**
 * Compose the mosaic. `frames` = [{ box, index, frame, grid, vectors }] (every overlapping box, loaded, same valid time, on the
 * lattice); `world` = { grid, vectors } or null (the pad's honest sea); `mask` = the coast mask. Returns { vectors, lattice, padded, fromBoxes } or { miss }.
 */
export function composeMosaic(bbox, frames, world, mask) {
  const lat0 = mosaicLattice(bbox);
  if (!lat0) return { miss: 'mosaic_cap' };
  const { bounds, cols, rows } = lat0;
  const out = new Array(cols * rows);
  let padded = 0; const used = new Set();
  for (let r = 0; r < rows; r++) {
    const lat = +(bounds.south + r * MOSAIC_STEP).toFixed(6);
    for (let c = 0; c < cols; c++) {
      const lng = +(bounds.west + c * MOSAIC_STEP).toFixed(6);
      let v = null;
      for (const f of frames) {
        if (!holds(f.grid.bounds, lat, lng)) continue;
        v = nodeAt(f.grid, f.vectors, lat, lng);
        if (v) { used.add(f.box.id); break; }
      }
      if (v) { out[r * cols + c] = { ...v, lat, lng }; continue; }
      const coastal = coastalNode(mask, lat, lng);
      if (coastal === null) return { miss: 'mosaic_no_coast_mask' };
      if (coastal) return { miss: 'mosaic_uncovered_coast' };            // a coast no box holds: only the server rates it
      out[r * cols + c] = padNode(world, lat, lng);
      padded += 1;
    }
  }
  return { vectors: out, lattice: lat0, padded, fromBoxes: [...used] };
}

/**
 * Seam A for a surf ask no single box contains: the /grid?surf=1 JSON from the overlapping boxes' rated bundles, or null with the
 * miss recorded (the caller asks /grid). `d` = { getPinnedIndex, loadFrameVectors, setEnabled, askOffsetServed, worldKey, noteMiss }.
 */
/**
 * OVERSCAN (the owner: "never see a glitch in the band"): the mosaic covers the view plus one view on every side (capped at
 * MOSAIC_MAX_SPAN), so a pan of up to a whole screen is already covered when it starts: the next grid is a refinement, never a gap.
 * The exact view is the fallback when the margin reaches a coast no box holds. Kill: window.__RAW_DISABLE_RATED_OVERSCAN__ = true.
 */
export const OVERSCAN = 1.0;   // views per side (measured: half a view at z9 is ~0.5 deg, crossed by a 30 % pan)
export function overscanBox(b) {
  const w = b.east - b.west; const h = b.north - b.south;
  const mx = Math.max(0, Math.min(OVERSCAN * w, (MOSAIC_MAX_SPAN - w) / 2));
  const my = Math.max(0, Math.min(OVERSCAN * h, (MOSAIC_MAX_SPAN - h) / 2));
  return { west: Math.max(-180, b.west - mx), east: Math.min(180, b.east + mx), south: Math.max(-85, b.south - my), north: Math.min(85, b.north + my) };
}

export async function tryRatedMosaic({ model, layer, validTimeStr, clampedBbox, signal }, d) {
  if (!ratedMosaicOn()) return null;
  const areas = W().__RAW_DISABLE_RATED_OVERSCAN__ === true ? [clampedBbox] : [overscanBox(clampedBbox), clampedBbox];
  const boxes = mosaicBoxes({ model, layer, bbox: areas[0] }).filter((b) => d.setEnabled(b.key));
  if (!boxes.length) return d.noteMiss('mosaic_no_box');
  const askMs = Date.parse(validTimeStr);
  const frames = [];
  for (const box of boxes) {
    const index = await d.getPinnedIndex(box.key);
    if (!index) return d.noteMiss('mosaic_no_index');
    const frame = pickIndexFrame(index, askMs);
    if (!frame || !frame.path) return d.noteMiss('mosaic_unbuilt_frame');
    if (!d.askOffsetServed(index, frame, askMs)) return d.noteMiss('mosaic_ask_offset');
    const grid = frame.grid || index.grid;
    if (!onMosaicLattice(grid)) return d.noteMiss('mosaic_off_lattice');
    if (frames.length && frames[0].frame.valid_time !== frame.valid_time) return d.noteMiss('mosaic_valid_time');
    frames.push({ box, index, frame, grid });
  }
  // Smallest box first: two boxes share an edge node, and a node is read from one frame only (deterministic).
  frames.sort((a, b) => (a.grid.bounds.east - a.grid.bounds.west) * (a.grid.bounds.north - a.grid.bounds.south)
    - (b.grid.bounds.east - b.grid.bounds.west) * (b.grid.bounds.north - b.grid.bounds.south));
  const loaded = await Promise.all(frames.map((f) => d.loadFrameVectors(f.box.key, f.frame, signal, { priority: 'high' })));
  if (loaded.some((v) => !v)) return d.noteMiss('mosaic_frame_load');
  frames.forEach((f, i) => { f.vectors = loaded[i]; });
  const heldBy1 = (a) => { const lat = mosaicLattice(a); return !!lat && frames.some((f) => holds(f.grid.bounds, lat.bounds.south, lat.bounds.west) && holds(f.grid.bounds, lat.bounds.north, lat.bounds.east)); };
  let world = null; let mask = null;
  if (!areas.every(heldBy1)) {
    mask = coastMask() || await Promise.race([loadCoastMask(), new Promise((r) => setTimeout(() => r(null), 1500))]);
    if (!mask) return d.noteMiss('mosaic_no_coast_mask');
    const windex = await d.getPinnedIndex(d.worldKey);
    const wframe = windex && pickIndexFrame(windex, askMs);
    if (wframe && wframe.path && wframe.valid_time === frames[0].frame.valid_time) {
      const wvec = await d.loadFrameVectors(d.worldKey, wframe, signal, { priority: 'high' });
      if (wvec) world = { grid: wframe.grid || windex.grid, vectors: wvec };
    }
  }
  let m = null;
  for (const a of areas) {
    m = composeMosaic(a, frames, world, mask);
    if (!m.miss && m.fromBoxes.length) break;
  }
  if (m.miss) return d.noteMiss(m.miss);
  if (!m.fromBoxes.length) return d.noteMiss('mosaic_no_box');
  const first = frames[0];
  const json = gridJsonFromFrame(first.index, first.frame, m.vectors, { askIso: validTimeStr, requestedBbox: clampedBbox });
  const ids = m.fromBoxes.join('+');
  json.region_id = `mosaic:${ids}`; json.tile_id = json.region_id;
  json.coverage_mode = 'regional_mosaic';
  json.served_bbox = `${m.lattice.bounds.west},${m.lattice.bounds.south},${m.lattice.bounds.east},${m.lattice.bounds.north}`;
  json.grid = {
    bounds: m.lattice.bounds, cols: m.lattice.cols, rows: m.lattice.rows, vectors: m.vectors,
    diagnostics: { ...json.grid.diagnostics, cols: m.lattice.cols, rows: m.lattice.rows, vectorCount: m.vectors.length,
      // The frame's own overlay tag (value_kind 'surf_rating' is what marks the grid RATED: backendWeatherServiceClientHelpers),
      // with this mosaic's counts on top. Replacing it with the counts alone shipped the mosaic as UNRATED (caught offline).
      renderable: m.vectors.some((v) => v.speed > 0),
      surf_transform: { value_kind: 'surf_rating', ...((json.grid.diagnostics && json.grid.diagnostics.surf_transform) || {}), ...ratingCounts(m.vectors) },
      mosaic: { boxes: m.fromBoxes, padded: m.padded } },
  };
  json.static_frame = { ...json.static_frame, mosaic: frames.map((f) => f.frame.path) };
  return json;
}

/**
 * PREFETCH (the owner, 2026-11-15: "make sure the tile that we're panning to loads the rating band in advance"): warm the rated
 * bundles of every pilot box within one viewport of this one (in every direction), at this valid time, at low priority. CDN only:
 * nothing reaches the box. Returns the keys warmed. Kill: window.__RAW_DISABLE_RATED_PREFETCH__ = true.
 */
export function prefetchRatedNeighbours({ model, layer, validTimeStr, bbox, worldKey }, d) {
  if (!ratedMosaicOn() || W().__RAW_DISABLE_RATED_PREFETCH__ === true || !bbox) return [];
  coastMask();                                                  // the pad's coast test, once per page
  const w = bbox.east - bbox.west; const h = bbox.north - bbox.south;
  const ring = { west: bbox.west - w, east: bbox.east + w, south: Math.max(-85, bbox.south - h), north: Math.min(85, bbox.north + h) };
  const boxes = PILOT_BOXES
    .map(([id, west, south, east, north]) => ({ id, bounds: { west, south, east, north } }))
    .filter((b) => overlaps(b.bounds, ring))
    .map((b) => regionalSetKey('GFS', layer, b.id) + '_rated')
    .filter((key) => d.setEnabled(key));
  if (worldKey) boxes.push(worldKey);                            // the pad's honest sea: the rated world frame of this instant
  if (String(model || 'GFS').toUpperCase() !== 'GFS') return [];
  const askMs = Date.parse(validTimeStr);
  for (const key of boxes) {
    Promise.resolve(d.getPinnedIndex(key)).then((index) => {
      const frame = index && pickIndexFrame(index, askMs);
      if (frame && frame.path) return d.loadFrameVectors(key, frame, undefined, { priority: 'low' });
      return null;
    }).catch(() => null);
  }
  return boxes;
}
