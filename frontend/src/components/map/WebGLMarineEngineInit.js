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
export function initParticleTexture(gl, resolution) {
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

export function reinitParticles(engine, gl) {
  if (engine.particleStateA) gl.deleteTexture(engine.particleStateA);
  if (engine.particleStateB) gl.deleteTexture(engine.particleStateB);
  engine.particleStateA = initParticleTexture(gl, engine.particleRes);
  engine.particleStateB = initParticleTexture(gl, engine.particleRes);
}

export function initEngine(engine, gl) {
  if (engine._initialized) return;

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

  engine.advectProgram = createProgram(gl, advVS, advFS);
  engine.drawProgram = createProgram(gl, drawVS, drawFS);
  engine.heatmapProgram = createProgram(gl, heatVS, heatFS);

  engine.quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, engine.quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  const numParticles = engine.particleRes * engine.particleRes;
  const numVertices = numParticles * 6;
  const vertexIds = new Float32Array(numVertices);
  for (let i = 0; i < numVertices; i++) {
    vertexIds[i] = i;
  }
  engine.vertexIdBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, engine.vertexIdBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexIds, gl.STATIC_DRAW);
  engine._numQuadVertices = numVertices;

  const pointSizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  engine._maxPointSize = pointSizeRange ? Math.min(pointSizeRange[1], 64.0) : 64.0;
  engine._minPointSize = pointSizeRange ? pointSizeRange[0] : 1.0;
  console.log(`[WebGLMarine] v5.3 quad ribbon renderer. ${numParticles} particles × 6 verts = ${numVertices} vertices. GPU point size range: ${engine._minPointSize}-${engine._maxPointSize}`);

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
  engine.gridUVBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, engine.gridUVBuffer);
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
  engine.gridIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, engine.gridIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gridIndices, gl.STATIC_DRAW);
  engine.numGridIndices = gridIndices.length;

  engine.particleStateA = initParticleTexture(gl, engine.particleRes);
  engine.particleStateB = initParticleTexture(gl, engine.particleRes);

  engine.advFBO = gl.createFramebuffer();
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.framebufferCount++;
  }

  if (gl.createVertexArray) {
    engine.heatmapVAO = gl.createVertexArray();
    gl.bindVertexArray(engine.heatmapVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, engine.gridUVBuffer);
    var heatUVLoc = gl.getAttribLocation(engine.heatmapProgram, 'a_grid_uv');
    if (heatUVLoc !== -1) {
      gl.enableVertexAttribArray(heatUVLoc);
      gl.vertexAttribPointer(heatUVLoc, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, engine.gridIndexBuffer);

    engine.drawVAO = gl.createVertexArray();
    gl.bindVertexArray(engine.drawVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, engine.vertexIdBuffer);
    var idLoc = gl.getAttribLocation(engine.drawProgram, 'a_vertex_id');
    if (idLoc !== -1) {
      gl.enableVertexAttribArray(idLoc);
      gl.vertexAttribPointer(idLoc, 1, gl.FLOAT, false, 0, 0);
    }

    engine.advectVAO = gl.createVertexArray();
    gl.bindVertexArray(engine.advectVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, engine.quadBuffer);
    var advPosLoc = gl.getAttribLocation(engine.advectProgram, 'a_pos');
    if (advPosLoc !== -1) {
      gl.enableVertexAttribArray(advPosLoc);
      gl.vertexAttribPointer(advPosLoc, 2, gl.FLOAT, false, 0, 0);
    }

    gl.bindVertexArray(null);
  }

  engine._initialized = true;
  console.log('[WebGLMarine] Initialized engine with ' + numParticles + ' wave crests + 96x96 grid');
}

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

export function disposeEngine(engine, gl) {
  if (!gl) return;
  engine.clearBuffers(gl);

  if (engine.heatmapVAO) { gl.deleteVertexArray(engine.heatmapVAO); engine.heatmapVAO = null; }
  if (engine.drawVAO) { gl.deleteVertexArray(engine.drawVAO); engine.drawVAO = null; }
  if (engine.advectVAO) { gl.deleteVertexArray(engine.advectVAO); engine.advectVAO = null; }

  if (engine.advectProgram) deleteAttachedShaders(gl, engine.advectProgram);
  if (engine.drawProgram) deleteAttachedShaders(gl, engine.drawProgram);
  if (engine.heatmapProgram) deleteAttachedShaders(gl, engine.heatmapProgram);
  if (engine.quadBuffer) gl.deleteBuffer(engine.quadBuffer);
  if (engine.vertexIdBuffer) gl.deleteBuffer(engine.vertexIdBuffer);
  if (engine.gridUVBuffer) gl.deleteBuffer(engine.gridUVBuffer);
  if (engine.gridIndexBuffer) gl.deleteBuffer(engine.gridIndexBuffer);
  if (engine.advFBO) gl.deleteFramebuffer(engine.advFBO);
  if (engine.particleStateA) gl.deleteTexture(engine.particleStateA);
  if (engine.particleStateB) gl.deleteTexture(engine.particleStateB);
  
  if (engine._residentWaveTex) gl.deleteTexture(engine._residentWaveTex);
  if (engine._residentChlTex) gl.deleteTexture(engine._residentChlTex);
  if (engine._residentBathTex) gl.deleteTexture(engine._residentBathTex);
  if (engine._cachedMaskTex) gl.deleteTexture(engine._cachedMaskTex);
  
  engine._residentWaveTex = null;
  engine._residentChlTex = null;
  engine._residentBathTex = null;
  engine._cachedMaskTex = null;
  engine._cachedMaskGeoJSON = null;
  engine._landGeoJSON = null;
  engine._initialized = false;
  console.log('[WebGLMarine] Engine Disposed');
}
