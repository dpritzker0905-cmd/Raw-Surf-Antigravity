/**
 * backendWeatherServiceClientHelpers.js
 * 
 * Helper functions extracted from backendWeatherServiceClient.js to keep file size under 800 lines.
 * Contains vector mathematics, circular-blending helpers, DWD ICON extended-range
 * forecast blending, and schema mapping for WebGL grid structures.
 */

import { recordTruthStage } from './weatherTruthTracker';
import { updateDiagnostics, updateProjectionDiag } from './backendWeatherServiceClientDiag';
import { arrayMax } from './marineControllerUtils';

/**
 * Perform circular blending for direction vectors.
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
  return directions[0] != null ? directions[0] : null;
}

/**
 * Weighted average of wave periods.
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
 * Average individual sub-layer vectors using direction/period circular weights.
 */
export function blendSubVector(v1, v2, w1, w2) {
  if (!v1 && !v2) return { u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0, isOcean: false };
  if (!v1) return v2;
  if (!v2) return v1;
  const h1 = v1.speed || 0;
  const h2 = v2.speed || 0;
  const blendedHeight = h1 * w1 + h2 * w2;

  const p1 = v1.period || 0;
  const p2 = v2.period || 0;
  const blendedPeriod = blendPeriod([p1, p2], [w1, w2]) || 0;

  const d1 = v1.direction !== undefined ? v1.direction : ((Math.atan2(-v1.u, -v1.v) * 180 / Math.PI + 360) % 360);
  const d2 = v2.direction !== undefined ? v2.direction : ((Math.atan2(-v2.u, -v2.v) * 180 / Math.PI + 360) % 360);
  const blendedDirection = blendDirection([h1, h2], [d1, d2], [w1, w2]);

  let u = 0;
  let v = 0;
  if (blendedHeight > 0 && blendedDirection != null) {
    const rad = (blendedDirection * Math.PI) / 180;
    u = -blendedHeight * Math.sin(rad);
    v = -blendedHeight * Math.cos(rad);
  }
  return {
    u,
    v,
    speed: blendedHeight,
    period: blendedPeriod,
    height: blendedHeight,
    direction: blendedDirection,
    isOcean: v1.isOcean || v2.isOcean
  };
}

/**
 * Extrapolates trend delta of GFS model onto anchor DWD ICON vector.
 */
export function extrapolateSubVector(iconAnchor, gfsAnchor, gfsTarget, weightPersist, weightGfs) {
  if (!iconAnchor) return { u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0, isOcean: false };
  const hIcon = iconAnchor.speed || 0;
  const pIcon = iconAnchor.period || 0;
  const dIcon = iconAnchor.direction !== undefined ? iconAnchor.direction : ((Math.atan2(-iconAnchor.u, -iconAnchor.v) * 180 / Math.PI + 360) % 360);

  const hGfsAnchor = gfsAnchor?.speed || 0;
  const hGfsTarget = gfsTarget?.speed || 0;
  const hGfsTrend = Math.max(0, hIcon + (hGfsTarget - hGfsAnchor));

  const pGfsAnchor = gfsAnchor?.period || 0;
  const pGfsTarget = gfsTarget?.period || 0;
  const pGfsTrend = pGfsAnchor > 0 ? Math.max(2, pIcon + (pGfsTarget - pGfsAnchor)) : pIcon;

  const dGfsTarget = gfsTarget ? (gfsTarget.direction !== undefined ? gfsTarget.direction : ((Math.atan2(-gfsTarget.u, -gfsTarget.v) * 180 / Math.PI + 360) % 360)) : dIcon;
  const dGfsTrend = dGfsTarget;

  const blendedHeight = Math.max(0, weightPersist * hIcon + weightGfs * hGfsTrend);
  const blendedPeriod = blendPeriod([pIcon, pGfsTrend], [weightPersist, weightGfs]) || 0;
  const blendedDirection = blendDirection([hIcon, hGfsTrend], [dIcon, dGfsTrend], [weightPersist, weightGfs]);

  let u = 0;
  let v = 0;
  if (blendedHeight > 0 && blendedDirection != null) {
    const rad = (blendedDirection * Math.PI) / 180;
    u = -blendedHeight * Math.sin(rad);
    v = -blendedHeight * Math.cos(rad);
  }
  return {
    u,
    v,
    speed: blendedHeight,
    period: blendedPeriod,
    height: blendedHeight,
    direction: blendedDirection,
    isOcean: iconAnchor.isOcean
  };
}

/**
 * Maps standard backend grid response to WebGLLayer expectations.
 */
export function mapNormalizedGridToWebGL(json, snappedBounds, hourOffset, layer = 'waves', model = 'GFS') {
  if (!json || !json.grid || !Array.isArray(json.grid.vectors)) {
    throw new Error("Invalid normalized grid response structure");
  }

  // Oversized-grid guard. Every legitimate marine product is small: dynamic
  // viewport ~9x9, regional ~33x33, global coarse ~37x17. A response carrying a
  // native global 0.25deg field (1441x661 = ~952k cells, observed transiently
  // before the coarse product is cached) would freeze the tab in encodeMarineTexture
  // + land-mask build + particle-texture reset. Treat it as a transient
  // non-renderable so the SWR retry re-fetches the normal coarse product instead of
  // committing a ~1M-vector grid. Cap is far above any real product (<~3k cells).
  const MAX_GRID_CELLS = 250000;
  const rawVectorCount = json.grid.vectors.length;
  if (rawVectorCount > MAX_GRID_CELLS) {
    console.warn(`[Backend Weather Service] Oversized grid rejected: ${rawVectorCount} vectors (cols=${json.grid.cols}, rows=${json.grid.rows}) exceeds cap ${MAX_GRID_CELLS}. Treating as transient non-renderable so the retry fetches the coarse product.`);
    return {
      type: 'FeatureCollection',
      features: [],
      hourOffset,
      grid: {
        vectors: [],
        bounds: json.grid.bounds || snappedBounds,
        cols: 0,
        rows: 0,
        timestamp: Date.now(),
        __sourceModel: model,
        __provider: json.provider || 'backend-weather-service',
        __gridProvider: json.provider || 'backend-weather-service',
        __componentLayer: layer,
        __gridSupportsLayer: false,
        __activeLayerNonzeroCount: 0,
        __activeLayerMax: 0,
        __oceanMaskCount: 0,
        __renderable: false,
        provider: json.provider || 'backend-weather-service',
        hourOffset,
        nonzeroCount: 0,
        maxSpeed: 0,
        renderable: false,
        emptyGridWarning: `Oversized grid (${rawVectorCount} cells, ${json.grid.cols}x${json.grid.rows}) rejected — anomalous backend resolution`,
        productId: json.product_id || null,
        oversizedRejected: true
      },
      __renderable: false
    };
  }

  const zeroVec = { u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0, isOcean: false };
  const mappedVectors = json.grid.vectors.map(v => {
    const hasConjoined = !!(v.waves || v.swell_1 || v.swell_2 || v.wind_waves);
    
    let activeSource = v;
    if (hasConjoined && v[layer]) {
      activeSource = v[layer];
    }
    
    const u = activeSource.u || 0;
    const v_val = activeSource.v || 0;
    const speed = activeSource.speed || 0;
    const period = activeSource.period || 0;
    const height = activeSource.height !== undefined ? activeSource.height : speed;
    const direction = activeSource.direction !== undefined ? activeSource.direction : ((Math.atan2(-u, -v_val) * 180 / Math.PI + 360) % 360);
    const isOcean = activeSource.is_valid !== false && activeSource.isOcean !== false;

    const componentUV = { u, v: v_val, speed, period, height, direction, isOcean };

    const getConjoinedLayer = (layerName) => {
      if (v[layerName]) {
        const sub = v[layerName];
        const subU = sub.u || 0;
        const subV = sub.v || 0;
        const subSpeed = sub.speed || 0;
        const subPeriod = sub.period || 0;
        const subHeight = sub.height !== undefined ? sub.height : subSpeed;
        const subDirection = sub.direction !== undefined ? sub.direction : ((Math.atan2(-subU, -subV) * 180 / Math.PI + 360) % 360);
        const subIsOcean = sub.isOcean !== undefined ? sub.isOcean : (sub.is_valid !== false && isOcean);
        return { u: subU, v: subV, speed: subSpeed, period: subPeriod, height: subHeight, direction: subDirection, isOcean: subIsOcean };
      }
      return layer === layerName ? componentUV : zeroVec;
    };

    return {
      lat: v.lat,
      lng: v.lng,
      u,
      v: v_val,
      speed,
      period,
      height,
      direction,
      isOcean,
      waves: getConjoinedLayer('waves'),
      swell_1: getConjoinedLayer('swell_1'),
      swell_2: getConjoinedLayer('swell_2'),
      wind_waves: getConjoinedLayer('wind_waves')
    };
  });

  const nonzeroCount = mappedVectors.filter(v => v[layer].speed > 0).length;
  const maxSpeed = arrayMax(mappedVectors.map(v => v[layer].speed));
  
  const renderable = mappedVectors.length > 0;

  if (!renderable) {
    console.warn(`[Backend Weather Service] Grid is not renderable. mappedVectors=${mappedVectors.length}`);
  }

  const result = {
    type: 'FeatureCollection',
    features: [],
    hourOffset,
    stale: json.stale || false,
    staleReason: json.staleReason || null,
    tile_id: json.tile_id || json.region_id || null,
    region_id: json.region_id || json.tile_id || null,
    grid: {
      vectors: mappedVectors,
      bounds: json.grid.bounds || snappedBounds,
      cols: json.grid.cols,
      rows: json.grid.rows,
      timestamp: Date.now(),
      __sourceModel: model,
      __provider: json.provider || 'backend-weather-service',
      __gridProvider: json.provider || 'backend-weather-service',
      __componentLayer: layer,
      __gridSupportsLayer: renderable,
      __activeLayerNonzeroCount: nonzeroCount,
      __activeLayerMax: maxSpeed,
      __oceanMaskCount: mappedVectors.length,
      __renderable: renderable,
      provider: json.provider || 'backend-weather-service',
      hourOffset,
      nonzeroCount,
      maxSpeed,
      renderable,
      emptyGridWarning: !renderable ? "All vectors in grid are zero or null, or grid is empty" : null,
      productId: json.product_id || null,
      region_id: json.region_id || json.tile_id || null,
      coverage_scope: json.coverage_scope || null,
      is_estimated: json.is_estimated !== undefined ? json.is_estimated : false,
      estimate_basis: json.estimate_basis || null,
      is_dynamic_viewport_product: json.is_dynamic_viewport_product || false,
      validTime: json.valid_time || null,
      valid_time: json.valid_time || null,
      truthTag: json.truthTag || null,
      stale: json.stale || false,
      staleReason: json.staleReason || null
    },
    validTime: json.valid_time || null,
    valid_time: json.valid_time || null,
    truthTag: json.truthTag || null
  };

  if (typeof window !== 'undefined' && model === 'GFS' && layer === 'waves' && hourOffset === 0) {
    recordTruthStage('mappedGrid', {
      model,
      domain: 'marine',
      layer,
      valid_time: result.valid_time,
      run_time: json.run_time,
      product_id: result.grid.productId,
      is_dynamic_viewport_product: result.grid.is_dynamic_viewport_product,
      coverage_scope: result.grid.coverage_scope,
      requested_bbox: json.requested_bbox,
      served_bbox: json.served_bbox,
      grid: result.grid,
      truthTag: json.truthTag
    }, 'backendWeatherServiceClient.js', 'mapNormalizedGridToWebGL');

    window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
    const rootFlatSpeedNonzeroCount = mappedVectors.filter(v => v.speed > 0).length;
    const nestedWavesSpeedNonzeroCount = mappedVectors.filter(v => v.waves && v.waves.speed > 0).length;
    const rootFlatMaxSpeed = arrayMax(mappedVectors.map(v => v.speed));
    const nestedWavesMaxSpeed = arrayMax(mappedVectors.map(v => v.waves ? v.waves.speed : 0));
    const sampleMapped = mappedVectors.filter(v => v.speed > 0).slice(0, 5).map(v => ({
      root: {
        speed: v.speed,
        u: v.u,
        v: v.v,
        period: v.period,
        isOcean: v.isOcean
      },
      waves: {
        speed: v.waves ? v.waves.speed : null,
        u: v.waves ? v.waves.u : null,
        v: v.waves ? v.waves.v : null,
        period: v.waves ? v.waves.period : null
      }
    }));
    window.__GFS_WAVES_SINGLE_SLICE_TRACE__.mappedGrid = {
      gridProductId: json.product_id || null,
      bounds: json.grid?.bounds || snappedBounds,
      cols: json.grid?.cols,
      rows: json.grid?.rows,
      vectorsLength: mappedVectors.length,
      activeLayer: layer,
      rootFlatSpeedNonzeroCount,
      nestedWavesSpeedNonzeroCount,
      rootFlatMaxSpeed,
      nestedWavesMaxSpeed,
      sampleMappedVectors: sampleMapped
    };
    if (typeof window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ === 'function') {
      window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__();
    }
  }

  return result;
}

// ICON extended-blend ANCHOR cache. The anchors (ICON@168, GFS@168) are FIXED-hour fetches that
// are identical across timeline scrub steps for a given viewport — but the blend ran them on the
// caller's per-step signal, so every scrub step re-issued and the next step aborted them; they
// never completed → the blend never got anchors → safe-zero. Dedup per {model,layer,bbox} on a
// DEDICATED controller that survives scrub steps (so a no-pan scrub fetches each anchor once and
// reuses it). BOUNDED (not the reverted-shield pattern): at most one in-flight anchor per key, and
// a viewport (bbox) change ABORTS + evicts the stale-bbox anchors before starting new ones — so at
// most ICON+GFS in flight at a time, never accumulating across pans.
const _iconAnchorCache = new Map(); // key -> { promise, controller, ts }
const ICON_ANCHOR_TTL_MS = 5 * 60 * 1000;

function _anchorBboxKey(bounds, snappedBounds) {
  const b = bounds || snappedBounds || {};
  const r = v => (typeof v === 'number' ? v.toFixed(2) : 'x');
  return `${r(b.west)}_${r(b.south)}_${r(b.east)}_${r(b.north)}`;
}

function getCachedIconAnchor(model, layer, bounds, snappedBounds, fetchBackendMarineGridRecur) {
  const bboxKey = _anchorBboxKey(bounds, snappedBounds);
  const key = `${model}_${layer}_${bboxKey}`;
  const existing = _iconAnchorCache.get(key);
  if (existing && Date.now() - existing.ts < ICON_ANCHOR_TTL_MS) {
    return existing.promise; // warm hit — no network request (the scrub-step win)
  }
  // Evict + abort any anchor for this model+layer at a DIFFERENT bbox (a pan happened) so stale
  // requests can't pile up on the 1-CPU backend.
  for (const [k, v] of _iconAnchorCache) {
    if (k.startsWith(`${model}_${layer}_`) && k !== key) {
      try { v.controller.abort(); } catch (e) {}
      _iconAnchorCache.delete(k);
    }
  }
  const controller = new AbortController();
  const promise = fetchBackendMarineGridRecur(bounds, 168, controller.signal, snappedBounds, layer, model)
    .catch((e) => { _iconAnchorCache.delete(key); throw e; }); // drop on failure so the next step retries
  _iconAnchorCache.set(key, { promise, controller, ts: Date.now() });
  return promise;
}

/**
 * Handle DWD ICON extended-range grid fetching and blending.
 */
export async function fetchBackendMarineGridIconExtended(bounds, hourOffset, signal, snappedBounds, layer, fetchBackendMarineGridRecur) {
  updateProjectionDiag('marine', {
    activeModel: 'ICON',
    activeLayer: layer,
    requestedViewportBounds: bounds || snappedBounds,
    renderable: true,
    renderDecision: 'estimated_blend',
    reason: hourOffset <= 240 ? 'icon_trend_extrapolation' : 'icon_gfs_euro_blend',
    timeOffsetHours: hourOffset
  });

  try {
    if (hourOffset <= 240) {
      const [iconAnchorResult, gfsAnchorResult, gfsTargetResult] = await Promise.allSettled([
        // Anchors (fixed @168h) are deduped+cached per viewport on a dedicated controller so a
        // no-pan scrub fetches them once; the varying-hour TARGET keeps the caller's per-step signal.
        getCachedIconAnchor('ICON', layer, bounds, snappedBounds, fetchBackendMarineGridRecur),
        getCachedIconAnchor('GFS', layer, bounds, snappedBounds, fetchBackendMarineGridRecur),
        fetchBackendMarineGridRecur(bounds, hourOffset, signal, snappedBounds, layer, 'GFS')
      ]);

      const iconAnchorGrid = iconAnchorResult.status === 'fulfilled' ? iconAnchorResult.value : null;
      const gfsAnchorGrid = gfsAnchorResult.status === 'fulfilled' ? gfsAnchorResult.value : null;
      const gfsTargetGrid = gfsTargetResult.status === 'fulfilled' ? gfsTargetResult.value : null;

      const iconVectors = iconAnchorGrid?.grid?.vectors || [];
      const gfsAnchorVectors = gfsAnchorGrid?.grid?.vectors || [];
      const gfsTargetVectors = gfsTargetGrid?.grid?.vectors || [];

      // Deferred-2: if the inputs were ABORTED (cap eviction / unmount / switch), propagate an
      // AbortError so the fetcher's isAbort path handles it — don't mask it as a generic
      // "sources unavailable" error that would commit a safe-zero grid.
      if (signal?.aborted || iconAnchorResult.reason?.name === 'AbortError' ||
          gfsAnchorResult.reason?.name === 'AbortError' || gfsTargetResult.reason?.name === 'AbortError') {
        const e = new Error('ICON extended estimate fetch aborted'); e.name = 'AbortError'; throw e;
      }

      if (!iconVectors.length) {
        if (gfsTargetGrid) return gfsTargetGrid;
        throw new Error('ICON extended estimate anchor and target GFS are both unavailable');
      }

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

      const blendedVectors = [];
      let nonzeroCount = 0;

      for (let i = 0; i < iconVectors.length; i++) {
        const iv = iconVectors[i];
        const gfsAv = gfsAnchorVectors[i] || gfsAnchorVectors.find(v => Math.abs(v.lat - iv.lat) < 0.01 && Math.abs(v.lng - iv.lng) < 0.01);
        const gfsTv = gfsTargetVectors[i] || gfsTargetVectors.find(v => Math.abs(v.lat - iv.lat) < 0.01 && Math.abs(v.lng - iv.lng) < 0.01);

        if (!iv.isOcean) {
          blendedVectors.push({
            lat: iv.lat, lng: iv.lng, isOcean: false,
            u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0,
            waves: { u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0, isOcean: false },
            swell_1: { u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0, isOcean: false },
            swell_2: { u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0, isOcean: false },
            wind_waves: { u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0, isOcean: false }
          });
          continue;
        }

        const blendedWaves = extrapolateSubVector(iv.waves || iv, gfsAv?.waves || gfsAv, gfsTv?.waves || gfsTv, weightPersist, weightGfs);
        const blendedSwell1 = extrapolateSubVector(iv.swell_1, gfsAv?.swell_1, gfsTv?.swell_1, weightPersist, weightGfs);
        const blendedSwell2 = extrapolateSubVector(iv.swell_2, gfsAv?.swell_2, gfsTv?.swell_2, weightPersist, weightGfs);
        const blendedWindWaves = extrapolateSubVector(iv.wind_waves, gfsAv?.wind_waves, gfsTv?.wind_waves, weightPersist, weightGfs);

        const activeBlended = layer === 'waves' ? blendedWaves
                          : layer === 'swell_1' ? blendedSwell1
                          : layer === 'swell_2' ? blendedSwell2
                          : blendedWindWaves;

        if (activeBlended.speed > 0.05) nonzeroCount++;

        blendedVectors.push({
          lat: iv.lat, lng: iv.lng, isOcean: true,
          u: activeBlended.u, v: activeBlended.v,
          speed: activeBlended.speed, period: activeBlended.period,
          height: activeBlended.height, direction: activeBlended.direction,
          waves: blendedWaves,
          swell_1: blendedSwell1,
          swell_2: blendedSwell2,
          wind_waves: blendedWindWaves
        });
      }

      const maxSpeed = arrayMax(blendedVectors.map(v => v.speed));
      const blendedGrid = {
        vectors: blendedVectors,
        bounds: iconAnchorGrid.grid.bounds || snappedBounds || { west: -180, south: -80, east: 180, north: 85 },
        cols: iconAnchorGrid.grid.cols || 0,
        rows: iconAnchorGrid.grid.rows || 0,
        timestamp: Date.now(),
        __sourceModel: 'ICON',
        __provider: 'estimated',
        __gridProvider: 'gfs_trend',
        __componentLayer: layer,
        __gridSupportsLayer: blendedVectors.length > 0,
        __activeLayerNonzeroCount: nonzeroCount,
        __activeLayerMax: maxSpeed,
        __oceanMaskCount: iconAnchorGrid.grid.__oceanMaskCount || 0,
        __renderable: blendedVectors.length > 0,
        provider: 'estimated',
        source_dataset: 'icon_trend_extrapolation',
        hourOffset,
        nonzeroCount,
        maxSpeed,
        renderable: blendedVectors.length > 0,
        is_estimated: true,
        isEstimated: true,
        estimate_basis: {
          type: 'icon_trend_extrapolation',
          method: 'persistence_gfs_trend',
          weight_persist: weightPersist,
          weight_gfs: weightGfs
        }
      };

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
          vectorCount: blendedVectors.length,
          nonzeroCount,
          timestamp: new Date().toISOString()
        };
      }

      return {
        type: 'FeatureCollection',
        features: [],
        hourOffset,
        grid: blendedGrid,
        __renderable: blendedGrid.__renderable,
        status: 'ok'
      };
    } else {
      // hourOffset > 240
      const [gfsTargetResult, euroTargetResult] = await Promise.allSettled([
        fetchBackendMarineGridRecur(bounds, hourOffset, signal, snappedBounds, layer, 'GFS'),
        fetchBackendMarineGridRecur(bounds, hourOffset, signal, snappedBounds, layer, 'EURO')
      ]);

      const gfsTargetGrid = gfsTargetResult.status === 'fulfilled' ? gfsTargetResult.value : null;
      const euroTargetGrid = euroTargetResult.status === 'fulfilled' ? euroTargetResult.value : null;

      const gfsVectors = gfsTargetGrid?.grid?.vectors || [];
      const euroVectors = euroTargetGrid?.grid?.vectors || [];

      // Deferred-2: propagate aborted inputs as an AbortError (handled by the fetcher's isAbort
      // path) rather than masking them as "both unavailable" -> safe-zero commit.
      if (signal?.aborted || gfsTargetResult.reason?.name === 'AbortError' ||
          euroTargetResult.reason?.name === 'AbortError') {
        const e = new Error('ICON extended blend fetch aborted'); e.name = 'AbortError'; throw e;
      }

      if (!gfsVectors.length && !euroVectors.length) {
        throw new Error('ICON extended blend target GFS and EURO are both unavailable');
      }

      const primaryVectors = gfsVectors.length > 0 ? gfsVectors : euroVectors;
      const primaryGrid = gfsVectors.length > 0 ? gfsTargetGrid.grid : euroTargetGrid.grid;

      const GFS_WEIGHT = gfsVectors.length > 0 && euroVectors.length > 0 ? 0.6 : 1.0;
      const EURO_WEIGHT = 1.0 - GFS_WEIGHT;

      const blendedVectors = [];
      let nonzeroCount = 0;

      for (let i = 0; i < primaryVectors.length; i++) {
        const pv = primaryVectors[i];
        const sv = gfsVectors.length > 0
          ? euroVectors[i] || euroVectors.find(v => Math.abs(v.lat - pv.lat) < 0.01 && Math.abs(v.lng - pv.lng) < 0.01)
          : gfsVectors[i] || gfsVectors.find(v => Math.abs(v.lat - pv.lat) < 0.01 && Math.abs(v.lng - pv.lng) < 0.01);

        if (!pv.isOcean) {
          blendedVectors.push({
            lat: pv.lat, lng: pv.lng, isOcean: false,
            u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0,
            waves: { u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0, isOcean: false },
            swell_1: { u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0, isOcean: false },
            swell_2: { u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0, isOcean: false },
            wind_waves: { u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0, isOcean: false }
          });
          continue;
        }

        const blendedWaves = blendSubVector(pv.waves || pv, sv?.waves || sv, GFS_WEIGHT, EURO_WEIGHT);
        const blendedSwell1 = blendSubVector(pv.swell_1, sv?.swell_1, GFS_WEIGHT, EURO_WEIGHT);
        const blendedSwell2 = blendSubVector(pv.swell_2, sv?.swell_2, GFS_WEIGHT, EURO_WEIGHT);
        const blendedWindWaves = blendSubVector(pv.wind_waves, sv?.wind_waves, GFS_WEIGHT, EURO_WEIGHT);

        const activeBlended = layer === 'waves' ? blendedWaves
                          : layer === 'swell_1' ? blendedSwell1
                          : layer === 'swell_2' ? blendedSwell2
                          : blendedWindWaves;

        if (activeBlended.speed > 0.05) nonzeroCount++;

        blendedVectors.push({
          lat: pv.lat, lng: pv.lng, isOcean: true,
          u: activeBlended.u, v: activeBlended.v,
          speed: activeBlended.speed, period: activeBlended.period,
          height: activeBlended.height, direction: activeBlended.direction,
          waves: blendedWaves,
          swell_1: blendedSwell1,
          swell_2: blendedSwell2,
          wind_waves: blendedWindWaves
        });
      }

      const maxSpeed = arrayMax(blendedVectors.map(v => v.speed));
      const blendedGrid = {
        vectors: blendedVectors,
        bounds: primaryGrid.bounds || snappedBounds || { west: -180, south: -80, east: 180, north: 85 },
        cols: primaryGrid.cols || 0,
        rows: primaryGrid.rows || 0,
        timestamp: Date.now(),
        __sourceModel: 'ICON',
        __provider: 'estimated',
        __gridProvider: 'gfs_euro_blend',
        __componentLayer: layer,
        __gridSupportsLayer: blendedVectors.length > 0,
        __activeLayerNonzeroCount: nonzeroCount,
        __activeLayerMax: maxSpeed,
        __oceanMaskCount: primaryGrid.__oceanMaskCount || 0,
        __renderable: blendedVectors.length > 0,
        provider: 'estimated',
        source_dataset: 'gfs_euro_blend',
        hourOffset,
        nonzeroCount,
        maxSpeed,
        renderable: blendedVectors.length > 0,
        is_estimated: true,
        isEstimated: true,
        estimate_basis: {
          type: 'icon_extended_blend',
          method: 'weighted_average',
          gfs_weight: GFS_WEIGHT,
          euro_weight: EURO_WEIGHT
        }
      };

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
          weights: { gfs: GFS_WEIGHT, euro: EURO_WEIGHT },
          vectorCount: blendedVectors.length,
          nonzeroCount,
          timestamp: new Date().toISOString()
        };
      }

      return {
        type: 'FeatureCollection',
        features: [],
        hourOffset,
        grid: blendedGrid,
        __renderable: blendedGrid.__renderable,
        status: 'ok'
      };
    }
  } catch (blendErr) {
    console.error('[Backend Weather Client] ICON extended blending/extrapolation failed:', blendErr);
    throw blendErr;
  }
}
