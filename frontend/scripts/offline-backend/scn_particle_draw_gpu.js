// scn_particle_draw_gpu.js: GPU time of the marine PARTICLE DRAW alone (2026-11-13, Fable; the gate of the instanced draw).
// Offline only: built client over serve_synthetic.py. A timer query (EXT_disjoint_timer_query_webgl2, TIME_ELAPSED) is put
// around each particle draw call and nothing else: `drawArrays(TRIANGLES, 0, 6N)` (classic) or
// `drawElementsInstanced(TRIANGLES, 6, UNSIGNED_BYTE, 0, N)` (instanced), N >= 10,000. Disjoint results are dropped.
// Fixed view, the waves layer on, the map still. Reports the median / p90 over FRAMES samples and which draw was seen.
// The GPU is this machine's; a phone run throttles only the CPU and uses the handheld particle count.
//   PORT=4198 AB_BASE=http://127.0.0.1:3198 RR_DIR=<cache> [VP=desktop|phone] [FRAMES=300] [VIEW=lng,lat,zoom] [FLAGS='{"__RAW_DISABLE_PARTICLE_INSTANCED__":true}'] node scn_particle_draw_gpu.js
if (process.env.AB_LIVE === '1') throw Error('scn_particle_draw_gpu is offline only');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const VP = process.env.VP || 'desktop'; const FRAMES = +(process.env.FRAMES || 300);
const FLAGS = process.env.FLAGS ? JSON.parse(process.env.FLAGS) : {};
const VIEW = (process.env.VIEW || '-55,38,3.2').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SPY = () => {
  const G = (window.__PD__ = { on: false, ms: [], disjoint: 0, kinds: {}, counts: {}, ext: null, renderer: null });
  const wrap = (gl) => {
    const x = gl.getExtension('EXT_disjoint_timer_query_webgl2'); G.ext = G.ext || !!x;
    try { const d = gl.getExtension('WEBGL_debug_renderer_info'); if (d) G.renderer = String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)).slice(0, 90); } catch (e) { /* hidden */ }
    if (!x) return;
    const pending = [];
    const poll = () => {
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift();
        if (gl.getParameter(x.GPU_DISJOINT_EXT)) G.disjoint += 1; else G.ms.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
    };
    const timed = (kind, n, call) => {
      if (!G.on || pending.length >= 16 || gl.getQuery(x.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return call();
      poll();
      G.kinds[kind] = (G.kinds[kind] || 0) + 1; G.counts[n] = (G.counts[n] || 0) + 1;
      const q = gl.createQuery(); gl.beginQuery(x.TIME_ELAPSED_EXT, q);
      const r = call(); gl.endQuery(x.TIME_ELAPSED_EXT); pending.push(q); return r;
    };
    const da = gl.drawArrays;
    gl.drawArrays = function (mode, first, count) {
      if (mode === gl.TRIANGLES && count >= 60000 && count % 6 === 0) return timed('classic', count / 6, () => da.call(gl, mode, first, count));
      return da.call(gl, mode, first, count);
    };
    const de = gl.drawElementsInstanced;
    gl.drawElementsInstanced = function (mode, count, type, offset, instances) {
      if (mode === gl.TRIANGLES && count === 6 && instances >= 10000) return timed('instanced', instances, () => de.call(gl, mode, count, type, offset, instances));
      return de.call(gl, mode, count, type, offset, instances);
    };
  };
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const gl = orig.call(this, type, ...rest);
    if (gl && type === 'webgl2' && !gl.__pdSpy) { gl.__pdSpy = true; try { wrap(gl); } catch (e) { /* not wrapped */ } }
    return gl;
  };
};
const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(3); };

(async () => {
  const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'auto' });
  const phone = VP === 'phone';
  const { browser, page } = await L.launch(phone
    ? { port: +process.env.PORT || 4198, width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } }
    : { port: +process.env.PORT || 4198, width: 1280, height: 800, dpr: 1 });
  await rr.install(page);
  await page.addInitScript(SPY);
  await page.addInitScript((flags) => { try { localStorage.setItem('raw-surf-theme', 'dark'); } catch (e) { /* private mode */ } window.__RAW_STATIC_FRAMES_BASE__ = 'http://127.0.0.1:4293/'; Object.assign(window, flags); }, FLAGS);
  if (phone) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
  await L.openMap(page); await L.jump(page, VIEW[0], VIEW[1], VIEW[2]); await sleep(4000);
  await page.evaluate(() => window.toggleLayer('waves')); await sleep(10000);            // first data, compile, settle
  await page.evaluate(() => { window.__PD__.on = true; });
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) { await sleep(500); if (await page.evaluate(() => window.__PD__.ms.length) >= FRAMES) break; }
  const r = await page.evaluate(() => ({ ...window.__PD__, mode: (window.__RAW_GPU__ || {}).particleDraw || null }));
  const ms = r.ms.slice(0, FRAMES);
  console.log(JSON.stringify({ vp: VP, view: VIEW, flags: Object.keys(FLAGS), mode: r.mode, kinds: r.kinds, particles: r.counts, ext: r.ext, renderer: r.renderer,
    n: ms.length, disjoint: r.disjoint, medianMs: pct(ms, 0.5), p10: pct(ms, 0.1), p90: pct(ms, 0.9) }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
