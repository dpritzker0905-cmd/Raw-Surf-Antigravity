/**
 * marineFrameStoreGpu.js — forecast frames resident on the GPU (GPU-resident frames, phase 2 step 5). Spec:
 * docs/architecture/gpu-resident-forecast-frames.md sections 3.2 and 3.4. NO IMPORTS on purpose: the standalone bench
 * (frontend/scripts/gpu-frames-bench/store-gpu-check.html) loads this exact file in a real browser to verify it on the GPU.
 *
 * WHY THIS SHAPE: every marine shader is GLSL ES 1.00 with `sampler2D` and sha256-pinned string rewriters, and the particles
 * read the same `u_waveTexture`. So frames live in WebGL2 texture ARRAYS (one layer per frame of a set, texStorage3D RGBA8) and a
 * scrub step COPIES the wanted layer into the engine's existing 2D wave texture (copyTexSubImage2D from a read framebuffer bound
 * to that layer). No shader changes. Bench: 0.02-0.025 ms CPU per copy, byte-exact, against 0.03-0.21 ms for re-uploading the
 * same 60 KB from the CPU.
 *
 * Textures are POOLED: a set gives its array back on release and the next set reuses it (a fresh 115-layer allocation took
 * 8.9-41 ms to GPU-complete in the bench, a reused one 1.1-12 ms). The pool never exceeds `maxArrays`; when full, the least
 * recently used set loses its array and acquire() names it, so the store marks its frames non-resident.
 *
 * GL STATE: every call saves and restores what it touches (TEXTURE_2D_ARRAY and TEXTURE_2D on the active unit, the READ
 * framebuffer, UNPACK_FLIP_Y_WEBGL and UNPACK_PREMULTIPLY_ALPHA_WEBGL, which must be false for a typed-array texSubImage3D).
 * The engine's own captureWebGLState saves TEXTURE_BINDING_2D only, so this module never relies on it. UNPACK_ALIGNMENT is not
 * touched: an RGBA8 row of 181 texels is 724 bytes, valid under alignment 1, 2 and 4 (MapLibre uses 1 and 4).
 *
 * WebGL1 (no arrays): uploadBytesTo2D() writes CPU-held bytes into the 2D texture (texSubImage2D, the measured fallback).
 */

export function isWebGL2(gl) {
  return !!gl && typeof gl.texStorage3D === 'function' && typeof gl.copyTexSubImage2D === 'function';
}

/** Can one array hold `depth` frames here? (WebGL2 guarantees 256 layers; 94-100% of devices report 2048.) */
export function supportsFrameArrays(gl, depth) {
  if (!isWebGL2(gl)) return false;
  const max = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
  return typeof max === 'number' && max >= depth;
}

function saveState(gl) {
  return {
    arr: gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY),
    tex: gl.getParameter(gl.TEXTURE_BINDING_2D),
    read: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),
    flip: gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),
    pre: gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL),
  };
}
function restoreState(gl, s) {
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, s.arr || null);
  gl.bindTexture(gl.TEXTURE_2D, s.tex || null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s.read || null);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !!s.flip);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!s.pre);
}

/**
 * A pool of frame arrays of one size. `depth` = layers per array (a set's frame count, the largest of the sets it will hold).
 * `now` is injectable for tests. Returns the pool API; every method is safe to call with an unknown set key.
 */
export function createFrameArrays(gl, { cols, rows, depth, maxArrays = 4, now = () => Date.now() } = {}) {
  if (!supportsFrameArrays(gl, depth)) return null;
  const bytesPerLayer = cols * rows * 4;
  const bySet = new Map();     // setKey -> { tex, lastUse }
  const free = [];             // textures with no set (the spare pool)
  let allocated = 0;
  const t = { allocs: 0, reuses: 0, evictions: 0, uploads: 0, copies: 0, errors: 0, lost: 0 };
  let readFbo = null;
  let dead = false;

  // CONTEXT LOSS (found 2026-10-22, second pass): after webglcontextlost + restore every object made before the loss is invalid, and
  // GL calls on it fail WITHOUT throwing, so a copy "succeeded" while the engine's texture kept the previous frame (its identity said
  // the new hour). Each upload and copy first checks that the context is live and its array is still a texture; when not, the pool
  // is dead: it drops its references (no GL calls on dead objects) and reports false, so the caller uses the CPU bytes instead.
  const isTex = (x) => typeof gl.isTexture !== 'function' || gl.isTexture(x);
  function alive(tex) {
    if (dead) return false;
    let ok = false;
    try { ok = !(typeof gl.isContextLost === 'function' && gl.isContextLost()) && (!tex || isTex(tex)); } catch (e) { ok = false; }
    if (!ok) { dead = true; t.lost += 1; bySet.clear(); free.length = 0; allocated = 0; readFbo = null; }
    return ok;
  }

  function allocate() {
    const prev = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    // NEAREST + CLAMP: the array is only ever COPIED from (never sampled), so filtering is irrelevant; NEAREST keeps it complete.
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, cols, rows, depth);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, prev || null);
    allocated += 1; t.allocs += 1;
    return tex;
  }

  /** Pre-allocate one spare so the first toggle never pays an allocation. */
  function ensureSpare() {
    if (free.length === 0 && allocated < maxArrays) free.push(allocate());
  }

  /** The array for `setKey`, allocating, reusing a free one, or evicting the least recently used set. */
  function acquire(setKey) {
    const have = bySet.get(setKey);
    if (have) { have.lastUse = now(); return { tex: have.tex, evicted: null }; }
    let tex = null; let evicted = null;
    if (free.length) { tex = free.pop(); t.reuses += 1; }
    else if (allocated < maxArrays) tex = allocate();
    else {
      let oldest = null;
      for (const [k, v] of bySet) if (!oldest || v.lastUse < oldest[1].lastUse) oldest = [k, v];
      if (!oldest) return { tex: null, evicted: null };
      evicted = oldest[0]; tex = oldest[1].tex; bySet.delete(evicted); t.evictions += 1; t.reuses += 1;
    }
    bySet.set(setKey, { tex, lastUse: now() });
    return { tex, evicted };
  }

  /** Give a set's array back to the pool (its layers are garbage from now on; the store forgets them). */
  function release(setKey) {
    const have = bySet.get(setKey);
    if (!have) return false;
    bySet.delete(setKey); free.push(have.tex);
    return true;
  }

  /** Upload frames: items = [{ layer, bytes }] into `setKey`'s array. One state save/restore for the batch. */
  function uploadMany(setKey, items) {
    const have = bySet.get(setKey);
    if (!have || !items || !items.length || !alive(have.tex)) return 0;
    const s = saveState(gl);
    let n = 0;
    try {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, have.tex);
      for (const it of items) {
        if (!(it.layer >= 0 && it.layer < depth) || !it.bytes || it.bytes.byteLength !== bytesPerLayer) { t.errors += 1; continue; }
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, it.layer, cols, rows, 1, gl.RGBA, gl.UNSIGNED_BYTE, it.bytes);
        n += 1;
      }
      have.lastUse = now(); t.uploads += n;
    } finally { restoreState(gl, s); }
    return n;
  }

  /**
   * The scrub step: copy layer `layer` of `setKey`'s array into `dstTex` (a 2D RGBA8 texture of the same cols x rows; the
   * engine's resident wave texture). Returns false when the set has no array or the layer is out of range (caller falls back).
   */
  function copyToTexture(setKey, layer, dstTex) {
    const have = bySet.get(setKey);
    if (!have || !dstTex || !(layer >= 0 && layer < depth) || !alive(have.tex) || !isTex(dstTex)) return false;
    const s = saveState(gl);
    try {
      if (!readFbo) readFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFbo);
      gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, have.tex, 0, layer);
      gl.bindTexture(gl.TEXTURE_2D, dstTex);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cols, rows);
      have.lastUse = now(); t.copies += 1;
      return true;
    } catch (e) {
      t.errors += 1;
      return false;
    } finally { restoreState(gl, s); }
  }

  function dispose() {
    for (const v of bySet.values()) gl.deleteTexture(v.tex);
    for (const tex of free) gl.deleteTexture(tex);
    if (readFbo) gl.deleteFramebuffer(readFbo);
    bySet.clear(); free.length = 0; allocated = 0; readFbo = null;
  }

  return {
    cols, rows, depth, bytesPerLayer, maxArrays,
    ensureSpare, acquire, release, uploadMany, copyToTexture, dispose,
    has: (setKey) => bySet.has(setKey),
    /** False once the context was lost: the caller drops this pool and the store's residency, and builds a new pool later. */
    alive: () => alive(null),
    allocatedBytes: () => allocated * depth * bytesPerLayer,
    telemetry: () => ({ ...t, arrays: allocated, sets: bySet.size, spare: free.length, allocatedMB: +((allocated * depth * bytesPerLayer) / 1048576).toFixed(2) }),
  };
}

/** WebGL1 / no-array fallback: write CPU-held frame bytes into the 2D wave texture (same cols x rows). */
export function uploadBytesTo2D(gl, dstTex, bytes, cols, rows) {
  if (!gl || !dstTex || !bytes || bytes.byteLength !== cols * rows * 4) return false;
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
  const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  const pre = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
  try {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, dstTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return true;
  } finally {
    gl.bindTexture(gl.TEXTURE_2D, prevTex || null);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !!flip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!pre);
  }
}
