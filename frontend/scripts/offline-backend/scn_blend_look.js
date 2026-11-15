// THE OWNER'S BLINDED LOOK at the hour blend: 10 randomized pairs of HARD CUT against CROSS-FADE, the app itself moving.
// Protocol (registered before this file existed): docs/weather-program/log/2026-11-15-fable-crest-hour-blend.md section 35.
// Offline only. A browser job: run it only in a quiet window.
//
// Per pair (layer, view, theme): ONE page loaded with the opt-in; the cache is settled by two silent passes of the scrub; then
// the SAME scrub is recorded twice (CDP screencast of the compositor's own frames), once with the kill set (hard cut) and once
// without (cross-fade), the order of the two recordings alternating by pair. The two clips are written as the pair's "x" and "y"
// by a random draw; which is which goes ONLY into key.json, which the viewer never loads.
//
//   AB_BASE=http://127.0.0.1:3198 PORT=<backend> RR_DIR=<dir> OUT=<dir> node scn_blend_look.js
//   then open OUT/look/blend_look.html (it reads pairs.js beside it), and afterwards:  node blend_look_score.js OUT <answer code>
// Env: PAIRS (JSON list of {layer,lng,lat,z,theme,w,h}; the registered ten by default), STEPS (8), STEP_MS (700), ONLY (pair numbers, 1-based).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./ab_lib.js');
const { RR } = require('../raster-lab/rr.js');   // the offline replay of every non-backend request, as the gate instruments use

if (process.env.AB_LIVE === '1') throw Error('scn_blend_look is offline only');
const OUT = process.env.OUT || 'blend-look-out';
const STEPS = +(process.env.STEPS || 8);
const STEP_MS = +(process.env.STEP_MS || 700);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KILLS = ['__RAW_DISABLE_CREST_HOUR_BLEND__', '__RAW_DISABLE_WIND_HOUR_BLEND__'];
// The registered ten (section 35): six marine, four wind; world and coastal zooms; the three themes; two on the phone layout.
const DEFAULT_PAIRS = [
  { layer: 'waves', lng: -140, lat: 20, z: 3.0, theme: 'dark', w: 1280, h: 800 },
  { layer: 'waves', lng: -158, lat: 21.6, z: 5.0, theme: 'dark', w: 1280, h: 800 },
  { layer: 'waves', lng: -9.5, lat: 39, z: 5.0, theme: 'light', w: 1280, h: 800 },
  { layer: 'waves', lng: 150, lat: -34, z: 5.0, theme: 'beach', w: 390, h: 844 },
  { layer: 'swell_1', lng: -40, lat: 35, z: 2.5, theme: 'dark', w: 1280, h: 800 },
  { layer: 'swell_1', lng: -123, lat: 37.5, z: 5.0, theme: 'beach', w: 1280, h: 800 },
  { layer: 'wind', lng: -140, lat: 20, z: 3.0, theme: 'dark', w: 1280, h: 800 },
  { layer: 'wind', lng: -5, lat: 50, z: 4.5, theme: 'light', w: 1280, h: 800 },
  { layer: 'wind', lng: -106, lat: 14, z: 4.0, theme: 'dark', w: 390, h: 844 },
  { layer: 'wind', lng: 150, lat: -20, z: 3.0, theme: 'beach', w: 1280, h: 800 },
];
const PAIRS = process.env.PAIRS ? JSON.parse(process.env.PAIRS) : DEFAULT_PAIRS;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;

const HELPERS = () => {
  window.__LOOK__ = {
    key: (key, n) => { const el = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/.test(x.getAttribute('aria-label') || '') && x.offsetParent !== null);
      if (!el) return false; el.focus(); for (let i = 0; i < n; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); return true; },
    tel: () => ({ marine: window.__RAW_CREST_HOUR_BLEND__ ? window.__RAW_CREST_HOUR_BLEND__.starts : null, wind: window.__RAW_WIND_HOUR_BLEND__ ? window.__RAW_WIND_HOUR_BLEND__.starts : null }),
  };
};

async function recordPair(pair, idx, lookDir, rawDir) {
  const { browser, page } = await L.launch({ port: +(process.env.PORT || 4198), width: pair.w, height: pair.h, dpr: 1 });
  const res = { pair: idx + 1, ...pair, clips: {}, error: null };
  try {
    if (RR && process.env.RR_DIR) { const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'auto' }); await rr.install(page); }
    await page.addInitScript(HELPERS);
    await page.addInitScript((theme) => {
      try { localStorage.setItem('raw-surf-theme', theme); localStorage.setItem('__RAW_TUNER__', '0'); } catch (e) { /* private mode */ }
      window.__RAW_ENABLE_HOUR_BLEND__ = true;   // both clips load the blended shaders; the hard cut is the kill at run time
      window.__RAW_STATIC_FRAMES_BASE__ = 'http://127.0.0.1:4293/';
    }, pair.theme);
    await L.openMap(page);
    await L.jump(page, pair.lng, pair.lat, pair.z); await sleep(2000);
    await page.evaluate((layer) => window.toggleLayer(layer), pair.layer); await sleep(6000);
    const home = async () => { await page.evaluate(() => window.__LOOK__.key('Home', 1)); await sleep(2500); };
    const scrub = async (ms) => { for (let i = 0; i < STEPS; i++) { await page.evaluate(() => window.__LOOK__.key('ArrowRight', 3)); await sleep(ms); } await sleep(900); };
    const setKill = (on) => page.evaluate(({ kills, on: k }) => { for (const f of kills) { if (k) window[f] = true; else delete window[f]; } }, { kills: KILLS, on });
    // settle the cache: two silent passes, the second slow enough for every fine grid to land
    await setKill(true); await home(); await scrub(1500); await home(); await scrub(3000); await home();
    const order = idx % 2 === 0 ? ['cut', 'fade'] : ['fade', 'cut'];
    for (const arm of order) {
      await setKill(arm === 'cut'); await home();
      const before = await page.evaluate(() => window.__LOOK__.tel());
      const dir = path.join(rawDir, `p${String(idx + 1).padStart(2, '0')}-${arm}`); fs.mkdirSync(dir, { recursive: true });
      const frames = []; let n = 0; let t0 = null;
      const cdp = await page.context().newCDPSession(page);
      cdp.on('Page.screencastFrame', (f) => {
        const file = `f${String(n++).padStart(5, '0')}.jpg`; const ts = f.metadata.timestamp * 1000; if (t0 == null) t0 = ts;
        fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, 'base64')); frames.push({ file, t: Math.round(ts - t0) });
        cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: 960, maxHeight: 960, everyNthFrame: 1 });
      await sleep(500); await scrub(STEP_MS);
      await cdp.send('Page.stopScreencast').catch(() => {}); await sleep(200); await cdp.detach().catch(() => {});
      const after = await page.evaluate(() => window.__LOOK__.tel());
      const started = (after.marine || 0) - (before.marine || 0) + (after.wind || 0) - (before.wind || 0);
      res.clips[arm] = { dir, frames, blendsStarted: started };
    }
    // a clip that is not what it claims is not shown: the cut must start no blend, the fade must start one per step
    if (res.clips.cut.blendsStarted !== 0) res.error = `the hard-cut clip started ${res.clips.cut.blendsStarted} blends`;
    else if (res.clips.fade.blendsStarted < STEPS) res.error = `the cross-fade clip started ${res.clips.fade.blendsStarted} blends of ${STEPS}`;
  } catch (e) { res.error = String((e && e.message) || e).slice(0, 300).replace(/access_token=[^&\s"']+/g, 'access_token=REDACTED'); }
  await browser.close().catch(() => {});
  return res;
}

(async () => {
  const lookDir = path.join(OUT, 'look'); const rawDir = path.join(OUT, 'raw');
  fs.mkdirSync(lookDir, { recursive: true }); fs.mkdirSync(rawDir, { recursive: true });
  const keyFile = path.join(OUT, 'key.json');
  const key = fs.existsSync(keyFile) ? JSON.parse(fs.readFileSync(keyFile, 'utf8')) : { made: new Date().toISOString(), steps: STEPS, stepMs: STEP_MS, pairs: {} };
  for (let i = 0; i < PAIRS.length; i++) {
    if (ONLY && !ONLY.includes(i + 1)) continue;
    const r = await recordPair(PAIRS[i], i, lookDir, rawDir);
    const id = `p${String(i + 1).padStart(2, '0')}`;
    if (r.error) { key.pairs[id] = { ...PAIRS[i], error: r.error }; console.log(`${id}: NOT USABLE: ${r.error}`); fs.writeFileSync(keyFile, JSON.stringify(key, null, 1)); continue; }
    const xIsFade = crypto.randomInt(2) === 1;   // the draw: which clip is shown as "x"
    for (const [slot, arm] of [['x', xIsFade ? 'fade' : 'cut'], ['y', xIsFade ? 'cut' : 'fade']]) {
      const dst = path.join(lookDir, id, slot); fs.rmSync(dst, { recursive: true, force: true }); fs.mkdirSync(dst, { recursive: true });
      for (const f of r.clips[arm].frames) fs.copyFileSync(path.join(r.clips[arm].dir, f.file), path.join(dst, f.file));
      fs.writeFileSync(path.join(dst, 'frames.json'), JSON.stringify(r.clips[arm].frames));
    }
    key.pairs[id] = { ...PAIRS[i], x: xIsFade ? 'fade' : 'cut', y: xIsFade ? 'cut' : 'fade', recordedFirst: i % 2 === 0 ? 'cut' : 'fade',
      frames: { cut: r.clips.cut.frames.length, fade: r.clips.fade.frames.length }, blendsStarted: { cut: r.clips.cut.blendsStarted, fade: r.clips.fade.blendsStarted } };
    fs.writeFileSync(keyFile, JSON.stringify(key, null, 1));
    console.log(`${id}: recorded (${r.clips.cut.frames.length} + ${r.clips.fade.frames.length} frames)`);
  }
  // What the viewer loads: the pairs in a random ORDER, each with a random SIDE for x; nothing that says which clip is which.
  const ids = Object.keys(key.pairs).filter((id) => !key.pairs[id].error);
  for (let i = ids.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const pairs = ids.map((id) => {
    const xLeft = crypto.randomInt(2) === 1; const read = (slot) => JSON.parse(fs.readFileSync(path.join(lookDir, id, slot, 'frames.json'), 'utf8'));
    return { id, left: xLeft ? 'x' : 'y', right: xLeft ? 'y' : 'x', frames: { x: read('x'), y: read('y') } };
  });
  fs.writeFileSync(path.join(lookDir, 'pairs.js'), `window.LOOK_PAIRS = ${JSON.stringify(pairs)};\n`);
  fs.copyFileSync(path.join(__dirname, 'blend_look.html'), path.join(lookDir, 'blend_look.html'));
  console.log(`${pairs.length} pair(s) ready: ${path.join(lookDir, 'blend_look.html')}  (key: ${keyFile}, not loaded by the page)`);
})();
