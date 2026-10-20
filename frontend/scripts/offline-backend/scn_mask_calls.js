// How many land-mask builds a zoom / pan step triggers, and what each phase costs (offline only, 2026-10-20).
// Reads the app's own CPU phase receipts (window.__RAW_GPU__.cpuPhaseTiming: regionalMaskRefresh, overlayMaskRefresh,
// maskFeatureQuery, maskBaseCanvas, maskWaterPaint, maskUpload, waveDataUpdate) and the classifier counters
// (shelteredCalls / shelteredWorkCalls / shelterCache) as per-step deltas, plus the 'mask_rebuild' events of the encoder.
// Nothing in the app changes. Needs serve_synthetic.py --regions flagship --dynamic 1 (or no regional rebuilds happen).
//   PORT=4140 AB_BASE=http://127.0.0.1:3140 OUT=calls.json node scripts/offline-backend/scn_mask_calls.js
// LAB_KILLS (comma list of window.__RAW_DISABLE_*__ names) arms the A side of an A/B on one build; any window flag set to
// true works, e.g. LAB_KILLS=__RAW_SLICED_LAND_MASK__ (sliced map-event paints: per-step `sliced` = window.__RAW_GPU__.maskSlicing
// deltas, `jobs` by trigger, and every committed job's request-to-upload latency).
const L = require('./ab_lib.js');
if (process.env.AB_LIVE === '1') throw Error('offline only');
const PORT = +(process.env.PORT || 4140);
const WAIT_MS = +(process.env.WAIT_MS || 6000);
const THROTTLE = +(process.env.THROTTLE || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STEPS = [
  ['zoom 6', [-80, 26, 6]], ['zoom 8', [-80, 26, 8]], ['pan east', [-77, 26, 8]], ['zoom out 4', [-80, 25, 4]],
  ['zoom 8 (b)', [-80, 27, 8]], ['pan (b)', [-76, 28, 8]], ['zoom out 3', [-75, 30, 3]],
];

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 }); await loc.evaluate((el) => el.click());
}

(async () => {
  const { browser, page } = await L.launch({ port: PORT });
  if (process.env.LAB_KILLS) await page.addInitScript((ks) => { ks.forEach((k) => { window[k] = true; }); }, process.env.LAB_KILLS.split(','));
  await page.addInitScript(() => {
    const W = (window.__MASKCALLS__ = { lt: [] });
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) W.lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* none */ }
    // Which trigger drove each PAINT: a map event being dispatched (idle / moveend / zoomend / sourcedata) or none (a React
    // commit effect, the same-frame re-patch after a data commit). Observation only: fire() and the refresh pass through.
    W.byTrigger = {}; let evt = null;
    const hook = () => {
      const m = window.__MAP_INSTANCE__ || window.map; const e = window.__MARINE_ENGINE__;
      if (m && !m.__mcFire) { m.__mcFire = true; const f = m.fire.bind(m); m.fire = function (ev, ...a) { const prev = evt; evt = (ev && ev.type) || ev; try { return f(ev, ...a); } finally { evt = prev; } }; }
      if (e && !e.__mcWrap) { e.__mcWrap = true; const o = e.refreshMaskWithBasemapWater;
        e.refreshMaskWithBasemapWater = function (...a) { const g = window.__RAW_GPU__ || {}; const b = g.cpuPhaseTiming && g.cpuPhaseTiming.buckets; const n0 = b ? b.maskWaterPaint.calls : 0;
          const j0 = (g.maskSlicing || {}).scheduled || 0;
          const r = o.apply(this, a); const b2 = (window.__RAW_GPU__ || {}).cpuPhaseTiming; const n1 = b2 ? b2.buckets.maskWaterPaint.calls : 0;
          const j1 = ((window.__RAW_GPU__ || {}).maskSlicing || {}).scheduled || 0;
          const k = String(evt || 'commit'); const t = W.byTrigger[k] || (W.byTrigger[k] = { calls: 0, paints: 0, jobs: 0 }); t.calls++; t.paints += n1 - n0; t.jobs += j1 - j0; return r; }; }
    };
    setInterval(hook, 200);
  });
  const snap = () => page.evaluate(() => {
    const g = window.__RAW_GPU__ || {};
    const b = (g.cpuPhaseTiming && g.cpuPhaseTiming.buckets) || {};
    const pick = {};
    for (const k of ['regionalMaskRefresh', 'overlayMaskRefresh', 'maskFeatureQuery', 'maskBaseCanvas', 'maskWaterPaint', 'maskUpload', 'waveDataUpdate', 'maskRefreshInitial', 'maskRefreshIdle', 'maskRefreshMoveEnd', 'maskRefreshZoomEnd', 'maskRefreshSourceWater', 'maskRefreshSourceOther', 'maskRefreshOther']) {
      pick[k] = b[k] ? { calls: b[k].calls, ms: b[k].totalDurationMs } : { calls: 0, ms: 0 };
    }
    const sc = g.shelterCache || {};
    return { t: performance.now(), w: Date.now(), phases: pick, shelteredCalls: g.shelteredCalls || 0, shelteredWorkCalls: g.shelteredWorkCalls || 0,
      shelterHit: sc.hit || 0, shelterMiss: sc.miss || 0, sliced: JSON.parse(JSON.stringify(g.maskSlicing || {})),
      byTrigger: JSON.parse(JSON.stringify(window.__MASKCALLS__.byTrigger)), rebuilds: ((window.__RAW_FORENSIC__ && window.__RAW_FORENSIC__.events) || []).filter((x) => x.type === 'mask_rebuild').length };
  });
  try {
    if (THROTTLE > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
    await L.openMap(page); await L.jump(page, -80, 25, 3.5);
    await clickExact(page, 'Waves'); await sleep(10000);
    const out = [];
    for (const [name, [lng, lat, z]] of STEPS) {
      const a = await snap();
      await L.jump(page, lng, lat, z); await sleep(WAIT_MS);
      const b = await snap();
      const lt = await page.evaluate((t0) => window.__MASKCALLS__.lt.filter((x) => x[0] >= t0), a.t);
      const phases = {};
      for (const k of Object.keys(b.phases)) phases[k] = { calls: b.phases[k].calls - a.phases[k].calls, ms: Math.round(b.phases[k].ms - a.phases[k].ms) };
      const row = { step: name, phases, shelteredCalls: b.shelteredCalls - a.shelteredCalls, shelteredWorkCalls: b.shelteredWorkCalls - a.shelteredWorkCalls,
        shelterHit: b.shelterHit - a.shelterHit, shelterMiss: b.shelterMiss - a.shelterMiss, encoderRebuilds: b.rebuilds - a.rebuilds,
        paintsByTrigger: Object.fromEntries(Object.entries(b.byTrigger).map(([k, v]) => [k, v.paints - ((a.byTrigger[k] || {}).paints || 0)]).filter(([, n]) => n)),
        jobsByTrigger: Object.fromEntries(Object.entries(b.byTrigger).map(([k, v]) => [k, (v.jobs || 0) - ((a.byTrigger[k] || {}).jobs || 0)]).filter(([, n]) => n)),
        sliced: b.sliced.scheduled ? Object.fromEntries(['scheduled', 'committed', 'stale', 'coalesced', 'failed', 'slices', 'flushes'].map((k) => [k, (b.sliced[k] || 0) - (a.sliced[k] || 0)])
          .concat([['sliceMs', Math.round((b.sliced.sliceMs || 0) - (a.sliced.sliceMs || 0))], ['maxSliceMsEver', Math.round(b.sliced.maxSliceMs || 0)],
            ['latencyMs', (b.sliced.latencyMs || []).slice((a.sliced.latencyMs || []).length)],
            ['sliceMaxMs', Math.max(0, ...(b.sliced.sliceLog || []).slice((a.sliced.sliceLog || []).length))],
            ['segMaxMsEver', b.sliced.segMaxMs || null],
            ['slicesOver16', (b.sliced.sliceLog || []).slice((a.sliced.sliceLog || []).length).filter((x) => x > 16).length]])) : null,
        longtasks: lt.length, longtaskMax: Math.max(0, ...lt.map((x) => x[1])), longtaskTotal: lt.reduce((s, x) => s + x[1], 0) };
      out.push(row); console.log(JSON.stringify(row));
    }
    if (process.env.OUT) require('fs').writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
