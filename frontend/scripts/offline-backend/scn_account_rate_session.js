// ONE deliberately heavy signed-in session, measured against #815's per-account limits (2026-11-12, owner 11:47 EST:
// "also do the heavy-session measurement before the flip, we can increase the limit a little bit if needed").
//
// OFFLINE ONLY: the built app (serve_spa.js) against serve_synthetic.py (the real backend app over a synthetic store) and a
// local static host standing in for the frames CDN. ab_lib routes every /api/weather/* GET to the local backend and stubs
// every other backend call; nothing reaches the live box.
//
// What is counted, per account (both tabs are the same USER):
//   reads       every request on the limiter's "reads" lane: /grid_series, /grid, /point, /spot-ratings, /point-rating,
//               /spot-series/*, /point-tide, /wind_lane (weather_tier_clamp ROUTES + ACCOUNT_ONLY)
//   frame-urls  with FRAME_ENTITLEMENT on, the signer (staticFrameSigner.js) asks /frame-urls ONCE per index load
//               (staticFrames.loadIndex). Each run-index JSON fetched from the CDN is therefore one /frame-urls call: an
//               exact proxy, measured with the frames public so the loader behaves as it does once signed.
// Phases (one continuous session; t in ms):
//   1 cold      /map cold load, settle
//   2 scrub     focus the timeline, ArrowRight x HOURS at 30 ms then back, 3 times (all 14 days)
//   3 scrub_grid  reload with the static frames killed (every hour falls back to /grid: the worst case), scrub as 2
//   4 layers    every model x every layer chip
//   5 pan       2 min of drags and wheel zooms over Florida (the regional tile + dynamic lane)
//   6 taps      5 right-click point taps on the sea (the infobox reads)
//   7 tabs      a second tab of the same account, both scrubbing at once
//   8 reload    a reload mid-session, then a scrub
// Output: OUT json with the raw trace and, per lane, totals, the peak count in any 10 s / 60 s window and a token-bucket
// replay at the shipped numbers (weather_account_rate_limit.LANES): minimum tokens left and refusals.
// Usage: AB_BASE=http://127.0.0.1:3170 PORT=4170 CDN_DIR=<publisher out-dir> CDN_PORT=4190 OUT=<file> node scn_account_rate_session.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('offline only');
const PORT = +(process.env.PORT || 4170);
const CDN_DIR = path.resolve(process.env.CDN_DIR || '');
const CDN_PORT = +(process.env.CDN_PORT || 4190);
const OUT = process.env.OUT || 'account_rate_session.json';
const HOURS = +(process.env.HOURS || 336);
const PAN_MS = +(process.env.PAN_MS || 120000);
const LANES = { reads: { cap: +(process.env.READS_CAP || 600), rate: +(process.env.READS_RATE || 2) },
  'frame-urls': { cap: +(process.env.FU_CAP || 60), rate: +(process.env.FU_RATE || 0.1) } };
const READ_PATHS = ['/grid_series', '/grid', '/point', '/spot-ratings', '/point-rating', '/point-tide', '/wind_lane'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';

const events = [];          // { at (epoch ms), lane, path, tab, phase }
let phase = 'boot';
const marks = [];
const mark = (p) => { phase = p; marks.push({ phase: p, at: Date.now() }); console.log(`[phase] ${p}`); };

const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  if (!file.startsWith(CDN_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' });
    return res.end('{"statusCode":"404","error":"not_found"}');
  }
  if (/\/index\/[^/]+\.json$/.test(rel)) events.push({ at: Date.now(), lane: 'frame-urls', path: rel, tab: req.headers['x-tab'] || '?', phase });
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length,
    'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json',
    'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  res.end(body);
});

async function tab(name) {
  const t = await L.launch({ port: PORT, hooks: { afterWeather: async (url) => {
    const p = url.pathname.replace('/api/weather', '');
    if (READ_PATHS.includes(p) || p.startsWith('/spot-series/')) events.push({ at: Date.now(), lane: 'reads', path: p, tab: name, phase });
  } } });
  await t.page.addInitScript(({ base }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__');
    window.__RAW_STATIC_FRAMES_BASE__ = base;
    if (sessionStorage.getItem('rl_kill_static') === '1') window.__RAW_DISABLE_STATIC_FRAMES__ = true;
  }, { base: `http://127.0.0.1:${CDN_PORT}/` });
  return t;
}

async function openSheetIfNeeded(page) {
  const sheet = page.locator('[aria-label="Weather layers"][aria-expanded="false"], [aria-label="Expand weather controls"]').filter({ visible: true }).first();
  if (await sheet.count()) { await sheet.click({ timeout: 3000 }).catch(() => sheet.evaluate((el) => el.click())); await sleep(350); }
}
async function chip(page, text) {
  let loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  if (!(await loc.count())) { await openSheetIfNeeded(page); loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first(); }
  if (!(await loc.count())) return false;
  await loc.click({ timeout: 2500 }).catch(() => loc.evaluate((el) => el.click()));
  return true;
}
async function scrub(page, times = 3) {
  let w = page.locator(WHEEL).filter({ visible: true }).first();
  if (!(await w.count())) { await chip(page, 'Waves'); await sleep(600); w = page.locator(WHEEL).filter({ visible: true }).first(); }
  await w.focus().catch(() => {});
  await page.keyboard.press('Home');
  for (let r = 0; r < times; r++) {
    for (let k = 0; k < HOURS; k++) { await page.keyboard.press('ArrowRight'); await sleep(30); }
    for (let k = 0; k < HOURS; k++) { await page.keyboard.press('ArrowLeft'); await sleep(30); }
  }
}

function windowPeak(ts, ms) {
  let best = 0; let j = 0;
  for (let i = 0; i < ts.length; i++) { while (ts[i] - ts[j] >= ms) j += 1; best = Math.max(best, i - j + 1); }
  return best;
}
function bucket(ts, cap, rate) {
  let tokens = cap; let last = ts.length ? ts[0] : 0; let min = cap; let refused = 0;
  for (const t of ts) {
    tokens = Math.min(cap, tokens + ((t - last) / 1000) * rate); last = t;
    if (tokens >= 1) tokens -= 1; else refused += 1;
    min = Math.min(min, tokens);
  }
  return { minTokens: +min.toFixed(1), minPct: +((100 * min) / cap).toFixed(1), refused };
}
function summarise(evs) {
  const out = {};
  for (const lane of Object.keys(LANES)) {
    const ts = evs.filter((e) => e.lane === lane).map((e) => e.at).sort((a, b) => a - b);
    const byPhase = {};
    for (const e of evs) if (e.lane === lane) byPhase[e.phase] = (byPhase[e.phase] || 0) + 1;
    out[lane] = { total: ts.length, peak10s: windowPeak(ts, 10000), peak60s: windowPeak(ts, 60000),
      bucket: bucket(ts, LANES[lane].cap, LANES[lane].rate), byPhase };
  }
  return out;
}

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const t0 = Date.now();
  const A = await tab('A');
  try {
    mark('1_cold');
    await L.openMap(A.page, 120000); await sleep(15000);
    mark('2_scrub');
    await scrub(A.page, 3); await sleep(3000);
    mark('3_scrub_grid');
    await A.page.evaluate(() => sessionStorage.setItem('rl_kill_static', '1'));
    await A.page.reload({ waitUntil: 'domcontentloaded' });
    await A.page.waitForFunction(() => !!(window.__MAP_INSTANCE__ || window.map), null, { timeout: 120000 }); await sleep(5000);
    await scrub(A.page, 3); await sleep(3000);
    await A.page.evaluate(() => sessionStorage.removeItem('rl_kill_static'));
    mark('8a_reload');
    await A.page.reload({ waitUntil: 'domcontentloaded' });
    await A.page.waitForFunction(() => !!(window.__MAP_INSTANCE__ || window.map), null, { timeout: 120000 }); await sleep(5000);
    mark('4_layers');
    const missing = [];
    for (const model of ['GFS', 'EURO', 'ICON']) {
      if (!(await chip(A.page, model))) missing.push(model);
      await sleep(1500);
      for (const layer of ['Waves', 'Swell', 'Swell 2', 'Wind Waves', 'Wind']) {
        if (!(await chip(A.page, layer))) missing.push(`${model}/${layer}`);
        await sleep(2500);
      }
    }
    await chip(A.page, 'GFS'); await chip(A.page, 'Waves'); await sleep(2000);
    mark('5_pan');
    await L.jump(A.page, -80.0, 28.0, 6); await sleep(3000);
    const vp = A.page.viewportSize();
    const end = Date.now() + PAN_MS;
    let i = 0;
    while (Date.now() < end) {
      const cx = vp.width / 2; const cy = vp.height / 2;
      if (i % 3 === 2) {
        await A.page.mouse.move(cx, cy);
        const zin = (i % 6) < 3;
        for (let k = 0; k < 3; k++) { await A.page.mouse.wheel(0, zin ? -240 : 240); await sleep(60); }
      } else {
        const dx = ((i * 97) % 400) - 200; const dy = ((i * 53) % 260) - 130;
        await A.page.mouse.move(cx, cy); await A.page.mouse.down();
        await A.page.mouse.move(cx + dx, cy + dy, { steps: 8 }); await A.page.mouse.up();
      }
      i += 1; await sleep(400);
    }
    mark('6_taps');
    await L.jump(A.page, -60, 25, 3); await sleep(3000);
    for (const [lng, lat] of [[-60, 30], [-40, 35], [-30, -20], [-50, 10], [-20, 40]]) {
      const p = await A.page.evaluate(({ lng, lat }) => { const m = window.__MAP_INSTANCE__ || window.map; const q = m.project([lng, lat]); return { x: q.x, y: q.y }; }, { lng, lat });
      await A.page.mouse.click(p.x, p.y, { button: 'right' }); await sleep(3000);
      await A.page.keyboard.press('Escape'); await sleep(500);
    }
    mark('7_tabs');
    const B = await tab('B');
    try {
      await L.openMap(B.page, 120000); await sleep(5000);
      await Promise.all([scrub(A.page, 1), scrub(B.page, 1)]); await sleep(3000);
    } finally { await B.browser.close(); }
    mark('8b_reload');
    await A.page.reload({ waitUntil: 'domcontentloaded' });
    await A.page.waitForFunction(() => !!(window.__MAP_INSTANCE__ || window.map), null, { timeout: 120000 }); await sleep(5000);
    await scrub(A.page, 1); await sleep(3000);
    mark('end');
    const report = { at: new Date(t0).toISOString(), offline: true, hours: HOURS, panMs: PAN_MS, lanes: LANES, missingChips: missing,
      marks: marks.map((m) => ({ phase: m.phase, t: m.at - t0 })), summary: summarise(events),
      hostsLeftMachine: A.log.leftMachine, errors: A.log.errors.slice(0, 10),
      trace: events.map((e) => ({ t: e.at - t0, lane: e.lane, path: e.path, tab: e.tab, phase: e.phase })) };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ summary: report.summary, missingChips: missing, leftMachine: A.log.leftMachine }, null, 1));
  } finally {
    await A.browser.close(); cdn.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
