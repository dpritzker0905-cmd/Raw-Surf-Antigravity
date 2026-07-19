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
  createTexture,
  unbindTexture,
  createFBO,
  bindTexture,
  encodeWindTexture
} from './WebGLWindUtils';
import {
  initEngine,
  disposeEngine,
  reinitParticles
} from './WebGLWindEngineInit';
import { recordTruthStage } from './weatherTruthTracker';
import { captureWebGLState, restoreWebGLState } from './WebGLStateIsolation';

function latToMercatorY(lat) {
  var latClamped = Math.max(-85.051129, Math.min(85.051129, lat));
  var rad = latClamped * Math.PI / 180.0;
  return (1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0;
}

// WIND ANIM TUNING (2026-07-06, user request: "+~10% wind animation presence at z3.3-4.69" and
// "slower winds move slower, faster winds move faster"): motion was ALREADY linearly proportional
// to |wind| (webgl-wind lineage — offset ∝ decoded u/v); gamma > 1 adds perceptual CONTRAST by
// damping slow particles relative to fast ones (pow(speedNorm, gamma-1)); gamma 1.0 = exact linear.
// Levers: __RAW_WIND_LOWBAND_BIAS__ (0..1, default 0.012 ≈ +10% on-screen in-band),
// __RAW_WIND_SPEED_GAMMA__ (0.5..3, default 1.15), kill __RAW_DISABLE_WIND_SPEED_GAMMA__ → 1.0.
export function resolveWindAnimTuning(win) {
  const w = win || {};
  let lowBandBias = 0.012;
  if (typeof w.__RAW_WIND_LOWBAND_BIAS__ === 'number' && isFinite(w.__RAW_WIND_LOWBAND_BIAS__)) {
    lowBandBias = Math.max(0, Math.min(1, w.__RAW_WIND_LOWBAND_BIAS__));
  }
  let speedGamma = 1.15;
  if (typeof w.__RAW_WIND_SPEED_GAMMA__ === 'number' && isFinite(w.__RAW_WIND_SPEED_GAMMA__)) {
    speedGamma = Math.max(0.5, Math.min(3, w.__RAW_WIND_SPEED_GAMMA__));
  }
  if (w.__RAW_DISABLE_WIND_SPEED_GAMMA__ === true) speedGamma = 1.0;
  return { lowBandBias, speedGamma };
}

// --- Exported Constructor (var/function TDZ-immune) ---

function WebGLWindEngine() {
  // v3.13.4: Atmospheric transparency — continents must be clearly visible
  this.particleRes = 296; // 296² = 87,616 particles (~10% thinner than 330²)
  this.fadeOpacity = 0.965; // Faster trail decay — less cumulative opacity buildup
  this.speedFactor = 0.55;  // v3.19: Increased from 0.35 for faster, more dynamic glide and visible flow
  this.dropRate = 0.002; // v3.15: Between original 0.0015 and aggressive 0.003
  this.dropRateBump = 0.008; // v3.15: Between original 0.006 and aggressive 0.01
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
  initEngine(this, gl);
};

WebGLWindEngine.prototype.setWindData = function(gl, windGrid) {
  if (!windGrid?.vectors?.length) return;
  if (this._windData?.texture) gl.deleteTexture(this._windData.texture);
  this._windData = encodeWindTexture(gl, windGrid);
  if (this._windData) {
    this._windData.truthTag = windGrid.truthTag;
    this._windData.windGrid = windGrid;

    // v3.16: Update _maxWindSpeed from actual GFS data, with sane bounds
    // Floor of 10kn prevents all-calm grids from blowing up the ramp
    // Ceiling of 80kn keeps hurricane-force winds from washing out variation
    var dataMaxSpeed = this._windData.maxSpeed || 50;
    var newMaxSpeed = Math.max(10, Math.min(dataMaxSpeed, 80));
    if (newMaxSpeed !== this._maxWindSpeed) {
      console.log('[WebGLWind] maxWindSpeed updated: ' + this._maxWindSpeed + ' -> ' + newMaxSpeed + ' kn (data max: ' + dataMaxSpeed + ')');
      this._maxWindSpeed = newMaxSpeed;
      // Force color ramp regeneration on next render by clearing cached ramp
      if (this._colorRamp) {
        gl.deleteTexture(this._colorRamp);
        this._colorRamp = null;
      }
    }
  }

  const model = windGrid.truthTag?.model || 'GFS';
  const layer = windGrid.truthTag?.layer || 'wind';
  const hourOffset = windGrid.hourOffset || 0;

  if (hourOffset === 0) {
    recordTruthStage('webglUpload', {
      model,
      domain: 'wind',
      layer,
      valid_time: windGrid.valid_time || windGrid.validTime,
      run_time: windGrid.run_time || windGrid.runTime,
      product_id: windGrid.productId || windGrid.product_id,
      is_dynamic_viewport_product: windGrid.is_dynamic_viewport_product,
      coverage_scope: windGrid.coverage_scope,
      requested_bbox: windGrid.requested_bbox,
      served_bbox: windGrid.served_bbox,
      maxWindSpeed: this._maxWindSpeed,
      grid: windGrid,
      truthTag: windGrid.truthTag
    }, 'WebGLWindEngine.js', 'setWindData');
  }
};

WebGLWindEngine.prototype.render = function(gl, matrix, screenWidth, screenHeight, zoom, theme, worldOffsets, viewportBounds) {
  if (!this._initialized || !this._windData) return;

  const windGrid = this._windData?.windGrid;
  if (windGrid) {
    const model = windGrid.truthTag?.model || 'GFS';
    const layer = windGrid.truthTag?.layer || 'wind';
    const hourOffset = windGrid.hourOffset || 0;

    if (hourOffset === 0) {
      recordTruthStage('webglRender', {
        model,
        domain: 'wind',
        layer,
        valid_time: windGrid.valid_time || windGrid.validTime,
        run_time: windGrid.run_time || windGrid.runTime,
        product_id: windGrid.productId || windGrid.product_id,
        is_dynamic_viewport_product: windGrid.is_dynamic_viewport_product,
        coverage_scope: windGrid.coverage_scope,
        requested_bbox: windGrid.requested_bbox,
        served_bbox: windGrid.served_bbox,
        grid: windGrid,
        truthTag: this._windData.truthTag
      }, 'WebGLWindEngine.js', 'render');

      recordTruthStage('animationFrame', {
        model,
        domain: 'wind',
        layer,
        valid_time: windGrid.valid_time || windGrid.validTime,
        run_time: windGrid.run_time || windGrid.runTime,
        product_id: windGrid.productId || windGrid.product_id,
        is_dynamic_viewport_product: windGrid.is_dynamic_viewport_product,
        coverage_scope: windGrid.coverage_scope,
        requested_bbox: windGrid.requested_bbox,
        served_bbox: windGrid.served_bbox,
        grid: windGrid,
        truthTag: this._windData.truthTag
      }, 'WebGLWindEngine.js', 'render');
    }
  }
  // Update color ramp when theme changes or if texture is not yet created
  // v3.15: Use _currentTheme (set by setTheme) as fallback when theme param not passed
  var activeTheme = theme || this._currentTheme || 'dark';
  if (activeTheme !== this._currentTheme || !this._colorRamp) {
    this._currentTheme = activeTheme;
    var rampData = generateRampData(this._maxWindSpeed, null, activeTheme);
    if (this._colorRamp) gl.deleteTexture(this._colorRamp);
    this._colorRamp = createTexture(gl, gl.LINEAR, rampData, 256, 1);
    console.log('[WebGLWind] Color ramp updated for theme:', activeTheme);
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

  // v3.15: Clear trail FBOs during genuine zoom transitions only.
  // Track camera center to distinguish zoom from pan (pan causes micro zoom jitter).
  var currentZoom = typeof zoom === 'number' ? zoom : 6;
  if (this._lastRenderZoom !== undefined) {
    var zoomDelta = Math.abs(currentZoom - this._lastRenderZoom);
    // v3.15: Only clear on genuine zoom changes (> 0.15), not pan-induced float jitter.
    // During panning, mapbox can report sub-0.01 zoom fluctuations that falsely trigger
    // trail clears, causing the "grid flash" artifact.
    if (zoomDelta > 0.15) {
      // Additional guard: accumulate zoom delta across frames to filter jitter
      this._zoomDeltaAccum = (this._zoomDeltaAccum || 0) + zoomDelta;
      if (this._zoomDeltaAccum > 0.25) {
        // Genuine zoom change — clear trail buffers
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenA.fbo);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenB.fbo);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this._zoomDeltaAccum = 0;
      }
    } else {
      // Small delta — likely pan jitter, decay accumulator
      this._zoomDeltaAccum = Math.max(0, (this._zoomDeltaAccum || 0) - 0.02);
    }
  }
  this._lastRenderZoom = currentZoom;
  const webglState = captureWebGLState(gl);
  try {
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);

    // Unbind only the texture units we actually use (0 to 3) to prevent feedback loops (non-blocking)
    for (let u = 0; u < 4; u++) {
      bindTexture(gl, null, u);
    }

    // Unbind WebGL2 VAO
    if (webglState.isWebGL2) {
      gl.bindVertexArray(null);
    }

  var mat4 = matrix instanceof Float32Array ? matrix : new Float32Array(matrix);
  // v3.15: Use _currentTheme when theme param not passed (standalone overlay path)
  var effectiveTheme = theme || this._currentTheme || 'dark';
  var themeVal = effectiveTheme === 'light' ? 1.0 : (effectiveTheme === 'beach' ? 2.0 : 0.0);

  // Compute scale-invariant advection step sizes
  const z = typeof zoom === 'number' ? zoom : 6;
  const bounds = this._windData.bounds;
  const windGrid = this._windData.windGrid;
  const crosses = bounds.west > bounds.east;
  const lngSpan = crosses ? (bounds.east + 360.0) - bounds.west : bounds.east - bounds.west;
  const isGlobal = (lngSpan >= 350.0) || windGrid?.coverage_scope === 'global' || windGrid?.coverage_scope === 'global_coarse';
  const isRegionalGrid = !isGlobal;
  const edgeFeatherVal = isRegionalGrid ? 1.0 : 0.0;
  if (typeof window !== 'undefined') {
    window.__WIND_COVERAGE_STATUS__ = isRegionalGrid
      ? 'partial_regional_coverage'
      : 'full_coverage';
  }

  const dataBoundsMinX = isRegionalGrid ? bounds.west : -180.0;
  const dataBoundsMaxX = isRegionalGrid ? bounds.east : 180.0;

  // v3.23: Disable the minimum advection step clamp at high zooms (z > 6) since
  // we use tile-relative coordinates. This prevents the wind animation from
  // exploding in speed. Also, we scale the tile coordinate size to increase precision.
  const stableSpeedScale = (z > 6.0)
    ? (this.speedFactor * Math.pow(0.5, z) * 0.00025)
    : Math.max(2.5e-6, this.speedFactor * Math.pow(0.5, z) * 0.00025);

  // v3.22: Compute camera center and tile origin for high-precision advection
  var vb = viewportBounds || [-180, -80, 180, 85];
  var centerLng = (vb[0] + vb[2]) * 0.5;
  if (vb[2] < vb[0]) {
    centerLng = (vb[0] + vb[2] + 360) * 0.5;
    if (centerLng > 180) centerLng -= 360;
  }
  var centerLat = (vb[1] + vb[3]) * 0.5;
  var cx = (centerLng + 180.0) / 360.0;
  var cy = latToMercatorY(centerLat);

  var isHighZoom = z > 6.0;
  var prevHighZoom = this._lastZoom > 6.0;
  var zoomStateChanged = (this._lastZoom !== undefined && isHighZoom !== prevHighZoom);
  this._lastZoom = z;

  var tileOriginX = 0.0;
  var tileOriginY = 0.0;
  var tileWidth = 1.0;

  if (isHighZoom) {
    // v3.23: Use -3 instead of -5 so the tile is 8x larger than the screen instead of 32x.
    // This increases tile-relative coordinate precision, preventing particles from freezing
    // at low wind speeds.
    var tileZoom = Math.max(0, Math.floor(z) - 3);
    tileWidth = 1.0 / Math.pow(2.0, tileZoom);

    // Initialize or drift check
    if (this._tileCenterX === undefined || this._tileCenterY === undefined) {
      this._tileCenterX = cx;
      this._tileCenterY = cy;
      this.reinitParticles(gl, { keepTrails: true });
    } else {
      var dx = cx - this._tileCenterX;
      var dy = cy - this._tileCenterY;
      // Re-initialize particles when camera center drifts by more than 25% of the tile width
      if (Math.abs(dx) > tileWidth * 0.25 || Math.abs(dy) > tileWidth * 0.25) {
        this._tileCenterX = cx;
        this._tileCenterY = cy;
        this.reinitParticles(gl, { keepTrails: true });
      }
    }
    tileOriginX = this._tileCenterX - tileWidth * 0.5;
    tileOriginY = this._tileCenterY - tileWidth * 0.5;
  } else {
    this._tileCenterX = undefined;
    this._tileCenterY = undefined;
  }

  if (zoomStateChanged) {
    this.reinitParticles(gl, { keepTrails: true });
  }

  if (this.frameCount === undefined) this.frameCount = 0;
  this.frameCount++;
  if (this.frameCount === 1) {
    // NOTE uMin/uMax are the u/v WIND-COMPONENT encoding ranges, NOT geographic bounds — the old
    // "bounds:" label sent two forensic passes hunting a phantom equatorial clamp (2026-07-10).
    console.log(`[WIND-TELEMETRY] Frame 1 | advection step = ${stableSpeedScale.toFixed(8)} | u/v range: [${this._windData.uMin[0].toFixed(1)},${this._windData.uMin[1].toFixed(1)}] to [${this._windData.uMax[0].toFixed(1)},${this._windData.uMax[1].toFixed(1)}] | maxSpeed: ${this._maxWindSpeed} kn | ${this.particleRes * this.particleRes} particles`);
  }

  // Step 0: Draw live wind-speed heatmap from the same forecast grid used by particles.
  gl.bindFramebuffer(gl.FRAMEBUFFER, webglState.prevFBO);
  gl.viewport(0, 0, screenWidth, screenHeight);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(this.heatmapProgram);
  gl.uniformMatrix4fv(gl.getUniformLocation(this.heatmapProgram, 'u_matrix'), false, mat4);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_min'), dataBoundsMinX, bounds.south);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_max'), dataBoundsMaxX, bounds.north);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_wind'), 0);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_wind_min'), this._windData.uMin[0], this._windData.uMin[1]);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_wind_max'), this._windData.uMax[0], this._windData.uMax[1]);
  // v3.20: Theme-dynamic heatmap opacity for premium look per theme (increased contrast: light=0.65, beach=0.55, dark=0.48)
  var heatmapOpacity = effectiveTheme === 'dark' ? 0.48 : (effectiveTheme === 'light' ? 0.65 : 0.55);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_opacity'), heatmapOpacity);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_theme'), themeVal);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_max_speed'), this._maxWindSpeed);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_edgeFeatherEnabled'), edgeFeatherVal);

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
  bindTexture(gl, this._windData.texture, 0);
    var heatOffsetLoc = gl.getUniformLocation(this.heatmapProgram, 'u_lng_offset');
    if (this.heatmapVAO) {
      gl.bindVertexArray(this.heatmapVAO);
    } else {
      var heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.heatmapGridBuffer);
      gl.enableVertexAttribArray(heatUVLoc);
      gl.vertexAttribPointer(heatUVLoc, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.heatmapIndexBuffer);
    }
    var heatOffsets = worldOffsets || (z < 3.5 ? [0.0, -360.0, 360.0] : [0.0]);
    for (var hi = 0; hi < heatOffsets.length; hi++) {
      gl.uniform1f(heatOffsetLoc, heatOffsets[hi]);
      gl.drawElements(gl.TRIANGLES, this.heatmapIndexCount, gl.UNSIGNED_SHORT, 0);
    }
    if (this.heatmapVAO) {
      gl.bindVertexArray(null);
    } else {
      var heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
      if (heatUVLoc !== -1) gl.disableVertexAttribArray(heatUVLoc);
    }

  // Step 1: Advect particles (ping-pong)
  gl.disable(gl.BLEND); // CRITICAL: Disable blend to prevent position texture corruption!
  gl.useProgram(this.advectProgram);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_particles'), 0);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_wind'), 1);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_wind_min'), this._windData.uMin[0], this._windData.uMin[1]);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_wind_max'), this._windData.uMax[0], this._windData.uMax[1]);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_wind_res'), 1, 1);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speed_scale'), stableSpeedScale);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_rand_seed'), Math.random());
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate'), this.dropRate);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate_bump'), this.dropRateBump);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_edgeFeatherEnabled'), edgeFeatherVal);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_min'), dataBoundsMinX, bounds.south);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_max'), dataBoundsMaxX, bounds.north);
  // v3.16: Pass zoom and viewport bounds for viewport-biased respawning
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_zoom'), z);
  gl.uniform4f(gl.getUniformLocation(this.advectProgram, 'u_viewport_bounds'), vb[0], vb[1], vb[2], vb[3]);
  // v3.22: Bind tile origin and width for high zoom precision
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_tile_origin'), tileOriginX, tileOriginY);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_tile_width'), tileWidth);
  // 2026-07-06 wind anim tuning: low-band density floor + speed-contrast gamma (levers in
  // resolveWindAnimTuning; physics stays linearly speed-proportional at gamma 1.0).
  const _windTune = resolveWindAnimTuning(typeof window !== 'undefined' ? window : null);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_lowband_bias'), _windTune.lowBandBias);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speed_gamma'), _windTune.speedGamma);
  const _speedMax = Math.max(1, Math.hypot(this._windData.uMax[0] || 0, this._windData.uMax[1] || 0));
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speed_max'), _speedMax);
  unbindTexture(gl, this.particleStateB);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.particleStateB, 0);
  gl.viewport(0, 0, this.particleRes, this.particleRes);
  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._windData.texture, 1);
  if (this.advectVAO) {
    gl.bindVertexArray(this.advectVAO);
  } else {
    var advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(advPosLoc);
    gl.vertexAttribPointer(advPosLoc, 2, gl.FLOAT, false, 0, 0);
  }

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  if (this.advectVAO) {
    gl.bindVertexArray(null);
  } else {
    var advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
    if (advPosLoc !== -1) gl.disableVertexAttribArray(advPosLoc);
  }
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
  if (this.fadeVAO) {
    gl.bindVertexArray(this.fadeVAO);
  } else {
    var fadePosLoc = gl.getAttribLocation(this.fadeProgram, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(fadePosLoc);
    gl.vertexAttribPointer(fadePosLoc, 2, gl.FLOAT, false, 0, 0);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  if (this.fadeVAO) {
    gl.bindVertexArray(null);
  } else {
    var fadePosLoc = gl.getAttribLocation(this.fadeProgram, 'a_pos');
    if (fadePosLoc !== -1) gl.disableVertexAttribArray(fadePosLoc);
  }

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
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_min'), dataBoundsMinX, bnd.south);
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_max'), dataBoundsMaxX, bnd.north);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_zoom'), z); // v3.13.5: close-zoom density boost
  // THEME PARITY FIX (2026-07-18 EVE-3): the particle program was the ONE wind program that never
  // received the theme — `u_theme` was bound to heatmapProgram only (L351), so the wind FIELD was
  // theme-aware while the wind PARTICLES were not. Their separation rim/core were therefore tuned
  // against dark and inverted in light mode. See DRAW_FS for the full reasoning.
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_theme'), themeVal);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_theme_rim'),
    (typeof window !== 'undefined' && window.__RAW_DISABLE_THEMED_PARTICLE_RIM__ === true) ? 0.0 : 1.0);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_lowwind_boost'),
    (typeof window !== 'undefined' && window.__RAW_DISABLE_LOWWIND_LEGIBILITY__ === true) ? 0.0 : 1.0);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_edgeFeatherEnabled'), edgeFeatherVal);
  // v3.22: Bind tile origin and width for high zoom precision
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_tile_origin'), tileOriginX, tileOriginY);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_tile_width'), tileWidth);

  let drawDebugModeVal = 0.0;
  if (typeof window !== 'undefined' && window.__GPU_DEBUG__) {
    const mode = window.__GPU_DEBUG__.mode;
    if (mode === 'part_uv') drawDebugModeVal = 5.0;
    else if (mode === 'part_pos') drawDebugModeVal = 6.0;
    else if (mode === 'part_offset') drawDebugModeVal = 7.0;
    else if (mode === 'part_fbo') drawDebugModeVal = 8.0;
  }
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_debug_mode'), drawDebugModeVal);
  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._windData.texture, 1);
  if (this._colorRamp) bindTexture(gl, this._colorRamp, 2);
  var lngOffsetLoc = gl.getUniformLocation(this.drawProgram, 'u_lng_offset');
  if (this.drawVAO) {
    gl.bindVertexArray(this.drawVAO);
  } else {
    var idxLoc = gl.getAttribLocation(this.drawProgram, 'a_index');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleIndexBuffer);
    gl.enableVertexAttribArray(idxLoc);
    gl.vertexAttribPointer(idxLoc, 1, gl.FLOAT, false, 0, 0);
  }

  // v3.13: Draw particles for multiple world copies to fill the entire viewport at low zoom.
  // At zoom < 3, the map shows more than 360° of longitude, so we need 3 copies.
  // At higher zoom, a single copy at offset 0 is sufficient.
  var actualWorldOffsets = worldOffsets || (z < 3.5 ? [0.0, -360.0, 360.0] : [0.0]);
  for (var wi = 0; wi < actualWorldOffsets.length; wi++) {
    gl.uniform1f(lngOffsetLoc, actualWorldOffsets[wi]);
    gl.drawArrays(gl.POINTS, 0, this.particleRes * this.particleRes);
  }

  if (this.drawVAO) {
    gl.bindVertexArray(null);
  } else {
    var idxLoc = gl.getAttribLocation(this.drawProgram, 'a_index');
    if (idxLoc !== -1) gl.disableVertexAttribArray(idxLoc);
  }

  // Copy screenB screenA
  gl.useProgram(this.screenProgram);
  unbindTexture(gl, this.screenA.tex);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenA.fbo);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1i(gl.getUniformLocation(this.screenProgram, 'u_screen'), 0);
  gl.uniform1f(gl.getUniformLocation(this.screenProgram, 'u_opacity'), 1.0);
  bindTexture(gl, this.screenB.tex, 0);
  if (this.screenVAO) {
    gl.bindVertexArray(this.screenVAO);
  } else {
    var cpLoc = gl.getAttribLocation(this.screenProgram, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(cpLoc);
    gl.vertexAttribPointer(cpLoc, 2, gl.FLOAT, false, 0, 0);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  if (this.screenVAO) {
    gl.bindVertexArray(null);
  } else {
    var cpLoc = gl.getAttribLocation(this.screenProgram, 'a_pos');
    if (cpLoc !== -1) gl.disableVertexAttribArray(cpLoc);
  }

  // Step 4: Composite to main framebuffer
  // v3.12.2: Standard alpha blend screen shader derives alpha from trail brightness.
  // RGB-fade FBO has alpha=1.0, but screen shader outputs brightness-derived alpha.
  gl.useProgram(this.screenProgram);
  gl.bindFramebuffer(gl.FRAMEBUFFER, webglState.prevFBO);
  gl.viewport(0, 0, screenWidth, screenHeight);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  bindTexture(gl, this.screenB.tex, 0);
  if (this.screenVAO) {
    gl.bindVertexArray(this.screenVAO);
  } else {
    var scrLoc = gl.getAttribLocation(this.screenProgram, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(scrLoc);
    gl.vertexAttribPointer(scrLoc, 2, gl.FLOAT, false, 0, 0);
  }
  // v3.13.4: Reduced to 0.48 — continents must be clearly visible
  // beneath the wind layer. Wind should feel atmospheric, not solid fog.
  // v3.24: Surgically increase opacity by 2.5% (+0.025 absolute) in mid-lower zooms (4.0 <= z <= 9.0)
  // to improve contrast over map features like state names and major highways.
  var finalOpacity = 0.48;
  if (z >= 4.0 && z <= 9.0) {
    finalOpacity = 0.505;
  }
  gl.uniform1f(gl.getUniformLocation(this.screenProgram, 'u_opacity'), finalOpacity);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  if (this.screenVAO) {
    gl.bindVertexArray(null);
  } else {
    var scrLoc = gl.getAttribLocation(this.screenProgram, 'a_pos');
    if (scrLoc !== -1) gl.disableVertexAttribArray(scrLoc);
  }
  } finally {
    if (gl && !gl.isContextLost() && webglState) {
      if (this.advFBO && gl.isFramebuffer(this.advFBO)) {
        try {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
          if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === this.advFBO) {
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
          }
        } catch (e) {}
      }
      restoreWebGLState(gl, webglState);
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
  disposeEngine(this, gl);
};
/**
 * v3.11.2r1: Clear all framebuffers called on layer deactivation
 * to prevent stale trails from persisting across layer switches.
 */
WebGLWindEngine.prototype.clearBuffers = function(gl) {
  if (!gl || !this._initialized || !this.screenA || !this.screenB) return;
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

WebGLWindEngine.prototype.reinitParticles = function(gl, opts) {
  reinitParticles(this, gl, opts);
};

/**
 * v3.15: setTheme — update color ramp texture when theme changes.
 * Public engine API; no live callers since the WebGLSynchronizedOverlay removal (2026-07-10).
 */
WebGLWindEngine.prototype.setTheme = function(gl, theme) {
  if (!gl || !this._initialized) return;
  var activeTheme = theme || 'dark';
  if (activeTheme !== this._currentTheme || !this._colorRamp) {
    this._currentTheme = activeTheme;
    var rampData = generateRampData(this._maxWindSpeed, null, activeTheme);
    if (this._colorRamp) gl.deleteTexture(this._colorRamp);
    this._colorRamp = createTexture(gl, gl.LINEAR, rampData, 256, 1);
    console.log('[WebGLWind] Theme set to:', activeTheme);
  }
};

/**
 * v3.15: renderHeatmapAndParticles — alias for render() (matches WebGLMarineEngine API).
 * Public engine API; no live callers since the WebGLSynchronizedOverlay removal (2026-07-10).
 */
WebGLWindEngine.prototype.renderHeatmapAndParticles = WebGLWindEngine.prototype.render;
