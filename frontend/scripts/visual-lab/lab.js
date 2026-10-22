// VISUAL LAB — replays the owner's map flows on the production bundle and measures what is ON SCREEN (offline by default).
//
// Why: the owner's checks ("I still saw stale heatmaps, and slow to scrub ... intermittent") are visual and happen across
// layers, models, wind + marine together, pan and zoom. This lab replays those flows step by step and, for every step, keeps:
//   identity   what the marine engine drew (window.__MARINE_DRAWN__ / engine grid) and what the wind engine drew
//              (window.__WIND_ENGINE__._windData.windGrid) against the wheel's selected hour, layer and model, per frame:
//              silent mismatch frames vs frames the status line admitted ("Loading…", "nearest stored forecast", "Estimated")
//   time       input -> first frame with the correct marine field; -> correct wind field
//   pixels     a screenshot 150 ms after the input and one at settle; STALE score = the immediate shot is closer to the
//              PREVIOUS step's settled picture than to this step's (the eye's "stale heatmap"), with the measured noise floor
//   console    counts of the patterns from the owner's logs (aborted fetches + safe-zero, wind retries, settle misses,
//              stale-fetch discards), per step
//   network    weather requests per step: series pages, /grid, wind, duplicates (same URL twice), failures
//   pacing     rAF gaps > 50 ms, worst gap, long tasks
// Output: <OUT>/report.html (self-contained, thumbnails inline) + <OUT>/lab.json (+ <OUT>/trace.json with LAB_TRACE=1, open
// it in Chrome DevTools > Performance).
//
// Run (offline, the default; see README.md):
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <dir> --port 4103 --thin-bounds 1 \
//     --models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves,wind
//   node frontend/scripts/offline-backend/serve_spa.js frontend/build 3100
//   PORT=4103 OUT=lab-out node frontend/scripts/visual-lab/lab.js
// Env: FLOWS (comma list, default all), VIEW (desktop|phone), LAT_SERIES / LAT_GRID (ms injected per request), LAB_TRACE=1
// (also writes profile.json, a V8 CPU profile on the same clock: attribute main-thread stalls with stall_profile.js).
// LIVE: AB_LIVE=1 replays against the REAL backend — real load on the 1-CPU box that serves production: one run at a time,
// /api/health probed before and after, never in a loop, only on the owner's word (CLAUDE.md).
const fs = require('fs');
const path = require('path');
const L = require('../offline-backend/ab_lib.js');
const P = require('../../e2e/pngPixels.js');

const PORT = +(process.env.PORT || 4103);
const OUT = path.resolve(process.env.OUT || 'visual-lab-out');
const VIEW = process.env.VIEW || 'desktop';
const LAT_SERIES = +(process.env.LAT_SERIES || 0); const LAT_GRID = +(process.env.LAT_GRID || 0);
// LAT_PRODUCTS (2026-10-20, request diet): ms injected per /products reply (live: 1.3-2.1 s for 10.75 MB). Without it the manifest
// lands in a few ms here and the calls that start before it lands (the amplification being measured) cannot happen.
const LAT_PRODUCTS = +(process.env.LAT_PRODUCTS || 0);
// LAB_EXACT=0 stops waiting for the EXACT frame (identity right AND not a thinned world frame); default on, bounded by WIN.
const WAIT_EXACT = process.env.LAB_EXACT !== '0';
const WIN = +(process.env.WIN || 8000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const LABEL = { waves: 'Waves', swell_1: 'Swell', swell_2: 'Swell 2', wind_waves: 'Wind Waves', wind: 'Wind' };
// Console patterns lifted from the owner's 2026-10-19 logs.
const PATTERNS = {
  windAbortSafeZero: /conformed safe zero grid/,
  windRetry: /No data \(attempt|Fetching wind \(attempt [2-9]/,
  windPrimaryAttempt: /Fetching wind \(attempt/,
  staleDiscard: /Discarding stale/,
  settleMiss: /\[SCRUB-SETTLE\] Post-scrub verification/,
  seriesInstant: /Instant re-index/,
  maskRebuild: /land mask texture created/,
  swell2Blend: /ICON swell_2 blend/,
};

// ---- in-page probe: identity per animation frame, console pattern counters ----
const PROBE = (patterns) => {
  const W = (window.__LAB__ = { step: null, lt: [], counts: {} });
  const re = Object.fromEntries(Object.entries(patterns).map(([k, v]) => [k, new RegExp(v)]));
  for (const k of Object.keys(re)) W.counts[k] = 0;
  const wrap = (fn) => function (...args) {
    try { const line = args.map((a) => (typeof a === 'string' ? a : '')).join(' '); for (const k in re) if (re[k].test(line)) W.counts[k]++; } catch (e) { /* never break logging */ }
    return fn.apply(this, args);
  };
  console.log = wrap(console.log); console.warn = wrap(console.warn); console.error = wrap(console.error);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) W.lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* none */ }
  window.addEventListener('keydown', (e) => { if (W.step) W.step.tIn = e.timeStamp; }, true);
  const wheel = () => [...document.querySelectorAll('[role="slider"][aria-label*="Forecast timeline"]')].find((el) => el.offsetParent !== null);
  let fc = 0; let status = '';
  W.snap = () => {
    if ((fc++ % 4) === 0) status = [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null).map((x) => x.textContent.trim()).join(' | ').slice(0, 200);
    const md = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const mg = md && md.waveGrid;
    const we = window.__WIND_ENGINE__; const wg = we && we._windData && we._windData.windGrid;
    const w = wheel();
    return { wheel: w ? Number(w.getAttribute('aria-valuenow')) : null,
      mHour: mg ? mg.hourOffset : null, mLayer: mg ? mg.__componentLayer : null, mModel: mg ? mg.__sourceModel : null,
      mSeries: !!(mg && mg.__fromSeries), mCols: mg ? mg.cols : null,
      // SERVED vs ASKED clock on the engine's grid (2026-10-21, marineConformServed.js): mServed is null on every frame unless the
      // conform carries served_valid_time (dark: __RAW_MARINE_CONFORM_SERVED_TIME__); mAsk is the ask's echo on /grid.
      mServed: mg ? (mg.served_valid_time || null) : null, mAsk: mg ? (mg.valid_time || null) : null,
      // The engine's copy of the grid does not keep __decimatedStride, so detail is judged by cell size: a WORLD grid coarser than
      // 2.5 deg a cell (a stride-4 series frame is 8 deg, the exact global_mid 2 deg) is not the exact frame.
      mStride: (() => { const b = mg && mg.bounds; if (!b || !(mg.cols > 1)) return null; const sp = b.east < b.west ? b.east + 360 - b.west : b.east - b.west;
        return sp >= 340 && sp / (mg.cols - 1) > 2.5 ? Math.round(sp / (mg.cols - 1) / 2) : 1; })(),
      drawn: window.__MARINE_DRAWN__ || null, switchAborts: window.__SERIES_SWITCH_ABORTS__ || 0,
      wHour: wg ? (wg.hourOffset || 0) : null, wModel: wg ? (wg.__sourceModel || wg.model || null) : null,
      status };
  };
  let prev = null;
  const loop = (t) => {
    const S = W.step;
    if (S && !S.done) {
      const s = W.snap();
      if (prev != null) { const dt = t - prev; S.frames++; if (dt > 50) S.gaps++; if (dt > S.maxGap) S.maxGap = dt;
        // HEATMAP DIM (2026-10-19, owner: "heatmap dimming"): the custom layer's opacity multiplier; 0.4 = the stale-world-hour dim
        // (marineStaleHour.STALE_WORLD_DIM), 0.45-0.95 = a provisional/transition fade.
        const op = window.__RAW_GPU__ && window.__RAW_GPU__.opacity; const mu = op && Number.isFinite(op.mult) ? op.mult : null;
        if (mu != null && S.expect.marine) { if (mu <= 0.45) S.dimStale += dt; else if (mu < 0.95) S.dimSoft += dt; if (mu < S.minMult) S.minMult = mu;
          // the first stale-dim frame's resident and both clocks (2026-10-21): which grid the dim judged, by which clock
          if (mu <= 0.45 && !S.dimAt) { const sel = window.__RAW_SELECTED_FRAME__; const sh = window.__RAW_GPU__ && window.__RAW_GPU__.staleHour;
            S.dimAt = { rel: S.tIn != null ? Math.round(t - S.tIn) : null, mHour: s.mHour, mLayer: s.mLayer, mModel: s.mModel, mSeries: s.mSeries, mCols: s.mCols,
              mServed: s.mServed, mAsk: s.mAsk, selHour: sel ? sel.hour : null, selMs: sel ? sel.instantMs : null, why: sh ? sh.why : null }; } } }
      if (S.tIn != null && t >= S.tIn) {
        const rel = t - S.tIn;
        const admitted = /Loading|nearest|Estimated|Verifying|does not match/i.test(s.status);
        if (S.expect.marine) {
          const ok = s.mHour === S.expect.hour && s.mLayer === S.expect.layer && s.mModel === S.expect.model;
          if (ok && S.mOk == null) S.mOk = rel;
          // By INSTANT when known (the app's #267 rule): a frame labelled with another hour can be exactly the product a fetch
          // for the selected hour returns (3-hourly data snapped by instant); that is not a mislabel.
          const sel = window.__RAW_SELECTED_FRAME__; const dr = s.drawn;
          const sameInstant = !!(sel && dr && Number.isFinite(sel.instantMs) && Number.isFinite(dr.dataMs) && Math.abs(sel.instantMs - dr.dataMs) < 1800000
            && sel.layer === s.mLayer && sel.model === s.mModel);
          if (!ok && s.mHour != null && !sameInstant) admitted ? S.mAdm++ : S.mSilent++;
          if (!ok && sameInstant) S.mSameInstant++;
          // EXACT-CORRECT (2026-10-20): the selected instant's data at full detail, i.e. not a stride-thinned series frame
          // (marineExactUpgrade.isThinnedWorldGrid's placeholder). The time the eye waits for the real picture of the step.
          // The instant rule only counts once the app's own selected frame IS the expected hour (it lags the keypress by a render).
          const selNow = !!(sel && sel.hour === S.expect.hour);
          if ((ok || (sameInstant && selNow)) && !(s.mStride > 1) && S.mExact == null) S.mExact = rel;
        }
        if (S.expect.wind) {
          const okw = s.wHour === S.expect.hour && (!s.wModel || s.wModel === S.expect.model);
          if (okw && S.wOk == null) S.wOk = rel;
          if (!okw && s.wHour != null) S.wOff++;
        }
      }
    }
    prev = t; requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  W.arm = (expect) => { W.step = { expect, tIn: null, mOk: null, mExact: null, wOk: null, mSilent: 0, mAdm: 0, wOff: 0, frames: 0, gaps: 0, maxGap: 0,
    lt0: W.lt.length, c0: { ...W.counts }, mSameInstant: 0, dimStale: 0, dimSoft: 0, minMult: 1, dimAt: null }; };
  W.read = () => { const S = W.step; const lt = W.lt.slice(S.lt0);
    const counts = Object.fromEntries(Object.keys(W.counts).map((k) => [k, W.counts[k] - (S.c0[k] || 0)]));
    return { ...S, counts, ltN: lt.length, ltMax: Math.round(lt.reduce((a, x) => Math.max(a, x[1]), 0)), end: W.snap() }; };
};

// ---- load probe (2026-10-20, async shader compile): from page start, per animation frame, until the first heatmap draw ----
// firstLayerCall / firstDraw: the marine custom layer's first render() call and its first real heatmap draw (`__RAW_GPU__.layer.n`
// counts layer calls, `__RAW_GPU__.opacity.n` heatmap draws), each with the page's rAF frame index and ms since navigation.
// shaderBatch: the engines' batch telemetry (WebGLProgramBatch.publishBatch: mode async|deferred|serial, polls, ms) when it settled.
const LOAD_PROBE = () => {
  const L = (window.__LAB_LOAD__ = { frames: 0, firstLayerCall: null, firstDraw: null, marineBatch: null, windBatch: null });
  const at = (g) => ({ t: Math.round(performance.now()), frame: L.frames, layerCalls: (g.layer && g.layer.n) || 0 });
  const tick = () => {
    L.frames++;
    const g = window.__RAW_GPU__;
    if (g) {
      if (!L.firstLayerCall && g.layer && g.layer.n >= 1) L.firstLayerCall = at(g);
      const b = g.shaderBatch || {};
      if (!L.marineBatch && b.marine) L.marineBatch = { ...at(g), ...b.marine };
      if (!L.windBatch && b.wind) L.windBatch = { ...at(g), ...b.wind };
      if (!L.firstDraw && g.opacity && g.opacity.n >= 1) L.firstDraw = at(g);
    }
    if (!L.firstDraw && performance.now() < 60000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

// ---- helpers ----
// LIVE mode: real backend through the dev server (mock auth), with zoomlab's badge stub so the refused mock token never redirects
// to sign-in. Requests are logged from the page (path, query, status, duration). One bounded run, /api/health probed by the caller.
async function liveLaunch(base, size) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.dpr || 1 })).newPage();
  await page.addInitScript(() => { const m = { register: () => new Promise(() => {}), ready: new Promise(() => {}), addEventListener() {}, removeEventListener() {},
    getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]) }; Object.defineProperty(navigator, 'serviceWorker', { get() { return m; }, configurable: true }); });
  if (process.env.AB_DIAG) await page.addInitScript(() => { window.__AB_DIAG__ = true; });
  await require('../zoomlab-harness.cjs').stubZoomlabMessageBadge(page);
  const log = { requests: [], errors: [], blockedWs: [] }; const t0 = Date.now(); const starts = new Map();
  page.on('request', (r) => { if (/\/api\/weather\//.test(r.url())) starts.set(r, Date.now()); });
  const done = (r, status, error) => { if (!starts.has(r)) return; const u = new URL(r.url()); const st = starts.get(r); starts.delete(r);
    log.requests.push({ t: st - t0, ms: Date.now() - st, path: u.pathname.replace(/^\/api\/weather/, ''), q: Object.fromEntries(u.searchParams), status, error }); };
  page.on('requestfinished', async (r) => { let s = null; try { s = (await r.response()).status(); } catch (e) { /* gone */ } done(r, s, null); });
  page.on('requestfailed', (r) => done(r, null, (r.failure() || {}).errorText || 'failed'));
  page.on('pageerror', (e) => log.errors.push(String(e && e.message).slice(0, 200)));
  return { browser, page, log };
}
async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 }); await loc.evaluate((el) => el.click());
}
async function pressed(page, text) {
  return page.evaluate((t) => [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => (b.textContent || '').trim() === t), text);
}
async function ensureLayer(page, layer, on = true) {
  if ((await pressed(page, LABEL[layer])) !== on) await clickExact(page, LABEL[layer]);
}
async function seek(page, hour) {
  const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
  const cur = Number(await wheel.getAttribute('aria-valuenow'));
  if (hour === 0) { await page.keyboard.press('Home'); return; }
  const d = hour - cur;
  for (let i = 0; i < Math.floor(Math.abs(d) / 24); i++) await page.keyboard.press(d > 0 ? 'PageUp' : 'PageDown');
  for (let i = 0; i < Math.abs(d) % 24; i++) await page.keyboard.press(d > 0 ? 'ArrowRight' : 'ArrowLeft');
}
// Particle-blind picture difference: mean |RGB| over 16 x 16 px BLOCK AVERAGES. Wind streaks and crest ribbons are thin and
// moving, so they average out inside a block; the heatmap's colour field does not.
const BLOCK = 16;
function blocks(buf) {
  const im = P.decodePng(buf); const ch = im.bpp || im.channels || 4; const bw = Math.floor(im.width / BLOCK), bh = Math.floor(im.height / BLOCK);
  const out = new Float64Array(bw * bh * 3);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let r = 0, g = 0, b = 0;
    for (let y = by * BLOCK; y < (by + 1) * BLOCK; y++) for (let x = bx * BLOCK; x < (bx + 1) * BLOCK; x++) {
      const i = (y * im.width + x) * ch; r += im.data[i]; g += im.data[i + 1]; b += im.data[i + 2];
    }
    const k = (by * bw + bx) * 3, n = BLOCK * BLOCK; out[k] = r / n; out[k + 1] = g / n; out[k + 2] = b / n;
  }
  return out;
}
// Weather requests by kind (wind /grid and /grid_series counted apart), plus when the first of each started and how long it took
// (ms since the page's launch clock): the request diet's "calls per map open" and "did the first /grid wait for /products".
function netSummary(reqs) {
  const byPath = {};
  for (const q of reqs) { const k = `${q.path}${q.q && q.q.domain === 'wind' ? '#wind' : ''}`; byPath[k] = (byPath[k] || 0) + 1; }
  const first = (k) => { const q = reqs.filter((x) => `${x.path}${x.q && x.q.domain === 'wind' ? '#wind' : ''}` === k).sort((a, b) => a.t - b.t)[0];
    return q ? { t: q.t, ms: q.ms } : null; };
  return { n: reqs.length, byPath, firstProducts: first('/products'), firstGrid: first('/grid'), firstSeries: first('/grid_series') };
}
function mad(a, b) {
  if (!a || !b) return null;
  const x = blocks(a), y = blocks(b); const n = Math.min(x.length, y.length);
  let s = 0; for (let i = 0; i < n; i++) s += Math.abs(x[i] - y[i]);
  return +(s / n).toFixed(2);
}

// ---- the owner's flows ----
const FLOWS = {
  // The heatmap layers are exclusive (turning Wind on turns Waves off), so ICON waves and ICON wind are separate flows,
  // scrubbed like the owner did: hours, days, long jumps, Home.
  icon_waves_scrub: { setup: { model: 'ICON', layers: ['waves'] }, view: [-80, 25, 3.5],
    steps: [['+3h', 3], ['+6h', 6], ['+18h', 18], ['+26h', 26], ['+42h', 42], ['+82h', 82], ['+115h', 115], ['Home', 0]] },
  icon_wind_scrub: { setup: { model: 'ICON', layers: ['wind'] }, view: [-80, 25, 3.5],
    steps: [['+3h', 3], ['+6h', 6], ['+18h', 18], ['+26h', 26], ['+42h', 42], ['+82h', 82], ['+115h', 115], ['Home', 0]] },
  // switching marine layers while a future hour is selected (the "after switching layer it stopped" report).
  layer_switch_future: { setup: { model: 'ICON', layers: ['waves'], hour: 26 }, view: [-80, 25, 3.5],
    steps: [['Swell', { layer: 'swell_1' }], ['Swell 2', { layer: 'swell_2' }], ['+3h on Swell 2', 29], ['Wind Waves', { layer: 'wind_waves' }], ['Waves', { layer: 'waves' }]] },
  // model switches at a fixed future hour.
  model_switch_future: { setup: { model: 'GFS', layers: ['waves'], hour: 48 }, view: [-80, 25, 3.5],
    steps: [['ICON', { model: 'ICON' }], ['EURO', { model: 'EURO' }], ['GFS', { model: 'GFS' }]] },
  // pan and zoom while a future hour is selected.
  // the owner's erratic session (2026-10-19 21:20Z console): long scrubs, model and layer switches, wind, pan/zoom, fast toggles.
  erratic: { setup: { model: 'GFS', layers: ['waves'] }, view: [-75, 30, 3],
    steps: [['+5h', 5], ['+45h', 45], ['+131h', 131], ['EURO', { model: 'EURO' }], ['Wind Waves', { layer: 'wind_waves' }], ['+153h', 153],
      ['ICON', { model: 'ICON' }], ['Swell 2', { layer: 'swell_2' }], ['+165h', 165], ['zoom 8', { view: [-80, 27, 8] }], ['pan', { view: [-76, 28, 8] }],
      ['zoom out 3', { view: [-75, 30, 3] }], ['Waves', { layer: 'waves' }], ['GFS', { model: 'GFS' }], ['+12h', 12], ['Swell', { layer: 'swell_1' }], ['Waves again', { layer: 'waves' }]] },
  // ONE-HOUR steps on 3-hourly data (2026-10-20, request diet): offsets 2, 3 and 4 ask for the same instant, as do 5 and 6, so the
  // client that keys its exact /grid cache by hour offset fetches the same world grid again.
  hour_steps: { setup: { model: 'GFS', layers: ['waves'] }, view: [-80, 25, 3.5],
    steps: [['+1h', 1], ['+2h', 2], ['+3h', 3], ['+4h', 4], ['+5h', 5], ['+6h', 6], ['+7h', 7], ['back +3h', 3]] },
  // EURO one-hour steps across its 48 h page boundary: EURO pages are never prewarmed (per-hour Copernicus work), so the steps
  // past hour 48 hit no page unless the step asks for it.
  euro_steps: { setup: { model: 'EURO', layers: ['waves'], hour: 44 }, view: [-80, 25, 3.5],
    steps: [['+45h', 45], ['+46h', 46], ['+47h', 47], ['+48h', 48], ['+49h', 49], ['+50h', 50], ['+51h', 51], ['+52h', 52], ['+53h', 53], ['+54h', 54]] },
  // REGIONAL one-hour steps across GFS's 144 h page boundary: at a regional zoom the series frame is full detail, so a step into a page
  // no request has loaded yet costs a /grid per hour until that page lands.
  regional_page_steps: { setup: { model: 'GFS', layers: ['waves'], hour: 140 }, view: [-80, 27.5, 7.5],
    steps: [['+141h', 141], ['+142h', 142], ['+143h', 143], ['+144h', 144], ['+145h', 145], ['+146h', 146], ['+147h', 147], ['+148h', 148], ['+149h', 149], ['+150h', 150]] },
  // A map open and nothing else (2026-10-20, request diet): the load's request mix, read from the flow's loadNet / net.
  open_waves: { setup: { model: 'GFS', layers: ['waves'] }, view: [-80, 25, 3.5], steps: [], settleMs: 20000 },
  open_wind: { setup: { model: 'GFS', layers: ['wind'] }, view: [-80, 25, 3.5], steps: [], settleMs: 20000 },
  pan_zoom_future: { setup: { model: 'ICON', layers: ['waves'], hour: 24 }, view: [-80, 25, 3.5],
    steps: [['zoom 6', { view: [-80, 26, 6] }], ['zoom 8', { view: [-80, 26, 8] }], ['pan east', { view: [-77, 26, 8] }], ['zoom out 4', { view: [-80, 25, 4] }], ['+3h after zoom', 27]] },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const which = (process.env.FLOWS || Object.keys(FLOWS).join(',')).split(',');
  const size = VIEW === 'phone' ? { width: 390, height: 844, dpr: 3 } : { width: 1280, height: 800, dpr: 1 };
  const results = { env: { PORT, VIEW, LAT_SERIES, LAT_GRID, LAT_PRODUCTS, kills: process.env.LAB_KILLS || '', flags: process.env.LAB_FLAGS || '', live: process.env.AB_LIVE === '1', startedUtc: new Date().toISOString() }, flows: [] };
  for (const name of which) {
    const flow = FLOWS[name]; if (!flow) continue;
    const LIVE = process.env.LAB_LIVE_BASE;   // e.g. http://localhost:3009: dev server on the LIVE backend, set up as the nightly does
    // SERVED vs ASKED per marine /grid reply (2026-10-21, marineConformServed.js): the reply's valid_time echoes the ask and
    // served_valid_time names the frame served. Where they differ, a reader of the engine's grid decides differently by which one
    // it is handed, so this counts the cases the conform A/B can show at all (both arms: read off the wire, not the app).
    const gridServed = [];
    const { browser, page, log } = LIVE ? await liveLaunch(LIVE, size) : await L.launch({ port: PORT, ...size, hooks: { beforeWeather: async (url) => {
      const d = url.pathname.endsWith('/grid_series') ? LAT_SERIES : url.pathname.endsWith('/grid') ? LAT_GRID
        : url.pathname.endsWith('/products') ? LAT_PRODUCTS : 0; if (d) await sleep(d); },
    afterWeather: async (url, resp) => {
      if (url.searchParams.get('domain') === 'wind' || resp.status() !== 200) return;
      const off = (x) => { const a = Date.parse(x.valid_time || ''), s = Date.parse(x.served_valid_time || ''); return Number.isFinite(a) && Number.isFinite(s) ? (s - a) / 3600000 : null; };
      const base = { t: Date.now(), model: url.searchParams.get('model'), layer: url.searchParams.get('layer') };
      if (url.pathname.endsWith('/grid')) {
        const j = await resp.json();
        gridServed.push({ ...base, kind: 'grid', offH: off(j), substituted: !!j.frame_substituted, noServed: !j.served_valid_time });
      } else if (url.pathname.endsWith('/grid_series')) {   // a series frame's valid_time is the hour it was ASKED for, too
        const j = await resp.json();
        for (const f of (j.frames || [])) gridServed.push({ ...base, kind: 'series', offH: off(f), substituted: !!f.frame_substituted, noServed: !f.served_valid_time });
      }
    } } });
    if (process.env.LAB_KILLS) await page.addInitScript((ks) => { ks.forEach((k) => { window[k] = true; }); }, process.env.LAB_KILLS.split(','));   // A/B: kill switches set before the app boots
    // LAB_FLAGS: other window flags set true before boot, the same in both arms (e.g. __SURF_MODE__: the rating overlay on, whose spot
    // lookups resolve valid times before the manifest lands, as the live app's spot hubs and glyphs do).
    if (process.env.LAB_FLAGS) await page.addInitScript((ks) => { ks.forEach((k) => { window[k] = true; }); }, process.env.LAB_FLAGS.split(','));
    await page.addInitScript(PROBE, Object.fromEntries(Object.entries(PATTERNS).map(([k, v]) => [k, v.source])));
    await page.addInitScript(LOAD_PROBE);
    // Console patterns counted from Node (page.on('console')): independent of any in-page console override.
    // Weather requests as the page STARTS them (the harness log only holds finished ones, so a request still in flight at the end of a
    // flow, e.g. a slow /products, would be missed): path, query and ms since the flow's launch.
    const started = []; const tStart = Date.now();
    page.on('request', (rq) => { try { const u = new URL(rq.url()); if (!/\/api\/weather\//.test(u.pathname) || /client-diagnostics/.test(u.pathname)) return;
      started.push({ t: Date.now() - tStart, path: u.pathname.replace(/^\/api\/weather/, ''), q: Object.fromEntries(u.searchParams) }); } catch (e) { /* data: */ } });
    const ccount = Object.fromEntries(Object.keys(PATTERNS).map((k) => [k, 0]));
    page.on('console', (m) => { const t = m.text(); for (const k in PATTERNS) if (PATTERNS[k].test(t)) ccount[k]++; });
    if (process.env.LAB_CONSOLE) { const cf = path.join(OUT, `console-${name}.txt`); fs.mkdirSync(OUT, { recursive: true }); const re = new RegExp(process.env.LAB_CONSOLE); page.on('console', (m) => { const t = m.text(); if (re.test(t)) fs.appendFileSync(cf, `${Date.now()} ${t.slice(0, 300)}
`); }); }   // LAB_CONSOLE=<regex>: matching lines to OUT/console-<flow>.txt
    const cdp = process.env.LAB_TRACE === '1' && name === which[0] ? await page.context().newCDPSession(page) : null;
    const traceChunks = [];
    if (cdp) { cdp.on('Tracing.dataCollected', (e) => traceChunks.push(...e.value)); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: +(process.env.LAB_SAMPLE_US || 250) }); await cdp.send('Profiler.start'); await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8.execute,disabled-by-default-devtools.timeline.frame,toplevel,blink.user_timing,v8,disabled-by-default-v8.cpu_profiler,disabled-by-default-v8.gc' }); }
    const fr = { name, steps: [] };
    try {
      if (LIVE) { await page.goto(LIVE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 }); await require('../zoomlab-harness.cjs').waitForMarineReady(page); await page.evaluate(() => { const d = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Decline'); if (d) d.click(); }); }
      else await L.openMap(page);
      await L.jump(page, ...flow.view);
      if (VIEW === 'phone') { const exp = page.locator('button[aria-label="Weather layers"], button[aria-label="Expand weather controls"]').filter({ visible: true }).first(); if (await exp.count()) await exp.evaluate((el) => el.click()); await sleep(800); }
      for (const l of flow.setup.layers) await ensureLayer(page, l, true);
      if (flow.setup.model && !(await pressed(page, flow.setup.model))) await clickExact(page, flow.setup.model);
      await sleep(flow.settleMs || 9000);
      fr.setupPressed = await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => (b.textContent || '').trim()).filter(Boolean));
      fr.load = await page.evaluate(() => ({ ...window.__LAB_LOAD__, windBatchNow: (window.__RAW_GPU__ && window.__RAW_GPU__.shaderBatch && window.__RAW_GPU__.shaderBatch.wind) || null }));
      fr.loadNet = netSummary(log.requests); fr.loadStarted = netSummary(started);
      fr.loadServedOff = Object.fromEntries(['grid', 'series'].map((k) => { const g = gridServed.filter((x) => x.kind === k);
        return [k, { n: g.length, off: g.filter((x) => x.offH).length, offH: [...new Set(g.filter((x) => x.offH).map((x) => x.offH))] }]; }));
      fr.loadList = log.requests.map((q) => [q.path, q.t, q.ms, q.q && q.q.hours ? q.q.hours.split(',').length : null, q.q && q.q.domain]);
      console.log(name, 'load', JSON.stringify(fr.load), JSON.stringify(fr.loadNet));
      if (flow.setup.hour) { await seek(page, flow.setup.hour); await sleep(6000); }
      const clip = { x: Math.round(size.width * 0.15), y: Math.round(size.height * 0.2), width: Math.round(size.width * 0.7), height: Math.round(size.height * 0.45) };
      let state = { model: flow.setup.model, layer: flow.setup.layers.find((l) => l !== 'wind') || null, hour: flow.setup.hour || 0, wind: flow.setup.layers.includes('wind') };
      let prevSettled = await page.screenshot({ clip });
      for (const [label, act] of flow.steps) {
        const next = { ...state };
        if (typeof act === 'number') next.hour = act; else Object.assign(next, act.layer ? { layer: act.layer } : {}, act.model ? { model: act.model } : {});
        // Step marker for CPU profiles: a uniquely NAMED function that runs ~4 ms, so stall_profile.js can pin each stall to a step.
        if (cdp) await page.evaluate((nm) => { const f = new Function(`return function ${nm}(){const t=performance.now();while(performance.now()-t<4){}}`)(); f(); }, `LABSTEP_${fr.steps.length}_${label.replace(/[^A-Za-z0-9]/g, '_')}`);
        await page.evaluate((e) => window.__LAB__.arm(e), { marine: !!next.layer, wind: next.wind, hour: next.hour, layer: next.layer, model: next.model });
        const r0 = log.requests.length; const cc0 = { ...ccount }; const g0 = gridServed.length;
        if (typeof act === 'number') await seek(page, act);
        else if (act.layer) await clickExact(page, LABEL[act.layer]);
        else if (act.model) await clickExact(page, act.model);
        else if (act.view) await L.jump(page, ...act.view);
        if (typeof act !== 'number') await page.evaluate(() => { window.__LAB__.step.tIn = performance.now(); });
        await sleep(150);
        const immediate = await page.screenshot({ clip });
        const immediateJpg = await page.screenshot({ clip, type: 'jpeg', quality: 55, scale: 'css' });   // report thumbnail (PNG stays for metrics)
        const t0 = Date.now(); let r;
        do { await sleep(150); r = await page.evaluate(() => window.__LAB__.read()); }
        while (((next.layer && (r.mOk == null || (WAIT_EXACT && r.mExact == null))) || (next.wind && r.wOk == null)) && Date.now() - t0 < WIN);
        await sleep(600);
        r = await page.evaluate(() => { const x = window.__LAB__.read(); window.__LAB__.step.done = true; return x; });
        const settled = await page.screenshot({ clip });
        await sleep(400);
        const settled2 = await page.screenshot({ clip });                 // noise floor: same state, 400 ms later (animation only)
        const settledJpg = await page.screenshot({ clip, type: 'jpeg', quality: 55, scale: 'css' });
        const reqs = log.requests.slice(r0);
        const urls = reqs.map((q) => `${q.path}?${new URLSearchParams(q.q || {}).toString()}`);
        const dupes = urls.length - new Set(urls).size;
        const toPrev = mad(immediate, prevSettled), toNow = mad(immediate, settled), moved = mad(prevSettled, settled), noise = mad(settled, settled2);
        // STALE only when the step visibly changed the picture (well above the animation noise) and the 150 ms picture still
        // looked like the previous step's; 'n/a' when the step barely changed the field (a nearest-frame hold looks identical).
        const staleVerdict = (moved == null || noise == null || moved < Math.max(1.0, noise * 3)) ? 'n/a'
          : (toPrev < toNow ? 'STALE' : 'ok');
        const row = { label, expect: { hour: next.hour, layer: next.layer, model: next.model, wind: next.wind },
          marineMs: !next.layer ? 'n/a' : (r.mOk == null ? null : Math.round(r.mOk)),
          exactMs: !next.layer ? 'n/a' : (r.mExact == null ? null : Math.round(r.mExact)), windMs: !next.wind ? 'n/a' : (r.wOk == null ? null : Math.round(r.wOk)),
          marineSilent: r.mSilent, marineAdmitted: r.mAdm, marineSameInstant: r.mSameInstant, windOffFrames: r.wOff,
          dim: { staleMs: Math.round(r.dimStale), softMs: Math.round(r.dimSoft), minMult: +(+r.minMult).toFixed(2) },
          stale: staleVerdict, pixels: { toPrev, toNow, moved, noise },
          end: { mHour: r.end.mHour, mLayer: r.end.mLayer, mModel: r.end.mModel, mStride: r.end.mStride, mCols: r.end.mCols, wHour: r.end.wHour, status: r.end.status,
            mServed: r.end.mServed, mAsk: r.end.mAsk, drawnDataMs: r.end.drawn ? r.end.drawn.dataMs : null },
          // marine /grid replies in the step whose served frame is not the asked instant (offH = served - ask, hours)
          servedOff: (() => { const sum = (g) => ({ n: g.length, off: g.filter((x) => x.offH).length, offH: [...new Set(g.filter((x) => x.offH).map((x) => x.offH))],
            substituted: g.filter((x) => x.substituted).length, noServed: g.filter((x) => x.noServed).length });
            const g = gridServed.slice(g0); return { grid: sum(g.filter((x) => x.kind === 'grid')), series: sum(g.filter((x) => x.kind === 'series')) }; })(),
          dimAt: r.dimAt || null,
          console: Object.fromEntries(Object.keys(ccount).map((k) => [k, ccount[k] - cc0[k]])), requests: { n: reqs.length, series: reqs.filter((q) => q.path === '/grid_series').length, grid: reqs.filter((q) => q.path === '/grid').length,
            products: reqs.filter((q) => q.path === '/products').length,
            wind: reqs.filter((q) => (q.q && q.q.domain === 'wind') || /wind/.test(q.path)).length, dupes, failed: reqs.filter((q) => q.error || (q.status && q.status >= 400)).length },
          requestList: reqs.slice(0, 20).map((q) => ({ t: q.t, ms: q.ms, path: q.path, model: q.q && q.q.model, domain: q.q && q.q.domain, layer: q.q && q.q.layer, vt: q.q && q.q.valid_time, bbox: q.q && q.q.bbox, h0: q.q && q.q.hours ? q.q.hours.split(',')[0] : undefined, nh: q.q && q.q.hours ? q.q.hours.split(',').length : undefined, status: q.status })),
          pacing: { gaps50: r.gaps, maxGap: Math.round(r.maxGap), longtasks: r.ltN, ltMax: r.ltMax },
          shots: { immediate: immediateJpg.toString('base64'), settled: settledJpg.toString('base64') } };
        fr.steps.push(row);
        console.log(name, JSON.stringify({ ...row, shots: undefined }));
        prevSettled = settled; state = next;
      }
      // The request diet's own counters (marineRequestDiet.js) and the exact upgrade's, read at the end of the flow.
      fr.telemetry = await page.evaluate(() => ({ diet: window.__MARINE_REQUEST_DIET__ || null,
        exactUpgrade: window.__MARINE_EXACT_UPGRADE__ ? { triggers: window.__MARINE_EXACT_UPGRADE__.triggers, kept: window.__MARINE_EXACT_UPGRADE__.kept || 0 } : null,
        seriesHits: window.__MARINE_SCRUBSETTLE_SERIESHIT__ || 0 })).catch(() => null);
    } catch (e) { fr.error = String(e && e.message || e).slice(0, 300); console.error('flow failed', name, fr.error); }
    finally {
      if (cdp) { const prof = await cdp.send('Profiler.stop').catch(() => null); if (prof) fs.writeFileSync(path.join(OUT, 'profile.json'), JSON.stringify(prof.profile)); const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res)); await cdp.send('Tracing.end'); await Promise.race([done, sleep(20000)]); fs.writeFileSync(path.join(OUT, 'trace.json'), JSON.stringify({ traceEvents: traceChunks })); }
      fr.errors = log.errors.slice(0, 10); fr.blockedWs = log.blockedWs.length; fr.net = netSummary(log.requests); fr.started = netSummary(started);
      results.flows.push(fr); await browser.close();
    }
  }
  const lean = JSON.parse(JSON.stringify(results)); lean.flows.forEach((f) => f.steps.forEach((s) => { delete s.shots; }));
  fs.writeFileSync(path.join(OUT, 'lab.json'), JSON.stringify(lean, null, 1));
  fs.writeFileSync(path.join(OUT, 'report.html'), require('./report.js').render(results));
  console.log('report:', path.join(OUT, 'report.html'));
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
