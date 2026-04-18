/**
 * useFriendsOnMap Hook
 * Manages friends display on the map
 * Extracted from MapPage.js for better organization
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

export const useFriendsOnMap = ({ user, _mapInstanceRef }) => {
  const [friendsOnMap, setFriendsOnMap] = useState([]);
  const [showFriendsOnMap, setShowFriendsOnMap] = useState(true);
  const friendMarkersRef = useRef([]);

  /**
   * Fetch friends who are currently surfing
   */
  const fetchFriendsOnMap = useCallback(async () => {
    if (!user?.id) return;

    try {
      const response = await apiClient.get(`/friends/map/${user.id}`);
      setFriendsOnMap(response.data.friends_on_map || []);
    } catch (error) {
      logger.error('Error fetching friends on map:', error);
    }
  }, [user?.id]);

  /**
   * Clear friend markers from map
   */
  const clearFriendMarkers = useCallback(() => {
    friendMarkersRef.current.forEach(marker => {
      if (marker && marker.remove) {
        marker.remove();
      }
    });
    friendMarkersRef.current = [];
  }, []);

  /**
   * Toggle friends visibility
   */
  const toggleFriendsOnMap = useCallback(() => {
    setShowFriendsOnMap(prev => !prev);
  }, []);

  // Fetch friends periodically when user is logged in
  useEffect(() => {
    if (user?.id) {
      fetchFriendsOnMap();
      
      // Refresh every 30 seconds
      const interval = setInterval(fetchFriendsOnMap, 30000);
      return () => clearInterval(interval);
    }
  }, [user?.id, fetchFriendsOnMap]);

  return {
    friendsOnMap,
    setFriendsOnMap,
    showFriendsOnMap,
    setShowFriendsOnMap,
    friendMarkersRef,
    fetchFriendsOnMap,
    clearFriendMarkers,
    toggleFriendsOnMap
  };
};

export default useFriendsOnMap;
