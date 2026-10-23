// Regional bundle frames vs the resolver's own Step 3 tile clip, node by node (2026-10-23, z7-9 instant scrub). Offline only.
//
// The app answers a box a pilot tile FULLY covers from the tile's bundle (src/components/map/staticRegional.js). This loads the
// APP'S OWN modules (staticFrameCodec.js, staticFrameCrop.js, staticRegional.js, copied to a temp dir; the products-manifest reader
// is replaced by the same reading of THIS backend's /products) and, for boxes in and around the published regional sets:
//   - when the app claims a box (pickRegionalTile + regionalClipWindow(...).covers), the backend MUST serve that tile, fully covered
//     (coverage_scope 'regional', not partial), and the app's answer must equal it: grid geometry, every node (the frame's stated
//     quantisation), and product_id, served time, coverage_scope / mode, requested_bbox, served_bbox, partial_coverage;
//   - a box the app does not claim is counted with what the backend served there (a full regional cover the app refused is a
//     missed opportunity, never a wrong answer).
// /grid boxes in /grid's URL format, /grid_series at 4 dp, one hour each; frames are read from the BUNDLE (slice + sha12 + gunzip).
//
//   [LAYER=waves|swell_1|swell_2|wind_waves] node frontend/scripts/offline-backend/scn_regional_client_parity.mjs <cdn dir with the
//       regional sets> <backend port> [boxes=300] [out.json]
// Build the sets with backend/scripts/publish_frame_images.py --store-dir <store> --out-dir <cdn> --only frames (FRAME_SETS=...), and
// serve the SAME store with serve_synthetic.py --regions flagship.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';

const [cdnDir, port, nBoxesArg, outFile] = process.argv.slice(2);
if (!cdnDir || !port) { console.error('usage: scn_regional_client_parity.mjs <cdn dir> <backend port> [boxes] [out.json]'); process.exit(2); }
const N_BOXES = +(nBoxesArg || 300);
const here = path.dirname(fileURLToPath(import.meta.url));
const mapDir = path.resolve(here, '../../src/components/map');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'regional-parity-'));
const API = `http://127.0.0.1:${port}/api/weather`;
const LAYER = process.env.LAYER || 'waves';

const manifest = await (await fetch(`${API}/products`)).json();
const products = Array.isArray(manifest) ? manifest : (manifest.products || []);
const tiles = []; const seen = new Set();
for (const p of products) {
  if (String(p.model).toUpperCase() !== 'GFS' || String(p.domain).toLowerCase() !== 'marine' || String(p.layer).toLowerCase() !== LAYER) continue;
  if (p.region_id && !seen.has(p.region_id)) { seen.add(p.region_id); tiles.push({ id: p.region_id, bounds: p.coverage }); }
}
const TILES = `const __TILES = ${JSON.stringify(tiles)};\nconst getAvailableTilesFromManifest = () => ({ tiles: __TILES, fallbackReason: null });`;
const MANIFEST_IMPORT = /import \{ getAvailableTilesFromManifest \} from '\.\/backendWeatherServiceClientCoverage';/;
fs.writeFileSync(path.join(tmpDir, 'staticFrameCodec.mjs'), fs.readFileSync(path.join(mapDir, 'staticFrameCodec.js'), 'utf8'));
const cropSrc = fs.readFileSync(path.join(mapDir, 'staticFrameCrop.js'), 'utf8').replace(MANIFEST_IMPORT, TILES);
const regSrc = fs.readFileSync(path.join(mapDir, 'staticRegional.js'), 'utf8').replace(MANIFEST_IMPORT, TILES)
  .replace("from './staticFrameCrop';", "from './staticFrameCrop.mjs';");
if (!cropSrc.includes('__TILES') || !regSrc.includes('__TILES') || !regSrc.includes("'./staticFrameCrop.mjs'")) throw Error('an import line changed: update this script');
fs.writeFileSync(path.join(tmpDir, 'staticFrameCrop.mjs'), cropSrc);
fs.writeFileSync(path.join(tmpDir, 'staticRegional.mjs'), regSrc);
const C = await import(pathToFileURL(path.join(tmpDir, 'staticFrameCodec.mjs')).href);
const X = await import(pathToFileURL(path.join(tmpDir, 'staticFrameCrop.mjs')).href);
const R = await import(pathToFileURL(path.join(tmpDir, 'staticRegional.mjs')).href);

const latest = JSON.parse(fs.readFileSync(path.join(cdnDir, 'v1/latest.json'), 'utf8'));
const sets = {};
for (const [key, entry] of Object.entries(latest.sets || {})) {
  if (!R.isRegionalSetKey(key) || !entry.bundle || key.split('/')[2] !== LAYER) continue;
  const index = R.normalizeBundleIndex(JSON.parse(fs.readFileSync(path.join(cdnDir, entry.index), 'utf8')));
  index.path = index.path || entry.index;
  sets[key] = { index, bundle: fs.readFileSync(path.join(cdnDir, entry.bundle.path)) };
}

const TOL = { speed: 0.0005 + 1e-9, direction: 0.005 + 1e-9, period: 0.005 + 1e-9, dir_confidence: 0.5 / 254 + 1e-4, uv: 0.0012 };
const angle = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const vecCache = new Map();
let shaBad = 0;
function vectorsOf(set, frame) {
  if (vecCache.has(frame.path)) return vecCache.get(frame.path);
  const s = frame.bundle;
  const slice = set.bundle.subarray(s.offset, s.offset + s.length);
  if (crypto.createHash('sha256').update(slice).digest('hex').slice(0, 12) !== s.sha12) shaBad++;
  const raw = zlib.gunzipSync(slice);
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

// Boxes: z7-9-sized (lng 1.5-9 deg, lat 1-6 deg) around each published set's tile, every fourth snapped to whole degrees, plus each
// tile's own coverage box, the box 0.01 deg inside it, and one poking 0.5 deg past each edge (a partial cover: never claimed).
let seed = 20261023;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const regTiles = tiles.filter((t) => sets[R.regionalSetKey('GFS', LAYER, t.id)]);
const boxes = [];
for (let i = 0; i < N_BOXES; i++) {
  const t = regTiles[i % regTiles.length].bounds;
  const lngSpan = 1.5 + rnd() * 7.5; const latSpan = 1 + rnd() * 5;
  const cx = t.west - 1 + rnd() * (t.east - t.west + 2); const cy = t.south - 1 + rnd() * (t.north - t.south + 2);
  let b = { west: cx - lngSpan / 2, south: cy - latSpan / 2, east: cx + lngSpan / 2, north: cy + latSpan / 2 };
  if (i % 4 === 0) b = { west: Math.floor(b.west), south: Math.floor(b.south), east: Math.ceil(b.east), north: Math.ceil(b.north) };
  boxes.push(b);
}
for (const t of regTiles) {
  const c = t.bounds;
  boxes.push({ ...c, edge: `${t.id} exact` });
  boxes.push({ west: c.west + 0.01, south: c.south + 0.01, east: c.east - 0.01, north: c.north - 0.01, edge: `${t.id} -0.01` });
  boxes.push({ west: c.west + 1, south: c.south + 1, east: c.east + 0.5, north: c.north - 1, edge: `${t.id} past east` });
  boxes.push({ west: c.west - 0.5, south: c.south + 1, east: c.east - 1, north: c.north - 1, edge: `${t.id} past west` });
}

const t0 = Date.now();
const rows = []; const edges = []; const missed = [];
const totals = { boxes: 0, claimed: 0, refused: 0, refusedButFullRegional: 0, claimedButNot: 0, grid: newR(), series: newR() };
const metaKeys = ['product_id', 'served_valid_time', 'frame_offset_hours', 'frame_substituted', 'is_estimated', 'coverage_scope', 'coverage_mode',
  'requested_bbox', 'query_bbox', 'requested_bbox_original', 'served_bbox', 'coverage', 'partial_coverage'];
for (let i = 0; i < boxes.length; i++) {
  const b = boxes[i];
  const anchorMs = Math.round(Date.now() / 3600000) * 3600000;
  for (const seam of ['grid', 'series']) {
    if (seam === 'series' && (i % 3) && !b.edge) continue;
    const param = seam === 'grid' ? X.gridBboxParam(b) : X.seriesBboxParam(b);
    const tile = R.pickRegionalTile({ model: 'GFS', layer: LAYER, bboxStr: param });
    const set = tile && sets[tile.key];
    const anyIdx = (set || Object.values(sets)[0]).index;
    const built = anyIdx.frames.filter((f) => f.path);
    const frame0 = built[(i * 7) % built.length];
    const hour = Math.max(0, Math.round((Date.parse(frame0.valid_time) - anchorMs) / 3600000) + (i % 3));
    const askMs = anchorMs + hour * 3600000;
    const askIso = new Date(askMs).toISOString();
    totals.boxes++;
    let win = null; let pick = null;
    if (set) { pick = C.pickIndexFrame(set.index, askMs); if (pick && pick.path) win = R.regionalClipWindow(param, pick.grid || set.index.grid, 'GFS'); }
    const claimed = !!(win && win.covers);
    const url = seam === 'grid'
      ? `${API}/grid?model=GFS&domain=marine&layer=${LAYER}&valid_time=${encodeURIComponent(askIso)}&bbox=${param}`
      : `${API}/grid_series?model=GFS&domain=marine&layer=${LAYER}&bbox=${param}&hours=${hour}&base_time=${encodeURIComponent(new Date(anchorMs).toISOString())}`;
    const body = await (await fetch(url)).json();
    const theirs = seam === 'grid' ? body : (body.frames || [])[0];
    if (!theirs) continue;
    const theirScope = seam === 'grid' ? body.coverage_scope : (theirs.coverage_scope || null);
    const theirProduct = String(theirs.product_id || '');
    const theirTile = regTiles.find((t) => theirProduct.includes(`_${t.id}_`));
    const fullRegional = seam === 'grid' ? (theirScope === 'regional' && !!theirTile) : (!!tile && theirProduct.includes(`_${tile.id}_`));
    if (b.edge) edges.push({ edge: b.edge, seam, claimed, backend_scope: theirScope, product: theirProduct });
    if (!claimed) {
      totals.refused++;
      if (fullRegional && seam === 'grid') {
        totals.refusedButFullRegional++;
        missed.push({ i, param, why: !tile ? 'no tile contains the box' : !win ? 'no built frame' : 'window does not cover',
          tile: tile && tile.id, served_bbox: body.served_bbox, mine: win && win.bounds });
      }
      continue;
    }
    totals.claimed++;
    if (!fullRegional) { totals.claimedButNot++; rows.push({ i, seam, param, problem: 'claimed, backend did not serve the full regional tile', got: [theirScope, theirProduct, body.partial_coverage] }); continue; }
    const vectors = vectorsOf(set, pick);
    const grid = pick.grid || set.index.grid;
    const r = newR();
    if (seam === 'grid') {
      const mine = R.regionalGridJson(C.gridJsonFromFrame(set.index, pick, vectors, { askIso, requestedBbox: b }), win, X.cropVectors(vectors, grid.cols, win), param);
      metaCmp(mine, body, metaKeys, r);
      compareNodes(mine.grid, body.grid, r);
    } else {
      const sf = C.seriesFrameFromFrame(set.index, pick, vectors, { hourOffset: hour, askIso });
      const mine = X.cropSeriesFrame(sf, { ...win, clip: win.snapped }, X.cropVectors(vectors, grid.cols, win));
      metaCmp(mine, theirs, ['product_id', 'served_valid_time', 'frame_offset_hours', 'cols', 'rows', 'is_estimated'], r);
      compareNodes(mine, theirs, r);
    }
    const T = totals[seam];
    T.nodes += r.nodes; T.bad += r.bad; T.validity += r.validity; T.position += r.position; T.meta.push(...r.meta.map((m) => ({ i, ...m })));
    for (const k of Object.keys(T.maxErr)) T.maxErr[k] = Math.max(T.maxErr[k], r.maxErr[k]);
    if (r.bad || r.meta.length) rows.push({ i, seam, param, bad: r.bad, meta: r.meta.slice(0, 4) });
  }
}
const report = {
  layer: LAYER, sets: Object.keys(sets), boxes_x_seams: totals.boxes, claimed: totals.claimed, refused: totals.refused,
  refused_but_backend_full_regional: totals.refusedButFullRegional, claimed_but_backend_not_full_regional: totals.claimedButNot, sha12_bad: shaBad,
  grid: { nodes: totals.grid.nodes, bad: totals.grid.bad, meta_mismatches: totals.grid.meta.length, max_abs_err: totals.grid.maxErr },
  series: { nodes: totals.series.nodes, bad: totals.series.bad, meta_mismatches: totals.series.meta.length, max_abs_err: totals.series.maxErr },
  tolerance: TOL, edges, missed: missed.slice(0, 20), seconds: (Date.now() - t0) / 1000, problems: rows.slice(0, 12),
};
console.log(JSON.stringify(report, null, 1));
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ report, rows }, null, 1));
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exitCode = (totals.grid.bad || totals.series.bad || totals.grid.meta.length || totals.series.meta.length || totals.claimedButNot || shaBad) ? 1 : 0;
