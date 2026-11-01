// Static frames vs /grid, node by node (step 2b, 2026-10-20). Offline only.
//
// For every frame in the published run index (scripts/publish_frame_images.py --store-dir <store> --out-dir <cdn>),
// decode it with the APP'S OWN codec (src/components/map/staticFrameCodec.js, loaded as-is) into the /grid response it
// stands in for, and compare it with what the REAL backend (serve_synthetic.py over the same store) serves for the same
// world request and valid time: on the hour of the frame and at +1 h and +2 h (nearest-frame substitution, the honesty
// fields). Tolerances are the frame's stated quantisation (backend/services/frame_binary.py TOLERANCE). An entry the
// publisher could not build (path null) is checked the other way: every ask that picks it falls back, and /grid serves
// the product it names (a gap must never be filled with a neighbouring frame).
//
//   node frontend/scripts/offline-backend/scn_static_parity.mjs <cdn dir> <backend port> [out.json]
//
// MASKED CELLS (2026-10-22): run it over a store built with `serve_synthetic.py --land-mask 1`. An all-ocean store hid that /grid
// rewrites EURO/ICON world grids' masked cells (coarse_gulf_fill), so EURO/ICON world frames read 0 bad there and differ live.
// With the mask, EURO/ICON sets read bad > 0 here: that is the POSITIVE CONTROL. GUARD=1 mirrors the client's guard
// (staticFrames.serveTimeFillAtWorld: those world asks go to /grid) and skips them, reporting them as guarded.
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';

const [cdnDir, port, outFile] = process.argv.slice(2);
if (!cdnDir || !port) { console.error('usage: scn_static_parity.mjs <cdn dir> <backend port> [out.json]'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const codecSrc = path.resolve(here, '../../src/components/map/staticFrameCodec.js');
const tmp = path.join(os.tmpdir(), `staticFrameCodec-${process.pid}.mjs`);
fs.copyFileSync(codecSrc, tmp);
const C = await import(pathToFileURL(tmp).href);

const TOL = { speed: 0.0005 + 1e-9, direction: 0.005 + 1e-9, period: 0.005 + 1e-9, dir_confidence: 0.5 / 254 + 1e-4, uv: 0.0012 };
const WORLD = '-180,-80,180,85';
const latest = JSON.parse(fs.readFileSync(path.join(cdnDir, 'v1/latest.json'), 'utf8'));

const angle = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
function compare(mine, theirs) {
  const r = { nodes: 0, bad: 0, validity: 0, position: 0, maxErr: { speed: 0, direction: 0, period: 0, dir_confidence: 0, uv: 0 }, meta: [] };
  for (const k of ['served_valid_time', 'frame_offset_hours', 'frame_substituted', 'product_id', 'model_run_time', 'run_time',
    'provider', 'upstream_provider', 'source_dataset', 'is_estimated', 'is_forecast_authoritative', 'value_unit', 'coverage_scope']) {
    if (JSON.stringify(mine[k] ?? null) !== JSON.stringify(theirs[k] ?? null)) r.meta.push({ k, mine: mine[k] ?? null, grid: theirs[k] ?? null });
  }
  if (C.apiIso(Date.parse(mine.valid_time)) !== C.apiIso(Date.parse(theirs.valid_time))) r.meta.push({ k: 'valid_time', mine: mine.valid_time, grid: theirs.valid_time });
  const a = mine.grid; const b = theirs.grid;
  const sameBounds = ['west', 'south', 'east', 'north'].every((k) => Math.abs(a.bounds[k] - b.bounds[k]) < 1e-9);
  if (a.cols !== b.cols || a.rows !== b.rows || !sameBounds) {
    r.meta.push({ k: 'grid', mine: [a.cols, a.rows, a.bounds], grid: [b.cols, b.rows, b.bounds] });
    r.bad = Math.max(a.vectors.length, b.vectors.length);
    return r;
  }
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
  return r;
}

const reports = [];
const GUARD = process.env.GUARD === '1';
const FILL_WORLD = (m, l) => ['EURO', 'ICON'].includes(m) && ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l);
const guarded = [];
// SETS_RE (2026-10-27): only the set keys matching this regex (e.g. 'global_mid' for the world sets). A regional set reads as
// unbuilt here (this script cannot read regional bundles; scn_regional_client_parity.mjs is their parity) and costs ~2 min of gap
// asks for nothing, which pushed a full run past the regression driver's 40-min timeout.
const SETS_RE = process.env.SETS_RE ? new RegExp(process.env.SETS_RE) : null;
for (const [setKey, entry] of Object.entries(latest.sets)) {   // EVERY published set (one model x layer each)
  if (SETS_RE && !SETS_RE.test(setKey)) continue;
  const [MODEL, , LAYER, REGION] = setKey.split('/');
  if (!entry.index) continue;                                   // an explicit-empty / retired record: nothing to compare
  // A FILLED world set (2026-10-24, frame_set_fill.py: <model>/marine/<layer>/global_mid_filled) carries /grid's own targeted fill,
  // so it is compared, never guarded; it needs the backend in the same mode (MARINE_GULF_FILL_MID_TARGETED=1).
  if (GUARD && FILL_WORLD(MODEL, LAYER) && REGION !== 'global_mid_filled') { guarded.push(setKey); continue; }   // world asks go to /grid
  const index = JSON.parse(fs.readFileSync(path.join(cdnDir, entry.index), 'utf8'));
  index.path = index.path || entry.index;
  const rows = [];
  let worst = { bad: 0, meta: 0 };
  const maxErr = { speed: 0, direction: 0, period: 0, dir_confidence: 0, uv: 0 };
  const t0 = Date.now();
  let gapAsks = 0;
  const gapRows = [];
  for (const frame of index.frames) {
    if (!frame.path) {
      // An entry the publisher could not build. Every ask that picks it must FALL BACK (the client returns null and asks
      // /grid), and /grid must serve exactly the product this entry names. The pick must never substitute a neighbour.
      for (const offH of [0, 1, 2]) {
        const askMs = Date.parse(frame.valid_time) + offH * 3600000;
        const pick = C.pickIndexFrame(index, askMs);
        if (pick !== frame) continue;
        gapAsks++;
        const res = await fetch(`http://127.0.0.1:${port}/api/weather/grid?model=${MODEL}&domain=marine&layer=${LAYER}&valid_time=${encodeURIComponent(new Date(askMs).toISOString())}&bbox=${WORLD}`);
        const grid = await res.json();
        const ok = grid.product_id === (frame.source || {}).filename;
        if (!ok) worst.meta += 1;
        gapRows.push({ valid: frame.valid_time, ask: C.apiIso(askMs), unbuilt: frame.unbuilt, falls_back: true, grid_product: grid.product_id, ok });
      }
      continue;
    }
    const gz = fs.readFileSync(path.join(cdnDir, frame.path));
    const raw = gz[0] === 0x1f && gz[1] === 0x8b ? zlib.gunzipSync(gz) : gz;
    const vectors = C.buildVectors(C.parseFrame(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
    for (const offH of [0, 1, 2]) {
      const askMs = Date.parse(frame.valid_time) + offH * 3600000;
      const askIso = new Date(askMs).toISOString();
      const pick = C.pickIndexFrame(index, askMs);
      if (!pick || pick.path !== frame.path) continue;      // a later frame is nearer: compared on its own row
      const res = await fetch(`http://127.0.0.1:${port}/api/weather/grid?model=${MODEL}&domain=marine&layer=${LAYER}&valid_time=${encodeURIComponent(askIso)}&bbox=${WORLD}`);
      const grid = await res.json();
      const mine = C.gridJsonFromFrame(index, pick, vectors, { askIso, requestedBbox: { west: -180, south: -80, east: 180, north: 85 } });
      const r = compare(mine, grid);
      for (const k of Object.keys(maxErr)) maxErr[k] = Math.max(maxErr[k], r.maxErr[k]);
      worst.bad += r.bad; worst.meta += r.meta.length;
      rows.push({ valid: frame.valid_time, ask: C.apiIso(askMs), nodes: r.nodes, bad: r.bad, validity: r.validity, position: r.position, meta: r.meta });
    }
  }
  const report = {
    set: setKey, index: index.path, frames: index.frames.length, built: index.frames.filter((f) => f.path).length,
    unbuilt: index.frames.filter((f) => !f.path).length, gap_asks_falling_back: gapAsks, gap_rows: gapRows.slice(0, 6),
    comparisons: rows.length, nodes: rows.reduce((a, r) => a + r.nodes, 0),
    bad_nodes: worst.bad, meta_mismatches: worst.meta, max_abs_err: Object.fromEntries(Object.entries(maxErr).map(([k, v]) => [k, +v.toFixed(6)])),
    tolerance: TOL, seconds: (Date.now() - t0) / 1000, mismatched_rows: rows.filter((r) => r.bad || r.meta.length).slice(0, 10),
  };
  reports.push({ report, rows });
  console.log(JSON.stringify({ set: setKey, frames: report.frames, built: report.built, unbuilt: report.unbuilt,
    gap_asks: report.gap_asks_falling_back, comparisons: report.comparisons, nodes: report.nodes, bad: report.bad_nodes,
    meta: report.meta_mismatches, max_abs_err: report.max_abs_err, secs: report.seconds }));
}
const totals = reports.reduce((a, { report: r }) => ({ sets: a.sets + 1, nodes: a.nodes + r.nodes, bad: a.bad + r.bad_nodes,
  meta: a.meta + r.meta_mismatches, comparisons: a.comparisons + r.comparisons }), { sets: 0, nodes: 0, bad: 0, meta: 0, comparisons: 0 });
totals.guarded = guarded;
console.log(JSON.stringify({ totals }));
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ totals, sets: reports }, null, 1));
fs.unlinkSync(tmp);
process.exitCode = totals.bad || totals.meta ? 1 : 0;
