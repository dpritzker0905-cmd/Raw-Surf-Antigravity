import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { initializeMap, recreateMapAtLocation } from './map/mapInitializer';
import { updateMapMarkers as updateMapMarkersService } from './map/markerManager';
import { updateFriendMarkers } from './map/friendMarkers';
import { updateOnDemandMarkers } from './map/onDemandMarkers';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useTheme } from '../contexts/ThemeContext';
import { PermissionNudgeDrawer } from './PermissionNudgeDrawer';
import { toast } from 'sonner';
import useMapActions from '../hooks/useMapActions';
import { JumpInSessionModal } from './JumpInSessionModal';
import { supabase } from '../lib/supabase';
import UnifiedSpotDrawer from './UnifiedSpotDrawer';
import { RequestProSelfieModal } from './RequestProSelfieModal';
import { RequestProModal } from './map/RequestProModal';
import { MapLiveFloatingIsland } from './MapLiveIndicator';
import DispatchTrackingPanel from './map/DispatchTrackingPanel';
import FeaturedPhotographersPanel from './map/FeaturedPhotographersPanel';
import PhotographerBottomSheet from './map/PhotographerBottomSheet';
import EndSessionModal from './EndSessionModal';
import ConditionsModal from './ConditionsModal';
import WaveLoader from './WaveLoader';
import { GPSSettingsGuide } from './GPSSettingsGuide';
import { LocationPicker } from './LocationPicker';
import { MapFilterTabs } from './map/MapFilterTabs';
import { MapHeader } from './map/MapHeader';
import MapErrorBoundary from './map/MapErrorBoundary';
import { IPLocationBanner } from './map/IPLocationBanner';
import { MapRightControls } from './map/MapRightControls';
import { NearestSpotCard } from './map/NearestSpotCard';
import { isValidLatLng, truncateCoord, TILE_LAYER_CONFIG, MAPBOX_TILES, FLORIDA_CENTER } from './map/mapUtils';
import { useMapData } from '../hooks/useMapData';
import { useUserLocation } from '../hooks/useUserLocation';
import { useGoLiveFlow } from '../hooks/useGoLiveFlow';
import { useIPGeolocation } from '../hooks/useIPGeolocation';
import { useMarkerClustering } from '../hooks/useMarkerClustering';
import { useMapState } from '../hooks/useMapState';
import { useFriendsOnMap } from '../hooks/useFriendsOnMap';
import logger from '../utils/logger';
import useDispatchTracking from '../hooks/useDispatchTracking';

const MapPageContent = () => {
  const { user } = useAuth();
  const { getEffectiveRole } = usePersona();
  const { theme } = useTheme();
  
  const isLight = theme === 'light';
  const mapTilesUrl = isLight ? MAPBOX_TILES.light : TILE_LAYER_CONFIG.url;
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const userMarkerRef = useRef(null);
  const userAccuracyCircleRef = useRef(null);
  const spotClusterRef = useRef(null);
  const photographerClusterRef = useRef(null);
  
  // User location hook - handles GPS and location-related state
  const {
    userLocation,
    locationDenied,
    gpsLoading,
    requestLocation,
    findNearestSpot,
    setUserLocation,
    setLocationDenied,
    startWatchingLocation,
    stopWatchingLocation,
  } = useUserLocation();

  const {
    surfSpots,
    livePhotographers,
    featuredPhotographers,
    loading,
    fetchLivePhotographers,
    _fetchSurfSpots,
  } = useMapData(user?.id, userLocation);

  const {
    goLiveSpotId,
    goLiveLoading,
    currentLiveSpot,
    showConditionsModal,
    showEndSessionModal,
    endSessionLoading,
    currentLiveSession,
    startGoLiveFlow,
    handleConditionsConfirm: hookHandleConditionsConfirm,
    handleStopLive,
    handleEndSessionConfirmed,
    closeConditionsModal,
    closeEndSessionModal,
    setCurrentLiveSpot,
  } = useGoLiveFlow({
    userId: user?.id,
    onGoLiveSuccess: () => {
      fetchLivePhotographers();
      setUnifiedDrawerOpen(false);
      setBottomSheetOpen(false);
    },
    onEndSessionSuccess: () => {
      fetchLivePhotographers();
    }
  });

  const {
    ipLocation, 
    _ipLoading, 
    _coastalSnapped,
    cityChanged,
    _forceRecalibrate 
  } = useIPGeolocation();

  const [mapBounds, _setMapBounds] = useState(null);
  const [mapZoom, _setMapZoom] = useState(10);
  const clusteringOptions = useMemo(() => ({ radius: 60, maxZoom: 14 }), []);
  const { _clusters } = useMarkerClustering(surfSpots, mapBounds, mapZoom, clusteringOptions);

  const effectiveLocation = useMemo(() => {
    // Check GPS location first
    if (userLocation?.lat && userLocation?.lng && 
        !isNaN(userLocation.lat) && !isNaN(userLocation.lng) &&
        isFinite(userLocation.lat) && isFinite(userLocation.lng)) {
      return { ...userLocation, source: 'gps' };
    }
    if (ipLocation?.lat && ipLocation?.lng &&
        !isNaN(ipLocation.lat) && !isNaN(ipLocation.lng) &&
        isFinite(ipLocation.lat) && isFinite(ipLocation.lng)) {
      return { ...ipLocation, source: 'ip' };
    }
    return null;
  }, [userLocation, ipLocation]);

  const {
    selectedSpot,
    setSelectedSpot,
    selectedPhotographer,
    setSelectedPhotographer,
    bottomSheetOpen,
    setBottomSheetOpen,
    showFeaturedPanel,
    setShowFeaturedPanel,
    filter,
    setFilter,
    unifiedDrawerOpen,
    setUnifiedDrawerOpen,
    activeShootersAtSpot,
    setActiveShootersAtSpot,
    showJumpInModal,
    setShowJumpInModal,
    showGPSGuide,
    setShowGPSGuide,
    showLocationPicker,
    setShowLocationPicker,
    showIpBanner,
    setShowIpBanner,
    pulsingMarkers,
    setPulsingMarkers,
  } = useMapState();
  
  // Nearest spot (derived from user location)
  const nearestSpot = useMemo(() => 
    userLocation ? findNearestSpot(surfSpots) : null,
    [userLocation, surfSpots, findNearestSpot]
  );

  const [showRequestProModal, setShowRequestProModal] = useState(false);
  const [requestProLoading, setRequestProLoading] = useState(false);
  const [estimatedDuration, setEstimatedDuration] = useState(1);
  const [inviteFriends, setInviteFriends] = useState(false);
  const [pendingRequestPro, setPendingRequestPro] = useState(false);
  const [requestProLocationLoading, setRequestProLocationLoading] = useState(false);
  const [showRequestProSelfieModal, setShowRequestProSelfieModal] = useState(false);
  const [boostHours, setBoostHours] = useState(0);
  const [onDemandPhotographers, setOnDemandPhotographers] = useState([]);
  const [requestProSelectedPro, setRequestProSelectedPro] = useState(null);
  const [onDemandLoading, setOnDemandLoading] = useState(false);
  
  // Friend invite state for split sessions
  const [friendsList, setFriendsList] = useState([]);
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [_showFriendPicker, setShowFriendPicker] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState('');

  const {
    friendsOnMap,
    showFriendsOnMap,
    setShowFriendsOnMap,
    friendMarkersRef,
    _fetchFriendsOnMap,
    _clearFriendMarkers,
  } = useFriendsOnMap({ user, mapInstanceRef });
  
  const [activeOnDemandRequests, setActiveOnDemandRequests] = useState([]);
  const onDemandMarkersRef = useRef([]);
  const [_lockedShooterCount, setLockedShooterCount] = useState(null);
  
  const [trackingMarkersRef] = useState({ surfer: null, photographer: null, routeLine: null });
  const [showPermissionNudge, setShowPermissionNudge] = useState(false);
  const [permissionNudgeAction, setPermissionNudgeAction] = useState('booking');

  const effectiveRole = getEffectiveRole(user?.role);
  const isPhotographer = useMemo(() =>
    ['Hobbyist', 'Photographer', 'Approved Pro'].includes(effectiveRole),
    [effectiveRole]
  );
  const _canAccessPhotoTools = useMemo(() =>
    ['Grom Parent', 'Hobbyist', 'Photographer', 'Approved Pro'].includes(effectiveRole),
    [effectiveRole]
  );

  // Handle filter change with map resize
  const handleFilterChange = useCallback((newFilter) => {
    setFilter(newFilter);
    
    // Force map resize on filter change
    if (mapInstanceRef.current) {
      setTimeout(() => {
        mapInstanceRef.current.invalidateSize();
        
        // Fit bounds to all data points for 'ALL' filter
        if (newFilter === 'all') {
          const bounds = [];
          surfSpots.forEach(spot => {
            if (spot.latitude && spot.longitude) {
              bounds.push([spot.latitude, spot.longitude]);
            }
          });
          livePhotographers.forEach(p => {
            if (p.current_latitude && p.current_longitude) {
              bounds.push([p.current_latitude, p.current_longitude]);
            }
          });
          
          if (bounds.length > 0) {
            mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
          } else {
            // Default to Florida center if no data
            mapInstanceRef.current.setView([FLORIDA_CENTER.lat, FLORIDA_CENTER.lng], 7);
          }
        }
      }, 100);
    }
  }, [surfSpots, livePhotographers]);

  // Debug logger for permission status
  const _logPermissionStatus = useCallback((step, status, details = '') => {
    const timestamp = new Date().toISOString();
    logger.debug(`[PERMISSION DEBUG ${timestamp}] Step: ${step}, Status: ${status}${details ? `, Details: ${details}` : ''}`);
  }, []);

  useEffect(() => {
    if (pendingRequestPro && userLocation) {
      setShowRequestProModal(true);
      setPendingRequestPro(false);
      setRequestProLocationLoading(false);
    }
  }, [userLocation, pendingRequestPro]);

  useEffect(() => {
    const ogTags = [];
    const setMeta = (property, content) => {
      if (!content) return;
      let tag = document.querySelector(`meta[property="${property}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('property', property);
        document.head.appendChild(tag);
        ogTags.push(tag);
      }
      tag.setAttribute('content', content);
    };
    document.title = 'Surf Map - Raw Surf';
    setMeta('og:title', 'Surf Map - Raw Surf');
    setMeta('og:description', 'Live surf spot map with real-time photographer locations, conditions, and on-demand booking on Raw Surf.');
    setMeta('og:url', `${window.location.origin}/map`);
    setMeta('og:type', 'website');
    setMeta('og:site_name', 'Raw Surf');
    return () => {
      document.title = 'Raw Surf';
      ogTags.forEach(tag => tag.remove());
    };
  }, []);

  useEffect(() => {
    fetchOnDemandPros();
  }, [showRequestProModal, userLocation]);

  const {
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
  } = useMapActions({
    user, mapInstanceRef, selectedSpot,
    trackingMarkersRef, userMarkerRef, userAccuracyCircleRef,
    livePhotographers, surfSpots, userLocation, effectiveLocation,
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

  useEffect(() => { fetchFriends(); }, [inviteFriends, user?.id]);

  // Dispatch tracking — extracted to useDispatchTracking hook (v80)
  const {
    activeDispatch,
    activeDispatchId,
    setActiveDispatchId,
    clearDispatch,
  } = useDispatchTracking({ userId: user?.id, updateTrackingMarkers });

  useEffect(() => {
    if (!isPhotographer) return;
    fetchActiveRequests();
    const interval = setInterval(fetchActiveRequests, 30000);
    return () => clearInterval(interval);
  }, [isPhotographer]);

  useEffect(() => {
    const channel = supabase
      .channel('live-session-participants')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'live_session_participants'
        },
        (payload) => {
          const photographerId = payload.new?.photographer_id;
          
          if (photographerId) {
            setPulsingMarkers(prev => new Set([...prev, photographerId]));
            
            // Remove pulse after 3 seconds
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

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      const frameId = requestAnimationFrame(() => initMap());
      return () => cancelAnimationFrame(frameId);
    }
  }, [loading]);

  useEffect(() => {
    if (mapInstanceRef.current && mapInstanceRef.current._tileLayer) {
      mapInstanceRef.current._tileLayer.setUrl(mapTilesUrl);
    }
  }, [isLight, mapTilesUrl]);

  useEffect(() => {
    if (mapInstanceRef.current && !locationDenied) startWatchingLocation();
    return () => stopWatchingLocation();
  }, [startWatchingLocation, stopWatchingLocation, locationDenied]);

  const hasAutocenteredRef = useRef(false);
  useEffect(() => {
    if (mapInstanceRef.current && !hasAutocenteredRef.current) {
      if (user?.home_latitude && user?.home_longitude &&
          typeof user.home_latitude === 'number' && typeof user.home_longitude === 'number' &&
          !Number.isNaN(user.home_latitude) && !Number.isNaN(user.home_longitude) &&
          user.home_latitude >= -90 && user.home_latitude <= 90 && 
          user.home_longitude >= -180 && user.home_longitude <= 180) {
        
        hasAutocenteredRef.current = true;
        logger.debug(`[MAP] Auto-centering on home location: ${user.home_latitude.toFixed(4)}, ${user.home_longitude.toFixed(4)}`);
        
        // Zoom in tight (14) for saved home location
        mapInstanceRef.current.setView([user.home_latitude, user.home_longitude], 14);
        
        setTimeout(() => {
          if (mapInstanceRef.current) {
            mapInstanceRef.current.invalidateSize();
          }
        }, 200);
        return;
      }
      
      // Priority 2 & 3: GPS or IP location
      if (effectiveLocation) {
        const { lat, lng, source } = effectiveLocation;
        
        // Validate coordinates
        if (typeof lat === 'number' && typeof lng === 'number' &&
            !Number.isNaN(lat) && !Number.isNaN(lng) && 
            lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          
          hasAutocenteredRef.current = true;
          logger.debug(`[MAP] Auto-centering on ${source}: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
          
          // GPS gets zoom 12, IP gets zoom 9
          const zoom = source === 'gps' ? 12 : 9;
          mapInstanceRef.current.setView([lat, lng], zoom);
          
          // Simple refresh
          setTimeout(() => {
            if (mapInstanceRef.current) {
              mapInstanceRef.current.invalidateSize();
            }
          }, 200);
        }
      }
    }
  }, [effectiveLocation, user?.home_latitude, user?.home_longitude]);

  useEffect(() => {
    if (!loading && mapInstanceRef.current) {
      updateMapMarkers();
    }
  }, [surfSpots, livePhotographers, filter, pulsingMarkers, loading]);
  
  useEffect(() => {
    if (!loading && mapInstanceRef.current) {
      updateUserLocationMarker();
    }
  }, [userLocation, effectiveLocation, loading]);

  useEffect(() => {
    if (selectedSpot && surfSpots.length > 0) {
      const updatedSpot = surfSpots.find(s => s.id === selectedSpot.id);
      if (updatedSpot && updatedSpot.active_photographers_count !== selectedSpot.active_photographers_count) {
        setSelectedSpot(updatedSpot);
      }
    }
  }, [surfSpots, selectedSpot]);

  useEffect(() => {
    if (mapInstanceRef.current) {
      setTimeout(() => mapInstanceRef.current.invalidateSize(), 300);
    }
  }, [bottomSheetOpen]);

  // Auto-dismiss IP location banner after 5 seconds
  useEffect(() => {
    if (ipLocation && !userLocation && showIpBanner) {
      const timer = setTimeout(() => {
        setShowIpBanner(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [ipLocation, userLocation, showIpBanner]);

  useEffect(() => {
    updateFriendMarkers({ mapInstance: mapInstanceRef.current, friendMarkersRef, friendsOnMap, showFriendsOnMap });
  }, [friendsOnMap, showFriendsOnMap]);

  useEffect(() => {
    updateOnDemandMarkers({ mapInstance: mapInstanceRef.current, onDemandMarkersRef, activeOnDemandRequests, isPhotographer });
  }, [activeOnDemandRequests, isPhotographer]);

  const getUserLocation = async () => {
    try {
      const location = await requestLocation();
      if (!location?.lat || !location?.lng ||
          typeof location.lat !== 'number' || typeof location.lng !== 'number' ||
          Number.isNaN(location.lat) || Number.isNaN(location.lng)) {
        logger.error('[MAP] Invalid location:', location);
        setShowLocationPicker(true);
        return;
      }
      recreateMapAtLocation({
        location, mapRef, mapInstanceRef, spotClusterRef, photographerClusterRef,
        mapTilesUrl, onMarkersReady: () => { updateMapMarkers(); updateUserLocationMarker(); }
      });
    } catch (error) {
      logger.error('[MAP] GPS failed:', error);
      setShowLocationPicker(true);
    }
  };

  const initMap = () => {
    initializeMap({
      mapRef, mapInstanceRef, spotClusterRef, photographerClusterRef,
      mapTilesUrl, onMarkersReady: () => { updateMapMarkers(); updateUserLocationMarker(); }
    });
  };

  const updateMapMarkers = () => {
    updateMapMarkersService({
      map: mapInstanceRef.current, markersRef, spotClusterRef, photographerClusterRef,
      filter, surfSpots, livePhotographers, pulsingMarkers,
      handleSpotClick, handlePhotographerClick
    });
  };

  const handleStartGoLiveFlow = useCallback((spotId, sessionSettings = {}) => {
    if (!userLocation && locationDenied) {
      setPermissionNudgeAction('go_live');
      setShowPermissionNudge(true);
      return;
    }
    setUnifiedDrawerOpen(false);
    setBottomSheetOpen(false);
    startGoLiveFlow(spotId, sessionSettings);
  }, [startGoLiveFlow, userLocation, locationDenied]);

  const handleConditionsConfirm = useCallback((data) => {
    hookHandleConditionsConfirm(data, surfSpots);
  }, [hookHandleConditionsConfirm, surfSpots]);

  const currentUserShooting = livePhotographers.find(p => p.id === user?.id);
  const handleStopLiveWrapper = useCallback(() => {
    handleStopLive(currentUserShooting);
  }, [handleStopLive, currentUserShooting]);

  if (loading) {
    return (
      <div 
        className={`fixed ${isLight ? 'bg-white' : 'bg-black'} md:left-[200px] flex items-center justify-center`}
        style={{ 
          top: '56px', // Below TopNav
          left: 0, 
          right: 0, 
          bottom: 0,
          zIndex: 50 // Below TopNav (z-100)
        }}
      >
        <WaveLoader />
      </div>
    );
  }

  return (
    <div 
      className={`fixed ${isLight ? 'bg-gray-50' : 'bg-black'} md:left-[200px]`}
      style={{ 
        top: '56px', // Below TopNav (TopNav is ~56px height on mobile)
        left: 0, 
        right: 0, 
        bottom: 0,
        zIndex: 50 // Below TopNav (z-100) but above other content
      }}
      data-testid="map-page-container"
    >
      {/* Map Container - Fill entire view */}
      <div 
        ref={mapRef} 
        className="absolute inset-0 z-0" 
        data-testid="map-container"
      />

      {/* TOP RAIL */}
      <div 
        className="absolute top-0 left-0 right-0 md:left-[200px] z-[1000] pointer-events-none" 
        style={{ paddingTop: '16px' }}
      >
        <div className="px-4">
          <MapHeader livePhotographerCount={livePhotographers.length} />
          {currentUserShooting && (
            <div className="mb-3 pointer-events-auto">
              <MapLiveFloatingIsland 
                session={{
                  location: currentUserShooting.current_spot_name || currentUserShooting.location,
                  started_at: currentUserShooting.started_at || new Date().toISOString(),
                  active_surfers: currentUserShooting.active_surfers || 0,
                  earnings: currentUserShooting.earnings || 0
                }}
                onEndSession={handleStopLiveWrapper}
              />
            </div>
          )}
          <MapFilterTabs 
            filter={filter}
            onFilterChange={handleFilterChange}
            locationDenied={locationDenied}
            surfSpots={surfSpots}
            onSpotSelect={(spot) => {
              if (mapRef.current && isValidLatLng(spot.latitude, spot.longitude)) {
                mapRef.current.flyTo([spot.latitude, spot.longitude], 14, { duration: 1 });
              }
              setSelectedSpot(spot);
              setUnifiedDrawerOpen(true);
            }}
          />
          <IPLocationBanner
            showIpBanner={showIpBanner}
            cityChanged={cityChanged}
            locationDenied={locationDenied}
            ipLocation={ipLocation}
            userLocation={userLocation}
            onRequestGPS={getUserLocation}
            onDismiss={() => setShowIpBanner(false)}
          />
          <div className="mt-2 pointer-events-auto">
            <button
              onClick={() => {
                if (!userLocation) {
                  setPendingRequestPro(true);
                  setRequestProLocationLoading(true);
                  setLocationDenied(false);
                  getUserLocation();
                } else {
                  setShowRequestProModal(true);
                }
              }}
              disabled={requestProLocationLoading}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all backdrop-blur-sm border border-cyan-500/50 ${
                requestProLocationLoading 
                  ? 'bg-cyan-600/50 text-white cursor-wait' 
                  : 'bg-zinc-800/90 text-gray-300 hover:bg-zinc-700'
              }`}
              data-testid="request-pro-btn"
            >
              {requestProLocationLoading ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Finding location...
                </span>
              ) : (
                'Request a 📸'
              )}
          </button>
          </div>
        </div>
      </div>

      <DispatchTrackingPanel activeDispatch={activeDispatch} onDismiss={clearDispatch} />

      <MapRightControls
        userLocation={userLocation}
        gpsLoading={gpsLoading}
        locationDenied={locationDenied}
        currentUserShooting={currentUserShooting}
        showFeaturedPanel={showFeaturedPanel}
        showFriendsOnMap={showFriendsOnMap}
        friendsOnMap={friendsOnMap}
        onGetLocation={getUserLocation}
        onShowLocationPicker={() => setShowLocationPicker(true)}
        onToggleFeatured={() => setShowFeaturedPanel(!showFeaturedPanel)}
        onToggleFriends={() => setShowFriendsOnMap(!showFriendsOnMap)}
        onShowGPSGuide={() => setShowGPSGuide(true)}
      />

      {showFeaturedPanel && (
        <FeaturedPhotographersPanel
          featuredPhotographers={featuredPhotographers}
          onClose={() => setShowFeaturedPanel(false)}
          onPhotographerSelect={(photographer) => {
            setSelectedPhotographer(photographer);
            setBottomSheetOpen(true);
            setShowFeaturedPanel(false);
          }}
        />
      )}

      <NearestSpotCard
        nearestSpot={nearestSpot}
        userLocation={userLocation}
        onSpotSelect={(spot) => {
          if (mapInstanceRef.current && spot.latitude && spot.longitude) {
            mapInstanceRef.current.setView([spot.latitude, spot.longitude], 14);
          }
          setSelectedSpot(spot);
          setUnifiedDrawerOpen(true);
        }}
      />

      {bottomSheetOpen && selectedPhotographer && !showJumpInModal && (
        <PhotographerBottomSheet
          selectedPhotographer={selectedPhotographer}
          onClose={() => { setBottomSheetOpen(false); setSelectedPhotographer(null); }}
          onJumpIn={() => {
            setBottomSheetOpen(false);
            setUnifiedDrawerOpen(false);
            setShowJumpInModal(true);
          }}
        />
      )}

      <style>{`
        .custom-marker { background: transparent !important; border: none !important; }
        .custom-cluster-marker { background: transparent !important; border: none !important; }
        .photographer-marker .animate-ping { animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite; }
        @keyframes ping { 75%, 100% { transform: scale(1.5); opacity: 0; } }
        .marker-cluster-small, .marker-cluster-medium, .marker-cluster-large { background: transparent !important; }
        .marker-cluster div { background: transparent !important; }
      `}</style>

      <UnifiedSpotDrawer
        spot={selectedSpot}
        isOpen={unifiedDrawerOpen}
        onClose={handleCloseUnifiedDrawer}
        onStartShooting={handleStartShootingFromDrawer}
        onSwitchLocation={handleSwitchLocation}
        activeShooters={activeShootersAtSpot}
        isPhotographer={isPhotographer}
        isUserLive={currentUserShooting}
        currentLiveSpot={currentLiveSpot}
        goLiveLoading={goLiveLoading}
        userId={user?.id}
      />

      {showJumpInModal && selectedPhotographer && (
        <JumpInSessionModal
          photographer={selectedPhotographer}
          onClose={() => setShowJumpInModal(false)}
          onSuccess={(_data) => {
            setShowJumpInModal(false);
            setBottomSheetOpen(false);
            toast.success(`Joined ${selectedPhotographer.full_name}'s session!`);
          }}
        />
      )}

      <RequestProModal
        isOpen={showRequestProModal}
        onClose={() => {
          setShowRequestProModal(false);
          setRequestProSelectedPro(null);
          setSelectedFriends([]);
          setFriendSearchQuery('');
          setShowFriendPicker(false);
        }}
        userId={user?.id}
        user={user}
        userLocation={userLocation}
        nearestSpot={nearestSpot}
        onDemandPhotographers={onDemandPhotographers}
        onDemandLoading={onDemandLoading}
        friendsList={friendsList}
        friendsLoading={friendsLoading}
        onSuccess={(dispatchId) => {
          setActiveDispatchId(dispatchId);
          setTimeout(() => setShowRequestProSelfieModal(true), 1500);
        }}
      />

      <RequestProSelfieModal
        dispatchId={activeDispatchId}
        isOpen={showRequestProSelfieModal}
        onClose={() => setShowRequestProSelfieModal(false)}
        onSuccess={(_selfieUrl) => {
          toast.success('Great! Your Pro will be able to spot you easily.');
        }}
      />

      <EndSessionModal
        isOpen={showEndSessionModal}
        onClose={closeEndSessionModal}
        onConfirm={handleEndSessionConfirmed}
        session={currentLiveSession}
        isLoading={endSessionLoading}
      />

      <ConditionsModal
        isOpen={showConditionsModal}
        onClose={closeConditionsModal}
        onConfirm={handleConditionsConfirm}
        spotName={surfSpots.find(s => s.id === goLiveSpotId)?.name || 'Selected Spot'}
        isLoading={goLiveLoading}
      />

      <PermissionNudgeDrawer
        isOpen={showPermissionNudge}
        onClose={() => setShowPermissionNudge(false)}
        onRetryLocation={getUserLocation}
        action={permissionNudgeAction}
      />
      
      <GPSSettingsGuide
        isOpen={showGPSGuide}
        onClose={() => setShowGPSGuide(false)}
        onRetryLocation={getUserLocation}
        onManualLocation={() => setShowLocationPicker(true)}
        currentAccuracy={userLocation?.accuracy}
        isLoading={gpsLoading}
      />
      
      <LocationPicker
        isOpen={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
        onLocationSelected={(location) => {
          if (location && isValidLatLng(location.lat, location.lng)) {
            setUserLocation(location);
            if (mapInstanceRef.current) {
              mapInstanceRef.current.setView([location.lat, location.lng], 12);
            }
            toast.success('Location set manually!');
          } else {
            toast.error('Invalid location selected');
          }
        }}
        currentLocation={userLocation}
        currentAccuracy={userLocation?.accuracy}
        surfSpots={surfSpots}
      />
    </div>
  );
};

export const MapPage = () => (
  <MapErrorBoundary>
    <MapPageContent />
  </MapErrorBoundary>
);

export default MapPage;