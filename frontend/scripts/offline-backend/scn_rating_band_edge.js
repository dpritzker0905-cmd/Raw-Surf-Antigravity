// The rating band's EDGE case (2026-10-26): a rating grid that ends inside the view is a seam ("breaks in the rating on tiles that weren't
// all the way on the screen yet"). Offline only.
//
// One fresh browser per (arm, theme, view): Surf/Rating flag ON, Waves on, a settle on view 1 (a fine rating grid resident), then the surf
// asks are DELAYED HOLD_MS (the new view's covering grid is "not here yet", exactly the owner's moment), the map jumps SHIFT degrees away so the
// resident covers only part of the new view, and the state is read and photographed at HOLD_READ ms (past the 1.5 s grace) and again
// after the held asks are released and the covering grid lands (RELEASE_READ ms). Arms: `on` (the build as it ships), `nofix` (both band-hold
// legs killed: __RAW_DISABLE_BAND_RES_FADE__ + __RAW_DISABLE_BAND_EDGE_FADE__).
//   AB_BASE=http://127.0.0.1:3107 PORT=4151 CDN_DIR=<cdn> THEME=dark|light|beach VIEW=desktop|phone OUT=<json> SHOTS=<dir> \
//       node frontend/scripts/offline-backend/scn_rating_band_edge.js
// Env: ARMS (on,nofix), THEME (dark), VIEW (desktop: 1280x800 | phone: 390x844 dpr 3 touch UA), START ("-80.6,28.1,8"), SHIFT (desktop
// "1.2,0", phone "0,1.6"), SETTLE (9000), HOLD_READ (4000), HOLD_MS (6500: how long the held asks take), RELEASE_READ (9000, after HOLD_READ), CDN_PORT (4381), LEVERS (JSON of window levers to set, e.g.
// {"__RAW_BAND_RES_CELL_LO__":0.2,"__RAW_BAND_RES_CELL_HI__":0.4} to force the RESOLUTION leg on a 0.5 deg grid).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_rating_band_edge is offline only');
const PORT = +(process.env.PORT || 4151);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4381);
const THEME = process.env.THEME || 'dark';
const VIEW = process.env.VIEW || 'desktop';
const ARMS = (process.env.ARMS || 'on,nofix').split(',');
const [SLNG, SLAT, SZ] = (process.env.START || '-80.6,28.1,8').split(',').map(Number);
const [DLNG, DLAT] = (process.env.SHIFT || (VIEW === 'phone' ? '0,1.6' : '1.2,0')).split(',').map(Number);
const SETTLE = +(process.env.SETTLE || 9000);
const HOLD_READ = +(process.env.HOLD_READ || 4000);
const HOLD_MS = +(process.env.HOLD_MS || 6500);
const RELEASE_READ = +(process.env.RELEASE_READ || 9000);
const LEVERS = process.env.LEVERS ? JSON.parse(process.env.LEVERS) : {};
const SHOTS = process.env.SHOTS || '';
if (!CDN_DIR) throw Error('CDN_DIR=<a local copy of the weather-frames bucket> is required');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIMS = VIEW === 'phone' ? { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } }
  : { width: 1280, height: 800, dpr: 1, contextOptions: {} };

const cdn = http.createServer((req, res) => {
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

const READ = () => {
  const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid; const m = window.__MAP_INSTANCE__ || window.map;
  const b = m.getBounds(); const vb = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  const gb = g && g.bounds;
  const rf = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBandFade; const rb = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBand;
  const say = [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null).map((x) => x.textContent.trim());
  return { zoom: +m.getZoom().toFixed(2), vb: { w: +vb.west.toFixed(2), s: +vb.south.toFixed(2), e: +vb.east.toFixed(2), n: +vb.north.toFixed(2) },
    grid: g ? { dims: `${g.cols}x${g.rows}`, bounds: gb && { w: +gb.west.toFixed(2), s: +gb.south.toFixed(2), e: +gb.east.toFixed(2), n: +gb.north.toFixed(2) }, rating: !!g.ratingMode } : null,
    band: rb ? { active: rb.active, cols: rb.gridCols } : null,
    fade: rf ? { fade: +(+rf.fade).toFixed(3), bandMult: +(+rf.bandMult).toFixed(3), covFrac: rf.covFrac == null ? null : +(+rf.covFrac).toFixed(3), edgeFade: rf.edgeFade == null ? null : +(+rf.edgeFade).toFixed(3), resFade: rf.resFade == null ? null : +(+rf.resFade).toFixed(3), heldBy: rf.heldBy, cellDeg: rf.cellDeg } : null,
    say: say.filter((t) => /Surf ratings paused/.test(t)),
    heldEl: (() => { const he = document.querySelector('[data-rating-band-held]'); if (!he) return null; const r = he.getBoundingClientRect(); let a = he.parentElement; let sc = null; while (a) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 2) { sc = { sh: a.scrollHeight, ch: a.clientHeight, st: a.scrollTop, cls: String(a.className).slice(0, 60) }; break; } a = a.parentElement; } const nav = [...document.querySelectorAll('nav,[role="navigation"]')].map((n) => n.getBoundingClientRect()).filter((q) => q.top > window.innerHeight * 0.7).map((q) => Math.round(q.top))[0] || null; return { top: Math.round(r.top), bottom: Math.round(r.bottom), innerH: window.innerHeight, navTop: nav, scroller: sc }; })(),
    allHeld: [...document.querySelectorAll('[data-rating-band-held]')].map((n) => { const r = n.getBoundingClientRect(); let a = n; let hid = null; while (a) { const cs = getComputedStyle(a); if (cs.display === 'none' || cs.visibility === 'hidden') { hid = a.tagName + '.' + String(a.className).slice(0, 40); break; } a = a.parentElement; } return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), hiddenBy: hid, offsetParent: !!n.offsetParent, bottom: Math.round(r.bottom) }; }),
    statuses: [...document.querySelectorAll('[role="status"]')].map((n) => { const r = n.getBoundingClientRect(); return { t: n.textContent.slice(0, 40), top: Math.round(r.top), h: Math.round(r.height), vis: !!n.offsetParent }; }),
    sharpen: window.__MARINE_SHARPEN_DIAG__ ? { kind: window.__MARINE_SHARPEN_DIAG__.kind, found: window.__MARINE_SHARPEN_DIAG__.frameFound, covers: window.__MARINE_SHARPEN_DIAG__.frameCovers, fw: window.__MARINE_SHARPEN_DIAG__.fw, will: window.__MARINE_SHARPEN_DIAG__.willSharpen, ageMs: Date.now() - window.__MARINE_SHARPEN_DIAG__.ts } : null };
};

async function session(arm) {
  let gate = null;                                   // while set, surf asks wait on it (the covering grid "not here yet")
  const held = { n: 0 };
  const asks = [];
  const { browser, page } = await L.launch({ port: PORT, width: DIMS.width, height: DIMS.height, dpr: DIMS.dpr, contextOptions: DIMS.contextOptions, hooks: {
    afterWeather: async (url, resp) => {
      if (url.pathname.endsWith('/grid') || url.pathname.endsWith('/grid_series')) asks.push({ t: Date.now(), p: url.pathname.replace('/api/weather', ''), surf: url.searchParams.get('surf'), bbox: url.searchParams.get('bbox'), layer: url.searchParams.get('layer'), status: resp.status() });
    },
    beforeWeather: async (url) => {
      const p = url.pathname;
      if (gate && /\/(grid|grid_series)$/.test(p) && (url.searchParams.get('surf') === '1' || url.searchParams.get('surf') === 'true')) { held.n += 1; await gate; }
    },
  } });
  const out = { arm, theme: THEME, view: VIEW, start: [SLNG, SLAT, SZ], shift: [DLNG, DLAT] };
  try {
    await page.addInitScript(({ base, arm, theme, levers }) => {
      localStorage.setItem('raw-surf-theme', theme);
      localStorage.removeItem('__RAW_STATIC_FRAMES__');
      window.__RAW_STATIC_FRAMES_BASE__ = base;
      window.__SURF_MODE__ = true;
      if (arm === 'nofix') { window.__RAW_DISABLE_BAND_RES_FADE__ = true; window.__RAW_DISABLE_BAND_EDGE_FADE__ = true; }
      for (const [k, v] of Object.entries(levers)) window[k] = v;
    }, { base: `http://127.0.0.1:${CDN_PORT}/`, arm, theme: THEME, levers: LEVERS });
    await L.openMap(page);
    if (VIEW === 'phone') {                                // the mobile layout starts collapsed: expand the weather controls first
      const ex = page.locator('[aria-label="Weather layers"]').first();
      await ex.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await ex.evaluate((el) => el.click()).catch(() => {});
      await sleep(1000);
    }
    const wv = page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first();
    await wv.waitFor({ state: 'visible', timeout: 20000 }).catch(async (e) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${VIEW}-${THEME}-${arm}-waves-button-missing.png`) }); } throw e; });
    await wv.evaluate((el) => el.click());
    await sleep(3000);
    await L.jump(page, SLNG, SLAT, SZ);
    await sleep(SETTLE);
    out.settled = await page.evaluate(READ);
    const shot = async (tag) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${VIEW}-${THEME}-${arm}-${tag}.png`) }); } };
    await shot('1-settled');
    const tJump = Date.now();
    gate = sleep(HOLD_MS);                                // the surf asks of the new view each take HOLD_MS to answer (the covering grid is "not here yet")
    await L.jump(page, SLNG + DLNG, SLAT + DLAT, SZ);
    await sleep(HOLD_READ);
    out.held = await page.evaluate(READ);
    out.heldAsks = held.n;
    out.asksAfterJump = asks.filter((a) => a.t >= tJump).map((a) => ({ ...a, t: a.t - tJump }));
    await shot('2-edge-held-asks');
    await sleep(RELEASE_READ);
    out.released = await page.evaluate(READ);
    if (process.env.RING) out.events = await page.evaluate((t0) => ((window.__RAW_FORENSIC__ && window.__RAW_FORENSIC__.events) || []).filter((e) => e.t >= t0).slice(-120).map((e) => JSON.stringify({ ...e, t: e.t - t0 }).slice(0, 260)), tJump);
    await shot('3-covering-grid-landed');
  } finally { await browser.close(); }
  return out;
}

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const res = [];
  for (const arm of ARMS) {
    try { res.push(await session(arm)); } catch (e) { res.push({ arm, error: String(e && e.stack || e).slice(0, 800) }); }
  }
  cdn.close();
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(res, null, 1));
  for (const r of res) {
    if (r.error) { console.log('arm', r.arm, 'ERROR', r.error); continue; }
    const f = (s) => `${s.grid && s.grid.dims} cov=${s.fade && s.fade.covFrac} edge=${s.fade && s.fade.edgeFade} res=${s.fade && s.fade.resFade} fade=${s.fade && s.fade.fade} bandMult=${s.fade && s.fade.bandMult} held=${s.fade && s.fade.heldBy} says=${s.say.length}`;
    console.log(`arm ${r.arm} ${r.theme} ${r.view} | settled: ${f(r.settled)} | HELD-ASKS (${r.heldAsks} held): ${f(r.held)} | landed: ${f(r.released)}`);
  }
})();
