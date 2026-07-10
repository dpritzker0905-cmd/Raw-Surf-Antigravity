import {
  ADVECT_VS,
  ADVECT_FS,
  DRAW_VS,
  DRAW_FS,
  HEATMAP_VS,
  HEATMAP_FS,
  SCREEN_VS,
  SCREEN_FS,
  FADE_FS
} from './WebGLWindShaders';
import {
  createShader,
  createProgram,
  initParticleTexture
} from './WebGLWindUtils';

export function reinitParticles(engine, gl, opts) {
  if (!gl || !engine._initialized) return;
  // keepTrails (2026-07-10, the pan/zoom wind blink): CAMERA-driven reseeds (tile drift recenter,
  // zoom-tier crossing) used to hard-clear the trail FBOs too — the whole field blanked and took
  // ~1s to redraw on every screen-sized pan ("not snappy" feel with all data paths warm). Trails
  // are screen-space and the fade pass ages them out in <1s, so keeping them = a smooth crossfade
  // (the same trade the instant-toggle path already ships for stale trails: re-advect, don't blank).
  // DATA-driven reseeds (genuine grid-bounds change) keep the full clear.
  // Kill switch: window.__RAW_WIND_TRAIL_CLEAR_LEGACY__ = true restores clearing everywhere.
  const keepTrails = !!(opts && opts.keepTrails) &&
    !(typeof window !== 'undefined' && window.__RAW_WIND_TRAIL_CLEAR_LEGACY__ === true);
  if (!keepTrails) engine.clearBuffers(gl);
  if (engine.particleStateA) gl.deleteTexture(engine.particleStateA);
  if (engine.particleStateB) gl.deleteTexture(engine.particleStateB);
  engine.particleStateA = initParticleTexture(gl, engine.particleRes);
  engine.particleStateB = initParticleTexture(gl, engine.particleRes);
  console.log(keepTrails
    ? '[WebGLWind] Particles re-seeded (trails kept — camera recenter)'
    : '[WebGLWind] Particles re-initialized and FBOs cleared due to bounds change');
}

export function initEngine(engine, gl) {
  if (engine._initialized) return;
  var advVS = createShader(gl, gl.VERTEX_SHADER, ADVECT_VS);
  var advFS = createShader(gl, gl.FRAGMENT_SHADER, ADVECT_FS);
  var drawVS = createShader(gl, gl.VERTEX_SHADER, DRAW_VS);
  var drawFS = createShader(gl, gl.FRAGMENT_SHADER, DRAW_FS);
  var screenVS = createShader(gl, gl.VERTEX_SHADER, SCREEN_VS);
  var screenFS = createShader(gl, gl.FRAGMENT_SHADER, SCREEN_FS);
  var fadeVS = createShader(gl, gl.VERTEX_SHADER, SCREEN_VS);
  var fadeFS = createShader(gl, gl.FRAGMENT_SHADER, FADE_FS);
  var heatVS = createShader(gl, gl.VERTEX_SHADER, HEATMAP_VS);
  var heatFS = createShader(gl, gl.FRAGMENT_SHADER, HEATMAP_FS);
  if (!advVS || !advFS || !drawVS || !drawFS || !screenVS || !screenFS || !heatVS || !heatFS) {
    console.error('[WebGLWind] Failed to compile shaders'); return;
  }
  engine.advectProgram = createProgram(gl, advVS, advFS);
  engine.drawProgram = createProgram(gl, drawVS, drawFS);
  engine.screenProgram = createProgram(gl, screenVS, screenFS);
  engine.fadeProgram = createProgram(gl, fadeVS, fadeFS);
  engine.heatmapProgram = createProgram(gl, heatVS, heatFS);
  engine.quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, engine.quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  var indices = new Float32Array(engine.particleRes * engine.particleRes);
  for (var i = 0; i < indices.length; i++) indices[i] = i;
  engine.particleIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, engine.particleIndexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  const gridW = 72;
  const gridH = 48;
  const gridUVs = new Float32Array(gridW * gridH * 2);
  for (let r = 0; r < gridH; r++) {
    for (let c = 0; c < gridW; c++) {
      const idx = (r * gridW + c) * 2;
      gridUVs[idx + 0] = c / (gridW - 1);
      gridUVs[idx + 1] = r / (gridH - 1);
    }
  }
  const gridIndices = new Uint16Array((gridW - 1) * (gridH - 1) * 6);
  let gi = 0;
  for (let r = 0; r < gridH - 1; r++) {
    for (let c = 0; c < gridW - 1; c++) {
      const i0 = r * gridW + c;
      const i1 = i0 + 1;
      const i2 = (r + 1) * gridW + c;
      const i3 = i2 + 1;
      gridIndices[gi++] = i0;
      gridIndices[gi++] = i1;
      gridIndices[gi++] = i2;
      gridIndices[gi++] = i1;
      gridIndices[gi++] = i3;
      gridIndices[gi++] = i2;
    }
  }
  engine.heatmapGridBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, engine.heatmapGridBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, gridUVs, gl.STATIC_DRAW);
  engine.heatmapIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, engine.heatmapIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gridIndices, gl.STATIC_DRAW);
  engine.heatmapIndexCount = gridIndices.length;
  engine.particleStateA = initParticleTexture(gl, engine.particleRes);
  engine.particleStateB = initParticleTexture(gl, engine.particleRes);
  engine.advFBO = gl.createFramebuffer();

  // Create Vertex Array Objects (VAOs) for VAO isolation under WebGL 2
  if (gl.createVertexArray) {
    engine.heatmapVAO = gl.createVertexArray();
    gl.bindVertexArray(engine.heatmapVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, engine.heatmapGridBuffer);
    var heatUVLoc = gl.getAttribLocation(engine.heatmapProgram, 'a_grid_uv');
    if (heatUVLoc !== -1) {
      gl.enableVertexAttribArray(heatUVLoc);
      gl.vertexAttribPointer(heatUVLoc, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, engine.heatmapIndexBuffer);

    engine.advectVAO = gl.createVertexArray();
    gl.bindVertexArray(engine.advectVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, engine.quadBuffer);
    var advPosLoc = gl.getAttribLocation(engine.advectProgram, 'a_pos');
    if (advPosLoc !== -1) {
      gl.enableVertexAttribArray(advPosLoc);
      gl.vertexAttribPointer(advPosLoc, 2, gl.FLOAT, false, 0, 0);
    }

    engine.fadeVAO = gl.createVertexArray();
    gl.bindVertexArray(engine.fadeVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, engine.quadBuffer);
    var fadePosLoc = gl.getAttribLocation(engine.fadeProgram, 'a_pos');
    if (fadePosLoc !== -1) {
      gl.enableVertexAttribArray(fadePosLoc);
      gl.vertexAttribPointer(fadePosLoc, 2, gl.FLOAT, false, 0, 0);
    }

    engine.drawVAO = gl.createVertexArray();
    gl.bindVertexArray(engine.drawVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, engine.particleIndexBuffer);
    var idxLoc = gl.getAttribLocation(engine.drawProgram, 'a_index');
    if (idxLoc !== -1) {
      gl.enableVertexAttribArray(idxLoc);
      gl.vertexAttribPointer(idxLoc, 1, gl.FLOAT, false, 0, 0);
    }

    engine.screenVAO = gl.createVertexArray();
    gl.bindVertexArray(engine.screenVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, engine.quadBuffer);
    var scrLoc = gl.getAttribLocation(engine.screenProgram, 'a_pos');
    if (scrLoc !== -1) {
      gl.enableVertexAttribArray(scrLoc);
      gl.vertexAttribPointer(scrLoc, 2, gl.FLOAT, false, 0, 0);
    }

    gl.bindVertexArray(null);
  }

  engine._colorRamp = null;
  engine._currentTheme = null;
  engine._initialized = true;
  console.log('[WebGLWind] Initialized: ' + (engine.particleRes * engine.particleRes) + ' particles');
}

var deleteAttachedShaders = function(gl, prog) {
  if (!gl || !prog) return;
  try {
    var shaders = gl.getAttachedShaders(prog);
    if (shaders) {
      for (var i = 0; i < shaders.length; i++) {
        gl.detachShader(prog, shaders[i]);
        gl.deleteShader(shaders[i]);
      }
    }
  } catch (e) {}
  gl.deleteProgram(prog);
};

export function disposeEngine(engine, gl) {
  if (!gl) return;
  if (engine.heatmapVAO) { gl.deleteVertexArray(engine.heatmapVAO); engine.heatmapVAO = null; }
  if (engine.advectVAO) { gl.deleteVertexArray(engine.advectVAO); engine.advectVAO = null; }
  if (engine.fadeVAO) { gl.deleteVertexArray(engine.fadeVAO); engine.fadeVAO = null; }
  if (engine.drawVAO) { gl.deleteVertexArray(engine.drawVAO); engine.drawVAO = null; }
  if (engine.screenVAO) { gl.deleteVertexArray(engine.screenVAO); engine.screenVAO = null; }

  if (engine.advectProgram) deleteAttachedShaders(gl, engine.advectProgram);
  if (engine.drawProgram) deleteAttachedShaders(gl, engine.drawProgram);
  if (engine.screenProgram) deleteAttachedShaders(gl, engine.screenProgram);
  if (engine.fadeProgram) deleteAttachedShaders(gl, engine.fadeProgram);
  if (engine.heatmapProgram) deleteAttachedShaders(gl, engine.heatmapProgram);
  if (engine.quadBuffer) gl.deleteBuffer(engine.quadBuffer);
  if (engine.particleIndexBuffer) gl.deleteBuffer(engine.particleIndexBuffer);
  if (engine.heatmapGridBuffer) gl.deleteBuffer(engine.heatmapGridBuffer);
  if (engine.heatmapIndexBuffer) gl.deleteBuffer(engine.heatmapIndexBuffer);
  if (engine.advFBO) gl.deleteFramebuffer(engine.advFBO);
  if (engine.particleStateA) gl.deleteTexture(engine.particleStateA);
  if (engine.particleStateB) gl.deleteTexture(engine.particleStateB);
  if (engine._windData?.texture) gl.deleteTexture(engine._windData.texture);
  if (engine._colorRamp) gl.deleteTexture(engine._colorRamp);
  if (engine.screenA) { gl.deleteFramebuffer(engine.screenA.fbo); gl.deleteTexture(engine.screenA.tex); }
  if (engine.screenB) { gl.deleteFramebuffer(engine.screenB.fbo); gl.deleteTexture(engine.screenB.tex); }
  
  engine.advectProgram = null;
  engine.drawProgram = null;
  engine.screenProgram = null;
  engine.fadeProgram = null;
  engine.heatmapProgram = null;
  engine.quadBuffer = null;
  engine.particleIndexBuffer = null;
  engine.heatmapGridBuffer = null;
  engine.heatmapIndexBuffer = null;
  engine.advFBO = null;
  engine.particleStateA = null;
  engine.particleStateB = null;
  engine._windData = null;
  engine._colorRamp = null;
  engine.screenA = null;
  engine.screenB = null;
  engine._initialized = false;
  console.log('[WebGLWind] Disposed');
}
