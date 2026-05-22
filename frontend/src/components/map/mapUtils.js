/**
 * Map utility functions and constants
 * Extracted from MapPage.js for better organization
 */

import maplibregl from 'maplibre-gl';

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

  var afterWater = false;
  var fallbackId = null;

  // Primary Pass: Find the first valid non-custom layer immediately following water fill layers.
  // Placing the marine/mask layers here inserts them at the absolute bottom of the land layer stack,
  // below landuse, parks, roads, buildings, and labels.
  for (var layer of style.layers) {
    var id = layer.id;
    var isCustom = id.startsWith('ocean-mask-') || 
                   id.endsWith('-layer') || 
                   id.endsWith('-source') ||
                   id === 'radar-layer' || 
                   id === 'esri-satellite-layer' ||
                   id === 'spot-geofences-layer' ||
                   id === 'marine-raster-anchor';

    if (id === 'water' || id === 'water-depth' || id === 'wetland') {
      afterWater = true;
      continue;
    }

    if (afterWater && !isCustom) {
      return id;
    }

    // Keep track of a general fallback (any non-custom, non-background, non-water layer)
    if (!isCustom && id !== 'background' && id !== 'water' && id !== 'water-depth' && id !== 'wetland') {
      if (!fallbackId) {
        fallbackId = id;
      }
    }
  }

  // Fallback Pass 1: If water layers were not found, search for preferred land prefixes
  var preferredPrefixes = [
    'tunnel-', 'road-', 'bridge-', 'building', 'land-structure', 
    'aeroway', 'admin-', 'highway-', 'railway-'
  ];

  for (layer of style.layers) {
    id = layer.id;
    isCustom = id.startsWith('ocean-mask-') || 
                   id.endsWith('-layer') || 
                   id.endsWith('-source') ||
                   id === 'radar-layer' || 
                   id === 'esri-satellite-layer' ||
                   id === 'spot-geofences-layer' ||
                   id === 'marine-raster-anchor';
    if (isCustom) continue;

    for (var prefix of preferredPrefixes) {
      if (id.startsWith(prefix)) {
        return id;
      }
    }
  }

  // Fallback Pass 2: return the first general non-custom fallback layer we saw
  if (fallbackId) return fallbackId;

  // Fallback Pass 3: return the last non-custom layer in the style
  for (var i = style.layers.length - 1; i >= 0; i--) {
    var lid = style.layers[i].id;
    var isLidCustom = lid.startsWith('ocean-mask-') || 
                      lid.endsWith('-layer') || 
                      lid.endsWith('-source') ||
                      lid === 'radar-layer' || 
                      lid === 'esri-satellite-layer' ||
                      lid === 'spot-geofences-layer' ||
                      lid === 'marine-raster-anchor';
    if (!isLidCustom) return lid;
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

var BASE_CUSTOM_COLOR_SCALES = {
  wave_height: {
    type: 'breakpoint',
    unit: 'm',
    breakpoints: [0, 0.61, 1.22, 2.44, 3.66, 6.1],
    colors: [
      [219, 234, 254, 0.15],
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
      [219, 234, 254, 0.15],
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
      [207, 250, 254, 0.15],
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
      [243, 232, 255, 0.15],
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
      [209, 250, 229, 0.15],
      [52, 211, 153, 0.4],
      [20, 184, 166, 0.6],
      [8, 145, 178, 0.75],
      [29, 78, 216, 0.85],
      [30, 58, 138, 0.95]
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

export async function fetchModelMetadata(modelToCheck, MODEL_METADATA_CACHE, onMetadataChanged) {
  const cached = MODEL_METADATA_CACHE[modelToCheck];
  if (!LIVE_FETCHED_MODELS.has(modelToCheck) && !MODEL_METADATA_PROMISES[modelToCheck]) {
    MODEL_METADATA_PROMISES[modelToCheck] = fetch(`https://map-tiles.open-meteo.com/data_spatial/${modelToCheck}/latest.json`)
      .then(res => {
        if (!res.ok) throw new Error('Fetch failed');
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

        if (hasChanged && onMetadataChanged) {
          onMetadataChanged();
        }
        return result;
      })
      .catch(err => {
        console.warn(`[MapWebGL] Failed to fetch latest.json for ${modelToCheck}`, err);
        LIVE_FETCHED_MODELS.add(modelToCheck);
        return cached || { variables: [], validTimes: [], referenceTime: null };
      })
      .finally(() => {
        MODEL_METADATA_PROMISES[modelToCheck] = null;
      });
  }
  return cached || { variables: [], validTimes: [], referenceTime: null };
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
      if (layerIdx === beforeIdx - 1) {
        return; // Already immediately before beforeId
      }
    }
    mapInstance.moveLayer(layerId, beforeId);
  } catch (e) {}
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
    } catch (err) {}
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
    } catch (err) {}
  }
}

export function registerOpenMeteoProtocol(maplibregl, setProtocolReady) {
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

    if (maplibregl?.addProtocol) {
      try {
        maplibregl.addProtocol('om', (params, abortController) => {
          const currentSettings = window.__OM_PROTOCOL_SETTINGS__ || settings;
          
          if (!window.__RASTER_DEBUG__?.hasLoggedProtocol) {
            window.__RASTER_DEBUG__.hasLoggedProtocol = true;
            console.log('[OM-Protocol] Custom scales initialized:', Object.keys(currentSettings.colorScales));
          }
          
          try {
            const urlObj = new URL(params.url.replace('om://', ''));
            const variable = urlObj.searchParams.get('variable');
            const scale = currentSettings.colorScales[variable];
            if (scale && window.__RASTER_DEBUG__?.logMissingVariables && !window.__RASTER_DEBUG__?.[`logged_scale_${variable}`]) {
              window.__RASTER_DEBUG__[`logged_scale_${variable}`] = true;
              console.log(`[OM-Protocol] Variable: ${variable}, Unit: ${scale.unit}, Breakpoints count: ${scale.breakpoints?.length}`);
            }
          } catch (err) { /* ignore parse errors */ }

          return omProtocol(params, abortController, currentSettings);
        });
      } catch (e) { /* already registered - will read from window.__OM_PROTOCOL_SETTINGS__ */ }
    }
    setProtocolReady(true);
  });
}


