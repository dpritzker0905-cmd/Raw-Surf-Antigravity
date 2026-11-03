// RATED static frames vs /grid?surf=1, node by node (2026-11-01, item 10: the Surf Rating band from CDN frames). Offline only.
//
// The app answers a surf ask for a crop box from the RATED set (src/components/map/staticRatingFrames.js; publisher
// backend/services/frame_set_rating.py). This loads the APP'S OWN modules (staticFrameCodec.js, staticFrameCrop.js,
// staticRatingFrames.js, copied to a temp dir; the products-manifest reader is replaced by this backend's /products, the truth tag
// is stubbed) and, for seeded viewport boxes x frames x ask offsets -2..+2 h:
//   - when the app CLAIMS the ask (ratedCropEligible + askOffsetServed + a built frame), the backend's /grid?surf=1 MUST be a rated
//     mid-tier grid and tryStaticRatedGrid's JSON must equal it: geometry; every node's speed (the score / 10: EXACT), is_valid and
//     phys_speed (presence exact, value at the height's 0.5 mm step), direction / period / confidence / u, v at the frame's
//     quantisation; identity and time fields; diagnostics.surf_transform (value_kind, wind, local_size, obs_gate, rated, masked);
//   - POSITIVE CONTROL: for asks the app REFUSES on `ask_offsets_h` alone, the same crop built anyway is compared too; it must read
//     bad > 0 somewhere (the offsets exist because the wind the rating reads changes with the ask hour).
// Exit 1 on any mismatch in a claimed ask, or a control that finds nothing.
//
//   node frontend/scripts/offline-backend/scn_rated_crop_parity.mjs <bucket copy> <backend port> [boxes=120] [out.json]
// Publish first: FRAME_RATING_SETS=1 python backend/scripts/publish_frame_images.py --store-dir <store> --out-dir <cdn> --only rated
// and serve the SAME store with serve_synthetic.py (MODEL / LAYER env pick the set; default GFS waves).
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';

const [cdnDir, port, nBoxesArg, outFile] = process.argv.slice(2);
const MODEL = (process.env.MODEL || 'GFS').toUpperCase();
const LAYER = (process.env.LAYER || 'waves').toLowerCase();
if (!cdnDir || !port) { console.error('usage: scn_rated_crop_parity.mjs <bucket copy> <backend port> [boxes] [out.json]'); process.exit(2); }
const N_BOXES = +(nBoxesArg || 120);
const here = path.dirname(fileURLToPath(import.meta.url));
const mapDir = path.resolve(here, '../../src/components/map');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rated-parity-'));
const API = `http://127.0.0.1:${port}/api/weather`;
globalThis.window = { __RAW_RATING_FRAMES__: true };   // the app's dark lever, ON for this run

const manifest = await (await fetch(`${API}/products`)).json();
const products = Array.isArray(manifest) ? manifest : (manifest.products || []);
const tiles = []; const seen = new Set();
for (const p of products) {
  if (String(p.model).toUpperCase() !== MODEL || String(p.domain).toLowerCase() !== 'marine' || String(p.layer).toLowerCase() !== LAYER) continue;
  if (p.region_id && !seen.has(p.region_id)) { seen.add(p.region_id); tiles.push({ id: p.region_id, bounds: p.coverage }); }
}
const stubTiles = `const __TILES = ${JSON.stringify(tiles)};\nconst getAvailableTilesFromManifest = () => ({ tiles: __TILES, fallbackReason: null });`;
const copy = (name, edit) => {
  let src = fs.readFileSync(path.join(mapDir, `${name}.js`), 'utf8');
  src = edit ? edit(src) : src;
  fs.writeFileSync(path.join(tmpDir, `${name}.mjs`), src.replace(/from '\.\/(staticFrameCodec|staticFrameCrop)'/g, "from './$1.mjs'"));
};
const coverageImport = /import \{ getAvailableTilesFromManifest \} from '\.\/backendWeatherServiceClientCoverage';/;
copy('staticFrameCodec');
copy('staticFrameCrop', (s) => { if (!coverageImport.test(s)) throw Error('staticFrameCrop.js import changed'); return s.replace(coverageImport, stubTiles); });
copy('staticRatingFrames', (s) => {
  if (!coverageImport.test(s)) throw Error('staticRatingFrames.js import changed');
  return s.replace(coverageImport, stubTiles).replace(/import \{ buildTruthTag \} from '\.\/weatherTruthTracker';/, 'const buildTruthTag = () => null;');
});
const C = await import(pathToFileURL(path.join(tmpDir, 'staticFrameCodec.mjs')).href);
const X = await import(pathToFileURL(path.join(tmpDir, 'staticFrameCrop.mjs')).href);
const R = await import(pathToFileURL(path.join(tmpDir, 'staticRatingFrames.mjs')).href);

const latest = JSON.parse(fs.readFileSync(path.join(cdnDir, 'v1/latest.json'), 'utf8'));
const key = R.ratedSetKey(MODEL, LAYER);
const entry = latest.sets[key];
if (!entry || !entry.index) throw Error(`no ${key} in latest.json`);
const index = JSON.parse(fs.readFileSync(path.join(cdnDir, entry.index), 'utf8'));
index.path = index.path || entry.index;
const built = index.frames.filter((f) => f.path);

const TOL = { phys_speed: 0.0005 + 1e-9, direction: 0.005 + 1e-9, period: 0.005 + 1e-9, dir_confidence: 0.5 / 254 + 1e-4, uv: 0.0012 };
const angle = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const vecCache = new Map();
const vectorsOf = (frame, plain = false) => {
  const ck = `${frame.path}${plain ? '#plain' : ''}`;
  if (vecCache.has(ck)) return vecCache.get(ck);
  const gz = fs.readFileSync(path.join(cdnDir, frame.path));
  const raw = gz[0] === 0x1f && gz[1] === 0x8b ? zlib.gunzipSync(gz) : gz;
  const parsed = C.parseFrame(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  if (plain) delete parsed.fields[C.FIELD.RATING];          // CONTROL 2: the same frame without its rating plane
  const v = C.buildVectors(parsed);
  vecCache.set(ck, v);
  return v;
};
const loaders = { getPinnedIndex: async () => index, loadFrameVectors: async (_k, f) => vectorsOf(f) };
const plainLoaders = { getPinnedIndex: async () => index, loadFrameVectors: async (_k, f) => vectorsOf(f, true) };

const newR = () => ({ nodes: 0, bad: 0, speed: 0, validity: 0, phys: 0, other: 0, rated: 0, maxErr: { ...Object.fromEntries(Object.keys(TOL).map((k) => [k, 0])), speed: 0 }, meta: [] });
function compare(mine, body, r) {
  const a = mine.grid; const b = body.grid;
  const same = ['west', 'south', 'east', 'north'].every((k) => Math.abs(a.bounds[k] - b.bounds[k]) < 1e-9);
  if (a.cols !== b.cols || a.rows !== b.rows || !same) { r.meta.push({ k: 'grid', mine: [a.cols, a.rows], grid: [b.cols, b.rows] }); r.bad += b.vectors.length; return; }
  for (let i = 0; i < b.vectors.length; i++) {
    const m = a.vectors[i]; const g = b.vectors[i];
    r.nodes++;
    let bad = false;
    if ((m.is_valid !== false) !== (g.is_valid !== false)) { r.validity++; bad = true; }
    if ((m.phys_speed == null) !== (g.phys_speed == null)) { r.phys++; bad = true; }
    if (g.phys_speed != null && g.is_valid !== false) r.rated++;
    const sp = Math.abs(m.speed - g.speed);
    // a rated node's speed is the score / 10: EXACT; any other node's speed is the stored height (the frame's 0.5 mm step)
    if (g.phys_speed != null && g.is_valid !== false ? sp !== 0 : sp > TOL.phys_speed) { r.speed++; bad = true; }
    r.maxErr.speed = Math.max(r.maxErr.speed, g.phys_speed != null && g.is_valid !== false ? sp : 0);
    const e = {
      phys_speed: (m.phys_speed != null && g.phys_speed != null) ? Math.abs(m.phys_speed - g.phys_speed) : 0,
      direction: angle(m.direction, g.direction),
      period: (m.period == null) !== (g.period == null) ? Infinity : Math.abs((m.period || 0) - (g.period || 0)),
      dir_confidence: (m.dir_confidence == null) !== (g.dir_confidence == null) ? Infinity : Math.abs((m.dir_confidence || 0) - (g.dir_confidence || 0)),
      uv: (g.u || g.v) ? Math.max(Math.abs(m.u - g.u), Math.abs(m.v - g.v)) : 0,
    };
    for (const [k, v] of Object.entries(e)) { if (v > r.maxErr[k]) r.maxErr[k] = v; if (v > TOL[k]) { r.other++; bad = true; } }
    if (bad) r.bad++;
  }
  const keys = ['product_id', 'served_valid_time', 'frame_offset_hours', 'model_run_time', 'provider', 'is_estimated',
    'is_forecast_authoritative', 'coverage_scope', 'coverage_mode', 'requested_bbox', 'served_bbox', 'coverage'];
  for (const k of keys) if (JSON.stringify(mine[k] ?? null) !== JSON.stringify(body[k] ?? null)) r.meta.push({ k, mine: mine[k] ?? null, grid: body[k] ?? null });
  const st = (j) => { const t = (j.grid.diagnostics || {}).surf_transform || {}; return { value_kind: t.value_kind, wind: t.wind, local_size: t.local_size, obs_gate: t.obs_gate, rated: t.rated, masked: t.masked }; };
  if (JSON.stringify(st(mine)) !== JSON.stringify(st(body))) r.meta.push({ k: 'surf_transform', mine: st(mine), grid: st(body) });
}

let seed = 20261101;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const boxes = [];
for (let i = 0; i < N_BOXES; i++) {                       // viewport-like, z3.5-5.5: lng 16-45 deg, lat 10-30 deg (+ a few narrow ones)
  const narrow = i % 6 === 5;
  const lngSpan = narrow ? 13 + rnd() * 3 : 16 + rnd() * 29; const latSpan = narrow ? 8 + rnd() * 6 : 10 + rnd() * 20;
  const cx = -170 + rnd() * 340; const cy = -60 + rnd() * 120;
  let b = { west: cx - lngSpan / 2, south: cy - latSpan / 2, east: cx + lngSpan / 2, north: cy + latSpan / 2 };
  if (i % 4 === 0) b = { west: Math.floor(b.west), south: Math.floor(b.south), east: Math.ceil(b.east), north: Math.ceil(b.north) };
  boxes.push(b);
}

const t0 = Date.now();
const totals = { asks: 0, claimedAsks: 0, refused_offset: 0, refused_rules: 0, claimed_not_rated: 0, claimed: newR(), control: newR(), controlAsks: 0, plain: newR() };
const problems = [];
for (let i = 0; i < boxes.length; i++) {
  const b = boxes[i];
  const frame = built[(i * 7) % built.length];
  for (const off of [-2, -1, 0, 1, 2]) {
    const askMs = Date.parse(frame.valid_time) + off * 3600000;
    const pick = C.pickIndexFrame(index, askMs);
    if (!pick || !pick.path || pick.path !== frame.path) continue;    // only asks that land on this frame
    const askIso = new Date(askMs).toISOString();
    totals.asks++;
    if (!R.ratedCropEligible({ model: MODEL, layer: LAYER, bbox: b }, () => true)) { totals.refused_rules++; continue; }
    const served = R.askOffsetServed(index, pick, askMs);
    const param = X.gridBboxParam(b);
    const body = await (await fetch(`${API}/grid?model=${MODEL}&domain=marine&layer=${LAYER}&surf=1&valid_time=${encodeURIComponent(askIso)}&bbox=${param}`)).json();
    const rated = !!(body.grid && body.grid.diagnostics && body.grid.diagnostics.mid_res_tier && (body.grid.diagnostics.surf_transform || {}).value_kind === 'surf_rating');
    // the app's own answer; for a refused offset, the same crop built anyway (the control)
    const mine = served ? await R.tryStaticRatedGrid({ model: MODEL, layer: LAYER, validTimeStr: askIso, clampedBbox: b }, loaders)
      : await R.tryStaticRatedGrid({ model: MODEL, layer: LAYER, validTimeStr: askIso, clampedBbox: b },
        { getPinnedIndex: async () => ({ ...index, common_meta: { ...index.common_meta, ask_offsets_h: [-3, -2, -1, 0, 1, 2, 3] }, frames: index.frames.map((f) => ({ ...f, meta: { ...(f.meta || {}), ask_offsets_h: [-3, -2, -1, 0, 1, 2, 3] } })) }), loadFrameVectors: loaders.loadFrameVectors });
    if (!served) totals.refused_offset++; else totals.claimedAsks++;
    if (!rated) { if (served) { totals.claimed_not_rated++; problems.push({ i, off, param, problem: 'claimed, backend did not serve a rated mid grid', got: body.product_id }); } continue; }
    if (!mine) { problems.push({ i, off, param, problem: 'app returned null', telemetry: globalThis.window.__RAW_STATIC_FRAMES_RATED__ }); continue; }
    const r = newR();
    compare(mine, body, r);
    const T = served ? totals.claimed : totals.control;
    if (!served) totals.controlAsks++;
    for (const k of ['nodes', 'bad', 'speed', 'validity', 'phys', 'other', 'rated']) T[k] += r[k];
    for (const k of Object.keys(T.maxErr)) T.maxErr[k] = Math.max(T.maxErr[k], r.maxErr[k]);
    T.meta.push(...r.meta.map((m) => ({ i, off, ...m })));
    if (served && (r.bad || r.meta.length)) problems.push({ i, off, param, bad: r.bad, meta: r.meta.slice(0, 3) });
    if (served) {                                            // CONTROL 2: the plain frame cropped the same way is NOT the band
      const pm = await R.tryStaticRatedGrid({ model: MODEL, layer: LAYER, validTimeStr: askIso, clampedBbox: b }, plainLoaders);
      const pr = newR();
      if (pm) { compare(pm, body, pr); for (const k of ['nodes', 'bad']) totals.plain[k] += pr[k]; }
    }
  }
}
const pack = (T) => ({ nodes: T.nodes, rated_nodes: T.rated, bad: T.bad, speed_bad: T.speed, validity_bad: T.validity, phys_bad: T.phys, other_bad: T.other, meta_mismatches: T.meta.length, max_abs_err: T.maxErr });
const report = {
  set: key, index: index.path, frames_built: built.length, asks: totals.asks, refused_by_rules: totals.refused_rules,
  claimed: totals.claimedAsks, claimed_but_backend_not_rated_mid: totals.claimed_not_rated, refused_on_ask_offset: totals.refused_offset,
  claimed_parity: pack(totals.claimed), control_asks: totals.controlAsks, control_parity: pack(totals.control),
  control_meta_sample: totals.control.meta.slice(0, 3), plain_control: { nodes: totals.plain.nodes, bad: totals.plain.bad }, seconds: (Date.now() - t0) / 1000, problems: problems.slice(0, 10),
};
console.log(JSON.stringify(report, null, 1));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
fs.rmSync(tmpDir, { recursive: true, force: true });
const controlFound = totals.control.bad > 0 || totals.control.meta.length > 0;
process.exitCode = (!(totals.plain.bad > 0) || totals.claimed.bad || totals.claimed.meta.length || totals.claimed_not_rated || problems.length || (totals.controlAsks && !controlFound)) ? 1 : 0;
