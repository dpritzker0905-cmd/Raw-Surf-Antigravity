// What a layer / model switch and a pan/zoom cost on the main thread, split by the land-mask decision (offline only).
// Measurement-only instrumentation: wraps the engine's setWaveData in the page to time each call and read
// engine._lastMaskEncodeMode afterwards ('reuse' | 'retain_*' | 'rebuild*'). Nothing in the app changes.
//   PORT=4102 node scripts/offline-backend/scn_mask_cost.js
const L = require('./ab_lib.js');
if (process.env.AB_LIVE === '1') throw Error('offline only');
const PORT = +(process.env.PORT || 4102);
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
        const t0 = performance.now(); const r = orig(gl, grid, geo); const t1 = performance.now();
        W.calls.push({ t: Math.round(t0), ms: +(t1 - t0).toFixed(1), mode: e._lastMaskEncodeMode || null,
          dims: e._cachedMaskTexDims ? `${e._cachedMaskTexDims.w}x${e._cachedMaskTexDims.h}` : null, layer: grid && grid.__componentLayer, model: grid && grid.__sourceModel });
        return r;
      };
      e.__maskCostWrapped = true;
    };
    setInterval(hook, 200);
  });
  const marks = []; const mark = (name) => marks.push({ name, t: null });
  try {
    await L.openMap(page); await L.jump(page, -80, 24, 3.2);
    await clickExact(page, 'Waves'); await sleep(8000);
    const actions = [
      ['GFS Swell', async () => clickExact(page, LABEL.swell_1)], ['GFS Waves', async () => clickExact(page, LABEL.waves)],
      ['EURO', async () => clickExact(page, 'EURO')], ['EURO Swell', async () => clickExact(page, LABEL.swell_1)],
      ['GFS', async () => clickExact(page, 'GFS')], ['GFS Waves', async () => clickExact(page, LABEL.waves)],
      ['zoom 5', async () => L.jump(page, -80, 26, 5)], ['zoom 7', async () => L.jump(page, -80, 26, 7)],
      ['pan', async () => L.jump(page, -77, 27, 7)], ['zoom 4', async () => L.jump(page, -80, 25, 4)],
    ];
    const out = [];
    for (const [name, fn] of actions) {
      const t0 = await page.evaluate(() => performance.now());
      await fn(); await sleep(5000);
      const r = await page.evaluate((t0) => ({ calls: window.__MASKCOST__.calls.filter((c) => c.t >= t0), lt: window.__MASKCOST__.lt.filter((x) => x[0] >= t0) }), t0);
      const row = { action: name, uploads: r.calls.length, uploadMs: r.calls.map((c) => c.ms), modes: r.calls.map((c) => c.mode), dims: [...new Set(r.calls.map((c) => c.dims))],
        rebuildMsMax: Math.max(0, ...r.calls.filter((c) => /rebuild/.test(c.mode || '')).map((c) => c.ms)),
        longtasks: r.lt.length, longtaskMax: Math.max(0, ...r.lt.map((x) => x[1])), longtaskTotal: r.lt.reduce((a, x) => a + x[1], 0) };
      out.push(row); console.log(JSON.stringify(row));
    }
    if (process.env.OUT) require('fs').writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
