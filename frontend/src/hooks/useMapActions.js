/**
 * useMapActions.js - Extracted from MapPage.js
 * Map page handlers: data fetching, location, search.
 * ~340 lines, 11 handlers.
 */
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

    const fetchOnDemandPros = async () => {
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
    };

    const fetchFriends = async () => {
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
    };

    const fetchActiveRequests = async () => {
      try {
        const response = await apiClient.get(`/dispatch/requests/pending`);
        setActiveOnDemandRequests(response.data || []);
      } catch (error) {
        logger.debug('No pending dispatch requests');
        setActiveOnDemandRequests([]);
      }
    };

  const updateTrackingMarkers = (trackingData) => {
    if (!mapInstanceRef.current) return;
    
    const { photographer_location, requester_location } = trackingData;
    
    // Update or create photographer tracking marker
    if (photographer_location?.lat && photographer_location?.lng) {
      const photographerIcon = window.L.divIcon({
        className: 'custom-marker tracking-marker',
        html: `
          <div class="relative animate-bounce">
            <div class="w-12 h-12 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg">
              <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4z"/>
                <circle cx="10" cy="11" r="3"/>
              </svg>
            </div>
            <div class="absolute -bottom-4 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-cyan-500 rounded-full text-xs text-white font-bold whitespace-nowrap">
              ${trackingData.estimated_arrival_minutes || '?'} min
            </div>
          </div>
        `,
        iconSize: [48, 60],
        iconAnchor: [24, 30]
      });
      
      if (trackingMarkersRef.photographer) {
        trackingMarkersRef.photographer.setLatLng([photographer_location.lat, photographer_location.lng]);
      } else {
        trackingMarkersRef.photographer = window.L.marker(
          [photographer_location.lat, photographer_location.lng], 
          { icon: photographerIcon }
        ).addTo(mapInstanceRef.current);
      }
    }
    
    // Update or create requester (surfer) tracking marker
    if (requester_location?.lat && requester_location?.lng) {
      const surferIcon = window.L.divIcon({
        className: 'custom-marker tracking-marker',
        html: `
          <div class="relative">
            <div class="w-10 h-10 rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 flex items-center justify-center shadow-lg ring-4 ring-yellow-400/30">
          <span class="text-xl">${String.fromCodePoint(0x1F30A)}</span>
            </div>
            <div class="absolute -bottom-3 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-yellow-500 rounded-full text-[10px] text-black font-bold">
              YOU
            </div>
          </div>
        `,
        iconSize: [40, 50],
        iconAnchor: [20, 25]
      });
      
      if (trackingMarkersRef.surfer) {
        trackingMarkersRef.surfer.setLatLng([requester_location.lat, requester_location.lng]);
      } else {
        trackingMarkersRef.surfer = window.L.marker(
          [requester_location.lat, requester_location.lng], 
          { icon: surferIcon }
        ).addTo(mapInstanceRef.current);
      }
    }
    
    // Draw route line between photographer and surfer
    if (photographer_location?.lat && requester_location?.lat) {
      const points = [
        [photographer_location.lat, photographer_location.lng],
        [requester_location.lat, requester_location.lng]
      ];
      
      if (trackingMarkersRef.routeLine) {
        trackingMarkersRef.routeLine.setLatLngs(points);
      } else {
        trackingMarkersRef.routeLine = window.L.polyline(points, {
          color: '#22d3ee',
          weight: 3,
          opacity: 0.8,
          dashArray: '10, 10'
        }).addTo(mapInstanceRef.current);
      }
      
      // Fit map to show both markers
      const bounds = window.L.latLngBounds(points);
      mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
    }
  };

  const updateUserLocationMarker = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    // Remove old user marker
    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }
    
    // Remove old accuracy circle
    if (userAccuracyCircleRef.current) {
      userAccuracyCircleRef.current.remove();
      userAccuracyCircleRef.current = null;
    }
    
    // Add user location marker if available (not clustered - always visible)
    // Uses GPS or IP fallback location
    const locationToUse = effectiveLocation || userLocation;
    
    // IMPORTANT: Validate coordinates before using with Leaflet
    if (locationToUse && isValidLatLng(locationToUse.lat, locationToUse.lng)) {
      const isIPLocation = locationToUse.source === 'ip';
      const accuracy = locationToUse.accuracy || (isIPLocation ? 50000 : null);
      
      // Color based on accuracy: blue (good), orange (approximate), red (very inaccurate)
      let markerColor = 'bg-blue-500';
      let pingColor = 'bg-blue-500';
      let statusText = '';
      
      if (isIPLocation) {
        markerColor = 'bg-orange-500';
        pingColor = 'bg-orange-500';
        statusText = `~${locationToUse.city || 'Approx'}`;
      } else if (accuracy) {
        if (accuracy > 1000) {
          markerColor = 'bg-red-500';
          pingColor = 'bg-red-500';
          statusText = `~${(accuracy/1000).toFixed(1)}km`;
        } else if (accuracy > 500) {
          markerColor = 'bg-orange-500';
          pingColor = 'bg-orange-500';
          statusText = `~${Math.round(accuracy)}m`;
        } else if (accuracy > 100) {
          markerColor = 'bg-yellow-500';
          pingColor = 'bg-yellow-400';
        }
      }
      
      const userIcon = window.L.divIcon({
        className: 'custom-marker',
        html: `
          <div class="relative">
            <div class="absolute inset-0 w-6 h-6 rounded-full ${pingColor} animate-ping opacity-30"></div>
            <div class="w-6 h-6 rounded-full ${markerColor} border-2 border-white flex items-center justify-center shadow-lg">
              <div class="w-2 h-2 bg-white rounded-full"></div>
            </div>
            ${statusText ? `
              <div class="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[8px] ${markerColor === 'bg-red-500' ? 'text-red-400' : 'text-orange-400'} whitespace-nowrap font-medium bg-zinc-900/80 px-1 rounded">
                ${statusText}
              </div>
            ` : ''}
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      
      const validLat = truncateCoord(locationToUse.lat);
      const validLng = truncateCoord(locationToUse.lng);
      
      // Add accuracy circle for inaccurate locations (store reference for cleanup)
      if (accuracy && accuracy > 100 && validLat !== null && validLng !== null) {
        userAccuracyCircleRef.current = window.L.circle(
          [validLat, validLng],
          {
            radius: Math.min(accuracy, 5000), // Cap at 5km
            color: accuracy > 1000 ? '#ef4444' : '#f97316',
            fillColor: accuracy > 1000 ? '#ef4444' : '#f97316',
            fillOpacity: 0.1,
            weight: 1,
            dashArray: '5, 5'
          }
        ).addTo(map);
      }
      
      if (validLat !== null && validLng !== null) {
        userMarkerRef.current = window.L.marker(
          [validLat, validLng], 
          { icon: userIcon }
        )
          .addTo(map)
          .bindPopup(
            isIPLocation 
              ? `Approximate location: ${locationToUse.city || 'Unknown'}<br><small>Tap "Fix Location" for precise positioning</small>` 
              : accuracy && accuracy > 500 
                ? `Location accuracy: ~${accuracy > 1000 ? `${(accuracy/1000).toFixed(1)}km` : `${Math.round(accuracy)}m`}<br><small>Tap "Fix Location" if this is wrong</small>`
                : 'You are here'
          );
      }
    }
  };

  const handleSpotClick = (spot) => {
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
  };

  const fetchActiveShootersAtSpot = async (spotId) => {
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
  };

  const handleCloseUnifiedDrawer = () => {
    setUnifiedDrawerOpen(false);
    setSelectedSpot(null);
    setActiveShootersAtSpot([]);
    setLockedShooterCount(null);
  };

  const handleStartShootingFromDrawer = (spotId, sessionSettings = {}) => {
    handleStartGoLiveFlow(spotId, sessionSettings);
  };

  const handleSwitchLocation = async (newSpotId, sessionSettings = {}) => {
    // End current session first
    if (currentUserShooting) {
      try {
        await apiClient.post(`/photographer-sessions/end`, {
          photographer_id: user.id
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
  };

  const handlePhotographerClick = (photographer) => {
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
  };


  return {
    fetchOnDemandPros,
    fetchFriends,
    fetchActiveRequests,
    updateTrackingMarkers,
    updateUserLocationMarker,
    handleSpotClick,
    fetchActiveShootersAtSpot,
    handleCloseUnifiedDrawer,
    handleStartShootingFromDrawer,
    handleSwitchLocation,
    handlePhotographerClick,
  };
};

export default useMapActions;
