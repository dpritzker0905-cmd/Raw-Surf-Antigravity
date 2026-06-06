/**
 * backendWeatherServiceClientDiag.js
 * 
 * Extracted diagnostics updates for backend weather service.
 * Uses lazy imports to avoid circular dependency with the main client.
 */

import { BACKEND_URL } from '../../lib/apiClient';
import { getAvailableTilesFromManifest, PILOT_COVERAGE } from './backendWeatherServiceClientCoverage';

// Lazy accessors to break circular dependency with backendWeatherServiceClient
function getMainClient() {
  // eslint-disable-next-line global-require
  return require('./backendWeatherServiceClient');
}

function getStatusUrl() { return `${BACKEND_URL}/api/weather/status`; }
function getGridUrl() { return `${BACKEND_URL}/api/weather/grid`; }
function getPointUrl() { return `${BACKEND_URL}/api/weather/point`; }

export let latestTimeDiag = {
  marine: {
    requestedValidTime: null,
    selectedManifestValidTime: null,
    manifestDeltaHours: null,
    fallbackReason: null
  },
  wind: {
    requestedValidTime: null,
    selectedManifestValidTime: null,
    manifestDeltaHours: null,
    fallbackReason: null
  }
};

/**
 * Updates the global projection diagnostics registry for the truth gate.
 */
export function updateProjectionDiag(domain, details) {
  if (typeof window === 'undefined') return;

  const diagKey = domain === 'wind' 
    ? '__WIND_PROJECTION_DIAG__' 
    : domain === 'weather' || domain === 'pressure'
      ? '__WEATHER_GRID_PROJECTION_DIAG__' 
      : '__MARINE_PROJECTION_DIAG__';

  let mapViewportBounds = null;
  if (window.map && typeof window.map.getBounds === 'function') {
    try {
      const b = window.map.getBounds();
      mapViewportBounds = {
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth()
      };
    } catch (e) {}
  }

  // Compute coverage percent of viewport (guaranteed number, never NaN/undefined)
  let coveragePercentOfViewport = 0;
  const viewportBounds = details.requestedViewportBounds || mapViewportBounds;
  if (viewportBounds && details.clampedBbox) {
    const vW = Math.abs(viewportBounds.east - viewportBounds.west);
    const vH = Math.abs(viewportBounds.north - viewportBounds.south);
    const iW = Math.abs(details.clampedBbox.east - details.clampedBbox.west);
    const iH = Math.abs(details.clampedBbox.north - details.clampedBbox.south);
    const vArea = vW * vH;
    const iArea = iW * iH;
    coveragePercentOfViewport = (vArea > 0 && isFinite(iArea / vArea))
      ? Math.round(Math.min(100, (iArea / vArea) * 100))
      : 0;
  }

  const covBounds = details.coverageBounds || PILOT_COVERAGE;
  
  // Render decision mapping
  let renderDecision = details.renderDecision || 'unsupported';
  let outsideCoverageReason = null;

  if (details.error) {
    if (details.error.includes('outside') || details.error === 'outside_coverage_clear') {
      renderDecision = 'outside_coverage_clear';
      outsideCoverageReason = details.error;
    } else {
      renderDecision = 'fallback_legacy';
    }
  } else if (details.renderable) {
    const req = details.requestedViewportBounds;
    const clm = details.clampedBbox;
    if (req && clm && (clm.west > req.west || clm.east < req.east || clm.south > req.south || clm.north < req.north)) {
      renderDecision = 'clip_to_coverage';
    } else {
      renderDecision = 'render';
    }
  }

  const tileResult = getAvailableTilesFromManifest();
  const availableTiles = tileResult.tiles || [];
  const availableTileIds = availableTiles.map(t => t.id);
  const selectedTileId = details.selectedTileId || null;
  const selectedTileBounds = details.coverageBounds || null;
  const rejectedTileIds = details.rejectedTileIds || [];
  
  // coverage_status enum
  let coverage_status = 'unsupported_layer';
  if (renderDecision === 'render') {
    coverage_status = coveragePercentOfViewport >= 95 ? 'full_coverage' : 'partial_regional_coverage';
  } else if (renderDecision === 'clip_to_coverage') {
    coverage_status = 'partial_regional_coverage';
  } else if (renderDecision === 'outside_coverage_clear') {
    coverage_status = 'outside_coverage_clear';
  }

  window[diagKey] = {
    status: 'active',
    coverage_status,
    // 16 Required keys for Stage 6H
    coverageMode: selectedTileId ? 'regional_tile' : 'none',
    availableTileIds,
    selectedTileId,
    selectedTileBounds,
    rejectedTileIds,
    requestedViewportBounds: viewportBounds || null,
    backendRequestBbox: details.backendRequestBbox || null,
    responseGridBounds: details.responseGridBounds || null,
    renderBounds: details.responseGridBounds || covBounds || null,
    coveragePercentOfViewport,
    productId: details.productId || null,
    regionId: details.regionId || selectedTileId || null,
    tileId: details.tileId || selectedTileId || null,
    validTime: details.validTime || null,
    renderDecision,
    outsideCoverageReason,
    
    // Additional legacy diagnostic properties to prevent breaks
    activeModel: details.activeModel || 'GFS',
    activeLayer: details.activeLayer || 'waves',
    cols: details.cols || 0,
    rows: details.rows || 0,
    vectorCount: details.vectorCount || 0,
    nonzeroCount: details.nonzeroCount || 0,
    uploadCount: 0,
    uploadReason: 'none',
    staleClearStatus: 'none',
    firstVectorLatLng: details.firstVectorLatLng || null,
    lastVectorLatLng: details.lastVectorLatLng || null,
    provider: details.provider || 'unknown',
    reason: details.reason || details.error || 'Normal execution',
    coverageBounds: covBounds,
    mapViewportBounds,
    timestamp: new Date().toISOString()
  };

  const prevTimelineDiag = window.__FORECAST_TIMELINE_COVERAGE_DIAG__ || {};
  let webglUploadCount = prevTimelineDiag.webglUploadCount || 0;
  const detailsCommitRev = details.commitRevision || 0;
  if (detailsCommitRev > (prevTimelineDiag.commitRevision || 0)) {
    webglUploadCount += 1;
  }

  window.__FORECAST_TIMELINE_COVERAGE_DIAG__ = {
    ...prevTimelineDiag,
    status: 'active',
    coverage_status: coverage_status,
    activeModel: details.activeModel || details.model || prevTimelineDiag.activeModel || 'GFS',
    activeLayer: details.activeLayer || prevTimelineDiag.activeLayer || 'waves',
    domain: domain === 'wind' ? 'wind' : domain === 'pressure' ? 'pressure' : 'marine',
    regionId: details.regionId || selectedTileId || prevTimelineDiag.regionId || null,
    tileId: details.tileId || selectedTileId || prevTimelineDiag.tileId || null,
    timeOffsetHours: details.timeOffsetHours !== undefined ? details.timeOffsetHours : prevTimelineDiag.timeOffsetHours || 0,
    requestedValidTime: details.requestedValidTime || prevTimelineDiag.requestedValidTime || null,
    selectedValidTime: details.validTime || prevTimelineDiag.selectedValidTime || null,
    gridProductId: details.productId || prevTimelineDiag.gridProductId || null,
    pointProductId: prevTimelineDiag.pointProductId || null,
    cacheStatus: details.cacheStatus || prevTimelineDiag.cacheStatus || 'idle',
    fetchTriggeredBy: details.fetchTriggeredBy || prevTimelineDiag.fetchTriggeredBy || 'unknown',
    commitRevision: detailsCommitRev || prevTimelineDiag.commitRevision || 0,
    webglUploadCount: webglUploadCount,
    renderDecision: renderDecision || prevTimelineDiag.renderDecision || 'render',
    staleRejected: details.staleRejected !== undefined ? details.staleRejected : prevTimelineDiag.staleRejected || false,
    staleRejectReason: details.staleRejectReason || prevTimelineDiag.staleRejectReason || null,
    pointVisualParity: prevTimelineDiag.pointVisualParity || false,
    isEstimated: details.isEstimated !== undefined ? !!details.isEstimated : prevTimelineDiag.isEstimated || false,
    estimateBasis: details.estimateBasis !== undefined ? details.estimateBasis : prevTimelineDiag.estimateBasis || null,
    estimateSource: details.isEstimated !== undefined ? (details.isEstimated ? "backend" : "none") : prevTimelineDiag.estimateSource || "none"
  };
}

/**
 * Updates the global diagnostics telemetry registry.
 */
export function updateDiagnostics(type, details, model = 'GFS') {
  if (typeof window === 'undefined') return;

  const isIcon = model.toUpperCase() === 'ICON';
  const diagKey = isIcon ? '__BACKEND_ICON_SERVICE_DIAG__' : '__BACKEND_WEATHER_SERVICE_DIAG__';

  if (!window[diagKey]) {
    window[diagKey] = {
      featureFlagActive: isIcon ? getMainClient().getBackendIconMarineFlag() : getMainClient().getBackendWeatherFlag(),
      activeModel: model.toUpperCase(),
      activeLayer: 'waves',
      layer: 'waves',
      backendUrl: BACKEND_URL,
      statusUrl: getStatusUrl(),
      gridUrl: getGridUrl(),
      pointUrl: getPointUrl(),
      requestedHour: null,
      validTime: null,
      gridValidTime: null,
      pointValidTime: null,
      parity: 'pending_point_fetch',
      pointParity: 'pending_point_fetch',
      requestedBbox: null,
      clampedBbox: null,
      coverage: PILOT_COVERAGE,
      fallbackReason: null,
      lastGridFetch: null,
      lastPointFetch: null,
      coverageInside: true,
      fallbackToLegacy: false,
      reason: null,
      requestedValidTime: null,
      selectedManifestValidTime: null,
      manifestDeltaHours: null,
      gridVectorCount: null,
      nonzeroCount: null,
      renderable: false,
      sourceDataset: null,
      sourceVariables: null,
      is_forecast_authoritative: false,
      is_estimated: false,
      is_test_fixture: false,
      gridMode: null,
      interpolationMethod: null
    };
  }

  const diag = window[diagKey];
  diag.featureFlagActive = isIcon ? getMainClient().getBackendIconMarineFlag() : getMainClient().getBackendWeatherFlag();

  if (type === 'grid') {
    diag.layer = details.layer || diag.layer || 'waves';
    diag.lastGridFetch = details;
    diag.gridValidTime = details.validTime || null;
    diag.requestedBbox = details.requestedBbox;
    diag.clampedBbox = details.clampedBbox;
    diag.fallbackReason = details.error || details.fallbackReason || null;
    diag.gridVectorCount = details.gridVectorCount || null;
    diag.nonzeroCount = details.nonzeroCount || null;
    diag.renderable = details.renderable !== undefined ? details.renderable : false;
    diag.sourceDataset = details.sourceDataset || null;
    diag.sourceVariables = details.sourceVariables || null;
    diag.is_forecast_authoritative = details.is_forecast_authoritative !== undefined ? details.is_forecast_authoritative : false;
    diag.is_estimated = details.is_estimated !== undefined ? details.is_estimated : false;
    diag.is_test_fixture = details.is_test_fixture !== undefined ? details.is_test_fixture : false;
    diag.gridMode = details.gridMode || null;
    diag.productId = details.productId || null;
    diag.gridProductId = details.productId || null;

    const isInside = details.coverageInside !== undefined 
      ? details.coverageInside 
      : (details.clampedBbox !== null && !details.error?.includes('outside'));
      
    diag.coverageInside = isInside;
    diag.fallbackToLegacy = !isInside || !!details.error;
    
    if (!isInside) {
      diag.reason = 'outside_coverage';
    } else if (details.error) {
      diag.reason = 'fallback_legacy';
    } else {
      diag.reason = 'backend_success';
    }
  } else if (type === 'point') {
    diag.layer = details.layer || diag.layer || 'waves';
    diag.lastPointFetch = details;
    diag.pointValidTime = details.validTime || null;
    diag.interpolationMethod = details.interpolationMethod || null;
    diag.period = details.period || 0;
    diag.sourceDataset = details.sourceDataset || null;
    diag.sourceVariables = details.sourceVariables || null;
    diag.is_forecast_authoritative = details.is_forecast_authoritative !== undefined ? details.is_forecast_authoritative : false;
    diag.is_estimated = details.is_estimated !== undefined ? details.is_estimated : false;
    diag.is_test_fixture = details.is_test_fixture !== undefined ? details.is_test_fixture : false;
    diag.productId = details.productId || null;
    diag.pointProductId = details.productId || null;
    diag.gridProductId = diag.lastGridFetch?.productId || null;
    diag.source = details.source || 'network';
    diag.estimate_basis = details.estimate_basis || details.estimateBasis || null;
    diag.estimateBasis = details.estimate_basis || details.estimateBasis || null;

    if (details.error) {
      diag.reason = details.error === 'unsupported' ? 'unsupported_model_layer' : 'fallback_legacy';
    } else {
      diag.reason = 'backend_success';
    }

    if (typeof window !== 'undefined' && window.__FORECAST_TIMELINE_COVERAGE_DIAG__) {
      window.__FORECAST_TIMELINE_COVERAGE_DIAG__.pointProductId = details.productId || null;
      if (details.is_estimated !== undefined) {
        window.__FORECAST_TIMELINE_COVERAGE_DIAG__.isEstimated = !!details.is_estimated;
        window.__FORECAST_TIMELINE_COVERAGE_DIAG__.estimateSource = details.is_estimated ? "backend" : "none";
      }
      window.__FORECAST_TIMELINE_COVERAGE_DIAG__.estimateBasis = details.estimate_basis || details.estimateBasis || null;
    }
  }

  diag.activeModel = model.toUpperCase();
  diag.activeLayer = diag.layer;

  if (details.hourOffset !== undefined) {
    diag.requestedHour = details.hourOffset;
    diag.validTime = getMainClient().getSharedValidTime(details.hourOffset, diag.layer, model);
  }

  const timeDiag = latestTimeDiag[`${model.toUpperCase()}_${diag.layer}`] || {};
  diag.requestedValidTime = timeDiag.requestedValidTime;
  diag.selectedManifestValidTime = timeDiag.selectedManifestValidTime;
  diag.manifestDeltaHours = timeDiag.manifestDeltaHours;
  diag.timeFallbackReason = timeDiag.fallbackReason;

  diag.parity = diag.pointValidTime 
    ? (diag.gridValidTime === diag.pointValidTime) 
    : 'pending_point_fetch';
  diag.pointParity = diag.parity;
}

// Global Diagnostics Telemetry Initializers
if (typeof window !== 'undefined') {
  // Resolve feature flags safely — circular require may not be ready at init time
  let _flagWeather = false;
  let _flagIcon = false;
  try { _flagWeather = getMainClient().getBackendWeatherFlag(); } catch (e) { /* circular dep at init time */ }
  try { _flagIcon = getMainClient().getBackendIconMarineFlag(); } catch (e) { /* circular dep at init time */ }

  window.__BACKEND_WEATHER_SERVICE_DIAG__ = window.__BACKEND_WEATHER_SERVICE_DIAG__ || {
    featureFlagActive: _flagWeather,
    activeModel: 'GFS',
    activeLayer: 'waves',
    layer: 'waves',
    backendUrl: BACKEND_URL,
    statusUrl: getStatusUrl(),
    gridUrl: getGridUrl(),
    pointUrl: getPointUrl(),
    requestedHour: null,
    validTime: null,
    gridValidTime: null,
    pointValidTime: null,
    parity: 'pending_point_fetch',
    pointParity: 'pending_point_fetch',
    requestedBbox: null,
    clampedBbox: null,
    coverage: PILOT_COVERAGE,
    fallbackReason: null,
    lastGridFetch: null,
    lastPointFetch: null,
    coverageInside: true,
    fallbackToLegacy: false,
    reason: null,
    requestedValidTime: null,
    selectedManifestValidTime: null,
    manifestDeltaHours: null,
    gridVectorCount: null,
    nonzeroCount: null,
    renderable: false,
    sourceDataset: null,
    sourceVariables: null,
    is_forecast_authoritative: false,
    is_estimated: false,
    is_test_fixture: false,
    gridMode: null,
    interpolationMethod: null
  };

  window.__BACKEND_ICON_SERVICE_DIAG__ = window.__BACKEND_ICON_SERVICE_DIAG__ || {
    featureFlagActive: _flagIcon,
    activeModel: 'ICON',
    activeLayer: 'waves',
    layer: 'waves',
    backendUrl: BACKEND_URL,
    statusUrl: getStatusUrl(),
    gridUrl: getGridUrl(),
    pointUrl: getPointUrl(),
    requestedHour: null,
    validTime: null,
    gridValidTime: null,
    pointValidTime: null,
    parity: 'pending_point_fetch',
    pointParity: 'pending_point_fetch',
    requestedBbox: null,
    clampedBbox: null,
    coverage: PILOT_COVERAGE,
    fallbackReason: null,
    lastGridFetch: null,
    lastPointFetch: null,
    coverageInside: true,
    fallbackToLegacy: false,
    reason: null,
    requestedValidTime: null,
    selectedManifestValidTime: null,
    manifestDeltaHours: null,
    gridVectorCount: null,
    nonzeroCount: null,
    renderable: false,
    sourceDataset: null,
    sourceVariables: null,
    is_forecast_authoritative: false,
    is_estimated: false,
    is_test_fixture: false,
    gridMode: null,
    interpolationMethod: null
  };

  const initialProjectionDiag = {
    status: 'not_initialized',
    activeModel: 'GFS',
    activeLayer: 'waves',
    validTime: null,
    productId: null,
    provider: 'unknown',
    requestedViewportBounds: null,
    backendRequestBbox: null,
    responseGridBounds: null,
    coverageBounds: PILOT_COVERAGE,
    renderBounds: PILOT_COVERAGE,
    mapViewportBounds: null,
    cols: 0,
    rows: 0,
    vectorCount: 0,
    nonzeroCount: 0,
    uploadCount: 0,
    uploadReason: 'none',
    firstVectorLatLng: null,
    lastVectorLatLng: null,
    renderDecision: 'unsupported',
    coverage_status: 'not_initialized',
    coveragePercentOfViewport: 0,
    staleClearStatus: 'none',
    reason: 'Initial state',
    isStretchedToViewport: false,
    coverageIntersectsViewport: true,
    timestamp: null
  };

  window.__WEATHER_GRID_PROJECTION_DIAG__ = window.__WEATHER_GRID_PROJECTION_DIAG__ || {
    ...initialProjectionDiag,
    activeLayer: 'pressure'
  };

  window.__WIND_PROJECTION_DIAG__ = window.__WIND_PROJECTION_DIAG__ || {
    ...initialProjectionDiag,
    activeLayer: 'wind'
  };

  window.__MARINE_PROJECTION_DIAG__ = window.__MARINE_PROJECTION_DIAG__ || {
    ...initialProjectionDiag,
    activeLayer: 'waves'
  };

  window.__FORECAST_TIMELINE_COVERAGE_DIAG__ = window.__FORECAST_TIMELINE_COVERAGE_DIAG__ || {
    status: 'not_initialized',
    activeModel: 'GFS',
    activeLayer: 'waves',
    domain: 'marine',
    validTime: null,
    productId: null,
    provider: null,
    bounds: null,
    vectorCount: 0,
    nonzeroCount: 0,
    uploadCount: 0,
    uploadReason: 'none',
    renderDecision: 'init',
    coverage_status: 'not_initialized',
    staleClearStatus: 'none',
    regionId: null,
    tileId: null,
    timeOffsetHours: 0,
    requestedValidTime: null,
    selectedValidTime: null,
    gridProductId: null,
    pointProductId: null,
    cacheStatus: 'idle',
    fetchTriggeredBy: 'init',
    commitRevision: 0,
    webglUploadCount: 0,
    staleRejected: false,
    staleRejectReason: null,
    pointVisualParity: false,
    isEstimated: false,
    estimateBasis: null,
    estimateSource: 'none',
    timestamp: null
  };
}
