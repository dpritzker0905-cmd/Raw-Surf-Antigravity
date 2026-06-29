import { useState, useCallback, useEffect, useRef } from 'react';
import apiClient from '../lib/apiClient';
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
  const userLat = userLocation?.lat;
  const userLng = userLocation?.lng;

  const [surfSpots, setSurfSpots] = useState([]);
  const [surfSpotsGeoJSON, setSurfSpotsGeoJSON] = useState({ type: 'FeatureCollection', features: [] });
  
  const [livePhotographers, setLivePhotographers] = useState([]);
  const [livePhotographersGeoJSON, setLivePhotographersGeoJSON] = useState({ type: 'FeatureCollection', features: [] });
  
  const [featuredPhotographers, setFeaturedPhotographers] = useState([]);
  const [featuredPhotographersGeoJSON, setFeaturedPhotographersGeoJSON] = useState({ type: 'FeatureCollection', features: [] });
  
  const [loading, setLoading] = useState(true);

  // Helper to convert arrays to GeoJSON
  const toGeoJSON = (data, latKey = 'latitude', lngKey = 'longitude') => ({
    type: 'FeatureCollection',
    features: (Array.isArray(data) ? data : []).filter(item => item && item[latKey] && item[lngKey]).map(item => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [parseFloat(item[lngKey]), parseFloat(item[latKey])] },
      properties: { ...item }
    }))
  });

  // Live ref to the latest fetchSurfSpots so the retry timer can re-invoke it without a self-dependency.
  const fetchSurfSpotsRef = useRef(null);
  const fetchSurfSpots = useCallback(async (viewport = null, attempt = 0) => {
    // Backend cold-starts (Render) make this fetch transiently fail; the service worker then serves a STALE
    // cached spot list (or an {offline, data:[]} marker), which strands the map on the last region (the
    // "only Central FL spots show worldwide" report). So: retry with backoff on failure/offline-fallback,
    // and NEVER clobber a good spot list with an empty one — keep what we have until a real fetch succeeds.
    const RETRY_DELAYS = [1500, 3000, 6000, 12000];
    const retry = (err) => {
      if (attempt < RETRY_DELAYS.length) {
        // Recurse via a ref (not the callback itself) so this doesn't need to depend on itself.
        setTimeout(() => { if (fetchSurfSpotsRef.current) fetchSurfSpotsRef.current(viewport, attempt + 1); }, RETRY_DELAYS[attempt]);
      } else {
        logger.error('Error fetching surf spots (gave up after retries):', err);
      }
    };
    try {
      // Build query params for Privacy Shield geofencing
      const params = new URLSearchParams();

      if (userId) {
        params.append('user_id', userId);
      }

      if (userLat && userLng) {
        params.append('user_lat', userLat);
        params.append('user_lon', userLng);
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
      const payload = response.data;
      // SW no-cache offline response → cold-start, retry.
      if (payload && payload.offline) { retry(new Error('sw-offline-fallback')); return; }
      // SW served STALE cache (network failed). If we're actually online it's a transient cold-start — retry
      // so we don't get stuck on a stale spot list ("only Central FL spots"). If genuinely offline, accept it.
      const swStale = !!(response.headers && (response.headers['x-sw-cache-fallback'] || response.headers['X-SW-Cache-Fallback']));
      const isOnline = (typeof navigator === 'undefined') || navigator.onLine !== false;
      if (swStale && isOnline) { retry(new Error('sw-stale-coldstart')); return; }
      const data = Array.isArray(payload) ? payload : [];
      // An empty GLOBAL load (no viewport ⇒ there are always spots) is also a transient cold-start.
      if (data.length === 0 && !viewport) { retry(new Error('empty-global-spots')); return; }
      setSurfSpots(data);
      setSurfSpotsGeoJSON(toGeoJSON(data));
    } catch (error) {
      retry(error);   // network error (cold-start) — keep current spots + retry
    }
  }, [userId, userLat, userLng]);
  fetchSurfSpotsRef.current = fetchSurfSpots;

  const fetchLivePhotographers = useCallback(async () => {
    try {
      const response = await apiClient.get(`/live-photographers`);
      const data = Array.isArray(response.data) ? response.data : [];
      setLivePhotographers(data);
      setLivePhotographersGeoJSON(toGeoJSON(data));
    } catch (error) {
      logger.error('Error fetching live photographers:', error);
    }
  }, []);

  const fetchFeaturedPhotographers = useCallback(async () => {
    try {
      const response = await apiClient.get(`/photographers/featured`);
      const data = Array.isArray(response.data) ? response.data : [];
      setFeaturedPhotographers(data);
      setFeaturedPhotographersGeoJSON(toGeoJSON(data));
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
    surfSpotsGeoJSON,
    livePhotographers,
    livePhotographersGeoJSON,
    featuredPhotographers,
    featuredPhotographersGeoJSON,
    loading,
    refreshData: loadMapData,
    fetchLivePhotographers,
    fetchSurfSpots,
  };
};

export default useMapData;
