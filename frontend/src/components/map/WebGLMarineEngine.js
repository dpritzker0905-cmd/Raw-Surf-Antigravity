/**
 * WebGLMarineEngine.js
 * GPU-accelerated wave crest simulation engine.
 * Renders pulsing, perpendicular wave fronts using gl.drawArrays(gl.LINES).
 * Strictly conforms to WebGL State Isolation Protocol and is < 500 lines of code.
 */

var ADVECT_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

var ADVECT_FS = `
precision highp float;
uniform sampler2D u_particles;
uniform sampler2D u_marine_grid;
uniform float u_speed_factor;
uniform float u_rand_seed;
uniform float u_drop_rate;
varying vec2 v_uv;

vec2 decodePos(vec4 color) {
  return vec2(
    color.r + color.g / 255.0,
    color.b + color.a / 255.0
  );
}

vec4 encodePos(vec2 pos) {
  vec2 clamped = clamp(pos, 0.0, 1.0);
  float x_hi = floor(clamped.x * 255.0);
  float x_lo = fract(clamped.x * 255.0);
  float y_hi = floor(clamped.y * 255.0);
  float y_lo = fract(clamped.y * 255.0);
  return vec4(x_hi / 255.0, x_lo, y_hi / 255.0, y_lo);
}

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 encoded = texture2D(u_particles, v_uv);
  vec2 pos = decodePos(encoded);

  vec4 waveData = texture2D(u_marine_grid, pos);
  vec2 waveVec = waveData.rg * 2.0 - 1.0;
  float waveHeight = waveData.b * 10.0;

  float lat_rad = (pos.y - 0.5) * 3.141592653589793;
  float merc_scale = max(0.1, cos(lat_rad));
  
  // Wave drift (slower ocean velocity)
  vec2 offset = vec2(waveVec.x / merc_scale, waveVec.y) * u_speed_factor;
  pos = pos + offset;

  vec2 seed = (pos + v_uv) * u_rand_seed;
  float drop = step(1.0 - u_drop_rate, rand(seed));

  // Land or dead calm discard (threshold: 0.05m wave height)
  if (waveHeight < 0.05 || length(waveVec) < 0.02) {
    drop = 1.0;
  }

  // Out of bounds check
  float oob = step(1.0, pos.x) + step(1.0, pos.y) +
              step(0.0, -pos.x) + step(0.0, -pos.y);
  drop = max(drop, step(0.5, oob));

  vec2 newPos = vec2(rand(seed + 1.3), rand(seed + 2.1));
  pos = mix(pos, newPos, drop);

  gl_FragColor = encodePos(pos);
}
`;

var DRAW_VS = `
attribute float a_vertex_id;       // 0 to (numParticles * 2 - 1)
uniform sampler2D u_particles;     // particle position texture (RG=x, BA=y)
uniform sampler2D u_marine_grid;   // wave vector texture (R=u, G=v, B=height)
uniform float u_particles_res;     // resolution of position texture (e.g. 256.0)
uniform mat4 u_matrix;             // MapLibre projection matrix
uniform vec2 u_dataBounds_min;     // bounds [west, south]
uniform vec2 u_dataBounds_max;     // bounds [east, north]
uniform float u_time;              // elapsed time for pulsation
uniform float u_dash_length_scale; // wave crest width scale

varying float v_alpha;
varying float v_wave_height;

void main() {
  // 1. Calculate particle index and UV in state texture
  float particleIndex = floor(a_vertex_id / 2.0);
  float vertexType = mod(a_vertex_id, 2.0); // 0.0 = start, 1.0 = end

  float col = mod(particleIndex, u_particles_res);
  float row = floor(particleIndex / u_particles_res);
  vec2 p_uv = (vec2(col, row) + 0.5) / u_particles_res;

  // 2. Decode position from texture
  vec4 encodedPos = texture2D(u_particles, p_uv);
  vec2 pos = vec2(
    encodedPos.r + encodedPos.g / 255.0,
    encodedPos.b + encodedPos.a / 255.0
  );

  // 3. Lookup marine wave data at this position
  vec4 waveData = texture2D(u_marine_grid, pos);
  vec2 waveVec = waveData.rg * 2.0 - 1.0; // Decode u, v to [-1, 1]
  float waveHeight = waveData.b * 10.0;   // Decode height (up to 10m)
  v_wave_height = waveHeight;

  // Land discard: if wave height/velocity is zero, push vertex to infinity
  if (waveHeight < 0.05 || length(waveVec) < 0.02) {
    gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
    v_alpha = 0.0;
    return;
  }

  // 4. Calculate perpendicular wave crest offset
  vec2 dir = normalize(waveVec);
  vec2 perp = vec2(-dir.y, dir.x); // Rotate 90 degrees
  
  float dashLen = (4.0 + waveHeight * 2.0) * u_dash_length_scale;
  vec2 coordOffset = perp * (dashLen / 111320.0) * 0.5; // Degree expansion

  // 5. Expand start/end vertices
  vec2 finalPos = pos;
  if (vertexType < 0.5) {
    finalPos -= coordOffset;
  } else {
    finalPos += coordOffset;
  }

  // 6. Project position (Mercator & Matrix multiplication)
  float lng = mix(u_dataBounds_min.x, u_dataBounds_max.x, finalPos.x);
  float lat = mix(u_dataBounds_min.y, u_dataBounds_max.y, finalPos.y);
  lat = clamp(lat, -85.051129, 85.051129);

  float x = (lng + 180.0) / 360.0;
  float y = (1.0 - log(tan(radians(lat)) + 1.0 / cos(radians(lat))) / 3.141592653589793) / 2.0;

  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);

  // 7. Calculate periodic phase pulsation alpha
  float particleHash = fract(sin(particleIndex * 12.9898) * 43758.5453);
  float period = 3.0 + particleHash * 4.0; // Wave period 3s to 7s
  float phase = fract(u_time / period + particleHash);
  
  // Sine curve: smooth fade-in -> peak -> smooth fade-out
  v_alpha = sin(phase * 3.141592653589793);
  // Scale alpha by wave height (larger waves are highly visible)
  v_alpha *= clamp(waveHeight / 3.0, 0.2, 1.0);
}
`;

var DRAW_FS = `
precision mediump float;
varying float v_alpha;
varying float v_wave_height;

void main() {
  if (v_alpha < 0.02) discard;

  // Visual Tinting: ocean crests shift from pure white (high waves)
  // to beautiful light cyan/teal for standard waves
  float energy = clamp(v_wave_height / 4.0, 0.0, 1.0);
  
  vec3 standardColor = vec3(0.82, 0.95, 1.0); // Soft cyan foam
  vec3 highEnergyColor = vec3(1.0, 1.0, 1.0);  // Pure white crests
  vec3 finalColor = mix(standardColor, highEnergyColor, energy);

  gl_FragColor = vec4(finalColor * v_alpha, v_alpha);
}
`;

// --- Utility Functions ---

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[WebGLMarine] Shader compile error:', gl.getShaderInfoLog(shader));
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
    console.error('[WebGLMarine] Program link error:', gl.getProgramInfoLog(prog));
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
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  return tex;
}

function bindTexture(gl, tex, unit) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
}

function encodeMarineTexture(gl, waveGrid) {
  const { vectors, cols, rows, bounds } = waveGrid;
  if (!vectors?.length || !cols || !rows) return null;

  let maxVal = 0.001;
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    const len = Math.sqrt(v.u * v.u + v.v * v.v);
    if (len > maxVal) maxVal = len;
  }

  const data = new Uint8Array(cols * rows * 4);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    const nu = (v.u / maxVal) * 0.5 + 0.5;
    const nv = (v.v / maxVal) * 0.5 + 0.5;
    const height = Math.min(1.0, v.speed / 10.0);
    
    data[i * 4 + 0] = Math.floor(nu * 255);
    data[i * 4 + 1] = Math.floor(nv * 255);
    data[i * 4 + 2] = Math.floor(height * 255);
    data[i * 4 + 3] = 255;
  }

  const tex = createTexture(gl, gl.LINEAR, data, cols, rows);
  return {
    texture: tex,
    bounds
  };
}

function initParticleTexture(gl, resolution) {
  const numParticles = resolution * resolution;
  const data = new Uint8Array(numParticles * 4);
  for (let i = 0; i < numParticles; i++) {
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

// --- Engine Definition ---

function WebGLMarineEngine() {
  this.particleRes = 256;       // 256 * 256 = 65,536 lines
  this.speedFactor = 0.0003;    // Slower advection matching ocean drift
  this.dropRate = 0.002;
  this._initialized = false;
  this._waveData = null;
  this._startTime = Date.now();
}

WebGLMarineEngine.prototype.init = function(gl) {
  if (this._initialized) return;

  var advVS = createShader(gl, gl.VERTEX_SHADER, ADVECT_VS);
  var advFS = createShader(gl, gl.FRAGMENT_SHADER, ADVECT_FS);
  var drawVS = createShader(gl, gl.VERTEX_SHADER, DRAW_VS);
  var drawFS = createShader(gl, gl.FRAGMENT_SHADER, DRAW_FS);

  if (!advVS || !advFS || !drawVS || !drawFS) {
    console.error('[WebGLMarine] Failed to compile shaders');
    return;
  }

  this.advectProgram = createProgram(gl, advVS, advFS);
  this.drawProgram = createProgram(gl, drawVS, drawFS);

  this.quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  const numParticles = this.particleRes * this.particleRes;
  const vertexIds = new Float32Array(numParticles * 2);
  for (let i = 0; i < vertexIds.length; i++) {
    vertexIds[i] = i;
  }
  this.vertexIdBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIdBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexIds, gl.STATIC_DRAW);

  this.particleStateA = initParticleTexture(gl, this.particleRes);
  this.particleStateB = initParticleTexture(gl, this.particleRes);

  this.advFBO = gl.createFramebuffer();
  this._initialized = true;
  console.log('[WebGLMarine] Initialized engine with ' + numParticles + ' wave crests');
};

WebGLMarineEngine.prototype.setWaveData = function(gl, waveGrid) {
  if (!waveGrid?.vectors?.length) return;
  if (this._waveData?.texture) {
    gl.deleteTexture(this._waveData.texture);
  }
  this._waveData = encodeMarineTexture(gl, waveGrid);
};

WebGLMarineEngine.prototype.render = function(gl, matrix, screenWidth, screenHeight, zoom) {
  if (!this._initialized || !this._waveData) return;
  if (!matrix || !matrix.length) return;

  // WebGL State Isolation Protocol
  var prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
  var prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  var prevBlend = gl.getParameter(gl.BLEND);
  var prevActiveTex = gl.getParameter(gl.ACTIVE_TEXTURE);
  var prevArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
  var prevViewport = gl.getParameter(gl.VIEWPORT);

  var prevBlendSrcRGB = gl.getParameter(gl.BLEND_SRC_RGB);
  var prevBlendDstRGB = gl.getParameter(gl.BLEND_DST_RGB);
  var prevBlendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA);
  var prevBlendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);

  var prevDepthTest = gl.getParameter(gl.DEPTH_TEST);
  var prevDepthWriteMask = gl.getParameter(gl.DEPTH_WRITEMASK);
  var prevStencilTest = gl.getParameter(gl.STENCIL_TEST);
  var prevScissorTest = gl.getParameter(gl.SCISSOR_TEST);

  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.SCISSOR_TEST);

  // Capture and unbind WebGL2 VAO to prevent MapLibre attribute pollution
  var prevVAO = null;
  var isWebGL2 = false;
  if (gl.bindVertexArray) {
    isWebGL2 = true;
    prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.bindVertexArray(null);
  }

  var mat4 = matrix instanceof Float32Array ? matrix : new Float32Array(matrix);
  var time = (Date.now() - this._startTime) / 1000.0;

  // Step 1: Advect positions using FBO ping-pong
  gl.useProgram(this.advectProgram);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_particles'), 0);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_marine_grid'), 1);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speed_factor'), this.speedFactor);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_rand_seed'), Math.random());
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate'), this.dropRate);

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.particleStateB, 0);
  gl.viewport(0, 0, this.particleRes, this.particleRes);

  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._waveData.texture, 1);

  var advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
  gl.enableVertexAttribArray(advPosLoc);
  gl.vertexAttribPointer(advPosLoc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disableVertexAttribArray(advPosLoc);

  // Swap buffers
  var tmp = this.particleStateA;
  this.particleStateA = this.particleStateB;
  this.particleStateB = tmp;

  // Step 2: Draw wave crest lines directly to MapLibre's main framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  gl.viewport(0, 0, screenWidth, screenHeight);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // Pre-multiplied alpha

  gl.useProgram(this.drawProgram);
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_particles'), 0);
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_marine_grid'), 1);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_particles_res'), this.particleRes);
  gl.uniformMatrix4fv(gl.getUniformLocation(this.drawProgram, 'u_matrix'), false, mat4);

  var bnd = this._waveData.bounds;
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_min'), bnd.west, bnd.south);
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_max'), bnd.east, bnd.north);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_time'), time);

  var dashLengthScale = Math.max(0.3, Math.min(1.5, zoom / 6.0));
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_dash_length_scale'), dashLengthScale);

  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._waveData.texture, 1);

  var idLoc = gl.getAttribLocation(this.drawProgram, 'a_vertex_id');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIdBuffer);
  gl.enableVertexAttribArray(idLoc);
  gl.vertexAttribPointer(idLoc, 1, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.LINES, 0, this.particleRes * this.particleRes * 2);
  gl.disableVertexAttribArray(idLoc);

  // Restore State
  gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuffer);

  // Restore WebGL2 VAO
  if (isWebGL2 && gl.bindVertexArray) {
    gl.bindVertexArray(prevVAO);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  gl.useProgram(prevProg);
  gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
  gl.activeTexture(prevActiveTex);
  
  if (prevBlend) {
    gl.enable(gl.BLEND);
  } else {
    gl.disable(gl.BLEND);
  }
  gl.blendFuncSeparate(prevBlendSrcRGB, prevBlendDstRGB, prevBlendSrcAlpha, prevBlendDstAlpha);

  if (prevDepthTest) {
    gl.enable(gl.DEPTH_TEST);
  } else {
    gl.disable(gl.DEPTH_TEST);
  }
  gl.depthMask(prevDepthWriteMask);

  if (prevStencilTest) {
    gl.enable(gl.STENCIL_TEST);
  } else {
    gl.disable(gl.STENCIL_TEST);
  }
  if (prevScissorTest) {
    gl.enable(gl.SCISSOR_TEST);
  } else {
    gl.disable(gl.SCISSOR_TEST);
  }
};

WebGLMarineEngine.prototype.clearBuffers = function(gl) {
  // No screen FBOs are used (direct drawing), so there is no trail residue.
};

WebGLMarineEngine.prototype.dispose = function(gl) {
  if (!gl) return;
  if (this.advectProgram) gl.deleteProgram(this.advectProgram);
  if (this.drawProgram) gl.deleteProgram(this.drawProgram);
  if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
  if (this.vertexIdBuffer) gl.deleteBuffer(this.vertexIdBuffer);
  if (this.advFBO) gl.deleteFramebuffer(this.advFBO);
  if (this.particleStateA) gl.deleteTexture(this.particleStateA);
  if (this.particleStateB) gl.deleteTexture(this.particleStateB);
  if (this._waveData?.texture) gl.deleteTexture(this._waveData.texture);
  this._waveData = null;
  this._initialized = false;
  console.log('[WebGLMarine] Engine Disposed');
};

export default WebGLMarineEngine;
