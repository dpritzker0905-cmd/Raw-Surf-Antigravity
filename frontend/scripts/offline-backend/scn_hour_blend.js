// The hour blend's gate instrument (2026-11-15, Fable animation lane). Gate: docs/weather-program/log/2026-11-15-fable-crest-hour-blend.md.
// Offline only: built client over serve_synthetic.py. Two arms in the SAME page: A (the kill set: hard swap) and B (blend), one scrub
// each per phase, A first on even views and B first on odd views (the kill is read on every step).
//
// Per view, in one page: the layer on, then three 24 h scrubs in +3 h steps (three ArrowRight keydowns in one task = one step):
//   warm   : nothing measured (the frames become resident)
//   timing : GPU time per frame (EXT_disjoint_timer_query_webgl2), nothing read back                                 -> H2
//   capture: every drawn frame of the map canvas read back in the map's own 'render' event; per frame the mean absolute change
//            of luminance (Rec. 709, every 2nd pixel each way) against the frame before                             -> H1
//            and, 420 ms after each step: the wave texture's bytes hashed, the drawn record, the blend's state        -> H3, H4
//   edges  : (ARM=B) particles not drawn (the lab skips the particle draw program), the blend HELD at 0.5; Sobel edge
//            pixels at f = 0, 0.5, 1 for every step, and the positive control (a frame averaged with itself moved 12 px) -> H5
//   drag   : the same scrub at one step per 100 ms, captured                                                         -> H6
//   PORT=4198 AB_BASE=http://127.0.0.1:3198 RR_DIR=<cache> OUT=<dir> ARM=A|B [THEME=dark] [VIEWS=0,1,..] [STEP_MS=600] node scn_hour_blend.js
if (process.env.AB_LIVE === '1') throw Error('scn_hour_blend is offline only');
const fs = require('fs'); const path = require('path');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const OUT = process.env.OUT; const ARM = process.env.ARM || 'B'; const THEME = process.env.THEME || 'dark';
const STEP_MS = +(process.env.STEP_MS || 600); const STEPS = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWS = [
  ['waves', -158.0, 21.6, 5.0], ['waves', -9.5, 39.0, 5.0], ['waves', 150.0, -34.0, 5.0], ['waves', -40.0, 35.0, 2.5], ['waves', -140.0, 20.0, 3.0],
  ['waves', 20.0, -40.0, 3.5], ['swell_1', -123.0, 37.5, 5.0], ['swell_1', -60.0, 30.0, 3.5], ['swell_2', 115.0, -10.0, 4.0], ['wind_waves', -5.0, 50.0, 4.5],
];
const PICK = process.env.VIEWS ? process.env.VIEWS.split(',').map(Number) : VIEWS.map((_, i) => i);

const SPY = () => {
  const H = (window.__HB__ = { gpu: [], frames: [], capture: false, timing: false, hideParticles: false, particleVerts: [], lum: null, ctx: null });
  const src = new WeakMap(); const isParticle = new WeakMap();
  const P = WebGL2RenderingContext.prototype;
  const ss = P.shaderSource; P.shaderSource = function (sh, s) { src.set(sh, s); return ss.call(this, sh, s); };
  const as = P.attachShader; P.attachShader = function (pr, sh) { if (/u_trochoidal/.test(src.get(sh) || '')) isParticle.set(pr, true); return as.call(this, pr, sh); };
  let cur = null;
  const up = P.useProgram; P.useProgram = function (pr) { cur = pr; return up.call(this, pr); };
  for (const k of ['drawArrays', 'drawElements']) {
    const o = P[k];
    P[k] = function (...a) {
      if (cur && isParticle.get(cur)) { H.pv = (H.pv || 0) + ((k === 'drawArrays' ? a[2] : a[1]) || 0); if (H.hideParticles) return undefined; }
      return o.apply(this, a);
    };
  }
  // GPU time of everything issued in a frame, on the map's context (the same per-frame query as scn_gpu_cost.js)
  let q = null; const pending = [];
  const tick = (now) => {
    const m = window.__MAP_INSTANCE__ || window.map; const gl = m && m.painter && m.painter.context && m.painter.context.gl;
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
      if (H.timing) H.dts = (H.dts || []).concat([{ t: now, dt: now - (H.lastTick || now) }]);
    }
    H.lastTick = now; H.particleVerts.push(H.pv || 0); if (H.particleVerts.length > 600) H.particleVerts.shift(); H.pv = 0;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // the drawn frame, read in the map's 'render' event (the drawing buffer still holds this frame)
  H.read = (stride) => {
    const m = window.__MAP_INSTANCE__ || window.map; const gl = m.painter.context.gl; const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight;
    if (!H.px || H.px.length !== w * h * 4) H.px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, H.px);
    const cw = Math.floor(w / stride); const ch = Math.floor(h / stride); const out = new Float32Array(cw * ch); const px = H.px;
    for (let y = 0; y < ch; y++) { let i = (y * stride * w) * 4; const o = y * cw; for (let x = 0; x < cw; x++, i += 4 * stride) out[o + x] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; }
    return { lum: out, w: cw, h: ch };
  };
  H.hook = () => {
    const m = window.__MAP_INSTANCE__ || window.map; if (H.hooked || !m) return !!H.hooked; H.hooked = true;
    m.on('render', () => {
      if (!H.capture) return;
      const r = H.read(2); const prev = H.lum; let d = null;
      if (prev && prev.length === r.lum.length) { let s = 0; for (let i = 0; i < prev.length; i++) s += Math.abs(r.lum[i] - prev[i]); d = s / prev.length; }
      H.lum = r.lum;
      const t = window.__RAW_CREST_HOUR_BLEND__;
      H.frames.push({ t: performance.now(), d, mix: t ? t.mix : 0 });
    });
    return true;
  };
  H.sobel = (r) => {   // gradient magnitude of luminance, full resolution
    const { lum, w, h } = r; const g = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1] + lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1];
      const gy = -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
      g[i] = Math.hypot(gx, gy);
    }
    return g;
  };
  H.p99 = (g) => { const s = Float32Array.from(g).sort(); return s[Math.floor(0.99 * (s.length - 1))]; };
  H.edges = (g, thr) => { let n = 0; for (let i = 0; i < g.length; i++) if (g[i] > thr) n += 1; return n; };
  H.shot = () => new Promise((res) => { const m = window.__MAP_INSTANCE__ || window.map; m.once('render', () => res(H.read(1))); m.triggerRepaint(); });
  H.state = () => {
    const e = window.__MARINE_ENGINE__; const m = window.__MAP_INSTANCE__ || window.map; const gl = m.painter.context.gl;
    const wd = e && e._waveData; const g = wd && wd.waveGrid; const tex = e && e._residentWaveTex; let hash = null;
    if (tex && e._texWidth && e._texHeight) {
      const fb0 = gl.getParameter(gl.FRAMEBUFFER_BINDING); const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const b = new Uint8Array(e._texWidth * e._texHeight * 4); gl.readPixels(0, 0, e._texWidth, e._texHeight, gl.RGBA, gl.UNSIGNED_BYTE, b);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb0); gl.deleteFramebuffer(fb);
      let x = 0x811c9dc5; for (let i = 0; i < b.length; i++) { x ^= b[i]; x = Math.imul(x, 0x01000193); } hash = (x >>> 0).toString(16) + ':' + b.length;
    }
    let uni = null; try { uni = gl.getUniform(e.heatmapProgram, gl.getUniformLocation(e.heatmapProgram, 'u_hourPrevMix')); } catch (err) { uni = 'n/a'; }
    const t = window.__RAW_CREST_HOUR_BLEND__ || null;
    return { hash, rec: g ? [g.__sourceModel || 'GFS', g.__componentLayer || 'waves', g.hourOffset, String(g.served_valid_time || g.valid_time || ''), g.productId || null].join('|') : null,
      dims: e ? `${e._texWidth}x${e._texHeight}` : null, blendObj: !!(e && e._hourBlend), prevTex: !!(e && e._hourPrevTex), uni, tel: t ? JSON.parse(JSON.stringify(t)) : null };
  };
  H.key = (key, n) => { const el = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/.test(x.getAttribute('aria-label') || '') && x.offsetParent !== null);
    if (!el) return false; el.focus(); for (let i = 0; i < n; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); return performance.now(); };
};

const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r3 = (x) => (x == null ? null : +x.toFixed(3));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'auto' });
  const { browser, page } = await L.launch({ port: +(process.env.PORT || 4198), width: 1280, height: 800, dpr: 1 });
  await rr.install(page);
  await page.addInitScript(SPY);
  await page.addInitScript(({ theme, arm }) => {
    try { localStorage.setItem('raw-surf-theme', theme); } catch (e) { /* private mode */ }
    window.__RAW_STATIC_FRAMES_BASE__ = 'http://127.0.0.1:4293/';
  }, { theme: THEME, arm: ARM });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 160).replace(/access_token=[^&\s"']+/g, 'access_token=REDACTED')));
  await L.openMap(page);
  const home = async () => { await page.evaluate(() => window.__HB__.key('Home', 1)); await sleep(2500); };
  const scrub = async (stepMs, after) => {
    const marks = [];
    for (let i = 0; i < STEPS; i++) {
      marks.push(await page.evaluate(() => window.__HB__.key('ArrowRight', 3)));
      if (after) { await sleep(Math.min(420, stepMs - 60)); marks[i] = { t: marks[i], st: await page.evaluate(() => window.__HB__.state()) }; await sleep(Math.max(0, stepMs - 420)); } else await sleep(stepMs);
    }
    await sleep(900);
    return marks;
  };
  // Both arms in ONE page (registered 2026-11-15, section 6 of the log): the kill is read on every step.
  const setArm = (arm) => page.evaluate((kill) => { if (kill) window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true; else delete window.__RAW_DISABLE_CREST_HOUR_BLEND__; }, arm === 'A');
  const timing = async () => {
    await page.evaluate(() => { const H = window.__HB__; H.gpu = []; H.dts = []; H.timing = true; });
    const tm = await scrub(STEP_MS, false);
    const T = await page.evaluate(() => { const H = window.__HB__; H.timing = false; return { gpu: H.gpu, dts: H.dts, ext: H.hasExt }; });
    const inBlend = (t) => tm.some((m) => t >= m && t <= m + 220);
    await home();
    return { ext: T.ext, gpuN: T.gpu.length, gpuMedian: r3(med(T.gpu.map((g) => g.ms))), gpuMedianInBlend: r3(med(T.gpu.filter((g) => inBlend(g.t)).map((g) => g.ms))),
      gpuNInBlend: T.gpu.filter((g) => inBlend(g.t)).length, frameMsMedian: r3(med(T.dts.map((d) => d.dt))), frameMsMedianInBlend: r3(med(T.dts.filter((d) => inBlend(d.t)).map((d) => d.dt))) };
  };
  const capture = async () => {
    await page.evaluate(() => { const H = window.__HB__; H.frames = []; H.lum = null; H.capture = true; });
    await sleep(600);
    const cm = await scrub(STEP_MS, true);
    const F = await page.evaluate(() => { const H = window.__HB__; H.capture = false; return H.frames; });
    const steps = cm.map((m, i) => {
      const end = i + 1 < cm.length ? cm[i + 1].t : m.t + 800;
      const before = F.filter((f) => f.d != null && f.t >= m.t - 400 && f.t < m.t).map((f) => f.d);
      const after = F.filter((f) => f.d != null && f.t >= m.t && f.t < Math.min(end, m.t + 800));
      const floor = med(before); const peak = after.length ? Math.max(...after.map((f) => f.d)) : null;
      return { floor: r3(floor), peak: r3(peak), step: r3(peak != null && floor != null ? peak - floor : null), framesAfter: after.length, framesBefore: before.length,
        mixSeen: r3(Math.max(0, ...after.map((f) => f.mix || 0))), hash: m.st.hash, rec: m.st.rec, dims: m.st.dims, endBlendObj: m.st.blendObj, endUni: m.st.uni, endMix: m.st.tel ? m.st.tel.mix : 0, prevTex: m.st.prevTex };
    });
    await home();
    return { steps, tel: cm.length ? cm[cm.length - 1].st.tel : null };
  };
  const drag = async () => {
    await page.evaluate(() => { const H = window.__HB__; H.frames = []; H.lum = null; H.capture = true; });
    await sleep(600);
    const dm = await scrub(100, false);
    const D = await page.evaluate(() => { const H = window.__HB__; H.capture = false; return H.frames; });
    const dBefore = med(D.filter((f) => f.d != null && f.t < dm[0]).map((f) => f.d));
    await home();
    return { dragFloor: r3(dBefore), drag: dm.map((m, i) => { const end = i + 1 < dm.length ? dm[i + 1] : m + 800; const a = D.filter((f) => f.d != null && f.t >= m && f.t < end).map((f) => f.d);
      return r3(a.length ? Math.max(...a) - dBefore : null); }) };
  };
  const edges = async () => {
    const res = await page.evaluate(async (steps) => {
      const H = window.__HB__; const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const out = [];
      H.hideParticles = true; await wait(400);
      for (let i = 0; i < steps; i++) {
        const f0 = await H.shot(); const g0 = H.sobel(f0); const thr = 0.5 * H.p99(g0); const e0 = H.edges(g0, thr);
        let control = null;
        if (i === 0) {   // positive control: the frame averaged with itself moved 12 px must read as doubled
          const dbl = new Float32Array(f0.lum.length); for (let y = 0; y < f0.h; y++) for (let x = 0; x < f0.w; x++) dbl[y * f0.w + x] = 0.5 * (f0.lum[y * f0.w + x] + f0.lum[y * f0.w + Math.max(0, x - 12)]);
          control = H.edges(H.sobel({ lum: dbl, w: f0.w, h: f0.h }), thr) / Math.max(1, e0);
        }
        window.__RAW_CREST_BLEND_HOLD__ = 0.5; H.key('ArrowRight', 3); await wait(500);
        const f5 = await H.shot(); const e5 = H.edges(H.sobel(f5), thr); const mixHeld = (window.__RAW_CREST_HOUR_BLEND__ || {}).mix;
        let d05 = 0; for (let k = 0; k < f0.lum.length; k++) d05 += Math.abs(f5.lum[k] - f0.lum[k]); d05 /= f0.lum.length;
        window.__RAW_CREST_BLEND_HOLD__ = null; await wait(450);
        const f1 = await H.shot(); const e1 = H.edges(H.sobel(f1), thr);
        let d01 = 0; for (let k = 0; k < f0.lum.length; k++) d01 += Math.abs(f1.lum[k] - f0.lum[k]); d01 /= f0.lum.length;
        out.push({ e0, e5, e1, pixels: f0.lum.length, ratio: +(e5 / Math.max(1, Math.max(e0, e1))).toFixed(4), mixHeld, d05: +d05.toFixed(3), d01: +d01.toFixed(3), control: control == null ? null : +control.toFixed(3) });
      }
      H.hideParticles = false;
      return out;
    }, STEPS);
    await home();
    return res;
  };
  let on = null;
  for (const vi of PICK) {
    const [layer, lng, lat, z] = VIEWS[vi];
    if (on && on !== layer) { await page.evaluate((l) => window.toggleLayer(l), on); await sleep(1500); on = null; }
    await L.jump(page, lng, lat, z); await sleep(1500);
    if (!on) { await page.evaluate((l) => window.toggleLayer(l), layer); on = layer; }
    await sleep(9000); await home();
    await page.evaluate(() => window.__HB__.hook());
    const order = vi % 2 === 0 ? ['A', 'B'] : ['B', 'A'];
    const outs = { A: { arm: 'A', theme: THEME, view: vi, layer, lng, lat, z, order: order.join('') }, B: { arm: 'B', theme: THEME, view: vi, layer, lng, lat, z, order: order.join('') } };
    await setArm('B'); await scrub(STEP_MS, false); await home();                 // warm, unmeasured
    for (const arm of order) { await setArm(arm); outs[arm].timing = await timing(); }
    for (const arm of order) { await setArm(arm); Object.assign(outs[arm], await capture()); }
    for (const arm of order) { await setArm(arm); Object.assign(outs[arm], await drag()); }
    await setArm('B'); outs.B.edges = await edges();
    const pv = await page.evaluate(() => { const v = window.__HB__.particleVerts.filter((n) => n > 0); return { frames: v.length, min: Math.min(...v), max: Math.max(...v) }; });
    for (const arm of ['A', 'B']) {
      const o = outs[arm]; o.particleVerts = pv; o.errors = errs.slice(0, 4);
      fs.appendFileSync(path.join(OUT, `hb-${arm}-${THEME}.jsonl`), JSON.stringify(o) + '\n');
      const st = o.steps.map((s) => s.step).filter((x) => x != null);
      console.log(`view ${vi} ${layer} arm ${arm} (${o.order}): step mean ${r3(mean(st))} floor ${r3(mean(o.steps.map((s) => s.floor)))} gpu ${o.timing.gpuMedian} (blend ${o.timing.gpuMedianInBlend}) drag ${r3(mean(o.drag.filter((x) => x != null)))} rec ${o.steps[0].rec}`
        + (o.edges ? ` edges max ${Math.max(...o.edges.map((e) => e.ratio))} control ${o.edges[0].control}` : ''));
    }
  }
  await browser.close();
})().catch((e) => { console.error(String(e && e.stack || e).replace(/access_token=[^&\s"']+/g, 'access_token=REDACTED')); process.exit(1); });
