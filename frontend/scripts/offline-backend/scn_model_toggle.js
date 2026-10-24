// INSTANT MODEL TOGGLES (Stage A of the GPU-resident frames, 2026-10-22). Offline only. One build, two arms interleaved per round:
//   on   the default: at a model click the new model's stored frame (a warm frame the prefetch keeps for the other published waves
//        sets, shown with its own chl/bath) goes on screen at once; the coalesced fetch still commits it;
//   off  window.__RAW_DISABLE_FRAME_MODEL_TOGGLE__ = true: today's switch (the 350 ms coalescing window, then the fetch).
// Per click: ms from the click to the EXACT-CORRECT frame of the new model on the GPU (its model, the product /grid serves for that
// model and hour, full resolution), whether the frame store put it there, frames drawn until then, wrong-model frames the status
// line did NOT admit (silent) and did, frames where the map already shows the new model but the line still says it is loading
// (label lag), and one wheel step on the new model right after (it must take the resident path). Arm `on` also reads the resident
// wave, chlorophyll and bathymetry textures back at the store's show and again after the normal commit of the same product: all
// three must be equal (the show's exact chl/bath ARE what the encoder uploads, in the running app).
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS,ICON,EURO --port 4100
//   python backend/scripts/publish_frame_images.py --store-dir <store> --out-dir <cdn> --only frames   (#453's publisher: 3 waves sets)
//   node frontend/scripts/offline-backend/serve_spa.js frontend/build 3100
//   CDN_DIR=<cdn> PORT=4100 CDN_LAT=340 ARMS=on,off ROUNDS=2 OUT=toggle.json node frontend/scripts/offline-backend/scn_model_toggle.js
// Env: ROUNDS (2), ARMS (on,off; also on-light, on-beach, on-handheld), WIN (ms per click, 8000), CDN_LAT (ms per static object),
// CDN_PORT (4192), WARM_WAIT (ms to wait for the warm frames' chl/bath before the first click, 20000).
// MID ZOOM (2026-10-22, #458 on #459): ZOOM (3.2 = the world view), CENTER (lng,lat; -80,24), VIEW (desktop = 1280 x 800; owner =
// 844 x 390 at dpr 2), MIN_COLS (the exact frame's least width: 150 for a world frame; 10 for a mid-zoom clip). Run the backend with
// --dynamic 1 so a zoomed-in view commits its own clip.
// WAVE LAKES (2026-10-23, waveLakes.js): PLAN (comma list of models / WHEEL:<key>, e.g. EURO,GFS,EURO,GFS) replaces the default
// plan; an arm ending -nolakes sets __RAW_DISABLE_WAVE_LAKES__ (the build before lakes). Per click: litLake (drawn frames where a
// non-lake model's data sat under a mask with lakes cut in; must be 0), the CPU phases (maskBaseCanvas, maskWaterPaint, maskUpload,
// waveDataUpdate = setWaveData with its mask encode, regionalMaskRefresh: calls and ms) between the click and the exact frame, i.e.
// ON the toggle's critical path, and the engine's mask encode mode at the exact frame. Per session: litLake total.
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_model_toggle is offline only');
const PORT = +(process.env.PORT || 4100);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4192);
const ROUNDS = +(process.env.ROUNDS || 2);
const WIN = +(process.env.WIN || 8000);
const CDN_LAT = +(process.env.CDN_LAT || 0);
const WARM_WAIT = +(process.env.WARM_WAIT || 20000);
const ZOOM = +(process.env.ZOOM || 3.2);
const [CLNG, CLAT] = (process.env.CENTER || '-80,24').split(',').map(Number);
const VIEW = process.env.VIEW || 'desktop';
const MIN_COLS = +(process.env.MIN_COLS || 150);
if (!CDN_DIR) throw Error('CDN_DIR=<publisher --out-dir> is required');
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Clicks at the opening hour, then after a day's step, then far out (EURO turns 6-hourly past 144 h).
const PLAN = process.env.PLAN ? process.env.PLAN.split(',').map((x) => (x.startsWith('WHEEL:') ? ['WHEEL', x.slice(6)] : [x])) : [['ICON'], ['EURO'], ['GFS'], ['WHEEL', 'PageUp'], ['EURO'], ['ICON'], ['GFS'], ['WHEEL', 'PageUp'], ['WHEEL', 'PageUp'],
  ['WHEEL', 'PageUp'], ['WHEEL', 'PageUp'], ['WHEEL', 'PageUp'], ['WHEEL', 'PageUp'], ['ICON'], ['GFS'], ['EURO'], ['GFS']];

const cdnLog = { requests: 0, bytes: 0, frames: 0 };
const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  const send = () => {
    const cors = { 'access-control-allow-origin': '*' };
    if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(400, { ...cors, 'content-type': 'application/json' }); return res.end('{"statusCode":"404","error":"not_found"}');
    }
    const body = fs.readFileSync(file);
    cdnLog.requests += 1; cdnLog.bytes += body.length; if (rel.endsWith('.bin')) cdnLog.frames += 1;
    res.writeHead(200, { ...cors, 'content-length': body.length, 'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json',
      'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(body);
  };
  CDN_LAT ? setTimeout(send, CDN_LAT) : send();
});

// ---- the in-page probe ----
const PROBE = ({ bytesCheck, minCols }) => {
  const P = (window.__MT__ = { w: null, pairs: [], reads: new Map(), lit: 0, lakeTex: new WeakSet() });
  const PH = ['maskBaseCanvas', 'maskWaterPaint', 'maskUpload', 'waveDataUpdate', 'regionalMaskRefresh'];
  const phases = () => { const b = window.__RAW_GPU__ && window.__RAW_GPU__.cpuPhaseTiming && window.__RAW_GPU__.cpuPhaseTiming.buckets;
    return Object.fromEntries(PH.map((k) => [k, b && b[k] ? { calls: b[k].calls, ms: b[k].totalDurationMs } : { calls: 0, ms: 0 }])); };
  const phaseDelta = (a, b) => Object.fromEntries(PH.map((k) => [k, { calls: b[k].calls - a[k].calls, ms: +(b[k].ms - a[k].ms).toFixed(1) }]));
  window.addEventListener('pointerup', (e) => { if (P.w && P.w.t0 == null) P.w.t0 = e.timeStamp; }, true);
  window.addEventListener('click', (e) => { if (P.w && P.w.t0 == null) P.w.t0 = e.timeStamp; }, true);
  window.addEventListener('keydown', (e) => { if (P.w && P.w.t0 == null) P.w.t0 = e.timeStamp; }, true);
  const stampMs = (pid) => { const m = /_(\d{8}T\d{6}Z)\.json$/.exec(pid || ''); return m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : null; };
  let fc = 0; let status = '';
  const snap = () => {
    if ((fc++ % 3) === 0) status = [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null).map((x) => x.textContent.trim()).join(' | ').slice(0, 200);
    const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = d && d.waveGrid;
    return { g, d, model: g ? g.__sourceModel : null, layer: g ? g.__componentLayer : null, cols: g ? g.cols : null, stride: g ? (g.__decimatedStride || 0) : null,
      store: !!(g && g.__fromFrameStore), series: !!(g && g.__fromSeries), hour: g ? g.hourOffset : null,
      pid: (g && g.__fromFrameStore && g.__servedProductId) || (window.__WEBGL_MARINE_UPLOAD_DIAG__ && window.__WEBGL_MARINE_UPLOAD_DIAG__.servedProductId) || (g ? (g.__servedProductId || g.productId || null) : null),
      status };
  };
  const exactNow = (s, W) => s.model === W.model && s.layer === 'waves' && stampMs(s.pid) === W.expectedMs && s.stride === 0 && s.cols >= minCols;
  const fnv = (u8) => { let h = 2166136261; for (let i = 0; i < u8.length; i++) h = Math.imul(h ^ u8[i], 16777619); return (h >>> 0).toString(16); };
  function readTex(tex) {
    const eng = window.__MARINE_ENGINE__; const m = window.__MAP_INSTANCE__ || window.map;
    const gl = m && m.painter && m.painter.context && m.painter.context.gl;
    if (!gl || !tex || !eng._texWidth) return null;
    const W2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const prevD = gl.getParameter(W2 ? gl.DRAW_FRAMEBUFFER_BINDING : gl.FRAMEBUFFER_BINDING); const prevR = W2 ? gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) : null;
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const out = new Uint8Array(eng._texWidth * eng._texHeight * 4);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (ok) gl.readPixels(0, 0, eng._texWidth, eng._texHeight, gl.RGBA, gl.UNSIGNED_BYTE, out);
    if (W2) { gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevD); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevR); } else gl.bindFramebuffer(gl.FRAMEBUFFER, prevD);
    gl.deleteFramebuffer(fb);
    return ok ? fnv(out) : null;
  }
  const readAll = () => { const e = window.__MARINE_ENGINE__; return { wave: readTex(e._residentWaveTex), chl: readTex(e._residentChlTex), bath: readTex(e._residentBathTex), dims: `${e._texWidth}x${e._texHeight}` }; };
  let lastN = -1;
  const loop = (t) => {
    const W = P.w;
    const op = window.__RAW_GPU__ && window.__RAW_GPU__.opacity;
    const drew = op && op.n !== lastN; if (op) lastN = op.n;
    const eng = window.__MARINE_ENGINE__;
    if (eng && eng._cachedMaskTex && eng._cachedMaskGeoJSON && (eng._cachedMaskGeoJSON.__waveLakes || []).length) P.lakeTex.add(eng._cachedMaskTex);
    const dd = eng && eng._waveData; const gm = dd && dd.waveGrid ? (dd.waveGrid.__sourceModel || 'GFS') : null;
    const litNow = !!(drew && gm && gm !== 'EURO' && dd.u_oceanMaskTexture && P.lakeTex.has(dd.u_oceanMaskTexture));
    if (litNow) P.lit += 1;
    if (W && !W.done && W.t0 != null && t >= W.t0) {
      const s = snap(); const ok = exactNow(s, W);
      if (W.ph0 == null) W.ph0 = phases();
      if (litNow) W.litLake += 1;
      if (drew) {
        W.frames += 1;
        const admitted = /Loading|Verifying|does not match|pending|nearest|estimated/i.test(s.status);
        if (s.model && s.model !== W.model) {
          if (admitted) W.wrongAdmitted++;
          else { W.wrongSilent++; if (W.silentAt.length < 6) W.silentAt.push({ dt: Math.round(t - W.t0), model: s.model, store: s.store, series: s.series, cols: s.cols, status: s.status.slice(0, 120) }); }
        }
        if (s.model === W.model && /Loading .*still showing/i.test(s.status)) W.labelLag += 1;
        if (W.exact == null && !ok) W.framesToExact += 1;
        if (op.mult < 0.999) W.dimmed += 1;
      }
      if (W.exact == null && ok) { W.exact = t - W.t0; W.viaStore = s.store; W.pid = s.pid; W.statusAtExact = s.status; W.maskPhases = phaseDelta(W.ph0, phases());
        W.maskMode = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._lastMaskEncodeMode; }
      else if (W.exact != null && !ok) { W.regress += 1; const k = `${s.model}:${s.cols}`; W.regressAs[k] = (W.regressAs[k] || 0) + 1; }
    }
    if (bytesCheck) {
      const s = snap();
      // A cross-model show: read it once; after the normal commit of the same product (not from the store), read again.
      if (s.g && s.store && s.pid && s.g.__sourceModel && !P.reads.has(s.pid)) P.reads.set(s.pid, { at: readAll(), t, model: s.g.__sourceModel });
      else if (s.g && !s.store && s.pid && P.reads.has(s.pid) && !P.reads.get(s.pid).done) {
        const a = P.reads.get(s.pid); a.done = true; const b = readAll();
        P.pairs.push({ pid: s.pid, model: a.model, wave: a.at.wave != null && a.at.wave === b.wave, chl: a.at.chl != null && a.at.chl === b.chl,
          bath: a.at.bath != null && a.at.bath === b.bath, afterMs: Math.round(t - a.t), dimsShow: a.at.dims, dimsCommit: b.dims });
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  P.arm = (model, expected) => { P.w = { model, expectedMs: stampMs(expected), t0: null, exact: null, viaStore: null, pid: null, regress: 0, frames: 0,
    framesToExact: 0, wrongSilent: 0, wrongAdmitted: 0, labelLag: 0, dimmed: 0, statusAtExact: null, regressAs: {}, litLake: 0, ph0: null, maskPhases: null, silentAt: [] }; };
  P.read = () => ({ ...P.w, ph0: undefined });
};

// A visible button with exactly this text; on the phone layout a control may sit in a collapsed sheet, so fall back to the
// first matching button in the DOM (its React handler runs on a DOM click either way).
async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  try { await loc.waitFor({ state: 'visible', timeout: 4000 }); await loc.click(); return; } catch (e) { /* fall back */ }
  const clicked = await page.waitForFunction((t) => {
    const b = [...document.querySelectorAll('button,[role="button"]')].find((x) => x.textContent.trim() === t);
    if (b) b.click();
    return !!b;
  }, text, { timeout: 15000 });
  if (!(await clicked.jsonValue())) throw Error(`no ${text} control`);
}

async function session(arm, round) {
  const phone = arm.endsWith('-handheld');
  const theme = arm.endsWith('-light') ? 'light' : arm.endsWith('-beach') ? 'beach' : 'dark';
  const killToggle = arm.startsWith('off');
  const noLakes = arm.includes('-nolakes');
  const dims = phone ? { width: 390, height: 844, dpr: 2 } : VIEW === 'owner' ? { width: 844, height: 390, dpr: 2 } : {};
  const { browser, page, log } = await L.launch({ port: PORT, hashTextureUploads: false, ...dims });
  await page.addInitScript(({ base, theme, killToggle, phone, noLakes }) => {
    if (noLakes) window.__RAW_DISABLE_WAVE_LAKES__ = true;
    localStorage.removeItem('__RAW_STATIC_FRAMES__'); window.__RAW_STATIC_FRAMES_BASE__ = base;
    localStorage.setItem('raw-surf-theme', theme);
    if (killToggle) window.__RAW_DISABLE_FRAME_MODEL_TOGGLE__ = true;
    if (phone) window.__RAW_FRAME_STORE_TIER__ = 'handheld';
  }, { base: `http://127.0.0.1:${CDN_PORT}/`, theme, killToggle, phone, noLakes });
  await page.addInitScript(PROBE, { bytesCheck: !killToggle, minCols: MIN_COLS });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 200)));
  const clicks = []; const cdn0 = { ...cdnLog };
  try {
    await L.openMap(page); await L.jump(page, CLNG, CLAT, phone && ZOOM === 3.2 ? 1.6 : ZOOM);
    await clickExact(page, 'Waves');
    await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 60000 });
    const anchor = Math.round(Date.now() / 3600000) * 3600000; const expected = {};
    const expect = async (model, hour) => {
      const k = `${model}@${hour}`;
      if (expected[k] === undefined) {
        const ask = new Date(anchor + hour * 3600000).toISOString();
        const j = await (await fetch(`http://127.0.0.1:${PORT}/api/weather/grid?model=${model}&domain=marine&layer=waves&valid_time=${encodeURIComponent(ask)}&bbox=-180,-80,180,85`)).json();
        expected[k] = j.product_id || null;
      }
      return expected[k];
    };
    const wheelNow = () => page.evaluate((sel) => { const w = [...document.querySelectorAll(sel)].find((x) => x.offsetParent); return w ? +w.getAttribute('aria-valuenow') : 0; }, WHEEL);
    // Settle: the first draw, then (arm on) the warm frames' chl/bath, so a click measures the steady state a user reaches.
    const settle = async () => {
      const t0 = Date.now();
      for (;;) {
        await sleep(250);
        const st = await page.evaluate(() => { const t = window.__RAW_FRAME_STORE__; return t ? { cached: (t.aux || {}).cached || 0, inflight: (t.prefetch || {}).inflight || 0 } : null; });
        if (Date.now() - t0 >= 2500 && (killToggle || phone || (st && st.cached >= 2) || Date.now() - t0 >= WARM_WAIT)) return Date.now() - t0;
      }
    };
    let model = 'GFS'; let warmMs = await settle();
    for (const step of PLAN) {
      const hour = await wheelNow();
      if (step[0] === 'WHEEL') {
        const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus(); await page.keyboard.press(step[1]);
        await sleep(1500); warmMs = await settle();
        continue;
      }
      const target = step[0];
      const exp = await expect(target, hour);
      await page.evaluate(({ m, e }) => window.__MT__.arm(m, e), { m: target, e: exp });
      const ringT0 = await page.evaluate(() => Date.now());
      await clickExact(page, target);
      const t0 = Date.now(); let r;
      do { await sleep(50); r = await page.evaluate(() => window.__MT__.read()); } while (r.exact == null && Date.now() - t0 < WIN);
      await sleep(900);
      r = await page.evaluate(() => { const x = window.__MT__.read(); window.__MT__.w.done = true; return x; });
      // The engine's own commit log for the click window (lane, model, size, product): which path drew what.
      const ring = await page.evaluate((t0) => { const f = window.__RAW_FORENSIC__; const d = f && f.dump ? f.dump() : null;
        return d ? d.events.filter((e) => e.t >= t0 && e.type === 'commit').map((e) => ({ dt: e.t - t0, model: e.model, hour: e.hour, dims: e.dims, lane: e.lane,
          series: e.fromSeries, product: e.product ? String(e.product).slice(-40) : null })) : null; }, ringT0);
      // RING_ALL=1: every forensic event type (fetches, rejects, transitions) from the previous click on, for the hour-168 clicks.
      const ringAll = process.env.RING_ALL === '1' && hour >= 168 ? await page.evaluate((t0) => { const f = window.__RAW_FORENSIC__; const d = f && f.dump ? f.dump() : null;
        return d ? d.events.filter((e) => e.t >= t0 - 9000).map((e) => { const o = { dt: e.t - t0 }; for (const [k, v] of Object.entries(e)) if (k !== 't' && (typeof v !== 'object' || v === null)) o[k] = typeof v === 'string' ? v.slice(0, 60) : v; return o; }) : null; }, ringT0) : undefined;
      // One wheel step on the new model right after: it must take the resident path (exact, from the store).
      const next = hour + 1; const expN = await expect(target, next);
      await page.evaluate(({ m, e }) => window.__MT__.arm(m, e), { m: target, e: expN });
      const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus(); await page.keyboard.press('ArrowRight');
      const t1 = Date.now(); let s;
      do { await sleep(50); s = await page.evaluate(() => window.__MT__.read()); } while (s.exact == null && Date.now() - t1 < WIN);
      await page.evaluate(() => { window.__MT__.w.done = true; });
      await page.keyboard.press('ArrowLeft'); await sleep(1200);
      clicks.push({ from: model, to: target, hour, warmMs, ms: r.exact == null ? null : Math.round(r.exact), viaStore: r.viaStore, framesToExact: r.framesToExact,
        frames: r.frames, wrongSilent: r.wrongSilent, wrongAdmitted: r.wrongAdmitted, labelLag: r.labelLag, dimmed: r.dimmed, regress: r.regress, regressAs: r.regressAs,
        statusAtExact: r.statusAtExact, litLake: r.litLake, maskPhases: r.maskPhases, maskMode: r.maskMode, silentAt: r.silentAt, ring, ringAll, nextStepMs: s.exact == null ? null : Math.round(s.exact), nextViaStore: s.viaStore });
      model = target; warmMs = await settle();
    }
    const req = log.requests; const byPath = {}; for (const q of req) byPath[q.path] = (byPath[q.path] || 0) + 1;
    // REQLOG=1: every weather ask with its model, layer, hours, box and ms, and the clicks' wall-clock marks, so asks can be grouped
    // by model / layer / mini vs page / repeated box (the 2026-10-23 z8 question: 130-386 /grid_series asks in 12 clicks).
    const reqlog = process.env.REQLOG === '1' ? req.filter((q) => q.path === '/grid_series' || q.path === '/grid').map((q) => ({
      t: Math.round(q.t), ms: q.ms, path: q.path, q: q.q, status: q.status })) : undefined;
    const tail = await page.evaluate(() => { const t = window.__RAW_FRAME_STORE__; const P = window.__MT__;
      return { store: t ? { tier: t.tier, shows: t.shows, switches: t.switches, aux: t.aux, prefetch: t.prefetch, gpu: t.gpu, crop: t.crop,
        sets: (t.sets || []).map((s) => ({ key: s.key, frames: s.frames, packed: s.packed, resident: s.resident, absent: s.absent })) } : null, pairs: P.pairs,
        litLake: P.lit, waveLakes: window.__RAW_WAVE_LAKES__ || null }; });
    return { arm, round, theme, phone, clicks, backendRequests: byPath, reqlog, cdn: { requests: cdnLog.requests - cdn0.requests, frames: cdnLog.frames - cdn0.frames, bytes: cdnLog.bytes - cdn0.bytes },
      errors: [...errors, ...log.errors.slice(0, 5)], ...tail };
  } finally { await browser.close(); }
}

const pct = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : null; };
(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const sessions = [];
  const out = { env: { PORT, CDN_PORT, ROUNDS, WIN, CDN_LAT, WARM_WAIT, ZOOM, CENTER: [CLNG, CLAT], VIEW, MIN_COLS, startedUtc: new Date().toISOString() }, sessions, summary: {} };
  try {
    const ARMS = (process.env.ARMS || 'on,off').split(',');
    for (let i = 0; i < ROUNDS; i++) {
      for (const arm of (i % 2 === 0 ? ARMS : [...ARMS].reverse())) {
        let s;
        try { s = await session(arm, i); } catch (e) { s = { arm, round: i, error: String(e && e.stack || e).slice(0, 600), clicks: [] }; }
        sessions.push(s);
        const ms = s.clicks.map((x) => x.ms);
        console.log(arm, 'switch ms p50/p95/max', pct(ms, 0.5), pct(ms, 0.95), ms.some((x) => x == null) ? 'MISSED' : Math.max(...ms),
          'viaStore', s.clicks.filter((x) => x.viaStore).length + '/' + s.clicks.length, 'wrongSilent', s.clicks.reduce((a, x) => a + x.wrongSilent, 0),
          'labelLag', s.clicks.reduce((a, x) => a + x.labelLag, 0), 'next p95', pct(s.clicks.map((x) => x.nextStepMs), 0.95),
          'litLake', s.litLake, 'pairs', (s.pairs || []).filter((p) => p.wave && p.chl && p.bath).length + '/' + (s.pairs || []).length, 'errors', (s.errors || []).length,
          s.error ? 'SESSION ERROR ' + s.error.slice(0, 200) : '');
        if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
      }
    }
    for (const arm of new Set(sessions.map((s) => s.arm))) {
      const ss = sessions.filter((s) => s.arm === arm); const cl = ss.flatMap((s) => s.clicks); const ms = cl.map((x) => x.ms);
      out.summary[arm] = { sessions: ss.length, clicks: cl.length, switch_ms_p50: pct(ms, 0.5), switch_ms_p95: pct(ms, 0.95), switch_ms_max: ms.some((x) => x == null) ? null : Math.max(...ms),
        missed: ms.filter((x) => x == null).length, via_store: cl.filter((x) => x.viaStore).length, wrong_silent_frames: cl.reduce((a, x) => a + x.wrongSilent, 0),
        wrong_admitted_frames: cl.reduce((a, x) => a + x.wrongAdmitted, 0), label_lag_frames: cl.reduce((a, x) => a + x.labelLag, 0),
        dimmed_frames: cl.reduce((a, x) => a + x.dimmed, 0), regress_frames: cl.reduce((a, x) => a + x.regress, 0),
        next_step_ms_p95: pct(cl.map((x) => x.nextStepMs), 0.95), next_step_via_store: cl.filter((x) => x.nextViaStore).length,
        pairs: ss.flatMap((s) => s.pairs || []).length, pairs_all_equal: ss.flatMap((s) => s.pairs || []).filter((p) => p.wave && p.chl && p.bath).length,
        backend_requests: ss.reduce((acc, s) => { for (const [k, v] of Object.entries(s.backendRequests || {})) acc[k] = (acc[k] || 0) + v; return acc; }, {}),
        cdn_frames: ss.map((s) => s.cdn && s.cdn.frames), lit_lake_frames: ss.reduce((a, s) => a + (s.litLake || 0), 0),
        mask_ms_on_click_path_max: Math.max(0, ...cl.map((x) => (x.maskPhases ? ['maskBaseCanvas', 'maskWaterPaint', 'maskUpload'].reduce((a, k) => a + ((x.maskPhases[k] || {}).ms || 0), 0) : 0))), errors: ss.flatMap((s) => s.errors || []).slice(0, 5), session_errors: ss.filter((s) => s.error).length };
    }
    console.log(JSON.stringify(out.summary, null, 1));
  } finally {
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
    cdn.close();
  }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
