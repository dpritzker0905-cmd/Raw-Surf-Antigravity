// Which grid does the marine engine hold after a step, and when does it change? (2026-11-15; the hour blend's log, section 21.)
// Offline only, blend killed. After each +3 h step the engine's resident is sampled every 40 ms for WATCH_MS; every change of
// (grid size, valid time, source) is listed with its time since the step, beside the /api/weather requests of that window.
//   PORT=4201 AB_BASE=http://127.0.0.1:3198 RR_DIR=<cache> OUT=<dir> [WATCH_MS=10000] [STEPS=6] node scn_grid_at_rest.js
if (process.env.AB_LIVE === '1') throw Error('scn_grid_at_rest is offline only');
const fs = require('fs'); const path = require('path');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const OUT = process.env.OUT; const WATCH_MS = +(process.env.WATCH_MS || 10000); const STEPS = +(process.env.STEPS || 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWS = [['waves', -158.0, 21.6, 5.0], ['waves', 150.0, -34.0, 5.0], ['waves', -40.0, 35.0, 2.5], ['swell_1', -123.0, 37.5, 5.0], ['wind_waves', -5.0, 50.0, 4.5]];
const PICK = process.env.VIEWS ? process.env.VIEWS.split(',').map(Number) : VIEWS.map((_, i) => i);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'auto' });
  const { browser, page } = await L.launch({ port: +(process.env.PORT || 4201), width: 1280, height: 800, dpr: 1 });
  await rr.install(page);
  await page.addInitScript(() => { try { localStorage.setItem('raw-surf-theme', 'dark'); } catch (e) { /* private mode */ } window.__RAW_STATIC_FRAMES_BASE__ = 'http://127.0.0.1:4293/'; window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true; });
  const reqs = []; const t0 = Date.now();
  page.on('request', (r) => { const u = r.url(); if (/\/api\/weather\/(grid|grid_series|point|capabilities)/.test(u)) r.__t = Date.now(); });
  page.on('requestfinished', (r) => { const u = r.url(); if (r.__t && /\/api\/weather\/(grid|grid_series)/.test(u)) {
    const q = new URL(u); reqs.push({ start: r.__t - t0, ms: Date.now() - r.__t, path: q.pathname.replace('/api/weather/', ''), layer: q.searchParams.get('layer'), hour: q.searchParams.get('hour') || q.searchParams.get('valid_time') || q.searchParams.get('time_offset_hours'), bbox: (q.searchParams.get('bbox') || '').slice(0, 40) }); } });
  await L.openMap(page);
  const key = (k, n) => page.evaluate(({ k2, n2 }) => { const el = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/.test(x.getAttribute('aria-label') || '') && x.offsetParent !== null);
    if (!el) return false; el.focus(); for (let i = 0; i < n2; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: k2, bubbles: true, cancelable: true })); return true; }, { k2: k, n2: n });
  const watch = (ms) => page.evaluate(async (ms2) => {
    const read = () => { const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid; if (!g) return 'none';
      const b = g.bounds || {}; return [`${e._texWidth}x${e._texHeight}`, String(g.served_valid_time || g.valid_time || ''), g.__fromFrameStore ? 'store' : 'commit', g.productId || g.__productId || '', `${Math.round(b.west)},${Math.round(b.south)},${Math.round(b.east)},${Math.round(b.north)}`, e._pendingDowngrade ? 'stash' : ''].join(' | '); };
    const s = performance.now(); const out = []; let last = null;
    while (performance.now() - s < ms2) { const now = read(); if (now !== last) { out.push({ t: Math.round(performance.now() - s), state: now }); last = now; } await new Promise((r) => setTimeout(r, 40)); }
    return out;
  }, ms);
  let on = null; const all = [];
  for (const vi of PICK) {
    const [layer, lng, lat, z] = VIEWS[vi];
    if (on && on !== layer) { await page.evaluate((l) => window.toggleLayer(l), on); await sleep(1500); on = null; }
    await L.jump(page, lng, lat, z); await sleep(1500);
    if (!on) { await page.evaluate((l) => window.toggleLayer(l), layer); on = layer; }
    await sleep(9000); await key('Home', 1); await sleep(3000);
    for (const pass of ['first', 'second']) {      // the same hours twice: is the second pass (everything fetched once) different?
      for (let i = 0; i < STEPS; i++) {
        const mark = Date.now() - t0; await key('ArrowRight', 3); const tl = await watch(WATCH_MS);
        const r = reqs.filter((q) => q.start >= mark - 50 && q.start < mark + WATCH_MS);
        all.push({ view: vi, layer, z, pass, step: i, timeline: tl, requests: r.map((q) => ({ at: q.start - mark, ms: q.ms, path: q.path, layer: q.layer, hour: q.hour })) });
        console.log(`v${vi} z${z} ${pass} step ${i}: ` + tl.map((x) => `${x.t}ms ${x.state.split(' | ').slice(0, 3).join('/')}`).join('  ->  ') + ` || requests: ${r.map((q) => `${q.path}@${q.start - mark}+${q.ms}ms`).join(' ') || 'none'}`);
      }
      await key('Home', 1); await sleep(3000);
    }
  }
  fs.writeFileSync(path.join(OUT, 'grid-at-rest.json'), JSON.stringify(all));
  await browser.close();
})().catch((e) => { console.error(String(e && e.stack || e).replace(/access_token=[^&\s"']+/g, 'access_token=REDACTED')); process.exit(1); });
