/**
 * euroExtendedEstimate.js
 * Authoritative blending engine for the EURO Extended Estimate mode.
 *
 * Implements a formal persistence-trend blender using height-weighted vector circular math,
 * numeric period blending, and dynamic confidence decay.
 *
 * Feed BOTH point-sample infobox and WebGL heatmap/animation grids.
 */

// Native limits in hours
export const EURO_LIMIT_WAVES = 240;      // 10 days
export const EURO_LIMIT_COMPONENTS = 72; // 3 days
export const ICON_LIMIT = 168;            // 7 days

import { getBackendCopernicusFlag, getBackendIconMarineFlag } from './backendWeatherServiceClient';

// 34 authoritative cells in the Stage 7E test matrix
export const REQUIRED_CELLS = [
  // GFS: waves, swell_1, swell_2, wind_waves at Live (0), +72h, +168h
  { model: 'GFS', layer: 'waves', offset: 0 },
  { model: 'GFS', layer: 'waves', offset: 72 },
  { model: 'GFS', layer: 'waves', offset: 168 },
  { model: 'GFS', layer: 'swell_1', offset: 0 },
  { model: 'GFS', layer: 'swell_1', offset: 72 },
  { model: 'GFS', layer: 'swell_1', offset: 168 },
  { model: 'GFS', layer: 'swell_2', offset: 0 },
  { model: 'GFS', layer: 'swell_2', offset: 72 },
  { model: 'GFS', layer: 'swell_2', offset: 168 },
  { model: 'GFS', layer: 'wind_waves', offset: 0 },
  { model: 'GFS', layer: 'wind_waves', offset: 72 },
  { model: 'GFS', layer: 'wind_waves', offset: 168 },

  // EURO: waves, swell_1, swell_2, wind_waves at +72h, +120h, +168h, +240h
  { model: 'EURO', layer: 'waves', offset: 72 },
  { model: 'EURO', layer: 'waves', offset: 120 },
  { model: 'EURO', layer: 'waves', offset: 168 },
  { model: 'EURO', layer: 'waves', offset: 240 },
  { model: 'EURO', layer: 'swell_1', offset: 72 },
  { model: 'EURO', layer: 'swell_1', offset: 120 },
  { model: 'EURO', layer: 'swell_1', offset: 168 },
  { model: 'EURO', layer: 'swell_1', offset: 240 },
  { model: 'EURO', layer: 'swell_2', offset: 72 },
  { model: 'EURO', layer: 'swell_2', offset: 120 },
  { model: 'EURO', layer: 'swell_2', offset: 168 },
  { model: 'EURO', layer: 'swell_2', offset: 240 },
  { model: 'EURO', layer: 'wind_waves', offset: 72 },
  { model: 'EURO', layer: 'wind_waves', offset: 120 },
  { model: 'EURO', layer: 'wind_waves', offset: 168 },
  { model: 'EURO', layer: 'wind_waves', offset: 240 },

  // ICON: waves, swell_1, wind_waves at +168h, +240h
  { model: 'ICON', layer: 'waves', offset: 168 },
  { model: 'ICON', layer: 'waves', offset: 240 },
  { model: 'ICON', layer: 'swell_1', offset: 168 },
  { model: 'ICON', layer: 'swell_1', offset: 240 },
  { model: 'ICON', layer: 'wind_waves', offset: 168 },
  { model: 'ICON', layer: 'wind_waves', offset: 240 },

  // ICON swell_2: Live (0) and +72h (must remain unsupported/no source data)
  { model: 'ICON', layer: 'swell_2', offset: 0, unsupported: true },
  { model: 'ICON', layer: 'swell_2', offset: 72, unsupported: true }
];

function getCallStackShort() {
  try {
    const err = new Error();
    const stack = err.stack || '';
    const lines = stack.split('\n');
    return lines.slice(3, 6).map(l => l.trim()).join(' -> ');
  } catch (e) {
    return 'unknown_stack';
  }
}

export function updateRetirementSummary() {
  if (typeof window === 'undefined') return;
  const logs = window.__TESTED_CELLS_LOG__ || {};
  
  let matrixTotal = REQUIRED_CELLS.length;
  let matrixPassed = 0;
  let matrixFailed = 0;
  const untestedList = [];
  
  let estimatorInvocationCount = 0;
  let regressionCount = 0;
  let legacyFallbackCount = 0;

  Object.values(logs).forEach(log => {
    if (log.frontendEstimatorCalled) {
      estimatorInvocationCount++;
      if (log.status === 'frontend_estimator_regression') {
        regressionCount++;
      } else if (log.status === 'legacy_fallback_invoked') {
        legacyFallbackCount++;
      }
    }
  });

  REQUIRED_CELLS.forEach(cell => {
    const key = `${cell.model}_${cell.layer}_${cell.offset}`;
    const log = logs[key];
    if (!log) {
      untestedList.push(key);
      return;
    }

    if (cell.unsupported) {
      if (!log.frontendEstimatorCalled && (log.provider === 'backend-weather-service' || log.provider === 'none' || log.fallbackReason === 'icon_no_backend_extended_estimate' || log.fallbackReason === 'unsupported_model_layer')) {
        matrixPassed++;
      } else {
        matrixFailed++;
      }
    } else {
      if (log.status === 'backend_owned_no_estimator' && !log.frontendEstimatorCalled) {
        matrixPassed++;
      } else {
        matrixFailed++;
      }
    }
  });

  const untestedCells = untestedList.length;
  const allPassed = (matrixPassed === matrixTotal);
  const safeToDeleteNow = allPassed && (estimatorInvocationCount === 0);

  let verdict = "safe_to_delete_blocked";
  if (allPassed && estimatorInvocationCount === 0) {
    verdict = "safe_to_delete_candidate";
  }

  window.__MARINE_ESTIMATOR_RETIREMENT_SUMMARY__ = {
    matrixTotal,
    matrixPassed,
    matrixFailed,
    untestedCells,
    untestedList,
    estimatorInvocationCount,
    regressionCount,
    legacyFallbackCount,
    safeToDeleteNow,
    verdict,
    timestamp: new Date().toISOString()
  };
}

export function logTestedCell(model, layer, offset, data) {
  if (typeof window === 'undefined') return;
  window.__TESTED_CELLS_LOG__ = window.__TESTED_CELLS_LOG__ || {};
  
  const intOffset = Math.round(Number(offset));
  const normKey = `${model}_${layer}_${intOffset}`;
  
  window.__TESTED_CELLS_LOG__[normKey] = {
    model,
    layer,
    offset: intOffset,
    status: data.status,
    provider: data.provider || null,
    frontendEstimatorCalled: !!data.frontendEstimatorCalled,
    calledFunc: data.calledFunc || null,
    fallbackReason: data.fallbackReason || null,
    timestamp: new Date().toISOString()
  };
  
  updateRetirementSummary();
}

export function checkEstimatorRegression(model, layer, hour, calledFunc) {
  if (typeof window === 'undefined') return;

  const projDiag = window.__MARINE_PROJECTION_DIAG__ || {};
  const renderSourceDiag = window.__MARINE_RENDER_SOURCE_DIAG__ || {};
  const copernicusDiag = window.__BACKEND_COPERNICUS_SERVICE_DIAG__ || {};
  const iconDiag = window.__BACKEND_ICON_SERVICE_DIAG__ || {};
  const pointDiag = window.__MARINE_POINT_DIAG__ || {};
  const timelineDiag = window.__FORECAST_TIMELINE_COVERAGE_DIAG__ || {};

  const activeModel = model || projDiag.activeModel || renderSourceDiag.model || null;
  const activeLayer = layer || projDiag.activeLayer || renderSourceDiag.layer || null;
  const requestedHour = hour;

  const selectedValidTime = projDiag.selectedValidTime || renderSourceDiag.validTime || null;
  const gridProductId = projDiag.productId || renderSourceDiag.productId || null;
  const pointProductId = pointDiag.productId || timelineDiag.productId || null;

  let backendProductAvailable = false;
  if (model === 'EURO') {
    const hasCap = window.__WEATHER_CAPABILITIES__?.some(c => c.model === 'EURO' && c.layer === layer && c.backend_owned);
    const hasFlag = typeof window.__USE_BACKEND_COPERNICUS_SERVICE__ !== 'undefined' ? !!window.__USE_BACKEND_COPERNICUS_SERVICE__ : true;
    backendProductAvailable = !!(hasCap || hasFlag);
  } else if (model === 'ICON') {
    const hasCap = window.__WEATHER_CAPABILITIES__?.some(c => c.model === 'ICON' && c.layer === layer && c.backend_owned);
    const hasFlag = typeof window.__USE_BACKEND_ICON_MARINE_SERVICE__ !== 'undefined' ? !!window.__USE_BACKEND_ICON_MARINE_SERVICE__ : true;
    backendProductAvailable = !!(hasCap || hasFlag);
  }

  const backendProductActive = !!(
    (model === 'EURO' && (copernicusDiag.active || copernicusDiag.productId)) ||
    (model === 'ICON' && (iconDiag.active || iconDiag.productId)) ||
    gridProductId ||
    pointProductId
  );

  const backendProductMatchesRequestedLayer = !!(
    projDiag.activeLayer === layer || 
    renderSourceDiag.layer === layer || 
    copernicusDiag.layer === layer || 
    iconDiag.layer === layer
  );

  const backendProductMatchesRequestedHour = !!(
    projDiag.timeOffsetHours === hour || 
    renderSourceDiag.timeOffset === hour || 
    copernicusDiag.timeOffset === hour || 
    iconDiag.timeOffset === hour
  );

  let status = "inactive";
  if (backendProductAvailable) {
    status = "frontend_estimator_regression";
  } else {
    status = "legacy_fallback_invoked";
  }

  const diag = {
    status,
    activeModel,
    activeLayer,
    requestedHour,
    timeOffsetHours: requestedHour,
    selectedValidTime,
    gridProductId,
    pointProductId,
    provider: "estimated",
    isEstimated: true,
    estimateBasis: {
      basis: "frontend_blended",
      targetHour: hour,
      nativeLimit: model === 'EURO' ? (layer === 'waves' ? 240 : 72) : 168
    },
    coverageStatus: backendProductAvailable ? "regression_detected" : "fallback_active",
    backendProductAvailable,
    backendProductActive,
    backendProductMatchesRequestedLayer,
    backendProductMatchesRequestedHour,
    calledFunc,
    frontendEstimatorCalled: true,
    frontendEstimatorFunction: calledFunc,
    callStack: getCallStackShort(),
    safeToDeleteNow: false,
    cellSafe: false
  };

  window.__ESTIMATOR_REGRESSION_DIAG__ = diag;
  window.__MARINE_ESTIMATOR_DEPRECATION_DIAG__ = diag;

  logTestedCell(model, layer, hour, {
    status,
    provider: "estimated",
    frontendEstimatorCalled: true,
    calledFunc,
    fallbackReason: status
  });

  if (status === "frontend_estimator_regression") {
    console.error(`[ESTIMATOR_REGRESSION] Frontend estimator ${calledFunc} called for ${model} ${layer} at +${hour}h, but backend product is available!`);
  }
}

/**
 * Calculates weights and confidence for a target hour past the native limit.
 */
export function getEstimateWeights(targetHour, nativeLimit, isIconValid = false) {
  const daysPast = Math.max(0, (targetHour - nativeLimit) / 24);
  const confidence = Math.max(0.10, 1.0 - 0.15 * daysPast);

  let wPersistence = 0;
  let wGfs = 0;
  let wIcon = 0;

  if (isIconValid && targetHour <= 168) {
    // ICON is valid and target hour is within 7 days limit
    if (daysPast <= 1) {
      // Day 1 past limit: persistence (60% to 40%), GFS (30% to 50%), ICON (10%)
      wPersistence = 0.60 - 0.20 * daysPast;
      wGfs = 0.30 + 0.20 * daysPast;
      wIcon = 0.10;
    } else if (daysPast <= 5) {
      // Day 2-5 past limit: persistence (40% -> 0%), GFS (50% -> 90%), ICON (10% -> 0%)
      const pct = (daysPast - 1) / 4;
      wPersistence = 0.40 * (1 - pct);
      wGfs = 0.50 + 0.40 * pct;
      wIcon = 0.10 * (1 - pct);
    } else {
      wPersistence = 0;
      wGfs = 1.0;
      wIcon = 0;
    }
  } else {
    // ICON is invalid, unavailable, or expired
    if (daysPast <= 1) {
      // Day 1 past limit: persistence (70% to 40%), GFS (30% to 60%)
      wPersistence = 0.70 - 0.30 * daysPast;
      wGfs = 0.30 + 0.30 * daysPast;
      wIcon = 0;
    } else if (daysPast <= 5) {
      // Day 2-5 past limit: persistence (40% -> 0%), GFS (60% -> 100%)
      const pct = (daysPast - 1) / 4;
      wPersistence = 0.40 * (1 - pct);
      wGfs = 0.60 + 0.40 * pct;
      wIcon = 0;
    } else {
      wPersistence = 0;
      wGfs = 1.0;
      wIcon = 0;
    }
  }

  // Normalize weights to sum to exactly 1.0
  const sum = wPersistence + wGfs + wIcon;
  return {
    persistence: sum > 0 ? wPersistence / sum : 0,
    gfs: sum > 0 ? wGfs / sum : 0,
    icon: sum > 0 ? wIcon / sum : 0,
    confidence
  };
}

/**
 * Height-weighted vector circular blend for wave direction.
 */
export function blendDirection(heights, directions, weights) {
  let sumU = 0;
  let sumV = 0;
  let validWeightSum = 0;

  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    const dir = directions[i];
    const w = weights[i];

    if (h != null && dir != null && !isNaN(h) && !isNaN(dir) && w > 0) {
      const rad = (dir * Math.PI) / 180;
      const u = -h * Math.sin(rad);
      const v = -h * Math.cos(rad);
      sumU += u * w;
      sumV += v * w;
      validWeightSum += w;
    }
  }

  if (validWeightSum > 0 && (sumU !== 0 || sumV !== 0)) {
    return (Math.atan2(-sumU, -sumV) * 180 / Math.PI + 360) % 360;
  }
  return directions[0] != null ? directions[0] : null; // fallback to persistence anchor
}

/**
 * Linear blend for wave period, rejecting zero/null values.
 */
export function blendPeriod(periods, weights) {
  let periodSum = 0;
  let weightSum = 0;

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const w = weights[i];
    if (p != null && p > 0 && !isNaN(p) && w > 0) {
      periodSum += p * w;
      weightSum += w;
    }
  }

  return weightSum > 0 ? periodSum / weightSum : null;
}

/**
 * Bilinearly interpolates/resamples component values from a source grid at a specific lat/lng.
 */
export function resampleFromGrid(lat, lng, grid, componentKey) {
  if (!grid || !grid.vectors?.length || !grid.bounds || !grid.cols || !grid.rows) {
    return null;
  }

  const { west, south, east, north } = grid.bounds;
  const lngSpan = east - west;
  const latSpan = north - south;

  // Normalize longitude into grid bounds
  let normLng = lng;
  if (normLng < west) normLng += 360;
  if (normLng > east) normLng -= 360;
  
  if (normLng < west || normLng > east || lat < south || lat > north) {
    return null;
  }

  // Compute fractional coordinates
  const fx = ((normLng - west) / lngSpan) * (grid.cols - 1);
  const fy = ((lat - south) / latSpan) * (grid.rows - 1);

  const x0 = Math.floor(fx);
  const x1 = Math.min(grid.cols - 1, x0 + 1);
  const y0 = Math.floor(fy);
  const y1 = Math.min(grid.rows - 1, y0 + 1);

  const dx = fx - x0;
  const dy = fy - y0;

  const idx00 = y0 * grid.cols + x0;
  const idx10 = y0 * grid.cols + x1;
  const idx01 = y1 * grid.cols + x0;
  const idx11 = y1 * grid.cols + x1;

  const v00 = grid.vectors[idx00];
  const v10 = grid.vectors[idx10];
  const v01 = grid.vectors[idx01];
  const v11 = grid.vectors[idx11];

  if (!v00 || !v10 || !v01 || !v11) return null;

  const getVal = (v) => {
    // Grid vectors can be nested or flat
    const c = v?.[componentKey] !== undefined ? v[componentKey] : v;
    return c || { u: 0, v: 0, speed: 0, period: 0 };
  };

  const c00 = getVal(v00);
  const c10 = getVal(v10);
  const c01 = getVal(v01);
  const c11 = getVal(v11);

  // Interpolate speed, period, u, v
  const speed = c00.speed * (1 - dx) * (1 - dy) +
                c10.speed * dx * (1 - dy) +
                c01.speed * (1 - dx) * dy +
                c11.speed * dx * dy;

  const period = (c00.period || 0) * (1 - dx) * (1 - dy) +
                 (c10.period || 0) * dx * (1 - dy) +
                 (c01.period || 0) * (1 - dx) * dy +
                 (c11.period || 0) * dx * dy;

  const u = (c00.u || 0) * (1 - dx) * (1 - dy) +
            (c10.u || 0) * dx * (1 - dy) +
            (c01.u || 0) * (1 - dx) * dy +
            (c11.u || 0) * dx * dy;

  const v = (c00.v || 0) * (1 - dx) * (1 - dy) +
            (c10.v || 0) * dx * (1 - dy) +
            (c01.v || 0) * (1 - dx) * dy +
            (c11.v || 0) * dx * dy;

  return { u, v, speed, period };
}

/**
 * Calculates Point Extended Estimate past native EURO coverage.
 */
export function estimateEuroPoint(targetHour, nativeLimit, activeLayer, euroAnchor, gfsTarget, gfsAnchor, iconTarget, iconAnchor) {
  checkEstimatorRegression('EURO', activeLayer, targetHour, 'estimateEuroPoint');
  // Validate basic requirements: GFS target is required to do any estimate
  if (!gfsTarget || !gfsAnchor || !euroAnchor) {
    return null;
  }

  const isWaves = activeLayer === 'waves';
  const prefix = isWaves ? 'wave' : (activeLayer === 'swell_1' ? 'swell_wave' : (activeLayer === 'swell_2' ? 'secondary_swell_wave' : 'wind_wave'));
  
  const hKey = `${prefix}_height`;
  const dKey = `${prefix}_direction`;
  const pKey = `${prefix}_period`;

  const isIconValid = !!(iconTarget && iconAnchor && iconTarget[hKey] != null);
  const { persistence: wPersist, gfs: wGfs, icon: wIcon, confidence } = getEstimateWeights(targetHour, nativeLimit, isIconValid);

  // Extract anchors
  const hEuroAnchor = euroAnchor[hKey] || 0;
  const pEuroAnchor = euroAnchor[pKey] || 0;
  const dEuroAnchor = euroAnchor[dKey];

  // Extract GFS
  const hGfsAnchor = gfsAnchor[hKey] || 0;
  const hGfsTarget = gfsTarget[hKey] || 0;
  const pGfsAnchor = gfsAnchor[pKey] || 0;
  const pGfsTarget = gfsTarget[pKey] || 0;
  const dGfsTarget = gfsTarget[dKey];

  // GFS Trends
  const hGfsTrend = Math.max(0, hEuroAnchor + (hGfsTarget - hGfsAnchor));
  const pGfsTrend = pGfsAnchor > 0 ? Math.max(2, pEuroAnchor + (pGfsTarget - pGfsAnchor)) : pEuroAnchor;
  const dGfsTrend = dGfsTarget;

  // Extract ICON (if valid)
  let hIconTrend = 0;
  let pIconTrend = 0;
  let dIconTrend = null;

  if (isIconValid) {
    const hIconAnchor = iconAnchor[hKey] || 0;
    const hIconTarget = iconTarget[hKey] || 0;
    const pIconAnchor = iconAnchor[pKey] || 0;
    const pIconTarget = iconTarget[pKey] || 0;
    const dIconTarget = iconTarget[dKey];

    hIconTrend = Math.max(0, hEuroAnchor + (hIconTarget - hIconAnchor));
    pIconTrend = pIconAnchor > 0 ? Math.max(2, pEuroAnchor + (pIconTarget - pIconAnchor)) : pEuroAnchor;
    dIconTrend = dIconTarget;
  }

  // Weighted blending
  const blendedHeight = Math.max(0, wPersist * hEuroAnchor + wGfs * hGfsTrend + (isIconValid ? wIcon * hIconTrend : 0));
  
  const periods = [pEuroAnchor, pGfsTrend, isIconValid ? pIconTrend : null].filter(p => p != null);
  const periodWeights = [wPersist, wGfs, isIconValid ? wIcon : 0];
  const blendedPeriod = blendPeriod(periods, periodWeights);

  const directions = [dEuroAnchor, dGfsTrend, isIconValid ? dIconTrend : null].filter(d => d != null);
  const dirWeights = [wPersist, wGfs, isIconValid ? wIcon : 0];
  const blendedDirection = blendDirection([hEuroAnchor, hGfsTrend, isIconValid ? hIconTrend : 0], directions, dirWeights);

  // Expose Point Diagnostics
  if (typeof window !== 'undefined') {
    window.__EURO_EXTENDED_ESTIMATE_DIAG__ = {
      activeModel: 'EURO',
      activeLayer,
      targetHour,
      sourceProvider: 'estimated',
      isEstimated: true,
      estimateConfidence: confidence,
      euroAnchorTime: nativeLimit,
      gfsTargetTime: targetHour,
      iconTargetTime: isIconValid ? targetHour : null,
      iconUnavailableReason: !isIconValid ? (iconTarget ? 'ICON Swell 2 missing' : 'ICON forecast ended/unavailable') : null,
      weights: { persistence: wPersist, gfs: wGfs, icon: wIcon },
      timestamp: new Date().toISOString()
    };
  }

  return {
    [hKey]: blendedHeight,
    [pKey]: blendedPeriod,
    [dKey]: blendedDirection,
    confidence
  };
}

/**
 * Calculates Grid Extended Estimate cell-by-cell past native EURO coverage.
 */
export function estimateEuroGrid(targetHour, nativeLimit, activeLayer, euroAnchorGrid, gfsTargetGrid, gfsAnchorGrid, iconTargetGrid, iconAnchorGrid) {
  checkEstimatorRegression('EURO', activeLayer, targetHour, 'estimateEuroGrid');
  if (!euroAnchorGrid?.vectors || !gfsTargetGrid?.vectors || !gfsAnchorGrid?.vectors) {
    return null;
  }

  const isIconValid = !!(iconTargetGrid?.vectors && iconAnchorGrid?.vectors);
  const { persistence: wPersist, gfs: wGfs, icon: wIcon, confidence } = getEstimateWeights(targetHour, nativeLimit, isIconValid);

  const componentKey = activeLayer || 'waves';
  const vectors = [];
  let vectorCount = 0;
  let nonzeroCount = 0;

  const getComp = (v, key) => v?.[key] || null;

  euroAnchorGrid.vectors.forEach((vEuroAnchor, i) => {
    vectorCount++;
    const lat = vEuroAnchor.lat;
    const lng = vEuroAnchor.lng;
    const isOcean = vEuroAnchor.isOcean;

    if (!isOcean) {
      vectors.push({
        lat, lng, isOcean,
        [componentKey]: { u: 0, v: 0, speed: 0, period: 0 }
      });
      return;
    }

    const cEuroAnchor = getComp(vEuroAnchor, componentKey);
    if (!cEuroAnchor) {
      vectors.push({
        lat, lng, isOcean,
        [componentKey]: { u: 0, v: 0, speed: 0, period: 0 }
      });
      return;
    }

    // Geographically resample GFS at this coordinate to align grids
    const cGfsAnchor = resampleFromGrid(lat, lng, gfsAnchorGrid, componentKey);
    const cGfsTarget = resampleFromGrid(lat, lng, gfsTargetGrid, componentKey);

    if (!cGfsAnchor || !cGfsTarget) {
      vectors.push({
        lat, lng, isOcean,
        [componentKey]: { u: 0, v: 0, speed: 0, period: 0 }
      });
      return;
    }

    // Extract GFS directions
    const dGfsTarget = cGfsTarget.u !== 0 || cGfsTarget.v !== 0
      ? (Math.atan2(-cGfsTarget.u, -cGfsTarget.v) * 180 / Math.PI + 360) % 360
      : null;

    // GFS Trends
    const hEuroAnchor = cEuroAnchor.speed || 0;
    const hGfsTrend = Math.max(0, hEuroAnchor + (cGfsTarget.speed - cGfsAnchor.speed));
    const pEuroAnchor = cEuroAnchor.period || 0;
    const pGfsTrend = cGfsAnchor.period > 0 ? Math.max(2, pEuroAnchor + (cGfsTarget.period - cGfsAnchor.period)) : pEuroAnchor;
    const dGfsTrend = dGfsTarget;

    // Extract ICON (if valid)
    let hIconTrend = 0;
    let pIconTrend = 0;
    let dIconTrend = null;
    let validIcon = false;

    if (isIconValid) {
      // Geographically resample ICON at this coordinate to align grids
      const cIconAnchor = resampleFromGrid(lat, lng, iconAnchorGrid, componentKey);
      const cIconTarget = resampleFromGrid(lat, lng, iconTargetGrid, componentKey);
      if (cIconAnchor && cIconTarget && cIconTarget.speed != null) {
        validIcon = true;
        const dIconTarget = cIconTarget.u !== 0 || cIconTarget.v !== 0
          ? (Math.atan2(-cIconTarget.u, -cIconTarget.v) * 180 / Math.PI + 360) % 360
          : null;

        hIconTrend = Math.max(0, hEuroAnchor + (cIconTarget.speed - cIconAnchor.speed));
        pIconTrend = cIconAnchor.period > 0 ? Math.max(2, pEuroAnchor + (cIconTarget.period - cIconAnchor.period)) : pEuroAnchor;
        dIconTrend = dIconTarget;
      }
    }

    const wIconReal = (isIconValid && validIcon) ? wIcon : 0;
    const wGfsReal = wGfs + ((isIconValid && !validIcon) ? wIcon : 0);

    // Blended Height
    const blendedHeight = Math.max(0, wPersist * hEuroAnchor + wGfsReal * hGfsTrend + wIconReal * hIconTrend);
    if (blendedHeight > 0.05) nonzeroCount++;

    // Blended Period
    const periods = [pEuroAnchor, pGfsTrend, (isIconValid && validIcon) ? pIconTrend : null].filter(p => p != null && p > 0);
    const periodWeights = [wPersist, wGfsReal, wIconReal];
    const blendedPeriod = blendPeriod(periods, periodWeights) || 0;

    // Extract EURO direction
    const dEuroAnchor = cEuroAnchor.u !== 0 || cEuroAnchor.v !== 0
      ? (Math.atan2(-cEuroAnchor.u, -cEuroAnchor.v) * 180 / Math.PI + 360) % 360
      : null;

    // Blended Direction
    const directions = [dEuroAnchor, dGfsTrend, (isIconValid && validIcon) ? dIconTrend : null].filter(d => d != null);
    const dirWeights = [wPersist, wGfsReal, wIconReal];
    const blendedDirection = blendDirection([hEuroAnchor, hGfsTrend, hIconTrend], directions, dirWeights);

    // Convert back to u/v components
    let u = 0;
    let v = 0;
    if (blendedHeight > 0 && blendedDirection != null) {
      const rad = (blendedDirection * Math.PI) / 180;
      u = -blendedHeight * Math.sin(rad);
      v = -blendedHeight * Math.cos(rad);
    }

    vectors.push({
      lat, lng, isOcean,
      [componentKey]: { u, v, speed: blendedHeight, period: blendedPeriod }
    });
  });

  // Expose Grid Diagnostics
  if (typeof window !== 'undefined') {
    window.__EURO_EXTENDED_ESTIMATE_DIAG__ = {
      activeModel: 'EURO',
      activeLayer: componentKey,
      targetHour,
      sourceProvider: 'estimated',
      isEstimated: true,
      estimateConfidence: confidence,
      euroAnchorTime: nativeLimit,
      gfsTargetTime: targetHour,
      iconTargetTime: isIconValid ? targetHour : null,
      iconUnavailableReason: !isIconValid ? 'ICON forecast ended/unavailable' : null,
      weights: { persistence: wPersist, gfs: wGfs, icon: wIcon },
      vectorCount,
      nonzeroCount,
      timestamp: new Date().toISOString()
    };
  }

  return {
    vectors,
    bounds: euroAnchorGrid.bounds,
    cols: euroAnchorGrid.cols,
    rows: euroAnchorGrid.rows,
    timestamp: Date.now()
  };
}

/**
 * Calculates ICON Point Extended Estimate past native ICON coverage (168 hours).
 */
export function estimateIconPoint(targetHour, nativeLimit, activeLayer, iconAnchor, gfsTarget, gfsAnchor) {
  checkEstimatorRegression('ICON', activeLayer, targetHour, 'estimateIconPoint');
  // Validate basic requirements: GFS target is required to do any estimate
  if (!gfsTarget || !gfsAnchor || !iconAnchor) {
    return null;
  }

  const isWaves = activeLayer === 'waves';
  const prefix = isWaves ? 'wave' : (activeLayer === 'swell_1' ? 'swell_wave' : (activeLayer === 'swell_2' ? 'secondary_swell_wave' : 'wind_wave'));
  
  const hKey = `${prefix}_height`;
  const dKey = `${prefix}_direction`;
  const pKey = `${prefix}_period`;

  const daysPast = Math.max(0, (targetHour - nativeLimit) / 24);
  const confidence = Math.max(0.10, 1.0 - 0.15 * daysPast);

  // Day 1 past limit: persistence (70% to 40%), GFS (30% to 60%)
  // Day 2-5: fade persistence to 0%, GFS to 100%
  let wPersist = 0;
  let wGfs = 0;

  if (daysPast <= 1) {
    wPersist = 0.70 - 0.30 * daysPast;
    wGfs = 0.30 + 0.30 * daysPast;
  } else if (daysPast <= 5) {
    const pct = (daysPast - 1) / 4;
    wPersist = 0.40 * (1 - pct);
    wGfs = 0.60 + 0.40 * pct;
  } else {
    wPersist = 0;
    wGfs = 1.0;
  }

  const sum = wPersist + wGfs;
  const weightPersist = sum > 0 ? wPersist / sum : 0;
  const weightGfs = sum > 0 ? wGfs / sum : 0;

  // Extract anchors
  const hIconAnchor = iconAnchor[hKey] || 0;
  const pIconAnchor = iconAnchor[pKey] || 0;
  const dIconAnchor = iconAnchor[dKey];

  // Extract GFS
  const hGfsAnchor = gfsAnchor[hKey] || 0;
  const hGfsTarget = gfsTarget[hKey] || 0;
  const pGfsAnchor = gfsAnchor[pKey] || 0;
  const pGfsTarget = gfsTarget[pKey] || 0;
  const dGfsTarget = gfsTarget[dKey];

  // GFS Trends
  const hGfsTrend = Math.max(0, hIconAnchor + (hGfsTarget - hGfsAnchor));
  const pGfsTrend = pGfsAnchor > 0 ? Math.max(2, pIconAnchor + (pGfsTarget - pGfsAnchor)) : pIconAnchor;
  const dGfsTrend = dGfsTarget;

  // Weighted blending
  const blendedHeight = Math.max(0, weightPersist * hIconAnchor + weightGfs * hGfsTrend);
  
  const periods = [pIconAnchor, pGfsTrend].filter(p => p != null && p > 0);
  const periodWeights = [weightPersist, weightGfs];
  const blendedPeriod = blendPeriod(periods, periodWeights);

  const directions = [dIconAnchor, dGfsTrend].filter(d => d != null);
  const dirWeights = [weightPersist, weightGfs];
  const blendedDirection = blendDirection([hIconAnchor, hGfsTrend], directions, dirWeights);

  // Expose ICON Diagnostics
  if (typeof window !== 'undefined') {
    window.__ICON_EXTENDED_ESTIMATE_DIAG__ = {
      activeModel: 'ICON',
      activeLayer,
      targetHour,
      sourceProvider: 'estimated',
      isEstimated: true,
      estimateConfidence: confidence,
      iconAnchorTime: nativeLimit,
      gfsTargetTime: targetHour,
      weights: { persistence: weightPersist, gfs: weightGfs },
      timestamp: new Date().toISOString()
    };
    window.__EURO_EXTENDED_ESTIMATE_DIAG__ = window.__ICON_EXTENDED_ESTIMATE_DIAG__;
  }

  return {
    [hKey]: blendedHeight,
    [pKey]: blendedPeriod,
    [dKey]: blendedDirection,
    confidence
  };
}

/**
 * Calculates ICON Grid Extended Estimate cell-by-cell past native ICON coverage (168 hours).
 */
export function estimateIconGrid(targetHour, nativeLimit, activeLayer, iconAnchorGrid, gfsTargetGrid, gfsAnchorGrid) {
  checkEstimatorRegression('ICON', activeLayer, targetHour, 'estimateIconGrid');
  if (!iconAnchorGrid?.vectors || !gfsTargetGrid?.vectors || !gfsAnchorGrid?.vectors) {
    return null;
  }

  const daysPast = Math.max(0, (targetHour - nativeLimit) / 24);
  const confidence = Math.max(0.10, 1.0 - 0.15 * daysPast);

  let wPersist = 0;
  let wGfs = 0;

  if (daysPast <= 1) {
    wPersist = 0.70 - 0.30 * daysPast;
    wGfs = 0.30 + 0.30 * daysPast;
  } else if (daysPast <= 5) {
    const pct = (daysPast - 1) / 4;
    wPersist = 0.40 * (1 - pct);
    wGfs = 0.60 + 0.40 * pct;
  } else {
    wPersist = 0;
    wGfs = 1.0;
  }

  const sum = wPersist + wGfs;
  const weightPersist = sum > 0 ? wPersist / sum : 0;
  const weightGfs = sum > 0 ? wGfs / sum : 0;

  const componentKey = activeLayer || 'waves';
  const vectors = [];
  let vectorCount = 0;
  let nonzeroCount = 0;

  const getComp = (v, key) => v?.[key] || null;

  iconAnchorGrid.vectors.forEach((vIconAnchor, i) => {
    vectorCount++;
    const lat = vIconAnchor.lat;
    const lng = vIconAnchor.lng;
    const isOcean = vIconAnchor.isOcean;

    if (!isOcean) {
      vectors.push({
        lat, lng, isOcean,
        [componentKey]: { u: 0, v: 0, speed: 0, period: 0 }
      });
      return;
    }

    const cIconAnchor = getComp(vIconAnchor, componentKey);
    if (!cIconAnchor) {
      vectors.push({
        lat, lng, isOcean,
        [componentKey]: { u: 0, v: 0, speed: 0, period: 0 }
      });
      return;
    }

    // Geographically resample GFS at this coordinate to align grids
    const cGfsAnchor = resampleFromGrid(lat, lng, gfsAnchorGrid, componentKey);
    const cGfsTarget = resampleFromGrid(lat, lng, gfsTargetGrid, componentKey);

    if (!cGfsAnchor || !cGfsTarget) {
      vectors.push({
        lat, lng, isOcean,
        [componentKey]: { u: 0, v: 0, speed: 0, period: 0 }
      });
      return;
    }

    // Extract GFS directions
    const dGfsTarget = cGfsTarget.u !== 0 || cGfsTarget.v !== 0
      ? (Math.atan2(-cGfsTarget.u, -cGfsTarget.v) * 180 / Math.PI + 360) % 360
      : null;

    // GFS Trends
    const hIconAnchor = cIconAnchor.speed || 0;
    const hGfsTrend = Math.max(0, hIconAnchor + (cGfsTarget.speed - cGfsAnchor.speed));
    const pIconAnchor = cIconAnchor.period || 0;
    const pGfsTrend = cGfsAnchor.period > 0 ? Math.max(2, pIconAnchor + (cGfsTarget.period - cGfsAnchor.period)) : pIconAnchor;
    const dGfsTrend = dGfsTarget;

    // Blended Height
    const blendedHeight = Math.max(0, weightPersist * hIconAnchor + weightGfs * hGfsTrend);
    if (blendedHeight > 0.05) nonzeroCount++;

    // Blended Period
    const periods = [pIconAnchor, pGfsTrend].filter(p => p != null && p > 0);
    const periodWeights = [weightPersist, weightGfs];
    const blendedPeriod = blendPeriod(periods, periodWeights) || 0;

    // Extract ICON direction
    const dIconAnchor = cIconAnchor.u !== 0 || cIconAnchor.v !== 0
      ? (Math.atan2(-cIconAnchor.u, -cIconAnchor.v) * 180 / Math.PI + 360) % 360
      : null;

    // Blended Direction
    const directions = [dIconAnchor, dGfsTrend].filter(d => d != null);
    const dirWeights = [weightPersist, weightGfs];
    const blendedDirection = blendDirection([hIconAnchor, hGfsTrend], directions, dirWeights);

    // Convert back to u/v components
    let u = 0;
    let v = 0;
    if (blendedHeight > 0 && blendedDirection != null) {
      const rad = (blendedDirection * Math.PI) / 180;
      u = -blendedHeight * Math.sin(rad);
      v = -blendedHeight * Math.cos(rad);
    }

    vectors.push({
      lat, lng, isOcean,
      [componentKey]: { u, v, speed: blendedHeight, period: blendedPeriod }
    });
  });

  // Expose Grid Diagnostics
  if (typeof window !== 'undefined') {
    window.__ICON_EXTENDED_ESTIMATE_DIAG__ = {
      activeModel: 'ICON',
      activeLayer: componentKey,
      targetHour,
      sourceProvider: 'estimated',
      isEstimated: true,
      estimateConfidence: confidence,
      iconAnchorTime: nativeLimit,
      gfsTargetTime: targetHour,
      weights: { persistence: weightPersist, gfs: weightGfs },
      vectorCount,
      nonzeroCount,
      timestamp: new Date().toISOString()
    };
    window.__EURO_EXTENDED_ESTIMATE_DIAG__ = window.__ICON_EXTENDED_ESTIMATE_DIAG__;
  }

  return {
    vectors,
    bounds: iconAnchorGrid.bounds,
    cols: iconAnchorGrid.cols,
    rows: iconAnchorGrid.rows,
    timestamp: Date.now()
  };
}

if (typeof window !== 'undefined') {
  window.__logTestedCell__ = logTestedCell;
  window.__updateRetirementSummary__ = updateRetirementSummary;
  window.__REQUIRED_CELLS__ = REQUIRED_CELLS;
}

