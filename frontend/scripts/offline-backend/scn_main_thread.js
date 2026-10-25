// MAIN-THREAD JANK on the scrub, offline (2026-10-23; the lead's live trace of dev on the owner's 844 x 390 window found 23 frames
// over 50 ms in 144 s, a 213 ms first keydown, and the render-hour record naming the PREVIOUS hour for 206-467 ms on exact frame
// hours). Replays that flow: zoom 3.9 at (-79.5, 28.6), Waves on, the run in the store, 10 ArrowRight steps, PageDown, a zoom out
// to 1.9 and back. One session per arm (a kill-switch set from ONE build), in a fresh browser.
// Per step and per window it records, all in the page's clock:
//   - every Long Animation Frame (>= 50 ms) with its top scripts, and the keydown's Event Timing (input -> next paint);
//   - every engine call that can block a frame: setWaveData, _captureCoarseBase (who called it, ms, whether the shared world mask
//     was REUSED or re-RASTERIZED, the texture bytes uploaded inside it), renderHeatmapAndParticles, bridgeToCoarseGlobalIfHeld;
//   - per rendered frame: MapLibre's whole _render ms, the engine render ms, getUniformLocation calls and texImage2D/texSubImage2D
//     calls; an IDLE window (no input, ~6 s) gives the always-on loop's cost;
//   - SCREEN READ-BACK (READBACK=1 only): after every rendered frame for 1.5 s after each key, the median colour of 48 patches of the framebuffer
//     (read in MapLibre's own 'render' event, before compositing). Node classifies each frame against the settled frames of the
//     new and the previous hour: is the PREVIOUS hour still on screen, and for how long? Alongside: what the engine holds
//     (hour, frame store or not, product) and the render-hour parity record, so a lagging RECORD is told apart from stale PIXELS.
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS --dynamic 1 --port 4120
//   python backend/scripts/publish_frame_images.py --store-dir <store> --out-dir <cdn> --only frames
//   node frontend/scripts/offline-backend/serve_spa.js frontend/build 3120
//   AB_BASE=http://127.0.0.1:3120 CDN_DIR=<cdn> PORT=4120 ARMS=cur OUT=jank.json node frontend/scripts/offline-backend/scn_main_thread.js
// Env: ARMS (comma list; an arm is a name plus '+'-joined window flags set true before boot, e.g. 'cur,nobase:__RAW_X__'),
// CDN_LAT (ms per static object, 0), CDN_PORT (4194), FILL_WAIT (ms for the run to land in the store, 45000), STEP_GAP (ms, 1500),
// IDLE_MS (6000), VIEW (owner = 844 x 390 at dpr 2; desktop = 1280 x 800), ZOOM (3.9), CENTER (-79.5,28.6), ZOOM_OUT (1.9).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_main_thread is offline only');
const PORT = +(process.env.PORT || 4120);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4194);
const CDN_LAT = +(process.env.CDN_LAT || 0);
const FILL_WAIT = +(process.env.FILL_WAIT || 45000);
const STEP_GAP = +(process.env.STEP_GAP || 1500);
const IDLE_MS = +(process.env.IDLE_MS || 6000);
const VIEW = process.env.VIEW || 'owner';
// READBACK=1: the screen read-back (correctness run). It syncs the GPU every frame, so a READBACK run's frame times are NOT timings.
const READBACK = process.env.READBACK === '1';
// SEED_STEPS=2,5,9: 150 ms after those keys, stage a coarse-base SEED the way prewarmGlobalMarineGrid does, but with the /grid
// REQUEST box (north 85) and an older hour: the live alternation of two world bounds boxes (static frames say north 84).
const SEED_STEPS = (process.env.SEED_STEPS || '').split(',').filter(Boolean).map(Number);
const ZOOM = +(process.env.ZOOM || 3.9);
const ZOOM_OUT = +(process.env.ZOOM_OUT || 1.9);
const [CLNG, CLAT] = (process.env.CENTER || '-79.5,28.6').split(',').map(Number);
const ARMS = (process.env.ARMS || 'cur').split(',').map((a) => { const [name, flags] = a.split(':'); return { name, flags: flags ? flags.split('+') : [] }; });
if (!CDN_DIR) throw Error('CDN_DIR=<publisher --out-dir> is required');
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  const send = () => {
    const cors = { 'access-control-allow-origin': '*' };
    if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(400, { ...cors, 'content-type': 'application/json' }); return res.end('{"statusCode":"404","error":"not_found"}');
    }
    const body = fs.readFileSync(file);
    res.writeHead(200, { ...cors, 'content-length': body.length, 'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json',
      'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(body);
  };
  CDN_LAT ? setTimeout(send, CDN_LAT) : send();
});

// ---- the in-page instruments (installed before the app's code) ----
const PROBE = ({ readback }) => {
  const P = (window.__JK__ = { readback, loaf: [], lt: [], ev: [], calls: [], frames: [], keys: [], watch: null, ctx: [], counts: {}, engines: 0, gl: { ul: 0, ulMs: 0, tex: 0, texMs: 0, texBytes: 0 } });
  const now = () => performance.now();
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) {
      P.loaf.push({ t: e.startTime, d: e.duration, b: e.blockingDuration || 0,
        s: Array.from(e.scripts || []).sort((a, c) => c.duration - a.duration).slice(0, 3).map((x) => ({
          f: String(x.sourceURL || '').split('/').pop().split('?')[0].slice(0, 50), fn: String(x.sourceFunctionName || '').slice(0, 50),
          inv: String(x.invoker || '').slice(0, 60), d: Math.round(x.duration) })) });
    } }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) { /* no LoAF */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lt.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* none */ }
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'keydown') {
      P.ev.push({ t: e.startTime, d: e.duration, proc: e.processingEnd - e.processingStart, delay: e.processingStart - e.startTime });
    } }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch (e) { /* none */ }
  window.addEventListener('keydown', (e) => { P.keys.push({ t: e.timeStamp, key: e.key }); }, true);
  // WebGL: uniform lookups and texture uploads (count, ms, bytes) — what a frame and a capture pay.
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    const ul = C.prototype.getUniformLocation;
    C.prototype.getUniformLocation = function (...a) { const t = now(); try { return ul.apply(this, a); } finally { P.gl.ul += 1; P.gl.ulMs += now() - t; } };
    for (const name of ['texImage2D', 'texSubImage2D']) {
      const f = C.prototype[name];
      C.prototype[name] = function (...a) {
        const t = now();
        try { return f.apply(this, a); } finally {
          P.gl.tex += 1; P.gl.texMs += now() - t;
          const src = a[a.length - 1];
          const w = typeof a[3] === 'number' && name === 'texImage2D' && a.length >= 9 ? a[3] : (src && src.width) || 0;
          const h = typeof a[4] === 'number' && name === 'texImage2D' && a.length >= 9 ? a[4] : (src && src.height) || 0;
          P.gl.texBytes += w * h * 4;
          if (P.ctx.length) P.ctx[P.ctx.length - 1].tex.push({ fn: name, w, h, ms: +(now() - t).toFixed(2) });
        }
      };
    }
  }
  const glOf = () => { const m = window.__MAP_INSTANCE__ || window.map; return m && m.painter && m.painter.context && m.painter.context.gl; };
  // Engine methods: wrapped on the INSTANCE once it exists (calls through `this.` resolve to the wrapper).
  const wrapEngine = (eng) => {
    const wrap = (name, ctxOf) => {
      const orig = eng[name];
      if (typeof orig !== 'function' || orig.__jk) return;
      if (name === 'setWaveData') P.engines += 1;
      const w = function (...a) {
        P.counts[name] = (P.counts[name] || 0) + 1;
        // READBACK runs freeze the ANIMATION (the engine's clock pinned, crests not advected or respawned) so that only DATA moves a pixel.
        if (P.readback && name === 'render') { this._startTime = Date.now() - 1000; this.speedFactor = 0; this.dropRate = 0; }
        const c = { name, t: now(), parent: P.ctx.length ? P.ctx[P.ctx.length - 1].name : null, tex: [], ...(ctxOf ? ctxOf.call(this, a) : {}) };
        P.ctx.push(c);
        try { return orig.apply(this, a); } finally {
          P.ctx.pop(); c.ms = now() - c.t;
          if (name === 'setWaveData') c.maskMode = this._lastMaskEncodeMode || null;
          if (name === 'refreshMaskWithBasemapWater') { c.reason = this._lastMaskRepatchReason || null; c.maskMode = this._lastMaskEncodeMode || null; c.deliv = this._maskDeliveredState ? { short: this._maskDeliveredState.deliveredShort, force: this._maskDeliveredState.forceRepaint } : null;
            const mb = this._cachedMaskBounds; c.maskBounds = mb ? [mb.west, mb.south, mb.east, mb.north].map((x) => +(+x).toFixed(3)) : null; }
          if (name === '_captureCoarseBase') {
            const mask = this._coarseBaseData && this._coarseBaseData.u_oceanMaskTexture;
            c.maskReused = !!(mask && c.priorMasks.includes(mask));
            c.captured = this._coarseBaseData !== c.priorBase;
            delete c.priorMasks; delete c.priorBase;
          }
          if ((name !== 'render' && name !== 'refreshMaskWithBasemapWater') || c.ms >= 4) P.calls.push(c);
          else P.renderSmall = (P.renderSmall || 0) + 1;
          P.renderMs = (P.renderMs || 0) + (name === 'render' ? c.ms : 0);
        }
      };
      w.__jk = true;
      eng[name] = w;
    };
    wrap('setWaveData', function (a) { const g = a.find((x) => x && typeof x === 'object' && (Array.isArray(x.vectors) || x.bounds)) || null; /* (gl, waveGrid, ...) */ return { hour: g && g.hourOffset, cols: g && g.cols, rows: g && g.rows, store: !!(g && g.__fromFrameStore),
      series: !!(g && g.__fromSeries), bounds: g && g.bounds ? [g.bounds.west, g.bounds.south, g.bounds.east, g.bounds.north].map((x) => +(+x).toFixed(3)) : null, lane: g && g.__commitLane || null }; });
    wrap('refreshMaskWithBasemapWater', function () {
      const r3 = (o) => (o ? [o.west, o.south, o.east, o.north].map((x) => +(+x).toFixed(4)) : null);
      const rp = this._regionalPatchState; let view = null;
      try { const m = window.__MAP_INSTANCE__ || window.map; const b = m.getBounds(); view = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((x) => +x.toFixed(4)); } catch (e) { view = null; }
      return { rpBefore: rp ? { gridKey: rp.gridKey, box: r3(rp.box), degraded: rp.degraded, z: rp.z } : null, view, forcedFor: this._maskDeliveredForcedFor || null };
    });
    wrap('_captureCoarseBase', function (a) {
      const g = a[1]; const lru = this._coarseBaseLru ? [...this._coarseBaseLru.values()] : [];
      return { hour: g && g.hourOffset, cols: g && g.cols, rows: g && g.rows, bounds: g && g.bounds ? [g.bounds.west, g.bounds.south, g.bounds.east, g.bounds.north] : null,
        store: !!(g && g.__fromFrameStore), series: !!(g && g.__fromSeries), lruSize: lru.length,
        priorMasks: lru.map((b) => b && b.u_oceanMaskTexture).filter(Boolean), priorBase: this._coarseBaseData };
    });
    wrap('render');   // the layer calls engine.render (= prototype.renderHeatmapAndParticles, an alias)
    wrap('bridgeToCoarseGlobalIfHeld');
  };
  const hookMap = (m) => {
    if (m.__jk) return; m.__jk = true;
    const r = m._render;
    if (typeof r === 'function') {
      m._render = function (...a) {
        const t = now(); const ul0 = P.gl.ul; const tex0 = P.gl.tex; const rm0 = P.renderMs || 0;
        try { return r.apply(this, a); } finally {
          P.frames.push([Math.round(t * 10) / 10, +(now() - t).toFixed(2), P.gl.ul - ul0, P.gl.tex - tex0, +((P.renderMs || 0) - rm0).toFixed(2)]);
          if (P.frames.length > 40000) P.frames.splice(0, 10000);
        }
      };
    }
    // SCREEN READ-BACK in the frame's own task (the drawing buffer is still valid): 12 patches, median colour each.
    m.on('render', () => {
      const W = P.watch; if (!W || !P.readback) return;
      const gl = glOf(); if (!gl) return;
      const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight, S = 12; const px = new Uint8Array(S * S * 4);
      const W2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      const prev = gl.getParameter(W2 ? gl.READ_FRAMEBUFFER_BINDING : gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(W2 ? gl.READ_FRAMEBUFFER : gl.FRAMEBUFFER, null);
      const patches = [];
      for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) {
        const x = Math.round(cw * (i + 0.5) / 8 - S / 2), y = Math.round(ch * (j + 0.5) / 6 - S / 2);
        gl.readPixels(x, y, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const med = [0, 1, 2].map((k) => { const v = []; for (let q = k; q < px.length; q += 4) v.push(px[q]); v.sort((a, b) => a - b); return v[v.length >> 1]; });
        patches.push(med);
      }
      gl.bindFramebuffer(W2 ? gl.READ_FRAMEBUFFER : gl.FRAMEBUFFER, prev);
      const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid;
      const par = window.__MARINE_RENDER_HOUR_PARITY__ || {};
      W.rows.push({ t: now(), patches, hour: g ? g.hourOffset : null, store: !!(g && g.__fromFrameStore), pid: g ? String(g.__servedProductId || g.productId || '').slice(-24) : null,
        parReq: par.requestedHour, parRen: par.renderedDataHour, parity: par.parity, reason: par.reason, base: e && e._coarseBaseData && e._coarseBaseData.waveGrid ? e._coarseBaseData.waveGrid.hourOffset : null });
      if (W.rows.length > 400) P.watch = null;
    });
  };
  const poll = setInterval(() => {
    const e = window.__MARINE_ENGINE__; if (e) wrapEngine(e);
    const m = window.__MAP_INSTANCE__ || window.map; if (m) hookMap(m);
  }, 25);
  P.stop = () => clearInterval(poll);
};

async function clickExact(page, text) {
  const clicked = await page.waitForFunction((t) => {
    const b = [...document.querySelectorAll('button,[role="button"]')].find((x) => x.textContent.trim() === t && x.offsetParent !== null);
    if (b) b.click();
    return !!b;
  }, text, { timeout: 15000 });
  if (!(await clicked.jsonValue())) throw Error(`no ${text} control`);
}

const window_ = (P, a, b) => ({
  loaf: P.loaf.filter((x) => x.t >= a && x.t < b), lt: P.lt.filter((x) => x.t >= a && x.t < b),
  calls: P.calls.filter((x) => x.t >= a && x.t < b), frames: P.frames.filter((x) => x[0] >= a && x[0] < b),
  ev: P.ev.filter((x) => x.t >= a - 2 && x.t < b),
});

async function session(arm) {
  const dims = VIEW === 'owner' ? { width: 844, height: 390, dpr: 2 } : {};
  const { browser, page, log } = await L.launch({ port: PORT, hashTextureUploads: false, ...dims });
  await page.addInitScript(({ base, flags }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__'); window.__RAW_STATIC_FRAMES_BASE__ = base;
    localStorage.setItem('raw-surf-theme', 'dark');
    for (const f of flags) window[f] = true;
  }, { base: `http://127.0.0.1:${CDN_PORT}/`, flags: arm.flags });
  await page.addInitScript(PROBE, { readback: READBACK });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 200)));
  const steps = [];
  try {
    await L.openMap(page); await L.jump(page, CLNG, CLAT, ZOOM);
    await clickExact(page, 'Waves');
    await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 60000 });
    const t0 = Date.now();
    for (;;) {   // the run in the store (the live trace had 115 frames resident)
      await sleep(500);
      const st = await page.evaluate(() => { const t = window.__RAW_FRAME_STORE__; const s = t && (t.sets || []).find((x) => /GFS\/marine\/waves/.test(x.key)); return s ? { resident: s.resident, frames: s.frames } : null; });
      if ((st && st.frames && st.resident >= st.frames) || Date.now() - t0 > FILL_WAIT) { steps.push({ kind: 'fill', ms: Date.now() - t0, store: st }); break; }
    }
    await sleep(2000);
    // IDLE: no input; the always-on render loop alone.
    const i0 = await page.evaluate(() => performance.now()); await sleep(IDLE_MS); const i1 = await page.evaluate(() => performance.now());
    const idle = await page.evaluate(({ a, b }) => { const P = window.__JK__; const f = P.frames.filter((x) => x[0] >= a && x[0] < b);
      return { ms: b - a, frames: f.length, renderMs: f.reduce((s, x) => s + x[1], 0), engineMs: f.reduce((s, x) => s + x[4], 0), ul: f.reduce((s, x) => s + x[2], 0),
        tex: f.reduce((s, x) => s + x[3], 0), loaf: P.loaf.filter((x) => x.t >= a && x.t < b).map((x) => Math.round(x.d)) }; }, { a: i0, b: i1 });
    const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
    const plan = [...Array(10).fill('ArrowRight'), 'PageDown', 'ZOOM_OUT', 'ZOOM_IN'];
    for (const step of plan) {
      const hourBefore = +(await page.evaluate((sel) => { const w = [...document.querySelectorAll(sel)].find((x) => x.offsetParent); return w ? w.getAttribute('aria-valuenow') : 0; }, WHEEL));
      const a = await page.evaluate(() => { window.__JK__.watch = { rows: [] }; return performance.now(); });
      if (step === 'ZOOM_OUT' || step === 'ZOOM_IN') {
        await page.evaluate((z) => { const m = window.__MAP_INSTANCE__ || window.map; m.easeTo({ zoom: z, duration: 400 }); }, step === 'ZOOM_OUT' ? ZOOM_OUT : ZOOM);
        await sleep(3000);
      } else {
        await page.keyboard.press(step);
        if (SEED_STEPS.includes(steps.length - 1)) {
          await sleep(150);
          await page.evaluate(() => { const e = window.__MARINE_ENGINE__; const b = e && e._coarseBaseData && e._coarseBaseData.waveGrid; if (!b) return;
            e._pendingCoarseBaseGrid = { ...b, bounds: { ...b.bounds, north: 85 }, hourOffset: (b.hourOffset || 0) - 3,
              valid_time: new Date(Date.parse(b.valid_time) - 3 * 3600000).toISOString(), __fromSeries: false }; });
          await sleep(STEP_GAP - 150);
        } else await sleep(STEP_GAP);
      }
      const b = await page.evaluate(() => performance.now());
      const hourAfter = +(await page.evaluate((sel) => { const w = [...document.querySelectorAll(sel)].find((x) => x.offsetParent); return w ? w.getAttribute('aria-valuenow') : 0; }, WHEEL));
      const rec = await page.evaluate(({ a, b }) => { const P = window.__JK__; const W = P.watch; P.watch = null;
        const pick = (arr, f) => arr.filter(f);
        return { a, b, key: P.keys.filter((k) => k.t >= a - 5 && k.t < b).map((k) => k.t)[0] || null,
          loaf: pick(P.loaf, (x) => x.t >= a && x.t < b), lt: pick(P.lt, (x) => x.t >= a && x.t < b), ev: pick(P.ev, (x) => x.t >= a - 2 && x.t < b),
          calls: pick(P.calls, (x) => x.t >= a && x.t < b), frames: pick(P.frames, (x) => x[0] >= a && x[0] < b), read: W ? W.rows : [] }; }, { a, b });
      steps.push({ kind: step, hourBefore, hourAfter, ...rec });
    }
    const store = await page.evaluate(() => { const t = window.__RAW_FRAME_STORE__; return t ? { shows: t.shows, commits: t.commits, gpu: t.gpu, crop: t.crop } : null; });
    const phases = await page.evaluate(() => { const c = window.__RAW_GPU__ && window.__RAW_GPU__.cpuPhaseTiming; if (!c || !c.buckets) return null; const o = {};
      for (const [k, b] of Object.entries(c.buckets)) if (b && b.calls) o[k] = { calls: b.calls, ms: Math.round(b.totalDurationMs), hist: b.histogram }; return o; });
    const counts = await page.evaluate(() => ({ counts: window.__JK__.counts, engines: window.__JK__.engines, renderSmall: window.__JK__.renderSmall || 0 }));
    const gpuMaskCache = await page.evaluate(() => (window.__RAW_GPU__ && window.__RAW_GPU__.coarseMaskCache) || null);
    const backend = {}; for (const q of log.requests) backend[q.path] = (backend[q.path] || 0) + 1;
    return { arm: arm.name, flags: arm.flags, idle, steps, store, backend, counts, gpuMaskCache, phases, requests: log.requests.map((q) => ({ t: q.t, path: q.path, ms: q.ms, layer: q.q && q.q.layer, hours: q.q && q.q.hours, bbox: q.q && q.q.bbox })).slice(-300), errors: [...errors, ...log.errors.slice(0, 5)] };
  } finally { await browser.close(); }
}

// Is the previous hour still on screen? Each read-back frame against the settled frames of the new hour (this step's last 400 ms)
// and of the previous hour (the previous step's last 400 ms); only patches that differ between the two hours vote.
function staleness(steps) {
  const settled = (s) => {
    const rows = s.read.filter((r) => r.t >= s.b - 400 - 0 && r.t < s.b);
    if (!rows.length) return null;
    return rows[0].patches.map((_, i) => [0, 1, 2].map((k) => { const v = rows.map((r) => r.patches[i][k]).sort((x, y) => x - y); return v[v.length >> 1]; }));
  };
  const out = [];
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i]; const p = steps[i - 1];
    if (!s.read || !s.read.length || !p.read || !p.read.length || !String(s.kind).startsWith('Arrow') && s.kind !== 'PageDown') continue;
    const refNew = settled(s), refOld = settled(p);
    if (!refNew || !refOld) continue;
    const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const vote = refNew.map((v, j) => dist(v, refOld[j]) >= 12);
    const n = vote.filter(Boolean).length;
    const t0 = s.key || s.a;
    const frames = s.read.map((r) => {
      let dn = 0, dold = 0;
      r.patches.forEach((v, j) => { if (vote[j]) { dn += dist(v, refNew[j]); dold += dist(v, refOld[j]); } });
      return { dt: Math.round(r.t - t0), cls: n === 0 ? 'same' : dn < dold * 0.5 ? 'new' : dold < dn * 0.5 ? 'old' : 'mixed', engineHour: r.hour, store: r.store,
        parity: r.parity, reason: r.reason, base: r.base };
    });
    const firstNew = frames.find((f) => f.cls === 'new');
    const oldAfterKey = frames.filter((f) => f.cls === 'old' && f.dt >= 17);
    out.push({ step: i, kind: s.kind, from: s.hourBefore, to: s.hourAfter, votingPatches: n, firstNewMs: firstNew ? firstNew.dt : null,
      oldFramesAfterKey: oldAfterKey.length, lastOldMs: oldAfterKey.length ? oldAfterKey[oldAfterKey.length - 1].dt : null,
      mixed: frames.filter((f) => f.cls === 'mixed').length,
      parityFalseUntilMs: (() => { const f = frames.filter((x) => x.parity === false); return f.length ? f[f.length - 1].dt : null; })(),
      reasons: [...new Set(frames.filter((x) => x.parity === false).map((x) => x.reason))] });
  }
  return out;
}

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const results = [];
  try {
    for (const arm of ARMS) {
      const s = await session(arm);
      s.stale = staleness(s.steps);
      results.push(s);
      const keySteps = s.steps.filter((x) => x.kind === 'ArrowRight' || x.kind === 'PageDown');
      const zoomSteps = s.steps.filter((x) => String(x.kind).startsWith('ZOOM'));
      const loafs = (arr) => arr.flatMap((x) => (x.loaf || []).map((l) => Math.round(l.d)));
      const caps = s.steps.flatMap((x) => (x.calls || []).filter((c) => c.name === '_captureCoarseBase'));
      console.log(`== ${arm.name} [${arm.flags.join(' ') || 'defaults'}]  idle: ${s.idle.frames} frames in ${Math.round(s.idle.ms)} ms, MapLibre _render ${Math.round(s.idle.renderMs)} ms`
        + ` (${(100 * s.idle.renderMs / s.idle.ms).toFixed(1)}% of wall), engine ${Math.round(s.idle.engineMs)} ms, getUniformLocation ${s.idle.ul} (${(s.idle.ul / Math.max(1, s.idle.frames)).toFixed(1)}/frame), loaf ${JSON.stringify(s.idle.loaf)}`);
      console.log(`   keys: event-timing ms ${JSON.stringify(keySteps.map((x) => (x.ev[0] ? Math.round(x.ev[0].d) : null)))} | LoAF>=50 per step ${JSON.stringify(keySteps.map((x) => x.loaf.map((l) => Math.round(l.d))))}`);
      console.log(`   zoom: LoAF ${JSON.stringify(zoomSteps.map((x) => x.loaf.map((l) => Math.round(l.d))))} | all LoAF over 50: ${loafs(s.steps).filter((d) => d >= 50).length}, max ${Math.max(0, ...loafs(s.steps))}`);
      const rast = caps.filter((c) => !c.maskReused).length;
      console.log(`   rasterized masks in steps: ${rast} | coarseMaskCache ${JSON.stringify(s.gpuMaskCache)}`);
      console.log(`   _captureCoarseBase: ${caps.length} calls, ms ${JSON.stringify(caps.map((c) => Math.round(c.ms)))}, parent ${JSON.stringify(caps.map((c) => c.parent))}, maskReused ${JSON.stringify(caps.map((c) => c.maskReused))}, store ${JSON.stringify(caps.map((c) => c.store))}`);
      for (const st of s.stale) console.log(`   stale? ${st.kind} ${st.from}->${st.to}: voting ${st.votingPatches}, first new ${st.firstNewMs} ms, old frames after key ${st.oldFramesAfterKey} (last ${st.lastOldMs} ms), mixed ${st.mixed}, parity false until ${st.parityFalseUntilMs} ms ${JSON.stringify(st.reasons)}`);
      console.log(`   backend ${JSON.stringify(s.backend)} | engine calls ${JSON.stringify(s.counts)} | store ${JSON.stringify(s.store && { shows: s.store.shows && s.store.shows.n, commits: s.store.commits })} | errors ${s.errors.length} ${JSON.stringify(s.errors.slice(0, 2))}`);
    }
  } finally { cdn.close(); }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ env: { VIEW, ZOOM, CLNG, CLAT, STEP_GAP, CDN_LAT }, results }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
