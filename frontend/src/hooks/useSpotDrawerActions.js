/**
 * useSpotDrawerActions.js
 * Extracted from UnifiedSpotDrawer.js — handler logic for spot drawer data & actions.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

var useSpotDrawerActions = ({
  user,
  spotId,
  navigate,
  updateUser,
  setLiveWaveHeight,
  setSpotOfTheDay,
  setConditionReports,
  setProPhotos,
  setCommunityPhotos,
  setPricingData,
  setJoinLoading,
}) => {

  const fetchLiveWaveHeight = async () => {
    if (!spotId) return;
    try {
      const response = await apiClient.get(`/surf-spots/${spotId}/wave-height`);
      setLiveWaveHeight(response.data);
    } catch (error) {
      logger.debug('Wave height data not available');
    }
  };

  const fetchSpotOfTheDay = async () => {
    try {
      const response = await apiClient.get('/surf-spots/spot-of-the-day');
      setSpotOfTheDay(response.data);
    } catch (error) {
      logger.debug('Spot of the day not available');
    }
  };

  const fetchConditionReports = async () => {
    if (!spotId) return;
    try {
      const response = await apiClient.get(`/surf-spots/${spotId}/condition-reports`);
      setConditionReports(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch condition reports:', error);
    }
  };

  const fetchProPhotos = async () => {
    if (!spotId) return;
    try {
      const response = await apiClient.get(`/surf-spots/${spotId}/pro-photos`);
      setProPhotos(response.data || []);
    } catch (error) {
      logger.debug('Pro photos not available');
    }
  };

  const fetchCommunityPhotos = async () => {
    if (!spotId) return;
    try {
      const response = await apiClient.get(`/surf-spots/${spotId}/community-photos`);
      setCommunityPhotos(response.data || []);
    } catch (error) {
      logger.debug('Community photos not available');
    }
  };

  const fetchPricing = async () => {
    if (!spotId) return;
    try {
      const response = await apiClient.get(`/surf-spots/${spotId}/pricing`);
      setPricingData(response.data);
    } catch (error) {
      logger.debug('Pricing data not available');
    }
  };

  const handleJoinSession = async (photographerId, sessionType) => {
    if (!user?.id) {
      toast.error('Please log in to join');
      return;
    }
    setJoinLoading(true);
    try {
      const response = await apiClient.post('/sessions/join', {
        user_id: user.id,
        photographer_id: photographerId,
        session_type: sessionType || 'live'
      });
      if (response.data?.remaining_credits !== undefined) {
        updateUser?.({ credit_balance: response.data.remaining_credits });
      }
      toast.success('Successfully joined session!');
      return response.data;
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to join session');
    } finally {
      setJoinLoading(false);
    }
  };

  return {
    fetchLiveWaveHeight,
    fetchSpotOfTheDay,
    fetchConditionReports,
    fetchProPhotos,
    fetchCommunityPhotos,
    fetchPricing,
    handleJoinSession,
  };
};

export default useSpotDrawerActions;
