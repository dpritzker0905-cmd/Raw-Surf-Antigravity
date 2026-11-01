// FIRST WAVES CLICK after boot (skills audit #2, 2026-10-23). Offline only. One build, two arms interleaved per round (a fresh
// browser each, so nothing is in the HTTP cache):
//   on   the default: MapPage's mount spawns the static frames' inflate worker, reads latest.json, pins the GFS waves index and,
//        in idle time, loads the current hour's frame and builds its vectors at 'low' priority (staticFrames.prewarmStaticFrames);
//   off  window.__RAW_DISABLE_STATIC_FRAMES_PREWARM__ = true: today's waterfall, all of it after the click.
// Per session: open /map, go to the world view, wait IDLE ms (someone looking at the map), click Waves, then time the click to
//   first   the first waves frame the engine holds (any resolution),
//   full    the first full-resolution frame (stride 0, >= MIN_COLS columns), and whether the static frame put it there;
// plus the static objects fetched before the click (the warm-up) and after it, the backend /grid and /grid_series asks after it,
// and the page's own prewarm record (window.__RAW_STATIC_FRAMES__.prewarm).
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS --port 4100
//   python backend/scripts/publish_frame_images.py --store-dir <store> --out-dir <cdn> --only frames
//   node frontend/scripts/offline-backend/serve_spa.js frontend/build 3100
//   CDN_DIR=<cdn> PORT=4100 CDN_LAT=340 IDLE=3000 ROUNDS=3 OUT=first_waves.json node frontend/scripts/offline-backend/scn_first_waves.js
// Env: ROUNDS (3), ARMS (on,off), IDLE (ms between the map being up and the click, 3000; 0 = at once), WIN (ms, 20000),
// CDN_LAT (ms per static object), CDN_PORT (4193), ZOOM (3.2, the world view), CENTER (-80,24), MIN_COLS (150).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_first_waves is offline only');
const PORT = +(process.env.PORT || 4100);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4193);
const ROUNDS = +(process.env.ROUNDS || 3);
const ARMS = (process.env.ARMS || 'on,off').split(',');
const IDLE = +(process.env.IDLE || 3000);
const WIN = +(process.env.WIN || 20000);
const CDN_LAT = +(process.env.CDN_LAT || 0);
const ZOOM = +(process.env.ZOOM || 3.2);
const [CLNG, CLAT] = (process.env.CENTER || '-80,24').split(',').map(Number);
const MIN_COLS = +(process.env.MIN_COLS || 150);
if (!CDN_DIR) throw Error('CDN_DIR=<publisher --out-dir> is required');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdnLog = [];
const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  const send = () => {
    const cors = { 'access-control-allow-origin': '*' };
    if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(400, { ...cors, 'content-type': 'application/json' }); return res.end('{"statusCode":"404","error":"not_found"}');
    }
    const body = fs.readFileSync(file);
    cdnLog.push({ at: Date.now(), kind: rel.endsWith('latest.json') ? 'latest' : rel.endsWith('.bin') ? 'frame' : 'index', bytes: body.length });
    res.writeHead(200, { ...cors, 'content-length': body.length, 'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json',
      'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(body);
  };
  CDN_LAT ? setTimeout(send, CDN_LAT) : send();
});

// The in-page probe: the click's own timeStamp, then every animation frame, what the engine holds.
const PROBE = ({ minCols }) => {
  const P = (window.__FW__ = { armed: false, t0: null, first: null, full: null });
  window.addEventListener('click', (e) => { if (P.armed && P.t0 == null) P.t0 = e.timeStamp; }, true);
  const tick = () => {
    const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = d && d.waveGrid;
    if (P.t0 != null && g && (g.__componentLayer || 'waves') === 'waves' && !P.full) {
      const at = { ms: Math.round(performance.now() - P.t0), cols: g.cols, stride: g.__decimatedStride || 0, static: !!g.static_frame,
        series: !!g.__fromSeries, store: !!g.__fromFrameStore };
      if (!P.first) P.first = at;
      if (at.stride === 0 && g.cols >= minCols) P.full = at;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function clickExact(page, text) {
  const clicked = await page.waitForFunction((t) => {
    const b = [...document.querySelectorAll('button,[role="button"]')].find((x) => x.textContent.trim() === t && x.offsetParent !== null);
    if (b) b.click();
    return !!b;
  }, text, { timeout: 15000 });
  if (!(await clicked.jsonValue())) throw Error(`no ${text} control`);
}

async function session(arm, round) {
  const kill = arm === 'off';
  const { browser, page, log } = await L.launch({ port: PORT, hashTextureUploads: false });
  await page.addInitScript(({ base, kill }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__'); window.__RAW_STATIC_FRAMES_BASE__ = base;
    if (kill) window.__RAW_DISABLE_STATIC_FRAMES_PREWARM__ = true;
  }, { base: `http://127.0.0.1:${CDN_PORT}/`, kill });
  await page.addInitScript(PROBE, { minCols: MIN_COLS });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 200)));
  const c0 = cdnLog.length; const tOpen = Date.now();
  try {
    await L.openMap(page);
    await L.jump(page, CLNG, CLAT, ZOOM);
    await sleep(IDLE);
    const warm = await page.evaluate(() => { const t = window.__RAW_STATIC_FRAMES__; return t ? { prewarm: t.prewarm || null, worker: t.worker || null } : null; });
    const cBefore = cdnLog.length; const rBefore = log.requests.length;
    await page.evaluate(() => { window.__FW__.armed = true; });
    await clickExact(page, 'Waves');
    const t0 = Date.now(); let r;
    do { await sleep(50); r = await page.evaluate(() => ({ t0: window.__FW__.t0, first: window.__FW__.first, full: window.__FW__.full })); } while (!r.full && Date.now() - t0 < WIN);
    await sleep(500);
    const objs = (a, b) => { const o = { latest: 0, index: 0, frame: 0 }; for (const x of cdnLog.slice(a, b)) o[x.kind] += 1; return o; };
    const after = log.requests.slice(rBefore).map((q) => q.path);
    return { arm, round, idle: IDLE, openToClickMs: t0 - tOpen, first: r.first, full: r.full, warm,
      cdnBeforeClick: objs(c0, cBefore), cdnAfterClick: objs(cBefore, cdnLog.length),
      gridAsks: after.filter((p) => p.endsWith('/grid')).length, seriesAsks: after.filter((p) => p.endsWith('/grid_series')).length,
      errors: [...errors, ...log.errors.slice(0, 5)] };
  } finally { await browser.close(); }
}

const pct = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : null; };
(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const out = [];
  try {
    for (let round = 0; round < ROUNDS; round++) {
      const order = round % 2 ? ARMS.slice().reverse() : ARMS;
      for (const arm of order) {
        const s = await session(arm, round);
        out.push(s);
        console.log(`${arm} r${round}: first ${s.first ? s.first.ms : '-'} ms, full ${s.full ? s.full.ms : '-'} ms (static ${s.full ? s.full.static : '-'})`
          + ` | cdn before ${JSON.stringify(s.cdnBeforeClick)} after ${JSON.stringify(s.cdnAfterClick)} | /grid ${s.gridAsks} series ${s.seriesAsks}`
          + ` | prewarm ${JSON.stringify(s.warm && s.warm.prewarm)}${s.errors.length ? ' | errors ' + s.errors.length : ''}`);
      }
    }
  } finally { cdn.close(); }
  const summary = {};
  for (const arm of ARMS) {
    const rows = out.filter((s) => s.arm === arm);
    summary[arm] = { n: rows.length, firstP50: pct(rows.map((s) => s.first && s.first.ms), 0.5), fullP50: pct(rows.map((s) => s.full && s.full.ms), 0.5),
      fullMax: pct(rows.map((s) => s.full && s.full.ms), 1), staticShare: rows.filter((s) => s.full && s.full.static).length / (rows.length || 1) };
  }
  console.log('SUMMARY', JSON.stringify(summary));
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ env: { IDLE, CDN_LAT, ZOOM, ROUNDS }, summary, sessions: out }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
