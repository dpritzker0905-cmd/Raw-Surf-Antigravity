import { useMemo, useCallback } from 'react';

/**
 * Calculates the Haversine distance between two coordinates in kilometers.
 * Clamps the intermediate dot product to [0, 1] to prevent NaN values
 * due to floating-point rounding errors for antipodal points.
 */
export function calculateHaversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const clampedA = Math.max(0, Math.min(1, a));
  return R * 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
}

export function useSnappedCoordinates({ selectedSpot, longPressLocation, userLocation, mapCenter, ipLocation, surfSpots }) {
  const findNearestSpotToCoord = useCallback((lat, lng) => {
    if (
      lat == null || lng == null || 
      isNaN(lat) || isNaN(lng) || 
      !isFinite(lat) || !isFinite(lng) || 
      !surfSpots?.length
    ) {
      return null;
    }
    let nearest = null;
    let minDist = Infinity;
    for (const spot of surfSpots) {
      if (
        spot.latitude != null && spot.longitude != null &&
        !isNaN(spot.latitude) && !isNaN(spot.longitude) &&
        isFinite(spot.latitude) && isFinite(spot.longitude)
      ) {
        const d = calculateHaversineDistance(lat, lng, spot.latitude, spot.longitude);
        if (d < minDist) {
          minDist = d;
          nearest = spot;
        }
      }
    }
    return nearest;
  }, [surfSpots]);

  const snappedCoordinates = useMemo(() => {
    if (selectedSpot?.latitude != null && selectedSpot?.longitude != null) {
      return { lat: selectedSpot.latitude, lng: selectedSpot.longitude, source: 'spot' };
    }
    if (longPressLocation?.lat != null && longPressLocation?.lng != null) {
      return { lat: longPressLocation.lat, lng: longPressLocation.lng, source: 'long_press' };
    }
    if (userLocation?.lat != null && userLocation?.lng != null) {
      const nearest = findNearestSpotToCoord(userLocation.lat, userLocation.lng);
      if (nearest) return { lat: nearest.latitude, lng: nearest.longitude, source: 'gps_snapped', name: nearest.name };
    }
    return null;
  }, [selectedSpot, longPressLocation, userLocation, surfSpots, findNearestSpotToCoord]);

  return { snappedCoordinates, findNearestSpotToCoord };
}

