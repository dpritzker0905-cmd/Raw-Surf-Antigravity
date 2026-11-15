// H8 (the hidden middle hour), H5's exact reference, and H9 (truth for a grid swap): the hour blend's truth lines.
// Gate: docs/weather-program/log/2026-11-15-fable-crest-hour-blend.md, sections 9 and 10. Offline only. Particles not drawn.
// Per view:
//   real   : with the kill set (hard cut) the engine steps +3 h at a time; each hour's picture R[j] and wave-texture bytes T[j]
//            are read at rest, j = 1..8
//   held   : for j = 1..4 the engine shows hour j, then with the blend on and HELD at 0.5 it steps straight to hour j+2 (six
//            ArrowRight keydowns in one task): M[j], the half-way mix of j and j+2, never having seen j+1
//   ref    : the exact arithmetic average of T[j] and T[j+2], written into the wave texture by the lab and drawn at rest
//   scores : H8  ERROR(blend) = mean |M[j] - R[j+1]| against ERROR(cut) = min(mean |R[j] - R[j+1]|, mean |R[j+2] - R[j+1]|)
//            flat control: the luminance average of R[j] and R[j+4] (12 h apart) scored the same way
//            H5  M[j] against the reference picture (difference, and contrast retention of both)
//            the same in VALUE space, from the texture bytes: height in metres, direction in degrees
//   swap   : H9. A grid swap inside one hour (the coarse grid, then the finer one): the coarse and the fine pictures at rest
//            (kill set), then the same step with the blend on, HELD at 0.5 once the coarse grid is at rest; the held picture
//            against the fine one.
//   PORT=4201 AB_BASE=http://127.0.0.1:3198 RR_DIR=<cache> OUT=<dir> [VIEWS=0,1,..] node scn_hour_blend_mid.js
if (process.env.AB_LIVE === '1') throw Error('scn_hour_blend_mid is offline only');
const fs = require('fs'); const path = require('path');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const OUT = process.env.OUT; const THEME = process.env.THEME || 'dark';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Section 15 of the log: candidates in order per layer; a candidate is USED only if, with the kill set, the engine's grid at
// rest is the same at all 8 hours of the real-frame pass (decided before any blend picture of the view is taken).
const CANDIDATES = {
  waves: [[-40, 35, 2.5], [-140, 20, 3.0], [20, -40, 3.5], [150, -20, 3.0], [-100, -30, 2.5]],
  swell_1: [[-60, 30, 3.5], [-150, 35, 3.0], [60, -30, 3.5], [-20, -20, 2.5]],
  swell_2: [[-30, 0, 3.0], [115, -10, 2.5], [-150, 0, 2.5], [60, 10, 2.5]],
  wind_waves: [[-5, 50, 2.5], [-140, 40, 2.5], [80, -30, 2.5], [-30, 20, 3.0]],
};
const QUOTA = { waves: 4, swell_1: 3, swell_2: 2, wind_waves: 1 };
const SWAPS = process.env.SWAPS !== '0';
// MODE=h8c (log section 16.1): the ORIGINAL coastal views, triples scored regardless of grid, luminance only.
// MODE=grey (section 16.3): the first three one-grid waves views drawn with the raw height as grey instead of the colour table.
const MODE = process.env.MODE || 'h8';
if (MODE === 'h8c' || MODE === 'h8f') {
  for (const k of Object.keys(CANDIDATES)) CANDIDATES[k] = [];
  CANDIDATES.waves = [[-158.0, 21.6, 5.0], [-9.5, 39.0, 5.0], [150.0, -34.0, 5.0], [-40.0, 35.0, 2.5], [-140.0, 20.0, 3.0], [20.0, -40.0, 3.5]];
  CANDIDATES.swell_1 = [[-123.0, 37.5, 5.0], [-60.0, 30.0, 3.5]]; CANDIDATES.swell_2 = [[115.0, -10.0, 4.0]]; CANDIDATES.wind_waves = [[-5.0, 50.0, 4.5]];
  Object.assign(QUOTA, { waves: 6, swell_1: 2, swell_2: 1, wind_waves: 1 });
}
if (MODE === 'grey') {
  CANDIDATES.waves = [[-158.0, 21.6, 5.0], [150.0, -34.0, 5.0], [-9.5, 39.0, 5.0], [-40.0, 35.0, 2.5], [-140.0, 20.0, 3.0], [20.0, -40.0, 3.5]];
  Object.assign(QUOTA, { waves: 6, swell_1: 0, swell_2: 0, wind_waves: 0 });
}
const ANYGRID = MODE === 'h8c' || MODE === 'grey' || MODE === 'h8f';
const WARM_MS = +(process.env.WARM_MS || 700);   // 5000 = every hour's fine grid arrives and is cached before anything is measured

const SPY = () => {
  const H = (window.__HM__ = { hide: true, R: {}, T: {} });
  const src = new WeakMap(); const isParticle = new WeakMap(); const P = WebGL2RenderingContext.prototype;
  const ss = P.shaderSource; P.shaderSource = function (sh, s) { src.set(sh, s); return ss.call(this, sh, s); };
  const as = P.attachShader; P.attachShader = function (pr, sh) { if (/u_trochoidal/.test(src.get(sh) || '')) isParticle.set(pr, true); return as.call(this, pr, sh); };
  let cur = null; const up = P.useProgram; P.useProgram = function (pr) { cur = pr; return up.call(this, pr); };
  for (const k of ['drawArrays', 'drawElements']) { const o = P[k]; P[k] = function (...a) { if (H.hide && cur && isParticle.get(cur)) return undefined; return o.apply(this, a); }; }
  const map = () => window.__MAP_INSTANCE__ || window.map; const eng = () => window.__MARINE_ENGINE__;
  H.shot = () => new Promise((res) => { const m = map(); m.once('render', () => {
    const gl = m.painter.context.gl; const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight; const px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const lum = new Float32Array(w * h); for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    res(lum); }); m.triggerRepaint(); });
  H.mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  H.std = (a) => { let m = 0; for (let i = 0; i < a.length; i++) m += a[i]; m /= a.length; let v = 0; for (let i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m); return Math.sqrt(v / a.length); };
  H.avg = (a, b) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = 0.5 * (a[i] + b[i]); return o; };
  H.tex = () => {   // the resident wave texture's bytes
    const e = eng(); const gl = map().painter.context.gl; const w = e._texWidth; const h = e._texHeight;
    const fb0 = gl.getParameter(gl.FRAMEBUFFER_BINDING); const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, e._residentWaveTex, 0);
    const b = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb0); gl.deleteFramebuffer(fb);
    return { b, w, h, scale: (e._waveData && e._waveData.u_heightScale > 0) ? e._waveData.u_heightScale : 10 };
  };
  H.put = (bytes) => {   // lab only: write bytes into the resident wave texture (the reference picture), same size
    const e = eng(); const gl = map().painter.context.gl; const t0 = gl.getParameter(gl.TEXTURE_BINDING_2D); const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.bindTexture(gl.TEXTURE_2D, e._residentWaveTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, e._texWidth, e._texHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.bindTexture(gl.TEXTURE_2D, t0); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !!flip);
  };
  // value space: height in metres (byte 2), direction from the unit vector (bytes 0, 1); cells with height 0 in any frame are land / no data
  H.values = (a, c, truth) => {
    const n = truth.b.length / 4; let eh = 0; let ch1 = 0; let ch2 = 0; let ed = 0; let cd1 = 0; let cd2 = 0; let k = 0; let vm = 0; let vt = 0; let mm = 0; let mt = 0;
    const ang = (x, y) => Math.atan2(y, x); const dd = (p, q) => { let d = Math.abs(p - q); if (d > Math.PI) d = 2 * Math.PI - d; return d * 180 / Math.PI; };
    const hs = []; const ts = [];
    for (let i = 0; i < n; i++) {
      const o = i * 4; if (!a.b[o + 2] || !c.b[o + 2] || !truth.b[o + 2]) continue;
      const ha = a.b[o + 2] / 255 * a.scale; const hc = c.b[o + 2] / 255 * c.scale; const ht = truth.b[o + 2] / 255 * truth.scale; const hm = 0.5 * (ha + hc);
      eh += Math.abs(hm - ht); ch1 += Math.abs(ha - ht); ch2 += Math.abs(hc - ht); hs.push(hm); ts.push(ht);
      const ua = a.b[o] / 255 * 2 - 1; const va = a.b[o + 1] / 255 * 2 - 1; const uc = c.b[o] / 255 * 2 - 1; const vc = c.b[o + 1] / 255 * 2 - 1; const ut = truth.b[o] / 255 * 2 - 1; const vtt = truth.b[o + 1] / 255 * 2 - 1;
      const at = ang(ut, vtt); ed += dd(ang(0.5 * (ua + uc), 0.5 * (va + vc)), at); cd1 += dd(ang(ua, va), at); cd2 += dd(ang(uc, vc), at); k += 1;
    }
    if (!k) return null;
    for (const x of hs) mm += x; mm /= k; for (const x of ts) mt += x; mt /= k; for (const x of hs) vm += (x - mm) * (x - mm); for (const x of ts) vt += (x - mt) * (x - mt);
    return { cells: k, hBlend: eh / k, hCut: Math.min(ch1, ch2) / k, dBlend: ed / k, dCut: Math.min(cd1, cd2) / k, hRetTruth: Math.sqrt(vm / k) / Math.max(1e-9, Math.sqrt(vt / k)) };
  };
  H.state = () => { const e = eng(); const g = e && e._waveData && e._waveData.waveGrid; const t = window.__RAW_CREST_HOUR_BLEND__ || {}; const p = e && e._hourPrev;
    return { dims: e ? `${e._texWidth}x${e._texHeight}` : null, cells: e ? e._texWidth * e._texHeight : 0, layer: g ? (g.__componentLayer || 'waves') : null, valid: g ? String(g.served_valid_time || g.valid_time || '') : null,
      starts: t.starts || 0, kept: t.kept || 0, gridSwaps: t.gridSwaps || 0, mix: t.mix || 0, blend: !!(e && e._hourBlend), prevValid: p ? p.validTime : null, prevDims: p ? `${p.cols}x${p.rows}` : null, prevAdopted: p ? !!p.adopted : null }; };
  H.key = (key, n) => { const el = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/.test(x.getAttribute('aria-label') || '') && x.offsetParent !== null);
    if (!el) return false; el.focus(); for (let i = 0; i < n; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); return true; };
  H.kill = (on) => { if (on) window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true; else delete window.__RAW_DISABLE_CREST_HOUR_BLEND__; };
  H.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // settled (log section 23.3): the grid unchanged for 1.5 s and at least 2 s since the call; 10 s limit
  H.settle = async (limit = 10000) => { const s0 = performance.now(); let last = H.state().dims; let since = s0;
    while (performance.now() - s0 < limit) { await H.wait(60); const d = H.state().dims; if (d !== last) { last = d; since = performance.now(); }
      if (performance.now() - s0 >= 2000 && performance.now() - since >= 1500) return { ok: true, dims: last, ms: Math.round(performance.now() - s0) }; }
    return { ok: false, dims: last, ms: limit }; };
  // the rounding bracket (section 23.2): the share of pixels whose value is outside [reference rounded down, rounded up] widened by one level
  H.outside = (M, LO, HI) => { let n = 0; for (let i = 0; i < M.length; i++) { const lo = Math.min(LO[i], HI[i]) - 1; const hi = Math.max(LO[i], HI[i]) + 1; if (M[i] < lo || M[i] > hi) n += 1; } return n / M.length; };
  H.F = {};
  // H9 (forced): the lab hands the blend a COARSER copy of the resident field as the earlier one, at the same bounds
  H.forced = async () => {
    const e = eng(); const gl = map().painter.context.gl; const t = H.tex(); const g = e._waveData && e._waveData.waveGrid;
    if (!g || !g.bounds || e._waveData.u_waveScoreTexture) return { miss: 'no_grid' };
    // the coarse copy: the resident field resampled (bilinear) to about a third of its resolution on the SAME sample extents
    // SELF=1 (a diagnosis): the earlier field is an exact copy of the resident, so every mix must reproduce the picture at rest
    const coarseN = window.__HM_SELF__ ? ((n) => n) : ((n) => Math.max(4, Math.round((n - 1) / 3) + 1));
    const cw = coarseN(t.w); const ch = coarseN(t.h); if (!window.__HM_SELF__ && (cw >= t.w || ch >= t.h)) return { miss: 'too_small', dims: `${t.w}x${t.h}` };
    const cb = new Uint8Array(cw * ch * 4);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const fx = x * (t.w - 1) / (cw - 1); const fy = y * (t.h - 1) / (ch - 1); const x0 = Math.min(t.w - 2, Math.floor(fx)); const y0 = Math.min(t.h - 2, Math.floor(fy)); const ax = fx - x0; const ay = fy - y0;
      for (let c = 0; c < 4; c++) {
        const v = (1 - ax) * (1 - ay) * t.b[(y0 * t.w + x0) * 4 + c] + ax * (1 - ay) * t.b[(y0 * t.w + x0 + 1) * 4 + c] + (1 - ax) * ay * t.b[((y0 + 1) * t.w + x0) * 4 + c] + ax * ay * t.b[((y0 + 1) * t.w + x0 + 1) * 4 + c];
        cb[(y * cw + x) * 4 + c] = Math.round(v);
      }
    }
    const t0 = gl.getParameter(gl.TEXTURE_BINDING_2D); const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL); const tex = gl.createTexture();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, cb);
    gl.bindTexture(gl.TEXTURE_2D, t0); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !!flip);
    const before = H.state(); const FINE = await H.shot();
    const b = g.bounds; const prev = { wave: tex, adopted: false, cols: cw, rows: ch, bounds: { ...b }, reg: [-1 / cw, -1 / ch, 0.5 / cw, 0.5 / ch], scale: t.scale, landAware: false, validTime: 'lab' };
    let out;
    try {
      H.kill(false); e._hourPrev = prev; e._hourBlend = { t0: 0, ms: 160 };
      window.__RAW_CREST_BLEND_HOLD__ = 0; const COARSE = await H.shot(); const m0 = H.state().mix;
      window.__RAW_CREST_BLEND_HOLD__ = 0.5; const HELD = await H.shot(); const m5 = H.state().mix;
      const dx = (b.east - b.west) / (cw - 1); const dy = (b.north - b.south) / (ch - 1);   // the control: one coarse cell east AND one north
      e._hourPrev = { ...prev, bounds: { west: b.west + dx, east: b.east + dx, south: b.south + dy, north: b.north + dy } }; const SHIFT = await H.shot();
      out = { coarse: `${cw}x${ch}`, fine: `${t.w}x${t.h}`, mixes: [m0, m5], eHeld: H.mad(HELD, FINE), eCoarse: H.mad(COARSE, FINE), eShift: H.mad(SHIFT, FINE), retHeld: H.std(HELD) / H.std(FINE) };
    } finally {
      window.__RAW_CREST_BLEND_HOLD__ = null; e._hourBlend = null; e._hourPrev = null; H.kill(true); gl.deleteTexture(tex);
    }
    const after = H.state(); const REST = await H.shot();
    return { ...out, stable: after.dims === before.dims && after.valid === before.valid, restNoise: H.mad(REST, FINE) };
  };
  // H9, kill set: after a step, the first picture on the coarse grid and the first on a finer grid of the SAME valid time
  H.swapRest = async (ms) => {
    const t0 = performance.now(); let coarse = null; let fine = null;
    while (performance.now() - t0 < ms) {
      const s = H.state();
      if (s.valid && (!coarse || (s.valid === coarse.st.valid && s.cells > coarse.st.cells && !fine) || (s.valid !== coarse.st.valid && !fine))) {
        const lum = await H.shot(); const s2 = H.state();
        if (s2.dims === s.dims && s2.valid === s.valid) { if (!coarse || s.valid !== coarse.st.valid) { coarse = { lum, st: s }; fine = null; } else if (s.cells > coarse.st.cells) fine = { lum, st: s }; }
      }
      if (fine) break;
      await H.wait(40);
    }
    H.swap = { coarse, fine };
    return { coarse: coarse && coarse.st, fine: fine && fine.st };
  };
  // H9, blend on: the same step; once the coarse grid is at rest the blend is HELD at 0.5, and the picture is read when the finer grid's swap is blending
  H.swapHeld = async (ms, coarseDims, fineDims) => {
    const t0 = performance.now(); let armed = false; const before = H.state();
    while (performance.now() - t0 < ms) {
      const s = H.state();
      if (!armed && s.dims === fineDims && s.starts > before.starts) return { miss: 'fine_before_coarse_rested', s };
      if (!armed && s.dims === coarseDims && !s.blend && s.valid !== before.valid) { window.__RAW_CREST_BLEND_HOLD__ = 0.5; armed = true; }
      if (armed && s.dims === fineDims && s.blend && s.mix === 0.5) {
        const lum = await H.shot(); const s2 = H.state(); window.__RAW_CREST_BLEND_HOLD__ = null;
        const sw = H.swap; return { s: s2, eHeld: H.mad(lum, sw.fine.lum), eCoarse: H.mad(sw.coarse.lum, sw.fine.lum), retHeld: H.std(lum) / H.std(sw.fine.lum) };
      }
      await H.wait(16);
    }
    window.__RAW_CREST_BLEND_HOLD__ = null;
    return { miss: armed ? 'no_fine_swap' : 'coarse_never_rested', s: H.state() };
  };
};
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(4));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'auto' });
  const { browser, page } = await L.launch({ port: +(process.env.PORT || 4201), width: 1280, height: 800, dpr: 1 });
  await rr.install(page); await page.addInitScript(SPY);
  await page.addInitScript((theme) => { try { localStorage.setItem('raw-surf-theme', theme); } catch (e) { /* private mode */ } window.__RAW_STATIC_FRAMES_BASE__ = 'http://127.0.0.1:4293/'; }, THEME);
  const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 160).replace(/access_token=[^&\s"']+/g, 'access_token=REDACTED')));
  await L.openMap(page);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  if (MODE === 'grey') await ev(() => { window.__GPU_DEBUG__ = { mode: 'value' }; });
  if (process.env.SELF === '1') await ev(() => { window.__HM_SELF__ = true; });
  const home = async () => { await ev(() => window.__HM__.key('Home', 1)); await sleep(2500); };
  const stepTo = async (n, wait = 700) => { for (let i = 0; i < n; i++) { await ev(() => window.__HM__.key('ArrowRight', 3)); await sleep(wait); } };
  let on = null; let vi = -1; const used = {}; const skipped = [];
  for (const [layer, list] of Object.entries(CANDIDATES)) for (const [lng, lat, z] of list) {
    if ((used[layer] || 0) >= QUOTA[layer] || (process.env.MAXV && vi + 1 >= +process.env.MAXV)) continue;
    if (on && on !== layer) { await ev((l) => window.toggleLayer(l), on); await sleep(1500); on = null; }
    await L.jump(page, lng, lat, z); await sleep(1500);
    if (!on) { await ev((l) => window.toggleLayer(l), layer); on = layer; }
    await sleep(9000); await home();
    if (MODE === 'h8f') {
      // H8f (log section 23.1): h and h+3 settled on their fine grid, h+6 never visited; the held picture mixes fine h with the
      // coarse STAND-IN of h+6. Hours are visited in order, so each triple's jump is the first visit to its last hour.
      await ev(() => window.__HM__.kill(true));
      const settleStep = async () => { await ev(() => window.__HM__.key('ArrowRight', 3)); return ev(() => window.__HM__.settle()); };
      const s1 = await settleStep(); const s2 = await settleStep();
      used[layer] = (used[layer] || 0) + 1; vi += 1; const triples = [];
      for (let j = 1; j <= 4; j++) {
        await home(); await stepTo(j, 900); const stA = await ev(async () => { const H = window.__HM__; H.F.A = await H.shot(); return H.state(); });
        await stepTo(1, 900); const stT = await ev(async () => { const H = window.__HM__; H.F.T = await H.shot(); return H.state(); });
        await home(); await stepTo(j, 900); const before = await ev(() => window.__HM__.state());
        const held = await ev(async () => {
          const H = window.__HM__; H.kill(false); window.__RAW_CREST_BLEND_HOLD__ = 0.5; H.key('ArrowRight', 6); await H.wait(250);
          const M = await H.shot(); const stM = H.state();
          window.__RAW_CREST_BLEND_HOLD__ = 1; const C = await H.shot(); const stC = H.state();     // the stand-in alone
          window.__RAW_CREST_BLEND_HOLD__ = null; H.kill(true);
          return { stM, stC, eBlend: H.mad(M, H.F.T), eCutA: H.mad(H.F.A, H.F.T), eCutB: H.mad(C, H.F.T), retTruth: H.std(M) / H.std(H.F.T) };
        });
        const settled = await ev(() => window.__HM__.settle());                                   // hour j+2 gets its fine grid: settled for the next triple
        await home(); await stepTo(j + 1, 900);
        const again = await ev(async () => { const H = window.__HM__; const lum = await H.shot(); return { noise: H.mad(lum, H.F.T), st: H.state() }; });
        const want = new Date(Date.parse(stT.valid) + 3 * 3600e3).toISOString().replace('.000Z', 'Z');
        const fineOk = stA.dims === stT.dims && before.dims === stA.dims && before.valid === stA.valid;
        const standIn = held.stM.dims !== stA.dims && held.stC.dims === held.stM.dims && held.stM.valid === want && held.stM.prevValid === stA.valid && held.stM.mix === 0.5 && held.stC.mix === 0;
        const eCut = Math.min(held.eCutA, held.eCutB);
        const t = { j, dims: stA.dims, grids: [stA.dims, stT.dims, held.stM.dims, held.stM.prevDims, held.stC.dims], mixed: [held.stM.prevValid, held.stM.valid], hidden: stT.valid,
          eBlend: r4(held.eBlend), eCut: r4(eCut), eCutA: r4(held.eCutA), eCutB: r4(held.eCutB), retTruth: r4(held.retTruth), truthNoise: r4(again.noise), truthGrid2: again.st.dims,
          settledAfter: settled, startsDelta: held.stM.starts - before.starts };
        const quiet = !(again.noise > (eCut - held.eBlend)) || eCut <= held.eBlend;
        triples.push(fineOk && standIn && quiet ? t : { ...t, leftOut: !fineOk ? 'fine_not_settled' : !standIn ? 'not_the_stand_in' : 'truth_noise' });
      }
      const out = { view: vi, mode: MODE, layer, lng, lat, z, theme: THEME, drawnLayer: layer, settle: [s1, s2], triples, swaps: [], errors: errs.slice(0, 4) };
      fs.appendFileSync(path.join(OUT, `hm-${THEME}.jsonl`), JSON.stringify(out) + '\n');
      console.log(`view ${vi} ${layer} z${z}: H8f ` + triples.map((t) => (t.leftOut ? `[out:${t.leftOut} ${t.grids.join('|')}]` : `${t.eBlend}/${t.eCut} (fine ${t.eCutA}, stand-in ${t.eCutB}; noise ${t.truthNoise})`)).join('  '));
      await home();
      continue;
    }
    await ev(() => window.__HM__.kill(true)); await stepTo(9, WARM_MS); await home();          // warm: every hour used below becomes resident
    await ev(() => { window.__HM__.R = {}; window.__HM__.T = {}; });
    const real = {};
    for (let j = 1; j <= 8; j++) { await stepTo(1); await sleep(600); real[j] = await ev(async (k) => { const H = window.__HM__; H.R[k] = await H.shot(); H.T[k] = H.tex(); return H.state(); }, j); }
    const stable = ANYGRID || Object.values(real).every((x) => x.dims === real[1].dims && x.layer === layer);
    if (!stable) { skipped.push(`${layer}@${lng},${lat},z${z}:${[...new Set(Object.values(real).map((x) => x.dims))].join('/')}`); console.log(`skipped ${skipped[skipped.length - 1]}`); await home(); continue; }
    used[layer] = (used[layer] || 0) + 1; vi += 1;
    const triples = [];
    for (let j = 1; process.env.ONLY_SWAPS !== '1' && j <= 4; j++) {
      let got = null;
      for (let attempt = 0; attempt < 2 && !got; attempt++) {
        let jump = null;
        if (process.env.JUMPCHK === '1') {   // a diagnosis: the same 6 h jump with the blend KILLED, against the at-rest picture of h+6
          await home(); await ev(() => window.__HM__.kill(true)); await stepTo(j); await sleep(600);
          jump = await ev(async (k) => { const H = window.__HM__; H.key('ArrowRight', 6); const o = {}; for (const ms of [250, 900, 2500, 5000]) { await H.wait(ms - (o.last || 0)); o.last = ms; const J = await H.shot(); const st = H.state(); o['at' + ms] = [+H.mad(J, H.R[k + 2]).toFixed(3), st.dims, st.valid.slice(11, 16)]; } delete o.last; return o; }, j);
        }
        await home(); await ev(() => window.__HM__.kill(true)); await stepTo(j); await sleep(600);
        const before = await ev(() => window.__HM__.state());
        const held = await ev(async (k) => {
          const H = window.__HM__; const R = H.R; const T = H.T;
          H.kill(false); window.__RAW_CREST_BLEND_HOLD__ = 0.5; H.key('ArrowRight', 6); await H.wait(900);
          const M = await H.shot(); const st = H.state();
          // what the shader is mixing, read back: the kept texture's bytes against T[h], the resident's against T[h+6], and the scales
          let probe = null;
          try { const e = window.__MARINE_ENGINE__; const gl = (window.__MAP_INSTANCE__ || window.map).painter.context.gl; const p = e._hourPrev; const w = e._texWidth; const h = e._texHeight;
            const rd = (tex) => { const fb0 = gl.getParameter(gl.FRAMEBUFFER_BINDING); const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); const b = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); gl.bindFramebuffer(gl.FRAMEBUFFER, fb0); gl.deleteFramebuffer(fb); return b; };
            const cmp = (a, b) => { if (!a || !b || a.length !== b.length) return -1; let n = 0; let mx = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) n += 1; if (d > mx) mx = d; } return [n, mx]; };
            probe = { prevVsTh: p ? cmp(rd(p.wave), T[k].b) : null, residentVsTh6: cmp(rd(e._residentWaveTex), T[k + 2].b), prevScale: p ? p.scale : null, nowScale: e._waveData.u_heightScale || 10, tScales: [T[k].scale, T[k + 1].scale, T[k + 2].scale], prevCols: p ? [p.cols, p.rows] : null, tex: [w, h], prevBounds: p ? p.bounds : null, nowBounds: e._waveData.bounds, opacity: e._lastHeatmapOpacity, ease: !!e._opacityEase };
          } catch (err) { probe = { error: String(err).slice(0, 120) }; }
          window.__RAW_CREST_BLEND_HOLD__ = null; await H.wait(500); H.kill(true); await H.wait(100);
          // the reference: the exact average of the two hours' bytes, drawn at rest through the unchanged path
          let ref = null; const now = H.tex();
          if (T[k].b.length === now.b.length && T[k + 2].b.length === now.b.length) {
            const mid = new Uint8Array(now.b.length); for (let i = 0; i < mid.length; i++) mid[i] = Math.round(0.5 * (T[k].b[i] + T[k + 2].b[i]));
            H.put(mid); const REF = await H.shot();
            const lo = new Uint8Array(now.b.length); const hi = new Uint8Array(now.b.length);
            for (let i = 0; i < lo.length; i++) { const v = 0.5 * (T[k].b[i] + T[k + 2].b[i]); lo[i] = Math.floor(v); hi[i] = Math.ceil(v); }
            H.put(lo); const LO = await H.shot(); H.put(hi); const HI = await H.shot();
            H.put(now.b); const N1 = await H.shot(); const N2 = await H.shot();
            const base = Math.min(H.std(R[k]), H.std(R[k + 2]));
            ref = { outside: H.outside(M, LO, HI), diff: H.mad(M, REF), retM: H.std(M) / base, retRef: H.std(REF) / base, toLo: H.mad(M, LO), toHi: H.mad(M, HI), loHi: H.mad(LO, HI), noise: H.mad(N1, N2), restVsReal: H.mad(N1, R[k + 2]) };
          }
          const flat = H.avg(R[k], R[k + 4]);
          return { st, ref, probe, eBlend: H.mad(M, R[k + 1]), eCutA: H.mad(R[k], R[k + 1]), eCutB: H.mad(R[k + 2], R[k + 1]), eFlat: H.mad(flat, R[k + 1]),
            retTruth: H.std(M) / H.std(R[k + 1]), flatRetTruth: H.std(flat) / H.std(R[k + 1]),
            values: (T[k].b.length === T[k + 1].b.length && T[k + 2].b.length === T[k + 1].b.length) ? H.values(T[k], T[k + 2], T[k + 1]) : null };
        }, j);
        // the truth picture a second time (section 19.3a / 22): back to hour j+1, read again
        await home(); await ev(() => window.__HM__.kill(true)); await stepTo(j + 1); await sleep(900);
        const again = await ev(async (k) => { const H = window.__HM__; const lum = await H.shot(); return { noise: H.mad(lum, H.R[k + 1]), st: H.state() }; }, j);
        const sameGridAll = [real[j], real[j + 1], real[j + 2], before, held.st].every((s) => s.dims === real[j].dims);
        const rightHours = before.valid === real[j].valid && held.st.valid === real[j + 2].valid;
        const mixedRight = held.st.prevValid === real[j].valid && held.st.valid === real[j + 2].valid;      // the two textures the shader mixed: h and h+6, never h+3
        const oneBlend = held.st.starts - before.starts === 1 && held.st.mix === 0.5;
        const t = { j, attempt, sameGridAll, rightHours, mixedRight, oneBlend, dims: real[j].dims, mixed: [held.st.prevValid, held.st.valid], hidden: real[j + 1].valid,
          eBlend: r4(held.eBlend), eCut: r4(Math.min(held.eCutA, held.eCutB)), eFlat: r4(held.eFlat), retTruth: r4(held.retTruth), flatRetTruth: r4(held.flatRetTruth),
          refDiff: held.ref ? r4(held.ref.diff) : null, retM: held.ref ? r4(held.ref.retM) : null, retRef: held.ref ? r4(held.ref.retRef) : null,
          outside: held.ref ? +held.ref.outside.toFixed(5) : null,
          diag: held.ref ? { toLo: r4(held.ref.toLo), toHi: r4(held.ref.toHi), loHi: r4(held.ref.loHi), noise: r4(held.ref.noise), restVsReal: r4(held.ref.restVsReal) } : null,
          values: held.values && Object.fromEntries(Object.entries(held.values).map(([k2, v]) => [k2, r4(v)])), startsDelta: held.st.starts - before.starts, mix: held.st.mix };
        t.truthNoise = r4(again.noise); t.truthGrid2 = again.st.dims; t.truthSameHour = again.st.valid === real[j + 1].valid;
        t.probe = held.probe; t.jump = jump;
        t.grids = [real[j].dims, real[j + 1].dims, real[j + 2].dims, held.st.prevDims, held.st.dims];   // h, the hidden h+3, h+6 at rest; the two fields mixed
        const gridOk = ANYGRID || sameGridAll;
        const quiet = !(t.truthNoise > (t.eCut - t.eBlend)) || t.eCut <= t.eBlend;   // a noise floor above the cut-blend gap: not scored
        if (gridOk && rightHours && mixedRight && oneBlend && quiet) got = t;
        else if (attempt === 1) got = { ...t, leftOut: !gridOk ? 'grid' : !rightHours ? 'hours' : !mixedRight ? 'mixed_wrong_hours' : !oneBlend ? 'in_between_drawn' : 'truth_noise' };
      }
      triples.push(got);
    }
    // H9 (forced, section 13.2): four hours per view
    const swaps = [];
    for (let j = 1; SWAPS && j <= 4; j++) {
      await home(); await ev(() => window.__HM__.kill(true)); await stepTo(j); await sleep(900);
      const r = await ev(() => window.__HM__.forced());
      if (r.miss) { swaps.push({ j, miss: r.miss }); continue; }
      const okMix = r.mixes[0] === 1 && r.mixes[1] === 0.5;
      swaps.push({ j, coarse: r.coarse, fine: r.fine, eHeld: r4(r.eHeld), eCoarse: r4(r.eCoarse), eShift: r4(r.eShift), retHeld: r4(r.retHeld), restNoise: r4(r.restNoise), ...(r.stable && okMix ? {} : { miss: !r.stable ? 'engine_changed' : 'mix_not_held' }) });
    }
    const out = { view: vi, mode: MODE, layer, lng, lat, z, theme: THEME, drawnLayer: real[1].layer, skippedSoFar: [...skipped], triples, swaps, errors: errs.slice(0, 4) };
    fs.appendFileSync(path.join(OUT, `hm-${THEME}.jsonl`), JSON.stringify(out) + '\n');
    console.log(`view ${vi} ${layer}: H8 ` + triples.map((t) => (t.leftOut ? `[out:${t.leftOut}]` : `${t.eBlend}/${t.eCut}`)).join(' ') + ' | H9 ' + swaps.map((s) => (s.miss ? `[${s.miss}]` : `${s.eHeld}/${s.eCoarse}/${s.eShift}`)).join(' '));
    await home();
  }
  await browser.close();
})().catch((e) => { console.error(String(e && e.stack || e).replace(/access_token=[^&\s"']+/g, 'access_token=REDACTED')); process.exit(1); });
