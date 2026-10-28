// The owner's four failures of 2026-10-26 (manual test ~12:40Z on live dev, bundle 4e004446; the lead's forensics in the shared notes
// owner-manual-test-2026-10-26/FINDINGS.md), each as a scenario with a PASS / FAIL verdict. Offline only. They are written to FAIL
// on the dev tip of 2026-10-26 and PASS once each is fixed; the process exits 1 while any case fails.
//
//   band_off      "the surf rating band stays on for a few seconds, when its turned off": Waves with Surf Rating ON at the owner's
//                 z5.2, a timeline scrub in flight (live-like latency), then the Surf Rating button pressed OFF. The band-off is a
//                 FETCH ("flavor_toggle") that the abort gate ranks below the scrub ("Preserving high-priority fetch
//                 (timeline_scrub) against low-priority request (flavor_toggle)"), and the owner's console shows an 18 s wedge
//                 ("Stranded fetch-pending released (idle 18.0s ...)"). PASS: the band stops painting within BAND_MAX_MS (100) of
//                 the click, and no stranded-fetch release fires in the window. Band OFF must be a local render decision.
//   icon_far      "instant scrubbing not working ... (using icon)" at the owner's zoom (z4.6-5.3): far jumps (End, Home, a 10-day
//                 burst) with ICON. Live, the frames came from /grid_series pages and a far jump waited on /grid ("rendered
//                 hour=29, requested hour=250. Fetch already in-flight"), while GFS re-indexed instantly. PASS: every far jump
//                 draws the exact frame from the frame store (via 'store') within STEP_MAX_MS (100).
//   euro_switch   "Heatmap temporarily cleared when switching to Euro": GFS Waves, then the EURO chip. The engine clears its
//                 resident textures before the new model's frame exists ("[WebGLMarineEngine-Clear] Clearing resident wave
//                 textures" then "render returned early! ... _waveData: false"). PASS: 0 blank frames between the click and the first
//                 EURO frame (the contract: never a blank frame).
//   euro_240      "Euro had delays scrubbing": EURO past ~240 h is not framed on the CDN (FRAME_TAIL_DOWNLOAD=0: EURO's estimated tail
//                 is never published), so every hour there is a /grid round trip. Serve CDN_DIR from a LIVE-SHAPED bucket copy (the
//                 core lane's tails absent, see the README). PASS: every step past 240 h draws the exact frame from the store within
//                 STEP_MAX_MS.
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves \
//       --regions flagship --dynamic 1 --land-mask 1 --enclosed-seas 1 --port 4192      (env: the box's flags, e.g. MARINE_GULF_FILL_MID_TARGETED=1)
//   node frontend/scripts/offline-backend/serve_spa.js frontend/build 3190
//   AB_BASE=http://127.0.0.1:3190 PORT=4192 EXPECT_STORE=<store> CDN_DIR=<live-shaped bucket copy> OUT=owner.json node frontend/scripts/offline-backend/scn_owner_1026.js
// Env: CASES (band_off,icon_far,euro_switch,euro_240), VIEW (owner = 844 x 390 dpr 2, desktop, phone), THEME (dark), LAT_GRID (1500)
// and LAT_SERIES (6000) ms per backend answer (live-like; the owner's box), CDN_PORT (4372), SETTLE (6000), WIN (12000),
// BAND_MAX_MS (100), STEP_MAX_MS (100). Port 4190 is a Fetch "bad port": use another.
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_owner_1026 is offline only');
const PORT = +(process.env.PORT || 4192);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4372);
const CDN_LAT = +(process.env.CDN_LAT || 0);   // ms added to every CDN answer (the live CDN's round trip is ~300-400 ms)
const CASES = (process.env.CASES || 'band_off,icon_far,euro_switch,euro_240').split(',');
const VIEWS = { desktop: { width: 1280, height: 800, dpr: 1 }, owner: { width: 844, height: 390, dpr: 2 }, phone: { width: 390, height: 844, dpr: 3 } };
const VIEW = process.env.VIEW || 'owner';
const THEME = process.env.THEME || 'dark';
const LAT_GRID = +(process.env.LAT_GRID || 1500);
const LAT_SERIES = +(process.env.LAT_SERIES || 6000);
const SETTLE = +(process.env.SETTLE || 6000);
const WIN = +(process.env.WIN || 12000);
const BAND_MAX_MS = +(process.env.BAND_MAX_MS || 100);
const STEP_MAX_MS = +(process.env.STEP_MAX_MS || 100);
const CENTER = [-79.5, 28.6];
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!CDN_DIR) throw Error('CDN_DIR=<a local copy of the weather-frames bucket> is required');

const cdn = http.createServer(async (req, res) => {
  if (CDN_LAT) await sleep(CDN_LAT);
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' });
    return res.end('{"statusCode":"404","error":"not_found"}');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length,
    'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json',
    'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  res.end(body);
});

// In-page probe: one rAF loop records, per frame in an armed window, the resident wave grid's identity, a blank frame (no resident),
// the band's paint state and when the exact expected frame first appears (and from where: store / series / grid).
const PROBE = () => {
  const P = (window.__OW__ = { w: null });
  const stampMs = (pid) => { const m = /_(\d{8}T\d{6}Z)(?:_[-\d.]+)*(?:_estimated)?\.json$/.exec(pid || ''); return m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : null; };
  P.snap = () => {
    const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = d && d.waveGrid;
    const pid = (g && g.__fromFrameStore && g.__servedProductId) || (g ? (g.__servedProductId || g.productId || null) : null);
    const rb = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBand;
    // The band PAINTS when the engine's rating band is active AND its fade multiplier is not 0: #598 hides it locally (bandMult 0,
    // heldBy 'off') while the resident is still a rating grid, so `active` alone reads a hidden band as painting.
    const rf = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBandFade;
    const band = rb ? (!!rb.active && !(rf && rf.bandMult === 0)) : null;
    return { blank: !g, hour: g ? g.hourOffset : null, layer: g ? g.__componentLayer : null, model: g ? (g.__sourceModel || 'GFS') : null,
      stride: g ? (g.__decimatedStride || 0) : null, series: !!(g && g.__fromSeries), store: !!(g && g.__fromFrameStore), pid,
      served: g ? (g.served_valid_time || null) : null, band, bandActive: rb ? !!rb.active : null, grid: g || null };
  };
  const dataMs = (s, W) => (s.pid ? stampMs(s.pid) : (s.served ? Date.parse(s.served) : (s.series && s.hour != null ? W.anchor + s.hour * 3600000 : null)));
  const loop = (t) => {
    const W = P.w;
    if (W && !W.done && W.t0 != null && t >= W.t0) {
      const s = P.snap(); const rel = t - W.t0;
      W.frames += 1;
      if (s.blank) { W.blank += 1; if (W.firstBlank == null) W.firstBlank = Math.round(rel); }
      if (W.bandOff == null && s.band === false) W.bandOff = Math.round(rel);
      if (s.band === true) { W.bandOnFrames += 1; if (rel > W.bandMaxMs) W.bandLateFrames += 1; }
      if (W.expectedMs != null) {
        const ok = !s.blank && dataMs(s, W) === W.expectedMs && s.layer === 'waves' && s.model === W.model && s.stride === 0;
        if (W.exact == null && ok) { W.exact = Math.round(rel); W.via = s.store ? 'store' : (s.series ? 'series' : 'grid'); W.pid = s.pid; }
      }
      if (W.wantModel && W.modelAt == null && !s.blank && s.model === W.wantModel) W.modelAt = Math.round(rel);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.addEventListener('keydown', (e) => { if (P.w && !P.w.done && P.w.exact == null) P.w.t0 = e.timeStamp; }, true);   // the LAST key of a step
  window.addEventListener('click', (e) => { if (P.w && P.w.t0 == null && P.w.onClick) P.w.t0 = e.timeStamp; }, true);
  P.arm = (o) => { P.w = { t0: null, frames: 0, blank: 0, firstBlank: null, bandOff: null, bandOnFrames: 0, bandLateFrames: 0, bandMaxMs: o.bandMaxMs || 100, exact: null, via: null, pid: null,
    modelAt: null, expectedMs: o.expected ? stampMs(o.expected) : null, anchor: o.anchor, model: o.model, wantModel: o.wantModel || null, onClick: !!o.onClick }; };
  P.read = () => { const s = P.snap(); delete s.grid; return { ...P.w, end: s }; };
};

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.click();
}

// Hour 0 of the APP: labelMs - hour of `__RAW_SELECTED_FRAME__` (= getSeriesAnchorMs()), else the rounded clock (the same rule). Not the
// resident's valid_time minus its hour offset: that is the snapped product time, 1-2 h off when hour 0 sits off the 3-hourly cadence.
async function appAnchor(page) {
  const a = await page.evaluate(() => { const f = window.__RAW_SELECTED_FRAME__;
    return f && Number.isFinite(f.labelMs) && Number.isFinite(f.hour) ? f.labelMs - f.hour * 3600000 : null; });
  return a != null ? a : Math.round(Date.now() / 3600000) * 3600000;
}

async function expectedPid(model, anchor, hour) {
  const ask = new Date(anchor + hour * 3600000).toISOString();
  const r = await fetch(`http://127.0.0.1:${PORT}/api/weather/grid?model=${model}&domain=marine&layer=waves&valid_time=${encodeURIComponent(ask)}&bbox=-180,-80,180,85`);
  return (await r.json()).product_id;
}

async function open(caseName, { surf = false, zoom = 5.2, model = 'GFS' } = {}) {
  const v = VIEWS[VIEW];
  const consoleHits = [];
  const { browser, page, log } = await L.launch({ port: PORT, width: v.width, height: v.height, dpr: v.dpr, hashTextureUploads: false, hooks: {
    beforeWeather: async (url) => { const d = url.pathname.endsWith('/grid_series') ? LAT_SERIES : url.pathname.endsWith('/grid') ? LAT_GRID : 0; if (d) await sleep(d); } } });
  page.on('console', (m) => { const t = m.text(); if (/Stranded fetch-pending released|Abort-Gate\] Preserving|WebGLMarineEngine-Clear\]|render returned early/.test(t)) consoleHits.push({ t: Date.now() - log.t0, text: t.slice(0, 200) }); });
  await page.addInitScript(({ base, surf, theme }) => {
    localStorage.setItem('raw-surf-theme', theme);
    localStorage.removeItem('__RAW_STATIC_FRAMES__');
    window.__RAW_STATIC_FRAMES_BASE__ = base;
    localStorage.setItem('__SURF_MODE__', surf ? 'true' : 'false');
    window.__SURF_MODE__ = surf;
  }, { base: `http://127.0.0.1:${CDN_PORT}/`, surf, theme: THEME });
  await page.addInitScript(PROBE);
  await L.openMap(page);
  await L.jump(page, CENTER[0], CENTER[1], zoom);
  if (model !== 'GFS') await clickExact(page, model);
  await clickExact(page, 'Waves');
  await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 90000, polling: 50 });
  await sleep(SETTLE);
  return { browser, page, log, consoleHits, caseName };
}

// The timeline wheel (ForecastWheel) takes arrows (+-1 h), PageUp/PageDown (+-24 h) and Home (hour 0); it has NO End key.
// keysFor(from, to): the presses that move the wheel from one hour to another (Home when going to 0).
function keysFor(from, to) {
  if (to === 0) return ['Home'];
  const keys = []; let h = from;
  while (to - h >= 24) { keys.push('PageUp'); h += 24; }
  while (h - to >= 24) { keys.push('PageDown'); h -= 24; }
  while (h < to) { keys.push('ArrowRight'); h += 1; }
  while (h > to) { keys.push('ArrowLeft'); h -= 1; }
  return keys;
}

async function gotoHour(page, from, to) {
  const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
  for (const k of keysFor(from, to)) { await page.keyboard.press(k); await sleep(40); }
}

async function stepTo(page, from, target, model, anchor) {
  const expected = await expectedPid(model, anchor, target);
  await page.evaluate((o) => window.__OW__.arm(o), { expected, anchor, model });
  const keys = keysFor(from, target);
  const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
  for (const k of keys) { await page.keyboard.press(k); if (keys.length > 1) await sleep(60); }
  const key = keys.length > 1 ? `${keys[0]}..x${keys.length}` : keys[0];
  const t0 = Date.now(); let r;
  do { await sleep(50); r = await page.evaluate(() => window.__OW__.read()); } while (r.exact == null && Date.now() - t0 < WIN);
  await page.evaluate(() => { window.__OW__.w.done = true; });
  return { key, from, target, exactMs: r.exact, via: r.via, blankFrames: r.blank, end: { hour: r.end.hour, model: r.end.model, store: r.end.store, series: r.end.series, pid: r.end.pid } };
}

async function bandOff() {
  const s = await open('band_off', { surf: true, zoom: 5.21, model: 'ICON' });   // the owner's state: ICON, band on, z5.21
  try {
    const bandOn = await s.page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.ratingBand && window.__RAW_GPU__.ratingBand.active === true, null, { timeout: 60000, polling: 100 }).then(() => true).catch(() => false);
    await gotoHour(s.page, 0, 72);                                     // a scrub fetch in flight (LAT_SERIES / LAT_GRID)
    await sleep(300);
    const hits0 = s.consoleHits.length;
    await s.page.evaluate((ms) => { window.__OW__.arm({ onClick: true, bandMaxMs: ms }); }, BAND_MAX_MS);
    await clickExact(s.page, 'Surf Rating: ON');
    const toggled = await s.page.locator('button').filter({ hasText: /^\s*Surf Rating: OFF\s*$/ }).filter({ visible: true }).count() > 0;
    const t0 = Date.now(); let r;
    do { await sleep(50); r = await s.page.evaluate(() => window.__OW__.read()); } while (r.bandOff == null && Date.now() - t0 < 25000);
    await sleep(Math.max(0, 20000 - (Date.now() - t0)));         // watch for the stranded-fetch wedge after the click
    r = await s.page.evaluate(() => window.__OW__.read());
    const after = s.consoleHits.slice(hits0);
    const stranded = after.filter((h) => /Stranded fetch-pending released/.test(h.text));
    // Painting = the engine's band active AND its fade multiplier not 0 (#598 hides it through bandMult). A scrub's own edge/resolution
    // hold can zero the band for a frame right after the click and then let it paint again, so the case also asks that NO frame paints
    // it after BAND_MAX_MS (the measured tip 4b8563851: off at 3 ms by that hold, then 1,194 painting frames).
    const pass = bandOn && toggled && r.bandOff != null && r.bandOff <= BAND_MAX_MS && r.bandLateFrames === 0 && stranded.length === 0;
    return { case: 'band_off', pass, bandWasOn: bandOn, buttonReadsOff: toggled, flagAfter: await s.page.evaluate(() => window.__SURF_MODE__), bandOffMs: r.bandOff, bandOnFramesAfterClick: r.bandOnFrames, bandLateFrames: r.bandLateFrames, stranded: stranded.map((h) => h.text),
      abortGate: after.filter((h) => /Abort-Gate/.test(h.text)).length, criterion: `band stops painting <= ${BAND_MAX_MS} ms after OFF and paints no frame after that; no stranded-fetch release` };
  } finally { await s.browser.close(); }
}

async function iconFar() {
  const s = await open('icon_far', { zoom: 5.0, model: 'ICON' });
  try {
    const anchor = await appAnchor(s.page);
    const steps = [];
    // The owner's console: "rendered hour=29, requested hour=250", "137 -> 336", "242 -> 336": far jumps out and back.
    let at = 0;
    for (const t of [250, 328, 0, 240, 264, 320]) { steps.push(await stepTo(s.page, at, t, 'ICON', anchor)); at = t; }   // 336 is the wheel's clamp edge
    // Every jump is judged, each tagged with its region: 'tail' (inside the stored run + 336 h: frame store / series) or 'hold' (past
    // it: the server's far-edge hold, the day-14 end). The owner's slow jumps ("137 -> 336", "242 -> 336") land in the hold region;
    // offline every 'tail' jump is instant (2026-10-27: 2-42 ms, also with a 340 ms CDN), every 'hold' jump waits on /grid (~2.1 s).
    const tail = tailHour(anchor);
    steps.forEach((x) => { x.region = x.target <= tail ? 'tail' : 'hold'; });
    const fails = steps.filter((x) => x.exactMs == null || x.exactMs > STEP_MAX_MS);
    return { case: 'icon_far', pass: fails.length === 0, tailHour: tail, failRegions: [...new Set(fails.map((x) => x.region))], steps,
      criterion: `every far ICON jump at z5 exact within ${STEP_MAX_MS} ms of its last key (store or series; hours past ${tail} are the hold region)` };
  } finally { await s.browser.close(); }
}

// The owner's switch (console-0840): ICON at hour 328 (past EURO's native 240 h, whose tail the live CDN does not carry), z5.21, to EURO.
// The hour-0 GFS -> EURO switch is the CONTROL: EURO's native frame is in the store there, so it must pass on any build.
// SWITCH_AT (default 328, the owner's hour) is a wheel hour, or `run+N`: the hour whose valid time is the store's run + N h (the store's
// earliest non-estimated EURO waves global_mid product, read from EXPECT_STORE), clamped to 1..336. The fixed hour drifts against a
// synthetic store as the clock runs (328 was run+340 h at 17:55Z and run+348 h at 01:32Z on 2026-10-26/27, and the blank reproduced only
// in the first), so `run+N` pins the case to the same place in the run on any day.
function storeRunMs() {
  const dir = process.env.EXPECT_STORE;
  if (!dir) throw Error('SWITCH_AT=run+N needs EXPECT_STORE (the store directory)');
  const stamps = fs.readdirSync(dir).map((f) => /^euro_marine_waves_global_mid_(\d{8}T\d{6}Z)\.json$/.exec(f)).filter(Boolean)
    .map((m) => Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z'))).sort((a, b) => a - b);
  if (!stamps.length) throw Error(`no EURO waves global_mid product in ${dir}`);
  return stamps[0];
}
async function switchHour(page) {
  const spec = process.env.SWITCH_AT || '328';
  const m = /^run\+(\d+)$/.exec(spec);
  if (!m) return +spec;
  const anchor = await appAnchor(page);
  return Math.max(1, Math.min(336, Math.round((storeRunMs() + (+m[1]) * 3600000 - anchor) / 3600000)));
}

// The last wheel hour inside the store's stored tail (run + TAIL_H, 336: every ICON/EURO lane ends there; beyond it the server HOLDS the
// last frame, the day-14 end, a separate issue). A step past it is recorded, not judged.
const TAIL_H = +(process.env.TAIL_H || 336);
function tailHour(anchor) { return Math.floor((storeRunMs() + TAIL_H * 3600000 - anchor) / 3600000); }

async function euroSwitch() {
  const out = [];
  for (const v of [{ zoom: 5.21, from: 'ICON', hour: 'switch' }, { zoom: 3.0, from: 'GFS', hour: 0, control: true }]) {
    const s = await open('euro_switch', { zoom: v.zoom, model: v.from });
    try {
      if (v.hour === 'switch') { v.hour = await switchHour(s.page); v.at = process.env.SWITCH_AT || '328'; }
      if (v.hour) { await gotoHour(s.page, 0, v.hour); await sleep(SETTLE); }
      await s.page.evaluate(() => { window.__OW__.arm({ onClick: true, wantModel: 'EURO' }); });
      const hits0 = s.consoleHits.length;
      await clickExact(s.page, 'EURO');
      const t0 = Date.now(); let r;
      do { await sleep(50); r = await s.page.evaluate(() => window.__OW__.read()); } while (r.modelAt == null && Date.now() - t0 < WIN);
      await sleep(500);
      r = await s.page.evaluate(() => window.__OW__.read());
      out.push({ ...v, euroAtMs: r.modelAt, blankFrames: r.blank, firstBlankMs: r.firstBlank, framesWatched: r.frames, endHour: r.end.hour,
        clears: s.consoleHits.slice(hits0).filter((h) => /Clear\]|returned early/.test(h.text)).length });
    } finally { await s.browser.close(); }
  }
  return { case: 'euro_switch', pass: out.every((x) => x.blankFrames === 0 && x.euroAtMs != null), zooms: out, criterion: '0 blank frames between the EURO click and the first EURO frame' };
}

async function euro240() {
  const out = [];
  for (const zoom of [3.0, 5.0]) {
    const s = await open('euro_240', { zoom, model: 'EURO' });
    try {
      const anchor = await appAnchor(s.page);
      const steps = [];
      let at = 0;
      for (const t of [240, 264, 288, 312, 322, 323, 336]) { steps.push(await stepTo(s.page, at, t, 'EURO', anchor)); at = t; }
      out.push({ zoom, tailHour: tailHour(anchor), steps });
    } finally { await s.browser.close(); }
  }
  const past = out.flatMap((z) => z.steps.filter((x) => x.target > 240 && x.target <= z.tailHour));
  const fails = past.filter((x) => x.exactMs == null || x.exactMs > STEP_MAX_MS || x.via !== 'store');
  return { case: 'euro_240', pass: fails.length === 0, zooms: out, criterion: `every EURO step past 240 h and inside the stored tail exact from the store within ${STEP_MAX_MS} ms of its last key` };
}

(async () => {
  const id = await (await fetch(`http://127.0.0.1:${PORT}/__harness/identity`)).json();
  if (process.env.EXPECT_STORE && path.resolve(id.store) !== path.resolve(process.env.EXPECT_STORE)) throw Error(`port ${PORT} serves ${id.store}, not EXPECT_STORE`);
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const run = { band_off: bandOff, icon_far: iconFar, euro_switch: euroSwitch, euro_240: euro240 };
  const results = { env: { PORT, CDN_DIR, VIEW, THEME, LAT_GRID, LAT_SERIES, SETTLE, WIN, BAND_MAX_MS, STEP_MAX_MS, identity: id, startedUtc: new Date().toISOString() }, cases: [] };
  try {
    for (const c of CASES) {
      let r;
      try { r = await run[c](); } catch (e) { r = { case: c, pass: false, error: String(e && e.stack || e).slice(0, 800) }; }
      results.cases.push(r);
      console.log(`${r.pass ? 'PASS' : 'FAIL'} ${c}`, JSON.stringify(r).slice(0, 900));
      if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 1));
    }
  } finally { cdn.close(); }
  if (results.cases.some((r) => !r.pass)) process.exitCode = 1;
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
