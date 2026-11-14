// scn_wind_world_copies.js: the gate of the wind world-copy cull (2026-11-13, Fable). Offline only (built client over
// serve_synthetic.py). One page per arm, the wind layer on:
//   ARM=new (default)          ARM=old (window.__RAW_DISABLE_WIND_COPY_CULL__ = true: the layer's old offsets)
// STILL VIEWS. Per view: the offsets drawn per frame (read from the `u_lng_offset` uniform at each draw), GPU time per draw by
//   offset for the particles (drawArrays POINTS) and the heatmap (drawElements with a program that has u_lng_offset), each
//   timed alone (EXT_disjoint_timer_query_webgl2); and a PROBE: at a real draw of offset 0, with the engine's program,
//   uniforms, textures and blend state bound, offsets 0 / -360 / +360 are each drawn alone into an offscreen RGBA8 target and
//   their lit pixels counted. A copy the new rule does not draw must light 0; offset 0 lighting > 0 is the positive control.
// PANS. The map is eased across the date line; for EVERY frame the copies the frame's true bounds need (no margin) must be
//   among the copies drawn in that frame. A frame that needs a copy that was not drawn is a pop-in.
//   PORT=4198 AB_BASE=http://127.0.0.1:3198 RR_DIR=<cache> ARM=new|old [VP=desktop|phone] [W=3400] node scn_wind_world_copies.js
if (process.env.AB_LIVE === '1') throw Error('scn_wind_world_copies is offline only');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const VP = process.env.VP || 'desktop'; const ARM = process.env.ARM || 'new'; const WIDE = +(process.env.W || 0) >= 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// [name, lng, lat, zoom]
const VIEWS = WIDE ? [['wide window z2 at 0E', 0, 20, 2], ['wide window z2 at 150E', 150, 0, 2]] : [
  ['atlantic z3.2', -55, 38, 3.2], ['e-pacific z3', -110, 10, 3], ['indian z2.8', 80, -20, 2.8], ['mid-atlantic z3.4', -30, 0, 3.4], ['min zoom z2 at 0E', 0, 20, 2],
  ['span z5 at 150E', 150, 0, 5], ['span z4 at 140W', -140, 20, 4],
  ['fiji z4', 179, -17, 4], ['bering z5', -178, 52, 5], ['nz z3', 175, -40, 3], ['date line z2.5', -170, 0, 2.5],
];
// [name, from lng, to lng, lat, zoom, ms]
const PANS = WIDE ? [] : [['east across +180 at z3', 120, 200, 0, 3, 1500], ['west across -180 at z3', -120, -200, 0, 3, 1500],
  ['east across +180 at z5', 165, 195, -17, 5, 1200], ['fast east across +180 at z2.5', 60, 240, 0, 2.5, 700]];

const SPY = () => {
  const G = (window.__WC__ = { on: false, want: false, probe: null, t: { p: {}, h: {} }, gen: 0, cur: { p: [], h: [] }, frames: [], rec: false, disjoint: 0 });
  const locs = new WeakMap();
  const wrap = (gl) => {
    const x = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const pending = [];
    const locOf = (pr) => { if (!pr) return null; if (!locs.has(pr)) locs.set(pr, gl.getUniformLocation(pr, 'u_lng_offset')); return locs.get(pr); };
    const poll = () => {
      while (x && pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
        const e = pending.shift();
        if (gl.getParameter(x.GPU_DISJOINT_EXT)) G.disjoint += 1;
        else if (e.gen === G.gen) (G.t[e.kind][e.off] = G.t[e.kind][e.off] || []).push(gl.getQueryParameter(e.q, gl.QUERY_RESULT) / 1e6);   // a sample belongs to the view it was taken at
        gl.deleteQuery(e.q);
      }
    };
    const lit = (w, h) => { const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] || px[i + 1] || px[i + 2] || px[i + 3]) n += 1; return n; };
    const probe = (pr, loc, call) => {
      const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight;
      const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING); const act = gl.getParameter(gl.ACTIVE_TEXTURE); const cc = gl.getParameter(gl.COLOR_CLEAR_VALUE); const vp = gl.getParameter(gl.VIEWPORT);
      gl.activeTexture(gl.TEXTURE0 + 15); const t15 = gl.getParameter(gl.TEXTURE_BINDING_2D);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, t15); gl.activeTexture(act);
      const target = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); gl.viewport(0, 0, w, h);
      const out = [0, -360, 360].map((o) => { gl.uniform1f(loc, o); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); call(); return lit(w, h); });
      gl.uniform1f(loc, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(vp[0], vp[1], vp[2], vp[3]); gl.clearColor(cc[0], cc[1], cc[2], cc[3]);
      gl.deleteFramebuffer(target); gl.deleteTexture(tex);
      return { lit: out, pixels: w * h, glError: gl.getError() };
    };
    const handle = (kind, call) => {
      const pr = gl.getParameter(gl.CURRENT_PROGRAM); const loc = locOf(pr); if (!loc) return call();
      const off = Math.round(gl.getUniform(pr, loc)); G.cur[kind].push(off);
      if (G.want && off === 0 && !(G.probe && G.probe[kind])) { try { G.probe = { ...(G.probe || {}), [kind]: probe(pr, loc, call) }; } catch (e) { G.probe = { ...(G.probe || {}), [kind]: { error: String(e && e.message).slice(0, 200) } }; } }
      if (!G.on || !x || pending.length >= 24 || gl.getQuery(x.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return call();
      poll();
      const q = gl.createQuery(); gl.beginQuery(x.TIME_ELAPSED_EXT, q); const r = call(); gl.endQuery(x.TIME_ELAPSED_EXT); pending.push({ q, kind, off, gen: G.gen }); return r;
    };
    const da = gl.drawArrays;
    gl.drawArrays = function (mode, first, count) {
      if (mode === gl.POINTS && count >= 30000) return handle('p', () => da.call(gl, mode, first, count));
      return da.call(gl, mode, first, count);
    };
    const de = gl.drawElements;
    gl.drawElements = function (mode, count, type, offset) {
      if (mode === gl.TRIANGLES && type === gl.UNSIGNED_SHORT && count >= 1000) return handle('h', () => de.call(gl, mode, count, type, offset));
      return de.call(gl, mode, count, type, offset);
    };
  };
  // Registered before the map's own frame callback, so each tick sees the draws of the PREVIOUS frame and the camera they used.
  const tick = () => {
    if (G.rec && (G.cur.p.length || G.cur.h.length)) { const m = window.__MAP_INSTANCE__ || window.map; const b = m && m.getBounds(); if (b) G.frames.push({ w: b.getWest(), e: b.getEast(), p: G.cur.p, h: G.cur.h }); }
    G.last = { p: G.cur.p, h: G.cur.h }; G.cur = { p: [], h: [] }; requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const gl = orig.call(this, type, ...rest);
    if (gl && type === 'webgl2' && !gl.__wcSpy) { gl.__wcSpy = true; try { wrap(gl); } catch (e) { /* not wrapped */ } }
    return gl;
  };
};
const med = (a) => { if (!a || !a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(3); };
const needed = (w, e) => { const out = []; for (let k = Math.floor((w + 180) / 360); k <= Math.ceil((e - 180) / 360); k += 1) out.push(k * 360); return out; };

(async () => {
  const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'auto' });
  const phone = VP === 'phone';
  const { browser, page } = await L.launch(phone
    ? { port: +process.env.PORT || 4198, width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } }
    : { port: +process.env.PORT || 4198, width: +(process.env.W || 1280), height: 800, dpr: 1 });
  await rr.install(page);
  await page.addInitScript(SPY);
  await page.addInitScript((old) => { try { localStorage.setItem('raw-surf-theme', 'dark'); } catch (e) { /* private mode */ } window.__RAW_STATIC_FRAMES_BASE__ = 'http://127.0.0.1:4293/'; if (old) window.__RAW_DISABLE_WIND_COPY_CULL__ = true; }, ARM === 'old');
  await L.openMap(page); await L.jump(page, VIEWS[0][1], VIEWS[0][2], VIEWS[0][3]); await sleep(3000);
  await page.evaluate(() => window.toggleLayer('wind')); await sleep(10000);
  for (const [name, lng, lat, zoom] of VIEWS) {
    await L.jump(page, lng, lat, zoom); await sleep(6000);
    await page.evaluate(() => { const G = window.__WC__; G.gen += 1; G.t = { p: {}, h: {} }; G.probe = null; G.on = true; G.want = true; });
    await sleep(6000);
    const r = await page.evaluate(() => { const G = window.__WC__; G.on = false; G.want = false; const m = window.__MAP_INSTANCE__ || window.map; const b = m.getBounds();
      return { t: G.t, last: G.last, probe: G.probe, tel: (window.__RAW_GPU__ || {}).windCopies || null, west: +b.getWest().toFixed(1), east: +b.getEast().toFixed(1), zoom: +m.getZoom().toFixed(2) }; });
    const ms = (k) => Object.fromEntries(Object.entries(r.t[k]).map(([o, a]) => [o, med(a)]));
    console.log(JSON.stringify({ arm: ARM, vp: VP, view: name, zoom: r.zoom, bounds: [r.west, r.east], need: needed(r.west, r.east), drawn: r.last, by: r.tel && r.tel.by, legacy: r.tel && r.tel.legacy,
      particleMs: ms('p'), heatmapMs: ms('h'), particleLit: r.probe && r.probe.p ? (r.probe.p.lit || r.probe.p.error) : null, heatmapLit: r.probe && r.probe.h ? (r.probe.h.lit || r.probe.h.error) : null }));
  }
  for (const [name, from, to, lat, zoom, ms] of PANS) {
    await L.jump(page, from, lat, zoom); await sleep(4000);
    await page.evaluate(({ to2, lat2, ms2 }) => { const G = window.__WC__; G.frames = []; G.rec = true; (window.__MAP_INSTANCE__ || window.map).easeTo({ center: [to2, lat2], duration: ms2, easing: (t) => t }); }, { to2: to, lat2: lat, ms2: ms });
    await sleep(ms + 1500);
    const frames = await page.evaluate(() => { const G = window.__WC__; G.rec = false; return G.frames; });
    let missing = 0; let withSide = 0; const miss = [];
    for (const f of frames) { const need = needed(f.w, f.e); if (need.length > 1 || need[0] !== 0) withSide += 1;
      for (const k of ['p', 'h']) { if (!f[k].length) continue; const lack = need.filter((o) => !f[k].includes(o)); if (lack.length) { missing += 1; if (miss.length < 3) miss.push({ k, w: +f.w.toFixed(1), e: +f.e.toFixed(1), drawn: f[k], lack }); } } }
    console.log(JSON.stringify({ arm: ARM, vp: VP, pan: name, frames: frames.length, framesNeedingASideCopy: withSide, framesMissingACopy: missing, examples: miss,
      maxCopiesDrawn: Math.max(0, ...frames.map((f) => new Set(f.p).size)) }));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
