// GPU and upload cost per weather layer (2026-11-12, Fable layer-animation lane; the coordinator's brief: "measure first").
// Offline only: built client over serve_synthetic.py, raster hosts replayed (rr.js), the own-frames CDN stand-in.
//
// Injected before any page script: every WebGL2 context the page creates is wrapped. Per animation frame and per context it
// records the GPU time of everything issued in that frame (EXT_disjoint_timer_query_webgl2, TIME_ELAPSED; a disjoint result is
// dropped), the draw calls, and the CPU time and bytes of texture uploads (texImage2D / texSubImage2D / texStorage2D).
// Phases, each tagged: no layer, then per layer `idle` (the layer on, the map still) and `scrub` (STEPS ArrowRight on the wheel).
// A phone run throttles the CPU 4x; the GPU is NOT throttled (there is no such lever), so phone GPU ms are this machine's GPU.
//   PORT=4198 AB_BASE=http://127.0.0.1:3198 OWN_CDN=http://127.0.0.1:4293/ RR_DIR=<cache> OUT=<dir> VP=desktop|phone
//   [LAYERS=waves,wind,pressure,rain] [STEPS=12] [KEY_MS=300] [IDLE_MS=5000] [FLAGS='{"...":true}'] [TAG=name] node scn_gpu_cost.js
if (process.env.AB_LIVE === '1') throw Error('scn_gpu_cost is offline only');
const fs = require('fs'); const path = require('path');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const OUT = process.env.OUT; const VP = process.env.VP || 'desktop';
const LAYERS = (process.env.LAYERS || 'waves,wind,pressure,rain').split(',');
const STEPS = +(process.env.STEPS || 12); const KEY_MS = +(process.env.KEY_MS || 300); const IDLE_MS = +(process.env.IDLE_MS || 5000);
const FLAGS = process.env.FLAGS ? JSON.parse(process.env.FLAGS) : {};
const TAG = process.env.TAG || 'base';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SPY = () => {
  const G = (window.__GPU__ = { ctx: [], phase: 'load', frames: [] });
  const wrap = (gl, canvas) => {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const c = { id: G.ctx.length, w: canvas.width, h: canvas.height, cls: String(canvas.className || '').slice(0, 40), ext: !!ext,
      q: null, pending: [], draws: 0, upMs: 0, upBytes: 0, ups: 0 };
    c.gl = gl; c.x = ext;
    for (const k of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const o = gl[k]; if (typeof o !== 'function') continue;
      gl[k] = function (...a) { c.draws += 1; return o.apply(gl, a); };
    }
    for (const k of ['texImage2D', 'texSubImage2D', 'texStorage2D']) {
      const o = gl[k];
      gl[k] = function (...a) {
        const t = performance.now(); const r = o.apply(gl, a); c.upMs += performance.now() - t; c.ups += 1;
        const px = a[a.length - 1]; if (px && px.byteLength) c.upBytes += px.byteLength;
        return r;
      };
    }
    G.ctx.push(c);
  };
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const gl = orig.call(this, type, ...rest);
    if (gl && type === 'webgl2' && !gl.__gpuSpy) { gl.__gpuSpy = true; try { wrap(gl, this); } catch (e) { /* not wrapped */ } }
    return gl;
  };
  let last = performance.now();
  const tick = (now) => {
    for (const c of G.ctx) {
      const gl = c.gl; const x = c.x;
      if (gl.isContextLost && gl.isContextLost()) continue;
      // Everything counted since the last tick, and the query ended here, belong to the SAME frame: the one just drawn.
      const rec = { c: c.id, p: c.phase || G.phase, dt: now - last, draws: c.draws, upMs: c.upMs, upBytes: c.upBytes, ups: c.ups, gpu: null };
      c.draws = 0; c.upMs = 0; c.upBytes = 0; c.ups = 0; c.phase = G.phase;
      G.frames.push(rec);
      if (x) {
        if (c.q) { gl.endQuery(x.TIME_ELAPSED_EXT); c.pending.push({ q: c.q, rec }); c.q = null; }
        while (c.pending.length && gl.getQueryParameter(c.pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
          const p = c.pending.shift();
          if (!gl.getParameter(x.GPU_DISJOINT_EXT)) p.rec.gpu = gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
          gl.deleteQuery(p.q);
        }
        if (c.pending.length < 8) { c.q = gl.createQuery(); gl.beginQuery(x.TIME_ELAPSED_EXT, c.q); }
      }
    }
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(2); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'auto' });
  const phone = VP === 'phone';
  const { browser, page } = await L.launch(phone
    ? { port: +process.env.PORT, width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } }
    : { port: +process.env.PORT, width: 1280, height: 800, dpr: 1 });
  await rr.install(page);
  await page.addInitScript(SPY);
  await page.addInitScript(({ cdn, flags }) => {
    try { localStorage.setItem('raw-surf-theme', 'dark'); } catch (e) { /* private mode */ }
    window.__RAW_STATIC_FRAMES_BASE__ = cdn; Object.assign(window, flags);
  }, { cdn: process.env.OWN_CDN, flags: FLAGS });
  const cdp = await page.context().newCDPSession(page);
  if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await L.openMap(page);
  await L.jump(page, -55, 38, 3.2); await sleep(5000);
  const phase = (p) => page.evaluate((x) => { window.__GPU__.phase = x; }, p);
  await phase('none-idle'); await sleep(IDLE_MS);
  const wheel = page.locator('[role="slider"][aria-label*="timeline wheel"]').filter({ visible: true }).first();
  let on = null;
  for (const layer of LAYERS) {
    await phase(`${layer}-toggle`);
    await page.evaluate((l) => window.toggleLayer(l), layer); on = layer;
    await sleep(9000);                                         // first data, compile, settle
    await phase(`${layer}-idle`); await sleep(IDLE_MS);
    await phase(`${layer}-scrub`);
    for (let i = 0; i < STEPS; i++) { await wheel.focus().catch(() => {}); await page.keyboard.press('ArrowRight'); await sleep(KEY_MS); }
    await sleep(2500);
    await phase(`${layer}-off`);
    await page.evaluate((l) => window.toggleLayer(l), on); on = null;
    for (let i = 0; i < STEPS; i++) { await wheel.focus().catch(() => {}); await page.keyboard.press('ArrowLeft'); await sleep(60); }
    await sleep(2500);
  }
  const data = await page.evaluate(() => ({
    ctx: window.__GPU__.ctx.map((c) => ({ id: c.id, w: c.w, h: c.h, cls: c.cls, ext: c.ext })), frames: window.__GPU__.frames,
  }));
  const out = { tag: TAG, vp: VP, flags: FLAGS, steps: STEPS, ctx: data.ctx, phases: {} };
  for (const p of [...new Set(data.frames.map((f) => f.p))]) {
    if (/-off$|^load$/.test(p)) continue;
    out.phases[p] = {};
    for (const c of data.ctx) {
      const fr = data.frames.filter((f) => f.p === p && f.c === c.id);
      const drawn = fr.filter((f) => f.draws > 0);
      const gpu = drawn.map((f) => f.gpu).filter((v) => v !== null);
      out.phases[p][`ctx${c.id}`] = {
        frames: fr.length, drawnFrames: drawn.length, gpuN: gpu.length, gpuP50: pct(gpu, 0.5), gpuP95: pct(gpu, 0.95), gpuMax: pct(gpu, 1),
        drawsP50: pct(drawn.map((f) => f.draws), 0.5), frameMsP50: pct(fr.map((f) => f.dt), 0.5), frameMsP95: pct(fr.map((f) => f.dt), 0.95),
        uploads: fr.reduce((s, f) => s + f.ups, 0), uploadMs: +fr.reduce((s, f) => s + f.upMs, 0).toFixed(1),
        uploadMB: +(fr.reduce((s, f) => s + f.upBytes, 0) / 1e6).toFixed(2), uploadWorstFrameMs: pct(fr.map((f) => f.upMs), 1),
      };
    }
  }
  fs.writeFileSync(path.join(OUT, `gpu-${TAG}-${VP}.json`), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
