/**
 * MapForecastOverlayDiag.js
 * 
 * Extracted telemetry and diagnostics helper for MapForecastOverlay.
 */

import { getBackendPressureFlag } from './backendPressureServiceClient';

export function logPressureTelemetryDiagnostics({
  activeLayer,
  isExactPointAuthority,
  effectiveExactPointResponse,
  useExactPoint,
  timeOffsetHours,
  activeModel,
  pressure,
  exactPointStatus,
  exactPointResponse
}) {
  const offset = isNaN(Number(timeOffsetHours)) ? 0 : Number(timeOffsetHours);
  if (activeLayer === 'pressure' && isExactPointAuthority && typeof getBackendPressureFlag === 'function' && getBackendPressureFlag()) {
    if (effectiveExactPointResponse) {
      const backendModel = effectiveExactPointResponse.requestedModel;
      const backendValidTime = useExactPoint?.time;
      const rasterModel = activeModel;
      
      const baseTime = (typeof window !== 'undefined' && window.__MOCK_DATE_NOW__) || Date.now();
      const roundedNow = Math.round(baseTime / 3600000) * 3600000;
      const targetDt = new Date(roundedNow + offset * 3600000);
      const rasterValidTime = targetDt.toISOString();
      
      const modelMatch = rasterModel === backendModel;
      
      let exactTimeMatch = false;
      let snapDeltaHours = 999.0;
      let withinTolerance = false;
      let status = 'no_coverage';
      
      const diagDetails = effectiveExactPointResponse.diagnosticDetails || {};
      const interpolationMethod = diagDetails.interpolationMethod || 'none';
      
      if (backendValidTime) {
        const rasterMs = new Date(rasterValidTime).getTime();
        const backendMs = new Date(backendValidTime).getTime();
        const diffMs = Math.abs(rasterMs - backendMs);
        snapDeltaHours = diffMs / 3600000;
        exactTimeMatch = diffMs === 0;
        withinTolerance = snapDeltaHours <= 3.0;
        
        if (exactTimeMatch) {
          status = 'exact_match';
        } else if (withinTolerance) {
          status = 'snapped_match';
        } else {
          status = 'fallback';
        }
      } else {
        status = 'no_coverage';
      }
      
      if (interpolationMethod === 'out_of_bounds_fallback' || 
          ['no_backend_coverage', 'no_copernicus_coverage', 'exact_no_time_coverage', 'exact_empty'].includes(useExactPoint?.status) ||
          ['no_backend_coverage', 'no_copernicus_coverage', 'exact_no_time_coverage', 'exact_empty'].includes(exactPointStatus)) {
        status = 'no_coverage';
      }
      
      const isForecastAuthoritative = diagDetails.is_forecast_authoritative !== undefined
        ? diagDetails.is_forecast_authoritative
        : (status !== 'no_coverage' && status !== 'fallback');
      
      console.log(
        `%c[Pressure Telemetry Diagnostics]\n` +
        `  - Raster Model: ${rasterModel}\n` +
        `  - Backend Model: ${backendModel} (Match: ${modelMatch})\n` +
        `  - Raster Valid Time: ${rasterValidTime}\n` +
        `  - Backend Valid Time: ${backendValidTime || 'none'} (Exact Match: ${exactTimeMatch})\n` +
        `  - Snap Delta Hours: ${snapDeltaHours.toFixed(2)}h (Within Tolerance: ${withinTolerance})\n` +
        `  - Infobox Pressure Value: ${pressure} hPa (Sourced from backend: ${!!useExactPoint})\n` +
        `  - Status: ${status}\n` +
        `  - Interpolation Method: ${interpolationMethod}\n` +
        `  - Is Forecast Authoritative: ${isForecastAuthoritative}`,
        status === 'exact_match' || status === 'snapped_match' ? 'color: #22c55e; font-weight: bold;' : 'color: #ef4444; font-weight: bold;'
      );
      
      if (typeof window !== 'undefined') {
        window.__PRESSURE_PARITY_DIAG__ = {
          featureFlagActive: getBackendPressureFlag(),
          rasterModel,
          backendModel,
          rasterValidTime,
          backendValidTime: backendValidTime || null,
          exactTimeMatch,
          snapDeltaHours,
          withinTolerance,
          pressureValue: pressure,
          pressureUnit: "hPa",
          sourcedFromBackend: !!useExactPoint,
          status,
          interpolationMethod,
          isForecastAuthoritative,
          productId: exactPointResponse?.diagnosticDetails?.productId || null,
          source: exactPointResponse?.source || 'network'
        };
      }
    } else if (exactPointStatus === 'exact_loading' || exactPointStatus === 'exact_stale_rejected') {
      console.log('[Pressure Telemetry Diagnostics] Loading backend pressure point...');
    } else {
      const baseTime = (typeof window !== 'undefined' && window.__MOCK_DATE_NOW__) || Date.now();
      const rasterValidTime = new Date(baseTime + offset * 3600000).toISOString();
      let status = 'fallback';
      if (['no_backend_coverage', 'no_copernicus_coverage', 'exact_no_time_coverage', 'exact_empty'].includes(exactPointStatus)) {
        status = 'no_coverage';
      }
      
      console.log(
        `%c[Pressure Telemetry Diagnostics] Fallback active: Sourced from local weather forecast/raster grid. Status: ${exactPointStatus}`,
        'color: #f59e0b; font-weight: bold;'
      );
      if (typeof window !== 'undefined') {
        window.__PRESSURE_PARITY_DIAG__ = {
          featureFlagActive: getBackendPressureFlag(),
          rasterModel: activeModel,
          backendModel: 'none',
          rasterValidTime,
          backendValidTime: 'none',
          exactTimeMatch: false,
          snapDeltaHours: 999.0,
          withinTolerance: false,
          pressureValue: pressure,
          pressureUnit: "hPa",
          sourcedFromBackend: false,
          status,
          interpolationMethod: 'none',
          isForecastAuthoritative: false,
          productId: null,
          source: 'network'
        };
      }
    }
  }
}

export function checkIsExactPointValid({
  effectiveExactPoint,
  effectiveExactPointStatus,
  pointLat,
  pointLng,
  activeModel,
  activeLayer
}) {
  if (!effectiveExactPoint) return false;
  if (effectiveExactPointStatus !== 'exact_success' && 
      effectiveExactPointStatus !== 'exact_stale_available' &&
      effectiveExactPointStatus !== 'exact_no_time_coverage' &&
      effectiveExactPointStatus !== 'no_copernicus_coverage' &&
      effectiveExactPointStatus !== 'no_backend_coverage' &&
      effectiveExactPointStatus !== 'unsupported') return false;

  const epLat = effectiveExactPoint.requestedLat;
  const epLng = effectiveExactPoint.requestedLng;
  if (epLat == null || epLng == null || pointLat == null || pointLng == null) return false;
  if (Math.abs(epLat - +pointLat.toFixed(2)) > 0.01 || Math.abs(epLng - +pointLng.toFixed(2)) > 0.01) {
    return false;
  }
  if (effectiveExactPoint.requestedModel !== activeModel) {
    return false;
  }
  
  const expectedExactProv = (activeModel === 'EURO' && ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(activeLayer)) ? 'copernicus' : 'open-meteo';
  const isEstimated = effectiveExactPoint.provider === 'estimated';
  if (!isEstimated) {
    const isProviderMatch = 
      effectiveExactPoint.provider === expectedExactProv ||
      (activeModel === 'EURO' && effectiveExactPoint.provider === 'copernicus') ||
      effectiveExactPoint.provider === 'backend-weather-service' ||
      effectiveExactPoint.provider === 'test-fixture' ||
      (activeModel === 'EURO' && ['gfs_estimated_fallback', 'gfs_estimated_backdrop', 'open-meteo'].includes(effectiveExactPoint.provider));
      
    if (!isProviderMatch && !(activeModel === 'EURO' && activeLayer === 'waves')) {
      return false;
    }
  }
  return true;
}

export function logForensicAudit({
  isExactPointRequired,
  pointLat,
  pointLng,
  activeLayer,
  activeModel,
  effectiveExactPointStatus,
  effectiveExactPoint,
  cards,
  isExactPointAuthority,
  waveDir, swell1Dir, swell2Dir, windWaveDir,
  degToCompass,
  blockFallbacks
}) {
  if (isExactPointRequired && pointLat && pointLng) {
    console.log(`%c[Forensic Audit] Infobox display data source for ${activeLayer} (Model: ${activeModel})`, 'color: #06b6d4; font-weight: bold;');
    console.log(`Coords: ${pointLat.toFixed(4)}, ${pointLng.toFixed(4)} | Status: ${effectiveExactPointStatus}`);
    if (effectiveExactPointStatus === 'exact_success' && effectiveExactPoint) {
      console.table({
        height: { displayedValue: cards.find(c => c.label === 'Height')?.value, isAuthoritative: isExactPointAuthority, source: 'exact_point_api' },
        period: { displayedValue: cards.find(c => c.label === 'Period')?.value, isAuthoritative: isExactPointAuthority, source: 'exact_point_api' },
        direction: { displayedValue: cards.find(c => c.label === 'Dir' || c.label === degToCompass(waveDir || swell1Dir || swell2Dir || windWaveDir))?.value, isAuthoritative: isExactPointAuthority, source: 'exact_point_api' }
      });
    } else if (effectiveExactPointStatus === 'exact_success' && !effectiveExactPoint) {
      console.log(`[Forensic Audit] Temporal hour mismatch (data succeeded but requested hour has no point coverage) — fallbacks ${blockFallbacks ? 'BLOCKED' : 'ACTIVE'}.`);
    } else if (effectiveExactPointStatus === 'exact_loading') {
      console.log(`[Forensic Audit] Exact point is loading — fallbacks ${blockFallbacks ? 'BLOCKED' : 'ACTIVE'}.`);
    } else {
      console.log(`[Forensic Audit] Exact point failed/unavailable: ${effectiveExactPointStatus} — fallbacks ${blockFallbacks ? 'BLOCKED' : 'ACTIVE'}.`);
    }
  }
}

