// After ONE far scrub jump, dump the app's own account of why the requested hour is not rendered.
const L = require('./ab_lib.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { browser, page, log } = await L.launch({ port: +(process.env.PORT || 4100) });
  try {
    await L.openMap(page); await L.jump(page, -108, 16, 2.6); await L.clickText(page, 'Waves'); await sleep(12000);
    await page.evaluate(() => document.querySelector('[role="slider"][aria-label*="Forecast timeline"]').focus());
    await page.keyboard.press('PageUp'); await sleep(14000);
    const d = await page.evaluate(() => {
      const pick = (o, ks) => o ? Object.fromEntries(ks.map((k) => [k, o[k]])) : o;
      const tail = (a, n) => Array.isArray(a) ? a.slice(-n) : a;
      return {
        parity: window.__MARINE_RENDER_HOUR_PARITY__, heatmap: window.__MARINE_HEATMAP_STATUS__,
        pipeline: window.__MARINE_PIPELINE_TRUTH__, fetchDiag: window.__MARINE_FETCH_DIAG__,
        inflight: window.__MARINE_INFLIGHT__ && { counts: window.__MARINE_INFLIGHT__.counts, active: window.__MARINE_INFLIGHT__.active, log: tail(window.__MARINE_INFLIGHT__.log, 6) },
        series: window.__MARINE_SERIES_DIAG__, strand: window.__MARINE_STRAND_WATCHDOG__ && { counts: window.__MARINE_STRAND_WATCHDOG__.counts, log: tail(window.__MARINE_STRAND_WATCHDOG__.log, 5) },
        fce: window.__FCE_MARINE_BLOCKED__, resWatch: window.__RAW_RES_WATCH__ && { counts: window.__RAW_RES_WATCH__.counts, anomalies: tail(window.__RAW_RES_WATCH__.anomalies, 4) },
        transition: window.__MARINE_TRANSITION_STATE__, arbiter: window.__RAW_ARBITER_SHADOW__,
      };
    });
    console.log(JSON.stringify(d).slice(0, 6000));
    console.log('REQ', log.requests.map((r) => `${r.path}${r.q && r.q.valid_time ? ' vt=' + r.q.valid_time.slice(5, 16) : ''}:${r.status}`).join(' | '));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
