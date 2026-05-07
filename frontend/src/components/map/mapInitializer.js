/**
 * Map Initializer Service
 * Handles Leaflet map instance creation, tile layers, cluster groups, and viewport handlers.
 * Extracted from MapPage.js (v68)
 */

import { toast } from 'sonner';
import logger from '../../utils/logger';
import {
  FLORIDA_CENTER, DEFAULT_MAP_OPTIONS, TILE_LAYER_CONFIG,
  SPOT_CLUSTER_OPTIONS, PHOTOGRAPHER_CLUSTER_OPTIONS, debounce
} from './mapUtils';

/**
 * Create custom cluster icon functions for spot and photographer clusters.
 */
const createSpotClusterIconFn = (cluster) => {
  const count = cluster.getChildCount();
  return window.L.divIcon({
    className: 'custom-cluster-marker',
    html: `
      <div class="w-10 h-10 rounded-full bg-gradient-to-r from-emerald-400 to-yellow-400 flex items-center justify-center shadow-lg">
        <span class="text-black font-bold text-sm">${count}</span>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });
};

const createPhotographerClusterIconFn = (cluster) => {
  const count = cluster.getChildCount();
  return window.L.divIcon({
    className: 'custom-cluster-marker',
    html: `
      <div class="relative">
        <div class="absolute inset-0 w-12 h-12 rounded-full bg-cyan-400 animate-ping opacity-30"></div>
        <div class="w-12 h-12 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg">
          <span class="text-white font-bold text-sm">${count}</span>
        </div>
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24]
  });
};

/**
 * Attach visual viewport resize handlers for Android foldable support.
 * @param {Object} map - Leaflet map instance
 * @param {Object} mapInstanceRef - Ref to map instance (for debounce closure)
 */
const attachViewportHandlers = (map, mapInstanceRef) => {
  if (!window.visualViewport) return;

  const onVisualViewportResize = debounce(() => {
    if (mapInstanceRef.current) mapInstanceRef.current.invalidateSize({ pan: false });
  }, 100);

  window.visualViewport.addEventListener('resize', onVisualViewportResize);
  window.visualViewport.addEventListener('scroll', onVisualViewportResize);

  map.on('remove', () => {
    window.visualViewport.removeEventListener('resize', onVisualViewportResize);
    window.visualViewport.removeEventListener('scroll', onVisualViewportResize);
  });
};

/**
 * Initialize the primary Leaflet map instance.
 *
 * @param {Object} params
 * @param {Object} params.mapRef - React ref to the map container DOM element
 * @param {Object} params.mapInstanceRef - React ref to store the map instance
 * @param {Object} params.spotClusterRef - React ref for spot cluster group
 * @param {Object} params.photographerClusterRef - React ref for photographer cluster group
 * @param {string} params.mapTilesUrl - Tile layer URL (light/dark theme)
 * @param {Function} params.onMarkersReady - Callback to invoke after map is ready (e.g., updateMapMarkers + updateUserLocationMarker)
 */
export const initializeMap = ({
  mapRef, mapInstanceRef, spotClusterRef, photographerClusterRef,
  mapTilesUrl, onMarkersReady
}) => {
  if (!mapRef.current || !window.L) {
    logger.warn('[MAP] Missing container or Leaflet');
    return;
  }

  try {
    mapRef.current.style.height = '100%';
    mapRef.current.style.minHeight = '50vh';
    const rect = mapRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      setTimeout(() => initializeMap({ mapRef, mapInstanceRef, spotClusterRef, photographerClusterRef, mapTilesUrl, onMarkersReady }), 100);
      return;
    }
    if (mapInstanceRef.current) return;

    const map = window.L.map(mapRef.current, {
      center: [FLORIDA_CENTER.lat, FLORIDA_CENTER.lng],
      zoom: 7,
      ...DEFAULT_MAP_OPTIONS
    });

    setTimeout(() => { if (map?.invalidateSize) map.invalidateSize(); }, 100);

    const tileLayer = window.L.tileLayer(mapTilesUrl, TILE_LAYER_CONFIG.options).addTo(map);
    map._tileLayer = tileLayer;
    window.L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Initialize marker cluster groups with custom icon functions
    spotClusterRef.current = window.L.markerClusterGroup({
      ...SPOT_CLUSTER_OPTIONS,
      chunkInterval: 100, chunkDelay: 25,
      animate: true, animateAddingMarkers: false,
      removeOutsideVisibleBounds: true,
      iconCreateFunction: createSpotClusterIconFn
    });

    photographerClusterRef.current = window.L.markerClusterGroup({
      ...PHOTOGRAPHER_CLUSTER_OPTIONS,
      maxClusterRadius: 80, disableClusteringAtZoom: 12,
      chunkInterval: 100, chunkDelay: 25,
      animate: true, animateAddingMarkers: false,
      removeOutsideVisibleBounds: true,
      iconCreateFunction: createPhotographerClusterIconFn
    });

    map.addLayer(spotClusterRef.current);
    map.addLayer(photographerClusterRef.current);

    const debouncedMoveEnd = debounce(() => {}, 250);
    map.on('moveend', debouncedMoveEnd);

    attachViewportHandlers(map, mapInstanceRef);

    mapInstanceRef.current = map;

    if (onMarkersReady) onMarkersReady();
  } catch (error) {
    logger.error('[MAP] Error initializing map:', error);
    toast.error('Map failed to load', { description: 'Please refresh the page' });
  }
};

/**
 * Recreate the map instance at a new GPS location.
 * Used when the user grants GPS access for the first time.
 *
 * @param {Object} params
 * @param {Object} params.location - { lat, lng } coordinates
 * @param {Object} params.mapRef - React ref to the map container DOM element
 * @param {Object} params.mapInstanceRef - React ref to store the map instance
 * @param {Object} params.spotClusterRef - React ref for spot cluster group
 * @param {Object} params.photographerClusterRef - React ref for photographer cluster group
 * @param {string} params.mapTilesUrl - Tile layer URL
 * @param {Function} params.onMarkersReady - Callback to invoke after map is ready
 */
export const recreateMapAtLocation = ({
  location, mapRef, mapInstanceRef, spotClusterRef, photographerClusterRef,
  mapTilesUrl, onMarkersReady
}) => {
  // Destroy existing map
  if (mapInstanceRef.current) {
    mapInstanceRef.current.remove();
    mapInstanceRef.current = null;
  }

  setTimeout(() => {
    if (!mapRef.current || !window.L) return;

    const map = window.L.map(mapRef.current, {
      center: [location.lat, location.lng], zoom: 12,
      ...DEFAULT_MAP_OPTIONS
    });

    window.L.tileLayer(mapTilesUrl, TILE_LAYER_CONFIG.options).addTo(map);
    window.L.control.zoom({ position: 'bottomright' }).addTo(map);

    spotClusterRef.current = window.L.markerClusterGroup(SPOT_CLUSTER_OPTIONS);
    map.addLayer(spotClusterRef.current);
    photographerClusterRef.current = window.L.markerClusterGroup(PHOTOGRAPHER_CLUSTER_OPTIONS);
    map.addLayer(photographerClusterRef.current);

    attachViewportHandlers(map, mapInstanceRef);

    mapInstanceRef.current = map;

    setTimeout(() => {
      if (onMarkersReady) onMarkersReady();
      if (mapInstanceRef.current) mapInstanceRef.current.invalidateSize();
    }, 100);
  }, 100);
};
