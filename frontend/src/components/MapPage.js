import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Lock } from 'lucide-react';
import MapWebGL from './map/MapWebGL';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useTheme } from '../contexts/ThemeContext';
import { toast } from 'sonner';
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
// isValidLatLng guards the flyTo below (L~478). It was USED but never imported — a live
// ReferenceError on the map-search spot-click path, invisible until the ESLint config was
// repaired (2026-07-18: no-undef could not run at all while the linter was crashing).
import { getSharedLandGeoJSON, isValidLatLng } from './map/mapUtils';
import { useMapData } from '../hooks/useMapData';
import { useUserLocation } from '../hooks/useUserLocation';
import { useGoLiveFlow } from '../hooks/useGoLiveFlow';
import { useIPGeolocation } from '../hooks/useIPGeolocation';
import { useMapState } from '../hooks/useMapState';
import useOpenMeteoForecast from '../hooks/useOpenMeteoForecast';
import { useWeatherState } from '../hooks/useWeatherState';
import { useSnappedCoordinates } from '../hooks/useSnappedCoordinates';
import { useMapPhotographerState } from '../hooks/useMapPhotographerState';
import { useMapInteractions } from '../hooks/useMapInteractions';
import logger from '../utils/logger';

var MapPageContent = () => {
  const { user, refreshUser } = useAuth();

  // Refresh user profile and preload land GeoJSON on mount
  useEffect(() => {
    if (user?.id && user.id !== 'dev-mock-user-id') {
      refreshUser();
    }
    getSharedLandGeoJSON().catch(err => {
      logger.warn('[MapPage] Failed to preload land GeoJSON:', err);
    });
  }, []);
  const { theme } = useTheme();
  const { getEffectiveRole } = usePersona();
  const isLight = theme === 'light';
  const mapInstanceRef = useRef(null);
  const mapPageContainerRef = useRef(null);

  // Keep the WebGL map canvas sized to its container (2026-07-03). The container's left offset now
  // follows the sidebar rail width per breakpoint (md:left-16 xl:left-[200px]) — it was a hardcoded
  // 200px at ALL md+ widths, so tablets/15" laptops (md–lg: 64px rail) showed a 136px dead strip the
  // map never reclaimed. The map lib only auto-resizes on window `resize`; a container box change
  // WITHOUT one (breakpoint class swap, browser zoom, immersive toggle) leaves a stale canvas — so
  // observe the container box directly and resize the map whenever it changes.
  useEffect(() => {
    const el = mapPageContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try { mapInstanceRef.current && mapInstanceRef.current.resize(); } catch (e) { /* map not ready */ }
      });
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

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

  const memoizedUserLocation = useMemo(() => {
    if (!userLocation) return null;
    return {
      lat: userLocation.lat,
      lng: userLocation.lng,
      accuracy: userLocation.accuracy
    };
  }, [userLocation?.lat, userLocation?.lng, userLocation?.accuracy]);

  const {
    surfSpots,
    livePhotographers,
    featuredPhotographers,
    loading,
    fetchLivePhotographers,
  } = useMapData(user?.id, memoizedUserLocation);

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
    if (memoizedUserLocation?.lat && memoizedUserLocation?.lng && 
        !isNaN(memoizedUserLocation.lat) && !isNaN(memoizedUserLocation.lng) &&
        isFinite(memoizedUserLocation.lat) && isFinite(memoizedUserLocation.lng)) {
      return { ...memoizedUserLocation, source: 'gps' };
    }
    if (ipLocation?.lat && ipLocation?.lng &&
        !isNaN(ipLocation.lat) && !isNaN(ipLocation.lng) &&
        isFinite(ipLocation.lat) && isFinite(ipLocation.lng)) {
      return { ...ipLocation, source: 'ip' };
    }
    return null;
  }, [memoizedUserLocation, ipLocation]);

  const { snappedCoordinates, findNearestSpotToCoord } = useSnappedCoordinates({
    selectedSpot,
    longPressLocation,
    userLocation: memoizedUserLocation,
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
      // Exposed for the scrub-perf harness (scrubPerfProbe.bench) — drives the real playback loop.
      window.setRadarFrameIndex = setRadarFrameIndex;
      window.setIsPlayingTimeline = setIsPlayingTimeline;
    }
  }, [setActiveModel, setTimeOffsetHours, toggleLayer, setRadarFrameIndex, setIsPlayingTimeline]);

  // Snapped ocean/water coordinates to avoid querying land cells
  const forecastLat = snappedCoordinates?.lat;
  const forecastLng = snappedCoordinates?.lng;

  // Clear selected spot and long-press location when changing weather layers,
  // except when toggling between compatible marine layers.
  const prevLayersRef = useRef(activeLayers);
  useEffect(() => {
    const prev = prevLayersRef.current;
    if (JSON.stringify(prev) !== JSON.stringify(activeLayers)) {
      const isMarineLayer = (layer) => ["waves", "swell_1", "swell_2", "wind_waves"].includes(layer);
      const prevIsMarine = prev.length > 0 && prev.every(isMarineLayer);
      const nextIsMarine = activeLayers.length > 0 && activeLayers.every(isMarineLayer);
      
      if (!(prevIsMarine && nextIsMarine)) {
        setSelectedSpot(null);
        setLongPressLocation(null);
      }
    }
    prevLayersRef.current = activeLayers;
  }, [activeLayers, setSelectedSpot, setLongPressLocation]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__MARINE_BOOT_DIAG__ = {
        activeModel,
        activeLayers,
        timeOffsetHours,
        gpsAvailable: !!memoizedUserLocation,
        ipAvailable: !!ipLocation,
        snappedCoordinates,
        timestamp: new Date().toISOString()
      };
    }
  }, [activeModel, activeLayers, timeOffsetHours, memoizedUserLocation, ipLocation, snappedCoordinates]);

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
    memoizedUserLocation ? findNearestSpot(surfSpots) : null,
    [memoizedUserLocation, surfSpots, findNearestSpot]
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
    friendsOnMap, showFriendsOnMap, setShowFriendsOnMap,
    friendMarkersRef,
    activeOnDemandRequests, setActiveOnDemandRequests,
    setLockedShooterCount,
    trackingMarkersRef, userMarkerRef, userAccuracyCircleRef,
    showPermissionNudge, setShowPermissionNudge,
    permissionNudgeAction, setPermissionNudgeAction,
    effectiveRole, isPhotographer,
  } = useMapPhotographerState({ user, mapInstanceRef, getEffectiveRole });


  const {
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
    currentUserShooting,
    activeDispatch,
    activeDispatchId,
    setActiveDispatchId,
    clearDispatch,
    fetchActiveShootersAtSpot,
  } = useMapInteractions({
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
    hookHandleConditionsConfirm,
    handleStopLive,
    fetchLivePhotographers,
  });

  if (loading) {
    return (
      <div 
        className={`fixed ${isLight ? 'bg-white' : 'bg-black'} md:left-16 xl:left-[200px] flex items-center justify-center`}
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
      ref={mapPageContainerRef}
      className={`fixed top-[56px] md:top-0 left-0 right-0 bottom-0 md:left-16 xl:left-[200px] ${isLight ? 'bg-gray-50' : 'bg-black'} z-[50] ${isImmersiveMode ? 'immersive' : ''}`}
      data-testid="map-page-container"
    >
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
          isPlaying={isPlayingTimeline}
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
