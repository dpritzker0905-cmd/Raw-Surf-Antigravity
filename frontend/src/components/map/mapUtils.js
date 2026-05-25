/**
 * Map utility functions and constants
 * Extracted from MapPage.js for better organization
 */

import maplibregl from 'maplibre-gl';

// Custom protocol active model lock to avoid premature tile discarding
let activeModelLock = "";

export const setMapActiveModelLock = (modelName) => {
  activeModelLock = modelName;
  console.log('[OM-Protocol] Active model lock target set to:', activeModelLock);
};

export function invalidateStaleTileRequests() {
  // Backwards compatibility stub
}

const getParentModel = (folder) => {
  if (!folder) return "";
  const f = folder.toLowerCase();
  if (f.includes('dwd') || f.includes('icon') || f.includes('gwam')) return "ICON";
  if (f.includes('gfs')) return "GFS";
  if (f.includes('ecmwf') || f.includes('ifs') || f.includes('wam')) return "EURO";
  return "";
};

const isModelMatch = (folder, lock) => {
  if (!folder) return true;
  
  // Safe dynamic fallback: check typeof window !== 'undefined' to avoid worker ReferenceErrors
  if (typeof window !== 'undefined' && window.__OM_ACTIVE_MODELS__ && window.__OM_ACTIVE_MODELS__.includes(folder)) {
    return true;
  }
  
  if (!lock) return true; // Safe fallback if lock is empty
  
  const f = folder.toLowerCase();
  
  // GFS is the global fallback model for all weather/marine layers, allow it always
  if (f.includes('gfs')) {
    return true;
  }
  
  const parent = getParentModel(folder);
  const l = lock.toLowerCase();
  return parent.toLowerCase() === l || f.includes(l) || l.includes(f);
};

// Colors
export var ELECTRIC_CYAN = '#00CCFF';

// Default map center (Florida)
export var FLORIDA_CENTER = { lat: 28.0, lng: -81.5 };

// Re-exported from shared utility for backwards compatibility
export { getErrorMessage } from '../../utils/errors';

/**
 * Debounce function for performance optimization
 */
export var debounce = function(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Truncate coordinate to 5 decimal places
 * Returns null for invalid inputs (prevents NaN errors)
 */
export var truncateCoord = function(coord) {
  if (coord === null || coord === undefined || isNaN(coord)) {
    return null;
  }
  return Math.round(coord * 100000) / 100000;
};

/**
 * Validate coordinates are valid for Leaflet
 * CRITICAL: Prevents "Invalid LatLng object: (NaN, NaN)" errors on Samsung
 */
export var isValidLatLng = function(lat, lng) {
  return lat !== null && lng !== null && 
         lat !== undefined && lng !== undefined &&
         !isNaN(lat) && !isNaN(lng) &&
         isFinite(lat) && isFinite(lng) &&
         lat >= -90 && lat <= 90 && 
         lng >= -180 && lng <= 180;
};

/**
 * Mapbox access token (public / publishable key)
 * Loaded from REACT_APP_MAPBOX_TOKEN env var
 */
var MAPBOX_TOKEN = process.env.REACT_APP_MAPBOX_TOKEN || '';

/**
 * Mapbox raster tile URLs (kept for TILE_LAYER_CONFIG / legacy Leaflet)
 */
export var MAPBOX_TILES = {
  dark:  `https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
  light: `https://api.mapbox.com/styles/v1/mapbox/navigation-day-v1/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
  beach: `https://api.mapbox.com/styles/v1/mapbox/outdoors-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
  satellite: `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
};

/**
 * Mapbox VECTOR style URLs (v84: used as MapLibre GL base map).
 * Vector styles render land, water, roads as separate layers — marine rasters
 * are inserted between water and land for natural coastline clipping.
 */
var MAPBOX_VECTOR_STYLES = {
  dark:      `https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1?access_token=${MAPBOX_TOKEN}`,
  light:     `https://api.mapbox.com/styles/v1/mapbox/navigation-day-v1?access_token=${MAPBOX_TOKEN}`,
  beach:     `https://api.mapbox.com/styles/v1/mapbox/outdoors-v11?access_token=${MAPBOX_TOKEN}`,
  satellite: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v11?access_token=${MAPBOX_TOKEN}`,
};

/**
 * transformRequest — Converts mapbox:// protocol URLs to HTTPS for MapLibre.
 * MapLibre doesn't natively resolve mapbox:// URIs; this translates tile,
 * sprite, glyph, and source URLs to their HTTPS equivalents with the access token.
 */
export var mapboxTransformRequest = function(url, resourceType) {
  if (!url || !url.startsWith('mapbox://')) return { url: url };
  // mapbox://mapbox.mapbox-streets-v8 → tile source
  if (url.startsWith('mapbox://styles/')) {
    return { url: url.replace('mapbox://styles/', 'https://api.mapbox.com/styles/v1/') + '?access_token=' + MAPBOX_TOKEN };
  }
  if (url.startsWith('mapbox://tiles/')) {
    return { url: url.replace('mapbox://tiles/', 'https://api.mapbox.com/v4/') + '?access_token=' + MAPBOX_TOKEN };
  }
  if (url.startsWith('mapbox://sprites/')) {
    const match = url.match(/mapbox:\/\/sprites\/(.+?)((?:@\d+x)?\.(?:json|png))$/);
    if (match) {
      const stylePath = match[1];
      const suffix = match[2];
      return { url: `https://api.mapbox.com/styles/v1/${stylePath}/sprite${suffix}?access_token=${MAPBOX_TOKEN}` };
    }
    return { url: url.replace('mapbox://sprites/', 'https://api.mapbox.com/styles/v1/') + '/sprite?access_token=' + MAPBOX_TOKEN };
  }
  if (url.startsWith('mapbox://fonts/')) {
    return { url: url.replace('mapbox://fonts/', 'https://api.mapbox.com/fonts/v1/') + '?access_token=' + MAPBOX_TOKEN };
  }
  // Generic mapbox:// → api.mapbox.com/v4/ (vector tile sources)
  return { url: url.replace('mapbox://', 'https://api.mapbox.com/v4/') + '.json?secure&access_token=' + MAPBOX_TOKEN };
};

/**
 * Generate a MapLibre GL JS compatible style.
 * v84: Returns Mapbox VECTOR style URL for proper layer ordering.
 * @param {string|boolean} themeOrLight - theme string ('light'/'dark'/'beach') or boolean isLight
 * @param {boolean} isSatellite - use satellite imagery
 */
export var getMapStyle = function(themeOrLight, isSatellite) {
  var theme = typeof themeOrLight === 'boolean'
    ? (themeOrLight ? 'light' : 'dark')
    : (themeOrLight || 'dark');
  if (isSatellite) return MAPBOX_VECTOR_STYLES.satellite;
  return MAPBOX_VECTOR_STYLES[theme] || MAPBOX_VECTOR_STYLES.dark;
};

/**
 * Find the correct insertion layer for marine rasters in a Mapbox vector style.
 *
 * Strategy: Marine rasters go ABOVE the water fill layer. Then OceanMask
 * (a separate imperative layer) covers any coastline bleed on land areas.
 *   water → [MARINE RASTERS HERE] → [OceanMask] → land-structure → roads → labels
 *
 * Returns the id of the first layer AFTER the `water` fill (typically land-structure-polygon).
 */
export var findMarineInsertionLayer = function(mapInstance) {
  if (!mapInstance) return null;
  var style = mapInstance.getStyle?.();
  if (!style?.layers || style.layers.length === 0) return null;

  // Search for the first label, text, symbol or coastline layer to insert BEFORE
  for (var layer of style.layers) {
    var id = layer.id;
    var type = layer.type;
    
    const isTarget = type === 'symbol' || 
                     id.includes('label') || 
                     id.includes('coastline') || 
                     id.includes('place') ||
                     id.includes('poi-') ||
                     id.includes('road') ||
                     id.includes('track') ||
                     id.includes('bridge') ||
                     id.includes('tunnel') ||
                     id.includes('road-label');
                     
    const isCustom = id.startsWith('ocean-mask-') || 
                     id.endsWith('-layer') || 
                     id.endsWith('-source') ||
                     id === 'radar-layer' || 
                     id === 'esri-satellite-layer' ||
                     id === 'spot-geofences-layer' ||
                     id === 'marine-raster-anchor';
                     
    if (isTarget && !isCustom) {
      return id;
    }
  }

  // Fallback Pass: return any non-custom, non-background, non-water layer
  for (var layer of style.layers) {
    var id = layer.id;
    var isCustom = id.startsWith('ocean-mask-') || 
                   id.endsWith('-layer') || 
                   id.endsWith('-source') ||
                   id === 'radar-layer' || 
                   id === 'esri-satellite-layer' ||
                   id === 'spot-geofences-layer' ||
                   id === 'marine-raster-anchor';
    if (isCustom) continue;
    if (id !== 'background' && id !== 'water' && id !== 'water-depth' && id !== 'wetland') {
      return id;
    }
  }

  return null;
};

/**
 * Default tile layer configuration Mapbox raster tiles via Leaflet
 */
export var TILE_LAYER_CONFIG = {
  url: MAPBOX_TILES.dark,
  options: {
    maxZoom: 19,
    tileSize: 256,
    updateWhenIdle: false,
 updateWhenZooming: false, // wait for zoom to settle smoother animation
    keepBuffer: 2,              // default; 4 was too RAM-heavy on mobile
    updateInterval: 150,        // throttle tile requests during fast panning (ms)
    edgeBufferTiles: 2,         // pre-fetch 2 extra rows beyond viewport (requires EdgeBuffer plugin)
    crossOrigin: 'anonymous',
    detectRetina: false,        // already requesting @2x tiles from Mapbox
 attribution: ' <a href="https://www.mapbox.com/about/maps/">Mapbox</a> <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }
};

/**
 * Default map options
 * 
 * ANDROID FOLDABLE FIX (Galaxy Z Fold 7 et al.):
 * - tap: false Leaflet's tap handler uses incorrect coordinate offsets on Android
 *   when the visual viewport sits at a Y offset from the layout viewport (common on
 *   foldables due to status/nav bar chrome). This causes pinch-zoom to drift south.
 * - touchZoom is left as true but the drift correction happens via the
 *   visualViewport resize listener in MapPage (invalidateSize on every fold/unfold).
 */
export var DEFAULT_MAP_OPTIONS = {
  minZoom: 2,
  zoomControl: false,
  attributionControl: false,
  preferCanvas: true,
  worldCopyJump: true,
  maxBounds: [[-85, -Infinity], [85, Infinity]],
  maxBoundsViscosity: 1.0,
  tap: false,              // FIXED: Leaflet tap conflicts with Android touch offset on foldables
  tapTolerance: 15,
  touchZoom: true,
  bounceAtZoomLimits: false
};

/**
 * Cluster group options for spots
 */
export var SPOT_CLUSTER_OPTIONS = {
  maxClusterRadius: 60,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: true,
  disableClusteringAtZoom: 13,
  chunkedLoading: true
};

/**
 * Cluster group options for photographers
 */
export var PHOTOGRAPHER_CLUSTER_OPTIONS = {
  maxClusterRadius: 50,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: true,
  disableClusteringAtZoom: 14,
  chunkedLoading: true
};

export function smoothColorScale(baseScale, numSteps = 80) {
  if (!baseScale || baseScale.type !== 'breakpoint') return baseScale;
  
  var originalBreakpoints = baseScale.breakpoints;
  var originalColors = baseScale.colors;
  
  var newBreakpoints = [];
  var newColors = [];
  
  var numIntervals = originalBreakpoints.length - 1;
  var stepsPerInterval = Math.max(1, Math.round(numSteps / numIntervals));
  
  for (var i = 0; i < numIntervals; i++) {
    var bStart = originalBreakpoints[i];
    var bEnd = originalBreakpoints[i + 1];
    
    var cStart = originalColors[i];
    var cEnd = originalColors[i + 1];
    
    for (var j = 0; j < stepsPerInterval; j++) {
      var t = j / stepsPerInterval;
      var val = bStart + (bEnd - bStart) * t;
      
      var r = Math.round(cStart[0] + (cEnd[0] - cStart[0]) * t);
      var g = Math.round(cStart[1] + (cEnd[1] - cStart[1]) * t);
      var b = Math.round(cStart[2] + (cEnd[2] - cStart[2]) * t);
      var a = Number((cStart[3] + (cEnd[3] - cStart[3]) * t).toFixed(3));
      
      newBreakpoints.push(Number(val.toFixed(3)));
      newColors.push([r, g, b, a]);
    }
  }
  
  newBreakpoints.push(originalBreakpoints[originalBreakpoints.length - 1]);
  newColors.push(originalColors[originalColors.length - 1]);
  
  return {
    type: 'breakpoint',
    unit: baseScale.unit,
    breakpoints: newBreakpoints,
    colors: newColors
  };
}

export var BASE_CUSTOM_COLOR_SCALES = {
  wave_height: {
    type: 'breakpoint',
    unit: 'm',
    breakpoints: [0, 0.61, 1.22, 2.44, 3.66, 6.1],
    colors: [
      [219, 234, 254, 0.0],
      [34, 211, 238, 0.45],
      [37, 99, 235, 0.65],
      [147, 51, 234, 0.75],
      [190, 24, 74, 0.85],
      [159, 18, 57, 0.95]
    ]
  },
  wave: {
    type: 'breakpoint',
    unit: 'm',
    breakpoints: [0, 0.61, 1.22, 2.44, 3.66, 6.1],
    colors: [
      [219, 234, 254, 0.0],
      [34, 211, 238, 0.45],
      [37, 99, 235, 0.65],
      [147, 51, 234, 0.75],
      [190, 24, 74, 0.85],
      [159, 18, 57, 0.95]
    ]
  },
  swell_wave_height: {
    type: 'breakpoint',
    unit: 'm',
    breakpoints: [0, 0.61, 1.22, 2.44, 3.66, 6.1],
    colors: [
      [207, 250, 254, 0.0],
      [34, 211, 238, 0.45],
      [59, 130, 246, 0.65],
      [79, 70, 229, 0.75],
      [109, 40, 217, 0.85],
      [91, 33, 182, 0.95]
    ]
  },
  secondary_swell_wave_height: {
    type: 'breakpoint',
    unit: 'm',
    breakpoints: [0, 0.3, 0.61, 1.22, 1.83, 3.05],
    colors: [
      [243, 232, 255, 0.0],
      [192, 132, 252, 0.4],
      [217, 70, 239, 0.6],
      [219, 39, 119, 0.75],
      [190, 24, 74, 0.85],
      [159, 18, 57, 0.95]
    ]
  },
  wind_wave_height: {
    type: 'breakpoint',
    unit: 'm',
    breakpoints: [0, 0.3, 0.61, 1.22, 1.83, 3.05],
    colors: [
      [209, 250, 229, 0.0],
      [52, 211, 153, 0.4],
      [20, 184, 166, 0.6],
      [8, 145, 178, 0.75],
      [29, 78, 216, 0.85],
      [30, 58, 138, 0.95]
    ]
  },
  precipitation: {
    type: 'breakpoint',
    unit: 'mm',
    breakpoints: [0, 0.1, 0.5, 2.0, 10.0, 50.0],
    colors: [
      [224, 242, 254, 0.0],
      [56, 189, 248, 0.35],
      [14, 165, 233, 0.55],
      [37, 99, 235, 0.70],
      [124, 58, 237, 0.85],
      [219, 39, 119, 0.95]
    ]
  }
};

export var CUSTOM_COLOR_SCALES = {};
Object.keys(BASE_CUSTOM_COLOR_SCALES).forEach(function(key) {
  CUSTOM_COLOR_SCALES[key] = smoothColorScale(BASE_CUSTOM_COLOR_SCALES[key], 80);
});

var _mapLibreWorkerSet = false;
export function ensureMapLibreInit() {
  if (_mapLibreWorkerSet) return;
  maplibregl.setWorkerUrl('/maplibre-gl-worker.js');
  maplibregl.setMaxParallelImageRequests(32);
  window.__LRCM_EXEC_TRACE__ = window.__LRCM_EXEC_TRACE__ || [];
  window.__RASTER_DEBUG__ = window.__RASTER_DEBUG__ || { failFast: true, logMissingVariables: true };

  // Suppress unhandled promise rejection for aborted fetch tiles
  const suppress = e => (e?.reason?.name === 'AbortError' || e?.reason?.message?.includes('aborted')) && e.preventDefault();
  window.addEventListener('unhandledrejection', suppress);

  _mapLibreWorkerSet = true;
}

export function trace(layer, action, source, payload) {
  (window.__LRCM_EXEC_TRACE__ = window.__LRCM_EXEC_TRACE__ || []).push({
    layer,
    action,
    source,
    timestamp: Date.now(),
    payload,
    stack: new Error().stack
  });
  return payload;
}

export var OM_MODEL_MAP = {
  GFS:  'ncep_gfs025',
  EURO: 'ecmwf_ifs025',
  ICON: 'dwd_icon',
};

export var MODEL_METADATA_PROMISES = {};
export var LIVE_FETCHED_MODELS = new Set();

export async function fetchModelMetadata(modelToCheck, MODEL_METADATA_CACHE, onMetadataChanged, signal) {
  const cached = MODEL_METADATA_CACHE[modelToCheck];
  if (cached && LIVE_FETCHED_MODELS.has(modelToCheck)) return cached;

  // Try reading from localStorage persistent cache
  try {
    const stored = localStorage.getItem(`om_meta_${modelToCheck}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Ensure the cache is fresh (less than 1 hour old)
      if (parsed && parsed.validTimes && (Date.now() - (parsed.fetchedAt || 0) < 3600000)) {
        MODEL_METADATA_CACHE[modelToCheck] = {
          variables: parsed.variables || [],
          validTimes: parsed.validTimes || [],
          referenceTime: parsed.referenceTime || null
        };
        LIVE_FETCHED_MODELS.add(modelToCheck);
        console.log(`[OM-Cache] Persistent metadata cache HIT for ${modelToCheck} (<1ms)`);
        
        if (onMetadataChanged) {
          onMetadataChanged();
        }
        return MODEL_METADATA_CACHE[modelToCheck];
      }
    }
  } catch (e) {
    console.warn('[OM-Cache] Failed to read metadata from localStorage:', e);
  }

  // If already in flight, return the active promise so callers await the fresh network data
  if (MODEL_METADATA_PROMISES[modelToCheck]) {
    return MODEL_METADATA_PROMISES[modelToCheck];
  }

  if (!LIVE_FETCHED_MODELS.has(modelToCheck)) {
    // If signal is already aborted, throw AbortError immediately
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }

    MODEL_METADATA_PROMISES[modelToCheck] = fetch(`/api/weather-proxy?type=tiles&model=${modelToCheck}`, { signal })
      .then(async res => {
        const contentType = res.headers.get('content-type') || '';
        if (!res.ok || !contentType.includes('application/json')) {
          console.warn(`[OM-Protocol] Proxy failed or returned non-JSON (${res.status}, ${contentType}). Initiating direct-to-CDN metadata fallback fetch...`);
          // Bypassing netlify proxy and fetching straight from Open-Meteo edge CDN
          const fallbackRes = await fetch(`https://map-tiles.open-meteo.com/data_spatial/${modelToCheck}/latest.json?skip_intercept=true`, { signal });
          if (!fallbackRes.ok) {
            throw new Error(`Direct edge CDN fetch failed: ${fallbackRes.status}`);
          }
          return fallbackRes.json();
        }
        return res.json();
      })
      .then(data => {
        const result = {
          variables: data.variables || [],
          validTimes: data.valid_times || [],
          referenceTime: data.reference_time || null,
        };
        const prevCache = MODEL_METADATA_CACHE[modelToCheck];
        const hasChanged = !prevCache ||
          prevCache.referenceTime !== result.referenceTime ||
          prevCache.variables.length !== result.variables.length ||
          prevCache.validTimes.length !== result.validTimes.length;

        MODEL_METADATA_CACHE[modelToCheck] = result;
        LIVE_FETCHED_MODELS.add(modelToCheck);

        // Save to localStorage persistent cache
        try {
          localStorage.setItem(`om_meta_${modelToCheck}`, JSON.stringify({
            ...result,
            fetchedAt: Date.now()
          }));
          console.log(`[OM-Cache] Persistent metadata cache WARMED for ${modelToCheck}`);
        } catch (e) {
          // ignore
        }

        if (hasChanged && onMetadataChanged) {
          onMetadataChanged();
        }
        return result;
      })
      .catch(err => {
        // High-precision AbortError checking: do not flag aborted requests as systemic proxy errors
        if (err.name === 'AbortError' || err.message?.includes('abort')) {
          console.log(`[OM-Protocol] Metadata fetch for ${modelToCheck} was cleanly aborted.`);
          throw err; // Propagate AbortError cleanly
        }
        console.warn(`[MapWebGL] Failed to fetch latest.json for ${modelToCheck}`, err);
        // CRITICAL BUGFIX: Do NOT add failed models to LIVE_FETCHED_MODELS, which would block future retry attempts
        // LIVE_FETCHED_MODELS.add(modelToCheck);
        return cached || { variables: [], validTimes: [], referenceTime: null };
      })
      .finally(() => {
        MODEL_METADATA_PROMISES[modelToCheck] = null;
      });

    return MODEL_METADATA_PROMISES[modelToCheck];
  }
  return MODEL_METADATA_CACHE[modelToCheck] || cached || { variables: [], validTimes: [], referenceTime: null };
}

// v18: Shared utilities to completely prevent styledata event storms and mount race conditions
export function safeMoveLayer(mapInstance, layerId, beforeId) {
  if (!mapInstance || !layerId || !beforeId) return;
  try {
    if (!mapInstance.getLayer(layerId) || !mapInstance.getLayer(beforeId)) return;
    const style = mapInstance.getStyle();
    if (!style || !style.layers) return;
    const layers = style.layers;
    const layerIdx = layers.findIndex(l => l.id === layerId);
    const beforeIdx = layers.findIndex(l => l.id === beforeId);
    if (layerIdx !== -1 && beforeIdx !== -1) {
      if (layerIdx < beforeIdx) {
        return; // Already before beforeId (completely avoids styledata loops)
      }
    }
    mapInstance.moveLayer(layerId, beforeId);
  } catch (e) { /* ignore */ }
}

export function safeSetPaintProperty(mapInstance, layerId, name, value) {
  if (!mapInstance || !layerId) return;
  try {
    if (!mapInstance.getLayer(layerId)) return;
    const current = mapInstance.getPaintProperty(layerId, name);
    if (JSON.stringify(current) === JSON.stringify(value)) {
      return; // No change, skip to prevent styledata loop
    }
    mapInstance.setPaintProperty(layerId, name, value);
  } catch (e) {
    try {
      mapInstance.setPaintProperty(layerId, name, value);
    } catch (err) { /* ignore */ }
  }
}

export function safeSetFilter(mapInstance, layerId, filter) {
  if (!mapInstance || !layerId) return;
  try {
    if (!mapInstance.getLayer(layerId)) return;
    const current = mapInstance.getFilter(layerId);
    if (JSON.stringify(current) === JSON.stringify(filter)) {
      return; // No change, skip to prevent styledata loop
    }
    mapInstance.setFilter(layerId, filter);
  } catch (e) {
    try {
      mapInstance.setFilter(layerId, filter);
    } catch (err) { /* ignore */ }
  }
}

// Marine variables that should be clipped to ocean only
const MARINE_VARIABLES = new Set([
  'wave_height', 'swell_wave_height', 'secondary_swell_wave_height',
  'wind_wave_height', 'swell_wave_period', 'swell_wave_direction',
  'wind_wave_period', 'wind_wave_direction', 'wave_period', 'wave_direction',
  'ocean_current_velocity', 'sea_surface_temperature'
]);

/**
 * Build an ocean-only GeoJSON polygon from land GeoJSON.
 * Creates a world bounding box with land polygons as holes.
 */
function buildOceanPolygon(landGeoJSON) {
  if (!landGeoJSON?.features?.length) return null;

  // World bounding box (outer ring, counter-clockwise)
  const worldRing = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];

  // Collect all land polygon rings as holes (clockwise for GeoJSON holes)
  const holes = [];
  for (const feature of landGeoJSON.features) {
    const geom = feature.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      // Only take the outer ring of each land polygon as a hole
      if (geom.coordinates[0]) holes.push(geom.coordinates[0]);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (poly[0]) holes.push(poly[0]);
      }
    }
  }

  if (holes.length === 0) return null;

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [worldRing, ...holes]
    },
    properties: {}
  };
}

export function registerOpenMeteoProtocol(maplibregl, setProtocolReady, MODEL_METADATA_CACHE) {
  // Register a global fetch interceptor to completely prevent 429 rate limits on latest.json metadata requests
  const globalCtx = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : {};
  if (globalCtx.fetch && !globalCtx.__FETCH_INTERCEPTED__) {
    globalCtx.__FETCH_INTERCEPTED__ = true;
    const originalFetch = globalCtx.fetch;
    globalCtx.fetch = function (input, init) {
      const urlString = typeof input === 'string' ? input : input?.url || '';
      if (urlString.includes('map-tiles.open-meteo.com') && urlString.includes('latest.json') && !urlString.includes('skip_intercept=true') && MODEL_METADATA_CACHE) {
        try {
          const urlObj = new URL(urlString);
          const parts = urlObj.pathname.split('/');
          const model = parts[2];
          if (model && MODEL_METADATA_CACHE[model] && MODEL_METADATA_CACHE[model].validTimes?.length) {
            const meta = MODEL_METADATA_CACHE[model];
            const responseData = {
              completed: true,
              crs_wkt: "",
              last_modified_time: new Date().toISOString(),
              reference_time: meta.referenceTime || (() => {
                const d = new Date(Date.now() - 12 * 3600000);
                const h = d.getUTCHours();
                d.setUTCHours(Math.floor(h / 6) * 6, 0, 0, 0);
                return d.toISOString().replace(/\.\d+Z$/, 'Z');
              })(),
              valid_times: meta.validTimes || [],
              variables: meta.variables || []
            };
            console.log(`[OM-Protocol] Fetch intercept HIT for ${model} latest.json (<1ms)`);
            return Promise.resolve(new Response(JSON.stringify(responseData), {
              status: 200,
              statusText: 'OK',
              headers: { 'Content-Type': 'application/json' }
            }));
          }
        } catch (err) {
          console.warn('[OM-Protocol] Fetch intercept parsing error:', err);
        }
      }
      return originalFetch.apply(this, arguments);
    };
  }

  import('@openmeteo/weather-map-layer').then(({ omProtocol, defaultOmProtocolSettings }) => {
    // Forceful mutation to guarantee custom scales are used in all instances
    Object.assign(defaultOmProtocolSettings.colorScales, CUSTOM_COLOR_SCALES);

    const settings = {
      ...defaultOmProtocolSettings,
      colorScales: {
        ...defaultOmProtocolSettings.colorScales,
        ...CUSTOM_COLOR_SCALES
      }
    };
    window.__OM_PROTOCOL_SETTINGS__ = settings;

    // Fetch land GeoJSON and build ocean clipping polygon for marine layers
    // Use 50m resolution for faster loading (sufficient for tile-level clipping)
    const NE_LAND_50M_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_land.geojson';
    fetch(NE_LAND_50M_URL)
      .then(r => r.json())
      .then(landGeoJSON => {
        const oceanPoly = buildOceanPolygon(landGeoJSON);
        if (oceanPoly) {
          const marineSettings = {
            ...settings,
            clippingOptions: {
              geojson: oceanPoly,
              fillRule: 'evenodd'
            }
          };
          window.__OM_MARINE_SETTINGS__ = marineSettings;
          console.log('[OM-Protocol] Ocean clipping polygon built:', oceanPoly.geometry.coordinates.length - 1, 'land holes');
        }
      })
      .catch(err => {
        console.warn('[OM-Protocol] Failed to build ocean clipping polygon:', err.message);
      });

    if (maplibregl?.addProtocol) {
      try {
        maplibregl.addProtocol('om', (params, abortController) => {
          const hasWindow = typeof window !== 'undefined';
          const currentSettings = (hasWindow && window.__OM_PROTOCOL_SETTINGS__) || settings;
          const debug = (hasWindow && window.__RASTER_DEBUG__) || {};
          
          // Safe one-time init log
          if (!debug.hasLoggedProtocol) {
            if (hasWindow && window.__RASTER_DEBUG__) window.__RASTER_DEBUG__.hasLoggedProtocol = true;
            console.log('[OM-Protocol] Registered with', Object.keys(currentSettings.colorScales).length, 'color scales');
          }
          
           let requestedModelFolder = "";
          let urlObj = null;
          let variable = "";
          try {
            urlObj = new URL(params.url.replace('om://', ''));
            const parts = urlObj.pathname.split('/');
            if (parts[2]) {
              requestedModelFolder = parts[2];
            }
            variable = urlObj.searchParams.get('variable') || "";
          } catch (err) { /* ignore parse errors */ }

          const getSafeWorkerFallbackResponse = async (url, type) => {
            // Explicitly verify that the URL request targets a cancelled metadata configuration block
            const isAbortedJsonMeta = type === 'json' || 
              (url && (url.includes('type=json') || url.includes('time_step=undefined') || url.includes('latest.json'))) && 
              !url.includes('.om');

            if (isAbortedJsonMeta) {
              const flawlessMockJson = {
                tilejson: "2.2.0",
                name: "om-safe-fallback",
                version: "1.0.0",
                tiles: ["om://transparent-tile"],
                bounds: [-180, -85, 180, 85],
                minzoom: 0,
                maxzoom: 22,
                completed: true,
                crs_wkt: "",
                last_modified_time: new Date().toISOString(),
                reference_time: new Date().toISOString(),
                valid_times: [new Date().toISOString()],
                variables: []
              };
              // Return the parsed JSON object directly to prevent MapLibre from throwing length TypeError
              return { data: flawlessMockJson };
            }

            // Standard imagery fallbacks return our valid 1x1 fully transparent PNG data container
            // Pre-compiled raw Uint8Array byte sequence avoids window.atob ReferenceError in Web Workers.
            try {
              const cleanPngBytes = new Uint8Array([
                137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 96, 96, 96, 96, 0, 0, 0, 5, 0, 1, 165, 246, 69, 64, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
              ]);
              return { data: cleanPngBytes.buffer };
            } catch (e) {
              return { data: new ArrayBuffer(0) };
            }
          };

          // Intercept local transparent-tile requests seamlessly without causing Data URI fetch exceptions
          if (params.url && params.url.includes('transparent-tile')) {
            return getSafeWorkerFallbackResponse(params.url, 'image');
          }

          // Zero-Latency Match Lock Fast-Path
          const matchResult = isModelMatch(requestedModelFolder, activeModelLock);
          if (params.url.includes('variable=')) {
            console.log(`[OM-Protocol DEBUG] url: ${params.url}, folder: ${requestedModelFolder}, lock: ${activeModelLock}, match: ${matchResult}`);
          }
          if (!matchResult) {
            return getSafeWorkerFallbackResponse(params.url, params.type);
          }

          // v3.14: Use ocean-clipped settings for marine variables so land pixels are transparent
          const isMarine = variable && MARINE_VARIABLES.has(variable);
          const marineSettings = (hasWindow && window.__OM_MARINE_SETTINGS__) || null;
          const effectiveSettings = (isMarine && marineSettings) ? marineSettings : currentSettings;

          // v3.13.5: Double-wrapped synchronous + asynchronous type-safe error boundaries
          // Guarantee that the base map tiles survive even if a specific forecast block fails to decode or load
          try {
            return omProtocol(params, abortController, effectiveSettings)
              .catch(err => {
                if (err.name === 'AbortError' || err.message?.includes('aborted')) {
                  // Propagate the AbortError cleanly to let MapLibre know the cancellation succeeded
                  throw err;
                }
                console.error('[OM-Protocol] Async tile decoding error caught:', err, err.stack);
                return getSafeWorkerFallbackResponse(params.url, params.type); // Type-safe fallback!
              });
          } catch (syncErr) {
            if (syncErr.name === 'AbortError' || syncErr.message?.includes('aborted')) {
              throw syncErr;
            }
            console.error('[OM-Protocol] Sync tile parsing error:', syncErr, syncErr.stack);
            return getSafeWorkerFallbackResponse(params.url, params.type); // Type-safe fallback!
          }
        });
      } catch (e) { /* already registered - will read from window.__OM_PROTOCOL_SETTINGS__ */ }
    }
    setProtocolReady(true);
  });
}

/**
 * v3.13.2: Dynamically imports clearBlockCache from @openmeteo/weather-map-layer
 * and completely clears the tile server's grid block registry.
 * Called on activeModel changes to prevent cross-model data pollution and tile corruption.
 * @returns {Promise<void>}
 */
export function clearOpenMeteoCache() {
  return import('@openmeteo/weather-map-layer')
    .then(({ clearBlockCache }) => {
      return clearBlockCache()
        .then(() => {
          console.log('[OM-Protocol] Grid block cache cleared successfully');
        })
        .catch(err => {
          console.warn('[OM-Protocol] clearBlockCache execution failed:', err);
        });
    })
    .catch(err => {
      console.warn('[OM-Protocol] Failed to import clearBlockCache:', err);
    });
}


