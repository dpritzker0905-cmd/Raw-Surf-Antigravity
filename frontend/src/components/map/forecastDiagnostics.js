/**
 * forecastDiagnostics.js
 *
 * Modularized diagnostic telemetry for marine forecast overlay.
 * Keeps forecastSamplers.js strictly under 800 lines.
 */

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
    currentHourIndex, wx, exactPointResponse
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
}
