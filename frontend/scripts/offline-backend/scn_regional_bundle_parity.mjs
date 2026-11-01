// Regional static frame BUNDLES vs /grid_series, node by node (2026-10-23, the z7-9 bundle client's parity gate). Offline first.
//
// For every regional set in v1/latest.json (backend/services/frame_set_bundle.py: one bundle per set per run, frames as slices
// [offset, offset+length) checked by sha12), ask the REAL backend's /grid_series for the same box and hours the client would, and
// compare every frame the bundle would serve with the series frame, node by node, with the APP'S OWN codec
// (src/components/map/staticFrameCodec.js, loaded as-is):
//   (A) the WHOLE tile: bbox = the tile's own lattice (index.grid.bounds, the outer cell centres) -> the series frame must equal the
//       bundle frame (same lattice, every node within the quantisation, same validity, same served valid time and run);
//   (B) a SUB-BOX inside the tile (the client's fully-covered rule: a viewport the tile fully covers reads the bundle) -> every node
//       the series returns must equal the bundle's node at the same position;
//   (C) the POSITIVE CONTROL: a box that pokes outside the tile (partial cover; the client stays on /grid_series there) -> the
//       server answers from another tier, so the comparison MUST report differences. If it reports none the check has no teeth and
//       the run fails.
// Hours: 0..HOURS-1 (default 48, hourly, the client's page) from the index's first valid time; each ask picks its frame with the
// client's own pickIndexFrame (nearest within 3 h, authoritative first). An unbuilt entry (offset null) must fall back.
//
//   node frontend/scripts/offline-backend/scn_regional_bundle_parity.mjs <cdn dir | https base> <backend base url> [out.json]
//   env: SETS=<comma list of set keys> (default every regional set), HOURS=48, LIVE=1 (one set, 3 hours, the live-read mode)
//
// Offline recipe: serve_synthetic.py --dir <store> --regions all --port 4110 ; publish_frame_images.py --store-dir <store>
// --out-dir <cdn> --only frames (FRAME_SETS= the regional keys) ; then this script against <cdn> and http://127.0.0.1:4110.
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

const [cdn, backend, outFile] = process.argv.slice(2);
if (!cdn || !backend) { console.error('usage: scn_regional_bundle_parity.mjs <cdn dir|base url> <backend base url> [out.json]'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `staticFrameCodec-${process.pid}.mjs`);
fs.copyFileSync(path.resolve(here, '../../src/components/map/staticFrameCodec.js'), tmp);
const C = await import(pathToFileURL(tmp).href);

const LIVE = process.env.LIVE === '1';
const HOURS = Number(process.env.HOURS || (LIVE ? 3 : 48));
const TOL = { speed: 0.0005 + 1e-9, direction: 0.005 + 1e-9, period: 0.005 + 1e-9, dir_confidence: 0.5 / 254 + 1e-4 };
const isUrl = /^https?:/.test(cdn);
async function readBytes(rel) {
  if (!isUrl) return fs.readFileSync(path.join(cdn, rel));
  const r = await fetch(`${cdn.replace(/\/+$/, '')}/${rel}?cb=${Date.now()}`);
  if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
const sha12 = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);
const angle = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const key = (v) => `${(+v.lat).toFixed(3)},${(+v.lng).toFixed(3)}`;

function compareNodes(mine, theirs, { requireSameLattice }) {
  const r = { nodes: 0, bad: 0, validity: 0, missing: 0, maxErr: { speed: 0, direction: 0, period: 0, dir_confidence: 0 } };
  const byPos = new Map(mine.vectors.map((v) => [key(v), v]));
  if (requireSameLattice && (mine.cols !== theirs.cols || mine.rows !== theirs.rows)) { r.bad = Math.max(mine.vectors.length, theirs.vectors.length); r.lattice = [mine.cols, mine.rows, theirs.cols, theirs.rows]; return r; }
  for (const g of theirs.vectors) {
    r.nodes++;
    const m = byPos.get(key(g));
    if (!m) { r.missing++; r.bad++; continue; }
    if ((m.is_valid !== false) !== (g.is_valid !== false)) { r.validity++; r.bad++; continue; }
    if (g.is_valid === false) continue;
    const e = {
      speed: Math.abs(m.speed - g.speed), direction: angle(m.direction, g.direction),
      period: (m.period == null) !== (g.period == null) ? Infinity : Math.abs((m.period || 0) - (g.period || 0)),
      dir_confidence: (m.dir_confidence == null) !== (g.dir_confidence == null) ? Infinity : Math.abs((m.dir_confidence || 0) - (g.dir_confidence || 0)),
    };
    let bad = false;
    for (const [k, v] of Object.entries(e)) { if (v > r.maxErr[k]) r.maxErr[k] = v; if (v > TOL[k]) bad = true; }
    if (bad) r.bad++;
  }
  return r;
}

async function series(model, layer, bbox, baseIso, hours) {
  const b = [bbox.west, bbox.south, bbox.east, bbox.north].map((x) => x.toFixed(4)).join(',');
  const url = `${backend.replace(/\/+$/, '')}/api/weather/grid_series?model=${model}&domain=marine&layer=${layer}&bbox=${b}`
    + `&hours=${hours.join(',')}&base_time=${encodeURIComponent(baseIso)}`;
  const t0 = Date.now();
  const r = await fetch(url);
  const body = await r.json();
  return { status: r.status, frames: body.frames || [], secs: (Date.now() - t0) / 1000 };
}

const latest = JSON.parse((await readBytes('v1/latest.json')).toString('utf8'));
let sets = Object.entries(latest.sets || {}).filter(([k, v]) => v.bundle && !k.endsWith('/global_mid'));
if (process.env.SETS) { const want = new Set(process.env.SETS.split(',')); sets = sets.filter(([k]) => want.has(k)); }
if (LIVE) sets = sets.slice(0, 1);
const reports = [];
const totals = { sets: 0, frames_checked: 0, nodes: 0, bad: 0, meta: 0, sha_bad: 0, unbuilt_fallbacks: 0, control_sets: 0, control_differs: 0 };
for (const [setKey, rec] of sets) {
  const [MODEL, , LAYER, REGION] = setKey.split('/');
  const index = JSON.parse((await readBytes(rec.index)).toString('utf8'));
  const bundle = await readBytes(index.bundle.path);
  const rep = { set: setKey, frames: index.frames.length, sha_bad: 0, whole: { nodes: 0, bad: 0, meta: 0 }, sub: { nodes: 0, bad: 0 },
    control: null, unbuilt_fallbacks: 0, series_secs: 0 };
  if (sha12(bundle) !== index.bundle.sha12) rep.sha_bad++;
  const decoded = new Map();
  for (const f of index.frames) {
    if (f.offset == null) continue;
    const slice = bundle.subarray(f.offset, f.offset + f.length);
    if (sha12(slice) !== f.sha12) { rep.sha_bad++; continue; }
    const raw = zlib.gunzipSync(slice);
    decoded.set(f.valid_time, C.buildVectors(C.parseFrame(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))));
  }
  const g = index.grid.bounds;
  const baseMs = Date.parse(index.frames[0].valid_time);
  const baseIso = new Date(baseMs).toISOString();
  const hours = Array.from({ length: HOURS }, (_, i) => i);
  const dLon = (g.east - g.west) / (index.grid.cols - 1), dLat = (g.north - g.south) / (index.grid.rows - 1);
  const boxes = {
    whole: { west: g.west, south: g.south, east: g.east, north: g.north },
    sub: { west: g.west + 2 * dLon, south: g.south + 2 * dLat, east: g.east - 2 * dLon, north: g.north - 2 * dLat },
    control: { west: g.west - 3, south: g.south - 3, east: g.east, north: g.north },
  };
  for (const [which, bbox] of Object.entries(boxes)) {
    const s = await series(MODEL, LAYER, bbox, baseIso, hours);
    rep.series_secs += s.secs;
    let cmpNodes = 0, cmpBad = 0, meta = 0;
    for (const sf of s.frames) {
      const askMs = baseMs + (sf.hour_offset ?? 0) * 3600000;
      const pick = C.pickIndexFrame(index, askMs);
      if (!pick) continue;
      if (pick.offset == null) { if (which === 'whole') rep.unbuilt_fallbacks++; continue; }   // the client asks /grid_series here
      const vectors = decoded.get(pick.valid_time);
      if (!vectors) continue;
      const mine = C.seriesFrameFromFrame(index, pick, vectors, { hourOffset: sf.hour_offset, askIso: new Date(askMs).toISOString() });
      if (which !== 'control') {
        for (const k of ['served_valid_time', 'model_run_time', 'product_id']) {
          const a = mine[k] ?? null, b = sf[k] ?? null;
          // timestamps compare as INSTANTS: the series serialises model_run_time as +00:00, the index as Z (the same time)
          const same = k === 'product_id' ? a === b : (a === null || b === null ? a === b : Date.parse(a) === Date.parse(b));
          if (!same) meta++;
        }
      }
      const r = compareNodes(mine, sf, { requireSameLattice: which === 'whole' });
      cmpNodes += r.nodes; cmpBad += r.bad;
    }
    if (which === 'control') rep.control = { frames: s.frames.length, nodes: cmpNodes, differing: cmpBad + (s.frames[0] && s.frames[0].cols !== index.grid.cols ? 1 : 0) };
    else { rep[which] = { nodes: cmpNodes, bad: cmpBad, meta }; }
  }
  totals.sets++; totals.frames_checked += decoded.size; totals.nodes += rep.whole.nodes + rep.sub.nodes;
  totals.bad += rep.whole.bad + rep.sub.bad; totals.meta += rep.whole.meta + rep.sub.meta; totals.sha_bad += rep.sha_bad;
  totals.unbuilt_fallbacks += rep.unbuilt_fallbacks; totals.control_sets++; totals.control_differs += rep.control && rep.control.differing > 0 ? 1 : 0;
  reports.push(rep);
  console.log(JSON.stringify({ set: setKey, frames: rep.frames, whole: rep.whole, sub: rep.sub, control: rep.control, sha_bad: rep.sha_bad,
    unbuilt: rep.unbuilt_fallbacks, series_secs: +rep.series_secs.toFixed(1) }));
}
const pass = totals.sets > 0 && totals.bad === 0 && totals.meta === 0 && totals.sha_bad === 0 && totals.control_differs === totals.control_sets;
console.log(JSON.stringify({ totals, pass }));
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ totals, pass, sets: reports }, null, 1));
fs.unlinkSync(tmp);
process.exitCode = pass ? 0 : 1;
