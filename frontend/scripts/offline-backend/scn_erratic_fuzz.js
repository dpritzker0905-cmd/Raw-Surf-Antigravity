// THE ERRATIC FUZZER (2026-10-27, the owner 16:40Z: "All layers need to be instant. Work perfectly. Display correct data on heat map
// and in infobox ... scrub, pan, zoom, toggle all the layers on and off ... Do erratic actions on the map and log everything").
// OFFLINE ONLY: the built client over serve_synthetic.py; every non-127.0.0.1 request is answered locally or aborted, every
// WebSocket is closed, and a host audit is printed per sequence. Never point it at the live box.
//
// A seeded PRNG builds each sequence as a CONCRETE action list (so a replay is exact): wheel steps, held-key bursts at 30/s,
// PageUp/PageDown, Home, far jumps, small drags and continent flights, wheel zooms z2-10, layer chips (Waves, Swell, Swell 2,
// Wind Waves, Wind), the Surf Rating band, model chips, theme switches (the app's /theme page and back), viewport resize, device
// pixel ratio, infobox open (right-click / long-press at a sea point) and close, the phone's weather sheet, injected faults
// (backend latency / 429 / 503 / timeout; CDN latency / 404 / corrupt frame / 429), WebGL context loss + restore, and idle.
// Each action is followed by a gap: settle (wait for the exact frame), or a short/mid/long pause (the next action lands mid-fetch).
// Profiles bias sequences toward known hot spots (EURO past h144 and its tail, ICON's estimated tail, day-14 holds, zoom 8-9
// regional tiles, model switches at mid zoom, the band during a scrub, faults, WebGL/viewport faults).
//
// Invariants (erratic_probe.js judges every rendered frame; this file checks each action's outcome):
//   inv1 blank / alpha 0 frame with a marine layer on      inv2 silent mislabel / unworded nearest / drawn record off the resident
//   inv3 Loading > 3 s with nothing in flight; a frame that never reaches the asked hour while the store has it
//   inv4 band paints > 100 ms after OFF; band ON shows nothing and says nothing      inv5 drawn model != selected, silently
//   inv6 infobox: model, hour, offshore height vs point and heatmap, surf labelled as breaking      inv7 console errors, repeated
//   asks, non-local hosts      inv8 timing (report only): last input -> the exact frame on the next 'render' event
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS,ICON,EURO \
//       --layers waves,swell_1,swell_2,wind_waves,wind --regions florida_east_coast,us_west_coast_socal,france_biscay \
//       --dynamic 1 --land-mask 1 --enclosed-seas 1 --port 4120     (env: MARINE_GULF_FILL_MID_TARGETED=1 MARINE_REGIONAL_TILE_FIRST=1
//       FAR_EDGE_HOLD_PREFER_MID=1, the live box's flags)
//   python backend/scripts/publish_frame_images.py --store-dir <store> --out-dir <cdn> --only frames
//   node frontend/scripts/offline-backend/serve_spa.js <build with REACT_APP_ICON_STORED_TAIL=true> 3120
//   AB_BASE=http://127.0.0.1:3120 PORT=4120 EXPECT_STORE=<store> CDN_DIR=<cdn> CDN_PORT=3121 SEEDS=1-40 OUT_DIR=<dir> \
//       node frontend/scripts/offline-backend/scn_erratic_fuzz.js
// Env: SEEDS (1-40 | 3,7,9), ACTIONS (60), VIEWS (desktop,phone: sequence s uses VIEWS[s % n]), PROFILE (force one), PIXEL (1),
// REPLAY=<file.json> (a sequence or {sequences}) with KIND=<violation kind> + SHRINK=1 (ddmin to the fewest actions that still show
// KIND; CONFIRM=3 replays the minimum), SETTLE_MAX (7000), SHOTS (6 per sequence).
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');
const { PROBE } = require('./erratic_probe.js');

if (process.env.AB_LIVE === '1') throw Error('scn_erratic_fuzz is offline only (never load the live box)');
const BASE = process.env.AB_BASE; if (!BASE) throw Error('AB_BASE=http://127.0.0.1:<SPA port> is required');
const PORT = +(process.env.PORT || 4120);
const CDN_DIR = process.env.CDN_DIR; if (!CDN_DIR) throw Error('CDN_DIR=<published frames> is required');
// RUN ROLLOVER (the 'rollover' action, scenario only): the backend and the CDN the page reads switch to ROLL_PORT / ROLL_CDN_DIR, a
// store and a published copy one model run newer, as a new cycle landing mid-session does
const target = { port: PORT, cdnDir: CDN_DIR };
const CDN_PORT = +(process.env.CDN_PORT || 3121);
const OUT_DIR = process.env.OUT_DIR || path.join(__dirname, 'OB', 'fuzz-2026-10-27');
const N_ACTIONS = +(process.env.ACTIONS || 60);
const VIEWS = (process.env.VIEWS || 'desktop,phone').split(',');
const SETTLE_MAX = +(process.env.SETTLE_MAX || 7000);
const SHOTS = +(process.env.SHOTS || 6);
const PIXEL = process.env.PIXEL !== '0';
const H = 3600000;
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const USER = { id: 'test-surfer-id', email: 'surfer@rawsurf.com', full_name: 'Standard Surfer', username: 'standardsurfer', role: 'user', subscription_tier: 'premium', is_admin: false };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'cache-control': 'no-store' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT_DIR, { recursive: true });
const LAYER_OF = { Waves: 'waves', Swell: 'swell_1', 'Swell 2': 'swell_2', 'Wind Waves': 'wind_waves' };
// the height card per layer, by its accessible name (forecastCardCompiler.js ariaLabel), and the /point field it shows
const CARD_OF = { waves: { aria: /^Offshore swell height (.+)$/, field: 'wave_height' }, swell_1: { aria: /^Primary swell train height (.+)$/, field: 'swell_wave_height' },
  swell_2: { aria: /^Secondary swell train height (.+)$/, field: 'secondary_swell_wave_height' }, wind_waves: { aria: /^Wind wave \(windsea\) height (.+)$/, field: 'wind_wave_height' } };
// an episode of a label/model condition counts as a violation from 3 rendered frames and 50 ms (a 1-2 frame lag between the React
// line and the canvas is recorded as `transient`); a blank frame counts from 1
const MIN_FRAMES = +(process.env.MIN_FRAMES || 3); const MIN_MS = +(process.env.MIN_MS || 50);
const COUNTS_FROM_ONE = new Set(['inv1_blank', 'inv1_alpha0']);

// ---------------------------------------------------------------- seeded generator
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PLACES = [
  { n: 'world', c: [0, 20], z: 2 }, { n: 'atlantic', c: [-40, 30], z: 3 }, { n: 'pacific', c: [-150, 20], z: 3 }, { n: 'mexico_vortex', c: [-108, 16], z: 4.6 },
  { n: 'florida_mid', c: [-79.5, 28.6], z: 5.2 }, { n: 'florida_z8', c: [-80.2, 27.6], z: 8 }, { n: 'florida_z9', c: [-80.6, 28.1], z: 9 },
  { n: 'socal_z6', c: [-119.5, 33], z: 6 }, { n: 'socal_z85', c: [-118.6, 33.6], z: 8.5 }, { n: 'biscay_z5', c: [-4, 45.5], z: 5 }, { n: 'biscay_z85', c: [-2.2, 44.2], z: 8.5 },
  { n: 'hawaii', c: [-157.5, 20.5], z: 6 }, { n: 'indonesia', c: [115, -9], z: 5 }, { n: 'australia', c: [152, -30], z: 4 }, { n: 'eastcoast_z46', c: [-75, 30], z: 4.6 },
  { n: 'z10_florida', c: [-80.05, 26.7], z: 10 }, { n: 'antimeridian', c: [179, -20], z: 3.5 },
];
const REGIONAL = PLACES.filter((p) => /z8|z9|z85|z10/.test(p.n));
const SEA_POINTS = [[-60, 30], [-40, 35], [-150, 25], [-125, 30], [-30, -20], [170, -30], [-80.3, 28.2], [-118.9, 33.4], [-3.0, 45.5], [-108, 16], [90, -10], [-157.9, 21.0],
  [-79.7, 27.0], [-2.6, 44.6], [-119.2, 33.1], [-50, 10], [-20, 40], [140, 30], [-75, 31], [-77.5, 29.5]];
const PROFILES = ['random', 'euro_tail', 'icon_tail', 'regional', 'model_mid', 'band_scrub', 'faults', 'gl_viewport'];
const FAULTS = ['w_lat', 'w_429', 'w_503', 'w_timeout', 'c_lat', 'c_404', 'c_corrupt', 'c_429'];

function generate(seed, n, view, forceProfile) {
  const R = mulberry32(seed * 2654435761);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const ri = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
  const profile = forceProfile || PROFILES[(seed - 1) % PROFILES.length];
  const theme0 = ['dark', 'light', 'beach'][Math.floor(seed / 2) % 3];
  const model0 = profile === 'euro_tail' ? 'EURO' : profile === 'icon_tail' ? 'ICON' : pick(['GFS', 'GFS', 'EURO', 'ICON']);
  const start = profile === 'regional' ? pick(REGIONAL) : profile === 'model_mid' ? pick(PLACES.filter((p) => p.z >= 4.5 && p.z <= 6)) : pick(PLACES);
  const layer0 = R() < 0.7 ? 'Waves' : pick(['Swell', 'Swell 2', 'Wind Waves']);
  const W = { step: 10, burst: 6, day: 6, home: 3, jump: 6, pan: 6, fly: 5, zoom: 5, layer: 7, band: 4, model: 6, theme: 1.2, viewport: view === 'desktop' ? 1 : 0.5, dpr: 0.8,
    infobox: 4, infoclose: 2, sheet: view === 'phone' ? 1.5 : 0, fault: 2, gl: 0.8, wait: 3 };
  if (profile === 'euro_tail' || profile === 'icon_tail') { W.jump = 12; W.day = 10; W.model = 2; }
  if (profile === 'regional') { W.fly = 3; W.pan = 9; W.zoom = 6; }
  if (profile === 'model_mid') { W.model = 14; W.jump = 8; }
  if (profile === 'band_scrub') { W.band = 12; W.burst = 12; }
  if (profile === 'faults') { W.fault = 12; }
  if (profile === 'gl_viewport') { W.gl = 6; W.viewport = view === 'desktop' ? 5 : 2; W.dpr = 5; }
  const types = Object.keys(W); const tot = types.reduce((a, k) => a + W[k], 0);
  const drawType = () => { let x = R() * tot; for (const k of types) { x -= W[k]; if (x <= 0) return k; } return 'wait'; };
  const hourTarget = () => {
    if (profile === 'euro_tail') return R() < 0.8 ? ri(120, 336) : ri(0, 336);
    if (profile === 'icon_tail') return R() < 0.8 ? ri(160, 336) : ri(0, 336);
    const x = R(); return x < 0.15 ? ri(300, 336) : x < 0.35 ? ri(120, 200) : ri(0, 336);
  };
  const gap = () => { const x = R(); return x < 0.4 ? 'settle' : x < 0.65 ? ri(0, 120) : x < 0.85 ? ri(150, 600) : ri(800, 2000); };
  const actions = [];
  for (let i = 0; i < n; i++) {
    const t = drawType(); let a;
    switch (t) {
      case 'step': a = { type: 'step', key: R() < 0.75 ? 'ArrowRight' : 'ArrowLeft' }; break;
      case 'burst': a = { type: 'burst', key: R() < 0.8 ? 'ArrowRight' : 'ArrowLeft', n: ri(3, 30), gapMs: 33 }; break;
      case 'day': a = { type: 'day', key: R() < 0.7 ? 'PageUp' : 'PageDown', n: ri(1, 3) }; break;
      case 'home': a = { type: 'home' }; break;
      case 'jump': a = { type: 'jump', hour: hourTarget() }; break;
      case 'pan': a = { type: 'pan', dx: ri(-260, 260), dy: ri(-160, 160) }; break;
      case 'fly': { const p = profile === 'regional' && R() < 0.7 ? pick(REGIONAL) : pick(PLACES); a = { type: 'fly', place: p.n, c: p.c, z: +(p.z + (R() - 0.5) * 0.6).toFixed(2), mode: pick(['jump', 'fly', 'ease']) }; break; }
      case 'zoom': a = { type: 'zoom', ticks: pick([-3, -2, -1, 1, 2, 3]), fx: +(0.3 + R() * 0.4).toFixed(2), fy: +(0.3 + R() * 0.4).toFixed(2) }; break;
      case 'layer': a = { type: 'layer', name: pick(['Waves', 'Waves', 'Swell', 'Swell 2', 'Wind Waves', 'Wind']) }; break;
      case 'band': a = { type: 'band' }; break;
      case 'model': a = { type: 'model', name: pick(['GFS', 'EURO', 'ICON']) }; break;
      case 'theme': a = { type: 'theme', to: pick(['dark', 'light', 'beach']) }; break;
      case 'viewport': a = view === 'desktop' ? { type: 'viewport', w: pick([1280, 1024, 1440, 844, 1600]), h: pick([800, 700, 900, 390]) } : { type: 'viewport', w: pick([390, 844]), h: pick([844, 390]) }; break;
      case 'dpr': a = { type: 'dpr', dpr: pick([1, 2, 3]) }; break;
      case 'infobox': a = { type: 'infobox', pt: ri(0, SEA_POINTS.length - 1) }; break;
      case 'infoclose': a = { type: 'infoclose' }; break;
      case 'sheet': a = { type: 'sheet' }; break;
      case 'fault': a = { type: 'fault', kind: pick(FAULTS), durMs: ri(1500, 9000) }; break;
      case 'gl': a = { type: 'gl', restoreMs: ri(200, 2500) }; break;
      default: a = { type: 'wait', ms: ri(300, 3000) };
    }
    a.gap = (a.type === 'infobox' || a.type === 'theme' || a.type === 'gl' || a.type === 'dpr' || a.type === 'viewport') ? 'settle' : gap();
    actions.push(a);
  }
  return { seed, view, profile, theme0, model0, layer0, start: { place: start.n, c: start.c, z: start.z }, actions };
}

// ---------------------------------------------------------------- the CDN stand-in, with faults
const fault = { kind: null, until: 0, windows: [] };
const holdSurf = { active: false, releaseAt: Infinity };
let currentLog = null;   // the running sequence's request log (the infobox check re-asks the app's own /point)   // repro only: the 'w_hold_surf_off' fault
const faultOn = (k) => fault.kind === k && Date.now() < fault.until;
let cdnLog = [];
const cdn = http.createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const rec = { t: Date.now(), path: rel, status: 200, fault: null };
  cdnLog.push(rec);
  const isFrame = /\.bin$/.test(rel);
  if (faultOn('c_lat')) { rec.fault = 'c_lat'; await sleep(340); }
  if (faultOn('c_429') && isFrame) { rec.fault = 'c_429'; rec.status = 429; res.writeHead(429, { 'access-control-allow-origin': '*', 'content-type': 'application/json' }); return res.end('{"statusCode":"429","error":"Too Many Requests"}'); }
  if (faultOn('c_404') && isFrame) { rec.fault = 'c_404'; rec.status = 400; res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' }); return res.end('{"statusCode":"404","error":"not_found"}'); }
  const file = path.join(target.cdnDir, rel);
  if (!file.startsWith(path.resolve(target.cdnDir)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    rec.status = 400; res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' }); return res.end('{"statusCode":"404","error":"not_found"}');
  }
  let body = fs.readFileSync(file);
  if (faultOn('c_corrupt') && isFrame) { rec.fault = 'c_corrupt'; body = body.subarray(0, Math.max(8, Math.floor(body.length / 2))); }
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length, 'content-type': isFrame ? 'application/octet-stream' : 'application/json',
    'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  res.end(body);
});

// ---------------------------------------------------------------- the strict browser
async function launch(view) {
  const args = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-swiftshader', '--use-angle=d3d11'];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
  const ctxOpts = view === 'phone' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
  const ctx = await browser.newContext({ ...ctxOpts, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const log = { t0: Date.now(), requests: [], console: [], errors: [], hosts: {}, blockedWs: [], aborted: {}, stubbed: 0 };
  currentLog = log;
  await page.routeWebSocket(/.*/, (ws) => { const h = new URL(ws.url()).hostname; log.blockedWs.push(h); return ws.close({ code: 1008, reason: 'offline harness' }); });
  page.on('request', (r) => { try { const h = new URL(r.url()).hostname; log.hosts[h] = (log.hosts[h] || 0) + 1; } catch (e) { /* data: */ } });
  await page.route('**/*', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const method = req.method();
    if (url.hostname === '127.0.0.1') return route.continue();
    if (/(^|\.)onrender\.com$/.test(url.hostname)) {
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (url.pathname.startsWith('/api/weather/client-diagnostics')) return route.fulfill({ status: 204, headers: CORS });
      if (url.pathname.startsWith('/api/weather/') && method === 'GET') {
        const t = Date.now(); const p = url.pathname.replace('/api/weather', '');
        const q = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
        const rec = { t: t - log.t0, path: p, key: `${p}?${q}`, fault: null, status: null, ms: null };
        log.requests.push(rec);
        const marine = /^\/(grid|grid_series|point)$/.test(p);
        try {
          if (marine && faultOn('w_lat')) { rec.fault = 'w_lat'; await sleep(p === '/grid_series' ? 6000 : 1500); }
          if (marine && faultOn('w_429')) { rec.fault = 'w_429'; rec.status = 429; return route.fulfill({ status: 429, headers: { ...CORS, 'content-type': 'application/json', 'retry-after': '2' }, body: '{"detail":"rate limited"}' }); }
          if (marine && faultOn('w_503')) { rec.fault = 'w_503'; rec.status = 503; return route.fulfill({ status: 503, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"detail":"unavailable"}' }); }
          if (marine && faultOn('w_timeout')) { rec.fault = 'w_timeout'; while (faultOn('w_timeout')) await sleep(100); rec.status = 504; return route.fulfill({ status: 504, headers: CORS, body: '' }); }
          const resp = await route.fetch({ url: `http://127.0.0.1:${target.port}${url.pathname}${url.search}` });
          // REPRO ONLY (never drawn by the generator): hold a Surf Rating (surf=1) /grid answer until the window ends, so it lands at a
          // chosen moment (e.g. just after the band is switched off)
          if (p === '/grid' && url.searchParams.get('surf') === '1' && faultOn('w_hold_surf')) { rec.fault = 'w_hold_surf'; while (faultOn('w_hold_surf')) await sleep(5); rec.releasedAt = Date.now() - log.t0; }
          // REPRO ONLY: held until the band is switched OFF, then released HOLD_DELTA ms after that click
          if (p === '/grid' && url.searchParams.get('surf') === '1' && holdSurf.active) { rec.fault = 'w_hold_surf_off'; while (Date.now() < holdSurf.releaseAt) await sleep(2); rec.releasedAt = Date.now() - log.t0; holdSurf.active = false; }
          rec.status = resp.status(); rec.ms = Date.now() - t;
          return route.fulfill({ response: resp, headers: { ...resp.headers(), ...CORS } });
        } catch (e) { rec.status = 502; rec.error = String(e).slice(0, 100); return route.fulfill({ status: 502, headers: CORS, body: '{}' }).catch(() => {}); }
      }
      if (url.pathname.includes('/api/location/ip-geolocation')) {
        return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ success: true, latitude: 16, longitude: -108, city: 'Puerto Vallarta', region: 'Jalisco', country: 'MX', accuracy: 'city', is_coastal: true, coastal_snapped: true }) });
      }
      log.stubbed += 1;
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: method === 'GET' ? '[]' : '{}' });
    }
    log.aborted[url.hostname] = (log.aborted[url.hostname] || 0) + 1;   // every other host: never sent
    return route.abort();
  });
  await page.addInitScript(({ user, cdnBase }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(user));
    localStorage.setItem(`tos-accepted-${user.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('__RAW_DIAG__', '0'); localStorage.setItem('__RAW_TUNER__', '0');
    localStorage.removeItem('__RAW_STATIC_FRAMES__'); window.__RAW_STATIC_FRAMES_BASE__ = cdnBase;
  }, { user: USER, cdnBase: `http://127.0.0.1:${CDN_PORT}/` });
  await page.addInitScript(PROBE);
  page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') log.console.push({ t: Date.now() - log.t0, type: t, text: m.text().slice(0, 300) }); });
  page.on('pageerror', (e) => log.errors.push({ t: Date.now() - log.t0, text: String((e && (e.stack || e.message)) || e).slice(0, 500) }));
  page.on('crash', () => log.errors.push({ t: Date.now() - log.t0, text: 'PAGE CRASH' }));
  const cdp = await ctx.newCDPSession(page);
  return { browser, ctx, page, log, cdp };
}

// ---------------------------------------------------------------- UI helpers
const visibleButton = (page, text) => page.locator('button').filter({ hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).filter({ visible: true }).first();
async function openSheetIfNeeded(page) {
  const sheet = page.locator('[aria-label="Weather layers"][aria-expanded="false"], [aria-label="Expand weather controls"]').filter({ visible: true }).first();
  if (await sheet.count()) { await sheet.click({ timeout: 3000 }).catch(() => sheet.evaluate((el) => el.click())); await sleep(350); }
}
async function clickChip(page, text) {
  let loc = visibleButton(page, text);
  if (!(await loc.count())) { await openSheetIfNeeded(page); loc = visibleButton(page, text); }
  await loc.waitFor({ state: 'visible', timeout: 6000 });
  await loc.click({ timeout: 2500 }).catch(() => loc.evaluate((el) => el.click()));
}
async function focusWheel(page, rec) {
  let w = page.locator(WHEEL).filter({ visible: true }).first();
  if (!(await w.count())) { await openSheetIfNeeded(page); w = page.locator(WHEEL).filter({ visible: true }).first(); }
  if (!(await w.count())) {   // no weather layer on (the wheel hides): the user turns Waves on first
    await clickChip(page, 'Waves'); await sleep(400); if (rec) rec.note = 'wheel hidden: Waves turned on first';
    w = page.locator(WHEEL).filter({ visible: true }).first();
  }
  await w.focus({ timeout: 4000 });
}
const wheelHour = (page) => page.evaluate((sel) => { const w = document.querySelector(sel); return w ? +w.getAttribute('aria-valuenow') : null; }, WHEEL);
function keyRun(from, to) {
  if (to === 0) return ['Home'];
  const keys = []; let h = from;
  while (to - h >= 24) { keys.push('PageUp'); h += 24; }
  while (h - to >= 24) { keys.push('PageDown'); h -= 24; }
  while (h < to) { keys.push('ArrowRight'); h += 1; }
  while (h > to) { keys.push('ArrowLeft'); h -= 1; }
  return keys;
}
const mapBox = (page) => page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; const r = m.getCanvas().getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
async function touchDrag(cdp, x0, y0, x1, y1, steps = 8) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] }); await sleep(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function navigateSpa(page, p) {
  await page.evaluate((to) => { window.history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, p);
}

// ---------------------------------------------------------------- the expected product (asked of the offline backend directly)
const expCache = new Map();
async function expectedInstants(model, layer, labelMs, box) {
  const boxes = ['-180,-80,180,85'].concat(box ? [box] : []);
  const out = [];
  for (const b of boxes) {
    const k = `${target.port}|${model}|${layer}|${labelMs}|${b}`;
    if (!expCache.has(k)) {
      let v = null;
      try {
        const j = await (await fetch(`http://127.0.0.1:${target.port}/api/weather/grid?model=${model}&domain=marine&layer=${layer}&valid_time=${encodeURIComponent(new Date(labelMs).toISOString())}&bbox=${b}`)).json();
        const m = /(\d{8}T\d{6}Z)/.exec(j.product_id || '');
        v = { ms: m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : (Date.parse(j.served_valid_time || '') || null), pid: j.product_id || null, est: !!j.is_estimated, basis: j.estimate_basis && j.estimate_basis.type };
      } catch (e) { v = { ms: null, error: String(e).slice(0, 80) }; }
      expCache.set(k, v);
    }
    const v = expCache.get(k); if (v && v.ms) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------- one sequence
async function runSequence(seq, { tag = '', stopAfter = null, quiet = false } = {}) {
  const view = seq.view;
  target.port = PORT; target.cdnDir = CDN_DIR;   // every sequence starts on the base run
  const { browser, ctx, page, log, cdp } = await launch(view);
  const out = { seed: seq.seed, view, profile: seq.profile, theme0: seq.theme0, model0: seq.model0, layer0: seq.layer0, start: seq.start, tag, startedUtc: new Date().toISOString(),
    actions: [], episodes: [], infobox: [], shots: [], faults: [], pixel: [], longtasks: [], buckets: [], rejections: [], frames: 0, harnessErrors: [] };
  const shotKinds = new Set(); let shotsTaken = 0;
  const shot = async (kind, idx) => {
    if (shotsTaken >= SHOTS || shotKinds.has(kind)) return null;
    shotKinds.add(kind); shotsTaken += 1;
    const f = path.join(OUT_DIR, 'shots', `s${seq.seed}${tag}-a${idx}-${kind}.png`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    try { await page.screenshot({ path: f, timeout: 5000 }); out.shots.push({ kind, idx, file: path.relative(OUT_DIR, f) }); return f; } catch (e) { return null; }
  };
  const watchOpen = async (idx) => {   // a violation open right now: screenshot it while it is on screen
    const keys = await page.evaluate(() => Object.values(window.__FZ__.open).map((e) => e.kind)).catch(() => []);
    for (const k of keys) await shot(k, idx);
  };
  const drain = async () => {
    const d = await page.evaluate(() => window.__FZ__.drain()).catch(() => null);
    if (!d) return;
    out.episodes.push(...d.episodes); out.buckets.push(...d.buckets); out.longtasks.push(...d.longtasks); out.rejections.push(...d.rejections); out.frames = d.frames;
    if (d.pixelLog.length) out.pixel.push(...d.pixelLog);
    out.pixelMeta = Object.assign(out.pixelMeta || {}, d.pixelMeta || {});
  };
  const setFault = async (kind, durMs) => {
    fault.kind = kind; fault.until = Date.now() + durMs; out.faults.push({ kind, t: Date.now() - log.t0, durMs });
    await page.evaluate(() => { window.__FZ__.faultActive = true; }).catch(() => {});
    setTimeout(async () => { if (fault.kind === kind && Date.now() >= fault.until - 5) { fault.kind = null; await page.evaluate(() => { window.__FZ__.faultActive = false; }).catch(() => {}); } }, durMs + 10);
  };
  let cdnFrom = cdnLog.length;
  try {
    await page.addInitScript((theme) => { localStorage.setItem('raw-surf-theme', theme); }, seq.theme0);
    await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.__MAP_INSTANCE__ || window.map), null, { timeout: 90000 });
    await sleep(1500);
    await page.evaluate(({ c, z }) => { const m = window.__MAP_INSTANCE__; m.stop(); m.jumpTo({ center: c, zoom: z }); }, seq.start);
    await clickChip(page, seq.layer0);
    if (seq.model0 !== 'GFS') await clickChip(page, seq.model0);
    const fp0 = Date.now();
    await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 60000, polling: 100 })
      .then(() => { out.firstPaintMs = Date.now() - fp0; })
      .catch(async () => { out.firstPaintMs = null; out.firstPaintMiss = { ui: await page.evaluate(() => window.__FZ__.readUi()).catch(() => null), diag: await diagSnapshot(page) }; await shot('boot_no_first_paint', -1); });
    await sleep(3000);
    out.bundle = await page.evaluate(() => { const s = [...document.scripts].map((x) => x.src).find((x) => /\/main\.[0-9a-f]+\.js/.test(x)); return s ? s.split('/').pop() : null; });
    out.idleTwoRaf = await page.evaluate(() => new Promise((resolve) => { const o = []; const one = () => { const t0 = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => { o.push(performance.now() - t0); if (o.length < 12) setTimeout(one, 30); else { o.sort((a, b) => a - b); resolve(+o[6].toFixed(1)); } })); }; one(); }));
    await drain();
    out.bootEpisodes = out.episodes; out.episodes = [];   // the boot's own episodes are kept apart (not in the totals)
    for (let i = 0; i < seq.actions.length; i++) {
      if (stopAfter != null && i > stopAfter) break;
      const a = seq.actions[i];
      const rec = { i, type: a.type, a, t: Date.now() - log.t0 };
      out.actions.push(rec);
      try {
        await page.evaluate(([idx, type]) => window.__FZ__.beginAction(idx, type), [i, a.type]);
        const before = await page.evaluate(() => { const u = window.__FZ__.readUi(); return { model: u.model, layer: u.layer, hour: u.hour, band: u.band, wind: u.wind }; });
        rec.before = before;
        await execute(page, cdp, ctx, a, view, rec, setFault, out);
        rec.inputDoneAt = Date.now() - log.t0;
        await page.evaluate(() => window.__FZ__.markInput());
        // the selection after the input, and the frame it should draw
        const sel = await page.evaluate(() => { const u = window.__FZ__.readUi(); const m = window.__MAP_INSTANCE__ || window.map;
          const b = m.getBounds(); return { model: u.model, layer: u.layer, hour: u.hour, band: u.band, zoom: m.getZoom(), box: [Math.floor(b.getWest()), Math.floor(b.getSouth()), Math.ceil(b.getEast()), Math.ceil(b.getNorth())].join(','),
            labelMs: (window.__RAW_SELECTED_FRAME__ && window.__RAW_SELECTED_FRAME__.hour === u.hour && Number.isFinite(window.__RAW_SELECTED_FRAME__.labelMs)) ? window.__RAW_SELECTED_FRAME__.labelMs : Math.round(Date.now() / 3600000) * 3600000 + (u.hour || 0) * 3600000 }; });
        rec.sel = { model: sel.model, layer: sel.layer, hour: sel.hour, band: sel.band, zoom: +sel.zoom.toFixed(2) };
        let expDone = null;
        if (sel.layer && sel.model && Number.isFinite(sel.hour)) {
          // arm NOW (the clock starts at the last input; the probe's ring keeps every frame), and fill the expectation when the backend
          // answers: asking it inline delayed the next action by the backend's latency (seconds when loaded), so "mid-fetch" gaps were not
          rec.armLagMs = Math.max(0, Date.now() - log.t0 - rec.inputDoneAt);
          await page.evaluate((arm) => window.__FZ__.setArm(arm), { id: i, model: sel.model, layer: sel.layer, expected: [], band: !!sel.band,
            bandWant: a.type === 'band' ? !!sel.band : null, lagMs: rec.armLagMs });
          const tAsk = Date.now();
          expDone = expectedInstants(sel.model, sel.layer, sel.labelMs, sel.zoom >= 6.5 ? sel.box : null).then(async (exp) => {
            rec.expected = exp.map((e) => ({ iso: e.ms ? new Date(e.ms).toISOString() : null, est: e.est, basis: e.basis }));
            rec.expectedAfterMs = Date.now() - tAsk;
            await page.evaluate(([id, list]) => window.__FZ__.fillArm(id, list), [i, exp.map((e) => e.ms)]).catch(() => {});
          });
        }
        // the gap: settle (wait for the exact frame) or a pause (the next action lands mid-fetch)
        const settle = a.gap === 'settle';
        const waitMs = settle ? (fault.kind && Date.now() < fault.until ? Math.max(SETTLE_MAX, fault.until - Date.now() + SETTLE_MAX) : SETTLE_MAX) : a.gap;
        const tEnd = Date.now() + waitMs; let arm = null;
        do {
          await sleep(Math.min(60, Math.max(0, tEnd - Date.now())));
          arm = await page.evaluate(() => window.__FZ__.readArm()).catch(() => null);
          await watchOpen(i);
          if (settle && arm && arm.exactMs != null && (arm.fullMs != null || Date.now() > tEnd - SETTLE_MAX + 2500) && (a.type !== 'band' || arm.bandMs != null)) break;
        } while (Date.now() < tEnd);
        if (settle && expDone) {   // a settled action is judged only once its expectation is known (bounded wait)
          await Promise.race([expDone, sleep(20000)]);
          if (!rec.expected) rec.note = (rec.note ? rec.note + '; ' : '') + 'expectation not known in 20 s (backend slow)';
          arm = await page.evaluate(() => window.__FZ__.readArm()).catch(() => arm);
        }
        rec.arm = arm; rec.settled = settle;
        if (settle && sel.layer && rec.expected && rec.expected.length) {
          rec.outcome = arm && arm.exactMs != null ? 'exact' : 'missed';
          if (rec.outcome === 'missed') {
            rec.missState = await page.evaluate(() => ({ res: window.__FZ__.resident(), status: window.__FZ__.readUi().statuses, inflight: window.__MARINE_INFLIGHT__ && window.__MARINE_INFLIGHT__.active ? window.__MARINE_INFLIGHT__.active.length : null,
              pending: !!window.__MARINE_FETCH_PENDING__, drawn: window.__MARINE_DRAWN__, store: (() => { try { const f = window.__RAW_FRAME_STORE__; return f && f.shows ? { shows: f.shows.n, misses: f.shows.misses } : null; } catch (e) { return null; } })() }));
            rec.missState.diag = await diagSnapshot(page);
            await shot('inv3_never_exact', i);
          }
        }
        if (a.type === 'band' && arm) rec.bandMs = arm.bandMs;
        if (PIXEL && settle && (rec.outcome === 'exact' || a.type === 'gl') && (i % 3 === 0 || a.type === 'gl' || a.type === 'dpr' || a.type === 'viewport' || a.type === 'band')) {
          await armPixels(page, `a${i}`, 3); await sleep(250);
        }
        if (a.type === 'infobox' && rec.infobox) { out.infobox.push({ i, ...rec.infobox }); for (const v of rec.infobox.violations || []) await shot(v, i); }
      } catch (e) {
        rec.error = String(e && e.message || e).slice(0, 300);
        out.harnessErrors.push(`a${i} ${a.type}: ${rec.error}`);
        if (/Target closed|crash|has been closed/.test(rec.error)) break;
      }
      await drain();
    }
    await page.evaluate(() => window.__FZ__.closeAll()).catch(() => {});
    await drain();
    out.statusAtEnd = await page.evaluate(() => window.__FZ__ && window.__FZ__.readUi().statuses).catch(() => null);
    out.diagAtEnd = await diagSnapshot(page);
  } catch (e) {
    out.harnessErrors.push('session: ' + String(e && e.stack || e).slice(0, 500));
  } finally {
    fault.kind = null;
    out.requests = log.requests; out.console = log.console; out.pageErrors = log.errors; out.hosts = log.hosts; out.aborted = log.aborted; out.blockedWs = log.blockedWs; out.stubbed = log.stubbed;
    out.cdn = cdnLog.slice(cdnFrom).map((r) => ({ t: r.t - log.t0, path: r.path, status: r.status, fault: r.fault }));
    out.endedUtc = new Date().toISOString();
    await browser.close().catch(() => {});
  }
  summarizeSequence(out);
  if (!quiet) console.log(lineOf(out));
  return out;
}

// The app's own account of why a frame is (not) on screen: the layer's drop record, the parity and heatmap status objects, the
// frame store's misses and the forensic ring's last commits / rejects / clears.
const diagSnapshot = (page) => page.evaluate(() => {
  const j = (x) => { try { return x == null ? null : JSON.parse(JSON.stringify(x)); } catch (e) { return String(e); } };
  const f = window.__RAW_FORENSIC__; const d = f && f.dump ? f.dump() : null;
  let store = null; try { const s = window.__RAW_FRAME_STORE__; store = s ? { shows: s.shows, crop: s.crop && { built: s.crop.built, shows: s.crop.shows, window: s.crop.window && s.crop.window.key }, sets: (s.sets || []).map((x) => `${x.key.split('|')[0]} ${x.mode} res${x.resident} abs${x.absent}`) } : null; } catch (e) { store = String(e); }
  return { drop: j(window.__SWELL2_LAST_DROP__), parity: j(window.__MARINE_RENDER_HOUR_PARITY__), heatmap: j(window.__MARINE_HEATMAP_STATUS__),
    upload: j(window.__WEBGL_MARINE_UPLOAD_DIAG__), clears: window.__WEBGL_MARINE_CLEAR_COUNT__ || 0, store,
    ring: d ? d.events.slice(-30).map((e) => { const o = {}; for (const [k, v] of Object.entries(e)) if (v == null || typeof v !== 'object') o[k] = typeof v === 'string' ? v.slice(0, 80) : v; return o; }) : null };
}).catch((e) => ({ error: String(e).slice(0, 120) }));

async function armPixels(page, tag, frames) {
  // a 6 x 4 lattice of screen points, inner 80% of the canvas (the driver judges colour only where the grid is open sea)
  const pts = []; for (let yi = 0; yi < 4; yi++) for (let xi = 0; xi < 6; xi++) pts.push([+(0.12 + xi * 0.152).toFixed(3), +(0.2 + yi * 0.2).toFixed(3)]);
  await page.evaluate(([t, p, f]) => {
    const F = window.__FZ__; const m = window.__MAP_INSTANCE__ || window.map; const c = m.getCanvas();
    const W = c.clientWidth; const Hh = c.clientHeight; const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid;
    // the grid value the heatmap holds under each point (bilinear on the resident's lattice; null on land or off the grid)
    const sample = (lng, lat) => {
      if (!g || !g.vectors || !g.bounds) return null;
      const { west, east, south, north } = g.bounds; const cols = g.cols; const rows = g.rows;
      let x = lng; while (x < west) x += 360; while (x > east + 1e-9 && x - 360 >= west) x -= 360;
      const fx = (x - west) / (east - west) * (cols - 1); const fy = (lat - south) / (north - south) * (rows - 1);
      if (fx < 0 || fy < 0 || fx > cols - 1 || fy > rows - 1) return null;
      const x0 = Math.floor(fx); const y0 = Math.floor(fy); const x1 = Math.min(cols - 1, x0 + 1); const y1 = Math.min(rows - 1, y0 + 1);
      const v = (xx, yy) => g.vectors[yy * cols + xx];
      const n = [v(x0, y0), v(x1, y0), v(x0, y1), v(x1, y1)];
      if (n.some((q) => !q || q.isOcean === false || !Number.isFinite(q.height))) return null;
      if (Math.abs(n[0].lat - (south + y0 * (north - south) / (rows - 1))) > 0.6) return { h: null, layout: 'unexpected' };
      const tx = fx - x0; const ty = fy - y0;
      const h = (n[0].height * (1 - tx) + n[1].height * tx) * (1 - ty) + (n[2].height * (1 - tx) + n[3].height * tx) * ty;
      return { h: +h.toFixed(3), spread: +(Math.max(...n.map((q) => q.height)) - Math.min(...n.map((q) => q.height))).toFixed(3) };
    };
    const meta = p.map(([fx, fy]) => { const ll = m.unproject([fx * W, fy * Hh]); return { lng: +ll.lng.toFixed(3), lat: +ll.lat.toFixed(3), s: sample(ll.lng, ll.lat) }; });
    F.pixelMeta = F.pixelMeta || {}; F.pixelMeta[t] = { meta, zoom: m.getZoom(), blendBoth: window.__RAW_GPU__ && window.__RAW_GPU__.blendBoth ? !!window.__RAW_GPU__.blendBoth.engaged : null, gridPid: g ? (g.__servedProductId || g.productId) : null, scale: e && e._waveData ? e._waveData.u_heightScale : null,
      bandOffAt: F.band.offAt != null ? Math.round(F.band.offAt - F.t0) : null, armedAt: Math.round(performance.now() - F.t0) };
    F.armPixels(t, p, f);
  }, [tag, pts, frames]);
}

// ---------------------------------------------------------------- one action
async function execute(page, cdp, ctx, a, view, rec, setFault, out) {
  const box = await mapBox(page);
  const cx = box.x + box.w / 2; const cy = box.y + box.h / 2;
  switch (a.type) {
    case 'step': await focusWheel(page, rec); await page.keyboard.press(a.key); break;
    case 'burst': await focusWheel(page, rec); for (let k = 0; k < a.n; k++) { await page.keyboard.press(a.key); await sleep(a.gapMs); } break;
    case 'day': await focusWheel(page, rec); for (let k = 0; k < a.n; k++) { await page.keyboard.press(a.key); await sleep(40); } break;
    case 'home': await focusWheel(page, rec); await page.keyboard.press('Home'); break;
    case 'jump': { await focusWheel(page, rec); const from = (await wheelHour(page)) || 0; for (const k of keyRun(from, a.hour)) { await page.keyboard.press(k); await sleep(40); } break; }
    case 'pan':
      if (view === 'phone') await touchDrag(cdp, cx, cy, cx + a.dx * 0.6, cy + a.dy * 0.6);
      else { await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + a.dx, cy + a.dy, { steps: 8 }); await page.mouse.up(); }
      break;
    case 'fly': await page.evaluate((x) => { const m = window.__MAP_INSTANCE__; m.stop(); if (x.mode === 'jump') m.jumpTo({ center: x.c, zoom: x.z }); else if (x.mode === 'fly') m.flyTo({ center: x.c, zoom: x.z, duration: 900 }); else m.easeTo({ center: x.c, zoom: x.z, duration: 600 }); }, a); break;
    case 'zoom':
      if (view === 'phone') await page.evaluate((t) => { const m = window.__MAP_INSTANCE__; m.easeTo({ zoom: Math.max(1.5, Math.min(11, m.getZoom() + t * 0.7)), duration: 300 }); }, a.ticks);
      else { await page.mouse.move(box.x + box.w * a.fx, box.y + box.h * a.fy); for (let k = 0; k < Math.abs(a.ticks); k++) { await page.mouse.wheel(0, a.ticks > 0 ? -240 : 240); await sleep(60); } }
      break;
    case 'layer': await clickChip(page, a.name); break;
    case 'band': {
      const on = await page.evaluate(() => window.__FZ__.readUi().band);
      await clickChip(page, on ? 'Surf Rating: ON' : 'Surf Rating: OFF');
      if (on && holdSurf.active) holdSurf.releaseAt = Date.now() + (+process.env.HOLD_DELTA || 40);
      // band OFF: a pixel window over the next frames, timed from the click (the band's pixels must be gone 100 ms after it)
      if (on && PIXEL) { await armPixels(page, `b${rec.i}`, 14); rec.bandPixelTag = `b${rec.i}`; }
      break;
    }
    case 'model': await clickChip(page, a.name); break;
    case 'theme': {
      const gen0 = await page.evaluate(() => window.__FZ__.mapGen || 0);
      const was = await page.evaluate(() => { const u = window.__FZ__.readUi(); return { model: u.model, layer: u.layer }; });
      await navigateSpa(page, '/theme');
      const btn = page.locator(`[data-testid="theme-${a.to}"]`).first();
      await btn.waitFor({ state: 'visible', timeout: 15000 }); await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((el) => el.click()));
      await sleep(300);
      await navigateSpa(page, '/map');
      await page.waitForFunction((g) => (window.__FZ__.mapGen || 0) > g, gen0, { timeout: 30000, polling: 100 });
      await sleep(1200);
      // the round trip through /theme remounts the map: what survived it is recorded, then the user restores what is missing
      const now = await page.evaluate(() => { const u = window.__FZ__.readUi(); return { model: u.model, layer: u.layer }; });
      rec.remount = { was, after: now };
      const NAME = { waves: 'Waves', swell_1: 'Swell', swell_2: 'Swell 2', wind_waves: 'Wind Waves' };
      if (was.layer && now.layer !== was.layer) await clickChip(page, NAME[was.layer]);
      if (was.model && now.model !== was.model) await clickChip(page, was.model);
      if (was.layer) await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 30000, polling: 100 }).catch(() => { rec.note = 'no marine frame 30 s after the theme remount'; });
      break;
    }
    case 'viewport': await page.setViewportSize({ width: a.w, height: a.h }); break;
    case 'dpr': { const vs = page.viewportSize(); await cdp.send('Emulation.setDeviceMetricsOverride', { width: vs.width, height: vs.height, deviceScaleFactor: a.dpr, mobile: view === 'phone' }); break; }
    case 'infobox': rec.infobox = await infobox(page, cdp, a, view); break;
    case 'infoclose': {
      const open = await page.locator('[data-testid="forecast-overlay"]').count();
      if (!open) { rec.note = 'no infobox open'; break; }
      const p = await seaScreenPoint(page, a.pt || 0);
      if (!p) { rec.note = 'no sea point on screen'; break; }
      if (view === 'phone') { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }); await sleep(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
      else await page.mouse.click(p.x, p.y);
      break;
    }
    case 'sheet': { const b = page.locator('[aria-label="Weather layers"]').filter({ visible: true }).first(); if (await b.count()) await b.click({ timeout: 2500 }).catch(() => b.evaluate((el) => el.click())); else rec.note = 'no sheet button'; break; }
    case 'fault':
      if (a.kind === 'w_hold_surf_off') { holdSurf.active = true; holdSurf.releaseAt = Infinity; rec.note = 'surf=1 /grid held until band OFF + HOLD_DELTA'; break; }
      await setFault(a.kind, a.durMs); break;
    case 'gl': {
      const ok = await page.evaluate((ms) => { const m = window.__MAP_INSTANCE__; const gl = m.painter && m.painter.context && m.painter.context.gl; const ext = gl && gl.getExtension('WEBGL_lose_context');
        if (!ext) return false; ext.loseContext(); setTimeout(() => { try { ext.restoreContext(); } catch (e) { /* already */ } }, ms); return true; }, a.restoreMs);
      if (!ok) rec.note = 'no WEBGL_lose_context';
      await sleep(a.restoreMs + 150);
      break;
    }
    case 'rollover':
      if (!process.env.ROLL_PORT || !process.env.ROLL_CDN_DIR) { rec.note = 'no ROLL_PORT / ROLL_CDN_DIR: skipped'; break; }
      target.port = +process.env.ROLL_PORT; target.cdnDir = process.env.ROLL_CDN_DIR; rec.note = `backend -> ${target.port}, CDN -> ${target.cdnDir}`;
      await page.evaluate(() => { window.__FZ__.rolledAt = performance.now(); }).catch(() => {});
      break;
    case 'wait': await sleep(a.ms); break;
    default: break;
  }
}

async function seaScreenPoint(page, startIdx) {
  return page.evaluate(([pts, s]) => {
    const m = window.__MAP_INSTANCE__ || window.map; const c = m.getCanvas(); const r = c.getBoundingClientRect();
    for (let k = 0; k < pts.length; k++) {
      const [lng, lat] = pts[(s + k) % pts.length];
      const p = m.project([lng, lat]);
      if (p.x < 40 || p.y < 80 || p.x > r.width - 40 || p.y > r.height - 80) continue;
      const x = r.left + p.x; const y = r.top + p.y; const el = document.elementFromPoint(x, y);
      if (el !== c) continue;
      return { x, y, lng, lat };
    }
    const x = r.left + r.width * 0.55; const y = r.top + r.height * 0.45; const el = document.elementFromPoint(x, y);
    if (el !== c) return null;
    const ll = m.unproject([r.width * 0.55, r.height * 0.45]); return { x, y, lng: ll.lng, lat: ll.lat, fallback: true };
  }, [SEA_POINTS, startIdx]);
}

// ---------------------------------------------------------------- the infobox check (INV6)
async function infobox(page, cdp, a, view) {
  if (view === 'phone') {   // the expanded weather sheet covers the map: the user closes it to press on the sea
    const open = page.locator('[aria-label="Weather layers"][aria-expanded="true"]').filter({ visible: true }).first();
    if (await open.count()) { await open.click({ timeout: 2500 }).catch(() => open.evaluate((el) => el.click())); await sleep(400); }
  }
  const p = await seaScreenPoint(page, a.pt);
  if (!p) return { skipped: 'no sea point on screen' };
  // The phone opens the infobox with a press-and-hold. In EMULATED touch, Chrome dispatches a click on the lift and the map's click
  // handler clears the pressed point (measured 2026-10-28: open at 500 ms, gone on lift; MapPage onMapClick). Android Chrome fires
  // `contextmenu` for a long press instead of that click, so the phone path sends the contextmenu the device would (a right-click).
  if (view === 'phone') await page.mouse.click(p.x, p.y, { button: 'right' });
  else await page.mouse.click(p.x, p.y, { button: 'right' });
  // wait for a terminal state: no 'Loading' card, the diagnostics name our point and a non-loading status
  let snap = null; const t0 = Date.now();
  do {
    await sleep(150);
    snap = await page.evaluate(() => {
      const o = document.querySelector('[data-testid="forecast-overlay"]');
      if (!o) { const u0 = window.__FZ__.readUi(); return { open: false, sel: { model: u0.model, layer: u0.layer, hour: u0.hour } }; }
      const head = o.querySelector('button'); const items = [...o.querySelectorAll('[role="listitem"]')].map((x) => x.getAttribute('aria-label') || '');
      const d = window.__MARINE_INFOBOX_DIAG__ || null; const u = window.__FZ__.readUi();
      return { open: true, header: head ? head.textContent.trim() : '', items, loading: items.some((x) => /Loading|refining/i.test(x)) || /Loading/.test(o.textContent),
        diag: d && { model: d.activeModel, layer: d.activeLayer, hour: d.timeOffsetHours, status: d.exactPointStatus, valid: d.exactPointValid, pointPid: d.pointProductId, gridPid: d.gridProductId,
          snapped: d.snappedPoint, selectedPoint: d.selectedPoint, exact: d.exactPointValues, displayed: d.displayedValues, ts: d.timestamp },
        sel: { model: u.model, layer: u.layer, hour: u.hour, band: u.band }, res: window.__FZ__.resident(), status: u.statuses };
    });
  } while ((!snap.open || snap.loading || !snap.diag || /loading/.test(snap.diag.status || '')) && Date.now() - t0 < 9000);
  const v = []; const r = { pt: p, settledMs: Date.now() - t0, header: snap.header, items: snap.items, diag: snap.diag, sel: snap.sel, res: snap.res, status: snap.status };
  if (!snap.open) { r.violations = snap.sel && snap.sel.layer ? ['inv6_infobox_not_open'] : []; r.note = snap.sel && snap.sel.layer ? null : 'no weather layer on: the infobox is not rendered (MapPage)'; return r; }
  const sel = snap.sel; const d = snap.diag;
  const modelWord = (snap.header.match(/^(GFS|EURO|ICON|ECMWF)/) || [])[1];
  if (sel.model && modelWord && modelWord !== sel.model) v.push('inv6_model_mismatch');
  if (d && sel.model && d.model !== sel.model) v.push('inv6_diag_model_mismatch');
  if (d && Number.isFinite(sel.hour) && d.hour !== sel.hour) v.push('inv6_hour_mismatch');
  // the offshore height card of the selected layer, against the point authority, the heatmap's node and the backend asked directly
  const card = sel.layer && CARD_OF[sel.layer];
  const parse = (s) => { const m = /(-?\d+(?:\.\d+)?)\s*(ft|m)\b/.exec(s || ''); return m ? { v: +m[1], unit: m[2], m: m[2] === 'ft' ? +m[1] / 3.28084 : +m[1] } : null; };
  let shown = null;
  if (card) { const it = snap.items.find((x) => card.aria.test(x)); r.card = it || null; shown = it ? parse(card.aria.exec(it)[1]) : null; r.shown = shown; }
  // the app's own /point ask for this point, re-asked of the backend directly (independent of the page's caches)
  if (d && d.selectedPoint && sel.layer) {
    const lat = d.selectedPoint.lat.toFixed(2); const lng = d.selectedPoint.lng.toFixed(2);
    const labelMs = await page.evaluate((h) => (window.__RAW_SELECTED_FRAME__ && window.__RAW_SELECTED_FRAME__.hour === h ? window.__RAW_SELECTED_FRAME__.labelMs : Math.round(Date.now() / 3600000) * 3600000 + h * 3600000), sel.hour);
    try {
      // the app's OWN last /point ask for this point (its valid_time and grid hints), re-asked of the backend directly; without one, the
      // selection's instant with no hints (a different product can then answer: informational only)
      const qp = (q) => Object.fromEntries(new URLSearchParams(q.key.split('?')[1] || ''));
      const mine = currentLog ? currentLog.requests.filter((q) => { if (q.path !== '/point') return false; const p = qp(q); return p.model === sel.model && p.layer === sel.layer && Math.abs(+p.lat - +lat) < 0.006 && Math.abs(+p.lng - +lng) < 0.006; }).pop() : null;
      r.pointAskReused = !!mine;
      const askQs = mine ? mine.key.split('?')[1] : `model=${sel.model}&domain=marine&layer=${sel.layer}&lat=${lat}&lng=${lng}&valid_time=${encodeURIComponent(new Date(labelMs).toISOString())}`;
      const j = await (await fetch(`http://127.0.0.1:${target.port}/api/weather/point?${askQs}`)).json();
      // the backend's /point carries the layer's value in point.speed (the client's conform renames it per layer)
      const pt = j.point || {};
      r.backendPoint = { pid: j.product_id || j.productId || null, model: j.model || null, vt: j.valid_time || j.validTime || null, served: j.served_valid_time || null,
        [card ? card.field : 'value']: Number.isFinite(pt.speed) ? pt.speed : null, wave_height: sel.layer === 'waves' && Number.isFinite(pt.speed) ? pt.speed : null,
        period: pt.period, direction: pt.direction, surf_height_m: j.surf_height_m != null ? j.surf_height_m : pt.surf_height_m, surf_regime: j.surf_regime || pt.surf_regime || null,
        sampled: [pt.sampled_lat, pt.sampled_lng] };
    } catch (e) { r.backendPointError = String(e).slice(0, 100); }
  }
  // display rounding: tenths below 10 ft (or in m), whole feet from 10 ft
  const tol = shown ? (shown.unit === 'ft' ? (shown.v >= 10 ? 0.5 : 0.05) / 3.28084 : 0.05) + 0.02 : 0;
  if (card && shown && d && d.exact && d.status === 'exact_success') {
    const auth = d.exact[card.field];
    r.auth = auth;
    if (Number.isFinite(auth) && Math.abs(auth - shown.m) > tol) v.push('inv6_card_vs_point_authority');
  }
  // the infobox's own point product must be the SELECTED model's (a stale grid hint from another model makes /point answer with that model)
  const pidModel = (x) => { const m = /^(gfs|euro|icon|ecmwf)_/i.exec(String(x || '').split('/').pop()); return m ? (m[1].toUpperCase() === 'ECMWF' ? 'EURO' : m[1].toUpperCase()) : null; };
  r.pointPidModel = d ? pidModel(d.pointPid) : null;
  if (d && d.pointPid && sel.model && r.pointPidModel && r.pointPidModel !== sel.model) v.push('inv6_point_from_other_model');
  if (card && shown && r.backendPoint && Number.isFinite(r.backendPoint[card.field]) && d && d.status === 'exact_success' && r.pointAskReused && !(r.pointPidModel && r.pointPidModel !== sel.model)) {
    if (Math.abs(r.backendPoint[card.field] - shown.m) > tol) v.push('inv6_card_vs_backend_point');
  }
  // the heatmap's value at the same node and time: only when the resident is the selection's frame (same model, layer, data time)
  if (card && shown && d && d.snapped && snap.res && snap.res.has && snap.res.model === sel.model && snap.res.layer === sel.layer) {
    const node = await page.evaluate(([lat, lng]) => { const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid; if (!g || !g.vectors) return null;
      let best = null; let bd = 1e9; for (const q of g.vectors) { const dd = (q.lat - lat) ** 2 + (((q.lng - lng + 540) % 360) - 180) ** 2; if (dd < bd) { bd = dd; best = q; } }
      return best ? { lat: best.lat, lng: best.lng, h: best.height, ocean: best.isOcean, d: Math.sqrt(bd) } : null; }, [d.snapped.lat, d.snapped.lng]);
    r.heatmapNode = node;
    const pidStamp = (s) => { const m = /(\d{8}T\d{6}Z)/.exec(s || ''); return m ? m[1] : null; };
    r.sameFrame = !!(pidStamp(d.pointPid) && snap.res.pid && pidStamp(d.pointPid) === pidStamp(snap.res.pid));
    if (node && node.d < 0.05 && r.sameFrame && Number.isFinite(node.h) && Math.abs(node.h - shown.m) > tol + 0.04) v.push('inv6_card_vs_heatmap_node');
    if (!r.sameFrame && pidStamp(d.pointPid) && snap.res.pid) {
      const off = Math.abs(Date.parse(pidStamp(d.pointPid).replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) - (snap.res.dataMs || 0)) / H;
      r.frameOffH = +off.toFixed(2);
      if (off > 1.01 && !/Loading|Holding|still showing|not arriving/i.test((snap.status || []).join(' '))) v.push('inv6_infobox_heatmap_different_times_silent');
    }
  }
  // breaking surf must be named as such and never be the offshore number (CLAUDE.md ONE FORECAST COMPOSITION)
  const surf = snap.items.find((x) => /surf/i.test(x));
  if (surf && !/Breaking surf height/.test(surf)) v.push('inv6_surf_not_labelled_breaking');
  if (sel.layer === 'waves' && shown && r.backendPoint && Number.isFinite(r.backendPoint.surf_height_m) && Number.isFinite(r.backendPoint.wave_height)
      && Math.abs(r.backendPoint.surf_height_m - r.backendPoint.wave_height) > 0.15 && Math.abs(shown.m - r.backendPoint.surf_height_m) < 0.03) v.push('inv6_offshore_card_shows_surf');
  r.violations = v;
  return r;
}

// ---------------------------------------------------------------- per-sequence summary
function summarizeSequence(out) {
  // injected faults, and the WebGL context loss the fuzzer causes (its "context lost" console line is expected)
  for (const a of out.actions) if (a.type === 'gl' && !out.faults.some((f) => f.kind === 'gl' && f.t === a.t)) out.faults.push({ kind: 'gl', t: a.t, durMs: (a.a.restoreMs || 0) + 500 });
  const viol = {}; const transient = {};
  const add = (k, n = 1) => { viol[k] = (viol[k] || 0) + n; };
  for (const e of out.episodes) {
    e.counts = COUNTS_FROM_ONE.has(e.kind) || (e.frames >= MIN_FRAMES && (e.durMs || 0) >= MIN_MS);
    if (e.counts) add(e.kind); else transient[e.kind] = (transient[e.kind] || 0) + 1;
  }
  out.transient = transient;
  if (out.firstPaintMs === null) add('inv1_boot_no_first_paint');
  for (const a of out.actions) {
    if (a.outcome === 'missed') {
      const ms = a.missState || {}; const busy = ms.inflight || ms.pending;
      const faulted = out.faults.some((f) => a.t + 0 >= f.t - 500 && a.t <= f.t + f.durMs + 10000);
      a.missClass = faulted ? 'under_fault' : busy ? 'still_fetching' : 'idle';
      add(`inv3_never_exact_${a.missClass}`);
    }
    if (a.type === 'band' && a.sel && a.sel.layer && a.sel.band === true && a.arm && a.arm.bandMs == null && a.settled) add('inv4_band_on_nothing_shown');
    for (const v of (a.infobox && a.infobox.violations) || []) add(v);
  }
  // INV7: console errors (harness-caused aborts and injected faults set apart), page errors, rejections, repeated asks, hosts
  // harness-caused: aborted third-party hosts, blocked sockets, the stubbed (empty) spots list, and a CDN object this offline publish
  // never writes (v1/wind_lane.json: written only with FRAME_WIND_LANE_FILE) answered 400 like the bucket's 404
  const harnessNoise = /ERR_FAILED|ERR_BLOCKED|net::ERR_|posthog|rainviewer|unpkg|fonts\.googleapis|jsdelivr|WebSocket|offline harness|empty-global-spots/i;
  const inFault = (t) => out.faults.some((f) => t >= f.t - 200 && t <= f.t + f.durMs + 4000);
  const cdnMiss = (t) => out.cdn.some((c) => c.status === 400 && !c.fault && Math.abs(c.t - t) < 600);
  out.consoleErrors = out.console.filter((c) => c.type === 'error');
  out.consoleAppErrors = out.consoleErrors.filter((c) => !harnessNoise.test(c.text) && !inFault(c.t) && !(/status of 400/.test(c.text) && cdnMiss(c.t)));
  if (out.consoleAppErrors.length) add('inv7_console_error', out.consoleAppErrors.length);
  if (out.pageErrors.length) add('inv7_page_error', out.pageErrors.length);
  if (out.rejections.length) add('inv7_unhandled_rejection', out.rejections.length);
  // the same ask more than twice inside 30 s (a periodic refresh, e.g. /wind_lane every ~2 min, is listed apart as `periodic`)
  const byKey = {};
  for (const q of out.requests) { (byKey[q.key] = byKey[q.key] || []).push(q); }
  out.repeats = []; out.periodic = [];
  for (const [k, v] of Object.entries(byKey)) {
    if (v.length <= 2) continue;
    let burst = 0; for (let x = 0; x + 2 < v.length; x++) if (v[x + 2].t - v[x].t <= 30000) burst = Math.max(burst, v.filter((q) => q.t >= v[x].t && q.t <= v[x].t + 30000).length);
    const r = { key: k.slice(0, 220), n: v.length, burst, faulted: v.some((q) => q.fault || inFault(q.t)), ts: v.map((q) => q.t), statuses: [...new Set(v.map((q) => q.status))] };
    (burst > 2 ? out.repeats : out.periodic).push(r);
  }
  const rep = out.repeats.filter((r) => !r.faulted);
  if (rep.length) add('inv7_repeated_ask', rep.length);
  if (out.repeats.length - rep.length) add('inv7_repeated_ask_under_fault', out.repeats.length - rep.length);
  out.nonLocal = Object.fromEntries(Object.entries(out.hosts).filter(([h]) => h !== '127.0.0.1'));
  // the harness's own proxy failing to reach the offline backend (a 502 the harness made, not the app): taints the sequence
  out.backendProxyErrors = out.requests.filter((q) => q.error).length;
  const bms = out.requests.filter((q) => q.ms != null && !q.fault).map((q) => q.ms);
  out.backendMs = { n: bms.length, p50: pct(bms, 0.5), p95: pct(bms, 0.95), max: bms.length ? Math.max(...bms) : null, proxyErrors: out.backendProxyErrors };
  // a sequence whose offline backend was itself slow: its timings and "never exact" rows are not claims about the client
  out.backendSlow = (out.backendMs.p95 || 0) > 8000 || out.backendProxyErrors > 2;
  out.violations = viol;
  // INV8 timing per action type (settled actions; exactMs from the last input to the first rendered exact frame)
  const t = {};
  for (const a of out.actions) if (a.settled && a.arm && a.arm.exactMs != null) (t[a.type] = t[a.type] || []).push(a.arm.exactMs);
  out.timing = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { n: v.length, p50: pct(v, 0.5), p95: pct(v, 0.95), over500: v.filter((x) => x > 500).length }]));
  out.longTaskSummary = { n: out.longtasks.length, over200: out.longtasks.filter((x) => x.d > 200).length, max: out.longtasks.reduce((m, x) => Math.max(m, x.d), 0) };
}
const pct = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
const lineOf = (o) => `seed ${o.seed} ${o.view} ${o.profile} ${o.theme0}/${o.model0}/${o.layer0} @${o.start.place}: actions ${o.actions.length} frames ${o.frames} idle ${o.idleTwoRaf} viol ${JSON.stringify(o.violations)} harness ${o.harnessErrors.length} hosts ${JSON.stringify(o.nonLocal)} ws ${o.blockedWs.length}`;

// ---------------------------------------------------------------- shrink (ddmin over the actions before the first failure)
async function reproduces(seq, kind, sig) {
  const o = await runSequence(seq, { tag: '-sh', quiet: true });
  const hit = (o.violations[kind] || 0) > 0 && (!sig || o.episodes.some((e) => e.kind === kind && sig(e)) || o.actions.some((a) => (a.infobox && (a.infobox.violations || []).includes(kind)) || `inv3_never_exact_${a.missClass}` === kind));
  return { hit, o };
}
async function shrink(seq, kind) {
  const log = []; const firstIdx = (o) => { const e = o.episodes.find((x) => x.kind === kind); if (e && e.action != null) return e.action; const a = o.actions.find((x) => (x.infobox && (x.infobox.violations || []).includes(kind)) || `inv3_never_exact_${x.missClass}` === kind); return a ? a.i : o.actions.length - 1; };
  const upTo = process.env.FAIL_AT != null ? +process.env.FAIL_AT : null;   // the failing action's index in the original run
  let base = await reproduces(upTo != null ? { ...seq, actions: seq.actions.slice(0, upTo + 1) } : seq, kind); log.push({ step: 'original', hit: base.hit });
  if (!base.hit) return { kind, reproduced: false, log };
  let acts = seq.actions.slice(0, firstIdx(base.o) + 1);
  const test = async (cand) => { const r = await reproduces({ ...seq, actions: cand }, kind); log.push({ n: cand.length, hit: r.hit, types: cand.map((x) => x.type).join(',') }); return r; };
  // SUFFIX FIRST: most failures need only the last few actions from the same starting view; then ddmin inside what is left
  for (const k of [1, 2, 3, 5, 8, 13]) {
    if (k >= acts.length) break;
    const r = await test(acts.slice(acts.length - k));
    if (r.hit) { acts = acts.slice(acts.length - k); acts = acts.slice(0, Math.min(acts.length, firstIdx(r.o) + 1)); break; }
  }
  let n = 2;
  while (acts.length >= 2) {
    const chunk = Math.ceil(acts.length / n); let reduced = false;
    for (let s = 0; s < acts.length; s += chunk) {
      const cand = acts.slice(0, s).concat(acts.slice(s + chunk));
      if (!cand.length) continue;
      const r = await test(cand);
      if (r.hit) { acts = cand.slice(0, firstIdx(r.o) + 1); n = Math.max(n - 1, 2); reduced = true; break; }
    }
    if (!reduced) { if (n >= acts.length) break; n = Math.min(acts.length, n * 2); }
  }
  const confirm = []; for (let k = 0; k < +(process.env.CONFIRM || 3); k++) confirm.push((await reproduces({ ...seq, actions: acts }, kind)).hit);
  return { kind, reproduced: true, minimal: acts, confirm, rate: `${confirm.filter(Boolean).length}/${confirm.length}`, log };
}

// ---------------------------------------------------------------- main
function parseSeeds(s) { return s.split(',').flatMap((x) => { const m = /^(\d+)-(\d+)$/.exec(x); return m ? Array.from({ length: +m[2] - +m[1] + 1 }, (_, i) => +m[1] + i) : [+x]; }); }
(async () => {
  const id = await (await fetch(`http://127.0.0.1:${PORT}/__harness/identity`)).json();
  const norm = (p) => path.resolve(p).replace(/\\+/g, '/').toLowerCase();
  if (process.env.EXPECT_STORE && norm(id.store) !== norm(process.env.EXPECT_STORE)) throw Error(`port ${PORT} serves ${id.store}, not EXPECT_STORE ${process.env.EXPECT_STORE}`);
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  try {
    if (process.env.REPLAY) {
      const j = JSON.parse(fs.readFileSync(process.env.REPLAY, 'utf8'));
      const seq = j.actions ? j : j.sequence || j;
      if (process.env.SHRINK === '1') {
        const res = await shrink(seq, process.env.KIND);
        const f = path.join(OUT_DIR, `shrink-s${seq.seed}-${process.env.KIND}.json`);
        fs.writeFileSync(f, JSON.stringify({ identity: id, seq: { ...seq, actions: undefined }, ...res }, null, 1));
        console.log(`SHRINK ${process.env.KIND} seed ${seq.seed}: reproduced ${res.reproduced} minimal ${res.minimal ? res.minimal.length : '-'} rate ${res.rate || '-'} -> ${f}`);
      } else {
        const o = await runSequence(seq, { tag: process.env.TAG || '-replay' });
        fs.writeFileSync(path.join(OUT_DIR, `replay-s${seq.seed}${process.env.TAG || ''}.json`), JSON.stringify(o, null, 1));
      }
      return;
    }
    const seeds = parseSeeds(process.env.SEEDS || '1-40');
    const healthy = async () => { for (let k = 0; k < 4; k++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/__harness/identity`, { signal: AbortSignal.timeout(15000) }); if (r.ok) return true; } catch (e) { /* retry */ } await sleep(20000); } return false; };
    for (const s of seeds) {
      if (!(await healthy())) { console.log(`seed ${s} SKIPPED: the offline backend on ${PORT} does not answer`); fs.writeFileSync(path.join(OUT_DIR, `run-s${s}.json`), JSON.stringify({ seed: s, error: 'backend_down' })); continue; }
      const view = VIEWS[s % VIEWS.length];
      const seq = generate(s, N_ACTIONS, view, process.env.PROFILE || null);
      fs.mkdirSync(path.join(OUT_DIR, 'seq'), { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, 'seq', `s${s}.json`), JSON.stringify(seq, null, 1));
      let o;
      try { o = await runSequence(seq); } catch (e) { o = { seed: s, error: String(e && e.stack || e).slice(0, 500) }; console.log(`seed ${s} ERROR ${o.error}`); }
      o.identity = id;
      fs.writeFileSync(path.join(OUT_DIR, `run-s${s}.json`), JSON.stringify(o));
    }
  } finally { cdn.close(); }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });

module.exports = { generate, keyRun };
