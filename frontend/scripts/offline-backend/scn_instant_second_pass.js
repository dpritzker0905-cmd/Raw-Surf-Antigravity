// SECOND PASS on instant scrubbing (2026-10-22, the owner: "make sure we're definitely in position to be instant with scrubbing and
// delivering heatmap data"). Offline only. The gaps a Reflection review ranked highest, each as an instrument:
//   - per FRAME, not per step: frames drawn DIMMED (__RAW_GPU__.opacity.mult < 1) and SILENT-STALE frames (the hour held >= 600 ms,
//     the drawn product is not the selected hour's, drawn at full strength: the label says one hour, the map shows another);
//   - a seeded RANDOM 40-step sequence after the fixed 10 (jumps the window has not prefetched; bursts; back and forth);
//   - GPU READBACK (arm `bytes`): the resident wave texture read back right after a frame-store show and again after the normal commit
//     of the same product: the bytes must be equal (the store's copy IS what the normal path uploads, in the running app);
//   - THEMES (dark, light, beach: each has its own pack signature), the PHONE tier (handheld budgets, no idle fill, phone viewport),
//     CDN FAULTS (503 on a quarter of first frame asks, one truncated body in 16), WebGL CONTEXT LOSS and restore mid-session, and a
//     store-KILLED baseline.
// Per step: ms from the key press to the EXACT-CORRECT frame (the product /grid serves for that hour, asked before the timed window),
// whether the frame store put it there, the frames until then, dimmed frames, silent-stale frames, regressions after exact.
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS --port 4100
//   python backend/scripts/publish_frame_images.py --store-dir <store> --out-dir <cdn> --only frames
//   node frontend/scripts/offline-backend/serve_spa.js frontend/build 3100
//   CDN_DIR=<cdn> PORT=4100 CDN_LAT=340 ARMS=dark,light,beach,handheld,faults,ctxloss,bytes,killed OUT=pass2.json \
//     node frontend/scripts/offline-backend/scn_instant_second_pass.js
// Env: ROUNDS (1), WIN (ms per step, 8000), CDN_LAT (ms per static object), CDN_PORT (4191), SEED (1), RANDOM_STEPS (40),
// FILL_WAIT (ms, 45000: the steps start once the run is in the store, or after this).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_instant_second_pass is offline only');
const PORT = +(process.env.PORT || 4100);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4191);
const ROUNDS = +(process.env.ROUNDS || 1);
const WIN = +(process.env.WIN || 8000);
const CDN_LAT = +(process.env.CDN_LAT || 0);
const SEED = +(process.env.SEED || 1);
const RANDOM_STEPS = +(process.env.RANDOM_STEPS || 40);
const FILL_WAIT = +(process.env.FILL_WAIT || 45000);
// REAL_INDEX: the published run's index JSON, when CDN_DIR holds REAL published frames (their validity varies hour to hour, which
// synthetic stores never do: the gap the 2026-10-22 live read exposed). Expected frames then come from that index, as the app picks.
const REAL = process.env.REAL_INDEX ? JSON.parse(fs.readFileSync(process.env.REAL_INDEX, 'utf8')) : null;
if (!CDN_DIR) throw Error('CDN_DIR=<publisher --out-dir> is required');
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIXED = [['ArrowRight'], ['ArrowRight'], ['ArrowRight'], ['ArrowRight'], ['PageUp'], ['PageUp'], ['BURST'], ['PageDown'], ['ArrowLeft'], ['Home']];

// ---- the local CDN, with optional faults (deterministic per path: the first ask of a faulted path fails, a retry succeeds) ----
const cdnLog = { requests: 0, bytes: 0, frames: 0, faults: 0, truncated: 0, rateLimited: 0, maxConcurrent: 0 };
// CDN_RATE_LIMIT=N (2026-10-22): a stand-in for Supabase Storage's rate limit (the live read saw 3 x 429 at 6 in flight): a frame
// ask that arrives while N are already being served is answered 429 at once.
const RATE_LIMIT = +(process.env.CDN_RATE_LIMIT || 0);
let concurrent = 0;
let FAULTS = false;
const asked = new Map();
const hash32 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  if (rel.endsWith('.bin')) {
    if (RATE_LIMIT && concurrent >= RATE_LIMIT) { cdnLog.rateLimited += 1; res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end('rate limited'); }
    concurrent += 1; cdnLog.maxConcurrent = Math.max(cdnLog.maxConcurrent, concurrent);
    res.on('close', () => { concurrent -= 1; });
  }
  const send = () => {
    const cors = { 'access-control-allow-origin': '*' };
    if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(400, { ...cors, 'content-type': 'application/json' }); return res.end('{"statusCode":"404","error":"not_found"}');
    }
    const body = fs.readFileSync(file);
    const isFrame = rel.endsWith('.bin');
    cdnLog.requests += 1; cdnLog.bytes += body.length; if (isFrame) cdnLog.frames += 1;
    if (FAULTS && isFrame) {
      const n = (asked.get(rel) || 0) + 1; asked.set(rel, n);
      const h = hash32(rel);
      if (n === 1 && h % 4 === 0) { cdnLog.faults += 1; res.writeHead(503, cors); return res.end('busy'); }
      if (n === 1 && h % 16 === 1) {                   // a truncated body: the worker's inflate must fail closed
        cdnLog.truncated += 1; res.writeHead(200, { ...cors, 'content-type': 'application/octet-stream', 'content-length': Math.floor(body.length / 2) });
        return res.end(body.subarray(0, Math.floor(body.length / 2)));
      }
    }
    res.writeHead(200, { ...cors, 'content-length': body.length, 'content-type': isFrame ? 'application/octet-stream' : 'application/json',
      'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(body);
  };
  CDN_LAT ? setTimeout(send, CDN_LAT) : send();
});

// ---- the in-page probe: per-frame records while a step is armed ----
const PROBE = (bytesCheck) => {
  const P = (window.__P2__ = { w: null, pairs: [], storeReads: new Map(), texSame: { same: 0, differ: 0 } });
  window.addEventListener('keydown', (e) => { if (P.w && P.w.tKey == null) P.w.tKey = e.timeStamp; if (P.w) P.w.tLast = e.timeStamp; }, true);
  const stampMs = (pid) => { const m = /_(\d{8}T\d{6}Z)\.json$/.exec(pid || ''); return m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : null; };
  const snap = () => {
    const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = d && d.waveGrid;
    return { g, d, hour: g ? g.hourOffset : null, layer: g ? g.__componentLayer : null, model: g ? g.__sourceModel : null, cols: g ? g.cols : null,
      stride: g ? (g.__decimatedStride || 0) : null, series: !!(g && g.__fromSeries), store: !!(g && g.__fromFrameStore),
      pid: (g && g.__fromFrameStore && g.__servedProductId) || (window.__WEBGL_MARINE_UPLOAD_DIAG__ && window.__WEBGL_MARINE_UPLOAD_DIAG__.servedProductId) || (g ? (g.__servedProductId || g.productId || null) : null) };
  };
  P.snap = () => { const s = snap(); return { hour: s.hour, pid: s.pid, store: s.store, cols: s.cols }; };
  const productMs = (s, W) => (s.pid ? stampMs(s.pid) : (s.series && s.hour != null ? W.anchor + s.hour * 3600000 : null));
  const exactNow = (s, W) => productMs(s, W) === W.expectedMs && s.layer === 'waves' && s.model === 'GFS' && s.stride === 0 && s.cols >= 150;
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
  let lastN = -1;
  const loop = (t) => {
    const W = P.w;
    const op = window.__RAW_GPU__ && window.__RAW_GPU__.opacity;
    const drew = op && op.n !== lastN; if (op) lastN = op.n;
    if (W && !W.done && W.tLast != null && t >= W.tLast) {
      const s = snap(); const rel = t - W.tLast;
      const ok = exactNow(s, W);
      if (drew) {
        W.frames += 1;
        const dim = op.mult < 0.999;
        if (dim) { W.dimmed += 1; const why = (window.__RAW_GPU__.staleHour || {}).why || 'other'; W.dimWhy[why] = (W.dimWhy[why] || 0) + 1; }
        if (!ok && rel >= 600 && !dim) W.silentStale += 1;
        if (W.exact == null && !ok) W.framesToExact += 1;
      }
      if (W.exact == null && ok) { W.exact = W.already ? 0 : rel; W.viaStore = s.store; W.pid = s.pid; }
      else if (W.exact != null && !ok) W.regress += 1;
    }
    if (bytesCheck) {
      const s = snap(); const eng = window.__MARINE_ENGINE__;
      if (s.g && s.store && s.pid && !P.storeReads.has(s.pid)) {
        const same = s.d.u_waveTexture === eng._residentWaveTex; P.texSame[same ? 'same' : 'differ'] += 1;
        P.storeReads.set(s.pid, { h: readTex(eng._residentWaveTex), t });
      } else if (s.g && !s.store && s.pid && P.storeReads.has(s.pid) && !P.storeReads.get(s.pid).done) {
        const a = P.storeReads.get(s.pid); a.done = true;
        const hb = readTex(s.d.u_waveTexture || eng._residentWaveTex);
        P.pairs.push({ pid: s.pid, equal: a.h != null && a.h === hb, a: a.h, b: hb, afterMs: Math.round(t - a.t) });
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  P.arm = (expected, anchor) => {
    const s = snap();
    P.w = { expectedMs: stampMs(expected), anchor, tKey: null, tLast: null, exact: null, viaStore: null, pid: null, already: false, regress: 0,
      frames: 0, dimmed: 0, dimWhy: {}, silentStale: 0, framesToExact: 0 };
    P.w.already = exactNow(s, P.w);
  };
  P.read = () => { const w = P.w; return { ...w, end: P.snap() }; };
};

// The wheel: ArrowRight/Left +-1 h, PageUp/Down +-24 h, Home 0, End the last hour; clamped.
function predict(h, key, max) {
  const n = key === 'ArrowRight' ? h + 1 : key === 'ArrowLeft' ? h - 1 : key === 'PageUp' ? h + 24 : key === 'PageDown' ? h - 24
    : key === 'BURST' ? h + 120 : key === 'Home' ? 0 : key === 'End' ? max : h;
  return Math.max(0, Math.min(max, n));
}
function randomSteps(seed, n) {
  let s = seed >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const keys = ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'PageUp', 'PageUp', 'PageDown', 'PageDown', 'BURST', 'Home'];
  return Array.from({ length: n }, () => [keys[Math.floor(rnd() * keys.length)]]);
}

async function session(arm, round) {
  const phone = arm === 'handheld';
  const theme = ['light', 'beach'].includes(arm) ? arm : 'dark';
  FAULTS = arm === 'faults';
  const { browser, page, log } = await L.launch({ port: PORT, hashTextureUploads: false, ...(phone ? { width: 390, height: 844, dpr: 2 } : {}) });
  await page.addInitScript(({ base, theme, killStore, phone, ect }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__'); window.__RAW_STATIC_FRAMES_BASE__ = base;
    localStorage.setItem('raw-surf-theme', theme);
    if (killStore) window.__RAW_DISABLE_FRAME_STORE__ = true;
    if (phone) window.__RAW_FRAME_STORE_TIER__ = 'handheld';
    // ect3g: Chrome's network-quality estimate reads 3g (what ~500 ms CDN round trips can make it say); listeners are inert here.
    if (ect) Object.defineProperty(navigator, 'connection', { configurable: true, value: { effectiveType: ect, saveData: false, rtt: 450, downlink: 1.5, addEventListener() {}, removeEventListener() {} } });
  }, { base: `http://127.0.0.1:${CDN_PORT}/`, theme, killStore: arm === 'killed', phone, ect: arm === 'ect3g' ? '3g' : null });
  await page.addInitScript(PROBE, arm === 'bytes' || arm === 'ctxbytes');
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 200)));
  const steps = []; const cdn0 = { ...cdnLog };
  try {
    await L.openMap(page); await L.jump(page, -80, 24, phone ? 1.6 : 3.2);
    const clicked = await page.waitForFunction(() => { const b = [...document.querySelectorAll('button,[role="button"]')].find((x) => /^\s*Waves\s*$/.test(x.textContent)); if (b) b.click(); return !!b; }, null, { timeout: 20000 });
    if (!(await clicked.jsonValue())) throw Error('no Waves control');
    await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 60000 });
    const tDraw = Date.now(); let wholeRunMs = null;
    for (;;) {
      await sleep(250);
      const el = Date.now() - tDraw;
      const whole = await page.evaluate(() => { const t = window.__RAW_FRAME_STORE__; const s = t && t.sets && t.sets[0]; return !!(s && s.frames > 0 && s.absent === 0 && s.inflight === 0); });
      if (whole && wholeRunMs === null) wholeRunMs = el;
      if (el >= 6000 && (whole || el >= (arm === 'killed' || phone ? 6000 : FILL_WAIT))) break;
    }
    let ctx = null;
    if (arm === 'ctxloss' || arm === 'ctxbytes') {
      ctx = await page.evaluate(async () => {
        const m = window.__MAP_INSTANCE__ || window.map; const gl = m.painter.context.gl; const ext = gl.getExtension('WEBGL_lose_context');
        if (!ext) return { ext: false };
        ext.loseContext(); await new Promise((r) => setTimeout(r, 600)); ext.restoreContext(); await new Promise((r) => setTimeout(r, 4000));
        return { ext: true, lost: gl.isContextLost(), engine: !!window.__MARINE_ENGINE__, grid: !!(window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData) };
      });
    }
    const max = await page.evaluate((sel) => { const w = [...document.querySelectorAll(sel)].find((x) => x.offsetParent); return w ? +w.getAttribute('aria-valuemax') : null; }, WHEEL);
    const seq = [...FIXED, ...randomSteps(SEED + round * 7919 + arm.length, RANDOM_STEPS)];
    const wheelNow = () => page.evaluate((sel) => { const w = [...document.querySelectorAll(sel)].find((x) => x.offsetParent); return w ? +w.getAttribute('aria-valuenow') : 0; }, WHEEL);
    // What /grid serves for a target's time (the app's anchor: the hour-rounded clock), asked from Node BEFORE the step's timed window.
    const anchor = Math.round(Date.now() / 3600000) * 3600000; const expected = {};
    const expect = async (t) => {
      if (expected[t] === undefined && REAL) {
        // REAL frames (REAL_INDEX = the published run's index): the frame the app's own pickIndexFrame takes (nearest within +-3 h,
        // non-estimated first, the earlier on a tie). Past the run, the hour falls back to /grid, asked below.
        const ask = anchor + t * 3600000; let best = null; let bd = Infinity;
        for (const est of [false, true]) {
          for (const f of REAL.frames) { if (!!f.is_estimated !== est || !f.path) continue; const d = Math.abs(Date.parse(f.valid_time) - ask); if (d <= 3 * 3600000 && d < bd) { best = f; bd = d; } }
          if (best) break;
        }
        if (best) expected[t] = (best.meta && best.meta.product_id) || null;
      }
      if (expected[t] === undefined) {
        const ask = new Date(anchor + t * 3600000).toISOString();
        const j = await (await fetch(`http://127.0.0.1:${PORT}/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=${encodeURIComponent(ask)}&bbox=-180,-80,180,85`)).json();
        expected[t] = j.product_id;
      }
      return expected[t];
    };
    const reqs0 = log.requests.length;
    for (const [key] of seq) {
      const p = { key, target: predict(await wheelNow(), key, max) };      // from the wheel's ACTUAL value: one surprise never drifts the rest
      const exp = await expect(p.target);
      await page.evaluate(({ e, a }) => window.__P2__.arm(e, a), { e: exp, a: anchor });
      const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
      if (p.key === 'BURST') { for (let i = 0; i < 5; i++) { await page.keyboard.press('PageUp'); await sleep(60); } } else await page.keyboard.press(p.key);
      const t0 = Date.now(); let r;
      do { await sleep(50); r = await page.evaluate(() => window.__P2__.read()); } while (r.exact == null && Date.now() - t0 < WIN);
      await sleep(600);                                    // the frames after exact (regressions, late dims) count too
      r = await page.evaluate(() => { const x = window.__P2__.read(); window.__P2__.w.done = true; return x; });
      const now = await page.evaluate((sel) => { const w = [...document.querySelectorAll(sel)].find((x) => x.offsetParent); return w ? +w.getAttribute('aria-valuenow') : null; }, WHEEL);
      steps.push({ key: p.key, target: p.target, wheel: now, predicted: now === p.target, exactMs: r.exact == null ? null : Math.round(r.exact), viaStore: r.viaStore,
        framesToExact: r.framesToExact, frames: r.frames, dimmed: r.dimmed, dimWhy: r.dimWhy, silentStale: r.silentStale, regress: r.regress, already: r.already });
    }
    const req = log.requests.slice(reqs0); const byPath = {}; for (const q of req) byPath[q.path] = (byPath[q.path] || 0) + 1;
    const tail = await page.evaluate(() => { const t = window.__RAW_FRAME_STORE__; const P = window.__P2__;
      return { store: t ? { tier: t.tier, fill: t.fill, prefetch: t.prefetch, shows: t.shows, gpu: t.gpu, sets: (t.sets || []).map((s) => ({ frames: s.frames, packed: s.packed, resident: s.resident, absent: s.absent, unbuilt: s.unbuilt })) } : null,
        pairs: P.pairs, texSame: P.texSame, sf: window.__RAW_STATIC_FRAMES__ ? { hits: window.__RAW_STATIC_FRAMES__.hits, misses: window.__RAW_STATIC_FRAMES__.misses, errors: window.__RAW_STATIC_FRAMES__.errors } : null }; });
    return { arm, round, theme, phone, wholeRunMs, ctx, max, steps, backendRequests: byPath, cdn: { requests: cdnLog.requests - cdn0.requests, frames: cdnLog.frames - cdn0.frames,
      faults: cdnLog.faults - cdn0.faults, truncated: cdnLog.truncated - cdn0.truncated, rateLimited: cdnLog.rateLimited - cdn0.rateLimited, maxConcurrent: cdnLog.maxConcurrent },
      errors: [...errors, ...log.errors.slice(0, 5)], ...tail };
  } finally { await browser.close(); FAULTS = false; }
}

const pct = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : null; };
(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const sessions = [];
  const out = { env: { PORT, CDN_PORT, ROUNDS, WIN, CDN_LAT, SEED, RANDOM_STEPS, FILL_WAIT, startedUtc: new Date().toISOString() }, sessions, summary: {} };
  try {
    const ARMS = (process.env.ARMS || 'dark,light,beach,handheld,faults,ctxloss,bytes,killed').split(',');
    for (let i = 0; i < ROUNDS; i++) {
      for (const arm of (i % 2 === 0 ? ARMS : [...ARMS].reverse())) {
        let s;
        try { s = await session(arm, i); } catch (e) { s = { arm, round: i, error: String(e && e.stack || e).slice(0, 600), steps: [] }; }
        sessions.push(s);
        const ex = s.steps.map((x) => x.exactMs);
        console.log(arm, 'exact p50/p95/max', pct(ex, 0.5), pct(ex, 0.95), ex.some((x) => x == null) ? 'MISSED' : Math.max(...ex),
          'viaStore', s.steps.filter((x) => x.viaStore).length + '/' + s.steps.length, 'dimmed', s.steps.reduce((a, x) => a + x.dimmed, 0),
          'silentStale', s.steps.reduce((a, x) => a + x.silentStale, 0), 'regress', s.steps.reduce((a, x) => a + x.regress, 0),
          'unpredicted', s.steps.filter((x) => !x.predicted).length, 'backend', JSON.stringify(s.backendRequests || {}), 'errors', (s.errors || []).length,
          s.pairs ? 'pairs ' + s.pairs.filter((p) => p.equal).length + '/' + s.pairs.length : '', s.error ? 'SESSION ERROR ' + s.error.slice(0, 160) : '');
        if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
      }
    }
    for (const arm of new Set(sessions.map((s) => s.arm))) {
      const ss = sessions.filter((s) => s.arm === arm); const st = ss.flatMap((s) => s.steps); const ex = st.map((x) => x.exactMs);
      out.summary[arm] = { sessions: ss.length, steps: st.length, exact_ms_p50: pct(ex, 0.5), exact_ms_p95: pct(ex, 0.95), exact_ms_max: ex.some((x) => x == null) ? null : Math.max(...ex),
        exact_missed: ex.filter((x) => x == null).length, via_store: st.filter((x) => x.viaStore).length, dimmed_frames: st.reduce((a, x) => a + x.dimmed, 0),
        frames: st.reduce((a, x) => a + x.frames, 0), silent_stale_frames: st.reduce((a, x) => a + x.silentStale, 0), regress_frames: st.reduce((a, x) => a + x.regress, 0),
        unpredicted_steps: st.filter((x) => !x.predicted).length, backend_requests: ss.reduce((acc, s) => { for (const [k, v] of Object.entries(s.backendRequests || {})) acc[k] = (acc[k] || 0) + v; return acc; }, {}),
        errors: ss.flatMap((s) => s.errors || []).slice(0, 5), whole_run_ms: ss.map((s) => s.wholeRunMs), pairs: ss.flatMap((s) => s.pairs || []).length,
        pairs_equal: ss.flatMap((s) => s.pairs || []).filter((p) => p.equal).length, ctx: ss.map((s) => s.ctx).filter(Boolean), session_errors: ss.filter((s) => s.error).length };
    }
    console.log(JSON.stringify(out.summary, null, 1));
  } finally {
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
    cdn.close();
  }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
