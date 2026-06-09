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
import { recordTruthStage } from './weatherTruthTracker';

import {
  createShader,
  createProgram,
  createTexture,
  bindTexture,
  unbindTexture,
  safeDeleteTexture,
  encodeMarineTexture
} from './WebGLMarineTextureEncoder';

import { populateCrestDiagnostics } from './WebGLMarineEngineDiagnostics';

// --- Particle Texture Init Helper ---
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
  this.particleRes = 296;       // 296² = 87,616 crests
  this.speedFactor = 0.05;      // drift speed scale
  this.dropRate = 0.003;        // particle drop rate
  this._initialized = false;
  this._waveData = null;
  this._startTime = Date.now();

  if (typeof window !== 'undefined') {
    window.__MARINE_ENGINE__ = this;
  }

  if (typeof window !== 'undefined' && !window.__RAW_GPU__) {
    window.__RAW_GPU__ = {
      textureCount: 0,
      textureUploadCount: 0,
      framebufferCount: 0,
      activeRafCount: 1,
      drawCallsPerFrame: 0,
      gpuMemoryEstimate: 0,
      shaderCompileCount: 6, // 6 shaders compiled at start
      frameTimeHistogram: [0, 0, 0, 0, 0], // <8ms, 8-16ms, 16-32ms, 32-64ms, >64ms
      droppedFrameCounter: 0,
      reactRerenderCounter: 0
    };
  }
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
  // v5.3: Six vertices per particle (2 triangles = 1 quad ribbon)
  const numVertices = numParticles * 6;
  const vertexIds = new Float32Array(numVertices);
  for (let i = 0; i < numVertices; i++) {
    vertexIds[i] = i;
  }
  this.vertexIdBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIdBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexIds, gl.STATIC_DRAW);
  this._numQuadVertices = numVertices;

  // Keep point-size range query for diagnostics
  const pointSizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  this._maxPointSize = pointSizeRange ? Math.min(pointSizeRange[1], 64.0) : 64.0;
  this._minPointSize = pointSizeRange ? pointSizeRange[0] : 1.0;
  console.log(`[WebGLMarine] v5.3 quad ribbon renderer. ${numParticles} particles × 6 verts = ${numVertices} vertices. GPU point size range: ${this._minPointSize}-${this._maxPointSize}`);

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
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.framebufferCount++;
  }
  this._initialized = true;
  console.log('[WebGLMarine] Initialized engine with ' + numParticles + ' wave crests + 96x96 grid');
};

WebGLMarineEngine.prototype.isHighResMaskLoaded = function() {
  return !!this._cachedMaskGeoJSON;
};

WebGLMarineEngine.prototype.setWaveData = function(gl, waveGrid, landGeoJSON) {
  if (!waveGrid?.vectors?.length) return;
  
  if (landGeoJSON) {
    this._landGeoJSON = landGeoJSON;
  }
  const activeGeoJSON = landGeoJSON || this._landGeoJSON;
  console.log(`[WebGLMarineEngine-Forensic] setWaveData: ${waveGrid.vectors.length} vectors, landGeoJSON present: ${!!activeGeoJSON}`);

  let minHeight = Infinity, maxHeight = -Infinity, sumHeight = 0;
  let minPeriod = Infinity, maxPeriod = -Infinity, sumPeriod = 0;
  let oceanCount = 0;
  
  for (let i = 0; i < waveGrid.vectors.length; i++) {
    const v = waveGrid.vectors[i];
    if (v && v.isOcean) {
      oceanCount++;
      const h = v.height || v.speed || 0;
      const p = v.period || 0;
      
      if (h < minHeight) minHeight = h;
      if (h > maxHeight) maxHeight = h;
      sumHeight += h;
      
      if (p < minPeriod) minPeriod = p;
      if (p > maxPeriod) maxPeriod = p;
      sumPeriod += p;
    }
  }
  
  const meanHeight = oceanCount > 0 ? sumHeight / oceanCount : 0;
  const meanPeriod = oceanCount > 0 ? sumPeriod / oceanCount : 0;
  
  console.log(`[FORENSIC-ENCODE] GPU Upload Stats: ${waveGrid.vectors.length} vectors, ${oceanCount} ocean points. ` +
    `Height: min=${oceanCount ? minHeight.toFixed(2) : 0}m, max=${oceanCount ? maxHeight.toFixed(2) : 0}m, mean=${meanHeight.toFixed(2)}m (${(meanHeight * 3.28084).toFixed(1)}ft). ` +
    `Period: min=${oceanCount ? minPeriod.toFixed(1) : 0}s, max=${oceanCount ? maxPeriod.toFixed(1) : 0}s, mean=${meanPeriod.toFixed(1)}s.`);

  if (this._waveData) {
    if (this._waveData.u_waveTexture && this._waveData.u_waveTexture !== this._residentWaveTex) {
      safeDeleteTexture(gl, this._waveData.u_waveTexture, this);
    }
    if (this._waveData.u_chlorophyllTexture && this._waveData.u_chlorophyllTexture !== this._residentChlTex) {
      safeDeleteTexture(gl, this._waveData.u_chlorophyllTexture, this);
    }
    if (this._waveData.u_bathymetryTexture && this._waveData.u_bathymetryTexture !== this._residentBathTex) {
      safeDeleteTexture(gl, this._waveData.u_bathymetryTexture, this);
    }
    
    if (this._waveData.u_oceanMaskTexture && this._waveData.u_oceanMaskTexture === this._cachedMaskTex) {
      // Keep it
    } else {
      if (this._waveData.u_oceanMaskTexture) safeDeleteTexture(gl, this._waveData.u_oceanMaskTexture, this);
    }
  }
  
  console.log('[WebGLMarineEngine] setWaveData input:', {vectors: waveGrid.vectors.length, cols: waveGrid.cols, rows: waveGrid.rows, hasBounds: !!waveGrid.bounds, hasGeoJSON: !!activeGeoJSON});
  this._waveData = encodeMarineTexture(gl, waveGrid, activeGeoJSON, this);
  if (this._waveData) {
    this._waveData.truthTag = waveGrid.truthTag;
    this._waveData.waveGrid = waveGrid;
  }
  console.log('[WebGLMarineEngine] setWaveData result:', {hasData: !!this._waveData, hasWaveTexture: !!this._waveData?.u_waveTexture});

  const model = waveGrid.__sourceModel || 'GFS';
  const layer = waveGrid.__componentLayer || 'waves';
  const hourOffset = waveGrid.hourOffset || 0;

  if (model === 'GFS' && layer === 'waves' && hourOffset === 0) {
    recordTruthStage('webglUpload', {
      model,
      domain: 'marine',
      layer,
      valid_time: waveGrid.valid_time || waveGrid.validTime,
      run_time: waveGrid.run_time || waveGrid.runTime,
      product_id: waveGrid.productId || waveGrid.product_id,
      is_dynamic_viewport_product: waveGrid.is_dynamic_viewport_product,
      coverage_scope: waveGrid.coverage_scope,
      requested_bbox: waveGrid.requested_bbox,
      served_bbox: waveGrid.served_bbox,
      grid: waveGrid,
      truthTag: waveGrid.truthTag
    }, 'WebGLMarineEngine.js', 'setWaveData');
  }
};

WebGLMarineEngine.prototype.renderHeatmapAndParticles = function(gl, matrix, screenWidth, screenHeight, zoom, theme) {
  const renderStart = (typeof window !== 'undefined' && window.__RAW_GPU__) ? performance.now() : 0;
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.drawCallsPerFrame = 0;
    window.__RAW_GPU__.particlePassExecuted = false;
  }
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

  if (window.__WEATHER_DEBUG_ISOLATE_OVERLAY__ === true) {
    gl.clearColor(0.05, 0.05, 0.08, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  const waveGrid = this._waveData?.waveGrid;
  if (waveGrid) {
    const model = waveGrid.__sourceModel || 'GFS';
    const layer = waveGrid.__componentLayer || 'waves';
    const hourOffset = waveGrid.hourOffset || 0;

    if (model === 'GFS' && layer === 'waves' && hourOffset === 0) {
      recordTruthStage('webglRender', {
        model,
        domain: 'marine',
        layer,
        valid_time: waveGrid.valid_time || waveGrid.validTime,
        run_time: waveGrid.run_time || waveGrid.runTime,
        product_id: waveGrid.productId || waveGrid.product_id,
        is_dynamic_viewport_product: waveGrid.is_dynamic_viewport_product,
        coverage_scope: waveGrid.coverage_scope,
        requested_bbox: waveGrid.requested_bbox,
        served_bbox: waveGrid.served_bbox,
        grid: waveGrid,
        truthTag: this._waveData.truthTag
      }, 'WebGLMarineEngine.js', 'renderHeatmapAndParticles');

      recordTruthStage('animationFrame', {
        model,
        domain: 'marine',
        layer,
        valid_time: waveGrid.valid_time || waveGrid.validTime,
        run_time: waveGrid.run_time || waveGrid.runTime,
        product_id: waveGrid.productId || waveGrid.product_id,
        is_dynamic_viewport_product: waveGrid.is_dynamic_viewport_product,
        coverage_scope: waveGrid.coverage_scope,
        requested_bbox: waveGrid.requested_bbox,
        served_bbox: waveGrid.served_bbox,
        grid: waveGrid,
        truthTag: this._waveData.truthTag
      }, 'WebGLMarineEngine.js', 'renderHeatmapAndParticles');
    }
  }

  var themeVal = 0.0;
  if (typeof window !== 'undefined' && window.__DIAGNOSTIC_THEME__ !== undefined) {
    themeVal = window.__DIAGNOSTIC_THEME__;
  } else if (theme === 'light') {
    themeVal = 1.0;
  } else if (theme === 'beach') {
    themeVal = 2.0;
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
  var prevBlendEqRGB = gl.getParameter(gl.BLEND_EQUATION_RGB);
  var prevBlendEqAlpha = gl.getParameter(gl.BLEND_EQUATION_ALPHA);

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
  gl.blendEquation(gl.FUNC_ADD);

  var prevClearColor = null;
  if (window.__WEATHER_DEBUG_ISOLATE_OVERLAY__ === true) {
    prevClearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE);
    gl.clearColor(0.05, 0.05, 0.08, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  while (gl.getError() !== gl.NO_ERROR) {}

  var prevAttribsEnabled = [];
  var maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) || 16;
  for (var i = 0; i < maxAttribs; i++) {
    try {
      var enabled = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED);
      prevAttribsEnabled.push(enabled);
      if (enabled) {
        gl.disableVertexAttribArray(i);
      }
    } catch (e) {
      prevAttribsEnabled.push(false);
    }
  }

  var prevVAO = null;
  var isWebGL2 = false;
  if (gl.bindVertexArray) {
    isWebGL2 = true;
  }

  var prevTextures2D = [];
  var prevTexturesCube = [];
  var prevSamplers = [];
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
    if (isWebGL2) {
      try {
        prevSamplers.push(gl.getParameter(gl.SAMPLER_BINDING));
        gl.bindSampler(u, null);
      } catch (e) {
        prevSamplers.push(null);
      }
    }
  }

  if (isWebGL2) {
    prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.bindVertexArray(null);
  }

  var mat4 = matrix instanceof Float32Array ? matrix : new Float32Array(matrix);
  var time = (Date.now() - this._startTime) / 1000.0;
  const waveBounds = this._waveData.bounds;
  const z = typeof zoom === 'number' ? zoom : 6;
  const smoothstepVal = (edge0, edge1, x) => {
    const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3.0 - 2.0 * t);
  };
  // v7.0: Slow animation motion speed smoothly by 25% at lower/far zoom without changing animation type
  const zoomFactor = z < 6.0 ? (0.75 + 0.25 * smoothstepVal(3.0, 6.0, z)) : 1.0;
  const motionScale = (0.75 + 0.25 * smoothstepVal(4.0, 7.0, z)) * zoomFactor;
  this.motionScale = motionScale;

  // ==========================================
  // PHASE 1: GPU HEATMAP BASE LAYER (Upgraded Multi-Texture)
  // Draw base heatmap instantly using fallback grid mask texture if land mask is loading.
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
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_theme'), themeVal);
  
  const isRegionalGrid = (waveBounds.east - waveBounds.west < 359.9);
  const edgeFeatherEnabledVal = isRegionalGrid ? 1.0 : 0.0;
  if (typeof window !== 'undefined') {
    window.__MARINE_COVERAGE_STATUS__ = isRegionalGrid
      ? 'partial_regional_coverage'
      : 'full_coverage';
  }
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_edgeFeatherEnabled'), edgeFeatherEnabledVal);

  if (typeof window !== 'undefined' && !window.__GPU_DEBUG__) {
    window.__GPU_DEBUG__ = { mode: null };
  }
  let debugModeVal = 0.0;
  if (typeof window !== 'undefined' && window.__GPU_DEBUG__) {
    const mode = window.__GPU_DEBUG__.mode;
    if (mode === 'uv') debugModeVal = 1.0;
    else if (mode === 'mask') debugModeVal = 2.0;
    else if (mode === 'grid') debugModeVal = 3.0;
    else if (mode === 'mercator') debugModeVal = 4.0;
  }
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_debug_mode'), debugModeVal);

  var heatmapOpacity;
  if (z <= 2) heatmapOpacity = 0.55;
  else if (z <= 5) heatmapOpacity = 0.55 + (z - 2) / 3 * 0.10;
  else if (z <= 8) heatmapOpacity = 0.65 + (z - 5) / 3 * 0.10;
  else if (z <= 12) heatmapOpacity = 0.75 + (z - 8) / 4 * 0.05;
  else heatmapOpacity = 0.85;

  if (window.__WEATHER_DEBUG_ISOLATE_OVERLAY__ === true) {
    heatmapOpacity = 1.0;
  }

  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_opacity'), heatmapOpacity);

  bindTexture(gl, this._waveData.u_waveTexture, 0);
  bindTexture(gl, this._waveData.u_chlorophyllTexture, 1);
  bindTexture(gl, this._waveData.u_bathymetryTexture, 2);
  bindTexture(gl, this._waveData.u_oceanMaskTexture, 3);

  var heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
  var heatLngOffsetLoc = gl.getUniformLocation(this.heatmapProgram, 'u_lng_offset');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.gridUVBuffer);
  gl.enableVertexAttribArray(heatUVLoc);
  gl.vertexAttribPointer(heatUVLoc, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIndexBuffer);

  var worldOffsets = [0.0, -360.0, 360.0];
  for (var wi = 0; wi < worldOffsets.length; wi++) {
    gl.uniform1f(heatLngOffsetLoc, worldOffsets[wi]);
    gl.drawElements(gl.TRIANGLES, this.numGridIndices, gl.UNSIGNED_SHORT, 0);
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.drawCallsPerFrame++;
    }
  }
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
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_theme'), themeVal);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_edgeFeatherEnabled'), edgeFeatherEnabledVal);

  let drawDebugModeVal = 0.0;
  if (typeof window !== 'undefined' && window.__GPU_DEBUG__) {
    const mode = window.__GPU_DEBUG__.mode;
    if (mode === 'part_uv') drawDebugModeVal = 5.0;
    else if (mode === 'part_pos') drawDebugModeVal = 6.0;
    else if (mode === 'part_offset') drawDebugModeVal = 7.0;
    else if (mode === 'part_fbo') drawDebugModeVal = 8.0;
  }
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_debug_mode'), drawDebugModeVal);

  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_time'), time);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_zoom'), z);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_motion_scale'), motionScale);

  // v5.3: viewport and DPR uniforms for pixel-space quad expansion
  var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1.0;
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_viewport'), gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_device_pixel_ratio'), dpr);

  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._waveData.u_waveTexture, 1);
  bindTexture(gl, this._waveData.u_oceanMaskTexture, 2);

  var idLoc = gl.getAttribLocation(this.drawProgram, 'a_vertex_id');
  var mercOffsetLoc = gl.getUniformLocation(this.drawProgram, 'u_merc_offset');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIdBuffer);
  gl.enableVertexAttribArray(idLoc);
  gl.vertexAttribPointer(idLoc, 1, gl.FLOAT, false, 0, 0);

  // v5.3: gl.TRIANGLES quad ribbons (6 verts per particle)
  var numQuadVerts = this._numQuadVertices || this.particleRes * this.particleRes * 6;
  var worldOffsets = [0.0, -1.0, 1.0];
  for (var wi = 0; wi < worldOffsets.length; wi++) {
    gl.uniform1f(mercOffsetLoc, worldOffsets[wi]);
    gl.drawArrays(gl.TRIANGLES, 0, numQuadVerts);
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.drawCallsPerFrame++;
    }
  }
  gl.disableVertexAttribArray(idLoc);

  // === CREST DIAGNOSTICS (v5.3) ===
  populateCrestDiagnostics(this, gl, waveBounds, z);

  // ==========================================
  // PHASE 3: PARTICLE ADVECTION SYSTEM (Simulate next state)
  // ==========================================
  const stableSpeedScale = this.speedFactor * Math.pow(0.5, Math.max(0, z - 6)) * 1.5e-5 * motionScale;

  gl.disable(gl.BLEND); // CRITICAL: Disable blend to prevent position texture corruption!
  gl.useProgram(this.advectProgram);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_particles'), 0);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_waveTexture'), 1);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_oceanMaskTexture'), 2);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speed_scale'), stableSpeedScale);

  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_rand_seed'), Math.random());
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate'), this.dropRate);

  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);

  unbindTexture(gl, this.particleStateB);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.particleStateB, 0);
  gl.viewport(0, 0, this.particleRes, this.particleRes);

  const readTex = this.particleStateA;
  const writeTex = this.particleStateB;
  console.assert(readTex !== writeTex, "Assertion failed: readTex === writeTex inside WebGL advection loop!");

  const fboStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  let fboStatusStr = 'UNKNOWN';
  if (fboStatus === gl.FRAMEBUFFER_COMPLETE) fboStatusStr = 'FRAMEBUFFER_COMPLETE';
  else if (fboStatus === gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT) fboStatusStr = 'INCOMPLETE_ATTACHMENT';
  else if (fboStatus === gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT) fboStatusStr = 'INCOMPLETE_MISSING';
  else if (fboStatus === gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS) fboStatusStr = 'INCOMPLETE_DIMENSIONS';
  else if (fboStatus === gl.FRAMEBUFFER_UNSUPPORTED) fboStatusStr = 'UNSUPPORTED';
  else fboStatusStr = 'INCOMPLETE_STATUS_' + fboStatus;

  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.particleStateATexUnit = 0;
    window.__RAW_GPU__.particleStateBTexUnit = 'FBO_ATTACH_COLOR0';
    window.__RAW_GPU__.advFboStatus = fboStatusStr;
    window.__RAW_GPU__.particlePassExecuted = true;
  }

  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._waveData.u_waveTexture, 1);
  bindTexture(gl, this._waveData.u_oceanMaskTexture, 2);

  var advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
  gl.enableVertexAttribArray(advPosLoc);
  gl.vertexAttribPointer(advPosLoc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.drawCallsPerFrame++;
  }
  gl.disableVertexAttribArray(advPosLoc);

  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);

  var tmp = this.particleStateA;
  this.particleStateA = this.particleStateB;
  this.particleStateB = tmp;

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
    if (isWebGL2 && prevSamplers[u] !== undefined) {
      gl.bindSampler(u, prevSamplers[u]);
    }
  }

  gl.activeTexture(prevActiveTex);
  
  for (var i = 0; i < prevAttribsEnabled.length; i++) {
    try {
      if (prevAttribsEnabled[i]) {
        gl.enableVertexAttribArray(i);
      } else {
        gl.disableVertexAttribArray(i);
      }
    } catch (e) {}
  }
  
  if (prevBlend) {
    gl.enable(gl.BLEND);
  } else {
    gl.disable(gl.BLEND);
  }
  gl.blendFuncSeparate(prevBlendSrcRGB, prevBlendDstRGB, prevBlendSrcAlpha, prevBlendDstAlpha);
  gl.blendEquationSeparate(prevBlendEqRGB, prevBlendEqAlpha);

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

  if (prevClearColor) {
    gl.clearColor(prevClearColor[0], prevClearColor[1], prevClearColor[2], prevClearColor[3]);
  }

  if (typeof window !== 'undefined' && window.__RAW_GPU__ && renderStart > 0) {
    const renderDuration = performance.now() - renderStart;
    if (renderDuration < 8.0) window.__RAW_GPU__.frameTimeHistogram[0]++;
    else if (renderDuration < 16.6) window.__RAW_GPU__.frameTimeHistogram[1]++;
    else if (renderDuration < 33.3) window.__RAW_GPU__.frameTimeHistogram[2]++;
    else if (renderDuration < 66.6) window.__RAW_GPU__.frameTimeHistogram[3]++;
    else window.__RAW_GPU__.frameTimeHistogram[4]++;

    if (renderDuration > 16.6) {
      window.__RAW_GPU__.droppedFrameCounter++;
    }
  }
};

WebGLMarineEngine.prototype.render = WebGLMarineEngine.prototype.renderHeatmapAndParticles;

WebGLMarineEngine.prototype.clearBuffers = function(gl) {
  if (!gl) return;
  console.log('[WebGLMarineEngine-Clear] Clearing resident wave textures and waveData');
  if (this._waveData) {
    if (this._waveData.u_waveTexture && this._waveData.u_waveTexture !== this._residentWaveTex) {
      safeDeleteTexture(gl, this._waveData.u_waveTexture, this);
    }
    if (this._waveData.u_chlorophyllTexture && this._waveData.u_chlorophyllTexture !== this._residentChlTex) {
      safeDeleteTexture(gl, this._waveData.u_chlorophyllTexture, this);
    }
    if (this._waveData.u_bathymetryTexture && this._waveData.u_bathymetryTexture !== this._residentBathTex) {
      safeDeleteTexture(gl, this._waveData.u_bathymetryTexture, this);
    }
    if (this._waveData.u_oceanMaskTexture && this._waveData.u_oceanMaskTexture !== this._cachedMaskTex) {
      safeDeleteTexture(gl, this._waveData.u_oceanMaskTexture, this);
    }
    this._waveData = null;
  }
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
  
  if (this._residentWaveTex) gl.deleteTexture(this._residentWaveTex);
  if (this._residentChlTex) gl.deleteTexture(this._residentChlTex);
  if (this._residentBathTex) gl.deleteTexture(this._residentBathTex);
  if (this._cachedMaskTex) gl.deleteTexture(this._cachedMaskTex);
  
  this._residentWaveTex = null;
  this._residentChlTex = null;
  this._residentBathTex = null;
  this._cachedMaskTex = null;
  this._cachedMaskGeoJSON = null;
  this._landGeoJSON = null;

  if (this._waveData) {
    if (this._waveData.u_waveTexture && this._waveData.u_waveTexture !== this._residentWaveTex) {
      gl.deleteTexture(this._waveData.u_waveTexture);
    }
    if (this._waveData.u_chlorophyllTexture && this._waveData.u_chlorophyllTexture !== this._residentChlTex) {
      gl.deleteTexture(this._waveData.u_chlorophyllTexture);
    }
    if (this._waveData.u_bathymetryTexture && this._waveData.u_bathymetryTexture !== this._residentBathTex) {
      gl.deleteTexture(this._waveData.u_bathymetryTexture);
    }
    if (this._waveData.u_oceanMaskTexture && this._waveData.u_oceanMaskTexture !== this._cachedMaskTex) {
      gl.deleteTexture(this._waveData.u_oceanMaskTexture);
    }
  }
  this._waveData = null;
  this._initialized = false;
  console.log('[WebGLMarine] Engine Disposed');
};

export default WebGLMarineEngine;
