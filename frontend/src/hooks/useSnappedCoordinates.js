import { useMemo, useCallback } from 'react';

export function useSnappedCoordinates({ selectedSpot, longPressLocation, userLocation, mapCenter, ipLocation, surfSpots }) {
  const findNearestSpotToCoord = useCallback((lat, lng) => {
    if (lat == null || lng == null || !surfSpots?.length) return null;
    let nearest = null;
    let minDist = Infinity;
    for (const spot of surfSpots) {
      if (spot.latitude != null && spot.longitude != null) {
        const d = Math.pow(spot.latitude - lat, 2) + Math.pow(spot.longitude - lng, 2);
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
    if (mapCenter?.lat != null && mapCenter?.lng != null) {
      const nearest = findNearestSpotToCoord(mapCenter.lat, mapCenter.lng);
      if (nearest) return { lat: nearest.latitude, lng: nearest.longitude, source: 'center_snapped', name: nearest.name };
    }
    if (ipLocation?.lat != null && ipLocation?.lng != null) {
      const nearest = findNearestSpotToCoord(ipLocation.lat, ipLocation.lng);
      if (nearest) return { lat: nearest.latitude, lng: nearest.longitude, source: 'ip_snapped', name: nearest.name };
    }
    return { lat: 37.4984, lng: -122.4975, source: 'fallback_mavericks', name: 'Mavericks' };
  }, [selectedSpot, longPressLocation, userLocation, mapCenter, ipLocation, surfSpots, findNearestSpotToCoord]);

  return { snappedCoordinates, findNearestSpotToCoord };
}
