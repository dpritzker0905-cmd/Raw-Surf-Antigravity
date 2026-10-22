// Waves -> Wind toggle, then a 10-step scrub, at the owner's zooms (2026-10-22, "wind is not immediately instant scrub upon
// toggling over to that layer"). Offline only.
//
// One fresh browser per (zoom, arm). Waves on at hour 0, SETTLE ms (the owner looks at waves first: this is also the idle time
// a wind prefetch gets), then the Wind button, then STEPS on the forecast wheel. Recorded per toggle and per step:
//   baseMs    press -> the wind engine's BASE texture holds the product /grid serves for the hour's WORLD request, at full
//             resolution (not the 46 x 21 thinned series frame), GFS
//   viewMs    press -> baseMs holds AND the fine overlay (when one is resident) holds the same instant (or none is resident)
//   fineMs    press -> a fine overlay of the target hour finer than the 2-deg base is resident (close zooms only; null = none)
//   mislabel  animation frames whose base or fine grid is LABELLED the target hour (hourOffset) while its data is another
//             instant (the #267 rule; must be 0)
//   thin      animation frames with the thinned series frame as the base (a coarser picture than /grid's 2-deg base)
//   reqs      backend requests during the window, by path; gridH0 = /grid requests for the toggle hour
//   logs      app console lines during the window that name the fetch storm ("Fetching wind (attempt", "Cache miss for wind",
//             "Wind grid fetch error", "Contained) Wind Cache Hit"), counted
// Data instant of a grid: its STORED product id (gfs_wind_wind_<tier>_<stamp>.json), else served_valid_time, else (a series
// frame) the served instant the /grid_series response carried for that hour (captured from the response by the harness).
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS --layers waves,wind --dynamic 1 --port 4100
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3100
//   CDN_DIR=<frames dir> PORT=4100 VIEW=owner ZOOMS=2,3.9,4.4,6,9 OUT=wind.json node frontend/scripts/offline-backend/scn_wind_toggle.js
// Env: ARMS (cur; nowind = window.__RAW_DISABLE_WIND_STATIC_FRAMES__; grid = window.__RAW_DISABLE_STATIC_FRAMES__), ROUNDS (1),
// SETTLE (15000), WIN (8000), CENTER (-79.5,28.6), VIEW (desktop | owner | phone), CDN_PORT (4192), CDN_LAT, LAT_SERIES,
// LAT_SERIES_FRAME, LAT_GRID (ms added per backend response: a stand-in for the live box).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_wind_toggle is offline only');
const PORT = +(process.env.PORT || 4100);
const CDN_DIR = process.env.CDN_DIR || '';
const CDN_PORT = +(process.env.CDN_PORT || 4192);
const ROUNDS = +(process.env.ROUNDS || 1);
const WIN = +(process.env.WIN || 8000);
const SETTLE = +(process.env.SETTLE || 15000);
const ZOOMS = (process.env.ZOOMS || '2,3.9,4.4,6,9').split(',').map(Number);
const [CLNG, CLAT] = (process.env.CENTER || '-79.5,28.6').split(',').map(Number);
const VIEW = process.env.VIEW || 'owner';
const VIEWS = { desktop: { width: 1280, height: 800, dpr: 1 }, owner: { width: 844, height: 390, dpr: 2 }, phone: { width: 390, height: 844, dpr: 3 } };
const LAT_SERIES = +(process.env.LAT_SERIES || 0); const LAT_GRID = +(process.env.LAT_GRID || 0); const CDN_LAT = +(process.env.CDN_LAT || 0);
// The live box builds a series page frame by frame (~0.25 s each for a 48-frame world page): LAT_SERIES_FRAME ms per asked hour.
const LAT_SERIES_FRAME = +(process.env.LAT_SERIES_FRAME || 0);
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
// Two builds in one run, alternated per session: an arm "old:<flags>" opens OLD_BASE, anything else AB_BASE (the default build).
const OLD_BASE = process.env.OLD_BASE || null;
const GESTURE = process.env.GESTURE !== '0';   // after the toggle: zoom +0.5, back, pan 200 px (the owner zoomed while it loaded)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// [key, requested hour after it]: 1-h steps (two of every three land between stored 3-hourly frames), day steps, a 5-day
// burst, back, Home.
const STEPS = [['ArrowRight', 1], ['ArrowRight', 2], ['ArrowRight', 3], ['ArrowRight', 4], ['PageUp', 28], ['PageUp', 52],
  ['BURST', 172], ['PageDown', 148], ['ArrowLeft', 147], ['Home', 0]];
const LOG_PATTERNS = { attempt: 'Fetching wind (attempt', cacheMiss: 'Cache miss for wind', fetchError: 'Wind grid fetch error',
  containedHit: 'Contained Wind Cache Hit', cacheHit: 'Backend Wind Cache Hit', aborted: 'signal is aborted' };

const cdnLog = { requests: 0, bytes: 0, byKind: {} };
const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  const send = () => {
    if (!CDN_DIR || !file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' });
      return res.end('{"statusCode":"404","error":"not_found"}');
    }
    const body = fs.readFileSync(file);
    const kind = rel.endsWith('.bin') ? (rel.includes('/wind/') ? 'windFrame' : 'frame') : rel.endsWith('latest.json') ? 'latest'
      : rel.endsWith('wind_lane.json') ? 'lane' : 'index';
    cdnLog.requests += 1; cdnLog.bytes += body.length;
    cdnLog.byKind[kind] = cdnLog.byKind[kind] || { n: 0, bytes: 0 };
    cdnLog.byKind[kind].n += 1; cdnLog.byKind[kind].bytes += body.length;
    res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length,
      'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json',
      'cache-control': (kind === 'latest' || kind === 'lane') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(body);
  };
  CDN_LAT ? setTimeout(send, CDN_LAT) : send();
});

const PROBE = () => {
  const P = (window.__WT__ = { w: null, seriesServed: {} });
  window.addEventListener('keydown', (e) => { if (P.w && P.w.armed) P.w.tLast = e.timeStamp; }, true);
  window.addEventListener('pointerdown', (e) => { if (P.w && P.w.armed && P.w.byClick) P.w.tLast = e.timeStamp; }, true);
  const stampMs = (pid) => { const m = /_(\d{8}T\d{6}Z)(_estimated)?\.json$/.exec(pid || ''); return m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : null; };
  const span = (b) => (b ? ((b.east < b.west) ? b.east + 360 - b.west : b.east - b.west) : null);
  const cell = (g) => (g && g.bounds && g.cols > 1 ? span(g.bounds) / (g.cols - 1) : null);
  const dataMs = (g) => {
    if (!g) return null;
    const pid = g.product_id || g.productId || null;
    const s = stampMs(pid); if (s != null) return s;
    if (g.served_valid_time) return Date.parse(g.served_valid_time);
    if (g.__fromSeries && P.seriesServed[g.hourOffset] != null) return P.seriesServed[g.hourOffset];
    if (g.__staticWind && g.valid_time) return Date.parse(g.valid_time);
    return null;
  };
  const desc = (g) => (g ? { h: g.hourOffset, cols: g.cols, rows: g.rows, span: Math.round(span(g.bounds) * 10) / 10, cell: cell(g) && +cell(g).toFixed(3),
    series: !!g.__fromSeries, stat: !!g.__staticWind, stale: !!g.stale, data: dataMs(g), pid: g.product_id || null, src: g.source || null } : null);
  P.snap = () => {
    const e = window.__WIND_ENGINE__;
    const base = e && e._windData && e._windData.windGrid; const fine = e && e._windFine && e._windFine.windGrid;
    return { base, fine };
  };
  const loop = (t) => {
    const W = P.w;
    if (W && W.armed && !W.done && W.tLast != null && t >= W.tLast) {
      const { base, fine } = P.snap(); const rel = t - W.tLast;
      const bd = dataMs(base); const fd = dataMs(fine);
      const fullBase = !!(base && base.cols >= 150 && (base.source || 'GFS') === 'GFS' && span(base.bounds) >= 350);
      const baseOk = fullBase && bd === W.expectedMs;
      const fineOk = !fine || (fd === W.expectedMs);
      if (W.base == null && baseOk) W.base = W.already ? 0 : rel;
      if (W.view == null && baseOk && fineOk) { W.view = W.already ? 0 : rel; W.viewVia = base.__staticWind ? 'static' : (base.__fromSeries ? 'series' : 'grid'); }
      else if (W.view != null && !(baseOk && fineOk)) W.regress += 1;
      if (W.fine == null && fine && fine.hourOffset === W.target && cell(fine) != null && cell(fine) < 1.9) W.fine = rel;
      if ((base && base.hourOffset === W.target && bd != null && bd !== W.expectedMs) || (fine && fine.hourOffset === W.target && fd != null && fd !== W.expectedMs)) W.mislabel += 1;
      if (base && base.__fromSeries && base.cols < 100) W.thin += 1;
      W.frames += 1;
      const k = `${base ? base.cols + 'x' + base.rows : '-'}/${fine ? fine.cols + 'x' + fine.rows : '-'}`;
      if (k !== W.lastDims) { W.dims.push(`${k}@${Math.round(rel)}`); W.lastDims = k; }
      if (base !== W.lastBase || fine !== W.lastFine) { W.commits += 1; W.lastBase = base; W.lastFine = fine; }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  P.arm = (target, expectedMs, byClick) => {
    const { base, fine } = P.snap();
    P.w = { armed: true, byClick: !!byClick, target, expectedMs, tLast: null, base: null, view: null, viewVia: null, fine: null, regress: 0,
      mislabel: 0, thin: 0, frames: 0, dims: [], lastDims: null, commits: 0, lastBase: base, lastFine: fine, already: false };
    const bd = dataMs(base); const fd = dataMs(fine);
    P.w.already = !!(base && base.cols >= 150 && bd === expectedMs && (!fine || fd === expectedMs));
  };
  P.read = () => { const { lastBase, lastFine, ...w } = P.w; const { base, fine } = P.snap(); return { ...w, end: { base: desc(base), fine: desc(fine) } }; };
  P.counters = () => ({ sf: window.__RAW_STATIC_FRAMES__ ? { ...window.__RAW_STATIC_FRAMES__, fetchMs: undefined, inflateMs: undefined, buildMs: undefined } : null,
    wind: window.__RAW_WIND_STATIC__ ? JSON.parse(JSON.stringify(window.__RAW_WIND_STATIC__)) : null,
    series: window.__WIND_SERIES_DIAG__ ? { ...window.__WIND_SERIES_DIAG__ } : null,
    baseLane: window.__WIND_BASE_LANE__ ? { ...window.__WIND_BASE_LANE__ } : null });
};

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.click();
}

async function expectedFor(anchor, hours) {
  const out = {};
  for (const h of hours) {
    const ask = new Date(anchor + h * 3600000).toISOString();
    const j = await (await fetch(`http://127.0.0.1:${PORT}/api/weather/grid?model=GFS&domain=wind&layer=wind&valid_time=${encodeURIComponent(ask)}&bbox=-180,-80,180,85`)).json();
    const m = /_(\d{8}T\d{6}Z)(_estimated)?\.json$/.exec(j.product_id || '');
    out[h] = m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : (j.served_valid_time ? Date.parse(j.served_valid_time) : null);
  }
  return out;
}

async function session(arm, zoom) {
  const v = VIEWS[VIEW];
  const useOld = arm.startsWith('old');
  let pageRef = null;
  const { browser, page, log } = await L.launch({ port: PORT, width: v.width, height: v.height, dpr: v.dpr, hooks: {
    beforeWeather: async (url) => { const nh = (url.searchParams.get('hours') || '').split(',').filter(Boolean).length;
      const d = url.pathname.endsWith('/grid_series') ? LAT_SERIES + LAT_SERIES_FRAME * nh : url.pathname.endsWith('/grid') ? LAT_GRID : 0; if (d) await sleep(d); },
    afterWeather: async (url, resp) => {
      if (!url.pathname.endsWith('/grid_series') || url.searchParams.get('domain') !== 'wind' || !pageRef) return;
      const j = JSON.parse((await resp.body()).toString('utf8'));
      const served = {};
      for (const f of j.frames || []) {
        const m = /_(\d{8}T\d{6}Z)(_estimated)?\.json$/.exec(f.product_id || '');
        served[f.hour_offset] = m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : (f.served_valid_time ? Date.parse(f.served_valid_time) : null);
      }
      await pageRef.evaluate((s) => { Object.assign(window.__WT__.seriesServed, s); }, served);
    } } });
  pageRef = page;
  const counts = {}; let counting = false;
  page.on('console', (m) => { if (!counting) return; const t = m.text(); for (const [k, p] of Object.entries(LOG_PATTERNS)) if (t.includes(p)) counts[k] = (counts[k] || 0) + 1; });
  await page.addInitScript(({ arm, base }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__');
    window.__RAW_STATIC_FRAMES_BASE__ = base;
    if (arm.endsWith('grid')) window.__RAW_DISABLE_STATIC_FRAMES__ = true;
    if (arm.endsWith('nowind')) window.__RAW_DISABLE_WIND_STATIC_FRAMES__ = true;
    if (arm.endsWith('noprefetch')) window.__RAW_DISABLE_WIND_PREFETCH__ = true;
  }, { arm, base: `http://127.0.0.1:${CDN_PORT}/` });
  await page.addInitScript(PROBE);
  const out = { arm, zoom, view: VIEW };
  try {
    if (useOld) {
      if (!OLD_BASE) throw Error('arm old* needs OLD_BASE');
      await page.goto(OLD_BASE + '/map', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!(window.__MAP_INSTANCE__ || window.map), null, { timeout: 90000 });
      await page.waitForTimeout(1500);
    } else await L.openMap(page);
    await L.jump(page, CLNG, CLAT, zoom);
    await clickExact(page, 'Waves');
    await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 60000 });
    await sleep(SETTLE);
    const anchor = Math.round(Date.now() / 3600000) * 3600000;
    const expected = await expectedFor(anchor, [0, ...STEPS.map((s) => s[1])]);
    out.vp = await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; const b = m.getBounds(); return { z: +m.getZoom().toFixed(2), w: +b.getWest().toFixed(2), s: +b.getSouth().toFixed(2), e: +b.getEast().toFixed(2), n: +b.getNorth().toFixed(2) }; });
    out.beforeToggle = await page.evaluate(() => window.__WT__.counters());
    const cdn0 = JSON.parse(JSON.stringify(cdnLog));
    // THE TOGGLE: Waves -> Wind (layers are exclusive), at hour 0.
    const window0 = async (t0, r0) => {
      let r;
      do { await sleep(50); r = await page.evaluate(() => window.__WT__.read()); } while ((r.view == null) && Date.now() - t0 < WIN);
      await sleep(1500);
      r = await page.evaluate(() => window.__WT__.read());
      await page.evaluate(() => { window.__WT__.w.done = true; });
      const q = log.requests.slice(r0); const by = {}; for (const x of q) by[x.path] = (by[x.path] || 0) + 1;
      return { r, by, q };
    };
    await page.evaluate(({ e }) => window.__WT__.arm(0, e, true), { e: expected[0] });
    counting = true; for (const k of Object.keys(counts)) delete counts[k];
    const r0 = log.requests.length; const t0 = Date.now();
    await clickExact(page, 'Wind');
    const tg = await window0(t0, r0);
    const gridH0 = tg.q.filter((x) => x.path === '/grid' && x.q && x.q.domain === 'wind').length;
    out.toggle = { baseMs: tg.r.base == null ? null : Math.round(tg.r.base), viewMs: tg.r.view == null ? null : Math.round(tg.r.view), via: tg.r.viewVia,
      fineMs: tg.r.fine == null ? null : Math.round(tg.r.fine), mislabel: tg.r.mislabel, thin: tg.r.thin, regress: tg.r.regress, commits: tg.r.commits,
      dims: tg.r.dims, reqs: tg.by, gridH0, logs: { ...counts }, end: tg.r.end,
      windowMs: Date.now() - t0 };
    if (GESTURE) {
      // The owner zoomed while the toggle settled: moveend / zoomstart / dragstart all re-enter the wind fetch loop at hour 0.
      for (const k of Object.keys(counts)) delete counts[k];
      const g0 = log.requests.length;
      await page.evaluate((z) => { const m = window.__MAP_INSTANCE__ || window.map; m.zoomTo(z + 0.5, { duration: 300 }); }, zoom); await sleep(1500);
      await page.evaluate((z) => { const m = window.__MAP_INSTANCE__ || window.map; m.zoomTo(z, { duration: 300 }); }, zoom); await sleep(1500);
      await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; m.panBy([200, 0], { duration: 300 }); }); await sleep(2000);
      const q = log.requests.slice(g0); const by = {}; for (const x of q) by[x.path] = (by[x.path] || 0) + 1;
      out.gesture = { reqs: by, gridH0: q.filter((x) => x.path === '/grid' && x.q && x.q.domain === 'wind').length, logs: { ...counts },
        end: await page.evaluate(() => { const r = window.__WT__.snap(); const d = (g) => g && { cols: g.cols, rows: g.rows, h: g.hourOffset, pid: g.product_id || null }; return { base: d(r.base), fine: d(r.fine) }; }) };
    }
    out.steps = [];
    for (const [key, target] of STEPS) {
      await page.evaluate(({ t, e }) => window.__WT__.arm(t, e, false), { t: target, e: expected[target] });
      for (const k of Object.keys(counts)) delete counts[k];
      const s0 = log.requests.length; const ts = Date.now();
      const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
      if (key === 'BURST') { for (let i = 0; i < 5; i++) { await page.keyboard.press('PageUp'); await sleep(60); } } else await page.keyboard.press(key);
      const st = await window0(ts, s0);
      out.steps.push({ key, target, baseMs: st.r.base == null ? null : Math.round(st.r.base), viewMs: st.r.view == null ? null : Math.round(st.r.view),
        via: st.r.viewVia, fineMs: st.r.fine == null ? null : Math.round(st.r.fine), already: st.r.already, mislabel: st.r.mislabel, thin: st.r.thin,
        regress: st.r.regress, commits: st.r.commits, dims: st.r.dims, reqs: st.by, logs: { ...counts }, end: st.r.end });
      await sleep(300);
    }
    counting = false;
    if (Math.round(Date.now() / 3600000) * 3600000 !== anchor) out.anchorRolled = true;
    out.after = await page.evaluate(() => window.__WT__.counters());
    out.cdn = { requests: cdnLog.requests - cdn0.requests, bytes: cdnLog.bytes - cdn0.bytes, beforeToggleBytes: cdn0.bytes };
    out.errors = log.errors.slice(0, 5);
    out.hosts = Object.keys(log.hosts);
    return out;
  } finally { await browser.close(); }
}

const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const pct = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const sessions = [];
  const out = { env: { PORT, CDN_PORT, CDN_DIR, ROUNDS, WIN, SETTLE, ZOOMS, CENTER: [CLNG, CLAT], VIEW, LAT_SERIES, LAT_SERIES_FRAME, LAT_GRID, CDN_LAT, base: L.BASE, startedUtc: new Date().toISOString() }, sessions };
  const ARMS = (process.env.ARMS || 'cur').split(',');
  try {
    for (let i = 0; i < ROUNDS; i++) {
      for (const zoom of ZOOMS) {
        for (const arm of (i % 2 === 0 ? ARMS : [...ARMS].reverse())) {
          const s = await session(arm, zoom);
          sessions.push(s);
          console.log(`z${zoom} ${arm} toggle base/view ${s.toggle.baseMs}/${s.toggle.viewMs} via ${s.toggle.via} gridH0 ${s.toggle.gridH0} logs ${JSON.stringify(s.toggle.logs)} gesture ${JSON.stringify(s.gesture || null)}`,
            'steps', JSON.stringify(s.steps.map((x) => [x.target, x.viewMs, x.via, x.mislabel, x.thin, (x.reqs['/grid'] || 0) + (x.reqs['/grid_series'] || 0)])), 'cdn', JSON.stringify(s.cdn));
          if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
        }
      }
    }
    const summary = {};
    for (const arm of ARMS) {
      for (const zoom of ZOOMS) {
        const ss = sessions.filter((s) => s.arm === arm && s.zoom === zoom);
        const st = ss.flatMap((s) => s.steps);
        const v = st.map((x) => x.viewMs);
        const backend = (x) => (x.reqs['/grid'] || 0) + (x.reqs['/grid_series'] || 0);
        summary[`${arm}@z${zoom}`] = {
          toggle_view_ms: ss.map((s) => s.toggle.viewMs), toggle_base_ms: ss.map((s) => s.toggle.baseMs), toggle_backend: ss.map((s) => backend(s.toggle)),
          toggle_grid_h0: ss.map((s) => s.toggle.gridH0), toggle_logs: ss.map((s) => s.toggle.logs),
          gesture_backend: ss.map((s) => s.gesture && ((s.gesture.reqs['/grid'] || 0) + (s.gesture.reqs['/grid_series'] || 0))), gesture_logs: ss.map((s) => s.gesture && s.gesture.logs),
          steps: st.length, view_missed: v.filter((x) => x == null).length, view_ms_p50: median(v), view_ms_p95: pct(v, 0.95),
          backend_per_step: +(st.reduce((a, x) => a + backend(x), 0) / Math.max(1, st.length)).toFixed(2),
          mislabel_frames: st.reduce((a, x) => a + x.mislabel, 0) + ss.reduce((a, s) => a + s.toggle.mislabel, 0),
          thin_frames: st.reduce((a, x) => a + x.thin, 0) + ss.reduce((a, s) => a + s.toggle.thin, 0),
          via: st.reduce((a, x) => { a[x.via || 'none'] = (a[x.via || 'none'] || 0) + 1; return a; }, {}),
          cdn_bytes: ss.map((s) => s.cdn.bytes), cdn_before_toggle: ss.map((s) => s.cdn.beforeToggleBytes) };
      }
    }
    out.summary = summary;
    console.log(JSON.stringify(summary, null, 1));
  } finally {
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
    cdn.close();
  }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
