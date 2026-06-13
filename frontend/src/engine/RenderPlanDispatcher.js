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
const _lastGoodGridsCache = {};

function hydrateGridFromLocalStorage(activeModel, activeMarineLayer, hourOffset) {
  try {
    const raw = localStorage.getItem('rawsurf_marine_cache_v9');
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (!cache || !cache.results || !cache.points) return null;

    const sourceModel = cache.model || 'GFS';
    const provider = cache.provider || 'open-meteo';
    const cachedLayer = cache.activeLayer || 'waves';
    if (sourceModel !== activeModel) {
      if (typeof window !== 'undefined') window.__MARINE_BOOTSTRAP_GRID_DIAG__ = { hydrated: false, reason: `Model mismatch: cache=${sourceModel} vs active=${activeModel}`, timestamp: new Date().toISOString() };
      return null;
    }
    if (cachedLayer !== activeMarineLayer) {
      if (typeof window !== 'undefined') window.__MARINE_BOOTSTRAP_GRID_DIAG__ = { hydrated: false, reason: `Layer mismatch: cache=${cachedLayer} vs active=${activeMarineLayer}`, timestamp: new Date().toISOString() };
      return null;
    }
    if (provider === 'fallback_safe_zero' || provider === 'estimated') return null;

    const timeArray = cache.results[0]?.hourly?.time;
    if (!timeArray || timeArray.length === 0) return null;

    const targetMs = Date.now() + hourOffset * 3600000;
    let bestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < timeArray.length; i++) {
      const diff = Math.abs(new Date(timeArray[i].endsWith('Z') ? timeArray[i] : timeArray[i] + 'Z').getTime() - targetMs);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }

    if (minDiff > 3 * 3600000) {
      if (typeof window !== 'undefined') {
        window.__MARINE_BOOTSTRAP_GRID_DIAG__ = {
          hydrated: false,
          reason: `Hour offset ${hourOffset} is too far from cached times (min diff: ${Math.round(minDiff / 3600000)}h)`,
          timestamp: new Date().toISOString()
        };
      }
      return null;
    }

    const size = cache.points.length;
    const vectors = new Array(size);
    let nonzeroCount = 0;
    let maxHeight = 0;
    let sumHeight = 0;

    for (let i = 0; i < size; i++) {
      const r = cache.results[i];
      if (!r?.hourly) {
        vectors[i] = { u: 0, v: 0, speed: 0, period: 0, isOcean: false };
        continue;
      }

      let h = 0;
      let dir = 0;
      let period = 0;

      const h_all = r.hourly.wave_height;
      const d_all = r.hourly.wave_direction;
      const p_all = r.hourly.wave_period;

      const s1_h_all = r.hourly.swell_wave_height;
      const s1_d_all = r.hourly.swell_wave_direction;
      const s1_p_all = r.hourly.swell_wave_period;

      const s2_h_all = r.hourly.secondary_swell_wave_height;
      const s2_d_all = r.hourly.secondary_swell_wave_direction;
      const s2_p_all = r.hourly.secondary_swell_wave_period;

      const ww_h_all = r.hourly.wind_wave_height;
      const ww_d_all = r.hourly.wind_wave_direction;
      const ww_p_all = r.hourly.wind_wave_period;

      if (activeMarineLayer === 'waves') {
        h = h_all?.[bestIdx] ?? 0;
        dir = (d_all?.[bestIdx] ?? 0) * (Math.PI / 180);
        period = p_all?.[bestIdx] ?? 0;
      } else if (activeMarineLayer === 'swell_1') {
        h = s1_h_all?.[bestIdx] ?? 0;
        dir = (s1_d_all?.[bestIdx] ?? 0) * (Math.PI / 180);
        period = s1_p_all?.[bestIdx] ?? 0;
      } else if (activeMarineLayer === 'swell_2') {
        h = s2_h_all?.[bestIdx] ?? 0;
        dir = (s2_d_all?.[bestIdx] ?? 0) * (Math.PI / 180);
        period = s2_p_all?.[bestIdx] ?? 0;
      } else if (activeMarineLayer === 'wind_waves') {
        h = ww_h_all?.[bestIdx] ?? 0;
        dir = (ww_d_all?.[bestIdx] ?? 0) * (Math.PI / 180);
        period = ww_p_all?.[bestIdx] ?? 0;
      }

      if (h > 0) {
        nonzeroCount++;
        if (h > maxHeight) maxHeight = h;
        sumHeight += h;
      }

      vectors[i] = {
        u: -h * Math.sin(dir),
        v: -h * Math.cos(dir),
        speed: h,
        height: h,
        direction: dir * (180 / Math.PI),
        period: period,
        isOcean: h > 0 || (r.hourly.wave_height?.[bestIdx] ?? 0) > 0
      };
    }

    const meanHeight = nonzeroCount > 0 ? sumHeight / nonzeroCount : 0;
    const marineGrid = {
      vectors,
      cols: cache.gridSize,
      rows: cache.gridSize,
      bounds: cache.bounds,
      nonzeroCount,
      maxHeight,
      meanHeight
    };

    if (typeof window !== 'undefined') {
      window.__MARINE_BOOTSTRAP_GRID_DIAG__ = {
        hydrated: true,
        sourceModel,
        activeMarineLayer,
        hourOffset,
        provider,
        vectorCount: vectors.length,
        nonzeroCount,
        maxHeight,
        timestamp: new Date().toISOString()
      };
    }

    return {
      marineGrid,
      model: activeModel,
      layer: activeMarineLayer,
      provider,
      timestamp: Date.now(),
      hourOffset
    };

  } catch (e) {
    if (typeof window !== 'undefined') {
      window.__MARINE_BOOTSTRAP_GRID_DIAG__ = {
        hydrated: false,
        reason: `Hydration exception: ${e.message}`,
        timestamp: new Date().toISOString()
      };
    }
    return null;
  }
}

export function updateMarineTruthTrace(stage, data, activeModel, activeLayer, hourOffset, sourcePath, rejectionReason = null, gpuUploaded = false, httpStatus = 200) {
  if (typeof window === 'undefined') return;

  let vCount = 0;
  let nzCount = 0;
  let hMin = Infinity, hMax = -Infinity, hSum = 0;
  let pMin = Infinity, pMax = -Infinity, pSum = 0;
  let dirSum = 0;
  let gridSum = 0;

  const vectors = data?.grid?.vectors || data?.vectors;
  if (vectors?.length) {
    vCount = vectors.length;
    const compKey = activeLayer || 'waves';
    const step = Math.max(1, Math.floor(vectors.length / 50));
    
    vectors.forEach((v) => {
      if (!v) return;
      const c = v[compKey] !== undefined ? v[compKey] : v;
      if (c && c.speed > 0) {
        nzCount++;
        hSum += c.speed;
        if (c.speed < hMin) hMin = c.speed;
        if (c.speed > hMax) hMax = c.speed;
        
        const period = c.period || 0;
        if (period > 0) {
          pSum += period;
          if (period < pMin) pMin = period;
          if (period > pMax) pMax = period;
        }
      }
    });

    for (let i = 0; i < vectors.length; i += step) {
      const v = vectors[i];
      if (v) {
        const c = v[compKey] !== undefined ? v[compKey] : v;
        dirSum += (c?.direction || 0) + (c?.u || 0) + (c?.v || 0);
        gridSum += (c?.speed || c?.height || 0) + (c?.period || 0);
      }
    }
  }

  if (gpuUploaded) {
    window.__MARINE_UPLOAD_SEQ_NUM__ = (window.__MARINE_UPLOAD_SEQ_NUM__ || 0) + 1;
  }

  window.__MARINE_TRUTH_TRACE__ = {
    timeOffsetHours: hourOffset,
    selectedForecastTimestamp: (typeof hourOffset === 'number' && !isNaN(hourOffset)) ? new Date(Date.now() + hourOffset * 3600000).toISOString() : new Date().toISOString(),
    activeModel,
    activeMarineLayer: activeLayer,
    provider: data?.grid?.__provider || data?.grid?.provider || data?.__provider || 'none',
    gridProvider: data?.grid?.__gridProvider || data?.__gridProvider || 'none',
    componentLayer: data?.grid?.__componentLayer || data?.__componentLayer || 'none',
    sourcePath: sourcePath || 'none',
    uploadSource: sourcePath || 'none',
    vectorCount: vCount,
    nonzeroCount: nzCount,
    gridBounds: data?.grid?.bounds || data?.bounds || null,
    heightMin: hMin === Infinity ? 0 : hMin,
    heightMax: hMax === -Infinity ? 0 : hMax,
    heightMean: nzCount > 0 ? hSum / nzCount : 0,
    periodMin: pMin === Infinity ? 0 : pMin,
    periodMax: pMax === -Infinity ? 0 : pMax,
    periodMean: nzCount > 0 ? pSum / nzCount : 0,
    directionChecksum: Math.round(dirSum * 100),
    gridChecksum: Math.round(gridSum * 100),
    uploadSequenceNumber: window.__MARINE_UPLOAD_SEQ_NUM__ || 0,
    gpuTextureUploaded: gpuUploaded,
    fceOverrideActive: window.__ALLOW_FCE_MARINE_UPLOAD__ === true,
    dispatcherBlocked: !!window.__FCE_MARINE_BLOCKED__?.blocked,
    rejectionReason,
    httpStatus,
    cacheHit: sourcePath?.includes('cache') || sourcePath?.includes('direct') || sourcePath?.includes('orchestrator') || sourcePath?.includes('dispatcher'),
    cooldownState: (typeof window !== 'undefined' && window.__MARINE_FETCH_DIAG__?.cooldownState) || 'ok',
    timestamp: new Date().toISOString()
  };
}

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
    if (typeof window !== 'undefined' && window.__ALLOW_FCE_WIND_UPLOAD__ !== true) {
      return;
    }
    try {
      const windGrid = fieldToWindGrid(field);
      if (windGrid) {
        _windEngine.setWindData(_windGL, windGrid);
      }
    } catch (e) {
      console.warn('[RenderPlanDispatcher] Wind texture upload error:', e.message);
    }
  }

  // v7.6: FCE marine texture uploads are DISABLED by default.
  // Forecast-authoritative data from React/WebGLMarineLayer is the only source.
  // Enable FCE marine uploads for diagnostics only: window.__ALLOW_FCE_MARINE_UPLOAD__ = true
  if (_marineEngine && _marineGL && field.sources.marine) {
    if (typeof window !== 'undefined' && window.__ALLOW_FCE_MARINE_UPLOAD__ !== true) {
      window.__FCE_MARINE_BLOCKED__ = { blocked: true, reason: 'v7.6: FCE marine uploads disabled — forecast-authoritative mode', frameIndex, timestamp: new Date().toISOString() };
      return;
    }
    if (typeof window !== 'undefined') {
      if (window.isScrubbingTimeline) { window.lastScrubTime = Date.now(); }
      const isScrubbing = window.isScrubbingTimeline || (window.lastScrubTime && (Date.now() - window.lastScrubTime < 1500));
      if (isScrubbing) return;
      const activeMarineLayer = renderPlan.waveField.marineLayer || 'waves';
      const activeModel = renderPlan.activeModel || renderPlan.model || 'GFS';
      if (window.activeTimeOffsetHours !== undefined && field.hourOffset !== window.activeTimeOffsetHours) return;
      if (window.activeModel !== undefined && activeModel !== window.activeModel) return;
      if (window.activeMarineLayer !== undefined && activeMarineLayer !== window.activeMarineLayer) return;
    }
    const activeMarineLayer = renderPlan.waveField.marineLayer || 'waves';
    const activeModel = renderPlan.activeModel || renderPlan.model || 'GFS';
    const gridModel = field.sourceModel || 'unknown';
    const gridProvider = field.gridProvider || 'none';
    const componentLayer = field.componentLayer || 'none';

    // 1. Model Mismatch: field model must match the currently selected active model
    let isValid = (field.model === activeModel);
    let rejectionReason = null;
    if (!isValid) {
      rejectionReason = `Model mismatch: field.model=${field.model} vs activeModel=${activeModel}`;
    }

    // 2. Source Model Mismatch: actual grid source model must match active model
    if (isValid && gridModel !== 'unknown' && gridModel !== 'none' && gridModel !== activeModel) {
      isValid = false;
      rejectionReason = `Source model mismatch: gridModel=${gridModel} vs activeModel=${activeModel}`;
    }

    // 3. Component Layer Mismatch (for Copernicus or Estimated)
    const isEuro = activeModel === 'EURO';
    const isWaves = activeMarineLayer === 'waves';
    if (isValid) {
      if (gridProvider === 'fallback_safe_zero') {
        isValid = false;
        rejectionReason = `fallback_safe_zero grid rejected`;
      } else if (gridProvider === 'estimated') {
        if (componentLayer !== activeMarineLayer) {
          isValid = false;
          rejectionReason = `Estimated component layer mismatch: componentLayer=${componentLayer} vs activeMarineLayer=${activeMarineLayer}`;
        }
      } else if (isEuro) {
        if (isWaves) {
          const validEuroWaveProviders = ['open-meteo', 'copernicus', 'backend-weather-service', 'estimated', 'test-fixture', 'gfs_estimated_fallback', 'gfs_estimated_backdrop'];
          if (!validEuroWaveProviders.includes(gridProvider)) {
            isValid = false;
            rejectionReason = `EURO Waves provider mismatch: gridProvider=${gridProvider}`;
          }
        } else {
          // v7.0: Accept copernicus, gfs_estimated_backdrop, gfs_estimated_fallback, and other backend/dev providers for EURO components
          const validEuroComponentProviders = ['copernicus', 'gfs_estimated_backdrop', 'gfs_estimated_fallback', 'backend-weather-service', 'open-meteo', 'estimated', 'test-fixture'];
          if (!validEuroComponentProviders.includes(gridProvider) || componentLayer !== activeMarineLayer) {
            isValid = false;
            rejectionReason = `EURO Component mismatch: gridProvider=${gridProvider} or componentLayer=${componentLayer} vs ${activeMarineLayer}`;
          }
        }
      } else {
        const validGfsIconProviders = ['open-meteo', 'backend-weather-service', 'estimated', 'test-fixture'];
        if (!validGfsIconProviders.includes(gridProvider)) {
          isValid = false;
          rejectionReason = `Non-EURO provider mismatch: gridProvider=${gridProvider}`;
        } else if ((gridProvider === 'backend-weather-service' || gridProvider === 'estimated' || gridProvider === 'test-fixture') && componentLayer !== activeMarineLayer) {
          isValid = false;
          rejectionReason = `Non-EURO component layer mismatch: componentLayer=${componentLayer} vs ${activeMarineLayer}`;
        }
      }
    }

    // 4. Bounds Mismatch: copernicus regional cannot be global
    if (isValid && field.bounds) {
      const isGlobalBounds = Math.abs(field.bounds.west - (-180)) < 1.0 && Math.abs(field.bounds.east - 180) < 1.0;
      if (gridProvider === 'copernicus') {
        if (isGlobalBounds) {
          isValid = false;
          rejectionReason = `Copernicus regional grid cannot have global bounds`;
        }
      }
    }

    // Detect Confirmed Hard Mismatch (Fix: do not treat temporary loading/cooldown misses as hard mismatch layers)
    const isModelMismatch = (field.model !== activeModel) || (gridModel !== 'unknown' && gridModel !== 'none' && gridModel !== activeModel);
    const isComponentMismatch = (gridProvider === 'copernicus' && componentLayer !== 'none' && componentLayer !== 'unknown' && componentLayer !== activeMarineLayer);
    const isLayerDisabled = !activeMarineLayer || activeMarineLayer === 'none';
    const isHardMismatch = isModelMismatch || isComponentMismatch || isLayerDisabled;

    try {
      const marineGrid = fieldToMarineGrid(field, activeMarineLayer);
      
      // 5. Nonzero Count Mismatch: nonzeroCount > 0 unless UI explicitly showing trace/no-data
      if (isValid && marineGrid && marineGrid.nonzeroCount === 0) {
        isValid = false;
        rejectionReason = `Zero nonzeroCount grid rejected`;
      }

      // Populate Cache or Retrieve from Cache
      const cacheKey = `${activeModel}_${activeMarineLayer}_${field.hourOffset}`;
      let gridToUpload = null;
      let usingLastGood = false;

      if (isValid && marineGrid) {
        gridToUpload = marineGrid;
        // Save to cache
        _lastGoodGridsCache[cacheKey] = {
          marineGrid,
          model: activeModel,
          layer: activeMarineLayer,
          provider: gridProvider,
          timestamp: Date.now(),
          hourOffset: field.hourOffset
        };
      } else {
        // Retrieve from cache if transient error
        let cached = _lastGoodGridsCache[cacheKey];
        if (!cached && !isHardMismatch) {
          cached = hydrateGridFromLocalStorage(activeModel, activeMarineLayer, field.hourOffset);
          if (cached) {
            _lastGoodGridsCache[cacheKey] = cached;
          }
        }
        if (cached && !isHardMismatch) {
          gridToUpload = cached.marineGrid;
          usingLastGood = true;
        }
      }

      const dispatcherActiveBefore = !!_marineEngine._dispatcherActive;
      const waveDataPresentBefore = !!_marineEngine._waveData;

      if (gridToUpload) {
        _marineEngine._dispatcherActive = true;
        _marineEngine.setWaveData(_marineGL, gridToUpload);
        updateMarineTruthTrace('upload', gridToUpload, activeModel, activeMarineLayer, field.hourOffset, usingLastGood ? 'last_good_cache' : 'render_plan_dispatcher', null, true);
      } else if (isHardMismatch) {
        // Confirmed hard mismatch: clear buffers to prevent stale/tight heatmap rendering
        _marineEngine.clearBuffers(_marineGL);
        updateMarineTruthTrace('rejection', null, activeModel, activeMarineLayer, field.hourOffset, 'cleared', isLayerDisabled ? 'Layer disabled' : isModelMismatch ? 'Model mismatch' : 'Component layer mismatch', false);
      }

      // Diagnostic: expose dispatch status for console verification
      if (typeof window !== 'undefined') {
        const cached = _lastGoodGridsCache[cacheKey];
        const diag = {
          sourcePath: 'render_plan_dispatcher',
          activeModel,
          activeMarineLayer,
          activeLayer: activeMarineLayer,
          provider: gridProvider,
          gridProvider,
          bounds: field.bounds ? { ...field.bounds } : null,
          cols: field.cols,
          rows: field.rows,
          vectorCount: gridToUpload ? gridToUpload.vectors.length : 0,
          nonzeroCount: gridToUpload ? gridToUpload.nonzeroCount : 0,
          maxHeight: gridToUpload ? gridToUpload.maxHeight : 0,
          meanHeight: gridToUpload ? gridToUpload.meanHeight : 0,
          timeOffsetHours: field.hourOffset,
          isOverridingReactData: false,  // v7.6: FCE marine uploads disabled by default
          fceGateEnabled: typeof window !== 'undefined' && window.__ALLOW_FCE_MARINE_UPLOAD__ === true,
          dispatcherBlocked: typeof window !== 'undefined' && window.__ALLOW_FCE_MARINE_UPLOAD__ !== true,
          
          renderAccepted: isValid,
          renderHeldLastGood: usingLastGood || (!isValid && !isHardMismatch),
          clearReason: isHardMismatch ? (isLayerDisabled ? 'Layer disabled' : isModelMismatch ? 'Model mismatch' : 'Component layer mismatch') : null,
          rejectionReason: isValid ? null : (rejectionReason || `Mismatch guard: model=${gridModel} vs ${activeModel}, layer=${componentLayer} vs ${activeMarineLayer}, provider=${gridProvider}, hard=${isHardMismatch}`),
          lastGoodAgeMs: cached ? (Date.now() - cached.timestamp) : null,
          lastGoodModel: cached ? cached.model : null,
          lastGoodLayer: cached ? cached.layer : null,
          lastGoodProvider: cached ? cached.provider : null,
          
          timestamp: new Date().toISOString()
        };
        window.__FCE_DISPATCH_STATUS__ = diag;
        window.__MARINE_RENDER_SOURCE_DIAG__ = diag;

        // Build exhaustive forensic diagnostics
        window.__MARINE_RENDER_FORENSIC_DIAG__ = {
          activeModel,
          activeLayer: activeMarineLayer,
          timeOffsetHours: field.hourOffset,
          sourcePath: usingLastGood ? 'held_last_good' : isHardMismatch ? 'cleared' : 'render_plan_dispatcher',
          marineData: {
            model: gridModel,
            provider: gridProvider,
            gridProvider: gridProvider,
            componentLayer: componentLayer
          },
          field: {
            model: field.model,
            provider: field.gridProvider,
            componentLayer: field.componentLayer
          },
          vectorCount: gridToUpload ? gridToUpload.vectors.length : 0,
          nonzeroCount: gridToUpload ? gridToUpload.nonzeroCount : 0,
          maxHeight: gridToUpload ? gridToUpload.maxHeight : 0,
          meanHeight: gridToUpload ? gridToUpload.meanHeight : 0,
          renderAccepted: isValid,
          rejectionReason: isValid ? null : (rejectionReason || 'Mismatch guard'),
          clearCalled: isHardMismatch,
          clearReason: isHardMismatch ? (isLayerDisabled ? 'Layer disabled' : isModelMismatch ? 'Model mismatch' : 'Component layer mismatch') : null,
          dispatcherActiveBefore,
          dispatcherActiveAfter: !!_marineEngine._dispatcherActive,
          waveDataPresentBefore,
          waveDataPresentAfter: !!_marineEngine._waveData,
          directUploadBlockedReason: 'RenderPlanDispatcher is active',
          cacheHit: usingLastGood,
          cacheSource: usingLastGood ? 'last_good_cache' : 'none',
          networkStatus: isValid ? 200 : 502,
          rateLimitStatus: gridProvider === 'fallback_safe_zero' ? 'rate_limited' : 'ok',
          timestamp: new Date().toISOString()
        };
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
