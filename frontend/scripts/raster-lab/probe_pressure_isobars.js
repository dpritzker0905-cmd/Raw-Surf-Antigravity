// Isobars + H/L over the per-model pressure field (2026-10-24) and the worldwide matrix cells the raster lane owns:
//   cell 11: one region at z5, GFS / EURO / ICON, three themes;  cell 6: Fiji (179.5, -17) z5, the antimeridian seam;
//   cell 7: Norway (6, 70) and the Southern Ocean (0, -62) z5, polar stretch.
// Per scenario: toggle, settle, screenshot; isobar and centre counts; worker ms; then 8 one-hour steps and a 96 h jump with a
// per-animation-frame sampler: a frame whose VISIBLE isobars belong to another frame than the one the field shows is STALE
// (must be 0); frames with no isobars while the field shows a frame are counted (the not-yet-ready window).
//   AB_BASE=http://127.0.0.1:3192 OWN_CDN=http://127.0.0.1:4294/ OUT=<dir> node probe_pressure_isobars.js
const L = require('../offline-backend/ab_lib.js');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.OUT || '.';
const SCEN = [
  ...['GFS', 'EURO', 'ICON'].flatMap((m) => ['dark', 'light', 'beach'].map((t) => ({ cell: 11, model: m, theme: t, view: [-35, 42, 5] }))),
  { cell: 6, model: 'GFS', theme: 'dark', view: [179.5, -17, 5] },
  { cell: 6, model: 'EURO', theme: 'light', view: [179.5, -17, 5] },
  { cell: 7, model: 'GFS', theme: 'dark', view: [6, 70, 5] },
  { cell: 7, model: 'EURO', theme: 'beach', view: [6, 70, 5] },
  { cell: 7, model: 'GFS', theme: 'light', view: [0, -62, 5] },
].filter((s) => !process.env.CELLS || process.env.CELLS.split(',').includes(String(s.cell)));

const SAMPLER = () => {
  window.__ISO_S__ = { rows: [], on: false };
  const tick = () => {
    const S = window.__ISO_S__;
    if (S.on) {
      const sh = (window.__RAW_OWN_RASTER__ || {}).shown; const want = (window.__RAW_OWN_RASTER__ || {}).want;
      S.rows.push([performance.now(), sh ? sh.path : null, (window.__RAW_ISOBARS__ || {}).visiblePath || null, want ? want.path : null]);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = [];
  for (const s of SCEN) {
    const { browser, page } = await L.launch({ port: +(process.env.PORT || 4198) });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    await page.addInitScript(({ theme, cdn }) => {
      localStorage.setItem('raw-surf-theme', theme);
      window.__RAW_RASTER_OWN_FRAMES__ = true; window.__RAW_STATIC_FRAMES_BASE__ = cdn;
    }, { theme: s.theme, cdn: process.env.OWN_CDN });
    await page.addInitScript(SAMPLER);
    await page.goto(process.env.AB_BASE + '/map', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__MAP_INSTANCE__, null, { timeout: 90000 });
    await sleep(2500);
    await page.evaluate((m) => window.setActiveModel && window.setActiveModel(m), s.model);
    await L.jump(page, s.view[0], s.view[1], s.view[2]);
    await sleep(2000);
    await page.evaluate(() => window.toggleLayer('pressure'));
    const ready = await page.waitForFunction(() => { const t = window.__RAW_OWN_RASTER__ || {}; const i = window.__RAW_ISOBARS__ || {};
      return !!(t.shown && i.visiblePath && i.visiblePath === t.shown.path); }, null, { timeout: 30000, polling: 50 }).then(() => true).catch(() => false);
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, `iso-c${s.cell}-${s.model}-${s.theme}.png`) });
    const shape = await page.evaluate(() => {
      const m = window.__MAP_INSTANCE__; const i = window.__RAW_ISOBARS__ || {};
      const count = (id) => { try { return m.querySourceFeatures(id).length; } catch (e) { return null; } };
      const vis = ['a', 'b'].find((b) => m.getLayoutProperty(`own-raster-pressure-isobar-line-${b}`, 'visibility') === 'visible');
      return { worker: i.worker, ms: (i.ms || []).slice(-6), computed: i.computed, visibleBuf: vis || null,
        lines: vis ? count(`own-raster-pressure-isobars-${vis}`) : 0, centres: vis ? count(`own-raster-pressure-centres-${vis}`) : 0,
        rendered: vis ? m.queryRenderedFeatures({ layers: [`own-raster-pressure-centre-${vis}`] }).map((f) => f.properties.label.replace('\n', ' ')).slice(0, 6) : [] };
    });
    await page.evaluate(() => { window.__ISO_S__.rows = []; window.__ISO_S__.on = true; });
    for (let h = 1; h <= 8; h++) { await page.evaluate((h) => window.setTimeOffsetHours(h), h); await sleep(300); }
    await page.evaluate(() => window.setTimeOffsetHours(96)); await sleep(1500);
    const S = await page.evaluate(() => { window.__ISO_S__.on = false; return window.__ISO_S__.rows; });
    const stale = S.filter((r) => r[2] && r[1] && r[2] !== r[1]).length;
    const missing = S.filter((r) => r[1] && !r[2]).length;
    const row = { ...s, ready, ...shape, frames: S.length, staleIsobarFrames: stale, framesWithoutIsobars: missing, errors };
    rows.push(row);
    console.log(JSON.stringify(row));
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'probe-pressure-isobars.json'), JSON.stringify(rows, null, 1));
})();
