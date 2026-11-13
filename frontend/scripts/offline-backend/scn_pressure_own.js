// Pressure own-frames default A/B (2026-11-12). Offline only: built client over serve_synthetic.py; the PUBLISHED pressure sets
// mirrored behind a local CDN stand-in (raster-lab/own_frames_fixture.js --no-build --serve), the Open-Meteo .om host through rr.js.
// Arm `own` = the shipped default (no lever set; only the CDN base points at the stand-in). Arm `om` = the kill switch
// window.__RAW_DISABLE_RASTER_OWN_PRESSURE__ (the .om colour field, as before). Real clock: the mirrored run is the live one.
// Per arm: pressure on (ms until drawn), STEPS ArrowRight on the timeline wheel (ms from the last key until drawn), main-thread
// Long Animation Frames for both phases, the own-frames telemetry, the isobar / H-L layers present, a screenshot.
//   PORT=4198 AB_BASE=http://127.0.0.1:3198 OWN_CDN=http://127.0.0.1:4293/ RR_DIR=<cache> OUT=<dir> VP=phone|desktop
//   THEME=dark|light|beach MODEL=GFS|EURO|ICON ARM=own|om [RR_MODE=auto] [DRAWN=om] node scn_pressure_own.js
// FLAGS='{"__RAW_DISABLE_ISOBAR_NEIGHBOUR_IDLE__":true}' sets window levers before load (a same-build A/B of one switch); TAG_SUFFIX names the run.
if (process.env.AB_LIVE === '1') throw Error('scn_pressure_own is offline only');
const fs = require('fs'); const path = require('path');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const OUT = process.env.OUT; const VP = process.env.VP || 'desktop'; const THEME = process.env.THEME || 'dark';
const ARM = process.env.ARM || 'own'; const MODEL = process.env.MODEL || 'GFS';
const STEPS = +(process.env.STEPS || 12); const KEY_MS = +(process.env.KEY_MS || 300);
const VIEW = (process.env.VIEW || '-55,38,3.2').split(',').map(Number);
const FLAGS = process.env.FLAGS ? JSON.parse(process.env.FLAGS) : {};
const TAG = `${ARM}-${MODEL}-${THEME}-${VP}${process.env.TAG_SUFFIX || ''}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const drawn = (own) => {
  if (own) { const t = window.__RAW_OWN_RASTER__ || {}; return !!(t.shown && t.want && t.shown.path === t.want.path); }
  const m = window.__MAP_INSTANCE__;
  return m.loaded() && [0, 1, 2].some((i) => m.getLayer(`pressure-slot-${i}-layer`) && m.getPaintProperty(`pressure-slot-${i}-layer`, 'raster-opacity') !== 0);
};
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'replay' });
  const phone = VP === 'phone';
  const { browser, page } = await L.launch(phone
    ? { port: +process.env.PORT, width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } }
    : { port: +process.env.PORT, width: 1280, height: 800, dpr: 1 });
  await rr.install(page);
  await page.addInitScript(({ theme, kill, cdn, flags }) => {
    Object.assign(window, flags);
    try { localStorage.setItem('raw-surf-theme', theme); } catch (e) { /* private mode */ }
    window.__RAW_STATIC_FRAMES_BASE__ = cdn;
    if (kill) window.__RAW_DISABLE_RASTER_OWN_PRESSURE__ = true;
    window.__LAF__ = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__LAF__.push({ t: e.startTime, d: e.duration, b: e.blockingDuration || 0 }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) { /* no LoAF */ }
  }, { theme: THEME, kill: ARM === 'om', cdn: process.env.OWN_CDN, flags: FLAGS });
  const cdp = await page.context().newCDPSession(page);
  if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await L.openMap(page);
  await page.evaluate((m) => window.setActiveModel && window.setActiveModel(m), MODEL);
  await L.jump(page, VIEW[0], VIEW[1], VIEW[2]); await sleep(4000);
  const own = ARM === 'own' && process.env.DRAWN !== 'om';   // DRAWN=om: the own arm is expected to fall back (a set that is not published)
  const t0 = await page.evaluate(() => performance.now());
  await page.evaluate(() => window.toggleLayer('pressure'));
  let toggleMs = null;
  try { await page.waitForFunction(drawn, own, { timeout: 60000, polling: 50 }); toggleMs = Math.round(await page.evaluate(() => performance.now()) - t0); } catch (e) { /* never drawn: reported as null */ }
  await sleep(4000);
  await page.screenshot({ path: path.join(OUT, `${TAG}-start.png`) });
  const wheel = page.locator('[role="slider"][aria-label*="timeline wheel"]').filter({ visible: true }).first();
  const t1 = await page.evaluate(() => performance.now());
  for (let i = 0; i < STEPS; i++) { await wheel.focus().catch(() => {}); await page.keyboard.press('ArrowRight'); await sleep(KEY_MS); }
  const tKey = await page.evaluate(() => performance.now());
  let settleMs = null;
  try { await page.waitForFunction(drawn, own, { timeout: 60000, polling: 50 }); settleMs = Math.round(await page.evaluate(() => performance.now()) - tKey); } catch (e) { /* reported as null */ }
  await sleep(4000);
  const res = await page.evaluate(({ t0, t1 }) => {
    const laf = window.__LAF__ || [];
    const sum = (a, k) => Math.round(a.reduce((s, e) => s + e[k], 0));
    const tog = laf.filter((e) => e.t >= t0 && e.t < t1); const scr = laf.filter((e) => e.t >= t1);
    const t = window.__RAW_OWN_RASTER__ || null;
    const m = window.__MAP_INSTANCE__;
    const ids = m.getStyle().layers.map((l) => l.id).filter((id) => /isobar|pressure|own-raster|hl-/i.test(id));
    return {
      toggle: { n: tog.length, total: sum(tog, 'd'), blocking: sum(tog, 'b'), worst: Math.round(Math.max(0, ...tog.map((e) => e.d))) },
      scrub: { n: scr.length, total: sum(scr, 'd'), blocking: sum(scr, 'b'), worst: Math.round(Math.max(0, ...scr.map((e) => e.d))) },
      own: t ? { loads: t.loads || 0, bytes: t.bytes || 0, set: (t.shown && t.shown.set) || (t.want && t.want.set) || null, shown: t.shown ? t.shown.path : null } : null,
      layers: ids,
      readout: (document.querySelector('[role="slider"][aria-label*="timeline wheel"]') || {}).ariaValueText || null,
    };
  }, { t0, t1 });
  await page.screenshot({ path: path.join(OUT, `${TAG}.png`) });
  const log = rr.log || [];
  Object.assign(res, { flags: FLAGS, arm: ARM, model: MODEL, theme: THEME, vp: VP, steps: STEPS, toggleMs, settleMs,
    omRequests: log.length, omBytes: log.reduce((s, e) => s + ((e && e.bytes) || 0), 0), rrMisses: log.filter((e) => e && e.hit === false).length });
  fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
