// scn_particle_draw_pixels.js: is the INSTANCED particle draw pixel-identical to the six-vertex draw? (2026-11-13, Fable)
// Offline only: built client over serve_synthetic.py, the app running the instanced draw (the default).
// The particles move and are seeded at random, so two page loads never show the same frame. This compares INSIDE one frame:
// at one real particle draw call, with the engine's own program, uniforms, textures and blend state still bound, it draws the
// particles into an offscreen RGBA8 target three ways and reads each back:
//   A  the app's instanced draw (its own vertex array)                 B  the same again            -> NULL control: A == B
//   C  the classic draw: the same shader with the instanced rewrite undone (particleInstancedDraw.js), 6N vertex ids,
//      every uniform value copied from the app's program                                            -> THE TEST: A == C
//   D  the classic draw with the last 2,000 particles left out                                     -> POSITIVE control: A != D
// The offscreen target has no depth or stencil buffer; all four draws share that, the blend state and the viewport.
//   PORT=4198 AB_BASE=http://127.0.0.1:3198 RR_DIR=<cache> [VP=desktop|phone] node scn_particle_draw_pixels.js
if (process.env.AB_LIVE === '1') throw Error('scn_particle_draw_pixels is offline only');
const fs = require('fs'); const path = require('path');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const VP = process.env.VP || 'desktop';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODULE = fs.readFileSync(path.join(__dirname, '../../src/components/map/particleInstancedDraw.js'), 'utf8').replace(/^export /gm, '');

const SPY = (moduleText) => {
  // eslint-disable-next-line no-new-func
  const K = new Function(moduleText + '\nreturn { CLASSIC_ATTR, CLASSIC_INDEX, CLASSIC_CORNERS, INSTANCED_ATTR, INSTANCED_INDEX, INSTANCED_CORNERS };')();
  const G = (window.__PX__ = { want: false, result: null, seen: 0 });
  const classicOf = (vs) => {
    let out = vs;
    for (const [from, to] of [[K.INSTANCED_ATTR, K.CLASSIC_ATTR], [K.INSTANCED_INDEX, K.CLASSIC_INDEX], [K.INSTANCED_CORNERS, K.CLASSIC_CORNERS]]) {
      if (out.split(from).length !== 2) throw new Error('instanced text not found in the running shader');
      out = out.replace(from, to);
    }
    return out;
  };
  const compile = (gl, type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(String(gl.getShaderInfoLog(s)).slice(0, 200)); return s; };
  const copyUniforms = (gl, from, to) => {
    let n = 0;
    gl.useProgram(to);
    for (let i = 0; i < gl.getProgramParameter(from, gl.ACTIVE_UNIFORMS); i += 1) {
      const info = gl.getActiveUniform(from, i); const base = info.name.replace(/\[0\]$/, '');
      for (let k = 0; k < info.size; k += 1) {
        const name = info.size > 1 ? `${base}[${k}]` : base;
        const a = gl.getUniformLocation(from, name); const b = gl.getUniformLocation(to, name); if (!a || !b) continue;
        const v = gl.getUniform(from, a); n += 1;
        switch (info.type) {
          case gl.FLOAT: gl.uniform1f(b, v); break; case gl.FLOAT_VEC2: gl.uniform2fv(b, v); break;
          case gl.FLOAT_VEC3: gl.uniform3fv(b, v); break; case gl.FLOAT_VEC4: gl.uniform4fv(b, v); break;
          case gl.INT: case gl.BOOL: case gl.SAMPLER_2D: case gl.SAMPLER_2D_ARRAY: case gl.SAMPLER_CUBE: gl.uniform1i(b, v); break;
          case gl.INT_VEC2: case gl.BOOL_VEC2: gl.uniform2iv(b, v); break; case gl.INT_VEC3: case gl.BOOL_VEC3: gl.uniform3iv(b, v); break;
          case gl.INT_VEC4: case gl.BOOL_VEC4: gl.uniform4iv(b, v); break;
          case gl.FLOAT_MAT2: gl.uniformMatrix2fv(b, false, v); break; case gl.FLOAT_MAT3: gl.uniformMatrix3fv(b, false, v); break;
          case gl.FLOAT_MAT4: gl.uniformMatrix4fv(b, false, v); break;
          default: throw new Error('uniform type ' + info.type + ' of ' + name);
        }
      }
    }
    return n;
  };
  const ab = (gl, de, args) => {
    const N = args[4]; const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight;
    const prog = gl.getParameter(gl.CURRENT_PROGRAM); const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING); const ab0 = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    const tex0 = gl.getParameter(gl.TEXTURE_BINDING_2D); const act = gl.getParameter(gl.ACTIVE_TEXTURE); const cc = gl.getParameter(gl.COLOR_CLEAR_VALUE);
    const shaders = gl.getAttachedShaders(prog);
    const vsCur = gl.getShaderSource(shaders.find((s) => gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.VERTEX_SHADER));
    const fsCur = gl.getShaderSource(shaders.find((s) => gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER));
    const classic = gl.createProgram();
    gl.attachShader(classic, compile(gl, gl.VERTEX_SHADER, classicOf(vsCur))); gl.attachShader(classic, compile(gl, gl.FRAGMENT_SHADER, fsCur));
    gl.linkProgram(classic); if (!gl.getProgramParameter(classic, gl.LINK_STATUS)) throw new Error('classic link: ' + String(gl.getProgramInfoLog(classic)).slice(0, 200));
    const uniforms = copyUniforms(gl, prog, classic);
    const cvao = gl.createVertexArray(); gl.bindVertexArray(cvao);
    const ids = new Float32Array(N * 6); for (let i = 0; i < ids.length; i += 1) ids[i] = i;
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(classic, 'a_vertex_id'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + 15); const t15 = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, t15); gl.activeTexture(act);
    const target = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('offscreen target incomplete');
    const shot = (draw) => { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); draw(); const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const instanced = () => { gl.useProgram(prog); gl.bindVertexArray(vao); de.apply(gl, args); };
    const A = shot(instanced); const B = shot(instanced);
    const C = shot(() => { gl.useProgram(classic); gl.bindVertexArray(cvao); gl.drawArrays(gl.TRIANGLES, 0, N * 6); });
    const D = shot(() => { gl.useProgram(classic); gl.bindVertexArray(cvao); gl.drawArrays(gl.TRIANGLES, 0, (N - 2000) * 6); });
    const diff = (x, y) => { let px = 0; let max = 0; for (let i = 0; i < x.length; i += 4) { const d = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]), Math.abs(x[i + 3] - y[i + 3])); if (d) { px += 1; if (d > max) max = d; } } return { px, max }; };
    let lit = 0; for (let i = 3; i < A.length; i += 4) if (A[i] || A[i - 1] || A[i - 2] || A[i - 3]) lit += 1;
    const err = gl.getError();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.useProgram(prog); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, ab0);
    gl.activeTexture(act); gl.bindTexture(gl.TEXTURE_2D, tex0); gl.clearColor(cc[0], cc[1], cc[2], cc[3]);
    gl.deleteFramebuffer(target); gl.deleteTexture(tex); gl.deleteBuffer(buf); gl.deleteVertexArray(cvao); gl.deleteProgram(classic);
    return { particles: N, w, h, uniforms, litPixels: lit, nullControl: diff(A, B), test: diff(A, C), positiveControl: diff(A, D), glError: err,
      blend: gl.isEnabled(gl.BLEND), depthTest: gl.isEnabled(gl.DEPTH_TEST), stencilTest: gl.isEnabled(gl.STENCIL_TEST), scissor: gl.isEnabled(gl.SCISSOR_TEST) };
  };
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const gl = orig.call(this, type, ...rest);
    if (gl && type === 'webgl2' && !gl.__pxSpy) {
      gl.__pxSpy = true; const de = gl.drawElementsInstanced;
      gl.drawElementsInstanced = function (...a) {
        const mine = a[0] === gl.TRIANGLES && a[1] === 6 && a[4] >= 10000;
        if (mine) G.seen += 1;
        if (mine && G.want) { G.want = false; try { G.result = ab(gl, de, a); } catch (e) { G.result = { error: String(e && e.message).slice(0, 300) }; } }
        return de.apply(gl, a);
      };
    }
    return gl;
  };
};

const VIEWS = [
  ['dark', -55, 38, 3.2, false], ['dark', -4, 50, 5, false], ['dark', -158, 21.6, 7, false], ['dark', 179, -17, 4, false],
  ['light', -55, 38, 3.2, false], ['light', -4, 50, 5, false], ['light', 115, -9, 6, false],
  ['beach', -55, 38, 3.2, false], ['beach', -158, 21.6, 7, false], ['beach', -4, 50, 5, true],
];

(async () => {
  const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'auto' });
  const phone = VP === 'phone'; const rows = [];
  let theme = null; let browser = null; let page = null;
  for (const [th, lng, lat, zoom, rating] of VIEWS) {
    if (th !== theme) {
      if (browser) await browser.close();
      ({ browser, page } = await L.launch(phone
        ? { port: +process.env.PORT || 4198, width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } }
        : { port: +process.env.PORT || 4198, width: 1280, height: 800, dpr: 1 }));
      await rr.install(page);
      await page.addInitScript(SPY, MODULE);
      await page.addInitScript((t) => { try { localStorage.setItem('raw-surf-theme', t); } catch (e) { /* private mode */ } window.__RAW_STATIC_FRAMES_BASE__ = 'http://127.0.0.1:4293/'; }, th);
      await L.openMap(page); await L.jump(page, lng, lat, zoom); await sleep(3000);
      await page.evaluate(() => window.toggleLayer('waves')); await sleep(9000);
      theme = th;
    } else { await L.jump(page, lng, lat, zoom); await sleep(6000); }
    let ratingOn = null;
    if (rating) { ratingOn = await L.clickText(page, 'Surf Rating').then(() => true).catch(() => false); await sleep(5000); }
    await page.evaluate(() => { window.__PX__.result = null; window.__PX__.want = true; });
    const t0 = Date.now(); let r = null;
    while (Date.now() - t0 < 15000 && !r) { await sleep(300); r = await page.evaluate(() => window.__PX__.result); }
    const mode = await page.evaluate(() => ({ mode: (window.__RAW_GPU__ || {}).particleDraw || null, seen: window.__PX__.seen }));
    rows.push({ theme: th, view: [lng, lat, zoom], rating: ratingOn, ...mode, ...(r || { error: 'no particle draw seen' }) });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
  if (browser) await browser.close();
  const ok = rows.filter((x) => x.test);
  console.log('SUMMARY views', rows.length, 'compared', ok.length, '| test max diff', Math.max(-1, ...ok.map((x) => x.test.max)), 'pixels differing', ok.reduce((s, x) => s + x.test.px, 0),
    '| null control max', Math.max(-1, ...ok.map((x) => x.nullControl.max)), '| positive control views that differ', ok.filter((x) => x.positiveControl.px > 0).length, 'of', ok.length);
})().catch((e) => { console.error(e); process.exit(1); });
