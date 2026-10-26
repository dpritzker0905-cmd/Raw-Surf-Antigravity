// THE INSTANT CONTRACT (2026-10-26, the owner's live test: "All marine layers need to be instant. Work perfectly. Display correct
// data."). Offline only. One fresh browser per session = (model x layer x zoom x theme x view x arm). Open the map, turn the layer on,
// pick the model, settle, then run PLAN and record per action:
//   exactMs   press / click -> the engine's resident is the product /grid serves for (model, layer, hour), labelled with that hour
//   via       store | series | grid (the path that drew it)
//   blank     animation frames in the action's window with the layer on and NO wave field in the engine (the render returns early)
//   mislabel  frames labelled (target model, target hour) whose data is another time's or another model's product
//   drag      per press of a held-key drag: shown within 33 ms of its press, or skipped (the next press came first); `late` = shown later
// PASS = step p95 <= 100 ms, every drag press shown <= 33 ms or skipped, 0 blank frames, 0 mislabel frames.
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS,ICON,EURO --layers waves --land-mask 1 \
//       --regions flagship --dynamic 1 --port 4263
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3263
//   CDN_DIR=<published frames> PORT=4263 OUT=c.json node frontend/scripts/offline-backend/scn_instant_contract.js
// Env: MODELS (GFS,EURO,ICON: one session per model, which then switches to the others mid-scrub), LAYERS (waves), ZOOMS (2,4.6,5.3,8),
// THEMES (dark), VIEW (desktop | phone = 390 x 844 at dpr 3), CENTER (-75,30), PLAN (below), ARMS (cur | <name>:<FLAG>+<FLAG>...: window
// flags set true), SETTLE (6000), WIN (6000), DRAG_GAP (33), CDN_PORT (4264), CDN_LAT (ms per static object), LAT_MODEL
// (<MODEL>:<ms>: that model's /grid and /grid_series answers held back, a slow switch), AB_BASE (REQUIRED: the SPA under test).
// Known limits: a series-page frame carries no product id or served time, so it is never called exact; the phone layout's
// controls are not opened yet (VIEW=phone fails at the layer chip).
// PLAN tokens: R = one ArrowRight; PU / PD = PageUp / PageDown; J:<h> = a far jump to hour h as a fast key run (PageUp/PageDown, then
// arrows, 40 ms apart: what a wheel drag sends); D:<n> = a held key, n ArrowRight presses DRAG_GAP ms apart; M = switch to the next
// model in MODELS (a click on its chip mid-scrub); H = Home.
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_instant_contract is offline only (never load the live box)');
const PORT = +(process.env.PORT || 4263);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4264);
const CDN_LAT = +(process.env.CDN_LAT || 0);
const WIN = +(process.env.WIN || 6000);
const SETTLE = +(process.env.SETTLE || 6000);
const DRAG_GAP = +(process.env.DRAG_GAP || 33);
const MODELS = (process.env.MODELS || 'GFS,EURO,ICON').split(',');
const LAYERS = (process.env.LAYERS || 'waves').split(',');
const ZOOMS = (process.env.ZOOMS || '2,4.6,5.3,8').split(',').map(Number);
const THEMES = (process.env.THEMES || 'dark').split(',');
const VIEW = process.env.VIEW || 'desktop';
const VIEWS = { desktop: { width: 1280, height: 800, dpr: 1 }, phone: { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } } };
const [CLNG, CLAT] = (process.env.CENTER || '-75,30').split(',').map(Number);
const PLAN = (process.env.PLAN || 'R,R,R,PU,J:29,J:250,J:336,J:126,D:12,M,R,J:250,M,R,J:336').split(',');
const ARMS = (process.env.ARMS || 'cur').split(',').map((a) => { const [name, flags] = a.split(':'); return { name, flags: flags ? flags.split('+') : [] }; });
const CHIP = { waves: 'Waves', swell_1: 'Swell', wind_waves: 'Wind Waves' };
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!CDN_DIR) throw Error('CDN_DIR=<published static frames> is required');
// ⚠️ AB_BASE is REQUIRED here (2026-10-26): ab_lib defaults to 127.0.0.1:3100, which another session's SPA held, so a whole matrix
// measured someone else's build against this backend. Each session also records the bundle it loaded (`bundle`).
if (!process.env.AB_BASE) throw Error('AB_BASE=http://127.0.0.1:<the SPA port serving the build under test> is required');

const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  const send = () => {
    if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' }); return res.end('{"statusCode":"404"}');
    }
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length,
      'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(body);
  };
  CDN_LAT ? setTimeout(send, CDN_LAT) : send();
});

// In the page: one rAF loop judging every frame against the armed action.
const PROBE = () => {
  const P = (window.__IC__ = { w: null, layerOn: false });
  const stamp = (pid) => { const m = /(\d{8}T\d{6}Z)/.exec(pid || ''); return m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : null; };
  const modelOfPid = (pid) => { const m = /^(gfs|euro|icon|ecmwf)_/i.exec(String(pid || '').split('/').pop()); return m ? (m[1].toUpperCase() === 'ECMWF' ? 'EURO' : m[1].toUpperCase()) : null; };
  P.snap = () => {
    const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = d && d.waveGrid;
    const pid = g ? ((g.__fromFrameStore && g.__servedProductId) || g.__servedProductId || g.productId || (window.__WEBGL_MARINE_UPLOAD_DIAG__ || {}).servedProductId || null) : null;
    return { has: !!g, hour: g ? g.hourOffset : null, layer: g ? (g.__componentLayer || 'waves') : null, model: g ? (g.__sourceModel || 'GFS') : null,
      cols: g ? g.cols : null, rows: g ? g.rows : null, stride: g ? (g.__decimatedStride || 0) : 0, series: !!(g && g.__fromSeries), store: !!(g && g.__fromFrameStore),
      pid, served: g ? (g.served_valid_time || null) : null, rating: !!(g && g.ratingMode), grid: g || null };
  };
  const dataMs = (s, W) => (s.pid ? stamp(s.pid) : (s.served ? Date.parse(s.served) : (s.series && s.hour != null ? W.anchor + s.hour * 3600000 : null)));
  const status = () => [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null).map((x) => x.textContent.trim()).join(' | ').slice(0, 160);
  const isExact = (s, W, hour, model) => s.has && s.hour === hour && s.model === model && s.layer === W.layer && s.stride === 0 && !s.rating
    && dataMs(s, W) === W.expected[hour] && (!s.pid || !modelOfPid(s.pid) || modelOfPid(s.pid) === model);
  // Every engine clear, with who asked (the reason log of WebGLMarineLayer's sites, the transition flags, a short stack).
  P.clears = [];
  const hookClear = () => {
    const e = window.__MARINE_ENGINE__;
    if (!e || e.__icHooked) return; e.__icHooked = true;
    const orig = e.clearBuffers.bind(e);
    e.clearBuffers = (gl) => {
      const log = window.__MARINE_CLEAR_LOG__ || []; const last = log[log.length - 1];
      P.clears.push({ t: performance.now(), reason: last && Date.now() - last.timestamp < 50 ? last.reason : null, transitioning: !!window.__MARINE_TRANSITIONING__,
        fetchPending: !!window.__MARINE_FETCH_PENDING__, debouncing: !!window.__MARINE_FETCH_DEBOUNCING__, stack: String(new Error().stack || '').split('\n').slice(2, 7).map((x) => x.trim().slice(0, 90)) });
      return orig(gl);
    };
  };
  const loop = (t) => {
    hookClear();
    const W = P.w;
    if (W && !W.done && W.t0 != null && t >= W.t0) {
      const s = P.snap(); const rel = t - W.t0;
      W.frames += 1;
      if (P.layerOn && !s.has) { W.blank += 1; if (W.blankAt == null) W.blankAt = Math.round(rel); }
      // MISLABEL: a frame labelled (target model, hour h) whose OWN data time is more than 1.5 h from h (the nearest 3-hourly stored
      // frame is at most 1.5 h off by design), or whose product is another model's. Silent when the status line does not say so.
      if (s.has && s.model === W.model && s.layer === W.layer && !s.rating && s.hour != null) {
        const dm = dataMs(s, W); const pm = s.pid ? modelOfPid(s.pid) : null;
        const offH = dm == null ? 0 : Math.abs(W.anchor + s.hour * 3600000 - dm) / 3600000;
        if (offH > 1.5 || (pm && pm !== W.model)) {
          W.mislabel += 1; W.maxOffH = Math.max(W.maxOffH || 0, offH);
          const st = status(); const silent = !/Loading|Verifying|does not match|pending|nearest|estimated|Holding/i.test(st);
          if (silent) W.mislabelSilent += 1;
          const ex = { rel: Math.round(rel), hour: s.hour, offH: +offH.toFixed(2), pid: s.pid && s.pid.slice(-56), served: s.served, series: s.series, store: s.store, status: st };
          if (!W.mislabelEx) W.mislabelEx = ex;
          if (silent && !W.silentEx) W.silentEx = ex;
        }
      }
      if (W.exact == null && isExact(s, W, W.target, W.model)) { W.exact = rel; W.via = s.store ? 'store' : (s.series ? 'series' : 'grid'); W.end = `${s.cols}x${s.rows}`; }
      // Drag presses: each one shown (exact) before the next press, or skipped.
      for (const p of W.presses || []) {
        if (p.shown != null || p.skipped || t < p.t) continue;
        if (isExact(s, W, p.hour, W.model)) p.shown = t - p.t;
      }
      const dims = `${s.cols}x${s.rows}${s.store ? 's' : s.series ? 'q' : 'g'}`;
      if (dims !== W.lastDims) { W.dims.push(`${dims}@${Math.round(rel)}`); W.lastDims = dims; }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  P.arm = (w) => { P.w = { ...w, t0: null, frames: 0, blank: 0, blankAt: null, mislabel: 0, mislabelSilent: 0, exact: null, via: null, dims: [], lastDims: '', presses: [] }; };
  P.go = () => { P.w.t0 = performance.now(); P.w.tGo = P.w.t0; };
  P.press = (hour) => { const W = P.w; const now = performance.now(); for (const p of W.presses) if (p.shown == null) p.skipped = true; W.presses.push({ hour, t: now, shown: null, skipped: false }); };
  P.read = () => { const { presses, ...w } = P.w; const t0 = w.tGo || 0;
    return { ...w, clears: P.clears.filter((c) => c.t >= t0).map((c) => ({ ...c, t: Math.round(c.t - t0) })), presses: presses.map((p) => ({ hour: p.hour, shown: p.shown == null ? null : Math.round(p.shown), skipped: p.skipped })) }; };
};

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  if (!(await loc.count())) {   // the phone layout keeps the chips in the collapsed weather panel: open it first
    const e = page.locator('[aria-label="Expand weather controls"]').filter({ visible: true }).first();
    if (await e.count()) { await e.click(); await sleep(500); }
  }
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.evaluate((el) => el.click());
}
const wheelNow = (page) => page.evaluate((sel) => { const w = [...document.querySelectorAll(sel)].find((x) => x.offsetParent); return w ? +w.getAttribute('aria-valuenow') : 0; }, WHEEL);
async function focusWheel(page) {
  if (!(await page.locator(WHEEL).filter({ visible: true }).count())) {
    const e = page.locator('[aria-label="Expand weather controls"]').filter({ visible: true }).first(); if (await e.count()) { await e.click(); await sleep(400); }
  }
  await page.locator(WHEEL).filter({ visible: true }).first().focus();
}
// The key run a wheel drag from `from` to `to` sends: whole days first, then hours.
function keyRun(from, to) {
  const d = to - from; const keys = [];
  for (let i = 0; i < Math.floor(Math.abs(d) / 24); i++) keys.push(d > 0 ? 'PageUp' : 'PageDown');
  for (let i = 0; i < Math.abs(d) % 24; i++) keys.push(d > 0 ? 'ArrowRight' : 'ArrowLeft');
  return keys;
}

async function session({ model0, layer, zoom, theme, arm }) {
  const v = VIEWS[VIEW];
  // LAT_MODEL=<MODEL>:<ms>: hold that model's /grid and /grid_series answers back (a slow switch: an un-framed tail hour on the live box).
  const [latModel, latMs] = (process.env.LAT_MODEL || ':0').split(':');
  const hooks = latModel ? { beforeWeather: async (url) => { if (/\/grid(_series)?$/.test(url.pathname) && String(url.searchParams.get('model') || '').toUpperCase() === latModel.toUpperCase()) await sleep(+latMs || 0); } } : {};
  const { browser, page, log } = await L.launch({ port: PORT, width: v.width, height: v.height, dpr: v.dpr, contextOptions: v.contextOptions || {}, hooks });
  await page.addInitScript(({ base, theme, flags }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__'); window.__RAW_STATIC_FRAMES_BASE__ = base;
    localStorage.setItem('raw-surf-theme', theme);
    for (const f of flags) window[f] = true;
  }, { base: `http://127.0.0.1:${CDN_PORT}/`, theme, flags: arm.flags });
  await page.addInitScript(PROBE);
  const actions = []; const others = MODELS.filter((m) => m !== model0); let next = 0; let bundle = null;
  try {
    await L.openMap(page); await L.jump(page, CLNG, CLAT, zoom);
    bundle = await page.evaluate(() => { const s = [...document.scripts].map((x) => x.src).find((x) => /\/main\.[0-9a-f]+\.js/.test(x)); return s ? `${location.origin} ${s.split('/').pop()}` : location.origin; });
    await clickExact(page, CHIP[layer] || 'Waves');
    await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 60000 });
    await page.evaluate(() => { window.__IC__.layerOn = true; });
    if (model0 !== 'GFS') { await clickExact(page, model0); }
    await sleep(SETTLE);
    const idle = await page.evaluate(() => new Promise((resolve) => { const out = []; const one = () => { const t0 = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => { out.push(performance.now() - t0); if (out.length < 20) setTimeout(one, 30); else { out.sort((a, b) => a - b); resolve(+out[10].toFixed(1)); } })); }; one(); }));
    // Hour 0 is THE app's anchor (backendWeatherServiceClient.getSeriesAnchorMs: now rounded to the nearest hour), read right before
    // each action: a grid-derived anchor read at settle was an hour off for half of every hour, and the hour can roll mid-run.
    const nowAnchor = () => page.evaluate(() => Math.round(((window.__MOCK_DATE_NOW__) || Date.now()) / 3600000) * 3600000);
    let anchor = await nowAnchor();
    const cache = {};
    // The product /grid serves for (model, hour): the data time to compare with (world box below z7, the app's own box at z7+).
    const box = zoom >= 7 ? await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; const b = m.getBounds(); return [Math.floor(b.getWest()), Math.floor(b.getSouth()), Math.ceil(b.getEast()), Math.ceil(b.getNorth())].join(','); }) : '-180,-80,180,85';
    const expectedFor = async (m, hours) => {
      const out = {};
      for (const h of hours) {
        const k = `${m}@${h}@${anchor}`;
        if (cache[k] === undefined) {
          const ask = new Date(anchor + h * 3600000).toISOString();
          try { const j = await (await fetch(`http://127.0.0.1:${PORT}/api/weather/grid?model=${m}&domain=marine&layer=${layer}&valid_time=${encodeURIComponent(ask)}&bbox=${box}`)).json();
            const pid = j.product_id || ''; const mm = /(\d{8}T\d{6}Z)/.exec(pid);
            cache[k] = mm ? Date.parse(mm[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : (j.served_valid_time ? Date.parse(j.served_valid_time) : null);
          } catch (e) { cache[k] = null; }
        }
        out[h] = cache[k];
      }
      return out;
    };
    let model = model0;
    for (const tok of PLAN) {
      anchor = await nowAnchor();
      const from = await wheelNow(page);
      let keys = []; let target = from; let to = model; let drag = false;
      if (tok === 'R') { keys = ['ArrowRight']; target = from + 1; }
      else if (tok === 'PU') { keys = ['PageUp']; target = Math.min(336, from + 24); }
      else if (tok === 'PD') { keys = ['PageDown']; target = Math.max(0, from - 24); }
      else if (tok === 'H') { keys = ['Home']; target = 0; }
      else if (tok.startsWith('J:')) { target = +tok.slice(2); keys = keyRun(from, target); }
      else if (tok.startsWith('D:')) { const n = +tok.slice(2); target = Math.min(336, from + n); keys = Array(target - from).fill('ArrowRight'); drag = true; }
      else if (tok === 'M') { if (!others.length) continue; to = others[next++ % others.length]; if (to === model) to = model0; }
      const hours = drag ? Array.from({ length: target - from + 1 }, (_, i) => from + i) : [...new Set([from, target])];
      const expected = await expectedFor(to, hours);
      await page.evaluate((w) => window.__IC__.arm(w), { model: to, layer, target, anchor, expected });
      const ring0 = await page.evaluate(() => Date.now());
      const t0 = Date.now();
      if (tok === 'M') {
        await page.evaluate(() => window.__IC__.go()); await clickExact(page, to); model = to;
      } else {
        await focusWheel(page);
        await page.evaluate(() => window.__IC__.go());
        let h = from;
        for (const k of keys) {
          await page.keyboard.press(k);
          h = k === 'PageUp' ? Math.min(336, h + 24) : k === 'PageDown' ? Math.max(0, h - 24) : k === 'ArrowRight' ? h + 1 : k === 'ArrowLeft' ? h - 1 : 0;
          if (drag) await page.evaluate((x) => window.__IC__.press(x), h);
          await sleep(drag ? DRAG_GAP : 40);
        }
        // the action's clock starts at its LAST key (a far jump's intermediate hours are the drag's, not the jump's)
        await page.evaluate(() => { window.__IC__.w.t0 = performance.now(); window.__IC__.w.exact = null; });
      }
      let r;
      do { await sleep(40); r = await page.evaluate(() => window.__IC__.read()); } while (r.exact == null && Date.now() - t0 < WIN);
      await sleep(500);
      r = await page.evaluate(() => { const x = window.__IC__.read(); window.__IC__.w.done = true; return x; });
      const ring = await page.evaluate((t0) => { const f = window.__RAW_FORENSIC__; const d = f && f.dump ? f.dump() : null;
        return d ? d.events.filter((e) => e.t >= t0 && /clear|commit|reject/.test(e.type)).slice(0, 30).map((e) => { const o = { dt: e.t - t0, type: e.type }; for (const k of ['reason', 'model', 'hour', 'dims', 'lane', 'hadResident', 'residentDims']) if (e[k] !== undefined) o[k] = e[k]; return o; }) : null; }, ring0);
      const status = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null).map((x) => x.textContent.trim()).join(' | ').slice(0, 160));
      const shown = (r.presses || []).filter((p) => p.shown != null).map((p) => p.shown);
      actions.push({ tok, model: to, from, target, exactMs: r.exact == null ? null : Math.round(r.exact), via: r.via, end: r.end, blank: r.blank, blankAt: r.blankAt,
        mislabel: r.mislabel, mislabelSilent: r.mislabelSilent, maxOffH: +(r.maxOffH || 0).toFixed(2), mislabelEx: r.mislabelEx || null, silentEx: r.silentEx || null,
        clears: r.clears && r.clears.length ? r.clears : undefined, frames: r.frames, dims: r.dims.slice(0, 12), status,
        ...(drag ? { drag: { presses: r.presses.length, shown: shown.length, skipped: r.presses.filter((p) => p.skipped).length, late: shown.filter((x) => x > 33).length, maxShown: shown.length ? Math.max(...shown) : null } } : {}),
        ...(tok === 'M' || r.blank ? { ring } : {}) });
      await sleep(300);
    }
    const counters = await page.evaluate(() => { const f = window.__RAW_FRAME_STORE__; const sf = window.__RAW_STATIC_FRAMES__;
      return { store: f ? { shows: f.shows && f.shows.n, misses: f.shows && { ...f.shows.misses }, commits: { ...f.commits }, crop: f.crop && { window: f.crop.window && f.crop.window.key, built: f.crop.built, shows: f.crop.shows }, switches: f.switches } : null,
        sf: sf ? { hits: sf.hits, seriesFrames: sf.seriesFrames, crops: sf.crops, misses: { ...sf.misses } } : null, clears: window.__WEBGL_MARINE_CLEAR_COUNT__ || 0 }; });
    const byPath = {}; for (const q of log.requests) byPath[q.path] = (byPath[q.path] || 0) + 1;
    return { model0, layer, zoom, theme, view: VIEW, arm: arm.name, bundle, idleTwoRafMedian: idle, actions, counters, backend: byPath, errors: log.errors.slice(0, 5) };
  } finally { await browser.close(); }
}

const pct = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const sessions = []; const out = { env: { MODELS, LAYERS, ZOOMS, THEMES, VIEW, CENTER: [CLNG, CLAT], PLAN, ARMS, DRAG_GAP, WIN, SETTLE, CDN_LAT, startedUtc: new Date().toISOString() }, sessions };
  try {
    for (const arm of ARMS) for (const theme of THEMES) for (const layer of LAYERS) for (const zoom of ZOOMS) for (const model0 of MODELS) {
      let s;
      try { s = await session({ model0, layer, zoom, theme, arm }); } catch (e) { s = { model0, layer, zoom, theme, arm: arm.name, error: String(e && e.message || e).slice(0, 300), actions: [] }; }
      sessions.push(s);
      const steps = s.actions.filter((a) => !a.drag);
      const ex = steps.map((a) => a.exactMs);
      console.log(`${arm.name} ${theme} ${layer} z${zoom} ${model0} [${s.bundle || '?'} idle ${s.idleTwoRafMedian}]: p95=${pct(ex, 0.95)} missed=${ex.filter((x) => x == null).length}/${ex.length} blank=${s.actions.reduce((a, x) => a + x.blank, 0)} mislabel=${s.actions.reduce((a, x) => a + x.mislabel, 0)}`,
        JSON.stringify(s.actions.map((a) => [a.tok, a.model, a.target, a.exactMs, a.via, a.blank || undefined, a.mislabel || undefined, a.drag ? `${a.drag.shown}/${a.drag.presses} late${a.drag.late}` : undefined])), s.error || '');
      if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
    }
    const summary = {};
    for (const s of sessions) {
      const k = `${s.arm}|${s.theme}|${s.layer}|z${s.zoom}|${s.model0}`;
      const steps = s.actions.filter((a) => !a.drag); const drags = s.actions.filter((a) => a.drag);
      const ex = steps.map((a) => a.exactMs);
      summary[k] = { step_p50: pct(ex, 0.5), step_p95: pct(ex, 0.95), missed: ex.filter((x) => x == null).length, steps: ex.length,
        blank: s.actions.reduce((a, x) => a + x.blank, 0), mislabel: s.actions.reduce((a, x) => a + x.mislabel, 0), mislabelSilent: s.actions.reduce((a, x) => a + x.mislabelSilent, 0),
        drag_late: drags.reduce((a, x) => a + x.drag.late, 0), drag_shown: drags.reduce((a, x) => a + x.drag.shown, 0), drag_presses: drags.reduce((a, x) => a + x.drag.presses, 0),
        via: steps.reduce((a, x) => { a[x.via || 'none'] = (a[x.via || 'none'] || 0) + 1; return a; }, {}), idle: s.idleTwoRafMedian, error: s.error };
      summary[k].pass = !s.error && summary[k].step_p95 != null && summary[k].step_p95 <= 100 && !summary[k].missed && !summary[k].blank && !summary[k].mislabel && !summary[k].drag_late;
    }
    out.summary = summary;
    console.log(JSON.stringify(summary, null, 1));
  } finally {
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
    cdn.close();
  }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
