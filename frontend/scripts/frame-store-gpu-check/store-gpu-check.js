// Real-GPU check of frontend/src/components/map/marineFrameStoreGpu.js (served by run.js under /appsrc/). Posts its results.
import { createFrameArrays, supportsFrameArrays, uploadBytesTo2D } from '/appsrc/marineFrameStoreGpu.js'; // served by run.js from src/

const Q = new URLSearchParams(location.search);
const LABEL = Q.get('label') || 'manual';
const logEl = document.getElementById('log');
const log = (...a) => { logEl.textContent += a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n'; };
const COLS = 181; const ROWS = 83; const N = 24;
const R = { label: LABEL, startedAt: new Date().toISOString(), checks: {} };
window.__GFB_RESULTS__ = R;

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const frames = Array.from({ length: N }, (_, k) => { const r = rng(k + 1); const b = new Uint8Array(COLS * ROWS * 4); for (let i = 0; i < b.length; i++) b[i] = Math.floor(r() * 256); return b; });
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))].toFixed(3); };

function readTex(gl, tex) {
  const fb = gl.createFramebuffer(); const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const px = new Uint8Array(COLS * ROWS * 4); gl.readPixels(0, 0, COLS, ROWS, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prev); gl.deleteFramebuffer(fb); return px;
}
const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
// The engine's resident wave texture is made this way (WebGLMarineTextureState.createTexture): unsized RGBA, LINEAR, CLAMP.
function engineLikeTexture(gl) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, COLS, ROWS, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(COLS * ROWS * 4));
  gl.bindTexture(gl.TEXTURE_2D, null); return t;
}
async function fence(gl) { const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); const t0 = performance.now();
  for (;;) { await new Promise((r) => setTimeout(r, 0)); if (gl.getSyncParameter(s, gl.SYNC_STATUS) === gl.SIGNALED) { gl.deleteSync(s); return performance.now() - t0; } } }

async function webgl2Checks() {
  const c = document.createElement('canvas'); const gl = c.getContext('webgl2');
  if (!gl) return { webgl2: false };
  const out = { renderer: (() => { const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })(),
    supports: supportsFrameArrays(gl, N) };
  const pool = createFrameArrays(gl, { cols: COLS, rows: ROWS, depth: N, maxArrays: 2 });
  pool.ensureSpare();
  pool.acquire('A');
  // Upload with the caller's FLIP_Y and PREMULTIPLY set to TRUE: a typed-array texSubImage3D is INVALID_OPERATION under them,
  // so the module must clear them and put them back.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  out.uploaded = pool.uploadMany('A', frames.map((bytes, layer) => ({ layer, bytes })));
  out.uploadError = gl.getError();
  out.pixelStoreRestored = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) === true && gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) === true;
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  const target = engineLikeTexture(gl);
  const foreignTex = gl.createTexture(); const foreignFbo = gl.createFramebuffer();
  const order = Array.from({ length: N }, (_, k) => k).sort(() => Math.random() - 0.5);
  let exact = 0; let restored = 0; let errors = 0; const cpu = []; const gpu = [];
  for (const k of order) {
    gl.bindTexture(gl.TEXTURE_2D, foreignTex); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, foreignFbo);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const t0 = performance.now(); const ok = pool.copyToTexture('A', k, target); cpu.push(performance.now() - t0);
    gpu.push(await fence(gl));
    const st = gl.getParameter(gl.TEXTURE_BINDING_2D) === foreignTex && gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === foreignFbo
      && gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) === true && gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY) === null;
    if (st) restored += 1;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    if (gl.getError() !== 0) errors += 1;
    if (ok && same(readTex(gl, target), frames[k])) exact += 1;
  }
  out.copies = { n: N, byteExact: exact, stateRestored: restored, glErrors: errors, cpuMs: { p50: pct(cpu, 0.5), p95: pct(cpu, 0.95) }, toGpuCompleteMs: { p50: pct(gpu, 0.5), p95: pct(gpu, 0.95) } };
  const b = pool.acquire('B'); const cAcq = pool.acquire('C');
  out.eviction = { bEvicted: b.evicted, cEvicted: cAcq.evicted, telemetry: pool.telemetry() };
  pool.dispose();
  return out;
}

function webgl1Check() {
  const c = document.createElement('canvas'); const gl = c.getContext('webgl');
  if (!gl) return { webgl1: false };
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, COLS, ROWS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const foreign = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, foreign); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const ok = uploadBytesTo2D(gl, t, frames[3], COLS, ROWS);
  const restored = gl.getParameter(gl.TEXTURE_BINDING_2D) === foreign && gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) === true;
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  const px = new Uint8Array(COLS * ROWS * 4); gl.readPixels(0, 0, COLS, ROWS, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { ok, byteExact: same(px, frames[3]), stateRestored: restored, glError: gl.getError() };
}

(async () => {
  try { R.checks.webgl2 = await webgl2Checks(); R.checks.webgl1 = webgl1Check(); } catch (e) { R.error = String(e && e.stack || e); }
  log(JSON.stringify(R, null, 1));
  try { await fetch('/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(R) }); } catch (e) { /* offline */ }
  window.__GFB_DONE__ = true;
})();
