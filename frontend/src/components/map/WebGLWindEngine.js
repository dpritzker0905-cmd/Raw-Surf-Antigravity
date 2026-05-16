/**
 * WebGLWindEngine — GPU-accelerated wind particle advection + trail fading
 *
 * v3.8: Replaces Canvas2D particle loop with WebGL ping-pong framebuffer
 * architecture for 10-50x more particles with trail decay.
 *
 * Architecture:
 *   1. Wind vectors → GPU texture (RGBA encoding of u,v per grid cell)
 *   2. Particle positions → ping-pong framebuffers (read/write swap each frame)
 *   3. Advection shader: sample wind texture → move particle positions
 *   4. Trail texture: alpha-blend particles → fade previous frame (persistence)
 *   5. Final composite: render trail texture to screen canvas
 */

// --- Shader Sources ---

const ADVECT_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const ADVECT_FS = `
precision highp float;
uniform sampler2D u_particles;    // current particle positions (RGBA = x_hi,x_lo,y_hi,y_lo)
uniform sampler2D u_wind;         // wind field texture (RG = u, BA = v)
uniform vec2 u_wind_min;          // min u,v values for decoding
uniform vec2 u_wind_max;          // max u,v values for decoding
uniform vec2 u_wind_res;          // wind grid resolution (cols, rows)
uniform float u_speed_factor;     // advection speed multiplier
uniform float u_rand_seed;        // per-frame random seed for respawn
uniform float u_drop_rate;        // base particle drop rate
uniform float u_drop_rate_bump;   // speed-dependent drop rate increase
varying vec2 v_uv;

// Decode position from 2-channel encoding (16-bit precision per axis)
vec2 decodePos(vec4 color) {
  return vec2(
    color.r / 255.0 + color.g,
    color.b / 255.0 + color.a
  );
}

vec4 encodePos(vec2 pos) {
  // Encode position into RGBA with sub-pixel precision
  vec2 clamped = clamp(pos, 0.0, 1.0);
  float x_hi = floor(clamped.x * 255.0);
  float x_lo = fract(clamped.x * 255.0);
  float y_hi = floor(clamped.y * 255.0);
  float y_lo = fract(clamped.y * 255.0);
  return vec4(x_hi / 255.0, x_lo, y_hi / 255.0, y_lo);
}

// Pseudo-random hash
float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

vec2 lookupWind(vec2 uv) {
  vec4 color = texture2D(u_wind, uv);
  // Decode from [0,1] range back to actual wind values
  return mix(u_wind_min, u_wind_max, vec2(color.r, color.g));
}

void main() {
  vec4 encoded = texture2D(u_particles, v_uv);
  vec2 pos = decodePos(encoded);

  // Lookup wind at this position
  vec2 wind = lookupWind(pos);
  float speed = length(wind);

  // Advect: move particle by wind velocity (normalized to [0,1] space)
  vec2 offset = wind * u_speed_factor;
  pos = pos + offset;

  // Respawn logic: randomly drop particles (more likely when slow)
  vec2 seed = (pos + v_uv) * u_rand_seed;
  float dropRate = u_drop_rate + speed * u_drop_rate_bump;
  float drop = step(1.0 - dropRate, rand(seed));

  // Random new position for respawned particles
  vec2 newPos = vec2(rand(seed + 1.3), rand(seed + 2.1));

  // Out of bounds check
  float oob = step(1.0, pos.x) + step(1.0, pos.y) +
              step(0.0, -pos.x) + step(0.0, -pos.y);
  drop = max(drop, step(0.5, oob));

  pos = mix(pos, newPos, drop);
  gl_FragColor = encodePos(pos);
}`;

const DRAW_VS = `
attribute float a_index;
uniform sampler2D u_particles;
uniform float u_particles_res;
uniform mat4 u_matrix;
uniform vec2 u_dataBounds_min;   // [west, south] in degrees
uniform vec2 u_dataBounds_max;   // [east, north] in degrees
varying float v_speed;
uniform sampler2D u_wind;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;

vec2 decodePos(vec4 color) {
  return vec2(
    color.r / 255.0 + color.g,
    color.b / 255.0 + color.a
  );
}

void main() {
  // Particle UV in state texture
  float col = mod(a_index, u_particles_res);
  float row = floor(a_index / u_particles_res);
  vec2 uv = (vec2(col, row) + 0.5) / u_particles_res;

  vec4 encoded = texture2D(u_particles, uv);
  vec2 pos = decodePos(encoded);

  // Convert [0,1] → [lng, lat]
  float lng = mix(u_dataBounds_min.x, u_dataBounds_max.x, pos.x);
  float lat = mix(u_dataBounds_min.y, u_dataBounds_max.y, pos.y);

  // Speed for coloring
  vec4 windColor = texture2D(u_wind, pos);
  vec2 wind = mix(u_wind_min, u_wind_max, vec2(windColor.r, windColor.g));
  v_speed = length(wind);

  // Convert to Mercator for MapLibre
  float x = (lng + 180.0) / 360.0;
  float y = (1.0 - log(tan(radians(lat)) + 1.0 / cos(radians(lat))) / 3.141592653589793) / 2.0;

  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;

const DRAW_FS = `
precision mediump float;
varying float v_speed;
void main() {
  // Dark, semi-transparent particles — heatmap carries color
  float alpha = clamp(0.15 + v_speed * 0.015, 0.1, 0.6);
  gl_FragColor = vec4(0.06, 0.06, 0.1, alpha);
}`;

const SCREEN_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const SCREEN_FS = `
precision mediump float;
uniform sampler2D u_screen;
uniform float u_opacity;
varying vec2 v_uv;
void main() {
  vec4 color = texture2D(u_screen, v_uv);
  gl_FragColor = vec4(color.rgb, color.a * u_opacity);
}`;

const FADE_FS = `
precision mediump float;
uniform sampler2D u_screen;
uniform float u_fade;
varying vec2 v_uv;
void main() {
  vec4 color = texture2D(u_screen, v_uv);
  gl_FragColor = vec4(color.rgb, color.a * u_fade);
}`;

// --- Utility Functions ---

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[WebGLWind] Shader error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl, vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[WebGLWind] Link error:', gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

function createTexture(gl, filter, data, width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  if (data instanceof Uint8Array) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  } else if (data == null) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }
  return tex;
}

function createFBO(gl, filter, width, height) {
  const tex = createTexture(gl, filter, null, width, height);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo };
}

function bindTexture(gl, tex, unit) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
}

/**
 * Encode wind grid data into an RGBA texture.
 * R = normalized u, G = normalized v, B = speed (for lookup), A = 1.0
 */
function encodeWindTexture(gl, windGrid) {
  const { vectors, cols, rows, bounds } = windGrid;
  if (!vectors?.length || !cols || !rows) return null;

  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;

  for (const v of vectors) {
    if (v.u < minU) minU = v.u;
    if (v.u > maxU) maxU = v.u;
    if (v.v < minV) minV = v.v;
    if (v.v > maxV) maxV = v.v;
  }

  // Prevent division by zero
  if (maxU === minU) { maxU = minU + 1; }
  if (maxV === minV) { maxV = minV + 1; }

  const data = new Uint8Array(cols * rows * 4);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    const nu = (v.u - minU) / (maxU - minU);
    const nv = (v.v - minV) / (maxV - minV);
    const speed = Math.min(1.0, v.speed / 40); // Normalize to ~40kts max
    data[i * 4 + 0] = Math.floor(nu * 255);
    data[i * 4 + 1] = Math.floor(nv * 255);
    data[i * 4 + 2] = Math.floor(speed * 255);
    data[i * 4 + 3] = 255;
  }

  const tex = createTexture(gl, gl.LINEAR, data, cols, rows);
  return {
    texture: tex,
    uMin: [minU, minV],
    uMax: [maxU, maxV],
    bounds
  };
}

/**
 * Initialize random particle positions as a texture.
 * Each particle position is encoded as RGBA = (x_hi, x_lo, y_hi, y_lo)
 */
function initParticleTexture(gl, resolution) {
  const numParticles = resolution * resolution;
  const data = new Uint8Array(numParticles * 4);
  for (let i = 0; i < numParticles; i++) {
    // Random position in [0,1] x [0,1] encoded as 2-channel 16-bit
    const x = Math.random();
    const y = Math.random();
    const xHi = Math.floor(x * 255);
    const xLo = Math.floor(((x * 255) - xHi) * 255);
    const yHi = Math.floor(y * 255);
    const yLo = Math.floor(((y * 255) - yHi) * 255);
    data[i * 4 + 0] = xHi;
    data[i * 4 + 1] = xLo;
    data[i * 4 + 2] = yHi;
    data[i * 4 + 3] = yLo;
  }
  return createTexture(gl, gl.NEAREST, data, resolution, resolution);
}

// --- Exported Class ---

export default class WebGLWindEngine {
  constructor() {
    this.particleRes = 128; // 128x128 = 16,384 particles
    this.fadeOpacity = 0.985; // Trail persistence (higher = longer trails)
    this.speedFactor = 0.15; // Advection multiplier
    this.dropRate = 0.003;
    this.dropRateBump = 0.01;
    this._initialized = false;
    this._windData = null;
  }

  /**
   * Initialize all WebGL resources. Call once with a GL context.
   */
  init(gl) {
    if (this._initialized) return;

    // Build shader programs
    const advVS = createShader(gl, gl.VERTEX_SHADER, ADVECT_VS);
    const advFS = createShader(gl, gl.FRAGMENT_SHADER, ADVECT_FS);
    const drawVS = createShader(gl, gl.VERTEX_SHADER, DRAW_VS);
    const drawFS = createShader(gl, gl.FRAGMENT_SHADER, DRAW_FS);
    const screenVS = createShader(gl, gl.VERTEX_SHADER, SCREEN_VS);
    const screenFS = createShader(gl, gl.FRAGMENT_SHADER, SCREEN_FS);
    const fadeVS = createShader(gl, gl.VERTEX_SHADER, SCREEN_VS);
    const fadeFS = createShader(gl, gl.FRAGMENT_SHADER, FADE_FS);

    if (!advVS || !advFS || !drawVS || !drawFS || !screenVS || !screenFS) {
      console.error('[WebGLWind] Failed to compile shaders');
      return;
    }

    this.advectProgram = createProgram(gl, advVS, advFS);
    this.drawProgram = createProgram(gl, drawVS, drawFS);
    this.screenProgram = createProgram(gl, screenVS, screenFS);
    this.fadeProgram = createProgram(gl, fadeVS, fadeFS);

    // Full-screen quad
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    // Particle index buffer
    const indices = new Float32Array(this.particleRes * this.particleRes);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    this.particleIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleIndexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    // Particle state textures (ping-pong)
    this.particleStateA = initParticleTexture(gl, this.particleRes);
    this.particleStateB = initParticleTexture(gl, this.particleRes);

    // Persistent advection FBO (avoid creating/deleting every frame)
    this.advFBO = gl.createFramebuffer();

    this._initialized = true;
    console.log(`[WebGLWind] Initialized: ${this.particleRes * this.particleRes} particles`);
  }

  /**
   * Update the wind data texture from new grid data.
   */
  setWindData(gl, windGrid) {
    if (!windGrid?.vectors?.length) return;
    // Clean up previous
    if (this._windData?.texture) {
      gl.deleteTexture(this._windData.texture);
    }
    this._windData = encodeWindTexture(gl, windGrid);
  }

  /**
   * Render one frame: advect particles, draw trails, composite.
   * v3.8.3: Fixed feedback loop, matrix null guard, GL state restoration.
   */
  render(gl, matrix, screenWidth, screenHeight) {
    if (!this._initialized || !this._windData) return;
    if (!matrix || !matrix.length) return; // Guard: prevents 'no array' spam

    if (!this.screenA || this._screenW !== screenWidth || this._screenH !== screenHeight) {
      if (this.screenA) {
        gl.deleteFramebuffer(this.screenA.fbo);
        gl.deleteTexture(this.screenA.tex);
        gl.deleteFramebuffer(this.screenB.fbo);
        gl.deleteTexture(this.screenB.tex);
      }
      this.screenA = createFBO(gl, gl.NEAREST, screenWidth, screenHeight);
      this.screenB = createFBO(gl, gl.NEAREST, screenWidth, screenHeight);
      this._screenW = screenWidth;
      this._screenH = screenHeight;
    }

    const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
    const prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const prevBlend = gl.getParameter(gl.BLEND);
    const mat4 = matrix instanceof Float32Array ? matrix : new Float32Array(matrix);

    // === Step 1: Advect particles (ping-pong) ===
    gl.useProgram(this.advectProgram);
    gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_particles'), 0);
    gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_wind'), 1);
    gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_wind_min'), ...this._windData.uMin);
    gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_wind_max'), ...this._windData.uMax);
    gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_wind_res'), 1, 1);
    gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speed_factor'), this.speedFactor);
    gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_rand_seed'), Math.random());
    gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate'), this.dropRate);
    gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate_bump'), this.dropRateBump);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D,
      this.particleStateB, 0);
    gl.viewport(0, 0, this.particleRes, this.particleRes);
    bindTexture(gl, this.particleStateA, 0);
    bindTexture(gl, this._windData.texture, 1);

    const advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(advPosLoc);
    gl.vertexAttribPointer(advPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(advPosLoc);

    // Detach texture from FBO before reading (prevents feedback loop)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    const tmp = this.particleStateA;
    this.particleStateA = this.particleStateB;
    this.particleStateB = tmp;

    // === Step 2: Fade screen A → screen B ===
    gl.useProgram(this.fadeProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenB.fbo);
    gl.viewport(0, 0, screenWidth, screenHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1i(gl.getUniformLocation(this.fadeProgram, 'u_screen'), 0);
    gl.uniform1f(gl.getUniformLocation(this.fadeProgram, 'u_fade'), this.fadeOpacity);
    bindTexture(gl, this.screenA.tex, 0);
    const fadePosLoc = gl.getAttribLocation(this.fadeProgram, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(fadePosLoc);
    gl.vertexAttribPointer(fadePosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(fadePosLoc);

    // === Step 3: Draw particles onto screen B ===
    gl.useProgram(this.drawProgram);
    gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_particles'), 0);
    gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_wind'), 1);
    gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_particles_res'), this.particleRes);
    gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_wind_min'), ...this._windData.uMin);
    gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_wind_max'), ...this._windData.uMax);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.drawProgram, 'u_matrix'), false, mat4);
    const b = this._windData.bounds;
    gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_min'), b.west, b.south);
    gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_max'), b.east, b.north);
    bindTexture(gl, this.particleStateA, 0);
    bindTexture(gl, this._windData.texture, 1);
    const idxLoc = gl.getAttribLocation(this.drawProgram, 'a_index');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleIndexBuffer);
    gl.enableVertexAttribArray(idxLoc);
    gl.vertexAttribPointer(idxLoc, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, this.particleRes * this.particleRes);
    gl.disableVertexAttribArray(idxLoc);

    // Copy screenB → screenA for next frame persistence (avoids swap feedback)
    gl.useProgram(this.screenProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenA.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1i(gl.getUniformLocation(this.screenProgram, 'u_screen'), 0);
    gl.uniform1f(gl.getUniformLocation(this.screenProgram, 'u_opacity'), 1.0);
    bindTexture(gl, this.screenB.tex, 0);
    const cpLoc = gl.getAttribLocation(this.screenProgram, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(cpLoc);
    gl.vertexAttribPointer(cpLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(cpLoc);

    // === Step 4: Composite screen B to main framebuffer ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
    gl.viewport(0, 0, screenWidth, screenHeight);
    bindTexture(gl, this.screenB.tex, 0);
    const scrLoc = gl.getAttribLocation(this.screenProgram, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(scrLoc);
    gl.vertexAttribPointer(scrLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(scrLoc);

    // Restore MapLibre GL state
    if (!prevBlend) gl.disable(gl.BLEND);
    gl.useProgram(prevProg);
  }

  /**
   * Clean up all GL resources.
   */
  dispose(gl) {
    if (!gl) return;
    if (this.advectProgram) gl.deleteProgram(this.advectProgram);
    if (this.drawProgram) gl.deleteProgram(this.drawProgram);
    if (this.screenProgram) gl.deleteProgram(this.screenProgram);
    if (this.fadeProgram) gl.deleteProgram(this.fadeProgram);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
    if (this.particleIndexBuffer) gl.deleteBuffer(this.particleIndexBuffer);
    if (this.advFBO) gl.deleteFramebuffer(this.advFBO);
    if (this.particleStateA) gl.deleteTexture(this.particleStateA);
    if (this.particleStateB) gl.deleteTexture(this.particleStateB);
    if (this._windData?.texture) gl.deleteTexture(this._windData.texture);
    if (this.screenA) {
      gl.deleteFramebuffer(this.screenA.fbo);
      gl.deleteTexture(this.screenA.tex);
    }
    if (this.screenB) {
      gl.deleteFramebuffer(this.screenB.fbo);
      gl.deleteTexture(this.screenB.tex);
    }
    this._initialized = false;
    console.log('[WebGLWind] Disposed');
  }
}
