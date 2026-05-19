/**
 * Map utility functions and constants
 * Extracted from MapPage.js for better organization
 */


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
  beach: `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
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
  beach:     `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12?access_token=${MAPBOX_TOKEN}`,
  satellite: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12?access_token=${MAPBOX_TOKEN}`,
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
  if (!style?.layers) return null;

  // Find the first layer after the water fill
  var afterWater = false;
  for (var layer of style.layers) {
    if (layer.id === 'water' || layer.id === 'water-depth' || layer.id === 'wetland') {
      afterWater = true;
      continue;
    }
    if (afterWater && (layer.type === 'fill' || layer.type === 'line')) return layer.id;
  }

  // Fallback: known layer IDs
  var knownIds = ['land-structure-polygon', 'building-outline', 'building'];
  for (var layer2 of style.layers) {
    if (knownIds.includes(layer2.id)) return layer2.id;
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
