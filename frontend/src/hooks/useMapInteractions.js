import { useEffect, useCallback } from 'react';
import useMapActions from './useMapActions';
import useDispatchTracking from './useDispatchTracking';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import { isValidLatLng, truncateCoord, fitMapToAll } from '../components/map/mapUtils';
import { useMapSeo } from './useMapSeo';
import logger from '../utils/logger';

/**
 * useMapInteractions — Extracted from MapPage.js to reduce LOC.
 * Manages map interactions: filter changes, go-live flow wrappers,
 * spot/photographer click handlers, real-time subscriptions, dispatch tracking,
 * and SEO meta tags.
 */
export function useMapInteractions({
  user,
  mapInstanceRef,
  selectedSpot,
  livePhotographers,
  surfSpots,
  userLocation,
  memoizedUserLocation,
  effectiveLocation,
  currentLiveSpot,
  startGoLiveFlow,
  locationDenied,
  requestLocation,
  isPhotographer,
  isImmersiveMode,
  inviteFriends,
  pendingRequestPro,
  showRequestProModal,
  // State setters
  setFilter,
  setSelectedSpot,
  setUnifiedDrawerOpen,
  setBottomSheetOpen,
  setSelectedPhotographer,
  setCurrentLiveSpot,
  setShowLocationPicker,
  setShowWeatherControls,
  setIsTimelineCollapsed,
  setShowRequestProModal,
  setPendingRequestPro,
  setRequestProLocationLoading,
  setPulsingMarkers,
  setShowPermissionNudge,
  setPermissionNudgeAction,
  // Photographer state refs/setters
  trackingMarkersRef,
  userMarkerRef,
  userAccuracyCircleRef,
  setActiveOnDemandRequests,
  setActiveShootersAtSpot,
  setFriendsList,
  setFriendsLoading,
  setLockedShooterCount,
  setOnDemandLoading,
  setOnDemandPhotographers,
  // Go-live callbacks
  hookHandleConditionsConfirm,
  handleStopLive,
  fetchLivePhotographers,
}) {
  // Handle filter change with map resize
  const handleFilterChange = useCallback((newFilter) => {
    setFilter(newFilter);
    if (mapInstanceRef.current) {
      setTimeout(() => {
        mapInstanceRef.current.resize();
        if (newFilter === 'all') {
          fitMapToAll(mapInstanceRef.current, surfSpots, livePhotographers);
        }
      }, 100);
    }
  }, [surfSpots, livePhotographers, setFilter, mapInstanceRef]);

  // Pending request pro → show modal when location becomes available
  useEffect(() => {
    if (pendingRequestPro && memoizedUserLocation) {
      setShowRequestProModal(true);
      setPendingRequestPro(false);
      setRequestProLocationLoading(false);
    }
  }, [memoizedUserLocation, pendingRequestPro, setShowRequestProModal, setPendingRequestPro, setRequestProLocationLoading]);

  // Immersive mode collapses weather controls
  useEffect(() => {
    if (isImmersiveMode) {
      setShowWeatherControls(false);
      setIsTimelineCollapsed(true);
    }
  }, [isImmersiveMode, setShowWeatherControls, setIsTimelineCollapsed]);

  // SEO meta tags
  useMapSeo();

  // Map Actions hook
  const {
    fetchOnDemandPros,
    fetchFriends,
    fetchActiveRequests,
    handleSpotClick,
    fetchActiveShootersAtSpot,
    handleCloseUnifiedDrawer,
    handleStartShootingFromDrawer,
    handleSwitchLocation,
    handlePhotographerClick,
  } = useMapActions({
    user, mapInstanceRef, selectedSpot,
    trackingMarkersRef, userMarkerRef, userAccuracyCircleRef,
    livePhotographers, surfSpots, userLocation: memoizedUserLocation, effectiveLocation,
    showRequestProModal, inviteFriends, currentUserShooting: !!currentLiveSpot,
    isValidLatLng, truncateCoord, handleStartGoLiveFlow: startGoLiveFlow,
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
  });

  // Fetch on-demand pros when modal opens or location changes
  useEffect(() => {
    fetchOnDemandPros();
  }, [showRequestProModal, memoizedUserLocation, fetchOnDemandPros]);

  // Fetch friends when invite toggle changes
  useEffect(() => { fetchFriends(); }, [inviteFriends, user?.id]);

  // Dispatch tracking
  const {
    activeDispatch,
    activeDispatchId,
    setActiveDispatchId,
    clearDispatch,
  } = useDispatchTracking({ userId: user?.id });

  // Active request polling for photographers
  useEffect(() => {
    if (!isPhotographer) return;
    fetchActiveRequests();
    const interval = setInterval(fetchActiveRequests, 30000);
    return () => clearInterval(interval);
  }, [isPhotographer, fetchActiveRequests]);

  // Realtime subscription for live session participants
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('live-session-participants')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_session_participants' },
        (payload) => {
          const photographerId = payload.new?.photographer_id;
          if (photographerId) {
            setPulsingMarkers(prev => new Set([...prev, photographerId]));
            setTimeout(() => {
              setPulsingMarkers(prev => {
                const newSet = new Set(prev);
                newSet.delete(photographerId);
                return newSet;
              });
            }, 3000);
            fetchLivePhotographers();
            toast.success('\u{1F3C4} A surfer just jumped in!', { description: 'Someone joined a live session' });
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [setPulsingMarkers, fetchLivePhotographers]);

  // Get user location handler
  const getUserLocation = useCallback(async () => {
    try {
      const location = await requestLocation();
      if (!location?.lat || !location?.lng ||
          typeof location.lat !== 'number' || typeof location.lng !== 'number' ||
          Number.isNaN(location.lat) || Number.isNaN(location.lng)) {
        logger.error('[MAP] Invalid location:', location);
        setShowLocationPicker(true);
        return;
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.flyTo({ center: [location.lng, location.lat], zoom: 12 });
      }
    } catch (error) {
      logger.error('[MAP] GPS failed:', error);
      setShowLocationPicker(true);
    }
  }, [requestLocation, mapInstanceRef, setShowLocationPicker]);

  // Go-live flow wrapper
  const handleStartGoLiveFlow = useCallback((spotId, sessionSettings = {}) => {
    if (!userLocation && locationDenied) {
      setPermissionNudgeAction('go_live');
      setShowPermissionNudge(true);
      return;
    }
    setUnifiedDrawerOpen(false);
    setBottomSheetOpen(false);
    startGoLiveFlow(spotId, sessionSettings);
  }, [startGoLiveFlow, userLocation, locationDenied, setPermissionNudgeAction, setShowPermissionNudge, setUnifiedDrawerOpen, setBottomSheetOpen]);

  // Conditions confirm wrapper
  const handleConditionsConfirm = useCallback((data) => {
    hookHandleConditionsConfirm(data, surfSpots);
  }, [hookHandleConditionsConfirm, surfSpots]);

  // Current user shooting status
  const currentUserShooting = (livePhotographers || []).find(p => p.id === user?.id);

  // Stop live wrapper
  const handleStopLiveWrapper = useCallback(() => {
    handleStopLive(currentUserShooting);
  }, [handleStopLive, currentUserShooting]);

  return {
    // Handlers
    handleFilterChange,
    getUserLocation,
    handleStartGoLiveFlow,
    handleConditionsConfirm,
    handleStopLiveWrapper,
    handleSpotClick,
    handleCloseUnifiedDrawer,
    handleStartShootingFromDrawer,
    handleSwitchLocation,
    handlePhotographerClick,
    // Derived
    currentUserShooting,
    // Dispatch
    activeDispatch,
    activeDispatchId,
    setActiveDispatchId,
    clearDispatch,
    // Fetchers
    fetchOnDemandPros,
    fetchActiveShootersAtSpot,
  };
}

export default useMapInteractions;
