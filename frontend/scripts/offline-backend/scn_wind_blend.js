// The wind hour blend's gate instrument, scrub lines (W1, W2, W3, W4, W8b, W9), and the probe of what the engine holds after a step.
// Gate: docs/weather-program/log/2026-11-15-fable-wind-hour-blend.md. Offline only: built client over serve_synthetic.py
// (--layers wind --moving-wind 8). Both arms in ONE page: A = the kill set (hard swap), B = the blend, one scrub each per phase,
// A first on even views and B first on odd views (the kill is read on every commit).
//
// PROBE=1: no gate line. After each +3 h step the engine's base and overlay are sampled every 40 ms for WATCH_MS and every change
//          is listed with its time, beside the /api/weather requests; the same hours twice (first visit, repeat visit).
// Otherwise, per view: every hour used is visited until SETTLED, then
//   timing : GPU time per frame (EXT_disjoint_timer_query_webgl2), nothing read back                                   -> W2
//   capture: particles NOT drawn; every drawn frame of the map canvas read in the map's 'render' event; the mean absolute
//            change of luminance against the frame before; 420 ms after each step the base texture's bytes hashed, its u/v
//            range, and the blend's state in all three programs                                                        -> W1, W3, W4
//   drag   : the same at one step per 100 ms                                                                           -> W9
//   marks  : the colour field NOT drawn; the mean luminance of the particle picture in the 200 ms after each step, and the
//            particle vertices drawn per frame                                                                         -> W8b
//   PORT=4203 AB_BASE=http://127.0.0.1:3198 RR_DIR=<cache> OUT=<dir> [THEME=dark] [VP=desktop|phone] [VIEWS=0,1,..] node scn_wind_blend.js
// MODE=more (log section 5, the advisor's lines): per view and arm, the colour field AND the particles drawn                -> W8c
//          and per drawn frame the particle state texture read back: particles respawned since the frame before, and the
//          mean step of the rest                                                                                       -> W8d
//          and per drawn frame the base's and the fine overlay's valid time beside the mix weight (two CONUS views added) -> W14
// MODE=plain (W2b): the page is loaded WITHOUT the opt-in (the plain shaders every user gets); the timing phase only.
if (process.env.AB_LIVE === '1') throw Error('scn_wind_blend is offline only');
const fs = require('fs'); const path = require('path');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const OUT = process.env.OUT; const THEME = process.env.THEME || 'dark'; const PHONE = process.env.VP === 'phone';
const STEP_MS = +(process.env.STEP_MS || 600); const STEPS = +(process.env.STEPS || 8); const PROBE = process.env.PROBE === '1'; const WATCH_MS = +(process.env.WATCH_MS || 8000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODE = process.env.MODE || 'gate';
const VIEWS = [[-40, 35, 2.5], [-140, 20, 3.0], [20, -40, 3.5], [150, -20, 3.0], [-106, 14, 4.0], [-158, 21.6, 5.0], [-9.5, 39, 5.0], [150, -34, 5.0], [-123, 37.5, 5.0], [-5, 50, 4.5]];
if (MODE === 'more') VIEWS.push([-98, 39, 4.5], [-122, 37, 5.5]);   // W14's two CONUS views
const PICK = process.env.VIEWS ? process.env.VIEWS.split(',').map(Number) : VIEWS.map((_, i) => i);

const SPY = () => {
  const H = (window.__WB__ = { gpu: [], frames: [], capture: false, timing: false, hideMarks: false, hideField: false, markVerts: [], lum: null });
  const P = WebGL2RenderingContext.prototype; let cur = null;
  const up = P.useProgram; P.useProgram = function (pr) { cur = pr; return up.call(this, pr); };
  for (const k of ['drawArrays', 'drawElements']) {
    const o = P[k];
    P[k] = function (...a) {
      const e = window.__WIND_ENGINE__;
      if (e && cur) {
        if (cur === e.drawProgram) H.mv = (H.mv || 0) + ((k === 'drawArrays' ? a[2] : a[1]) || 0);
        if (H.hideMarks && (cur === e.drawProgram || cur === e.screenProgram || cur === e.fadeProgram)) return undefined;   // the particles and their trails
        if (H.hideField && cur === e.heatmapProgram) return undefined;                                                    // the colour field
      }
      return o.apply(this, a);
    };
  }
  const map = () => window.__MAP_INSTANCE__ || window.map;
  let q = null; const pending = [];
  const tick = (now) => {
    const m = map(); const gl = m && m.painter && m.painter.context && m.painter.context.gl;
    if (gl && !(gl.isContextLost && gl.isContextLost())) {
      const x = H.ext || (H.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')); H.hasExt = !!x;
      if (x) {
        if (q) { gl.endQuery(x.TIME_ELAPSED_EXT); pending.push({ q, t: now, on: H.timing }); q = null; }
        while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
          const p = pending.shift();
          if (p.on && !gl.getParameter(x.GPU_DISJOINT_EXT)) H.gpu.push({ t: p.t, ms: gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6 });
          gl.deleteQuery(p.q);
        }
        if (pending.length < 8) { q = gl.createQuery(); gl.beginQuery(x.TIME_ELAPSED_EXT, q); }
      }
    }
    H.markVerts.push(H.mv || 0); if (H.markVerts.length > 900) H.markVerts.shift(); H.mv = 0;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  H.read = (stride) => {
    const gl = map().painter.context.gl; const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight;
    if (!H.px || H.px.length !== w * h * 4) H.px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, H.px);
    const cw = Math.floor(w / stride); const ch = Math.floor(h / stride); const out = new Float32Array(cw * ch); const px = H.px;
    for (let y = 0; y < ch; y++) { let i = (y * stride * w) * 4; const o = y * cw; for (let x = 0; x < cw; x++, i += 4 * stride) out[o + x] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; }
    return out;
  };
  // W8d: the particle state texture (positions in [0,1)), read back; respawned = moved more than 5% of the domain in one frame
  H.particles = () => {
    const e = window.__WIND_ENGINE__; const gl = map().painter.context.gl; const n = e && e.particleRes; if (!n || !e.particleStateA) return null;
    const fb0 = gl.getParameter(gl.FRAMEBUFFER_BINDING); const fb = H.pfb || (H.pfb = gl.createFramebuffer());
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, e.particleStateA, 0);
    const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE); const isFloat = type === gl.FLOAT || type === gl.HALF_FLOAT;
    const pos = new Float32Array(n * n * 2);
    if (isFloat) { const b = H.pbf && H.pbf.length === n * n * 4 ? H.pbf : (H.pbf = new Float32Array(n * n * 4)); gl.readPixels(0, 0, n, n, gl.RGBA, gl.FLOAT, b); for (let i = 0; i < n * n; i++) { pos[2 * i] = b[4 * i]; pos[2 * i + 1] = b[4 * i + 1]; } }
    else { const b = H.pbb && H.pbb.length === n * n * 4 ? H.pbb : (H.pbb = new Uint8Array(n * n * 4)); gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, b); for (let i = 0; i < n * n; i++) { pos[2 * i] = b[4 * i] / 255 + b[4 * i + 1] / 65025; pos[2 * i + 1] = b[4 * i + 2] / 255 + b[4 * i + 3] / 65025; } }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb0);
    const prev = H.ppos; H.ppos = pos; if (!prev || prev.length !== pos.length) return { float: isFloat, respawn: null, step: null };
    let respawn = 0; let sum = 0; let k = 0;
    for (let i = 0; i < n * n; i++) { const d = Math.hypot(pos[2 * i] - prev[2 * i], pos[2 * i + 1] - prev[2 * i + 1]); if (d > 0.05) respawn += 1; else { sum += d; k += 1; } }
    return { float: isFloat, respawn, step: k ? sum / k : null, n: n * n };
  };
  H.hook = () => {
    const m = map(); if (H.hooked || !m) return !!H.hooked; H.hooked = true;
    m.on('render', () => {
      if (!H.capture) return;
      const lum = H.read(2); const prev = H.lum; let d = null; let mean = 0;
      for (let i = 0; i < lum.length; i++) mean += lum[i]; mean /= lum.length;
      if (prev && prev.length === lum.length) { let s = 0; for (let i = 0; i < prev.length; i++) s += Math.abs(lum[i] - prev[i]); d = s / prev.length; }
      H.lum = lum; const t = window.__RAW_WIND_HOUR_BLEND__;
      const fr = { t: performance.now(), d, mean, mix: t ? t.mix : 0 };
      if (H.more) { const b = H.base(); fr.baseValid = b.valid; fr.fine = b.fine; const p = H.particles(); if (p) { fr.respawn = p.respawn; fr.pstep = p.step; fr.pfloat = p.float; } }
      H.frames.push(fr);
    });
    return true;
  };
  H.base = () => {   // what the engine holds: the base, the overlay, the blend
    const e = window.__WIND_ENGINE__; const b = e && e._windData; const g = b && b.windGrid; const f = e && e._windFine; const fg = f && f.windGrid;
    if (!g) return { none: true };
    const bb = b.bounds || {};
    return { dims: `${g.cols}x${g.rows}`, valid: String(g.valid_time || g.validTime || ''), hour: g.hourOffset || 0, model: g.source || (g.truthTag && g.truthTag.model) || null,
      bounds: `${Math.round(bb.west)},${Math.round(bb.south)},${Math.round(bb.east)},${Math.round(bb.north)}`, fine: fg ? `${fg.cols}x${fg.rows}@${String(fg.valid_time || fg.validTime || '').slice(11, 16)}` : null };
  };
  H.state = () => {
    const e = window.__WIND_ENGINE__; const gl = map().painter.context.gl; const s = H.base(); const b = e && e._windData; let hash = null;
    if (b && b.texture && b.windGrid) {
      const w = b.windGrid.cols; const h = b.windGrid.rows; const fb0 = gl.getParameter(gl.FRAMEBUFFER_BINDING); const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.texture, 0);
      const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb0); gl.deleteFramebuffer(fb);
      let x = 0x811c9dc5; for (let i = 0; i < px.length; i++) { x ^= px[i]; x = Math.imul(x, 0x01000193); }
      hash = `${(x >>> 0).toString(16)}:${px.length}:${b.uMin.map((v) => v.toFixed(4)).join(',')}:${b.uMax.map((v) => v.toFixed(4)).join(',')}`;
    }
    const uni = {}; for (const k of ['heatmapProgram', 'advectProgram', 'drawProgram']) { try { uni[k] = gl.getUniform(e[k], gl.getUniformLocation(e[k], 'u_windPrevMix')); } catch (err) { uni[k] = 'n/a'; } }
    const t = window.__RAW_WIND_HOUR_BLEND__ || null;
    return { ...s, hash, blend: !!(e && e._windBlend), prev: !!(e && e._windPrev), uni, tel: t ? JSON.parse(JSON.stringify(t)) : null };
  };
  H.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // settled (log section 4): the base's valid time is no longer the one before the step, and base and overlay unchanged for 1.5 s; 10 s limit.
  H.settle = async (wasValid, limit = 10000) => { const s0 = performance.now(); const sig = () => { const b = H.base(); return `${b.dims}|${b.valid}|${b.fine}`; }; let last = sig(); let since = s0;
    while (performance.now() - s0 < limit) { await H.wait(60); const d = sig(); if (d !== last) { last = d; since = performance.now(); }
      if (H.base().valid !== wasValid && performance.now() - since >= 1500) return { ok: true, sig: last, ms: Math.round(performance.now() - s0) }; }   // the new hour has arrived and nothing has changed for 1.5 s
    return { ok: false, sig: last, ms: limit }; };
  H.watch = async (ms) => { const s0 = performance.now(); const out = []; let last = null;
    while (performance.now() - s0 < ms) { const b = H.base(); const now = `${b.dims} ${String(b.valid).slice(11, 16)} base[${b.bounds}] fine:${b.fine}`; if (now !== last) { out.push({ t: Math.round(performance.now() - s0), state: now }); last = now; } await H.wait(40); }
    return out; };
  H.key = (key, n) => { const el = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/.test(x.getAttribute('aria-label') || '') && x.offsetParent !== null);
    if (!el) return false; el.focus(); for (let i = 0; i < n; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); return performance.now(); };
};

const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));
const r3n = (x) => (x == null || !Number.isFinite(x) ? null : +x.toPrecision(5));   // particle steps are small numbers

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'auto' });
  const { browser, page } = await L.launch(PHONE ? { port: +(process.env.PORT || 4203), width: 390, height: 844, dpr: 2, contextOptions: { isMobile: true, hasTouch: true } } : { port: +(process.env.PORT || 4203), width: 1280, height: 800, dpr: 1 });
  await rr.install(page);
  await page.addInitScript(SPY);
  if (MODE === 'plain') await page.addInitScript(() => { window.__WB_PLAIN__ = true; });
  await page.addInitScript((theme) => { try { localStorage.setItem('raw-surf-theme', theme); } catch (e) { /* private mode */ } if (!window.__WB_PLAIN__) window.__RAW_ENABLE_HOUR_BLEND__ = true; /* the blend is opt-in: both arms load the blended shaders, arm A sets the kill; MODE=plain leaves it unset */ window.__RAW_STATIC_FRAMES_BASE__ = 'http://127.0.0.1:4293/'; }, THEME);
  const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 160).replace(/access_token=[^&\s"']+/g, 'access_token=REDACTED')));
  const reqs = []; const t0 = Date.now();
  page.on('request', (r) => { if (/\/api\/weather\/(grid|grid_series)/.test(r.url())) r.__t = Date.now(); });
  page.on('requestfinished', (r) => { if (r.__t) { const q = new URL(r.url()); reqs.push({ start: r.__t - t0, ms: Date.now() - r.__t, path: q.pathname.replace('/api/weather/', ''), layer: q.searchParams.get('layer') }); } });
  await L.openMap(page);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const home = async () => { await ev(() => window.__WB__.key('Home', 1)); await sleep(2500); };
  const setArm = (arm) => ev((kill) => { if (kill) window.__RAW_DISABLE_WIND_HOUR_BLEND__ = true; else delete window.__RAW_DISABLE_WIND_HOUR_BLEND__; }, arm === 'A');
  const scrub = async (stepMs, after) => {
    const marks = [];
    for (let i = 0; i < STEPS; i++) {
      const t = await ev(() => window.__WB__.key('ArrowRight', 3));
      if (after) { await sleep(Math.min(420, stepMs - 60)); marks.push({ t, st: await ev(() => window.__WB__.state()) }); await sleep(Math.max(0, stepMs - 420)); } else { marks.push({ t }); await sleep(stepMs); }
      if (after === 'late') { await sleep(Math.max(0, 1500 - stepMs)); marks[marks.length - 1].late = await ev(() => { const s = window.__WB__.state(); return { blend: s.blend, prev: s.prev, uni: s.uni }; }); }   // W4c: 1,500 ms after the step
    }
    await sleep(900);
    return marks;
  };
  await ev(() => window.toggleLayer('wind')); await sleep(9000);
  for (const vi of PICK) {
    const [lng, lat, z] = VIEWS[vi];
    await L.jump(page, lng, lat, z); await sleep(4000); await home();
    await ev(() => window.__WB__.hook());
    if (PROBE) {
      await setArm('A');
      for (const pass of ['first', 'repeat']) {
        for (let i = 0; i < Math.min(STEPS, 4); i++) {
          const mark = Date.now() - t0; await ev(() => window.__WB__.key('ArrowRight', 3)); const tl = await ev((ms) => window.__WB__.watch(ms), WATCH_MS);
          const r = reqs.filter((q) => q.start >= mark - 50 && q.start < mark + WATCH_MS);
          console.log(`v${vi} z${z} ${pass} step ${i}: ` + tl.map((x) => `${x.t}ms ${x.state}`).join('  ->  ') + ` || requests: ${r.map((q) => `${q.path}(${q.layer})@${q.start - mark}+${q.ms}ms`).join(' ') || 'none'}`);
        }
        await home();
      }
      continue;
    }
    // settle every hour used (kill set), then measure
    await setArm('A'); const settles = [];
    for (let i = 0; i < STEPS; i++) { settles.push(await ev(async () => { const H = window.__WB__; const was = H.base().valid; H.key('ArrowRight', 3); return H.settle(was); })); }
    await home();
    const order = vi % 2 === 0 ? ['A', 'B'] : ['B', 'A'];
    const outs = { A: { arm: 'A', theme: THEME, vp: PHONE ? 'phone' : 'desktop', view: vi, lng, lat, z, order: order.join(''), settles }, B: { arm: 'B', theme: THEME, vp: PHONE ? 'phone' : 'desktop', view: vi, lng, lat, z, order: order.join(''), settles } };
    if (MODE === 'plain') {   // W2b: the plain shaders (no opt-in), the timing phase only, one scrub
      const loaded = await ev(() => { const e = window.__WIND_ENGINE__; return { blendShaders: !!(e && e._windBlendShaders), optIn: window.__RAW_ENABLE_HOUR_BLEND__ === true }; });
      await ev(() => { const H = window.__WB__; H.gpu = []; H.timing = true; });
      await scrub(STEP_MS, false);
      const T = await ev(() => { const H = window.__WB__; H.timing = false; return { gpu: H.gpu, ext: H.hasExt }; });
      const o = { mode: 'plain', theme: THEME, view: vi, lng, lat, z, loaded, ext: T.ext, gpuN: T.gpu.length, gpuMedian: r3(med(T.gpu.map((g) => g.ms))), errors: errs.slice(0, 4) };
      fs.appendFileSync(path.join(OUT, `wb-plain-${THEME}-${PHONE ? 'phone' : 'desktop'}.jsonl`), JSON.stringify(o) + '\n');
      console.log(`view ${vi} z${z} PLAIN shaders (blendShaders ${loaded.blendShaders}, optIn ${loaded.optIn}): gpu ${o.gpuMedian} over ${o.gpuN}`);
      await home(); continue;
    }
    if (MODE === 'more') {   // W8c, W8d, W14: the colour field AND the particles drawn; the particle state and the overlay's hour per frame
      await ev(() => { const H = window.__WB__; H.hideMarks = false; H.hideField = false; H.more = true; }); await sleep(2500);
      for (const arm of order) {
        await setArm(arm);
        await ev(() => { const H = window.__WB__; H.frames = []; H.lum = null; H.ppos = null; H.capture = true; }); await sleep(600);
        const cm = await scrub(STEP_MS, false);
        const F = await ev(() => { const H = window.__WB__; H.capture = false; return H.frames; });
        await home();
        const win = (a, b, get) => { const v = F.filter((x) => x.t >= a && x.t < b).map(get).filter((x) => x != null); return v.length ? { n: v.length, mean: r3n(mean(v)), max: r3n(Math.max(...v)) } : null; };
        outs[arm].more = cm.map((m, i) => {
          const end = i + 1 < cm.length ? cm[i + 1].t : m.t + 800;
          const before = F.filter((x) => x.d != null && x.t >= m.t - 400 && x.t < m.t).map((x) => x.d); const after = F.filter((x) => x.d != null && x.t >= m.t && x.t < Math.min(end, m.t + 800));
          const floor = med(before); const peak = after.length ? Math.max(...after.map((x) => x.d)) : null;
          // W14: a frame that mixes (mix > 0) while a fine overlay of ANOTHER hour than the base is held
          const bad = F.filter((x) => x.t >= m.t && x.t < end && x.mix > 0 && x.fine && String(x.baseValid).slice(11, 16) !== String(x.fine).split('@')[1]).length;
          const anyFine = F.filter((x) => x.t >= m.t && x.t < end && x.fine).length;
          return { step: r3(peak != null && floor != null ? peak - floor : null), floor: r3(floor),
            respawn: { rest0: win(m.t - 300, m.t, (x) => x.respawn), blend: win(m.t, m.t + 160, (x) => x.respawn), rest1: win(m.t + 300, m.t + 560, (x) => x.respawn) },
            pstep: { rest0: win(m.t - 300, m.t, (x) => x.pstep), blend: win(m.t, m.t + 160, (x) => x.pstep), rest1: win(m.t + 300, m.t + 560, (x) => x.pstep) },
            mixFrames: F.filter((x) => x.t >= m.t && x.t < end && x.mix > 0).length, fineFrames: anyFine, overlayOtherHourWhileMixing: bad };
        });
        outs[arm].pfloat = F.some((x) => x.pfloat);
      }
      await ev(() => { window.__WB__.more = false; });
      for (const arm of ['A', 'B']) {
        const o = outs[arm]; o.errors = errs.slice(0, 4);
        fs.appendFileSync(path.join(OUT, `wbmore-${arm}-${THEME}-${PHONE ? 'phone' : 'desktop'}.jsonl`), JSON.stringify(o) + '\n');
        const st = o.more.map((x) => x.step).filter((x) => x != null);
        console.log(`view ${vi} z${z} arm ${arm} (${o.order}) MORE: step mean ${r3(mean(st))}; mix frames ${o.more.reduce((t, x) => t + x.mixFrames, 0)}; fine-overlay frames ${o.more.reduce((t, x) => t + x.fineFrames, 0)}; overlay of another hour while mixing ${o.more.reduce((t, x) => t + x.overlayOtherHourWhileMixing, 0)}`);
      }
      continue;
    }
    for (const arm of order) {   // timing
      await setArm(arm); await ev(() => { const H = window.__WB__; H.gpu = []; H.timing = true; });
      const tm = await scrub(STEP_MS, false);
      const T = await ev(() => { const H = window.__WB__; H.timing = false; return { gpu: H.gpu, ext: H.hasExt }; });
      const inBlend = (t) => tm.some((m) => t >= m.t && t <= m.t + 220);
      outs[arm].timing = { ext: T.ext, gpuN: T.gpu.length, gpuMedian: r3(med(T.gpu.map((g) => g.ms))), gpuMedianInBlend: r3(med(T.gpu.filter((g) => inBlend(g.t)).map((g) => g.ms))) };
      await home();
    }
    const captured = async (stepMs, after) => {
      await ev(() => { const H = window.__WB__; H.frames = []; H.lum = null; H.capture = true; }); await sleep(600);
      const cm = await scrub(stepMs, after);
      const F = await ev(() => { const H = window.__WB__; H.capture = false; return H.frames; });
      await home();
      return { cm, F };
    };
    await ev(() => { window.__WB__.hideMarks = true; });
    for (const arm of order) {   // capture: the colour field alone
      await setArm(arm); const { cm, F } = await captured(STEP_MS, 'late');
      outs[arm].steps = cm.map((m, i) => {
        const end = i + 1 < cm.length ? cm[i + 1].t : m.t + 800;
        const before = F.filter((f) => f.d != null && f.t >= m.t - 400 && f.t < m.t).map((f) => f.d);
        const after = F.filter((f) => f.d != null && f.t >= m.t && f.t < Math.min(end, m.t + 800));
        const floor = med(before); const peak = after.length ? Math.max(...after.map((f) => f.d)) : null;
        return { floor: r3(floor), peak: r3(peak), step: r3(peak != null && floor != null ? peak - floor : null), mixSeen: r3(Math.max(0, ...after.map((f) => f.mix || 0))),
          hash: m.st.hash, dims: m.st.dims, valid: m.st.valid, fine: m.st.fine, endBlend: m.st.blend, endPrev: m.st.prev, endUni: m.st.uni, endMix: m.st.tel ? m.st.tel.mix : 0, late: m.late || null };
      });
      outs[arm].tel = cm.length ? cm[cm.length - 1].st.tel : null;
    }
    for (const arm of order) {   // drag
      await setArm(arm); const { cm, F } = await captured(100, false);
      const base = med(F.filter((f) => f.d != null && f.t < cm[0].t).map((f) => f.d));
      outs[arm].drag = cm.map((m, i) => { const end = i + 1 < cm.length ? cm[i + 1].t : m.t + 800; const a = F.filter((f) => f.d != null && f.t >= m.t && f.t < end).map((f) => f.d); return r3(a.length ? Math.max(...a) - base : null); });
    }
    await ev(() => { const H = window.__WB__; H.hideMarks = false; H.hideField = true; }); await sleep(2500);
    for (const arm of order) {   // marks: the particle picture alone
      await setArm(arm); await ev(() => { window.__WB__.markVerts = []; }); const { cm, F } = await captured(STEP_MS, false);
      outs[arm].marks = cm.map((m) => { const b = F.filter((f) => f.t >= m.t - 300 && f.t < m.t).map((f) => f.mean); const a = F.filter((f) => f.t >= m.t && f.t < m.t + 200).map((f) => f.mean); return { before: r3(mean(b)), after: r3(mean(a)), low: r3(a.length ? Math.min(...a) : null) }; });
      outs[arm].markVerts = await ev(() => { const v = window.__WB__.markVerts.filter((n) => n > 0); return { frames: v.length, min: Math.min(...v), max: Math.max(...v) }; });
    }
    await ev(() => { window.__WB__.hideField = false; }); await sleep(1500);
    for (const arm of ['A', 'B']) {
      const o = outs[arm]; o.errors = errs.slice(0, 4);
      fs.appendFileSync(path.join(OUT, `wb-${arm}-${THEME}-${PHONE ? 'phone' : 'desktop'}.jsonl`), JSON.stringify(o) + '\n');
      console.log(`view ${vi} z${z} arm ${arm} (${o.order}): step mean ${r3(mean(o.steps.map((s) => s.step).filter((x) => x != null)))} floor ${r3(mean(o.steps.map((s) => s.floor)))} gpu ${o.timing.gpuMedian} drag ${r3(mean(o.drag.filter((x) => x != null)))} base ${o.steps[0].dims} fine ${o.steps[0].fine} blended ${o.steps.filter((s) => s.mixSeen > 0).length}/${o.steps.length}`);
    }
  }
  await browser.close();
})().catch((e) => { console.error(String(e && e.stack || e).replace(/access_token=[^&\s"']+/g, 'access_token=REDACTED')); process.exit(1); });
