/**
 * useIPGeolocation - IP-based location fallback when GPS is denied
 * Features:
 * - Coastal Snap: Snaps inland IP locations to nearest coastline
 * - City Migration: Detects when user moves to a new city
 * - Session Persistence: Stores last known city for comparison
 */
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const LAST_CITY_KEY = 'rawsurf_last_known_city';
const LAST_COORDS_KEY = 'rawsurf_last_known_coords';

export const useIPGeolocation = () => {
  const [ipLocation, setIpLocation] = useState(null);
  const [ipLoading, setIpLoading] = useState(false);
  const [ipError, setIpError] = useState(null);
  const [cityChanged, setCityChanged] = useState(false);
  const [coastalSnapped, setCoastalSnapped] = useState(false);

  /**
   * Get stored last known city from localStorage
   */
  const getLastKnownCity = useCallback(() => {
    try {
      return localStorage.getItem(LAST_CITY_KEY);
    } catch {
      return null;
    }
  }, []);

  /**
   * Store current city to localStorage
   */
  const storeCity = useCallback((city, lat, lng) => {
    try {
      localStorage.setItem(LAST_CITY_KEY, city);
      localStorage.setItem(LAST_COORDS_KEY, JSON.stringify({ lat, lng }));
    } catch (e) {
      logger.warn('Could not store city to localStorage:', e);
    }
  }, []);

  /**
   * Fetch IP-based geolocation with coastal snap support
   * @param {boolean} forceRefresh - Force recalibration even if cached
   */
  const fetchIPLocation = useCallback(async (forceRefresh = false) => {
    setIpLoading(true);
    setIpError(null);
    
    try {
      const lastCity = forceRefresh ? null : getLastKnownCity();
      
      const response = await axios.get(`${API}/location/ip-geolocation`, {
        params: {
          coastal_snap: true,
          last_city: lastCity
        }
      });
      
      if (response.data.success && response.data.latitude && response.data.longitude) {
        const data = response.data;
        
        // CRITICAL: Validate coordinates are valid numbers
        const lat = parseFloat(data.latitude);
        const lng = parseFloat(data.longitude);
        
        if (isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) {
          logger.error('[IP-GEO] Invalid coordinates from API:', data.latitude, data.longitude);
          setIpError('Invalid coordinates from IP geolocation');
          return null;
        }
        
        // Validate coordinate ranges
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          logger.error('[IP-GEO] Coordinates out of range:', lat, lng);
          setIpError('Coordinates out of valid range');
          return null;
        }
        
        const location = {
          lat: lat,
          lng: lng,
          originalLat: parseFloat(data.original_latitude) || lat,
          originalLng: parseFloat(data.original_longitude) || lng,
          city: data.city,
          region: data.region,
          country: data.country,
          accuracy: data.accuracy || 'city',
          source: 'ip',
          isCoastal: data.is_coastal,
          coastalSnapped: data.coastal_snapped,
          snapInfo: data.snap_info,
          cityChanged: data.city_changed,
          previousCity: data.previous_city,
          migrationDetected: data.migration_detected
        };
        
        logger.debug(`[IP-GEO] Valid location: ${lat.toFixed(4)}, ${lng.toFixed(4)} (${data.city})`);
        
        setIpLocation(location);
        setCityChanged(data.city_changed || false);
        setCoastalSnapped(data.coastal_snapped || false);
        
        // CACHE PURGE: If city changed, clear all location-based caches
        // This prevents "Ghost Activity" from previous location
        if (data.city_changed || data.migration_detected) {
          logger.debug(`[IP-SYNC] City migration detected: ${data.previous_city} -> ${data.city}`);
          purgeLocationCache();
        }
        
        // Store current city for future migration detection
        if (data.city) {
          storeCity(data.city, data.latitude, data.longitude);
        }
        
        return location;
      } else {
        setIpError('IP geolocation unavailable');
        return null;
      }
    } catch (error) {
      logger.error('IP geolocation error:', error);
      setIpError(error.message);
      return null;
    } finally {
      setIpLoading(false);
    }
  }, [getLastKnownCity, storeCity]);

  /**
   * Force recalibration - used when user manually requests location update
   * (e.g., "Use Current IP Location" button)
   */
  const forceRecalibrate = useCallback(async () => {
    return fetchIPLocation(true);
  }, [fetchIPLocation]);

  /**
   * Clear stored city data
   */
  const clearStoredCity = useCallback(() => {
    try {
      localStorage.removeItem(LAST_CITY_KEY);
      localStorage.removeItem(LAST_COORDS_KEY);
    } catch {
      // Ignore errors
    }
  }, []);

  /**
   * Purge all location-based caches when city changes
   * Prevents "Ghost Activity" from previous location showing in drawer
   */
  const purgeLocationCache = useCallback(() => {
    try {
      // Clear spot-related caches
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.includes('spot_') ||
          key.includes('nearby_') ||
          key.includes('activity_') ||
          key.includes('photographer_') ||
          key.includes('geofence_')
        )) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      // Also clear session storage
      sessionStorage.clear();
      
      logger.debug(`[CACHE-PURGE] Cleared ${keysToRemove.length} location cache entries`);
    } catch (e) {
      logger.warn('Cache purge error:', e);
    }
  }, []);

  // Auto-fetch on mount (Session Geo-Sync)
  useEffect(() => {
    fetchIPLocation();
  }, [fetchIPLocation]);

  return {
    // Location data
    ipLocation,
    ipLoading,
    ipError,
    
    // Coastal snap info
    coastalSnapped,
    
    // City migration
    cityChanged,
    
    // Actions
    refetchIPLocation: fetchIPLocation,
    forceRecalibrate,
    clearStoredCity
  };
};

export default useIPGeolocation;
