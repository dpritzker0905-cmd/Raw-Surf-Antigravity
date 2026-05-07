/**
 * On-Demand Request Markers Manager
 * Handles rendering on-demand surfer request markers on the Leaflet map.
 * Extracted from MapPage.js (v68)
 */

/**
 * Get priority-based colors for on-demand request markers.
 * @param {Object|null} badge - Priority badge object
 * @param {boolean} isBoosted - Whether the request is boosted
 * @returns {Object} Color config with gradient, shadow, bg, ring properties
 */
const getPriorityColors = (badge, isBoosted) => {
  if (isBoosted) return { gradient: 'from-orange-400 to-red-600', shadow: 'orange', bg: 'orange', ring: 'ring-orange-400' };
  if (!badge) return { gradient: 'from-emerald-400 to-green-600', shadow: 'emerald', bg: 'emerald' };

  switch (badge.level) {
    case 'boosted':
      return { gradient: 'from-orange-400 to-red-600', shadow: 'orange', bg: 'orange', ring: 'ring-orange-400' };
    case 'pro':
      return { gradient: 'from-yellow-400 to-amber-600', shadow: 'amber', bg: 'amber', ring: 'ring-yellow-400' };
    case 'comp':
      return { gradient: 'from-purple-400 to-violet-600', shadow: 'violet', bg: 'purple', ring: 'ring-purple-400' };
    default:
      return { gradient: 'from-cyan-400 to-blue-600', shadow: 'cyan', bg: 'cyan', ring: 'ring-cyan-400' };
  }
};

/**
 * Get the SVG badge icon for a priority level.
 */
const getBadgeIcon = (isBoosted, badge, colors) => {
  if (isBoosted) return `<svg class="w-3 h-3 text-orange-400" fill="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"/><path d="M12 2v14"/></svg>`;
  if (badge.level === 'pro') return `<svg class="w-3 h-3 text-${colors.bg}-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L14.09 8.26L21 9.27L16 14.14L17.18 21.02L12 17.77L6.82 21.02L8 14.14L3 9.27L9.91 8.26L12 2Z"/></svg>`;
  if (badge.level === 'comp') return `<svg class="w-3 h-3 text-${colors.bg}-400" fill="currentColor" viewBox="0 0 24 24"><path d="M17 10.43V3H7v7.43c0 .35.18.68.49.86l4.18 2.51-.99 2.34-3.41.29 2.59 2.24L9.07 22 12 20.23 14.93 22l-.79-3.33 2.59-2.24-3.41-.29-.99-2.34 4.18-2.51c.3-.18.49-.51.49-.86z"/></svg>`;
  return `<svg class="w-3 h-3 text-${colors.bg}-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;
};

/**
 * Update on-demand request markers on the map.
 * Clears existing markers and re-renders based on active requests.
 *
 * @param {Object} params
 * @param {Object} params.mapInstance - Leaflet map instance
 * @param {Object} params.onDemandMarkersRef - Ref holding current on-demand marker array
 * @param {Array} params.activeOnDemandRequests - Array of active on-demand request objects
 * @param {boolean} params.isPhotographer - Whether current user is a photographer
 */
export const updateOnDemandMarkers = ({ mapInstance, onDemandMarkersRef, activeOnDemandRequests, isPhotographer }) => {
  if (!mapInstance || !isPhotographer) return;

  // Clear existing on-demand markers
  onDemandMarkersRef.current.forEach(m => m.remove());
  onDemandMarkersRef.current = [];

  if (!activeOnDemandRequests || activeOnDemandRequests.length === 0) return;

  activeOnDemandRequests.forEach((request, index) => {
    if (!request.latitude || !request.longitude) return;

    const isBoosted = request.is_boosted;
    const badge = request.priority_badge || { level: 'regular', label: 'Surfer', color: 'cyan' };
    const colors = getPriorityColors(badge, isBoosted);
    const queuePosition = index + 1;
    const badgeIcon = getBadgeIcon(isBoosted, badge, colors);

    const onDemandIcon = window.L.divIcon({
      className: 'custom-marker on-demand-marker',
      html: `
        <div class="relative">
          <div class="absolute inset-0 w-14 h-14 -top-1 -left-1 rounded-full bg-${colors.bg}-400 animate-ping opacity-40"></div>
          <div class="absolute inset-0 w-12 h-12 rounded-full bg-${colors.bg}-500 animate-pulse opacity-30"></div>
          <div class="absolute -top-2 -right-2 z-10 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-${colors.bg}-500/90 text-white text-[8px] font-bold shadow-md ${isBoosted || badge.level === 'pro' ? 'animate-pulse' : ''}">
            ${badgeIcon}
            ${isBoosted ? '\u{1F680}' : badge.level === 'pro' ? 'PRO' : badge.level === 'comp' ? 'COMP' : ''}
          </div>
          ${isBoosted ? `
            <div class="absolute -top-2 -left-2 z-10 px-1.5 py-0.5 rounded-full bg-orange-500 text-white text-[8px] font-bold shadow-md animate-pulse">
              ${request.boost_time_remaining_minutes || 0}m
            </div>
          ` : badge.level === 'pro' ? `
            <div class="absolute -top-2 -left-2 z-10 w-5 h-5 rounded-full bg-yellow-500 text-black text-[10px] font-bold flex items-center justify-center shadow-md">
              ${queuePosition}
            </div>
          ` : ''}
          <div class="relative w-12 h-12 rounded-full bg-gradient-to-br ${colors.gradient} p-[3px] shadow-lg shadow-${colors.shadow}-500/50">
            <div class="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
              ${request.requester_avatar 
                ? `<img loading="lazy" decoding="async" src="${request.requester_avatar}" alt="${request.requester_name || 'Requester'} avatar" class="w-full h-full object-cover" />`
                : `<span class="text-${colors.bg}-400 text-lg font-bold">${request.requester_name?.charAt(0) || 'S'}</span>`
              }
            </div>
          </div>
          <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-${colors.bg}-500 rounded text-[9px] text-white font-bold whitespace-nowrap animate-pulse">
            ${isBoosted ? 'BOOSTED \u{1F680}' : 'NEEDS PRO'}
          </div>
        </div>
      `,
      iconSize: [48, 56],
      iconAnchor: [24, 56]
    });

    const popupBgColor = isBoosted ? '#ea580c' : (badge.color === 'yellow' ? '#eab308' : badge.color === 'purple' ? '#a855f7' : '#06b6d4');
    const popupTextColor = isBoosted ? '#c2410c' : (badge.color === 'yellow' ? '#ca8a04' : badge.color === 'purple' ? '#9333ea' : '#0891b2');

    const marker = window.L.marker([request.latitude, request.longitude], { icon: onDemandIcon })
      .addTo(mapInstance)
      .bindPopup(`
        <div class="text-center p-2 min-w-[150px]">
          <div class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full mb-2" style="background: ${popupBgColor}">
            <span class="text-[10px] font-bold text-white">${isBoosted ? 'BOOSTED \u{1F680}' : badge.label.toUpperCase()}</span>
          </div>
          
          <p class="font-bold text-sm" style="color: ${popupTextColor}">${request.requester_name}</p>
          <p class="text-xs text-gray-500">Looking for a Pro</p>
          <p class="text-xs text-gray-400 mt-1">${request.location_name || 'Nearby'}</p>
          <p class="text-xs font-medium mt-1" style="color: ${badge.color === 'yellow' ? '#ca8a04' : badge.color === 'purple' ? '#9333ea' : '#0891b2'}">${request.estimated_duration}h session</p>
          ${badge.level === 'pro' ? '<p class="text-[10px] font-bold text-yellow-600 mt-2">? PRIORITY REQUEST</p>' : ''}
        </div>
      `);

    onDemandMarkersRef.current.push(marker);
  });
};
