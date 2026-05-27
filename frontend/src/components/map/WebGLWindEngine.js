/**
 * WebGLWindEngine GPU-accelerated wind particle advection + trail fading
 *
 * v3.8: Replaces Canvas2D particle loop with WebGL ping-pong framebuffer
 * architecture for 10-50x more particles with trail decay.
 *
 * Architecture:
 * 1. Wind vectors GPU texture (RGBA encoding of u,v per grid cell)
 * 2. Particle positions ping-pong framebuffers (read/write swap each frame)
 * 3. Advection shader: sample wind texture move particle positions
 * 4. Trail texture: alpha-blend particles fade previous frame (persistence)
 *   5. Final composite: render trail texture to screen canvas
 */

// --- Shader Sources ---
// v3.9.8: Color ramp LUT import for Beaufort-scale wind coloring
import { generateRampData } from './WindColorRamp';

var ADVECT_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

var ADVECT_FS = `
precision highp float;
uniform sampler2D u_particles;    // current particle positions (RGBA = x_hi,x_lo,y_hi,y_lo)
uniform sampler2D u_wind;         // wind field texture (RG = u, BA = v)
uniform vec2 u_wind_min;          // min u,v values for decoding
uniform vec2 u_wind_max;          // max u,v values for decoding
uniform vec2 u_wind_res;          // wind grid resolution (cols, rows)
uniform vec2 u_speed_scale;       // scale-invariant speed scale
uniform float u_rand_seed;        // per-frame random seed for respawn
uniform float u_drop_rate;        // base particle drop rate
uniform float u_drop_rate_bump;   // speed-dependent drop rate increase
varying vec2 v_uv;

// Decode position from 2-channel encoding (16-bit precision per axis)
vec2 decodePos(vec4 color) {
  return vec2(
    color.r + color.g / 255.0,
    color.b + color.a / 255.0
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
 // v3.11.1: Mercator latitude correction cos(lat) prevents polar distortion
 float lat_rad = (pos.y - 0.5) * 3.141592653589793; // [0,1] [-/2, /2]
  float merc_scale = max(0.1, cos(lat_rad));
  vec2 offset = vec2(wind.x / merc_scale, wind.y) * u_speed_scale;
  pos = pos + offset;

  // Respawn logic: randomly drop particles (more likely when slow)
  vec2 seed = (pos + v_uv) * u_rand_seed;
  float dropRate = u_drop_rate + speed * u_drop_rate_bump;
  float drop = step(1.0 - dropRate, rand(seed));

  // Random new position for respawned particles
  vec2 newPos = vec2(rand(seed + 1.3), rand(seed + 2.1));

  // Out of bounds: wrap X (longitude) for antimeridian, drop Y (latitude)
  pos.x = fract(pos.x);
  float oobY = step(1.0, pos.y) + step(0.0, -pos.y);
  drop = max(drop, step(0.5, oobY));

  pos = mix(pos, newPos, drop);
  gl_FragColor = encodePos(pos);
}`;

var DRAW_VS = `
attribute float a_index;
uniform sampler2D u_particles;
uniform float u_particles_res;
uniform mat4 u_matrix;
uniform vec2 u_dataBounds_min;   // [west, south] in degrees
uniform vec2 u_dataBounds_max;   // [east, north] in degrees
uniform float u_lng_offset;      // world-copy offset: -360, 0, or +360
varying float v_speed;
uniform sampler2D u_wind;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;
uniform float u_zoom;  // v3.13.5: for close-zoom density boost

vec2 decodePos(vec4 color) {
  return vec2(
    color.r + color.g / 255.0,
    color.b + color.a / 255.0
  );
}

void main() {
  // Particle UV in state texture
  float col = mod(a_index, u_particles_res);
  float row = floor(a_index / u_particles_res);
  vec2 uv = (vec2(col, row) + 0.5) / u_particles_res;

  vec4 encoded = texture2D(u_particles, uv);
  vec2 pos = decodePos(encoded);

  // Convert [0,1] to [lng, lat] then apply world-copy offset
  float lng = mix(u_dataBounds_min.x, u_dataBounds_max.x, pos.x) + u_lng_offset;
  float lat = mix(u_dataBounds_min.y, u_dataBounds_max.y, pos.y);

  // Speed for coloring
  vec4 windColor = texture2D(u_wind, pos);
  vec2 wind = mix(u_wind_min, u_wind_max, vec2(windColor.r, windColor.g));
  v_speed = length(wind);

  // Convert to Mercator for MapLibre
  float x = (lng + 180.0) / 360.0;
  float y = (1.0 - log(tan(radians(lat)) + 1.0 / cos(radians(lat))) / 3.141592653589793) / 2.0;

  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  if (gl_Position.w == 0.0) {
    gl_Position.w = 1.0;
  }
 // v3.13.5: Close-zoom density enhancement — larger particles at high zoom
  // for +20% visual density at the 3 closest zoom levels (≥8)
  float zoomBoost = u_zoom >= 8.0 ? 1.2 : 1.0;
  gl_PointSize = v_speed < 0.5 ? 0.0 : (2.0 + clamp(v_speed / 8.0, 0.0, 3.0)) * zoomBoost;
}`;

// v3.9.8: Color ramp LUT replaces fixed dark shader
var DRAW_FS = [
  'precision mediump float;',
  'varying float v_speed;',
  'uniform sampler2D u_color_ramp;',
  'uniform float u_max_speed;',
  'void main() {',
  '  float normalizedSpeed = clamp(v_speed / u_max_speed, 0.0, 1.0);',
  '  vec4 color = texture2D(u_color_ramp, vec2(normalizedSpeed, 0.5));',
  '  gl_FragColor = vec4(color.rgb, 1.0);',
  '}',
].join('\n');

var SCREEN_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

var SCREEN_FS = `
precision mediump float;
uniform sampler2D u_screen;
uniform float u_opacity;
varying vec2 v_uv;
void main() {
  vec4 color = texture2D(u_screen, v_uv);
  // v3.12.2: FBO uses RGB-fade (alpha=1.0), so derive alpha from brightness.
  // Black = transparent, bright = opaque. Creates proper vapor trail effect.
  float brightness = max(color.r, max(color.g, color.b));
  gl_FragColor = vec4(color.rgb, brightness * u_opacity);
}`;

var FADE_FS = `
precision mediump float;
uniform sampler2D u_screen;
uniform float u_fade;
varying vec2 v_uv;
void main() {
  vec4 color = texture2D(u_screen, v_uv);
  // v3.12.2 CRITICAL FIX: Fade RGB, keep alpha=1.0 (mapbox/webgl-wind technique).
 // Fading alpha causes compound decay invisible trails.
 // Fading RGB creates visible dimming premultiplied blend makes black = transparent.
  gl_FragColor = vec4(floor(color.rgb * 255.0 * u_fade) / 255.0, 1.0);
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
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
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
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  return tex;
}

function unbindTexture(gl, tex) {
  if (!tex) return;
  var prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
  var maxUnits = Math.min(16, gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) || 8);
  for (var u = 0; u < maxUnits; u++) {
    gl.activeTexture(gl.TEXTURE0 + u);
    if (gl.getParameter(gl.TEXTURE_BINDING_2D) === tex) {
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }
  gl.activeTexture(prevActive);
}

function logStepDetails(gl, stepName) {
  var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  var currentFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  var activeTex = gl.getParameter(gl.ACTIVE_TEXTURE);
  var bindings = [];
  for (var u = 0; u < 4; u++) {
    gl.activeTexture(gl.TEXTURE0 + u);
    bindings.push(gl.getParameter(gl.TEXTURE_BINDING_2D));
  }
  gl.activeTexture(activeTex);
  console.log("[WebGLWindEngine-DIAGNOSTIC] " + stepName + ": status=" + status + ", currentFBO=" + (currentFBO ? "yes" : "null") + ", textures=", bindings);
}


function createFBO(gl, filter, width, height) {
  const prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const tex = createTexture(gl, filter, null, width, height);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
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

// --- Exported Constructor (var/function TDZ-immune) ---

function WebGLWindEngine() {
  // v3.13.4: Atmospheric transparency — continents must be clearly visible
 this.particleRes = 296; // 296² = 87,616 particles (~10% thinner than 330²)
  this.fadeOpacity = 0.990; // Faster trail decay — less cumulative opacity buildup
  this.speedFactor = 0.32;  // Tuned: good correlation with real wind speeds
 this.dropRate = 0.0015; // Particles live longer continuous streams
  this.dropRateBump = 0.006;
  this._initialized = false;
  this._windData = null;
  this._colorRamp = null; // v3.9.8: Color ramp LUT texture
 this._maxWindSpeed = 50; // m/s maps to ramp max
}
export default WebGLWindEngine;

WebGLWindEngine.prototype.init = function(gl) {
  if (this._initialized) return;
  var advVS = createShader(gl, gl.VERTEX_SHADER, ADVECT_VS);
  var advFS = createShader(gl, gl.FRAGMENT_SHADER, ADVECT_FS);
  var drawVS = createShader(gl, gl.VERTEX_SHADER, DRAW_VS);
  var drawFS = createShader(gl, gl.FRAGMENT_SHADER, DRAW_FS);
  var screenVS = createShader(gl, gl.VERTEX_SHADER, SCREEN_VS);
  var screenFS = createShader(gl, gl.FRAGMENT_SHADER, SCREEN_FS);
  var fadeVS = createShader(gl, gl.VERTEX_SHADER, SCREEN_VS);
  var fadeFS = createShader(gl, gl.FRAGMENT_SHADER, FADE_FS);
  if (!advVS || !advFS || !drawVS || !drawFS || !screenVS || !screenFS) {
    console.error('[WebGLWind] Failed to compile shaders'); return;
  }
  this.advectProgram = createProgram(gl, advVS, advFS);
  this.drawProgram = createProgram(gl, drawVS, drawFS);
  this.screenProgram = createProgram(gl, screenVS, screenFS);
  this.fadeProgram = createProgram(gl, fadeVS, fadeFS);
  this.quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  var indices = new Float32Array(this.particleRes * this.particleRes);
  for (var i = 0; i < indices.length; i++) indices[i] = i;
  this.particleIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.particleIndexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  this.particleStateA = initParticleTexture(gl, this.particleRes);
  this.particleStateB = initParticleTexture(gl, this.particleRes);
  this.advFBO = gl.createFramebuffer();
  // v3.9.8: Create color ramp LUT texture
  var rampData = generateRampData(this._maxWindSpeed);
  this._colorRamp = createTexture(gl, gl.LINEAR, rampData, 256, 1);
  this._initialized = true;
  console.log('[WebGLWind] Initialized: ' + (this.particleRes * this.particleRes) + ' particles');
};

WebGLWindEngine.prototype.setWindData = function(gl, windGrid) {
  if (!windGrid?.vectors?.length) return;
  if (this._windData?.texture) gl.deleteTexture(this._windData.texture);
  this._windData = encodeWindTexture(gl, windGrid);
};

WebGLWindEngine.prototype.render = function(gl, matrix, screenWidth, screenHeight, zoom) {
  if (!this._initialized || !this._windData) return;
  if (!matrix || !matrix.length) {
    if (this._renderLogged === undefined) {
      this._renderLogged = 0;
    }
    this._renderLogged++;
    if (this._renderLogged === 1 || this._renderLogged % 180 === 0) {
      console.log("[WebGLWindEngine] render returned early! _initialized:", this._initialized, "_windData:", !!this._windData, "matrix:", !!matrix, "matrix.length:", matrix?.length);
    }
    return;
  }
  if (!this.screenA || this._screenW !== screenWidth || this._screenH !== screenHeight) {
    if (this.screenA) {
      gl.deleteFramebuffer(this.screenA.fbo); gl.deleteTexture(this.screenA.tex);
      gl.deleteFramebuffer(this.screenB.fbo); gl.deleteTexture(this.screenB.tex);
    }
    this.screenA = createFBO(gl, gl.NEAREST, screenWidth, screenHeight);
    this.screenB = createFBO(gl, gl.NEAREST, screenWidth, screenHeight);
    this._screenW = screenWidth; this._screenH = screenHeight;
  }

  // v3.13: Clear trail FBOs during zoom transitions to prevent ghosting/smearing.
  // Screen-space trails don't move with the map, so rapid zoom creates visual noise.
  var currentZoom = typeof zoom === 'number' ? zoom : 6;
  if (this._lastRenderZoom !== undefined) {
    var zoomDelta = Math.abs(currentZoom - this._lastRenderZoom);
    if (zoomDelta > 0.15) {
      // Significant zoom change — clear trail buffers
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenA.fbo);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenB.fbo);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }
  this._lastRenderZoom = currentZoom;
  // WebGL State Isolation Protocol
  var prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
  var prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  var prevBlend = gl.getParameter(gl.BLEND);
  var prevActiveTex = gl.getParameter(gl.ACTIVE_TEXTURE);
  var prevArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
  var prevElementArrayBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
  var prevViewport = gl.getParameter(gl.VIEWPORT);

  var prevBlendSrcRGB = gl.getParameter(gl.BLEND_SRC_RGB);
  var prevBlendDstRGB = gl.getParameter(gl.BLEND_DST_RGB);
  var prevBlendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA);
  var prevBlendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);

  var prevDepthTest = gl.getParameter(gl.DEPTH_TEST);
  var prevDepthWriteMask = gl.getParameter(gl.DEPTH_WRITEMASK);
  var prevStencilTest = gl.getParameter(gl.STENCIL_TEST);
  var prevScissorTest = gl.getParameter(gl.SCISSOR_TEST);
  var prevColorMask = gl.getParameter(gl.COLOR_WRITEMASK);

  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.SCISSOR_TEST);
  gl.colorMask(true, true, true, true);

  // Clear any existing WebGL errors from MapLibre's previous drawing operations
  while (gl.getError() !== gl.NO_ERROR) {}

  // Prevent MapLibre vertex attribute pollution by disabling all attribute arrays
  var maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) || 16;
  for (var i = 0; i < maxAttribs; i++) {
    try {
      gl.disableVertexAttribArray(i);
    } catch (e) {}
  }

  // Capture and unbind all texture units to prevent feedback loops with MapLibre's active drawing textures
  var prevTextures2D = [];
  var prevTexturesCube = [];
  var maxUnits = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) || 8;
  for (var u = 0; u < maxUnits; u++) {
    gl.activeTexture(gl.TEXTURE0 + u);
    prevTextures2D.push(gl.getParameter(gl.TEXTURE_BINDING_2D));
    gl.bindTexture(gl.TEXTURE_2D, null);
    try {
      prevTexturesCube.push(gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP));
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
    } catch (e) {
      prevTexturesCube.push(null);
    }
  }


  // Capture and unbind WebGL2 VAO to prevent MapLibre attribute pollution
  var prevVAO = null;
  var isWebGL2 = false;
  if (gl.bindVertexArray) {
    isWebGL2 = true;
    prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.bindVertexArray(null);
  }

  var mat4 = matrix instanceof Float32Array ? matrix : new Float32Array(matrix);

  // Compute scale-invariant advection step sizes
  const z = typeof zoom === 'number' ? zoom : 6;
  const baseScale = this.speedFactor * Math.pow(0.55, Math.max(0, z - 6)) * 0.05; // Normalizing 0.40 speedFactor to correct coordinate step sizes
  const bounds = this._windData.bounds;
  const lngSpan = Math.max(0.01, Math.abs(bounds.east - bounds.west));
  const latSpan = Math.max(0.01, Math.abs(bounds.north - bounds.south));
  const speedScaleX = Math.max(1.0e-5, baseScale / lngSpan);
  const speedScaleY = Math.max(1.0e-5, baseScale / latSpan);

  if (this.frameCount === undefined) this.frameCount = 0;
  this.frameCount++;
  if (this.frameCount === 1) {
    console.log(`[WIND-TELEMETRY] Frame 1 | advection step = [${speedScaleX.toFixed(6)}, ${speedScaleY.toFixed(6)}] | bounds: [${this._windData.uMin[0].toFixed(1)},${this._windData.uMin[1].toFixed(1)}] to [${this._windData.uMax[0].toFixed(1)},${this._windData.uMax[1].toFixed(1)}] | ${this.particleRes * this.particleRes} particles`);
  }

  // Step 1: Advect particles (ping-pong)
  gl.disable(gl.BLEND); // CRITICAL: Disable blend to prevent position texture corruption!
  gl.useProgram(this.advectProgram);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_particles'), 0);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_wind'), 1);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_wind_min'), this._windData.uMin[0], this._windData.uMin[1]);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_wind_max'), this._windData.uMax[0], this._windData.uMax[1]);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_wind_res'), 1, 1);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_speed_scale'), speedScaleX, speedScaleY);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_rand_seed'), Math.random());
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate'), this.dropRate);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate_bump'), this.dropRateBump);
  unbindTexture(gl, this.particleStateB);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.particleStateB, 0);
  gl.viewport(0, 0, this.particleRes, this.particleRes);
  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._windData.texture, 1);
  var advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
  gl.enableVertexAttribArray(advPosLoc);
  gl.vertexAttribPointer(advPosLoc, 2, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  var err1 = gl.getError();
  if (err1 !== gl.NO_ERROR) {
    console.error("[WebGLWindEngine] Step 1 Draw Error:", err1);
  }
  gl.disableVertexAttribArray(advPosLoc);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  var tmp = this.particleStateA; this.particleStateA = this.particleStateB; this.particleStateB = tmp;

  // Step 2: Fade screen A screen B (RGB fade, alpha=1.0)
  gl.useProgram(this.fadeProgram);
  unbindTexture(gl, this.screenB.tex);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenB.fbo);
  gl.viewport(0, 0, screenWidth, screenHeight);
  // v3.12.2: No blend for fade shader outputs alpha=1.0, straight overwrite
  gl.disable(gl.BLEND);
  gl.uniform1i(gl.getUniformLocation(this.fadeProgram, 'u_screen'), 0);
  gl.uniform1f(gl.getUniformLocation(this.fadeProgram, 'u_fade'), this.fadeOpacity);
  bindTexture(gl, this.screenA.tex, 0);
  var fadePosLoc = gl.getAttribLocation(this.fadeProgram, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
  gl.enableVertexAttribArray(fadePosLoc);
  gl.vertexAttribPointer(fadePosLoc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  var err2 = gl.getError();
  if (err2 !== gl.NO_ERROR) {
    console.error("[WebGLWindEngine] Step 2 Draw Error:", err2);
  }
  gl.disableVertexAttribArray(fadePosLoc);

  // Step 3: Draw particles onto screen B with color ramp
  // v3.12.2: Re-enable blending particles drawn ON TOP of faded trails
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(this.drawProgram);
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_particles'), 0);
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_wind'), 1);
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_color_ramp'), 2);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_max_speed'), this._maxWindSpeed);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_particles_res'), this.particleRes);
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_wind_min'), this._windData.uMin[0], this._windData.uMin[1]);
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_wind_max'), this._windData.uMax[0], this._windData.uMax[1]);
  gl.uniformMatrix4fv(gl.getUniformLocation(this.drawProgram, 'u_matrix'), false, mat4);
  var bnd = this._windData.bounds;
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_min'), bnd.west, bnd.south);
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_max'), bnd.east, bnd.north);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_zoom'), z); // v3.13.5: close-zoom density boost
  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._windData.texture, 1);
  if (this._colorRamp) bindTexture(gl, this._colorRamp, 2);
  var idxLoc = gl.getAttribLocation(this.drawProgram, 'a_index');
  var lngOffsetLoc = gl.getUniformLocation(this.drawProgram, 'u_lng_offset');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.particleIndexBuffer);
  gl.enableVertexAttribArray(idxLoc);
  gl.vertexAttribPointer(idxLoc, 1, gl.FLOAT, false, 0, 0);

  // v3.13: Draw particles for multiple world copies to fill the entire viewport at low zoom.
  // At zoom < 3, the map shows more than 360° of longitude, so we need 3 copies.
  // At higher zoom, a single copy at offset 0 is sufficient.
  var worldOffsets = (z < 3.5) ? [0.0, -360.0, 360.0] : [0.0];
  for (var wi = 0; wi < worldOffsets.length; wi++) {
    gl.uniform1f(lngOffsetLoc, worldOffsets[wi]);
    gl.drawArrays(gl.POINTS, 0, this.particleRes * this.particleRes);
  }
  gl.disableVertexAttribArray(idxLoc);

  // Copy screenB screenA
  gl.useProgram(this.screenProgram);
  unbindTexture(gl, this.screenA.tex);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenA.fbo);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1i(gl.getUniformLocation(this.screenProgram, 'u_screen'), 0);
  gl.uniform1f(gl.getUniformLocation(this.screenProgram, 'u_opacity'), 1.0);
  bindTexture(gl, this.screenB.tex, 0);
  var cpLoc = gl.getAttribLocation(this.screenProgram, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
  gl.enableVertexAttribArray(cpLoc);
  gl.vertexAttribPointer(cpLoc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  var errCopy = gl.getError();
  if (errCopy !== gl.NO_ERROR) {
    console.error("[WebGLWindEngine] Copy Draw Error:", errCopy);
  }
  gl.disableVertexAttribArray(cpLoc);

  // Step 4: Composite to main framebuffer
  // v3.12.2: Standard alpha blend screen shader derives alpha from trail brightness.
  // RGB-fade FBO has alpha=1.0, but screen shader outputs brightness-derived alpha.
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  gl.viewport(0, 0, screenWidth, screenHeight);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  bindTexture(gl, this.screenB.tex, 0);
  var scrLoc = gl.getAttribLocation(this.screenProgram, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
  gl.enableVertexAttribArray(scrLoc);
  gl.vertexAttribPointer(scrLoc, 2, gl.FLOAT, false, 0, 0);
  // v3.13.4: Reduced from 0.90 to 0.65 — continents must be clearly visible
  // beneath the wind layer. Wind should feel atmospheric, not solid fog.
  gl.uniform1f(gl.getUniformLocation(this.screenProgram, 'u_opacity'), 0.65);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  var err4 = gl.getError();
  if (err4 !== gl.NO_ERROR) {
    console.error("[WebGLWindEngine] Step 4 Draw Error:", err4);
  }
  gl.disableVertexAttribArray(scrLoc);

  // Restore State
  gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuffer);
  if (isWebGL2 && gl.bindVertexArray) {
    gl.bindVertexArray(prevVAO);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  gl.useProgram(prevProg);
  gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
  for (var u = 0; u < prevTextures2D.length; u++) {
    gl.activeTexture(gl.TEXTURE0 + u);
    gl.bindTexture(gl.TEXTURE_2D, prevTextures2D[u]);
    if (prevTexturesCube[u]) {
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, prevTexturesCube[u]);
    }
  }

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
  gl.colorMask(prevColorMask[0], prevColorMask[1], prevColorMask[2], prevColorMask[3]);
};

WebGLWindEngine.prototype.dispose = function(gl) {
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
  if (this._colorRamp) gl.deleteTexture(this._colorRamp);
  if (this.screenA) { gl.deleteFramebuffer(this.screenA.fbo); gl.deleteTexture(this.screenA.tex); }
  if (this.screenB) { gl.deleteFramebuffer(this.screenB.fbo); gl.deleteTexture(this.screenB.tex); }
  this._initialized = false;
  console.log('[WebGLWind] Disposed');
};

/**
 * v3.11.2r1: Clear all framebuffers called on layer deactivation
 * to prevent stale trails from persisting across layer switches.
 */
WebGLWindEngine.prototype.clearBuffers = function(gl) {
  if (!gl || !this._initialized) return;
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenA.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenB.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    console.log('[WebGLWind] Buffers cleared (layer switch)');
  } catch (e) {
    console.warn('[WebGLWind] clearBuffers error:', e.message);
  }
};

