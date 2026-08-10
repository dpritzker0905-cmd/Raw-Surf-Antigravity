/**
 * forecastDiagnostics.js
 *
 * Modularized diagnostic telemetry for marine forecast overlay.
 * Keeps forecastSamplers.js strictly under 800 lines.
 */

import { isInCooldown } from 'C:/Users/dprit/Raw-Surf/frontend/src/components/map/marineControllerUtils';

export function computeHeatmapStatus({ activeModel, activeLayer, renderMarineData }) {
  if (typeof window === 'undefined') return null;
  
  if (activeModel !== 'EURO' || !['swell_1', 'swell_2', 'wind_waves'].includes(activeLayer)) {
    return null;
  }
  
  const statusDiag = window.__MARINE_HEATMAP_STATUS__;
  if (statusDiag?.status === 'no_copernicus_coverage') {
    return 'no_copernicus_coverage';
  }
  if (statusDiag?.status === 'no_backend_coverage') {
    return 'no_backend_coverage';
  }
  if (statusDiag?.status === 'retained_previous_hour_warning' || statusDiag?.status === 'retained_previous_hour') {
    return 'retained_stale_warning';
  }
  if (statusDiag?.status === 'response_too_large_prevented' || window.__MARINE_FETCH_DIAG__?.httpStatus === 413) {
    return 'payload_too_large';
  }

  // v7.12: Instantly check and show rate-limited status for any model in cooldown
  if (window.__MARINE_FETCH_DIAG__?.cooldownState === 'rate_limited' || isInCooldown('marine')) {
    return 'rate_limited';
  }
  
  const webglDiag = window.__WebGLMarineLayer_DIAG__;
  const validProviders = ['copernicus', 'gfs_estimated_fallback', 'gfs_estimated_backdrop', 'open-meteo', 'backend-weather-service', 'test-fixture', 'gfs_euro_blend', 'estimated'];
  const isWebGLRendered = webglDiag &&
                          validProviders.includes(webglDiag.renderedProvider) && 
                          webglDiag.activeMarineLayer === activeLayer && 
                          webglDiag.componentLayer === activeLayer &&
                          webglDiag.renderedVectorCount > 0 &&
                          webglDiag.renderedNonzeroCount > 0;

  if (isWebGLRendered) {
    return 'ready';
  }
  
  // Check if the backend request skipped/failed
  const diag = window.__COPERNICUS_GRID_DIAG__;
  if (diag && diag.layer === activeLayer && diag.skipped) {
    if (diag.skippedReason === 'copernicus_no_nonzero_vectors' || diag.skippedReason === 'no_nonzero_vectors') {
      return 'copernicus_no_nonzero_vectors';
    }
    return diag.skippedReason || 'unavailable';
  }
  
  return 'loading';
}

export function writeOverlayDiagnostics(params) {
  if (typeof window === 'undefined') return;
  const {
    lat, lng, activeModel, activeLayer, timeOffsetHours, exactPoint,
    sampledSwell1Period, sampledWavePeriod, marineGridSample, marine,
    marineHourIndex, swell1Supported, cards, waveHeight, swell1Height,
    swell2Height, windWaveHeight, swell2ModelUnavailable, windWavesSupported,
    marineData, exactPointStatus, isExactPointValid, wavePeriod, waveDir,
    swell1Dir, swell2Dir, windWaveDir, blockFallbacks, isExactPointAuthority,
    sampledWaves, sampledSwell1, sampledSwell2, sampledWindWaves,
    useExactPoint, rawWaveHeight, mToFt, degToCompass,
    currentHourIndex, wx, exactPointResponse,
    hasGfs, hasIcon
  } = params;

  // Consolidate into a single lightweight diagnostic payload (saves ~130 LOC)
  window.__MARINE_DIAG__ = {
    activeModel,
    activeLayer,
    timeOffsetHours,
    selectedPoint: lat != null ? { lat, lng } : null,
    exactPointStatus,
    exactPointValid: isExactPointValid,
    fallbackBlocked: blockFallbacks,
    gridProvider: marineData?.grid?.__gridProvider || 'open-meteo',
    gridComponentLayer: marineData?.grid?.__componentLayer || null,
    productId: exactPointResponse?.productId || marineData?.grid?.productId || null,
    pointProductId: exactPointResponse?.pointProductId || exactPointResponse?.productId || null,
    gridProductId: marineData?.grid?.gridProductId || marineData?.grid?.productId || null,
    source: exactPointResponse?.source || 'network',
    snappedPoint: exactPointResponse ? { lat: exactPointResponse.snappedLat, lng: exactPointResponse.snappedLng } : null,
    requestedPoint: exactPointResponse ? { lat: exactPointResponse.requestedLat, lng: exactPointResponse.requestedLng } : null,
    snapExplanation: (() => {
      if (!exactPointResponse || !exactPointResponse.snappedLat || !exactPointResponse.requestedLat) return null;
      const dLat = exactPointResponse.snappedLat - exactPointResponse.requestedLat;
      const dLng = exactPointResponse.snappedLng - exactPointResponse.requestedLng;
      const dist = Math.sqrt(dLat * dLat + dLng * dLng) * 111;
      if (dist > 0.5) {
        return `Coastal Snapping: Snapped from (${exactPointResponse.requestedLat.toFixed(3)}, ${exactPointResponse.requestedLng.toFixed(3)}) to nearest ocean point (${exactPointResponse.snappedLat.toFixed(3)}, ${exactPointResponse.snappedLng.toFixed(3)}) ${dist.toFixed(1)} km offshore.`;
      }
      return null;
    })(),
    displayedValues: {
      waveHeight: mToFt(waveHeight),
      wavePeriod,
      waveDir,
      swell1Height: mToFt(swell1Height),
      swell2Height: mToFt(swell2Height),
      windWaveHeight: mToFt(windWaveHeight)
    },
    exactPointValues: useExactPoint ? {
      wave_height: useExactPoint.wave_height,
      wave_period: useExactPoint.wave_period,
      wave_direction: useExactPoint.wave_direction,
      swell_wave_height: useExactPoint.swell_wave_height,
      swell_wave_period: useExactPoint.swell_wave_period,
      swell_wave_direction: useExactPoint.swell_wave_direction,
      secondary_swell_wave_height: useExactPoint.secondary_swell_wave_height,
      secondary_swell_wave_period: useExactPoint.secondary_swell_wave_period,
      wind_wave_height: useExactPoint.wind_wave_height,
      wind_wave_period: useExactPoint.wind_wave_period,
      wind_wave_direction: useExactPoint.wind_wave_direction
    } : null,
    timestamp: new Date().toISOString()
  };

  // Infobox-specific telemetry to prevent split-brain state overwrites
  window.__MARINE_INFOBOX_DIAG__ = window.__MARINE_DIAG__;

  // Maintain legacy interfaces only if not owned by WebGL render-path
  if (activeModel !== 'EURO') {
    window.__MARINE_DISPLAY_SOURCE_DIAG__ = window.__MARINE_DIAG__;
  }
  window.__MARINE_LAYER_VALUE_DIAG__ = { displayed: window.__MARINE_DIAG__.displayedValues };
  window.__MARINE_PERIOD_DIAG__ = { displayedPeriodSource: activeLayer === 'waves' ? 'waves' : 'swell_1' };
  window.__MARINE_MODEL_CAPABILITY_DIAG__ = { activeModel };
  window.__EURO_MARINE_PROVIDER_DIAG__ = {
    model: activeModel,
    activeLayer,
    gridProvider: window.__MARINE_DIAG__.gridProvider,
    exactPointStatus,
    exactPointValid: isExactPointValid
  };

  // Build high-telemetry EURO MARINE FORENSIC DIAGNOSTIC Object
  const isWaves = activeLayer === 'waves';
  const nativeLimit = activeModel === 'EURO' ? 240 : 168;

  let mode = 'unavailable';
  if (exactPointStatus === 'estimate_pending_sources') {
    mode = 'estimate_pending_sources';
  } else if (activeModel === 'EURO') {
    mode = isWaves ? 'native_open_meteo' : 'native_copernicus';
  } else if (activeModel === 'GFS' || activeModel === 'ICON') {
    mode = 'native_open_meteo';
  }

  const hasGfsAnchor = !!hasGfs;
  const hasGfsTarget = !!hasGfs;
  const hasIconAnchor = !!hasIcon;
  const hasIconTarget = !!hasIcon;

  const estimateCreated = false;
  let estimateReasonIfNot = null;
  if (!estimateCreated && timeOffsetHours > nativeLimit) {
    if (!hasGfs) {
      estimateReasonIfNot = 'GFS cache data missing';
    } else {
      estimateReasonIfNot = 'Extended estimate computation skipped or failed';
    }
  }

  const fceDiag = window.__FCE_DISPATCH_STATUS__ || {};
  const heatmapVectorCount = fceDiag.vectorCount || 0;
  const heatmapNonzeroCount = fceDiag.nonzeroCount || 0;
  const renderAccepted = fceDiag.renderAccepted ?? false;
  const renderRejectedReason = fceDiag.rejectionReason || null;
  const fetchElapsedMs = window.__LAST_EXACT_FETCH_ELAPSED_MS__ || null;

  window.__EURO_MARINE_FORENSIC_DIAG__ = {
    activeModel,
    activeLayer,
    timeOffsetHours,
    nativeLimit,
    mode,
    exactProvider: exactPoint?.provider || (exactPointResponse?.provider) || null,
    gridProvider: marineData?.grid?.__gridProvider || marineData?.grid?.provider || null,
    componentLayer: marineData?.grid?.__componentLayer || null,
    exactTimeRangeStart: exactPoint?.timeRangeStart || exactPointResponse?.hourly?.time?.[0] || null,
    exactTimeRangeEnd: exactPoint?.timeRangeEnd || exactPointResponse?.hourly?.time?.[exactPointResponse?.hourly?.time?.length - 1] || null,
    hasGfsAnchor,
    hasGfsTarget,
    hasIconAnchor,
    hasIconTarget,
    estimateCreated,
    estimateReasonIfNot,
    heatmapVectorCount,
    heatmapNonzeroCount,
    renderAccepted,
    renderRejectedReason,
    fetchElapsedMs
  };

  // v7.11: Source parity diagnostic moved from MapForecastOverlay to keep it under LOC limits
  const webglDiag = window.__WebGLMarineLayer_DIAG__;
  const heatmapModel = webglDiag?.activeModel || 'none';
  const heatmapLayer = webglDiag?.activeMarineLayer || 'none';
  const heatmapProvider = webglDiag?.renderedProvider || 'none';
  const heatmapWaveData = !!window.__MARINE_ENGINE__?._waveData;
  const heatmapVectors = webglDiag?.renderedVectorCount || 0;
  const heatmapNonzero = webglDiag?.renderedNonzeroCount || 0;
  const infoboxProvider = exactPoint?.provider || marineGridSample?.provider || 'none';
  const infoboxStatus = exactPointStatus;
  const mismatches = [];
  if (heatmapModel !== activeModel) mismatches.push(`model: heatmap=${heatmapModel} infobox=${activeModel}`);
  if (heatmapLayer !== 'unknown' && heatmapLayer !== activeLayer) mismatches.push(`layer: heatmap=${heatmapLayer} infobox=${activeLayer}`);
  if (heatmapProvider !== 'none' && infoboxProvider !== 'none' && heatmapProvider !== infoboxProvider) mismatches.push(`provider: heatmap=${heatmapProvider} infobox=${infoboxProvider}`);
  
  window.__MARINE_SOURCE_PARITY__ = {
    activeModel, activeLayer, timeOffsetHours,
    infobox: { provider: infoboxProvider, status: infoboxStatus, timestamp: exactPoint?.time || null },
    heatmap: { model: heatmapModel, provider: heatmapProvider, waveData: heatmapWaveData, vectorCount: heatmapVectors, nonzeroActiveLayer: heatmapNonzero },
    match: mismatches.length === 0, mismatchReasons: mismatches.length > 0 ? mismatches : null,
    timestamp: new Date().toISOString()
  };

  // Set window.__MARINE_STALE_DIAG__ if stale response is detected (User Rule 5 / 6)
  if (exactPointResponse?.__stale_telemetry) {
    window.__MARINE_STALE_DIAG__ = {
      isStale: true,
      staleReason: exactPointResponse.__stale_telemetry.staleReason,
      ageMs: exactPointResponse.__stale_telemetry.ageMs,
      shape: exactPointResponse.__stale_telemetry.shape,
      originalCacheKey: exactPointResponse.__stale_telemetry.originalCacheKey,
      circuitRemainingMs: exactPointResponse.__stale_telemetry.circuitRemainingMs,
      timestamp: new Date().toISOString()
    };
  } else if (exactPointResponse && exactPointResponse.headers?.get?.('X-Cache') === 'STALE') {
    // Fallback if headers is a Headers object instead of inline JSON
    window.__MARINE_STALE_DIAG__ = {
      isStale: true,
      staleReason: exactPointResponse.headers.get('X-Stale-Reason') || 'unknown',
      ageMs: parseInt(exactPointResponse.headers.get('X-Stale-Age-Ms'), 10) || 0,
      shape: exactPointResponse.headers.get('X-Stale-Shape') || 'unknown',
      originalCacheKey: exactPointResponse.headers.get('X-Stale-Original-Cache-Key') || 'unknown',
      circuitRemainingMs: parseInt(exactPointResponse.headers.get('X-Circuit-Remaining-Ms'), 10) || 0,
      timestamp: new Date().toISOString()
    };
  } else {
    window.__MARINE_STALE_DIAG__ = null;
  }
}
