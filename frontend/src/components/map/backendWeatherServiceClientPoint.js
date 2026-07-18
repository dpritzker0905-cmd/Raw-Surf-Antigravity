import { getSharedValidTime, pointCache, POINT_URL, blendDirection, blendPeriod } from './backendWeatherServiceClient';
import { iconExtendedContinuityDecay, iconExtendedContinuityOffset } from './backendWeatherServiceClientHelpers';
import { recordTruthStage } from './weatherTruthTracker';
import { updateDiagnostics } from './backendWeatherServiceClientDiag';

export async function fetchBackendExactPoint(lat, lng, hourOffset, signal, layer = 'waves', model = 'GFS', gridProductIdParam = null, gridBboxParam = null) {
  if (model === 'ICON' && hourOffset > 168) {
    if (hourOffset <= 240 && layer === 'swell_2') {
      // Fall through to unsupported swell_2 response below
    } else {
      const validTimeStr = getSharedValidTime(hourOffset, layer, 'ICON');
      try {
        if (hourOffset <= 240) {
          // ICON Persistence + GFS Trend extrapolation
          const [iconAnchor, gfsAnchor, gfsTarget] = await Promise.all([
            fetchBackendExactPoint(lat, lng, 168, signal, layer, 'ICON', gridProductIdParam, gridBboxParam),
            fetchBackendExactPoint(lat, lng, 168, signal, layer, 'GFS', gridProductIdParam, gridBboxParam),
            fetchBackendExactPoint(lat, lng, hourOffset, signal, layer, 'GFS', gridProductIdParam, gridBboxParam)
          ]);

          if (!iconAnchor || !gfsAnchor || !gfsTarget) {
            throw new Error('ICON point extended estimate anchors or target GFS are unavailable');
          }

          const prefix = layer === 'waves' ? 'wave' : (layer === 'swell_1' ? 'swell_wave' : (layer === 'swell_2' ? 'secondary_swell_wave' : 'wind_wave'));
          const hKey = `${prefix}_height`;
          const dKey = `${prefix}_direction`;
          const pKey = `${prefix}_period`;

          const hIconAnchor = iconAnchor.hourly?.[hKey]?.[0] || 0;
          const pIconAnchor = iconAnchor.hourly?.[pKey]?.[0] || 0;
          const dIconAnchor = iconAnchor.hourly?.[dKey]?.[0];

          const hGfsAnchor = gfsAnchor.hourly?.[hKey]?.[0] || 0;
          const hGfsTarget = gfsTarget.hourly?.[hKey]?.[0] || 0;
          const pGfsAnchor = gfsAnchor.hourly?.[pKey]?.[0] || 0;
          const pGfsTarget = gfsTarget.hourly?.[pKey]?.[0] || 0;
          const dGfsTarget = gfsTarget.hourly?.[dKey]?.[0];

          const daysPast = Math.max(0, (hourOffset - 168) / 24);
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

          const hGfsTrend = Math.max(0, hIconAnchor + (hGfsTarget - hGfsAnchor));
          const pGfsTrend = pGfsAnchor > 0 ? Math.max(2, pIconAnchor + (pGfsTarget - pGfsAnchor)) : pIconAnchor;
          const dGfsTrend = dGfsTarget;

          const blendedHeight = Math.max(0, weightPersist * hIconAnchor + weightGfs * hGfsTrend);
          const blendedPeriod = blendPeriod([pIconAnchor, pGfsTrend], [weightPersist, weightGfs]) || 0;
          const blendedDirection = blendDirection([hIconAnchor, hGfsTrend], [dIconAnchor, dGfsTrend], [weightPersist, weightGfs]);

          const conformedHourly = {
            time: [validTimeStr.replace(/\.\d+Z$/, 'Z')],
            wave_height: [null], wave_direction: [null], wave_period: [null], wave_peak_period: [null],
            swell_wave_height: [null], swell_wave_direction: [null], swell_wave_period: [null], swell_wave_peak_period: [null],
            secondary_swell_wave_height: [null], secondary_swell_wave_direction: [null], secondary_swell_wave_period: [null],
            wind_wave_height: [null], wind_wave_direction: [null], wind_wave_period: [null], wind_wave_peak_period: [null]
          };
          conformedHourly[hKey] = [blendedHeight];
          conformedHourly[dKey] = [blendedDirection];
          conformedHourly[pKey] = [blendedPeriod];

          if (typeof window !== 'undefined') {
            window.__ICON_EXTENDED_ESTIMATE_DIAG__ = {
              activeModel: 'ICON',
              activeLayer: layer,
              targetHour: hourOffset,
              sourceProvider: 'estimated',
              isEstimated: true,
              estimateConfidence: confidence,
              iconAnchorTime: 168,
              gfsTargetTime: hourOffset,
              weights: { persistence: weightPersist, gfs: weightGfs },
              timestamp: new Date().toISOString()
            };
          }

          return {
            hourly: conformedHourly,
            requestedLat: lat,
            requestedLng: lng,
            requestedModel: 'ICON',
            activeLayer: layer,
            forecastDays: 1,
            apiModel: 'gwam',
            provider: 'estimated',
            source: 'estimated_trend',
            status: 'exact_success',
            is_estimated: true,
            estimate_basis: {
              type: 'icon_extended_estimate',
              method: 'persistence_gfs_trend',
              icon_anchor: hIconAnchor,
              gfs_anchor: hGfsAnchor,
              gfs_target: hGfsTarget
            }
          };
        } else {
          // hourOffset > 240: 60/40 GFS/EURO Weighted Average blend.
          // BOUNDARY CONTINUITY (2026-07-06, the POINT mirror of the GRID fix in
          // backendWeatherServiceClientHelpers — infobox/heatmap coherence): the raw mix jumps
          // at the 240 boundary wherever its climatology differs from the ≤240 anchored trend,
          // so the infobox disagreed with the (already-fixed) heatmap across 240h. Same additive
          // correction, scalar form: est(t) = mix(t) + [trend(240) − mix(240)]·decay(t), decay
          // 1→0 over 240→288h; height/period only, direction untouched — identical to the grid.
          // Anchor points ride the point cache (168h anchors are the ≤240 branch's own inputs).
          // Fail-open: any missing anchor → the raw mix. Kill: __RAW_DISABLE_ICON_TAIL_CONTINUITY__.
          const [gfsTarget, euroTarget, icon168R, gfs168R, gfs240R, euro240R] = await Promise.allSettled([
            fetchBackendExactPoint(lat, lng, hourOffset, signal, layer, 'GFS', gridProductIdParam, gridBboxParam),
            fetchBackendExactPoint(lat, lng, hourOffset, signal, layer, 'EURO', gridProductIdParam, gridBboxParam),
            fetchBackendExactPoint(lat, lng, 168, signal, layer, 'ICON', gridProductIdParam, gridBboxParam),
            fetchBackendExactPoint(lat, lng, 168, signal, layer, 'GFS', gridProductIdParam, gridBboxParam),
            fetchBackendExactPoint(lat, lng, 240, signal, layer, 'GFS', gridProductIdParam, gridBboxParam),
            fetchBackendExactPoint(lat, lng, 240, signal, layer, 'EURO', gridProductIdParam, gridBboxParam)
          ]);

          const gfsVal = gfsTarget.status === 'fulfilled' ? gfsTarget.value : null;
          const euroVal = euroTarget.status === 'fulfilled' ? euroTarget.value : null;

          if (!gfsVal && !euroVal) {
            throw new Error('ICON extended blend target GFS and EURO are both unavailable');
          }

          const prefix = layer === 'waves' ? 'wave' : (layer === 'swell_1' ? 'swell_wave' : (layer === 'swell_2' ? 'secondary_swell_wave' : 'wind_wave'));
          const hKey = `${prefix}_height`;
          const dKey = `${prefix}_direction`;
          const pKey = `${prefix}_period`;

          const hGfs = gfsVal?.hourly?.[hKey]?.[0];
          const dGfs = gfsVal?.hourly?.[dKey]?.[0];
          const pGfs = gfsVal?.hourly?.[pKey]?.[0];

          const hEuro = euroVal?.hourly?.[hKey]?.[0];
          const dEuro = euroVal?.hourly?.[dKey]?.[0];
          const pEuro = euroVal?.hourly?.[pKey]?.[0];

          let blendedHeight = 0;
          let blendedPeriod = 0;
          let blendedDirection = 0;
          let usedGfsWeight = 0.6;
          let usedEuroWeight = 0.4;

          if (hGfs != null && hEuro != null) {
            blendedHeight = hGfs * 0.6 + hEuro * 0.4;
            blendedPeriod = blendPeriod([pGfs, pEuro], [0.6, 0.4]) || 0;
            blendedDirection = blendDirection([hGfs, hEuro], [dGfs, dEuro], [0.6, 0.4]);
          } else if (hGfs != null) {
            blendedHeight = hGfs;
            blendedPeriod = pGfs;
            blendedDirection = dGfs;
            usedGfsWeight = 1.0;
            usedEuroWeight = 0.0;
          } else if (hEuro != null) {
            blendedHeight = hEuro;
            blendedPeriod = pEuro;
            blendedDirection = dEuro;
            usedGfsWeight = 0.0;
            usedEuroWeight = 1.0;
          }

          // Additive continuity offset (see branch comment above). The shared grid helpers take
          // {height, period} cells, so the scalar hourly values are wrapped; a null anchor makes
          // iconExtendedContinuityOffset return null → raw mix unchanged (fail-open).
          let continuityApplied = false;
          const _decay = iconExtendedContinuityDecay(hourOffset);
          if (_decay > 0 && !(typeof window !== 'undefined' && window.__RAW_DISABLE_ICON_TAIL_CONTINUITY__ === true)) {
            const _pt = (r) => (r && r.status === 'fulfilled' && r.value ? r.value : null);
            const _cell = (v) => v && v.hourly?.[hKey]?.[0] != null
              ? { height: v.hourly[hKey][0] || 0, period: v.hourly?.[pKey]?.[0] || 0 } : null;
            const off = iconExtendedContinuityOffset(
              _cell(_pt(icon168R)), _cell(_pt(gfs168R)), _cell(_pt(gfs240R)), _cell(_pt(euro240R)), usedGfsWeight
            );
            if (off) {
              blendedHeight = Math.max(0, blendedHeight + off.dH * _decay);
              blendedPeriod = Math.max(0, (blendedPeriod || 0) + off.dP * _decay);
              continuityApplied = true;
            }
          }

          const conformedHourly = {
            time: [validTimeStr.replace(/\.\d+Z$/, 'Z')],
            wave_height: [null], wave_direction: [null], wave_period: [null], wave_peak_period: [null],
            swell_wave_height: [null], swell_wave_direction: [null], swell_wave_period: [null], swell_wave_peak_period: [null],
            secondary_swell_wave_height: [null], secondary_swell_wave_direction: [null], secondary_swell_wave_period: [null],
            wind_wave_height: [null], wind_wave_direction: [null], wind_wave_period: [null], wind_wave_peak_period: [null]
          };
          conformedHourly[hKey] = [blendedHeight];
          conformedHourly[dKey] = [blendedDirection];
          conformedHourly[pKey] = [blendedPeriod];

          if (typeof window !== 'undefined') {
            window.__ICON_EXTENDED_ESTIMATE_DIAG__ = {
              activeModel: 'ICON',
              activeLayer: layer,
              targetHour: hourOffset,
              sourceProvider: 'estimated',
              isEstimated: true,
              estimateConfidence: 0.5,
              iconAnchorTime: 168,
              gfsTargetTime: hourOffset,
              weights: { gfs: usedGfsWeight, euro: usedEuroWeight },
              timestamp: new Date().toISOString()
            };
          }

          return {
            hourly: conformedHourly,
            requestedLat: lat,
            requestedLng: lng,
            requestedModel: 'ICON',
            activeLayer: layer,
            forecastDays: 1,
            apiModel: 'gwam',
            provider: 'estimated',
            source: 'estimated_blend',
            status: 'exact_success',
            is_estimated: true,
            estimate_basis: {
              type: 'icon_extended_blend',
              method: 'weighted_average',
              gfs_weight: usedGfsWeight,
              euro_weight: usedEuroWeight,
              continuity_offset: continuityApplied
            }
          };
        }
      } catch (err) {
        console.error('[Backend Weather Client Point] ICON extended point emulation failed:', err);
        throw err;
      }
    }
  }

  if (model === 'ICON' && layer === 'swell_2') {
    // ICON/GWAM has NO native secondary swell, so swell_2 is synthesized as a 60/40 GFS/EURO
    // point blend at ALL hours — matching the heatmap (backendWeatherServiceClient.js ~L254) and
    // the >240h extended path above. Previously this returned 'unsupported' for hours ≤240, so
    // the infobox showed "no source data" while the heatmap rendered the blend. Only falls back to
    // 'unsupported' when BOTH GFS and EURO swell_2 are genuinely unavailable.
    try {
      const s2ValidTimeStr = getSharedValidTime(hourOffset, 'swell_2', 'ICON');
      const [gfsS2, euroS2] = await Promise.allSettled([
        fetchBackendExactPoint(lat, lng, hourOffset, signal, 'swell_2', 'GFS', gridProductIdParam, gridBboxParam),
        fetchBackendExactPoint(lat, lng, hourOffset, signal, 'swell_2', 'EURO', gridProductIdParam, gridBboxParam)
      ]);
      // An abort (model/layer switch cancels the shared signal) is NOT data-unavailability:
      // falling through to the terminal 'unsupported' response here let the caller CACHE
      // 'unsupported' for the point/hour, so the infobox stayed "no source data" long after
      // the switch storm ended (live console repro 2026-07-04 at 19.9,-119.58). Re-throw the
      // abort so the redirect wrapper propagates it and nothing gets cached.
      const isAbortRejection = (r) => r.status === 'rejected' &&
        (r.reason?.name === 'AbortError' || r.reason?.message?.toLowerCase().includes('abort'));
      if (signal?.aborted || (isAbortRejection(gfsS2) && isAbortRejection(euroS2))) {
        const abortErr = new Error('ICON swell_2 blend aborted (model/layer switch)');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      const gfsVal = gfsS2.status === 'fulfilled' ? gfsS2.value : null;
      const euroVal = euroS2.status === 'fulfilled' ? euroS2.value : null;
      const hKey = 'secondary_swell_wave_height', dKey = 'secondary_swell_wave_direction', pKey = 'secondary_swell_wave_period';
      const hGfs = gfsVal?.hourly?.[hKey]?.[0], dGfs = gfsVal?.hourly?.[dKey]?.[0], pGfs = gfsVal?.hourly?.[pKey]?.[0];
      const hEuro = euroVal?.hourly?.[hKey]?.[0], dEuro = euroVal?.hourly?.[dKey]?.[0], pEuro = euroVal?.hourly?.[pKey]?.[0];

      if (hGfs != null || hEuro != null) {
        let blendedHeight = 0, blendedPeriod = 0, blendedDirection = 0, usedGfsWeight = 0.6, usedEuroWeight = 0.4;
        if (hGfs != null && hEuro != null) {
          blendedHeight = hGfs * 0.6 + hEuro * 0.4;
          blendedPeriod = blendPeriod([pGfs, pEuro], [0.6, 0.4]) || 0;
          blendedDirection = blendDirection([hGfs, hEuro], [dGfs, dEuro], [0.6, 0.4]);
        } else if (hGfs != null) {
          blendedHeight = hGfs; blendedPeriod = pGfs; blendedDirection = dGfs; usedGfsWeight = 1.0; usedEuroWeight = 0.0;
        } else {
          blendedHeight = hEuro; blendedPeriod = pEuro; blendedDirection = dEuro; usedGfsWeight = 0.0; usedEuroWeight = 1.0;
        }
        if (typeof window !== 'undefined') {
          window.__ICON_EXTENDED_ESTIMATE_DIAG__ = {
            activeModel: 'ICON', activeLayer: 'swell_2', targetHour: hourOffset,
            sourceProvider: 'estimated', isEstimated: true, estimateConfidence: 0.5,
            gfsTargetTime: hourOffset, euroTargetTime: hourOffset,
            weights: { gfs: usedGfsWeight, euro: usedEuroWeight }, timestamp: new Date().toISOString()
          };
        }
        return {
          hourly: {
            time: [s2ValidTimeStr.replace(/\.\d+Z$/, 'Z')],
            wave_height: [null], wave_direction: [null], wave_period: [null], wave_peak_period: [null],
            swell_wave_height: [null], swell_wave_direction: [null], swell_wave_period: [null], swell_wave_peak_period: [null],
            secondary_swell_wave_height: [blendedHeight], secondary_swell_wave_direction: [blendedDirection], secondary_swell_wave_period: [blendedPeriod],
            wind_wave_height: [null], wind_wave_direction: [null], wind_wave_period: [null], wind_wave_peak_period: [null]
          },
          requestedLat: lat, requestedLng: lng, requestedModel: 'ICON', activeLayer: 'swell_2',
          forecastDays: 1, apiModel: 'gwam', provider: 'estimated', source: 'estimated_blend',
          status: 'exact_success', is_estimated: true,
          estimate_basis: { type: 'icon_swell_2_gfs_euro_blend', method: 'weighted_average', gfs_weight: usedGfsWeight, euro_weight: usedEuroWeight }
        };
      }
      // Both GFS and EURO swell_2 unavailable — fall through to the unsupported response below.
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.toLowerCase().includes('abort') || signal?.aborted) {
        throw err; // abort is not unavailability — propagate so nothing caches 'unsupported'
      }
      console.error('[Backend Weather Client Point] ICON swell_2 GFS/EURO blend failed:', err);
      // fall through to unsupported
    }
    return {
      status: 'unsupported',
      hourly: {
        time: [getSharedValidTime(hourOffset, 'swell_2', 'ICON')],
        secondary_swell_wave_height: [null],
        secondary_swell_wave_direction: [null],
        secondary_swell_wave_period: [null]
      },
      requestedLat: lat,
      requestedLng: lng,
      requestedModel: 'ICON',
      activeLayer: 'swell_2',
      provider: 'none',
      source: 'unsupported_model_layer',
      is_estimated: false,
      warnings: ['unsupported_model_layer']
    };
  }

  let gridProductId = gridProductIdParam;
  if (!gridProductId && typeof window !== 'undefined') {
    const diag = window.__MARINE_PROJECTION_DIAG__;
    if (diag && diag.activeLayer === layer && diag.activeModel === model) {
      gridProductId = diag.productId || diag.gridProductId || null;
    }
  }

  let gridBbox = gridBboxParam;
  if (!gridBbox && typeof window !== 'undefined') {
    const diag = window.__MARINE_PROJECTION_DIAG__;
    if (diag && diag.activeLayer === layer && diag.activeModel === model) {
      gridBbox = diag.requested_bbox || diag.backendRequestBbox || null;
    }
  }
  if (!gridBbox && typeof window !== 'undefined' && window.map) {
    try {
      const b = window.map.getBounds();
      gridBbox = `${b.getWest().toFixed(4)},${b.getSouth().toFixed(4)},${b.getEast().toFixed(4)},${b.getNorth().toFixed(4)}`;
    } catch (e) {
      gridBbox = null;
    }
  }

  // Surf-ACCURACY guard (prefer accuracy over heatmap grid-parity): the global-COARSE frame's product id — or
  // a globe-wide bbox — makes /point sample a ~10° coarse cell, which mislocates the dominant component and
  // returns wildly wrong height/direction at the real point (confirmed live: a coarse cell read 9.3ft/ENE/8.3s
  // where the precise viewport tile reads 2.7ft/SW/12.3s). When the loaded grid is coarse/global, drop the grid
  // hints so the backend resolves the precise high-res viewport point. Parity still holds for regional/high-res
  // tiles (their product id isn't 'coarse' and their bbox is small).
  if (gridProductId && /coarse/i.test(gridProductId)) {
    gridProductId = null;
    gridBbox = null;
  } else if (gridBbox) {
    const _p = gridBbox.split(',').map(Number);
    if (_p.length === 4 && _p.every(n => !isNaN(n))) {
      let _w = Math.abs(_p[2] - _p[0]); if (_w > 180) _w = 360 - _w;
      if (_w > 60 || Math.abs(_p[3] - _p[1]) > 60) { gridProductId = null; gridBbox = null; } // too-wide ⇒ coarse
    }
  }

  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, layer, model);
  const provider = model === 'EURO' ? 'copernicus' : 'open-meteo';
  let cacheKey = `${model}_marine_${layer}_${lat.toFixed(2)}_${lng.toFixed(2)}_${validTimeStr}_${provider}`;
  if (gridProductId) {
    cacheKey += `_grid_${gridProductId}`;
  }
  if (gridBbox) {
    cacheKey += `_bbox_${gridBbox}`;
  }

  const cached = pointCache.get(cacheKey);
  if (cached) {
    console.log(`[Backend Weather Service] Cache hit for ${model} Marine: ${cacheKey}`);
    const clonedData = JSON.parse(JSON.stringify(cached.data));
    clonedData.source = 'cache';
    updateDiagnostics('point', { ...cached.details, source: 'cache' }, model);
    return clonedData;
  }

  let url = `${POINT_URL}?model=${model}&domain=marine&layer=${layer}&lat=${lat}&lng=${lng}&valid_time=${validTimeStr}`;
  if (gridProductId) {
    url += `&grid_product_id=${encodeURIComponent(gridProductId)}`;
  }
  if (gridBbox) {
    url += `&grid_bbox=${encodeURIComponent(gridBbox)}`;
  }

  if (model === 'GFS' && layer === 'waves' && hourOffset === 0) {
    recordTruthStage('pointRequest', {
      model,
      domain: 'marine',
      layer,
      valid_time: validTimeStr,
      grid_product_id: gridProductId,
      truthTag: window.__WEATHER_TRUTH_TRACE__?.stages?.find(s => s.stage === 'webglRender')?.truthTag
    }, 'backendWeatherServiceClient.js', 'fetchBackendExactPoint');
  }

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      let reason = `Backend conformed point returned HTTP ${res.status}`;
      let errorJson = null;
      try {
        errorJson = await res.json();
        if (errorJson && errorJson.reason) {
          reason = errorJson.reason;
        } else if (errorJson && errorJson.detail) {
          reason = errorJson.detail;
        }
      } catch (e) { /* keep default reason */ }

      if (reason === 'no_backend_coverage' || reason === 'no_copernicus_coverage') {
        const errorDetails = {
          url,
          status: res.status,
          validTime: validTimeStr,
          valueKind: 'none',
          valueUnit: 'none',
          displayUnitHint: 'none',
          elapsedMs: Date.now() - start,
          error: reason,
          hourOffset,
          layer,
          speed: 0,
          direction: 0,
          interpolationMethod: 'none',
          provider: 'backend-weather-service',
          sourceDataset: null,
          sourceVariables: null,
          is_forecast_authoritative: false,
          is_estimated: false,
          is_test_fixture: false
        };
        updateDiagnostics('point', errorDetails, model);
        return {
          status: reason,
          hourly: { time: [] },
          requestedLat: lat,
          requestedLng: lng,
          requestedModel: model,
          activeLayer: layer,
          provider: 'backend-weather-service',
          source: 'backend_point_api'
        };
      }
      throw new Error(reason);
    }
    const json = await res.json();
    if (model === 'GFS' && layer === 'waves' && hourOffset === 0) {
      recordTruthStage('pointResponse', {
        model,
        domain: 'marine',
        layer,
        valid_time: json.valid_time,
        product_id: json.product_id,
        truthTag: json.truthTag
      }, 'backendWeatherServiceClient.js', 'fetchBackendExactPoint');
    }
    
    const mockTime = validTimeStr.replace(/\.\d+Z$/, 'Z');
    const conformedHourly = {
      time: [mockTime],
      wave_height: [null],
      wave_direction: [null],
      wave_period: [null],
      wave_peak_period: [null],
      swell_wave_height: [null],
      swell_wave_direction: [null],
      swell_wave_period: [null],
      swell_wave_peak_period: [null],
      secondary_swell_wave_height: [null],
      secondary_swell_wave_direction: [null],
      secondary_swell_wave_period: [null],
      wind_wave_height: [null],
      wind_wave_direction: [null],
      wind_wave_period: [null],
      wind_wave_peak_period: [null]
    };

    // /point returns ZEROS with interpolation_method 'unavailable' when no ocean cell is reachable —
    // e.g. the Gulf of Mexico: no regional tile AND every surrounding 10° coarse cell center is land,
    // so the nearest-ocean search finds nothing (Texas coast live report, 2026-07-03). Conform those
    // to NULL so the infobox shows its no-data state instead of a confident "0.0 ft / N 0" — the same
    // contract as the all-land grid-cell fix (3f45d004).
    const _ptUnavailable = !json.point || json.point.interpolation_method === 'unavailable';
    const _ptSpeed = _ptUnavailable ? null : (json.point.speed || 0);
    const _ptDir = _ptUnavailable ? null : (json.point.direction || 0);
    const _ptPer = _ptUnavailable ? null : (json.point.period || 0);

    if (layer === 'waves') {
      conformedHourly.wave_height = [_ptSpeed];
      conformedHourly.wave_direction = [_ptDir];
      conformedHourly.wave_period = [_ptPer];
      conformedHourly.wave_peak_period = [null];
    } else if (layer === 'swell_1') {
      conformedHourly.swell_wave_height = [_ptSpeed];
      conformedHourly.swell_wave_direction = [_ptDir];
      conformedHourly.swell_wave_period = [_ptPer];
      conformedHourly.swell_wave_peak_period = [null];
    } else if (layer === 'swell_2') {
      conformedHourly.secondary_swell_wave_height = [_ptSpeed];
      conformedHourly.secondary_swell_wave_direction = [_ptDir];
      conformedHourly.secondary_swell_wave_period = [_ptPer];
    } else if (layer === 'wind_waves') {
      conformedHourly.wind_wave_height = [_ptSpeed];
      conformedHourly.wind_wave_direction = [_ptDir];
      conformedHourly.wind_wave_period = [_ptPer];
      conformedHourly.wind_wave_peak_period = [null];
    }

    const data = {
      hourly: conformedHourly,
      snappedLat: json.point.sampled_lat || lat,
      snappedLng: json.point.sampled_lng || lng,
      requestedLat: lat,
      requestedLng: lng,
      requestedModel: model,
      activeLayer: layer,
      forecastDays: 1,
      apiModel: model === 'ICON' ? 'gwam' : (model === 'EURO' ? 'ecmwf_wam025' : 'ncep_gfswave025'),
      provider: json.provider || provider,
      source: 'network',
      status: json.status || json.coverage_status || 'exact_success',
      is_estimated: json.is_estimated || false,
      estimate_basis: json.estimate_basis || null,
      productId: json.product_id || null,
      // Option-2 bathymetry surf transform (estimate): nearshore breaking height for this point/hour.
      surf_height_m: (json.surf_height_m ?? null),
      surf_regime: (json.surf_regime ?? null),
      shelf_depth_m: (json.shelf_depth_m ?? null),
      surf_nearshore: (json.surf_nearshore ?? null)
    };

    const details = {
      url,
      status: res.status,
      validTime: validTimeStr,
      valueKind: json.value_kind || (layer === 'swell_1' ? 'swell_wave_height' : 'wave_height'),
      valueUnit: json.value_unit || 'm',
      displayUnitHint: json.display_unit_hint || 'ft',
      elapsedMs: Date.now() - start,
      error: null,
      hourOffset,
      layer,
      speed: json.point.speed || 0,
      direction: json.point.direction || 0,
      period: json.point.period || 0,
      interpolationMethod: json.point.interpolation_method || 'bilinear',
      provider: json.provider || provider,
      sourceDataset: json.source_dataset,
      sourceVariables: json.source_variables,
      is_forecast_authoritative: json.is_forecast_authoritative,
      is_estimated: json.is_estimated,
      estimate_basis: json.estimate_basis || null,
      estimateBasis: json.estimate_basis || null,
      is_test_fixture: json.is_test_fixture,
      productId: json.product_id || null,
      pointProductId: json.product_id || null,
      source: json.source || 'network',
      is_dynamic_viewport_product: json.is_dynamic_viewport_product || false,
      coverage_scope: json.coverage_scope || null,
      requested_bbox: json.requested_bbox || null,
      served_bbox: json.served_bbox || null,
      resolution: json.resolution || null,
      coordinate_count: json.coordinate_count || null,
      cache_key: json.cache_key || null,
      cache_hit: json.cache_hit || null
    };

    if (typeof window !== 'undefined' && model === 'GFS' && layer === 'waves' && hourOffset === 0) {
      window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
      window.__GFS_WAVES_SINGLE_SLICE_TRACE__.exactPoint = {
        pointRequestUrl: url,
        pointProductId: json.point?.product_id || json.product_id || null,
        pointValidTime: json.point?.valid_time || json.valid_time || null,
        pointSpeed: json.point?.speed,
        pointDirection: json.point?.direction,
        pointPeriod: json.point?.period,
        gridProductId: gridProductId,
        gridParity: json.gridParity !== undefined ? json.gridParity : (json.point?.grid_parity),
        fallbackReason: json.fallbackReason || json.point?.fallback_reason || null,
        coverageStatus: json.status || json.coverage_status || null,
        infoboxDisplayedHeight: json.point?.speed ? `${json.point.speed.toFixed(1)} m` : 'No Data'
      };
      if (typeof window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ === 'function') {
        window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__();
      }
    }

    pointCache.set(cacheKey, { data, details });
    updateDiagnostics('point', details, model);
    return data;
  } catch (err) {
    const status = err.message.includes('HTTP') ? parseInt(err.message.match(/\d+/)?.[0] || '0') : 500;
    updateDiagnostics('point', {
      url,
      status,
      validTime: validTimeStr,
      valueKind: 'none',
      valueUnit: 'none',
      displayUnitHint: 'none',
      elapsedMs: Date.now() - start,
      error: err.message,
      hourOffset,
      layer,
      speed: 0,
      direction: 0,
      interpolationMethod: 'none',
      provider: 'none',
      sourceDataset: null,
      sourceVariables: null,
      is_forecast_authoritative: false,
      is_estimated: false,
      is_test_fixture: false
    }, model);
    if (err.name === 'AbortError' || err.message?.includes('abort')) {
      console.log(`[Backend Weather Service] Point fetch aborted (expected during model/layer switch).`);
    } else {
      console.error(`[Backend Weather Service] Point fetch error: ${err.message}. Falling back cleanly to standard proxy pipeline.`);
    }
    throw err;
  }
}
