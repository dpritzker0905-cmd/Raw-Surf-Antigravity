// scn_world_wrap_cull.js: the gate of the low-zoom world-copy cull (2026-11-13, Fable). Offline only (built client over
// serve_synthetic.py). One page per arm visits every view with the waves layer on:
//   ARM=new  (default)                                   ARM=old  (window.__RAW_DISABLE_WRAP_CULL_LOWZOOM__ = true)
// Per view it reports
//   - the engine's own decision (window.__RAW_GPU__.wrapCull) and the particle / heatmap draw calls per frame;
//   - GPU time per draw by world copy (EXT_disjoint_timer_query_webgl2 around each particle and each heatmap draw alone).
//     In the OLD arm one page load times all three copies, so the share spent on copies -1 / +1 is read within one load;
//   - PROBE: at a real draw of the main copy, with the engine's program, uniforms, textures and blend state bound, each of
//     the three copies is drawn alone into an offscreen RGBA8 target and its lit pixels are counted. A copy the new rule
//     skips must light 0. The main copy lighting > 0 is the positive control (the probe can see a copy).
//   PORT=4198 AB_BASE=http://127.0.0.1:3198 RR_DIR=<cache> ARM=new|old [VP=desktop|phone] [W=3400] node scn_world_wrap_cull.js
if (process.env.AB_LIVE === '1') throw Error('scn_world_wrap_cull is offline only');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const VP = process.env.VP || 'desktop'; const ARM = process.env.ARM || 'new';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// [name, lng, lat, zoom, expect]: 'one' = no world edge in view, 'wrap' = an edge in view (or more than a world shown).
const VIEWS = [
  ['atlantic z3.2', -55, 38, 3.2, 'one'], ['e-pacific z3', -110, 10, 3, 'one'], ['indian z2.8', 80, -20, 2.8, 'one'],
  ['mid-atlantic z3.6', -30, 0, 3.6, 'one'], ['s-america z3.9', -100, -30, 3.9, 'one'],
  ['fiji z4', 179, -17, 4, 'wrap'], ['bering z5', -178, 52, 5, 'wrap'], ['nz z3', 175, -40, 3, 'wrap'],
  ['date line z2.5', -170, 0, 2.5, 'wrap'], ['min zoom z2 at 0E', 0, 20, 2, 'one'],
  // The map's minimum zoom is 2, so a 1080 px map never shows a whole world. With W >= 3000 these two show more than one:
  ...(+(process.env.W || 0) >= 3000 ? [['wide window z2 at 0E', 0, 20, 2, 'wrap'], ['wide window z2 at 150E', 150, 0, 2, 'wrap']] : []),
];

const SPY = () => {
  const G = (window.__WW__ = { on: false, want: false, probe: null, t: { p: [[], [], []], h: [[], [], []] }, per: { p: 0, h: 0 }, max: { p: 0, h: 0 }, disjoint: 0 });
  const wrap = (gl) => {
    const x = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const pending = [];
    const poll = () => {
      while (x && pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
        const e = pending.shift();
        if (gl.getParameter(x.GPU_DISJOINT_EXT)) G.disjoint += 1; else (G.t[e.kind][e.k] || G.t[e.kind][2]).push(gl.getQueryParameter(e.q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(e.q);
      }
    };
    const lit = (w, h) => { const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] || px[i + 1] || px[i + 2] || px[i + 3]) n += 1; return n; };
    const probe = (uniform, offsets, call) => {
      const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight; const pr = gl.getParameter(gl.CURRENT_PROGRAM);
      const loc = gl.getUniformLocation(pr, uniform); const was = gl.getUniform(pr, loc);
      const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING); const act = gl.getParameter(gl.ACTIVE_TEXTURE); const cc = gl.getParameter(gl.COLOR_CLEAR_VALUE);
      gl.activeTexture(gl.TEXTURE0 + 15); const t15 = gl.getParameter(gl.TEXTURE_BINDING_2D);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, t15); gl.activeTexture(act);
      const target = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const out = offsets.map((o) => { gl.uniform1f(loc, o); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); call(); return lit(w, h); });
      gl.uniform1f(loc, was); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.clearColor(cc[0], cc[1], cc[2], cc[3]);
      gl.deleteFramebuffer(target); gl.deleteTexture(tex);
      return { lit: out, pixels: w * h, uniformWas: was, glError: gl.getError() };
    };
    const handle = (kind, uniform, offsets, call) => {
      const k = G.per[kind]; G.per[kind] = k + 1;
      if (G.want && k === 0 && !(G.probe && G.probe[kind])) { try { G.probe = { ...(G.probe || {}), [kind]: probe(uniform, offsets, call) }; } catch (e) { G.probe = { ...(G.probe || {}), [kind]: { error: String(e && e.message).slice(0, 200) } }; } }
      if (!G.on || !x || pending.length >= 24 || gl.getQuery(x.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return call();
      poll();
      const q = gl.createQuery(); gl.beginQuery(x.TIME_ELAPSED_EXT, q); const r = call(); gl.endQuery(x.TIME_ELAPSED_EXT); pending.push({ q, kind, k }); return r;
    };
    const da = gl.drawArrays;
    gl.drawArrays = function (mode, first, count) {
      if (mode === gl.TRIANGLES && count >= 60000 && count % 6 === 0) return handle('p', 'u_merc_offset', [0, -1, 1], () => da.call(gl, mode, first, count));
      return da.call(gl, mode, first, count);
    };
    const de = gl.drawElements;
    gl.drawElements = function (mode, count, type, offset) {
      if (mode === gl.TRIANGLES && count === 54150 && type === gl.UNSIGNED_SHORT) return handle('h', 'u_lng_offset', [0, -360, 360], () => de.call(gl, mode, count, type, offset));
      return de.call(gl, mode, count, type, offset);
    };
  };
  const tick = () => { for (const k of ['p', 'h']) { if (G.per[k] > G.max[k]) G.max[k] = G.per[k]; G.per[k] = 0; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const gl = orig.call(this, type, ...rest);
    if (gl && type === 'webgl2' && !gl.__wwSpy) { gl.__wwSpy = true; try { wrap(gl); } catch (e) { /* not wrapped */ } }
    return gl;
  };
};
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(3); };

(async () => {
  const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'auto' });
  const phone = VP === 'phone';
  const { browser, page } = await L.launch(phone
    ? { port: +process.env.PORT || 4198, width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } }
    : { port: +process.env.PORT || 4198, width: +(process.env.W || 1280), height: 800, dpr: 1 });
  await rr.install(page);
  await page.addInitScript(SPY);
  await page.addInitScript((old) => { try { localStorage.setItem('raw-surf-theme', 'dark'); } catch (e) { /* private mode */ } window.__RAW_STATIC_FRAMES_BASE__ = 'http://127.0.0.1:4293/'; if (old) window.__RAW_DISABLE_WRAP_CULL_LOWZOOM__ = true; }, ARM === 'old');
  await L.openMap(page); await L.jump(page, VIEWS[0][1], VIEWS[0][2], VIEWS[0][3]); await sleep(3000);
  await page.evaluate(() => window.toggleLayer('waves')); await sleep(9000);
  for (const [name, lng, lat, zoom, expect] of VIEWS) {
    await L.jump(page, lng, lat, zoom); await sleep(6000);
    await page.evaluate(() => { const G = window.__WW__; G.t = { p: [[], [], []], h: [[], [], []] }; G.max = { p: 0, h: 0 }; G.probe = null; G.on = true; G.want = true; });
    await sleep(6000);
    const r = await page.evaluate(() => { const G = window.__WW__; G.on = false; G.want = false; const m = window.__MAP_INSTANCE__ || window.map; const b = m.getBounds();
      return { t: G.t, max: G.max, probe: G.probe, disjoint: G.disjoint, wrapCull: (window.__RAW_GPU__ || {}).wrapCull || null, west: +b.getWest().toFixed(1), east: +b.getEast().toFixed(1) }; });
    const row = { arm: ARM, vp: VP, view: name, zoom, expect, bounds: [r.west, r.east], needWrap: r.wrapCull && r.wrapCull.needWrap, why: r.wrapCull && r.wrapCull.why,
      drawsPerFrame: r.max, particleMs: r.t.p.map(med), heatmapMs: r.t.h.map(med), samples: [r.t.p[0].length, r.t.h[0].length],
      particleLit: r.probe && r.probe.p ? (r.probe.p.lit || r.probe.p.error) : null, heatmapLit: r.probe && r.probe.h ? (r.probe.h.lit || r.probe.h.error) : null,
      pixels: r.probe && r.probe.p ? r.probe.p.pixels : null };
    console.log(JSON.stringify(row));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
