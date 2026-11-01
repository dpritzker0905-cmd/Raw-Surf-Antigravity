// GPU FRAMES BENCH (standalone; see README.md). Phases, in order:
//   limits   WebGL2 / WebGL1 limits and the device facts a tier decision would read
//   decode   a worker pool fetches + inflates + packs every frame of the series (no per-node JS objects)
//   vectors  today's static-frame path for comparison: main-thread parse + ~15k vector objects + vector -> RGBA8 bytes
//   upload   texStorage3D once, texSubImage3D per layer (RGBA8 and RGBA16F), a per-frame texImage2D baseline, a WebGL1 atlas
//   scrub    change a layer-index uniform per frame / per key press; verify the drawn layer with texelFetch + readPixels
//   interp   GPU cost of nearest vs linear (2 layers) vs clamped Catmull-Rom (4 layers) at the canvas size
//   toggle   switch to another set with only its current hour on the CPU: allocate (or reuse a spare) + 1 layer + draw
//   memory   (probe=1) allocate texture arrays until 448 MB or an error, then free them
// Query: label, lat (ms per frame request), probe=1, w / h (canvas CSS px), dpr, auto=1, skip=<phase,...>, n (frames).
const Q = new URLSearchParams(location.search);
const LABEL = Q.get('label') || 'manual';
const LAT = +(Q.get('lat') || 0);
const SKIP = new Set((Q.get('skip') || '').split(',').filter(Boolean));
const logEl = document.getElementById('log');
const log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); logEl.textContent += s + '\n'; console.log('[gfb]', s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raf = () => new Promise((r) => requestAnimationFrame(r));
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))].toFixed(3); };
const stats = (arr) => ({ n: arr.length, p50: pct(arr, 0.5), p95: pct(arr, 0.95), max: arr.length ? +Math.max(...arr).toFixed(3) : null,
  mean: arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3) : null });
const heap = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024) : null); // KB, Chrome only
const R = { label: LABEL, startedAt: new Date().toISOString(), lat: LAT, phases: {} };
window.__GFB_RESULTS__ = R;

// A fast poll tick (MessageChannel, no 4 ms setTimeout clamp): WebGL sync and query results only update between tasks.
const mc = new MessageChannel(); const tickQ = [];
mc.port1.onmessage = () => { const f = tickQ.shift(); if (f) f(); };
const tick = () => new Promise((r) => { tickQ.push(r); mc.port2.postMessage(0); });
async function fenceMs(gl) {
  const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); const t0 = performance.now();
  for (;;) { await tick(); if (gl.getSyncParameter(s, gl.SYNC_STATUS) === gl.SIGNALED) { gl.deleteSync(s); return performance.now() - t0; } if (performance.now() - t0 > 5000) return null; }
}

// Main-thread jank meter: rAF gaps and long tasks inside a window.
function jankMeter() {
  const gaps = []; let last = null; let on = true; const lt = [];
  const loop = (t) => { if (!on) return; if (last !== null) gaps.push(t - last); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  let po = null;
  try { po = new PerformanceObserver((l) => l.getEntries().forEach((e) => lt.push(e.duration))); po.observe({ type: 'longtask', buffered: false }); } catch (e) { po = null; }
  return () => { on = false; if (po) po.disconnect(); return { rafGap: stats(gaps), gaps50: gaps.filter((g) => g > 50).length, longtasks: lt.length, longtaskMax: lt.length ? Math.max(...lt) : 0 }; };
}
const mark = (n) => { try { performance.mark(`gfb:${n}`); } catch (e) { /* old browsers */ } };

// ---------------------------------------------------------------------------------------------------------------- limits
function glFacts(gl, v) {
  if (!gl) return null;
  const P = (k) => { try { const x = gl.getParameter(gl[k]); return x && x.length !== undefined && typeof x !== 'string' ? Array.from(x) : x; } catch (e) { return null; } };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const keys = ['MAX_TEXTURE_SIZE', 'MAX_TEXTURE_IMAGE_UNITS', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'MAX_RENDERBUFFER_SIZE', 'MAX_VIEWPORT_DIMS', 'MAX_VERTEX_TEXTURE_IMAGE_UNITS'];
  if (v === 2) keys.push('MAX_ARRAY_TEXTURE_LAYERS', 'MAX_3D_TEXTURE_SIZE', 'MAX_SAMPLES', 'MAX_COLOR_ATTACHMENTS');
  const out = { version: P('VERSION'), glsl: P('SHADING_LANGUAGE_VERSION'), renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : P('RENDERER'), vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : P('VENDOR') };
  keys.forEach((k) => { out[k] = P(k); });
  const ext = gl.getSupportedExtensions() || [];
  out.ext = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'OES_texture_half_float', 'OES_texture_half_float_linear',
    'OES_texture_float', 'EXT_disjoint_timer_query_webgl2', 'EXT_disjoint_timer_query', 'KHR_parallel_shader_compile', 'EXT_texture_norm16', 'WEBGL_lose_context',
    'OES_vertex_array_object', 'ANGLE_instanced_arrays'].filter((e) => ext.includes(e));
  return out;
}
function phaseLimits() {
  const c2 = document.createElement('canvas'); const c1 = document.createElement('canvas');
  const gl2 = c2.getContext('webgl2'); const gl1 = c1.getContext('webgl');
  const nav = navigator; const conn = nav.connection || {};
  const out = {
    ua: nav.userAgent, platform: nav.platform, deviceMemoryGB: nav.deviceMemory ?? null, cores: nav.hardwareConcurrency ?? null,
    dpr: devicePixelRatio, screen: [screen.width, screen.height], secure: isSecureContext, crossOriginIsolated: !!window.crossOriginIsolated,
    connection: { effectiveType: conn.effectiveType ?? null, downlink: conn.downlink ?? null, saveData: conn.saveData ?? null },
    api: { DecompressionStream: typeof DecompressionStream !== 'undefined', OffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      schedulerYield: !!(window.scheduler && window.scheduler.yield), requestIdleCallback: typeof requestIdleCallback === 'function',
      measureMemory: typeof performance.measureUserAgentSpecificMemory === 'function', perfMemory: !!performance.memory },
    webgl2: glFacts(gl2, 2), webgl1: glFacts(gl1, 1),
  };
  [gl2, gl1].forEach((g) => { const l = g && g.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- decode
let INDEX = null;
const frameUrl = (f) => `/frames/${f.path}${LAT ? `?lat=${LAT}` : ''}`;
function makePool(size) {
  const ws = Array.from({ length: size }, () => ({ w: new Worker('decode-worker.js'), busy: 0 }));
  const pend = new Map(); let seq = 0;
  ws.forEach((x) => { x.w.onmessage = (e) => { const p = pend.get(e.data.id); if (!p) return; pend.delete(e.data.id); x.busy--; p.resolve({ ...e.data, recvAt: performance.now() }); }; });
  return {
    decode(url, mode) {
      const x = ws.reduce((a, b) => (b.busy < a.busy ? b : a)); x.busy++;
      const id = ++seq; const postAt = performance.now();
      return new Promise((resolve) => { pend.set(id, { resolve: (d) => resolve({ ...d, postAt }) }); x.w.postMessage({ id, url, mode }); });
    },
    close() { ws.forEach((x) => x.w.terminate()); },
  };
}
async function decodeAll(poolSize, mode, inFlight, keep) {
  const pool = makePool(poolSize); const frames = INDEX.frames; const out = new Array(frames.length);
  const per = { fetch: [], inflate: [], pack: [], total: [], deliver: [], mainHandle: [] }; let errors = 0; let wire = 0;
  const stopJank = jankMeter(); const h0 = heap(); const t0 = performance.now(); let next = 0;
  const workerLoop = async () => {
    while (next < frames.length) {
      const k = next++;
      const d = await pool.decode(frameUrl(frames[k]), mode);
      const m0 = performance.now();
      if (d.error) { errors++; continue; }
      if (keep) out[k] = d.packed;
      wire += d.wire;
      per.fetch.push(d.t.fetch); per.inflate.push(d.t.inflate); per.pack.push(d.t.pack); per.total.push(d.t.total);
      per.deliver.push(d.recvAt - d.postAt - d.t.total);
      per.mainHandle.push(performance.now() - m0);
    }
  };
  await Promise.all(Array.from({ length: inFlight }, workerLoop));
  const wall = performance.now() - t0; pool.close();
  const res = { poolSize, mode, inFlight, frames: frames.length, errors, wallMs: +wall.toFixed(1), framesPerSec: +(frames.length / (wall / 1000)).toFixed(1),
    wireKB: Math.round(wire / 1024), heapDeltaKB: h0 === null ? null : heap() - h0, jank: stopJank(),
    perFrame: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, stats(v)])) };
  return { res, packed: out };
}

// ---------------------------------------------------------------------------------------------------------------- vectors
// Today's static path (staticFrameCodec.parseFrame + buildVectors) on the main thread, then a vector -> RGBA8 loop standing in
// for WebGLMarineTextureEncoder. The parse/build code mirrors staticFrameCodec.js (PR #422) so the cost is the real one.
function parseFrameF64(buf) {
  const bytes = new Uint8Array(buf); const dv = new DataView(buf);
  const cols = dv.getUint16(8, true); const rows = dv.getUint16(10, true); const fieldCount = dv.getUint8(18); const headerBytes = dv.getUint32(20, true);
  const bounds = { west: dv.getFloat64(24, true), south: dv.getFloat64(32, true), east: dv.getFloat64(40, true), north: dv.getFloat64(48, true) };
  const n = cols * rows; const fields = {}; let pos = headerBytes;
  for (let f = 0; f < fieldCount; f++) {
    const d = 72 + f * 24; const id = dv.getUint8(d); const dtype = dv.getUint8(d + 1); const layout = dv.getUint8(d + 2);
    const missing = dv.getUint32(d + 4, true); const scale = dv.getFloat64(d + 8, true); const offset = dv.getFloat64(d + 16, true);
    const out = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let code; if (dtype === 1) code = bytes[pos + k]; else if (layout === 1) code = bytes[pos + k] | (bytes[pos + n + k] << 8); else code = bytes[pos + 2 * k] | (bytes[pos + 2 * k + 1] << 8);
      out[k] = (missing !== 0xFFFFFFFF && code === missing) ? NaN : code * scale + offset;
    }
    fields[id] = out; pos += n * dtype;
  }
  return { cols, rows, bounds, fields };
}
const r2 = (x) => Math.round(x * 100) / 100; const r4 = (x) => Math.round(x * 1e4) / 1e4; const r6 = (x) => Math.round(x * 1e6) / 1e6;
function buildVectors(p) {
  const { cols, rows, bounds, fields } = p; const H = fields[0]; const D = fields[1]; const P = fields[2]; const C = fields[3];
  const dLat = (bounds.north - bounds.south) / (rows - 1); const dLng = (bounds.east - bounds.west) / (cols - 1); const out = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const lat = r6(bounds.south + r * dLat);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c; const lng = r6(bounds.west + c * dLng); const h = H[i]; const valid = !Number.isNaN(h);
      const dir = D ? (Number.isNaN(D[i]) ? 0 : r2(D[i])) : 0; const per = P ? (Number.isNaN(P[i]) ? null : r2(P[i])) : null; const conf = C ? (Number.isNaN(C[i]) ? null : r4(C[i])) : null;
      if (!valid) { out[i] = { lat, lng, speed: 0, direction: dir, u: 0, v: 0, period: per, gust: null, value: null, is_valid: false, dir_confidence: conf }; continue; }
      const speed = r4(h); const rad = dir * (Math.PI / 180);
      out[i] = { lat, lng, speed, direction: dir, u: r4(-speed * Math.sin(rad)) + 0, v: r4(-speed * Math.cos(rad)) + 0, period: per, gust: null, value: null, is_valid: true, dir_confidence: conf };
    }
  }
  return out;
}
function vectorsToRGBA8(vectors) {
  const out = new Uint8Array(vectors.length * 4);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i]; if (!v.is_valid) continue; const o = i * 4; const m = Math.hypot(v.u, v.v) || 1;
    out[o] = 1 + Math.min(254, Math.round((v.speed / 16) * 254)); out[o + 1] = Math.round((-v.u / m * 0.5 + 0.5) * 255);
    out[o + 2] = Math.round((-v.v / m * 0.5 + 0.5) * 255); out[o + 3] = v.period == null ? 0 : Math.min(255, Math.round(v.period / 25 * 255));
  }
  return out;
}
async function phaseVectors(nFrames) {
  const keepLRU = []; const sync = []; const parse = []; const build = []; const enc = []; const stopJank = jankMeter(); const h0 = heap(); let hPeak = h0;
  for (let k = 0; k < nFrames; k++) {
    const f = INDEX.frames[k % INDEX.frames.length];
    let buf = await (await fetch(frameUrl(f))).arrayBuffer();
    const b = new Uint8Array(buf, 0, 2);
    if (b[0] === 0x1f && b[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const t0 = performance.now(); const p = parseFrameF64(buf); const t1 = performance.now(); const v = buildVectors(p); const t2 = performance.now(); vectorsToRGBA8(v); const t3 = performance.now();
    parse.push(t1 - t0); build.push(t2 - t1); enc.push(t3 - t2); sync.push(t3 - t0);
    keepLRU.push(v); if (keepLRU.length > 12) keepLRU.shift(); // staticFrames.js LRU_MAX = 12 decoded frames
    const hh = heap(); if (hh !== null && hh > hPeak) hPeak = hh;
    await raf();
  }
  const j = stopJank();
  return { frames: nFrames, syncBlockMs: stats(sync), parseMs: stats(parse), buildVectorsMs: stats(build), encodeMs: stats(enc), heapDeltaKB: h0 === null ? null : heap() - h0,
    heapPeakDeltaKB: h0 === null ? null : hPeak - h0, lruFramesKept: keepLRU.length, jank: j };
}

// ---------------------------------------------------------------------------------------------------------------- GL setup
const canvas = document.getElementById('c');
const VS2 = `#version 300 es
in vec2 a; out vec2 v_uv; void main(){ v_uv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;
const FS2 = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray u_tex; uniform float u_layer; uniform float u_t; uniform float u_last; uniform int u_mode; uniform int u_fmt;
in vec2 v_uv; out vec4 o;
float hOf(vec4 s) { if (u_fmt == 0) { float b = s.r * 255.0; return b < 0.5 ? -1.0 : (b - 1.0) / 254.0 * 16.0; } return s.r; }
vec2 dOf(vec4 s) { return u_fmt == 0 ? s.gb * 2.0 - 1.0 : s.gb; }
float pOf(vec4 s) { return u_fmt == 0 ? s.a * 25.0 : s.a; }
vec4 tap(float L) { return texture(u_tex, vec3(v_uv, clamp(L, 0.0, u_last))); }
vec3 ramp(float h) { float x = clamp(h / 16.0, 0.0, 1.0); return vec3(x, 1.0 - abs(x - 0.5) * 2.0, 1.0 - x); }
void main() {
  float L = u_layer; vec4 s1 = tap(L); float h1 = hOf(s1);
  if (u_mode == 0 || h1 < 0.0) { o = h1 < 0.0 ? vec4(0.08, 0.08, 0.08, 1.0) : vec4(ramp(h1) + 1e-4 * vec3(dOf(s1), pOf(s1)), 1.0); return; }
  vec4 s2 = tap(L + 1.0); float h2 = hOf(s2);
  if (h2 < 0.0) { o = vec4(ramp(h1), 1.0); return; }
  float t = u_t; float h; vec2 d; float p = t < 0.5 ? pOf(s1) : pOf(s2);   // period: nearest step, never blended
  if (u_mode == 1) { h = mix(h1, h2, t); d = mix(dOf(s1), dOf(s2), t); }
  else {
    vec4 s0 = tap(L - 1.0); vec4 s3 = tap(L + 2.0); float h0 = hOf(s0); float h3 = hOf(s3);
    if (h0 < 0.0) h0 = h1; if (h3 < 0.0) h3 = h2;
    float t2 = t * t; float t3 = t2 * t;
    float w0 = -0.5 * t3 + t2 - 0.5 * t; float w1 = 1.5 * t3 - 2.5 * t2 + 1.0; float w2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t; float w3 = 0.5 * t3 - 0.5 * t2;
    h = w0 * h0 + w1 * h1 + w2 * h2 + w3 * h3;
    float span = abs(h2 - h1); h = clamp(h, min(h1, h2) - 0.5 * span, max(h1, h2) + 0.5 * span);    // the hold-out's clamp
    d = w0 * dOf(s0) + w1 * dOf(s1) + w2 * dOf(s2) + w3 * dOf(s3);
  }
  float m = length(d); d = m < 0.2 ? (t < 0.5 ? dOf(s1) : dOf(s2)) : d / m;     // opposing directions: nearest, never a fake mean
  o = vec4(ramp(h) + 1e-4 * vec3(d, p), 1.0);
}`;
const FSV = `#version 300 es
precision highp float; precision highp sampler2DArray; precision highp int;
uniform sampler2DArray u_tex; uniform ivec3 u_at; out vec4 o; void main() { o = texelFetch(u_tex, u_at, 0); }`;
const VS1 = `attribute vec2 a; varying vec2 v_uv; void main(){ v_uv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;
const FS1 = `precision highp float; uniform sampler2D u_atlas; uniform vec2 u_tile; uniform vec2 u_size; uniform vec2 u_frame; varying vec2 v_uv;
vec3 ramp(float h) { float x = clamp(h / 16.0, 0.0, 1.0); return vec3(x, 1.0 - abs(x - 0.5) * 2.0, 1.0 - x); }
void main() { vec2 tx = u_tile + 0.5 + v_uv * (u_frame - 1.0); vec4 s = texture2D(u_atlas, tx / u_size); float b = s.r * 255.0;
  gl_FragColor = b < 0.5 ? vec4(0.08, 0.08, 0.08, 1.0) : vec4(ramp((b - 1.0) / 254.0 * 16.0), 1.0); }`;
function program(gl, vs, fs) {
  const p = gl.createProgram();
  [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(([t, src]) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); gl.attachShader(p, s); });
  gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}
function quad(gl) {
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}
function sizeCanvas(cv) {
  const dpr = +(Q.get('dpr') || devicePixelRatio || 1); const w = +(Q.get('w') || cv.clientWidth || 1280); const h = +(Q.get('h') || Math.round(w * 10 / 16));
  cv.style.width = `${w}px`; cv.style.height = `${h}px`; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); return [cv.width, cv.height];
}
function arrayTex(gl, fmt, cols, rows, depth) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, fmt === 'rgba16f' ? gl.RGBA16F : gl.RGBA8, cols, rows, depth); return t;
}
function uploadLayer(gl, fmt, cols, rows, layer, buf) {
  if (fmt === 'rgba16f') gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, cols, rows, 1, gl.RGBA, gl.HALF_FLOAT, new Uint16Array(buf));
  else gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, cols, rows, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(buf));
}

// ---------------------------------------------------------------------------------------------------------------- upload
async function phaseUpload(gl, packed8, packed16) {
  const { cols, rows } = INDEX; const N = INDEX.frames.length; const out = {};
  for (const [fmt, packed] of [['rgba8', packed8], ['rgba16f', packed16]]) {
    if (!packed || !packed[0]) continue;
    await fenceMs(gl);
    const a0 = performance.now(); const tex = arrayTex(gl, fmt, cols, rows, N); const allocCpu = performance.now() - a0; const allocGpu = await fenceMs(gl);
    const cpu = []; for (let k = 0; k < N; k++) { const t0 = performance.now(); uploadLayer(gl, fmt, cols, rows, k, packed[k]); cpu.push(performance.now() - t0); }
    const allGpu = await fenceMs(gl);
    // Drip: one layer per animation frame with its own fence (how frames arrive in practice), latency to GPU-complete.
    const drip = []; const dripCpu = [];
    for (let k = 0; k < 30; k++) { await raf(); const t0 = performance.now(); uploadLayer(gl, fmt, cols, rows, k, packed[k]); dripCpu.push(performance.now() - t0); drip.push(await fenceMs(gl)); }
    out[fmt] = { layers: N, bytesPerLayer: cols * rows * (fmt === 'rgba16f' ? 8 : 4), arrayMB: +(cols * rows * (fmt === 'rgba16f' ? 8 : 4) * N / 1048576).toFixed(2),
      allocCpuMs: +allocCpu.toFixed(3), allocGpuMs: allocGpu === null ? null : +allocGpu.toFixed(2), texSubImage3DCpuMs: stats(cpu), allLayersGpuMs: allGpu === null ? null : +allGpu.toFixed(2),
      dripCpuMs: stats(dripCpu), dripToGpuCompleteMs: stats(drip.filter((x) => x !== null)), err: gl.getError() };
    if (fmt === 'rgba8') out.keep = tex; else gl.deleteTexture(tex);
  }
  // Baseline: one 2D texture re-specified per step (texImage2D), as a per-step upload path does.
  const t2d = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t2d); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  const c2d = []; for (let k = 0; k < Math.min(60, N); k++) { const t0 = performance.now(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(packed8[k])); c2d.push(performance.now() - t0); }
  out.texImage2DBaselineCpuMs = stats(c2d); out.texImage2DGpuMs = await fenceMs(gl); gl.deleteTexture(t2d);
  return out;
}
async function phaseAtlas(packed8) {
  const cv = document.createElement('canvas'); cv.width = canvas.width; cv.height = canvas.height;
  const gl = cv.getContext('webgl', { antialias: false }); if (!gl) return { webgl1: false };
  const { cols, rows } = INDEX; const N = INDEX.frames.length; const AW = 2048; const tilesX = Math.floor(AW / cols); const AH = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 2048);
  const tilesY = Math.ceil(N / tilesX); const needH = tilesY * rows; const H = needH <= 1024 ? 1024 : AH;
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const a0 = performance.now(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, AW, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); const alloc = performance.now() - a0;
  const cpu = []; for (let k = 0; k < N; k++) { const t0 = performance.now(); gl.texSubImage2D(gl.TEXTURE_2D, 0, (k % tilesX) * cols, Math.floor(k / tilesX) * rows, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(packed8[k])); cpu.push(performance.now() - t0); }
  const prog = program(gl, VS1, FS1); gl.useProgram(prog.p); quad(gl); gl.viewport(0, 0, cv.width, cv.height);
  gl.uniform2f(prog.u.u_size, AW, H); gl.uniform2f(prog.u.u_frame, cols, rows);
  const dt = []; let last = null;
  for (let i = 0; i < 120; i++) { const ts = await raf(); if (last !== null) dt.push(ts - last); last = ts; const k = i % N; gl.uniform2f(prog.u.u_tile, (k % tilesX) * cols, Math.floor(k / tilesX) * rows); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
  // Verify: the texel at tile k's centre equals the packed bytes (tiles never bleed, because samples stay on texel centres).
  let bad = 0; const px = new Uint8Array(4);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  for (let k = 0; k < N; k += 7) { const x = (k % tilesX) * cols + 90; const y = Math.floor(k / tilesX) * rows + 41; gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const src = new Uint8Array(packed8[k]); const o = (41 * cols + 90) * 4; if (px[0] !== src[o] || px[1] !== src[o + 1] || px[2] !== src[o + 2] || px[3] !== src[o + 3]) bad++; }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const l = gl.getExtension('WEBGL_lose_context'); const out = { atlas: [AW, H], tiles: [tilesX, tilesY], tileSlots: tilesX * Math.floor(H / rows), allocCpuMs: +alloc.toFixed(3),
    texSubImage2DCpuMs: stats(cpu), scrubRafDtMs: stats(dt), verifyBad: bad, atlasMB: +(AW * H * 4 / 1048576).toFixed(1) };
  if (l) l.loseContext(); return out;
}

// ---------------------------------------------------------------------------------------------------------------- scrub
async function phaseScrub(gl, tex, packed8) {
  const N = INDEX.frames.length; const prog = program(gl, VS2, FS2); const ver = program(gl, VS2, FSV); quad(gl);
  gl.useProgram(prog.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); gl.uniform1i(prog.u.u_tex, 0); gl.uniform1i(prog.u.u_fmt, 0); gl.uniform1i(prog.u.u_mode, 0);
  gl.uniform1f(prog.u.u_last, N - 1); gl.viewport(0, 0, canvas.width, canvas.height);
  const out = {};
  for (const pattern of ['sweep', 'random']) {
    const dt = []; const cpu = []; let last = null; let L = 0;
    for (let i = 0; i < 240; i++) { const ts = await raf(); if (last !== null) dt.push(ts - last); last = ts; const t0 = performance.now();
      L = pattern === 'sweep' ? (L + 1) % N : Math.floor(Math.random() * N); gl.uniform1f(prog.u.u_layer, L); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); cpu.push(performance.now() - t0); }
    out[pattern] = { rafDtMs: stats(dt), cpuPerFrameMs: stats(cpu), over20ms: dt.filter((x) => x > 20).length };
  }
  // Key-press latency: real key events when a driver presses keys (?keys=driver), else synthetic events at random times.
  const lat = []; const frames = []; let pending = null; let cur = 0; let drawn = 0;
  const onKey = (e) => { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'PageUp') return; e.preventDefault();
    const step = e.key === 'PageUp' ? 24 / 3 : (e.key === 'ArrowRight' ? 1 : -1); cur = (cur + step + N) % N; if (!pending) pending = { at: e.timeStamp, frame: 0 }; };
  canvas.addEventListener('keydown', onKey);
  let running = true;
  const loop = (ts) => { if (!running) return; if (pending) { pending.frame++; gl.uniform1f(prog.u.u_layer, cur); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); lat.push(performance.now() - pending.at); frames.push(pending.frame); pending = null; drawn++; } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.__GFB_KEYS_READY__ = true;
  if (Q.get('keys') === 'driver') { const t0 = performance.now(); while (!window.__GFB_KEYS_DONE__ && performance.now() - t0 < 30000) await sleep(50); }
  else { canvas.focus(); for (let i = 0; i < 80; i++) { await sleep(20 + Math.random() * 60); canvas.dispatchEvent(new KeyboardEvent('keydown', { key: Math.random() < 0.15 ? 'PageUp' : 'ArrowRight', bubbles: true })); } await sleep(100); }
  running = false; canvas.removeEventListener('keydown', onKey);
  out.keyToDrawMs = stats(lat); out.keyToDrawFrames = stats(frames); out.keyEvents = drawn; out.keySource = Q.get('keys') === 'driver' ? 'real input (driver)' : 'synthetic dispatchEvent';
  // Correctness: texelFetch the layer the uniform names into a 1x1 target; it must equal the bytes uploaded for that layer.
  const fbt = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, fbt); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbt, 0);
  gl.useProgram(ver.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); gl.uniform1i(ver.u.u_tex, 0); gl.viewport(0, 0, 1, 1);
  let bad = 0; const px = new Uint8Array(4); const { cols, rows } = INDEX;
  for (let i = 0; i < 64; i++) { const L = Math.floor(Math.random() * N); const x = Math.floor(Math.random() * cols); const y = Math.floor(Math.random() * rows);
    gl.uniform3i(ver.u.u_at, x, y, L); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const s = new Uint8Array(packed8[L]); const o = (y * cols + x) * 4; if (px[0] !== s[o] || px[1] !== s[o + 1] || px[2] !== s[o + 2] || px[3] !== s[o + 3]) bad++; }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(fbt);
  out.verify = { samples: 64, bad };
  return { out, prog };
}
async function phaseInterp(gl, tex, prog) {
  const N = INDEX.frames.length; const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2'); const out = { timerQuery: !!tq, canvas: [canvas.width, canvas.height] };
  gl.useProgram(prog.p); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); gl.viewport(0, 0, canvas.width, canvas.height);
  for (const [name, mode] of [['nearest', 0], ['linear', 1], ['catmullRom', 2]]) {
    gl.uniform1i(prog.u.u_mode, mode); const gpu = []; const dt = []; let last = null; const reps = 8;
    for (let i = 0; i < 40; i++) {
      const ts = await raf(); if (last !== null) dt.push(ts - last); last = ts;
      gl.uniform1f(prog.u.u_layer, 1 + (i % (N - 3))); gl.uniform1f(prog.u.u_t, (i % 3 + 1) / 3);
      let q = null; if (tq) { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); }
      for (let r = 0; r < reps; r++) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); const qq = q; (async () => { for (let w = 0; w < 200; w++) { await tick(); if (gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6 / reps); gl.deleteQuery(qq); return; } } })(); }
    }
    await sleep(200);
    out[name] = { gpuMsPerFullscreenPass: gpu.length ? stats(gpu) : null, rafDtMsAt8Passes: stats(dt) };
  }
  if (!tq) { // no timer query: GPU time per pass from a fence after 30 passes
    for (const [name, mode] of [['nearest', 0], ['linear', 1], ['catmullRom', 2]]) {
      gl.uniform1i(prog.u.u_mode, mode); await fenceMs(gl); const t0 = performance.now(); for (let r = 0; r < 30; r++) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const g = await fenceMs(gl); out[name].fenceMsPer30Passes = g === null ? null : +(performance.now() - t0).toFixed(2);
    }
  }
  gl.uniform1i(prog.u.u_mode, 0); return out;
}
async function phaseToggle(gl, prog, packed8) {
  const { cols, rows } = INDEX; const N = INDEX.frames.length; const out = {};
  for (const variant of ['allocate', 'spare']) {
    const cpu = []; const gpu = []; let spare = variant === 'spare' ? arrayTex(gl, 'rgba8', cols, rows, N) : null; await fenceMs(gl);
    for (let i = 0; i < 12; i++) {
      await raf(); const t0 = performance.now();
      const t = spare || arrayTex(gl, 'rgba8', cols, rows, N); if (spare) gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      const k = Math.floor(Math.random() * N); uploadLayer(gl, 'rgba8', cols, rows, k, packed8[k]);
      gl.useProgram(prog.p); gl.uniform1f(prog.u.u_layer, k); gl.viewport(0, 0, canvas.width, canvas.height); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      cpu.push(performance.now() - t0); const g = await fenceMs(gl); if (g !== null) gpu.push(performance.now() - t0);
      if (!spare) gl.deleteTexture(t);
    }
    if (spare) gl.deleteTexture(spare);
    out[variant] = { cpuMs: stats(cpu), toGpuCompleteMs: stats(gpu) };
  }
  return out;
}
// The no-shader-change integration: copy layer k of the array into the engine's existing 2D wave texture (same size, RGBA8)
// with copyTexSubImage2D from a read framebuffer bound to that layer. Every existing sampler2D (heatmap, advect, draw) keeps
// reading the 2D texture it reads today. Verified byte-exact against the uploaded layer.
async function phaseCopy(gl, tex, packed8) {
  const { cols, rows } = INDEX; const N = INDEX.frames.length;
  const dst = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, dst); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, cols, rows);
  const rfb = gl.createFramebuffer(); const cpu = []; const gpu = []; let bad = 0; const px = new Uint8Array(cols * rows * 4);
  const vfb = gl.createFramebuffer();
  for (let i = 0; i < 40; i++) {
    await raf(); const k = Math.floor(Math.random() * N); const t0 = performance.now();
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rfb); gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, k);
    gl.bindTexture(gl.TEXTURE_2D, dst); gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cols, rows); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    cpu.push(performance.now() - t0); const g = await fenceMs(gl); if (g !== null) gpu.push(performance.now() - t0);
    if (i % 8 === 0) { // verify the whole copied frame
      gl.bindFramebuffer(gl.FRAMEBUFFER, vfb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
      gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const s = new Uint8Array(packed8[k]); for (let j = 0; j < s.length; j++) if (s[j] !== px[j]) { bad++; break; }
    }
  }
  gl.deleteFramebuffer(rfb); gl.deleteFramebuffer(vfb); gl.deleteTexture(dst);
  return { copies: 40, cpuMs: stats(cpu), toGpuCompleteMs: stats(gpu), verifiedFrames: 5, badFrames: bad, err: gl.getError() };
}
async function phaseMemory(gl) {
  const { cols, rows } = INDEX; const per = cols * rows * 4 * 128; const held = []; const steps = []; let total = 0;
  while (total < 448 * 1048576) {
    const t0 = performance.now(); const t = arrayTex(gl, 'rgba8', cols, rows, 128);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 127, cols, rows, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(cols * rows * 4)); // touch it
    const e = gl.getError(); const g = await fenceMs(gl); held.push(t); total += per;
    steps.push({ MB: +(total / 1048576).toFixed(1), err: e, ms: +(performance.now() - t0).toFixed(1), gpu: g === null ? null : +g.toFixed(1), lost: gl.isContextLost() });
    if (e !== 0 || gl.isContextLost()) break;
  }
  held.forEach((t) => gl.deleteTexture(t)); await fenceMs(gl);
  return { arrayMB: +(per / 1048576).toFixed(2), steps, reachedMB: +(total / 1048576).toFixed(1) };
}

// ---------------------------------------------------------------------------------------------------------------- run
async function run() {
  document.getElementById('run').disabled = true;
  try {
    mark('limits'); R.phases.limits = phaseLimits(); log('limits', { gl2: R.phases.limits.webgl2 && { r: R.phases.limits.webgl2.renderer, layers: R.phases.limits.webgl2.MAX_ARRAY_TEXTURE_LAYERS, tex: R.phases.limits.webgl2.MAX_TEXTURE_SIZE } });
    INDEX = await (await fetch('/frames/index.json')).json();
    if (Q.get('n')) INDEX.frames = INDEX.frames.slice(0, +Q.get('n'));
    R.series = { source: INDEX.source, frames: INDEX.frames.length, cols: INDEX.cols, rows: INDEX.rows, gzKB: Math.round(INDEX.frames.reduce((a, f) => a + f.bytes, 0) / 1024) };
    log('series', R.series);
    mark('decode'); const dec = {};
    const r8 = await decodeAll(2, 'rgba8', 6, true); dec.pool2_rgba8 = r8.res; log('decode pool2 rgba8', r8.res.wallMs, 'ms', r8.res.framesPerSec, 'fps');
    const r16 = await decodeAll(2, 'rgba16f', 6, true); dec.pool2_rgba16f = r16.res; log('decode pool2 rgba16f', r16.res.wallMs, 'ms');
    if (!SKIP.has('pools')) { dec.pool1_rgba8 = (await decodeAll(1, 'rgba8', 6, false)).res; dec.pool4_rgba8 = (await decodeAll(4, 'rgba8', 6, false)).res; dec.pool2_inflateOnly = (await decodeAll(2, 'none', 6, false)).res; }
    R.phases.decode = dec;
    if (!SKIP.has('vectors')) { mark('vectors'); R.phases.vectors = await phaseVectors(30); log('vectors', R.phases.vectors.syncBlockMs, 'heapPeakKB', R.phases.vectors.heapPeakDeltaKB); }
    sizeCanvas(canvas);
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) { R.phases.webgl2 = 'unavailable'; } else {
      mark('upload'); const up = await phaseUpload(gl, r8.packed, r16.packed); const tex = up.keep; delete up.keep; R.phases.upload = up; log('upload rgba8', up.rgba8 && up.rgba8.texSubImage3DCpuMs);
      mark('scrub'); const sc = await phaseScrub(gl, tex, r8.packed); R.phases.scrub = sc.out; log('scrub', sc.out.sweep.rafDtMs, 'key->draw', sc.out.keyToDrawMs, 'verify bad', sc.out.verify.bad);
      mark('interp'); R.phases.interp = await phaseInterp(gl, tex, sc.prog); log('interp', R.phases.interp);
      mark('toggle'); R.phases.toggle = await phaseToggle(gl, sc.prog, r8.packed); log('toggle', R.phases.toggle);
      mark('copy'); R.phases.copyLayerTo2D = await phaseCopy(gl, tex, r8.packed); log('copy', R.phases.copyLayerTo2D);
      if (Q.get('probe') === '1') { mark('memory'); gl.deleteTexture(tex); R.phases.memory = await phaseMemory(gl); log('memory', R.phases.memory.reachedMB, 'MB'); }
    }
    if (!SKIP.has('atlas')) { mark('atlas'); R.phases.atlasWebGL1 = await phaseAtlas(r8.packed); log('atlas', R.phases.atlasWebGL1); }
    mark('end');
  } catch (e) { R.error = String(e && e.stack || e); log('ERROR', R.error); }
  R.finishedAt = new Date().toISOString();
  try { await fetch('/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(R) }); } catch (e) { log('could not post results'); }
  window.__GFB_DONE__ = true; document.title = 'GPU frames bench: done'; log('done');
}
document.getElementById('run').addEventListener('click', run);
if (Q.get('auto') === '1') run();
