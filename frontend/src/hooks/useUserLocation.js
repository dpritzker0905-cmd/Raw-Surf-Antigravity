import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';

/**
 * useUserLocation - SIMPLIFIED for reliability
 * 
 * Previous versions were too complex. This version:
 * - Uses ONE simple getCurrentPosition call
 * - Falls back to manual selection immediately on ANY error
 * - No progressive loading, no watchPosition, no complexity
 */

const CACHE_KEY = 'user_gps_location';
const CACHE_AGE = 5 * 60 * 1000; // 5 min

export const useUserLocation = () => {
  const [userLocation, setUserLocation] = useState(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const requestingRef = useRef(false);

  // Load cache on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { loc, time } = JSON.parse(cached);
        if (Date.now() - time < CACHE_AGE && loc?.lat && loc?.lng) {
          setUserLocation(loc);
        }
      }
    } catch (e) { /* localStorage unavailable - run without cache */ }
  }, []);

  // Save to cache
  const cache = useCallback((loc) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ loc, time: Date.now() }));
    } catch (e) { /* localStorage unavailable - skip cache write */ }
  }, []);

  /**
   * Request location - SIMPLE version
   * Returns Promise<location> or throws error
   */
  const requestLocation = useCallback(async () => {
    // Prevent double calls
    if (requestingRef.current) {
      return userLocation;
    }

    // Check support
    if (!navigator?.geolocation) {
      toast.error('GPS not supported');
      setLocationDenied(true);
      throw new Error('GPS not supported');
    }

    requestingRef.current = true;
    setGpsLoading(true);

    const toastId = toast.loading('Getting location...');

    try {
      // Simple promise wrapper
      const position = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout'));
        }, 10000);

        navigator.geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timeout);
            resolve(pos);
          },
          (err) => {
            clearTimeout(timeout);
            reject(err);
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
        );
      });

      // Validate position object exists
      if (!position || !position.coords) {
        throw new Error('Invalid position');
      }

      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const acc = position.coords.accuracy || 1000;

      // Validate coordinates
      if (typeof lat !== 'number' || typeof lng !== 'number' ||
          Number.isNaN(lat) || Number.isNaN(lng)) {
        throw new Error('Invalid coordinates');
      }

      const location = { lat, lng, accuracy: acc };
      
      setUserLocation(location);
      setLocationDenied(false);
      cache(location);

      toast.dismiss(toastId);
      toast.success(`Location found (${Math.round(acc)}m accuracy)`);

      return location;

    } catch (error) {
      toast.dismiss(toastId);
      setLocationDenied(true);

      const msg = error?.code === 1 ? 'Permission denied' :
                  error?.code === 2 ? 'Location unavailable' :
                  error?.code === 3 ? 'Timeout' : 
                  error?.message || 'GPS failed';

      toast.error('Could not get GPS', {
        description: msg + '. Use manual selection.',
      });

      throw error;

    } finally {
      setGpsLoading(false);
      requestingRef.current = false;
    }
  }, [userLocation, cache]);

  // Distance calculation
  const calculateDistance = useCallback((lat1, lng1, lat2, lng2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) ** 2 + 
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
              Math.sin(dLng/2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }, []);

  // Find nearest spot
  const findNearestSpot = useCallback((spots) => {
    if (!userLocation?.lat || !userLocation?.lng || !spots?.length) return null;
    
    let nearest = null;
    let minDist = Infinity;
    
    for (const spot of spots) {
      if (spot.latitude && spot.longitude) {
        const d = calculateDistance(userLocation.lat, userLocation.lng, spot.latitude, spot.longitude);
        if (d < minDist) {
          minDist = d;
          nearest = { ...spot, distance: d };
        }
      }
    }
    return nearest;
  }, [userLocation, calculateDistance]);

  // Dummy functions for compatibility
  const startWatchingLocation = useCallback(() => {}, []);
  const stopWatchingLocation = useCallback(() => {}, []);
  const attemptSilentLocation = useCallback(() => {}, []);

  return {
    userLocation,
    locationDenied,
    gpsLoading,
    requestLocation,
    findNearestSpot,
    calculateDistance,
    setUserLocation,
    setLocationDenied,
    startWatchingLocation,
    stopWatchingLocation,
    attemptSilentLocation
  };
};

export default useUserLocation;
