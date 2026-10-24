// Per-model pressure (2026-10-24): the dark own-frames client with GFS, EURO and ICON sets, on the REAL clock against a local
// CDN stand-in of real published runs. Per theme and model: toggle, two steps, a jump past EURO's 240 h / ICON's 180 h (the
// labelled GFS stand-in), the status words, the legend credit, Open-Meteo requests (must be 0), and one model switch.
//   AB_BASE=http://127.0.0.1:3193 OWN_CDN=http://127.0.0.1:4294/ OUT=<dir> THEMES=dark,light,beach node probe_pressure_models.js
const L = require('../offline-backend/ab_lib.js');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.OUT || '.';
const THEMES = (process.env.THEMES || 'dark').split(',');
const MODELS = (process.env.MODELS || 'GFS,EURO,ICON').split(',');

const settled = (page, h) => page.waitForFunction((h) => {
  const t = window.__RAW_OWN_RASTER__ || {}; const w = t.want;
  return !!(t.shown && w && w.path && Math.abs(w.validMs - (Date.now() + h * 3600000)) < 60000 && t.shown.path === w.path);
}, h, { timeout: 30000, polling: 10 }).then(() => true).catch(() => false);
const said = (page) => page.evaluate(() => [...document.querySelectorAll('[role="status"]')].filter((el) => el.offsetParent !== null)
  .map((el) => el.textContent.trim()).filter(Boolean).join(' | '));
const credit = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="layer-data-credit"]')].map((a) => a.textContent)[0] || null);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = [];
  for (const theme of THEMES) {
    for (const model of MODELS) {
      const { browser, page } = await L.launch({ port: +(process.env.PORT || 4198) });
      const om = [];
      page.on('request', (r) => { try { const h = new URL(r.url()).hostname; if (/open-?meteo/.test(h)) om.push(r.url()); } catch (e) { /* data: */ } });
      await page.addInitScript(({ theme, cdn }) => {
        localStorage.setItem('raw-surf-theme', theme);
        window.__RAW_RASTER_OWN_FRAMES__ = true; window.__RAW_STATIC_FRAMES_BASE__ = cdn;
      }, { theme, cdn: process.env.OWN_CDN });
      await page.goto(process.env.AB_BASE + '/map', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.__MAP_INSTANCE__, null, { timeout: 90000 });
      await sleep(2500);
      await page.evaluate((m) => window.setActiveModel && window.setActiveModel(m), model);
      await L.jump(page, -40, 40, 3);
      await sleep(2000);
      const row = { theme, model, steps: [] };
      let t0 = Date.now();
      await page.evaluate(() => window.toggleLayer('pressure'));
      row.toggleOk = await settled(page, 0); row.toggleMs = Date.now() - t0;
      await sleep(1200);
      await page.screenshot({ path: path.join(OUT, `models-${model}-${theme}.png`) });
      row.credit = await credit(page);
      const far = model === 'EURO' ? 246 : model === 'ICON' ? 186 : 246;
      for (const h of [3, 4, far]) {
        t0 = Date.now();
        await page.evaluate((h) => window.setTimeOffsetHours(h), h);
        const ok = await settled(page, h); const ms = Date.now() - t0;
        await sleep(500);
        const tel = await page.evaluate(() => { const t = window.__RAW_OWN_RASTER__ || {}; return t.want ? { model: t.want.model, estimated: t.want.estimated } : null; });
        row.steps.push({ h, ok, ms, said: await said(page), credit: await credit(page), ...tel });
      }
      if (model !== 'GFS') {                                   // one switch back to GFS at hour 3
        await page.evaluate(() => window.setTimeOffsetHours(3)); await settled(page, 3); await sleep(500);
        t0 = Date.now();
        await page.evaluate(() => window.setActiveModel('GFS'));
        const ok = await page.waitForFunction(() => { const t = window.__RAW_OWN_RASTER__ || {}; return t.want && t.want.model === 'GFS' && t.shown && t.shown.path === t.want.path; }, null, { timeout: 30000, polling: 10 }).then(() => true).catch(() => false);
        row.switchToGfs = { ok, ms: Date.now() - t0, credit: await credit(page) };
      }
      row.openMeteoRequests = om.length;
      rows.push(row);
      console.log(JSON.stringify(row));
      await browser.close();
    }
  }
  fs.writeFileSync(path.join(OUT, 'probe-pressure-models.json'), JSON.stringify(rows, null, 1));
})();
