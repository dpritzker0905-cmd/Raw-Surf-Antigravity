/**
 * Marker Icon Factory
 * Creates Leaflet DivIcon markers for the map
 * Extracted from MapPage.js for better organization
 */


/**
 * Create user location marker icon
 * @param {Object} options - Marker options
 * @param {number} options.accuracy - GPS accuracy in meters
 * @param {boolean} options.isIPLocation - Whether this is an IP-based location
 * @param {string} options.city - City name for IP location
 */
export const createUserLocationIcon = ({ accuracy, isIPLocation, city }) => {
  let markerColor = 'bg-blue-500';
  let pingColor = 'bg-blue-500';
  let statusText = '';
  
  if (isIPLocation) {
    markerColor = 'bg-orange-500';
    pingColor = 'bg-orange-500';
    statusText = `~${city || 'Approx'}`;
  } else if (accuracy) {
    if (accuracy > 1000) {
      markerColor = 'bg-red-500';
      pingColor = 'bg-red-500';
      statusText = `~${(accuracy/1000).toFixed(1)}km`;
    } else if (accuracy > 500) {
      markerColor = 'bg-orange-500';
      pingColor = 'bg-orange-500';
      statusText = `~${Math.round(accuracy)}m`;
    } else if (accuracy > 100) {
      markerColor = 'bg-yellow-500';
      pingColor = 'bg-yellow-400';
    }
  }
  
  return {
    className: 'custom-marker',
    html: `
      <div class="relative">
        <div class="absolute inset-0 w-6 h-6 rounded-full ${pingColor} animate-ping opacity-30"></div>
        <div class="w-6 h-6 rounded-full ${markerColor} border-2 border-white flex items-center justify-center shadow-lg">
          <div class="w-2 h-2 bg-white rounded-full"></div>
        </div>
        ${statusText ? `
          <div class="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[8px] ${markerColor === 'bg-red-500' ? 'text-red-400' : 'text-orange-400'} whitespace-nowrap font-medium bg-zinc-900/80 px-1 rounded">
            ${statusText}
          </div>
        ` : ''}
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    // Return these for popup content
    _meta: { markerColor, accuracy, isIPLocation, city }
  };
};

/**
 * Create surf spot marker icon
 * @param {Object} spot - Spot data
 * @param {boolean} spot.is_within_geofence - Privacy shield status
 * @param {number} spot.active_photographers_count - Active photographers
 * @param {number} spot.distance_miles - Distance from user
 */
export const createSpotIcon = (spot) => {
  const hasPhotographers = spot.active_photographers_count > 0;
  const isWithinGeofence = spot.is_within_geofence !== false;
  
  return {
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
          ` : hasPhotographers ? `
            <svg class="w-4 h-4 text-black" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
            </svg>
          ` : `
            <svg class="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.6 11.4c-.1-.1-.2-.1-.3-.2-1.3-.7-2.2-1.1-3.3-1.7-1.1-.6-2-1.2-2-2.5s.9-2.5 2-2.5c.4 0 .7.1 1 .3-.3-.9-1.2-1.5-2.3-1.5-1.4 0-2.5 1.2-2.5 2.7s.9 2.8 2.3 3.5c1.1.6 2.2 1.1 3.4 1.8.8.5 1.4 1.3 1.4 2.2 0 .7-.3 1.4-.8 1.9-.5.5-1.2.8-2 .8-.5 0-1-.1-1.4-.4.3 1 1.3 1.7 2.5 1.7 1.5 0 2.8-1.3 2.8-3 0-1.2-.7-2.3-1.8-3.1z"/>
            </svg>
          `}
        </div>
        ${hasPhotographers && isWithinGeofence ? `
          <div class="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center text-white text-[8px] font-bold border border-white">
            ${spot.active_photographers_count}
          </div>
        ` : ''}
        ${!isWithinGeofence && spot.distance_miles ? `
          <div class="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[7px] text-gray-500 whitespace-nowrap">
            ${spot.distance_miles.toFixed(1)}mi
          </div>
        ` : ''}
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  };
};

/**
 * Create photographer marker icon
 * @param {Object} photographer - Photographer data
 */
export const createPhotographerIcon = (photographer) => {
  return {
    className: 'custom-marker photographer-marker',
    html: `
      <div class="relative">
        <div class="absolute inset-0 w-12 h-12 rounded-full bg-cyan-400 animate-ping opacity-30"></div>
        <div class="w-12 h-12 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 p-0.5">
          <div class="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center overflow-hidden">
            ${photographer.avatar_url 
              ? `<img src="${photographer.avatar_url}" class="w-full h-full object-cover" alt="${photographer.full_name}" />`
              : `<span class="text-cyan-400 font-bold">${photographer.full_name?.charAt(0) || 'P'}</span>`
            }
          </div>
        </div>
        <div class="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-cyan-500 rounded text-[9px] text-white font-bold whitespace-nowrap">
          LIVE
        </div>
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24]
  };
};

/**
 * Get priority colors for on-demand request markers
 * @param {Object} badge - Priority badge info
 * @param {boolean} isBoosted - Whether request is boosted
 */
export const getPriorityColors = (badge, isBoosted) => {
  if (isBoosted) {
    return { gradient: 'from-orange-400 to-red-500', shadow: 'orange', bg: 'orange', ring: 'ring-orange-400' };
  }
  
  switch (badge?.level) {
    case 'pro':
      return { gradient: 'from-yellow-400 to-amber-600', shadow: 'amber', bg: 'amber', ring: 'ring-yellow-400' };
    case 'comp':
      return { gradient: 'from-purple-400 to-violet-600', shadow: 'violet', bg: 'purple', ring: 'ring-purple-400' };
    default:
      return { gradient: 'from-cyan-400 to-blue-600', shadow: 'cyan', bg: 'cyan', ring: 'ring-cyan-400' };
  }
};

/**
 * Create cluster icon for spot clusters
 * @param {number} count - Number of items in cluster
 */
export const createSpotClusterIcon = (count) => {
  return {
    className: 'custom-cluster-marker',
    html: `
      <div class="w-10 h-10 rounded-full bg-gradient-to-r from-emerald-400 to-yellow-400 flex items-center justify-center shadow-lg">
        <span class="text-black font-bold text-sm">${count}</span>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  };
};

/**
 * Create cluster icon for photographer clusters
 * @param {number} count - Number of items in cluster
 */
export const createPhotographerClusterIcon = (count) => {
  return {
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
  };
};

/**
 * Create friend marker icon
 * @param {Object} friend - Friend data
 */
export const createFriendIcon = (friend) => {
  return {
    className: 'custom-marker friend-marker',
    html: `
      <div class="relative">
        <div class="absolute inset-0 w-10 h-10 rounded-full bg-purple-400 animate-ping opacity-20"></div>
        <div class="w-10 h-10 rounded-full bg-gradient-to-r from-purple-400 to-pink-500 p-0.5">
          <div class="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center overflow-hidden">
            ${friend.avatar_url 
              ? `<img src="${friend.avatar_url}" class="w-full h-full object-cover" />`
              : `<span class="text-purple-400 font-bold">${friend.full_name?.charAt(0) || '?'}</span>`
            }
          </div>
        </div>
        <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-purple-500 rounded text-[8px] text-white font-medium whitespace-nowrap">
          ${friend.full_name?.split(' ')[0] || 'Friend'}
        </div>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  };
};
