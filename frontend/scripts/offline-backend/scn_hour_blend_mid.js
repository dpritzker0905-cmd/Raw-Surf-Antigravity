// H8, the hidden middle hour (docs/weather-program/log/2026-11-15-fable-crest-hour-blend.md, section 9). Offline only.
// Per view, particles not drawn:
//   real frames  : with the kill set (hard cut), the engine steps +3 h at a time and each hour's picture is read at rest: R[1..6]
//   held pictures: for j = 1..4, the engine shows hour j (kill set), then with the blend on and HELD at 0.5 it steps straight
//                  to hour j+2 (six ArrowRight keydowns in one task); the picture is the half-way mix of j and j+2: M[j]
//   scores       : ERROR(blend) = mean |M[j] - R[j+1]|;  ERROR(cut) = min(mean |R[j] - R[j+1]|, mean |R[j+2] - R[j+1]|)
// A triple is left out (and counted) when the grid differs among its frames or an in-between hour was drawn during the jump.
//   PORT=4201 AB_BASE=http://127.0.0.1:3198 RR_DIR=<cache> OUT=<dir> [VIEWS=0,1,..] node scn_hour_blend_mid.js
if (process.env.AB_LIVE === '1') throw Error('scn_hour_blend_mid is offline only');
const fs = require('fs'); const path = require('path');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const OUT = process.env.OUT; const THEME = process.env.THEME || 'dark';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWS = [
  ['waves', -158.0, 21.6, 5.0], ['waves', -9.5, 39.0, 5.0], ['waves', 150.0, -34.0, 5.0], ['waves', -40.0, 35.0, 2.5], ['waves', -140.0, 20.0, 3.0],
  ['waves', 20.0, -40.0, 3.5], ['swell_1', -123.0, 37.5, 5.0], ['swell_1', -60.0, 30.0, 3.5], ['swell_2', 115.0, -10.0, 4.0], ['wind_waves', -5.0, 50.0, 4.5],
];
const PICK = process.env.VIEWS ? process.env.VIEWS.split(',').map(Number) : VIEWS.map((_, i) => i);

const SPY = () => {
  const H = (window.__HM__ = { hide: true, R: {}, });
  const src = new WeakMap(); const isParticle = new WeakMap(); const P = WebGL2RenderingContext.prototype;
  const ss = P.shaderSource; P.shaderSource = function (sh, s) { src.set(sh, s); return ss.call(this, sh, s); };
  const as = P.attachShader; P.attachShader = function (pr, sh) { if (/u_trochoidal/.test(src.get(sh) || '')) isParticle.set(pr, true); return as.call(this, pr, sh); };
  let cur = null; const up = P.useProgram; P.useProgram = function (pr) { cur = pr; return up.call(this, pr); };
  for (const k of ['drawArrays', 'drawElements']) { const o = P[k]; P[k] = function (...a) { if (H.hide && cur && isParticle.get(cur)) return undefined; return o.apply(this, a); }; }
  const map = () => window.__MAP_INSTANCE__ || window.map;
  H.shot = () => new Promise((res) => { const m = map(); m.once('render', () => {
    const gl = m.painter.context.gl; const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight; const px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const lum = new Float32Array(w * h); for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    res(lum); }); m.triggerRepaint(); });
  H.mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  H.std = (a) => { let m = 0; for (let i = 0; i < a.length; i++) m += a[i]; m /= a.length; let v = 0; for (let i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m); return Math.sqrt(v / a.length); };
  H.state = () => { const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid; const t = window.__RAW_CREST_HOUR_BLEND__ || {};
    return { dims: e ? `${e._texWidth}x${e._texHeight}` : null, layer: g ? (g.__componentLayer || 'waves') : null, hour: g ? g.hourOffset : null, valid: g ? String(g.served_valid_time || g.valid_time || '') : null,
      starts: t.starts || 0, kept: t.kept || 0, mix: t.mix || 0, blend: !!(e && e._hourBlend) }; };
  H.key = (key, n) => { const el = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/.test(x.getAttribute('aria-label') || '') && x.offsetParent !== null);
    if (!el) return false; el.focus(); for (let i = 0; i < n; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); return true; };
  H.kill = (on) => { if (on) window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true; else delete window.__RAW_DISABLE_CREST_HOUR_BLEND__; };
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
  const home = async () => { await ev(() => window.__HM__.key('Home', 1)); await sleep(2500); };
  const stepTo = async (n) => { for (let i = 0; i < n; i++) { await ev(() => window.__HM__.key('ArrowRight', 3)); await sleep(700); } };
  let on = null;
  for (const vi of PICK) {
    const [layer, lng, lat, z] = VIEWS[vi];
    if (on && on !== layer) { await ev((l) => window.toggleLayer(l), on); await sleep(1500); on = null; }
    await L.jump(page, lng, lat, z); await sleep(1500);
    if (!on) { await ev((l) => window.toggleLayer(l), layer); on = layer; }
    await sleep(9000); await home();
    await ev(() => window.__HM__.kill(true)); await stepTo(7); await home();          // warm: every hour used below becomes resident
    // the real frames, at rest, hard cut
    await ev(() => { window.__HM__.R = {}; });
    const real = {};
    for (let j = 1; j <= 6; j++) { await stepTo(1); await sleep(500); real[j] = await ev(async (k) => { const H = window.__HM__; H.R[k] = await H.shot(); return H.state(); }, j); }
    const triples = [];
    for (let j = 1; j <= 4; j++) {
      let got = null;
      for (let attempt = 0; attempt < 2 && !got; attempt++) {
        await home(); await ev(() => window.__HM__.kill(true)); await stepTo(j); await sleep(500);
        const before = await ev(() => window.__HM__.state());
        const held = await ev(async (k) => {
          const H = window.__HM__; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          H.kill(false); window.__RAW_CREST_BLEND_HOLD__ = 0.5; H.key('ArrowRight', 6); await wait(900);
          const M = await H.shot(); const st = H.state();
          window.__RAW_CREST_BLEND_HOLD__ = null; await wait(500); H.kill(true);
          const R = H.R; return { st, eBlend: H.mad(M, R[k + 1]), eCutA: H.mad(R[k], R[k + 1]), eCutB: H.mad(R[k + 2], R[k + 1]), ends: H.mad(R[k], R[k + 2]),
            ret6: H.std(M) / Math.min(H.std(R[k]), H.std(R[k + 2])), retTruth: H.std(M) / H.std(R[k + 1]) };
        }, j);
        const sameGridAll = [real[j], real[j + 1], real[j + 2], before, held.st].every((s) => s.dims === real[j].dims);
        const rightHours = before.valid === real[j].valid && held.st.valid === real[j + 2].valid;
        const oneBlend = held.st.starts - before.starts === 1 && held.st.mix === 0.5;
        const t = { j, attempt, sameGridAll, rightHours, oneBlend, dims: real[j].dims, eBlend: r4(held.eBlend), eCut: r4(Math.min(held.eCutA, held.eCutB)), eCutA: r4(held.eCutA), eCutB: r4(held.eCutB), ends: r4(held.ends),
          ret6: r4(held.ret6), retTruth: r4(held.retTruth), startsDelta: held.st.starts - before.starts, keptDelta: held.st.kept - before.kept, mix: held.st.mix };
        if (sameGridAll && rightHours && oneBlend) got = t; else if (attempt === 1) got = { ...t, leftOut: !sameGridAll ? 'grid' : !rightHours ? 'hours' : 'in_between_drawn' };
      }
      triples.push(got);
    }
    const out = { view: vi, layer, lng, lat, z, theme: THEME, drawnLayer: real[1].layer, triples, errors: errs.slice(0, 4) };
    fs.appendFileSync(path.join(OUT, `hm-${THEME}.jsonl`), JSON.stringify(out) + '\n');
    console.log(`view ${vi} ${layer}: ` + triples.map((t) => (t.leftOut ? `[out:${t.leftOut}]` : `${t.eBlend}/${t.eCut}`)).join('  '));
    await home();
  }
  await browser.close();
  // score
  const rows = fs.readFileSync(path.join(OUT, `hm-${THEME}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const ok = rows.flatMap((r) => r.triples.filter((t) => !t.leftOut).map((t) => ({ ...t, view: r.view })));
  const sum = (a, k) => a.reduce((s, t) => s + t[k], 0);
  const worse = rows.filter((r) => { const t = r.triples.filter((x) => !x.leftOut); return t.length && sum(t, 'eBlend') > sum(t, 'eCut'); }).map((r) => r.view);
  const wrongLayer = rows.filter((r) => r.drawnLayer !== r.layer).map((r) => r.view);
  const ratio = sum(ok, 'eBlend') / sum(ok, 'eCut');
  console.log(`H8: ${ok.length} of ${rows.length * 4} triples scored (30 required); pooled ERROR(blend) ${(sum(ok, 'eBlend') / ok.length).toFixed(3)} against ERROR(cut) ${(sum(ok, 'eCut') / ok.length).toFixed(3)} = ${(100 * ratio).toFixed(1)}% (line 60%); views where the blend is worse than the cut: ${worse.length ? worse.join(',') : 'none'}; wrong layer drawn: ${wrongLayer.length ? wrongLayer.join(',') : 'none'}`);
  console.log(`    per view %: ${rows.map((r) => { const t = r.triples.filter((x) => !x.leftOut); return `${r.view}:${t.length ? (100 * sum(t, 'eBlend') / sum(t, 'eCut')).toFixed(0) : 'n/a'}`; }).join(' ')}`);
  console.log(`    contrast of the held 6 h picture: against its two ends, mean ${(sum(ok, 'ret6') / ok.length).toFixed(3)} min ${Math.min(...ok.map((t) => t.ret6)).toFixed(3)}; against the real middle hour, mean ${(sum(ok, 'retTruth') / ok.length).toFixed(3)}`);
  console.log(ok.length < 30 || wrongLayer.length ? 'H8 VOID' : (ratio <= 0.6 && worse.length === 0 ? 'H8 PASS' : 'H8 FAIL'));
})().catch((e) => { console.error(String(e && e.stack || e).replace(/access_token=[^&\s"']+/g, 'access_token=REDACTED')); process.exit(1); });
