/**
 * Map utility functions and constants
 * Extracted from MapPage.js for better organization
 */

import maplibregl from 'maplibre-gl';

export function invalidateStaleTileRequests() {
  // Backwards compatibility stub
}

var _mapLibreWorkerSet = false;
export function ensureMapLibreInit() {
  if (_mapLibreWorkerSet) return;
  maplibregl.setWorkerUrl('/maplibre-gl-worker.js');
  maplibregl.setMaxParallelImageRequests(32);
  window.__LRCM_EXEC_TRACE__ = window.__LRCM_EXEC_TRACE__ || [];
  window.__RASTER_DEBUG__ = window.__RASTER_DEBUG__ || { failFast: true, logMissingVariables: true };
  _mapLibreWorkerSet = true;
}

export function trace(layer, action, source, payload) {
  const isDebug = typeof window !== 'undefined' && window.__RASTER_DEBUG__?.enableTrace;
  (window.__LRCM_EXEC_TRACE__ = window.__LRCM_EXEC_TRACE__ || []).push({
    layer,
    action,
    source,
    timestamp: Date.now(),
    payload,
    stack: isDebug ? new Error().stack : null
  });
  return payload;
}

export const safeSetPaintProperty = (mapInstance, layerId, name, value) => {
  if (!mapInstance || !layerId) return;
  try {
    if (!mapInstance.getLayer(layerId)) return;
    const current = mapInstance.getPaintProperty(layerId, name);
    if (JSON.stringify(current) === JSON.stringify(value)) {
      return; // No change, skip to prevent styledata loop
    }
    mapInstance.setPaintProperty(layerId, name, value);
  } catch (e) {
    // Suppress errors or handle them gracefully
  }
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

// Re-export everything from colorScales and openMeteoProtocol
export * from './colorScales';
export * from './openMeteoProtocol';

/**
 * Fits the map bounds to include all active surf spots and live photographers
 */
export function fitMapToAll(mapInstance, surfSpots, livePhotographers) {
  if (!mapInstance) return;
  let minLng = Infinity, minLat = Infinity;
  let maxLng = -Infinity, maxLat = -Infinity;
  
  (surfSpots || []).forEach(spot => {
    if (spot.latitude && spot.longitude) {
      minLng = Math.min(minLng, spot.longitude);
      minLat = Math.min(minLat, spot.latitude);
      maxLng = Math.max(maxLng, spot.longitude);
      maxLat = Math.max(maxLat, spot.latitude);
    }
  });
  
  (livePhotographers || []).forEach(p => {
    if (p.current_latitude && p.current_longitude) {
      minLng = Math.min(minLng, p.current_longitude);
      minLat = Math.min(minLat, p.current_latitude);
      maxLng = Math.max(maxLng, p.current_longitude);
      maxLat = Math.max(maxLat, p.current_latitude);
    }
  });
  
  if (minLng !== Infinity) {
    mapInstance.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]], 
      { padding: 50 }
    );
  } else {
    // Default to Florida center
    mapInstance.jumpTo({
      center: [FLORIDA_CENTER.lng, FLORIDA_CENTER.lat], 
      zoom: 7
    });
  }
}

export var OM_MODEL_MAP = {
  GFS:  'ncep_gfs025',
  EURO: 'ecmwf_ifs025',
  ICON: 'dwd_icon',
};

export var MODEL_METADATA_PROMISES = {};
export var LIVE_FETCHED_MODELS = new Set();

export async function fetchModelMetadata(modelToCheck, MODEL_METADATA_CACHE, onMetadataChanged) {
  const cached = MODEL_METADATA_CACHE[modelToCheck];
  if (!LIVE_FETCHED_MODELS.has(modelToCheck) && !MODEL_METADATA_PROMISES[modelToCheck]) {
    MODEL_METADATA_PROMISES[modelToCheck] = fetch(`https://map-tiles.open-meteo.com/data_spatial/${modelToCheck}/latest.json`)
      .then(res => {
        if (!res.ok) throw new Error('Fetch failed');
        return res.json();
      })
      .then(data => {
        const variables = data.variables || [];
        if (variables.includes('wind_u_component_10m') && variables.includes('wind_v_component_10m') && !variables.includes('wind_speed_10m')) {
          variables.push('wind_speed_10m');
        }
        const result = {
          variables: variables,
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

        if (hasChanged && onMetadataChanged) {
          onMetadataChanged();
        }
        return result;
      })
      .catch(err => {
        console.warn(`[MapWebGL] Failed to fetch latest.json for ${modelToCheck}`, err);
        return cached || { variables: [], validTimes: [], referenceTime: null };
      })
      .finally(() => {
        MODEL_METADATA_PROMISES[modelToCheck] = null;
      });
  }
  return cached || { variables: [], validTimes: [], referenceTime: null };
}
