// Radar advection worker A/B (2026-11-12). Offline only: built client over serve_synthetic.py, raster hosts replayed (rr.js).
// Per arm (worker = default, main = window.__RAW_DISABLE_RADAR_ADVECT_WORKER__): radar on, then STEPS ArrowRight into the
// nowcast frames; records Long Animation Frames / long tasks on the main thread, the worker telemetry, replay misses, and a
// screenshot of the last frame (pixel parity between arms is checked by the caller).
//   PORT=4198 AB_BASE=http://127.0.0.1:3198 RR_DIR=<cache> OUT=<dir> VP=phone|desktop THEME=dark ARM=worker|main node scn_radar_worker.js
// FLAGS='{"__RAW_RADAR_HRRR_FAR__":true}' sets window levers before load; KILL names the switch the 'main' arm sets
// (default __RAW_DISABLE_RADAR_ADVECT_WORKER__; the recolor A/B uses __RAW_DISABLE_RADAR_RECOLOR_WORKER__).
if (process.env.AB_LIVE === '1') throw Error('scn_radar_worker is offline only');
const fs = require('fs'); const path = require('path');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const OUT = process.env.OUT; const VP = process.env.VP || 'phone'; const THEME = process.env.THEME || 'dark';
const ARM = process.env.ARM || 'worker'; const STEPS = +(process.env.STEPS || 6);
const FLAGS = process.env.FLAGS ? JSON.parse(process.env.FLAGS) : {};
const KILL = process.env.KILL || '__RAW_DISABLE_RADAR_ADVECT_WORKER__';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'replay' });   // RR_MODE=auto records misses once
  const meta = JSON.parse(fs.readFileSync(path.join(process.env.RR_DIR, 'meta.json')));
  const phone = VP === 'phone';
  const { browser, page } = await L.launch(phone
    ? { port: +process.env.PORT, width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } }
    : { port: +process.env.PORT, width: 1280, height: 800, dpr: 1 });
  await rr.install(page);
  const external = [];
  const wms = [];
  page.on('request', (r) => { const u = r.url(); if (/rainviewer|\/rv\//.test(u)) external.push(u); if (/mesonet|dwd\.de|nowcoast/.test(u)) wms.push(u); });
  await page.addInitScript((offset) => { const RD = Date; function D(...a) { if (!(this instanceof D)) return new RD(RD.now() + offset).toString(); return a.length ? new RD(...a) : new RD(RD.now() + offset); } D.prototype = RD.prototype; D.now = () => RD.now() + offset; D.parse = RD.parse; D.UTC = RD.UTC; window.Date = D; }, meta.tRec - Date.now());
  await page.addInitScript(({ theme, kill, flags }) => {
    try { localStorage.setItem('raw-surf-theme', theme); } catch (e) { /* private mode */ }
    for (const k of Object.keys(flags)) window[k] = flags[k];
    if (kill) window[kill] = true;
    window.__LAF__ = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__LAF__.push({ t: e.startTime, d: e.duration, b: e.blockingDuration || 0 }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) { /* no LoAF */ }
  }, { theme: THEME, kill: ARM === 'main' ? KILL : null, flags: FLAGS });
  const cdp = await page.context().newCDPSession(page);
  if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await L.openMap(page); await L.jump(page, -79.8, 28.0, 5); await sleep(5000);
  const t0 = await page.evaluate(() => performance.now());
  await page.evaluate(() => window.toggleLayer('radar')); await sleep(9000);
  const wheel = page.locator('[role="slider"][aria-label*="timeline wheel"]').filter({ visible: true }).first();
  const t1 = await page.evaluate(() => performance.now());
  for (let i = 0; i < STEPS; i++) { await wheel.focus().catch(() => {}); await page.keyboard.press('ArrowRight'); await sleep(700); }
  await sleep(2500);
  const res = await page.evaluate(({ t0, t1 }) => {
    const laf = window.__LAF__ || [];
    const sum = (a, k) => Math.round(a.reduce((s, e) => s + e[k], 0));
    const tog = laf.filter((e) => e.t >= t0 && e.t < t1); const scr = laf.filter((e) => e.t >= t1);
    return {
      worker: window.__RAW_RADAR_ADVECT_WORKER__ || null,
      tileCache: window.__RAW_RADAR_TILE_CACHE__ || null,
      toggle: { n: tog.length, total: sum(tog, 'd'), blocking: sum(tog, 'b'), worst: Math.round(Math.max(0, ...tog.map((e) => e.d))) },
      scrub: { n: scr.length, total: sum(scr, 'd'), blocking: sum(scr, 'b'), worst: Math.round(Math.max(0, ...scr.map((e) => e.d))) },
      readout: (document.querySelector('[role="slider"][aria-label*="timeline wheel"]') || {}).ariaValueText || null,
    };
  }, { t0, t1 });
  await page.screenshot({ path: path.join(OUT, `${ARM}-${THEME}-${VP}.png`) });
  res.rainviewerRequests = external.length; res.wmsRequests = wms.length; res.arm = ARM; res.vp = VP; res.theme = THEME;
  res.rrMisses = (rr.log || []).filter((e) => e && e.hit === false).length;
  fs.writeFileSync(path.join(OUT, `${ARM}-${THEME}-${VP}.json`), JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
