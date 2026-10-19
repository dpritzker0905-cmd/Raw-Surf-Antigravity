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
// Env: FLOWS (comma list, default all), VIEW (desktop|phone), LAT_SERIES / LAT_GRID (ms injected per request), LAB_TRACE=1.
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
      mSeries: !!(mg && mg.__fromSeries), drawn: window.__MARINE_DRAWN__ || null,
      wHour: wg ? (wg.hourOffset || 0) : null, wModel: wg ? (wg.__sourceModel || wg.model || null) : null,
      status };
  };
  let prev = null;
  const loop = (t) => {
    const S = W.step;
    if (S && !S.done) {
      const s = W.snap();
      if (prev != null) { const dt = t - prev; S.frames++; if (dt > 50) S.gaps++; if (dt > S.maxGap) S.maxGap = dt; }
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
  W.arm = (expect) => { W.step = { expect, tIn: null, mOk: null, wOk: null, mSilent: 0, mAdm: 0, wOff: 0, frames: 0, gaps: 0, maxGap: 0,
    lt0: W.lt.length, c0: { ...W.counts }, mSameInstant: 0 }; };
  W.read = () => { const S = W.step; const lt = W.lt.slice(S.lt0);
    const counts = Object.fromEntries(Object.keys(W.counts).map((k) => [k, W.counts[k] - (S.c0[k] || 0)]));
    return { ...S, counts, ltN: lt.length, ltMax: Math.round(lt.reduce((a, x) => Math.max(a, x[1]), 0)), end: W.snap() }; };
};

// ---- helpers ----
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
  pan_zoom_future: { setup: { model: 'ICON', layers: ['waves'], hour: 24 }, view: [-80, 25, 3.5],
    steps: [['zoom 6', { view: [-80, 26, 6] }], ['zoom 8', { view: [-80, 26, 8] }], ['pan east', { view: [-77, 26, 8] }], ['zoom out 4', { view: [-80, 25, 4] }], ['+3h after zoom', 27]] },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const which = (process.env.FLOWS || Object.keys(FLOWS).join(',')).split(',');
  const size = VIEW === 'phone' ? { width: 390, height: 844, dpr: 3 } : { width: 1280, height: 800, dpr: 1 };
  const results = { env: { PORT, VIEW, LAT_SERIES, LAT_GRID, live: process.env.AB_LIVE === '1', startedUtc: new Date().toISOString() }, flows: [] };
  for (const name of which) {
    const flow = FLOWS[name]; if (!flow) continue;
    const { browser, page, log } = await L.launch({ port: PORT, ...size, hooks: { beforeWeather: async (url) => {
      const d = url.pathname.endsWith('/grid_series') ? LAT_SERIES : url.pathname.endsWith('/grid') ? LAT_GRID : 0; if (d) await sleep(d); } } });
    await page.addInitScript(PROBE, Object.fromEntries(Object.entries(PATTERNS).map(([k, v]) => [k, v.source])));
    // Console patterns counted from Node (page.on('console')): independent of any in-page console override.
    const ccount = Object.fromEntries(Object.keys(PATTERNS).map((k) => [k, 0]));
    page.on('console', (m) => { const t = m.text(); for (const k in PATTERNS) if (PATTERNS[k].test(t)) ccount[k]++; });
    const cdp = process.env.LAB_TRACE === '1' && name === which[0] ? await page.context().newCDPSession(page) : null;
    const traceChunks = [];
    if (cdp) { cdp.on('Tracing.dataCollected', (e) => traceChunks.push(...e.value)); await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8.execute,disabled-by-default-devtools.timeline.frame,toplevel,blink.user_timing' }); }
    const fr = { name, steps: [] };
    try {
      await L.openMap(page); await L.jump(page, ...flow.view);
      if (VIEW === 'phone') { const exp = page.locator('button[aria-label="Weather layers"], button[aria-label="Expand weather controls"]').filter({ visible: true }).first(); if (await exp.count()) await exp.evaluate((el) => el.click()); await sleep(800); }
      for (const l of flow.setup.layers) await ensureLayer(page, l, true);
      if (flow.setup.model && !(await pressed(page, flow.setup.model))) await clickExact(page, flow.setup.model);
      await sleep(9000);
      fr.setupPressed = await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => (b.textContent || '').trim()).filter(Boolean));
      if (flow.setup.hour) { await seek(page, flow.setup.hour); await sleep(6000); }
      const clip = { x: Math.round(size.width * 0.15), y: Math.round(size.height * 0.2), width: Math.round(size.width * 0.7), height: Math.round(size.height * 0.45) };
      let state = { model: flow.setup.model, layer: flow.setup.layers.find((l) => l !== 'wind') || null, hour: flow.setup.hour || 0, wind: flow.setup.layers.includes('wind') };
      let prevSettled = await page.screenshot({ clip });
      for (const [label, act] of flow.steps) {
        const next = { ...state };
        if (typeof act === 'number') next.hour = act; else Object.assign(next, act.layer ? { layer: act.layer } : {}, act.model ? { model: act.model } : {});
        await page.evaluate((e) => window.__LAB__.arm(e), { marine: !!next.layer, wind: next.wind, hour: next.hour, layer: next.layer, model: next.model });
        const r0 = log.requests.length; const cc0 = { ...ccount };
        if (typeof act === 'number') await seek(page, act);
        else if (act.layer) await clickExact(page, LABEL[act.layer]);
        else if (act.model) await clickExact(page, act.model);
        else if (act.view) await L.jump(page, ...act.view);
        if (typeof act !== 'number') await page.evaluate(() => { window.__LAB__.step.tIn = performance.now(); });
        await sleep(150);
        const immediate = await page.screenshot({ clip });
        const immediateJpg = await page.screenshot({ clip, type: 'jpeg', quality: 55, scale: 'css' });   // report thumbnail (PNG stays for metrics)
        const t0 = Date.now(); let r;
        do { await sleep(150); r = await page.evaluate(() => window.__LAB__.read()); } while (((next.layer && r.mOk == null) || (next.wind && r.wOk == null)) && Date.now() - t0 < WIN);
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
          marineMs: !next.layer ? 'n/a' : (r.mOk == null ? null : Math.round(r.mOk)), windMs: !next.wind ? 'n/a' : (r.wOk == null ? null : Math.round(r.wOk)),
          marineSilent: r.mSilent, marineAdmitted: r.mAdm, marineSameInstant: r.mSameInstant, windOffFrames: r.wOff,
          stale: staleVerdict, pixels: { toPrev, toNow, moved, noise },
          end: { mHour: r.end.mHour, mLayer: r.end.mLayer, mModel: r.end.mModel, wHour: r.end.wHour, status: r.end.status },
          console: Object.fromEntries(Object.keys(ccount).map((k) => [k, ccount[k] - cc0[k]])), requests: { n: reqs.length, series: reqs.filter((q) => q.path === '/grid_series').length, grid: reqs.filter((q) => q.path === '/grid').length,
            wind: reqs.filter((q) => (q.q && q.q.domain === 'wind') || /wind/.test(q.path)).length, dupes, failed: reqs.filter((q) => q.error || (q.status && q.status >= 400)).length },
          pacing: { gaps50: r.gaps, maxGap: Math.round(r.maxGap), longtasks: r.ltN, ltMax: r.ltMax },
          shots: { immediate: immediateJpg.toString('base64'), settled: settledJpg.toString('base64') } };
        fr.steps.push(row);
        console.log(name, JSON.stringify({ ...row, shots: undefined }));
        prevSettled = settled; state = next;
      }
    } catch (e) { fr.error = String(e && e.message || e).slice(0, 300); console.error('flow failed', name, fr.error); }
    finally {
      if (cdp) { const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res)); await cdp.send('Tracing.end'); await Promise.race([done, sleep(20000)]); fs.writeFileSync(path.join(OUT, 'trace.json'), JSON.stringify({ traceEvents: traceChunks })); }
      fr.errors = log.errors.slice(0, 10); fr.blockedWs = log.blockedWs.length;
      results.flows.push(fr); await browser.close();
    }
  }
  const lean = JSON.parse(JSON.stringify(results)); lean.flows.forEach((f) => f.steps.forEach((s) => { delete s.shots; }));
  fs.writeFileSync(path.join(OUT, 'lab.json'), JSON.stringify(lean, null, 1));
  fs.writeFileSync(path.join(OUT, 'report.html'), require('./report.js').render(results));
  console.log('report:', path.join(OUT, 'report.html'));
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
