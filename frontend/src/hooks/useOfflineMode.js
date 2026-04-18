/**
 * useOfflineMode - React hook for managing offline spot data
 * 
 * Features:
 * - Detect online/offline status
 * - Cache spot data for offline access
 * - Auto-sync based on location and favorite spots
 * - Sync when back online
 * - LocalStorage fallback for older browsers
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';

const SPOTS_STORAGE_KEY = 'rawsurf_cached_spots';
const NEARBY_SPOTS_KEY = 'rawsurf_nearby_spots';
const FAVORITE_SPOTS_KEY = 'rawsurf_favorite_spots';
const CACHE_TIMESTAMP_KEY = 'rawsurf_spots_cache_time';
const AUTO_SYNC_KEY = 'rawsurf_auto_sync_enabled';

export const useOfflineMode = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [spotsCached, setSpotsCached] = useState(false);
  const [nearbyCached, setNearbyCached] = useState(false);
  const [cacheTimestamp, setCacheTimestamp] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [lastSyncLocation, setLastSyncLocation] = useState(null);
  const locationWatchRef = useRef(null);

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      logger.debug('[OfflineMode] Back online');
      // Auto-sync when back online if enabled
      if (autoSyncEnabled) {
        syncNearbySpots();
      }
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      logger.debug('[OfflineMode] Gone offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check existing cache and settings
    checkCacheStatus();
    loadAutoSyncSetting();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (locationWatchRef.current) {
        navigator.geolocation.clearWatch(locationWatchRef.current);
      }
    };
  }, []);

  // Load auto-sync setting from localStorage
  const loadAutoSyncSetting = useCallback(() => {
    const saved = localStorage.getItem(AUTO_SYNC_KEY);
    if (saved === 'true') {
      setAutoSyncEnabled(true);
      startLocationTracking();
    }
  }, []);

  // Check if spots are cached in localStorage
  const checkCacheStatus = useCallback(() => {
    const cachedSpots = localStorage.getItem(SPOTS_STORAGE_KEY);
    const nearbySpots = localStorage.getItem(NEARBY_SPOTS_KEY);
    const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    
    if (cachedSpots && timestamp) {
      setSpotsCached(true);
      setCacheTimestamp(new Date(parseInt(timestamp)));
    } else {
      setSpotsCached(false);
      setCacheTimestamp(null);
    }
    
    setNearbyCached(!!nearbySpots);
  }, []);

  // Start location tracking for auto-sync
  const startLocationTracking = useCallback(() => {
    if (!navigator.geolocation) return;
    
    // Watch position for significant changes
    locationWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const newLocation = { lat: latitude, lng: longitude };
        
        // Check if we've moved significantly (> 10km)
        if (lastSyncLocation) {
          const distance = calculateDistance(
            lastSyncLocation.lat, lastSyncLocation.lng,
            latitude, longitude
          );
          if (distance > 10) { // 10km threshold
            logger.debug('[OfflineMode] Significant location change, syncing nearby spots');
            syncNearbySpots(latitude, longitude);
            setLastSyncLocation(newLocation);
          }
        } else {
          setLastSyncLocation(newLocation);
          syncNearbySpots(latitude, longitude);
        }
      },
      (error) => logger.debug('[OfflineMode] Location error:', error),
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 }
    );
  }, [lastSyncLocation]);

  // Calculate distance between two points in km (Haversine formula)
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Sync spots near current location
  const syncNearbySpots = useCallback(async (lat, lng) => {
    if (!isOnline || isDownloading) return;
    
    try {
      // Get current location if not provided
      if (!lat || !lng) {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
        });
        lat = position.coords.latitude;
        lng = position.coords.longitude;
      }
      
      // Fetch spots within 100km radius
      const response = await apiClient.get(`/spots-in-bounds`, {
        params: {
          sw_lat: lat - 0.9, // ~100km
          sw_lng: lng - 0.9,
          ne_lat: lat + 0.9,
          ne_lng: lng + 0.9
        }
      });
      
      const nearbySpots = response.data;
      localStorage.setItem(NEARBY_SPOTS_KEY, JSON.stringify(nearbySpots));
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
      setNearbyCached(true);
      setCacheTimestamp(new Date());
      
      logger.debug(`[OfflineMode] Cached ${nearbySpots.length} nearby spots`);
      return { success: true, count: nearbySpots.length };
    } catch (error) {
      logger.error('[OfflineMode] Nearby sync failed:', error);
      return { success: false };
    }
  }, [isOnline, isDownloading]);

  // Sync favorite spots for offline use
  const syncFavoriteSpots = useCallback(async (userId) => {
    if (!isOnline || !userId) return { success: false };
    
    try {
      // Fetch user's favorite/saved spots
      const response = await apiClient.get(`/users/${userId}/favorites`);
      const favorites = response.data;
      
      if (favorites && favorites.length > 0) {
        localStorage.setItem(FAVORITE_SPOTS_KEY, JSON.stringify(favorites));
        logger.debug(`[OfflineMode] Cached ${favorites.length} favorite spots`);
        return { success: true, count: favorites.length };
      }
      return { success: true, count: 0 };
    } catch (error) {
      logger.error('[OfflineMode] Favorites sync failed:', error);
      return { success: false };
    }
  }, [isOnline]);

  // Enable/disable auto-sync
  const toggleAutoSync = useCallback((enabled) => {
    setAutoSyncEnabled(enabled);
    localStorage.setItem(AUTO_SYNC_KEY, enabled.toString());
    
    if (enabled) {
      startLocationTracking();
      // Immediately sync if online
      if (isOnline) {
        syncNearbySpots();
      }
    } else {
      if (locationWatchRef.current) {
        navigator.geolocation.clearWatch(locationWatchRef.current);
        locationWatchRef.current = null;
      }
    }
    
    return { success: true, enabled };
  }, [isOnline, startLocationTracking, syncNearbySpots]);

  // Download all spots for offline use
  const downloadSpotsForOffline = useCallback(async () => {
    if (isDownloading) return { success: false, message: 'Download already in progress' };
    
    setIsDownloading(true);
    try {
      // Fetch all spots
      const response = await apiClient.get(`/surf-spots`);
      const spots = response.data;
      
      // Store in localStorage
      localStorage.setItem(SPOTS_STORAGE_KEY, JSON.stringify(spots));
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
      
      setSpotsCached(true);
      setCacheTimestamp(new Date());
      
      // Also try to cache via Service Worker for better performance
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CACHE_SPOTS' });
      }
      
      return { 
        success: true, 
        message: `Downloaded ${spots.length} spots for offline use`,
        spotCount: spots.length
      };
    } catch (error) {
      logger.error('[OfflineMode] Download failed:', error);
      return { 
        success: false, 
        message: 'Failed to download spots. Check your connection.'
      };
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading]);

  // Get cached spots (for offline use)
  const getCachedSpots = useCallback(() => {
    try {
      // Priority: nearby spots -> all spots
      const nearby = localStorage.getItem(NEARBY_SPOTS_KEY);
      if (nearby) return JSON.parse(nearby);
      
      const cached = localStorage.getItem(SPOTS_STORAGE_KEY);
      if (cached) return JSON.parse(cached);
    } catch (e) {
      logger.error('[OfflineMode] Error reading cache:', e);
    }
    return [];
  }, []);

  // Get cached favorite spots
  const getCachedFavorites = useCallback(() => {
    try {
      const cached = localStorage.getItem(FAVORITE_SPOTS_KEY);
      if (cached) return JSON.parse(cached);
    } catch (e) {
      logger.error('[OfflineMode] Error reading favorites cache:', e);
    }
    return [];
  }, []);

  // Clear the offline cache
  const clearOfflineCache = useCallback(() => {
    localStorage.removeItem(SPOTS_STORAGE_KEY);
    localStorage.removeItem(NEARBY_SPOTS_KEY);
    localStorage.removeItem(FAVORITE_SPOTS_KEY);
    localStorage.removeItem(CACHE_TIMESTAMP_KEY);
    setSpotsCached(false);
    setNearbyCached(false);
    setCacheTimestamp(null);
    
    // Also clear Service Worker cache
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_SPOT_CACHE' });
    }
    
    return { success: true, message: 'Offline cache cleared' };
  }, []);

  // Get cache size in MB
  const getCacheSize = useCallback(() => {
    try {
      let totalSize = 0;
      const keys = [SPOTS_STORAGE_KEY, NEARBY_SPOTS_KEY, FAVORITE_SPOTS_KEY];
      keys.forEach(key => {
        const cached = localStorage.getItem(key);
        if (cached) {
          totalSize += new Blob([cached]).size;
        }
      });
      return (totalSize / (1024 * 1024)).toFixed(2);
    } catch (e) {
      logger.error('[OfflineMode] Error calculating cache size:', e);
    }
    return 0;
  }, []);

  // Format cache timestamp
  const formatCacheTime = useCallback(() => {
    if (!cacheTimestamp) return 'Never';
    
    const now = new Date();
    const diff = now - cacheTimestamp;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return 'Just now';
  }, [cacheTimestamp]);

  return {
    isOnline,
    spotsCached,
    nearbyCached,
    cacheTimestamp,
    isDownloading,
    autoSyncEnabled,
    downloadSpotsForOffline,
    syncNearbySpots,
    syncFavoriteSpots,
    toggleAutoSync,
    getCachedSpots,
    getCachedFavorites,
    clearOfflineCache,
    getCacheSize,
    formatCacheTime,
    checkCacheStatus
  };
};

export default useOfflineMode;
