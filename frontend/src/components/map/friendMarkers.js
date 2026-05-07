/**
 * Friend Markers Manager
 * Handles rendering friend location markers on the Leaflet map.
 * Extracted from MapPage.js (v68)
 */

/**
 * Update friend markers on the map.
 * Clears existing markers and re-renders based on current friend data.
 *
 * @param {Object} params
 * @param {Object} params.mapInstance - Leaflet map instance
 * @param {Object} params.friendMarkersRef - Ref holding current friend marker array
 * @param {Array} params.friendsOnMap - Array of friend objects with lat/lng
 * @param {boolean} params.showFriendsOnMap - Whether friend markers are toggled on
 */
export const updateFriendMarkers = ({ mapInstance, friendMarkersRef, friendsOnMap, showFriendsOnMap }) => {
  if (!mapInstance || !window.L) return;

  // Clear existing friend markers
  friendMarkersRef.current.forEach(m => m.remove());
  friendMarkersRef.current = [];

  if (!showFriendsOnMap || friendsOnMap.length === 0) return;

  friendsOnMap.forEach(friend => {
    if (!friend.latitude || !friend.longitude) return;

    const friendIcon = window.L.divIcon({
      className: 'custom-marker friend-marker',
      html: `
        <div class="relative">
          <div class="absolute inset-0 w-10 h-10 rounded-full bg-yellow-400 animate-pulse opacity-30"></div>
          <div class="relative w-10 h-10 rounded-full p-[2px] bg-gradient-to-r from-yellow-400 to-orange-400">
            <div class="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
              ${friend.avatar_url 
                ? `<img loading="lazy" decoding="async" src="${friend.avatar_url}" alt="${friend.full_name || 'Friend'} avatar" class="w-full h-full object-cover" />`
                : `<span class="text-sm text-yellow-400 font-bold">${friend.full_name?.charAt(0) || '?'}</span>`
              }
            </div>
          </div>
          <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-yellow-400 rounded text-[8px] text-black font-bold whitespace-nowrap">
            ${friend.is_shooting ? 'LIVE' : 'FRIEND'}
          </div>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 40]
    });

    const marker = window.L.marker([friend.latitude, friend.longitude], { icon: friendIcon })
      .addTo(mapInstance)
      .bindPopup(`
        <div class="text-center p-2">
          <p class="font-bold text-sm">${friend.full_name}</p>
          <p class="text-xs text-gray-500">${friend.role}</p>
          ${friend.is_shooting ? '<p class="text-xs text-emerald-500 font-bold">Currently Shooting</p>' : ''}
        </div>
      `);

    friendMarkersRef.current.push(marker);
  });
};
