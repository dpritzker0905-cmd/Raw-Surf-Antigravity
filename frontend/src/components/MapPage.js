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
import MapTimelineSlider from './map/MapTimelineSlider';
import MapForecastOverlay from './map/MapForecastOverlay';
import { RequestProButton } from './map/RequestProButton';
import { FLORIDA_CENTER } from './map/mapUtils';
import { useMapData } from '../hooks/useMapData';
import { useUserLocation } from '../hooks/useUserLocation';
import { useGoLiveFlow } from '../hooks/useGoLiveFlow';
import { useIPGeolocation } from '../hooks/useIPGeolocation';
import { useMapState } from '../hooks/useMapState';
import { useFriendsOnMap } from '../hooks/useFriendsOnMap';
import logger from '../utils/logger';
import useDispatchTracking from '../hooks/useDispatchTracking';
import useOpenMeteoForecast from '../hooks/useOpenMeteoForecast';
import { useMapSeo } from '../hooks/useMapSeo';

const MapPageContent = () => {
  const { user } = useAuth();
  const { getEffectiveRole } = usePersona();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const mapInstanceRef = useRef(null);

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

  // Weather Mapping State
  const [activeModel, setActiveModel] = useState('GFS');
  const [activeLayers, setActiveLayers] = useState([]);
  const [timeOffsetHours, setTimeOffsetHours] = useState(0);
  const [isPlayingTimeline, setIsPlayingTimeline] = useState(false);
  const [showWeatherControls, setShowWeatherControls] = useState(false);

  // Open-Meteo 16-day forecast (weather + marine) — driven by map center & model
  // PLACEMENT: Must be AFTER activeModel useState (v30 hook placement rule)
  const {
    forecastData,
    marineData,
    isLoading: forecastLoading,
  } = useOpenMeteoForecast({
    latitude: effectiveLocation?.lat || FLORIDA_CENTER.lat,
    longitude: effectiveLocation?.lng || FLORIDA_CENTER.lng,
    activeModel,
    enabled: true,
  });

  // Radar animation state — driven by RainViewer past frames
  const [radarFrames, setRadarFrames] = useState([]);
  const [radarFrameIndex, setRadarFrameIndex] = useState(0);
  const radarIntervalRef = useRef(null);

  // Fetch RainViewer frames once on mount
  useEffect(() => {
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(r => r.json())
      .then(data => {
        const past = data?.radar?.past || [];
        const nowcast = data?.radar?.nowcast || [];
        const allFrames = [...past, ...nowcast];
        if (allFrames.length > 0) {
          setRadarFrames(allFrames);
          setRadarFrameIndex(past.length > 0 ? past.length - 1 : 0);
        }
      })
      .catch(err => logger.error('[MAP] RainViewer fetch failed:', err));
  }, []);

  // Animation intervals — cycles through frames/time when playing
  const isRadarActive = activeLayers.includes('radar');
  const isSatelliteActive = activeLayers.includes('satellite');
  const isRadarOrSat = isRadarActive || isSatelliteActive;
  // All weather layers are now animated (radar via frames, others via time offset)
  const isAnimatedLayer = activeLayers.length > 0;

  // Radar/Satellite frame animation
  useEffect(() => {
    if (isPlayingTimeline && isRadarOrSat && radarFrames.length > 1) {
      radarIntervalRef.current = setInterval(() => {
        setRadarFrameIndex(prev => (prev + 1) % radarFrames.length);
      }, 800);
    }
    return () => {
      if (radarIntervalRef.current) clearInterval(radarIntervalRef.current);
    };
  }, [isPlayingTimeline, isRadarOrSat, radarFrames.length]);

  const maxHoursForUser = useMemo(() => {
    const tier = user?.tier_id || 'tier_1';
    if (tier === 'tier_3' || tier === 'admin') return 14 * 24;
    if (tier === 'tier_2') return 7 * 24;
    return 24;
  }, [user]);

  const isLockedForecast = timeOffsetHours > maxHoursForUser;

  // Forecast time-step animation (non-radar layers: precipitation, wind, pressure, waves)
  const forecastIntervalRef = useRef(null);
  useEffect(() => {
    if (isPlayingTimeline && !isRadarOrSat && activeLayers.length > 0) {
      forecastIntervalRef.current = setInterval(() => {
        setTimeOffsetHours(prev => {
          const next = prev + 3; // step 3 hours per tick
          return next > maxHoursForUser ? 0 : next; // loop back to Live
        });
      }, 1200);
    }
    return () => {
      if (forecastIntervalRef.current) clearInterval(forecastIntervalRef.current);
    };
  }, [isPlayingTimeline, isRadarOrSat, activeLayers, maxHoursForUser]);

  const toggleLayer = useCallback((layerId) => {
    setActiveLayers(prev => 
      prev.includes(layerId) ? [] : [layerId]
    );
    // Reset play state when switching layers
    setIsPlayingTimeline(false);
    setTimeOffsetHours(0);
  }, []);

  const handleUpgradeClick = useCallback(() => {
    // Show a toast or trigger subscription modal
    toast.info("Upgrade your subscription to access this feature!");
  }, []);

  
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
  const userMarkerRef = useRef(null);
  const userAccuracyCircleRef = useRef(null);
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
        mapInstanceRef.current.resize();
        
        // Fit bounds to all data points for 'ALL' filter
        if (newFilter === 'all') {
          let minLng = Infinity, minLat = Infinity;
          let maxLng = -Infinity, maxLat = -Infinity;
          
          surfSpots.forEach(spot => {
            if (spot.latitude && spot.longitude) {
              minLng = Math.min(minLng, spot.longitude);
              minLat = Math.min(minLat, spot.latitude);
              maxLng = Math.max(maxLng, spot.longitude);
              maxLat = Math.max(maxLat, spot.latitude);
            }
          });
          livePhotographers.forEach(p => {
            if (p.current_latitude && p.current_longitude) {
              minLng = Math.min(minLng, p.current_longitude);
              minLat = Math.min(minLat, p.current_latitude);
              maxLng = Math.max(maxLng, p.current_longitude);
              maxLat = Math.max(maxLat, p.current_latitude);
            }
          });
          
          if (minLng !== Infinity) {
            mapInstanceRef.current.fitBounds(
              [[minLng, minLat], [maxLng, maxLat]], 
              { padding: 50 }
            );
          } else {
            // Default to Florida center if no data
            mapInstanceRef.current.jumpTo({
              center: [FLORIDA_CENTER.lng, FLORIDA_CENTER.lat], 
              zoom: 7
            });
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

  // Setup Map page SEO meta tags
  useMapSeo();

  useEffect(() => {
    fetchOnDemandPros();
  }, [showRequestProModal, userLocation]);

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

  useEffect(() => { fetchFriends(); }, [inviteFriends, user?.id]);

  // Dispatch tracking — extracted to useDispatchTracking hook (v80)
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
      className={`fixed top-[56px] md:top-0 left-0 right-0 bottom-0 md:left-[200px] ${isLight ? 'bg-gray-50' : 'bg-black'} z-[50]`}
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
        className="absolute top-0 left-0 right-0 z-[1000] pointer-events-none pt-4" 
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
          <IPLocationBanner
            showIpBanner={showIpBanner}
            cityChanged={cityChanged}
            locationDenied={locationDenied}
            ipLocation={ipLocation}
            userLocation={userLocation}
            onRequestGPS={getUserLocation}
            onDismiss={() => setShowIpBanner(false)}
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
        showWeatherControls={showWeatherControls}
        onToggleWeatherControls={() => setShowWeatherControls(!showWeatherControls)}
      />

      {/* Desktop Weather Controls */}
      <MapWeatherControls 
        isDesktop={true}
        activeModel={activeModel}
        onModelChange={setActiveModel}
        activeLayers={activeLayers}
        onLayerToggle={toggleLayer}
        userTier={user?.tier_id || 'tier_1'}
        onUpgradeClick={handleUpgradeClick}
      />

      {/* Mobile Weather Controls — anchored ABOVE bottom nav bar */}
      {showWeatherControls && (
        <>
          <div 
            className="absolute inset-0 z-[999] bg-black/20 md:hidden"
            onClick={() => setShowWeatherControls(false)}
          />
          <div className="absolute left-0 right-0 z-[1000] md:hidden shadow-2xl" style={{ bottom: '64px' }}>
            <MapWeatherControls 
              isDesktop={false}
              activeModel={activeModel}
              onModelChange={setActiveModel}
              activeLayers={activeLayers}
              onLayerToggle={(layerId) => { toggleLayer(layerId); setShowWeatherControls(false); }}
              userTier={user?.tier_id || 'tier_1'}
              onUpgradeClick={handleUpgradeClick}
              onClose={() => setShowWeatherControls(false)}
            />
          </div>
        </>
      )}

      {/* Timeline / Radar Scrubber (shows when any weather layer is active) */}
      {activeLayers.length > 0 && (
        <MapTimelineSlider
          radarMode={isAnimatedLayer}
          radarFrames={radarFrames}
          radarFrameIndex={radarFrameIndex}
          onRadarFrameChange={setRadarFrameIndex}
          currentTimeOffset={timeOffsetHours}
          onTimeChange={setTimeOffsetHours}
          isPlaying={isPlayingTimeline}
          onTogglePlay={() => setIsPlayingTimeline(!isPlayingTimeline)}
          userTier={user?.tier_id || 'tier_1'}
          onUpgradeClick={handleUpgradeClick}
        />
      )}

      {/* Forecast Data Overlay — shows Open-Meteo data when layer active */}
      {activeLayers.length > 0 && (
        <MapForecastOverlay
          forecastData={forecastData}
          marineData={marineData}
          activeLayer={activeLayers[0]}
          activeModel={activeModel}
          timeOffsetHours={timeOffsetHours}
          isLoading={forecastLoading}
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

      <NearestSpotCard
        nearestSpot={nearestSpot}
        userLocation={userLocation}
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

export const MapPage = () => (
  <MapErrorBoundary>
    <MapPageContent />
  </MapErrorBoundary>
);

export default MapPage;