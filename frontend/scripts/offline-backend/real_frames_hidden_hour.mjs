// THE REAL-FRAME HIDDEN-HOUR TEST for the hour blend (marine and wind). Node only: no browser, no GPU.
// Gate text (registered before this file existed): docs/weather-program/log/2026-11-15-fable-crest-hour-blend.md section 34
// (R1-R3, N1, N2, P) and 2026-11-15-fable-wind-hour-blend.md section 5 (W13).
//
//   node real_frames_hidden_hour.mjs fetch --out <dir> [--sets waves,swell_1,swell_2,wind_waves,wind] [--pause 600] [--max-hour 168]
//       Reads the public frame CDN ONCE, one request at a time with a pause, into <dir>. The CDN base comes from the
//       environment variable RAW_FRAMES_BASE (the bucket's public URL); it is never printed and never written to <dir>.
//       Static files only: nothing is asked of the live backend. Frames already in <dir> are not fetched again.
//   node real_frames_hidden_hour.mjs score --dir <dir> [--json <file>]
//       Scores offline from <dir>. `--selftest` scores a synthetic folder-free case (the positive control's arithmetic).
//       `--controls-only` prints N1, N2 and P and withholds R1-R3 (used while fewer than 2 model runs are in: the result is
//       not reportable then, and is not looked at either).
//       One model run counts ONCE: the CDN's current and previous index can be two publishes of the same run (found
//       2026-11-15), so per set and run only the first index listed (the current one) is scored.
//
// It works in VALUE space on each frame's own grid and computes the mix the shaders compute: marine height in metres,
// direction as unit vectors, period; wind as u/v vectors. That the shaders DRAW that mix is the grey-view bracket's result.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mode = args[0];
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt; };
const has = (name) => args.includes(`--${name}`);

const SET_OF = { waves: 'GFS/marine/waves/global_mid', swell_1: 'GFS/marine/swell_1/global_mid', swell_2: 'GFS/marine/swell_2/global_mid',
  wind_waves: 'GFS/marine/wind_waves/global_mid', wind: 'GFS/wind/wind/global_mid' };
const FIELD = { HEIGHT: 0, DIRECTION: 1, PERIOD: 2, SPEED: 4 };
const H3 = 3 * 3600 * 1000;
const safe = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '_');
const redact = (s) => String(s).replace(/https?:\/\/[^\s'"]+/g, '<url>');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The app's own decoder (pure, no imports), loaded from a copy so Node reads it as a module.
async function loadCodec() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rfhh-'));
  const dst = path.join(tmp, 'staticFrameCodec.mjs');
  fs.copyFileSync(path.join(HERE, '../../src/components/map/staticFrameCodec.js'), dst);
  return import(pathToFileURL(dst).href);
}

const framePath = (f) => f.path || f.frame || f.key || f.file || null;
const frameMs = (f) => Date.parse(f.valid_time || f.valid_time_start || f.validTime);

// ---------------------------------------------------------------------------------------------------------------- fetch
async function doFetch() {
  const base = (process.env.RAW_FRAMES_BASE || '').replace(/\/+$/, '');
  if (!base) throw new Error('set RAW_FRAMES_BASE (the frame bucket\'s public URL) in the environment');
  const out = opt('out'); if (!out) throw new Error('--out <dir>');
  const pause = Number(opt('pause', 600)); const maxHour = Number(opt('max-hour', 168));
  const sets = opt('sets', 'waves,swell_1,swell_2,wind_waves,wind').split(',').map((s) => s.trim()).filter(Boolean);
  fs.mkdirSync(out, { recursive: true });
  let requests = 0; let bytes = 0;
  const get = async (rel, noCache) => {
    await sleep(pause); requests += 1;
    let res;
    try { res = await fetch(`${base}/${rel}`, noCache ? { cache: 'no-cache' } : undefined); } catch (e) { throw new Error(`fetch failed for ${rel}: ${redact(e && e.message)}`); }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${rel}`);
    const buf = Buffer.from(await res.arrayBuffer()); bytes += buf.length; return buf;
  };
  const latest = JSON.parse((await get('v1/latest.json', true)).toString('utf8'));
  const manifestFile = path.join(out, 'manifest.json');
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { runs: [] };
  for (const name of sets) {
    const key = SET_OF[name]; if (!key) throw new Error(`unknown set "${name}"`);
    const entry = latest.sets && latest.sets[key];
    if (!entry || !entry.index) { console.log(`${name}: not listed in latest.json, skipped`); continue; }
    // the current index and, when latest.json names one, the previous (the CDN keeps both)
    const indexPaths = [entry.index, entry.previous_index || entry.previous || entry.prev_index].filter((p) => typeof p === 'string');
    for (const indexRel of indexPaths) {
      const indexFile = path.join(out, safe(indexRel));
      if (!fs.existsSync(indexFile)) fs.writeFileSync(indexFile, await get(indexRel));
      const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      const frames = (index.frames || []).filter((f) => !f.is_estimated && Number.isFinite(frameMs(f)));
      if (!frames.length) { console.log(`${name}: index has no usable frames; first frame keys: ${Object.keys((index.frames || [])[0] || {}).join(',')}`); continue; }
      if (!framePath(frames[0])) { console.log(`${name}: no path field on a frame; keys: ${Object.keys(frames[0]).join(',')}`); continue; }
      const t0 = Math.min(...frames.map(frameMs));
      const run = { set: name, key, index: safe(indexRel), run: index.run || index.run_time || entry.run || null, t0: new Date(t0).toISOString(), frames: [] };
      for (const f of frames) {
        const hour = Math.round((frameMs(f) - t0) / 3600000);
        if (hour > maxHour || hour % 3 !== 0) continue;
        const rel = framePath(f); const file = safe(`${name}__${run.index}__f${String(hour).padStart(3, '0')}.bin`);
        const dst = path.join(out, file);
        if (!fs.existsSync(dst)) {
          const raw = await get(rel.startsWith('v1/') || !index.base ? rel : `${String(index.base).replace(/\/+$/, '')}/${rel}`);
          fs.writeFileSync(dst, raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw);
        }
        run.frames.push({ hour, file, valid: new Date(frameMs(f)).toISOString() });
      }
      manifest.runs = manifest.runs.filter((r) => !(r.set === name && r.index === run.index)); manifest.runs.push(run);
      fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
      console.log(`${name}: run ${run.run || run.t0}, ${run.frames.length} frames (3-hourly to f${maxHour})`);
    }
  }
  console.log(`done: ${requests} requests, ${(bytes / 1e6).toFixed(1)} MB, pause ${pause} ms`);
}

// ---------------------------------------------------------------------------------------------------------------- score
const D2R = Math.PI / 180;
/** A decoded frame as the value planes the blend mixes. Marine: h (m), dx, dy (unit direction), p (s). Wind: u, v (frame units). */
function planes(parsed, kind) {
  const n = parsed.cols * parsed.rows; const D = parsed.fields[FIELD.DIRECTION];
  if (kind === 'wind') {
    const S = parsed.fields[FIELD.SPEED]; if (!S || !D) throw new Error('not a wind frame');
    const u = new Float64Array(n); const v = new Float64Array(n);
    for (let i = 0; i < n; i++) { if (Number.isNaN(S[i]) || Number.isNaN(D[i])) { u[i] = NaN; v[i] = NaN; } else { u[i] = S[i] * Math.sin(D[i] * D2R); v[i] = S[i] * Math.cos(D[i] * D2R); } }
    return { cols: parsed.cols, rows: parsed.rows, bounds: parsed.bounds, u, v };
  }
  const H = parsed.fields[FIELD.HEIGHT]; const P = parsed.fields[FIELD.PERIOD]; if (!H) throw new Error('not a marine frame');
  const dx = new Float64Array(n); const dy = new Float64Array(n);
  for (let i = 0; i < n; i++) { const d = D ? D[i] : NaN; dx[i] = Number.isNaN(d) ? NaN : Math.sin(d * D2R); dy[i] = Number.isNaN(d) ? NaN : Math.cos(d * D2R); }
  return { cols: parsed.cols, rows: parsed.rows, bounds: parsed.bounds, h: H, dx, dy, p: P || null };
}
const mean = (sum, n) => (n ? sum / n : NaN);

/** Marine: the blend of a and b against truth m, and each end hour against m. All means over nodes valid in all three. */
export function scoreMarine(a, b, m) {
  const { cols, rows } = m; const n = cols * rows;
  if (a.cols !== cols || b.cols !== cols || a.rows !== rows || b.rows !== rows) return null;
  let k = 0; let eB = 0; let eA = 0; let eZ = 0;
  const move = [];
  for (let i = 0; i < n; i++) {
    const ha = a.h[i]; const hb = b.h[i]; const hm = m.h[i];
    if (Number.isNaN(ha) || Number.isNaN(hb) || Number.isNaN(hm)) continue;
    k += 1; eB += Math.abs(0.5 * (ha + hb) - hm); eA += Math.abs(ha - hm); eZ += Math.abs(hb - hm);
    move.push([Math.abs(hb - ha), Math.abs(0.5 * (ha + hb) - hm), Math.abs(ha - hm), Math.abs(hb - hm)]);
  }
  // the tenth of nodes where the sea moves most between the two end hours
  move.sort((x, y) => y[0] - x[0]); const top = move.slice(0, Math.max(1, Math.floor(move.length / 10)));
  const tB = top.reduce((s, r) => s + r[1], 0) / top.length; const tC = Math.min(top.reduce((s, r) => s + r[2], 0), top.reduce((s, r) => s + r[3], 0)) / top.length;
  // R2: the L1 error of the height gradient (central differences, both axes; a node counts when it and its four neighbours are valid in all three)
  let g = 0; let gB = 0; let gA = 0; let gZ = 0;
  const ok = (i) => !(Number.isNaN(a.h[i]) || Number.isNaN(b.h[i]) || Number.isNaN(m.h[i]));
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c; const E = i + 1; const Wn = i - 1; const N = i + cols; const S = i - cols;
      if (!(ok(i) && ok(E) && ok(Wn) && ok(N) && ok(S))) continue;
      const gx = (f) => 0.5 * (f[E] - f[Wn]); const gy = (f) => 0.5 * (f[N] - f[S]);
      const mx = gx(m.h); const my = gy(m.h); const ax = gx(a.h); const ay = gy(a.h); const bx = gx(b.h); const by = gy(b.h);
      g += 1;
      gB += Math.abs(0.5 * (ax + bx) - mx) + Math.abs(0.5 * (ay + by) - my);
      gA += Math.abs(ax - mx) + Math.abs(ay - my); gZ += Math.abs(bx - mx) + Math.abs(by - my);
    }
  }
  // R3: direction (degrees, on nodes above 0.25 m in the truth) and period (seconds)
  let dk = 0; let dB = 0; let dA = 0; let dZ = 0; let pk = 0; let pB = 0; let pA = 0; let pZ = 0;
  const ang = (x1, y1, x2, y2) => Math.acos(Math.max(-1, Math.min(1, x1 * x2 + y1 * y2))) / D2R;
  for (let i = 0; i < n; i++) {
    if (!ok(i)) continue;
    if (m.h[i] > 0.25 && ![a.dx[i], b.dx[i], m.dx[i]].some(Number.isNaN)) {
      let x = 0.5 * (a.dx[i] + b.dx[i]); let y = 0.5 * (a.dy[i] + b.dy[i]); const len = Math.hypot(x, y);
      if (len > 1e-9) { x /= len; y /= len; dk += 1; dB += ang(x, y, m.dx[i], m.dy[i]); dA += ang(a.dx[i], a.dy[i], m.dx[i], m.dy[i]); dZ += ang(b.dx[i], b.dy[i], m.dx[i], m.dy[i]); }
    }
    if (a.p && b.p && m.p && ![a.p[i], b.p[i], m.p[i]].some(Number.isNaN)) { pk += 1; pB += Math.abs(0.5 * (a.p[i] + b.p[i]) - m.p[i]); pA += Math.abs(a.p[i] - m.p[i]); pZ += Math.abs(b.p[i] - m.p[i]); }
  }
  return { nodes: k, blend: mean(eB, k), endA: mean(eA, k), endB: mean(eZ, k), cut: Math.min(mean(eA, k), mean(eZ, k)),
    moving: { blend: tB, cut: tC },
    grad: { nodes: g, blend: mean(gB, g), endA: mean(gA, g), endB: mean(gZ, g), cut: Math.min(mean(gA, g), mean(gZ, g)) },
    dir: { nodes: dk, blend: mean(dB, dk), cut: Math.min(mean(dA, dk), mean(dZ, dk)) },
    period: { nodes: pk, blend: mean(pB, pk), cut: Math.min(mean(pA, pk), mean(pZ, pk)) } };
}

/** Wind: the mean vector difference (frame units) of the half-way u/v mix against the real middle, and speed kept through the mix. */
export function scoreWind(a, b, m) {
  const { cols, rows } = m; const n = cols * rows;
  if (a.cols !== cols || b.cols !== cols || a.rows !== rows || b.rows !== rows) return null;
  let k = 0; let eB = 0; let eA = 0; let eZ = 0; let sMix = 0; let sEnds = 0; let lost = 0;
  for (let i = 0; i < n; i++) {
    if ([a.u[i], b.u[i], m.u[i]].some(Number.isNaN)) continue;
    const mu = 0.5 * (a.u[i] + b.u[i]); const mv = 0.5 * (a.v[i] + b.v[i]);
    k += 1; eB += Math.hypot(mu - m.u[i], mv - m.v[i]); eA += Math.hypot(a.u[i] - m.u[i], a.v[i] - m.v[i]); eZ += Math.hypot(b.u[i] - m.u[i], b.v[i] - m.v[i]);
    const ends = 0.5 * (Math.hypot(a.u[i], a.v[i]) + Math.hypot(b.u[i], b.v[i])); const mixSpeed = Math.hypot(mu, mv);
    sMix += mixSpeed; sEnds += ends; if (mixSpeed < 0.5 * ends) lost += 1;
  }
  return { nodes: k, blend: mean(eB, k), endA: mean(eA, k), endB: mean(eZ, k), cut: Math.min(mean(eA, k), mean(eZ, k)), retention: sEnds ? sMix / sEnds : NaN, lostHalf: lost };
}

// THE ADVECTION ARM (log section 37). `hours` > 0 carries the frame FORWARD in time, < 0 BACKWARD, 0 leaves it as it is.
// Semi-Lagrangian, first order: each node reads (bilinear, wrapping in longitude) from where its own motion came from; a read
// that touches a missing node keeps the node's own value. Waves move toward (direction + 180) at c_g = 0.78 T m/s; wind along
// its own vector (knots). The planes hold the FROM unit vector (dx, dy) and the FROM wind vector (u, v), so motion = minus those.
export function advect(pl, kind, hours) {
  if (!hours) return pl;
  const { cols, rows, bounds } = pl; const n = cols * rows;
  const dLat = (bounds.north - bounds.south) / (rows - 1); const dLng = (bounds.east - bounds.west) / (cols - 1);
  const wraps = Math.abs((bounds.east - bounds.west) - 360) < 1e-6; const period = cols - 1;
  const names = kind === 'wind' ? ['u', 'v'] : ['h', 'dx', 'dy', 'p'].filter((k) => pl[k]);
  const out = { cols, rows, bounds }; for (const k of names) out[k] = new Float64Array(pl[k]); if (kind !== 'wind' && !pl.p) out.p = null;
  const secs = hours * 3600;
  for (let r = 0; r < rows; r++) {
    const lat = bounds.south + r * dLat; if (Math.abs(lat) > 80) continue;
    const mPerLng = 111320 * Math.cos(lat * Math.PI / 180);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c; let vx; let vy;   // motion in m/s, east and north
      if (kind === 'wind') { if (Number.isNaN(pl.u[i])) continue; vx = -pl.u[i] * 0.5144; vy = -pl.v[i] * 0.5144; }
      else { if (!pl.p || Number.isNaN(pl.p[i]) || Number.isNaN(pl.dx[i]) || Number.isNaN(pl.h[i])) continue; const cg = 0.78 * pl.p[i]; vx = -pl.dx[i] * cg; vy = -pl.dy[i] * cg; }
      let fc = c - (vx * secs / mPerLng) / dLng; const fr = r - (vy * secs / 111320) / dLat;
      if (fr < 0 || fr > rows - 1) continue;
      if (wraps) fc = ((fc % period) + period) % period; else if (fc < 0 || fc > cols - 1) continue;
      const c0 = Math.floor(fc); const r0 = Math.floor(fr); const c1 = Math.min(cols - 1, c0 + 1); const r1 = Math.min(rows - 1, r0 + 1); const tx = fc - c0; const ty = fr - r0;
      const i00 = r0 * cols + c0; const i01 = r0 * cols + c1; const i10 = r1 * cols + c0; const i11 = r1 * cols + c1;
      let ok = true; for (const k of names) { if (Number.isNaN(pl[k][i00]) || Number.isNaN(pl[k][i01]) || Number.isNaN(pl[k][i10]) || Number.isNaN(pl[k][i11])) { ok = false; break; } }
      if (!ok) continue;
      for (const k of names) { const a = pl[k]; out[k][i] = (a[i00] * (1 - tx) + a[i01] * tx) * (1 - ty) + (a[i10] * (1 - tx) + a[i11] * tx) * ty; }
    }
  }
  return out;
}

/** A2: ghost nodes of a mix of x and y, and of each END hour a and b, against truth m: off by more than 0.3 m (height) or 3 kn (vector). */
export function ghostCounts(x, y, a, b, m, kind) {
  const n = m.cols * m.rows; let k = 0; let mix = 0; let endA = 0; let endB = 0;
  for (let i = 0; i < n; i++) {
    if (kind === 'wind') {
      if ([a.u[i], b.u[i], m.u[i]].some(Number.isNaN)) continue; k += 1;
      if (Math.hypot(0.5 * (x.u[i] + y.u[i]) - m.u[i], 0.5 * (x.v[i] + y.v[i]) - m.v[i]) > 3) mix += 1;
      if (Math.hypot(a.u[i] - m.u[i], a.v[i] - m.v[i]) > 3) endA += 1; if (Math.hypot(b.u[i] - m.u[i], b.v[i] - m.v[i]) > 3) endB += 1;
    } else {
      if ([a.h[i], b.h[i], m.h[i]].some(Number.isNaN)) continue; k += 1;
      if (Math.abs(0.5 * (x.h[i] + y.h[i]) - m.h[i]) > 0.3) mix += 1;
      if (Math.abs(a.h[i] - m.h[i]) > 0.3) endA += 1; if (Math.abs(b.h[i] - m.h[i]) > 0.3) endB += 1;
    }
  }
  return { nodes: k, mix, cut: Math.min(endA, endB) };
}

const pct = (x, y) => (y > 0 ? `${(100 * x / y).toFixed(1)}%` : 'n/a');
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : 'n/a');

async function doScore() {
  const dir = opt('dir'); if (!dir) throw new Error('--dir <dir>');
  const codec = await loadCodec();
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const cache = new Map();
  const load = (run, hour, kind) => {
    const f = run.frames.find((x) => x.hour === hour); if (!f) return null;
    if (!cache.has(f.file)) cache.set(f.file, planes(codec.parseFrame(fs.readFileSync(path.join(dir, f.file))), kind));
    return cache.get(f.file);
  };
  const report = { sets: {}, runs: manifest.runs.map((r) => ({ set: r.set, run: r.run, t0: r.t0, frames: r.frames.length })) };
  for (const name of [...new Set(manifest.runs.map((r) => r.set))]) {
    const kind = name === 'wind' ? 'wind' : 'marine'; const score = kind === 'wind' ? scoreWind : scoreMarine;
    const rows = []; const skipped = [];
    const seenRun = new Set();
    for (const run of manifest.runs.filter((r) => r.set === name)) {
      const runKey = String(run.run || run.t0); if (seenRun.has(runKey)) { skipped.push(`${runKey} (a second publish of the same run: not scored)`); continue; } seenRun.add(runKey);
      for (let h = 0; h <= 114; h += 6) {
        const a = load(run, h, kind); const m = load(run, h + 3, kind); const b = load(run, h + 6, kind);
        if (!a || !m || !b) { skipped.push(`${run.run || run.t0} f${h}`); continue; }
        const real = score(a, b, m); if (!real) { skipped.push(`${run.run || run.t0} f${h} (grid differs)`); continue; }
        const row = { run: run.run || run.t0, h, real };
        const wrongTruth = load(run, h + 3 + 48, kind); if (wrongTruth) row.n1 = score(a, b, wrongTruth);          // N1: a wrong truth
        const wrongEnd = load(run, h + 54, kind); if (wrongEnd) row.n2 = score(a, wrongEnd, m);                    // N2: a wrong blend
        row.p = score(a, a, a);                                                                                    // P: identical neighbours
        // the advection arm: h carried forward 3 h, h+6 backward 3 h, then mixed (log section 37)
        const aF = advect(a, kind, 3); const bB = advect(b, kind, -3);
        row.adv = score(aF, bB, m); row.gBlend = ghostCounts(a, b, a, b, m, kind); row.gAdv = ghostCounts(aF, bB, a, b, m, kind);
        if (wrongTruth) row.n1a = score(aF, bB, wrongTruth);
        if (wrongEnd) row.n2a = score(aF, advect(wrongEnd, kind, -3), m);
        row.pa = score(advect(a, kind, 0), advect(a, kind, 0), a);          // P for the arm: identical neighbours, no motion
        row.still = score(aF, advect(a, kind, -3), a).blend;                // the arm's cost on a field that did not move (printed, not a control)
        rows.push(row);
      }
    }
    const pool = (get) => { let s = 0; let k = 0; for (const r of rows) { const v = get(r); if (Number.isFinite(v)) { s += v; k += 1; } } return k ? s / k : NaN; };
    const runsSeen = new Set(rows.map((r) => r.run)).size;
    const blend = pool((r) => r.real.blend); const cut = pool((r) => r.real.cut);
    const wins = rows.filter((r) => r.real.blend <= r.real.cut).length;
    const r1 = rows.length > 0 && blend <= cut && wins >= 0.8 * rows.length;
    const n1rows = rows.filter((r) => r.n1); const n1ok = n1rows.filter((r) => r.n1.blend >= 2 * r.real.blend).length;
    const n1 = n1rows.length > 0 && n1ok >= 0.9 * n1rows.length;
    const n2rows = rows.filter((r) => r.n2); const n2blend = pool((r) => (r.n2 ? r.n2.blend : NaN)); const n2cut = pool((r) => (r.n2 ? r.n2.cut : NaN));
    const n2 = n2rows.length > 0 && n2blend > n2cut;   // the wrong blend must FAIL R1's pooled line
    const pZero = rows.every((r) => r.p.blend === 0 && r.p.cut === 0 && (kind === 'wind' || (r.p.grad.blend === 0 && r.p.grad.cut === 0)));
    const out = { kind, triples: rows.length, runs: runsSeen, skipped, R1: { blend, cut, ratio: blend / cut, endA: pool((r) => r.real.endA), endB: pool((r) => r.real.endB), wins, pass: r1 },
      N1: { triples: n1rows.length, held: n1ok, pass: n1 }, N2: { triples: n2rows.length, blend: n2blend, cut: n2cut, failsAsItMust: n2 }, P: { exactZero: pZero } };
    if (kind === 'marine') {
      const gb = pool((r) => r.real.grad.blend); const gc = pool((r) => r.real.grad.cut);
      out.R2 = { blend: gb, cut: gc, ratio: gb / gc, pass: gb <= gc };
      const db = pool((r) => r.real.dir.blend); const dc = pool((r) => r.real.dir.cut); const pb = pool((r) => r.real.period.blend); const pc = pool((r) => r.real.period.cut);
      out.R3 = { dirBlend: db, dirCut: dc, periodBlend: pb, periodCut: pc, pass: !(db > dc) && !(pb > pc) };
      out.moving = { blend: pool((r) => r.real.moving.blend), cut: pool((r) => r.real.moving.cut) };
    } else {
      out.retention = pool((r) => r.real.retention); out.lostHalfNodes = rows.reduce((s, r) => s + r.real.lostHalf, 0);
    }
    // ---- the advection arm's lines (A1-A3) and its controls
    const adv = pool((r) => r.adv.blend); const advVsBlend = rows.filter((r) => r.adv.blend < r.real.blend).length; const advVsCut = rows.filter((r) => r.adv.blend <= r.real.cut).length;
    const sum = (get) => rows.reduce((t, r) => t + get(r), 0);
    const G = { nodes: sum((r) => r.gBlend.nodes), blend: sum((r) => r.gBlend.mix), adv: sum((r) => r.gAdv.mix), cut: sum((r) => r.gBlend.cut) };
    const gSignal = Math.max(G.blend, G.adv, G.cut) >= 0.01 * G.nodes;
    const n1aRows = rows.filter((r) => r.n1a); const n1aOk = n1aRows.filter((r) => r.n1a.blend >= 2 * r.adv.blend).length; const n1a = n1aRows.length > 0 && n1aOk >= 0.9 * n1aRows.length;
    const n2aBlend = pool((r) => (r.n2a ? r.n2a.blend : NaN)); const n2a = rows.some((r) => r.n2a) && n2aBlend > n2cut;
    const paZero = rows.every((r) => r.pa.blend === 0 && r.pa.cut === 0);
    out.A = { controls: { n1: n1a, n1held: n1aOk, n1triples: n1aRows.length, n2failsAsItMust: n2a, pZero: paZero }, stillFieldCost: pool((r) => r.still),
      A1: { adv, ofBlend: adv / blend, ofCut: adv / cut, smallerThanBlendIn: advVsBlend, notWorseThanCutIn: advVsCut,
        vsCrossFade: adv <= 0.95 * blend && advVsBlend >= 0.7 * rows.length ? 'BETTER' : adv > 1.05 * blend ? 'WORSE' : (adv >= 0.95 * blend ? 'NO DIFFERENCE' : 'smaller pooled, but not in 70% of triples: NO DIFFERENCE'),
        ownerLine: adv <= cut && advVsCut >= 0.8 * rows.length },
      A2: { ...G, signal: gSignal, pass: gSignal ? (G.adv <= G.blend && G.adv <= G.cut && G.blend <= G.cut) : null } };
    if (kind === 'marine') { const ga = pool((r) => r.adv.grad.blend); out.A.A3 = { adv: ga, cut: pool((r) => r.real.grad.cut), pass: ga <= pool((r) => r.real.grad.cut) }; }
    const void1 = !n1 || !n2 || !pZero;
    out.verdict = runsSeen < 2 ? 'NOT REPORTABLE (fewer than 2 runs)' : void1 ? 'VOID (a control did not hold)' : (out.R1.pass && (kind === 'wind' || out.R2.pass) ? 'PASS' : 'FAIL');
    report.sets[name] = out;
    const unit = kind === 'wind' ? 'frame speed units' : 'm';
    console.log(`\n== ${name} (${kind}): ${rows.length} triples over ${runsSeen} run(s), ${skipped.length} skipped`);
    if (has('controls-only')) {
      console.log(`N1 wrong truth: blend error at least doubled in ${n1ok} of ${n1rows.length}  -> ${n1 ? 'holds' : 'DOES NOT HOLD'}`);
      console.log(`N2 wrong blend: ${n2 ? 'fails R1, as it must' : 'PASSES R1: THE TEST CANNOT FAIL'} (over ${n2rows.length})`);
      console.log(`P identical neighbours: ${pZero ? 'exactly zero' : 'NOT ZERO'}`);
      console.log(`advection arm: N1 held in ${n1aOk} of ${n1aRows.length} -> ${n1a ? 'holds' : 'DOES NOT HOLD'}; N2 ${n2a ? 'fails, as it must' : 'PASSES: CANNOT FAIL'}; P (no motion) ${paZero ? 'exactly zero' : 'NOT ZERO'}`);
      console.log('R1-R3 and A1-A3 withheld (--controls-only)');
      continue;
    }
    console.log(`R1 truth: blend ${f3(blend)} ${unit}, cut ${f3(cut)} (h alone ${f3(out.R1.endA)}, h+6 alone ${f3(out.R1.endB)}) = ${pct(blend, cut)} of the cut; blend <= cut in ${wins} of ${rows.length}  -> ${r1 ? 'pass' : 'FAIL'}`);
    if (kind === 'marine') {
      console.log(`   where the sea moves most (top tenth of nodes): blend ${f3(out.moving.blend)}, cut ${f3(out.moving.cut)} = ${pct(out.moving.blend, out.moving.cut)}`);
      console.log(`R2 ghosting (gradient L1): blend ${f3(out.R2.blend)}, cut ${f3(out.R2.cut)} = ${pct(out.R2.blend, out.R2.cut)}  -> ${out.R2.pass ? 'pass' : 'FAIL'}`);
      console.log(`R3 direction ${f3(out.R3.dirBlend)} deg vs ${f3(out.R3.dirCut)}; period ${f3(out.R3.periodBlend)} s vs ${f3(out.R3.periodCut)}  -> ${out.R3.pass ? 'pass' : 'FAIL'}`);
    } else {
      console.log(`   speed kept through the mix ${f3(out.retention)}; nodes losing more than half: ${out.lostHalfNodes}`);
    }
    console.log(`N1 wrong truth: blend error at least doubled in ${n1ok} of ${n1rows.length}  -> ${n1 ? 'holds' : 'DOES NOT HOLD'}`);
    console.log(`N2 wrong blend: ${f3(n2blend)} vs cut ${f3(n2cut)} over ${n2rows.length}  -> ${n2 ? 'fails R1, as it must' : 'PASSES R1: THE TEST CANNOT FAIL'}`);
    console.log(`P identical neighbours: ${pZero ? 'exactly zero' : 'NOT ZERO'}`);
    const unitA = kind === 'wind' ? 'kn' : 'm';
    console.log(`A1 advection: ${f3(adv)} ${unitA} = ${pct(adv, blend)} of the cross-fade, ${pct(adv, cut)} of the cut; smaller than the cross-fade in ${advVsBlend} of ${rows.length}, not worse than the cut in ${advVsCut}  -> vs cross-fade: ${out.A.A1.vsCrossFade}; owner's line: ${out.A.A1.ownerLine ? 'pass' : 'FAIL'}`);
    console.log(`A2 ghost nodes of ${G.nodes}: advection ${G.adv}, cross-fade ${G.blend}, hard swap ${G.cut}  -> ${out.A.A2.pass == null ? 'VOID (under 1% for every arm)' : out.A.A2.pass ? 'pass' : 'FAIL'}`);
    if (out.A.A3) console.log(`A3 gradient error: advection ${f3(out.A.A3.adv)} vs cut ${f3(out.A.A3.cut)}  -> ${out.A.A3.pass ? 'pass' : 'FAIL'}`);
    console.log(`   advection controls: N1 ${n1aOk} of ${n1aRows.length} ${n1a ? 'holds' : 'DOES NOT HOLD'}; N2 ${n2a ? 'fails, as it must' : 'PASSES: CANNOT FAIL'}; P ${paZero ? 'zero' : 'NOT ZERO'}; cost on a still field ${f3(out.A.stillFieldCost)} ${unitA}`);
    console.log(`VERDICT ${name}: ${out.verdict}`);
  }
  const jsonOut = opt('json'); if (jsonOut && !has('controls-only')) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1));
}

// A check of the scorer's own arithmetic with no data: a field that moves linearly in time is recovered exactly by the mix.
function selftest() {
  const cols = 12; const rows = 8; const n = cols * rows;
  const mk = (t) => { const h = new Float64Array(n); const dx = new Float64Array(n); const dy = new Float64Array(n); const p = new Float64Array(n);
    for (let i = 0; i < n; i++) { h[i] = 1 + 0.1 * (i % cols) + 0.2 * t; dx[i] = 0; dy[i] = 1; p[i] = 10 + t; } return { cols, rows, h, dx, dy, p }; };
  const s = scoreMarine(mk(0), mk(2), mk(1));
  const zero = scoreMarine(mk(0), mk(0), mk(0));
  const w = (t) => { const u = new Float64Array(n).fill(3 + t); const v = new Float64Array(n).fill(-1); return { cols, rows, u, v }; };
  const sw = scoreWind(w(0), w(2), w(1));
  const ok = Math.abs(s.blend) < 1e-12 && Math.abs(s.cut - 0.2) < 1e-12 && s.grad.blend < 1e-12 && zero.blend === 0 && zero.cut === 0 && Math.abs(sw.blend) < 1e-12 && Math.abs(sw.cut - 1) < 1e-12
    && Math.abs(sw.retention - Math.hypot(4, 1) / (0.5 * (Math.hypot(3, 1) + Math.hypot(5, 1)))) < 1e-12;   // 0.998: a mix of two speeds of one direction keeps almost all
  const id = advect(mk(0), 'marine', 0) === undefined ? false : advect(w(1), 'wind', 0).u[5] === w(1).u[5];
  // a uniform wind field carried along itself is unchanged (nothing to move), and a still sea (no period) does not move
  const b0 = { west: -180, south: -40, east: 180, north: 40 };
  const uni = { cols: 181, rows: 41, bounds: b0, u: new Float64Array(181 * 41).fill(10), v: new Float64Array(181 * 41).fill(0) };
  const carried = advect(uni, 'wind', 3); const sameUni = carried.u.every((x) => Math.abs(x - 10) < 1e-12);
  // a ramp in longitude under a uniform wind FROM the west (u = +10 in the planes' FROM convention means motion toward -x)
  const ramp = { cols: 181, rows: 41, bounds: b0, u: new Float64Array(181 * 41), v: new Float64Array(181 * 41).fill(0) };
  for (let i = 0; i < ramp.u.length; i++) ramp.u[i] = 10 + 0.01 * (i % 181);
  const moved = advect(ramp, 'wind', 3); const mid = 20 * 181 + 90; const shifted = moved.u[mid] > ramp.u[mid];   // motion toward -x: the value arrives from +x, where the ramp is larger
  if (!(id && sameUni && shifted)) { console.log(`selftest FAILED (advect) ${JSON.stringify({ id, sameUni, shifted })}`); process.exitCode = 1; return; }
  console.log(ok ? 'selftest ok' : `selftest FAILED ${JSON.stringify({ s, zero, sw })}`);
  process.exitCode = ok ? 0 : 1;
}

if (has('selftest')) selftest();
else if (mode === 'fetch') doFetch().catch((e) => { console.error(redact(e && e.message)); process.exitCode = 1; });
else if (mode === 'score') doScore().catch((e) => { console.error(redact(e && e.message)); process.exitCode = 1; });
else { console.log('usage: real_frames_hidden_hour.mjs fetch --out <dir> | score --dir <dir> [--json <file>] | --selftest'); process.exitCode = 2; }
