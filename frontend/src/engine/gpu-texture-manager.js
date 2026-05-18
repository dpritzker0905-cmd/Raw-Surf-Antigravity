/**
 * GPU Texture Manager Persistent GPU Resource Pool
 *
 * Manages WebGL textures, framebuffers, and shared state across frames.
 * Prevents the #1 GPU performance killer: recreating resources per frame.
 *
 * RULES:
 *   - NO import-time side effects
 *   - NO React coupling
 *   - ALL resources tracked for cleanup
 *   - Texture reuse via named slots
 *   - Frame-persistent: resources survive across renders
 */

// RESOURCE POOLS 
const _textures = new Map(); // name { texture, width, height, format }
const _framebuffers = new Map(); // name { fb, colorTex }
const _vaos = new Map(); // name VAO
let _gl = null;
let _lostContextCount = 0;

/**
 * Bind to a WebGL context. Call once when the shared GL context is available.
 * @param {WebGL2RenderingContext|WebGLRenderingContext} gl
 */
export function bindContext(gl) {
  if (_gl === gl) return;
 // Context changed purge all resources from old context
  if (_gl) destroyAll();
  _gl = gl;
  _lostContextCount = 0;
  console.log('[GPUTexMgr] Context bound');
}

/**
 * Get or create a 2D texture by name.
 * If the texture already exists with matching dimensions, return it.
 * Otherwise, create (or recreate) it.
 *
 * @param {string} name - Unique slot name
 * @param {number} width
 * @param {number} height
 * @param {object} [opts]
 * @param {number} [opts.internalFormat] - gl.RGBA, gl.R32F, etc.
 * @param {number} [opts.format] - gl.RGBA, gl.RED, etc.
 * @param {number} [opts.type] - gl.UNSIGNED_BYTE, gl.FLOAT, etc.
 * @param {number} [opts.filter] - gl.LINEAR or gl.NEAREST
 * @param {number} [opts.wrap] - gl.CLAMP_TO_EDGE, gl.REPEAT
 * @param {ArrayBufferView} [opts.data] - Initial pixel data (null = empty)
 * @returns {WebGLTexture|null}
 */
export function getTexture(name, width, height, opts = {}) {
  if (!_gl) return null;
  const gl = _gl;

  const existing = _textures.get(name);
  if (existing && existing.width === width && existing.height === height) {
 // Reuse existing texture optionally upload new data
    if (opts.data) {
      gl.bindTexture(gl.TEXTURE_2D, existing.texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height,
        opts.format || gl.RGBA, opts.type || gl.UNSIGNED_BYTE, opts.data);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    return existing.texture;
  }

  // Clean up old texture if dimensions changed
  if (existing) {
    gl.deleteTexture(existing.texture);
  }

  const tex = gl.createTexture();
  const internalFormat = opts.internalFormat || gl.RGBA;
  const format = opts.format || gl.RGBA;
  const type = opts.type || gl.UNSIGNED_BYTE;
  const filter = opts.filter || gl.LINEAR;
  const wrap = opts.wrap || gl.CLAMP_TO_EDGE;

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0,
    format, type, opts.data || null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.bindTexture(gl.TEXTURE_2D, null);

  _textures.set(name, { texture: tex, width, height, format: internalFormat });
  return tex;
}

/**
 * Upload data to an existing named texture without recreating it.
 * @param {string} name
 * @param {ArrayBufferView} data
 * @returns {boolean} success
 */
export function uploadTextureData(name, data) {
  if (!_gl) return false;
  const entry = _textures.get(name);
  if (!entry) return false;
  const gl = _gl;

  gl.bindTexture(gl.TEXTURE_2D, entry.texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, entry.width, entry.height,
    gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return true;
}

/**
 * Get or create a framebuffer with an attached color texture.
 * Used for ping-pong buffers, offscreen rendering, etc.
 *
 * @param {string} name - Unique slot name
 * @param {number} width
 * @param {number} height
 * @returns {{ fb: WebGLFramebuffer, texture: WebGLTexture }|null}
 */
export function getFramebuffer(name, width, height) {
  if (!_gl) return null;
  const gl = _gl;

  const existing = _framebuffers.get(name);
  if (existing && existing.width === width && existing.height === height) {
    return { fb: existing.fb, texture: existing.colorTex };
  }

  // Clean up old
  if (existing) {
    gl.deleteFramebuffer(existing.fb);
    gl.deleteTexture(existing.colorTex);
  }

  const colorTex = getTexture(`__fb_${name}`, width, height, {
    filter: gl.NEAREST,
    type: gl.UNSIGNED_BYTE,
  });

  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D, colorTex, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.warn(`[GPUTexMgr] Framebuffer '${name}' incomplete: ${status}`);
    gl.deleteFramebuffer(fb);
    return null;
  }

  _framebuffers.set(name, { fb, colorTex, width, height });
  return { fb, texture: colorTex };
}

/**
 * Create a ping-pong buffer pair for temporal blending / simulation.
 * Returns two framebuffers that can be swapped each frame.
 *
 * @param {string} baseName
 * @param {number} width
 * @param {number} height
 * @returns {{ read: { fb, texture }, write: { fb, texture }, swap: Function }|null}
 */
export function getPingPongBuffers(baseName, width, height) {
  const a = getFramebuffer(`${baseName}_a`, width, height);
  const b = getFramebuffer(`${baseName}_b`, width, height);
  if (!a || !b) return null;

  const state = { read: a, write: b };
  state.swap = () => {
    const tmp = state.read;
    state.read = state.write;
    state.write = tmp;
  };
  return state;
}

/**
 * Delete a named texture and free GPU memory.
 * @param {string} name
 */
export function releaseTexture(name) {
  if (!_gl) return;
  const entry = _textures.get(name);
  if (entry) {
    _gl.deleteTexture(entry.texture);
    _textures.delete(name);
  }
}

/**
 * Destroy all GPU resources. Call on context loss or unmount.
 */
export function destroyAll() {
  if (!_gl) return;
  const gl = _gl;

  for (const [, entry] of _textures) {
    gl.deleteTexture(entry.texture);
  }
  _textures.clear();

  for (const [, entry] of _framebuffers) {
    gl.deleteFramebuffer(entry.fb);
    // Color tex is in _textures map, already deleted
  }
  _framebuffers.clear();

  for (const [, vao] of _vaos) {
    if (gl.deleteVertexArray) gl.deleteVertexArray(vao);
  }
  _vaos.clear();

  console.log('[GPUTexMgr] All resources destroyed');
}

/**
 * Get diagnostic info about GPU resource usage.
 */
export function getResourceStats() {
  return {
    textures: _textures.size,
    framebuffers: _framebuffers.size,
    vaos: _vaos.size,
    hasContext: !!_gl,
  };
}
