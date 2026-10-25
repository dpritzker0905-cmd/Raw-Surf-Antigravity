// Static WIND frames vs /grid, node by node (2026-10-22, the wind instant scrub). Offline only.
//
// Loads the APP'S OWN windStaticFrames.js (with staticFrameCodec.js and staticFrameCrop.js; its CDN loader, products manifest and
// truth-tag imports replaced by readers of a local copy of the frames bucket and of THIS backend's /products) and asks it what
// seam A asks: tryStaticWindGrid({ model: 'GFS', validTimeStr, clampedBbox }). For every built frame of the run, at the frame's
// own time and +1 h / +2 h (the client asks manifest-snapped times; /grid picks the nearest within 3 h), for the WORLD box and for
// random viewport boxes the client can send (integer-snapped, as clampViewportBbox makes them) and the owner's boxes:
//   - when the app serves the box statically, /grid must answer the same: product id, served / asked times, frame_substituted,
//     coverage_scope, requested_bbox, served_bbox, stale, the HRRR lane stamp (deep equal), grid geometry and EVERY node (speed
//     0.005 kn, direction 0.005 deg, u / v 0.006 + 1e-4 x speed, validity);
//   - and the WIND TEXTURE bytes (WebGLWindUtils.encodeWindTexture's own formula: u, v over the grid's range, speed over
//     min(max, 120) kn, floored to 8 bits) built from both: identical bytes, or the count that differ (and by how much);
//   - boxes the app refuses are counted with what /grid served there (a refusal is always safe: /grid is asked as before).
// Exit 1 on any node or field mismatch.
//
//   node frontend/scripts/offline-backend/scn_wind_static_parity.mjs <frames dir> <backend port> [boxes=60] [out.json]
// Serve the backend with serve_synthetic.py --real-wind <dir> --real-wind-lane <lane json> (the published run in the store, the lane
// the frames were built with), and publish <frames dir> from that store with FRAME_WIND_LANE_FILE=<lane json>.
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';

const [cdnDir, port, nBoxesArg, outFile] = process.argv.slice(2);
if (!cdnDir || !port) { console.error('usage: scn_wind_static_parity.mjs <frames dir> <backend port> [boxes] [out.json]'); process.exit(2); }
// THE ONE LIVE READ (2026-10-23, PR #468's commitment): API_BASE=<backend origin> points the /grid side at it (the port is then
// ignored) and BOX_INDEXES=0,4 keeps the world box and one owner box; with FRAME_FROM/TO and OFFSETS=0 that is a handful of
// requests. <frames dir> is a local mirror of the CDN files the client reads (latest.json, the index, the frame, wind_lane.json).
const N_BOXES = +(nBoxesArg || 60);
const here = path.dirname(fileURLToPath(import.meta.url));
const mapDir = path.resolve(here, '../../src/components/map');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wind-parity-'));
const API = process.env.API_BASE ? `${process.env.API_BASE.replace(/\/+$/, '')}/api/weather` : `http://127.0.0.1:${port}/api/weather`;

const manifest = await (await fetch(`${API}/products`)).json();
const products = Array.isArray(manifest) ? manifest : (manifest.products || []);
const tiles = []; const seen = new Set();
for (const p of products) {
  if (String(p.model).toUpperCase() !== 'GFS' || String(p.domain).toLowerCase() !== 'wind') continue;
  if (p.region_id && !seen.has(p.region_id)) { seen.add(p.region_id); tiles.push({ id: p.region_id, bounds: p.coverage, is_estimated: !!p.is_estimated }); }
}
const latest = JSON.parse(fs.readFileSync(path.join(cdnDir, 'v1/latest.json'), 'utf8'));
const entry = latest.sets['GFS/wind/wind/global_mid'];
const index = JSON.parse(fs.readFileSync(path.join(cdnDir, entry.index), 'utf8'));
index.path = index.path || entry.index;

// The app's modules, imports rewired (nothing else touched).
const read = (f) => fs.readFileSync(path.join(mapDir, f), 'utf8');
const sub = (src, from, to) => { if (!src.includes(from)) throw Error(`import changed: ${from}`); return src.replace(from, to); };
fs.writeFileSync(path.join(tmp, 'staticFrameCodec.mjs'), read('staticFrameCodec.js'));
fs.writeFileSync(path.join(tmp, 'coverage.mjs'), `export const getAvailableTilesFromManifest = () => ({ tiles: ${JSON.stringify(tiles)}, fallbackReason: null });
export const clampViewportBbox = () => null;\n`);
fs.writeFileSync(path.join(tmp, 'staticFrameCrop.mjs'), sub(read('staticFrameCrop.js'), "from './backendWeatherServiceClientCoverage'", "from './coverage.mjs'"));
fs.writeFileSync(path.join(tmp, 'truth.mjs'), 'export const buildTruthTag = () => ({ stub: true });\n');
fs.writeFileSync(path.join(tmp, 'staticFrames.mjs'), `import fs from 'fs'; import path from 'path'; import zlib from 'zlib';
const DIR = ${JSON.stringify(cdnDir)}; const INDEX = JSON.parse(fs.readFileSync(path.join(DIR, ${JSON.stringify(entry.index)}), 'utf8'));
INDEX.path = INDEX.path || ${JSON.stringify(entry.index)};
const inflate = (p) => { const b = fs.readFileSync(path.join(DIR, p)); const r = b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b) : b; return r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength); };
export const staticFramesEnabled = () => true; export const staticFramesBase = () => 'file:///cdn/'; export const staticSetEnabled = () => true;
export const getPinnedIndex = async () => INDEX;
export const loadFrameParsed = async (key, frame) => ({ buffer: inflate(frame.path) });
export const fetchFrameBytes = async (url) => ({ buffer: inflate(url.replace('file:///cdn/', '')) });\n`);
let src = read('windStaticFrames.js');
src = sub(src, "from './staticFrames'", "from './staticFrames.mjs'");
src = sub(src, "from './staticFrameCodec'", "from './staticFrameCodec.mjs'");
src = sub(src, "from './staticFrameCrop'", "from './staticFrameCrop.mjs'");
src = sub(src, "from './backendWeatherServiceClientCoverage'", "from './coverage.mjs'");
src = sub(src, "from './weatherTruthTracker'", "from './truth.mjs'");
src = sub(src, "from '../../lib/apiClient'", "from './api.mjs'");   // the box-lane read (GET /api/weather/wind_lane) goes to the backend under test
fs.writeFileSync(path.join(tmp, 'api.mjs'), `export const BACKEND_URL = ${JSON.stringify(API.replace(/\/api\/weather$/, ''))};\n`);
fs.writeFileSync(path.join(tmp, 'windStaticFrames.mjs'), src);
globalThis.fetch = ((orig) => async (url, opts) => {
  if (String(url).startsWith('file:///cdn/')) {
    const p = path.join(cdnDir, String(url).replace('file:///cdn/', ''));
    if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
  }
  return orig(url, opts);
})(globalThis.fetch);
globalThis.window = globalThis.window || {};   // the module's telemetry (window.__RAW_WIND_STATIC__) and kill switches
for (const k of (process.env.KILLS || '').split(',').filter(Boolean)) globalThis.window[k] = true;   // KILLS=__RAW_DISABLE_...__,...
const WS = await import(pathToFileURL(path.join(tmp, 'windStaticFrames.mjs')).href);
// The box's lane constants, as the app reads them (LayerAccessResolver -> window.__WEATHER_CAPABILITIES__; windStaticFrames.boxLane).
globalThis.window.__WEATHER_CAPABILITIES__ = await (await fetch(`${API}/capabilities`)).json();

// WebGLWindUtils.encodeWindTexture's bytes (no GL): R = u, G = v over the grid's range, B = speed over min(max, 120), floored.
function texBytes(vectors) {
  let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity; let maxS = 0;
  for (const v of vectors) { if (v.u < minU) minU = v.u; if (v.u > maxU) maxU = v.u; if (v.v < minV) minV = v.v; if (v.v > maxV) maxV = v.v; if (v.speed > maxS) maxS = v.speed; }
  if (maxU === minU) maxU = minU + 1; if (maxV === minV) maxV = minV + 1;
  const eff = Math.max(5, Math.min(maxS, 120));
  const out = new Uint8Array(vectors.length * 3);
  vectors.forEach((v, i) => {
    out[i * 3] = Math.floor(((v.u - minU) / (maxU - minU)) * 255);
    out[i * 3 + 1] = Math.floor(((v.v - minV) / (maxV - minV)) * 255);
    out[i * 3 + 2] = Math.floor(Math.min(1, v.speed / eff) * 255);
  });
  return out;
}
const mapped = (vs) => vs.map((v) => ({ speed: v.speed || 0, u: v.u || 0, v: v.v || 0 }));   // mapNormalizedWindGridToWebGL's fields
const angle = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const deepEq = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(o) { if (Array.isArray(o)) return o.map(sortKeys); if (o && typeof o === 'object') return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])); return o; }

let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const boxes = [{ west: -180, south: -80, east: 180, north: 85, kind: 'world' }];
// the owner's boxes (844 x 390 at -79.5, 28.6: z2, z3.9, z4.4 as clampViewportBbox pads and snaps them) and the scenario's
for (const b of [[-172, -22, 8, 72], [-160, -10, -4, 60], [-104, 8, -54, 50], [-99, 13, -60, 44], [-96, 15, -63, 42], [-112, -2, -46, 58], [-87, 24, -73, 33], [-90, 18, -70, 39]]) {
  boxes.push({ west: b[0], south: b[1], east: b[2], north: b[3], kind: 'owner' });
}
for (let i = 0; i < N_BOXES; i++) {
  const spanX = 8 + Math.floor(rnd() * 172); const spanY = Math.min(160, 5 + Math.floor(rnd() * 100));
  const w = -180 + Math.floor(rnd() * (360 - spanX)); const s = -80 + Math.floor(rnd() * Math.max(1, 165 - spanY));
  boxes.push({ west: w, south: s, east: w + spanX, north: Math.min(85, s + spanY), kind: 'random' });
}

if (process.env.BOX_INDEXES) {
  const keep = new Set(process.env.BOX_INDEXES.split(',').map(Number));
  boxes.splice(0, boxes.length, ...boxes.filter((_, i) => keep.has(i)));
}
const frames = index.frames.filter((f) => f.path);
const stats = { comparisons: 0, nodes: 0, bad: 0, fieldBad: 0, refused: {}, refusedServedMid: 0, texBytes: 0, texDiff: 0, texMaxLsb: 0, maxErr: { speed: 0, direction: 0, uv: 0 }, worldServed: 0, cropServed: 0, laneTouched: 0, examples: [], missSeen: {} };
const fieldsToCompare = ['product_id', 'served_valid_time', 'valid_time', 'frame_substituted', 'coverage_scope', 'requested_bbox', 'served_bbox', 'stale', 'model', 'region_id', 'is_estimated', 'model_run_time'];
const hoursPer = (process.env.OFFSETS || '0,1,2').split(',').map(Number);
const step = +(process.env.FRAME_STEP || 1);
const fromF = +(process.env.FRAME_FROM || 0); const toF = Math.min(frames.length, +(process.env.FRAME_TO || frames.length));
const snapshot = () => ({ cdnDir, run: index.run, lane: index.wind_lane, frames: frames.length, frameRange: [fromF, toF, step], boxes: boxes.length,
  offsets: hoursPer, ...stats, missSeen: undefined });
for (let fi = fromF; fi < toF; fi += step) {
  const f = frames[fi];
  for (const dh of hoursPer) {
    const ask = new Date(Date.parse(f.valid_time) + dh * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    for (const box of boxes) {
      const kind = WS.windBoxKind('GFS', box);
      const bboxParam = `${box.west},${box.south},${box.east},${box.north}`;
      if (!kind) { stats.refused.box = (stats.refused.box || 0) + 1; continue; }
      const sj = await WS.tryStaticWindGrid({ model: 'GFS', validTimeStr: ask, clampedBbox: box });
      const gj = await (await fetch(`${API}/grid?model=GFS&domain=wind&layer=wind&valid_time=${encodeURIComponent(ask)}&bbox=${bboxParam}`)).json();
      if (!sj) {
        const m = (globalThis.window.__RAW_WIND_STATIC__ || {}).misses || {};
        const why = Object.keys(m).find((k) => (m[k] || 0) > (stats.missSeen[k] || 0)) || 'refused';
        stats.missSeen = { ...m };
        stats.refused[why] = (stats.refused[why] || 0) + 1;
        if (gj && gj.grid && gj.grid.diagnostics && gj.grid.diagnostics.mid_res_tier) stats.refusedServedMid += 1;
        continue;
      }
      stats.comparisons += 1;
      if (kind === 'world') stats.worldServed += 1; else stats.cropServed += 1;
      if (sj.wind_lane && sj.wind_lane.lane === 'hrrr+gfs') stats.laneTouched += 1;
      const issues = [];
      for (const k of fieldsToCompare) if (JSON.stringify(sj[k] ?? null) !== JSON.stringify(gj[k] ?? null)) issues.push(`${k}: ${JSON.stringify(sj[k])} vs ${JSON.stringify(gj[k])}`);
      if (!deepEq(sj.wind_lane || null, gj.wind_lane || null)) issues.push(`wind_lane: ${JSON.stringify(sj.wind_lane)} vs ${JSON.stringify(gj.wind_lane)}`);
      const sg = sj.grid; const gg = gj.grid;
      if (sg.cols !== gg.cols || sg.rows !== gg.rows || !deepEq(sg.bounds, gg.bounds)) issues.push(`grid ${sg.cols}x${sg.rows} ${JSON.stringify(sg.bounds)} vs ${gg.cols}x${gg.rows} ${JSON.stringify(gg.bounds)}`);
      else {
        for (let i = 0; i < gg.vectors.length; i++) {
          const a = sg.vectors[i]; const b = gg.vectors[i]; stats.nodes += 1;
          const valid = b.is_valid !== false;
          if (Math.abs(a.lat - b.lat) > 1e-6 || Math.abs(a.lng - b.lng) > 1e-6 || (a.is_valid !== false) !== valid) { stats.bad += 1; continue; }
          if (!valid) continue;
          const es = Math.abs(a.speed - b.speed); const ed = angle(a.direction, b.direction); const eu = Math.max(Math.abs(a.u - b.u), Math.abs(a.v - b.v));
          stats.maxErr.speed = Math.max(stats.maxErr.speed, es); stats.maxErr.direction = Math.max(stats.maxErr.direction, ed); stats.maxErr.uv = Math.max(stats.maxErr.uv, eu);
          if (es > 0.005 + 1e-9 || ed > 0.005 + 1e-9 || eu > 0.006 + 1e-4 * b.speed) stats.bad += 1;
        }
        const ta = texBytes(mapped(sg.vectors)); const tb = texBytes(mapped(gg.vectors));
        stats.texBytes += ta.length;
        for (let i = 0; i < ta.length; i++) if (ta[i] !== tb[i]) { stats.texDiff += 1; stats.texMaxLsb = Math.max(stats.texMaxLsb, Math.abs(ta[i] - tb[i])); }
      }
      if (issues.length) { stats.fieldBad += 1; if (stats.examples.length < 8) stats.examples.push({ ask, box: bboxParam, issues }); }
    }
  }
  console.log(`frame ${fi}/${frames.length}: comparisons ${stats.comparisons} nodes ${stats.nodes} bad ${stats.bad} fieldBad ${stats.fieldBad} texDiff ${stats.texDiff}/${stats.texBytes} laneTouched ${stats.laneTouched}`);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(snapshot(), null, 1));   // a stopped run keeps its numbers
}
const out = snapshot();
console.log(JSON.stringify(out, null, 1));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
process.exitCode = (stats.bad || stats.fieldBad) ? 1 : 0;
