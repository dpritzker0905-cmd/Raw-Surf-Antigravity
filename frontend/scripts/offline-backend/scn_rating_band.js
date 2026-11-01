// The rating band at Florida z7-9 (2026-10-25, the owner's manual test): is the band painted from a rating grid that covers the view, and
// does the regional bundle client (#552, waves-only frames) displace the surf=1 rating grids? Offline only.
//
// Per (arm, view): a fresh browser with the Surf/Rating flag ON (window.__SURF_MODE__ = true before load), the Waves layer on, a jump to the
// view, a settle. Recorded per view: window.__RAW_GPU__.ratingBand (flag, gridRatingMode, active, cols, fromSeries), the engine grid
// (dims, span, bounds, isEstimated, product id, source), whether the grid COVERS the map's viewport, and EVERY weather ask since the jump
// (path, surf flag, bbox, status) with, for surf asks, what the answer was (rating_mode, dims, region, estimated). Arms: `on` (the build's
// default: bundles ON), `off` (window.__RAW_DISABLE_REGIONAL_BUNDLES__ = true), `nofix` (the band-hold legs killed: __RAW_DISABLE_BAND_RES_FADE__ + __RAW_DISABLE_BAND_EDGE_FADE__).
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS --layers waves --regions <...> --dynamic 1 --port 4151
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3106
//   AB_BASE=http://127.0.0.1:3106 PORT=4151 CDN_DIR=<cdn> OUT=<json> node frontend/scripts/offline-backend/scn_rating_band.js
// Env: EARLY (1500 ms after the jump: a second, early read of the same state), ARMS (on,off), VIEWS ("lng,lat,zoom;..." default Florida 7, 7.8, 8, 8.5, 9 at -80.6,28.1), SETTLE (9000), CDN_PORT (4371), SHOTS (dir:
// saves a PNG per arm and view), THEME (dark).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_rating_band is offline only');
const PORT = +(process.env.PORT || 4151);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4371);
const SETTLE = +(process.env.SETTLE || 9000);
const EARLY = +(process.env.EARLY || 1500);
const ARMS = (process.env.ARMS || 'on,off').split(',');
const THEME = process.env.THEME || 'dark';
const VIEWS = (process.env.VIEWS || '-80.6,28.1,7;-80.6,28.1,7.8;-80.6,28.1,8;-80.6,28.1,8.5;-80.6,28.1,9')
  .split(';').map((s) => s.split(',').map(Number));
const SHOTS = process.env.SHOTS || '';
if (!CDN_DIR) throw Error('CDN_DIR=<a local copy of the weather-frames bucket> is required');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// What a surf ask was answered with (the first frame of a series page, or the grid of a /grid answer).
function summarize(body) {
  try {
    const j = JSON.parse(body);
    const f = j.frames && j.frames[0] ? j.frames[0] : null;
    const g = (f && (f.grid || f)) || j.grid || {};
    const meta = (f && f.meta) || j.meta || j.common_meta || {};
    return { ratingMode: j.rating_mode ?? j.ratingMode ?? (f && (f.rating_mode ?? f.ratingMode)) ?? meta.rating_mode ?? null,
      cols: g.cols ?? null, rows: g.rows ?? null, region: meta.region_id ?? j.region_id ?? null, est: meta.is_estimated ?? j.is_estimated ?? null,
      served: j.served_bbox || meta.served_bbox || null, keys: Object.keys(j).slice(0, 8) };
  } catch (e) { return { parseError: true }; }
}


// In-page read: the band state, the resident grid, its coverage of the viewport, the fade legs and the visible status lines.
const READ = () => {
  const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid; const m = window.__MAP_INSTANCE__ || window.map;
  const b = m.getBounds(); const vb = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  const gb = g && g.bounds;
  const cover = gb ? (gb.west <= vb.west && gb.east >= vb.east && gb.south <= vb.south && gb.north >= vb.north) : null;
  const rb = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBand; const rf = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBandFade;
  const say = [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null).map((x) => x.textContent.trim());
  return { zoom: +m.getZoom().toFixed(2), vb, band: rb ? { flag: rb.flag, gridRatingMode: rb.gridRatingMode, forcedOff: rb.forcedOff, active: rb.active, cols: rb.gridCols, fromSeries: rb.fromSeries } : null,
    fade: rf ? { fade: rf.fade, bandMult: rf.bandMult, resFade: rf.resFade, edgeFade: rf.edgeFade, heldBy: rf.heldBy, cellDeg: rf.cellDeg, covFrac: rf.covFrac, spanFade: rf.spanFade, covFade: rf.covFade } : null,
    say: say.filter((t) => /Surf ratings paused/.test(t)),
    grid: g ? { dims: `${g.cols}x${g.rows}`, bounds: gb, spanLng: gb ? +(gb.east - gb.west).toFixed(2) : null, est: !!g.isEstimated, pid: g.__servedProductId || g.productId || null,
      ratingMode: !!g.ratingMode, series: !!g.__fromSeries, store: !!g.__fromFrameStore, hour: g.hourOffset, model: g.__sourceModel || 'GFS' } : null,
    coversViewport: cover, regional: window.__RAW_STATIC_REGIONAL__ ? { hits: window.__RAW_STATIC_REGIONAL__.hits, series: window.__RAW_STATIC_REGIONAL__.series } : null };
};

async function session(arm) {
  const asks = [];
  const { browser, page, log } = await L.launch({ port: PORT, width: 1280, height: 800, hooks: {
    afterWeather: async (url, resp) => {
      const q = Object.fromEntries(url.searchParams.entries());
      const rec = { t: Date.now(), path: url.pathname.replace('/api/weather', ''), surf: q.surf, layer: q.layer, bbox: q.bbox, status: resp.status() };
      if (q.surf === '1' || q.surf === 'true') rec.ans = summarize(await resp.text());
      asks.push(rec);
    },
  } });
  const out = { arm, views: [] };
  try {
    await page.addInitScript(({ base, arm, theme }) => {
      localStorage.setItem('raw-surf-theme', theme);
      localStorage.removeItem('__RAW_STATIC_FRAMES__');
      window.__RAW_STATIC_FRAMES_BASE__ = base;
      window.__SURF_MODE__ = true;                             // the Surf / Rating band ON, before the first read
      if (arm === 'off') window.__RAW_DISABLE_REGIONAL_BUNDLES__ = true;
      if (arm === 'nofix') { window.__RAW_DISABLE_BAND_RES_FADE__ = true; window.__RAW_DISABLE_BAND_EDGE_FADE__ = true; }   // the band-hold legs killed
    }, { base: `http://127.0.0.1:${CDN_PORT}/`, arm, theme: THEME });
    await L.openMap(page);
    await page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first().evaluate((el) => el.click());
    await sleep(3000);
    for (const [lng, lat, zoom] of VIEWS) {
      const from = asks.length;
      await L.jump(page, lng, lat, zoom);
      await sleep(EARLY);
      const early = await page.evaluate(READ);
      await sleep(Math.max(0, SETTLE - EARLY));
      await sleep(0);
      const st = await page.evaluate(READ);
      const mine = asks.slice(from).filter((a) => a.layer === 'waves' || a.layer === undefined);
      out.views.push({ view: [lng, lat, zoom], early: { band: early.band, fade: early.fade, say: early.say, grid: early.grid && early.grid.dims, span: early.grid && early.grid.spanLng, covers: early.coversViewport }, ...st, asks: mine.map((a) => ({ p: a.path, surf: a.surf, bbox: a.bbox, status: a.status, ans: a.ans })) });
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${arm}-z${zoom}-${lng}_${lat}.png`) }); }
    }
    out.errors = log.errors.slice(0, 4);
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
  const json = JSON.stringify(res, null, 1);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, json);
  for (const r of res) {
    console.log('######## arm', r.arm, r.error || '');
    for (const v of r.views || []) {
      console.log(`z${v.zoom} EARLY grid=${v.early.grid} span=${v.early.span} covers=${v.early.covers} fade=${v.early.fade && v.early.fade.fade} held=${v.early.fade && v.early.fade.heldBy} says=${v.early.say.length}`);
      console.log(`z${v.zoom} SETTLED fade=${v.fade && v.fade.fade} held=${v.fade && v.fade.heldBy} cell=${v.fade && v.fade.cellDeg} says=${v.say.length} band=${JSON.stringify(v.band)} grid=${v.grid && v.grid.dims} span=${v.grid && v.grid.spanLng} est=${v.grid && v.grid.est} rating=${v.grid && v.grid.ratingMode} covers=${v.coversViewport} asks(surf)=${v.asks.filter((a) => a.surf === '1' || a.surf === 'true').length}/${v.asks.length}`);
    }
  }
})();
