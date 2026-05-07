/**
 * Map Marker Manager
 * Handles rendering surf spot and photographer markers on the Leaflet map.
 * Extracted from MapPage.js (v68)
 */

import { ELECTRIC_CYAN, isValidLatLng, truncateCoord } from './mapUtils';

/**
 * Create a surf spot marker icon based on geofence and activity state.
 */
const createSpotMarkerIcon = (spot) => {
  const hasPhotographers = spot.active_photographers_count > 0;
  const isWithinGeofence = spot.is_within_geofence !== false;
  const distanceMiles = spot.distance_miles;

  return window.L.divIcon({
    className: 'custom-marker',
    html: `
      <div class="relative">
        <div class="w-8 h-8 rounded-full flex items-center justify-center ${
          !isWithinGeofence
            ? 'bg-zinc-800 border-2 border-zinc-600 opacity-60'
            : hasPhotographers 
              ? 'bg-gradient-to-r from-emerald-400 to-yellow-400' 
              : 'bg-zinc-700 border-2 border-zinc-500'
        }">
          ${!isWithinGeofence ? `
            <svg class="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 17a2 2 0 002-2V9a2 2 0 00-2-2 2 2 0 00-2 2v6a2 2 0 002 2m6-9h-1V6a5 5 0 00-10 0v2H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2z"/>
            </svg>
          ` : `
            <svg class="w-4 h-4 ${hasPhotographers ? 'text-black' : 'text-gray-300'}" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          `}
        </div>
        ${hasPhotographers && isWithinGeofence ? `
          <div class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[10px] text-white font-bold animate-pulse">
            ${spot.active_photographers_count}
          </div>
        ` : ''}
        ${!isWithinGeofence && distanceMiles ? `
          <div class="absolute -bottom-5 left-1/2 transform -translate-x-1/2 text-[9px] text-gray-500 whitespace-nowrap font-medium">
            ${distanceMiles > 100 ? Math.round(distanceMiles) : distanceMiles.toFixed(1)} mi
          </div>
        ` : ''}
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 32]
  });
};

/**
 * Create a photographer marker icon with status-specific styling.
 */
const createPhotographerMarkerIcon = (photographer, isPulsing) => {
  const isAtOfficialSpot = photographer.current_spot_id || photographer.spot_id;
  const isShootingLive = photographer.is_streaming || photographer.is_live;
  const isOnDemand = photographer.on_demand_available || photographer.is_available_on_demand;
  const isBoth = isShootingLive && isOnDemand;

  let statusClass, ringClass, labelClass, statusLabel;
  if (isBoth) {
    statusClass = 'status-both'; ringClass = 'status-both-ring'; labelClass = 'status-both-label'; statusLabel = 'LIVE + BOOK';
  } else if (isShootingLive) {
    statusClass = 'status-shooting-live'; ringClass = 'status-shooting-live-ring'; labelClass = 'status-shooting-live-label'; statusLabel = 'SHOOTING';
  } else if (isOnDemand) {
    statusClass = 'status-on-demand'; ringClass = 'status-on-demand-ring'; labelClass = 'status-on-demand-label'; statusLabel = 'ON-DEMAND';
  } else {
    statusClass = ''; ringClass = ''; labelClass = ''; statusLabel = 'ROAMING';
  }

  const html = isAtOfficialSpot
    ? `
      <div class="photographer-pin-container">
        ${isBoth ? `
          <div class="photographer-pin-pulse ${statusClass}" style="background: rgba(168, 85, 247, 0.4);"></div>
          <div class="absolute inset-0 w-14 h-14 -top-1 -left-1 rounded-full ${statusClass}" style="background: rgba(124, 58, 237, 0.3);"></div>
        ` : isShootingLive ? `
          <div class="photographer-pin-pulse ${statusClass}" style="background: rgba(239, 68, 68, 0.4);"></div>
          <div class="absolute inset-0 w-14 h-14 -top-1 -left-1 rounded-full ${statusClass}" style="background: rgba(220, 38, 38, 0.3);"></div>
        ` : isOnDemand ? `
          <div class="photographer-pin-pulse ${statusClass}" style="background: rgba(34, 197, 94, 0.4);"></div>
          <div class="absolute inset-0 w-14 h-14 -top-1 -left-1 rounded-full ${statusClass}" style="background: rgba(22, 163, 74, 0.3);"></div>
        ` : isPulsing ? `
          <div class="absolute inset-0 w-16 h-16 -top-2 -left-2 rounded-full animate-ping opacity-60" style="background-color: ${ELECTRIC_CYAN};"></div>
          <div class="absolute inset-0 w-14 h-14 -top-1 -left-1 rounded-full animate-pulse opacity-40" style="background-color: ${ELECTRIC_CYAN};"></div>
        ` : `
          <div class="absolute inset-0 w-12 h-12 rounded-full bg-cyan-400 animate-ping opacity-40"></div>
        `}
        <div class="photographer-pin-avatar p-[3px] rounded-full ${ringClass || ''}" style="${!ringClass ? `background: ${isPulsing ? `linear-gradient(135deg, ${ELECTRIC_CYAN}, #0099CC)` : 'linear-gradient(to right, rgb(34 211 238), rgb(59 130 246))'}` : ''}">
          <div class="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
            ${photographer.avatar_url 
              ? `<img loading="lazy" decoding="async" src="${photographer.avatar_url}" alt="${photographer.full_name || 'Photographer'} avatar" class="w-full h-full object-cover" />`
              : `<span class="text-lg ${isBoth ? 'text-purple-400' : isShootingLive ? 'text-red-400' : isOnDemand ? 'text-green-400' : ''}" style="${!isBoth && !isShootingLive && !isOnDemand ? `color: ${isPulsing ? ELECTRIC_CYAN : 'rgb(34 211 238)'}` : ''}">${photographer.full_name?.charAt(0) || '?'}</span>`
            }
          </div>
        </div>
        <div class="photographer-pin-status-label ${labelClass || ''}" style="${!labelClass ? `background-color: ${isPulsing ? ELECTRIC_CYAN : 'rgb(16 185 129)'}` : ''}">
          ${isPulsing ? 'NEW!' : statusLabel}
        </div>
      </div>
    `
    : `
      <div class="relative">
        <div class="absolute inset-0 w-12 h-12 rounded-full bg-orange-400 animate-ping opacity-40"></div>
        <div class="relative w-12 h-12 rounded-full p-[3px]" style="background: linear-gradient(135deg, #f97316, #eab308);">
          <div class="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
            ${photographer.avatar_url 
              ? `<img loading="lazy" decoding="async" src="${photographer.avatar_url}" alt="${photographer.full_name || 'Photographer'} avatar" class="w-full h-full object-cover" />`
              : `<span class="text-lg text-orange-400">${photographer.full_name?.charAt(0) || '?'}</span>`
            }
          </div>
        </div>
        <div class="absolute -top-1 -right-1 w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center">
          <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
          </svg>
        </div>
        <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-orange-500 rounded text-[9px] text-white font-bold">
          ROAMING
        </div>
      </div>
    `;

  return window.L.divIcon({
    className: 'custom-marker photographer-marker',
    html,
    iconSize: [56, 64],
    iconAnchor: [28, 64]
  });
};

/**
 * Update all map markers (surf spots + photographers).
 * Clears existing markers and re-renders based on current data and filter.
 *
 * @param {Object} params
 * @param {Object} params.map - Leaflet map instance
 * @param {Object} params.markersRef - Ref holding current individual marker array
 * @param {Object} params.spotClusterRef - Ref to spot cluster group
 * @param {Object} params.photographerClusterRef - Ref to photographer cluster group
 * @param {string} params.filter - Current filter ('all', 'spots', 'photographers')
 * @param {Array} params.surfSpots - Array of surf spot data
 * @param {Array} params.livePhotographers - Array of live photographer data
 * @param {Set} params.pulsingMarkers - Set of photographer IDs currently pulsing
 * @param {Function} params.handleSpotClick - Callback for spot marker clicks
 * @param {Function} params.handlePhotographerClick - Callback for photographer marker clicks
 */
export const updateMapMarkers = ({
  map, markersRef, spotClusterRef, photographerClusterRef,
  filter, surfSpots, livePhotographers, pulsingMarkers,
  handleSpotClick, handlePhotographerClick
}) => {
  if (!map) return;

  try {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (spotClusterRef.current) spotClusterRef.current.clearLayers();
    if (photographerClusterRef.current) photographerClusterRef.current.clearLayers();

    // Add surf spot markers
    if ((filter === 'all' || filter === 'spots') && spotClusterRef.current) {
      const spotMarkers = [];
      surfSpots.forEach(spot => {
        if (!isValidLatLng(spot.latitude, spot.longitude)) return;
        const spotIcon = createSpotMarkerIcon(spot);
        const marker = window.L.marker(
          [truncateCoord(spot.latitude), truncateCoord(spot.longitude)], 
          { icon: spotIcon }
        ).on('click', () => handleSpotClick(spot));
        spotMarkers.push(marker);
      });
      spotClusterRef.current.addLayers(spotMarkers);
    }

    // Add photographer markers
    if ((filter === 'all' || filter === 'photographers') && photographerClusterRef.current) {
      const photographerMarkers = [];
      livePhotographers.forEach(photographer => {
        if (!isValidLatLng(photographer.latitude, photographer.longitude)) return;
        const isPulsing = pulsingMarkers.has(photographer.id);
        const photographerIcon = createPhotographerMarkerIcon(photographer, isPulsing);
        const marker = window.L.marker(
          [truncateCoord(photographer.latitude), truncateCoord(photographer.longitude)], 
          { icon: photographerIcon }
        ).on('click', () => handlePhotographerClick(photographer));
        photographerMarkers.push(marker);
      });
      photographerClusterRef.current.addLayers(photographerMarkers);
    }
  } catch (error) {
    console.error('[MAP] Error updating markers:', error);
  }
};
