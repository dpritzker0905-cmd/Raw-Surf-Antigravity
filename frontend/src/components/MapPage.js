import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import apiClient from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useTheme } from '../contexts/ThemeContext';
import { MapPin, Camera, Users, X, MessageCircle, Navigation, Loader2, Check } from 'lucide-react';
import { PermissionNudgeDrawer } from './PermissionNudgeDrawer';
import { Button } from './ui/button';
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
import {
  API, ELECTRIC_CYAN, FLORIDA_CENTER, getErrorMessage, debounce, truncateCoord, isValidLatLng,
  TILE_LAYER_CONFIG, MAPBOX_TILES, DEFAULT_MAP_OPTIONS, SPOT_CLUSTER_OPTIONS, PHOTOGRAPHER_CLUSTER_OPTIONS
} from './map/mapUtils';
import { useMapData } from '../hooks/useMapData';
import { useUserLocation } from '../hooks/useUserLocation';
import { useGoLiveFlow } from '../hooks/useGoLiveFlow';
import { useIPGeolocation } from '../hooks/useIPGeolocation';
import { useMarkerClustering } from '../hooks/useMarkerClustering';
import { useMapState } from '../hooks/useMapState';
import { useFriendsOnMap } from '../hooks/useFriendsOnMap';
import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';

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
  const [activeDispatchId, setActiveDispatchId] = useState(null);
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
  
  const [activeDispatch, setActiveDispatch] = useState(null);
  const [trackingMarkersRef] = useState({ surfer: null, photographer: null, routeLine: null });
  const trackingIntervalRef = useRef(null);
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

  useEffect(() => {
    const checkActiveDispatch = async () => {
      if (!user?.id) return;
      try {
        const response = await apiClient.get(`/dispatch/user/${user.id}/active`);
        if (response.data && response.data.status === 'en_route') {
          setActiveDispatch(response.data);
        }
      } catch (e) {}
    };
    
    checkActiveDispatch();
  }, [user?.id]);

  useEffect(() => {
    if (!isPhotographer) return;
    fetchActiveRequests();
    const interval = setInterval(fetchActiveRequests, 30000);
    return () => clearInterval(interval);
  }, [isPhotographer]);

  useEffect(() => {
    if (!activeDispatch || activeDispatch.status !== 'en_route') {
      if (trackingIntervalRef.current) clearInterval(trackingIntervalRef.current);
      return;
    }
    const pollLocations = async () => {
      try {
        const response = await apiClient.get(`/dispatch/${activeDispatch.id}/tracking`);
        setActiveDispatch(prev => ({
          ...prev,
          photographer_lat: response.data.photographer_location?.lat,
          photographer_lng: response.data.photographer_location?.lng,
          requester_lat: response.data.requester_location?.lat,
          requester_lng: response.data.requester_location?.lng,
          estimated_arrival_minutes: response.data.estimated_arrival_minutes
        }));
        updateTrackingMarkers(response.data);
      } catch (error) {
        logger.error('Error polling dispatch locations:', error);
      }
    };
    const sendLocationUpdate = async () => {
      if (!navigator.geolocation) return;
      
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          await apiClient.post(`/dispatch/${activeDispatch.id}/update-location`, {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        } catch (error) {
          logger.error('Error sending location update:', error);
        }
      });
    };
    pollLocations();
    sendLocationUpdate();
    trackingIntervalRef.current = setInterval(() => {
      pollLocations();
      sendLocationUpdate();
    }, 5000);
    
    return () => {
      if (trackingIntervalRef.current) clearInterval(trackingIntervalRef.current);
    };
  }, [activeDispatch?.id, activeDispatch?.status, user?.id]);

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
    if (!mapInstanceRef.current || !window.L) return;
    friendMarkersRef.current.forEach(m => m.remove());
    friendMarkersRef.current = [];
    if (!showFriendsOnMap || friendsOnMap.length === 0) return;
    friendsOnMap.forEach(friend => {
      if (!friend.latitude || !friend.longitude) return;
      
      const friendIcon = window.L.divIcon({
        className: 'custom-marker friend-marker',
        html: `
          <div class="relative">
            <div class="absolute inset-0 w-10 h-10 rounded-full bg-yellow-400 animate-pulse opacity-30"></div>
            <div class="relative w-10 h-10 rounded-full p-[2px] bg-gradient-to-r from-yellow-400 to-orange-400">
              <div class="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                ${friend.avatar_url 
                  ? `<img loading="lazy" decoding="async" src="${friend.avatar_url}" alt="${friend.full_name || 'Friend'} avatar" class="w-full h-full object-cover" />`
                  : `<span class="text-sm text-yellow-400 font-bold">${friend.full_name?.charAt(0) || '?'}</span>`
                }
              </div>
            </div>
            <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-yellow-400 rounded text-[8px] text-black font-bold whitespace-nowrap">
              ${friend.is_shooting ? 'LIVE' : 'FRIEND'}
            </div>
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 40]
      });
      
      const marker = window.L.marker([friend.latitude, friend.longitude], { icon: friendIcon })
        .addTo(mapInstanceRef.current)
        .bindPopup(`
          <div class="text-center p-2">
            <p class="font-bold text-sm">${friend.full_name}</p>
            <p class="text-xs text-gray-500">${friend.role}</p>
            ${friend.is_shooting ? '<p class="text-xs text-emerald-500 font-bold">Currently Shooting</p>' : ''}
          </div>
        `);
      
      friendMarkersRef.current.push(marker);
    });
  }, [friendsOnMap, showFriendsOnMap]);

  useEffect(() => {
    if (!mapInstanceRef.current || !isPhotographer) return;
    onDemandMarkersRef.current.forEach(m => m.remove());
    onDemandMarkersRef.current = [];
    
    if (!activeOnDemandRequests || activeOnDemandRequests.length === 0) return;
    const getPriorityColors = (badge, isBoosted) => {
      if (isBoosted) return { gradient: 'from-orange-400 to-red-600', shadow: 'orange', bg: 'orange', ring: 'ring-orange-400' };
      
      if (!badge) return { gradient: 'from-emerald-400 to-green-600', shadow: 'emerald', bg: 'emerald' };
      
      switch (badge.level) {
        case 'boosted':
          return { gradient: 'from-orange-400 to-red-600', shadow: 'orange', bg: 'orange', ring: 'ring-orange-400' };
        case 'pro':
          return { gradient: 'from-yellow-400 to-amber-600', shadow: 'amber', bg: 'amber', ring: 'ring-yellow-400' };
        case 'comp':
          return { gradient: 'from-purple-400 to-violet-600', shadow: 'violet', bg: 'purple', ring: 'ring-purple-400' };
        default:
          return { gradient: 'from-cyan-400 to-blue-600', shadow: 'cyan', bg: 'cyan', ring: 'ring-cyan-400' };
      }
    };
    activeOnDemandRequests.forEach((request, index) => {
      if (!request.latitude || !request.longitude) return;
      
      const isBoosted = request.is_boosted;
      const badge = request.priority_badge || { level: 'regular', label: 'Surfer', color: 'cyan' };
      const colors = getPriorityColors(badge, isBoosted);
      const queuePosition = index + 1;
      const badgeIcon = isBoosted
        ? `<svg class="w-3 h-3 text-orange-400" fill="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"/><path d="M12 2v14"/></svg>`
        : badge.level === 'pro'
        ? `<svg class="w-3 h-3 text-${colors.bg}-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L14.09 8.26L21 9.27L16 14.14L17.18 21.02L12 17.77L6.82 21.02L8 14.14L3 9.27L9.91 8.26L12 2Z"/></svg>`
        : badge.level === 'comp'
        ? `<svg class="w-3 h-3 text-${colors.bg}-400" fill="currentColor" viewBox="0 0 24 24"><path d="M17 10.43V3H7v7.43c0 .35.18.68.49.86l4.18 2.51-.99 2.34-3.41.29 2.59 2.24L9.07 22 12 20.23 14.93 22l-.79-3.33 2.59-2.24-3.41-.29-.99-2.34 4.18-2.51c.3-.18.49-.51.49-.86z"/></svg>`
        : `<svg class="w-3 h-3 text-${colors.bg}-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;
      
      const onDemandIcon = window.L.divIcon({
        className: 'custom-marker on-demand-marker',
        html: `
          <div class="relative">
            <div class="absolute inset-0 w-14 h-14 -top-1 -left-1 rounded-full bg-${colors.bg}-400 animate-ping opacity-40"></div>
            <div class="absolute inset-0 w-12 h-12 rounded-full bg-${colors.bg}-500 animate-pulse opacity-30"></div>
            <div class="absolute -top-2 -right-2 z-10 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-${colors.bg}-500/90 text-white text-[8px] font-bold shadow-md ${isBoosted || badge.level === 'pro' ? 'animate-pulse' : ''}">
              ${badgeIcon}
              ${isBoosted ? '🚀' : badge.level === 'pro' ? 'PRO' : badge.level === 'comp' ? 'COMP' : ''}
            </div>
            ${isBoosted ? `
              <div class="absolute -top-2 -left-2 z-10 px-1.5 py-0.5 rounded-full bg-orange-500 text-white text-[8px] font-bold shadow-md animate-pulse">
                ${request.boost_time_remaining_minutes || 0}m
              </div>
            ` : badge.level === 'pro' ? `
              <div class="absolute -top-2 -left-2 z-10 w-5 h-5 rounded-full bg-yellow-500 text-black text-[10px] font-bold flex items-center justify-center shadow-md">
                ${queuePosition}
              </div>
            ` : ''}
            <div class="relative w-12 h-12 rounded-full bg-gradient-to-br ${colors.gradient} p-[3px] shadow-lg shadow-${colors.shadow}-500/50">
              <div class="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                ${request.requester_avatar 
                  ? `<img loading="lazy" decoding="async" src="${request.requester_avatar}" alt="${request.requester_name || 'Requester'} avatar" class="w-full h-full object-cover" />`
                  : `<span class="text-${colors.bg}-400 text-lg font-bold">${request.requester_name?.charAt(0) || 'S'}</span>`
                }
              </div>
            </div>
            <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-${colors.bg}-500 rounded text-[9px] text-white font-bold whitespace-nowrap animate-pulse">
              ${isBoosted ? 'BOOSTED 🚀' : 'NEEDS PRO'}
            </div>
          </div>
        `,
        iconSize: [48, 56],
        iconAnchor: [24, 56]
      });
      
      const popupBgColor = isBoosted ? '#ea580c' : (badge.color === 'yellow' ? '#eab308' : badge.color === 'purple' ? '#a855f7' : '#06b6d4');
      const popupTextColor = isBoosted ? '#c2410c' : (badge.color === 'yellow' ? '#ca8a04' : badge.color === 'purple' ? '#9333ea' : '#0891b2');
      
      const marker = window.L.marker([request.latitude, request.longitude], { icon: onDemandIcon })
        .addTo(mapInstanceRef.current)
        .bindPopup(`
          <div class="text-center p-2 min-w-[150px]">
            <div class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full mb-2" style="background: ${popupBgColor}">
              <span class="text-[10px] font-bold text-white">${isBoosted ? 'BOOSTED 🚀' : badge.label.toUpperCase()}</span>
            </div>
            
            <p class="font-bold text-sm" style="color: ${popupTextColor}">${request.requester_name}</p>
            <p class="text-xs text-gray-500">Looking for a Pro</p>
            <p class="text-xs text-gray-400 mt-1">${request.location_name || 'Nearby'}</p>
            <p class="text-xs font-medium mt-1" style="color: ${badge.color === 'yellow' ? '#ca8a04' : badge.color === 'purple' ? '#9333ea' : '#0891b2'}">${request.estimated_duration}h session</p>
            ${badge.level === 'pro' ? '<p class="text-[10px] font-bold text-yellow-600 mt-2">? PRIORITY REQUEST</p>' : ''}
          </div>
        `);
      
      onDemandMarkersRef.current.push(marker);
    });
  }, [activeOnDemandRequests, isPhotographer]);

  // Get user's GPS location - NUCLEAR: Recreate map at new location
  const getUserLocation = async () => {
    try {
      const location = await requestLocation();
      
      // Validate coordinates
      if (!location?.lat || !location?.lng ||
          typeof location.lat !== 'number' || typeof location.lng !== 'number' ||
          Number.isNaN(location.lat) || Number.isNaN(location.lng)) {
        logger.error('[MAP] Invalid location:', location);
        setShowLocationPicker(true);
        return;
      }
      
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      
      setTimeout(() => {
        if (mapRef.current && window.L) {
          const map = window.L.map(mapRef.current, {
            center: [location.lat, location.lng], zoom: 12,
            ...DEFAULT_MAP_OPTIONS
          });
          window.L.tileLayer(mapTilesUrl, TILE_LAYER_CONFIG.options).addTo(map);
          window.L.control.zoom({ position: 'bottomright' }).addTo(map);
          
          spotClusterRef.current = window.L.markerClusterGroup(SPOT_CLUSTER_OPTIONS);
          map.addLayer(spotClusterRef.current);
          photographerClusterRef.current = window.L.markerClusterGroup(PHOTOGRAPHER_CLUSTER_OPTIONS);
          map.addLayer(photographerClusterRef.current);

          if (window.visualViewport) {
            const onVvResize = debounce(() => {
              if (mapInstanceRef.current) {
                mapInstanceRef.current.invalidateSize({ pan: false });
              }
            }, 100);
            window.visualViewport.addEventListener('resize', onVvResize);
            window.visualViewport.addEventListener('scroll', onVvResize);
            map.on('remove', () => {
              window.visualViewport.removeEventListener('resize', onVvResize);
              window.visualViewport.removeEventListener('scroll', onVvResize);
            });
          }
          
          mapInstanceRef.current = map;
          
          // Update markers
          setTimeout(() => {
            updateMapMarkers();
            updateUserLocationMarker();
            if (mapInstanceRef.current) {
              mapInstanceRef.current.invalidateSize();
            }
          }, 100);
        }
      }, 100);

      
    } catch (error) {
      logger.error('[MAP] GPS failed:', error);
      setShowLocationPicker(true);
    }
  };

  const initMap = () => {
    if (!mapRef.current || !window.L) {
      logger.warn('[MAP] Missing container or Leaflet');
      return;
    }
    
    try {
      mapRef.current.style.height = '100%';
      mapRef.current.style.minHeight = '50vh';
    const rect = mapRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      setTimeout(initMap, 100);
      return;
    }
    if (mapInstanceRef.current) return;
    const map = window.L.map(mapRef.current, {
      center: [FLORIDA_CENTER.lat, FLORIDA_CENTER.lng],
      zoom: 7,
      ...DEFAULT_MAP_OPTIONS
    });
    setTimeout(() => { if (map?.invalidateSize) map.invalidateSize(); }, 100);
    const tileLayer = window.L.tileLayer(mapTilesUrl, TILE_LAYER_CONFIG.options).addTo(map);
    map._tileLayer = tileLayer;
    window.L.control.zoom({ position: 'bottomright' }).addTo(map);
    
    // Initialize marker cluster groups with custom icons
    spotClusterRef.current = window.L.markerClusterGroup({
      ...SPOT_CLUSTER_OPTIONS,
      chunkInterval: 100,
      chunkDelay: 25,
      animate: true,
      animateAddingMarkers: false,
      removeOutsideVisibleBounds: true,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        return window.L.divIcon({
          className: 'custom-cluster-marker',
          html: `
            <div class="w-10 h-10 rounded-full bg-gradient-to-r from-emerald-400 to-yellow-400 flex items-center justify-center shadow-lg">
              <span class="text-black font-bold text-sm">${count}</span>
            </div>
          `,
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        });
      }
    });
    photographerClusterRef.current = window.L.markerClusterGroup({
      ...PHOTOGRAPHER_CLUSTER_OPTIONS,
      maxClusterRadius: 80,
      disableClusteringAtZoom: 12,
      chunkInterval: 100,
      chunkDelay: 25,
      animate: true,
      animateAddingMarkers: false,
      removeOutsideVisibleBounds: true,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        return window.L.divIcon({
          className: 'custom-cluster-marker',
          html: `
            <div class="relative">
              <div class="absolute inset-0 w-12 h-12 rounded-full bg-cyan-400 animate-ping opacity-30"></div>
              <div class="w-12 h-12 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg">
                <span class="text-white font-bold text-sm">${count}</span>
              </div>
            </div>
          `,
          iconSize: [48, 48],
          iconAnchor: [24, 24]
        });
      }
    });
    
    map.addLayer(spotClusterRef.current);
    map.addLayer(photographerClusterRef.current);
    const debouncedMoveEnd = debounce(() => {}, 250);
    map.on('moveend', debouncedMoveEnd);

    if (window.visualViewport) {
      const onVisualViewportResize = debounce(() => {
        if (mapInstanceRef.current) mapInstanceRef.current.invalidateSize({ pan: false });
      }, 100);
      window.visualViewport.addEventListener('resize', onVisualViewportResize);
      window.visualViewport.addEventListener('scroll', onVisualViewportResize);
      map.on('remove', () => {
        window.visualViewport.removeEventListener('resize', onVisualViewportResize);
        window.visualViewport.removeEventListener('scroll', onVisualViewportResize);
      });
    }
    mapInstanceRef.current = map;
    updateMapMarkers();
    updateUserLocationMarker();
    } catch (error) {
      logger.error('[MAP] Error initializing map:', error);
      toast.error('Map failed to load', { description: 'Please refresh the page' });
    }
  };

  const updateMapMarkers = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    try {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
    if (spotClusterRef.current) spotClusterRef.current.clearLayers();
    if (photographerClusterRef.current) photographerClusterRef.current.clearLayers();
    

    
    // Add surf spot markers to CLUSTER GROUP for performance
    // Privacy Shield: Shows different visual state based on geofence
    if ((filter === 'all' || filter === 'spots') && spotClusterRef.current) {
      const spotMarkers = [];
      
      surfSpots.forEach(spot => {
        // Validate coordinates before creating marker
        if (!isValidLatLng(spot.latitude, spot.longitude)) return;
        
        const hasPhotographers = spot.active_photographers_count > 0;
        const isWithinGeofence = spot.is_within_geofence !== false; // Default to true if not set
        const distanceMiles = spot.distance_miles;
        
        // Privacy Shield visual state
        const spotIcon = window.L.divIcon({
          className: 'custom-marker',
          html: `
            <div class="relative">
              <div class="w-8 h-8 rounded-full flex items-center justify-center ${
                !isWithinGeofence
                  ? 'bg-zinc-800 border-2 border-zinc-600 opacity-60'
                  : hasPhotographers 
                    ? 'bg-gradient-to-r from-emerald-400 to-yellow-400' 
                    : 'bg-zinc-700 border-2 border-zinc-500'
              }">
                ${!isWithinGeofence ? `
                  <svg class="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 17a2 2 0 002-2V9a2 2 0 00-2-2 2 2 0 00-2 2v6a2 2 0 002 2m6-9h-1V6a5 5 0 00-10 0v2H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2z"/>
                  </svg>
                ` : `
                  <svg class="w-4 h-4 ${hasPhotographers ? 'text-black' : 'text-gray-300'}" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                  </svg>
                `}
              </div>
              ${hasPhotographers && isWithinGeofence ? `
                <div class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[10px] text-white font-bold animate-pulse">
                  ${spot.active_photographers_count}
                </div>
              ` : ''}
              ${!isWithinGeofence && distanceMiles ? `
                <div class="absolute -bottom-5 left-1/2 transform -translate-x-1/2 text-[9px] text-gray-500 whitespace-nowrap font-medium">
                  ${distanceMiles > 100 ? Math.round(distanceMiles) : distanceMiles.toFixed(1)} mi
                </div>
              ` : ''}
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 32]
        });
        
        // Use truncated coordinates for performance
        const marker = window.L.marker(
          [truncateCoord(spot.latitude), truncateCoord(spot.longitude)], 
          { icon: spotIcon }
        ).on('click', () => handleSpotClick(spot));
        
        spotMarkers.push(marker);
      });
      spotClusterRef.current.addLayers(spotMarkers);
    }
    if ((filter === 'all' || filter === 'photographers') && photographerClusterRef.current) {
      const photographerMarkers = [];
      livePhotographers.forEach(photographer => {
        if (!isValidLatLng(photographer.latitude, photographer.longitude)) return;
        const isPulsing = pulsingMarkers.has(photographer.id);
        const isAtOfficialSpot = photographer.current_spot_id || photographer.spot_id;
        const isShootingLive = photographer.is_streaming || photographer.is_live;
        const isOnDemand = photographer.on_demand_available || photographer.is_available_on_demand;
        const isBoth = isShootingLive && isOnDemand;
        let statusClass, ringClass, labelClass, statusLabel;
        if (isBoth) {
          statusClass = 'status-both';
          ringClass = 'status-both-ring';
          labelClass = 'status-both-label';
          statusLabel = 'LIVE + BOOK';
        } else if (isShootingLive) {
          statusClass = 'status-shooting-live';
          ringClass = 'status-shooting-live-ring';
          labelClass = 'status-shooting-live-label';
          statusLabel = 'SHOOTING';
        } else if (isOnDemand) {
          statusClass = 'status-on-demand';
          ringClass = 'status-on-demand-ring';
          labelClass = 'status-on-demand-label';
          statusLabel = 'ON-DEMAND';
        } else {
          statusClass = ''; ringClass = ''; labelClass = ''; statusLabel = 'ROAMING';
        }
        
        const photographerIcon = window.L.divIcon({
          className: 'custom-marker photographer-marker',
          html: isAtOfficialSpot
            ? `
              <div class="photographer-pin-container">
                ${isBoth ? `
                  <div class="photographer-pin-pulse ${statusClass}" style="background: rgba(168, 85, 247, 0.4);"></div>
                  <div class="absolute inset-0 w-14 h-14 -top-1 -left-1 rounded-full ${statusClass}" style="background: rgba(124, 58, 237, 0.3);"></div>
                ` : isShootingLive ? `
                  <div class="photographer-pin-pulse ${statusClass}" style="background: rgba(239, 68, 68, 0.4);"></div>
                  <div class="absolute inset-0 w-14 h-14 -top-1 -left-1 rounded-full ${statusClass}" style="background: rgba(220, 38, 38, 0.3);"></div>
                ` : isOnDemand ? `
                  <div class="photographer-pin-pulse ${statusClass}" style="background: rgba(34, 197, 94, 0.4);"></div>
                  <div class="absolute inset-0 w-14 h-14 -top-1 -left-1 rounded-full ${statusClass}" style="background: rgba(22, 163, 74, 0.3);"></div>
                ` : isPulsing ? `
                  <div class="absolute inset-0 w-16 h-16 -top-2 -left-2 rounded-full animate-ping opacity-60" style="background-color: ${ELECTRIC_CYAN};"></div>
                  <div class="absolute inset-0 w-14 h-14 -top-1 -left-1 rounded-full animate-pulse opacity-40" style="background-color: ${ELECTRIC_CYAN};"></div>
                ` : `
                  <div class="absolute inset-0 w-12 h-12 rounded-full bg-cyan-400 animate-ping opacity-40"></div>
                `}
                <div class="photographer-pin-avatar p-[3px] rounded-full ${ringClass || ''}" style="${!ringClass ? `background: ${isPulsing ? `linear-gradient(135deg, ${ELECTRIC_CYAN}, #0099CC)` : 'linear-gradient(to right, rgb(34 211 238), rgb(59 130 246))'}` : ''}">
                  <div class="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                    ${photographer.avatar_url 
                      ? `<img loading="lazy" decoding="async" src="${photographer.avatar_url}" alt="${photographer.full_name || 'Photographer'} avatar" class="w-full h-full object-cover" />`
                      : `<span class="text-lg ${isBoth ? 'text-purple-400' : isShootingLive ? 'text-red-400' : isOnDemand ? 'text-green-400' : ''}" style="${!isBoth && !isShootingLive && !isOnDemand ? `color: ${isPulsing ? ELECTRIC_CYAN : 'rgb(34 211 238)'}` : ''}">${photographer.full_name?.charAt(0) || '?'}</span>`
                    }
                  </div>
                </div>
                <div class="photographer-pin-status-label ${labelClass || ''}" style="${!labelClass ? `background-color: ${isPulsing ? ELECTRIC_CYAN : 'rgb(16 185 129)'}` : ''}">
                  ${isPulsing ? 'NEW!' : statusLabel}
                </div>
              </div>
            `
            : `
              <div class="relative">
                <div class="absolute inset-0 w-12 h-12 rounded-full bg-orange-400 animate-ping opacity-40"></div>
                <div class="relative w-12 h-12 rounded-full p-[3px]" style="background: linear-gradient(135deg, #f97316, #eab308);">
                  <div class="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                    ${photographer.avatar_url 
                      ? `<img loading="lazy" decoding="async" src="${photographer.avatar_url}" alt="${photographer.full_name || 'Photographer'} avatar" class="w-full h-full object-cover" />`
                      : `<span class="text-lg text-orange-400">${photographer.full_name?.charAt(0) || '?'}</span>`
                    }
                  </div>
                </div>
                <div class="absolute -top-1 -right-1 w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center">
                  <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
                  </svg>
                </div>
                <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-orange-500 rounded text-[9px] text-white font-bold">
                  ROAMING
                </div>
              </div>
            `,
          iconSize: [56, 64],
          iconAnchor: [28, 64]
        });
        
        // Use truncated coordinates for performance
        const marker = window.L.marker(
          [truncateCoord(photographer.latitude), truncateCoord(photographer.longitude)], 
          { icon: photographerIcon }
        ).on('click', () => handlePhotographerClick(photographer));
        
        photographerMarkers.push(marker);
      });
      photographerClusterRef.current.addLayers(photographerMarkers);
    }
    } catch (error) {
      logger.error('[MAP] Error updating markers:', error);
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
          {showIpBanner && (cityChanged || (locationDenied && ipLocation)) && (
            <div 
              className={`mt-2 px-3 py-2 rounded-lg backdrop-blur-sm pointer-events-auto flex items-center justify-between gap-2 text-sm ${
                cityChanged 
                  ? 'bg-gradient-to-r from-yellow-900/80 to-orange-900/80 border border-yellow-500/30' 
                  : 'bg-zinc-800/90 border border-zinc-700'
              }`}
              data-testid="ip-location-banner"
            >
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-4 h-4 flex-shrink-0 text-gray-400" />
                <span className="text-gray-300 truncate">
                  {cityChanged ? 'Updated: ' : ''}
                  <span className="font-medium text-white">{ipLocation?.city}</span>
                  <span className="text-gray-500 text-xs ml-1">(approx)</span>
                </span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {!userLocation && (
                  <button
                    onClick={getUserLocation}
                    className="px-2 py-0.5 text-xs bg-cyan-600 hover:bg-cyan-500 rounded text-white"
                    data-testid="grant-gps-link"
                  >
                    GPS
                  </button>
                )}
                <button
                  onClick={() => setShowIpBanner(false)}
                  className="p-1 hover:bg-white/10 rounded text-gray-500 hover:text-gray-300"
                  title="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
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

      <DispatchTrackingPanel activeDispatch={activeDispatch} onDismiss={() => setActiveDispatch(null)} />

      <div 
        className="absolute right-4 z-[1000] flex flex-col gap-2" 
        style={{ top: currentUserShooting ? 'calc(130px + env(safe-area-inset-top))' : 'calc(max(96px, env(safe-area-inset-top) + 80px))' }}
      >
        {userLocation?.accuracy && userLocation.accuracy > 1000 && (
          <button
            onClick={() => setShowLocationPicker(true)}
            className="flex items-center gap-2 px-3 py-2 bg-red-500/90 hover:bg-red-600 text-white rounded-full text-sm font-medium shadow-lg animate-pulse"
            data-testid="location-fix-btn"
          >
            <MapPin className="w-4 h-4" />
            <span>Fix Location</span>
          </button>
        )}
        <div className="relative">
          <Button
            onClick={getUserLocation}
            disabled={gpsLoading}
            className={`backdrop-blur-sm hover:bg-zinc-700 text-white rounded-full w-12 h-12 p-0 ${
              userLocation?.accuracy && userLocation.accuracy > 500 
                ? 'bg-orange-600/90' 
                : 'bg-zinc-800/90'
            }`}
            data-testid="gps-location-btn"
            title={userLocation?.accuracy ? `Accuracy: ${Math.round(userLocation.accuracy)}m` : 'Get location'}
          >
            {gpsLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Navigation className={`w-5 h-5 ${userLocation && userLocation.accuracy <= 100 ? 'text-blue-400' : ''}`} />
            )}
          </Button>
          {(locationDenied || (userLocation?.accuracy && userLocation.accuracy > 200)) && (
            <button
              onClick={() => setShowGPSGuide(true)}
              className="absolute -bottom-1 -right-1 w-5 h-5 bg-yellow-500 hover:bg-yellow-400 rounded-full flex items-center justify-center text-black text-xs font-bold shadow-lg"
              title="GPS Help"
              data-testid="gps-help-btn"
            >
              ?
            </button>
          )}
        </div>
        <Button
          aria-expanded={showFeaturedPanel} onClick={() => setShowFeaturedPanel(!showFeaturedPanel)}
          className={`bg-zinc-800/90 backdrop-blur-sm hover:bg-zinc-700 text-white rounded-full w-12 h-12 p-0 ${showFeaturedPanel ? 'ring-2 ring-yellow-400' : ''}`}
          data-testid="featured-photographers-btn"
        >
          <Camera className={`w-5 h-5 ${showFeaturedPanel ? 'text-yellow-400' : ''}`} />
        </Button>
        <Button
          aria-expanded={showFriendsOnMap} onClick={() => setShowFriendsOnMap(!showFriendsOnMap)}
          className={`bg-zinc-800/90 backdrop-blur-sm hover:bg-zinc-700 text-white rounded-full w-12 h-12 p-0 ${showFriendsOnMap ? 'ring-2 ring-yellow-400' : ''}`}
          data-testid="friends-on-map-btn"
        >
          <Users className={`w-5 h-5 ${showFriendsOnMap ? 'text-yellow-400' : ''}`} />
        </Button>
        {showFriendsOnMap && friendsOnMap.length > 0 && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-400 rounded-full flex items-center justify-center text-xs text-black font-bold">
            {friendsOnMap.length}
          </div>
        )}
      </div>

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

      {nearestSpot && userLocation && (
        <div className="absolute bottom-24 right-4 z-[1000] pointer-events-auto">
          <div 
            className="bg-zinc-800/95 backdrop-blur-sm rounded-lg p-3 max-w-[180px] shadow-lg border border-zinc-700/50 cursor-pointer hover:bg-zinc-700/95 transition-colors"
            onClick={() => {
              if (mapInstanceRef.current && nearestSpot.latitude && nearestSpot.longitude) {
                mapInstanceRef.current.setView([nearestSpot.latitude, nearestSpot.longitude], 14);
              }
              setSelectedSpot(nearestSpot);
              setUnifiedDrawerOpen(true);
            }}
          >
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Nearest spot</p>
            <p className="text-sm font-semibold text-white truncate">{nearestSpot.name}</p>
            <p className="text-xs text-cyan-400 font-medium">{nearestSpot.distance?.toFixed(1)} km away</p>
          </div>
        </div>
      )}

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