/**
 * WebGLMarineEngine.js
 * Ocean GPU v2 — Fully GPU-native, raster-free marine rendering engine.
 * Renders pulsing, perpendicular wave fronts using gl.drawArrays(gl.LINES)
 * overlayed on a smooth, continuous GPU wave height heatmap.
 * Strictly conforms to WebGL State Isolation Protocol and is < 600 lines of code.
 */

import { recordTruthStage } from './weatherTruthTracker';
import { captureWebGLState, restoreWebGLState } from './WebGLStateIsolation';

import {
  createShader,
  createProgram,
  bindTexture,
  unbindTexture,
  safeDeleteTexture
} from './WebGLWindUtils';
import {
  createTexture,
  encodeMarineTexture
} from './WebGLMarineTextureEncoder';

import { populateCrestDiagnostics } from './WebGLMarineEngineDiagnostics';
import {
  reinitParticles,
  reseedParticleStateInPlace,
  initEngine,
  disposeEngine
} from './WebGLMarineEngineInit';

function latToMercatorY(lat) {
  const latClamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const rad = (latClamped * Math.PI) / 180.0;
  return (1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0;
}

// Zoom-based base heatmap opacity ladder (shared by the main heatmap pass and the BLEND-BOTH coarse base wash).
function heatmapZoomOpacity(z) {
  if (z <= 2) return 0.55;
  if (z <= 5) return 0.55 + (z - 2) / 3 * 0.10;
  if (z <= 8) return 0.65 + (z - 5) / 3 * 0.10;
  if (z <= 12) return 0.75 + (z - 8) / 4 * 0.05;
  return 0.85;
}

// Longitude span of a grid's bounds in degrees (antimeridian-safe).
function boundsLonSpan(b) {
  if (!b || typeof b.west !== 'number' || typeof b.east !== 'number') return 0;
  return (b.east < b.west) ? (b.east + 360 - b.west) : (b.east - b.west);
}

// A regional tile covers a sub-global longitude span (< 359°). The coarse-global fallback spans the whole world.
function isRegionalBounds(b) {
  const span = boundsLonSpan(b);
  return span > 0 && span < 359.0;
}

// The coarse-global fallback: spans the world AND has large (~10°) cells. A hypothetical full-width FINE grid
// (cellDeg < 1°) is NOT a coarse base — mirrors the cellDeg>1° gate used by the close-zoom coarse-fade.
function isCoarseGlobalGrid(waveGrid) {
  const b = waveGrid && waveGrid.bounds;
  const cols = waveGrid && waveGrid.cols;
  if (!b || !cols) return false;
  const span = boundsLonSpan(b);
  if (span < 359.0) return false;
  return (span / cols) > 1.0;
}

// Identity of a captured coarse base so we re-encode only when the underlying coarse grid actually changes.
function coarseBaseKey(waveGrid) {
  const b = (waveGrid && waveGrid.bounds) || {};
  return [
    waveGrid && waveGrid.__sourceModel || 'GFS',
    waveGrid && waveGrid.__componentLayer || 'waves',
    waveGrid && waveGrid.cols, waveGrid && waveGrid.rows,
    b.west, b.south, b.east, b.north,
    waveGrid && waveGrid.hourOffset || 0
  ].join('|');
}

// --- Engine Definition ---

function WebGLMarineEngine() {
  this.particleRes = 296;       // 296² = 87,616 crests
  this.speedFactor = 0.05;      // drift speed scale
  this.dropRate = 0.003;        // particle drop rate
  this._initialized = false;
  this._waveData = null;
  this._startTime = Date.now();
  this._fboSupported = true;

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
  initEngine(this, gl);
};

WebGLMarineEngine.prototype.reinitParticles = function(gl) {
  reinitParticles(this, gl);
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

  console.log('[WebGLMarineEngine] setWaveData input:', {vectors: waveGrid.vectors.length, cols: waveGrid.cols, rows: waveGrid.rows, hasBounds: !!waveGrid.bounds, hasGeoJSON: !!activeGeoJSON});
  
  let newWaveData;
  try {
    newWaveData = encodeMarineTexture(gl, waveGrid, activeGeoJSON, this);
  } catch (err) {
    console.error('[WebGLMarineEngine] encodeMarineTexture threw an error:', err);
    this.clearBuffers(gl);
    throw err;
  }

  if (newWaveData) {
    newWaveData.truthTag = waveGrid.truthTag;
    newWaveData.waveGrid = waveGrid;
  }

  const oldWaveData = this._waveData;
  this._waveData = newWaveData;

  // Compare old grid dimensions/bounds to check if they shifted
  const oldGrid = oldWaveData?.waveGrid;
  const boundsChanged = !oldGrid || !oldGrid.bounds || !waveGrid.bounds ||
    waveGrid.bounds.west !== oldGrid.bounds.west ||
    waveGrid.bounds.south !== oldGrid.bounds.south ||
    waveGrid.bounds.east !== oldGrid.bounds.east ||
    waveGrid.bounds.north !== oldGrid.bounds.north;
  const dimsChanged = !oldGrid ||
    waveGrid.cols !== oldGrid.cols ||
    waveGrid.rows !== oldGrid.rows;

  if (boundsChanged || dimsChanged) {
    console.log('[WebGLMarineEngine] Resetting particle state textures due to grid shift/resize:', {
      boundsChanged,
      dimsChanged,
      oldCols: oldGrid?.cols,
      newCols: waveGrid.cols,
      oldRows: oldGrid?.rows,
      newRows: waveGrid.rows
    });
    // Phase 1.3: record reset reason + source product so real product changes can be
    // distinguished from redundant commits before optimizing. Diagnostics only.
    if (typeof window !== 'undefined') {
      const reason = (boundsChanged && dimsChanged) ? 'both' : boundsChanged ? 'bounds' : 'dimensions';
      const rd = window.__MARINE_GPU_RESET__ || (window.__MARINE_GPU_RESET__ = { counts: {}, log: [] });
      rd.counts[reason] = (rd.counts[reason] || 0) + 1;
      rd.log.unshift({
        reason,
        oldCols: oldGrid?.cols, newCols: waveGrid.cols,
        oldRows: oldGrid?.rows, newRows: waveGrid.rows,
        productId: waveGrid.productId || waveGrid.__productId || null,
        timestamp: new Date().toISOString()
      });
      if (rd.log.length > 40) rd.log.pop();
    }
    // Reseed the FIXED-size particle textures in place (texSubImage2D) instead of
    // delete+realloc — eliminates per-switch GPU texture churn during rapid toggling.
    reseedParticleStateInPlace(this, gl);
  }

  if (oldWaveData) {
    try {
      if (oldWaveData.u_waveTexture && oldWaveData.u_waveTexture !== this._residentWaveTex && (!newWaveData || oldWaveData.u_waveTexture !== newWaveData.u_waveTexture)) {
        safeDeleteTexture(gl, oldWaveData.u_waveTexture, this);
      }
      if (oldWaveData.u_chlorophyllTexture && oldWaveData.u_chlorophyllTexture !== this._residentChlTex && (!newWaveData || oldWaveData.u_chlorophyllTexture !== newWaveData.u_chlorophyllTexture)) {
        safeDeleteTexture(gl, oldWaveData.u_chlorophyllTexture, this);
      }
      if (oldWaveData.u_bathymetryTexture && oldWaveData.u_bathymetryTexture !== this._residentBathTex && (!newWaveData || oldWaveData.u_bathymetryTexture !== newWaveData.u_bathymetryTexture)) {
        safeDeleteTexture(gl, oldWaveData.u_bathymetryTexture, this);
      }
      
      if (oldWaveData.u_oceanMaskTexture && oldWaveData.u_oceanMaskTexture === this._cachedMaskTex) {
        // Keep it
      } else {
        if (oldWaveData.u_oceanMaskTexture && (!newWaveData || oldWaveData.u_oceanMaskTexture !== newWaveData.u_oceanMaskTexture)) {
          safeDeleteTexture(gl, oldWaveData.u_oceanMaskTexture, this);
        }
      }
    } catch (e) {
      console.warn('[WebGLMarineEngine] Error during safe deletion of old textures:', e);
    }
  }

  // BLEND BOTH: whenever the committed grid is the GLOBAL-COARSE fallback, snapshot it into a standalone,
  // independently-owned texture set (the resident wave/chl/bath textures get reused/realloc'd in place on the
  // next commit, so the old coarse textures can't simply be "retained"). A later regional commit then composites
  // over this faded base instead of reading as a cleared heatmap. Re-encode only when the coarse grid changes.
  try {
    const blendEnabled = (typeof window === 'undefined') || window.__RAW_DISABLE_BLEND_BOTH__ !== true;
    if (blendEnabled && newWaveData && isCoarseGlobalGrid(waveGrid)) {
      const key = coarseBaseKey(waveGrid);
      if (!this._coarseBaseData || this._coarseBaseData.__key !== key) {
        this._captureCoarseBase(gl, waveGrid, key);
      }
    }
  } catch (e) {
    console.warn('[WebGLMarineEngine] coarse-base capture skipped:', e && e.message);
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

WebGLMarineEngine.prototype.renderHeatmapAndParticles = function(gl, matrix, screenWidth, screenHeight, zoom, theme, viewportBounds, opacityMultiplier) {
  const mult = typeof opacityMultiplier === 'number' ? opacityMultiplier : 1.0;
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

  const webglState = captureWebGLState(gl);
  try {
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.blendEquation(gl.FUNC_ADD);

    if (window.__WEATHER_DEBUG_ISOLATE_OVERLAY__ === true) {
      gl.clearColor(0.05, 0.05, 0.08, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // Unbind only the texture units we actually use (0 to 3) to prevent feedback loops (non-blocking)
    for (let u = 0; u < 4; u++) {
      bindTexture(gl, null, u);
    }

    if (webglState.isWebGL2) {
      gl.bindVertexArray(null);
    }

    var mat4 = matrix instanceof Float32Array ? matrix : new Float32Array(matrix);
    var time = (Date.now() - this._startTime) / 1000.0;
    const waveBounds = this._waveData.bounds;
    const z = typeof zoom === 'number' ? zoom : 6;

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

    // Zoom above which particles use the camera-centered TILE (concentrated → adequate on-screen density). Below
    // it they seed across the whole data domain (global = sparse in any viewport), which caused the dense→sparse
    // CLIFF at z6 when zooming out. Lowered to 4.0 so the concentrated mode (and the constant-screen-density below)
    // covers the regional zoom-out range; tunable via window.__RAW_TILE_ZOOM_MIN__. Must match u_tileZoomMin.
    var tileZoomMin = (typeof window !== 'undefined' && typeof window.__RAW_TILE_ZOOM_MIN__ === 'number') ? window.__RAW_TILE_ZOOM_MIN__ : 4.0;
    var isHighZoom = z > tileZoomMin;
    var prevHighZoom = this._lastZoom > 6.0;
    var zoomStateChanged = (this._lastZoom !== undefined && isHighZoom !== prevHighZoom);
    this._lastZoom = z;

    var tileOriginX = 0.0;
    var tileOriginY = 0.0;
    var tileWidth = 1.0;

    if (isHighZoom) {
      // v3.23: Use -3 instead of -5 so the tile is 8x larger than the screen instead of 32x.
      // The tile is the particle-advection domain; only ~(screen/tile)² of particles land on screen, so the bigger
      // the tile, the fewer usable on-screen crests (and the deeper the per-zoom density sawtooth). Backoff is the
      // root density-headroom lever: 3 = 8×screen (default, max pan-stability); 2 = 4×screen (4× more on-screen
      // crests, slightly more reseed-on-pan). Default-neutral; tune live via window.__RAW_TILE_BACKOFF__.
      var _tileBackoff = (typeof window !== 'undefined' && typeof window.__RAW_TILE_BACKOFF__ === 'number') ? window.__RAW_TILE_BACKOFF__ : 2;
      var tileZoom = Math.max(0, Math.floor(z) - _tileBackoff);
      tileWidth = 1.0 / Math.pow(2.0, tileZoom);

      var tileWidthChanged = (this._lastTileWidth !== undefined && tileWidth !== this._lastTileWidth);
      this._lastTileWidth = tileWidth;

      // Initialize or drift check
      if (this._tileCenterX === undefined || this._tileCenterY === undefined || tileWidthChanged) {
        this._tileCenterX = cx;
        this._tileCenterY = cy;
        this.reinitParticles(gl);
      } else {
        var dx = cx - this._tileCenterX;
        var dy = cy - this._tileCenterY;
        if (Math.abs(dx) > tileWidth * 0.25 || Math.abs(dy) > tileWidth * 0.25) {
          this._tileCenterX = cx;
          this._tileCenterY = cy;
          this.reinitParticles(gl);
        }
      }
      tileOriginX = this._tileCenterX - tileWidth * 0.5;
      tileOriginY = this._tileCenterY - tileWidth * 0.5;
    } else {
      this._tileCenterX = undefined;
      this._tileCenterY = undefined;
      this._lastTileWidth = undefined;
    }

    if (zoomStateChanged) {
      this.reinitParticles(gl);
    }

    const smoothstepVal = (edge0, edge1, x) => {
      const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
      return t * t * (3.0 - 2.0 * t);
    };
    // v7.0: Slow animation motion speed smoothly by 25% at lower/far zoom without changing animation type
    const zoomFactor = z < 6.0 ? (0.75 + 0.25 * smoothstepVal(3.0, 6.0, z)) : 1.0;
    const motionScale = (0.75 + 0.25 * smoothstepVal(4.0, 7.0, z)) * zoomFactor;
    this.motionScale = motionScale;

    // BLEND BOTH: engage when the active grid is a REGIONAL tile and we retained a same-model/same-layer
    // global-coarse base. The coarse wash is drawn first (faded), then the regional on top with height-based
    // alpha so faint/near-zero regional cells let the wash show through — GFS's accurate-but-faint regional
    // swap then never reads as a "cleared" heatmap. Non-rating only (the rating band has its own coarse-fade
    // exemption). Kill switch: window.__RAW_DISABLE_BLEND_BOTH__ = true.
    const _gridForBlend = this._waveData && this._waveData.waveGrid;
    let blendEngaged = false;
    {
      const blendEnabled = (typeof window === 'undefined') || window.__RAW_DISABLE_BLEND_BOTH__ !== true;
      const cg = this._coarseBaseData;
      const isRating = !!(_gridForBlend && _gridForBlend.ratingMode);
      const curModel = (_gridForBlend && _gridForBlend.__sourceModel) || 'GFS';
      const curLayer = (_gridForBlend && _gridForBlend.__componentLayer) || 'waves';
      if (blendEnabled && !isRating && cg && cg.u_waveTexture &&
          isRegionalBounds(this._waveData.bounds) &&
          cg.__sourceModel === curModel && cg.__componentLayer === curLayer &&
          window.__WEATHER_DEBUG_ISOLATE_OVERLAY__ !== true) {
        blendEngaged = true;
      }
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.blendBoth = {
          engaged: blendEngaged,
          haveCoarseBase: !!(cg && cg.u_waveTexture),
          baseModel: cg && cg.__sourceModel,
          baseLayer: cg && cg.__componentLayer,
          curModel, curLayer,
          curRegional: isRegionalBounds(this._waveData.bounds),
          isRating
        };
      }
    }
    const _blendBaseWash = (typeof window !== 'undefined' && typeof window.__RAW_BLEND_BASE_WASH__ === 'number')
      ? window.__RAW_BLEND_BASE_WASH__ : 0.72;
    const baseWashOpacity = heatmapZoomOpacity(z) * mult * _blendBaseWash;

    // ==========================================
    // PHASE 1: GPU HEATMAP BASE LAYER (Upgraded Multi-Texture)
    // Draw base heatmap instantly using fallback grid mask texture if land mask is loading.
    // ==========================================
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // PHASE 0 (BLEND BOTH): faded coarse-global wash painted under the regional tile (same premultiplied blend).
    if (blendEngaged) {
      this._drawCoarseBasePass(gl, mat4, themeVal, time, baseWashOpacity);
    }

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

    // CLAMP SOFTENER: a regional tile narrower than the viewport (a sub-viewport tile committed during zoom-out)
    // otherwise renders as a hard-edged rectangle against the fainter coarse base. When the blend coarse base is
    // filling outside it, widen the regional edge-feather in proportion to how undersized the tile is, so it
    // dissolves smoothly into the coarse field instead of a hard clamp line. Default 0.18 (unchanged) when the
    // tile covers the viewport or there's no coarse base. Kill: window.__RAW_DISABLE_CLAMP_SOFTEN__ = true.
    let edgeFeatherWidthVal = 0.18;
    if (blendEngaged && (typeof window === 'undefined' || window.__RAW_DISABLE_CLAMP_SOFTEN__ !== true)) {
      const rLon = boundsLonSpan(waveBounds);
      const vLon = (vb[2] < vb[0]) ? (vb[2] + 360 - vb[0]) : (vb[2] - vb[0]);
      const coverage = (vLon > 0 && rLon > 0) ? Math.min(1, rLon / vLon) : 1;
      edgeFeatherWidthVal = 0.18 + (1 - coverage) * 0.32; // → up to ~0.5 as the tile shrinks below the viewport
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.clampSoften = { coverage: +coverage.toFixed(2), featherWidth: +edgeFeatherWidthVal.toFixed(2) };
      }
    }
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_edgeFeatherWidth'), edgeFeatherWidthVal);

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

    // Only apply the power-law visual scaling to actual trend-blended estimated products (provider "estimated" or source_dataset "estimated_blend")
    // and NOT to direct model fallbacks (like open-meteo or GFS fallback) which contain actual physical wave heights.
    const isEstimatedBlend = (
      waveGrid?.is_estimated || waveGrid?.isEstimated
    ) && (
      waveGrid?.provider === 'estimated' || 
      waveGrid?.source_dataset === 'estimated_blend' ||
      (waveGrid?.estimate_basis && (
        waveGrid.estimate_basis.type === 'euro_persistence_gfs_icon_blend' ||
        waveGrid.estimate_basis.type === 'euro_persistence_gfs_blend'
      ))
    );
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_is_estimated'), isEstimatedBlend ? 1.0 : 0.0);

    // Swell↔Surf coastal-band mode: rescale the color ramp to the surf range (0-4 m) so the band
    // differentiates. Read the flag inline (mirrors getSurfModeFlag) to avoid an engine import cycle; it
    // matches the rendered data, which marineGridSeries fetched with the same flag.
    var surfModeVal = 0.0;
    try {
      if (typeof window !== 'undefined') {
        surfModeVal = (window.__SURF_MODE__ !== undefined)
          ? (window.__SURF_MODE__ ? 1.0 : 0.0)
          : ((window.localStorage && window.localStorage.getItem('__SURF_MODE__') === 'true') ? 1.0 : 0.0);
      }
    } catch (e) { surfModeVal = 0.0; }
    // Option-A gate (rating plan §8 #2): the rating colormap (getRatingColorSmooth) decodes the height channel
    // as a 0-100 QUALITY score, which is only valid when the backend actually produced a rating grid. On a
    // raw-height frame (e.g. the global-coarse frame where the surf transform was skipped) `ratingMode` is
    // false, so we force surfMode off and the shader shows the HONEST swell field instead of fake rating
    // colours. The per-spot glyphs gate on the same signal (useSpotRatings) so both layers stay consistent.
    if (surfModeVal > 0.0 && !(waveGrid && waveGrid.ratingMode)) {
      surfModeVal = 0.0;
    }
    // Telemetry to localize a "no rating band" report in ONE console read (window.__RAW_GPU__.ratingBand): the
    // backend serves rating_mode=true on regional tiles (verified), the series conformer stamps grid.ratingMode,
    // and the shader paints the band when u_surfMode>0.5 — so a missing band is one of: flag off, grid not a
    // rating grid (propagation), or downstream. No render effect; reads the same inputs the gate above uses.
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      var _rawFlag = (window.__SURF_MODE__ !== undefined)
        ? !!window.__SURF_MODE__
        : (typeof window.localStorage !== 'undefined' && window.localStorage.getItem('__SURF_MODE__') === 'true');
      window.__RAW_GPU__.ratingBand = {
        flag: _rawFlag,                                            // is the Surf/Rating toggle's global flag set?
        gridRatingMode: !!(waveGrid && waveGrid.ratingMode),       // did a rating grid reach the engine?
        forcedOff: _rawFlag && !(waveGrid && waveGrid.ratingMode), // gate killing the band (flag on, grid not rating)
        active: surfModeVal > 0.5,                                 // is the band actually being painted?
        gridCols: (waveGrid && waveGrid.cols) || 0,
        fromSeries: !!(waveGrid && waveGrid.__fromSeries),         // which fetch path produced the rendered grid
      };
      // Loud, throttled breadcrumb so a "no band" report is self-diagnosing in the console (no need to know the
      // var name). Once per ~2s, only while the Surf/Rating toggle is on. Names the exact break.
      if (_rawFlag && typeof console !== 'undefined') {
        var _rbNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (!this._ratingBandLogT || (_rbNow - this._ratingBandLogT) > 2000) {
          this._ratingBandLogT = _rbNow;
          var _rb = window.__RAW_GPU__.ratingBand;
          console.log('[rating-band]', _rb.active
            ? 'PAINTING ✓ (band on)'
            : (_rb.forcedOff
                ? 'OFF — rendered grid is NOT a rating grid (ratingMode=false): the backend surf=1/regional tile is not reaching the engine for this viewport'
                : 'OFF — surf flag not set'),
            'cols=' + _rb.gridCols, 'fromSeries=' + _rb.fromSeries, _rb);
        }
      }
    }
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_surfMode'), surfModeVal);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_time'), time);

    // BLEND BOTH: on the regional overlay pass, fade near-flat cells so the coarse base wash shows through.
    // Off (0) on every non-blend frame → the shader factor is forced to 1 → no behavior change. lo/hi tunable live.
    const _haLo = (typeof window !== 'undefined' && typeof window.__RAW_BLEND_HEIGHT_LO__ === 'number') ? window.__RAW_BLEND_HEIGHT_LO__ : 0.05;
    // 1.4m crossover: below it the faint regional lets the coarse wash bleed through (lifts the nearshore where
    // surf is small); above it the regional dominates (real swell still reads as the precise regional tile).
    const _haHi = (typeof window !== 'undefined' && typeof window.__RAW_BLEND_HEIGHT_HI__ === 'number') ? window.__RAW_BLEND_HEIGHT_HI__ : 1.4;
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_heightAlphaEnabled'), blendEngaged ? 1.0 : 0.0);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_heightAlphaLo'), _haLo);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_heightAlphaHi'), _haHi);

    var heatmapOpacity = heatmapZoomOpacity(z);

    if (window.__WEATHER_DEBUG_ISOLATE_OVERLAY__ === true) {
      heatmapOpacity = 1.0;
    }

    // Coarse-grid fade (2026-06-29): when the ONLY marine data covering this viewport is the coarse-global
    // fallback (~10°/cell, 37×17) and the camera is zoomed in past it, a single flat cell fills the screen.
    // The old behavior painted that as a solid wash that reads as "wrong data" (the close-zoom "clamp").
    // Fade the heatmap out instead so it reads as "no fine data here" — the inherent 0.25°/10° resolution
    // limit, not a render bug. Per-spot rating glyphs (drawn in MapMarkerLayers, not this shader) stay visible.
    // Gate on cellDeg>1° so regional tiles (<0.3°/cell) NEVER fade, and the fade only engages once <2 cells
    // span the view (so zoomed-out global stays full). Kill switch: window.__RAW_DISABLE_COARSE_FADE__ = true
    let coarseFade = 1.0;
    if (window.__RAW_DISABLE_COARSE_FADE__ !== true && window.__WEATHER_DEBUG_ISOLATE_OVERLAY__ !== true) {
      const gb = (waveGrid && waveGrid.bounds) || waveBounds; // grid extent (matches waveGrid.cols); waveBounds is the same grid on the non-series path
      const gcols = waveGrid && waveGrid.cols;
      if (gb && gcols > 0 && typeof gb.west === 'number' && typeof gb.east === 'number') {
        const gridLonSpan = (gb.east < gb.west) ? (gb.east + 360 - gb.west) : (gb.east - gb.west);
        const cellDeg = gridLonSpan / gcols;                 // grid cell size in ° of longitude
        const vLonSpan = (vb[2] < vb[0]) ? (vb[2] + 360 - vb[0]) : (vb[2] - vb[0]);
        // RATING MODE IS EXEMPT: the surf-quality BAND is a smoothed coastal quality ZONE (not a literal
        // value), with accurate per-spot glyphs on top — it's wanted at close zoom even from coarse data, so
        // only the raw-height marine wash fades. Without this exemption the band vanished when zoomed in.
        const isRatingBand = !!(waveGrid && waveGrid.ratingMode);
        if (cellDeg > 1.0 && vLonSpan > 0 && !isRatingBand) { // only the coarse-global RAW wash qualifies
          const cellsAcross = vLonSpan / cellDeg;            // how many grid cells span the viewport
          // FLOOR at 0.7 (2026-06-29): a full fade-to-0 made the heatmap "clear" at very close zoom — but most
          // coastal viewports are STUCK on the coarse-global grid (regional tiles often don't cover them), so the
          // fade was firing constantly and reading as "the heatmap disappeared". Dim to 70% instead so the data
          // stays clearly visible (subtle coarseness cue) without vanishing. Kill switch still fully disables it.
          coarseFade = 0.7 + 0.3 * smoothstepVal(0.5, 2.0, cellsAcross); // [0.7..1.0]: dims, never clears
        }
      }
      if (typeof window !== 'undefined' && window.__RAW_GPU__) window.__RAW_GPU__.coarseFade = coarseFade;
    }
    heatmapOpacity *= coarseFade;

    heatmapOpacity *= mult;

    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_opacity'), heatmapOpacity);

    bindTexture(gl, this._waveData.u_waveTexture, 0);
    bindTexture(gl, this._waveData.u_chlorophyllTexture, 1);
    bindTexture(gl, this._waveData.u_bathymetryTexture, 2);
    bindTexture(gl, this._waveData.u_oceanMaskTexture, 3);

    var heatLngOffsetLoc = gl.getUniformLocation(this.heatmapProgram, 'u_lng_offset');
    if (this.heatmapVAO) {
      gl.bindVertexArray(this.heatmapVAO);
    } else {
      var heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gridUVBuffer);
      gl.enableVertexAttribArray(heatUVLoc);
      gl.vertexAttribPointer(heatUVLoc, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIndexBuffer);
    }

    var worldOffsets = [0.0, -360.0, 360.0];
    for (var wi = 0; wi < worldOffsets.length; wi++) {
      gl.uniform1f(heatLngOffsetLoc, worldOffsets[wi]);
      gl.drawElements(gl.TRIANGLES, this.numGridIndices, gl.UNSIGNED_SHORT, 0);
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.drawCallsPerFrame++;
      }
    }

    if (this.heatmapVAO) {
      gl.bindVertexArray(null);
    } else {
      var heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
      if (heatUVLoc !== -1) gl.disableVertexAttribArray(heatUVLoc);
    }

    if (this._fboSupported !== false) {
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
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_edgeFeatherWidth'), edgeFeatherWidthVal);
      // Directional-spectrum spread (breaks the parallel-crest lattice over uniform/coarse fields). OPT-IN until
      // visually verified + tuned on real swell data (default 0 = legacy parallel crests, no regression). Enable +
      // tune live via window.__RAW_CREST_DIR_JITTER__ (radians, ~0.15–0.30 is a natural spread).
      const _crestDirJitter = (typeof window !== 'undefined' && typeof window.__RAW_CREST_DIR_JITTER__ === 'number') ? window.__RAW_CREST_DIR_JITTER__ : 0.0;
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_crestDirJitter'), _crestDirJitter);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_opacity'), mult);

      // Constant-screen-density (flow-viz best practice): keep a FIXED number of seeded crests on screen at every
      // zoom instead of an ad-hoc per-zoom fraction. Particles live in a tile ~Nx the screen; the viewport's share
      // of that tile (onScreenFrac) lets us solve the cull fraction so total × onScreenFrac × threshold = target.
      // Default ON at 1650 on-screen seeds (≈ the previously-liked integer-zoom density), now held CONSTANT across
      // every zoom — verified via telemetry: count stays ~1650 from z9..z16 and across fractional zooms (was a ~4×
      // sawtooth: sparse just-before-integer, dense at integer). Reachable thanks to TILE_BACKOFF=2. Tunable live
      // via window.__RAW_PART_TARGET__ (set 0 to fall back to the legacy per-zoom curve). Telemetry: __RAW_GPU__.particleDensity.
      let densityBase = 0.0;
      const _partTarget = (typeof window !== 'undefined' && typeof window.__RAW_PART_TARGET__ === 'number')
        ? window.__RAW_PART_TARGET__ : 1650;
      if (_partTarget > 0 && z > tileZoomMin && tileWidth > 0) {
        const vWest = vb[0], vEast = vb[2];
        const lonSpan = (vEast < vWest) ? (vEast + 360 - vWest) : (vEast - vWest);
        const vMercX = Math.min(1.0, Math.max(0, lonSpan) / 360.0);
        const vMercY = Math.abs(latToMercatorY(vb[3]) - latToMercatorY(vb[1]));
        const onScreenFrac = Math.max(1e-6, Math.min(1.0, (vMercX * vMercY) / (tileWidth * tileWidth)));
        const totalParticles = this.particleRes * this.particleRes;
        densityBase = Math.max(0.02, Math.min(0.97, _partTarget / (totalParticles * onScreenFrac)));
        if (typeof window !== 'undefined' && window.__RAW_GPU__) {
          window.__RAW_GPU__.particleDensity = { zoom: +z.toFixed(2), onScreenFrac: +onScreenFrac.toFixed(4), densityBase: +densityBase.toFixed(3), targetSeeds: _partTarget, estInViewport: Math.round(totalParticles * onScreenFrac) };
        }
      }
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_densityBase'), densityBase);

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
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_tileZoomMin'), tileZoomMin);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_motion_scale'), motionScale);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_tile_origin'), tileOriginX, tileOriginY);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_tile_width'), tileWidth);

      // v5.3: viewport and DPR uniforms for pixel-space quad expansion
      var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1.0;
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_viewport'), gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_device_pixel_ratio'), dpr);

      bindTexture(gl, this.particleStateA, 0);
      bindTexture(gl, this._waveData.u_waveTexture, 1);
      bindTexture(gl, this._waveData.u_oceanMaskTexture, 2);

      var mercOffsetLoc = gl.getUniformLocation(this.drawProgram, 'u_merc_offset');
      if (this.drawVAO) {
        gl.bindVertexArray(this.drawVAO);
      } else {
        var idLoc = gl.getAttribLocation(this.drawProgram, 'a_vertex_id');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIdBuffer);
        gl.enableVertexAttribArray(idLoc);
        gl.vertexAttribPointer(idLoc, 1, gl.FLOAT, false, 0, 0);
      }

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

      if (this.drawVAO) {
        gl.bindVertexArray(null);
      } else {
        var idLoc = gl.getAttribLocation(this.drawProgram, 'a_vertex_id');
        if (idLoc !== -1) gl.disableVertexAttribArray(idLoc);
      }

      // === CREST DIAGNOSTICS (v5.3) ===
      populateCrestDiagnostics(this, gl, waveBounds, z);

      // ==========================================
      // PHASE 3: PARTICLE ADVECTION SYSTEM (Simulate next state)
      // ==========================================
      // Overall drift-speed multiplier (separate from the per-wave height cap below): lets the whole field be
      // slowed if mid-zoom motion reads too fast. Default 1.0 (unchanged); tunable live via window.__RAW_WAVE_SPEED__.
      const _waveSpeedMult = (typeof window !== 'undefined' && typeof window.__RAW_WAVE_SPEED__ === 'number') ? window.__RAW_WAVE_SPEED__ : 1.0;
      const stableSpeedScale = this.speedFactor * Math.pow(0.5, Math.max(0, z - 6)) * 1.5e-5 * motionScale * _waveSpeedMult;

      gl.disable(gl.BLEND); // CRITICAL: Disable blend to prevent position texture corruption!
      gl.useProgram(this.advectProgram);
      gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_particles'), 0);
      gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_waveTexture'), 1);
      gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_oceanMaskTexture'), 2);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speed_scale'), stableSpeedScale);
      // Cap the height term that drives drift speed (big swell otherwise drifts ~linearly with height → unnaturally
      // fast at mid-zoom over the coarse-global). Default 3.0 m; tunable live via window.__RAW_SPEED_HEIGHT_CAP__.
      const _speedHeightCap = (typeof window !== 'undefined' && typeof window.__RAW_SPEED_HEIGHT_CAP__ === 'number') ? window.__RAW_SPEED_HEIGHT_CAP__ : 3.0;
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speedHeightCap'), _speedHeightCap);

      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_rand_seed'), Math.random());
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate'), this.dropRate);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_zoom'), z);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_tileZoomMin'), tileZoomMin);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_tile_origin'), tileOriginX, tileOriginY);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_tile_width'), tileWidth);

      bindTexture(gl, null, 0);
      bindTexture(gl, null, 1);
      bindTexture(gl, null, 2);

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

      if (fboStatus !== gl.FRAMEBUFFER_COMPLETE) {
        console.warn('[WebGLMarine] Framebuffer incomplete: ' + fboStatusStr + '. Falling back to Heatmap only.');
        this._fboSupported = false;
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        bindTexture(gl, this.particleStateA, 0);
        bindTexture(gl, this._waveData.u_waveTexture, 1);
        bindTexture(gl, this._waveData.u_oceanMaskTexture, 2);

        if (this.advectVAO) {
          gl.bindVertexArray(this.advectVAO);
        } else {
          var advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(advPosLoc);
          gl.vertexAttribPointer(advPosLoc, 2, gl.FLOAT, false, 0, 0);
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (typeof window !== 'undefined' && window.__RAW_GPU__) {
          window.__RAW_GPU__.drawCallsPerFrame++;
        }

        if (this.advectVAO) {
          gl.bindVertexArray(null);
        } else {
          var advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
          if (advPosLoc !== -1) gl.disableVertexAttribArray(advPosLoc);
        }

        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);

        var tmp = this.particleStateA;
        this.particleStateA = this.particleStateB;
        this.particleStateB = tmp;
      }
    }
  } finally {
    if (gl && !gl.isContextLost() && webglState) {
      if (this.advFBO && gl.isFramebuffer(this.advFBO)) {
        try {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        } catch (e) {}
      }
      restoreWebGLState(gl, webglState);
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
  }
};

WebGLMarineEngine.prototype.render = WebGLMarineEngine.prototype.renderHeatmapAndParticles;

// BLEND BOTH: snapshot a global-coarse grid into a standalone (non-resident) texture set we own + free.
WebGLMarineEngine.prototype._captureCoarseBase = function(gl, waveGrid, key) {
  if (!gl) return;
  this._freeCoarseBase(gl);
  let base = null;
  try {
    // Pass the land GeoJSON so the standalone encode renders a high-res MERCATOR ocean mask (the heatmap shader
    // samples mask_v in mercator; a grid mask would be read at the wrong latitude and hide the wash).
    base = encodeMarineTexture(gl, waveGrid, this._landGeoJSON || null, this, { standalone: true });
  } catch (e) {
    console.warn('[WebGLMarineEngine] coarse-base encode failed:', e && e.message);
    base = null;
  }
  if (base && base.u_waveTexture) {
    base.waveGrid = waveGrid;
    base.__key = key || coarseBaseKey(waveGrid);
    base.__sourceModel = waveGrid.__sourceModel || 'GFS';
    base.__componentLayer = waveGrid.__componentLayer || 'waves';
    this._coarseBaseData = base;
  }
};

WebGLMarineEngine.prototype._freeCoarseBase = function(gl) {
  const b = this._coarseBaseData;
  if (!b) return;
  this._coarseBaseData = null;
  if (!gl) return;
  try {
    if (b.u_waveTexture) safeDeleteTexture(gl, b.u_waveTexture, this);
    if (b.u_chlorophyllTexture) safeDeleteTexture(gl, b.u_chlorophyllTexture, this);
    if (b.u_bathymetryTexture) safeDeleteTexture(gl, b.u_bathymetryTexture, this);
    if (b.u_oceanMaskTexture) safeDeleteTexture(gl, b.u_oceanMaskTexture, this);
  } catch (e) {}
};

// Draw the retained coarse-global grid as a faded background wash. Same heatmap program + premultiplied blend as
// the main pass; height-alpha OFF (solid wash) and edge-feather OFF (it's global, no regional rectangle to soften).
WebGLMarineEngine.prototype._drawCoarseBasePass = function(gl, mat4, themeVal, time, baseOpacity) {
  const base = this._coarseBaseData;
  if (!base || !base.u_waveTexture || !base.bounds) return;
  const bb = base.bounds;

  let debugModeVal = 0.0;
  if (typeof window !== 'undefined' && window.__GPU_DEBUG__) {
    const mode = window.__GPU_DEBUG__.mode;
    if (mode === 'uv') debugModeVal = 1.0;
    else if (mode === 'mask') debugModeVal = 2.0;
    else if (mode === 'grid') debugModeVal = 3.0;
    else if (mode === 'mercator') debugModeVal = 4.0;
  }

  gl.useProgram(this.heatmapProgram);
  gl.uniformMatrix4fv(gl.getUniformLocation(this.heatmapProgram, 'u_matrix'), false, mat4);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_min'), bb.west, bb.south);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_max'), bb.east, bb.north);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_waveTexture'), 0);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_chlorophyllTexture'), 1);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_bathymetryTexture'), 2);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_oceanMaskTexture'), 3);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_theme'), themeVal);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_edgeFeatherEnabled'), 0.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_debug_mode'), debugModeVal);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_is_estimated'), 0.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_surfMode'), 0.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_time'), time);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_heightAlphaEnabled'), 0.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_heightAlphaLo'), 0.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_heightAlphaHi'), 1.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_opacity'), baseOpacity);

  bindTexture(gl, base.u_waveTexture, 0);
  bindTexture(gl, base.u_chlorophyllTexture, 1);
  bindTexture(gl, base.u_bathymetryTexture, 2);
  bindTexture(gl, base.u_oceanMaskTexture, 3);

  const heatLngOffsetLoc = gl.getUniformLocation(this.heatmapProgram, 'u_lng_offset');
  let heatUVLoc = -1;
  if (this.heatmapVAO) {
    gl.bindVertexArray(this.heatmapVAO);
  } else {
    heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridUVBuffer);
    gl.enableVertexAttribArray(heatUVLoc);
    gl.vertexAttribPointer(heatUVLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIndexBuffer);
  }

  const worldOffsets = [0.0, -360.0, 360.0];
  for (let wi = 0; wi < worldOffsets.length; wi++) {
    gl.uniform1f(heatLngOffsetLoc, worldOffsets[wi]);
    gl.drawElements(gl.TRIANGLES, this.numGridIndices, gl.UNSIGNED_SHORT, 0);
    if (typeof window !== 'undefined' && window.__RAW_GPU__) window.__RAW_GPU__.drawCallsPerFrame++;
  }

  if (this.heatmapVAO) {
    gl.bindVertexArray(null);
  } else if (heatUVLoc !== -1) {
    gl.disableVertexAttribArray(heatUVLoc);
  }
};

WebGLMarineEngine.prototype.clearBuffers = function(gl) {
  if (!gl) return;
  console.log('[WebGLMarineEngine-Clear] Clearing resident wave textures and waveData');
  this._freeCoarseBase(gl);
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
  disposeEngine(this, gl);
};

export default WebGLMarineEngine;
