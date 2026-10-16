// Is "retained_previous_hour" after a forward scrub an artifact of this harness, or the app's behaviour? Vary zoom, wait, nudge.
const L = require('./ab_lib.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => window.__MARINE_RENDER_HOUR_PARITY__ && { req: window.__MARINE_RENDER_HOUR_PARITY__.requestedHour, ren: window.__MARINE_RENDER_HOUR_PARITY__.renderedDataHour, why: window.__MARINE_RENDER_HOUR_PARITY__.reason, ups: window.__WEBGL_MARINE_UPLOAD_COUNT__, hid: document.hidden, vis: document.visibilityState };
(async () => {
  for (const zoom of [2.6, 5.0]) {
    const { browser, page } = await L.launch({ port: +(process.env.PORT || 4100) });
    try {
      await L.openMap(page); await L.jump(page, -108, 16, zoom); await L.clickText(page, 'Waves'); await sleep(12000);
      await page.evaluate(() => document.querySelector('[role="slider"][aria-label*="Forecast timeline"]').focus());
      await page.keyboard.press('PageUp');
      const out = [];
      for (const w of [3000, 7000, 10000, 15000]) { await sleep(w); out.push(JSON.stringify(await page.evaluate(state))); }
      console.log(`zoom ${zoom}: +3s,+10s,+20s,+35s ->`, out.join(' | '));
      await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; m.jumpTo({ center: [m.getCenter().lng + 0.3, m.getCenter().lat + 0.2], zoom: m.getZoom() }); });
      await sleep(8000); console.log(`zoom ${zoom}: after a 0.3 deg camera nudge +8s ->`, JSON.stringify(await page.evaluate(state)));
      await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; m.jumpTo({ center: [m.getCenter().lng, m.getCenter().lat], zoom: m.getZoom() + 0.6 }); });
      await sleep(8000); console.log(`zoom ${zoom}: after zoom +0.6 +8s ->`, JSON.stringify(await page.evaluate(state)));
    } finally { await browser.close(); }
  }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
