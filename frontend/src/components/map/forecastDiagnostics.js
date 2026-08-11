/**
 * forecastDiagnostics.js
 *
 * Modularized diagnostic telemetry for marine forecast overlay.
 * Keeps forecastSamplers.js strictly under 800 lines.
 */

import { isInCooldown } from './marineControllerUtils';

// Layers the marine heatmap can be active on. `waves` is the DEFAULT and was missing from the
// disclosure path entirely — see the EURO-scoped branch below.
const MARINE_LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];

// ⛔ ORPHANED READS (fixed 2026-08-11, certification audit 11.2 / RC-02).
// This module read `webglDiag.renderedVectorCount` and `.renderedNonzeroCount`. NOTHING has
// written either name since the diag producer was renamed around `dcfce3c1` (2026-06-03):
// repo-wide both appeared 4 times, ALL reads, ZERO writes. Every read therefore resolved to
// `undefined`, and `|| 0` pinned it at 0 — permanently, for ~10 weeks. Two consequences, both
// measured live on production at `e015d90b`:
//   1. `__MARINE_SOURCE_PARITY__.heatmap.vectorCount` reported 0 while a 15,023-vector field
//      was on screen, so the parity gate below compared an "empty" heatmap against an idle
//      infobox and reported match:true. Reports 11.0 and 11.1 both read that PASS as meaningful.
//   2. The `isWebGLRendered` predicate in computeHeatmapStatus could never be true, so its
//      `return 'ready'` branch was dead.
// The producer publishes `webglSourceVectorCount` (WebGLMarineLayerDiag.js:18); the layer diag
// carries no nonzero count, so that comes off the upload diag.
// ★ Returns null — never 0 — when a count is unreadable, so callers can distinguish
//   "not sampled" from "sampled and genuinely zero". That distinction is the whole point.
// ⛔ A DEFAULT THAT LOOKS LIKE A MEASUREMENT (2026-08-11, audit 11.2 — a gap in the first fix).
// `WebGLMarineLayerDiag.js:11-38` publishes a DEFAULTS object at module load carrying
// `webglSourceVectorCount: 0`, `renderedProvider: null`, `status: 'not_initialized'` and
// `timestamp: null`. The real writer later REPLACES that object wholesale (14 keys, real
// timestamp, no `status`). So before the first write the key EXISTS with value 0 — and the
// original `?? null` guard only catches a MISSING key, not a present-but-uninitialised one.
// Observed live at the antimeridian: parity reported "heatmap: zero vectors rendered" while 629
// vectors were visibly painted. The refusal was correct by luck, for the wrong reason, and the
// same 0 would read as a genuine measurement once a real writer legitimately reports zero.
// ★ `timestamp == null` is the discriminator — the defaults set it null, every real write stamps
//   it. `status` is checked too because the defaults announce their own invalidity and it costs
//   nothing to believe them.
function isDiagUninitialised(d) {
  return !d || d.status === 'not_initialized' || d.timestamp == null;
}
function readHeatmapCounts(webglDiag) {
  const uploadDiag = typeof window !== 'undefined' ? window.__WEBGL_MARINE_UPLOAD_DIAG__ : null;
  const vectors = isDiagUninitialised(webglDiag)
    ? null
    : (webglDiag.webglSourceVectorCount ?? webglDiag.backendGridVectorCount ?? null);
  const nonzero = isDiagUninitialised(uploadDiag) ? null : (uploadDiag.nonzeroCount ?? null);
  return { vectors, nonzero };
}

export function computeHeatmapStatus({ activeModel, activeLayer, renderMarineData }) {
  if (typeof window === 'undefined') return null;

  if (!MARINE_LAYERS.includes(activeLayer)) return null;

  const statusDiag = window.__MARINE_HEATMAP_STATUS__;

  // ── MODEL-AGNOSTIC DEGRADATIONS ───────────────────────────────────────────────────────────────
  // ⛔ WHY THIS BRANCH EXISTS (2026-08-09). The gate here used to be
  //     if (activeModel !== 'EURO' || !['swell_1','swell_2','wind_waves'].includes(activeLayer)) return null;
  // which is a PROVIDER scope applied to statuses that are not about the provider. Measured with the
  // producer pinned to its real defect value {status:'retained_previous_hour'} and only model x layer
  // perturbed: the SAME degraded state warned in 3 of 12 cells and was SILENT IN 9 — including
  // GFS/waves (the default) and EURO/waves, the exact cell where a 72-hour stale render was measured
  // showing "+78 h EURO" over hour-6 pixels for >=60 s with no indication.
  // ★ A retained hour, a dead backend, an oversized payload and a 429 are properties of the RENDER,
  //   not of Copernicus. Only `no_copernicus_coverage` and the `ready` text ("CMEMS") are
  //   provider-specific, so only those stay EURO-scoped below.
  // ⚠️ Deliberately returns null rather than falling through: the tail can yield 'ready', whose badge
  //   reads "Heatmap Ready (CMEMS)" and would be a false provider claim on GFS/ICON.
  const isEuroScoped = activeModel === 'EURO' && activeLayer !== 'waves';
  if (!isEuroScoped) {
    if (statusDiag?.status === 'retained_previous_hour_warning' || statusDiag?.status === 'retained_previous_hour') {
      return 'retained_stale_warning';
    }
    if (statusDiag?.status === 'no_backend_coverage') return 'no_backend_coverage';
    if (statusDiag?.status === 'response_too_large_prevented' || window.__MARINE_FETCH_DIAG__?.httpStatus === 413) {
      return 'payload_too_large';
    }
    if (window.__MARINE_FETCH_DIAG__?.cooldownState === 'rate_limited' || isInCooldown('marine')) {
      return 'rate_limited';
    }
    return null;
  }
  // ── EURO / COPERNICUS-SCOPED TAIL (unchanged below this line) ─────────────────────────────────
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
  const renderedCounts = readHeatmapCounts(webglDiag);
  const isWebGLRendered = webglDiag &&
                          validProviders.includes(webglDiag.renderedProvider) &&
                          webglDiag.activeMarineLayer === activeLayer &&
                          webglDiag.componentLayer === activeLayer &&
                          renderedCounts.vectors > 0 &&
                          renderedCounts.nonzero > 0;

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
  const { vectors: heatmapVectors, nonzero: heatmapNonzero } = readHeatmapCounts(webglDiag);
  const infoboxProvider = exactPoint?.provider || marineGridSample?.provider || 'none';
  const infoboxStatus = exactPointStatus;

  // ⛔ VACUOUS PASS (fixed 2026-08-11, certification audit 11.2 / RC-02).
  // Every comparison below is guarded on BOTH sides being populated — correct, because comparing
  // against an unpopulated side would fire false mismatches. But the result was then collapsed to
  // `match: mismatches.length === 0`, which encodes "nothing was comparable" as SUCCESS. Measured
  // live on production: heatmap.vectorCount 0 + infobox.status 'idle' + productId null =>
  // `match: true, mismatchReasons: null`, while the sibling instrument
  // `__WebGLMarineLayer_DIAG__.infoboxHeatmapParity` said false. That PASS is what the HUD's
  // "No Causal Layer Violations Detected" rested on, including during a total data-load failure.
  // ★ A check that cannot tell "not sampled" from "agrees" must REFUSE, not pass.
  //   `status` is now three-valued: MATCH | MISMATCH | UNSAMPLED.
  // ⭐ SCOPE THE REFUSAL (2026-08-11, audit 11.2 follow-up). The three-valued gate above initially
  // fired UNSAMPLED in the RESTING state, because the infobox only has a provider once the user
  // selects a point — `useExactPointFetch.js:122` sets status 'idle' when `!pointLat || !pointLng`.
  // A warning that is always on carries exactly as little information as a pass that is always on;
  // it would have re-created the defect it was built to expose, with the colour inverted.
  // ★ The two sides are NOT symmetric:
  //   - the HEATMAP side is always checkable (something is or is not being drawn) => always report;
  //   - the INFOBOX side has no subject until a point exists => NOT_APPLICABLE, not a refusal.
  // `lat`/`lng` are the reliable discriminator, NOT the status: status 'idle' is overloaded — it
  // also covers "point selected but fetch suppressed" (`useExactPointFetch.js:142`).
  const pointSelected = lat != null && lng != null;

  // An UNINITIALISED heatmap diag cannot disagree with anything — its activeModel/activeLayer are
  // null, which `|| 'none'` turns into a value that compares UNEQUAL to every real model. Left
  // ungated that produces a false MISMATCH, which is the same defect as the false PASS wearing the
  // opposite sign: both report a verdict about a comparison that never happened.
  const heatmapUninitialised = isDiagUninitialised(webglDiag);

  const heatmapUnsampled = [];
  if (heatmapUninitialised) {
    heatmapUnsampled.push('heatmap: diagnostic not initialised');
    if (heatmapVectors === null) heatmapUnsampled.push('heatmap: vector count unreadable');
  } else {
    if (heatmapProvider === 'none') heatmapUnsampled.push('heatmap: no rendered provider');
    if (heatmapVectors === null) heatmapUnsampled.push('heatmap: vector count unreadable');
    else if (heatmapVectors === 0) heatmapUnsampled.push('heatmap: zero vectors rendered');
  }

  const infoboxUnsampled = [];
  if (pointSelected) {
    if (infoboxProvider === 'none') infoboxUnsampled.push('infobox: no provider');
    if (!infoboxStatus || infoboxStatus === 'idle') infoboxUnsampled.push(`infobox: status ${infoboxStatus || 'absent'}`);
  }
  const unsampled = [...heatmapUnsampled, ...infoboxUnsampled];

  const mismatches = [];
  if (!heatmapUninitialised) {
    if (heatmapModel !== activeModel) mismatches.push(`model: heatmap=${heatmapModel} infobox=${activeModel}`);
    if (heatmapLayer !== 'unknown' && heatmapLayer !== activeLayer) mismatches.push(`layer: heatmap=${heatmapLayer} infobox=${activeLayer}`);
    if (heatmapProvider !== 'none' && infoboxProvider !== 'none' && heatmapProvider !== infoboxProvider) mismatches.push(`provider: heatmap=${heatmapProvider} infobox=${infoboxProvider}`);
  }

  // A real disagreement always outranks everything. Then a genuine refusal. NOT_APPLICABLE means
  // "no point selected, so there is no infobox to compare" — never dress that up as a MATCH.
  const parityStatus = mismatches.length > 0
    ? 'MISMATCH'
    : unsampled.length > 0
      ? 'UNSAMPLED'
      : pointSelected ? 'MATCH' : 'NOT_APPLICABLE';

  window.__MARINE_SOURCE_PARITY__ = {
    activeModel, activeLayer, timeOffsetHours,
    infobox: { provider: infoboxProvider, status: infoboxStatus, timestamp: exactPoint?.time || null },
    heatmap: { model: heatmapModel, provider: heatmapProvider, waveData: heatmapWaveData, vectorCount: heatmapVectors, nonzeroActiveLayer: heatmapNonzero },
    status: parityStatus,
    // `match` is retained for existing readers but is now strictly "VERIFIED to agree".
    // It is false when nothing was comparable — that is the fix, not a regression.
    match: parityStatus === 'MATCH',
    mismatchReasons: mismatches.length > 0 ? mismatches : null,
    unsampledReasons: unsampled.length > 0 ? unsampled : null,
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
