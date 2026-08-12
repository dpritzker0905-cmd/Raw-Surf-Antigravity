import { noteTextureCreated } from './WebGLWindUtils';

/**
 * Texture lifecycle + WebGL state scoping for the marine engine.
 *
 * Split out of WebGLMarineTextureEncoder.js on 2026-08-11 for the 800-LOC ratchet: that file sat at
 * 799 and the batching work below took it to 832. Same move the file already made once for
 * WebGLMarineFieldMath, and the encoder re-exports these so no importer or test changes.
 *
 * ⛔ `gl.getParameter` IS NOT FREE. Measured on deploy `23743f63`
 * (audit/weather-simulation-11.2/evidence/forensics/GATE6_cpu_profile_RUN.txt): 1465.9 ms of self
 * time, 4.6% of a 30 s profile, second only to `getImageData`. In Chrome's command-buffer
 * architecture each call is a synchronous round trip to the GPU process, and `encodeMarineTexture`
 * creates up to FIVE textures per commit — ten round trips where one pair would do.
 *
 * ★ The fix is NOT to stop reading the driver. A JS shadow of the binding would only know about our
 *   own `bindTexture` calls, and MapLibre shares this context — restoring a shadowed value would
 *   hand MapLibre a stale binding. The read stays real; it just stops happening N times.
 *   Between our own texture ops only our own code runs, so nothing external can observe the
 *   intermediate states: capture once at scope entry, restore once at exit.
 *
 * Standalone calls keep their own save/restore, so every existing caller is unchanged.
 * Pinned by WebGLMarineTextureEncoder.stateScope.test.js — count AND restore, including on throw.
 */

// Scopes are keyed BY CONTEXT, not held in one global slot. The first version used a single
// `_texScopeGl` and recursed forever the moment a second context was used while a scope was open:
// the foreign branch never registered itself, so the re-entrant `createTexture` saw "not in scope"
// and called back into `withTextureState`. A WeakSet makes "is this context already scoped?" the
// actual question being asked, and cannot leak a context.
const _texScopes = new WeakSet();
const _inScope = (gl) => _texScopes.has(gl);

export function withTextureState(gl, fn) {
  if (_texScopes.has(gl)) return fn();   // already inside a scope for THIS context
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
  const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  _texScopes.add(gl);
  try {
    return fn();
  } finally {
    // `finally`, not a trailing statement: a throw mid-batch must not leave MapLibre's binding
    // pointing at one of our textures.
    _texScopes.delete(gl);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
  }
}

export function updateTexture(gl, tex, data, width, height) {
  if (!_inScope(gl)) return withTextureState(gl, () => updateTexture(gl, tex, data, width, height));
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.textureUploadCount++;
  }
}

export function createTexture(gl, filter, data, width, height) {
  if (!_inScope(gl)) return withTextureState(gl, () => createTexture(gl, filter, data, width, height));
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  if (data instanceof Uint8Array) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.textureCount++;
    window.__RAW_GPU__.textureUploadCount++;
    window.__RAW_GPU__.gpuMemoryEstimate += width * height * 4;
  }
  // Record the size so `safeDeleteTexture` subtracts exactly what this added — the 07-05 drift was
  // a hardcoded 1024x512 subtracted against tiers up to 4096x2048.
  noteTextureCreated(tex, width, height);
  return tex;
}
