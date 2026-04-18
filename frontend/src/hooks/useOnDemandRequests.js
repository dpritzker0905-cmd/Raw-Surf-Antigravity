/**
 * useOnDemandRequests Hook
 * Manages active on-demand requests display on the map
 * Extracted from MapPage.js for better organization
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

export const useOnDemandRequests = ({ user, isPhotographer }) => {
  const [activeOnDemandRequests, setActiveOnDemandRequests] = useState([]);
  const onDemandMarkersRef = useRef([]);

  /**
   * Fetch active on-demand requests (for photographers)
   */
  const fetchActiveOnDemandRequests = useCallback(async () => {
    if (!user?.id || !isPhotographer) return;

    try {
      const response = await apiClient.get(`/on-demand/active`, {
        params: { photographer_id: user.id }
      });
      
      if (response.data.success) {
        setActiveOnDemandRequests(response.data.requests || []);
      }
    } catch (error) {
      logger.error('Error fetching on-demand requests:', error);
    }
  }, [user?.id, isPhotographer]);

  /**
   * Clear on-demand request markers from map
   */
  const clearOnDemandMarkers = useCallback(() => {
    onDemandMarkersRef.current.forEach(marker => {
      if (marker && marker.remove) {
        marker.remove();
      }
    });
    onDemandMarkersRef.current = [];
  }, []);

  /**
   * Accept an on-demand request
   */
  const acceptRequest = useCallback(async (requestId) => {
    if (!user?.id) return;

    try {
      const response = await apiClient.post(`/on-demand/${requestId}/accept`, {
        photographer_id: user.id
      });
      
      if (response.data.success) {
        // Refresh the requests list
        await fetchActiveOnDemandRequests();
        return response.data;
      }
    } catch (error) {
      logger.error('Error accepting request:', error);
      throw error;
    }
  }, [user?.id, fetchActiveOnDemandRequests]);

  /**
   * Decline an on-demand request
   */
  const declineRequest = useCallback(async (requestId) => {
    if (!user?.id) return;

    try {
      const response = await apiClient.post(`/on-demand/${requestId}/decline`, {
        photographer_id: user.id
      });
      
      if (response.data.success) {
        // Refresh the requests list
        await fetchActiveOnDemandRequests();
        return response.data;
      }
    } catch (error) {
      logger.error('Error declining request:', error);
      throw error;
    }
  }, [user?.id, fetchActiveOnDemandRequests]);

  // Fetch requests periodically when user is a photographer
  useEffect(() => {
    if (user?.id && isPhotographer) {
      fetchActiveOnDemandRequests();
      
      // Refresh every 15 seconds for real-time updates
      const interval = setInterval(fetchActiveOnDemandRequests, 15000);
      return () => clearInterval(interval);
    }
  }, [user?.id, isPhotographer, fetchActiveOnDemandRequests]);

  return {
    activeOnDemandRequests,
    setActiveOnDemandRequests,
    onDemandMarkersRef,
    fetchActiveOnDemandRequests,
    clearOnDemandMarkers,
    acceptRequest,
    declineRequest
  };
};

export default useOnDemandRequests;
