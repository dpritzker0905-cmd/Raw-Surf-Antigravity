// The owner's moving side-by-side (2026-10-23): the SAME scripted scrub of the pressure layer in two arms, each in its own
// browser, recorded as timestamped CDP screencast frames, for compose_clip.py to lay side by side. Arm `om` = the Open-Meteo .om
// path (lever off), arm `own` = our own frames (window.__RAW_RASTER_OWN_FRAMES__). Real clock and real data: the .om hosts go
// through rr.js (RR_MODE=auto records a miss ONCE, then every run replays it at its recorded latency), our frames come from the
// published run behind a local CDN stand-in (OWN_CDN; serve it with own_frames_fixture.js --serve --lat 150).
//   ARM=om|own THEME=dark AB_BASE=http://127.0.0.1:3195 OWN_CDN=http://127.0.0.1:4293/ RR_DIR=<dir> OUT=<dir> node clip_own_vs_om.js
// Script: open the map at VIEW, toggle pressure, wait until it is drawn, then press ArrowRight on the timeline wheel every KEY_MS
// for STEPS hours, then hold HOLD_MS. Writes <OUT>/<arm>-<theme>/frames/*.jpg and meta.json (frame times, key times, ms from
// the first key).
const L = require('../offline-backend/ab_lib.js');
const { RR } = require('./rr.js');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ARM = process.env.ARM || 'own';
const THEME = process.env.THEME || 'dark';
const STEPS = +(process.env.STEPS || 24);
const KEY_MS = +(process.env.KEY_MS || 300);
const HOLD_MS = +(process.env.HOLD_MS || 4000);
const VIEW = (process.env.VIEW || '-55,38,3.2').split(',').map(Number);
const OUT = path.join(process.env.OUT || '.', `${ARM}-${THEME}`);

(async () => {
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'auto', lat: process.env.RR_LAT || '1' });
  const { browser, page } = await L.launch({ port: +(process.env.PORT || 4198) });
  await rr.install(page);
  await page.addInitScript(({ theme, own, cdn }) => {
    localStorage.setItem('raw-surf-theme', theme);
    if (own) { window.__RAW_RASTER_OWN_FRAMES__ = true; window.__RAW_STATIC_FRAMES_BASE__ = cdn; }
  }, { theme: THEME, own: ARM === 'own', cdn: process.env.OWN_CDN });
  await page.goto((process.env.AB_BASE || L.BASE) + '/map', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__MAP_INSTANCE__, null, { timeout: 90000 });
  await sleep(2500);
  // Close the offline backend's spots toast so it does not sit over both clips.
  await page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (/close|dismiss/i.test(b.getAttribute('aria-label') || '')) b.click(); });
  await L.jump(page, VIEW[0], VIEW[1], VIEW[2]);
  await sleep(1500);
  await page.evaluate(() => window.toggleLayer('pressure'));
  // Drawn: own = the layer shows its wanted frame; om = the map is idle with a slot lit.
  await page.waitForFunction((own) => {
    if (own) { const t = window.__RAW_OWN_RASTER__ || {}; return !!(t.shown && t.want && t.shown.path === t.want.path); }
    const m = window.__MAP_INSTANCE__;
    return m.loaded() && [0, 1, 2].some((i) => m.getLayer(`pressure-slot-${i}-layer`) && m.getPaintProperty(`pressure-slot-${i}-layer`, 'raster-opacity') !== 0);
  }, ARM === 'own', { timeout: 60000, polling: 100 });
  await sleep(+(process.env.SETTLE_MS || 4000));

  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let n = 0;
  cdp.on('Page.screencastFrame', async (f) => {
    const file = `f${String(n++).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(OUT, 'frames', file), Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp * 1000 });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) { /* closing */ }
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
  await sleep(600);
  const wheel = await page.evaluateHandle(() => [...document.querySelectorAll('[role="slider"][aria-label*="timeline wheel"]')].find((el) => el.offsetParent !== null));
  await wheel.focus();
  const keys = [];
  for (let i = 0; i < STEPS; i++) {
    keys.push(Date.now());
    await page.keyboard.press('ArrowRight');
    await sleep(KEY_MS);
  }
  await sleep(HOLD_MS);
  await cdp.send('Page.stopScreencast');
  await sleep(300);
  const tel = await page.evaluate(() => { const t = window.__RAW_OWN_RASTER__ || {}; return { loads: t.loads || 0, bytes: t.bytes || 0 }; });
  const net = rr.window(keys[0] - 600, Date.now());
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ arm: ARM, theme: THEME, view: VIEW, steps: STEPS, keyMs: KEY_MS, keys, frames, tel,
    openMeteo: { requests: net.n, bytes: net.bytes, live: net.live } }, null, 1));
  console.log(`${ARM} ${THEME}: ${frames.length} frames, ${keys.length} keys, open-meteo ${net.n} req ${(net.bytes / 1e6).toFixed(2)} MB (${net.live} live)`);
  await browser.close();
})();
