// What a layer / model switch and a pan/zoom cost on the main thread, split by the land-mask decision (offline only).
// Measurement-only instrumentation: wraps the engine's setWaveData in the page to time each call and read
// engine._lastMaskEncodeMode afterwards ('reuse' | 'retain_*' | 'rebuild*'). Nothing in the app changes.
//   PORT=4102 node scripts/offline-backend/scn_mask_cost.js
// THROTTLE=4 slows the page's CPU 4x (CDP Emulation.setCPUThrottlingRate), a mid-range phone's main thread. Each call row
// carries the grid bounds, so a rebuild can be traced to the bounds change that caused it (serve regional tiles with
// serve_synthetic.py --regions florida_east_coast,us_southeast_midatlantic, or every switch reuses the world mask).
const L = require('./ab_lib.js');
if (process.env.AB_LIVE === '1') throw Error('offline only');
const PORT = +(process.env.PORT || 4102);
const THROTTLE = +(process.env.THROTTLE || 1);
const WAIT_MS = +(process.env.WAIT_MS || 5000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LABEL = { waves: 'Waves', swell_1: 'Swell', swell_2: 'Swell 2', wind_waves: 'Wind Waves' };

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 }); await loc.evaluate((el) => el.click());
}

(async () => {
  const { browser, page } = await L.launch({ port: PORT });
  await page.addInitScript(() => {
    const W = (window.__MASKCOST__ = { calls: [], lt: [] });
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) W.lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* none */ }
    const hook = () => {
      const e = window.__MARINE_ENGINE__;
      if (!e || e.__maskCostWrapped) return;
      const orig = e.setWaveData.bind(e);
      e.setWaveData = function (gl, grid, geo) {
        e._lastMaskEncodeMode = null; // an early return (reject / stash) must not inherit the previous call's mode
        const t0 = performance.now(); const r = orig(gl, grid, geo); const t1 = performance.now();
        W.calls.push({ t: Math.round(t0), ms: +(t1 - t0).toFixed(1), mode: e._lastMaskEncodeMode || null,
          dims: e._cachedMaskTexDims ? `${e._cachedMaskTexDims.w}x${e._cachedMaskTexDims.h}` : null, layer: grid && grid.__componentLayer, model: grid && grid.__sourceModel,
          bounds: grid && grid.bounds ? [grid.bounds.west, grid.bounds.south, grid.bounds.east, grid.bounds.north].map((v) => +(+v).toFixed(2)).join(',') : null });
        return r;
      };
      e.__maskCostWrapped = true;
    };
    setInterval(hook, 200);
  });
  const marks = []; const mark = (name) => marks.push({ name, t: null });
  try {
    if (THROTTLE > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
    await L.openMap(page); await L.jump(page, -80, 24, 3.2);
    await clickExact(page, 'Waves'); await sleep(8000);
    const actions = [
      ['GFS Swell', async () => clickExact(page, LABEL.swell_1)], ['GFS Waves', async () => clickExact(page, LABEL.waves)],
      ['EURO', async () => clickExact(page, 'EURO')], ['EURO Swell', async () => clickExact(page, LABEL.swell_1)],
      ['GFS', async () => clickExact(page, 'GFS')], ['GFS Waves', async () => clickExact(page, LABEL.waves)],
      ['zoom 5', async () => L.jump(page, -80, 26, 5)], ['zoom 7', async () => L.jump(page, -80, 26, 7)],
      ['pan', async () => L.jump(page, -77, 27, 7)],
      // Switches while ZOOMED IN (the owner's session): a narrow viewport is served the 2-deg mid clip at once and sharpened to
      // its own viewport grid in the background (mid_res_tier._schedule_sharpen), so the next request for it commits new bounds.
      ['z7 Swell', async () => clickExact(page, LABEL.swell_1)], ['z7 Waves', async () => clickExact(page, LABEL.waves)],
      ['z7 Swell again', async () => clickExact(page, LABEL.swell_1)], ['z7 Waves again', async () => clickExact(page, LABEL.waves)],
      ['z7 Wind Waves', async () => clickExact(page, LABEL.wind_waves)], ['z7 Waves 3', async () => clickExact(page, LABEL.waves)],
      ['zoom 9', async () => L.jump(page, -80.1, 26.6, 9)], ['z9 Swell', async () => clickExact(page, LABEL.swell_1)],
      ['z9 Waves', async () => clickExact(page, LABEL.waves)], ['zoom 4', async () => L.jump(page, -80, 25, 4)],
      ['z4 Swell', async () => clickExact(page, LABEL.swell_1)], ['zoom 7 back', async () => L.jump(page, -80, 26, 7)],
    ];
    const out = [];
    for (const [name, fn] of actions) {
      const [t0, w0] = await page.evaluate(() => [performance.now(), Date.now()]);
      await fn(); await sleep(WAIT_MS * Math.max(1, THROTTLE / 2));
      const r = await page.evaluate(([t0, w0]) => ({ calls: window.__MASKCOST__.calls.filter((c) => c.t >= t0), lt: window.__MASKCOST__.lt.filter((x) => x[0] >= t0),
        // the app's own mask ring (marineForensics): one 'mask_rebuild' per painted + uploaded mask, one 'mask_stash_swap' per swap
        ev: ((window.__RAW_FORENSIC__ && window.__RAW_FORENSIC__.events) || []).filter((x) => x.t >= w0 && /^mask_(rebuild|stash_swap)$/.test(x.type)).map((x) => x.type) }), [t0, w0]);
      const row = { action: name, uploads: r.calls.length, uploadMs: r.calls.map((c) => c.ms), modes: r.calls.map((c) => c.mode), dims: [...new Set(r.calls.map((c) => c.dims))],
        bounds: r.calls.map((c) => c.bounds), rebuilds: r.calls.filter((c) => /rebuild/.test(c.mode || '')).length,
        maskBuiltEvents: r.ev.filter((x) => x === 'mask_rebuild').length, stashSwapEvents: r.ev.filter((x) => x === 'mask_stash_swap').length,
        rebuildMsMax: Math.max(0, ...r.calls.filter((c) => /rebuild/.test(c.mode || '')).map((c) => c.ms)),
        longtasks: r.lt.length, longtaskMax: Math.max(0, ...r.lt.map((x) => x[1])), longtaskTotal: r.lt.reduce((a, x) => a + x[1], 0) };
      out.push(row); console.log(JSON.stringify(row));
    }
    if (process.env.OUT) require('fs').writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
