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
  // BASE+OVERLAY (2026-07-19, queue #9): _windData stays the BASE grid (every probe/telemetry
  // consumer keeps working); _windFine is a resident viewport-fine grid rendered ON TOP of it.
  // Populated only when a regional grid commits while a GLOBAL base is resident with the same
  // model+hour — so default (always-global) traffic never engages this path at all.
  this._windFine = null;
  this._colorRamp = null; // v3.9.8: Color ramp LUT texture
  this._maxWindSpeed = 50; // knots: typical range 0-50kn for color ramp
  this._currentTheme = null; // Track theme for ramp updates

  // Diagnostic: expose wind engine for console verification
  if (typeof window !== 'undefined') {
    window.__WIND_ENGINE__ = this;
  }
}
export default WebGLWindEngine;

// ── BASE+OVERLAY helpers (pure; exported for the gate tests) ──

export function windGridIsGlobal(windGrid) {
  var b = windGrid && windGrid.bounds;
  if (!b) return false;
  var crosses = b.west > b.east;
  var lngSpan = crosses ? (b.east + 360.0) - b.west : b.east - b.west;
  return (lngSpan >= 350.0) || windGrid.coverage_scope === 'global' || windGrid.coverage_scope === 'global_coarse';
}

export function windGridModel(windGrid) {
  // source FIRST — the WeatherEngine choke and the layer's keepTrails compare data.source; the
  // engine must agree with them or a fine grid could route into base-replacement instead of
  // overlay filing when truthTag and source disagree.
  return (windGrid && (windGrid.source || windGrid.truthTag?.model)) || null;
}

// Same model AND same committed hour — the two textures may only composite when they describe
// the same air at the same time (truth first: never blend two hours or two models).
export function windGridsCompatible(a, b) {
  if (!a || !b) return false;
  var ma = windGridModel(a);
  var mb = windGridModel(b);
  if (!ma || !mb || ma !== mb) return false;
  if ((a.hourOffset || 0) !== (b.hourOffset || 0)) return false;
  var va = a.valid_time || a.validTime;
  var vb = b.valid_time || b.validTime;
  if (va && vb) {
    var ta = Date.parse(va);
    var tb = Date.parse(vb);
    // Fine products are 3-HOURLY while base series frames are HOURLY, so a resident fine grid
    // can legitimately sit up to 2 h from the base frame (hours ≡ 2 mod 3). The first window
    // (±90 min) dropped the overlay exactly there — the user's "low pressure vanishes at every
    // zoom" hour. ±180 min covers the full 3-hourly step distance; coverage-over-freshness: a
    // 2 h-old FINE circulation beats a fresh 10° smear for reading a live system.
    if (isFinite(ta) && isFinite(tb) && Math.abs(ta - tb) > 180 * 60 * 1000) return false;
  }
  return true;
}

export function windBaseOverlayEnabled(win) {
  var w = win || (typeof window !== 'undefined' ? window : null);
  return !(w && w.__RAW_DISABLE_WIND_BASE_OVERLAY__ === true);
}

// Approx cell size in degrees longitude — a resolution proxy for base/overlay ordering.
export function windGridCellDeg(g) {
  if (!g || !g.bounds || !g.cols || g.cols < 2) return Infinity;
  var b = g.bounds;
  var spanLng = b.west > b.east ? (b.east + 360.0) - b.west : b.east - b.west;
  return spanLng / (g.cols - 1);
}

// True when `a` is CLEARLY coarser than `b` (a's cells ≥1.3× b's). The FINE overlay must SHARPEN
// the base; a coarser grid there (e.g. a 5x4 `swr_revalidation_pending` SWR preview over the sharp
// 2° world base) renders a blocky patch/lattice on top of good data — the user's "grid shape /
// small clamp". Such a grid must never be filed as, or promoted into, the overlay.
export function windGridClearlyCoarserThan(a, b) {
  var ca = windGridCellDeg(a), cb = windGridCellDeg(b);
  if (!isFinite(ca) || !isFinite(cb) || cb <= 0) return false;
  return ca > cb * 1.3;
}

export function windCoarseOverlayGuardEnabled(win) {
  var w = win || (typeof window !== 'undefined' ? window : null);
  return !(w && w.__RAW_DISABLE_WIND_COARSE_OVERLAY_GUARD__ === true);
}

// Product IDENTITY (2026-07-20, the React Scan finding): metadata equality, not content diff.
// Every field that can change the data changes one of these; two grids that agree on all of
// them are the same served product, and re-committing it is pure GL waste (texture re-upload +
// reseed = the measured 235.9 ms "other time" behind the 5x FPS drops).
export function windGridsIdentical(a, b) {
  if (!a || !b) return false;
  if (windGridModel(a) !== windGridModel(b)) return false;
  if ((a.hourOffset || 0) !== (b.hourOffset || 0)) return false;
  if ((a.valid_time || a.validTime || null) !== (b.valid_time || b.validTime || null)) return false;
  if ((a.stale === true) !== (b.stale === true)) return false;
  if ((a.product_id || null) !== (b.product_id || null)) return false;
  var ba = a.bounds, bb = b.bounds;
  if (!ba || !bb) return false;
  if (ba.west !== bb.west || ba.east !== bb.east || ba.south !== bb.south || ba.north !== bb.north) return false;
  if ((a.cols || 0) !== (b.cols || 0) || (a.rows || 0) !== (b.rows || 0)) return false;
  if ((a.truthTag?.product || null) !== (b.truthTag?.product || null)) return false;
  var na = a.vectors ? a.vectors.length : 0;
  if (na !== (b.vectors ? b.vectors.length : 0)) return false;
  // 5-point content sample: a new model RUN can refresh values behind identical metadata
  // (same valid_time/bounds/dims, and mapped grids may carry no product_id) — metadata alone
  // would wrongly no-op that refresh.
  if (na > 0) {
    var probes = [0, na >> 2, na >> 1, (3 * na) >> 2, na - 1];
    for (var pi = 0; pi < probes.length; pi++) {
      var pa = a.vectors[probes[pi]], pb = b.vectors[probes[pi]];
      if (!pa || !pb || pa.u !== pb.u || pa.v !== pb.v) return false;
    }
  }
  return true;
}

// WIDE-ZOOM HANDLING, round 2 (2026-07-19 late). Round 1 faded the whole overlay out at wide
// zoom — and the user immediately caught the crime: "when you removed the grid, so went the low
// pressure system." The fine box's INTERIOR held the only data resolving the circulation;
// fading data to fix a frame artifact inverts the truth-first contract. The corrected split:
//   - the fine DATA never fades (colour == speed at every zoom; a circulation must never vanish);
//   - only the box EDGE dissolves — the feather band widens as the viewport dwarfs the box, so
//     the rectangle reading disappears while the core keeps full truth;
//   - only the vortex PERSISTENCE lever rides the fade (it hoards the fixed particle population
//     into the box at wide zoom — the "no animations over Texas" depletion; arc-reading is a
//     close-zoom concern).
// Pure + exported for the gate tests. Kill: __RAW_DISABLE_WIND_WIDEFADE__ (fade pinned to 1,
// feather stays narrow).
export function windFineWideFade(coverage) {
  return Math.max(0, Math.min(1, (coverage - 0.15) / 0.30));
}

// Edge-dissolve width: the shipped absolute-0.6° rule at full coverage, widening to 30% of the
// box span per side as coverage vanishes — the boundary becomes a broad crossfade into the
// base, the core (inner ~40%) keeps full fine data (an invest core of 3-5° fits inside).
export function windFineFeatherFrac(fineSpan, wideFade) {
  const base = Math.min(0.18, 0.6 / Math.max(fineSpan, 1e-6));
  return Math.min(0.30, base + (1 - wideFade) * 0.25);
}

WebGLWindEngine.prototype.init = function(gl) {
  initEngine(this, gl);
};

WebGLWindEngine.prototype.setWindData = function(gl, windGrid) {
  if (!windGrid?.vectors?.length) return 'skipped';

  // NO-OP COMMIT GUARD (2026-07-20). React Scan measured the FPS drops during pans: 41 ms of
  // React vs 235.9 ms of "other time" — the moveend refetch returns the SAME cached product and
  // every re-commit re-uploads textures (and a base replace reseeds particles). This is THE
  // single function every wind commit path calls, so the identity invariant lives here (the
  // distributed-guards lesson). Kill: __RAW_DISABLE_WIND_COMMIT_NOOP__.
  if (!(typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_COMMIT_NOOP__ === true)) {
    var residentSameSlot = null;
    if (this._windData?.windGrid
        && windGridIsGlobal(windGrid) === windGridIsGlobal(this._windData.windGrid)) {
      residentSameSlot = this._windData.windGrid;
    } else if (this._windFine?.windGrid && !windGridIsGlobal(windGrid)) {
      residentSameSlot = this._windFine.windGrid;
    }
    if (residentSameSlot && windGridsIdentical(residentSameSlot, windGrid)) return 'noop';
  }
  var verdict = 'base';

  // COARSE-OVERLAY GUARD (2026-07-21, user "grid shape / small clamp"). The FINE overlay must
  // SHARPEN the base. A compatible regional grid that is CLEARLY coarser than the resident global
  // base (a 5x4 `swr_revalidation_pending` SWR preview over the sharp 2° world base) would render a
  // blocky patch on top of good data — keep the base, ignore the preview. Kill:
  // __RAW_DISABLE_WIND_COARSE_OVERLAY_GUARD__.
  if (windCoarseOverlayGuardEnabled(typeof window !== 'undefined' ? window : null)
      && windBaseOverlayEnabled(typeof window !== 'undefined' ? window : null)
      && !windGridIsGlobal(windGrid)
      && this._windData?.windGrid && windGridIsGlobal(this._windData.windGrid)
      && windGridsCompatible(this._windData.windGrid, windGrid)
      && windGridClearlyCoarserThan(windGrid, this._windData.windGrid)) {
    return 'noop_coarse';
  }

  // BASE+OVERLAY filing (2026-07-19, queue #9). A REGIONAL grid arriving while a GLOBAL base of
  // the same model+hour is resident files as the FINE overlay — the base stays resident, so a
  // pan past the fine box shows base data, never a hole (clamp geometrically impossible). Any
  // other commit takes the legacy replace path; a replaced base drops an incompatible overlay.
  // Kill: __RAW_DISABLE_WIND_BASE_OVERLAY__ -> always legacy replace.
  if (windBaseOverlayEnabled(typeof window !== 'undefined' ? window : null)
      && !windGridIsGlobal(windGrid)
      && this._windData?.windGrid && windGridIsGlobal(this._windData.windGrid)
      && windGridsCompatible(this._windData.windGrid, windGrid)) {
    if (this._windFine?.texture) gl.deleteTexture(this._windFine.texture);
    this._windFine = encodeWindTexture(gl, windGrid);
    if (this._windFine) {
      this._windFine.truthTag = windGrid.truthTag;
      this._windFine.windGrid = windGrid;
      console.log('[WebGLWind] FINE overlay filed over resident global base ('
        + windGrid.cols + 'x' + windGrid.rows + ')');
    }
    verdict = 'fine';
  } else if (windBaseOverlayEnabled(typeof window !== 'undefined' ? window : null)
      && windGridIsGlobal(windGrid)
      && this._windData?.windGrid && !windGridIsGlobal(this._windData.windGrid)
      && windGridsCompatible(windGrid, this._windData.windGrid)) {
    // PROMOTE (the cold-enable-at-fine-zoom ordering): the fine product landed FIRST and became
    // the base; when the global arrives it must not REPLACE the sharper data on screen — it
    // becomes the new base and the resident regional grid MOVES to the overlay slot (texture
    // reference moved, not re-encoded). Found by the vortex probe's failed precondition.
    // COARSE-OVERLAY GUARD (2026-07-21): only KEEP the resident as the overlay if it actually
    // SHARPENS the incoming world base. A coarser resident (an SWR preview that landed first) would
    // render a blocky patch — drop it and take the world base alone.
    var _keepAsFine = !(windCoarseOverlayGuardEnabled(typeof window !== 'undefined' ? window : null)
      && windGridClearlyCoarserThan(this._windData.windGrid, windGrid));
    if (this._windFine?.texture) gl.deleteTexture(this._windFine.texture);
    if (_keepAsFine) {
      this._windFine = this._windData;
    } else {
      if (this._windData?.texture) gl.deleteTexture(this._windData.texture);
      this._windFine = null;
    }
    this._windData = encodeWindTexture(gl, windGrid);
    if (this._windData) {
      this._windData.truthTag = windGrid.truthTag;
      this._windData.windGrid = windGrid;
    }
    console.log('[WebGLWind] GLOBAL base ' + (_keepAsFine
      ? ('promoted under resident regional grid (' + (this._windFine.windGrid?.cols || '?') + 'x' + (this._windFine.windGrid?.rows || '?') + ' moved to overlay)')
      : 'replaced coarse resident preview (dropped, no overlay)'));
    verdict = _keepAsFine ? 'base_promote' : 'base';
  } else {
    if (this._windData?.texture) gl.deleteTexture(this._windData.texture);
    this._windData = encodeWindTexture(gl, windGrid);
    if (this._windData) {
      this._windData.truthTag = windGrid.truthTag;
      this._windData.windGrid = windGrid;
    }
    // A new base invalidates any overlay that no longer describes the same air.
    if (this._windFine && !windGridsCompatible(windGrid, this._windFine.windGrid)) {
      if (this._windFine.texture) gl.deleteTexture(this._windFine.texture);
      this._windFine = null;
    }
  }

  // v3.16: Update _maxWindSpeed from actual data, with sane bounds — across BOTH textures so the
  // shared colour ramp covers whichever grid carries the storm.
  // Floor of 10kn prevents all-calm grids from blowing up the ramp
  // Ceiling of 80kn keeps hurricane-force winds from washing out variation
  if (this._windData || this._windFine) {
    var dataMaxSpeed = Math.max(this._windData?.maxSpeed || 0, this._windFine?.maxSpeed || 0) || 50;
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
  return verdict;
};

/**
 * BASE+OVERLAY (queue #9): free BOTH wind textures. The layer's empty-data path used to null
 * _windData directly; routed here so the fine overlay can never leak a GL texture.
 */
WebGLWindEngine.prototype.clearWindData = function(gl) {
  if (gl && this._windData?.texture) gl.deleteTexture(this._windData.texture);
  if (gl && this._windFine?.texture) gl.deleteTexture(this._windFine.texture);
  this._windData = null;
  this._windFine = null;
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
  // FEATHER WIDTH (2026-07-19): 0.18 of grid span was tuned for pilot tiles much larger than the
  // viewport; a viewport-fine grid IS ~the viewport, so that band fell inside the screen on all
  // four sides ("clamped wind heatmap"). Absolute width ~0.6 deg (the request pad/snap margin),
  // expressed as a fraction of THIS grid's span, capped at the legacy 0.18 so small pilot tiles
  // (FL 2-deg) keep their shipped look exactly.
  const edgeFeatherFrac = isRegionalGrid ? Math.min(0.18, 0.6 / Math.max(lngSpan, 1e-6)) : 0.18;

  // BASE+OVERLAY (queue #9): a resident fine grid rides on top of the global base. Only active
  // when the base really is global — regional-only mode keeps the legacy single-texture path.
  const fine = (!isRegionalGrid
    && windBaseOverlayEnabled(typeof window !== 'undefined' ? window : null)
    && this._windFine && this._windFine.texture) ? this._windFine : null;
  let fineFeatherFrac = 0.18;
  let fineCrosses = false;
  let fineWideFade = 1.0;
  if (fine) {
    const fb = fine.bounds;
    fineCrosses = fb.west > fb.east;
    const fineSpan = fineCrosses ? (fb.east + 360.0) - fb.west : fb.east - fb.west;
    fineFeatherFrac = Math.min(0.18, 0.6 / Math.max(fineSpan, 1e-6));
    // Vortex-lever cell geometry (computed HERE because the heatmap debug view — Step 0 —
    // needs it before the advect step does). cell_km.x carries the box's mean cosLat.
    const fCols = Math.max(2, fine.windGrid?.cols || 2);
    const fRows = Math.max(2, fine.windGrid?.rows || 2);
    const meanCos = Math.max(0.2, Math.cos((fb.south + fb.north) * 0.5 * Math.PI / 180));
    this._fineTexel = [1.0 / (fCols - 1), 1.0 / (fRows - 1)];
    this._fineCellKm = [(fineSpan / (fCols - 1)) * 111.32 * meanCos, ((fb.north - fb.south) / (fRows - 1)) * 110.57];
    // WIDE-ZOOM: coverage-driven fade for the PERSISTENCE lever + edge-dissolve widening.
    // The fine DATA itself never fades (truth first — the round-1 mistake erased a live low).
    if (viewportBounds && !(typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_WIDEFADE__ === true)) {
      const vpLng = (viewportBounds[2] < viewportBounds[0])
        ? (viewportBounds[2] + 360 - viewportBounds[0]) : (viewportBounds[2] - viewportBounds[0]);
      const vpLat = Math.max(0.01, viewportBounds[3] - viewportBounds[1]);
      const cov = Math.min(1, fineSpan / Math.max(vpLng, 0.01)) * Math.min(1, (fb.north - fb.south) / vpLat);
      fineWideFade = windFineWideFade(cov);
      fineFeatherFrac = windFineFeatherFrac(fineSpan, fineWideFade);
    }
  }
  if (typeof window !== 'undefined') {
    window.__WIND_COVERAGE_STATUS__ = isRegionalGrid
      ? 'partial_regional_coverage'
      : 'full_coverage';
    window.__WIND_FINE_OVERLAY__ = fine
      ? { active: true, bounds: fine.bounds, cols: fine.windGrid?.cols, rows: fine.windGrid?.rows,
          wideFade: +fineWideFade.toFixed(2) }
      : { active: false };
  }

  const dataBoundsMinX = isRegionalGrid ? bounds.west : -180.0;
  const dataBoundsMaxX = isRegionalGrid ? bounds.east : 180.0;

  // ACCESSIBILITY (R11-09 port, 2026-08-09): honor prefers-reduced-motion by damping particle
  // drift to 0.15× — verbatim from the marine engine's 2026-07-03 §6.4 implementation, which was
  // never mirrored here: 147,456 wind particles (the busiest motion surface in the app) ran at
  // full speed for reduced-motion users, against the CLAUDE.md accessibility mandate. The
  // heatmap (the actual data) is untouched; only decorative motion slows. Cached matchMedia;
  // test override window.__RAW_REDUCED_MOTION__ (true = force damp, false = force off).
  if (this._prefersReducedMotion === undefined) {
    try {
      this._prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { this._prefersReducedMotion = false; }
  }
  const _rmOverride = (typeof window !== 'undefined' && typeof window.__RAW_REDUCED_MOTION__ === 'boolean')
    ? window.__RAW_REDUCED_MOTION__ : null;
  const _rmScale = (_rmOverride !== null ? _rmOverride : this._prefersReducedMotion) ? 0.15 : 1.0;

  // v3.23: Disable the minimum advection step clamp at high zooms (z > 6) since
  // we use tile-relative coordinates. This prevents the wind animation from
  // exploding in speed. Also, we scale the tile coordinate size to increase precision.
  const stableSpeedScale = ((z > 6.0)
    ? (this.speedFactor * Math.pow(0.5, z) * 0.00025)
    : Math.max(2.5e-6, this.speedFactor * Math.pow(0.5, z) * 0.00025)) * _rmScale;

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
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_edge_feather_frac'), edgeFeatherFrac);
  // BASE-PASS CUTOUT (queue #9): fade the base out exactly where the fine overlay fades in so the
  // two semi-transparent passes crossfade instead of compounding. Skipped when the fine box
  // crosses the antimeridian (rect wraps in base-UV space); the compound there is feathered and
  // brief, and correctness of DATA is unaffected.
  // SINGLE-PASS BASE+FINE (2026-07-20, the hairline-seam fix): with the fine box mapped into
  // base-UV space below, the base pass samples BOTH textures and mixes the WIND in-shader —
  // one draw, one alpha, so the two-pass crossfade band (and its bright hairline rectangle)
  // cannot exist. Legacy two-pass path kept behind the kill switch AND for the vortex debug
  // view (which paints on the overlay pass). Kill: __RAW_DISABLE_WIND_HEATMAP_SINGLEPASS__.
  var _vortexDebugOn = (typeof window !== 'undefined' && window.__GPU_DEBUG__ && window.__GPU_DEBUG__.mode === 'vortex');
  var heatmapSinglePass = !!(fine && !fineCrosses && !_vortexDebugOn
    && !(typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_HEATMAP_SINGLEPASS__ === true));
  if (fine && !fineCrosses) {
    const fb = fine.bounds;
    const cutMinX = (fb.west - dataBoundsMinX) / (dataBoundsMaxX - dataBoundsMinX);
    const cutMaxX = (fb.east - dataBoundsMinX) / (dataBoundsMaxX - dataBoundsMinX);
    const cutMinY = (fb.south - bounds.south) / Math.max(bounds.north - bounds.south, 1e-6);
    const cutMaxY = (fb.north - bounds.south) / Math.max(bounds.north - bounds.south, 1e-6);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_cutout_enabled'), 1.0);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_cutout_min'), cutMinX, cutMinY);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_cutout_max'), cutMaxX, cutMaxY);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_cutout_feather'), fineFeatherFrac);
    // full strength — the overlay's data no longer fades, so the cutout mirrors its full edge
    // (both share fineFeatherFrac, so the widened dissolve stays complementary)
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_cutout_strength'), 1.0);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_fine_singlepass'), heatmapSinglePass ? 1.0 : 0.0);
    if (heatmapSinglePass) {
      gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_wind_fine'), 2);
      gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_fine_min'), fine.uMin[0], fine.uMin[1]);
      gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_fine_max'), fine.uMax[0], fine.uMax[1]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, fine.texture);
      gl.activeTexture(gl.TEXTURE0);
    }
  } else {
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_cutout_enabled'), 0.0);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_fine_singlepass'), 0.0);
  }
  // FIELD == LUT (2026-07-19): the heatmap samples the same Beaufort ramp texture the particles
  // use — one palette everywhere, and the 0-21 kn band regains its full hue range.
  // Kill: __RAW_DISABLE_WIND_FIELD_LUT__ -> the legacy inline 7-stop ramp.
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_color_ramp'), 1);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_field_lut'),
    (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_FIELD_LUT__ === true) ? 0.0 : 1.0);
  // 07-20 slow-wind visibility raise kill switch: restores the 07-19 calm-alpha constant set
  // (dark 0.28/light 0.35/beach 0.45, 7 kn ramp) in BOTH the field and the casing model.
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_calm_alpha_kill'),
    (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_CALM_ALPHA_V3__ === true) ? 1.0 : 0.0);

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
  if (this._colorRamp) bindTexture(gl, this._colorRamp, 1);
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
    // OVERLAY PASS (queue #9) — LEGACY path only (kill switch / vortex debug / antimeridian
    // boxes): the single-pass composite above replaces it, drawing base+fine in one pass so the
    // crossfade band cannot compound (the 2026-07-20 hairline-seam fix). When single-pass is
    // active this second draw is SKIPPED entirely.
    if (fine && !heatmapSinglePass) {
      gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_min'), fine.bounds.west, fine.bounds.south);
      gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_max'), fine.bounds.east, fine.bounds.north);
      gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_wind_min'), fine.uMin[0], fine.uMin[1]);
      gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_wind_max'), fine.uMax[0], fine.uMax[1]);
      gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_edgeFeatherEnabled'), 1.0);
      gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_edge_feather_frac'), fineFeatherFrac);
      gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_cutout_enabled'), 0.0);
      // VORTEX GATE DEBUG VIEW: __GPU_DEBUG__.mode='vortex' paints the R-gate on THIS pass only
      // (the base pass keeps its normal render — 10-deg cells cannot resolve a vortex anyway).
      var _vortexDebug = (typeof window !== 'undefined' && window.__GPU_DEBUG__ && window.__GPU_DEBUG__.mode === 'vortex') ? 9.0 : debugModeVal;
      gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_debug_mode'), _vortexDebug);
      gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_fine_texel'), this._fineTexel[0], this._fineTexel[1]);
      gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_fine_cell_km'), this._fineCellKm[0], this._fineCellKm[1]);
      bindTexture(gl, fine.texture, 0);
      for (var fhi = 0; fhi < heatOffsets.length; fhi++) {
        gl.uniform1f(heatOffsetLoc, heatOffsets[fhi]);
        gl.drawElements(gl.TRIANGLES, this.heatmapIndexCount, gl.UNSIGNED_SHORT, 0);
      }
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
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_vp_density_boost'),
    (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_VIEWPORT_DENSITY__ === true) ? 0.0 : 1.0);
  // ANTIMERIDIAN RESPAWN WRAP (the wind seam at lng 180) — see ADVECT_FS. Kill restores the
  // legacy edge clamp that stacked up to 23% of all particles onto the +-180 meridian.
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_respawn_lng_wrap'),
    (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_RESPAWN_LNG_WRAP__ === true) ? 0.0 : 1.0);
  // Bounded drop rate — stops steady-state density from tracking (the inverse of) wind speed.
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_density_uniform'),
    (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_DENSITY_UNIFORM__ === true) ? 0.0 : 1.0);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speed_gamma'), _windTune.speedGamma);
  // Size monotonicity (2026-07-19): slower never draws larger than faster. Mirrored into the
  // advect stage's ink budget. Kill: __RAW_DISABLE_WIND_SIZE_MONOTONIC__.
  var _sizeMono = (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_SIZE_MONOTONIC__ === true) ? 0.0 : 1.0;
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_size_monotonic'), _sizeMono);
  var _calmMarks = (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_CALM_MARKS__ === true) ? 0.0 : 1.0;
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_calm_marks'), _calmMarks);
  var _czDensity = (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_CLOSEZOOM_DENSITY__ === true) ? 0.0 : 1.0;
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_closezoom_density'), _czDensity);
  const _speedMax = Math.max(1, Math.hypot(this._windData.uMax[0] || 0, this._windData.uMax[1] || 0));
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speed_max'), _speedMax);
  // BASE+OVERLAY (queue #9): advect from the fine field where it exists (unit 2).
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_wind_fine'), 2);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_fine_enabled'), fine ? 1.0 : 0.0);
  if (fine) {
    gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_fine_wide_fade'), fineWideFade);
    gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_fine_min'), fine.uMin[0], fine.uMin[1]);
    gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_fine_max'), fine.uMax[0], fine.uMax[1]);
    gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_fineBounds_min'), fine.bounds.west, fine.bounds.south);
    gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_fineBounds_max'), fine.bounds.east, fine.bounds.north);
    gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_fine_feather_frac'), fineFeatherFrac);
    // R-GATED VORTEX LEVERS (queue #2): cell geometry precomputed in the fine block above.
    gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_vortex_levers'),
      (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_VORTEX_LEVERS__ === true) ? 0.0 : 1.0);
    gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_fine_texel'), this._fineTexel[0], this._fineTexel[1]);
    gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_fine_cell_km'), this._fineCellKm[0], this._fineCellKm[1]);
  } else {
    gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_vortex_levers'), 0.0);
  }
  unbindTexture(gl, this.particleStateB);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.particleStateB, 0);
  gl.viewport(0, 0, this.particleRes, this.particleRes);
  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._windData.texture, 1);
  if (fine) bindTexture(gl, fine.texture, 2);
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
  // casing mirror of the 07-20 calm-alpha kill switch — both programs must agree or the pole
  // choice models a field alpha that is not on screen (the round-6 failure class).
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_calm_alpha_kill'),
    (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_CALM_ALPHA_V3__ === true) ? 1.0 : 0.0);
  // Oriented dash — direction is carried by ELONGATION, not by mark area.
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_dash'),
    (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_DASH__ === true) ? 0.0 : 1.0);
  // COMPOSITED BACKGROUND (round 6). The wind field is SEMI-TRANSPARENT, so a particle sits on the
  // ramp blended over the BASEMAP — in light mode only ~23% ramp at low wind. The casing must pick
  // its pole from that composite, not from the ramp colour, or it inverts (measured 1.71:1 at
  // light/0kn where 12.25:1 was available). These two uniforms let DRAW_FS reconstruct it.
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_field_opacity'), heatmapOpacity);
  // Approximate LINEAR luminance of each theme's basemap behind the wind layer.
  var _basemapY = effectiveTheme === 'light' ? 0.72 : (effectiveTheme === 'beach' ? 0.30 : 0.02);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_basemap_y'), _basemapY);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_lowwind_boost'),
    (typeof window !== 'undefined' && window.__RAW_DISABLE_LOWWIND_LEGIBILITY__ === true) ? 0.0 : 1.0);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_size_monotonic'),
    (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_SIZE_MONOTONIC__ === true) ? 0.0 : 1.0);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_calm_marks'),
    (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_CALM_MARKS__ === true) ? 0.0 : 1.0);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_closezoom_density'),
    (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_CLOSEZOOM_DENSITY__ === true) ? 0.0 : 1.0);
  // MOBILE: gl_PointSize is in DEVICE pixels and this pipeline had no DPR handling at all, so the
  // size floor above was ~3x physically smaller on a DPR-3 phone. Clamped [1,3] so an unusual
  // ratio cannot blow the sprite budget. Override for testing: __RAW_WIND_DPR__.
  var _dpr = (typeof window !== 'undefined' && Number(window.__RAW_WIND_DPR__))
    || (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_dpr'), Math.max(1, Math.min(3, _dpr)));
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_edgeFeatherEnabled'), edgeFeatherVal);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_edge_feather_frac'), edgeFeatherFrac);
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
  // BASE+OVERLAY (queue #9): the mark reads the same composited field the advection used (unit 3).
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_wind_fine'), 3);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_fine_enabled'), fine ? 1.0 : 0.0);
  if (fine) {
    gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_fine_min'), fine.uMin[0], fine.uMin[1]);
    gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_fine_max'), fine.uMax[0], fine.uMax[1]);
    gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_fineBounds_min'), fine.bounds.west, fine.bounds.south);
    gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_fineBounds_max'), fine.bounds.east, fine.bounds.north);
    gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_fine_feather_frac'), fineFeatherFrac);
  }
  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._windData.texture, 1);
  if (this._colorRamp) bindTexture(gl, this._colorRamp, 2);
  if (fine) bindTexture(gl, fine.texture, 3);
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
