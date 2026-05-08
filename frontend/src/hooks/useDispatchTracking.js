/**
 * useDispatchTracking — Extracted from MapPage.js (v80)
 *
 * Manages active dispatch tracking state: checks for an active dispatch
 * on mount, polls for location updates when en_route, and sends the
 * user's location back to the server.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

const useDispatchTracking = ({ userId, updateTrackingMarkers }) => {
  const [activeDispatch, setActiveDispatch] = useState(null);
  const [activeDispatchId, setActiveDispatchId] = useState(null);
  const trackingIntervalRef = useRef(null);

  // Check for active en_route dispatch on mount
  useEffect(() => {
    const checkActiveDispatch = async () => {
      if (!userId) return;
      try {
        const response = await apiClient.get(`/dispatch/user/${userId}/active`);
        if (response.data && response.data.status === 'en_route') {
          setActiveDispatch(response.data);
        }
      } catch (e) {}
    };
    
    checkActiveDispatch();
  }, [userId]);

  // Poll dispatch locations and send own location while en_route
  useEffect(() => {
    if (!activeDispatch || activeDispatch.status !== 'en_route') {
      if (trackingIntervalRef.current) clearInterval(trackingIntervalRef.current);
      return;
    }

    const pollLocations = async () => {
      try {
        const response = await apiClient.get(`/dispatch/${activeDispatch.id}/tracking`);
        setActiveDispatch(prev => ({
          ...prev,
          photographer_lat: response.data.photographer_location?.lat,
          photographer_lng: response.data.photographer_location?.lng,
          requester_lat: response.data.requester_location?.lat,
          requester_lng: response.data.requester_location?.lng,
          estimated_arrival_minutes: response.data.estimated_arrival_minutes
        }));
        if (updateTrackingMarkers) {
          updateTrackingMarkers(response.data);
        }
      } catch (error) {
        logger.error('Error polling dispatch locations:', error);
      }
    };

    const sendLocationUpdate = async () => {
      if (!navigator.geolocation) return;
      
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          await apiClient.post(`/dispatch/${activeDispatch.id}/update-location`, {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        } catch (error) {
          logger.error('Error sending location update:', error);
        }
      });
    };

    pollLocations();
    sendLocationUpdate();
    trackingIntervalRef.current = setInterval(() => {
      pollLocations();
      sendLocationUpdate();
    }, 5000);
    
    return () => {
      if (trackingIntervalRef.current) clearInterval(trackingIntervalRef.current);
    };
  }, [activeDispatch?.id, activeDispatch?.status, userId, updateTrackingMarkers]);

  const clearDispatch = useCallback(() => {
    setActiveDispatch(null);
  }, []);

  return {
    activeDispatch,
    activeDispatchId,
    setActiveDispatchId,
    clearDispatch,
  };
};

export default useDispatchTracking;
