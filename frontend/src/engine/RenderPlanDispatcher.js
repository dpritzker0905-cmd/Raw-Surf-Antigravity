/**
 * RenderPlanDispatcher.js — RenderPlan → GPU Renderer Bridge
 *
 * This module bridges the SimulationLoop's evolved field data
 * to the actual GPU renderers (WebGLWindEngine, WebGLMarineEngine).
 *
 * ARCHITECTURE:
 *   SimulationLoop produces RenderPlans with evolved field data at 60Hz.
 *   RenderPlanDispatcher converts that field data into GPU-ready textures
 *   and dispatches them to the registered GPU renderers.
 *
 * THIS IS NOT A RENDERER. It is a data bridge:
 *   Evolved SimulationField → GPU texture format → WebGLWindEngine.setWindData()
 *
 * RULES:
 *   - NO simulation logic
 *   - NO MapLibre references
 *   - NO React
 *   - Pure data transformation + dispatch
 */

import { onRenderPlan } from './SimulationLoop';

// ========================================================================
// RENDERER REGISTRY
// ========================================================================

let _windEngine = null;
let _windGL = null;
let _marineEngine = null;
let _marineGL = null;
let _unsubscribe = null;
let _lastFieldRevision = 0;
let _dispatchCount = 0;

// Throttle GPU texture uploads to ~10Hz (every 6th frame at 60Hz)
// GPU texture upload is expensive — don't do it every frame
const DISPATCH_INTERVAL = 6;



// ========================================================================
// FIELD → GPU TEXTURE CONVERSION
// ========================================================================

/**
 * Convert SimulationField's Float32Array wind grids into the format
 * expected by WebGLWindEngine.setWindData().
 *
 * WebGLWindEngine expects: { vectors: [{u,v,speed}], cols, rows, bounds }
 * SimulationField has:     { grid: { windU: Float32Array, windV: Float32Array }, cols, rows, bounds }
 *
 * @param {import('./SimulationField').SimulationField} field
 * @returns {Object|null} Wind grid in WebGLWindEngine format
 */
function fieldToWindGrid(field) {
  if (!field || !field.sources.wind) return null;

  const { windU, windV } = field.grid;
  const { cols, rows, bounds } = field;
  const size = cols * rows;

  // Build vectors array from typed arrays
  const vectors = new Array(size);
  for (let i = 0; i < size; i++) {
    const u = windU[i];
    const v = windV[i];
    vectors[i] = {
      u,
      v,
      speed: Math.sqrt(u * u + v * v),
    };
  }

  return {
    vectors,
    cols,
    rows,
    bounds: {
      west: bounds.west,
      south: bounds.south,
      east: bounds.east,
      north: bounds.north,
    },
  };
}

/**
 * Convert SimulationField's wave data into marine renderer format,
 * mapping active sub-layer variables (waves, swell_1, swell_2, wind_waves)
 * to prevent SimulationLoop background updates from overriding active layers.
 *
 * @param {import('./SimulationField').SimulationField} field
 * @param {string} activeMarineLayer - Which sub-layer is currently active
 * @returns {Object|null} Marine data in renderer format
 */
function fieldToMarineGrid(field, activeMarineLayer) {
  if (!field || !field.sources.marine) return null;

  const { waveHeight, waveDir, swellHeight, swellDir, swell2Height, swell2Dir, windWaveHeight, windWaveDir, landMask, wavePeriod, swellPeriod, swell2Period, windWavePeriod } = field.grid;
  const { cols, rows, bounds } = field;
  const size = cols * rows;

  let hSrc = waveHeight;
  let dirSrc = waveDir;
  let periodSrc = wavePeriod;

  if (activeMarineLayer === 'swell_1') {
    hSrc = swellHeight;
    dirSrc = swellDir;
    periodSrc = swellPeriod;
  } else if (activeMarineLayer === 'swell_2') {
    // v5.0: Fix — swell_2 now correctly uses secondary swell fields
    // instead of duplicating primary swell data
    hSrc = swell2Height;
    dirSrc = swell2Dir;
    periodSrc = swell2Period;
  } else if (activeMarineLayer === 'wind_waves') {
    hSrc = windWaveHeight;
    dirSrc = windWaveDir;
    periodSrc = windWavePeriod;
  }

  const vectors = new Array(size);
  let nonzeroCount = 0;
  let maxHeight = 0;
  let sumHeight = 0;
  for (let i = 0; i < size; i++) {
    const h = hSrc ? hSrc[i] : waveHeight[i];
    const dir = (dirSrc ? dirSrc[i] : waveDir[i]) * (Math.PI / 180);
    const period = periodSrc ? periodSrc[i] : 0;
    if (h > 0) {
      nonzeroCount++;
      if (h > maxHeight) maxHeight = h;
      sumHeight += h;
    }
    // Convert wave height + direction to u/v for advection visualization (meteorological velocity vector)
    // isOcean flag is REQUIRED by WebGLMarineEngine's shader (alpha channel = land mask)
    vectors[i] = {
      u: -h * Math.sin(dir),
      v: -h * Math.cos(dir),
      speed: h,
      height: h,
      direction: dirSrc ? dirSrc[i] : waveDir[i],
      period: period,
      swellHeight: swellHeight ? swellHeight[i] : 0,
      swellDir: swellDir ? swellDir[i] : 0,
      isOcean: landMask ? (landMask[i] === 0) : (h > 0),
    };
  }
  const meanHeight = nonzeroCount > 0 ? sumHeight / nonzeroCount : 0;

  return {
    vectors,
    cols,
    rows,
    bounds: {
      west: bounds.west,
      south: bounds.south,
      east: bounds.east,
      north: bounds.north,
    },
    nonzeroCount,
    maxHeight,
    meanHeight
  };
}

// ========================================================================
// DISPATCH LOGIC
// ========================================================================

/**
 * Called by SimulationLoop via onRenderPlan subscriber.
 * Converts evolved field data to GPU format and dispatches to renderers.
 *
 * @param {Object} renderPlan - Latest RenderPlan from SimulationLoop
 * @param {number} frameIndex - Current simulation frame
 */
function dispatchRenderPlan(renderPlan, frameIndex) {
  if (!renderPlan) return;

  _dispatchCount++;

  // Throttle GPU texture uploads
  if (_dispatchCount % DISPATCH_INTERVAL !== 0) return;

  // Get the evolved field from the renderPlan
  const field = renderPlan._evolvedField;
  if (!field) return;

  // ---- Dispatch to Wind Engine ----
  if (_windEngine && _windGL && field.sources.wind) {
    try {
      const windGrid = fieldToWindGrid(field);
      if (windGrid) {
        _windEngine.setWindData(_windGL, windGrid);
      }
    } catch (e) {
      console.warn('[RenderPlanDispatcher] Wind texture upload error:', e.message);
    }
  }

  if (_marineEngine && _marineGL && field.sources.marine) {
    const activeMarineLayer = renderPlan.waveField.marineLayer || 'waves';
    try {
      const marineGrid = fieldToMarineGrid(field, activeMarineLayer);
      if (marineGrid) {
        _marineEngine._dispatcherActive = true;
        _marineEngine.setWaveData(_marineGL, marineGrid);
        // Diagnostic: expose dispatch status for console verification
        if (typeof window !== 'undefined') {
          window.__FCE_DISPATCH_STATUS__ = {
            lastDispatchFrame: _dispatchCount,
            marineVectors: marineGrid.vectors.length,
            activeLayer: activeMarineLayer,
            nonzeroCount: marineGrid.nonzeroCount,
            maxHeight: marineGrid.maxHeight,
            meanHeight: marineGrid.meanHeight,
            sourceModel: field.model || 'unknown',
            provider: field.model === 'EURO' ? 'copernicus' : 'open-meteo',
            isOverridingReactData: true,
            timestamp: Date.now()
          };
        }
      }
    } catch (e) {
      console.warn('[RenderPlanDispatcher] Marine texture upload error:', e.message);
    }
  }
}

// ========================================================================
// REGISTRATION API (called from React components)
// ========================================================================

/**
 * Register a wind GPU engine for receiving evolved field data.
 *
 * @param {Object} engine - WebGLWindEngine instance
 * @param {WebGLRenderingContext} gl - WebGL context
 */
export function registerWindEngine(engine, gl) {
  _windEngine = engine;
  _windGL = gl;
  console.log('[RenderPlanDispatcher] Wind engine registered');
}

/**
 * Unregister the wind engine.
 */
export function unregisterWindEngine() {
  _windEngine = null;
  _windGL = null;
}

/**
 * Register a marine GPU engine for receiving evolved field data.
 *
 * @param {Object} engine - Marine engine instance
 * @param {WebGLRenderingContext} gl - WebGL context
 */
export function registerMarineEngine(engine, gl) {
  _marineEngine = engine;
  _marineGL = gl;
  console.log('[RenderPlanDispatcher] Marine engine registered');
}

/**
 * Unregister the marine engine.
 */
export function unregisterMarineEngine() {
  _marineEngine = null;
  _marineGL = null;
}

// ========================================================================
// LIFECYCLE
// ========================================================================

/**
 * Start the dispatcher — subscribes to SimulationLoop's RenderPlan output.
 */
export function startDispatcher() {
  if (_unsubscribe) return;
  _unsubscribe = onRenderPlan(dispatchRenderPlan);
  console.log('[RenderPlanDispatcher] Started — GPU renderers will receive evolved field data');
}

/**
 * Stop the dispatcher.
 */
export function stopDispatcher() {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
}

/**
 * Get dispatcher diagnostics.
 */
export function getDispatcherDiagnostics() {
  return {
    running: !!_unsubscribe,
    windEngineRegistered: !!_windEngine,
    marineEngineRegistered: !!_marineEngine,
    dispatchCount: _dispatchCount,
    lastFieldRevision: _lastFieldRevision,
  };
}
