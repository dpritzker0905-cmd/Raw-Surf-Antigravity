/**
 * forecastDeprecationDiag.js
 * 
 * Diagnostic tracking for deprecated frontend estimator usage.
 */

import {
  getBackendCopernicusFlag,
  getBackendIconMarineFlag,
  getBackendWeatherFlag
} from './backendWeatherServiceClient';
import { isProductMatching } from './weatherProductIdentity';

export function updateDeprecationDiag(params) {
  if (typeof window === 'undefined') return;
  const {
    model,
    layer,
    offset,
    calledFunc = null,
    called = false,
    backendAvailable = false,
    productId = null,
    fallbackReason = null,
    conformedPoint = null,
    isEstimated = null,
    estimateBasis = null,
    confidence = null,
    provider = null,
    source = null,
    infoboxValue = null
  } = params || {};
  
  const prev = window.__MARINE_ESTIMATOR_DEPRECATION_DIAG__ || {};

  const activeModel = model || prev.activeModel || null;
  const activeLayer = layer || prev.activeLayer || null;
  const timeOffsetHours = offset !== undefined ? offset : (prev.timeOffsetHours !== undefined ? prev.timeOffsetHours : null);

  const isEuro = activeModel === 'EURO';
  const isIcon = activeModel === 'ICON';
  const isBackendCopernicus = typeof getBackendCopernicusFlag === 'function' && getBackendCopernicusFlag();
  const isBackendIcon = typeof getBackendIconMarineFlag === 'function' && getBackendIconMarineFlag();
  const isBackendGfs = typeof getBackendWeatherFlag === 'function' && getBackendWeatherFlag();
  const isBackendRedirectActive = (isEuro && isBackendCopernicus) || (isIcon && isBackendIcon) || (!isEuro && !isIcon && isBackendGfs);

  // capabilities check
  let capAvailable = false;
  if (activeModel === 'EURO') {
    const hasCap = window.__WEATHER_CAPABILITIES__?.some(c => c.model === 'EURO' && c.layer === activeLayer && c.backend_owned);
    const hasFlag = typeof window.__USE_BACKEND_COPERNICUS_SERVICE__ !== 'undefined' ? !!window.__USE_BACKEND_COPERNICUS_SERVICE__ : true;
    capAvailable = !!(hasCap || hasFlag);
  } else if (activeModel === 'ICON') {
    const hasCap = window.__WEATHER_CAPABILITIES__?.some(c => c.model === 'ICON' && c.layer === activeLayer && c.backend_owned);
    const hasFlag = typeof window.__USE_BACKEND_ICON_MARINE_SERVICE__ !== 'undefined' ? !!window.__USE_BACKEND_ICON_MARINE_SERVICE__ : true;
    capAvailable = !!(hasCap || hasFlag);
  } else if (activeModel === 'GFS') {
    capAvailable = true;
  }

  const isUnsupported = (activeModel === 'ICON' && activeLayer === 'swell_2');

  const gridProductId = window.__MARINE_DIAG__?.gridProductId || window.__MARINE_PROJECTION_DIAG__?.productId || prev.gridProductId || null;
  const pointProductId = productId || conformedPoint?.productId || window.__MARINE_DIAG__?.pointProductId || prev.pointProductId || null;

  let gridPointParity = null;
  if (gridProductId && pointProductId) {
    gridPointParity = (gridProductId === pointProductId) ? "parity_pass" : "mismatch";
  } else if (window.__MARINE_SOURCE_PARITY__) {
    gridPointParity = window.__MARINE_SOURCE_PARITY__.match ? "parity_pass" : "mismatch";
  } else {
    gridPointParity = prev.gridPointParity || null;
  }

  let selectedValidTime = conformedPoint?.time || prev.selectedValidTime || null;
  let resolvedIsEstimated = isEstimated !== null ? isEstimated : (conformedPoint ? !!conformedPoint.is_estimated : (prev.isEstimated || false));
  let resolvedEstimateBasis = estimateBasis !== null ? estimateBasis : (conformedPoint?.estimate_basis || prev.estimateBasis || null);
  let resolvedConfidence = confidence !== null ? confidence : (conformedPoint?.estimate_basis?.confidence || prev.confidence || null);
  let resolvedProvider = provider !== null ? provider : (conformedPoint?.provider || prev.provider || null);
  let resolvedSource = source !== null ? source : (conformedPoint?.source || prev.source || null);

  const isGridMatching = !!(gridProductId && isProductMatching(gridProductId, activeModel, activeLayer));
  const isPointMatching = !!(pointProductId && isProductMatching(pointProductId, activeModel, activeLayer));
  const isConformedPointMatching = !!(conformedPoint && conformedPoint.productId && isProductMatching(conformedPoint.productId, activeModel, activeLayer));

  const hasSuccessfulBackendPoint = !!(conformedPoint && conformedPoint.productId &&
    isProductMatching(conformedPoint.productId, activeModel, activeLayer) &&
    resolvedProvider && resolvedProvider !== 'estimated' &&
    resolvedSource && resolvedSource !== 'local_fallback');

  const hasSuccessfulBackendGrid = !!(gridProductId &&
    isProductMatching(gridProductId, activeModel, activeLayer) &&
    resolvedProvider && resolvedProvider !== 'estimated' &&
    resolvedSource && resolvedSource !== 'local_fallback');

  const isExplicitUnsupportedOrNoCoverage = (isUnsupported && (
    fallbackReason === 'unsupported_model_layer' ||
    fallbackReason === 'icon_no_backend_extended_estimate' ||
    fallbackReason === 'no_copernicus_coverage' ||
    fallbackReason === 'no_backend_coverage' ||
    fallbackReason === 'no_coverage' ||
    fallbackReason === 'out_of_bounds/no_coverage'
  ));

  const backendProductActive = !!(
    isGridMatching ||
    isPointMatching ||
    isConformedPointMatching ||
    hasSuccessfulBackendPoint ||
    hasSuccessfulBackendGrid ||
    isExplicitUnsupportedOrNoCoverage
  );

  let status = "inactive";
  let cellSafe = false;

  if (called) {
    if (capAvailable || isBackendRedirectActive || backendAvailable) {
      status = "frontend_estimator_regression";
    } else {
      status = "legacy_fallback_invoked";
    }
    cellSafe = false;
  } else {
    if (isUnsupported || fallbackReason === 'unsupported_model_layer' || fallbackReason === 'icon_no_backend_extended_estimate' || fallbackReason === 'no_copernicus_coverage' || fallbackReason === 'no_backend_coverage' || fallbackReason === 'no_coverage' || fallbackReason === 'out_of_bounds/no_coverage' || fallbackReason === 'backend_required_no_frontend_estimator') {
      status = (fallbackReason === 'unsupported_model_layer' || isUnsupported) ? 'unsupported' : 'no_coverage';
      cellSafe = true;
    } else {
      const isResponseNotStale = conformedPoint ? (conformedPoint.status !== 'exact_stale_available' && conformedPoint.status !== 'exact_no_time_coverage') : true;
      const isNotFallback = resolvedSource !== 'local_fallback' && resolvedSource !== 'estimated' && resolvedSource !== 'legacy_fallback';
      
      const gridProductMatches = gridProductId ? isProductMatching(gridProductId, activeModel, activeLayer) : true;
      const pointProductMatches = pointProductId ? isProductMatching(pointProductId, activeModel, activeLayer) : true;
      const productMatches = gridProductMatches && pointProductMatches;

      const parityOk = (gridProductId && pointProductId) ? (gridPointParity === 'parity_pass') : true;

      if (backendProductActive && productMatches && parityOk && isResponseNotStale && isNotFallback) {
        status = "backend_owned_no_estimator";
        cellSafe = true;
      } else {
        status = "inactive";
        cellSafe = false;
      }
    }
  }

  const safeToDeleteNow = false;
  
  let resolvedInfoboxValue = infoboxValue !== null ? infoboxValue : null;
  if (resolvedInfoboxValue === null) {
    if (conformedPoint) {
      if (activeLayer === 'waves') resolvedInfoboxValue = conformedPoint.wave_height;
      else if (activeLayer === 'swell_1') resolvedInfoboxValue = conformedPoint.swell_wave_height;
      else if (activeLayer === 'swell_2') resolvedInfoboxValue = conformedPoint.secondary_swell_wave_height;
      else if (activeLayer === 'wind_waves') resolvedInfoboxValue = conformedPoint.wind_wave_height;
      else if (activeLayer === 'wind') resolvedInfoboxValue = conformedPoint.wind_speed_10m;
    } else {
      resolvedInfoboxValue = prev.infoboxValue || null;
    }
  }

  const resultDiagObj = {
    status,
    activeModel,
    activeLayer,
    timeOffsetHours,
    selectedValidTime,
    gridProductId,
    pointProductId,
    provider: resolvedProvider || (isBackendRedirectActive ? (isEuro ? 'copernicus' : 'backend-weather-service') : 'estimated'),
    source: resolvedSource || (called ? 'local_fallback' : 'network'),
    isEstimated: resolvedIsEstimated,
    estimateBasis: resolvedEstimateBasis,
    confidence: resolvedConfidence,
    backendReplacementAvailable: !!backendAvailable || !!prev.backendReplacementAvailable,
    backendProductActive,
    frontendEstimatorCalled: !!called || !!prev.frontendEstimatorCalled,
    frontendEstimatorFunction: calledFunc || prev.frontendEstimatorFunction || null,
    fallbackOnlyRetained: true,
    fallbackReason: fallbackReason || prev.fallbackReason || (isBackendRedirectActive ? 'backend_redirect_active' : 'within_native_limit_or_unsupported'),
    gridPointParity,
    infoboxValue: resolvedInfoboxValue,
    cellSafe,
    safeToDeleteNow,
    verdict: window.__MARINE_ESTIMATOR_RETIREMENT_SUMMARY__?.verdict || "safe_to_delete_blocked"
  };

  window.__MARINE_ESTIMATOR_DEPRECATION_DIAG__ = resultDiagObj;
  
  if (activeModel && activeLayer && timeOffsetHours !== null && typeof window.logTestedCell === 'function') {
    window.logTestedCell(activeModel, activeLayer, timeOffsetHours, {
      status,
      provider: resultDiagObj.provider,
      frontendEstimatorCalled: !!called,
      calledFunc,
      fallbackReason: resultDiagObj.fallbackReason,
      backendProductActive: resultDiagObj.backendProductActive,
      gridPointParity: resultDiagObj.gridPointParity
    });
  }
}
