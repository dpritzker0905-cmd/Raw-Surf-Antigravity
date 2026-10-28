// EURO WAVES AT ZOOM 9, ONE HOUR AT A TIME (2026-10-27; the lead's live read on dev 89a494aca: at z9 over the Florida east coast
// timeline hours 141-155 read "Loading X… still showing Mon, Nov 2, 4 AM" for good while every /grid answered 200). Offline only.
// Opens the map at z9, turns Waves on, picks EURO, jumps to FROM, then presses ArrowRight once per step to TO, waiting up to STEP_WAIT
// ms per step for the engine to hold a frame within 1.5 h of the selection. Per step: the status line, the drawn record
// (window.__MARINE_DRAWN__), the engine's resident grid, the engine's refusals (no-downgrade stash), the layer's drops, the frame
// store's counters, the marine forensic events, and every /grid and /grid_series ask in the step's window.
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS,EURO --layers waves --land-mask 1 \
//       --regions florida_east_coast --dynamic 1 --euro-regional-estimated-after 42 --port 4371
//   python backend/scripts/publish_frame_images.py --store-dir <store> --out-dir <cdn> --only frames
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3371
//   AB_BASE=http://127.0.0.1:3371 PORT=4371 CDN_DIR=<cdn> OUT=band.json node frontend/scripts/offline-backend/scn_euro_z9_band.js
// Env: FROM (120), TO (160), ZOOM (9), CENTER (-80.4,28.4), STEP_WAIT (4000), SETTLE (6000), CDN_PORT (4372), ARMS (cur | <name>:<FLAG>+...)
// PASS per step: the engine holds a EURO frame whose data time is within 1.5 h of the selection (the 3-hourly lattice's half step).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_euro_z9_band is offline only (never load the live box)');
if (!process.env.AB_BASE) throw Error('AB_BASE=http://127.0.0.1:<the SPA port serving the build under test> is required');
const PORT = +(process.env.PORT || 4371);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4372);
const FROM = +(process.env.FROM || 120);
const TO = +(process.env.TO || 160);
const ZOOM = +(process.env.ZOOM || 9);
const STEP_WAIT = +(process.env.STEP_WAIT || 4000);
const SETTLE = +(process.env.SETTLE || 6000);
const [CLNG, CLAT] = (process.env.CENTER || '-80.4,28.4').split(',').map(Number);
const ARMS = (process.env.ARMS || 'cur').split(',').map((a) => { const [name, flags] = a.split(':'); return { name, flags: flags ? flags.split('+') : [] }; });
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!CDN_DIR) throw Error('CDN_DIR=<published static frames> is required');

const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' }); return res.end('{"statusCode":"404"}');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length,
    'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  return res.end(body);
});

// In the page: what is on screen and why, read in one call.
const READ = () => {
  const e = window.__MARINE_ENGINE__; const d = e && e._waveData; const g = d && d.waveGrid;
  const st = [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null).map((x) => x.textContent.trim()).join(' | ').slice(0, 200);
  const dr = window.__MARINE_DRAWN__ || null;
  const fs_ = window.__RAW_FRAME_STORE__ || null;
  const nd = window.__MARINE_NO_DOWNGRADE__ || null;
  const pend = e && e._pendingDowngrade;
  const ev = (window.__RAW_FORENSIC__ && window.__RAW_FORENSIC__.events) || [];
  return {
    status: st,
    drawn: dr && { validTime: dr.validTime, dataMs: dr.dataMs, estimated: dr.estimated, store: dr.store, hour: dr.hour, runMs: dr.runMs, model: dr.model },
    engine: g ? { hour: g.hourOffset, model: g.__sourceModel || null, served: g.served_valid_time || g.__readoutServedTime || null, valid: g.valid_time,
      pid: (g.productId || g.__servedProductId || '').slice(-60), dims: `${g.cols}x${g.rows}`, series: !!g.__fromSeries, store: !!g.__fromFrameStore,
      est: !!(g.is_estimated || g.isEstimated), lane: g.__commitLane || null } : null,
    pending: pend ? { hour: pend.hourOffset, dims: `${pend.cols}x${pend.rows}`, served: pend.served_valid_time || pend.__readoutServedTime || null } : null,
    noDowngrade: nd ? { count: nd.count, last: nd.last && { why: nd.last.why, hour: nd.last.hour, resident: nd.last.residentDims, rejected: nd.last.rejectedDims } } : null,
    drop: window.__SWELL2_LAST_DROP__ || null,
    uploadReason: window.__WEBGL_MARINE_UPLOAD_REASON__ || null, uploads: window.__WEBGL_MARINE_UPLOAD_COUNT__ || 0,
    storeCommits: fs_ ? fs_.commits : null, storeMisses: fs_ && fs_.shows ? fs_.shows.misses : null, storeShows: fs_ && fs_.shows ? fs_.shows.n : null,
    nEvents: ev.length,
    fallback: !!(window.__WEBGL_GUARDRAIL_FALLBACK__ && window.__WEBGL_GUARDRAIL_FALLBACK__.webglMarineFailed),
    fps: window.__MAP_RENDER_FPS__ == null ? null : window.__MAP_RENDER_FPS__,
    t: Date.now(),
  };
};
const EVENTS_SINCE = (n) => ((window.__RAW_FORENSIC__ && window.__RAW_FORENSIC__.events) || []).slice(n).map((x) => {
  const { t, type, ...rest } = x; return { type, ...Object.fromEntries(Object.entries(rest).slice(0, 8)) };
});

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.evaluate((el) => el.click());
}
const wheelNow = (page) => page.evaluate((sel) => { const w = [...document.querySelectorAll(sel)].find((x) => x.offsetParent); return w ? +w.getAttribute('aria-valuenow') : 0; }, WHEEL);

// LAT_SERIES (ms): every EURO /grid_series answer is held back this long (the live box builds a 16-frame EURO page in seconds, the
// offline backend in well under one); LAT_GRID the same for EURO /grid.
const TRIP_AT = process.env.TRIP_AT ? +process.env.TRIP_AT : null;
// THROTTLE_AT=<hour>: before that step requestAnimationFrame is held to the next whole second for THROTTLE_MS with no input: what
// Chrome does to a window it is not painting (the lead's live tab: rAF 1.1/s, largest interval 1015 ms, visible and focused), with
// cheap frames. The wrapper is installed before the app loads and is off until then.
const THROTTLE_AT = process.env.THROTTLE_AT ? +process.env.THROTTLE_AT : null;
const THROTTLE_MS = +(process.env.THROTTLE_MS || 20000);
// SLOW_DRAW_AT=<hour>: for SLOW_DRAW_MS before that step every marine draw takes SLOW_DRAW_COST ms more and is recorded in the engine's
// histogram as slow (>= 66.6 ms): the renderer itself is the cost (a slow GPU or driver), so the guardrail SHOULD act unless its
// fallback has nothing to draw. LAYER_CHIP (Waves): the marine layer chip to turn on (Swell = swell_1).
const SLOW_DRAW_AT = process.env.SLOW_DRAW_AT ? +process.env.SLOW_DRAW_AT : null;
const SLOW_DRAW_MS = +(process.env.SLOW_DRAW_MS || 16000);
const SLOW_DRAW_COST = +(process.env.SLOW_DRAW_COST || 70);
const LAYER_CHIP = process.env.LAYER_CHIP || 'Waves';
const TRIP_RATE = +(process.env.TRIP_RATE || 20);
const TRIP_HOLD_MS = +(process.env.TRIP_HOLD_MS || 16000);
const TRIP_MODE = process.env.TRIP_MODE || 'busy';            // busy (a rAF-paced main-thread load) | cpu (CDP CPU throttling)
const TRIP_BUSY_MS = +(process.env.TRIP_BUSY_MS || 70);
const LAT_SERIES = +(process.env.LAT_SERIES || 0);
const LAT_GRID = +(process.env.LAT_GRID || 0);
const hooks = { beforeWeather: async (url) => {
  if (String(url.searchParams.get('model') || '').toUpperCase() !== 'EURO') return;
  if (/\/grid_series$/.test(url.pathname) && LAT_SERIES) await sleep(LAT_SERIES);
  else if (/\/grid$/.test(url.pathname) && LAT_GRID) await sleep(LAT_GRID);
} };

async function session(arm) {
  const { browser, page, log } = await L.launch({ port: PORT, hooks });
  await page.addInitScript(() => {
    const raw = window.requestAnimationFrame.bind(window); const rawCancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      if (!window.__AB_RAF_THROTTLE__) return raw(cb);
      const id = setTimeout(() => raw(cb), 1000 - (performance.now() % 1000));
      return -id;
    };
    window.cancelAnimationFrame = (id) => (id < 0 ? clearTimeout(-id) : rawCancel(id));
  });
  await page.addInitScript(({ base, flags }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__'); window.__RAW_STATIC_FRAMES_BASE__ = base;
    localStorage.setItem('raw-surf-theme', 'dark');
    for (const f of flags) window[f] = true;
  }, { base: `http://127.0.0.1:${CDN_PORT}/`, flags: arm.flags });
  const steps = []; let bundle = null;
  try {
    await L.openMap(page); await L.jump(page, CLNG, CLAT, ZOOM);
    bundle = await page.evaluate(() => { const s = [...document.scripts].map((x) => x.src).find((x) => /\/main\.[0-9a-f]+\.js/.test(x)); return s ? s.split('/').pop() : null; });
    await clickExact(page, LAYER_CHIP);
    await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 60000 });
    await clickExact(page, 'EURO');
    await sleep(SETTLE);
    await page.locator(WHEEL).filter({ visible: true }).first().focus();
    // The jump: whole days, then hours (what a wheel drag sends), then a settle so the band starts from a drawn frame.
    const from0 = await wheelNow(page);
    for (let i = 0; i < Math.floor((FROM - from0) / 24); i++) { await page.keyboard.press('PageUp'); await sleep(60); }
    for (let i = 0; i < (FROM - from0) % 24; i++) { await page.keyboard.press('ArrowRight'); await sleep(60); }
    await sleep(SETTLE);
    for (let h = FROM; h <= TO; h++) {
      // TRIP_AT=<hour>: before that step the page's CPU is throttled TRIP_RATE x for TRIP_HOLD_MS with no input, so the render rate
      // falls under the WebGL guardrail's 20 fps for its 12 s (useWebGLGuardrail.js; only on a non-local host name: AB_CHROME_ARGS).
      if (TRIP_AT != null && h === TRIP_AT) {
        if (TRIP_MODE === 'busy') {
          // A slow device's frame: every animation frame spends TRIP_BUSY_MS on the main thread (~12 fps at 70 ms).
          await page.evaluate(({ hold, busy }) => { const end = performance.now() + hold; const f = () => { const t = performance.now(); while (performance.now() - t < busy) { /* busy */ } if (performance.now() < end) requestAnimationFrame(f); }; requestAnimationFrame(f); }, { hold: TRIP_HOLD_MS, busy: TRIP_BUSY_MS });
          await sleep(TRIP_HOLD_MS + 500);
        } else {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: TRIP_RATE });
          await sleep(TRIP_HOLD_MS);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        }
        console.log(`${arm.name} trip at h${h}: ${JSON.stringify(await page.evaluate(() => ({ fb: !!(window.__WEBGL_GUARDRAIL_FALLBACK__ && window.__WEBGL_GUARDRAIL_FALLBACK__.webglMarineFailed), fps: window.__MAP_RENDER_FPS__, mainThread: window.__RAW_GUARDRAIL_MAIN_THREAD__ || null, throttled: window.__RAW_GUARDRAIL_THROTTLED__ || null })))}`);
      }
      if (THROTTLE_AT != null && h === THROTTLE_AT) {
        await page.evaluate(() => { window.__AB_RAF_THROTTLE__ = true; });
        await sleep(THROTTLE_MS);
        const th = await page.evaluate(() => { window.__AB_RAF_THROTTLE__ = false; return { fb: !!(window.__WEBGL_GUARDRAIL_FALLBACK__ && window.__WEBGL_GUARDRAIL_FALLBACK__.webglMarineFailed), fps: window.__MAP_RENDER_FPS__, throttled: window.__RAW_GUARDRAIL_THROTTLED__ || null }; });
        console.log(`${arm.name} throttled ${THROTTLE_MS} ms at h${h}: ${JSON.stringify(th)}`);
      }
      if (SLOW_DRAW_AT != null && h === SLOW_DRAW_AT) {
        await page.evaluate(({ cost }) => {
          const e = window.__MARINE_ENGINE__;
          const wrap = (name) => { const orig = e[name]; e[`__ab_${name}`] = orig; e[name] = function slowDraw(...a) {
            const t = performance.now(); while (performance.now() - t < cost) { /* the draw's own cost */ }
            const h = window.__RAW_GPU__ && window.__RAW_GPU__.frameTimeHistogram; const before = h ? h.slice() : null;
            const out = orig.apply(this, a);
            if (h && before) { const i = h.findIndex((v, k) => v > before[k]); if (i >= 0 && i !== 4) { h[i] -= 1; h[4] += 1; } }
            return out;
          }; };
          ['render', 'renderHeatmapAndParticles'].forEach(wrap);
        }, { cost: SLOW_DRAW_COST });
        await sleep(SLOW_DRAW_MS);
        const sd = await page.evaluate(() => {
          const e = window.__MARINE_ENGINE__; if (e) ['render', 'renderHeatmapAndParticles'].forEach((n) => { if (e[`__ab_${n}`]) e[n] = e[`__ab_${n}`]; });
          return { fb: !!(window.__WEBGL_GUARDRAIL_FALLBACK__ && window.__WEBGL_GUARDRAIL_FALLBACK__.webglMarineFailed), fps: window.__MAP_RENDER_FPS__,
            noFallback: window.__RAW_GUARDRAIL_NO_FALLBACK__ || null, mainThread: window.__RAW_GUARDRAIL_MAIN_THREAD__ || null, hist: window.__RAW_GPU__ && window.__RAW_GPU__.frameTimeHistogram };
        });
        console.log(`${arm.name} slow draws ${SLOW_DRAW_MS} ms at h${h}: ${JSON.stringify(sd)}`);
      }
      if (h > FROM) await page.keyboard.press('ArrowRight');
      const t0 = Date.now(); const nReq0 = log.requests.length;
      const anchor = await page.evaluate(() => Math.round(Date.now() / 3600000) * 3600000);
      const selMs = anchor + h * 3600000;
      const nEv0 = (await page.evaluate(READ)).nEvents;
      let r = null; let okAt = null;
      while (Date.now() - t0 < STEP_WAIT) {
        r = await page.evaluate(READ);
        const dm = r.drawn && r.drawn.dataMs;
        if (okAt == null && r.engine && r.engine.model === 'EURO' && dm && Math.abs(dm - selMs) <= 1.5 * 3600000 && r.engine.hour === h) okAt = Date.now() - t0;
        if (okAt != null && Date.now() - t0 > okAt + 300) break;
        await sleep(50);
      }
      const wheel = await wheelNow(page);
      const reqs = log.requests.slice(nReq0).filter((x) => /grid/.test(x.path || '')).map((x) => ({ path: x.path, vt: x.q && x.q.valid_time, model: x.q && x.q.model,
        hours: x.q && (x.q.hours || x.q.hour_offsets || '').slice(0, 40), status: x.status, ms: x.ms, err: x.error }));
      const events = (await page.evaluate(EVENTS_SINCE, nEv0)).filter((x) => !/^(series_|sib_)/.test(x.type)).slice(-12);
      steps.push({ h, wheel, sel: new Date(selMs).toISOString().slice(5, 16), okMs: okAt, pass: okAt != null, ...r,
        drawnVt: r && r.drawn && r.drawn.validTime ? String(r.drawn.validTime).slice(5, 16) : null, reqs, events });
      const s = steps[steps.length - 1];
      const ms = s.storeMisses || {};
      console.log(`${arm.name} h${h} sel ${s.sel} ${s.pass ? `OK ${okAt}ms` : 'STUCK'} fb=${s.fallback} drawn ${s.drawnVt} eng h${s.engine && s.engine.hour} ${s.engine && s.engine.dims} misses crop_only_set=${ms.crop_only_set || 0} no_target=${ms.no_target || 0} commits.no_served_time=${(s.storeCommits || {}).no_served_time || 0} | ${s.status.replace(/^.*unaffected\. \| /, '').slice(0, 80)} | reqs ${reqs.map((q) => `${q.path}@${(q.vt || '').slice(5, 13)}:${q.status}`).join(' ')}`);
    }
  } finally {
    await browser.close();
  }
  return { arm: arm.name, flags: arm.flags, bundle, steps, stuck: steps.filter((s) => !s.pass).map((s) => s.h) };
}

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const ident = await new Promise((resolve) => http.get(`http://127.0.0.1:${PORT}/__harness/identity`, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(b)); }).on('error', () => resolve(null)));
  console.log('backend', ident);
  const out = { started: new Date().toISOString(), backend: ident && JSON.parse(ident), from: FROM, to: TO, zoom: ZOOM, center: [CLNG, CLAT], arms: [] };
  for (const arm of ARMS) {
    const res = await session(arm);
    out.arms.push(res);
    console.log(`${arm.name}: bundle ${res.bundle} stuck ${res.stuck.length} of ${TO - FROM + 1}: ${res.stuck.join(',')}`);
  }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
  cdn.close();
})().catch((e) => { console.error(e); process.exit(1); });
