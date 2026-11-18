// SCRUB STEP TIME, fix vs kill (2026-11-15; pre-registered in docs/weather-program/log/2026-11-15-claude-marine-late-wash.md
// section 4, the advisor's condition for #937 to ship ON). Offline only (serve_synthetic + the publisher's frames as the CDN).
//
// Per (device, cadence, arm, rep): a fresh browser at a coastal regional view (Florida z7.5, waves, dark), settle, then 40 ArrowRight
// keys on the timeline wheel, one every CADENCE ms. Phone = 390 x 844, touch, CPU throttled 4x (CDP Emulation.setCPUThrottlingRate).
// Per step, read in the page:
//   stepMs   keydown -> the first rendered frame whose resident valid time differs from the one before the key (steps that do not
//            change the frame, the 3-hourly data's in-between hours, are counted apart: `sameFrame`)
//   inputMs  keydown -> the first rendered frame (any)
//   longMs   long tasks (PerformanceObserver 'longtask') overlapping [keydown, keydown + CADENCE)
// Pass line (section 4): per (device, cadence), fix minus kill <= 5 ms at p50 and <= 15 ms at p95 of stepMs, and <= 15 ms at p95 of
// longMs per step.
//   AB_BASE=http://127.0.0.1:3108 PORT=4151 CDN_DIR=<cdn> OUT=<json> node scn_scrub_step_time.js
// Env: DEVICES (desktop,phone), CADENCES (200,400,800), REPS (2), STEPS (40), KILL (__RAW_DISABLE_URGENT_WASH_SEED__), CDN_PORT (4374).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_scrub_step_time is offline only');
const PORT = +(process.env.PORT || 4151);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4374);
const DEVICES = (process.env.DEVICES || 'desktop,phone').split(',');
const CADENCES = (process.env.CADENCES || '200,400,800').split(',').map(Number);
const REPS = +(process.env.REPS || 2);
const STEPS = +(process.env.STEPS || 40);
const KILL = process.env.KILL || '__RAW_DISABLE_URGENT_WASH_SEED__';
const VIEW = [-80.3, 29.0, 7.5];
if (!CDN_DIR) throw Error('CDN_DIR is required');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' }); return res.end('{"statusCode":"404"}');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length, 'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json',
    'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  res.end(body);
});

function installProbe() {
  const W = window; const P = W.__SST__ = { steps: [], long: [], cur: null };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { P.noLongTask = true; }
  const valid = () => { const e = W.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid; return g ? String(g.served_valid_time || g.valid_time || g.validTime || '') : ''; };
  (W.__MAP_INSTANCE__ || W.map).on('render', () => {
    const s = P.cur; if (!s) return;
    const now = performance.now();
    if (s.inputMs === null) s.inputMs = now - s.t;
    if (s.stepMs === null && valid() !== s.before) s.stepMs = now - s.t;
  });
  P.key = () => {
    const el = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/i.test(x.getAttribute('aria-label') || '') && x.offsetParent !== null);
    if (!el) return false;
    el.focus();
    P.cur = { t: performance.now(), before: valid(), inputMs: null, stepMs: null };
    P.steps.push(P.cur);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    return true;
  };
  const kick = () => { try { (W.__MAP_INSTANCE__ || W.map).triggerRepaint(); } catch (e) { /* probe only */ } requestAnimationFrame(kick); };
  requestAnimationFrame(kick);
}

async function session(device, cadence, arm) {
  const phone = device === 'phone';
  const opts = phone ? { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } } : { width: 1280, height: 800, dpr: 1 };
  const { browser, page, log } = await L.launch({ port: PORT, ...opts });
  try {
    await page.addInitScript(({ base, kill, arm }) => {
      localStorage.setItem('raw-surf-theme', 'dark'); window.__RAW_STATIC_FRAMES_BASE__ = base; window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true;
      if (arm === 'kill') window[kill] = true;
    }, { base: `http://127.0.0.1:${CDN_PORT}/`, kill: KILL, arm });
    await L.openMap(page);
    if (phone) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
    await L.jump(page, VIEW[0], VIEW[1], VIEW[2]);
    await sleep(1500);
    if (phone) { await page.locator('[aria-label="Weather layers"]').first().evaluate((el) => el.click()).catch(() => {}); await sleep(800); }
    await page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first().evaluate((el) => el.click());
    if (phone) { await sleep(500); await page.locator('[aria-label="Weather layers"]').first().evaluate((el) => el.click()).catch(() => {}); }
    await sleep(phone ? 15000 : 10000);
    await page.evaluate(installProbe);
    await page.evaluate(() => { const el = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/i.test(x.getAttribute('aria-label') || '') && x.offsetParent !== null); if (el) { el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); } });
    await sleep(6000);
    for (let i = 0; i < STEPS; i++) { await page.evaluate(() => window.__SST__.key()); await sleep(cadence); }
    await sleep(1500);
    const p = await page.evaluate(() => window.__SST__);
    const rows = p.steps.map((s) => {
      const lo = s.t; const hi = s.t + cadence;
      const longMs = p.long.reduce((acc, [st, d]) => acc + Math.max(0, Math.min(hi, st + d) - Math.max(lo, st)), 0);
      return { inputMs: s.inputMs, stepMs: s.stepMs, longMs };
    });
    return { device, cadence, arm, rows, noLongTask: !!p.noLongTask, asks: log.requests.length, errors: log.errors.slice(0, 2) };
  } finally { await browser.close(); }
}

const pct = (xs, q) => { const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return v.length ? +v[Math.min(v.length - 1, Math.floor(q * v.length))].toFixed(1) : null; };

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const res = [];
  for (const device of DEVICES) for (const cadence of CADENCES) for (let rep = 0; rep < REPS; rep++) {
    for (const arm of (rep % 2 ? ['kill', 'fix'] : ['fix', 'kill'])) {   // interleaved order
      try { res.push(await session(device, cadence, arm)); } catch (e) { res.push({ device, cadence, arm, error: String(e && e.stack || e).slice(0, 400) }); }
    }
  }
  cdn.close();
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(res, null, 1));
  for (const device of DEVICES) for (const cadence of CADENCES) {
    const by = (arm) => res.filter((r) => r.device === device && r.cadence === cadence && r.arm === arm && r.rows).flatMap((r) => r.rows);
    const f = by('fix'); const k = by('kill');
    const s = (rows, key, q) => pct(rows.map((x) => x[key]), q);
    const d50 = s(f, 'stepMs', 0.5) - s(k, 'stepMs', 0.5); const d95 = s(f, 'stepMs', 0.95) - s(k, 'stepMs', 0.95); const l95 = s(f, 'longMs', 0.95) - s(k, 'longMs', 0.95);
    const pass = d50 <= 5 && d95 <= 15 && l95 <= 15;
    console.log(`${device} ${cadence}ms | step p50 fix ${s(f, 'stepMs', 0.5)} kill ${s(k, 'stepMs', 0.5)} (d ${d50.toFixed(1)}) | p95 fix ${s(f, 'stepMs', 0.95)} kill ${s(k, 'stepMs', 0.95)} (d ${d95.toFixed(1)}) | long p95 fix ${s(f, 'longMs', 0.95)} kill ${s(k, 'longMs', 0.95)} (d ${l95.toFixed(1)}) | input p50 fix ${s(f, 'inputMs', 0.5)} kill ${s(k, 'inputMs', 0.5)} | n ${f.filter((x) => x.stepMs !== null).length}/${k.filter((x) => x.stepMs !== null).length} | ${pass ? 'PASS' : 'FAIL'}`);
  }
})();
