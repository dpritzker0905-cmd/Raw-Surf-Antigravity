/**
 * useRequestPro Hook
 * Manages the "Request a Pro" workflow state and logic
 * Extracted from MapPage.js for better organization
 */

import { useState, useCallback } from 'react';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import { getErrorMessage } from '../utils/errors';
import logger from '../utils/logger';

export const useRequestPro = ({ user, userLocation, getUserLocation }) => {
  // Modal and loading states
  const [showRequestProModal, setShowRequestProModal] = useState(false);
  const [requestProLoading, setRequestProLoading] = useState(false);
  const [showRequestProSelfieModal, setShowRequestProSelfieModal] = useState(false);
  
  // Request configuration
  const [estimatedDuration, setEstimatedDuration] = useState(1);
  const [inviteFriends, setInviteFriends] = useState(false);
  const [boostHours, setBoostHours] = useState(0); // 0=none, 1/2/4=hours
  
  // Location pending state
  const [pendingRequestPro, setPendingRequestPro] = useState(false);
  const [requestProLocationLoading, setRequestProLocationLoading] = useState(false);
  
  // Active dispatch tracking
  const [activeDispatchId, setActiveDispatchId] = useState(null);

  /**
   * Open the Request Pro modal
   * If no location, request GPS first
   */
  const openRequestProModal = useCallback(() => {
    if (!userLocation) {
      setPendingRequestPro(true);
      setRequestProLocationLoading(true);
      getUserLocation();
    } else {
      setShowRequestProModal(true);
    }
  }, [userLocation, getUserLocation]);

  /**
   * Handle location acquired - open modal if pending
   */
  const handleLocationAcquired = useCallback(() => {
    if (pendingRequestPro && userLocation) {
      setPendingRequestPro(false);
      setRequestProLocationLoading(false);
      setShowRequestProModal(true);
    }
  }, [pendingRequestPro, userLocation]);

  /**
   * Submit the Request Pro
   */
  const submitRequestPro = useCallback(async () => {
    if (!userLocation || !user) return;

    setRequestProLoading(true);
    
    try {
      const response = await apiClient.post(`/on-demand/request`, {
        surfer_id: user.id,
        latitude: userLocation.lat,
        longitude: userLocation.lng,
        estimated_duration_hours: estimatedDuration,
        boost_hours: boostHours,
        invite_friends: inviteFriends,
        accuracy: userLocation.accuracy
      });

      if (response.data.success) {
        setActiveDispatchId(response.data.dispatch_id);
        setShowRequestProModal(false);
        setShowRequestProSelfieModal(true);
        
        toast.success('Request sent!', {
          description: 'Photographers in your area will be notified'
        });
      }
    } catch (error) {
      logger.error('Request Pro error:', error);
      toast.error('Failed to send request', {
        description: getErrorMessage(error)
      });
    } finally {
      setRequestProLoading(false);
    }
  }, [userLocation, user, estimatedDuration, boostHours, inviteFriends]);

  /**
   * Cancel active request
   */
  const cancelRequest = useCallback(async () => {
    if (!activeDispatchId) return;

    try {
      await apiClient.post(`/on-demand/${activeDispatchId}/cancel`);
      setActiveDispatchId(null);
      toast.info('Request cancelled');
    } catch (error) {
      logger.error('Cancel request error:', error);
      toast.error('Failed to cancel request');
    }
  }, [activeDispatchId]);

  /**
   * Reset all state
   */
  const resetRequestPro = useCallback(() => {
    setShowRequestProModal(false);
    setShowRequestProSelfieModal(false);
    setRequestProLoading(false);
    setPendingRequestPro(false);
    setRequestProLocationLoading(false);
    setEstimatedDuration(1);
    setInviteFriends(false);
    setBoostHours(0);
  }, []);

  return {
    // Modal states
    showRequestProModal,
    setShowRequestProModal,
    showRequestProSelfieModal,
    setShowRequestProSelfieModal,
    
    // Loading states
    requestProLoading,
    requestProLocationLoading,
    
    // Configuration
    estimatedDuration,
    setEstimatedDuration,
    inviteFriends,
    setInviteFriends,
    boostHours,
    setBoostHours,
    
    // Dispatch tracking
    activeDispatchId,
    setActiveDispatchId,
    pendingRequestPro,
    setPendingRequestPro,
    
    // Actions
    openRequestProModal,
    handleLocationAcquired,
    submitRequestPro,
    cancelRequest,
    resetRequestPro
  };
};

export default useRequestPro;
