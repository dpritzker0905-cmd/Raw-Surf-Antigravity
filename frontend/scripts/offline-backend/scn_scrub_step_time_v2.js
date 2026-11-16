// SCRUB STEP TIME v2 (2026-11-16; pre-registration 3, docs/weather-program/log/2026-11-15-claude-marine-late-wash.md section 6).
// Offline only. One browser session per (device, cadence); the arm is switched INSIDE the session with the runtime lever
// window[KILL] (seedConsumeAllowed reads it every frame), in ABBA groups; each block = Home, settle, then STEPS ArrowRight keys.
// MODE=AA: both arms are the kill (the instrument's own spread). MODE=AB: A = fix (lever off), B = kill (lever on).
// Per key, in the page:
//   target   the instant the app asks for after the key (window.__RAW_SELECTED_FRAME__.instantMs, read on the first render whose
//            selected hour moved); a step is FRAME-CHANGING when its target differs from the previous key's
//   stepMs   keydown -> the first rendered frame whose resident grid's valid_time equals the target. Every step stays pending until
//            then (v1 replaced the pending step on each key, so a slow change could be credited to the next key with a short time);
//            a step overtaken by a later key's frame is `superseded` (reported, never dropped silently)
//   longMs   long tasks overlapping [keydown, keydown + cadence)
//   AB_BASE=http://127.0.0.1:3108 PORT=4151 CDN_DIR=<cdn> MODE=AA OUT=<json> node scn_scrub_step_time_v2.js
// 6a: every step gets the same WINDOW_MS (3000); not drawn by then = censored AT the window (counted, used as WINDOW_MS); the end frame
// and its source are recorded per step; no-change keys are counted apart.
// Env: DEVICES (desktop,phone), CADENCES (200,400,800), GROUPS (8), STEPS (47), SETTLE_MS (6000), WINDOW_MS (3000), KILL (__RAW_DISABLE_URGENT_WASH_SEED__).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_scrub_step_time_v2 is offline only');
const PORT = +(process.env.PORT || 4151);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4375);
const MODE = process.env.MODE || 'AA';
const DEVICES = (process.env.DEVICES || 'desktop,phone').split(',');
const CADENCES = (process.env.CADENCES || '200,400,800').split(',').map(Number);
const GROUPS = +(process.env.GROUPS || 8);
const STEPS = +(process.env.STEPS || 47);
const SETTLE_MS = +(process.env.SETTLE_MS || 6000);
const KILL = process.env.KILL || '__RAW_DISABLE_URGENT_WASH_SEED__';
const WINDOW_MS = +(process.env.WINDOW_MS || 3000);   // 6a: one fixed window per step; not drawn by then = CENSORED at it
const VIEW = [-80.3, 29.0, 7.5];
if (!CDN_DIR) throw Error('CDN_DIR is required');
if (!['AA', 'AB'].includes(MODE)) throw Error('MODE must be AA or AB');
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

function installProbe(WINDOW_MS) {
  const W = window; const P = W.__SST2__ = { steps: [], long: [], pending: [] };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { P.noLongTask = true; }
  const grid = () => { const e = W.__MARINE_ENGINE__; return e && e._waveData && e._waveData.waveGrid; };
  const resident = () => { const g = grid(); const v = g && (g.valid_time || g.validTime); return v ? Date.parse(v) : NaN; };
  // 6a (2): where the drawn frame came from, from the resident grid's own tags
  const source = () => { const g = grid(); if (!g) return null; return g.__fromSeries ? 'series' : `${g.provider || '?'}${g.coverage_scope ? ':' + g.coverage_scope : ''}${g.region_id ? ':' + g.region_id : ''}`; };
  const end = (s, now, res, how) => { s.stepMs = now - s.t; s.endMs = res; s.source = source(); if (how) s[how] = true; };
  const sel = () => W.__RAW_SELECTED_FRAME__ || null;
  (W.__MAP_INSTANCE__ || W.map).on('render', () => {
    const now = performance.now(); const s0 = sel(); const res = resident();
    for (const s of P.pending) {
      if (s.inputMs === null) s.inputMs = now - s.t;
      if (s.target === null && s0 && s0.hour !== s.hourBefore && Number.isFinite(s0.instantMs)) s.target = s0.instantMs;
    }
    P.pending = P.pending.filter((s) => {
      if (now - s.t > WINDOW_MS) { s.censored = true; s.stepMs = WINDOW_MS; s.endMs = Number.isFinite(res) ? res : null; s.source = source(); return false; }
      if (s.target === null || !Number.isFinite(res)) return true;
      if (res === s.target) { end(s, now, res, null); return false; }
      if (res > s.target) { end(s, now, res, 'superseded'); return false; }   // a later key's frame
      return true;
    });
  });
  P.key = (block, k) => {
    const el = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/i.test(x.getAttribute('aria-label') || '') && x.offsetParent !== null);
    if (!el) return false;
    el.focus();
    const s0 = sel();
    const s = { block, k, t: performance.now(), hourBefore: s0 ? s0.hour : null, target: null, inputMs: null, stepMs: null, superseded: false, censored: false, endMs: null, source: null };
    P.steps.push(s); P.pending.push(s);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    return true;
  };
  P.home = () => {
    for (const s of P.pending) { s.censored = true; s.stepMs = WINDOW_MS; s.cutByHome = true; }   // never dropped (the tail is >= W, so this should not happen)
    P.pending = [];
    const el = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/i.test(x.getAttribute('aria-label') || '') && x.offsetParent !== null);
    if (el) { el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); }
  };
  const kick = () => { try { (W.__MAP_INSTANCE__ || W.map).triggerRepaint(); } catch (e) { /* probe only */ } requestAnimationFrame(kick); };
  requestAnimationFrame(kick);
}

async function session(device, cadence) {
  const phone = device === 'phone';
  const opts = phone ? { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } } : { width: 1280, height: 800, dpr: 1 };
  const { browser, page, log } = await L.launch({ port: PORT, ...opts });
  try {
    await page.addInitScript(({ base }) => {
      localStorage.setItem('raw-surf-theme', 'dark'); window.__RAW_STATIC_FRAMES_BASE__ = base; window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true;
    }, { base: `http://127.0.0.1:${CDN_PORT}/` });
    await L.openMap(page);
    // 6e: the GL renderer, so a software-GL (hosted runner) result is labelled from its own output
    const gl = await page.evaluate(() => { try { const c = document.createElement('canvas').getContext('webgl'); const x = c && c.getExtension('WEBGL_debug_renderer_info');
      return c ? String(c.getParameter(x ? x.UNMASKED_RENDERER_WEBGL : c.RENDERER)) : 'no webgl'; } catch (e) { return 'error'; } });
    const browserVersion = page.context().browser().version();
    if (phone) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
    await L.jump(page, VIEW[0], VIEW[1], VIEW[2]);
    await sleep(1500);
    if (phone) { await page.locator('[aria-label="Weather layers"]').first().evaluate((el) => el.click()).catch(() => {}); await sleep(800); }
    await page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first().evaluate((el) => el.click());
    if (phone) { await sleep(500); await page.locator('[aria-label="Weather layers"]').first().evaluate((el) => el.click()).catch(() => {}); }
    await sleep(phone ? 15000 : 10000);
    await page.evaluate(installProbe, WINDOW_MS);
    const blocks = [];
    for (let g = 0; g < GROUPS; g++) for (const pos of ['A', 'B', 'B', 'A']) {
      const kill = MODE === 'AA' ? true : pos === 'B';
      const block = blocks.length;
      blocks.push({ block, group: g, pos, arm: MODE === 'AA' ? `kill_${pos}` : (pos === 'A' ? 'fix' : 'kill') });
      await page.evaluate(({ name, on }) => { window[name] = on; }, { name: KILL, on: kill });
      await page.evaluate(() => window.__SST2__.home());
      await sleep(SETTLE_MS);
      for (let k = 0; k < STEPS; k++) { await page.evaluate(({ b, k }) => window.__SST2__.key(b, k), { b: block, k }); await sleep(cadence); }
      await sleep(WINDOW_MS + 300);   // 6a: the last key gets the same window as every other
    }
    const p = await page.evaluate(() => window.__SST2__);
    const rows = p.steps.map((s, i) => {
      const prev = i > 0 && p.steps[i - 1].block === s.block ? p.steps[i - 1].target : null;
      const lo = s.t; const hi = s.t + cadence;
      const longMs = p.long.reduce((acc, [st, d]) => acc + Math.max(0, Math.min(hi, st + d) - Math.max(lo, st)), 0);
      return { ...blocks[s.block], k: s.k, target: s.target, changing: s.k > 0 && s.target !== null && s.target !== prev /* k 0 (after Home) has no previous key */,
        stepMs: s.stepMs, inputMs: s.inputMs, superseded: s.superseded, censored: s.censored, cutByHome: !!s.cutByHome, endMs: s.endMs, source: s.source, longMs };
    });
    return { device, cadence, mode: MODE, gl, browserVersion, rows, noLongTask: !!p.noLongTask, asks: log.requests.length, errors: log.errors.slice(0, 2) };
  } finally { await browser.close(); }
}

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const res = [];
  for (const device of DEVICES) for (const cadence of CADENCES) {
    const t0 = Date.now();
    try { res.push(await session(device, cadence)); } catch (e) { res.push({ device, cadence, mode: MODE, error: String(e && e.stack || e).slice(0, 400) }); }
    const r = res[res.length - 1];
    const ch = (r.rows || []).filter((x) => x.changing);
    console.log(`${MODE} ${device} ${cadence}ms | gl ${r.gl || '?'} | chrome ${r.browserVersion || '?'} | ${Math.round((Date.now() - t0) / 1000)} s | keys ${(r.rows || []).length} | no-change keys ${(r.rows || []).length - ch.length} | frame-changing ${ch.length} | censored ${ch.filter((x) => x.censored).length} | superseded ${ch.filter((x) => x.superseded).length}${r.error ? ' | ERROR ' + r.error.slice(0, 120) : ''}`);
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(res));
  }
  cdn.close();
})();
