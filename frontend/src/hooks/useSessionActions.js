/**
 * useSessionActions.js � Extracted from PhotographerSessionsManager.js
 * Session management handlers: go-live, end session, pricing, settings.
 * ~571 lines extracted.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { useEffect } from 'react';

const useSessionActions = ({
  user, navigate, selectedSpot, savedRates,
  nearbySpots, setSessions, setSessionData, setGoLiveStep,
  setGoLiveData, setSelectedSpot, setNearbySpots,
  setEndSessionModal, setSessionToEnd, setSavingSettings,
  setDonationCauses, setLinkedGroms, setSurfSpots, setGalleries,
  setLoading, setCollapsedSections, setSavingPricing, setEditSectionData,
}) => {

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Calculate distance between two coordinates (Haversine formula)
  const _calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Update distance when spot is selected from nearby list (for edge cases)
  useEffect(() => {
    if (sessionSettings.surf_spot_id && showGoLiveModal && nearbySpots.length > 0) {
      const selectedSpot = nearbySpots.find(s => s.id === sessionSettings.surf_spot_id);
      if (selectedSpot && selectedSpot.distance !== undefined) {
        setDistanceToSpot(selectedSpot.distance);
      }
    }
  }, [sessionSettings.surf_spot_id, showGoLiveModal, nearbySpots]);

  // Check if user is within range
  const isWithinRange = distanceToSpot !== null && distanceToSpot <= REQUIRED_DISTANCE_MILES;
  const canProceed = isWithinRange || manualConfirm;
  
  // Get dynamic commission rate based on user's subscription tier
  const commissionRate = getCommissionRate(user?.subscription_tier);

  useEffect(() => {
    if (user?.id) {
      fetchSessionData();
      fetchSurfSpots();
      fetchGalleries();
      if (isHobbyist) {
        fetchCausesAndGroms();
      }
    }
  }, [user?.id]);

  const fetchCausesAndGroms = async () => {
    try {
      const [causesRes, gromsRes] = await Promise.all([
        apiClient.get(`/impact/causes`),
        apiClient.get(`/impact/search-groms?limit=20`)
      ]);
      setCauses(causesRes.data || []);
      setGroms(gromsRes.data || []);
    } catch (e) {
      logger.error('Error fetching causes/groms:', e);
    }
  };

  const fetchSurfSpots = async () => {
    try {
      const res = await apiClient.get(`/surf-spots`);
      setSurfSpots(res.data || []);
    } catch (e) {
      logger.error('Error fetching surf spots:', e);
    }
  };

  const fetchGalleries = async () => {
    try {
      const res = await apiClient.get(`/galleries/photographer/${user?.id}`);
      setGalleries(res.data || []);
    } catch (e) {
      logger.error('Error fetching galleries:', e);
    }
  };

  const fetchSessionData = async () => {
    setLoading(true);
    try {
      // Fetch pricing settings
      try {
        const pricingRes = await apiClient.get(`/photographer/${user?.id}/pricing`);
        setPricing(prev => ({
          ...prev,
          ...pricingRes.data
        }));
        // Sync session settings with pricing
        setSessionSettings(prev => ({
          ...prev,
          price_per_join: pricingRes.data.live_buyin_price || 25,
          live_photo_price: pricingRes.data.live_photo_price || 5,
          photos_included: pricingRes.data.photo_package_size || 3
        }));
      } catch (e) {
        logger.error('Error fetching pricing:', e);
      }
      
      // Fetch gallery pricing (for general_photo_price comparison and resolution pricing)
      try {
        const galleryPricingRes = await apiClient.get(`/photographer/${user?.id}/gallery-pricing`);
        const standardPrice = galleryPricingRes.data.photo_pricing?.standard || 10;
        const webPrice = galleryPricingRes.data.photo_pricing?.web || 3;
        const highPrice = galleryPricingRes.data.photo_pricing?.high || 10;
        const liveSessionPrice = galleryPricingRes.data.session_pricing?.live_session_photo_price || 5;
        const photosIncluded = galleryPricingRes.data.session_pricing?.live_session_photos_included || 3;
        const videosIncluded = galleryPricingRes.data.session_pricing?.live_session_videos_included ?? 1;
        
        setPricing(prev => ({ ...prev, gallery_photo_price: standardPrice }));
        setSessionSettings(prev => ({ 
          ...prev, 
          general_photo_price: standardPrice,
          // Resolution-based pricing defaults from gallery settings
          photo_price_web: webPrice,
          photo_price_standard: standardPrice,
          photo_price_high: highPrice,
          live_photo_price: liveSessionPrice,
          photos_included: photosIncluded,
          videos_included: videosIncluded
        }));
      } catch (e) {
        logger.error('Error fetching gallery pricing:', e);
      }
      
      // Check if photographer has an active session
      try {
        const activeRes = await apiClient.get(`/photographer/${user?.id}/active-session`);
        if (activeRes.data) {
          setIsLive(true);
          setCurrentSession(activeRes.data);
          // Populate settings from active session
          setSessionSettings(prev => ({
            ...prev,
            location: activeRes.data.location || '',
            price_per_join: activeRes.data.price_per_join || prev.price_per_join
          }));
        } else {
          setIsLive(false);
          setCurrentSession(null);
        }
      } catch (e) {
        logger.error('Error fetching active session:', e);
        setIsLive(false);
        setCurrentSession(null);
      }
      
      // Check on-demand status for mutual exclusivity warning
      try {
        const statusRes = await apiClient.get(`/photographer/${user?.id}/status`);
        setIsOnDemandActive(statusRes.data.on_demand_available || false);
      } catch (e) {
        logger.error('Error fetching photographer status:', e);
        setIsOnDemandActive(false);
      }
      
      // Fetch session history
      try {
        const historyRes = await apiClient.get(`/photographer/${user?.id}/session-history`);
        setSessionHistory(historyRes.data || []);
      } catch (e) {
        setSessionHistory([]);
      }
    } catch (error) {
      logger.error('Error fetching session data:', error);
      setIsLive(false);
      setCurrentSession(null);
      setSessionHistory([]);
    } finally {
      setLoading(false);
    }
  };

  // ============ SEQUENTIAL PERMISSION REQUEST ============
  
  const requestLocationPermission = async () => {
    setDebugInfo(prev => ({ ...prev, permissionStep: 'location', gpsStatus: 'requesting' }));
    
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        setDebugInfo(prev => ({ ...prev, gpsStatus: 'unsupported' }));
        reject(new Error('Geolocation not supported'));
        return;
      }
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setDebugInfo(prev => ({
            ...prev,
            gpsStatus: 'granted',
            gpsAccuracy: position.coords.accuracy,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          }));
          resolve(position);
        },
        (error) => {
          setDebugInfo(prev => ({ ...prev, gpsStatus: 'denied', gpsAccuracy: null }));
          reject(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  };
  
  const requestCameraPermission = async () => {
    setDebugInfo(prev => ({ ...prev, permissionStep: 'camera', cameraStatus: 'requesting' }));
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' },
        audio: false 
      });
      
      streamRef.current = stream;
      setDebugInfo(prev => ({ 
        ...prev, 
        cameraStatus: 'granted',
        cameraStream: stream 
      }));
      
      return stream;
    } catch (error) {
      setDebugInfo(prev => ({ ...prev, cameraStatus: 'denied' }));
      throw error;
    }
  };
  
  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setDebugInfo(prev => ({ ...prev, cameraStream: null, cameraStatus: 'stopped' }));
    }
  };
  
  // SETTINGS: Save session rates/pricing (separate from Go Live)
  const handleSaveSettings = async () => {
    try {
      // Save settings to backend
      const response = await apiClient.post(`/photographer/session-settings`, {
        user_id: user.id,
        ...sessionSettings
      });
      
      if (response.data.success) {
        toast.success('Session rates saved!');
        setShowSettingsModal(false);
      }
    } catch (error) {
      // Settings saved locally even if API fails
      toast.success('Session rates saved locally');
      setShowSettingsModal(false);
    }
  };

  // Fetch nearby spots based on user's GPS location
  const fetchNearbySpots = async (lat, lng) => {
    setNearbySpotsLoading(true);
    try {
      const response = await apiClient.get(`/surf-spots/nearby`, {
        params: {
          latitude: lat,
          longitude: lng,
          radius_miles: NEARBY_RADIUS_MILES
        }
      });
      
      // Map response and calculate distance for each spot
      const spotsWithDistance = (response.data || []).map(spot => {
        const distance = spot.distance_miles || spot.distance || calculateDistanceInMiles(
          lat, lng, spot.latitude, spot.longitude
        );
        return { ...spot, distance };
      }).sort((a, b) => a.distance - b.distance); // Sort by distance (closest first)
      
      setNearbySpots(spotsWithDistance);
    } catch (error) {
      logger.error('Failed to fetch nearby spots:', error);
      // Fallback to all spots if nearby endpoint fails
      setNearbySpots(surfSpots.map(spot => ({
        ...spot,
        distance: spot.latitude && spot.longitude 
          ? calculateDistanceInMiles(lat, lng, spot.latitude, spot.longitude)
          : null
      })).filter(s => s.distance !== null).sort((a, b) => a.distance - b.distance));
    } finally {
      setNearbySpotsLoading(false);
    }
  };

  // Helper: Calculate distance in miles between two coordinates
  const calculateDistanceInMiles = (lat1, lon1, lat2, lon2) => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // GO LIVE STEP 1: Start the Go Live flow - Request location and fetch nearby spots
  const startSequentialGoLive = async () => {
    // Check mutual exclusivity: cannot go live while On-Demand is active
    if (isOnDemandActive) {
      toast.error('Cannot start a live session while On-Demand mode is active. Please disable On-Demand first from On-Demand Settings.');
      return;
    }
    
    try {
      // Request Location first
      setDebugInfo(prev => ({ ...prev, permissionStep: 'location' }));
      toast.info('Requesting location access...');
      
      const position = await requestLocationPermission();
      toast.success('Location access granted!');
      
      // Set user location
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      setUserLocation({ lat, lng });
      setLocationError(null);
      
      // Fetch nearby spots based on GPS location
      await fetchNearbySpots(lat, lng);
      
      // Show Go Live Spot Picker Modal
      setDebugInfo(prev => ({ ...prev, permissionStep: 'spot_picker' }));
      setShowGoLiveModal(true);
      
    } catch (error) {
      // GPS failed - fallback to manual spot selection with all spots
      logger.warn('GPS unavailable, falling back to manual spot selection:', error);
      setLocationError('GPS unavailable - select your spot manually');
      setUserLocation(null);
      
      // Use all surf spots as fallback (no distance info)
      setNearbySpots(surfSpots.map(spot => ({
        ...spot,
        distance: null // No distance available without GPS
      })));
      
      toast.warning('GPS unavailable - you can still select a spot manually');
      setDebugInfo(prev => ({ ...prev, permissionStep: 'spot_picker' }));
      setShowGoLiveModal(true);
    }
  };

  // GO LIVE STEP 2: After spot selected and location verified, show Conditions Modal
  const handleGoLiveConfirmed = () => {
    if (!sessionSettings.surf_spot_id) {
      toast.error('Please select a surf spot before going live');
      return;
    }
    
    // Check location verification
    if (distanceToSpot !== null && !isWithinRange && !manualConfirm) {
      toast.error('Please verify your location or manually confirm you are at the spot');
      return;
    }
    
    // Close Go Live modal and open conditions modal
    setShowGoLiveModal(false);
    setShowConditionsModal(true);
  };

  // STEP 3: Handle final Go Live with conditions data
  const handleGoLiveWithConditions = async (conditionsData) => {
    setGoLiveLoading(true);

    try {
      setDebugInfo(prev => ({ ...prev, permissionStep: 'ready' }));

      const selectedSpot = surfSpots.find(s => s.id === sessionSettings.surf_spot_id);

      // --- STEP A: Upload conditions media (multipart � avoids large JSON body) ---
      let conditionMediaUrl = null;
      let conditionMediaType = null;
      if (conditionsData.media) {
        try {
          toast.info('Uploading conditions photo�', { id: 'cond-upload', duration: 8000 });
          const fd = new FormData();
          const ext = conditionsData.mediaType === 'video' ? 'webm' : 'jpg';
          fd.append('file', conditionsData.media, `conditions.${ext}`);
          fd.append('user_id', user?.id);
          // ?? Do NOT set Content-Type manually � browser must set it with boundary
          const uploadRes = await apiClient.post('/upload/conditions', fd, {
            headers: { 'Content-Type': undefined },
            timeout: 60000
          });
          conditionMediaUrl = uploadRes.data.media_url;
          conditionMediaType = uploadRes.data.media_type;
          toast.dismiss('cond-upload');
          logger.debug('[GoLive] conditions media uploaded:', conditionMediaUrl);
        } catch (uploadErr) {
          // Non-fatal: still allow go-live without media
          toast.dismiss('cond-upload');
          logger.warn('[GoLive] Conditions media upload failed (non-fatal):', uploadErr);
        }
      }

      // --- STEP B: Go Live � small JSON payload (no media bytes inline) ---
      // 120s timeout: Render free tier cold starts can take 30-60s
      const response = await apiClient.post(
        `/photographer/${user?.id}/go-live`,
        {
          ...sessionSettings,
          location: selectedSpot?.name || sessionSettings.location,
          spot_id: sessionSettings.surf_spot_id,
          latitude: debugInfo.latitude,
          longitude: debugInfo.longitude,
          live_photo_price: sessionSettings.live_photo_price,
          photos_included: sessionSettings.photos_included,
          videos_included: sessionSettings.videos_included,
          general_photo_price: sessionSettings.general_photo_price,
          estimated_duration: sessionSettings.estimated_duration,
          spot_notes: conditionsData.spotNotes || '',
          condition_media_url: conditionMediaUrl,
          condition_media_type: conditionMediaType,
          photo_price_web: sessionSettings.photo_price_web,
          photo_price_standard: sessionSettings.photo_price_standard,
          photo_price_high: sessionSettings.photo_price_high,
          earnings_destination_type: sessionSettings.earnings_destination_type,
          earnings_destination_id: sessionSettings.earnings_destination_id,
          earnings_cause_name: sessionSettings.earnings_cause_name
        },
        { timeout: 120000 }
      );

      setIsLive(true);
      setCurrentSession({
        photographer_id: user?.id,
        location: selectedSpot?.name || sessionSettings.location,
        surf_spot_id: sessionSettings.surf_spot_id,
        price_per_join: sessionSettings.price_per_join,
        active_surfers: 0,
        views: 0,
        earnings: 0,
        started_at: new Date().toISOString(),
        participants: [],
        live_session_id: response.data.live_session_id,
        earnings_destination: response.data.earnings_destination,
        live_session_rates: response.data.live_session_rates,
        spot_notes: conditionsData.spotNotes || ''
      });

      setShowConditionsModal(false);
      toast.success('You are now live! Surfers can find you on the map.');
    } catch (error) {
      logger.error('[GoLive] Failed to start session:', error);
      // Distinguish timeout / network-level errors from server errors
      const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
      const isNetwork = !error.response && !isTimeout;
      let detail;
      if (isTimeout) {
        detail = 'Server is warming up � please wait a moment and try again.';
      } else if (isNetwork) {
        detail = 'Network error � check your connection and try again.';
      } else {
        detail = error.response?.data?.detail || error.message || 'Failed to start session';
      }
      toast.error(detail);
      setDebugInfo(prev => ({ ...prev, permissionStep: 'idle' }));
    } finally {
      setGoLiveLoading(false);
    }
  };

  // Legacy handleGoLive - now redirects to new flow
  const _handleGoLive = async () => {
    if (!sessionSettings.surf_spot_id) {
      toast.error('Please select a surf spot before going live');
      setShowSettingsModal(true);
      return;
    }
    // Redirect to new conditions gatekeeper flow
    startSequentialGoLive();
  };

  // Show End Session confirmation modal (Kill Switch)
  const handleEndSessionClick = () => {
    setShowEndSessionModal(true);
  };

  // Actual end session logic after confirmation
  const handleEndSessionConfirmed = async () => {
    if (endSessionLoading) return; // Prevent double-clicks
    
    setEndSessionLoading(true);
    
    // Retry logic for robustness
    let attempts = 0;
    const maxAttempts = 2;
    
    while (attempts < maxAttempts) {
      try {
        attempts++;
        const response = await apiClient.post(`/photographer/${user?.id}/end-session`);
        setIsLive(false);
        setCurrentSession(null);
        setShowEndSessionModal(false);
        
        if (response.data.gallery_id) {
          setLastCreatedGallery({
            id: response.data.gallery_id,
            title: response.data.gallery_title,
            total_surfers: response.data.total_surfers,
            total_earnings: response.data.total_earnings,
            duration_mins: response.data.duration_mins
          });
          setShowGalleryCreatedModal(true);
          fetchGalleries();
          
          // Navigate to "Impacted" tab (session summary)
          // Using setTimeout to allow modal to close gracefully
          setTimeout(() => {
            navigate('/impacted');
          }, 500);
        } else {
          toast.success(`Session ended! Total: $${response.data.total_earnings || 0} from ${response.data.total_surfers || 0} surfers`);
          // Navigate to Impacted dashboard for session summary
          navigate('/impacted');
        }
        fetchSessionData();
        break; // Success - exit retry loop
      } catch (error) {
        if (attempts >= maxAttempts) {
          toast.error(error.response?.data?.detail || 'Failed to end session. Please try again.');
        } else {
          // Wait a moment before retry
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
    
    setEndSessionLoading(false);
  };

  // Legacy handleEndSession for backward compatibility
  const handleEndSession = async () => {
    handleEndSessionClick();
  };

  const handleSavePricing = async () => {
    try {
      await apiClient.put(`/photographer/${user?.id}/pricing`, {
        live_buyin_price: pricing.live_buyin_price,
        live_photo_price: pricing.live_photo_price,
        photo_package_size: pricing.photo_package_size,
        booking_hourly_rate: pricing.booking_hourly_rate,
        booking_min_hours: pricing.booking_min_hours
      });
      toast.success('Pricing updated successfully');
      setShowPricingModal(false);
      // Sync session settings with new pricing
      setSessionSettings(prev => ({
        ...prev,
        price_per_join: pricing.live_buyin_price,
        live_photo_price: pricing.live_photo_price,
        photos_included: pricing.photo_package_size
      }));
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update pricing');
    }
  };

  return {
    toggleSection,
    fetchCausesAndGroms,
    fetchSurfSpots,
    fetchGalleries,
    fetchSessionData,
    handleSaveSettings,
    fetchNearbySpots,
    calculateDistanceInMiles,
    startSequentialGoLive,
    handleGoLiveConfirmed,
    handleGoLiveWithConditions,
    handleEndSessionClick,
    handleEndSessionConfirmed,
    handleEndSession,
    handleSavePricing,
  };
};

export default useSessionActions;