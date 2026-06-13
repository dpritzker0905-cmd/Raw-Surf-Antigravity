import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Lock } from 'lucide-react';
import MapWebGL from './map/MapWebGL';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useTheme } from '../contexts/ThemeContext';
import { toast } from 'sonner';
import useMapActions from '../hooks/useMapActions';
import { supabase } from '../lib/supabase';
import UnifiedSpotDrawer from './UnifiedSpotDrawer';
import { MapLiveFloatingIsland } from './MapLiveIndicator';
import DispatchTrackingPanel from './map/DispatchTrackingPanel';
import FeaturedPhotographersPanel from './map/FeaturedPhotographersPanel';
import PhotographerBottomSheet from './map/PhotographerBottomSheet';
import WaveLoader from './WaveLoader';
import { MapFilterTabs } from './map/MapFilterTabs';
import { MapHeader } from './map/MapHeader';
import MapErrorBoundary from './map/MapErrorBoundary';
import { IPLocationBanner } from './map/IPLocationBanner';
import { MapRightControls } from './map/MapRightControls';
import { NearestSpotCard } from './map/NearestSpotCard';
import MapPageModals from './map/MapPageModals';
import MapWeatherControls from './map/MapWeatherControls';
import MapForecastOverlay from './map/MapForecastOverlay';
import { RequestProButton } from './map/RequestProButton';
import { FLORIDA_CENTER, isValidLatLng, truncateCoord, fitMapToAll, getSharedLandGeoJSON } from './map/mapUtils';
import { useMapData } from '../hooks/useMapData';
import { useUserLocation } from '../hooks/useUserLocation';
import { useGoLiveFlow } from '../hooks/useGoLiveFlow';
import { useIPGeolocation } from '../hooks/useIPGeolocation';
import { useMapState } from '../hooks/useMapState';
import { useFriendsOnMap } from '../hooks/useFriendsOnMap';
import { useRequestProState } from '../hooks/useRequestProState';
import logger from '../utils/logger';
import useDispatchTracking from '../hooks/useDispatchTracking';
import useOpenMeteoForecast from '../hooks/useOpenMeteoForecast';
import { useMapSeo } from '../hooks/useMapSeo';
import { useWeatherState } from '../hooks/useWeatherState';
import { useSnappedCoordinates } from '../hooks/useSnappedCoordinates';

var MapPageContent = () => {
  const { user, refreshUser } = useAuth();
  const { getEffectiveRole } = usePersona();

  // Refresh user profile on mount to get latest subscription_tier from backend
  // (admin tier changes update DB but not localStorage until refresh)
  useEffect(() => {
    if (user?.id && user.id !== 'dev-mock-user-id') {
      refreshUser();
    }
  }, []);

  useEffect(() => {
    // Eagerly preload land GeoJSON to prevent particle bunching on WebGL load
    getSharedLandGeoJSON().catch(err => {
      logger.warn('[MapPage] Failed to preload land GeoJSON:', err);
    });
  }, []);
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const mapInstanceRef = useRef(null);

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
    isImmersiveMode,
    setIsImmersiveMode,
  } = useMapState();

 // v3.7: Track map center for forecast overlay data tracks what user is looking at
  const [mapCenter, setMapCenter] = useState(null);
  // v163: Long-press marker location (Ventusky/Windy style)
  const [longPressLocation, setLongPressLocation] = useState(null);
  const [renderMarineData, setRenderMarineData] = useState(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.setLongPressLocation = setLongPressLocation;
    }
  }, [setLongPressLocation]);

  // User location hook - handles GPS and location-related state
  const {
    userLocation, locationDenied, gpsLoading, requestLocation, findNearestSpot,
    setUserLocation, setLocationDenied, startWatchingLocation, stopWatchingLocation,
  } = useUserLocation();

  const {
    surfSpots,
    livePhotographers,
    featuredPhotographers,
    loading,
    fetchLivePhotographers,
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

  const { ipLocation, cityChanged } = useIPGeolocation();

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

  const { snappedCoordinates, findNearestSpotToCoord } = useSnappedCoordinates({
    selectedSpot,
    longPressLocation,
    userLocation,
    mapCenter,
    ipLocation,
    surfSpots,
  });

 // Weather Mapping State extracted into useWeatherState hook (v125 decomposition)
  const {
    activeModel, setActiveModel,
    activeLayers,
    timeOffsetHours, setTimeOffsetHours,
    isPlayingTimeline, setIsPlayingTimeline,
    showWeatherControls, setShowWeatherControls,
    radarFrames, radarFrameIndex, setRadarFrameIndex,
    isRadarOrSat,
    maxHoursForUser, isLockedForecast,
    toggleLayer,
    isTimelineCollapsed, setIsTimelineCollapsed,
  } = useWeatherState({ user });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.setActiveModel = setActiveModel;
      window.setTimeOffsetHours = setTimeOffsetHours;
      window.toggleLayer = toggleLayer;
    }
  }, [setActiveModel, setTimeOffsetHours, toggleLayer]);

  // Snapped ocean/water coordinates to avoid querying land cells
  const forecastLat = snappedCoordinates?.lat;
  const forecastLng = snappedCoordinates?.lng;

  // Clear selected spot and long-press location when changing weather layers
  const prevLayersRef = useRef(activeLayers);
  useEffect(() => {
    const prev = prevLayersRef.current;
    if (JSON.stringify(prev) !== JSON.stringify(activeLayers)) {
      setSelectedSpot(null);
      setLongPressLocation(null);
    }
    prevLayersRef.current = activeLayers;
  }, [activeLayers, setSelectedSpot, setLongPressLocation]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__MARINE_BOOT_DIAG__ = {
        activeModel,
        activeLayers,
        timeOffsetHours,
        gpsAvailable: !!userLocation,
        ipAvailable: !!ipLocation,
        snappedCoordinates,
        timestamp: new Date().toISOString()
      };
    }
  }, [activeModel, activeLayers, timeOffsetHours, userLocation, ipLocation, snappedCoordinates]);

  const hasWeatherLayer = activeLayers.length > 0;
  const {
    forecastData,
    marineData: forecastMarineData,
    currentWeather,
    isLoading: forecastLoading,
  } = useOpenMeteoForecast({
    latitude: forecastLat,
    longitude: forecastLng,
    activeModel,
    enabled: true,
    isExplicit: !!(selectedSpot || longPressLocation),
    timeOffsetHours,
    activeLayer: activeLayers[0],
  });

  const handleUpgradeClick = useCallback(() => {
    // Show a toast or trigger subscription modal
    toast.info("Upgrade your subscription to access this feature!");
  }, []);

  
  // Nearest spot (derived from user location)
  const nearestSpot = useMemo(() => 
    userLocation ? findNearestSpot(surfSpots) : null,
    [userLocation, surfSpots, findNearestSpot]
  );

  const {
    showRequestProModal, setShowRequestProModal,
    requestProLoading, setRequestProLoading,
    estimatedDuration, setEstimatedDuration,
    inviteFriends, setInviteFriends,
    pendingRequestPro, setPendingRequestPro,
    requestProLocationLoading, setRequestProLocationLoading,
    showRequestProSelfieModal, setShowRequestProSelfieModal,
    boostHours, setBoostHours,
    onDemandPhotographers, setOnDemandPhotographers,
    requestProSelectedPro, setRequestProSelectedPro,
    onDemandLoading, setOnDemandLoading,
    friendsList, setFriendsList,
    selectedFriends, setSelectedFriends,
    friendsLoading, setFriendsLoading,
    setShowFriendPicker,
    friendSearchQuery, setFriendSearchQuery,
  } = useRequestProState();

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
  const [, setLockedShooterCount] = useState(null);
  
  const [trackingMarkersRef] = useState({ surfer: null, photographer: null, routeLine: null });
  const userMarkerRef = useRef(null);
  const userAccuracyCircleRef = useRef(null);
  const [showPermissionNudge, setShowPermissionNudge] = useState(false);
  const [permissionNudgeAction, setPermissionNudgeAction] = useState('booking');

  const effectiveRole = getEffectiveRole(user?.role);
  const isPhotographer = useMemo(() =>
    ['Hobbyist', 'Photographer', 'Approved Pro'].includes(effectiveRole),
    [effectiveRole]
  );


  // Handle filter change with map resize
  const handleFilterChange = useCallback((newFilter) => {
    setFilter(newFilter);
    
    // Force map resize on filter change
    if (mapInstanceRef.current) {
      setTimeout(() => {
        mapInstanceRef.current.resize();
        
        // Fit bounds to all data points for 'ALL' filter
        if (newFilter === 'all') {
          fitMapToAll(mapInstanceRef.current, surfSpots, livePhotographers);
        }
      }, 100);
    }
  }, [surfSpots, livePhotographers]);



  useEffect(() => {
    if (pendingRequestPro && userLocation) {
      setShowRequestProModal(true);
      setPendingRequestPro(false);
      setRequestProLocationLoading(false);
    }
  }, [userLocation, pendingRequestPro]);

  useEffect(() => {
    if (isImmersiveMode) {
      setShowWeatherControls(false);
      setIsTimelineCollapsed(true);
    }
  }, [isImmersiveMode, setShowWeatherControls, setIsTimelineCollapsed]);

  // Setup Map page SEO meta tags
  useMapSeo();

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

  useEffect(() => {
    fetchOnDemandPros();
  }, [showRequestProModal, userLocation, fetchOnDemandPros]);

  useEffect(() => { fetchFriends(); }, [inviteFriends, user?.id]);

 // Dispatch tracking extracted to useDispatchTracking hook (v80)
  const {
    activeDispatch,
    activeDispatchId,
    setActiveDispatchId,
    clearDispatch,
  } = useDispatchTracking({ userId: user?.id });

  useEffect(() => {
    if (!isPhotographer) return;
    fetchActiveRequests();
    const interval = setInterval(fetchActiveRequests, 30000);
    return () => clearInterval(interval);
  }, [isPhotographer]);

  useEffect(() => {
    if (!supabase) return;
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

  // MapLibre doesn't need these manual updates; React handles it via props!
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
      if (mapInstanceRef.current) {
        mapInstanceRef.current.flyTo({ center: [location.lng, location.lat], zoom: 12 });
      }
    } catch (error) {
      logger.error('[MAP] GPS failed:', error);
      setShowLocationPicker(true);
    }
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

  const currentUserShooting = (livePhotographers || []).find(p => p.id === user?.id);
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
      className={`fixed top-[56px] md:top-0 left-0 right-0 bottom-0 md:left-[200px] ${isLight ? 'bg-gray-50' : 'bg-black'} z-[50]`}
      data-testid="map-page-container"
    >
      {isImmersiveMode && <style>{`[data-testid="bottom-nav"], .bottom-nav-container { transform: translateY(100%); opacity: 0; pointer-events: none !important; } .top-rail-container, .top-rail-container *, .right-controls-container, .right-controls-container *, .nearest-spot-card-container, .nearest-spot-card-container * { pointer-events: none !important; }`}</style>}
      {/* Map Container - Fill entire view */}
      <div className="absolute inset-0 z-0" data-testid="map-container">
        <MapWebGL 
          isLight={isLight}
          userLocation={userLocation}
          effectiveLocation={effectiveLocation}
          surfSpots={surfSpots}
          livePhotographers={livePhotographers}
          filter={filter}
          pulsingMarkers={pulsingMarkers}
          onSpotClick={handleSpotClick}
          onPhotographerClick={handlePhotographerClick}
          mapInstanceRef={mapInstanceRef}
          activeDispatch={activeOnDemandRequests[0]}
          friendsOnMap={friendsOnMap}
          activeModel={activeModel}
          activeLayers={activeLayers}
          radarFrames={radarFrames}
          radarFrameIndex={radarFrameIndex}
          timeOffsetHours={timeOffsetHours}
          onMarineDataChange={setRenderMarineData}
          userTier={user ? (user.subscription_tier || user.tier_id || 'tier_1') : 'guest'}
          onMapClick={(e) => {
            if (e.originalEvent && !e.originalEvent.defaultPrevented) {
              // Clear long-press marker on normal click
              if (longPressLocation) { setLongPressLocation(null); }
              else { setIsImmersiveMode(prev => !prev); }
            }
          }}
          onMapMoveEnd={(center) => setMapCenter(center)}
          onMapLongPress={(lngLat) => {
            if (lngLat && typeof lngLat.lat === 'number' && typeof lngLat.lng === 'number') {
              setLongPressLocation({ lat: lngLat.lat, lng: lngLat.lng });
              setSelectedSpot(null);
              setUnifiedDrawerOpen(false);
            }
          }}
          longPressLocation={longPressLocation}
        />
      </div>

      {isLockedForecast && (
        <div className="absolute inset-0 z-[10] bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="bg-zinc-900/90 p-6 rounded-2xl border border-zinc-800 text-center pointer-events-auto max-w-sm mx-4">
            <div className="w-16 h-16 bg-yellow-400/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-yellow-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Premium Forecast</h2>
            <p className="text-gray-400 mb-6 text-sm">You've reached the end of your forecast. Upgrade to view conditions up to 14 days in advance.</p>
            <button onClick={handleUpgradeClick} className="w-full bg-yellow-400 text-black font-bold py-3 px-4 rounded-xl hover:bg-yellow-500 transition-colors">
              Unlock Extended Forecast
            </button>
          </div>
        </div>
      )}

      {/* TOP RAIL */}
      <div 
        className={`absolute top-0 left-0 right-0 z-[1000] pointer-events-none pt-4 transition-opacity duration-300 ${isImmersiveMode ? 'opacity-0' : 'opacity-100'} top-rail-container`} 
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
              if (mapInstanceRef.current && isValidLatLng(spot.latitude, spot.longitude)) {
                mapInstanceRef.current.flyTo({
                  center: [spot.longitude, spot.latitude],
                  zoom: 14,
                  pitch: 45,
                  duration: 1000
                });
              }
              setSelectedSpot(spot);
              setUnifiedDrawerOpen(true);
            }}
          />
          <RequestProButton
            userLocation={userLocation}
            requestProLocationLoading={requestProLocationLoading}
            setPendingRequestPro={setPendingRequestPro}
            setRequestProLocationLoading={setRequestProLocationLoading}
            setLocationDenied={setLocationDenied}
            getUserLocation={getUserLocation}
            setShowRequestProModal={setShowRequestProModal}
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
        </div>
      </div>

      <div className={`transition-opacity duration-300 ${isImmersiveMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <DispatchTrackingPanel activeDispatch={activeDispatch} onDismiss={clearDispatch} />
      </div>

      <div className={`transition-opacity duration-300 ${isImmersiveMode ? 'opacity-0 pointer-events-none' : 'opacity-100'} right-controls-container`}>
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
          showWeatherControls={showWeatherControls}
          onToggleWeatherControls={() => setShowWeatherControls(!showWeatherControls)}
          activeLayers={activeLayers}
        />
      </div>

      {/* Desktop Weather Controls */}
      <MapWeatherControls 
        isDesktop={true}
        activeModel={activeModel}
        onModelChange={setActiveModel}
        activeLayers={activeLayers}
        onLayerToggle={toggleLayer}
        userTier={user ? (user.subscription_tier || user.tier_id || 'tier_1') : 'guest'}
        onUpgradeClick={handleUpgradeClick}
        radarMode={isRadarOrSat}
        radarFrames={radarFrames}
        radarFrameIndex={radarFrameIndex}
        onRadarFrameChange={setRadarFrameIndex}
        currentTimeOffset={timeOffsetHours}
        onTimeChange={setTimeOffsetHours}
        isPlaying={isPlayingTimeline}
        onTogglePlay={() => setIsPlayingTimeline(!isPlayingTimeline)}
        isImmersiveMode={isImmersiveMode}
      />

 {/* Mobile Weather Controls anchors itself and handles expanded/collapsed state */}
      <MapWeatherControls 
        isDesktop={false}
        isMobileExpanded={showWeatherControls}
        isTimelineCollapsed={isTimelineCollapsed}
        onTimelineCollapseToggle={setIsTimelineCollapsed}
        activeModel={activeModel}
        onModelChange={setActiveModel}
        activeLayers={activeLayers}
        onLayerToggle={(layerId) => { toggleLayer(layerId); setShowWeatherControls(false); }}
        userTier={user ? (user.subscription_tier || user.tier_id || 'tier_1') : 'guest'}
        onUpgradeClick={handleUpgradeClick}
        onClose={() => setShowWeatherControls(false)}
        radarMode={isRadarOrSat}
        radarFrames={radarFrames}
        radarFrameIndex={radarFrameIndex}
        onRadarFrameChange={setRadarFrameIndex}
        currentTimeOffset={timeOffsetHours}
        onTimeChange={setTimeOffsetHours}
        isPlaying={isPlayingTimeline}
        onTogglePlay={() => setIsPlayingTimeline(!isPlayingTimeline)}
        isImmersiveMode={isImmersiveMode}
      />



 {/* Forecast Data Overlay shows Open-Meteo data when layer active */}
      {activeLayers.length > 0 && (activeLayers.length > 0 || selectedSpot || longPressLocation) && (
        <MapForecastOverlay
          forecastData={forecastData}
          marineData={forecastMarineData}
          renderMarineData={renderMarineData}
          currentWeather={currentWeather}
          activeLayer={activeLayers[0]}
          activeModel={activeModel}
          timeOffsetHours={timeOffsetHours}
          isLoading={forecastLoading}
          isLockedForecast={isLockedForecast}
          isTimelineCollapsed={isTimelineCollapsed}
          isImmersiveMode={isImmersiveMode}
          selectedSpot={selectedSpot}
          longPressLocation={longPressLocation}
          defaultSnappedLat={snappedCoordinates?.lat}
          defaultSnappedLng={snappedCoordinates?.lng}
        />
      )}

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

      <div className={`transition-opacity duration-300 ${isImmersiveMode ? 'opacity-0 pointer-events-none' : 'opacity-100'} nearest-spot-card-container`}>
        <NearestSpotCard
          nearestSpot={nearestSpot}
          userLocation={userLocation}
          isHidden={showWeatherControls}
          hasActiveLayers={activeLayers.length > 0}
          isTimelineCollapsed={isTimelineCollapsed}
          onSpotSelect={(spot) => {
            if (mapInstanceRef.current && spot.latitude && spot.longitude) {
              mapInstanceRef.current.flyTo({
                center: [spot.longitude, spot.latitude],
                zoom: 14,
                pitch: 45,
                duration: 1000
              });
            }
            setSelectedSpot(spot);
            setUnifiedDrawerOpen(true);
          }}
        />
      </div>

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

      <style>{`.custom-marker, .custom-cluster-marker, .marker-cluster div, .marker-cluster-small, .marker-cluster-medium, .marker-cluster-large { background: transparent !important; border: none !important; } .photographer-marker .animate-ping { animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite; } @keyframes ping { 75%, 100% { transform: scale(1.5); opacity: 0; } }`}</style>

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
        timeOffsetHours={timeOffsetHours}
      />

      <MapPageModals
        showJumpInModal={showJumpInModal}
        setShowJumpInModal={setShowJumpInModal}
        selectedPhotographer={selectedPhotographer}
        setBottomSheetOpen={setBottomSheetOpen}
        showRequestProModal={showRequestProModal}
        setShowRequestProModal={setShowRequestProModal}
        user={user}
        userLocation={userLocation}
        nearestSpot={nearestSpot}
        onDemandPhotographers={onDemandPhotographers}
        onDemandLoading={onDemandLoading}
        friendsList={friendsList}
        friendsLoading={friendsLoading}
        setRequestProSelectedPro={setRequestProSelectedPro}
        setSelectedFriends={setSelectedFriends}
        setFriendSearchQuery={setFriendSearchQuery}
        setShowFriendPicker={setShowFriendPicker}
        setActiveDispatchId={setActiveDispatchId}
        setShowRequestProSelfieModal={setShowRequestProSelfieModal}
        showRequestProSelfieModal={showRequestProSelfieModal}
        activeDispatchId={activeDispatchId}
        showEndSessionModal={showEndSessionModal}
        closeEndSessionModal={closeEndSessionModal}
        handleEndSessionConfirmed={handleEndSessionConfirmed}
        currentLiveSession={currentLiveSession}
        endSessionLoading={endSessionLoading}
        showConditionsModal={showConditionsModal}
        closeConditionsModal={closeConditionsModal}
        handleConditionsConfirm={handleConditionsConfirm}
        goLiveSpotId={goLiveSpotId}
        surfSpots={surfSpots}
        goLiveLoading={goLiveLoading}
        showPermissionNudge={showPermissionNudge}
        setShowPermissionNudge={setShowPermissionNudge}
        getUserLocation={getUserLocation}
        permissionNudgeAction={permissionNudgeAction}
        showGPSGuide={showGPSGuide}
        setShowGPSGuide={setShowGPSGuide}
        gpsLoading={gpsLoading}
        setShowLocationPicker={setShowLocationPicker}
        showLocationPicker={showLocationPicker}
        setUserLocation={setUserLocation}
        mapInstanceRef={mapInstanceRef}
      />
    </div>
  );
};
export var MapPage = () => (
  <MapErrorBoundary>
    <MapPageContent />
  </MapErrorBoundary>
);
export default MapPage;
