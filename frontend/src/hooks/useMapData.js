import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
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
  // Surfaced to callers so a dead /surf-spots is VISIBLE. Before this, exhausting the retry ladder
  // only wrote to logger.error -- the user sat on a silently stale or empty map with no error state
  // and no reason to reload.
  const [spotsError, setSpotsError] = useState(null);
  // Toast only on the ok -> failed EDGE. This fetch also runs on a 30s poll, so an unguarded toast
  // would fire every half-minute for as long as the outage lasted.
  const spotsFailedRef = useRef(false);

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
    // Was [1500, 3000, 6000, 12000] -- 4 retries, ~22.5s of silent retrying, on top of a then-60s
    // per-request timeout. That ladder was sized for a Render free-tier idle wake that does not
    // happen (paid plan). Two retries covers a deploy-window restart, which is the real transient.
    const RETRY_DELAYS = [1500, 4000];
    const retry = (err) => {
      if (attempt < RETRY_DELAYS.length) {
        // Recurse via a ref (not the callback itself) so this doesn't need to depend on itself.
        setTimeout(() => { if (fetchSurfSpotsRef.current) fetchSurfSpotsRef.current(viewport, attempt + 1); }, RETRY_DELAYS[attempt]);
        return;
      }
      // Exhausted. This used to end at logger.error, so a broken /surf-spots looked identical to a
      // working one: the map kept whatever spots it had (or none) and said nothing. Fail LOUDLY --
      // the stale-spot bug this ladder exists for ("only Central FL spots show worldwide") is
      // precisely the kind that is invisible unless we say so.
      logger.error('Error fetching surf spots (gave up after retries):', err);
      setSpotsError(err);
      if (!spotsFailedRef.current) {
        spotsFailedRef.current = true;
        toast.error("Couldn't load surf spots. The map may be incomplete or out of date.", {
          id: 'surf-spots-error',
          duration: 8000,
        });
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
      // Recovered (or never broken): clear the error and re-arm the edge so a LATER outage toasts.
      setSpotsError(null);
      spotsFailedRef.current = false;
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
    // ⭐⭐ THE SPLASH SAYS "Finding surf spots near you" — SO GATE IT ON THE SPOTS, NOT ON THE
    // PHOTOGRAPHER OVERLAYS. This was `Promise.all` of all three, so a slow `/live-photographers`
    // or `/photographers/featured` held the ENTIRE map behind `WaveLoader` for as long as it took —
    // up to `apiClient`'s own 60 s timeout — even though both are decorative overlays that render
    // independently the moment their state arrives. The map had everything it needed and showed a
    // loading screen anyway.
    // ⚠️ Found via the E2E gate at `weather-simulation.spec.js:358`, which times out waiting for a
    // map control while the page sits on that splash. Measured 2026-08-07: all three endpoints are
    // 0.7-3.1 s warm and an isolated /map load reaches the controls in 1.9-3.1 s over 6 of 6 runs —
    // so this is not about their normal cost. It is that ANY ONE of three stalling blocks the map,
    // which makes the exposed surface three times larger than it needs to be.
    // All three helpers swallow their own errors, so neither promise below can reject.
    const overlays = Promise.all([fetchLivePhotographers(), fetchFeaturedPhotographers()]);
    await fetchSurfSpots(viewport);
    setLoading(false);   // the map is usable the moment its SPOTS exist
    await overlays;      // still awaited, so callers keep the old completion contract
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
    spotsError,
    refreshData: loadMapData,
    fetchLivePhotographers,
    fetchSurfSpots,
  };
};

export default useMapData;
