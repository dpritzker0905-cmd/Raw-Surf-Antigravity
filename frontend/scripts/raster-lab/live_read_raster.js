// The ONE live read of the raster PRs #469 (hard cut, direction-aware neighbour, instant flip, radar hold), #471 (the status
// line) and #477 (water-temp fill) on the DEPLOYED dev bundle (2026-10-23). One browser, ONE map load, desktop 1280 x 800:
// pressure on (the .om path), 6 one-hour steps 1.5 s apart, then water temp on. /api/health is probed before and after; the
// raster data comes from Open-Meteo, so the read sends our backend only the map's own load.
//   AB_LIVE=1 AB_BASE=https://dev--rawsurf.netlify.app OUT=<json> node live_read_raster.js
const fs = require('fs');
const https = require('https');
const L = require('../offline-backend/ab_lib.js');

// AB_LIVE=1: the real backend (one run, never in a loop). Otherwise PORT=<synthetic backend>: the deployed bundle's weather calls go
// to the offline backend, and only the raster hosts (Open-Meteo) are real.
const LIVE = process.env.AB_LIVE === '1';
if (!LIVE && !process.env.PORT) { console.error('set AB_LIVE=1 (real backend) or PORT=<synthetic backend>'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const health = () => new Promise((res) => {
  const t = Date.now();
  https.get('https://raw-surf-antigravity.onrender.com/api/health', (r) => { let b = ''; r.on('data', (c) => { b += c; });
    r.on('end', () => res({ at: new Date().toISOString(), status: r.statusCode, ms: Date.now() - t })); })
    .on('error', (e) => res({ at: new Date().toISOString(), error: String(e) }));
});

// Per animation frame: which slots of the layer are lit, the lit slot's time_step and whether its tiles are its own and loaded,
// and the visible status line. Two lit slots = two hours on screen (a cross-fade).
const SAMPLER = () => {
  const S = (window.__LR__ = { layer: null, rows: [] });
  const tick = () => {
    const m = window.__MAP_INSTANCE__;
    if (m && S.layer) {
      const lit = []; let step = null; let ready = false;
      for (let i = 0; i < 3; i++) {
        const id = `${S.layer}-slot-${i}-layer`; const l = m.style && m.style._layers[id];
        if (!l || m.getLayoutProperty(id, 'visibility') === 'none') continue;
        const v = l.paint.get('raster-opacity');
        if (typeof v === 'number' && v > 0.02 && !(v === 1 && m.getPaintProperty(id, 'raster-opacity') === 0)) {
          lit.push(i);
          const src = m.getSource(`${S.layer}-slot-${i}-source`);
          const mm = src && src.url && src.url.match(/valid_times_(\d+)/);
          step = mm ? +mm[1] : null;   // null = the transparent placeholder (no data): never 'ready'
          const tpl = Array.isArray(src && src.tiles) ? src.tiles[0] : null;
          let n = 0; let ld = 0;
          const tm = m.style.tileManagers[`${S.layer}-slot-${i}-source`];
          if (tm && tm._inViewTiles) for (const t of tm._inViewTiles.getAllTiles()) { n += 1; if (t.state === 'loaded') ld += 1; }
          ready = step !== null && (typeof tpl !== 'string' || tpl.startsWith(src.url)) && n > 0 && ld === n;
        }
      }
      const said = [...document.querySelectorAll('[role="status"]')].filter((el) => el.offsetParent !== null).map((el) => el.textContent.trim()).filter(Boolean).join(' | ');
      S.rows.push([performance.now(), lit.length, step, ready ? 1 : 0, said]);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

(async () => {
  const out = { live: LIVE, before: LIVE ? await health() : null, layers: {} };
  const { browser, page } = await L.launch({ port: LIVE ? 0 : +process.env.PORT, live: LIVE });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.addInitScript(SAMPLER);
  await page.goto(process.env.AB_BASE + '/map', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__MAP_INSTANCE__, null, { timeout: 90000 });
  await sleep(6000);
  await L.jump(page, -79.8, 28.0, 4);
  await sleep(3000);
  for (const layer of ['pressure', 'water_temp']) {
    const t0 = await page.evaluate((l) => { window.__LR__.layer = l; window.__LR__.rows = []; const t = performance.now(); window.toggleLayer(l); return t; }, layer);
    await page.waitForFunction(() => window.__LR__.rows.some((r) => r[1] >= 1 && r[3] === 1), null, { timeout: 60000, polling: 50 }).catch(() => {});
    const toggleRows = await page.evaluate(() => window.__LR__.rows);
    const firstReady = toggleRows.find((r) => r[1] >= 1 && r[3] === 1);
    const res = { toggleMs: firstReady ? Math.round(firstReady[0] - t0) : null, steps: [] };
    if (layer === 'pressure') {
      await sleep(4000);
      const wheel = await page.evaluateHandle(() => [...document.querySelectorAll('[role="slider"][aria-label*="timeline wheel"]')].find((el) => el.offsetParent !== null));
      for (let i = 0; i < 6; i++) {
        const before = await page.evaluate(() => { const r = window.__LR__.rows; return r[r.length - 1][2]; });
        await page.evaluate(() => { window.__LR__.rows = []; });
        await wheel.focus();
        const ts = await page.evaluate(() => performance.now());
        await page.keyboard.press('ArrowRight');
        await sleep(1500);
        const rows = await page.evaluate(() => window.__LR__.rows);
        const done = rows.find((r) => r[1] >= 1 && r[2] !== null && r[2] !== before && r[3] === 1);
        res.steps.push({ ms: done ? Math.round(done[0] - ts) : null, mixedFrames: rows.filter((r) => r[1] > 1).length,
          staleFrames: rows.filter((r) => !done || r[0] < done[0]).length, said: [...new Set(rows.map((r) => r[4]).filter(Boolean))] });
      }
    } else {
      await sleep(3000);
    }
    res.credit = await page.evaluate(() => [...document.querySelectorAll('[data-testid="layer-data-credit"]')].map((a) => a.textContent));
    res.tileTruth = await page.evaluate(() => window.__TILE_TRUTH__ ? { calls: window.__TILE_TRUTH__.protocolCalls, errors: window.__TILE_TRUTH__.errors } : null);
    out.layers[layer] = res;
    await page.evaluate((l) => window.toggleLayer(l), layer);
    await sleep(1500);
  }
  out.errors = errors;
  await browser.close();
  out.after = LIVE ? await health() : null;
  fs.writeFileSync(process.env.OUT || 'live-read-raster.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
})();
