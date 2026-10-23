// Zoom OUT after scrubbing on a mid-zoom clip (2026-10-22, the owner's console on dev 8b396b11). Offline only.
//
// The owner scrubbed at z4.45 (the resident a 31 x 20 clip of global_mid), went Home, then zoomed out to z3.25: the engine kept the
// clip ("No-downgrade: kept resident 31x20; rejected 181x82 at zoom 3.3"), the render backstop re-drove 11 times over ~35 s, and the
// world frame landed only when the self-heal fired at z3.0. This replays that flow ONCE per (target zoom, arm) in a fresh browser:
// open at ZOOM_FROM, Waves, settle, scrub (PageUp x2, Home) so the exact clip is resident, then ease to each ZOOM_TO around a point
// AROUND of the way across the screen (a wheel zooms about the cursor, so the view does not stay centred on the clip), and sample
// every 100 ms for WATCH ms:
//   covers    the share of the viewport the engine's resident grid covers (its bounds against the map's bounds)
//   world     the resident is a world grid (span >= 340)
//   firstFull ms from the end of the zoom to the first frame whose resident covers the whole viewport (>= 0.999); null = never
//   firstWorld  the same, to the first world resident
//   rejects / selfHeals / backstops  window.__MARINE_NO_DOWNGRADE__.count / .selfHealed / __MARINE_BLANK_BACKSTOP_COUNT__ deltas
//   partialMs  ms spent with the resident covering less than the whole viewport (what the owner saw as a partial heatmap)
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS --layers waves,swell_1,swell_2,wind_waves \
//       --regions flagship --dynamic 1 --real-frames <bucket copy> --port 4100
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3100
//   CDN_DIR=<bucket copy> PORT=4100 OUT=zoomout.json node frontend/scripts/offline-backend/scn_zoom_out.js
// Env: ZOOM_FROM (4.45), ZOOM_TO (3.25,3.6), AROUND (0.25: the zoom's fixed point, a share of the width from the left), CENTER
// (-79.5,28.6), VIEW (owner = 844 x 390 dpr 2; desktop = 1280 x 800), ARMS (cur; nocrop, nocropshow: #459's kills; noclipcover / noresync: the
// zoom-out release's two kills, marineZoomOutRelease.js), ROUNDS (1), SETTLE (8000), WATCH (40000), CDN_PORT (4192), CDN_LAT (0).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_zoom_out is offline only');
const PORT = +(process.env.PORT || 4100);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4192);
const CDN_LAT = +(process.env.CDN_LAT || 0);
const ROUNDS = +(process.env.ROUNDS || 1);
const SETTLE = +(process.env.SETTLE || 8000);
const WATCH = +(process.env.WATCH || 40000);
const ZOOM_FROM = +(process.env.ZOOM_FROM || 4.45);
const ZOOM_TO = (process.env.ZOOM_TO || '3.25,3.6').split(',').map(Number);
const AROUND = +(process.env.AROUND || 0.25);
const [CLNG, CLAT] = (process.env.CENTER || '-79.5,28.6').split(',').map(Number);
const VIEWS = { desktop: { width: 1280, height: 800, dpr: 1 }, owner: { width: 844, height: 390, dpr: 2 } };
const VIEW = process.env.VIEW || 'owner';
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!CDN_DIR) throw Error('CDN_DIR=<a local copy of the weather-frames bucket> is required');

const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  const send = () => {
    if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' });
      return res.end('{"statusCode":"404","error":"not_found"}');
    }
    const body = fs.readFileSync(file);
    const kind = rel.endsWith('.bin') ? 'frame' : rel.endsWith('latest.json') ? 'latest' : 'index';
    res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length,
      'content-type': kind === 'frame' ? 'application/octet-stream' : 'application/json',
      'cache-control': kind === 'latest' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(body);
  };
  CDN_LAT ? setTimeout(send, CDN_LAT) : send();
});

// In the page: one sample of what the engine holds against the map's current view.
const SAMPLE = () => {
  const m = window.__MAP_INSTANCE__ || window.map;
  const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid;
  const b = m.getBounds(); const vw = b.getWest(); const ve = b.getEast(); const vs = b.getSouth(); const vn = b.getNorth();
  let covers = 0; let span = null;
  if (g && g.bounds) {
    const gb = g.bounds; span = (gb.east < gb.west) ? gb.east + 360 - gb.west : gb.east - gb.west;
    const world = span >= 340;
    const ix = world ? (ve - vw) : Math.max(0, Math.min(gb.east, ve) - Math.max(gb.west, vw));
    const iy = Math.max(0, Math.min(gb.north, vn) - Math.max(gb.south, vs));
    covers = (ix * iy) / Math.max(1e-9, (ve - vw) * (vn - vs));
  }
  const nd = window.__MARINE_NO_DOWNGRADE__ || {};
  return { z: +m.getZoom().toFixed(2), dims: g ? `${g.cols}x${g.rows}` : null, span: span === null ? null : Math.round(span), hour: g ? g.hourOffset : null,
    covers: +covers.toFixed(3), rejects: nd.count || 0, selfHeals: nd.selfHealed || 0, backstops: window.__MARINE_BLANK_BACKSTOP_COUNT__ || 0,
    moving: m.isMoving(), scrubbing: !!window.isScrubbingTimeline, debouncing: !!window.__MARINE_FETCH_DEBOUNCING__, pending: !!window.__MARINE_FETCH_PENDING__ };
};

async function session(arm, zoomTo) {
  const v = VIEWS[VIEW];
  const { browser, page, log } = await L.launch({ port: PORT, width: v.width, height: v.height, dpr: v.dpr });
  const notes = [];
  const TRACE = process.env.TRACE === '1';
  page.on('console', (msg) => { const t = msg.text(); if ((TRACE && /marine|Marine|MARINE|grid|Grid/.test(t)) || /No-downgrade|self-heal|Render backstop|Clamp backstop|WEATHER_TRUTH\] ABSENT/.test(t)) notes.push({ t: Date.now(), text: t.slice(0, 240) }); });
  await page.addInitScript(({ arm, base }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__');
    window.__RAW_STATIC_FRAMES_BASE__ = base;
    if (arm === 'nocrop' || arm === 'pre459') window.__RAW_DISABLE_STATIC_MID_CROP__ = true;
    if (arm === 'nocropshow' || arm === 'pre459') window.__RAW_DISABLE_FRAME_STORE_CROP__ = true;
    if (arm === 'noclipcover') window.__RAW_DISABLE_CLIP_COVER_RELEASE__ = true;
    if (arm === 'noresync') window.__RAW_DISABLE_STORE_SHOW_RESYNC__ = true;
  }, { arm, base: `http://127.0.0.1:${CDN_PORT}/` });
  try {
    await L.openMap(page); await L.jump(page, CLNG, CLAT, ZOOM_FROM);
    const loc = page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first();
    await loc.waitFor({ state: 'visible', timeout: 15000 }); await loc.evaluate((el) => el.click());
    await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 60000 });
    await sleep(SETTLE);
    const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
    for (const key of ['PageUp', 'PageUp', 'Home']) { await page.keyboard.press(key); await sleep(1500); }
    await sleep(1500);
    const before = await page.evaluate(SAMPLE);
    const pipeBefore = await page.evaluate(() => { const sf = window.__RAW_STATIC_FRAMES__ || {}; return { sfHits: sf.hits, sfCrops: sf.crops, uploads: window.__WEBGL_MARINE_UPLOAD_COUNT__ || 0 }; });
    const t0 = Date.now();
    await page.evaluate(({ z, f }) => {
      const m = window.__MAP_INSTANCE__ || window.map; const c = m.getCanvas();
      const around = m.unproject([c.clientWidth * f, c.clientHeight * 0.5]);
      m.easeTo({ zoom: z, around, duration: 700 });
    }, { z: zoomTo, f: AROUND });
    await page.waitForFunction(() => !(window.__MAP_INSTANCE__ || window.map).isMoving(), null, { timeout: 10000 });
    const tEnd = Date.now();
    const samples = [];
    while (Date.now() - tEnd < WATCH) { samples.push({ t: Date.now() - tEnd, ...(await page.evaluate(SAMPLE)) }); await sleep(100); }
    const events = await page.evaluate((since) => {
      const f = window.__RAW_FORENSIC__; const d = f && typeof f.dump === 'function' ? f.dump() : null;
      const ev = (d && (d.events || d)) || [];
      return (Array.isArray(ev) ? ev : []).filter((e) => e.t >= since).map((e) => { const { t, type, ...rest } = e; return { t: t - since, type, ...rest }; }).slice(0, 80);
    }, t0);
    const pipe = await page.evaluate(() => { const t = window.__MARINE_PIPELINE_TRUTH__ || {}; const sf = window.__RAW_STATIC_FRAMES__ || {};
      return { events: (t.lastEvents || t.recentEvents || t.events || []).slice(-20), counters: t.counters || null, sfHits: sf.hits, sfCrops: sf.crops, sfMisses: sf.misses,
        uploads: window.__WEBGL_MARINE_UPLOAD_COUNT__ || 0, dupUploads: window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__ || 0, keys: Object.keys(t) }; });
    const firstFull = (samples.find((s) => s.covers >= 0.999) || {}).t ?? null;
    const firstWorld = (samples.find((s) => s.span !== null && s.span >= 340) || {}).t ?? null;
    let partialMs = 0; for (let i = 1; i < samples.length; i++) if (samples[i - 1].covers < 0.999) partialMs += samples[i].t - samples[i - 1].t;
    const last = samples[samples.length - 1];
    return { arm, zoomTo, view: VIEW, before, zoomMs: tEnd - t0, firstFull, firstWorld, partialMs,
      minCovers: Math.min(...samples.map((s) => s.covers)), end: last,
      rejects: last.rejects - before.rejects, selfHeals: last.selfHeals - before.selfHeals, backstops: last.backstops - before.backstops,
      residents: [...new Set(samples.map((s) => `${s.dims}/${s.span}`))],
      notes: notes.filter((n) => n.t >= t0).map((n) => ({ t: n.t - tEnd, text: n.text })).slice(0, TRACE ? 120 : 30),
      samples: samples.filter((s, i) => i % 5 === 0), events, pipe, pipeBefore, backend: log.requests.filter((q) => q.t >= t0 - log.t0).length };
  } finally { await browser.close(); }
}

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const ARMS = (process.env.ARMS || 'cur').split(',');
  const out = { env: { PORT, CDN_PORT, CDN_LAT, ROUNDS, SETTLE, WATCH, ZOOM_FROM, ZOOM_TO, AROUND, CENTER: [CLNG, CLAT], VIEW, startedUtc: new Date().toISOString() }, sessions: [] };
  try {
    for (let i = 0; i < ROUNDS; i++) {
      for (const z of ZOOM_TO) {
        for (const arm of (i % 2 === 0 ? ARMS : [...ARMS].reverse())) {
          const s = await session(arm, z);
          out.sessions.push(s);
          console.log(`${arm} ${ZOOM_FROM}->${z}: firstFull=${s.firstFull} firstWorld=${s.firstWorld} partialMs=${s.partialMs} minCovers=${s.minCovers}`
            + ` rejects=${s.rejects} selfHeals=${s.selfHeals} backstops=${s.backstops} residents=${JSON.stringify(s.residents)} backend=${s.backend}`);
          if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
        }
      }
    }
  } finally {
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
    cdn.close();
  }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
