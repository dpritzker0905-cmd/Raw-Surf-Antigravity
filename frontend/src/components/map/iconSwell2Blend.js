/**
 * iconSwell2Blend.js — ICON secondary swell, synthesized from GFS + EURO (owner decision: intended, D-003).
 *
 * ICON/GWAM has no native swell_2. The map shows a 60 % GFS + 40 % EURO weighted blend (GFS alone where EURO has no
 * cell). This module is the ONE place that math lives, so the per-hour path (fetchBackendMarineGrid) and the series
 * path (marineGridSeries: blending two cached series frames, no network) can never disagree on a number.
 *
 * Moved verbatim from backendWeatherServiceClient.js (2026-10-19); behaviour is pinned by iconSwell2Blend.test.js.
 */
import { blendSubVector } from './marineDirectionBlend';

/** Hours for which ICON swell_2 is the GFS/EURO blend (beyond 240 h the ICON extended path owns it). */
export const ICON_SWELL2_BLEND_MAX_HOUR = 240;

export function isIconSwell2Blend(model, layer, hourOffset) {
  return (model || '').toUpperCase() === 'ICON' && layer === 'swell_2'
    && !(Number(hourOffset) > ICON_SWELL2_BLEND_MAX_HOUR);
}

function unsupported(hourOffset, snappedBounds) {
  return {
    type: 'FeatureCollection', features: [], hourOffset,
    grid: {
      vectors: [], bounds: snappedBounds || { west: -180, south: -80, east: 180, north: 85 },
      cols: 0, rows: 0, timestamp: Date.now(),
      __sourceModel: 'ICON', __provider: 'none', __gridProvider: 'none',
      __componentLayer: 'swell_2', __gridSupportsLayer: false,
      __activeLayerNonzeroCount: 0, __activeLayerMax: 0, __oceanMaskCount: 0,
      __renderable: false, __unsupportedLayer: true,
      provider: 'none', hourOffset, nonzeroCount: 0, maxSpeed: 0,
      renderable: false, status: 'unsupported'
    },
    __renderable: false, __unsupportedLayer: true, status: 'unsupported'
  };
}

/**
 * Blend a GFS swell_2 grid and a EURO swell_2 grid (either may be null) into the ICON swell_2 marineData object.
 * `gfsGrid` / `euroGrid` are the `.grid` objects of the two marineData results.
 */
export function blendIconSwell2(gfsGrid, euroGrid, hourOffset, snappedBounds, { quiet = false } = {}) {
  const gfsVectors = gfsGrid?.vectors || [];
  const euroVectors = euroGrid?.vectors || [];

  // Anchor the blend on the grid with MORE vectors (the finer/fuller resolution). FIX: GFS swell_2 can
  // come back as a coarse fallback (e.g. 60 vectors) while EURO returns a rich dynamic grid (629 vectors,
  // 348 nonzero in the Gulf) — anchoring on GFS + an exact (lat*100)|0 key DROPPED EURO's real secondary
  // swell, leaving the "Gulf/Antarctica square of no swell_2". Anchor on the fuller grid so that coverage
  // is preserved; then per-cell use whichever source actually has secondary swell.
  const gfsIsPrimary = gfsVectors.length >= euroVectors.length;
  const primaryVectors = gfsIsPrimary ? gfsVectors : euroVectors;
  const secondaryVectors = gfsIsPrimary ? euroVectors : gfsVectors;
  const primaryGrid = gfsIsPrimary ? gfsGrid : euroGrid;

  if (!primaryVectors.length) return unsupported(hourOffset, snappedBounds);

  // TOLERANT secondary lookup keyed at ~0.5° so a primary cell still matches a slightly-offset or
  // coarser secondary cell (the old exact 0.01° key missed whenever the two grids' centres/resolutions
  // differed — the root of the dropped-EURO bug). Keep the strongest secondary in each 0.5° bucket so a
  // zero never overwrites real swell.
  const skey = (lat, lng) => `${Math.round(lat * 2)},${Math.round(lng * 2)}`;
  let secondaryLookup = null;
  if (secondaryVectors.length > 0) {
    secondaryLookup = new Map();
    for (let i = 0; i < secondaryVectors.length; i++) {
      const sv = secondaryVectors[i];
      const key = skey(sv.lat, sv.lng);
      const ex = secondaryLookup.get(key);
      if (!ex || (sv.speed || 0) > (ex.speed || 0)) secondaryLookup.set(key, sv);
    }
  }

  // Source weights (GFS 0.6 / EURO 0.4) applied by ORIGIN regardless of which grid is the anchor.
  const bothPresent = gfsVectors.length > 0 && euroVectors.length > 0;
  const GFS_WEIGHT = bothPresent ? 0.6 : (gfsVectors.length > 0 ? 1.0 : 0.0);
  const EURO_WEIGHT = 1.0 - GFS_WEIGHT;
  const primaryW = gfsIsPrimary ? GFS_WEIGHT : EURO_WEIGHT;
  const secondaryW = gfsIsPrimary ? EURO_WEIGHT : GFS_WEIGHT;
  let maxSpeed = 0, nonzeroCount = 0;

  const blendedVectors = primaryVectors.map(pv => {
    const sv = secondaryLookup ? secondaryLookup.get(skey(pv.lat, pv.lng)) : null;
    const pAvailable = pv.isOcean !== false && pv.is_valid !== false;
    const sAvailable = sv && sv.isOcean !== false && sv.is_valid !== false;
    // Keep full-strength single-source ocean coverage, but never synthesize a bearing
    // from cancelling directions or include a masked secondary source.
    const blended = pAvailable && sAvailable && pv.speed > 0 && sv.speed > 0
      ? blendSubVector(pv, sv, primaryW, secondaryW)
      : blendSubVector(sAvailable && sv.speed > 0 ? sv : (pAvailable ? pv : null), null, 1, 0);
    if (blended.speed > maxSpeed) maxSpeed = blended.speed;
    if (blended.speed > 0) nonzeroCount++;
    return { lat: pv.lat, lng: pv.lng, ...blended };
  });

  const blendedGrid = {
    vectors: blendedVectors,
    bounds: primaryGrid.bounds || snappedBounds || { west: -180, south: -80, east: 180, north: 85 },
    cols: primaryGrid.cols || 0,
    rows: primaryGrid.rows || 0,
    timestamp: Date.now(),
    __sourceModel: 'ICON',
    __provider: 'estimated',
    __gridProvider: 'gfs_euro_blend',
    __componentLayer: 'swell_2',
    __gridSupportsLayer: true,
    __activeLayerNonzeroCount: nonzeroCount,
    __activeLayerMax: maxSpeed,
    __oceanMaskCount: primaryGrid.__oceanMaskCount || 0,
    __renderable: blendedVectors.length > 0,
    provider: 'estimated',
    source_dataset: 'estimated_blend',
    hourOffset,
    nonzeroCount,
    maxSpeed,
    renderable: blendedVectors.length > 0,
    is_estimated: true,
    isEstimated: true,
    estimate_basis: {
      type: 'icon_swell_2_gfs_euro_blend',
      method: 'weighted_average',
      gfs_weight: GFS_WEIGHT,
      euro_weight: EURO_WEIGHT,
      gfs_vectors: gfsVectors.length,
      euro_vectors: euroVectors.length,
      source_model: `${gfsGrid?.__sourceDataset || 'ncep_gfswave025'}+${euroGrid?.__sourceDataset || 'cmems_mod_glo_wav_anfc_0.083deg_PT3H-i'}` // A15-01: EURO swell_2 is CMEMS, not WAM
    }
  };

  if (!quiet) {
    console.log(`[Backend] ICON swell_2 blend: ${blendedVectors.length} vectors (GFS:${gfsVectors.length} EURO:${euroVectors.length}), max:${maxSpeed.toFixed(2)}, nz:${nonzeroCount}`);
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
