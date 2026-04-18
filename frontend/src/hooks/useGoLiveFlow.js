import { useState, useCallback } from 'react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';


// Permission status enum
const PermissionStatus = {
  PENDING: 'PENDING',
  REQUESTING: 'REQUESTING',
  GRANTED: 'GRANTED',
  DENIED: 'DENIED',
  ERROR: 'ERROR'
};

// Helper to safely extract error message from API responses
const getErrorMessage = (error, fallback = 'An error occurred') => {
  const detail = error?.response?.data?.detail;
  if (!detail) return error?.message || fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map(e => e.msg || e.message || JSON.stringify(e)).join(', ');
  }
  if (typeof detail === 'object') {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return fallback;
};

/**
 * useGoLiveFlow - Custom hook for photographer go-live workflow
 * 
 * Manages:
 * - Permission flow (location → conditions modal)
 * - Session settings storage
 * - Go live API calls
 * - End session flow
 */
export const useGoLiveFlow = ({ userId, onGoLiveSuccess, onEndSessionSuccess }) => {
  // State
  const [goLiveSpotId, setGoLiveSpotId] = useState(null);
  const [goLiveSessionSettings, setGoLiveSessionSettings] = useState({});
  const [goLiveLoading, setGoLiveLoading] = useState(false);
  const [permissionStep, setPermissionStep] = useState(0);
  const [locationPermission, setLocationPermission] = useState(PermissionStatus.PENDING);
  const [userLocation, setUserLocation] = useState(null);
  
  // Modals
  const [showConditionsModal, setShowConditionsModal] = useState(false);
  const [showEndSessionModal, setShowEndSessionModal] = useState(false);
  const [endSessionLoading, setEndSessionLoading] = useState(false);
  const [currentLiveSession, setCurrentLiveSession] = useState(null);
  const [currentLiveSpot, setCurrentLiveSpot] = useState(null);

  // Debug logger
  const logPermissionStatus = useCallback((step, status, details = '') => {
    const timestamp = new Date().toISOString();
    logger.debug(`[GO_LIVE_FLOW ${timestamp}] Step: ${step}, Status: ${status}${details ? `, Details: ${details}` : ''}`);
  }, []);

  // Step 1: Request Location Permission
  const requestLocationPermission = useCallback(async () => {
    logPermissionStatus('LOCATION', PermissionStatus.REQUESTING);
    setPermissionStep(1);
    setLocationPermission(PermissionStatus.REQUESTING);
    
    try {
      if (!navigator.geolocation) {
        throw new Error('Geolocation not supported by browser');
      }
      
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      });
      
      const { latitude, longitude } = position.coords;
      setUserLocation({ lat: latitude, lng: longitude });
      setLocationPermission(PermissionStatus.GRANTED);
      logPermissionStatus('LOCATION', PermissionStatus.GRANTED, `lat: ${latitude}, lng: ${longitude}`);
      
      return { lat: latitude, lng: longitude };
    } catch (error) {
      setLocationPermission(PermissionStatus.DENIED);
      logPermissionStatus('LOCATION', PermissionStatus.DENIED, error.message);
      
      if (error.code === 1) {
        toast.error('Location Access Required', {
          description: 'Please enable location in your browser settings to go live.'
        });
      } else {
        toast.error('Location Error', {
          description: error.message || 'Could not get your location'
        });
      }
      throw error;
    }
  }, [logPermissionStatus]);

  // Start Go Live Flow - Sequential permissions
  const startGoLiveFlow = useCallback(async (spotId, sessionSettings = {}) => {
    logPermissionStatus('GO_LIVE_FLOW', 'STARTED', `spotId: ${spotId}`);
    setGoLiveSpotId(spotId);
    setGoLiveSessionSettings(sessionSettings);
    setPermissionStep(0);
    
    try {
      // Step 1: Request Location
      await requestLocationPermission();
      
      // Step 2: Show the ConditionsModal (handles camera internally)
      setShowConditionsModal(true);
      logPermissionStatus('GO_LIVE_FLOW', 'CONDITIONS_MODAL_OPENED');
      
    } catch (error) {
      logPermissionStatus('GO_LIVE_FLOW', PermissionStatus.ERROR, error.message);
      setPermissionStep(0);
    }
  }, [requestLocationPermission, logPermissionStatus]);

  // Handle ConditionsModal confirm - convert media to base64 string
  const handleConditionsConfirm = useCallback(async ({ media, mediaType, spotNotes }, surfSpots = []) => {
    setGoLiveLoading(true);
    logPermissionStatus('CONDITIONS_CONFIRM', 'STARTING');
    
    try {
      // Convert media to base64 string for API - MUST be a string, not an object
      let mediaBase64 = null;
      
      if (media instanceof Blob) {
        // Convert Blob to base64 data URL
        mediaBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Failed to read media file'));
          reader.readAsDataURL(media);
        });
      } else if (typeof media === 'string') {
        // Already a string (e.g., data URL from previous capture)
        mediaBase64 = media;
      } else if (media && typeof media === 'object') {
        // Handle edge case where media might be an object with a URL
        // Try to extract a string value
        if (media.url && typeof media.url === 'string') {
          mediaBase64 = media.url;
        } else if (media.data && typeof media.data === 'string') {
          mediaBase64 = media.data;
        } else {
          logger.error('Media is an object but no valid string found:', media);
          throw new Error('Invalid media format - expected string or Blob');
        }
      }
      
      // Validate that we have a string
      if (mediaBase64 && typeof mediaBase64 !== 'string') {
        logger.error('Media conversion failed - result is not a string:', typeof mediaBase64);
        throw new Error('Media conversion failed');
      }
      
      // Go live at the spot with session settings and condition media
      const response = await apiClient.post(`/photographers/${userId}/go-live`, {
        spot_id: goLiveSpotId,
        is_streaming: false,
        condition_media: mediaBase64, // Now guaranteed to be a string
        condition_media_type: mediaType,
        spot_notes: spotNotes,
        // Include session settings
        price_per_join: goLiveSessionSettings.price_per_join || 25,
        max_surfers: goLiveSessionSettings.max_surfers || 10,
        auto_accept: goLiveSessionSettings.auto_accept !== false,
        estimated_duration: goLiveSessionSettings.estimated_duration || 2,
        live_photo_price: goLiveSessionSettings.live_photo_price || 5,
        photos_included: goLiveSessionSettings.photos_included || 3,
        general_photo_price: goLiveSessionSettings.general_photo_price || 10,
        // Resolution-based pricing (MANDATORY for all workflows)
        photo_price_web: goLiveSessionSettings.photo_price_web || 3,
        photo_price_standard: goLiveSessionSettings.photo_price_standard || 5,
        photo_price_high: goLiveSessionSettings.photo_price_high || 10
      });
      
      logPermissionStatus('CONDITIONS_CONFIRM', 'SUCCESS', response.data.message);
      toast.success(response.data.message);
      
      // Track current live spot
      const liveSpot = surfSpots.find(s => s.id === goLiveSpotId);
      setCurrentLiveSpot(liveSpot);
      
      // Cleanup
      setShowConditionsModal(false);
      setPermissionStep(0);
      setGoLiveSessionSettings({});
      
      // Callback
      onGoLiveSuccess?.(response.data);
      
    } catch (error) {
      logPermissionStatus('CONDITIONS_CONFIRM', PermissionStatus.ERROR, error.message);
      toast.error(getErrorMessage(error, 'Failed to go live'));
    } finally {
      setGoLiveLoading(false);
    }
  }, [goLiveSpotId, goLiveSessionSettings, userId, logPermissionStatus, onGoLiveSuccess]);

  // Show end session confirmation modal
  const handleStopLive = useCallback((currentUserShooting) => {
    const sessionData = currentUserShooting ? {
      location: currentUserShooting.current_spot_name || currentUserShooting.location,
      started_at: currentUserShooting.started_at || new Date().toISOString(),
      active_surfers: currentUserShooting.active_surfers || 0,
      participants: currentUserShooting.participants || [],
      earnings: currentUserShooting.earnings || 0
    } : null;
    
    setCurrentLiveSession(sessionData);
    setShowEndSessionModal(true);
  }, []);

  // Actual end session logic after confirmation
  const handleEndSessionConfirmed = useCallback(async () => {
    setEndSessionLoading(true);
    try {
      await apiClient.post(`/photographers/${userId}/stop-live`, {});
      toast.success('Session ended! Check your Impacted dashboard for summary.');
      setShowEndSessionModal(false);
      setCurrentLiveSession(null);
      setCurrentLiveSpot(null);
      
      // Callback
      onEndSessionSuccess?.();
      
    } catch (error) {
      toast.error('Failed to end session');
    } finally {
      setEndSessionLoading(false);
    }
  }, [userId, onEndSessionSuccess]);

  // Close modals
  const closeConditionsModal = useCallback(() => {
    setShowConditionsModal(false);
    setGoLiveLoading(false);
  }, []);

  const closeEndSessionModal = useCallback(() => {
    setShowEndSessionModal(false);
  }, []);

  return {
    // State
    goLiveSpotId,
    goLiveLoading,
    permissionStep,
    locationPermission,
    userLocation,
    currentLiveSpot,
    currentLiveSession,
    
    // Modal visibility
    showConditionsModal,
    showEndSessionModal,
    endSessionLoading,
    
    // Actions
    startGoLiveFlow,
    handleConditionsConfirm,
    handleStopLive,
    handleEndSessionConfirmed,
    closeConditionsModal,
    closeEndSessionModal,
    setUserLocation,
    setCurrentLiveSpot,
  };
};

export default useGoLiveFlow;
