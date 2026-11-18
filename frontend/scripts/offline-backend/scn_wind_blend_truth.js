// The wind hour blend's truth lines: W5 (self-mix), W6 (the values drawn are the exact mix), W7 (the hidden middle hour), W8a
// (speed kept through the mix). Gate: docs/weather-program/log/2026-11-15-fable-wind-hour-blend.md. Offline only; particles
// not drawn; the cache settled first (every hour's own grid has arrived).
// Per view:
//   real  : with the kill set, +3 h at a time; each hour's base texture bytes and u/v range T[j], and its colour picture R[j], j = 1..8
//   held  : for j = 1..4 the engine shows hour j, then with the blend on and HELD at 0.5 it steps straight to hour j+2 (six key
//           steps in one task); 3 s later the colour picture M and the VALUE picture (u, v as red, green) are read
//   W6    : the value picture against two references drawn at rest through the same shader: the two hours' vectors averaged, encoded
//           in the resident texture's range, rounded DOWN and rounded UP; per pixel and channel the held value must lie between them
//   W7    : in value space from the bytes: mean |0.5 (a + b) - t| in knots against the nearer of mean |a - t| and mean |b - t|
//           (a, b, t = hours j, j+2, j+1, each decoded with its own range); and the same on the colour pictures, truth read twice
//   W8a   : mean |0.5 (a + b)| / mean of the two speeds; the control: the same on the moving part (each node's 8-hour mean removed)
//           for two hours 12 h apart
//   W5    : at rest, the lab hands the blend an exact copy of the resident base as the earlier field: held at 0 and at 0.5 the colour
//           picture must be the picture at rest; with the copy placed one cell east and north it must not be
//   PORT=4203 AB_BASE=http://127.0.0.1:3198 RR_DIR=<cache> OUT=<dir> [THEME=dark] [VP=desktop|phone] [VIEWS=..] [ONLY=w5] node scn_wind_blend_truth.js
if (process.env.AB_LIVE === '1') throw Error('scn_wind_blend_truth is offline only');
const fs = require('fs'); const path = require('path');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const OUT = process.env.OUT; const THEME = process.env.THEME || 'dark'; const PHONE = process.env.VP === 'phone'; const ONLY = process.env.ONLY || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWS = [[-40, 35, 2.5], [-140, 20, 3.0], [20, -40, 3.5], [150, -20, 3.0], [-106, 14, 4.0], [-158, 21.6, 5.0], [-9.5, 39, 5.0], [150, -34, 5.0], [-123, 37.5, 5.0], [-5, 50, 4.5]];
const PICK = process.env.VIEWS ? process.env.VIEWS.split(',').map(Number) : VIEWS.map((_, i) => i);

const SPY = () => {
  const H = (window.__WT__ = { R: {}, T: {} });
  const P = WebGL2RenderingContext.prototype; let cur = null;
  const up = P.useProgram; P.useProgram = function (pr) { cur = pr; return up.call(this, pr); };
  for (const k of ['drawArrays', 'drawElements']) { const o = P[k]; P[k] = function (...a) { const e = window.__WIND_ENGINE__; if (e && cur && (cur === e.drawProgram || cur === e.screenProgram || cur === e.fadeProgram)) return undefined; return o.apply(this, a); }; }
  const map = () => window.__MAP_INSTANCE__ || window.map; const eng = () => window.__WIND_ENGINE__; const gl = () => map().painter.context.gl;
  const frame = () => new Promise((res) => { const m = map(); m.once('render', () => { const g = gl(); const w = g.drawingBufferWidth; const h = g.drawingBufferHeight; const px = new Uint8Array(w * h * 4); g.bindFramebuffer(g.FRAMEBUFFER, null); g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px); res(px); }); m.triggerRepaint(); });
  H.shot = async () => { window.__GPU_DEBUG__ = { mode: null }; await frame(); const px = await frame(); const lum = new Float32Array(px.length / 4); for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; return lum; };
  H.shotUV = async () => { window.__GPU_DEBUG__ = { mode: 'value' }; await frame(); const px = await frame(); window.__GPU_DEBUG__ = { mode: null }; const n = px.length / 4; const u = new Uint8Array(n); const v = new Uint8Array(n); for (let i = 0, j = 0; j < n; i += 4, j++) { u[j] = px[i]; v[j] = px[i + 1]; } return { u, v }; };
  H.mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  H.readTex = (tex, w, h) => { const g = gl(); const fb0 = g.getParameter(g.FRAMEBUFFER_BINDING); const fb = g.createFramebuffer(); g.bindFramebuffer(g.FRAMEBUFFER, fb); g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0); const b = new Uint8Array(w * h * 4); g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, b); g.bindFramebuffer(g.FRAMEBUFFER, fb0); g.deleteFramebuffer(fb); return b; };
  H.tex = () => { const b = eng()._windData; const gr = b.windGrid; return { b: H.readTex(b.texture, gr.cols, gr.rows), w: gr.cols, h: gr.rows, min: [...b.uMin], max: [...b.uMax], bounds: { ...b.bounds } }; };
  H.put = (bytes) => { const g = gl(); const b = eng()._windData; const t0 = g.getParameter(g.TEXTURE_BINDING_2D); const flip = g.getParameter(g.UNPACK_FLIP_Y_WEBGL); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false); g.bindTexture(g.TEXTURE_2D, b.texture);
    g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, b.windGrid.cols, b.windGrid.rows, g.RGBA, g.UNSIGNED_BYTE, bytes); g.bindTexture(g.TEXTURE_2D, t0); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, !!flip); };
  H.state = () => { const e = eng(); const b = e && e._windData; const g = b && b.windGrid; const p = e && e._windPrev; const t = window.__RAW_WIND_HOUR_BLEND__ || {};
    return g ? { dims: `${g.cols}x${g.rows}`, valid: String(g.valid_time || g.validTime || ''), fine: !!(e._windFine), prevValid: p ? p.validTime : null, prevDims: p ? `${p.cols}x${p.rows}` : null, mix: t.mix || 0, starts: t.starts || 0, blend: !!e._windBlend } : { none: true }; };
  H.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  H.settle = async (wasValid, limit = 10000) => { const s0 = performance.now(); const sig = () => { const s = H.state(); return `${s.dims}|${s.valid}|${s.fine}`; }; let last = sig(); let since = s0;
    while (performance.now() - s0 < limit) { await H.wait(60); const d = sig(); if (d !== last) { last = d; since = performance.now(); } if (H.state().valid !== wasValid && performance.now() - since >= 1500) return { ok: true, ms: Math.round(performance.now() - s0) }; }
    return { ok: false, ms: limit }; };
  H.key = (key, n) => { const el = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/.test(x.getAttribute('aria-label') || '') && x.offsetParent !== null);
    if (!el) return false; el.focus(); for (let i = 0; i < n; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); return true; };
  H.kill = (on) => { if (on) window.__RAW_DISABLE_WIND_HOUR_BLEND__ = true; else delete window.__RAW_DISABLE_WIND_HOUR_BLEND__; };
  const dec = (T, i) => [T.min[0] + (T.max[0] - T.min[0]) * T.b[i * 4] / 255, T.min[1] + (T.max[1] - T.min[1]) * T.b[i * 4 + 1] / 255];
  // value space, from the bytes (knots)
  H.values = (A, B, Tr) => { const n = A.w * A.h; let eb = 0; let ca = 0; let cb = 0; let half = 0; let sp = 0;
    for (let i = 0; i < n; i++) { const a = dec(A, i); const b = dec(B, i); const t = dec(Tr, i); const m = [0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1])];
      eb += Math.hypot(m[0] - t[0], m[1] - t[1]); ca += Math.hypot(a[0] - t[0], a[1] - t[1]); cb += Math.hypot(b[0] - t[0], b[1] - t[1]); half += Math.hypot(m[0], m[1]); sp += 0.5 * (Math.hypot(a[0], a[1]) + Math.hypot(b[0], b[1])); }
    return { nodes: n, eBlend: eb / n, eCut: Math.min(ca, cb) / n, eCutA: ca / n, eCutB: cb / n, retention: half / sp }; };
  // W8a control: the moving part alone (each node's mean over the stored hours removed), two hours 12 h apart
  H.moving = (ja, jb) => { const T = H.T; const keys = Object.keys(T).map(Number).filter((k) => T[k].b.length === T[ja].b.length); const n = T[ja].w * T[ja].h; let half = 0; let sp = 0;
    for (let i = 0; i < n; i++) { let mu = 0; let mv = 0; for (const k of keys) { const d = dec(T[k], i); mu += d[0]; mv += d[1]; } mu /= keys.length; mv /= keys.length;
      const a = dec(T[ja], i); const b = dec(T[jb], i); const wa = [a[0] - mu, a[1] - mv]; const wb = [b[0] - mu, b[1] - mv];
      half += Math.hypot(0.5 * (wa[0] + wb[0]), 0.5 * (wa[1] + wb[1])); sp += 0.5 * (Math.hypot(wa[0], wa[1]) + Math.hypot(wb[0], wb[1])); }
    return half / Math.max(1e-9, sp); };
  // W6: the references. The two hours' vectors averaged, encoded in the RESIDENT texture's range, rounded down / up.
  H.refBytes = (A, B, up) => { const n = A.w * A.h; const out = new Uint8Array(B.b); for (let i = 0; i < n; i++) { const a = dec(A, i); const b = dec(B, i);
      for (let c = 0; c < 2; c++) { const e = (0.5 * (a[c] + b[c]) - B.min[c]) / (B.max[c] - B.min[c]) * 255; out[i * 4 + c] = Math.max(0, Math.min(255, up ? Math.ceil(e) : Math.floor(e))); } }
    return out; };
  H.outside = (M, LO, HI, widen) => { let n = 0; const N = M.u.length; for (let i = 0; i < N; i++) { for (const c of ['u', 'v']) { const lo = Math.min(LO[c][i], HI[c][i]) - widen; const hi = Math.max(LO[c][i], HI[c][i]) + widen; if (M[c][i] < lo || M[c][i] > hi) { n += 1; break; } } } return n / N; };
  // W5: an exact copy of the resident base as the earlier field
  H.selfMix = async () => {
    const e = eng(); const g = gl(); const b = e._windData; const gr = b.windGrid; const bytes = H.readTex(b.texture, gr.cols, gr.rows);
    const t0 = g.getParameter(g.TEXTURE_BINDING_2D); const flip = g.getParameter(g.UNPACK_FLIP_Y_WEBGL); const tex = g.createTexture();
    const bb = b.bounds; const spanLng = (bb.east < bb.west ? bb.east + 360 : bb.east) - bb.west; const global = spanLng >= 350;
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false); g.bindTexture(g.TEXTURE_2D, tex);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, global ? g.REPEAT : g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, gr.cols, gr.rows, 0, g.RGBA, g.UNSIGNED_BYTE, bytes); g.bindTexture(g.TEXTURE_2D, t0); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, !!flip);
    const REST = await H.shot(); const before = H.state();
    const prev = { texture: tex, uMin: [...b.uMin], uMax: [...b.uMax], bounds: { ...bb }, cols: gr.cols, rows: gr.rows, reg: [-1 / gr.cols, -1 / gr.rows, 0.5 / gr.cols, 0.5 / gr.rows], validTime: 'lab' };
    let out;
    try {
      H.kill(false); e._windPrev = prev; e._windBlend = { t0: 0, ms: 160 };
      window.__RAW_WIND_BLEND_HOLD__ = 0; const P0 = await H.shot(); const m0 = H.state().mix;
      window.__RAW_WIND_BLEND_HOLD__ = 0.5; const P5 = await H.shot(); const m5 = H.state().mix;
      const dx = spanLng / (gr.cols - 1); const dy = (bb.north - bb.south) / (gr.rows - 1);
      e._windPrev = { ...prev, bounds: { west: bb.west + dx, east: bb.east + dx, south: bb.south + dy, north: bb.north + dy } }; const SH = await H.shot();
      out = { dims: `${gr.cols}x${gr.rows}`, global, mixes: [m0, m5], prevOnly: H.mad(P0, REST), half: H.mad(P5, REST), shifted: H.mad(SH, REST) };
    } finally { window.__RAW_WIND_BLEND_HOLD__ = null; e._windBlend = null; e._windPrev = null; H.kill(true); g.deleteTexture(tex); }
    const after = H.state(); const AGAIN = await H.shot();
    return { ...out, stable: after.dims === before.dims && after.valid === before.valid, restAgain: H.mad(AGAIN, REST) };
  };
};
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(4));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'auto' });
  const { browser, page } = await L.launch(PHONE ? { port: +(process.env.PORT || 4203), width: 390, height: 844, dpr: 2, contextOptions: { isMobile: true, hasTouch: true } } : { port: +(process.env.PORT || 4203), width: 1280, height: 800, dpr: 1 });
  await rr.install(page); await page.addInitScript(SPY);
  await page.addInitScript((theme) => { try { localStorage.setItem('raw-surf-theme', theme); } catch (e) { /* private mode */ } window.__RAW_ENABLE_HOUR_BLEND__ = true; /* the blend is opt-in: both arms load the blended shaders, arm A sets the kill */ window.__RAW_STATIC_FRAMES_BASE__ = 'http://127.0.0.1:4293/'; }, THEME);
  if (process.env.FINE_OFF === '1') await page.addInitScript(() => { window.__RAW_DISABLE_WIND_VIEWPORT_FINE__ = true; });   // log section 13: the diagnostic's FINE-OFF arm
  const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 160).replace(/access_token=[^&\s"']+/g, 'access_token=REDACTED')));
  await L.openMap(page);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const home = async () => { await ev(() => window.__WT__.key('Home', 1)); await sleep(2500); };
  const stepTo = async (n, wait = 800) => { for (let i = 0; i < n; i++) { await ev(() => window.__WT__.key('ArrowRight', 3)); await sleep(wait); } };
  await ev(() => window.toggleLayer('wind')); await sleep(9000);
  for (const vi of PICK) {
    const [lng, lat, z] = VIEWS[vi];
    await L.jump(page, lng, lat, z); await sleep(4000); await home();
    await ev(() => window.__WT__.kill(true)); const settles = [];
    for (let i = 0; i < 9; i++) settles.push(await ev(async () => { const H = window.__WT__; const was = H.state().valid; H.key('ArrowRight', 3); return H.settle(was); }));
    await home();
    const out = { view: vi, lng, lat, z, theme: THEME, vp: PHONE ? 'phone' : 'desktop', settles, self: [], triples: [] };
    // W5: two hours per view
    for (const j of [1, 3]) { await home(); await stepTo(j); await sleep(700); const r = await ev(() => window.__WT__.selfMix()); out.self.push({ j, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? r4(v) : v])) }); }
    if (ONLY !== 'w5') {
      await home(); await ev(() => { window.__WT__.R = {}; window.__WT__.T = {}; });
      const real = {};
      for (let j = 1; j <= 8; j++) { await stepTo(1); await sleep(400); real[j] = await ev(async (k) => { const H = window.__WT__; H.R[k] = await H.shot(); H.T[k] = H.tex(); return H.state(); }, j); }
      for (let j = 1; j <= 4; j++) {
        await home(); await ev(() => window.__WT__.kill(true)); await stepTo(j); await sleep(600);
        const before = await ev(() => window.__WT__.state());
        const held = await ev(async (k) => {
          const H = window.__WT__; const R = H.R; const T = H.T; const e = window.__WIND_ENGINE__;
          H.kill(false); window.__RAW_WIND_BLEND_HOLD__ = 0.5; H.key('ArrowRight', 6); await H.wait(3000);
          const M = await H.shot(); const MV = await H.shotUV(); const st = H.state();
          const p = e._windPrev; const same = T[k].b.length === T[k + 2].b.length && T[k].b.length === T[k + 1].b.length;
          const cmp = (a, b) => { if (!a || !b || a.length !== b.length) return -1; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n += 1; return n; };
          const mixing = { prevVsTh: p ? cmp(H.readTex(p.texture, p.cols, p.rows), T[k].b) : null, baseVsTh6: cmp(H.readTex(e._windData.texture, e._windData.windGrid.cols, e._windData.windGrid.rows), T[k + 2].b) };
          window.__RAW_WIND_BLEND_HOLD__ = null; await H.wait(500); H.kill(true); await H.wait(100);
          let bracket = null;
          if (same) { const now = H.tex(); H.put(H.refBytes(T[k], T[k + 2], false)); const LO = await H.shotUV(); H.put(H.refBytes(T[k], T[k + 2], true)); const HI = await H.shotUV(); H.put(now.b); await H.shot();
            bracket = { outside: H.outside(MV, LO, HI, 1), outside0: H.outside(MV, LO, HI, 0), loHi: (H.mad(LO.u, HI.u) + H.mad(LO.v, HI.v)) / 2 }; }
          return { st, mixing, bracket, same, values: same ? H.values(T[k], T[k + 2], T[k + 1]) : null, control: (same && T[k + 4] && T[k + 4].b.length === T[k].b.length) ? H.moving(k, k + 4) : null,
            moving3: same ? H.moving(k, k + 2) : null, pBlend: H.mad(M, R[k + 1]), pCutA: H.mad(R[k], R[k + 1]), pCutB: H.mad(R[k + 2], R[k + 1]), toOld: H.mad(M, R[k]), toNew: H.mad(M, R[k + 2]) };
        }, j);
        await home(); await ev(() => window.__WT__.kill(true)); await stepTo(j + 1); await sleep(700);
        const again = await ev(async (k) => { const H = window.__WT__; const lum = await H.shot(); return { noise: H.mad(lum, H.R[k + 1]), st: H.state() }; }, j);
        const grids = [real[j].dims, real[j + 1].dims, real[j + 2].dims, held.st.prevDims, held.st.dims];
        const okHours = before.valid === real[j].valid && held.st.valid === real[j + 2].valid && held.st.prevValid === real[j].valid;
        const okBlend = held.st.mix === 0.5 && held.st.starts - before.starts >= 1;
        const t = { j, fine: !!held.st.fine, toOld: r4(held.toOld), toNew: r4(held.toNew), pCutA: r4(held.pCutA), pCutB: r4(held.pCutB), grids, sameGrid: new Set(grids).size === 1, okHours, okBlend, mixed: [held.st.prevValid, held.st.valid], hidden: real[j + 1].valid, mixing: held.mixing,
          values: held.values && Object.fromEntries(Object.entries(held.values).map(([k2, v]) => [k2, r4(v)])), control12h: r4(held.control), moving6h: r4(held.moving3),
          bracket: held.bracket && { outside: +held.bracket.outside.toFixed(5), outside0: +held.bracket.outside0.toFixed(5), loHi: r4(held.bracket.loHi) },
          pBlend: r4(held.pBlend), pCut: r4(Math.min(held.pCutA, held.pCutB)), truthNoise: r4(again.noise), startsDelta: held.st.starts - before.starts };
        out.triples.push(okHours && okBlend ? t : { ...t, leftOut: !okHours ? 'hours' : 'blend_not_held' });
      }
    }
    out.errors = errs.slice(0, 4);
    fs.appendFileSync(path.join(OUT, `wt-${THEME}-${PHONE ? 'phone' : 'desktop'}.jsonl`), JSON.stringify(out) + '\n');
    console.log(`view ${vi} z${z}: W5 ` + out.self.map((s) => `${s.dims} prev-only ${s.prevOnly} half ${s.half} shifted ${s.shifted}`).join(' ; ')
      + ' | W7 ' + out.triples.map((t) => (t.leftOut ? `[out:${t.leftOut}]` : (t.values ? `${t.values.eBlend}/${t.values.eCut}kn` : 'n/a') + ` pic ${t.pBlend}/${t.pCut}`)).join('  '));
    await home();
  }
  await browser.close();
})().catch((e) => { console.error(String(e && e.stack || e).replace(/access_token=[^&\s"']+/g, 'access_token=REDACTED')); process.exit(1); });
