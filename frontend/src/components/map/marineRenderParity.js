/**
 * marineRenderParity.js - the render-hour parity record the marine layer publishes (extracted from WebGLMarineLayer.js).
 *
 * Two globals say whether the heat map on screen is the forecast for the hour the user selected:
 *   window.__MARINE_RENDER_HOUR_PARITY__ = { requestedHour, renderedDataHour, parity, reason }
 *   window.__MARINE_HEATMAP_STATUS__     = { status, model, layer, hour, renderedHour, retainedPrevious } | cleared
 * Consumers: MapForecastOverlay (a selected point's grid fallback is allowed only on parity === true),
 * marineTimelineCoverage, forecastDiagnostics, WeatherTelemetry, useMarineOrchestratorScrubCache, the "Stale Hour Retained" badge.
 *
 * `lastSig` is the layer's lastUploadedGridRef record: the frame the engine was last given. publishRenderParity is a pure
 * function of its inputs plus the controller caches; it holds no React state.
 *
 * WHEN IT RUNS (2026-10-16, the stale record). The layer calls it from an effect keyed on [timeOffsetHours, revision, active,
 * activeModel]. The upload that updates lastUploadedGridRef runs later: in the SAME commit but in a later effect (so the effect
 * read the previous frame), or on a path that changes none of those dependencies (the refeed effect, the land-mask swaps). With
 * realistic fetch latency the record then stayed wrong for 15+ s while the engine already held the right frame (measured with
 * the offline harness: engine on hour 0 within 0.8 s, record still "requested 0 / rendered 72 / false").
 * republishRenderParityAfterUpload re-runs the SAME function from the upload path, with the layer's current refs.
 * Kill switch for that second call only: window.__RAW_DISABLE_PARITY_REPUBLISH__ = true (the effect keeps its old behaviour).
 */
import { isInCooldown, findClosestHourIndex } from './marineControllerUtils';
import {
  getMarineHourlyCache, getBackendWeatherFlag, getBackendCopernicusFlag, getBackendIconMarineFlag, getModelSafeMarine,
} from './marineController';
import { uploadedGridServesHour } from './marineHourInstant';

const MARINE_LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
const activeMarineLayer = (activeLayers) => activeLayers?.find(l => MARINE_LAYERS.includes(l)) || 'waves';

// writeStatusWhenNoData (default true = the effect's behaviour, first activation included): false skips WRITING the heat-map status when
// nothing is drawn (see republishRenderParityAfterUpload). Clearing a stale status when parity holds is never skipped.
export function publishRenderParity({ requestedHour, active, activeModel, mapInstance, activeLayers, lastSig, writeStatusWhenNoData = true }) {
  if (typeof window === 'undefined') return;

  const renderedDataHour = lastSig.vectorsLength > 0 ? lastSig.renderedDataHour : null;
  // A frame labelled 15 IS offset 16's 12Z product at 3-hourly range: no "Stale Hour Retained" for it (marineHourInstant.js).
  const parity = active && renderedDataHour !== null &&
    (requestedHour === renderedDataHour || uploadedGridServesHour(lastSig, requestedHour, activeModel));

  let reason = 'parity_match';
  if (!active) {
    reason = 'layer_inactive';
  } else if (renderedDataHour === null) {
    reason = 'no_data_rendered';
  } else if (!parity) {
    let coverageMissing = false;
    const isGfsBackend = getBackendWeatherFlag() && (activeModel === 'GFS' || !activeModel);
    const isIconBackend = getBackendIconMarineFlag() && activeModel === 'ICON';
    const isCopernicusBackend = getBackendCopernicusFlag() && activeModel === 'EURO';
    const isBackendActive = isGfsBackend || isIconBackend || isCopernicusBackend;

    if (isBackendActive) {
      const curLayer = activeMarineLayer(activeLayers);
      let vpBounds = null;
      if (mapInstance) {
        try {
          const b = mapInstance.getBounds();
          vpBounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
        } catch (e) {
          vpBounds = null;
        }
      }
      const cached = getModelSafeMarine(activeModel, requestedHour, curLayer, vpBounds);
      if (!cached || cached.__staleHour || cached.__failureReason || cached.grid?.__failureReason) {
        coverageMissing = true;
      }
    } else {
      const cache = getMarineHourlyCache ? getMarineHourlyCache() : null;
      if (cache?.results?.length) {
        const timeArray = cache.results[0]?.hourly?.time;
        const targetMs = Date.now() + requestedHour * 3600000;
        const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;
        if (timeArray?.[idx]) {
          const cachedMs = new Date(timeArray[idx].endsWith('Z') ? timeArray[idx] : timeArray[idx] + 'Z').getTime();
          if (Math.abs(cachedMs - targetMs) > 3 * 3600000) {
            coverageMissing = true;
          }
        } else {
          coverageMissing = true;
        }
      } else {
        coverageMissing = true;
      }
    }

    if (coverageMissing) {
      reason = 'coverageMissing';
    } else if (isInCooldown('marine')) {
      reason = 'cooldownActive';
    } else {
      reason = 'retained_previous';
    }
  }

  window.__MARINE_RENDER_HOUR_PARITY__ = {
    requestedHour,
    renderedDataHour,
    parity,
    reason
  };

  if (active && !parity && (renderedDataHour !== null || writeStatusWhenNoData)) {
    let statusValue = 'retained_previous_hour';
    if (reason === 'cooldownActive') {
      statusValue = 'rate_limited_cached';
    } else if (reason === 'coverageMissing') {
      statusValue = activeModel === 'EURO' ? 'no_copernicus_coverage' : 'no_backend_coverage';
    }
    window.__MARINE_HEATMAP_STATUS__ = {
      status: statusValue,
      model: activeModel,
      layer: activeMarineLayer(activeLayers),
      hour: requestedHour,
      renderedHour: renderedDataHour,
      retainedPrevious: true
    };
  } else if (active && parity) {
    if (window.__MARINE_HEATMAP_STATUS__?.status === 'retained_previous_hour' ||
        window.__MARINE_HEATMAP_STATUS__?.status === 'no_copernicus_coverage' ||
        window.__MARINE_HEATMAP_STATUS__?.status === 'no_backend_coverage') {
      window.__MARINE_HEATMAP_STATUS__ = null;
    }
  }
}

// The upload path's second call (see the header): the same record, judged against the frame that was JUST drawn (or cleared).
// Reads the layer's current refs, never props, so it is right whichever effect or async path ran the upload. Never throws into
// the caller: the upload it follows has already succeeded, and a diagnostic must not undo that.
// It never WRITES the heat-map status for an emptied engine (writeStatusWhenNoData: false): MapForecastOverlay memoizes the badge from
// that global before the layer's effects run, so a status written at a clear, then nulled after the next good frame, left the
// "retained stale" badge stuck on a memo nothing recomputed (and nothing was retained). The parity record is still written.
export function republishRenderParityAfterUpload(refs) {
  try {
    if (typeof window === 'undefined' || window.__RAW_DISABLE_PARITY_REPUBLISH__ === true) return;
    publishRenderParity({
      requestedHour: refs.timeOffsetHoursRef.current,
      active: refs.activeRef.current,
      activeModel: refs.activeModelRef.current,
      mapInstance: refs.mapRef.current,
      activeLayers: refs.activeLayersRef.current,
      lastSig: refs.lastUploadedGridRef.current,
      writeStatusWhenNoData: false,
    });
  } catch (e) { /* diagnostic record only */ }
}
