/**
 * WebGLMarineEngine.js
 * Ocean GPU v2 — Fully GPU-native, raster-free marine rendering engine.
 * Renders pulsing, perpendicular wave fronts using gl.drawArrays(gl.LINES)
 * overlayed on a smooth, continuous GPU wave height heatmap.
 * Strictly conforms to WebGL State Isolation Protocol and is < 600 lines of code.
 */

import {
  ADVECT_VS,
  ADVECT_FS,
  DRAW_VS,
  DRAW_FS,
  HEATMAP_VS,
  HEATMAP_FS
} from './WebGLMarineShaders';

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
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
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

  // Allocate arrays for the four textures
  const dataWave = new Uint8Array(cols * rows * 4);
  const dataChl = new Uint8Array(cols * rows * 4);
  const dataBath = new Uint8Array(cols * rows * 4);
  const dataMask = new Uint8Array(cols * rows * 4);

  // We calculate distance-to-land for a robust bathymetry shelf structure.
  const grid = new Uint8Array(cols * rows);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    const isOcean = !!(v.isOcean || (v.isOcean === undefined && (v.speed > 0.001 || v.u !== 0 || v.v !== 0)));
    grid[i] = isOcean ? 1 : 0;
  }

  // Multi-pass distance transform in Javascript
  const dist = new Float32Array(cols * rows);
  dist.fill(Infinity);
  
  // Pass 1: Top-left to bottom-right
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (grid[idx] === 0) {
        dist[idx] = 0;
      } else {
        let minD = Infinity;
        if (r > 0) minD = Math.min(minD, dist[(r - 1) * cols + c] + 1);
        if (c > 0) minD = Math.min(minD, dist[r * cols + (c - 1)] + 1);
        dist[idx] = minD;
      }
    }
  }
  // Pass 2: Bottom-right to top-left
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const idx = r * cols + c;
      if (grid[idx] !== 0) {
        let minD = dist[idx];
        if (r < rows - 1) minD = Math.min(minD, dist[(r + 1) * cols + c] + 1);
        if (c < cols - 1) minD = Math.min(minD, dist[r * cols + (c + 1)] + 1);
        dist[idx] = minD;
      }
    }
  }

  // Procedural noise for organic chlorophyll patterns inside JS
  function hash(x, y) {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }
  function noise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
  }

  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    const col = i % cols;
    const row = Math.floor(i / cols);

    const lng = bounds.west + (col / (cols - 1)) * (bounds.east - bounds.west);
    const lat = bounds.south + (row / (rows - 1)) * (bounds.north - bounds.south);

    // 1. Wave texture (RG = u/v vector, B = normalized wave height)
    const nu = (v.u / maxVal) * 0.5 + 0.5;
    const nv = (v.v / maxVal) * 0.5 + 0.5;
    const height = Math.min(1.0, v.speed / 10.0);

    dataWave[i * 4 + 0] = Math.floor(nu * 255);
    dataWave[i * 4 + 1] = Math.floor(nv * 255);
    dataWave[i * 4 + 2] = Math.floor(height * 255);
    dataWave[i * 4 + 3] = 255;

    // 2. Bathymetry depth factor (0.0 = coastline, 1.0 = deep ocean)
    const maxShelfDist = 8.0;
    const depthFactor = grid[i] === 0 ? 0.0 : Math.min(1.0, dist[i] / maxShelfDist);
    dataBath[i * 4 + 0] = Math.floor(depthFactor * 255);
    dataBath[i * 4 + 1] = Math.floor(depthFactor * 255);
    dataBath[i * 4 + 2] = Math.floor(depthFactor * 255);
    dataBath[i * 4 + 3] = 255;

    // 3. Chlorophyll density mapping
    const absLat = Math.abs(lat);
    let tropicalChl = 0.0;
    if (absLat < 35.0) {
      tropicalChl = (1.0 - (absLat / 35.0)) * 0.25;
    }
    let temperateChl = 0.0;
    if (absLat > 25.0 && absLat < 65.0) {
      const scale1 = (absLat - 25.0) / 20.0;
      const scale2 = (65.0 - absLat) / 20.0;
      temperateChl = Math.max(0.0, Math.min(scale1, scale2)) * 0.15;
    }
    let coastalChl = 0.0;
    if (grid[i] === 1 && dist[i] <= 3.0) {
      coastalChl = (1.0 - (dist[i] / 3.0)) * 0.35;
    }

    // Gulf Stream streaking
    let gulfStreamChl = 0.0;
    if (lng > -85 && lng < -35 && lat > 20 && lat < 50) {
      const x1 = -80, y1 = 25, x2 = -40, y2 = 45;
      const A = lat - y1;
      const B = lng - x1;
      const C = x2 - x1;
      const D = y2 - y1;
      const dotVal = B * C + A * D;
      const lenSq = C * C + D * D;
      let param = -1;
      if (lenSq !== 0) param = dotVal / lenSq;
      let xx, yy;
      if (param < 0) {
        xx = x1; yy = y1;
      } else if (param > 1) {
        xx = x2; yy = y2;
      } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
      }
      const dx = lng - xx;
      const dy = lat - yy;
      const streamDist = Math.sqrt(dx * dx + dy * dy);
      if (streamDist < 5.0) {
        const streamNoise = noise(lng * 0.5, lat * 0.5) * 0.15;
        gulfStreamChl = (1.0 - (streamDist / 5.0)) * (0.2 + streamNoise);
      }
    }

    const chlNoiseVal = noise(lng * 0.2, lat * 0.2) * 0.12;
    const rawChl = tropicalChl + temperateChl + coastalChl + gulfStreamChl + chlNoiseVal;
    const chlDensity = Math.max(0.0, Math.min(0.65, rawChl));

    dataChl[i * 4 + 0] = Math.floor(chlDensity * 255);
    dataChl[i * 4 + 1] = Math.floor(chlDensity * 255);
    dataChl[i * 4 + 2] = Math.floor(chlDensity * 255);
    dataChl[i * 4 + 3] = 255;

    // 4. Land/ocean binary mask
    const isOcean = !!(v.isOcean || (v.isOcean === undefined && (v.speed > 0.001 || v.u !== 0 || v.v !== 0)));
    const oceanFlag = isOcean ? 255 : 0;
    dataMask[i * 4 + 0] = oceanFlag;
    dataMask[i * 4 + 1] = oceanFlag;
    dataMask[i * 4 + 2] = oceanFlag;
    dataMask[i * 4 + 3] = oceanFlag;
  }

  // Create four linear-filtered textures
  const waveTex = createTexture(gl, gl.LINEAR, dataWave, cols, rows);
  const chlTex = createTexture(gl, gl.LINEAR, dataChl, cols, rows);
  const bathTex = createTexture(gl, gl.LINEAR, dataBath, cols, rows);
  const maskTex = createTexture(gl, gl.LINEAR, dataMask, cols, rows);

  return {
    u_waveTexture: waveTex,
    u_chlorophyllTexture: chlTex,
    u_bathymetryTexture: bathTex,
    u_oceanMaskTexture: maskTex,
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
  this.particleRes = 136;       // 136² = 18,496 crests
  this.speedFactor = 0.05;      // drift speed scale
  this.dropRate = 0.003;        // particle drop rate
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
  var heatVS = createShader(gl, gl.VERTEX_SHADER, HEATMAP_VS);
  var heatFS = createShader(gl, gl.FRAGMENT_SHADER, HEATMAP_FS);

  if (!advVS || !advFS || !drawVS || !drawFS || !heatVS || !heatFS) {
    console.error('[WebGLMarine] Failed to compile shaders');
    return;
  }

  this.advectProgram = createProgram(gl, advVS, advFS);
  this.drawProgram = createProgram(gl, drawVS, drawFS);
  this.heatmapProgram = createProgram(gl, heatVS, heatFS);

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

  const W = 96;
  const H = 96;
  const gridUVs = new Float32Array(W * H * 2);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const idx = (r * W + c) * 2;
      gridUVs[idx + 0] = c / (W - 1);
      gridUVs[idx + 1] = r / (H - 1);
    }
  }
  this.gridUVBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.gridUVBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, gridUVs, gl.STATIC_DRAW);

  const gridIndices = new Uint16Array((W - 1) * (H - 1) * 6);
  let iIdx = 0;
  for (let r = 0; r < H - 1; r++) {
    for (let c = 0; c < W - 1; c++) {
      const i0 = r * W + c;
      const i1 = i0 + 1;
      const i2 = (r + 1) * W + c;
      const i3 = i2 + 1;
      gridIndices[iIdx++] = i0;
      gridIndices[iIdx++] = i1;
      gridIndices[iIdx++] = i2;
      gridIndices[iIdx++] = i1;
      gridIndices[iIdx++] = i3;
      gridIndices[iIdx++] = i2;
    }
  }
  this.gridIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gridIndices, gl.STATIC_DRAW);
  this.numGridIndices = gridIndices.length;

  this.particleStateA = initParticleTexture(gl, this.particleRes);
  this.particleStateB = initParticleTexture(gl, this.particleRes);

  this.advFBO = gl.createFramebuffer();
  this._initialized = true;
  console.log('[WebGLMarine] Initialized engine with ' + numParticles + ' wave crests + 96x96 grid');
};

WebGLMarineEngine.prototype.setWaveData = function(gl, waveGrid) {
  if (!waveGrid?.vectors?.length) return;
  if (this._waveData) {
    if (this._waveData.u_waveTexture) gl.deleteTexture(this._waveData.u_waveTexture);
    if (this._waveData.u_chlorophyllTexture) gl.deleteTexture(this._waveData.u_chlorophyllTexture);
    if (this._waveData.u_bathymetryTexture) gl.deleteTexture(this._waveData.u_bathymetryTexture);
    if (this._waveData.u_oceanMaskTexture) gl.deleteTexture(this._waveData.u_oceanMaskTexture);
  }
  console.log('[WebGLMarineEngine] setWaveData input:', {vectors: waveGrid.vectors.length, cols: waveGrid.cols, rows: waveGrid.rows, hasBounds: !!waveGrid.bounds});
  this._waveData = encodeMarineTexture(gl, waveGrid);
  console.log('[WebGLMarineEngine] setWaveData result:', {hasData: !!this._waveData, hasWaveTexture: !!this._waveData?.u_waveTexture});
};

WebGLMarineEngine.prototype.renderHeatmapAndParticles = function(gl, matrix, screenWidth, screenHeight, zoom) {
  if (!this._initialized || !this._waveData || !matrix || !matrix.length) {
    if (this._renderLogged === undefined) {
      this._renderLogged = 0;
    }
    this._renderLogged++;
    if (this._renderLogged === 1 || this._renderLogged % 180 === 0) {
      console.log("[WebGLMarineEngine] render returned early! _initialized:", this._initialized, "_waveData:", !!this._waveData, "matrix:", !!matrix);
    }
    return;
  }

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

  var prevCullFace = gl.getParameter(gl.CULL_FACE);
  gl.disable(gl.CULL_FACE);

  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.SCISSOR_TEST);
  gl.colorMask(true, true, true, true);

  while (gl.getError() !== gl.NO_ERROR) {}

  var maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) || 16;
  for (var i = 0; i < maxAttribs; i++) {
    try {
      gl.disableVertexAttribArray(i);
    } catch (e) {}
  }

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

  var prevVAO = null;
  var isWebGL2 = false;
  if (gl.bindVertexArray) {
    isWebGL2 = true;
    prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.bindVertexArray(null);
  }

  var mat4 = matrix instanceof Float32Array ? matrix : new Float32Array(matrix);
  var time = (Date.now() - this._startTime) / 1000.0;
  const waveBounds = this._waveData.bounds;
  const z = typeof zoom === 'number' ? zoom : 6;

  // ==========================================
  // PHASE 1: GPU HEATMAP BASE LAYER (Upgraded Multi-Texture)
  // ==========================================
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  gl.useProgram(this.heatmapProgram);
  gl.uniformMatrix4fv(gl.getUniformLocation(this.heatmapProgram, 'u_matrix'), false, mat4);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);

  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_waveTexture'), 0);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_chlorophyllTexture'), 1);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_bathymetryTexture'), 2);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_oceanMaskTexture'), 3);

  var heatmapOpacity;
  if (z <= 2) heatmapOpacity = 0.45;
  else if (z <= 5) heatmapOpacity = 0.45 + (z - 2) / 3 * 0.10;
  else if (z <= 8) heatmapOpacity = 0.55 + (z - 5) / 3 * 0.10;
  else if (z <= 12) heatmapOpacity = 0.65 + (z - 8) / 4 * 0.05;
  else heatmapOpacity = 0.70;
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_opacity'), heatmapOpacity);

  bindTexture(gl, this._waveData.u_waveTexture, 0);
  bindTexture(gl, this._waveData.u_chlorophyllTexture, 1);
  bindTexture(gl, this._waveData.u_bathymetryTexture, 2);
  bindTexture(gl, this._waveData.u_oceanMaskTexture, 3);

  var heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.gridUVBuffer);
  gl.enableVertexAttribArray(heatUVLoc);
  gl.vertexAttribPointer(heatUVLoc, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIndexBuffer);
  gl.drawElements(gl.TRIANGLES, this.numGridIndices, gl.UNSIGNED_SHORT, 0);
  gl.disableVertexAttribArray(heatUVLoc);

  // ==========================================
  // PHASE 2: WAVE CREST RENDERER
  // ==========================================
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(this.drawProgram);
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_particles'), 0);
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_waveTexture'), 1);
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_oceanMaskTexture'), 2);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_particles_res'), this.particleRes);
  gl.uniformMatrix4fv(gl.getUniformLocation(this.drawProgram, 'u_matrix'), false, mat4);

  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_time'), time);

  const dashLengthScale = 5.0;
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_dash_length_scale'), dashLengthScale);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_zoom'), z);

  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._waveData.u_waveTexture, 1);
  bindTexture(gl, this._waveData.u_oceanMaskTexture, 2);

  var idLoc = gl.getAttribLocation(this.drawProgram, 'a_vertex_id');
  var lngOffsetLoc = gl.getUniformLocation(this.drawProgram, 'u_lng_offset');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIdBuffer);
  gl.enableVertexAttribArray(idLoc);
  gl.vertexAttribPointer(idLoc, 1, gl.FLOAT, false, 0, 0);

  var worldOffsets = (z < 3.5) ? [0.0, -360.0, 360.0] : [0.0];
  for (var wi = 0; wi < worldOffsets.length; wi++) {
    gl.uniform1f(lngOffsetLoc, worldOffsets[wi]);
    gl.drawArrays(gl.LINES, 0, this.particleRes * this.particleRes * 2);
  }
  gl.disableVertexAttribArray(idLoc);

  // ==========================================
  // PHASE 3: PARTICLE ADVECTION SYSTEM (Simulate next state)
  // ==========================================
  const baseScale = this.speedFactor * Math.pow(0.5, Math.max(0, z - 6));
  const lngSpan = Math.max(0.01, Math.abs(waveBounds.east - waveBounds.west));
  const latSpan = Math.max(0.01, Math.abs(waveBounds.north - waveBounds.south));
  const speedScaleX = Math.max(3.0e-4, baseScale / lngSpan);
  const speedScaleY = Math.max(3.0e-4, baseScale / latSpan);

  gl.disable(gl.BLEND); // CRITICAL: Disable blend to prevent position texture corruption!
  gl.useProgram(this.advectProgram);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_particles'), 0);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_waveTexture'), 1);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_oceanMaskTexture'), 2);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_speed_scale'), speedScaleX, speedScaleY);

  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_rand_seed'), Math.random());
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate'), this.dropRate);

  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);

  unbindTexture(gl, this.particleStateB);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.particleStateB, 0);
  gl.viewport(0, 0, this.particleRes, this.particleRes);

  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._waveData.u_waveTexture, 1);
  bindTexture(gl, this._waveData.u_oceanMaskTexture, 2);

  var advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
  gl.enableVertexAttribArray(advPosLoc);
  gl.vertexAttribPointer(advPosLoc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disableVertexAttribArray(advPosLoc);

  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);

  // Swap buffers
  var tmp = this.particleStateA;
  this.particleStateA = this.particleStateB;
  this.particleStateB = tmp;

  // Restore State
  gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, prevElementArrayBuffer);

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

  if (prevCullFace) {
    gl.enable(gl.CULL_FACE);
  } else {
    gl.disable(gl.CULL_FACE);
  }
};

WebGLMarineEngine.prototype.render = WebGLMarineEngine.prototype.renderHeatmapAndParticles;

WebGLMarineEngine.prototype.clearBuffers = function(gl) {
  // Direct drawing to screen FBO.
};

WebGLMarineEngine.prototype.dispose = function(gl) {
  if (!gl) return;
  if (this.advectProgram) gl.deleteProgram(this.advectProgram);
  if (this.drawProgram) gl.deleteProgram(this.drawProgram);
  if (this.heatmapProgram) gl.deleteProgram(this.heatmapProgram);
  if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
  if (this.vertexIdBuffer) gl.deleteBuffer(this.vertexIdBuffer);
  if (this.gridUVBuffer) gl.deleteBuffer(this.gridUVBuffer);
  if (this.gridIndexBuffer) gl.deleteBuffer(this.gridIndexBuffer);
  if (this.advFBO) gl.deleteFramebuffer(this.advFBO);
  if (this.particleStateA) gl.deleteTexture(this.particleStateA);
  if (this.particleStateB) gl.deleteTexture(this.particleStateB);
  if (this._waveData) {
    if (this._waveData.u_waveTexture) gl.deleteTexture(this._waveData.u_waveTexture);
    if (this._waveData.u_chlorophyllTexture) gl.deleteTexture(this._waveData.u_chlorophyllTexture);
    if (this._waveData.u_bathymetryTexture) gl.deleteTexture(this._waveData.u_bathymetryTexture);
    if (this._waveData.u_oceanMaskTexture) gl.deleteTexture(this._waveData.u_oceanMaskTexture);
  }
  this._waveData = null;
  this._initialized = false;
  console.log('[WebGLMarine] Engine Disposed');
};

export default WebGLMarineEngine;
