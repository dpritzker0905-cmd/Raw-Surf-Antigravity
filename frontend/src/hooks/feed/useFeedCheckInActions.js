/**
 * useFeedCheckInActions -- Extracted from useFeedActions.js (v77)
 * Handles: check-in flow, GPS location, spot fetching, location hierarchy,
 * streak management, passport XP integration
 */
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';
import logger from '../../utils/logger';

const useFeedCheckInActions = ({
  user, spots, nearestSpot, checkInData, streak,
  // State setters
  setCheckInData, setCheckInLoading, setCheckInReward,
  setGpsLoading, setLocationHierarchy, setNearestSpot,
  setSelectedCity, setSelectedCountry, setSelectedState,
  setShowCheckInModal, setSpots, setStreak,
}) => {

  const fetchStreak = async () => {
    if (!user?.id) return;
    try {
      const response = await apiClient.get(`/streak/${user.id}`);
      setStreak(response.data);
    } catch (error) {
      logger.error('Error fetching streak:', error);
    }
  };

  // Lazy-loaded: only fetches if spots array is empty (deferred until check-in)
  const fetchSpots = async () => {
    try {
      const response = await apiClient.get(`/surf-spots`);
      setSpots(response.data);
    } catch (error) {
      logger.error('Error fetching spots:', error);
    }
  };

  // Lazy-loaded: only fetches if hierarchy is empty (deferred until check-in)
  const fetchLocationHierarchy = async () => {
    try {
      const response = await apiClient.get(`/surf-spots/locations`);
      setLocationHierarchy(response.data || { countries: [] });
    } catch (error) {
      logger.error('Error fetching location hierarchy:', error);
    }
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const getGpsLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }

    setGpsLoading(true);

    const handlePosition = (position) => {
      const { latitude, longitude } = position.coords;

      // Find nearest spot
      let nearest = null;
      let minDistance = Infinity;
      spots.forEach(spot => {
        const distance = calculateDistance(latitude, longitude, spot.latitude, spot.longitude);
        if (distance < minDistance) {
          minDistance = distance;
          nearest = { ...spot, distance: distance.toFixed(1) };
        }
      });

      setCheckInData(prev => ({
        ...prev,
        latitude,
        longitude,
        use_gps: true,
        spot_id: nearest && minDistance < 10 ? nearest.id : prev.spot_id
      }));

      setNearestSpot(nearest);
      if (nearest && minDistance < 10) {
 toast.success(`= At ${nearest.name} (${nearest.distance}km) - GPS verified, you'll earn XP!`);
      } else if (nearest) {
 toast.success(`= Location found. Nearest spot: ${nearest.name} (${nearest.distance}km)`);
      } else {
 toast.success('= Location detected - select your spot to earn XP');
      }
      setGpsLoading(false);
    };

    const handleErrorFinal = (error) => {
      setGpsLoading(false);
      if (error.code === 1) { // PERMISSION_DENIED
        toast.error(
          navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')
            ? 'Location denied. Go to Settings \u2192 Privacy \u2192 Location Services \u2192 Safari \u2192 While Using.'
            : 'Location access denied. Please enable it in your browser settings.'
        );
      } else if (error.code === 3) { // TIMEOUT
        toast.error('Location timed out. Tap again or select your spot manually below.');
      } else {
        toast.error('Unable to detect location. Select your spot manually below.');
      }
    };

    const handleErrorWithRetry = (error) => {
      if (error.code === 2 || error.code === 3) {
        // POSITION_UNAVAILABLE or TIMEOUT - retry with high accuracy & fresh fix
        navigator.geolocation.getCurrentPosition(
          handlePosition,
          handleErrorFinal,
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      } else {
        handleErrorFinal(error);
      }
    };

    // First attempt: low-accuracy / cached - fast on most devices
    navigator.geolocation.getCurrentPosition(
      handlePosition,
      handleErrorWithRetry,
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 30000 }
    );
  };

  const handleCheckIn = async () => {
    if (streak.checked_in_today) {
 toast.info('You already checked in today! Keep the streak going tomorrow =');
      return;
    }
    // Lazy-load spots + location hierarchy on first check-in open
    if (spots.length === 0) fetchSpots();
    fetchLocationHierarchy();
    setShowCheckInModal(true);
  };

  const submitCheckIn = async () => {
    setCheckInLoading(true);

    const spotId = checkInData.spot_id || nearestSpot?.id;
    const spotName = spotId
      ? (spots.find(s => s.id === spotId)?.name || nearestSpot?.name || 'Unknown Spot')
      : 'Custom Location';

    try {
      if (checkInData.use_gps && checkInData.latitude && checkInData.longitude && spotId) {
 // GPS path -- Passport check-in (XP + stamps + badges)
        const passportResponse = await apiClient.post(`/passport/checkin`, {
          spot_id: spotId,
          latitude: checkInData.latitude,
          longitude: checkInData.longitude,
          notes: checkInData.notes || null
        });

        if (!passportResponse.data.success) {
          toast.error(passportResponse.data.message || `You're too far from ${spotName} to check in`);
          setCheckInLoading(false);
          return;
        }

        // Also update legacy streak (best-effort)
        try {
          const streakResponse = await apiClient.post(`/check-in`, {
            spot_id: spotId,
            spot_name: spotName,
            conditions: checkInData.conditions || null,
            wave_height: checkInData.wave_height || null,
            notes: checkInData.notes || null,
            latitude: checkInData.latitude,
            longitude: checkInData.longitude,
            use_gps: true
          });
          setStreak({
            current_streak: streakResponse.data.current_streak,
            longest_streak: streakResponse.data.longest_streak,
            total_check_ins: streakResponse.data.total_check_ins,
            checked_in_today: true
          });
        } catch (streakError) {
          if (streakError.response?.data?.detail !== 'Already checked in today') {
            logger.warn('Legacy streak update failed:', streakError);
          }
          setStreak(prev => ({ ...prev, checked_in_today: true }));
        }

        // Show gamification reward card in modal instead of plain toast
        setCheckInReward({
          spot_name: spotName,
          xp_earned: passportResponse.data.xp_earned,
          badge_earned: passportResponse.data.badge_earned,
          is_first_visit: passportResponse.data.is_first_visit,
          streak_days: passportResponse.data.streak_days,
          new_level: passportResponse.data.new_level,
        });

      } else {
 // Manual (non-GPS) path -- legacy streak only, no passport XP
        const response = await apiClient.post(`/check-in`, {
          spot_id: spotId || null,
          spot_name: spotName,
          conditions: checkInData.conditions || null,
          wave_height: checkInData.wave_height || null,
          notes: checkInData.notes || null,
          latitude: checkInData.latitude,
          longitude: checkInData.longitude,
          use_gps: checkInData.use_gps
        });

        setStreak({
          current_streak: response.data.current_streak,
          longest_streak: response.data.longest_streak,
          total_check_ins: response.data.total_check_ins,
          checked_in_today: true
        });

 toast.success(`Checked in! = ${response.data.current_streak} day streak!`);
        // Close immediately for manual check-in
        setShowCheckInModal(false);
        setCheckInData({ spot_id: '', conditions: '', wave_height: '', notes: '', latitude: null, longitude: null, use_gps: false });
        setNearestSpot(null);
        setSelectedCountry('');
        setSelectedState('');
        setSelectedCity('');
      }

    } catch (error) {
      if (error.response?.data?.detail === 'Already checked in today') {
        toast.info('You already checked in today!');
        setStreak(prev => ({ ...prev, checked_in_today: true }));
      } else {
        const errorMsg = error.response?.data?.message || error.response?.data?.detail || 'Failed to check in';
        toast.error(errorMsg);
      }
    } finally {
      setCheckInLoading(false);
    }
  };

  const closeCheckInModal = () => {
    setShowCheckInModal(false);
    setCheckInReward(null);
    setCheckInData({ spot_id: '', conditions: '', wave_height: '', notes: '', latitude: null, longitude: null, use_gps: false });
    setNearestSpot(null);
    setSelectedCountry('');
    setSelectedState('');
    setSelectedCity('');
  };

  return {
    fetchStreak,
    fetchSpots,
    fetchLocationHierarchy,
    calculateDistance,
    getGpsLocation,
    handleCheckIn,
    submitCheckIn,
    closeCheckInModal,
  };
};

export default useFeedCheckInActions;
