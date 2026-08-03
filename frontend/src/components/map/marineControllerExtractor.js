// marineControllerExtractor.js
// Extracted slice processor stateless function for marineController.

import { safeNum, getUV, findClosestHourIndex } from './marineControllerUtils';

export function extractMarineAtOffset(cache, hourOffset, targetLayer) {
  if (!cache) return null;
  const { results, points, gridSize, bounds } = cache;
  if (!results || !points) {
    if (cache.grid && cache.type === 'FeatureCollection') {
      return cache;
    }
    return null;
  }
  const timeArray = results?.[0]?.hourly?.time;
  const targetMs = Date.now() + hourOffset * 3600000;
  const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;
  
  let validTimeStr = new Date().toISOString().replace(/\.\d{3}/, '');
  if (timeArray?.[idx]) {
    const cachedMs = new Date(timeArray[idx].endsWith('Z') ? timeArray[idx] : timeArray[idx] + 'Z').getTime();
    const delta = Math.abs(cachedMs - targetMs);
    if (delta > 3 * 3600000) {
      console.warn(`[extractMarineAtOffset] Rejected: delta=${(delta/3600000).toFixed(1)}h > 3h`);
      return null;
    }
    validTimeStr = new Date(timeArray[idx].endsWith('Z') ? timeArray[idx] : timeArray[idx] + 'Z').toISOString().replace(/\.\d{3}/, '');
  }

  const activeModel = cache.model || 'GFS';
  const gridVectors = [];
  const features = [];

  points.forEach((pt, i) => {
    const r = results[i];
    if (!r?.hourly) {
      gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
        waves: { u: 0, v: 0, speed: 0, period: 0 }, swell_1: { u: 0, v: 0, speed: 0, period: 0 },
        swell_2: { u: 0, v: 0, speed: 0, period: 0 }, wind_waves: { u: 0, v: 0, speed: 0, period: 0 },
        isOcean: false });
      return;
    }
    const c = {
      wave_height: r.hourly.wave_height?.[idx], wave_direction: r.hourly.wave_direction?.[idx],
      wave_period: r.hourly.wave_period?.[idx],
      swell_wave_height: r.hourly.swell_wave_height?.[idx], swell_wave_direction: r.hourly.swell_wave_direction?.[idx],
      swell_wave_period: r.hourly.swell_wave_period?.[idx],
      secondary_swell_wave_height: r.hourly.secondary_swell_wave_height?.[idx],
      secondary_swell_wave_direction: r.hourly.secondary_swell_wave_direction?.[idx],
      secondary_swell_wave_period: r.hourly.secondary_swell_wave_period?.[idx],
      wind_wave_height: r.hourly.wind_wave_height?.[idx], wind_wave_direction: r.hourly.wind_wave_direction?.[idx],
      wind_wave_period: r.hourly.wind_wave_period?.[idx],
    };
    const w_h = safeNum(c.wave_height), w_d = safeNum(c.wave_direction);
    const s1_h = safeNum(c.swell_wave_height ?? 0), s1_d = safeNum(c.swell_wave_direction ?? 0);
    const s2_h = safeNum(c.secondary_swell_wave_height ?? 0), s2_d = safeNum(c.secondary_swell_wave_direction ?? 0);
    const ww_h = safeNum(c.wind_wave_height ?? 0), ww_d = safeNum(c.wind_wave_direction ?? 0);

    const activeLayerFromCache = targetLayer || cache.activeLayer || 'waves';
    let isOcean = false;
    if (activeLayerFromCache === 'waves') {
      isOcean = (r.hourly.wave_height?.[idx] != null);
    } else if (activeLayerFromCache === 'swell_1') {
      isOcean = (r.hourly.swell_wave_height?.[idx] != null) || (r.hourly.wave_height?.[idx] != null);
    } else if (activeLayerFromCache === 'swell_2') {
      isOcean = (r.hourly.secondary_swell_wave_height?.[idx] != null) || (r.hourly.swell_wave_height?.[idx] != null) || (r.hourly.wave_height?.[idx] != null);
    } else if (activeLayerFromCache === 'wind_waves') {
      isOcean = (r.hourly.wind_wave_height?.[idx] != null) || (r.hourly.wave_height?.[idx] != null);
    } else {
      isOcean = (r.hourly.wave_height?.[idx] != null);
    }

    if (w_h === 0 && s1_h === 0 && ww_h === 0) {
      gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
        waves: { u: 0, v: 0, speed: 0, period: 0 }, swell_1: { u: 0, v: 0, speed: 0, period: 0 },
        swell_2: { u: 0, v: 0, speed: 0, period: 0 }, wind_waves: { u: 0, v: 0, speed: 0, period: 0 },
        isOcean });
      return;
    }

    const isIconSwell2Estimated = false; // Permanently disabled in Stage 4H
    const final_s2_h = isIconSwell2Estimated ? s1_h : s2_h;
    const final_s2_d = isIconSwell2Estimated ? s1_d : s2_d;
    const final_s2_period = isIconSwell2Estimated ? safeNum(c.swell_wave_period ?? 0) : safeNum(c.secondary_swell_wave_period ?? 0);

    gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
      waves: { ...getUV(w_h, w_d), period: safeNum(c.wave_period) },
      swell_1: { ...getUV(s1_h, s1_d), period: safeNum(c.swell_wave_period ?? 0) },
      swell_2: { ...getUV(final_s2_h, final_s2_d), period: final_s2_period },
      wind_waves: { ...getUV(ww_h, ww_d), period: safeNum(c.wind_wave_period ?? 0) },
      isOcean });

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pt.monotonicLng, pt.lat] },
      properties: {
        wave_height: w_h, wave_period: safeNum(c.wave_period), wave_direction: w_d,
        swell_wave_height: s1_h, swell_wave_period: safeNum(c.swell_wave_period != null ? c.swell_wave_period : null), swell_wave_direction: s1_h > 0 ? s1_d : null,
        secondary_swell_wave_height: s2_h, secondary_swell_wave_period: safeNum(c.secondary_swell_wave_period != null ? c.secondary_swell_wave_period : null), secondary_swell_wave_direction: s2_h > 0 ? s2_d : null,
        wind_wave_height: ww_h, wind_wave_period: safeNum(c.wind_wave_period != null ? c.wind_wave_period : null), wind_wave_direction: ww_h > 0 ? ww_d : null,
      },
    });
  });

  if (gridVectors.length === 0) return null;

  const provider = cache.provider || 'open-meteo';
  const activeLayerFromCache = targetLayer || cache.activeLayer || 'waves';
  let activeLayerNonzero = 0, activeLayerMax = 0, oceanMaskCount = 0;
  for (const gv of gridVectors) {
    if (gv.isOcean) oceanMaskCount++;
    const ld = gv[activeLayerFromCache];
    if (ld && ld.speed > 0) { activeLayerNonzero++; if (ld.speed > activeLayerMax) activeLayerMax = ld.speed; }
  }
  const renderable = oceanMaskCount > 0;
  const noDataReason = !renderable ? 'no_ocean_data' : null;
  return {
    type: 'FeatureCollection', features, hourOffset,
    valid_time: validTimeStr,
    validTime: validTimeStr,
    grid: { vectors: gridVectors, bounds, cols: gridSize, rows: gridSize, timestamp: Date.now(),
            __sourceModel: activeModel, __provider: provider, __gridProvider: provider,
            // The ORIGIN survives the REBUILD. This extractor reconstructs the grid from cache with
            // an explicit field list, so anything not named here is silently dropped — which is how
            // `upstream_provider` (noaa | dwd | copernicus | ecmwf | gfs_estimated_fallback) reached
            // the client on every response and never reached the render diagnostic. `provider` is
            // only the DISPATCH KEY ('open-meteo' for all three models); the origin is what separates
            // an 8 km MFWAM field (MAE 0.159) from a 25 km IFS one (0.339, worse than GFS).
            __upstreamProvider: cache.upstream_provider || cache.__upstreamProvider || null,
            __componentLayer: activeLayerFromCache, __gridSupportsLayer: renderable,
            __activeLayerNonzeroCount: activeLayerNonzero, __activeLayerMax: activeLayerMax,
            __oceanMaskCount: oceanMaskCount, __renderable: renderable, __noDataReason: noDataReason,
            provider: provider, hourOffset,
            valid_time: validTimeStr,
            validTime: validTimeStr }
  };
}
