// Smoke + look probe for the own-frames pressure client (2026-10-23). One build, one browser per theme: turn the lever on, toggle
// pressure at zoom 3, read the app's own telemetry (window.__RAW_OWN_RASTER__), count Open-Meteo pressure requests (must be 0), read
// the legend credit, screenshot; then 6 scrub steps and one long jump. Replay only for the .om hosts (RR_MODE=replay).
//   AB_BASE=http://127.0.0.1:3195 OWN_CDN=http://127.0.0.1:4291/ RR_DIR=<cache> OUT=<dir> node probe_own_frames.js
const L = require('../offline-backend/ab_lib.js');
const { RR } = require('./rr.js');
const path = require('path');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.OUT || '.';
const THEMES = (process.env.THEMES || 'dark,light,beach').split(',');
const ON = process.env.OWN !== '0';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // LIVE=1: the real clock, and .om misses fetched ONCE into RR_DIR (a parity read at the hour the published run covers);
  // otherwise replay only, the app's clock pinned to the recording.
  const LIVE = process.env.LIVE === '1';
  const rr = new RR(process.env.RR_DIR, { mode: LIVE ? 'auto' : 'replay', lat: process.env.RR_LAT || '1' });
  const meta = LIVE ? null : require(path.join(process.env.RR_DIR, 'meta.json'));
  const HOURS = (process.env.HOURS || '3,6,9,12,15,18,96').split(',').filter(Boolean).map(Number);
  const VIEW = (process.env.VIEW || '-40,40,3').split(',').map(Number);
  const rows = [];
  for (const theme of THEMES) {
    const { browser, page } = await L.launch({ port: 4198 });
    await rr.install(page);
    const om = [];
    // Every Open-Meteo request of the session (an .om file holds all variables, so a URL never names the layer); pressure is the
    // only weather layer the probe turns on.
    page.on('request', (r) => { const u = r.url(); try { if (new URL(u).hostname.includes('open-meteo') || new URL(u).hostname.includes('openmeteo')) om.push(u); } catch (e) { /* data: */ } });
    if (!LIVE) await page.addInitScript((off) => { const RD = Date; function D(...a) { if (!(this instanceof D)) return new RD(RD.now() + off).toString(); return a.length ? new RD(...a) : new RD(RD.now() + off); } D.prototype = RD.prototype; D.now = () => RD.now() + off; D.parse = RD.parse; D.UTC = RD.UTC; window.Date = D; }, meta ? meta.tRec - Date.now() : 0);
    await page.addInitScript(({ theme, on, cdn }) => {
      localStorage.setItem('raw-surf-theme', theme);
      if (on) { window.__RAW_RASTER_OWN_FRAMES__ = true; window.__RAW_STATIC_FRAMES_BASE__ = cdn; }
    }, { theme, on: ON, cdn: process.env.OWN_CDN });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    await page.goto((process.env.AB_BASE || L.BASE) + '/map', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__MAP_INSTANCE__, null, { timeout: 90000 });
    await sleep(2500);
    await L.jump(page, VIEW[0], VIEW[1], VIEW[2]);
    await sleep(1500);
    const t0 = Date.now();
    if (process.env.NOLAYER !== '1') await page.evaluate(() => window.toggleLayer('pressure'));   // NOLAYER=1: the bare map (a control)
    let firstMs = null;
    for (let i = 0; i < (ON ? 200 : 0); i++) {
      const sh = await page.evaluate(() => (window.__RAW_OWN_RASTER__ || {}).shown || null);
      if (sh) { firstMs = Date.now() - t0; break; }
      await sleep(25);
    }
    await sleep(+(process.env.SETTLE_MS || 1500));
    await page.screenshot({ path: path.join(OUT, `own-${ON ? 'on' : 'off'}-${theme}.png`) });
    const credit = await page.evaluate(() => [...document.querySelectorAll('[data-testid="layer-data-credit"]')].map((a) => a.textContent));
    const steps = [];
    for (const h of (ON ? HOURS : [])) {
      const s0 = Date.now();
      await page.evaluate((h) => window.setTimeOffsetHours(h), h);
      let ms = null;
      for (let i = 0; i < 400; i++) {
        // Done = the app has set the target FOR THIS HOUR (its asked time within a minute of now + h) and the layer shows it.
        const ok = await page.evaluate((h) => { const t = window.__RAW_OWN_RASTER__ || {}; const w = t.want;
          return !!(t.shown && w && w.path && Math.abs(w.validMs - (Date.now() + h * 3600000)) < 60000 && t.shown.path === w.path); }, h);
        if (ok) { ms = Date.now() - s0; break; }
        await sleep(10);
      }
      await sleep(400);
      // The status line under the timeline (rasterDrawnFrame): what it says once the step has settled.
      const said = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].filter((el) => el.offsetParent !== null).map((el) => el.textContent.trim()).filter(Boolean).join(' | '));
      steps.push({ h, ms, said });
    }
    const tel = await page.evaluate(() => { const t = window.__RAW_OWN_RASTER__ || {}; return { loads: t.loads, bytes: t.bytes, misses: t.misses, decodeMs: t.decodeMs, pin: t.pin && { run: t.pin.run, frames: t.pin.frames } }; });
    const layers = await page.evaluate(() => window.__MAP_INSTANCE__.getStyle().layers.filter((l) => /pressure/.test(l.id)).map((l) => `${l.id}:${l.type}:${(l.layout || {}).visibility || 'visible'}`));
    rows.push({ theme, on: ON, firstMs, steps, credit, openMeteoRequests: om.length, tel, layers, errors });
    console.log(JSON.stringify(rows[rows.length - 1]));
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, `probe-own-${ON ? 'on' : 'off'}.json`), JSON.stringify(rows, null, 1));
})();
