// ALL-LAND IDLE (2026-11-18; gate L2 of docs/weather-program/log/2026-11-19-opus-all-land-backoff.md). Offline only.
// 2026-11-18: the backoff this scenario gated was dropped (director, option a); the kill arm is inert. Kept to reproduce the empty-engine case.
// Opens /map at an inland view (Kansas, z8: no ocean in view), turns Waves on, then sits idle for IDLE_MS and counts the render
// backstop's re-drives (window.__MARINE_BLANK_BACKSTOP_COUNT__), the all-land planner's tally (window.__RAW_ALL_LAND_REDRIVE__) and every
// /api/weather/grid and /grid_series request. Arms alternate ON (fix) / KILL (__RAW_DISABLE_ALL_LAND_BACKOFF__); a fixed in-page
// calibration per session is recorded for the load-void rule.
//   AB_BASE=http://127.0.0.1:<spa> PORT=<backend> OUT=all-land.json node scn_all_land_idle.js
// Env: IDLE_MS (300000), SESSIONS (2 per arm), CENTER (-98,38), ZOOM (8).
if (process.env.AB_LIVE === '1') throw Error('scn_all_land_idle is offline only');
const fs = require('fs');
const L = require('./ab_lib.js');

const IDLE_MS = +(process.env.IDLE_MS || 300000);
const SESSIONS = +(process.env.SESSIONS || 2);
const ZOOM = +(process.env.ZOOM || 8);
const [CLNG, CLAT] = (process.env.CENTER || '-98,38').split(',').map(Number);
const OUT = process.env.OUT || 'all-land.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// CDN_DIR (2026-11-18 amendment): serve the lab's published frames (regional bundles included) as the CDN, as scn_zoom_scrub does;
// the all-zero state of the reproduction only appears on the regional bundle path.
const http = require('http'); const path = require('path');
const CDN_DIR = process.env.CDN_DIR; const CDN_PORT = +(process.env.CDN_PORT || 4192);
const cdn = CDN_DIR ? http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' }); return res.end('{"statusCode":"404","error":"not_found"}');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length, 'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json' });
  res.end(body);
}) : null;

async function session(arm) {
  const PHONE = process.env.VIEW === 'phone';
  const { browser, page } = await L.launch({ port: +(process.env.PORT || 4298), ...(PHONE ? { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } } : { width: 1280, height: 800, dpr: 1 }) });
  if (PHONE) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
  const res = { arm, at: new Date().toISOString() };
  const reqs = { grid: 0, series: 0 };
  try {
    if (arm === 'kill') await page.addInitScript(() => { window.__RAW_DISABLE_ALL_LAND_BACKOFF__ = true; });
    if (CDN_DIR) await page.addInitScript((base) => { localStorage.removeItem('__RAW_STATIC_FRAMES__'); window.__RAW_STATIC_FRAMES_BASE__ = base; }, `http://127.0.0.1:${CDN_PORT}/`);
    // REAL re-drives (2026-11-18 amendment): __MARINE_BLANK_BACKSTOP_COUNT__ counts backstop TICKS (it rises before the clamp cap returns
    // early), so count the console lines the backstop writes when it actually re-drives the settle check.
    const con = { emptyRedrive: 0, clampRedrive: 0, clampProbe: 0, idle: false };
    page.on('console', (m) => { if (!con.idle) return; const t = m.text();
      if (/Render backstop: engine empty \+ idle/.test(t)) con.emptyRedrive += 1;
      else if (/Render backstop: .* grid at zoomed-in viewport/.test(t)) con.clampRedrive += 1;
      else if (/Clamp backstop: capped .* slow probe/.test(t)) con.clampProbe += 1; });
    page.on('request', (r) => { const u = r.url(); if (/\/api\/weather\/grid_series/.test(u)) reqs.series += 1; else if (/\/api\/weather\/grid(\?|$)/.test(u)) reqs.grid += 1; });
    await page.goto(L.BASE + '/map', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.__MAP_INSTANCE__ || window.map), null, { timeout: 120000 });
    await sleep(1500);
    await L.jump(page, CLNG, CLAT, ZOOM);
    await page.evaluate(() => window.toggleLayer('waves'));
    await sleep(15000);   // the first load
    const r0 = { ...reqs }; const b0 = await page.evaluate(() => window.__MARINE_BLANK_BACKSTOP_COUNT__ || 0);
    con.idle = true;
    await sleep(IDLE_MS);
    const st = await page.evaluate(() => ({ backstops: window.__MARINE_BLANK_BACKSTOP_COUNT__ || 0, allLand: window.__RAW_ALL_LAND_REDRIVE__ || null,
      blocked: (window.__MARINE_RENDER_SOURCE_DIAG__ || {}).renderBlockedReason || null,
      dump: Object.fromEntries(['__MARINE_RENDER_SOURCE_DIAG__', '__WEBGL_MARINE_UPLOAD_DIAG__', '__MARINE_SHARPEN_DIAG__', '__MARINE_TRANSITION_STATE__', '__MARINE_FETCH_DIAG__', '__MARINE_SERVE_DIAG__']
        .map((k) => [k, (() => { try { return JSON.stringify(window[k]).slice(0, 500); } catch (e) { return null; } })()])),
      cal: (() => { const t0 = performance.now(); let h = 0x811c9dc5; for (let i = 0; i < 20000000; i += 1) { h ^= i; h = Math.imul(h, 0x01000193) >>> 0; } window.__CAL_SINK__ = h; return +(performance.now() - t0).toFixed(1); })() }));
    Object.assign(res, { redrives: { ...con, idle: undefined }, dump: st.dump, idleMs: IDLE_MS, backstopsIdle: st.backstops - b0, allLand: st.allLand, blocked: st.blocked, cal: st.cal,
      gridIdle: reqs.grid - r0.grid, seriesIdle: reqs.series - r0.series, gridTotal: reqs.grid, seriesTotal: reqs.series });
  } catch (e) { res.error = String(e && e.message || e).slice(0, 200); }
  await browser.close();
  return res;
}

(async () => {
  if (cdn) await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const out = [];
  for (let s = 0; s < SESSIONS; s += 1) for (const arm of (s % 2 ? ['kill', 'on'] : ['on', 'kill'])) {
    const r = await session(arm); out.push(r);
    console.log(`${arm}: backstop ticks ${r.backstopsIdle}, REAL re-drives ${r.redrives ? r.redrives.emptyRedrive + r.redrives.clampRedrive + r.redrives.clampProbe : '?'} ${JSON.stringify(r.redrives)} | /grid ${r.gridIdle} /grid_series ${r.seriesIdle} while idle | blocked ${r.blocked} | cal ${r.cal} ms | allLand ${JSON.stringify(r.allLand)}${r.error ? ' ERROR ' + r.error : ''}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  if (process.env.DUMP === '1') for (const r of out) console.log(JSON.stringify(r.dump, null, 1));
  if (cdn) cdn.close();
})();
