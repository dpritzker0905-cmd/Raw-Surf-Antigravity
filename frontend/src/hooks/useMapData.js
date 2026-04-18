import { useState, useCallback, useEffect } from 'react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';


/**
 * useMapData - Custom hook for fetching map data with Privacy Shield support
 * 
 * Manages:
 * - Surf spots with geofencing
 * - Live photographers
 * - Featured photographers
 * - Auto-refresh polling
 */
export const useMapData = (userId = null, userLocation = null) => {
  const [surfSpots, setSurfSpots] = useState([]);
  const [livePhotographers, setLivePhotographers] = useState([]);
  const [featuredPhotographers, setFeaturedPhotographers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchSurfSpots = useCallback(async (viewport = null) => {
    try {
      // Build query params for Privacy Shield geofencing
      const params = new URLSearchParams();
      
      if (userId) {
        params.append('user_id', userId);
      }
      
      if (userLocation?.lat && userLocation?.lng) {
        params.append('user_lat', userLocation.lat);
        params.append('user_lon', userLocation.lng);
      }
      
      // Viewport filtering for performance
      if (viewport) {
        params.append('viewport_only', 'true');
        params.append('min_lat', viewport.minLat);
        params.append('max_lat', viewport.maxLat);
        params.append('min_lon', viewport.minLng);
        params.append('max_lon', viewport.maxLng);
      }
      
      const url = `/surf-spots${params.toString() ? '?' + params.toString() : ''}`;
      const response = await apiClient.get(url);
      setSurfSpots(response.data);
    } catch (error) {
      logger.error('Error fetching surf spots:', error);
    }
  }, [userId, userLocation]);

  const fetchLivePhotographers = useCallback(async () => {
    try {
      const response = await apiClient.get(`/live-photographers`);
      setLivePhotographers(response.data);
    } catch (error) {
      logger.error('Error fetching live photographers:', error);
    }
  }, []);

  const fetchFeaturedPhotographers = useCallback(async () => {
    try {
      const response = await apiClient.get(`/photographers/featured`);
      setFeaturedPhotographers(response.data);
    } catch (error) {
      logger.error('Error fetching featured photographers:', error);
    }
  }, []);

  const loadMapData = useCallback(async (viewport = null) => {
    setLoading(true);
    await Promise.all([
      fetchSurfSpots(viewport),
      fetchLivePhotographers(),
      fetchFeaturedPhotographers()
    ]);
    setLoading(false);
  }, [fetchSurfSpots, fetchLivePhotographers, fetchFeaturedPhotographers]);

  // Initial load and auto-refresh
  useEffect(() => {
    loadMapData();
    
    // Refresh live photographers and surf spots every 30 seconds
    const interval = setInterval(() => {
      fetchLivePhotographers();
      fetchSurfSpots();
    }, 30000);
    
    return () => clearInterval(interval);
  }, [loadMapData, fetchLivePhotographers, fetchSurfSpots]);

  return {
    surfSpots,
    livePhotographers,
    featuredPhotographers,
    loading,
    refreshData: loadMapData,
    fetchLivePhotographers,
    fetchSurfSpots,
  };
};

export default useMapData;
