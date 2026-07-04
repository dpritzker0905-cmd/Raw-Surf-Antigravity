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
import { renderMaskToCanvas, overlayBasemapWaterOnMask, isBasemapWaterSourceReady } from './WebGLMarineMaskRenderer';

import { populateCrestDiagnostics } from './WebGLMarineEngineDiagnostics';
import { MARINE_ZOOMED_OUT_MAX_ZOOM, COARSE_CREST_BAND_MIN_ZOOM } from './marineZoomThresholds';
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

// === NO-DOWNGRADE decision (pure; exported for tests) ===
// True when `incoming` is the global-COARSE fallback that would DOWNGRADE a resident REGIONAL grid of the SAME
// component layer + hour while the map is zoomed IN — the coarse⇄regional ping-pong that resets the particle FBO
// and re-orients the (different) direction field on every commit, i.e. the "clockwise spin" (live repro
// 2026-07-01, Cocoa z9: 13×13 series_GFS_waves_h0 resident, overwritten by 37×17 gfs_marine_waves_global_coarse,
// rev 1→3→5→7 flipping shapes with a particle reset + traceId-race MISMATCH each time). Blocks ONLY the downgrade:
// coarse→regional (sharpen/UPGRADE), a scrub to a DIFFERENT hour, zoomed-out, no resident, or a resident regional
// that no longer COVERS the viewport (stale after a pan) all return false — so the guard can never strand a
// non-covering rectangle nor re-create the coarse-global CLAMP that 7f6c39be/54e289b5 fixed.
export function shouldRejectResolutionDowngrade(resident, incoming, lastZoom, viewportBounds, disabled) {
  if (disabled || !resident || !incoming) return false;
  if (!isCoarseGlobalGrid(incoming)) return false;         // incoming must be the coarse-global fallback
  if (!isRegionalBounds(resident.bounds)) return false;    // resident must itself be a regional tile
  const sameLayer = (incoming.__componentLayer || 'waves') === (resident.__componentLayer || 'waves');
  const sameHour = incoming.hourOffset !== undefined && resident.hourOffset !== undefined
    && incoming.hourOffset === resident.hourOffset;
  // UNKNOWN zoom must FAIL OPEN (2026-07-03): _lastZoom is only written by the render loop, so a
  // commit racing a zoom change (or arriving before the first frame / while rAF is paused) reads
  // undefined-or-stale. Treating unknown as "zoomed in" made the guard reject the coarse WHILE the
  // commit ledger recorded it — every retry then dup-skipped and the band displayed a stranded 3°
  // regional rectangle until an hour scrub (live 3Hz×40min loop, 2026-07-03). A wrong ACCEPT costs
  // one particle reset and self-heals via the sharpen path; a wrong REJECT was permanent.
  const zoomedIn = (typeof lastZoom === 'number') && (lastZoom > MARINE_ZOOMED_OUT_MAX_ZOOM);
  const residentRenderable = resident.__renderable !== false && !!(resident.vectors && resident.vectors.length);
  // Keep the resident regional ONLY if it still covers the current viewport; otherwise it's stale after a pan and
  // coarse (or a fresh regional) should be allowed to replace it (no stranded non-covering regional rectangle).
  const rb = resident.bounds;
  let covers = true;
  const coverageKnown = !!(viewportBounds && rb);
  if (coverageKnown) {
    const vw = viewportBounds[0], vs = viewportBounds[1], ve = viewportBounds[2], vn = viewportBounds[3];
    covers = rb.west <= vw + 1e-6 && rb.east >= ve - 1e-6 && rb.south <= vs + 1e-6 && rb.north >= vn - 1e-6;
  }
  // COVERAGE, not zoom, is the real predicate (2026-07-04, "waves flip direction + height color
  // around z7.0-7.74, then correct"): dipping below the z7.0 threshold let the 37×17 world grid
  // displace a regional tile that still fully covered the viewport — its 10° cells carry leaked
  // directions and block-mean heights at coasts, so every threshold crossing flipped the field on
  // screen (instrumented soak: commits ping-ponged span 360 ⇄ span 3-6 through the band). While
  // KNOWN coverage holds, keep the finer grid at ANY zoom; the swap to coarse then happens at the
  // natural coverage boundary, where the tile is a small part of the screen. The double-unknown
  // case (no zoom AND no viewport) still fails OPEN, and a wrong reject self-heals via the
  // _pendingDowngrade stash re-evaluated every frame with the current zoom/viewport.
  return !!(sameLayer && sameHour && residentRenderable && covers && (zoomedIn || coverageKnown));
}

// === COARSE-BAND CREST CONTROLS (pure; exported for tests) ===
// How crests behave on a magnified coarse-global grid in the vortex band (z3.5–7). The 2026-07-01 fix
// SUPPRESSED all crests there (dirCoherenceMin=2 → shader discards everything), which killed the vortex but
// left the whole band crest-less — the "wave animations clear from z3.61 to z6.89, restore at 7.04" report.
// Default is now 'nearest' (2026-07-02): sample the crest DIRECTION at the nearest coarse CELL CENTER
// (u_coarseNearestDir). The vortex was the bilinear BLEND of divergent ~10°-cell headings synthesizing a
// smooth rotation; uniform per-cell headings cannot swirl, so crests animate in the band again with no spin.
// Modes via window.__RAW_COARSE_CREST_MODE__: 'nearest' (default) | 'suppress' (the 2026-07-01 behavior;
// __RAW_DIR_COHERENCE_MIN__ 0..1 = partial cull) | 'off'. Kill switch (legacy bilinear crests — vortex risk,
// forensics only): window.__RAW_DISABLE_COARSE_CREST_SUPPRESS__ = true.
export function resolveCoarseCrestControls(inVortexBand, win) {
  if (!inVortexBand) return { dirCoherenceMin: 0.0, coarseNearestDir: 0.0, mode: 'off' };
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_DISABLE_COARSE_CREST_SUPPRESS__ === true || w.__RAW_COARSE_CREST_MODE__ === 'off') {
    return { dirCoherenceMin: 0.0, coarseNearestDir: 0.0, mode: 'killed' };
  }
  const o = (typeof w.__RAW_DIR_COHERENCE_MIN__ === 'number') ? w.__RAW_DIR_COHERENCE_MIN__ : null;
  if (w.__RAW_COARSE_CREST_MODE__ === 'suppress') {
    return { dirCoherenceMin: o !== null ? o : 2.0, coarseNearestDir: 0.0, mode: 'suppress' };
  }
  // SEAM floor default 0.7 (2026-07-03): coherence is now LAND-AWARE — the encoder's direction-only
  // dilation (dilateDirectionField, WebGLMarineTextureEncoder) fills a unit direction into every
  // zero-direction texel (land / is_valid:false / beyond the extrapolation ring), so the bilinear
  // |waveVec| collapses ONLY at true divergent-direction seams, never beside coastlines. (The first
  // default-on attempt was land-BLIND and faded a cell-width of ocean at every coastline — the
  // "missing patches all over" regression, HANDOFF-2026-07-03 §0A.) 0.7 ≈ fade where neighbor
  // headings differ by >~90° (|avg of two unit vectors| = cos(θ/2)); hard drop <0.35 ≈ >~140°.
  // Override via __RAW_DIR_COHERENCE_MIN__ (0 = off); encoder kill: __RAW_DISABLE_DIR_DILATION__.
  return { dirCoherenceMin: o !== null ? o : 0.7, coarseNearestDir: 1.0, mode: 'nearest' };
}

// === NATURAL ANIMATION DEFAULTS (baked 2026-07-01) ===
// The §5#2 animation upgrades (trochoidal crest shape, orbital pitch, shoaling foam, crest direction-jitter)
// shipped as gated shader uniforms DEFAULT-OFF pending visual dial-in — but the dial-in was never baked, so
// production always rendered the legacy flat look and the tuner's "Natural" preset had to be re-applied by hand
// every session. These are the designed Natural values (MarineAnimTuner PRESET_NATURAL). Resolution order per
// frame: explicit window.__RAW_*__ (tuner slider / console) → legacy kill (window.__RAW_ANIM_LEGACY__ = true →
// 0, the pre-2026-07-01 look) → Natural default. All values are DRAW-shader-only (crest visuals); advection is
// untouched, so motion/physics cannot regress. Exported for tests + the tuner (single source of truth).
export const NATURAL_ANIM_DEFAULTS = {
  __RAW_TROCHOIDAL__: 0.7,        // asymmetric crest: sharp leading face, broad trailing back
  __RAW_ORBITAL_PITCH__: 2.5,     // phase-synced fwd/back sway (px); keep ≤3 to avoid banding
  __RAW_SHOAL_FOAM__: 1.5,        // extra whitecap in shallow water (inert without bathymetry)
  __RAW_CREST_DIR_JITTER__: 0.2,  // rad of per-crest heading spread (breaks the parallel-crest lattice)
};
export function resolveAnimValue(key) {
  if (typeof window !== 'undefined') {
    if (typeof window[key] === 'number') return window[key];
    if (window.__RAW_ANIM_LEGACY__ === true) return 0.0;
  }
  return NATURAL_ANIM_DEFAULTS[key] !== undefined ? NATURAL_ANIM_DEFAULTS[key] : 0.0;
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

  // Every commit (re-)encodes the mask WITHOUT the basemap-truth patch — the repaint hysteresis
  // must forget its "already painted" state or it SKIPS the re-apply and the freshly-encoded
  // NE-only mask leaks the heatmap over fine-grained land (live "leaking all over the place"
  // report: hour scrubs/sharpens/toggles re-commit constantly). The layer's revision effect
  // re-patches immediately after the commit; this line just lets it through.
  this._regionalPatchState = null;

  // === NO-DOWNGRADE GUARD — kills the coarse⇄regional ping-pong "spin" at the single engine choke point every
  // commit source funnels through (orchestrator data_commit + SWR, WebGLMarineLayer land_mask_res_swap, the
  // instant cache-hit on toggle, and the sync overlay). Refuse to overwrite a resident REGIONAL grid with the
  // global-COARSE fallback for the same layer+hour while zoomed in over a covered viewport — that swap resets the
  // particle FBO and re-orients the direction field (the spin). Hour/coverage-scoped + directional, so coarse→
  // regional sharpen, a scrub to a new hour, a pan off the tile, and zoom-out all pass through untouched. Kill:
  // window.__RAW_DISABLE_NO_DOWNGRADE__. Telemetry: window.__MARINE_NO_DOWNGRADE__.count.
  if (this._waveData && this._waveData.waveGrid &&
      shouldRejectResolutionDowngrade(this._waveData.waveGrid, waveGrid, this._lastZoom, this._lastViewportBounds,
        typeof window !== 'undefined' && !!window.__RAW_DISABLE_NO_DOWNGRADE__)) {
    const _res = this._waveData.waveGrid;
    if (typeof window !== 'undefined') {
      const nd = window.__MARINE_NO_DOWNGRADE__ || (window.__MARINE_NO_DOWNGRADE__ = { count: 0 });
      nd.count++;
      nd.last = { residentDims: `${_res.cols}×${_res.rows}`, rejectedDims: `${waveGrid.cols}×${waveGrid.rows}`,
        layer: waveGrid.__componentLayer || 'waves', hour: waveGrid.hourOffset, zoom: this._lastZoom, ts: Date.now() };
    }
    console.log(`[WebGLMarineEngine] No-downgrade: kept resident regional ${_res.cols}×${_res.rows} (${waveGrid.__componentLayer || 'waves'} h${waveGrid.hourOffset}); rejected global-coarse ${waveGrid.cols}×${waveGrid.rows} at zoom ${typeof this._lastZoom === 'number' ? this._lastZoom.toFixed(1) : this._lastZoom} — skips particle reset + re-orient.`);
    // SELF-HEAL STASH (2026-07-03): a rejected grid must never be lost — the commit path records its
    // signature, so it will NEVER be re-committed (dup-skip) and a wrong rejection (stale _lastZoom)
    // would strand the display permanently. Stash it; the render loop re-evaluates the guard with the
    // CURRENT zoom/viewport every frame and swaps it in the moment rejection no longer holds.
    this._pendingDowngrade = waveGrid;
    return;
  }
  // Any ACCEPTED commit supersedes a stashed reject (newer data won; the stash must not resurrect).
  this._pendingDowngrade = null;

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
    this._lastViewportBounds = vb;   // snapshot for the no-downgrade guard's coverage check in setWaveData
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
    // CLIFF at z6 when zooming out — and, after the 4.0 lowering, its shadow at z3.02–3.93. Now 3.0: the
    // constant-screen-density solve covers everything down to z3 (at z3.x the tile is HALF the world → pans
    // basically never re-anchor), while below z3 the legacy globe-thinning curve stays deliberate. Live-verified
    // 2026-07-02: solve holds 1650 across z3.0–4.0 (densityBase 0.15–0.53), one reinit per 3.0 crossing, none
    // while panning in-band. Tunable via window.__RAW_TILE_ZOOM_MIN__. Must match u_tileZoomMin.
    var tileZoomMin = (typeof window !== 'undefined' && typeof window.__RAW_TILE_ZOOM_MIN__ === 'number') ? window.__RAW_TILE_ZOOM_MIN__ : 3.0;
    var isHighZoom = z > tileZoomMin;
    // THE z4–6 "VORTEX" ROOT (2026-07-02): prevHighZoom kept the OLD hardcoded 6.0 threshold when the
    // density-cliff fix moved isHighZoom onto tileZoomMin (default 4.0). For any zoom stably inside
    // (tileZoomMin, 6.0] the two flags disagreed on EVERY frame → zoomStateChanged stayed true →
    // reinitParticles() ran EVERY FRAME — full-field particle churn exactly in z4–6, the band of every
    // vortex report (z4.02–5.88, 3.9–5.93, 4.13–5.91). Both sides must use the SAME threshold; a
    // per-frame reseed can never be a valid steady state. Telemetry: window.__MARINE_ZOOMSTATE_REINITS__.
    var prevHighZoom = this._lastZoom > tileZoomMin;
    var zoomStateChanged = (this._lastZoom !== undefined && isHighZoom !== prevHighZoom);
    if (zoomStateChanged && typeof window !== 'undefined') {
      window.__MARINE_ZOOMSTATE_REINITS__ = (window.__MARINE_ZOOMSTATE_REINITS__ || 0) + 1;
    }
    this._lastZoom = z;

    // SELF-HEAL a stashed no-downgrade rejection (2026-07-03): re-evaluate with the zoom/viewport we
    // JUST recorded — the guard call inside setWaveData reads these same fields, so acceptance here is
    // authoritative. This releases the wedge where a coarse commit was rejected against a stale zoom
    // and the commit dedup then blocked every retry (stranded 3° regional at band zoom, live repro ×2).
    if (this._pendingDowngrade) {
      const _pd = this._pendingDowngrade;
      const _pdDisabled = typeof window !== 'undefined' && !!window.__RAW_DISABLE_NO_DOWNGRADE__;
      if (!shouldRejectResolutionDowngrade(this._waveData && this._waveData.waveGrid, _pd, z, vb, _pdDisabled)) {
        this._pendingDowngrade = null;
        if (typeof window !== 'undefined') {
          const nd = window.__MARINE_NO_DOWNGRADE__ || (window.__MARINE_NO_DOWNGRADE__ = { count: 0 });
          nd.selfHealed = (nd.selfHealed || 0) + 1;
        }
        console.log(`[WebGLMarineEngine] No-downgrade self-heal: stashed ${_pd.cols}×${_pd.rows} grid accepted at zoom ${z.toFixed(1)}.`);
        this.setWaveData(gl, _pd, null);
      }
    }

    // === COARSE-GLOBAL CREST SUPPRESSION — the real vortex fix (default ON) ===
    // The "clockwise spin" is NOT merely a bilinear-interpolation artifact: the coarse-GLOBAL 37×17 grid's direction
    // field is GENUINELY ROTATIONAL at regional magnification (measured curl 1.769 across ocean basins). A partial
    // coherence-floor cull removes only the cell-BOUNDARY particles (low interpolated magnitude) but KEEPS the
    // cell-CENTER particles (magnitude ≈1), and those still advect the divergent per-cell headings → the field
    // still rotates → vortex persists at ANY floor <1 (confirmed: 0.7 didn't kill it, z4.02–5.88). The honest fix is
    // to NOT animate crests on a coarse-global grid once it's magnified past a global view: the heatmap already
    // conveys wave height, and the coarse direction is not meaningful for per-crest animation there. We force the
    // discard floor ABOVE the max unit magnitude (>1 → discards EVERY crest) whenever a coarse-global grid is the
    // resident advection source and z>3.5. Regional/fine grids are untouched (crests stream normally). Heatmap pass
    // is unaffected. Kill: window.__RAW_DISABLE_COARSE_CREST_SUPPRESS__=true. Tune (partial cull instead of full
    // suppress): window.__RAW_DIR_COHERENCE_MIN__ = <0..1>. Echo: __RAW_GPU__.anim.dirCoherenceMin (2 = suppressed).
    const _residentCoarseGlobal = isCoarseGlobalGrid(this._waveData && this._waveData.waveGrid);
    // The vortex band: a coarse ~10°/cell grid shows 1-2 whole cells on screen so the divergent per-cell
    // headings rotate across the viewport (empirically z4.02–5.88). ABOVE ~z7 you are inside a single coarse
    // cell (near-uniform direction, no vortex) and BELOW ~z3.5 you see many cells (a global field, no
    // per-cell swirl). In the band, resolveCoarseCrestControls picks the crest strategy — default 'nearest'
    // (cell-center direction sampling: crests animate, no swirl); 'suppress' = the 2026-07-01 full discard.
    const _inVortexBand = _residentCoarseGlobal && z > COARSE_CREST_BAND_MIN_ZOOM && z <= MARINE_ZOOMED_OUT_MAX_ZOOM;
    const _ccc = resolveCoarseCrestControls(_inVortexBand, typeof window !== 'undefined' ? window : null);
    let dirCoherenceMin = _ccc.dirCoherenceMin;
    // COARSE-GLOBAL CLOSE-ZOOM crest suppression (2026-07-04, "waves over Venice z7.67-22, fixes
    // itself on zoom-out"): above the vortex band the old logic re-ENABLED crests on a coarse
    // WORLD grid, assuming a single near-uniform cell — but the world grid's 1024x512 land mask
    // (~39 km/texel) cannot resolve ANY coastline, so during the sharpen window (seconds warm,
    // minutes on a cold backend) crests race over cities and inland water.
    // OVERLAY-AWARE RELAXATION (2026-07-04 round 4): when the viewport-truth overlay mask COVERS
    // the current viewport, land is clipped at meter truth even on the world grid — crests behave
    // NORMALLY in the sharpen window (the suppressed dim/slow crests read as "broken animation",
    // live report at z17). Suppression remains only while the viewport is NOT overlay-covered
    // (stale overlay right after a pan, below the refresh cutoff, or painting unavailable) —
    // exactly where the 39 km mask is the only land guard.
    // Kill switch: the existing __RAW_DISABLE_COARSE_CREST_SUPPRESS__.
    const _ovb = this._overlayMaskBounds;
    const _overlayCoversViewport = !!(this._overlayMaskTex && _ovb &&
      _ovb.west <= vb[0] && _ovb.east >= vb[2] && _ovb.south <= vb[1] && _ovb.north >= vb[3]);
    // INTERSECTS is the fade guard's bar (not CONTAINS): every pan breaks containment for a beat
    // until the moveend repaint, and a contains-keyed fade blanked the whole wash per gesture
    // ("heatmaps clearing at z13", live). While the overlay still OVERLAPS the view, uncovered
    // pixels fall back per-pixel to the base mask — open water renders fine; only a brief
    // near-land edge bleed rides the repaint latency. Full fade is reserved for NO overlay at all
    // (boot) or a teleport whose old overlay doesn't even touch the view.
    const _overlayIntersectsViewport = !!(this._overlayMaskTex && _ovb &&
      _ovb.west < vb[2] && _ovb.east > vb[0] && _ovb.south < vb[3] && _ovb.north > vb[1]);
    if (_residentCoarseGlobal && z >= 8.0 && !_overlayIntersectsViewport &&
        !(typeof window !== 'undefined' && window.__RAW_DISABLE_COARSE_CREST_SUPPRESS__ === true)) {
      dirCoherenceMin = 2.0; // > max unit magnitude -> every crest discards (the proven suppress path)
    }
    const coarseNearestDir = _ccc.coarseNearestDir;
    const _wgCols = (this._waveData.waveGrid && this._waveData.waveGrid.cols) || 2;
    const _wgRows = (this._waveData.waveGrid && this._waveData.waveGrid.rows) || 2;

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
    // Close-zoom damp (2026-07-04, Long Beach land-bleed report): the coarse base is the WORLD grid
    // whose land-mask canvas is 1024x512 (~39 km/texel) — at harbor zooms the wash paints softly over
    // land/waterways no matter how good the polygons are. The regional tile fully covers the viewport
    // at these zooms, so the wash adds nothing there — damp it across z8→9.5. FLOOR 0.35, never 0
    // (live 2026-07-04 zoom-out report): during a zoom-out the ring revealed beyond the regional
    // tile has ONLY this wash to show — a zero damp blanked it ("the heatmap cleared, then came
    // back") until z<8 restored it. Dim reads as loading; blank reads as a bug — the same lesson
    // as the coarse-fade 0.7 and no-truth 0.3 floors.
    const _washZoomDamp = 1.0 - 0.65 * smoothstepVal(8.0, 9.5, z);
    const baseWashOpacity = heatmapZoomOpacity(z) * mult * _blendBaseWash * _washZoomDamp;

    // DECOUPLED MASK BOUNDS (2026-07-04): the resident ocean-mask texture may cover different
    // geography than the data grid — refreshMaskWithBasemapWater rebuilds it VIEWPORT-scoped while
    // the WORLD grid is resident at close zoom (the 1024×512 world mask is ~39 km/texel and cannot
    // carve any island — the Pianosa class). Every mask sample in the shaders uses these bounds.
    const maskBounds = (this._cachedMaskBounds && this._waveData.u_oceanMaskTexture === this._cachedMaskTex)
      ? this._cachedMaskBounds : waveBounds;
    // Viewport-truth OVERLAY mask (refreshViewportOverlayMask): shaders consult it only inside
    // its bounds; per-pixel fallback makes a stale overlay harmless. Two regimes:
    //  - WIDE (world) grid: overlay REPLACES the base sample (the 39 km base is too coarse to
    //    trust anywhere near a coast).
    //  - REGIONAL grid at deep zoom: overlay min()-COMBINES with the base (base is already
    //    truthful incl. the sheltered-water verdict; the crisp overlay only ever removes wash —
    //    the 27 m regional texels haloed over waterfront roads past ~z12).
    const _gwSpan = (waveBounds.east < waveBounds.west) ? (waveBounds.east + 360) - waveBounds.west : waveBounds.east - waveBounds.west;
    const _ovSpan = this._overlayMaskBounds ? (this._overlayMaskBounds.east - this._overlayMaskBounds.west) : 0;
    const _overlayReplace = _gwSpan >= 340;
    const overlayOn = !!(this._overlayMaskTex && this._overlayMaskBounds &&
      (_overlayReplace || (z >= 12 && _ovSpan > 0 && _ovSpan < _gwSpan * 0.5)));
    const ob = overlayOn ? this._overlayMaskBounds : { west: 0, south: 0, east: 0, north: 0 };
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.overlayMask = { on: overlayOn, replace: _overlayReplace, bounds: overlayOn ? ob : null };
    }

    // ==========================================
    // PHASE 1: GPU HEATMAP BASE LAYER (Upgraded Multi-Texture)
    // Draw base heatmap instantly using fallback grid mask texture if land mask is loading.
    // ==========================================
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // PHASE 0 (BLEND BOTH): faded coarse-global wash painted under the regional tile (same
    // premultiplied blend). The base is a WORLD grid, so when a viewport-truth overlay exists it
    // REPLACES the base's 39 km mask inside its bounds — the floored wash is then land-clipped at
    // meter truth wherever truth has been painted.
    if (blendEngaged) {
      const baseOverlay = (this._overlayMaskTex && this._overlayMaskBounds)
        ? { tex: this._overlayMaskTex, bounds: this._overlayMaskBounds } : null;
      this._drawCoarseBasePass(gl, mat4, themeVal, time, baseWashOpacity, baseOverlay);
    }

    gl.useProgram(this.heatmapProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.heatmapProgram, 'u_matrix'), false, mat4);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_maskBounds_min'), maskBounds.west, maskBounds.south);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_maskBounds_max'), maskBounds.east, maskBounds.north);

    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_waveTexture'), 0);
    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_chlorophyllTexture'), 1);
    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_bathymetryTexture'), 2);
    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_oceanMaskTexture'), 3);
    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_overlayMaskTexture'), 4);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayMaskEnabled'), overlayOn ? 1.0 : 0.0);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayReplace'), _overlayReplace ? 1.0 : 0.0);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayBounds_min'), ob.west, ob.south);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayBounds_max'), ob.east, ob.north);
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
          // coastal viewports were STUCK on the coarse-global grid back then, so the fade fired constantly and
          // read as "the heatmap disappeared". Dim to 70% instead so the data stays visible.
          // 2026-07-04 (Pianosa/world-window saga): two fade-to-zero ramps were tried here and BOTH
          // read as a "blank heatmap" bug within minutes of live driving. The real fix landed
          // elsewhere — refreshMaskWithBasemapWater now rebuilds the mask VIEWPORT-scoped while a
          // wide grid is resident (u_maskBounds decoupling), so the wash is land-clipped at meter
          // truth and can stay visible over water at every zoom. The legacy 0.7 floor stands.
          coarseFade = 0.7 + 0.3 * smoothstepVal(0.5, 2.0, cellsAcross); // [0.7..1.0]: dims, never clears
        }
      }
      if (typeof window !== 'undefined' && window.__RAW_GPU__) window.__RAW_GPU__.coarseFade = coarseFade;
    }
    heatmapOpacity *= coarseFade;

    // NO-TRUTH WINDOW GUARD (2026-07-04): a wide grid at close zoom with NO overlay covering the
    // viewport has only the ~39 km world mask — the wash paints roads/cities (boot at close zoom,
    // or the instants between a pan and the moveend/idle overlay repaint). Fade the wash for
    // exactly that window; it returns the moment the overlay covers the view (land then clipped at
    // meter truth). Keyed on MASK COVERAGE, not zoom — the two earlier zoom-keyed fades both read
    // as "blank heatmap" bugs because they fired even when masking was fine. Mirrors the crest
    // suppression condition above, so heatmap and particles agree about the window.
    if (_residentCoarseGlobal && z >= 8.0 && !_overlayIntersectsViewport) {
      // FLOOR 0.3, never 0 (live "heatmap clears occasionally" on fast long pans): a blank map
      // reads as a bug every time; a briefly-dimmed wash with ~1 s of soft near-land bleed reads
      // as loading. The overlay repaint (moveend/idle, 700 ms throttle) restores full truth.
      heatmapOpacity *= Math.max(0.3, 1 - (z - 8.0));
    }

    heatmapOpacity *= mult;

    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_opacity'), heatmapOpacity);

    // Overlay on unit 4 (fallback-bind the base mask so the sampler is always complete).
    bindTexture(gl, overlayOn ? this._overlayMaskTex : this._waveData.u_oceanMaskTexture, 4);
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
      const _crestDirJitter = resolveAnimValue('__RAW_CREST_DIR_JITTER__');
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_crestDirJitter'), _crestDirJitter);
      // Direction-coherence floor: DIM crests sampled from bilinear-interpolated DIVERGENT-direction zones (the
      // synthetic close-zoom vortex). Engine-computed close-zoom ramp above; 0 = off (legacy). Matches ADVECT_FS.
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_dirCoherenceMin'), dirCoherenceMin);
      // Seam-fade alpha FLOOR (2026-07-03): incoherent-direction zones dim to this instead of vanishing —
      // the zero-alpha fade made divergence hotspots (Baja rows 177° apart) a crest DEAD ZONE across the
      // whole band. 0.3 keeps motion visible at low emphasis. Tune live: __RAW_SEAM_FADE_FLOOR_ALPHA__.
      const _seamFadeFloor = (typeof window !== 'undefined' && typeof window.__RAW_SEAM_FADE_FLOOR_ALPHA__ === 'number')
        ? window.__RAW_SEAM_FADE_FLOOR_ALPHA__ : 0.3;
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_seamFadeFloor'), _seamFadeFloor);
      // Coarse-band nearest-cell direction (vortex band, default mode): crest orientation snaps to the nearest
      // coarse cell-center heading — matches ADVECT so orientation == motion. 0 outside the band.
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_coarseNearestDir'), coarseNearestDir);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_waveGridSize'), _wgCols, _wgRows);

      // Zoom-band crest SELF-CONTRAST (2026-07-03): full strength where the crest palette collides
      // with the heatmap palette (user-reported z3.65–4.25 wash-out), ramping in from z3.0 and out
      // by z4.9. Internal dark-skirt/bright-core gradient — no theme palette change, 0 elsewhere.
      // Override live: window.__RAW_CREST_CONTRAST__ (0 = off everywhere, 1 = on everywhere).
      let _crestContrast;
      const _ccOverride = (typeof window !== 'undefined' && typeof window.__RAW_CREST_CONTRAST__ === 'number')
        ? window.__RAW_CREST_CONTRAST__ : null;
      if (_ccOverride !== null) {
        _crestContrast = _ccOverride;
      } else {
        const _ccUp = Math.min(1, Math.max(0, (z - 3.0) / 0.5));
        const _ccDown = 1 - Math.min(1, Math.max(0, (z - 4.4) / 0.5));
        _crestContrast = Math.max(0, Math.min(_ccUp, _ccDown));
      }
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_crestContrast'), _crestContrast);

      // === ANIMATION UPGRADES (§5 #2) — all gated, default-off → byte-identical render until enabled ===
      // Trochoidal crest shape: asymmetric ribbon (sharp leading face, broad trailing back). window.__RAW_TROCHOIDAL__ [0..1].
      const _trochoidal = resolveAnimValue('__RAW_TROCHOIDAL__');
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_trochoidal'), _trochoidal);
      // Orbital pitch: phase-synced forward/back sway (CSS px) so crests pitch, not just translate. window.__RAW_ORBITAL_PITCH__.
      const _orbitalPitch = resolveAnimValue('__RAW_ORBITAL_PITCH__');
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_orbitalPitch'), _orbitalPitch);
      // Shoaling foam: extra whitecap in shallow water via bathymetry. GATED on a resident bath texture so the
      // sampler (bound to unit 3 below) is never READ unbound. window.__RAW_SHOAL_FOAM__.
      const _hasBathTex = !!(this._waveData && this._waveData.u_bathymetryTexture);
      const _shoalFoam = _hasBathTex ? resolveAnimValue('__RAW_SHOAL_FOAM__') : 0.0;
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_shoalFoam'), _shoalFoam);
      gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_bathTexture'), 3);

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

      // Ribbon-endpoint land fade (2026-07-04): crest quads dissolve toward a land end instead of
      // overhanging barrier islands (Venice/Lido). Kill: window.__RAW_DISABLE_ENDPOINT_LAND_FADE__=true.
      const _endpointLandFade = (typeof window !== 'undefined' && window.__RAW_DISABLE_ENDPOINT_LAND_FADE__ === true) ? 0.0 : 1.0;
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_endpointLandFade'), _endpointLandFade);
      // Viewport-truth overlay mask (unit 4; fallback-bound below so the sampler is always complete).
      gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_overlayMaskTexture'), 4);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_overlayMaskEnabled'), overlayOn ? 1.0 : 0.0);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_overlayReplace'), _overlayReplace ? 1.0 : 0.0);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_overlayBounds_min'), ob.west, ob.south);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_overlayBounds_max'), ob.east, ob.north);

      // TRUTHFULNESS ECHO: publish the exact animation values the engine is applying THIS frame (+ live zoom)
      // so the tuner can prove the sliders reach the GPU and show what's active per zoom. Read every frame.
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        const _g = (k, d) => (typeof window[k] === 'number' ? window[k] : d);
        window.__RAW_GPU__.anim = {
          zoom: +z.toFixed(2),
          trochoidal: _trochoidal,
          orbitalPitch: _orbitalPitch,
          shoalFoam: _shoalFoam,
          shoalActive: _hasBathTex,            // false → shoaling foam is inert (no bathymetry bound at this view)
          crestJitter: _crestDirJitter,
          dirCoherenceMin: +dirCoherenceMin.toFixed(3),  // applied close-zoom coherence floor (0 = off / far zoom)
          seamFadeFloor: _g('__RAW_SEAM_FADE_FLOOR_ALPHA__', 0.3), // alpha floor of the seam DIM (crests never vanish in incoherent zones)
          coarseNearestDir: coarseNearestDir,            // 1 = vortex-band nearest-cell direction sampling active
          coarseCrestMode: _ccc.mode,                    // 'nearest' | 'suppress' | 'killed' | 'off' (off = not in band)
          crestContrast: +_crestContrast.toFixed(3),     // zoom-band self-contrast strength (1 in z~3.5-4.4, 0 outside; __RAW_CREST_CONTRAST__ overrides)
          waveSpeed: _g('__RAW_WAVE_SPEED__', 1.0),
          reducedMotion: !!this._prefersReducedMotion || window.__RAW_REDUCED_MOTION__ === true, // a11y damp (0.15× drift; heatmap untouched)
          speedHeightCap: _g('__RAW_SPEED_HEIGHT_CAP__', 3.0),
          partTarget: _partTarget,
          densityBase: +densityBase.toFixed(3),
          tileZoomMin: tileZoomMin,
          tileBackoff: _g('__RAW_TILE_BACKOFF__', 2),
          stratifiedReseed: (typeof window.__RAW_STRATIFIED_RESEED__ === 'number' ? window.__RAW_STRATIFIED_RESEED__ !== 0 : true),
          farzoomSizeFloor: _g('__RAW_FARZOOM_SIZE_FLOOR__', 0.55),
          endpointLandFade: _endpointLandFade === 1.0,  // crest ribbons dissolve toward land ends (kill: __RAW_DISABLE_ENDPOINT_LAND_FADE__)
          blendWash: _blendBaseWash,
          legacyAnim: window.__RAW_ANIM_LEGACY__ === true   // true → Natural defaults killed (flat pre-2026-07 look)
        };
      }

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
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_maskBounds_min'), maskBounds.west, maskBounds.south);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_maskBounds_max'), maskBounds.east, maskBounds.north);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_time'), time);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_zoom'), z);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_tileZoomMin'), tileZoomMin);
      // U3 density-aware crest size: far-zoom size floor (0.55 default; 0.4 = legacy pre-2026-07-02 look).
      const _fzFloor = (typeof window !== 'undefined' && typeof window.__RAW_FARZOOM_SIZE_FLOOR__ === 'number')
        ? window.__RAW_FARZOOM_SIZE_FLOOR__ : 0.55;
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_farzoomSizeFloor'), _fzFloor);
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
      // Bind bathymetry to unit 3 for the (gated) shoaling-foam sampler. Fall back to the wave texture when no
      // bath texture is resident, so unit 3 is always a valid bound texture — the sampler is only READ when
      // u_shoalFoam>0, which the engine forces to 0 without a bath texture (so the fallback is never sampled).
      bindTexture(gl, (this._waveData.u_bathymetryTexture ? this._waveData.u_bathymetryTexture : this._waveData.u_waveTexture), 3);
      bindTexture(gl, overlayOn ? this._overlayMaskTex : this._waveData.u_oceanMaskTexture, 4);

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
      // ACCESSIBILITY (2026-07-03 audit §6.4): honor prefers-reduced-motion by damping crest drift
      // to 0.15× — the heatmap (the actual data) is untouched; only the decorative particle motion
      // slows. Cached matchMedia (evaluated once; OS-level changes re-evaluate on reload, which is
      // the norm for this media feature). Override for testing: window.__RAW_REDUCED_MOTION__
      // (true = force damp, false = force off); tuner __RAW_WAVE_SPEED__ still multiplies on top.
      if (this._prefersReducedMotion === undefined) {
        try {
          this._prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (e) { this._prefersReducedMotion = false; }
      }
      const _rmOverride = (typeof window !== 'undefined' && typeof window.__RAW_REDUCED_MOTION__ === 'boolean')
        ? window.__RAW_REDUCED_MOTION__ : null;
      const _reducedMotion = _rmOverride !== null ? _rmOverride : this._prefersReducedMotion;
      const _rmScale = _reducedMotion ? 0.15 : 1.0;
      const stableSpeedScale = this.speedFactor * Math.pow(0.5, Math.max(0, z - 6)) * 1.5e-5 * motionScale * _waveSpeedMult * _rmScale;

      gl.disable(gl.BLEND); // CRITICAL: Disable blend to prevent position texture corruption!
      gl.useProgram(this.advectProgram);
      gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_particles'), 0);
      gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_waveTexture'), 1);
      gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_oceanMaskTexture'), 2);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_maskBounds_min'), maskBounds.west, maskBounds.south);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_maskBounds_max'), maskBounds.east, maskBounds.north);
      gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_overlayMaskTexture'), 3);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_overlayMaskEnabled'), overlayOn ? 1.0 : 0.0);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_overlayReplace'), _overlayReplace ? 1.0 : 0.0);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_overlayBounds_min'), ob.west, ob.south);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_overlayBounds_max'), ob.east, ob.north);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speed_scale'), stableSpeedScale);
      // Cap the height term that drives drift speed (big swell otherwise drifts ~linearly with height → unnaturally
      // fast at mid-zoom over the coarse-global). Default 3.0 m; tunable live via window.__RAW_SPEED_HEIGHT_CAP__.
      const _speedHeightCap = (typeof window !== 'undefined' && typeof window.__RAW_SPEED_HEIGHT_CAP__ === 'number') ? window.__RAW_SPEED_HEIGHT_CAP__ : 3.0;
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speedHeightCap'), _speedHeightCap);
      // Direction-coherence floor (matches DRAW): drop particles advecting through interpolated divergent-direction
      // zones so they can't spiral the synthetic vortex. Engine-computed close-zoom ramp above; 0 = off (legacy).
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_dirCoherenceMin'), dirCoherenceMin);
      // Coarse-band nearest-cell direction (matches DRAW): advect along the nearest cell-center heading so the
      // per-cell motion is uniform — the bilinear swirl cannot form. 0 outside the vortex band.
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_coarseNearestDir'), coarseNearestDir);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_waveGridSize'), _wgCols, _wgRows);

      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_rand_seed'), Math.random());
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate'), this.dropRate);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_zoom'), z);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_tileZoomMin'), tileZoomMin);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_tile_origin'), tileOriginX, tileOriginY);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_tile_width'), tileWidth);
      // U2 stratified reseeding (default ON): respawn each particle inside its own state-texel stratum for
      // Jobard–Lefer-style even seed spacing (kills uniform-random reseed clumps at low density). Kill:
      // window.__RAW_STRATIFIED_RESEED__ = 0.
      const _stratified = (typeof window !== 'undefined' && window.__RAW_STRATIFIED_RESEED__ === 0) ? 0.0 : 1.0;
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_stratifiedReseed'), _stratified);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_particles_res'), this.particleRes);

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
        bindTexture(gl, overlayOn ? this._overlayMaskTex : this._waveData.u_oceanMaskTexture, 3);

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

// BASEMAP-WATER TRUTH REFRESH (2026-07-04, "Gull Park / Pier 15-16 under water"): repaint the
// CACHED mask texture in place with the basemap's own water polygons inside the viewport (see
// overlayBasemapWaterOnMask). In-place texImage2D on the SAME texture object means the resident
// waveData (which binds that object) picks it up on the next frame — no re-encode, no commit.
// Regional grids only (a world mask can't hold viewport detail at 1024px anyway). Idempotent and
// throttle-friendly: cheap enough for moveend. Kill switch window.__RAW_BASEMAP_WATER_MASK__=false.
WebGLMarineEngine.prototype.refreshMaskWithBasemapWater = function(gl, mapInstance) {
  if (typeof window !== 'undefined' && window.__RAW_BASEMAP_WATER_MASK__ === false) return false;
  if (!gl || !mapInstance) return false;
  const geo = this._cachedMaskGeoJSON;
  const tex = this._cachedMaskTex;
  const bounds = this._cachedMaskBounds;
  if (!geo || !bounds || !tex) return false;
  const span = (bounds.east < bounds.west ? bounds.east + 360 : bounds.east) - bounds.west;
  // WIDE (world) grids: the grid's own 1024×512 mask (~39 km/texel) cannot hold viewport detail —
  // paint a SEPARATE viewport-truth OVERLAY texture instead (see refreshViewportOverlayMask). The
  // base mask is never touched, so a stale overlay can only ever fall back to base behavior.
  // (A first attempt retargeted THIS texture to viewport bounds in place: one pan later the
  // out-of-bounds samples clamped to edge-water and land masking died wholesale — Istria/Susak.)
  if (span >= 30) return this.refreshViewportOverlayMask(gl, mapInstance, true);
  // The resident frame must actually be USING the cached texture — otherwise refreshing it paints
  // a texture nothing binds (and skipping avoids fighting an in-flight commit).
  if (!this._waveData || this._waveData.u_oceanMaskTexture !== tex) return false;
  // HYSTERESIS (stair-climb choppiness fix): the painter patches the viewport padded 40%; while
  // the SAME grid is resident and the current viewport is still INSIDE the last patch, a repaint
  // adds nothing — skip the 50–250 ms canvas+upload. Deep-zoom crispness still refreshes via the
  // overlay branch below (its own hysteresis).
  let curView = null;
  try {
    const b = mapInstance.getBounds();
    curView = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  } catch (e) { curView = null; }
  const gridKey = `${bounds.west}_${bounds.south}_${bounds.east}_${bounds.north}`;
  const rp = this._regionalPatchState;
  if (curView && rp && rp.gridKey === gridKey && rp.box &&
      rp.box.west <= curView.west && rp.box.east >= curView.east &&
      rp.box.south <= curView.south && rp.box.north >= curView.north) {
    // Base patch still covers the view — only the deep-zoom overlay may need work.
    try {
      let _z3; try { _z3 = mapInstance.getZoom(); } catch (e3) { _z3 = 0; }
      if (_z3 >= 12) return this.refreshViewportOverlayMask(gl, mapInstance);
    } catch (e3) { /* enhancement only */ }
    return false;
  }
  // TILE-READINESS GATE (the "rectangle holes" root, 2026-07-04): painting while the water source
  // is mid-load bakes missing-tile rectangles into the mask as false land, and the hysteresis
  // above then keeps the bad paint. Skip entirely — the resident mask (NE truth) serves, and the
  // layer's `idle` listener re-drives this refresh once every covering tile is queryable.
  if (!isBasemapWaterSourceReady(mapInstance)) return false;
  try {
    const canvas = renderMaskToCanvas(geo, bounds);
    const applied = overlayBasemapWaterOnMask(canvas, bounds, mapInstance);
    if (!applied) return false;
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    // Record the TRUTH box for the hysteresis above — the STRICT viewport the painter actually
    // repainted (the old 40%-padded box claimed truth over a ring the tile queries can never
    // cover; that ring was black land = the pan/zoom "rectangle holes"). Zoom-ins inside the box
    // still skip; any pan escaping it repaints (throttled + tile-gated at the layer).
    if (curView) {
      this._regionalPatchState = { gridKey, box: { ...curView } };
    }
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.basemapWaterMask = { applied: true, at: new Date().toISOString() };
    }
    // DEEP-ZOOM CRISPNESS (2026-07-04 round 6): past ~z12 the regional canvas (1° @ 4096 ≈ 27 m/
    // texel) halos the wash over waterfront roads — ALSO paint the crisp viewport overlay. The
    // shaders min()-combine it with the regional base for non-wide grids, so the regional
    // sheltered verdict and land truth both survive; the overlay only ever REMOVES wash.
    try {
      let _z2; try { _z2 = mapInstance.getZoom(); } catch (e2) { _z2 = 0; }
      if (_z2 >= 12) this.refreshViewportOverlayMask(gl, mapInstance);
    } catch (e2) { /* overlay is an enhancement */ }
    return true;
  } catch (e) {
    console.warn('[WebGLMarineEngine] basemap-water mask refresh skipped:', e && e.message);
    return false;
  }
};

// VIEWPORT-TRUTH OVERLAY MASK (2026-07-04): while a WIDE (world) grid is resident at close zoom,
// paint the basemap-truth mask for the PADDED VIEWPORT into a dedicated texture the shaders
// consult ONLY inside its bounds (u_overlayMask* uniforms). Per-pixel fallback to the grid's own
// mask makes staleness harmless: after a fast pan the overlay covers where the user WAS, those
// pixels are off-screen, and everything visible degrades to the coarse-but-sane base mask until
// the idle/zoomend refresh repaints. Kill switch rides __RAW_BASEMAP_WATER_MASK__ (caller-gated).
WebGLMarineEngine.prototype.refreshViewportOverlayMask = function(gl, mapInstance, basinScale) {
  const geo = this._cachedMaskGeoJSON;
  if (!geo || !gl || !mapInstance) return false;
  let z;
  try { z = mapInstance.getZoom(); } catch (e) { return false; }
  // z≥7 (was 9): between z7-9 the 39 km world mask is still visibly wrong along coasts — the
  // "land covered while zooming out for a while" report. Below z7 coarse texels read acceptably
  // and the padded viewport outgrows the useful canvas tiers.
  if (z < 7) return false;
  let bounds;
  let view = null;
  let viewSpan = 0;
  try {
    const b = mapInstance.getBounds();
    view = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    viewSpan = b.getEast() - b.getWest();
    // 50% pad (was 15%): each paint survives several pan/zoom gestures before the hysteresis
    // below forces a repaint — the paint itself is the choppiness (stair-climb forensics: 38
    // paints × 50–250 ms main-thread each in a 22 s interaction).
    const padX = viewSpan * 0.5;
    const padY = (b.getNorth() - b.getSouth()) * 0.5;
    bounds = {
      west: b.getWest() - padX,
      south: Math.max(-85, b.getSouth() - padY),
      east: b.getEast() + padX,
      north: Math.min(85, b.getNorth() + padY),
    };
    // TWO SPANS by combine mode (live lagoon-bleed catch at z12.5): overlays for REGIONAL grids
    // min()-combine with a base that already carries the sheltered verdict, so they stay CRISP
    // (0.05° floor, ~1 m/texel — the 0.7° attempt haloed canal-side roads). Overlays for WIDE
    // grids REPLACE the base sample, so they must be basin-scale (0.7° ⇒ the painter's ≥0.5°
    // sheltered gate runs and enclosed lagoons stay suppressed through the world-grid window).
    const MIN_SPAN = basinScale ? 0.7 : 0.05;
    if (bounds.east - bounds.west < MIN_SPAN) {
      const cx = (bounds.east + bounds.west) / 2;
      bounds.west = cx - MIN_SPAN / 2; bounds.east = cx + MIN_SPAN / 2;
    }
    if (bounds.north - bounds.south < MIN_SPAN) {
      const cy = (bounds.north + bounds.south) / 2;
      bounds.south = Math.max(-85, cy - MIN_SPAN / 2); bounds.north = Math.min(85, cy + MIN_SPAN / 2);
    }
    // HYSTERESIS (the stair-climb fix): if the previous paint's TRUTH box (the strict viewport it
    // actually repainted from tile truth — NOT the padded texture bounds, whose ring is only NE
    // base truth) still CONTAINS the current viewport AND its resolution is still adequate (span
    // not more than ~5× the viewport — i.e. the user hasn't zoomed far past its texel density),
    // skip the repaint entirely. Zoom-ins inside the truth box cost NOTHING; escaping it repaints
    // once (throttled at the layer, tile-gated below).
    const prev = this._overlayMaskBounds;
    const prevTruth = this._overlayMaskTruthBox;
    if (prev && prevTruth && this._overlayMaskTex &&
        prevTruth.west <= view.west && prevTruth.east >= view.east &&
        prevTruth.south <= view.south && prevTruth.north >= view.north &&
        (prev.east - prev.west) <= Math.max(viewSpan, 0.001) * 5) {
      return false; // still fresh — no repaint, no upload
    }
  } catch (e) { return false; }
  // TILE-READINESS GATE (the "rectangle holes" root): never paint truth from a mid-load source —
  // skip and let the `idle`-driven refresh land the paint when every covering tile is queryable.
  if (!isBasemapWaterSourceReady(mapInstance)) return false;
  try {
    // 2048 cap: an overlay spans ≤ ~1°, so 2048 px keeps ≤ ~3 m/texel at deep zoom while the
    // paint + texImage2D upload cost 4× less than the 4096 tier (8 MB vs 32 MB per refresh).
    const canvas = renderMaskToCanvas(geo, bounds, { maxWidth: 2048 });
    const applied = overlayBasemapWaterOnMask(canvas, bounds, mapInstance);
    if (!applied) return false;
    if (!this._overlayMaskTex) {
      this._overlayMaskTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._overlayMaskTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    gl.bindTexture(gl.TEXTURE_2D, this._overlayMaskTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    this._overlayMaskBounds = bounds;
    // The region the painter truth-painted from tiles = the strict viewport at paint time; the
    // canvas ring outside it holds NE base truth (sane but coarser). Hysteresis keys on this box.
    this._overlayMaskTruthBox = view;
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.basemapWaterMask = { applied: true, at: new Date().toISOString(), overlay: true, bounds, truthBox: view };
    }
    return true;
  } catch (e) {
    console.warn('[WebGLMarineEngine] viewport overlay mask refresh skipped:', e && e.message);
    return false;
  }
};

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
WebGLMarineEngine.prototype._drawCoarseBasePass = function(gl, mat4, themeVal, time, baseOpacity, overlay) {
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
  // The base binds its OWN world mask (encoded with the base grid), so its mask bounds = its grid.
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_maskBounds_min'), bb.west, bb.south);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_maskBounds_max'), bb.east, bb.north);
  // Viewport-truth overlay on the base wash (2026-07-04 zoom-out): the base is a WORLD grid whose
  // 39 km mask bleeds over land at z8+ — inside the overlay's bounds REPLACE the base sample at
  // meter truth (same rationale as the wide-grid main pass); per-pixel fallback everywhere else.
  const _bovOn = !!(overlay && overlay.tex && overlay.bounds);
  const _bob = _bovOn ? overlay.bounds : { west: 0, south: 0, east: 0, north: 0 };
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_overlayMaskTexture'), 4);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayMaskEnabled'), _bovOn ? 1.0 : 0.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayReplace'), _bovOn ? 1.0 : 0.0);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayBounds_min'), _bob.west, _bob.south);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayBounds_max'), _bob.east, _bob.north);
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
  bindTexture(gl, _bovOn ? overlay.tex : base.u_oceanMaskTexture, 4);

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
