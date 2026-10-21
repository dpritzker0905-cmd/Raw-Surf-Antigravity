// SETTLE TRACE (2026-10-21, SETTLE_LIVE_MAP / SETTLE_ARM_ON_ACTIVATE): what the scrub-settle check did during a marine layer's
// FIRST load, per arm, on one bundle (offline only: the real backend app over synthetic data, ../offline-backend).
//
// Per run it opens the map, switches Waves on (GFS), optionally moves the map during the load, waits SETTLE_MS and keeps:
//   checks    window.__MARINE_SETTLE_CHECK__ (marineSettleLiveMap.js): every settle check, which map it read ('live' = the
//             memoised map was null and the live one was used; 'none' = no map), and the commit lane or fetch reason it produced
//   liveLines the `[SETTLE-LIVE]` console lines (checks made while the memoised map was null), page ms
//   draw      the first heat-map draw (__RAW_GPU__.opacity.n >= 1) and the first EXACT frame resident (not a world grid coarser
//             than 2.5 deg a cell, the stride-4 placeholder), ms since navigation and since Waves was clicked, with the engine
//             grid's commit lane, size and hour
//   requests  weather requests by START (page.on('request'), so a request still in flight at the end counts), by kind
//   counters  the settle branches' own counters (exact upgrade, series hits, engine-empty recoveries, sharpen commits, backstop)
//
// Run (from frontend/, a production build served by serve_spa.js, serve_synthetic.py on PORT):
//   AB_BASE=http://127.0.0.1:3197 AB_DIAG=1 PORT=4197 LAT_PRODUCTS=6000 LAT_SERIES=2500 LAT_GRID=1500 RUNS=3 \
//     SCN=open OUT=settle-out node scripts/visual-lab/settle_trace.js
// ARMS: comma list of name:kill+kill (default A = both kills, B = none, interleaved A1 B1 A2 B2 ...). SCN: open (world view),
// open_pan (pans 1.5 s after Waves is clicked, before the first commit), open_regional (opens at zoom 7.5).
// FAIL_GRID=1 answers every marine /grid with a 502 (a box that cannot build the exact frame): the settle check is then the safety
// net that should draw the series frame that did land, which is where a check without a map fell through to another /grid.
const fs = require('fs');
const path = require('path');
const L = require('../offline-backend/ab_lib.js');

const PORT = +(process.env.PORT || 4103);
const OUT = path.resolve(process.env.OUT || 'settle-trace-out');
const RUNS = +(process.env.RUNS || 3);
const SETTLE_MS = +(process.env.SETTLE_MS || 20000);
const SCN = process.env.SCN || 'open';
const LAT = { products: +(process.env.LAT_PRODUCTS || 0), series: +(process.env.LAT_SERIES || 0), grid: +(process.env.LAT_GRID || 0) };
const FAIL_GRID = process.env.FAIL_GRID === '1';
const ARMS = (process.env.ARMS || 'A:__RAW_DISABLE_SETTLE_LIVE_MAP__+__RAW_DISABLE_SETTLE_ARM_ON_ACTIVATE__,B:').split(',')
  .map((s) => { const [name, ks] = s.split(':'); return { name, kills: (ks || '').split('+').filter(Boolean) }; });
const VIEWS = { open: [-80, 25, 3.5], open_pan: [-80, 25, 3.5], open_regional: [-80, 27.5, 7.5] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// In-page: per animation frame until 60 s, the first heat-map draw, the first exact frame, and each change of the resident grid.
const PROBE = () => {
  const P = (window.__SETTLE_PROBE__ = { firstDraw: null, firstExact: null, grids: [] });
  let last = null;
  const tick = () => {
    const t = Math.round(performance.now());
    const g = window.__RAW_GPU__;
    const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const mg = d && d.waveGrid;
    let snap = null;
    if (mg && mg.bounds && mg.cols > 1) {
      const b = mg.bounds; const span = b.east < b.west ? b.east + 360 - b.west : b.east - b.west;
      const cell = span / (mg.cols - 1);
      snap = { t, cols: mg.cols, rows: mg.rows, hour: mg.hourOffset, lane: mg.__commitLane || null, series: !!mg.__fromSeries,
        span: Math.round(span), cell: +cell.toFixed(2), thin: span >= 340 && cell > 2.5 };
      const sig = `${snap.cols}x${snap.rows}|${snap.hour}|${snap.lane}|${snap.span}`;
      if (sig !== last) { last = sig; if (P.grids.length < 60) P.grids.push(snap); }
    }
    if (!P.firstDraw && g && g.opacity && g.opacity.n >= 1) P.firstDraw = { t, grid: snap };
    if (!P.firstExact && P.firstDraw && snap && !snap.thin) P.firstExact = { t, grid: snap };
    if (performance.now() < 60000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

function kindOf(q) { return `${q.path}${q.q && q.q.domain === 'wind' ? '#wind' : ''}`; }
function byKind(list) { const o = {}; for (const q of list) o[kindOf(q)] = (o[kindOf(q)] || 0) + 1; return o; }

async function clickButton(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 }); await loc.evaluate((el) => el.click());
}
async function pressed(page, text) {
  return page.evaluate((t) => [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => (b.textContent || '').trim() === t), text);
}

async function runOnce(arm, run) {
  const { browser, page, log } = await L.launch({ port: PORT, hooks: { beforeWeather: async (url) => {
    const p = url.pathname; const d = p.endsWith('/grid_series') ? LAT.series : p.endsWith('/grid') ? LAT.grid : p.endsWith('/products') ? LAT.products : 0;
    if (d) await sleep(d);
    if (FAIL_GRID && p.endsWith('/grid') && url.searchParams.get('domain') !== 'wind') throw new Error('injected /grid failure');   // ab_lib answers 502
  } } });
  if (arm.kills.length) await page.addInitScript((ks) => { ks.forEach((k) => { window[k] = true; }); }, arm.kills);
  await page.addInitScript(PROBE);
  const liveLines = []; const started = [];
  let origin = null;   // performance.timeOrigin of the page, to put Node-side stamps on the page clock
  const pageMs = () => (origin ? Math.round(Date.now() - origin) : null);
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('[SETTLE-LIVE]')) liveLines.push({ t: pageMs(), line: t }); });
  page.on('request', (rq) => { try { const u = new URL(rq.url()); if (!/\/api\/weather\//.test(u.pathname) || /client-diagnostics/.test(u.pathname)) return;
    started.push({ t: pageMs(), path: u.pathname.replace(/^\/api\/weather/, ''), q: Object.fromEntries(u.searchParams) }); } catch (e) { /* data: */ } });
  const r = { arm: arm.name, kills: arm.kills, run, scn: SCN };
  try {
    await L.openMap(page);
    origin = await page.evaluate(() => performance.timeOrigin);
    await L.jump(page, ...VIEWS[SCN]);
    await sleep(1500);
    r.tActivate = await page.evaluate(() => Math.round(performance.now()));
    if (!(await pressed(page, 'Waves'))) await clickButton(page, 'Waves');
    if (!(await pressed(page, 'GFS'))) await clickButton(page, 'GFS');
    if (SCN === 'open_pan') { await sleep(1500); r.tPan = await page.evaluate(() => Math.round(performance.now())); await L.jump(page, -70, 30, 3.5); }
    await sleep(SETTLE_MS);
    const s = await page.evaluate(() => ({
      probe: window.__SETTLE_PROBE__, checks: window.__MARINE_SETTLE_CHECK__ || null,
      counters: { exactUpgrade: (window.__MARINE_EXACT_UPGRADE__ || {}).triggers || 0, seriesHits: window.__MARINE_SCRUBSETTLE_SERIESHIT__ || 0,
        emptyRecover: window.__MARINE_ENGINE_EMPTY_RECOVER__ || 0, sharpen: window.__MARINE_GRIDMISMATCH_COUNT__ || 0,
        backstop: window.__MARINE_BLANK_BACKSTOP_COUNT__ || 0, clampGiveUp: window.__MARINE_CLAMP_GIVEUP_COUNT__ || 0 },
    }));
    Object.assign(r, s);
    const rel = (x) => (x && r.tActivate != null ? x.t - r.tActivate : null);
    r.drawMs = rel(s.probe.firstDraw); r.exactMs = rel(s.probe.firstExact);
  } catch (e) { r.error = String((e && e.message) || e).slice(0, 300); }
  finally {
    r.liveLines = liveLines;
    const marine = started.filter((q) => !(q.q && q.q.domain === 'wind'));
    r.started = { n: started.length, byKind: byKind(started), list: marine.map((q) => [q.path, q.t, q.q.hours ? q.q.hours.split(',').length : null, q.q.bbox || null]) };
    const fin = log.requests.filter((q) => !(q.q && q.q.domain === 'wind'));
    r.finished = fin.map((q) => [q.path, q.t, q.ms, q.status]);
    r.errors = log.errors.length; r.blockedWs = log.blockedWs.length; r.failedRequests = log.requests.filter((q) => q.error).length;
    await browser.close();
  }
  return r;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const results = { env: { PORT, SCN, RUNS, SETTLE_MS, LAT, FAIL_GRID, arms: ARMS, base: L.BASE, startedUtc: new Date().toISOString() }, runs: [] };
  const tag = `${SCN}${FAIL_GRID ? '-failgrid' : ''}`;
  for (let run = 1; run <= RUNS; run++) {
    for (const arm of ARMS) {
      const r = await runOnce(arm, run);
      results.runs.push(r);
      console.log(JSON.stringify({ arm: r.arm, run, scn: SCN, drawMs: r.drawMs, exactMs: r.exactMs, firstLane: r.probe && r.probe.firstDraw && r.probe.firstDraw.grid && r.probe.firstDraw.grid.lane,
        checks: r.checks && r.checks.counts, live: r.liveLines.length, started: r.started.byKind, counters: r.counters, error: r.error }));
      fs.writeFileSync(path.join(OUT, `settle-trace-${tag}.json`), JSON.stringify(results, null, 1));
    }
  }
})();
