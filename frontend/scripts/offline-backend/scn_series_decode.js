// SERIES DECODE GATE (2026-11-15, docs/weather-program/log/2026-11-15-opus-series-decode-worker.md, gate 1 as amended 14:45Z).
// Offline only. Per session, one fresh browser: a cold map load, waves on, the series pages land, then a 10-step scrub (ArrowRight
// on the timeline wheel; the phone drawer opened first). Records the main-thread milliseconds in the series DECODE PATH, as the app
// counts them (window.__MARINE_SERIES_DIAG__.decodeMs / .decodes / .workerPages / .mainPages), and the long tasks (> 50 ms) that
// overlap a series page's arrival. Arms: the worker (default) vs the kill (__RAW_DISABLE_SERIES_DECODE_WORKER__).
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS --layers waves --dynamic 1 --port 4298
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3299
//   AB_BASE=http://127.0.0.1:3299 PORT=4298 OUT=out.jsonl node frontend/scripts/offline-backend/scn_series_decode.js
// Env: VIEW (phone | desktop), CPU (4: the CPU throttle), ZOOMS (2,6), RUNS (5 per arm per zoom), STEPS (10), CENTER (-75,30),
// MODEL (GFS), PAGES (3: series pages to wait for), ARMS (worker,kill; noric = worker with no requestIdleCallback).
if (process.env.AB_LIVE === '1') throw Error('scn_series_decode is offline only (never load the live box)');
const fs = require('fs');
const L = require('./ab_lib.js');

const PORT = +(process.env.PORT || 4298);
const OUT = process.env.OUT || 'series-decode.jsonl';
const VIEW = process.env.VIEW || 'phone';
const CPU = +(process.env.CPU || 4);
const ZOOMS = (process.env.ZOOMS || '2,6').split(',').map(Number);
const RUNS = +(process.env.RUNS || 5);
const STEPS = +(process.env.STEPS || 10);
const PAGES = +(process.env.PAGES || 3);
const MODEL = process.env.MODEL || 'GFS';
const [CLNG, CLAT] = (process.env.CENTER || '-75,30').split(',').map(Number);
const ARMS = (process.env.ARMS || 'worker,kill').split(',');
// noric (2026-11-15, the advisor): the worker arm with requestIdleCallback removed before boot (Safari on iOS has none), so no build-ahead.
const FLAGS = { worker: {}, kill: { __RAW_DISABLE_SERIES_DECODE_WORKER__: true }, noric: { __NO_RIC__: true } };
const VP = {
  desktop: { width: 1280, height: 800, dpr: 1, contextOptions: {} },
  phone: { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout, every = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await fn()) return Date.now() - t0; await sleep(every); }
  return null;
}

// Load record (census log 20:20Z): the machine's total CPU %, 1 s samples, for the session.
function cpuSampler() {
  // The machine's total CPU busy %, from os.cpus() tick deltas every 1 s (typeperf has no valid counters on this machine).
  const os = require('os'); const xs = [];
  const snap = () => os.cpus().reduce((a, c) => { const t = c.times; a.busy += t.user + t.nice + t.sys + t.irq; a.all += t.user + t.nice + t.sys + t.irq + t.idle; return a; }, { busy: 0, all: 0 });
  let last = snap();
  const iv = setInterval(() => { const n = snap(); const d = n.all - last.all; if (d > 0) xs.push(+(100 * (n.busy - last.busy) / d).toFixed(1)); last = n; }, 1000);
  return { stop() { clearInterval(iv); const s = [...xs].sort((a, b) => a - b); return { n: s.length, mean: s.length ? +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1) : null, p90: s.length ? s[Math.floor(0.9 * (s.length - 1))] : null }; } };
}
const CALIBRATE = () => { const t0 = performance.now(); let h = 0x811c9dc5; for (let i = 0; i < 20000000; i += 1) { h ^= i; h = Math.imul(h, 0x01000193) >>> 0; } window.__CAL_SINK__ = h; return +(performance.now() - t0).toFixed(1); };

async function session(arm, zoom, run) {
  const vp = VP[VIEW];
  const { browser, page } = await L.launch({ port: PORT, width: vp.width, height: vp.height, dpr: vp.dpr, contextOptions: vp.contextOptions });
  const res = { arm, zoom, run, view: VIEW, cpu: CPU, model: MODEL, at: new Date().toISOString() };
  try {
    await page.addInitScript((flags) => {
      for (const [k, v] of Object.entries(flags)) window[k] = v;
      if (flags.__NO_RIC__) { try { delete window.requestIdleCallback; delete window.cancelIdleCallback; window.requestIdleCallback = undefined; } catch (e) { /* none */ } }
      window.__SD__ = { lt: [], pages: [] };
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__SD__.lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* none */ }
    }, FLAGS[arm] || {});
    if (VIEW === 'phone' && CPU > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU }); }
    await page.goto(L.BASE + '/map', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.__MAP_INSTANCE__ || window.map), null, { timeout: 120000 });
    await sleep(1500);
    await page.evaluate((m) => window.setActiveModel && window.setActiveModel(m), MODEL);
    await L.jump(page, CLNG, CLAT, zoom);
    await page.evaluate(() => window.toggleLayer('waves'));   // a fresh browser starts with no layer on (useWeatherState)
    // the series pages land: watch the app's own load counter, stamping each arrival for the long-task overlap
    const landed = await waitFor(() => page.evaluate((n) => {
      const d = window.__MARINE_SERIES_DIAG__ || {}; const loads = d.loads || 0;
      while (window.__SD__.pages.length < loads) window.__SD__.pages.push(performance.now());
      return loads >= n;
    }, PAGES), 90000, 100);
    res.pagesLanded = landed !== null;
    await sleep(2000);
    // phone: the responsive timeline drawer is inert until opened (the raster lab's 2026-11-14 finding)
    await page.evaluate(() => {
      const body = document.getElementById('weather-mobile-timeline-body');
      if (!body || !body.inert) return;
      const h = [...document.querySelectorAll('button[aria-controls="weather-mobile-timeline-body"][aria-expanded="false"]')]
        .find((b) => b.offsetParent !== null && /Open timeline/.test(b.getAttribute('aria-label') || ''));
      if (h) h.click();
    });
    await sleep(800);
    const before = await page.evaluate(() => ({ ...(window.__MARINE_SERIES_DIAG__ || {}) }));
    let stepped = 0;
    const cpu = cpuSampler(); const calBefore = await page.evaluate(CALIBRATE);
    const stepBuildMs = [];   // gate 3 (amended): the decode-path ms each step added (the first-read build of the frame it shows)
    const readDecode = () => page.evaluate(() => (window.__MARINE_SERIES_DIAG__ || {}).decodeMs || 0);
    const readIdle = () => page.evaluate(() => (window.__MARINE_SERIES_DIAG__ || {}).idleDecodeMs || 0);
    const stepSyncMs = [];   // SECONDARY (not gating, 2026-11-15): stepBuildMs minus the idle-time builds in the same window
    for (let i = 0; i < STEPS; i += 1) {
      const w = page.locator('[role="slider"][aria-label*="timeline wheel"]').filter({ visible: true }).first();
      const d0 = await readDecode(); const i0 = await readIdle();
      if (await w.count()) { await w.focus().catch(() => {}); await page.keyboard.press('ArrowRight'); stepped += 1; }
      await sleep(900);
      const added = (await readDecode()) - d0;
      stepBuildMs.push(+added.toFixed(2));
      stepSyncMs.push(+(added - ((await readIdle()) - i0)).toFixed(2));
    }
    const calAfter = await page.evaluate(CALIBRATE); res.load = { calBefore, calAfter, cal: Math.max(calBefore, calAfter), cpu: cpu.stop() };
    res.stepBuildMs = stepBuildMs;
    res.stepSyncMs = stepSyncMs;
    const d = await page.evaluate(() => ({ diag: { ...(window.__MARINE_SERIES_DIAG__ || {}) }, lt: window.__SD__.lt, pages: window.__SD__.pages }));
    const overlap = (t) => d.pages.some((p) => t[0] <= p + 1000 && t[0] + t[1] >= p - 1000);   // a long task within 1 s of an arrival
    Object.assign(res, {
      stepped, loads: d.diag.loads || 0,
      decodeMs: +(d.diag.decodeMs || 0).toFixed(1), decodes: d.diag.decodes || 0,
      decodeMsAtLand: +(before.decodeMs || 0).toFixed(1), workerPages: d.diag.workerPages || 0, mainPages: d.diag.mainPages || 0,
      longTasks: d.lt.length, longTaskMs: Math.round(d.lt.reduce((s, t) => s + t[1], 0)),
      longTasksNearArrival: d.lt.filter(overlap).length, longTaskMsNearArrival: Math.round(d.lt.filter(overlap).reduce((s, t) => s + t[1], 0)),
    });
  } catch (e) { res.error = String(e && e.message || e).slice(0, 200); }
  await browser.close();
  return res;
}

(async () => {
  for (const zoom of ZOOMS) {
    for (let run = 0; run < RUNS; run += 1) {
      const arms = run % 2 ? [...ARMS].reverse() : ARMS;   // alternate which arm goes first
      for (const arm of arms) {
        const r = await session(arm, zoom, run);
        fs.appendFileSync(OUT, JSON.stringify(r) + '\n');
        console.log(`[${arm}] ${VIEW} z${zoom} run ${run}: decode ${r.decodeMs} ms (${r.decodes} decodes; worker ${r.workerPages} / main ${r.mainPages} pages; ${r.loads} loads)`
          + ` | cal ${r.load && r.load.cal} ms cpu ${r.load && r.load.cpu.mean}%` + ` | step build ms [${(r.stepBuildMs || []).join(',')}]`
          + ` | long tasks ${r.longTasks} (${r.longTaskMs} ms), near arrival ${r.longTasksNearArrival} (${r.longTaskMsNearArrival} ms) | stepped ${r.stepped}${r.error ? ' ERROR ' + r.error : ''}`);
      }
    }
  }
})();
