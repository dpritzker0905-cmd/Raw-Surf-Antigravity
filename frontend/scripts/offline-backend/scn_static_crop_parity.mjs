// Static-frame CROPS vs the resolver's own mid-tier clip, node by node (2026-10-22, the mid-zoom instant scrub). Offline only.
//
// The app crops the static world frame for a viewport box the resolver answers from global_mid (src/components/map/
// staticFrameCrop.js). This loads the APP'S OWN modules (staticFrameCodec.js and staticFrameCrop.js, copied to a temp dir; the
// crop module's one import, the products-manifest reader, is replaced by the same reading of THIS backend's /products) and, for
// random viewport boxes and frames of the published run:
//   - when the app's rules say "crop" (midCropRulesPass), the backend MUST answer from global_mid (diagnostics.mid_res_tier) and
//     the crop must equal its response: grid geometry, every node (the frame's stated quantisation), and the identity, time,
//     provenance and clip fields (product_id, valid / served times, coverage_scope / mode, requested_bbox, served_bbox, coverage);
//   - /grid boxes in /grid's URL format (the numbers as JS prints them), /grid_series boxes at 4 dp (its URL format), one hour each.
// Boxes the rules refuse are counted (and whether the backend served the mid tier there: a refusal is always safe, it only means
// /grid is asked as before). Exit 1 on any mismatch.
//
//   node frontend/scripts/offline-backend/scn_static_crop_parity.mjs <bucket copy> <backend port> [boxes=300] [out.json]
// Serve the backend with serve_synthetic.py --real-frames <bucket copy> (the published run in the store) and --regions flagship
// (so the tile rule meets real tiles).
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';

const [cdnDir, port, nBoxesArg, outFile] = process.argv.slice(2);
// Which world set to crop (2026-10-22: every STATIC_SETS entry; default GFS waves). MODEL / LAYER env.
const MODEL = (process.env.MODEL || 'GFS').toUpperCase();
const LAYER = (process.env.LAYER || 'waves').toLowerCase();
if (!cdnDir || !port) { console.error('usage: scn_static_crop_parity.mjs <bucket copy> <backend port> [boxes] [out.json]'); process.exit(2); }
const N_BOXES = +(nBoxesArg || 300);
const here = path.dirname(fileURLToPath(import.meta.url));
const mapDir = path.resolve(here, '../../src/components/map');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crop-parity-'));
const API = `http://127.0.0.1:${port}/api/weather`;

// The backend's own products manifest, read the way getAvailableTilesFromManifest reads it (region_id -> coverage).
const manifest = await (await fetch(`${API}/products`)).json();
const products = Array.isArray(manifest) ? manifest : (manifest.products || []);
const tiles = []; const seen = new Set();
for (const p of products) {
  if (String(p.model).toUpperCase() !== MODEL || String(p.domain).toLowerCase() !== 'marine' || String(p.layer).toLowerCase() !== LAYER) continue;
  if (p.region_id && !seen.has(p.region_id)) { seen.add(p.region_id); tiles.push({ id: p.region_id, bounds: p.coverage }); }
}
fs.writeFileSync(path.join(tmpDir, 'staticFrameCodec.mjs'), fs.readFileSync(path.join(mapDir, 'staticFrameCodec.js'), 'utf8'));
const cropSrc = fs.readFileSync(path.join(mapDir, 'staticFrameCrop.js'), 'utf8')
  .replace(/import \{ getAvailableTilesFromManifest \} from '\.\/backendWeatherServiceClientCoverage';/,
    `const __TILES = ${JSON.stringify(tiles)};\nconst getAvailableTilesFromManifest = () => ({ tiles: __TILES, fallbackReason: null });`);
if (!cropSrc.includes('__TILES')) throw Error('staticFrameCrop.js import line changed: update this script');
fs.writeFileSync(path.join(tmpDir, 'staticFrameCrop.mjs'), cropSrc);
const C = await import(pathToFileURL(path.join(tmpDir, 'staticFrameCodec.mjs')).href);
const X = await import(pathToFileURL(path.join(tmpDir, 'staticFrameCrop.mjs')).href);

const latest = JSON.parse(fs.readFileSync(path.join(cdnDir, 'v1/latest.json'), 'utf8'));
const entry = latest.sets[`${MODEL}/marine/${LAYER}/global_mid`];
const index = JSON.parse(fs.readFileSync(path.join(cdnDir, entry.index), 'utf8'));
index.path = index.path || entry.index;
const built = index.frames.filter((f) => f.path);

const TOL = { speed: 0.0005 + 1e-9, direction: 0.005 + 1e-9, period: 0.005 + 1e-9, dir_confidence: 0.5 / 254 + 1e-4, uv: 0.0012 };
const angle = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const vecCache = new Map();
function vectorsOf(frame) {
  if (vecCache.has(frame.path)) return vecCache.get(frame.path);
  const gz = fs.readFileSync(path.join(cdnDir, frame.path));
  const raw = gz[0] === 0x1f && gz[1] === 0x8b ? zlib.gunzipSync(gz) : gz;
  const v = C.buildVectors(C.parseFrame(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  vecCache.set(frame.path, v);
  return v;
}

function compareNodes(a, b, r) {
  const sameBounds = ['west', 'south', 'east', 'north'].every((k) => Math.abs(a.bounds[k] - b.bounds[k]) < 1e-9);
  if (a.cols !== b.cols || a.rows !== b.rows || !sameBounds) { r.meta.push({ k: 'grid', mine: [a.cols, a.rows, a.bounds], grid: [b.cols, b.rows, b.bounds] }); r.bad += Math.max(a.vectors.length, b.vectors.length); return; }
  for (let i = 0; i < b.vectors.length; i++) {
    const m = a.vectors[i]; const g = b.vectors[i];
    r.nodes++;
    let bad = false;
    if (Math.abs(m.lat - g.lat) > 1e-6 || Math.abs(m.lng - g.lng) > 1e-6) { r.position++; bad = true; }
    if ((m.is_valid !== false) !== (g.is_valid !== false)) { r.validity++; r.bad++; continue; }
    const e = {
      speed: Math.abs(m.speed - g.speed), direction: angle(m.direction, g.direction),
      period: (m.period == null) !== (g.period == null) ? Infinity : Math.abs((m.period || 0) - (g.period || 0)),
      dir_confidence: (m.dir_confidence == null) !== (g.dir_confidence == null) ? Infinity : Math.abs((m.dir_confidence || 0) - (g.dir_confidence || 0)),
      uv: (g.u || g.v) ? Math.max(Math.abs(m.u - g.u), Math.abs(m.v - g.v)) : 0,
    };
    for (const [k, v] of Object.entries(e)) { if (v > r.maxErr[k]) r.maxErr[k] = v; if (v > TOL[k]) bad = true; }
    if (bad) r.bad++;
  }
}
const newR = () => ({ nodes: 0, bad: 0, validity: 0, position: 0, maxErr: { speed: 0, direction: 0, period: 0, dir_confidence: 0, uv: 0 }, meta: [] });
const metaCmp = (mine, theirs, keys, r) => { for (const k of keys) if (JSON.stringify(mine[k] ?? null) !== JSON.stringify(theirs[k] ?? null)) r.meta.push({ k, mine: mine[k] ?? null, grid: theirs[k] ?? null }); };

// Deterministic boxes: viewport-like (lng span 10-45, lat span 5-32), every fourth one snapped to whole degrees as /grid often is,
// a few hugging the flagship tiles (the tile rule's edge) and the poles / the dateline.
let seed = 20261022;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const boxes = [];
for (let i = 0; i < N_BOXES; i++) {
  const lngSpan = 10 + rnd() * 35; const latSpan = 5 + rnd() * 27;
  let cx = -175 + rnd() * 350; let cy = -70 + rnd() * 140;
  if (i % 10 === 3) { cx = -82 + rnd() * 6; cy = 27 + rnd() * 4; }             // around florida_east_coast
  if (i % 10 === 7) { cx = -120 + rnd() * 6; cy = 33 + rnd() * 4; }            // around us_west_coast_socal
  let b = { west: cx - lngSpan / 2, south: cy - latSpan / 2, east: cx + lngSpan / 2, north: cy + latSpan / 2 };
  if (i % 4 === 0) b = { west: Math.floor(b.west), south: Math.floor(b.south), east: Math.ceil(b.east), north: Math.ceil(b.north) };
  boxes.push(b);
}
// THE TILE SLACK (decide_manifest_product: the request yields to a regional tile while it is at most tile + 0.05 deg on BOTH axes):
// for every regional tile with a side over 12 deg (crops need a span over 12), a box 0.03 deg wider than the tile on both axes (the
// server serves the tile: the rules must refuse) and one 0.08 deg wider on longitude (the mid clip: the rules may crop).
for (const t of tiles) {
  const c = t.bounds;
  if (!c || c.west > c.east || c.east - c.west >= 350 || Math.max(c.east - c.west, c.north - c.south) <= 12) continue;
  boxes.push({ west: c.west - 0.015, south: c.south - 0.015, east: c.east + 0.015, north: c.north + 0.015, edge: `${t.id}+0.03` });
  boxes.push({ west: c.west - 0.04, south: c.south, east: c.east + 0.04, north: c.north, edge: `${t.id}+0.08lng` });
}

const t0 = Date.now();
const rows = [];
const edges = [];
const totals = { boxes: 0, crop: 0, refused: 0, refusedButMid: 0, grid: newR(), series: newR(), cropButNotMid: 0, unmirrored: 0 };
const metaKeys = ['product_id', 'served_valid_time', 'frame_offset_hours', 'frame_substituted', 'model_run_time', 'run_time', 'provider',
  'upstream_provider', 'source_dataset', 'is_estimated', 'is_forecast_authoritative', 'value_unit', 'coverage_scope', 'coverage_mode',
  'requested_bbox', 'served_bbox', 'coverage'];
for (let i = 0; i < boxes.length; i++) {
  const b = boxes[i];
  const frame = built[(i * 7) % built.length];
  let askMs = Date.parse(frame.valid_time) + ((i % 3) * 3600000);            // on the hour, +1 h, +2 h (nearest-frame honesty)
  // /grid_series asks hour OFFSETS from an anchor the backend bounds near now (the app's: now rounded to the hour)
  const anchorMs = Math.round(Date.now() / 3600000) * 3600000;
  const seriesHour = Math.round((askMs - anchorMs) / 3600000);
  for (const seam of ['grid', 'series']) {
    if (seam === 'series' && ((i % 5 && !b.edge) || seriesHour < 0 || seriesHour > 336)) continue;   // every 5th box (+ edges)
    if (seam === 'series') askMs = anchorMs + seriesHour * 3600000;
    const pick = C.pickIndexFrame(index, askMs);
    if (!pick || !pick.path) continue;
    const askIso = new Date(askMs).toISOString();
    const param = seam === 'grid' ? X.gridBboxParam(b) : X.seriesBboxParam(b);
    totals.boxes++;
    const rules = X.midCropRulesPass({ model: MODEL, layer: LAYER, bboxStr: param });
    const url = seam === 'grid'
      ? `${API}/grid?model=${MODEL}&domain=marine&layer=${LAYER}&valid_time=${encodeURIComponent(askIso)}&bbox=${param}`
      : `${API}/grid_series?model=${MODEL}&domain=marine&layer=${LAYER}&bbox=${param}&hours=${seriesHour}&base_time=${encodeURIComponent(new Date(anchorMs).toISOString())}`;
    const res = await fetch(url);
    const body = await res.json();
    const theirs = seam === 'grid' ? body : (body.frames || [])[0];
    const theirGrid = seam === 'grid' ? body.grid : theirs;
    const mid = !!(seam === 'grid' ? (body.grid && body.grid.diagnostics && body.grid.diagnostics.mid_res_tier)
      : (theirs && String(theirs.product_id || '').includes('global_mid') && theirs.cols < 181));
    if (b.edge) edges.push({ edge: b.edge, seam, rules, backend_mid: mid, product: theirs && theirs.product_id });
    if (!rules) { totals.refused++; if (mid) totals.refusedButMid++; continue; }
    totals.crop++;
    if (!mid) { totals.cropButNotMid++; rows.push({ i, seam, param, problem: 'rules said crop, backend did not serve the mid clip', got: theirs && theirs.product_id }); continue; }
    const win = X.midClipWindow(param, index.grid, MODEL);
    if (!win) { totals.unmirrored++; rows.push({ i, seam, param, problem: 'no window' }); continue; }
    const vectors = vectorsOf(pick);
    const r = newR();
    if (seam === 'grid') {
      const mine = X.cropGridJson(C.gridJsonFromFrame(index, pick, vectors, { askIso, requestedBbox: b }), win, X.cropVectors(vectors, index.grid.cols, win));
      metaCmp(mine, body, metaKeys, r);
      if (C.apiIso(Date.parse(mine.valid_time)) !== C.apiIso(Date.parse(body.valid_time))) r.meta.push({ k: 'valid_time', mine: mine.valid_time, grid: body.valid_time });
      compareNodes(mine.grid, theirGrid, r);
    } else {
      const sf = C.seriesFrameFromFrame(index, pick, vectors, { hourOffset: seriesHour, askIso });
      const mine = X.cropSeriesFrame(sf, win, X.cropVectors(vectors, index.grid.cols, win));
      metaCmp(mine, theirs, ['product_id', 'served_valid_time', 'frame_offset_hours', 'cols', 'rows', 'is_estimated', 'provider'], r);
      compareNodes(mine, theirGrid, r);
    }
    const T = totals[seam];
    T.nodes += r.nodes; T.bad += r.bad; T.validity += r.validity; T.position += r.position; T.meta.push(...r.meta.map((m) => ({ i, ...m })));
    for (const k of Object.keys(T.maxErr)) T.maxErr[k] = Math.max(T.maxErr[k], r.maxErr[k]);
    if (r.bad || r.meta.length) rows.push({ i, seam, param, bad: r.bad, meta: r.meta.slice(0, 4) });
  }
}
const report = {
  index: index.path, frames_built: built.length, boxes_x_seams: totals.boxes, cropped: totals.crop, refused: totals.refused,
  refused_but_backend_served_mid: totals.refusedButMid, crop_but_backend_not_mid: totals.cropButNotMid, unmirrored: totals.unmirrored,
  grid: { nodes: totals.grid.nodes, bad: totals.grid.bad, meta_mismatches: totals.grid.meta.length, max_abs_err: totals.grid.maxErr },
  series: { nodes: totals.series.nodes, bad: totals.series.bad, meta_mismatches: totals.series.meta.length, max_abs_err: totals.series.maxErr },
  tolerance: TOL, tiles: tiles.filter((t) => t.bounds && (t.bounds.east - t.bounds.west) < 350).map((t) => t.id),
  tile_slack_edges: edges,
  seconds: (Date.now() - t0) / 1000, problems: rows.slice(0, 12),
};
console.log(JSON.stringify(report, null, 1));
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ report, rows }, null, 1));
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exitCode = (totals.grid.bad || totals.series.bad || totals.grid.meta.length || totals.series.meta.length || totals.cropButNotMid || totals.unmirrored) ? 1 : 0;
