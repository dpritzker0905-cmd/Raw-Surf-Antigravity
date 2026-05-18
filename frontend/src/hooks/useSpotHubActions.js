/**
 * useSpotHubActions.js
 * Extracted from SpotHub.js G handler logic for spot detail pages.
 * v32: Rewritten to match actual SpotHub.js handler implementations.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

const useSpotHubActions = ({
  user,
  spotId,
  navigate,
  userTier,
  // Setters
  setSpot,
  setSpotDetails,
  setActivePhotographers,
  setConditionReports,
  setSurfReports,
  setPhotographerPosts,
  setUserPosts,
  setLoading,
  setUserLocation,
  setIsWithinProximity,
  setLivePulse,
  setPulseLoading,
  setCrowdPrediction,
  setOptimalTime,
  setIntelLoading,
  setShowBookingModal,
  setSelectedPhotographer,
  setShowScheduledDrawer,
  setShowRequestModal,
}) => {

  // Calculate distance between two coordinates in miles
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Check user's proximity to the spot
  const checkProximity = (spotLat, spotLng) => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation({ lat: latitude, lng: longitude });
          
          if (spotLat && spotLng) {
            const distance = calculateDistance(latitude, longitude, spotLat, spotLng);
            // If within 1 mile, user can see all photographers regardless of subscription
            setIsWithinProximity(distance <= 1);
          }
        },
        (error) => {
          logger.debug('Could not get user location:', error);
          setIsWithinProximity(false);
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
  };

  // Fetch live shooting pulse - permission-gated visibility
  const fetchLivePulse = async () => {
    if (!spotId) return;
    try {
      setPulseLoading(true);
      const viewerId = user?.id || '';
      const response = await apiClient.get(`/surf-spots/${spotId}/live-shooting-pulse?viewer_id=${viewerId}`);
      setLivePulse(response.data);
    } catch (error) {
      logger.error('Error fetching live pulse:', error);
      // Don't show error toast - pulse is a nice-to-have feature
    } finally {
      setPulseLoading(false);
    }
  };

  const fetchAllSpotData = async () => {
    setLoading(true);
    try {
      // Fetch spot details with forecast
      const detailsResponse = await apiClient.get(`/explore/spot-details/${spotId}?subscription_tier=${userTier}`);
      if (detailsResponse.data.error) {
        toast.error(detailsResponse.data.error);
        setLoading(false);
        return;
      }
      setSpotDetails(detailsResponse.data);
      setSpot(detailsResponse.data);
      
      // Check user's proximity to the spot
      if (detailsResponse.data.latitude && detailsResponse.data.longitude) {
        checkProximity(detailsResponse.data.latitude, detailsResponse.data.longitude);
      }
      
      // Active photographers come from spot-details response
      setActivePhotographers(detailsResponse.data.active_photographers || []);
      
      // Store surf reports from spot-details (SurfReport model - wave height, crowd, rating)
      setSurfReports(detailsResponse.data.recent_reports || []);
      
      // Fetch additional data in parallel
      const [reportsRes, postsRes] = await Promise.allSettled([
        apiClient.get(`/condition-reports/spot/${spotId}?limit=10&include_expired=true`),
        apiClient.get(`/posts/spot/${spotId}?limit=50&viewer_id=${user?.id || ''}`) // Only posts TAGGED to this spot
      ]);
      
      if (reportsRes.status === 'fulfilled') {
        setConditionReports(reportsRes.value.data.reports || reportsRes.value.data || []);
      }
      
      if (postsRes.status === 'fulfilled') {
        // Use the separated posts from the new endpoint
        setPhotographerPosts(postsRes.value.data.photographer_posts || []);
        setUserPosts(postsRes.value.data.user_posts || []);
      }
      
    } catch (error) {
      logger.error('Error fetching spot data:', error);
      toast.error('Failed to load spot information');
    } finally {
      setLoading(false);
    }
  };

  // Fetch intelligence data (crowd prediction + optimal time)
  const fetchIntelData = async (crowdPrediction) => {
    if (!spotId || crowdPrediction) return; // Don't refetch if already loaded
    setIntelLoading(true);
    try {
      const [crowdRes, optimalRes] = await Promise.allSettled([
        apiClient.get(`/surf-spots/${spotId}/crowd-prediction`),
        apiClient.get(`/surf-spots/${spotId}/optimal-time`),
      ]);
      if (crowdRes.status === 'fulfilled') setCrowdPrediction(crowdRes.value.data);
      if (optimalRes.status === 'fulfilled') setOptimalTime(optimalRes.value.data);
    } catch (err) {
      logger.error('Error fetching intel data:', err);
    } finally {
      setIntelLoading(false);
    }
  };

  // Report a condition report for moderation
  const handleReportConditionReport = async (reportId) => {
    if (!user) {
      toast.error('Please sign in to report content');
      return;
    }
    try {
      const res = await apiClient.post('/content/flag', {
        content_type: 'condition_report',
        content_id: reportId,
        reporter_id: user.id,
        reason: 'user_report'
      });
      // Backend returns "Already reported" message when duplicate
      if (res.data?.message === 'Already reported') {
        toast.info('You have already reported this content');
      } else {
        toast.success('Report submitted \u2013 our team will review it');
      }
    } catch (error) {
      const detail = error?.response?.data?.detail;
      if (typeof detail === 'string' && detail.toLowerCase().includes('already')) {
        toast.info('You have already reported this content');
      } else {
        logger.error('Error reporting condition report:', error);
        toast.error('Failed to submit report');
      }
    }
  };

  const handleClose = () => {
    navigate(-1);
  };

  // Handle booking type selection from modal
  const handleBookingTypeSelect = (bookingType, photographer) => {
    setShowBookingModal(false);
    
    switch (bookingType) {
      case 'live_active':
        // Navigate to the bookings page with live_now tab and photographer context
        navigate(`/bookings?tab=live_now&photographer=${photographer.id}&spot=${spotId}`);
        break;
      case 'on_demand':
        // Navigate to the bookings page with on_demand tab
        navigate(`/bookings?tab=on_demand&photographer=${photographer.id}&spot=${spotId}`);
        break;
      case 'scheduled':
        // Open the scheduled booking drawer
        setSelectedPhotographer(photographer);
        setShowScheduledDrawer(true);
        break;
      default:
        break;
    }
  };

  // Open booking modal for a specific photographer
  const handleOpenBookingModal = (photographer) => {
    if (!user) {
      toast.error('Please sign in to book a photographer');
      navigate('/auth?tab=signup');
      return;
    }
    setSelectedPhotographer(photographer);
    setShowBookingModal(true);
  };

  return {
    fetchAllSpotData,
    fetchLivePulse,
    fetchIntelData,
    handleReportConditionReport,
    handleClose,
    handleBookingTypeSelect,
    handleOpenBookingModal,
    checkProximity,
    calculateDistance,
  };
};

export default useSpotHubActions;
