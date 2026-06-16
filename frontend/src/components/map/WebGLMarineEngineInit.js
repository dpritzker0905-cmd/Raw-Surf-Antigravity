import WebGLMarineEngine from './WebGLMarineEngine';
import {
  ADVECT_VS,
  ADVECT_FS,
  DRAW_VS,
  DRAW_FS,
  HEATMAP_VS,
  HEATMAP_FS
} from './WebGLMarineShaders';
import {
  createShader,
  createProgram
} from './WebGLWindUtils';
import {
  createTexture
} from './WebGLMarineTextureEncoder';

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

WebGLMarineEngine.prototype.reinitParticles = function(gl) {
  if (this.particleStateA) gl.deleteTexture(this.particleStateA);
  if (this.particleStateB) gl.deleteTexture(this.particleStateB);
  this.particleStateA = initParticleTexture(gl, this.particleRes);
  this.particleStateB = initParticleTexture(gl, this.particleRes);
};

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
  const numVertices = numParticles * 6;
  const vertexIds = new Float32Array(numVertices);
  for (let i = 0; i < numVertices; i++) {
    vertexIds[i] = i;
  }
  this.vertexIdBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIdBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexIds, gl.STATIC_DRAW);
  this._numQuadVertices = numVertices;

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

  if (gl.createVertexArray) {
    this.heatmapVAO = gl.createVertexArray();
    gl.bindVertexArray(this.heatmapVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridUVBuffer);
    var heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
    if (heatUVLoc !== -1) {
      gl.enableVertexAttribArray(heatUVLoc);
      gl.vertexAttribPointer(heatUVLoc, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIndexBuffer);

    this.drawVAO = gl.createVertexArray();
    gl.bindVertexArray(this.drawVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIdBuffer);
    var idLoc = gl.getAttribLocation(this.drawProgram, 'a_vertex_id');
    if (idLoc !== -1) {
      gl.enableVertexAttribArray(idLoc);
      gl.vertexAttribPointer(idLoc, 1, gl.FLOAT, false, 0, 0);
    }

    this.advectVAO = gl.createVertexArray();
    gl.bindVertexArray(this.advectVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    var advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
    if (advPosLoc !== -1) {
      gl.enableVertexAttribArray(advPosLoc);
      gl.vertexAttribPointer(advPosLoc, 2, gl.FLOAT, false, 0, 0);
    }

    gl.bindVertexArray(null);
  }

  this._initialized = true;
  console.log('[WebGLMarine] Initialized engine with ' + numParticles + ' wave crests + 96x96 grid');
};

var deleteAttachedShaders = function(gl, prog) {
  if (!gl || !prog) return;
  try {
    if (gl.isContextLost && gl.isContextLost()) return;
    if (!gl.isProgram(prog)) return;
    var shaders = gl.getAttachedShaders(prog);
    if (shaders) {
      for (var i = 0; i < shaders.length; i++) {
        gl.detachShader(prog, shaders[i]);
        gl.deleteShader(shaders[i]);
      }
    }
  } catch (e) {}
  try {
    if (gl.isProgram(prog)) {
      gl.deleteProgram(prog);
    }
  } catch (e) {}
};

WebGLMarineEngine.prototype.dispose = function(gl) {
  if (!gl) return;
  this.clearBuffers(gl);

  if (this.heatmapVAO) { gl.deleteVertexArray(this.heatmapVAO); this.heatmapVAO = null; }
  if (this.drawVAO) { gl.deleteVertexArray(this.drawVAO); this.drawVAO = null; }
  if (this.advectVAO) { gl.deleteVertexArray(this.advectVAO); this.advectVAO = null; }

  if (this.advectProgram) deleteAttachedShaders(gl, this.advectProgram);
  if (this.drawProgram) deleteAttachedShaders(gl, this.drawProgram);
  if (this.heatmapProgram) deleteAttachedShaders(gl, this.heatmapProgram);
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
  this._initialized = false;
  console.log('[WebGLMarine] Engine Disposed');
};
