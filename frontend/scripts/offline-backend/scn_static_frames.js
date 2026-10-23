// Static frames vs the backend, scrubbed the same way (step 2b, 2026-10-20). Offline only.
//
// Two arms from ONE production build, interleaved A B B A per round (ROUNDS rounds, default 3), each in a fresh browser:
//   grid    window.__RAW_DISABLE_STATIC_FRAMES__ = true (the kill switch: /grid_series pages + per-hour /grid from the real
//           backend app, today's path before 2026-10-21)
//   static  the app's DEFAULT (static frames ON since 2026-10-21; no opt-in is set), with window.__RAW_STATIC_FRAMES_BASE__
//           -> a local static host standing in for the Supabase CDN (it serves the publisher's --out-dir as is: gzipped
//           frames, no Content-Encoding header, so the app's own worker inflates them)
// Per scrub step (world view, GFS Waves): time from the key press to the EXACT-CORRECT frame on the GPU = the engine's
// resident grid is the stored product /grid serves for that time (its product_id, asked of the backend BEFORE the timed
// window), GFS, waves, at full resolution (no decimated_stride; 181 x 83 here). 0 ms when the resident frame already is
// that product (a 1-hour step between 3-hourly products). Also the time until the resident grid's hour LABEL equals the
// requested hour (any resolution), the backend requests made, the backend process's CPU seconds over the scrub (read
// from the OS), and the static host's bytes.
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS --port 4100
//   python backend/scripts/publish_frame_images.py --store-dir <store> --out-dir <cdn> --only frames
//   node frontend/scripts/offline-backend/serve_spa.js frontend/build 3100
//   CDN_DIR=<cdn> PORT=4100 OUT=static.json node frontend/scripts/offline-backend/scn_static_frames.js
// Env: ROUNDS (3), WIN (ms per step, 8000), LAT_SERIES / LAT_GRID (ms added per backend response), CDN_LAT (ms added per
// static object), CDN_PORT (4190), ARMS (default grid,static), MODEL / LAYER (default GFS / waves: which world set to
// scrub, 2026-10-22). The GPU-resident frames arms (2026-10-21):
//   static  as above (static frames on, the default), with the frame store KILLED (window.__RAW_DISABLE_FRAME_STORE__ = true)
//   store   static frames on and the frame store on (the default once static frames are on): prefetch + the layer copy, and
//           (2026-10-22) the adaptive idle fill: the rest of the run in idle time once the first frames have landed
//   intent  as store with the idle fill KILLED (window.__RAW_DISABLE_FRAME_IDLE_FILL__ = true): the intent-gated policy alone
//   eager   as store, plus window.__RAW_FRAME_PREFETCH_EAGER__ = true (the whole series from the first draw; an egress lever)
// Per open (2026-10-22): the static frame bytes in the first 6 s after the first draw (a glance), the time from the first draw
// until the whole run is in the store (store / eager arms; FILL_WAIT ms at most, default 45000; the steps start after it),
// and the frame bytes before the steps.
// The probe names the resident product from the engine grid itself when the frame store put it there (__fromFrameStore),
// because a store show writes no texture upload record (it is a GPU-side layer copy).
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execSync } = require('child_process');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_static_frames is offline only');
const PORT = +(process.env.PORT || 4100);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4190);
const ROUNDS = +(process.env.ROUNDS || 3);
const WIN = +(process.env.WIN || 8000);
const LAT_SERIES = +(process.env.LAT_SERIES || 0); const LAT_GRID = +(process.env.LAT_GRID || 0); const CDN_LAT = +(process.env.CDN_LAT || 0);
const FILL_WAIT = +(process.env.FILL_WAIT || 45000);
// Which world set to scrub (2026-10-22: every STATIC_SETS entry; serve the store with the matching --models / --layers).
const MODEL = (process.env.MODEL || 'GFS').toUpperCase();
const LAYER = process.env.LAYER || 'waves';
const LABEL = { waves: 'Waves', swell_1: 'Swell', swell_2: 'Swell 2', wind_waves: 'Wind Waves' };
if (!CDN_DIR) throw Error('CDN_DIR=<publisher --out-dir> is required');
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// [key, requested hour after it]: 1-h steps (two between stored frames), day steps, a 5-day burst, back, Home.
const STEPS = [['ArrowRight', 1], ['ArrowRight', 2], ['ArrowRight', 3], ['ArrowRight', 4], ['PageUp', 28], ['PageUp', 52],
  ['BURST', 172], ['PageDown', 148], ['ArrowLeft', 147], ['Home', 0]];

// The local "CDN": the publisher's objects, byte for byte, with the bucket's headers (immutable, no Content-Encoding).
const cdnLog = { requests: 0, bytes: 0, byKind: {} };
const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  const send = () => {
    if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' });
      return res.end('{"statusCode":"404","error":"not_found"}');
    }
    const body = fs.readFileSync(file);
    const kind = rel.endsWith('.bin') ? 'frame' : rel.endsWith('latest.json') ? 'latest' : 'index';
    cdnLog.requests += 1; cdnLog.bytes += body.length;
    cdnLog.byKind[kind] = cdnLog.byKind[kind] || { n: 0, bytes: 0 };
    cdnLog.byKind[kind].n += 1; cdnLog.byKind[kind].bytes += body.length;
    res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length,
      'content-type': kind === 'frame' ? 'application/octet-stream' : 'application/json',
      'cache-control': kind === 'latest' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(body);
  };
  CDN_LAT ? setTimeout(send, CDN_LAT) : send();
});

// Backend CPU seconds: the serve_synthetic.py process listening on PORT (Windows: CIM; elsewhere: ps).
function backendCpuS() {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='python.exe'\\" | Where-Object { $_.CommandLine -like '*--port ${PORT}*' } | ForEach-Object { (Get-Process -Id $_.ProcessId).CPU } | Measure-Object -Sum).Sum"`).toString().trim();
      return parseFloat(out);
    }
    const pid = execSync(`pgrep -f -- '--port ${PORT}'`).toString().trim().split('\n')[0];
    const [m, s] = execSync(`ps -o cputime= -p ${pid}`).toString().trim().split(':').slice(-2).map(Number);
    return m * 60 + s;
  } catch (e) { return NaN; }
}

const PROBE = ({ model, layer }) => {
  const P = (window.__SF__ = { w: null });
  window.addEventListener('keydown', (e) => { if (P.w) P.w.tLast = e.timeStamp; }, true);
  P.snap = () => {
    const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = d && d.waveGrid;
    const up = d && d.u_waveTexture && window.__TEX__ && window.__TEX__.uploads.get(d.u_waveTexture);
    return { hour: g ? g.hourOffset : null, layer: g ? g.__componentLayer : null, model: g ? g.__sourceModel : null,
      cols: g ? g.cols : null, stride: g ? (g.__decimatedStride || 0) : null, series: !!(g && g.__fromSeries),
      // The stored product of the LAST wave upload (WebGLMarineLayer's own record): series-committed grids reach the
      // engine without __servedProductId, so the engine grid alone cannot name its product.
      pid: (g && g.__fromFrameStore && g.__servedProductId) || (window.__WEBGL_MARINE_UPLOAD_DIAG__ && window.__WEBGL_MARINE_UPLOAD_DIAG__.servedProductId) || (g ? (g.__servedProductId || g.productId || null) : null),
      seq: up ? up.seq : -1 };
  };
  // The resident product's valid time: from its stored product id when the grid names one (the per-hour path), else,
  // for a series frame, anchor + its hour (series pages ask the cadence-aligned product times, so frame hour h IS the
  // product at anchor + h; series grids reach the engine without their stored id).
  const stampMs = (pid) => { const m = /_(\d{8}T\d{6}Z)\.json$/.exec(pid || ''); return m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : null; };
  const productMs = (s, W) => (s.pid ? stampMs(s.pid) : (s.series && s.hour != null ? W.anchor + s.hour * 3600000 : null));
  const exactNow = (s, W) => productMs(s, W) === W.expectedMs && s.layer === layer && s.model === model && s.stride === 0 && s.cols >= 150;
  const loop = (t) => {
    const W = P.w;
    if (W && !W.done && W.tLast != null && t >= W.tLast) {
      const s = P.snap(); const rel = t - W.tLast;
      if (W.label == null && s.hour === W.target && s.layer === layer && s.model === model && s.seq > W.seq0) W.label = rel;
      const ok = exactNow(s, W);
      if (W.exact == null && ok) { W.exact = W.already ? 0 : rel; W.exactSeries = s.series; W.pid = s.pid; }
      else if (W.exact != null && !ok) W.regress += 1;   // frames that left the exact-correct product after reaching it
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  P.arm = (target, expected, anchor) => {
    const s = P.snap();
    P.w = { target, expected, expectedMs: stampMs(expected), anchor, seq0: s.seq, tLast: null, label: null, exact: null, exactSeries: null, pid: null, already: false, regress: 0 };
    P.w.already = exactNow(s, P.w);
  };
  P.read = () => ({ ...P.w, end: P.snap(), sf: window.__RAW_STATIC_FRAMES__ ? { hits: window.__RAW_STATIC_FRAMES__.hits, series: window.__RAW_STATIC_FRAMES__.seriesFrames, misses: window.__RAW_STATIC_FRAMES__.misses } : null });
};

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.evaluate((el) => el.click());
}

async function session(arm) {
  const { browser, page, log } = await L.launch({ port: PORT, hashTextureUploads: true, hooks: { beforeWeather: async (url) => {
    const d = url.pathname.endsWith('/grid_series') ? LAT_SERIES : url.pathname.endsWith('/grid') ? LAT_GRID : 0; if (d) await sleep(d); } } });
  await page.addInitScript(({ on, base, killStore, eager, killFill }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__');          // no per-browser choice: the build default decides
    window.__RAW_STATIC_FRAMES_BASE__ = base;
    if (!on) window.__RAW_DISABLE_STATIC_FRAMES__ = true;      // the kill switch
    if (killStore) window.__RAW_DISABLE_FRAME_STORE__ = true;
    if (eager) window.__RAW_FRAME_PREFETCH_EAGER__ = true;
    if (killFill) window.__RAW_DISABLE_FRAME_IDLE_FILL__ = true;
  }, { on: ['static', 'store', 'intent', 'eager'].includes(arm), base: `http://127.0.0.1:${CDN_PORT}/`, killStore: arm === 'static', eager: arm === 'eager',
    killFill: arm === 'intent' });
  await page.addInitScript(PROBE, { model: MODEL, layer: LAYER });
  const steps = [];
  const frameBytes = () => ({ n: (cdnLog.byKind.frame || { n: 0 }).n, bytes: (cdnLog.byKind.frame || { bytes: 0 }).bytes });
  const open0 = frameBytes();
  const since = (b) => ({ frames: b.n - open0.n, bytes: b.bytes - open0.bytes });
  try {
    await L.openMap(page); await L.jump(page, -80, 24, 3.2);
    await clickExact(page, 'Waves');
    if (MODEL !== 'GFS') { await sleep(150); await clickExact(page, MODEL); }
    if (LAYER !== 'waves') { await sleep(150); await clickExact(page, LABEL[LAYER]); }
    await page.waitForFunction(({ m, l }) => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = d && d.waveGrid;
      return g && g.__sourceModel === m && g.__componentLayer === l; }, { m: MODEL, l: LAYER }, { timeout: 60000 });
    // After the first draw: a 6 s glance, then (store / eager) until the whole run is in the store, at most FILL_WAIT.
    const tDraw = Date.now(); let glance = null; let wholeRunMs = null;
    const fills = ['store', 'eager'].includes(arm);
    for (;;) {
      await sleep(100);
      const el = Date.now() - tDraw;
      if (glance === null && el >= 6000) glance = since(frameBytes());
      if (fills && wholeRunMs === null) {
        const whole = await page.evaluate(() => { const t = window.__RAW_FRAME_STORE__; const s = t && t.sets && (t.sets.find((x) => t.fill && x.key === t.fill.key) || t.sets[0]);
          return !!(s && s.frames > 0 && s.absent === 0 && s.inflight === 0); });
        if (whole) wholeRunMs = el;
      }
      if (el >= 6000 && (!fills || wholeRunMs !== null || el >= FILL_WAIT)) break;
    }
    const open = { glance, wholeRunMs, beforeSteps: since(frameBytes()),
      fill: await page.evaluate(() => { const t = window.__RAW_FRAME_STORE__; return t && t.fill ? { ...t.fill } : null; }) };
    // What /grid serves for each step's time (the app's anchor: the hour-rounded clock), asked BEFORE the timed window.
    const anchor = Math.round(Date.now() / 3600000) * 3600000;
    const expected = {};
    for (const [, target] of STEPS) {
      const ask = new Date(anchor + target * 3600000).toISOString();
      const j = await (await fetch(`http://127.0.0.1:${PORT}/api/weather/grid?model=${MODEL}&domain=marine&layer=${LAYER}&valid_time=${encodeURIComponent(ask)}&bbox=-180,-80,180,85`)).json();
      expected[target] = j.product_id;
    }
    const reqs0 = log.requests.length; const cdn0 = { ...cdnLog, byKind: JSON.parse(JSON.stringify(cdnLog.byKind)) };
    const cpu0 = backendCpuS();
    for (const [key, target] of STEPS) {
      await page.evaluate(({ t, e, a }) => window.__SF__.arm(t, e, a), { t: target, e: expected[target], a: anchor });
      const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
      if (key === 'BURST') { for (let i = 0; i < 5; i++) { await page.keyboard.press('PageUp'); await sleep(60); } } else await page.keyboard.press(key);
      const t0 = Date.now(); let r;
      do { await sleep(50); r = await page.evaluate(() => window.__SF__.read()); } while (r.exact == null && Date.now() - t0 < WIN);
      await page.evaluate(() => { window.__SF__.w.done = true; });
      steps.push({ key, target, expected: expected[target], exactMs: r.exact == null ? null : Math.round(r.exact),
        labelMs: r.label == null ? null : Math.round(r.label), already: r.already, regress: r.regress, exactFromSeries: r.exactSeries,
        end: { h: r.end.hour, pid: r.end.pid, cols: r.end.cols, stride: r.end.stride }, sf: r.sf });
      await sleep(600);
    }
    const cpu1 = backendCpuS();
    if (Math.round(Date.now() / 3600000) * 3600000 !== anchor) steps.forEach((x) => { x.anchorRolled = true; });
    const req = log.requests.slice(reqs0);
    const byPath = {}; for (const q of req) byPath[q.path] = (byPath[q.path] || 0) + 1;
    // Each backend request during the steps, by what it asked (which model/layer/box/time reached the backend, and why).
    const backendRequestDetail = req.map((q) => ({ path: q.path, model: q.q && q.q.model, layer: q.q && q.q.layer, bbox: q.q && q.q.bbox,
      valid_time: q.q && q.q.valid_time, ms: q.ms }));
    return { arm, steps, open, backendCpuS: +(cpu1 - cpu0).toFixed(3), backendRequests: byPath, backendRequestDetail,
      cdn: { requests: cdnLog.requests - cdn0.requests, bytes: cdnLog.bytes - cdn0.bytes },
      errors: log.errors.slice(0, 5), hosts: log.hosts,
      frameStore: await page.evaluate(() => { const t = window.__RAW_FRAME_STORE__; return t ? { shows: t.shows, commits: t.commits, prefetch: t.prefetch, gpu: t.gpu, cpuMB: t.cpuMB, gpuMB: t.gpuMB, tier: t.tier } : null; }) };
  } finally { await browser.close(); }
}

const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const pct = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const sessions = [];
  const out = { env: { PORT, CDN_PORT, ROUNDS, WIN, LAT_SERIES, LAT_GRID, CDN_LAT, MODEL, LAYER, startedUtc: new Date().toISOString() }, sessions };
  try {
    const ARMS = (process.env.ARMS || 'grid,static').split(',');
    for (let i = 0; i < ROUNDS; i++) {
      for (const arm of (i % 2 === 0 ? ARMS : [...ARMS].reverse())) {   // A B, B A, A B ... (interleaved)
        const s = await session(arm);
        sessions.push(s);
        console.log(arm, JSON.stringify(s.steps.map((x) => [x.target, x.exactMs, x.labelMs])), 'cpu', s.backendCpuS, JSON.stringify(s.backendRequests), 'cdn', JSON.stringify(s.cdn),
          'open', JSON.stringify(s.open));
        if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
      }
    }
    const summary = {};
    for (const arm of ARMS) {
      const ss = sessions.filter((s) => s.arm === arm);
      const ex = ss.flatMap((s) => s.steps.map((x) => x.exactMs));
      const any = ss.flatMap((s) => s.steps.map((x) => x.labelMs));
      summary[arm] = { sessions: ss.length, steps: ex.length, exact_missed: ex.filter((x) => x == null).length,
        exact_ms_p50: median(ex), exact_ms_p95: pct(ex, 0.95), exact_ms_max: ex.some((x) => x == null) ? null : Math.max(...ex),
        label_ms_p50: median(any), label_missed: any.filter((x) => x == null).length,
        backend_cpu_s_per_step: +(ss.reduce((a, s) => a + s.backendCpuS, 0) / Math.max(1, ex.length)).toFixed(4),
        backend_requests: ss.reduce((acc, s) => { for (const [k, v] of Object.entries(s.backendRequests)) acc[k] = (acc[k] || 0) + v; return acc; }, {}),
        cdn_bytes_per_frame: (() => { const n = ss.reduce((a, s) => a + s.cdn.requests, 0); return n ? Math.round(ss.reduce((a, s) => a + s.cdn.bytes, 0) / n) : null; })() };
      summary[arm].by_step = STEPS.map(([key, target], k) => ({ key, target, exact_ms: ss.map((s) => s.steps[k] && s.steps[k].exactMs) }));
      summary[arm].open = { glance_frame_bytes: ss.map((s) => s.open && s.open.glance && s.open.glance.bytes),
        whole_run_ms: ss.map((s) => s.open && s.open.wholeRunMs), before_steps_frame_bytes: ss.map((s) => s.open && s.open.beforeSteps.bytes),
        // the frames before the steps plus every static object asked during them (the index reads are a few KB)
        session_static_bytes: ss.map((s) => s.open && s.open.beforeSteps.bytes + s.cdn.bytes) };
    }
    out.summary = summary;
    console.log(JSON.stringify(summary, null, 1));
  } finally {
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
    cdn.close();
  }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
