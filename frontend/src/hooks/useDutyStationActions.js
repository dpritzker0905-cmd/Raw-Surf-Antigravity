import { useCallback } from 'react';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';
import { calculateDistance, metersToMiles } from '../components/on-demand/dutyStationConstants';

export const useDutyStationActions = ({
  user,
  userLocation,
  radiusConfig,
  showOnDemand,
  onDemandActive,
  selectedSpot,
  selectedSpots,
  pricingConfig,
  setLiveActive,
  setOnDemandActive,
  setSelectedSpot,
  setSelectedSpots,
  setAvailableSpots,
  setSpotsLoading,
  setLoading,
  setNearbyShooters,
  setProximityConfirmed,
  setStats,
  setShowConditionsModal,
  gpsAvailable,
  setGpsAvailable
}) => {

  const fetchStatuses = async () => {
    try {
      const liveResponse = await apiClient.get(`/photographer/${user.id}/status`);
      const liveData = liveResponse.data;
      setLiveActive(liveData?.is_shooting || false);
      
      if (liveData?.is_shooting && liveData?.current_spot_id) {
        setSelectedSpot({
          id: liveData.current_spot_id,
          name: liveData.current_spot_name,
          latitude: liveData.current_spot_latitude,
          longitude: liveData.current_spot_longitude
        });
        setProximityConfirmed(true);
      }
      
      if (showOnDemand) {
        const onDemandResponse = await apiClient.get(`/photographer/${user.id}/on-demand-status`);
        const onDemandData = onDemandResponse.data;
        setOnDemandActive(onDemandData?.is_available || false);
        
        if (onDemandData?.is_available) {
          setSelectedSpots(onDemandData.active_spots || []);
        }
      }
      
      try {
        const statsResponse = await apiClient.get(`/photographer/${user.id}/daily-stats`);
        setStats(statsResponse.data || { todayEarnings: 0, sessionsToday: 0 });
      } catch (e) { /* daily stats optional */ }
    } catch (error) {
      logger.error('Failed to fetch statuses:', error);
      setLiveActive(false);
      setOnDemandActive(false);
    }
  };

  const forceEndStaleSession = async () => {
    try {
      setLoading(true);
      await apiClient.post(`/photographer/${user.id}/end-session`);
      setLiveActive(false);
      setSelectedSpot(null);
      toast.success('Previous session ended. You can now go live again.');
      await fetchStatuses();
    } catch (err) {
      const errDetail = err.response?.data?.detail;
      if (errDetail && errDetail.toLowerCase().includes('no active session')) {
        setLiveActive(false);
        toast.success('Session already cleared. You can go live now.');
      } else {
        toast.error(`Could not end session: ${errDetail || err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableSpots = async () => {
    if (!userLocation) return;
    setSpotsLoading(true);
    try {
      const response = await apiClient.get(`/surf-spots/nearby`, {
        params: {
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          radius_miles: radiusConfig.max
        }
      });
      
      const spotsWithDistance = (response.data || []).map(spot => {
        const distance = spot.distance_miles || spot.distance || metersToMiles(
          calculateDistance(userLocation.lat, userLocation.lng, spot.latitude, spot.longitude)
        );
        return { ...spot, distance };
      }).filter(spot => spot.distance <= radiusConfig.max);
      
      setAvailableSpots(spotsWithDistance);
    } catch (error) {
      logger.error('Failed to fetch spots:', error);
      setAvailableSpots([]);
    } finally {
      setSpotsLoading(false);
    }
  };

  const fetchNearbyShooters = async () => {
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
          const response = await apiClient.get(`/photographers/live`, {
            params: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              radius: 25
            }
          });
          const others = (response.data || []).filter(p => p.id !== user?.id);
          setNearbyShooters(others.length);
        });
      }
    } catch (error) {
      logger.error('Failed to fetch nearby shooters:', error);
    }
  };

  const handleConditionsConfirm = async (conditionsData) => {
    setLoading(true);
    try {
      if (onDemandActive) {
        try {
          await apiClient.post(`/photographer/${user.id}/on-demand-toggle`, { is_available: false });
          setOnDemandActive(false);
          toast.info('Switching to Live mode. On-Demand disabled.');
        } catch (odErr) {
          logger.warn('[DutyStation] On-Demand toggle failed, backend will handle:', odErr);
        }
      }
      
      let conditionMediaUrl = null;
      let conditionMediaType = conditionsData?.mediaType || null;
      if (conditionsData?.media instanceof Blob) {
        try {
          const ext = conditionMediaType === 'video' ? '.webm' : '.jpg';
          const formData = new FormData();
          formData.append('file', conditionsData.media, `conditions${ext}`);
          formData.append('user_id', user.id);
          const uploadRes = await apiClient.post('/upload/conditions', formData, {
            headers: { 'Content-Type': undefined },
            timeout: 60000
          });
          conditionMediaUrl = uploadRes.data?.media_url;
          conditionMediaType = uploadRes.data?.media_type || conditionMediaType;
        } catch (uploadErr) {
          logger.warn('[DutyStation] Condition media upload failed (non-fatal):', uploadErr.message);
          conditionMediaUrl = null;
          conditionMediaType = null;
        }
      }
      
      const goLivePayload = {
        spot_id: selectedSpot.id,
        spot_name: selectedSpot.name,
        location: selectedSpot.name,
        latitude: userLocation?.lat || selectedSpot.latitude,
        longitude: userLocation?.lng || selectedSpot.longitude,
        price_per_join: pricingConfig.price_per_join,
        live_photo_price: pricingConfig.live_photo_price,
        photos_included: pricingConfig.photos_included,
        videos_included: pricingConfig.videos_included ?? 1,
        general_photo_price: pricingConfig.general_photo_price,
        photo_price_web: pricingConfig.photo_price_web,
        photo_price_standard: pricingConfig.photo_price_standard,
        photo_price_high: pricingConfig.photo_price_high,
        estimated_duration: pricingConfig.estimated_duration,
        max_surfers: pricingConfig.max_surfers,
        auto_accept: pricingConfig.auto_accept,
        condition_media_url: conditionMediaUrl || null,
        condition_media_type: conditionMediaType,
        spot_notes: conditionsData?.spotNotes || null,
        earnings_destination_type: pricingConfig.earnings_destination_type || null,
        earnings_destination_id: pricingConfig.earnings_destination_id || null,
        earnings_cause_name: pricingConfig.earnings_cause_name || null
      };
      
      const MAX_ATTEMPTS = 3;
      let lastError = null;
      
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          if (attempt > 1) {
            const retryDelay = attempt === 2 ? 5000 : 10000;
            toast.loading(`Server waking up - retry ${attempt - 1} of ${MAX_ATTEMPTS - 1}...`, { id: 'go-live-warmup' });
            await new Promise(r => setTimeout(r, retryDelay));
          } else {
            toast.loading('Connecting to server...', { id: 'go-live-warmup' });
          }
          
          try {
            await apiClient.get(`/photographer/${user.id}/status`, { timeout: 30000 });
          } catch (pingErr) {
            if (attempt === 1) {
              toast.loading('Server is starting up...', { id: 'go-live-warmup' });
              await new Promise(r => setTimeout(r, 8000));
              try {
                await apiClient.get(`/photographer/${user.id}/status`, { timeout: 30000 });
              } catch (secondPingErr) {}
            }
          }
          toast.dismiss('go-live-warmup');
          
          await apiClient.post(`/photographer/${user.id}/go-live`, goLivePayload, { timeout: 120000 });
          setLiveActive(true);
          setShowConditionsModal(false);
          toast.success(`Now live at ${selectedSpot.name}!`);
          return;
        } catch (err) {
          lastError = err;
          toast.dismiss('go-live-warmup');
          const hasResponse = !!err.response;
          if (hasResponse || attempt >= MAX_ATTEMPTS) break;
        }
      }
      throw lastError;
    } catch (error) {
      const detail = error.response?.data?.detail || '';
      const status = error.response?.status;
      if (status === 413) {
        toast.error('Media file too large. Please use a shorter video or lower-quality photo.');
      } else if (status === 400 && detail.toLowerCase().includes('already')) {
        toast.error('You have a stale live session blocking new activations.', {
          duration: 8000,
          action: { label: 'End Stale Session', onClick: () => forceEndStaleSession() }
        });
      } else if (status === 409) {
        toast.error('Session conflict detected. Please refresh and try again.');
      } else if (detail) {
        toast.error(`Go-live error: ${detail}`);
      } else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        toast.error('Server is warming up - please wait a moment and try again.', { duration: 6000 });
      } else if (!error.response) {
        toast.error('Could not reach the server after retrying. Please check your connection and try again.', { duration: 8000 });
      } else {
        toast.error('Failed to go live. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleActivateOnDemand = async () => {
    if (selectedSpots.length === 0) {
      toast.error('Please select at least one spot');
      return;
    }
    if (!gpsAvailable) {
      toast.error('GPS is required for On-Demand mode');
      return;
    }
    setLoading(true);
    try {
      if (liveActive) {
        await apiClient.post(`/photographer/${user.id}/end-session`);
        setLiveActive(false);
        toast.info('Switching to On-Demand mode. Live session ended.');
      }
      await apiClient.post(`/photographer/${user.id}/on-demand-toggle`, {
        is_available: true,
        spots: selectedSpots.map(s => ({ id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude }))
      });
      setOnDemandActive(true);
      toast.success(`On-Demand activated for ${selectedSpots.length} spot${selectedSpots.length !== 1 ? 's' : ''}!`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to activate On-Demand');
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivateLive = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/photographer/${user.id}/end-session`);
      setLiveActive(false);
      setSelectedSpot(null);
      setProximityConfirmed(false);
      toast.success('Live session ended');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to end session');
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivateOnDemand = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/photographer/${user.id}/on-demand-toggle`, { is_available: false });
      setOnDemandActive(false);
      setSelectedSpots([]);
      toast.success('On-Demand mode deactivated');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  return {
    fetchStatuses,
    forceEndStaleSession,
    fetchAvailableSpots,
    fetchNearbyShooters,
    handleConditionsConfirm,
    handleActivateOnDemand,
    handleDeactivateLive,
    handleDeactivateOnDemand
  };
};

export default useDutyStationActions;
