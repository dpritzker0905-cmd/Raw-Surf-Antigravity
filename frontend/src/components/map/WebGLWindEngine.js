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
 * 5. Final composite: render trail texture to screen canvas
 */

import { generateRampData } from './WindColorRamp';
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
  createTexture,
  unbindTexture,
  logStepDetails,
  createFBO,
  bindTexture,
  encodeWindTexture,
  initParticleTexture
} from './WebGLWindUtils';

// --- Exported Constructor (var/function TDZ-immune) ---

function WebGLWindEngine() {
  // v3.13.4: Atmospheric transparency — continents must be clearly visible
  this.particleRes = 296; // 296² = 87,616 particles (~10% thinner than 330²)
  this.fadeOpacity = 0.965; // Faster trail decay — less cumulative opacity buildup
  this.speedFactor = 0.32;  // Tuned: good correlation with real wind speeds
  this.dropRate = 0.0015; // Particles live longer continuous streams
  this.dropRateBump = 0.006;
  this._initialized = false;
  this._windData = null;
  this._colorRamp = null; // v3.9.8: Color ramp LUT texture
  this._maxWindSpeed = 50; // knots: typical range 0-50kn for color ramp
  this._currentTheme = null; // Track theme for ramp updates

  // Diagnostic: expose wind engine for console verification
  if (typeof window !== 'undefined') {
    window.__WIND_ENGINE__ = this;
  }
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
  var heatVS = createShader(gl, gl.VERTEX_SHADER, HEATMAP_VS);
  var heatFS = createShader(gl, gl.FRAGMENT_SHADER, HEATMAP_FS);
  if (!advVS || !advFS || !drawVS || !drawFS || !screenVS || !screenFS || !heatVS || !heatFS) {
    console.error('[WebGLWind] Failed to compile shaders'); return;
  }
  this.advectProgram = createProgram(gl, advVS, advFS);
  this.drawProgram = createProgram(gl, drawVS, drawFS);
  this.screenProgram = createProgram(gl, screenVS, screenFS);
  this.fadeProgram = createProgram(gl, fadeVS, fadeFS);
  this.heatmapProgram = createProgram(gl, heatVS, heatFS);
  this.quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  var indices = new Float32Array(this.particleRes * this.particleRes);
  for (var i = 0; i < indices.length; i++) indices[i] = i;
  this.particleIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.particleIndexBuffer);
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
  this.heatmapGridBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.heatmapGridBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, gridUVs, gl.STATIC_DRAW);
  this.heatmapIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.heatmapIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gridIndices, gl.STATIC_DRAW);
  this.heatmapIndexCount = gridIndices.length;
  this.particleStateA = initParticleTexture(gl, this.particleRes);
  this.particleStateB = initParticleTexture(gl, this.particleRes);
  this.advFBO = gl.createFramebuffer();
  // v3.9.8: Create color ramp LUT texture (theme-aware)
  var rampData = generateRampData(this._maxWindSpeed, null, 'dark');
  this._colorRamp = createTexture(gl, gl.LINEAR, rampData, 256, 1);
  this._currentTheme = 'dark';
  this._initialized = true;
  console.log('[WebGLWind] Initialized: ' + (this.particleRes * this.particleRes) + ' particles');
};

WebGLWindEngine.prototype.setWindData = function(gl, windGrid) {
  if (!windGrid?.vectors?.length) return;
  if (this._windData?.texture) gl.deleteTexture(this._windData.texture);
  this._windData = encodeWindTexture(gl, windGrid);
};

WebGLWindEngine.prototype.render = function(gl, matrix, screenWidth, screenHeight, zoom, theme) {
  if (!this._initialized || !this._windData) return;
  // Update color ramp when theme changes
  if (theme && theme !== this._currentTheme) {
    this._currentTheme = theme;
    var rampData = generateRampData(this._maxWindSpeed, null, theme);
    if (this._colorRamp) gl.deleteTexture(this._colorRamp);
    this._colorRamp = createTexture(gl, gl.LINEAR, rampData, 256, 1);
    console.log('[WebGLWind] Color ramp updated for theme:', theme);
  }
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
  var prevBlendEqRGB = gl.getParameter(gl.BLEND_EQUATION_RGB);
  var prevBlendEqAlpha = gl.getParameter(gl.BLEND_EQUATION_ALPHA);

  var prevDepthTest = gl.getParameter(gl.DEPTH_TEST);
  var prevDepthWriteMask = gl.getParameter(gl.DEPTH_WRITEMASK);
  var prevStencilTest = gl.getParameter(gl.STENCIL_TEST);
  var prevScissorTest = gl.getParameter(gl.SCISSOR_TEST);
  var prevColorMask = gl.getParameter(gl.COLOR_WRITEMASK);
  var prevClearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE);

  var prevAttribsEnabled = [];
  var prevVAO = null;
  var isWebGL2 = !!gl.bindVertexArray;

  // Capture and unbind all texture units to prevent feedback loops with MapLibre's active drawing textures
  var prevTextures2D = [];
  var prevTexturesCube = [];
  var prevSamplers = [];

  try {
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
        var enabled = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED);
        prevAttribsEnabled.push(enabled);
        if (enabled) {
          gl.disableVertexAttribArray(i);
        }
      } catch (e) {
        prevAttribsEnabled.push(false);
      }
    }

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

    // Capture and unbind WebGL2 VAO to prevent MapLibre attribute pollution
    if (isWebGL2) {
      prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      gl.bindVertexArray(null);
    }

  var mat4 = matrix instanceof Float32Array ? matrix : new Float32Array(matrix);
  var themeVal = theme === 'light' ? 1.0 : (theme === 'beach' ? 2.0 : 0.0);

  // Compute scale-invariant advection step sizes
  const z = typeof zoom === 'number' ? zoom : 6;
  const baseScale = this.speedFactor * Math.pow(0.55, Math.max(0, z - 6)) * 0.05; // Normalizing 0.40 speedFactor to correct coordinate step sizes
  const bounds = this._windData.bounds;
  const isRegionalGrid = (bounds.east - bounds.west < 359.9);
  const edgeFeatherVal = isRegionalGrid ? 1.0 : 0.0;
  if (typeof window !== 'undefined') {
    window.__WIND_COVERAGE_STATUS__ = isRegionalGrid
      ? 'partial_regional_coverage'
      : 'full_coverage';
  }
  const crossesAntimeridian = bounds.west > bounds.east;
  const lngSpan = Math.max(0.01, crossesAntimeridian 
    ? (bounds.east + 360.0) - bounds.west 
    : bounds.east - bounds.west);
  const latSpan = Math.max(0.01, Math.abs(bounds.north - bounds.south));
  const speedScaleX = Math.max(1.0e-5, baseScale / lngSpan);
  const speedScaleY = Math.max(1.0e-5, baseScale / latSpan);

  if (this.frameCount === undefined) this.frameCount = 0;
  this.frameCount++;
  if (this.frameCount === 1) {
    console.log(`[WIND-TELEMETRY] Frame 1 | advection step = [${speedScaleX.toFixed(6)}, ${speedScaleY.toFixed(6)}] | bounds: [${this._windData.uMin[0].toFixed(1)},${this._windData.uMin[1].toFixed(1)}] to [${this._windData.uMax[0].toFixed(1)},${this._windData.uMax[1].toFixed(1)}] | ${this.particleRes * this.particleRes} particles`);
  }

  // Step 0: Draw live wind-speed heatmap from the same forecast grid used by particles.
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  gl.viewport(0, 0, screenWidth, screenHeight);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(this.heatmapProgram);
  gl.uniformMatrix4fv(gl.getUniformLocation(this.heatmapProgram, 'u_matrix'), false, mat4);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_min'), bounds.west, bounds.south);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_max'), bounds.east, bounds.north);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_wind'), 0);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_wind_min'), this._windData.uMin[0], this._windData.uMin[1]);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_wind_max'), this._windData.uMax[0], this._windData.uMax[1]);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_opacity'), 0.36);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_theme'), themeVal);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_edgeFeatherEnabled'), edgeFeatherVal);
  bindTexture(gl, this._windData.texture, 0);
  var heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
  var heatOffsetLoc = gl.getUniformLocation(this.heatmapProgram, 'u_lng_offset');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.heatmapGridBuffer);
  gl.enableVertexAttribArray(heatUVLoc);
  gl.vertexAttribPointer(heatUVLoc, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.heatmapIndexBuffer);
  var heatOffsets = z < 3.5 ? [0.0, -360.0, 360.0] : [0.0];
  for (var hi = 0; hi < heatOffsets.length; hi++) {
    gl.uniform1f(heatOffsetLoc, heatOffsets[hi]);
    gl.drawElements(gl.TRIANGLES, this.heatmapIndexCount, gl.UNSIGNED_SHORT, 0);
  }
  gl.disableVertexAttribArray(heatUVLoc);

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
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_edgeFeatherEnabled'), edgeFeatherVal);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_min'), bounds.west, bounds.south);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_max'), bounds.east, bounds.north);
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
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_edgeFeatherEnabled'), edgeFeatherVal);
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
  // v3.13.4: Reduced to 0.48 — continents must be clearly visible
  // beneath the wind layer. Wind should feel atmospheric, not solid fog.
  gl.uniform1f(gl.getUniformLocation(this.screenProgram, 'u_opacity'), 0.48);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  var err4 = gl.getError();
  if (err4 !== gl.NO_ERROR) {
    console.error("[WebGLWindEngine] Step 4 Draw Error:", err4);
  }
    gl.disableVertexAttribArray(scrLoc);
  } finally {
    if (gl && !gl.isContextLost()) {
      gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, prevElementArrayBuffer);
      if (isWebGL2 && gl.bindVertexArray) {
        gl.bindVertexArray(prevVAO);
      }

      if (this.advFBO && gl.isFramebuffer(this.advFBO)) {
        try {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        } catch (e) {}
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
      gl.useProgram(prevProg);
      if (prevViewport) {
        gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
      }
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

      for (var i = 0; i < prevAttribsEnabled.length; i++) {
        try {
          if (prevAttribsEnabled[i]) {
            gl.enableVertexAttribArray(i);
          } else {
            gl.disableVertexAttribArray(i);
          }
        } catch (e) {}
      }

      gl.activeTexture(prevActiveTex);
      
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

      if (prevClearColor) {
        gl.clearColor(prevClearColor[0], prevClearColor[1], prevClearColor[2], prevClearColor[3]);
      }
    }
  }
};

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

WebGLWindEngine.prototype.dispose = function(gl) {
  if (!gl) return;
  if (this.advectProgram) deleteAttachedShaders(gl, this.advectProgram);
  if (this.drawProgram) deleteAttachedShaders(gl, this.drawProgram);
  if (this.screenProgram) deleteAttachedShaders(gl, this.screenProgram);
  if (this.fadeProgram) deleteAttachedShaders(gl, this.fadeProgram);
  if (this.heatmapProgram) deleteAttachedShaders(gl, this.heatmapProgram);
  if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
  if (this.particleIndexBuffer) gl.deleteBuffer(this.particleIndexBuffer);
  if (this.heatmapGridBuffer) gl.deleteBuffer(this.heatmapGridBuffer);
  if (this.heatmapIndexBuffer) gl.deleteBuffer(this.heatmapIndexBuffer);
  if (this.advFBO) gl.deleteFramebuffer(this.advFBO);
  if (this.particleStateA) gl.deleteTexture(this.particleStateA);
  if (this.particleStateB) gl.deleteTexture(this.particleStateB);
  if (this._windData?.texture) gl.deleteTexture(this._windData.texture);
  if (this._colorRamp) gl.deleteTexture(this._colorRamp);
  if (this.screenA) { gl.deleteFramebuffer(this.screenA.fbo); gl.deleteTexture(this.screenA.tex); }
  if (this.screenB) { gl.deleteFramebuffer(this.screenB.fbo); gl.deleteTexture(this.screenB.tex); }
  
  this.advectProgram = null;
  this.drawProgram = null;
  this.screenProgram = null;
  this.fadeProgram = null;
  this.heatmapProgram = null;
  this.quadBuffer = null;
  this.particleIndexBuffer = null;
  this.heatmapGridBuffer = null;
  this.heatmapIndexBuffer = null;
  this.advFBO = null;
  this.particleStateA = null;
  this.particleStateB = null;
  this._windData = null;
  this._colorRamp = null;
  this.screenA = null;
  this.screenB = null;
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
