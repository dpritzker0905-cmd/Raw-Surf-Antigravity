// Scrub at the owner's zooms (2026-10-22, the mid-zoom instant scrub). Offline only.
//
// The world-view A/Bs (scn_static_frames.js) open at zoom 3.2, where the whole world is on screen; the owner scrubs at zoom 3 to
// 9 and saw no change. This opens the map ONCE per (zoom, arm) in a fresh browser, at the zoom asked, turns Waves on, waits for
// the first draw plus SETTLE ms (the owner looks before he scrubs), then presses the steps below and records, per step:
//   exactMs   key press -> the engine's resident grid is the product /grid serves for that time (its valid time, from the
//             product id or a series frame's anchor + hour), not thinned (stride 0), GFS waves; 0 when it already was
//   labelMs   key press -> the resident grid's hour LABEL is the requested hour (any data)
//   mislabel  animation frames in the step window whose resident grid CLAIMS the requested hour while its data is another
//             time's product (the #267 rule: a label must never run ahead of its data; must be 0)
//   reqs      backend requests during the step (/grid, /grid_series), dims seen (each distinct resident cols x rows), commits
// and per session the frame store (window.__RAW_FRAME_STORE__: shows, misses by reason, the resident it compares against) and
// static frames (window.__RAW_STATIC_FRAMES__: hits, series frames, crops, misses by reason) counters.
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS --regions flagship --dynamic 1 \
//       --real-frames <bucket copy> --port 4100
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3100
//   CDN_DIR=<bucket copy> PORT=4100 OUT=zoom.json node frontend/scripts/offline-backend/scn_zoom_scrub.js
// Env: ZOOMS (2,3,4,5,7,9), CENTER (lng,lat; -79.5,28.6 = the Florida east coast, where z9 sits on a regional tile),
// VIEW (desktop = 1280 x 800; owner = 844 x 390 at dpr 2, whose z3.5-4.4 boxes are the owner's 27 x 20 / 29 x 20 / 31 x 21
// clips; phone = 390 x 844 at dpr 3, the mobile layout), ARMS (cur: the build's defaults; others below), ROUNDS (1),
// SETTLE (8000), WIN (8000), CDN_PORT (4191), CDN_LAT (ms per static object), LAT_SERIES / LAT_GRID / LAT_PRODUCTS (ms per backend
// response; LAT_PRODUCTS=4000 stands for the live read's late products manifest).
// Arms (all on ONE build; kill switches read per call):
//   cur      the build as it ships
//   nocrop   window.__RAW_DISABLE_STATIC_MID_CROP__ = true (static frames serve world boxes only, as before 2026-10-22)
//   nostore  window.__RAW_DISABLE_FRAME_STORE__ = true
//   nocropshow  window.__RAW_DISABLE_FRAME_STORE_CROP__ = true (the store shows world-sized residents only, as before 2026-10-22)
//   grid     window.__RAW_DISABLE_STATIC_FRAMES__ = true (no CDN at all: /grid + /grid_series only)
//   noaheadrun  window.__RAW_DISABLE_CROP_AHEAD_RUN__ = true (a new window's packs for the cursor +-24 only, as before pass 2)
//   regional    window.__RAW_ENABLE_REGIONAL_BUNDLES__ = true (the regional bundle client is DARK by default since 2026-10-23
//            evening: opt in to measure it)
//   regionalnostore  the same, with window.__RAW_DISABLE_FRAME_STORE_REGIONAL__ = true (the frame store takes no tile resident: the
//            2026-10-23 behaviour; `regional` adds the store's regional show, 2026-10-24)
//   noregional  window.__RAW_DISABLE_REGIONAL_BUNDLES__ = true (z7-9 boxes a pilot tile covers go to /grid + /grid_series, as before
//            2026-10-23). Per session `marineAll` counts every marine /grid and /grid_series ask, per layer, over the WHOLE session (load, settle and
//            steps) with the backend ms they took, and `regional` reads window.__RAW_STATIC_REGIONAL__ (hits, series frames, misses).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_zoom_scrub is offline only');
const PORT = +(process.env.PORT || 4100);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4191);
const ROUNDS = +(process.env.ROUNDS || 1);
const WIN = +(process.env.WIN || 8000);
const SETTLE = +(process.env.SETTLE || 8000);
const ZOOMS = (process.env.ZOOMS || '2,3,4,5,7,9').split(',').map(Number);
const [CLNG, CLAT] = (process.env.CENTER || '-79.5,28.6').split(',').map(Number);
const VIEW = process.env.VIEW || 'desktop';
const VIEWS = { desktop: { width: 1280, height: 800, dpr: 1 }, owner: { width: 844, height: 390, dpr: 2 }, phone: { width: 390, height: 844, dpr: 3 } };
const LAT_SERIES = +(process.env.LAT_SERIES || 0); const LAT_GRID = +(process.env.LAT_GRID || 0); const LAT_PRODUCTS = +(process.env.LAT_PRODUCTS || 0); const CDN_LAT = +(process.env.CDN_LAT || 0);
if (!CDN_DIR) throw Error('CDN_DIR=<a local copy of the weather-frames bucket> is required');
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// [key, requested hour after it]: 1-h steps (two between stored frames), day steps, a 5-day burst, back, Home.
const STEPS = [['ArrowRight', 1], ['ArrowRight', 2], ['ArrowRight', 3], ['ArrowRight', 4], ['PageUp', 28], ['PageUp', 52],
  ['BURST', 172], ['PageDown', 148], ['ArrowLeft', 147], ['Home', 0]];

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

const PROBE = () => {
  const P = (window.__ZS__ = { w: null });
  window.addEventListener('keydown', (e) => { if (P.w) P.w.tLast = e.timeStamp; }, true);
  // a dynamic viewport product id carries its box after the stamp: ..._20261024T120000Z_-77.00_33.00_-74.00_36.00.json
  const stampMs = (pid) => { const m = /_(\d{8}T\d{6}Z)(?:_[-\d.]+)*\.json$/.exec(pid || ''); return m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : null; };
  P.snap = () => {
    const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = d && d.waveGrid;
    const up = d && d.u_waveTexture && window.__TEX__ && window.__TEX__.uploads.get(d.u_waveTexture);
    const pid = (g && g.__fromFrameStore && g.__servedProductId) || (window.__WEBGL_MARINE_UPLOAD_DIAG__ && window.__WEBGL_MARINE_UPLOAD_DIAG__.servedProductId)
      || (g ? (g.__servedProductId || g.productId || null) : null);
    const b = g && g.bounds;
    return { hour: g ? g.hourOffset : null, layer: g ? g.__componentLayer : null, model: g ? g.__sourceModel : null,
      cols: g ? g.cols : null, rows: g ? g.rows : null, span: b ? Math.round(((b.east < b.west) ? b.east + 360 - b.west : b.east - b.west) * 10) / 10 : null,
      stride: g ? (g.__decimatedStride || 0) : null, series: !!(g && g.__fromSeries), store: !!(g && g.__fromFrameStore), pid,
      served: g ? (g.served_valid_time || null) : null, seq: up ? up.seq : -1, grid: g || null };
  };
  // The resident's data time: its stored product id (the per-hour path, a frame-store show), else the served time it carries,
  // else for a series frame anchor + its hour (series pages ask the cadence-aligned product times).
  const dataMs = (s, W) => (s.pid ? stampMs(s.pid) : (s.served ? Date.parse(s.served) : (s.series && s.hour != null ? W.anchor + s.hour * 3600000 : null)));
  P.dataIso = (s, W) => { const m = dataMs(s, W); return m == null ? null : new Date(m).toISOString(); };
  const exactNow = (s, W) => dataMs(s, W) === W.expectedMs && s.layer === 'waves' && s.model === 'GFS' && s.stride === 0;
  const loop = (t) => {
    const W = P.w;
    if (W && !W.done && W.tLast != null && t >= W.tLast) {
      const s = P.snap(); const rel = t - W.tLast;
      if (W.label == null && s.hour === W.target && s.layer === 'waves' && s.model === 'GFS' && (s.seq > W.seq0 || s.store)) W.label = rel;
      const ok = exactNow(s, W);
      if (W.exact == null && ok) { W.exact = W.already ? 0 : rel; W.via = s.store ? 'store' : (s.series ? 'series' : 'grid'); W.pid = s.pid; }
      else if (W.exact != null && !ok) W.regress += 1;
      const dm = dataMs(s, W);
      if (s.hour === W.target && dm != null && dm !== W.expectedMs && s.layer === 'waves') {
        W.mislabel += 1;
        // Does the status line SAY the field is not yet this hour (loading / nearest / estimated)? A mislabel with no such word is the
        // silent kind (matrix class 1); read per frame, the line's text is the only honesty the user has.
        const st = [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null).map((x) => x.textContent.trim()).join(' | ').slice(0, 160);
        if (!/Loading|Verifying|does not match|pending|nearest|estimated/i.test(st)) W.mislabelSilent = (W.mislabelSilent || 0) + 1;
        if (!W.mid) W.mid = { rel: Math.round(rel), pid: s.pid, served: s.served, store: s.store, series: s.series, dataIso: P.dataIso(s, W), status: st };
      }
      const dims = `${s.cols}x${s.rows}`;
      if (dims !== W.lastDims) { W.dims.push(`${dims}@${Math.round(rel)}`); W.lastDims = dims; }
      if (s.grid !== W.lastGrid) { W.commits += 1; W.lastGrid = s.grid; }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  P.arm = (target, expected, anchor) => {
    const s = P.snap();
    P.w = { target, expectedMs: stampMs(expected), anchor, seq0: s.seq, tLast: null, label: null, exact: null, via: null, pid: null,
      already: false, regress: 0, mislabel: 0, dims: [], lastDims: `${s.cols}x${s.rows}`, commits: 0, lastGrid: s.grid };
    P.w.already = exactNow(s, P.w);
  };
  P.read = () => { const { lastGrid, ...w } = P.w; const s = P.snap(); delete s.grid; return { ...w, end: s }; };
  P.counters = () => {
    const sf = window.__RAW_STATIC_FRAMES__; const fsx = window.__RAW_FRAME_STORE__;
    return { sf: sf ? { hits: sf.hits, seriesFrames: sf.seriesFrames, crops: sf.crops || 0, misses: { ...sf.misses }, fetches: sf.fetches, bytes: sf.bytes } : null,
      store: fsx ? { shows: fsx.shows && fsx.shows.n, misses: fsx.shows ? { ...fsx.shows.misses } : null, deferred: fsx.shows && fsx.shows.deferred,
        lastMs: fsx.shows && fsx.shows.lastMs, regionalShows: fsx.shows && fsx.shows.regional, resident: fsx.resident ? { cols: fsx.resident.cols, rows: fsx.resident.rows, window: fsx.resident.window || null } : null,
        commits: { ...(fsx.commits || {}) }, crop: fsx.crop ? { window: fsx.crop.window && fsx.crop.window.key, packs: fsx.crop.packs, built: fsx.crop.built, shows: fsx.crop.shows } : null } : null,
      regional: window.__RAW_STATIC_REGIONAL__ ? JSON.parse(JSON.stringify(window.__RAW_STATIC_REGIONAL__)) : null,
      regionalTrace: Array.isArray(window.__RAW_STATIC_REGIONAL_TRACE__) ? window.__RAW_STATIC_REGIONAL_TRACE__.slice() : undefined,
      nodowngrade: window.__MARINE_NO_DOWNGRADE__ ? { count: window.__MARINE_NO_DOWNGRADE__.count, selfHealed: window.__MARINE_NO_DOWNGRADE__.selfHealed || 0, last: window.__MARINE_NO_DOWNGRADE__.last } : null };
  };
};

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.evaluate((el) => el.click());
}

// REQLOG=1: what answered each weather request (the tier behind a resident: product, scope, lattice, dynamic or stored).
const REQLOG = process.env.REQLOG === '1';
function describeWeather(url, body) {
  const pick = (d) => { const g = (d && d.grid) || {}; return { product: d && d.product_id, scope: d && d.coverage_scope, dyn: !!(d && d.is_dynamic_viewport_product),
    served: d && d.served_bbox, cols: g.cols, rows: g.rows }; };
  const q = Object.fromEntries(url.searchParams.entries());
  const out = { path: url.pathname.replace('/api/weather', ''), bbox: q.bbox || null, vt: q.valid_time || null };
  if (Array.isArray(body && body.frames)) { out.frames = body.frames.length; Object.assign(out, pick(body.frames.find((f) => f && f.grid) || body.frames[0])); }
  else if (body && body.grid) Object.assign(out, pick(body));
  return out;
}


// The box a z7+ ask is made for (2026-10-24): the expected product must come from the SAME box the app asks, not the world box. A z8
// viewport product is stamped with the exact asked time (14:00Z) while the stored world product for that hour is the nearest stored
// frame (15:00Z), so no z8 frame could ever equal a world expectation. Taken from the app's own last /grid ask (its snapped box), else
// the map's bounds snapped out to whole degrees. Below z7 the world box, as before.
async function expectedBox(page, log, zoomedIn) {
  if (!zoomedIn) return '-180,-80,180,85';
  const g = [...log.requests].reverse().find((q) => q.path === '/grid' && q.q && q.q.bbox);
  if (g) return g.q.bbox;
  const b = await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; const x = m.getBounds(); return [x.getWest(), x.getSouth(), x.getEast(), x.getNorth()]; });
  return [Math.floor(b[0]), Math.floor(b[1]), Math.ceil(b[2]), Math.ceil(b[3])].join(',');
}

// Hour 0 of the APP (2026-10-24): the resident grid's own asked valid time minus its hour offset. The old rounded clock disagreed with the
// app's anchor by an hour whenever the run fell in the second half of an hour, which made a correct frame read as a mislabel (the Biscay
// north-edge cell, 1,821 'silent' frames). Falls back to the rounded clock when the grid carries neither field.
async function appAnchor(page) {
  const a = await page.evaluate(() => { const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid;
    const t = g && Date.parse(g.valid_time || g.validTime || ''); return g && Number.isFinite(t) && Number.isFinite(g.hourOffset) ? t - g.hourOffset * 3600000 : null; });
  return a != null ? a : Math.round(Date.now() / 3600000) * 3600000;
}

async function session(arm, zoom) {
  const v = VIEWS[VIEW];
  const reqLog = [];
  const { browser, page, log } = await L.launch({ port: PORT, width: v.width, height: v.height, dpr: v.dpr, hashTextureUploads: true, hooks: { beforeWeather: async (url) => {
    const d = url.pathname.endsWith('/grid_series') ? LAT_SERIES : url.pathname.endsWith('/grid') ? LAT_GRID
      : url.pathname.endsWith('/products') ? LAT_PRODUCTS : 0; if (d) await sleep(d); },
  afterWeather: REQLOG ? async (url, resp) => {
    if (!/\/grid(_series)?$/.test(url.pathname)) return;
    let body = null; try { body = JSON.parse((await resp.body()).toString('utf8')); } catch (e) { /* not json */ }
    reqLog.push({ t: Date.now() - log.t0, ...describeWeather(url, body) });
  } : undefined } });
  await page.addInitScript(({ arm, base, regTrace }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__');
    window.__RAW_STATIC_FRAMES_BASE__ = base;
    if (arm === 'grid') window.__RAW_DISABLE_STATIC_FRAMES__ = true;
    if (arm === 'nocrop') window.__RAW_DISABLE_STATIC_MID_CROP__ = true;
    if (arm === 'nostore') window.__RAW_DISABLE_FRAME_STORE__ = true;
    if (arm === 'nocropshow') window.__RAW_DISABLE_FRAME_STORE_CROP__ = true;
    if (arm === 'noaheadrun') window.__RAW_DISABLE_CROP_AHEAD_RUN__ = true;
    if (arm === 'noregional') window.__RAW_DISABLE_REGIONAL_BUNDLES__ = true;
    if (arm === 'regional' || arm === 'regionalnostore') window.__RAW_ENABLE_REGIONAL_BUNDLES__ = true;   // the client is dark by default since 2026-10-23
    if (arm === 'regionalnostore') window.__RAW_DISABLE_FRAME_STORE_REGIONAL__ = true;   // bundles on, the store's regional show killed (2026-10-24)
    if (regTrace) window.__RAW_STATIC_REGIONAL_TRACE__ = [];
  }, { arm, base: `http://127.0.0.1:${CDN_PORT}/`, regTrace: process.env.REGTRACE === '1' });
  await page.addInitScript(PROBE);
  const steps = [];
  try {
    await L.openMap(page); await L.jump(page, CLNG, CLAT, zoom);
    const tClick = Date.now();
    await clickExact(page, 'Waves');
    await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 60000, polling: 16 });
    // firstFrame: ms from the Waves click to the first wave grid in the engine (the owner's "time to first frame"), and its source.
    const firstFrameMs = Date.now() - tClick;
    const firstFrame = await page.evaluate(() => { const x = window.__ZS__.snap(); delete x.grid; return x; });
    await sleep(SETTLE);
    // IDLE TWO-rAF (the live-read rule, 2026-10-24): the time two consecutive animation frames take with nothing happening, 30 samples.
    // Step timings are only a claim when the median reads 40 ms or less; otherwise the box (or this headless window) is too loaded.
    const idleTwoRaf = await page.evaluate(() => new Promise((resolve) => {
      const out = []; const one = () => { const t0 = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => { out.push(performance.now() - t0); if (out.length < 30) setTimeout(one, 30); else { out.sort((a, b) => a - b); resolve({ median: +out[15].toFixed(1), p95: +out[28].toFixed(1) }); } })); };
      one();
    }));
    idleTwoRaf.valid = idleTwoRaf.median <= 40;
    const before = await page.evaluate(() => window.__ZS__.counters());
    const anchor = await appAnchor(page);
    const EXPBOX = await expectedBox(page, log, zoom >= 7);
    const expected = {};
    for (const [, target] of STEPS) {
      const ask = new Date(anchor + target * 3600000).toISOString();
      const j = await (await fetch(`http://127.0.0.1:${PORT}/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=${encodeURIComponent(ask)}&bbox=${EXPBOX}`)).json();
      expected[target] = j.product_id;
    }
    const vp = await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; const b = m.getBounds(); return { z: +m.getZoom().toFixed(2), w: +b.getWest().toFixed(2), s: +b.getSouth().toFixed(2), e: +b.getEast().toFixed(2), n: +b.getNorth().toFixed(2) }; });
    const reqs0 = log.requests.length;
    for (const [key, target] of STEPS) {
      await page.evaluate(({ t, e, a }) => window.__ZS__.arm(t, e, a), { t: target, e: expected[target], a: anchor });
      const r0 = log.requests.length; const q0 = reqLog.length;
      const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
      if (key === 'BURST') { for (let i = 0; i < 5; i++) { await page.keyboard.press('PageUp'); await sleep(60); } } else await page.keyboard.press(key);
      const t0 = Date.now(); let r;
      do { await sleep(50); r = await page.evaluate(() => window.__ZS__.read()); } while (r.exact == null && Date.now() - t0 < WIN);
      await sleep(400);
      r = await page.evaluate(() => window.__ZS__.read());
      await page.evaluate(() => { window.__ZS__.w.done = true; });
      const q = log.requests.slice(r0); const by = {}; for (const x of q) by[x.path] = (by[x.path] || 0) + 1;
      steps.push({ key, target, exactMs: r.exact == null ? null : Math.round(r.exact), labelMs: r.label == null ? null : Math.round(r.label),
        via: r.via, already: r.already, regress: r.regress, mislabel: r.mislabel, mislabelSilent: r.mislabelSilent || 0, commits: r.commits, dims: r.dims, reqs: by,
        ...(REQLOG ? { reqDetail: reqLog.slice(q0) } : {}),
        end: { h: r.end.hour, cols: r.end.cols, rows: r.end.rows, span: r.end.span, stride: r.end.stride, store: r.end.store, series: r.end.series, pid: r.end.pid, served: r.end.served },
        mid: r.mid || null });
      await sleep(400);
    }
    if ((await appAnchor(page)) !== anchor) steps.forEach((x) => { x.anchorRolled = true; });   // the app's own hour 0 moved during the run
    const after = await page.evaluate(() => window.__ZS__.counters());
    const byPath = {}; for (const q of log.requests.slice(reqs0)) byPath[q.path] = (byPath[q.path] || 0) + 1;
    const marineAll = {};
    for (const q of log.requests) {
      if (!q.q || q.q.domain !== 'marine' || !/^\/grid(_series)?$/.test(q.path)) continue;
      const k = `${q.q.layer}${q.path}`;
      const w = (marineAll[k] = marineAll[k] || { n: 0, ms: 0 }); w.n += 1; w.ms += q.ms || 0;
    }
    return { arm, zoom, view: VIEW, vp, firstFrameMs, idleTwoRaf, firstFrame: { cols: firstFrame.cols, rows: firstFrame.rows, series: firstFrame.series, store: firstFrame.store, pid: firstFrame.pid },
      steps, before, after, backendRequests: byPath, marineAll, errors: log.errors.slice(0, 5), ...(REQLOG ? { reqLog } : {}) };
  } finally { await browser.close(); }
}

const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const pct = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const sessions = [];
  const out = { env: { PORT, CDN_PORT, ROUNDS, WIN, SETTLE, ZOOMS, CENTER: [CLNG, CLAT], VIEW, LAT_SERIES, LAT_GRID, LAT_PRODUCTS, CDN_LAT, startedUtc: new Date().toISOString() }, sessions };
  const ARMS = (process.env.ARMS || 'cur').split(',');
  try {
    for (let i = 0; i < ROUNDS; i++) {
      for (const zoom of ZOOMS) {
        for (const arm of (i % 2 === 0 ? ARMS : [...ARMS].reverse())) {
          const s = await session(arm, zoom);
          sessions.push(s);
          console.log(`z${zoom} ${arm} first=${s.firstFrameMs}ms vp=${JSON.stringify(s.vp)}`, JSON.stringify(s.steps.map((x) => [x.target, x.exactMs, x.via, x.mislabel, x.end.cols + 'x' + x.end.rows])),
            'reqs', JSON.stringify(s.backendRequests), 'store', JSON.stringify(s.after.store && { shows: s.after.store.shows, misses: s.after.store.misses, crop: s.after.store.crop }),
            'sf', JSON.stringify(s.after.sf && { hits: s.after.sf.hits, series: s.after.sf.seriesFrames, crops: s.after.sf.crops, misses: s.after.sf.misses }),
            'marineAll', JSON.stringify(s.marineAll), 'regional', JSON.stringify(s.after.regional));
          if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
        }
      }
    }
    const summary = {};
    for (const arm of ARMS) {
      for (const zoom of ZOOMS) {
        const ss = sessions.filter((s) => s.arm === arm && s.zoom === zoom);
        const st = ss.flatMap((s) => s.steps);
        const ex = st.map((x) => x.exactMs);
        const steps = st.length;
        const grids = st.reduce((a, x) => a + (x.reqs['/grid'] || 0), 0); const series = st.reduce((a, x) => a + (x.reqs['/grid_series'] || 0), 0);
        summary[`${arm}@z${zoom}`] = { steps, exact_missed: ex.filter((x) => x == null).length, exact_ms_p50: median(ex), exact_ms_p95: pct(ex, 0.95),
          label_ms_p50: median(st.map((x) => x.labelMs)), mislabel_frames: st.reduce((a, x) => a + x.mislabel, 0), mislabel_silent_frames: st.reduce((a, x) => a + (x.mislabelSilent || 0), 0),
          grid_per_step: +(grids / Math.max(1, steps)).toFixed(2), series_per_step: +(series / Math.max(1, steps)).toFixed(2),
          via: st.reduce((a, x) => { a[x.via || 'none'] = (a[x.via || 'none'] || 0) + 1; return a; }, {}),
          resident_dims: [...new Set(st.map((x) => `${x.end.cols}x${x.end.rows}`))],
          first_frame_ms: ss.map((s) => s.firstFrameMs), idle_two_raf: ss.map((s) => s.idleTwoRaf), marine_session: ss.map((s) => s.marineAll), regional: ss.map((s) => s.after.regional),
          store_shows: ss.map((s) => s.after.store && s.after.store.shows), store_misses: ss.map((s) => s.after.store && s.after.store.misses) };
      }
    }
    out.summary = summary;
    console.log(JSON.stringify(summary, null, 1));
  } finally {
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
    cdn.close();
  }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
