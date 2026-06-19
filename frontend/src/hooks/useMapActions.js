import { useCallback } from 'react';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

const useMapActions = ({
  user, mapInstanceRef, selectedSpot,
  trackingMarkersRef, userMarkerRef, userAccuracyCircleRef,
  livePhotographers, surfSpots, userLocation, effectiveLocation,
  showRequestProModal, inviteFriends, currentUserShooting,
  isValidLatLng, truncateCoord, handleStartGoLiveFlow,
  setActiveOnDemandRequests,
  setActiveShootersAtSpot,
  setBottomSheetOpen,
  setCurrentLiveSpot,
  setFriendsList,
  setFriendsLoading,
  setLockedShooterCount,
  setOnDemandLoading,
  setOnDemandPhotographers,
  setSelectedPhotographer,
  setSelectedSpot,
  setUnifiedDrawerOpen,
}) => {

    const fetchOnDemandPros = useCallback(async () => {
      if (!showRequestProModal || !userLocation) return;
      
      setOnDemandLoading(true);
      try {
        const response = await apiClient.get(`/photographers/on-demand`, {
          params: {
            latitude: userLocation.lat,
            longitude: userLocation.lng,
            radius: 50 // 50 mile radius
          }
        });
        setOnDemandPhotographers(response.data || []);
      } catch (error) {
        logger.error('Error fetching on-demand photographers:', error);
        setOnDemandPhotographers([]);
      } finally {
        setOnDemandLoading(false);
      }
    }, [showRequestProModal, userLocation, setOnDemandLoading, setOnDemandPhotographers]);

    const fetchFriends = useCallback(async () => {
      if (!inviteFriends || !user?.id) return;
      
      setFriendsLoading(true);
      try {
        // Fetch mutual followers (friends)
        const response = await apiClient.get(`/profiles/${user.id}/friends`);
        setFriendsList(response.data || []);
      } catch (error) {
        logger.error('Error fetching friends:', error);
        // Fallback: try followers endpoint
        try {
          const followersRes = await apiClient.get(`/followers/${user.id}`);
          setFriendsList(followersRes.data?.filter(f => f.is_mutual) || []);
        } catch (e) {
          setFriendsList([]);
        }
      } finally {
        setFriendsLoading(false);
      }
    }, [inviteFriends, user?.id, setFriendsLoading, setFriendsList]);

    const fetchActiveRequests = useCallback(async () => {
      try {
        const response = await apiClient.get(`/dispatch/requests/pending`);
        setActiveOnDemandRequests(response.data || []);
      } catch (error) {
        logger.debug('No pending dispatch requests');
        setActiveOnDemandRequests([]);
      }
    }, [setActiveOnDemandRequests]);

  // Removed Leaflet tracking logic (updateTrackingMarkers, updateUserLocationMarker) 
  // as it is now natively handled by MapWebGL component via react-map-gl

  const fetchActiveShootersAtSpot = useCallback(async (spotId) => {
    try {
      // Filter live photographers who are at this spot
      const shootersAtSpot = livePhotographers.filter(
        p => p.current_spot_id === spotId || p.spot_id === spotId
      );
      setActiveShootersAtSpot(shootersAtSpot);
    } catch (error) {
      logger.error('Error fetching active shooters:', error);
      setActiveShootersAtSpot([]);
    }
  }, [livePhotographers, setActiveShootersAtSpot]);

  const handleSpotClick = useCallback((spot) => {
    // Clear any previous drawer state before mounting new one
    if (selectedSpot && selectedSpot.id !== spot.id) {
      // Different spot clicked - reset state
      setSelectedPhotographer(null);
      setActiveShootersAtSpot([]);
    }
    
    setSelectedSpot(spot);
    setSelectedPhotographer(null);
    // Lock the shooter count when opening spot details
    setLockedShooterCount(spot.active_photographers_count || 0);
    
    // Fetch active shooters at this spot
    fetchActiveShootersAtSpot(spot.id);
    
    // Open unified drawer instead of old bottom sheet
    setUnifiedDrawerOpen(true);
    setBottomSheetOpen(false);
  }, [selectedSpot, setSelectedSpot, setSelectedPhotographer, setActiveShootersAtSpot, setLockedShooterCount, fetchActiveShootersAtSpot, setUnifiedDrawerOpen, setBottomSheetOpen]);

  const handleCloseUnifiedDrawer = useCallback(() => {
    setUnifiedDrawerOpen(false);
    setActiveShootersAtSpot([]);
    setLockedShooterCount(null);
  }, [setUnifiedDrawerOpen, setActiveShootersAtSpot, setLockedShooterCount]);

  const handleStartShootingFromDrawer = useCallback((spotId, sessionSettings = {}) => {
    handleStartGoLiveFlow(spotId, sessionSettings);
  }, [handleStartGoLiveFlow]);

  const handleSwitchLocation = useCallback(async (newSpotId, sessionSettings = {}) => {
    // End current session first
    if (currentUserShooting) {
      try {
        await apiClient.post(`/photographer-sessions/end`, {
          photographer_id: user?.id
        });
        setCurrentLiveSpot(null);
      } catch (error) {
        logger.error('Error ending current session:', error);
        toast.error('Failed to end current session');
        return;
      }
    }
    // Start new session at new spot with settings
    handleStartGoLiveFlow(newSpotId, sessionSettings);
  }, [currentUserShooting, user?.id, setCurrentLiveSpot, handleStartGoLiveFlow]);

  const handlePhotographerClick = useCallback((photographer) => {
    // CRITICAL UX LOGIC: Differentiate between official spot vs GPS-based photographers
    
    // Check if photographer is at an official spot
    const hasOfficialSpot = photographer.current_spot_id || photographer.spot_id;
    
    if (hasOfficialSpot) {
      // Scenario A: Photographer is at an OFFICIAL SURF SPOT
      // -> Open Location Detail Drawer first (prioritize surf report, conditions)
      // -> Photographer appears as secondary metadata in that drawer
      const spotId = photographer.current_spot_id || photographer.spot_id;
      const spot = surfSpots.find(s => s.id === spotId);
      
      if (spot) {
        // Load spot drawer with this spot's data
        setSelectedSpot(spot);
        setSelectedPhotographer(null);
        setLockedShooterCount(spot.active_photographers_count || 1);
        fetchActiveShootersAtSpot(spotId);
        setUnifiedDrawerOpen(true);
        setBottomSheetOpen(false);
        return;
      }
    }
    
    // Scenario B: Photographer is at a GPS/ROAMING location (no official spot)
    // -> Open Photographer Session/Purchase Drawer directly
    // -> No spot report data available for custom GPS coordinates
    setSelectedPhotographer(photographer);
    setSelectedSpot(null);
    setLockedShooterCount(null);
    setBottomSheetOpen(true);
  }, [surfSpots, setSelectedSpot, setSelectedPhotographer, setLockedShooterCount, fetchActiveShootersAtSpot, setUnifiedDrawerOpen, setBottomSheetOpen]);


  return {
    fetchOnDemandPros,
    fetchFriends,
    fetchActiveRequests,
    handleSpotClick,
    fetchActiveShootersAtSpot,
    handleCloseUnifiedDrawer,
    handleStartShootingFromDrawer,
    handleSwitchLocation,
    handlePhotographerClick,
  };
};

export default useMapActions;
