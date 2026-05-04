/**
 * useOnDemandActions.js � Extracted from OnDemandSessionManager.js
 * On-demand session management: status toggling, request handling, settings.
 * ~344 lines extracted (19 handlers).
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { useCallback } from 'react';

const useOnDemandActions = ({
  user, settings, activeSession, selectedSpots,
  userLocation, nearbySpots, geoRadius, isOnline, isLiveShooting,
  baseRate, peakPricingEnabled, peakMultiplier, cancellationFeePct,
  odPriceWeb, odPriceStandard, odPriceHigh,
  odVideo720p, odVideo1080p, odVideo4k,
  onDemandPhotosIncluded, onDemandFullGallery,
  cancelTargetId,
  setOnDemandStatus: _setOnDemandStatus,
  setIsOnline, setIsTogglingStatus, setIsAccepting, setIsCancelling,
  setIsLiveShooting, setActiveSession, setSessionHistory,
  setIncomingRequests, setExceptionRequests, setStats, setLoading,
  setNearbySpots, setSelectedSpots, setSelectedOnDemandSpot,
  setBaseRate, setPeakPricingEnabled, setPeakMultiplier, setCancellationFeePct,
  setOdPriceWeb, setOdPriceStandard, setOdPriceHigh,
  setOdVideo720p, setOdVideo1080p, setOdVideo4k,
  setOnDemandPhotosIncluded, setOnDemandFullGallery,
  setSaving, setCancelTargetId, setShowCancelConfirm,
}) => {

  const fetchNearbySpots = async (location) => {
    try {
      const response = await apiClient.get(`/surf-spots/nearby`, {
        params: {
          latitude: location.latitude,
          longitude: location.longitude,
          radius_miles: geoRadius.default
        }
      });
      setNearbySpots(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch nearby spots:', error);
      try {
        const fallbackResponse = await apiClient.get(`/surf-spots?limit=30`);
        setNearbySpots(fallbackResponse.data || []);
      } catch (e) {
        logger.error('Fallback also failed:', e);
      }
    }
  };
  
  const fetchOnDemandStatus = async () => {
    try {
      const response = await apiClient.get(`/photographer/${user.id}/on-demand-status`);
      setIsOnline(response.data.is_available || false);
      if (response.data.active_spot) {
        setSelectedOnDemandSpot(response.data.active_spot);
      }
      setIsLiveShooting(response.data.is_live_shooting || false);
    } catch (error) {
      logger.error('Failed to fetch on-demand status:', error);
    }
  };
  
  const fetchSettings = async () => {
    try {
      const response = await apiClient.get(`/photographer/${user.id}/on-demand-settings`);
      if (response.data) {
        setBaseRate(response.data.base_rate || 75);
        setPeakPricingEnabled(response.data.peak_pricing_enabled || false);
        setPeakMultiplier(response.data.peak_multiplier || 1.5);
        setOnDemandPhotosIncluded(response.data.on_demand_photos_included || 3);
        setOnDemandFullGallery(response.data.on_demand_full_gallery || false);
        setSelectedSpots(response.data.claimed_spots || []);
        // Resolution pricing
        setOdPriceWeb(response.data.on_demand_price_web || 5);
        setOdPriceStandard(response.data.on_demand_price_standard || 10);
        setOdPriceHigh(response.data.on_demand_price_high || 18);
        setOdVideo720p(response.data.on_demand_video_720p || 12);
        setOdVideo1080p(response.data.on_demand_video_1080p || 20);
        setOdVideo4k(response.data.on_demand_video_4k || 40);
        // Cancellation fee
        setCancellationFeePct(response.data.on_demand_cancellation_fee_pct ?? 100);
      }
      setLoading(false);
    } catch (error) {
      logger.error('Failed to fetch settings:', error);
      setLoading(false);
    }
  };
  
  const fetchStats = async () => {
    try {
      const response = await apiClient.get(`/dispatch/photographer/${user.id}/stats`);
      setStats(response.data);
    } catch (error) {
      logger.error('Failed to fetch stats:', error);
      setStats({
        earnings_today: 0,
        sessions_today: 0,
        sessions_week: 0,
        streak: 0,
        total_sessions: 0
      });
    }
  };
  
  const fetchIncomingRequests = async () => {
    if (activeSession) return;
    
    try {
      const response = await apiClient.get(`/dispatch/photographer/${user.id}/pending`);
      const pending = response.data.pending_dispatches || [];
      
      // The pending endpoint already returns all needed data including crew with selfies
      // No need to fetch additional details
      setIncomingRequests(pending);
    } catch (error) {
      logger.debug('No pending requests');
      setIncomingRequests([]);
    }
  };
  
  const fetchActiveSession = async () => {
    try {
      const response = await apiClient.get(`/dispatch/user/${user.id}/active`);
      const active = response.data.active_dispatch;
      
      if (active && active.role === 'photographer') {
        // Use the selfie from active dispatch response (includes crew selfies too)
        const requesterSelfie = active.requester_selfie;
        
        // Also fetch full details for additional info
        const detailResponse = await apiClient.get(`/dispatch/${active.id}`);
        
        setActiveSession({
          id: active.id,
          status: detailResponse.data.status,
          requester_id: active.requester_id || detailResponse.data.requester?.id,
          requester_name: active.requester_name || detailResponse.data.requester?.name,
          requester_avatar: active.requester_avatar || detailResponse.data.requester?.avatar,
          requester_username: active.requester_username || detailResponse.data.requester?.username,
          requester_stance: active.requester_stance,
          requester_board_description: active.requester_board_description,
          requester_selfie: requesterSelfie || detailResponse.data.selfie_url,  // Prefer active dispatch selfie
          location_name: active.location_name || detailResponse.data.location?.name,
          estimated_duration: detailResponse.data.pricing?.estimated_duration,
          hourly_rate: detailResponse.data.pricing?.hourly_rate,
          eta_minutes: active.eta_minutes || detailResponse.data.gps?.eta_minutes,
          arrived_at: detailResponse.data.timestamps?.arrived,
          is_shared: active.is_shared,
          crew: active.crew  // Include crew with their selfies
        });
      } else {
        setActiveSession(null);
      }
    } catch (error) {
      setActiveSession(null);
    }
  };
  
  const fetchSessionHistory = async () => {
    try {
      const response = await apiClient.get(`/dispatch/photographer/${user.id}/history?limit=20`);
      setSessionHistory(response.data.history || []);
    } catch (error) {
      logger.error('Failed to fetch history:', error);
      setSessionHistory([]);
    }
  };

  const fetchExceptionRequests = async () => {
    try {
      const response = await apiClient.get(`/dispatch/photographer/${user.id}/exception-requests?status_filter=pending`);
      setExceptionRequests(response.data.exception_requests || []);
    } catch (error) {
      logger.error('Failed to fetch exception requests:', error);
    }
  };
  
  // ============ HANDLERS ============
  const handleToggleOnline = async () => {
    setIsTogglingStatus(true);
    try {
      // Check if live shooting is active
      if (isLiveShooting && !isOnline) {
        toast.error('Cannot go on-demand while Live Shooting is active. Please end your live session first.');
        setIsTogglingStatus(false);
        return;
      }
      
      // Get location
      let lat = userLocation?.latitude;
      let lng = userLocation?.longitude;
      
      if (!lat || !lng) {
        try {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
          });
          lat = position.coords.latitude;
          lng = position.coords.longitude;
        } catch {
          toast.error('Location required. Please enable location services.');
          setIsTogglingStatus(false);
          return;
        }
      }
      
      // Find the first selected spot to use
      const spotToUse = nearbySpots.find(s => selectedSpots.includes(s.id));
      
      const response = await apiClient.post(
        `/photographer/${user.id}/on-demand-toggle`,
        { 
          is_available: !isOnline,
          latitude: spotToUse?.latitude || lat, 
          longitude: spotToUse?.longitude || lng,
          spot_id: spotToUse?.id,
          spot_name: spotToUse?.name
        }
      );
      
      const newStatus = response.data.is_available;
      setIsOnline(newStatus);
      
      if (newStatus) {
        setSelectedOnDemandSpot(spotToUse);
        toast.success(`On-Demand activated${spotToUse ? ` at ${spotToUse.name}` : ''}!`);
      } else {
        setSelectedOnDemandSpot(null);
        toast.info("You're now offline");
        setIncomingRequests([]);
      }
    } catch (error) {
      const detail = error.response?.data?.detail;
      if (detail?.includes('live')) {
        toast.error('Cannot go on-demand while Live Shooting is active. Please end your live session first.');
      } else {
        toast.error(detail || 'Failed to update status');
      }
    } finally {
      setIsTogglingStatus(false);
    }
  };
  
  const handleAcceptRequest = async (dispatchId) => {
    setIsAccepting(true);
    try {
      await apiClient.post(`/dispatch/${dispatchId}/accept`, {
        photographer_id: user.id
      });
      
      toast.success('Request accepted! Head to the location.');
      setIncomingRequests([]);
      fetchActiveSession();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to accept request');
    } finally {
      setIsAccepting(false);
    }
  };
  
  const handleDeclineRequest = useCallback(async (dispatchId, isTimeout = false) => {
    try {
      // Call backend to decline
      await apiClient.post(`/dispatch/${dispatchId}/decline?photographer_id=${user.id}`);
      
      // Remove from local state
      setIncomingRequests(prev => prev.filter(r => r.dispatch_id !== dispatchId));
      
      if (!isTimeout) {
        toast.info('Request declined');
      }
    } catch (error) {
      logger.error('Failed to decline request:', error);
      toast.error(error.response?.data?.detail || 'Failed to decline request');
      // Still remove from local state even if API fails
      setIncomingRequests(prev => prev.filter(r => r.dispatch_id !== dispatchId));
    }
  }, [user?.id]);
  
  const handleMarkArrived = async (dispatchId) => {
    try {
      await apiClient.post(`/dispatch/${dispatchId}/arrived?photographer_id=${user.id}`);
      toast.success('Session started! Have fun shooting!');
      fetchActiveSession();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to mark arrival');
    }
  };
  
  const handleCompleteSession = async (dispatchId) => {
    try {
      await apiClient.post(`/dispatch/${dispatchId}/complete?photographer_id=${user.id}`);
      toast.success('Session completed! Gallery created.');
      setActiveSession(null);
      fetchStats();
      fetchSessionHistory();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to complete session');
    }
  };
  
  // Opens the in-app cancel confirmation modal
  const promptCancelSession = (dispatchId) => {
    setCancelTargetId(dispatchId);
    setShowCancelConfirm(true);
  };

  // Executes the cancel after the user confirms via the modal
  const handleConfirmCancel = async () => {
    if (!cancelTargetId) return;
    setIsCancelling(true);
    try {
      await apiClient.post(`/dispatch/${cancelTargetId}/cancel`, {
        reason: 'Photographer cancelled'
      });
      toast.info('Session cancelled');
      setActiveSession(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to cancel session');
    } finally {
      setIsCancelling(false);
      setShowCancelConfirm(false);
      setCancelTargetId(null);
    }
  };
  
  const toggleSpotSelection = (spotId) => {
    setSelectedSpots(prev => 
      prev.includes(spotId) 
        ? prev.filter(id => id !== spotId)
        : [...prev, spotId]
    );
  };
  
  const selectAllSpots = () => {
    setSelectedSpots(nearbySpots.map(s => s.id));
  };
  
  const clearAllSpots = () => {
    setSelectedSpots([]);
  };
  
  const saveSettings = async () => {
    setSaving(true);
    try {
      await apiClient.post(`/photographer/${user.id}/on-demand-settings`, {
        base_rate: baseRate,
        peak_pricing_enabled: peakPricingEnabled,
        peak_multiplier: peakMultiplier,
        claimed_spots: selectedSpots,
        latitude: userLocation?.latitude,
        longitude: userLocation?.longitude,
        on_demand_photos_included: onDemandPhotosIncluded,
        on_demand_full_gallery: onDemandFullGallery,
        on_demand_price_web: odPriceWeb,
        on_demand_price_standard: odPriceStandard,
        on_demand_price_high: odPriceHigh,
        on_demand_video_720p: odVideo720p,
        on_demand_video_1080p: odVideo1080p,
        on_demand_video_4k: odVideo4k,
        on_demand_cancellation_fee_pct: cancellationFeePct,
      });
      
      toast.success('On-Demand settings saved!');
    } catch (error) {
      logger.error('Failed to save settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return {
    fetchNearbySpots, fetchOnDemandStatus, fetchSettings, fetchStats,
    fetchIncomingRequests, fetchActiveSession, fetchSessionHistory,
    fetchExceptionRequests, handleToggleOnline,
    handleAcceptRequest, handleDeclineRequest,
    handleMarkArrived, handleCompleteSession, handleConfirmCancel,
    toggleSpotSelection, saveSettings,
  };
};

export default useOnDemandActions;