import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useTheme } from '../contexts/ThemeContext';
import { MapPin, Camera, Users, ChevronUp, ChevronDown, X, Radio, MessageCircle, Navigation, Loader2, Waves, Lock, Crown, RefreshCw, HelpCircle, Target, Check, Clock } from 'lucide-react';
import { PermissionNudgeDrawer } from './PermissionNudgeDrawer';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { toast } from 'sonner';
import { JumpInSessionModal } from './JumpInSessionModal';
import { supabase } from '../lib/supabase';
import UnifiedSpotDrawer from './UnifiedSpotDrawer';
import { RequestProSelfieModal } from './RequestProSelfieModal';
import { MapLiveFloatingIsland } from './MapLiveIndicator';
import EndSessionModal from './EndSessionModal';
import ConditionsModal from './ConditionsModal';
import WaveLoader from './WaveLoader';
import { GPSSettingsGuide } from './GPSSettingsGuide';
import { LocationPicker } from './LocationPicker';

// Extracted map components and utilities
import { MapFilterTabs } from './map/MapFilterTabs';
import { MapHeader } from './map/MapHeader';
import { RequestProModal } from './map/RequestProModal';
import MapErrorBoundary from './map/MapErrorBoundary';
import { 
  API, 
  ELECTRIC_CYAN, 
  FLORIDA_CENTER, 
  getErrorMessage, 
  debounce, 
  truncateCoord, 
  isValidLatLng,
  TILE_LAYER_CONFIG,
  DEFAULT_MAP_OPTIONS,
  SPOT_CLUSTER_OPTIONS,
  PHOTOGRAPHER_CLUSTER_OPTIONS
} from './map/mapUtils';
import {
  createUserLocationIcon,
  createSpotIcon,
  createPhotographerIcon,
  createSpotClusterIcon,
  createPhotographerClusterIcon,
  createFriendIcon,
  getPriorityColors
} from './map/markerIcons';

// Custom hooks for cleaner code organization
import { useMapData } from '../hooks/useMapData';
import { useUserLocation } from '../hooks/useUserLocation';
import { useGoLiveFlow } from '../hooks/useGoLiveFlow';
import { useIPGeolocation } from '../hooks/useIPGeolocation';
import { useMarkerClustering } from '../hooks/useMarkerClustering';
import { useMapState } from '../hooks/useMapState';
import { useFriendsOnMap } from '../hooks/useFriendsOnMap';
import logger from '../utils/logger';
// Note: useOnDemandRequests and useRequestPro hooks exist but use different API paths
// The inline code uses the correct /dispatch/ endpoints - keeping inline for now

const MapPageContent = () => {
  const { user } = useAuth();
  const { getEffectiveRole } = usePersona();
  const { theme } = useTheme();
  
  const isLight = theme === 'light';
  const mapTilesUrl = isLight ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' : TILE_LAYER_CONFIG.url;
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const userMarkerRef = useRef(null);
  const userAccuracyCircleRef = useRef(null);  // Reference to accuracy circle
  
  // Cluster group refs for performance optimization
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

  // ============ CUSTOM HOOKS ============
  // Map data hook - handles fetching surf spots with Privacy Shield geofencing
  const {
    surfSpots,
    livePhotographers,
    featuredPhotographers,
    loading,
    fetchLivePhotographers,
    fetchSurfSpots,
  } = useMapData(user?.id, userLocation);

  // Go live flow hook - handles photographer go-live workflow
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

  // IP Geolocation fallback when GPS is denied (with Coastal Snap support)
  const { 
    ipLocation, 
    ipLoading, 
    coastalSnapped,
    cityChanged,
    forceRecalibrate 
  } = useIPGeolocation();

  // Map viewport state for clustering
  const [mapBounds, setMapBounds] = useState(null);
  const [mapZoom, setMapZoom] = useState(10);

  // Memoize clustering options to prevent infinite re-render loop
  const clusteringOptions = useMemo(() => ({
    radius: 60,
    maxZoom: 14
  }), []);

  // Use marker clustering for performance (supercluster-based, optional)
  // Note: Primary clustering is handled by Leaflet markerClusterGroup
  const { clusters } = useMarkerClustering(surfSpots, mapBounds, mapZoom, clusteringOptions);

  // Effective location (GPS or IP fallback)
  // CRITICAL: Validates all coordinates before returning
  const effectiveLocation = useMemo(() => {
    // Check GPS location first
    if (userLocation?.lat && userLocation?.lng && 
        !isNaN(userLocation.lat) && !isNaN(userLocation.lng) &&
        isFinite(userLocation.lat) && isFinite(userLocation.lng)) {
      return { ...userLocation, source: 'gps' };
    }
    // Fall back to IP location
    if (ipLocation?.lat && ipLocation?.lng &&
        !isNaN(ipLocation.lat) && !isNaN(ipLocation.lng) &&
        isFinite(ipLocation.lat) && isFinite(ipLocation.lng)) {
      return { ...ipLocation, source: 'ip' };
    }
    return null;
  }, [userLocation, ipLocation]);
  
  // ============ LOCAL STATE ============
  // Use extracted hook for UI state management
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
  
  // Request a Pro state (kept local as it's tightly coupled with map actions)
  const [showRequestProModal, setShowRequestProModal] = useState(false);
  const [requestProLoading, setRequestProLoading] = useState(false);
  const [estimatedDuration, setEstimatedDuration] = useState(1);
  const [inviteFriends, setInviteFriends] = useState(false);
  const [pendingRequestPro, setPendingRequestPro] = useState(false);
  const [requestProLocationLoading, setRequestProLocationLoading] = useState(false);
  const [showRequestProSelfieModal, setShowRequestProSelfieModal] = useState(false);
  const [activeDispatchId, setActiveDispatchId] = useState(null);
  const [boostHours, setBoostHours] = useState(0); // 0=none, 1/2/4=hours
  
  // On-demand photographer availability (Uber-style)
  const [onDemandPhotographers, setOnDemandPhotographers] = useState([]);
  const [requestProSelectedPro, setRequestProSelectedPro] = useState(null); // null = auto-match
  const [onDemandLoading, setOnDemandLoading] = useState(false);
  
  // Friend invite state for split sessions
  const [friendsList, setFriendsList] = useState([]);
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [showFriendPicker, setShowFriendPicker] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  
  // Friends on Map - use extracted hook
  const {
    friendsOnMap,
    showFriendsOnMap,
    friendMarkersRef,
    fetchFriendsOnMap,
    clearFriendMarkers,
  } = useFriendsOnMap({ user, mapInstanceRef });
  
  // Active On-Demand requests on map (kept local as marker logic is in updateMapMarkers)
  const [activeOnDemandRequests, setActiveOnDemandRequests] = useState([]);
  const onDemandMarkersRef = useRef([]);
  
  // Locked shooter count for persistent display
  const [lockedShooterCount, setLockedShooterCount] = useState(null);
  
  // Active dispatch tracking for real-time GPS
  const [activeDispatch, setActiveDispatch] = useState(null);
  const [trackingMarkersRef] = useState({ surfer: null, photographer: null, routeLine: null });
  const trackingIntervalRef = useRef(null);

  // Permission Nudge Drawer state
  const [showPermissionNudge, setShowPermissionNudge] = useState(false);
  const [permissionNudgeAction, setPermissionNudgeAction] = useState('booking'); // 'booking' or 'go_live'

  // Get effective role (respects God Mode persona masking)
  const effectiveRole = getEffectiveRole(user?.role);
  
  // Check if user is a photographer - memoized to prevent re-renders
  // Only Hobbyist, Photographer, and Approved Pro can "Go Live" / "Start Shooting"
  const isPhotographer = useMemo(() => 
    ['Hobbyist', 'Photographer', 'Approved Pro'].includes(effectiveRole),
    [effectiveRole]
  );
  
  // Check if user can access Photo Tools (includes Grom Parent for viewing)
  const canAccessPhotoTools = useMemo(() => 
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
  const logPermissionStatus = useCallback((step, status, details = '') => {
    const timestamp = new Date().toISOString();
    logger.debug(`[PERMISSION DEBUG ${timestamp}] Step: ${step}, Status: ${status}${details ? `, Details: ${details}` : ''}`);
  }, []);

  // Auto-trigger Request a Pro modal once location is resolved
  useEffect(() => {
    if (pendingRequestPro && userLocation) {
      // Location is now available, open the modal
      setShowRequestProModal(true);
      setPendingRequestPro(false);
      setRequestProLocationLoading(false);
    }
  }, [userLocation, pendingRequestPro]);

  // Fetch on-demand photographers when modal opens (Uber-style)
  useEffect(() => {
    const fetchOnDemandPros = async () => {
      if (!showRequestProModal || !userLocation) return;
      
      setOnDemandLoading(true);
      try {
        const response = await axios.get(`${API}/photographers/on-demand`, {
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
    
    fetchOnDemandPros();
  }, [showRequestProModal, userLocation]);

  // Fetch friends when invite friends is toggled on
  useEffect(() => {
    const fetchFriends = async () => {
      if (!inviteFriends || !user?.id) return;
      
      setFriendsLoading(true);
      try {
        // Fetch mutual followers (friends)
        const response = await axios.get(`${API}/profiles/${user.id}/friends`);
        setFriendsList(response.data || []);
      } catch (error) {
        logger.error('Error fetching friends:', error);
        // Fallback: try followers endpoint
        try {
          const followersRes = await axios.get(`${API}/followers/${user.id}`);
          setFriendsList(followersRes.data?.filter(f => f.is_mutual) || []);
        } catch (e) {
          setFriendsList([]);
        }
      } finally {
        setFriendsLoading(false);
      }
    };
    
    fetchFriends();
  }, [inviteFriends, user?.id]);

  // Check for active dispatch on mount and poll for updates
  useEffect(() => {
    const checkActiveDispatch = async () => {
      if (!user?.id) return;
      try {
        const response = await axios.get(`${API}/dispatch/user/${user.id}/active`);
        if (response.data && response.data.status === 'en_route') {
          setActiveDispatch(response.data);
        }
      } catch (error) {
        // No active dispatch or error - that's fine
      }
    };
    
    checkActiveDispatch();
  }, [user?.id]);

  // Fetch active on-demand requests for green breathing markers (photographers only)
  useEffect(() => {
    if (!isPhotographer) return;
    
    const fetchActiveRequests = async () => {
      try {
        const response = await axios.get(`${API}/dispatch/requests/pending`);
        setActiveOnDemandRequests(response.data || []);
      } catch (error) {
        logger.debug('No pending dispatch requests');
        setActiveOnDemandRequests([]);
      }
    };
    
    fetchActiveRequests();
    
    // Poll every 30 seconds for new requests
    const interval = setInterval(fetchActiveRequests, 30000);
    return () => clearInterval(interval);
  }, [isPhotographer]);

  // Real-time GPS tracking for active dispatch
  useEffect(() => {
    if (!activeDispatch || activeDispatch.status !== 'en_route') {
      // Clear tracking interval and markers
      if (trackingIntervalRef.current) {
        clearInterval(trackingIntervalRef.current);
      }
      return;
    }
    
    // Poll for location updates every 5 seconds
    const pollLocations = async () => {
      try {
        const response = await axios.get(`${API}/dispatch/${activeDispatch.id}/tracking`);
        setActiveDispatch(prev => ({
          ...prev,
          photographer_lat: response.data.photographer_location?.lat,
          photographer_lng: response.data.photographer_location?.lng,
          requester_lat: response.data.requester_location?.lat,
          requester_lng: response.data.requester_location?.lng,
          estimated_arrival_minutes: response.data.estimated_arrival_minutes
        }));
        
        // Update tracking markers on map
        updateTrackingMarkers(response.data);
      } catch (error) {
        logger.error('Error polling dispatch locations:', error);
      }
    };
    
    // Also send our location updates
    const sendLocationUpdate = async () => {
      if (!navigator.geolocation) return;
      
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          await axios.post(`${API}/dispatch/${activeDispatch.id}/update-location?user_id=${user.id}`, {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        } catch (error) {
          logger.error('Error sending location update:', error);
        }
      });
    };
    
    // Initial poll
    pollLocations();
    sendLocationUpdate();
    
    // Set up polling interval
    trackingIntervalRef.current = setInterval(() => {
      pollLocations();
      sendLocationUpdate();
    }, 5000);
    
    return () => {
      if (trackingIntervalRef.current) {
        clearInterval(trackingIntervalRef.current);
      }
    };
  }, [activeDispatch?.id, activeDispatch?.status, user?.id]);

  // Update tracking markers on map for active dispatch
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
              <span class="text-xl">🏄</span>
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

  // Supabase Realtime subscription for "Jump In" events
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
          logger.debug('New jump in detected:', payload);
          
          // Get the photographer ID from the payload
          const photographerId = payload.new?.photographer_id;
          
          if (photographerId) {
            // Add to pulsing set
            setPulsingMarkers(prev => new Set([...prev, photographerId]));
            
            // Remove pulse after 3 seconds
            setTimeout(() => {
              setPulsingMarkers(prev => {
                const newSet = new Set(prev);
                newSet.delete(photographerId);
                return newSet;
              });
            }, 3000);
            
            // Refresh live photographers to get updated count
            fetchLivePhotographers();
            
            // Show toast notification
            toast.success('🏄 A surfer just jumped in!', {
              description: 'Someone joined a live session'
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Initialize map once when component mounts and loading is complete
  useEffect(() => {
    if (!loading) {
      // Delay to ensure DOM is ready
      const timer = setTimeout(() => {
        initMap();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  // Dynamically update map tiles when user switches themes without unmounting the map instance
  useEffect(() => {
    if (mapInstanceRef.current && mapInstanceRef.current._tileLayer) {
      mapInstanceRef.current._tileLayer.setUrl(mapTilesUrl);
    }
  }, [isLight, mapTilesUrl]);

  // Start watching location for continuous accuracy improvements
  // This helps Samsung devices improve GPS accuracy over time
  useEffect(() => {
    // Start watching when map is ready
    if (mapInstanceRef.current && !locationDenied) {
      startWatchingLocation();
    }
    
    // Cleanup: stop watching when component unmounts
    return () => {
      stopWatchingLocation();
    };
  }, [startWatchingLocation, stopWatchingLocation, locationDenied]);

  // Auto-center map on user's home/pinned location or GPS location when it becomes available
  // Priority: 1) User's saved home location (zoomed in tight) 2) GPS location 3) IP location
  const hasAutocenteredRef = useRef(false);
  useEffect(() => {
    // Only auto-center once when map is ready
    if (mapInstanceRef.current && !hasAutocenteredRef.current) {
      
      // Priority 1: User's saved home location (from profile)
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

  // Update markers when data changes (without reinitializing map)
  useEffect(() => {
    if (!loading && mapInstanceRef.current) {
      updateMapMarkers();
    }
  }, [surfSpots, livePhotographers, filter, userLocation, pulsingMarkers, loading]);

  // Keep selectedSpot in sync with latest surfSpots data (for active_photographers_count updates)
  useEffect(() => {
    if (selectedSpot && surfSpots.length > 0) {
      const updatedSpot = surfSpots.find(s => s.id === selectedSpot.id);
      if (updatedSpot && updatedSpot.active_photographers_count !== selectedSpot.active_photographers_count) {
        setSelectedSpot(updatedSpot);
      }
    }
  }, [surfSpots, selectedSpot]);

  // Resize map when bottom sheet toggles
  useEffect(() => {
    if (mapInstanceRef.current) {
      setTimeout(() => {
        mapInstanceRef.current.invalidateSize();
      }, 300); // Wait for animation
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

  // Note: Friends fetching is handled by useFriendsOnMap hook (polls every 30s)

  // Update friend markers on map
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;
    
    // Clear existing friend markers
    friendMarkersRef.current.forEach(m => m.remove());
    friendMarkersRef.current = [];
    
    if (!showFriendsOnMap || friendsOnMap.length === 0) return;
    
    // Add friend markers
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
                  ? `<img src="${friend.avatar_url}" class="w-full h-full object-cover" />`
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

  // Update on-demand request markers (green breathing markers for photographers)
  // Includes Surfer Priority Badge: Pro (gold) > Comp (purple) > Regular (cyan) + Boosted (orange)
  useEffect(() => {
    if (!mapInstanceRef.current || !isPhotographer) return;
    
    // Clear existing on-demand markers
    onDemandMarkersRef.current.forEach(m => m.remove());
    onDemandMarkersRef.current = [];
    
    if (!activeOnDemandRequests || activeOnDemandRequests.length === 0) return;
    
    // Priority color mapping
    const getPriorityColors = (badge, isBoosted) => {
      // Boosted requests get special orange styling
      if (isBoosted) {
        return { gradient: 'from-orange-400 to-red-600', shadow: 'orange', bg: 'orange', ring: 'ring-orange-400' };
      }
      
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
    
    // Add breathing markers for each active request with priority badges
    activeOnDemandRequests.forEach((request, index) => {
      if (!request.latitude || !request.longitude) return;
      
      const isBoosted = request.is_boosted;
      const badge = request.priority_badge || { level: 'regular', label: 'Surfer', color: 'cyan' };
      const colors = getPriorityColors(badge, isBoosted);
      const queuePosition = index + 1;
      
      // Badge icons based on priority
      const badgeIcon = isBoosted
        ? `<svg class="w-3 h-3 text-orange-400" fill="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"/><path d="M12 2v14"/></svg>` // Rocket/Boost
        : badge.level === 'pro' 
        ? `<svg class="w-3 h-3 text-${colors.bg}-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L14.09 8.26L21 9.27L16 14.14L17.18 21.02L12 17.77L6.82 21.02L8 14.14L3 9.27L9.91 8.26L12 2Z"/></svg>` // Star
        : badge.level === 'comp'
        ? `<svg class="w-3 h-3 text-${colors.bg}-400" fill="currentColor" viewBox="0 0 24 24"><path d="M17 10.43V3H7v7.43c0 .35.18.68.49.86l4.18 2.51-.99 2.34-3.41.29 2.59 2.24L9.07 22 12 20.23 14.93 22l-.79-3.33 2.59-2.24-3.41-.29-.99-2.34 4.18-2.51c.3-.18.49-.51.49-.86z"/></svg>` // Trophy
        : `<svg class="w-3 h-3 text-${colors.bg}-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`; // Check
      
      const onDemandIcon = window.L.divIcon({
        className: 'custom-marker on-demand-marker',
        html: `
          <div class="relative">
            <!-- Breathing animation with priority color -->
            <div class="absolute inset-0 w-14 h-14 -top-1 -left-1 rounded-full bg-${colors.bg}-400 animate-ping opacity-40"></div>
            <div class="absolute inset-0 w-12 h-12 rounded-full bg-${colors.bg}-500 animate-pulse opacity-30"></div>
            
            <!-- Priority/Boosted badge (top right) -->
            <div class="absolute -top-2 -right-2 z-10 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-${colors.bg}-500/90 text-white text-[8px] font-bold shadow-md ${isBoosted || badge.level === 'pro' ? 'animate-pulse' : ''}">
              ${badgeIcon}
              ${isBoosted ? '🚀' : badge.level === 'pro' ? 'PRO' : badge.level === 'comp' ? 'COMP' : ''}
            </div>
            
            ${/* Boost timer badge (top left for boosted) */ ''}
            ${isBoosted ? `
              <div class="absolute -top-2 -left-2 z-10 px-1.5 py-0.5 rounded-full bg-orange-500 text-white text-[8px] font-bold shadow-md animate-pulse">
                ${request.boost_time_remaining_minutes || 0}m
              </div>
            ` : badge.level === 'pro' ? `
              <div class="absolute -top-2 -left-2 z-10 w-5 h-5 rounded-full bg-yellow-500 text-black text-[10px] font-bold flex items-center justify-center shadow-md">
                ${queuePosition}
              </div>
            ` : ''}
            
            <!-- Marker body -->
            <div class="relative w-12 h-12 rounded-full bg-gradient-to-br ${colors.gradient} p-[3px] shadow-lg shadow-${colors.shadow}-500/50">
              <div class="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                ${request.requester_avatar 
                  ? `<img src="${request.requester_avatar}" class="w-full h-full object-cover" />`
                  : `<span class="text-${colors.bg}-400 text-lg font-bold">${request.requester_name?.charAt(0) || 'S'}</span>`
                }
              </div>
            </div>
            
            <!-- Label with priority color -->
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
            <!-- Priority badge in popup -->
            <div class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full mb-2" style="background: ${popupBgColor}">
              <span class="text-[10px] font-bold text-white">${isBoosted ? 'BOOSTED 🚀' : badge.label.toUpperCase()}</span>
            </div>
            
            <p class="font-bold text-sm" style="color: ${popupTextColor}">${request.requester_name}</p>
            <p class="text-xs text-gray-500">Looking for a Pro</p>
            <p class="text-xs text-gray-400 mt-1">${request.location_name || 'Nearby'}</p>
            <p class="text-xs font-medium mt-1" style="color: ${badge.color === 'yellow' ? '#ca8a04' : badge.color === 'purple' ? '#9333ea' : '#0891b2'}">${request.estimated_duration}h session</p>
            ${badge.level === 'pro' ? '<p class="text-[10px] font-bold text-yellow-600 mt-2">⭐ PRIORITY REQUEST</p>' : ''}
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
      
      // NUCLEAR OPTION: Destroy and recreate the entire map at the new location
      // This avoids all tile loading issues with setView/panTo
      if (mapInstanceRef.current) {
        logger.debug('[MAP] Destroying map for GPS relocate');
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      
      // Small delay then reinitialize at GPS location
      setTimeout(() => {
        if (mapRef.current && window.L) {
          logger.debug('[MAP] Recreating map at GPS location');
          
          const map = window.L.map(mapRef.current, {
            center: [location.lat, location.lng],
            zoom: 12,
            ...DEFAULT_MAP_OPTIONS
          });
          
          // Add tile layer
          window.L.tileLayer(mapTilesUrl, TILE_LAYER_CONFIG.options).addTo(map);
          
          // Add zoom control
          window.L.control.zoom({ position: 'bottomright' }).addTo(map);
          
          // Initialize cluster groups
          spotClusterRef.current = window.L.markerClusterGroup(SPOT_CLUSTER_OPTIONS);
          map.addLayer(spotClusterRef.current);
          
          photographerClusterRef.current = window.L.markerClusterGroup(PHOTOGRAPHER_CLUSTER_OPTIONS);
          map.addLayer(photographerClusterRef.current);
          
          mapInstanceRef.current = map;
          
          // Update markers
          setTimeout(() => {
            updateMapMarkers();
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
      // Force container resize to prevent black map
      mapRef.current.style.height = '100%';
      mapRef.current.style.minHeight = '50vh';
    
    // Guard against missing container dimensions
    const rect = mapRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      logger.warn('[MAP] Container has no dimensions, delaying init');
      setTimeout(initMap, 100);
      return;
    }
    
    // Skip if map already initialized
    if (mapInstanceRef.current) {
      logger.debug('[MAP] Map already initialized, skipping');
      return;
    }
    
    logger.debug('[MAP] Initializing Leaflet map with clustering...');
    
    // L_DISABLE_3D is set in index.html BEFORE Leaflet loads
    
    // Initialize Leaflet map with dark theme
    const map = window.L.map(mapRef.current, {
      center: [FLORIDA_CENTER.lat, FLORIDA_CENTER.lng],
      zoom: 7,
      ...DEFAULT_MAP_OPTIONS
    });
    
    // Force invalidateSize after initialization
    setTimeout(() => {
      if (map && map.invalidateSize) {
        map.invalidateSize();
        logger.debug('[MAP] Invalidate size called');
      }
    }, 100);
    
    // Add dark map tiles
    const tileLayer = window.L.tileLayer(mapTilesUrl, TILE_LAYER_CONFIG.options).addTo(map);
    map._tileLayer = tileLayer;
    
    // Add zoom control to bottom right
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
    
    // Photographer cluster with custom icon
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
    
    // Add cluster groups to map
    map.addLayer(spotClusterRef.current);
    map.addLayer(photographerClusterRef.current);
    
    // Debounced moveend handler for performance (250ms delay)
    const debouncedMoveEnd = debounce(() => {
      logger.debug('[MAP] Move ended - refreshing visible markers');
      // You could add viewport-based filtering here if needed
    }, 250);
    
    map.on('moveend', debouncedMoveEnd);
    
    mapInstanceRef.current = map;
    logger.debug('[MAP] Map initialized with clustering successfully');
    
    // Initial marker update
    updateMapMarkers();
    } catch (error) {
      logger.error('[MAP] Error initializing map:', error);
      // Show user-friendly error
      toast.error('Map failed to load', {
        description: 'Please refresh the page'
      });
    }
  };

  // Separate function to update markers without reinitializing map
  // PERFORMANCE OPTIMIZED: Uses cluster groups and truncated coordinates
  const updateMapMarkers = () => {
    const map = mapInstanceRef.current;
    if (!map) return;

    try {
      // Clear existing markers from markersRef (non-clustered markers like user location)
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
    
    // Clear cluster groups
    if (spotClusterRef.current) {
      spotClusterRef.current.clearLayers();
    }
    if (photographerClusterRef.current) {
      photographerClusterRef.current.clearLayers();
    }
    
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
      
      // Bulk add markers to cluster group for better performance
      spotClusterRef.current.addLayers(spotMarkers);
    }
    
    // Add live photographer markers to CLUSTER GROUP with pulsing animation
    if ((filter === 'all' || filter === 'photographers') && photographerClusterRef.current) {
      const photographerMarkers = [];
      
      livePhotographers.forEach(photographer => {
        // Validate coordinates before creating marker
        if (!isValidLatLng(photographer.latitude, photographer.longitude)) return;
        
        const isPulsing = pulsingMarkers.has(photographer.id);
        // Check if photographer is at an official spot or GPS/roaming
        const isAtOfficialSpot = photographer.current_spot_id || photographer.spot_id;
        
        // Different visual treatment for GPS/roaming photographers vs official spot photographers
        // STATUS COLORS: Red = Shooting Live, Green = On-Demand, Purple = Both
        const isShootingLive = photographer.is_streaming || photographer.is_live;
        const isOnDemand = photographer.on_demand_available || photographer.is_available_on_demand;
        const isBoth = isShootingLive && isOnDemand;
        
        // Determine status color and label
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
          // Fallback for photographers without clear status (ROAMING)
          statusClass = '';
          ringClass = '';
          labelClass = '';
          statusLabel = 'ROAMING';
        }
        
        const photographerIcon = window.L.divIcon({
          className: 'custom-marker photographer-marker',
          html: isAtOfficialSpot 
            ? `
              <!-- OFFICIAL SPOT PHOTOGRAPHER: Status-based styling -->
              <div class="photographer-pin-container">
                <!-- Breathing pulse animation based on status -->
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
                
                <!-- Avatar with status ring -->
                <div class="photographer-pin-avatar p-[3px] rounded-full ${ringClass || ''}" style="${!ringClass ? `background: ${isPulsing ? `linear-gradient(135deg, ${ELECTRIC_CYAN}, #0099CC)` : 'linear-gradient(to right, rgb(34 211 238), rgb(59 130 246))'}` : ''}">
                  <div class="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                    ${photographer.avatar_url 
                      ? `<img src="${photographer.avatar_url}" class="w-full h-full object-cover" />`
                      : `<span class="text-lg ${isBoth ? 'text-purple-400' : isShootingLive ? 'text-red-400' : isOnDemand ? 'text-green-400' : ''}" style="${!isBoth && !isShootingLive && !isOnDemand ? `color: ${isPulsing ? ELECTRIC_CYAN : 'rgb(34 211 238)'}` : ''}">${photographer.full_name?.charAt(0) || '?'}</span>`
                    }
                  </div>
                </div>
                
                <!-- Status label (contained within bounding box) -->
                <div class="photographer-pin-status-label ${labelClass || ''}" style="${!labelClass ? `background-color: ${isPulsing ? ELECTRIC_CYAN : 'rgb(16 185 129)'}` : ''}">
                  ${isPulsing ? 'NEW!' : statusLabel}
                </div>
              </div>
            `
            : `
              <!-- GPS/ROAMING PHOTOGRAPHER: Different visual (orange/gold ring, GPS indicator) -->
              <div class="relative">
                <div class="absolute inset-0 w-12 h-12 rounded-full bg-orange-400 animate-ping opacity-40"></div>
                <div class="relative w-12 h-12 rounded-full p-[3px]" style="background: linear-gradient(135deg, #f97316, #eab308);">
                  <div class="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                    ${photographer.avatar_url 
                      ? `<img src="${photographer.avatar_url}" class="w-full h-full object-cover" />`
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
      
      // Bulk add markers to cluster group for better performance
      photographerClusterRef.current.addLayers(photographerMarkers);
    }
    } catch (error) {
      logger.error('[MAP] Error updating markers:', error);
      // Don't crash the app - just log the error
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

  // Fetch photographers currently shooting at a specific spot
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

  // Handle closing the unified drawer
  const handleCloseUnifiedDrawer = () => {
    setUnifiedDrawerOpen(false);
    setSelectedSpot(null);
    setActiveShootersAtSpot([]);
    setLockedShooterCount(null);
  };

  // Handle starting to shoot at a spot (from unified drawer)
  const handleStartShootingFromDrawer = (spotId, sessionSettings = {}) => {
    handleStartGoLiveFlow(spotId, sessionSettings);
  };

  // Handle switching location while already live
  const handleSwitchLocation = async (newSpotId, sessionSettings = {}) => {
    // End current session first
    if (currentUserShooting) {
      try {
        await axios.post(`${API}/photographer-sessions/end`, {
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

  // Wrapper for startGoLiveFlow from hook - closes drawers before starting
  // INCLUDES: Permission Nudge check for GPS-denied users
  const handleStartGoLiveFlow = useCallback((spotId, sessionSettings = {}) => {
    // Check if user has GPS location or only IP fallback
    if (!userLocation && locationDenied) {
      // Show permission nudge drawer
      setPermissionNudgeAction('go_live');
      setShowPermissionNudge(true);
      return;
    }
    
    // IMPORTANT: Close the drawer FIRST to prevent z-index collision
    setUnifiedDrawerOpen(false);
    setBottomSheetOpen(false);
    startGoLiveFlow(spotId, sessionSettings);
  }, [startGoLiveFlow, userLocation, locationDenied]);

  // Wrapper for hook's handleConditionsConfirm - passes surfSpots for currentLiveSpot lookup
  const handleConditionsConfirm = useCallback((data) => {
    hookHandleConditionsConfirm(data, surfSpots);
  }, [hookHandleConditionsConfirm, surfSpots]);

  // Check if current user is shooting
  const currentUserShooting = livePhotographers.find(p => p.id === user?.id);

  // Wrapper for hook's handleStopLive - passes current session data
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
      
      {/* TOP RAIL - Header + Live Floating Island + Filters */}
      <div 
        className="absolute top-0 left-0 right-0 md:left-[200px] z-[1000] pointer-events-none" 
        style={{ paddingTop: '16px' }}
      >
        <div className="px-4">
          {/* Header Row - Using extracted component */}
          <MapHeader livePhotographerCount={livePhotographers.length} />
          
          {/* Live Floating Island - Nestled below header (Only for active photographers) */}
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
        
          {/* Filter Tabs - Using extracted component */}
          <MapFilterTabs 
            filter={filter}
            onFilterChange={handleFilterChange}
            locationDenied={locationDenied}
            surfSpots={surfSpots}
            onSpotSelect={(spot) => {
              // Pan map to the selected spot and open drawer
              if (mapRef.current && isValidLatLng(spot.latitude, spot.longitude)) {
                mapRef.current.flyTo([spot.latitude, spot.longitude], 14, { duration: 1 });
              }
              setSelectedSpot(spot);
              setShowSpotDrawer(true);
            }}
          />
          
          {/* City Migration / IP Location Banner - Auto-dismisses after 5 seconds */}
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
          
          {/* Request a Pro Button - Inline for placement control */}
          <div className="mt-2 pointer-events-auto">
            <button
              onClick={() => {
                if (!userLocation) {
                  // Set pending flag and start location loading
                  setPendingRequestPro(true);
                  setRequestProLocationLoading(true);
                  setLocationDenied(false);
                  getUserLocation();
                } else {
                  // Location available, open modal directly
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
                'Request a 🌊📸🎥'
              )}
            </button>
            
            {/* REMOVED: Global Go Live button - now merged into map pin drawers */}
          </div>
        </div>
      </div>
      
      {/* Active Dispatch Tracking Panel */}
      {activeDispatch && activeDispatch.status === 'en_route' && (
        <div 
          className="fixed z-[9998] left-4 right-4 top-24 bg-gradient-to-r from-cyan-900/95 to-blue-900/95 backdrop-blur-md rounded-2xl border border-cyan-500/30 shadow-2xl p-4"
          data-testid="dispatch-tracking-panel"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-cyan-400 rounded-full animate-pulse"></div>
              <span className="text-cyan-300 text-sm font-bold uppercase tracking-wide">Pro En Route</span>
            </div>
            <span className="text-2xl font-bold text-white">
              {activeDispatch.estimated_arrival_minutes || '?'}<span className="text-sm font-normal text-gray-400 ml-1">min</span>
            </span>
          </div>
          
          <div className="flex items-center gap-4 mb-3">
            {activeDispatch.photographer_avatar ? (
              <img src={activeDispatch.photographer_avatar} alt="" className="w-12 h-12 rounded-full border-2 border-cyan-400" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-cyan-500/30 flex items-center justify-center">
                <Camera className="w-6 h-6 text-cyan-400" />
              </div>
            )}
            <div>
              <p className="text-white font-medium">{activeDispatch.photographer_name || 'Photographer'}</p>
              <p className="text-gray-400 text-sm">is heading to your location</p>
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-300 text-sm">
              <MapPin className="w-4 h-4" />
              <span>{activeDispatch.location_name || 'Your location'}</span>
            </div>
            <Button
              onClick={() => {
                // Cancel or view details
                setActiveDispatch(null);
              }}
              variant="outline"
              size="sm"
              className="border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/20"
            >
              Details
            </Button>
          </div>
        </div>
      )}
      
      {/* REMOVED: BLUE LIVE BAR - Now integrated into UnifiedSpotDrawer */}

      {/* GPS & Control Buttons - Right Side */}
      <div 
        className="absolute right-4 z-[1000] flex flex-col gap-2" 
        style={{ top: currentUserShooting ? 'calc(130px + env(safe-area-inset-top))' : 'calc(max(96px, env(safe-area-inset-top) + 80px))' }}
      >
        {/* Location Accuracy Warning Banner */}
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
        
        {/* GPS Location Button Group */}
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
          
          {/* GPS Help Button - Shows when location accuracy is poor or denied */}
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
        
        {/* Featured Photographers Button */}
        <Button
          onClick={() => setShowFeaturedPanel(!showFeaturedPanel)}
          className={`bg-zinc-800/90 backdrop-blur-sm hover:bg-zinc-700 text-white rounded-full w-12 h-12 p-0 ${showFeaturedPanel ? 'ring-2 ring-yellow-400' : ''}`}
          data-testid="featured-photographers-btn"
        >
          <Camera className={`w-5 h-5 ${showFeaturedPanel ? 'text-yellow-400' : ''}`} />
        </Button>
        
        {/* Friends on Map Toggle */}
        <Button
          onClick={() => setShowFriendsOnMap(!showFriendsOnMap)}
          className={`bg-zinc-800/90 backdrop-blur-sm hover:bg-zinc-700 text-white rounded-full w-12 h-12 p-0 ${showFriendsOnMap ? 'ring-2 ring-yellow-400' : ''}`}
          data-testid="friends-on-map-btn"
        >
          <Users className={`w-5 h-5 ${showFriendsOnMap ? 'text-yellow-400' : ''}`} />
        </Button>
        
        {/* Friends count badge */}
        {showFriendsOnMap && friendsOnMap.length > 0 && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-400 rounded-full flex items-center justify-center text-xs text-black font-bold">
            {friendsOnMap.length}
          </div>
        )}
      </div>

      {/* Featured Photographers Panel */}
      {showFeaturedPanel && featuredPhotographers.length > 0 && (
        <div className="absolute top-44 right-4 z-[1000] w-72 max-h-[60vh] overflow-y-auto">
          <div className="bg-zinc-900/95 backdrop-blur-sm rounded-lg border border-zinc-700 shadow-xl">
            <div className="p-3 border-b border-zinc-700 flex items-center justify-between sticky top-0 bg-zinc-900/95">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Camera className="w-4 h-4 text-yellow-400" />
                Featured Photographers
              </h3>
              <button
                onClick={() => setShowFeaturedPanel(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 space-y-2">
              {featuredPhotographers.map((photographer) => (
                <div
                  key={photographer.id}
                  className="p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 transition-colors cursor-pointer"
                  onClick={() => {
                    setSelectedPhotographer(photographer);
                    setBottomSheetOpen(true);
                    setShowFeaturedPanel(false);
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-zinc-700 overflow-hidden flex items-center justify-center">
                        {photographer.avatar_url ? (
                          <img src={photographer.avatar_url} alt={photographer.full_name} className="w-full h-full object-cover" />
                        ) : (
                          <Camera className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                      {photographer.is_live && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full border-2 border-zinc-900 flex items-center justify-center">
                          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {photographer.full_name}
                        {photographer.is_verified && (
                          <span className="ml-1 text-blue-400">✓</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {photographer.location || photographer.current_spot || 'No location'}
                      </p>
                    </div>
                    <div className="text-right">
                      {photographer.is_live ? (
                        <span className="text-xs text-green-400 font-medium">LIVE</span>
                      ) : (
                        <span className="text-xs text-yellow-400">${photographer.session_price}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                    <span>{photographer.total_sessions || 0} sessions</span>
                    <span>•</span>
                    <span>{photographer.gallery_count || 0} photos</span>
                    {photographer.total_earnings > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-green-400">${photographer.total_earnings.toFixed(0)} earned</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Nearest Spot Card - Positioned to avoid collision with banners */}
      {nearestSpot && userLocation && (
        <div className="absolute bottom-24 right-4 z-[1000] pointer-events-auto">
          <div 
            className="bg-zinc-800/95 backdrop-blur-sm rounded-lg p-3 max-w-[180px] shadow-lg border border-zinc-700/50 cursor-pointer hover:bg-zinc-700/95 transition-colors"
            onClick={() => {
              if (mapInstanceRef.current && nearestSpot.latitude && nearestSpot.longitude) {
                mapInstanceRef.current.setView([nearestSpot.latitude, nearestSpot.longitude], 14);
              }
              setSelectedSpot(nearestSpot);
              setShowSpotDrawer(true);
            }}
          >
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Nearest spot</p>
            <p className="text-sm font-semibold text-white truncate">{nearestSpot.name}</p>
            <p className="text-xs text-cyan-400 font-medium">{nearestSpot.distance?.toFixed(1)} km away</p>
          </div>
        </div>
      )}

      {/* Bottom Sheet - Only for Photographer Details now (spot details in UnifiedSpotDrawer) */}
      {bottomSheetOpen && selectedPhotographer && !showJumpInModal && (
        <div 
          className="fixed bottom-0 left-0 right-0 z-[9998] bg-zinc-900 rounded-t-2xl border-t border-zinc-700 shadow-2xl transition-all duration-300"
          style={{ maxHeight: '40vh' }}
        >
          <div className="h-full flex flex-col">
            {/* Drag Handle */}
            <div 
              className="flex justify-center py-3 cursor-grab"
              onClick={() => { setBottomSheetOpen(false); setSelectedPhotographer(null); }}
            >
              <div className="w-12 h-1.5 bg-zinc-600 rounded-full hover:bg-zinc-500 transition-colors"></div>
            </div>
            
            {/* Close Button */}
            <button
              onClick={() => { setBottomSheetOpen(false); setSelectedPhotographer(null); }}
              className="absolute top-3 right-4 text-gray-400 hover:text-white z-10"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Photographer Details */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-14 h-14 rounded-full p-[2px] bg-gradient-to-r from-cyan-400 to-blue-500">
                  <div className="w-full h-full rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden">
                    {selectedPhotographer.avatar_url ? (
                      <img src={selectedPhotographer.avatar_url} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xl text-cyan-400">{selectedPhotographer.full_name?.charAt(0)}</span>
                    )}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold text-white" style={{ fontFamily: 'Oswald' }}>
                      {selectedPhotographer.full_name}
                    </h3>
                    {selectedPhotographer.is_streaming ? (
                      <span className="px-2 py-0.5 bg-red-500 rounded text-xs text-white font-bold">LIVE</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-emerald-500 rounded text-xs text-white font-bold">SHOOTING</span>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm">at {selectedPhotographer.current_spot_name}</p>
                </div>
              </div>
              
              {selectedPhotographer.session_price && (
                <div className="bg-zinc-800 rounded-lg p-3 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-sm">Session Price</span>
                    <span className="text-xl font-bold text-white">${selectedPhotographer.session_price}</span>
                  </div>
                </div>
              )}
              
              <div className="flex gap-3">
                <Button
                  onClick={() => {
                    // CRITICAL: Hide ALL drawers/sheets when opening Jump In modal
                    // Only ONE drawer/modal should exist at z-index 1000+ at any time
                    setBottomSheetOpen(false);
                    setUnifiedDrawerOpen(false);  // Close the spot drawer too
                    setShowJumpInModal(true);
                  }}
                  className="flex-1 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
                  data-testid="jump-in-session-btn"
                >
                  <Users className="w-4 h-4 mr-2" />
                  Jump In Session
                </Button>
                <Button
                  variant="outline"
                  className="border-zinc-600 text-white hover:bg-zinc-800"
                >
                  <MessageCircle className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Leaflet CSS injection */}
      <style>{`
        .custom-marker {
          background: transparent !important;
          border: none !important;
        }
        .custom-cluster-marker {
          background: transparent !important;
          border: none !important;
        }
        .photographer-marker .animate-ping {
          animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
        @keyframes ping {
          75%, 100% {
            transform: scale(1.5);
            opacity: 0;
          }
        }
        /* Override default Leaflet cluster styles */
        .marker-cluster-small,
        .marker-cluster-medium,
        .marker-cluster-large {
          background: transparent !important;
        }
        .marker-cluster div {
          background: transparent !important;
        }
      `}</style>

      {/* Unified Spot Drawer - Opens when map pin is clicked */}
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

      {/* Jump In Session Modal */}
      {showJumpInModal && selectedPhotographer && (
        <JumpInSessionModal
          photographer={selectedPhotographer}
          onClose={() => setShowJumpInModal(false)}
          onSuccess={(data) => {
            setShowJumpInModal(false);
            setBottomSheetOpen(false);
            toast.success(`Joined ${selectedPhotographer.full_name}'s session!`);
          }}
        />
      )}


      {/* Request a Pro Modal - Uber/DoorDash style */}
      <Dialog open={showRequestProModal} onOpenChange={(open) => {
        setShowRequestProModal(open);
        if (!open) {
          setRequestProSelectedPro(null); // Reset selection on close
          setSelectedFriends([]); // Reset friend selection
          setFriendSearchQuery(''); // Reset search
          setShowFriendPicker(false);
        }
      }}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white w-[calc(100vw-16px)] sm:max-w-md mx-auto max-h-[90vh] sm:max-h-[85vh] overflow-hidden flex flex-col p-0">
          {/* Fixed Header */}
          <DialogHeader className="flex-shrink-0 p-4 pb-2 border-b border-zinc-800">
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Camera className="w-5 h-5 text-cyan-400" />
              Request a Pro
            </DialogTitle>
            <p className="text-gray-400 text-xs mt-1">
              Get a pro photographer to your location within the hour
            </p>
          </DialogHeader>
          
          <div 
            className="flex-1 overflow-y-auto p-4 space-y-4"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {/* Available Photographers - Uber style */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-300">
                  {onDemandLoading ? 'Finding pros near you...' : 
                   onDemandPhotographers.length > 0 ? `${onDemandPhotographers.length} Pros Available Nearby` : 'No pros available nearby'}
                </span>
                {onDemandPhotographers.length > 0 && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                    Live
                  </span>
                )}
              </div>
              
              {onDemandLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                </div>
              ) : onDemandPhotographers.length > 0 ? (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {/* Auto-match option - like Uber's "Any driver" */}
                  <button
                    onClick={() => setRequestProSelectedPro(null)}
                    className={`w-full p-3 rounded-lg flex items-center gap-3 transition-all ${
                      requestProSelectedPro === null
                        ? 'bg-cyan-500/20 border border-cyan-400'
                        : 'bg-zinc-800 hover:bg-zinc-700 border border-transparent'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                      <Target className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium text-sm">Auto-Match (Fastest)</div>
                      <div className="text-xs text-gray-400">Nearest available pro will be dispatched</div>
                    </div>
                    {requestProSelectedPro === null && (
                      <Check className="w-5 h-5 text-cyan-400" />
                    )}
                  </button>
                  
                  {/* Individual photographers */}
                  {onDemandPhotographers.slice(0, 5).map((pro) => (
                    <button
                      key={pro.id}
                      onClick={() => setRequestProSelectedPro(pro)}
                      className={`w-full p-3 rounded-lg flex items-center gap-3 transition-all ${
                        requestProSelectedPro?.id === pro.id
                          ? 'bg-cyan-500/20 border border-cyan-400'
                          : 'bg-zinc-800 hover:bg-zinc-700 border border-transparent'
                      }`}
                    >
                      {pro.avatar_url ? (
                        <img src={pro.avatar_url} alt={pro.full_name} className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white font-bold">
                          {pro.full_name?.charAt(0) || 'P'}
                        </div>
                      )}
                      <div className="flex-1 text-left">
                        <div className="font-medium text-sm flex items-center gap-2">
                          {pro.full_name}
                          {pro.role === 'Approved Pro' && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">PRO</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 flex items-center gap-2">
                          {pro.distance !== null && (
                            <span>{pro.distance} mi away</span>
                          )}
                          <span>•</span>
                          <span>${pro.on_demand_hourly_rate}/hr</span>
                        </div>
                      </div>
                      {requestProSelectedPro?.id === pro.id && (
                        <Check className="w-5 h-5 text-cyan-400" />
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-4 bg-zinc-800/50 rounded-lg text-center">
                  <p className="text-gray-400 text-sm">No pros currently available in your area.</p>
                  <p className="text-xs text-gray-500 mt-1">Your request will be broadcast to all nearby photographers.</p>
                </div>
              )}
            </div>

            {/* Location */}
            <div className="p-3 bg-zinc-800 rounded-lg">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-yellow-400" />
                <span className="text-white font-medium text-sm">Your Location</span>
              </div>
              {userLocation ? (
                <p className="text-xs text-gray-400 mt-1 ml-6">
                  {nearestSpot ? `Near ${nearestSpot.name}` : `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`}
                </p>
              ) : (
                <p className="text-xs text-red-400 mt-1 ml-6">Location required</p>
              )}
            </div>

            {/* Duration - Compact */}
            <div className="p-3 bg-zinc-800 rounded-lg">
              <label className="text-white font-medium text-sm block mb-2">Session Duration</label>
              <div className="flex items-center gap-2">
                {[0.5, 1, 2, 3].map(hours => (
                  <button
                    key={hours}
                    onClick={() => setEstimatedDuration(hours)}
                    className={`flex-1 px-2 py-2 rounded-lg text-sm font-medium transition-all ${
                      estimatedDuration === hours
                        ? 'bg-cyan-400 text-black'
                        : 'bg-zinc-700 text-gray-300 hover:bg-zinc-600'
                    }`}
                  >
                    {hours}h
                  </button>
                ))}
              </div>
            </div>

            {/* Invite Friends Toggle & Picker - Like Uber's Split Fare */}
            <div className="p-3 bg-zinc-800 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-white font-medium text-sm">Invite Friends to Split</span>
                  <p className="text-xs text-gray-400">Share the cost • 10 min to accept</p>
                </div>
                <button
                  onClick={() => {
                    setInviteFriends(!inviteFriends);
                    if (!inviteFriends) setShowFriendPicker(true);
                    else {
                      setShowFriendPicker(false);
                      setSelectedFriends([]);
                    }
                  }}
                  className={`w-11 h-6 rounded-full transition-colors ${
                    inviteFriends ? 'bg-cyan-400' : 'bg-zinc-600'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                    inviteFriends ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
              
              {/* Friend Picker - Expanded when invite friends is on */}
              {inviteFriends && (
                <div className="mt-3 pt-3 border-t border-zinc-700">
                  {/* Selected Friends */}
                  {selectedFriends.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {selectedFriends.map(friend => (
                        <div 
                          key={friend.id}
                          className="flex items-center gap-1.5 bg-cyan-500/20 border border-cyan-400/50 rounded-full pl-1 pr-2 py-0.5"
                        >
                          {friend.avatar_url ? (
                            <img src={friend.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-[10px] font-bold">
                              {friend.full_name?.charAt(0) || '?'}
                            </div>
                          )}
                          <span className="text-xs text-cyan-400">{friend.full_name?.split(' ')[0]}</span>
                          <button 
                            onClick={() => setSelectedFriends(prev => prev.filter(f => f.id !== friend.id))}
                            className="text-cyan-400 hover:text-white"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Search & Add Friends */}
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search friends to invite..."
                      value={friendSearchQuery}
                      onChange={(e) => setFriendSearchQuery(e.target.value)}
                      className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400"
                    />
                    <Users className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  </div>
                  
                  {/* Friends List */}
                  {friendsLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                    </div>
                  ) : (
                    <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                      {friendsList
                        .filter(f => 
                          !selectedFriends.some(sf => sf.id === f.id) &&
                          (friendSearchQuery === '' || 
                           f.full_name?.toLowerCase().includes(friendSearchQuery.toLowerCase()) ||
                           f.username?.toLowerCase().includes(friendSearchQuery.toLowerCase()))
                        )
                        .slice(0, 10)
                        .map(friend => (
                          <button
                            key={friend.id}
                            onClick={() => setSelectedFriends(prev => [...prev, friend])}
                            className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-zinc-700 transition-colors"
                          >
                            {friend.avatar_url ? (
                              <img src={friend.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
                                {friend.full_name?.charAt(0) || '?'}
                              </div>
                            )}
                            <div className="flex-1 text-left">
                              <div className="text-sm text-white">{friend.full_name}</div>
                              {friend.username && (
                                <div className="text-[10px] text-gray-500">@{friend.username}</div>
                              )}
                            </div>
                            <div className="w-5 h-5 rounded-full border border-gray-600 flex items-center justify-center">
                              <span className="text-cyan-400 text-lg leading-none">+</span>
                            </div>
                          </button>
                        ))}
                      
                      {friendsList.length === 0 && !friendsLoading && (
                        <p className="text-center text-gray-500 text-xs py-3">
                          No friends found. Follow surfers to add them as friends!
                        </p>
                      )}
                    </div>
                  )}
                  
                  {/* Info about split & timer */}
                  <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Clock className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-amber-200">
                        <span className="font-medium">On-Demand Split Rules:</span>
                        <ul className="mt-1 space-y-0.5 text-amber-300/80">
                          <li>• Friends have <strong>10 minutes</strong> to accept</li>
                          <li>• Session starts when you pay, invites sent instantly</li>
                          <li>• Friends who don't respond miss out</li>
                          <li>• Cost split equally among confirmed</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Estimated Pricing - Compact */}
            <div className="p-3 bg-gradient-to-r from-cyan-900/30 to-blue-900/30 rounded-lg border border-cyan-500/30">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-gray-400">Rate</span>
                <span className="text-white">${requestProSelectedPro?.on_demand_hourly_rate || 75}/hr × {estimatedDuration}h</span>
              </div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-400">Total Session Cost</span>
                <span className="text-white font-bold">${((requestProSelectedPro?.on_demand_hourly_rate || 75) * estimatedDuration).toFixed(0)}</span>
              </div>
              
              {/* Split cost info when friends are invited */}
              {inviteFriends && selectedFriends.length > 0 && (
                <div className="border-t border-zinc-700 pt-2 mb-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-emerald-400">Your Share ({selectedFriends.length + 1} split)</span>
                    <span className="text-emerald-400 font-bold">
                      ~${(((requestProSelectedPro?.on_demand_hourly_rate || 75) * estimatedDuration) / (selectedFriends.length + 1)).toFixed(0)}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">
                    If all {selectedFriends.length} friend{selectedFriends.length > 1 ? 's' : ''} accept within 10 min
                  </p>
                </div>
              )}
              
              <div className="border-t border-zinc-700 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-cyan-400 font-medium text-sm">Your Deposit (25%)</span>
                  <span className="text-cyan-400 font-bold">${(((requestProSelectedPro?.on_demand_hourly_rate || 75) * estimatedDuration) * 0.25 / (inviteFriends && selectedFriends.length > 0 ? selectedFriends.length + 1 : 1)).toFixed(0)}</span>
                </div>
              </div>
            </div>
            
            {/* Boost Priority Option - Compact */}
            <div className="p-3 bg-gradient-to-r from-orange-900/30 to-red-900/30 rounded-lg border border-orange-500/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">🚀</span>
                <span className="text-orange-400 font-bold text-sm">Boost Your Request</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { hours: 1, credits: 5 },
                  { hours: 2, credits: 10 },
                  { hours: 4, credits: 20 }
                ].map(({ hours, credits }) => (
                  <button
                    key={hours}
                    onClick={() => setBoostHours(boostHours === hours ? 0 : hours)}
                    className={`p-2 rounded-lg text-center transition-all ${
                      boostHours === hours 
                        ? 'bg-orange-500 text-white ring-2 ring-orange-400' 
                        : 'bg-zinc-800 text-gray-300 hover:bg-zinc-700'
                    }`}
                  >
                    <div className="text-sm font-bold">{credits}</div>
                    <div className="text-[10px]">credits/{hours}h</div>
                  </button>
                ))}
              </div>
            </div>

            <p className="text-[10px] text-gray-500 text-center">
              Deposit is non-refundable once a Pro accepts and starts traveling to you.
            </p>
          </div>
          
          {/* Fixed Footer */}
          <DialogFooter className="flex-shrink-0 p-4 pt-2 border-t border-zinc-800 gap-2">
            <Button
              variant="outline"
              onClick={() => setShowRequestProModal(false)}
              className="border-zinc-600 text-white hover:bg-zinc-800 flex-1 sm:flex-none"
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!userLocation) {
                  toast.error('Location required');
                  return;
                }
                setRequestProLoading(true);
                try {
                  const response = await axios.post(`${API}/dispatch/request?requester_id=${user?.id}`, {
                    latitude: userLocation.lat,
                    longitude: userLocation.lng,
                    location_name: nearestSpot?.name || 'Current Location',
                    spot_id: nearestSpot?.id || null,
                    estimated_duration_hours: estimatedDuration,
                    is_immediate: true,
                    is_shared: inviteFriends && selectedFriends.length > 0,
                    target_photographer_id: requestProSelectedPro?.id || null,
                    // Include selected friends for lineup invites
                    friend_ids: selectedFriends.length > 0 ? selectedFriends.map(f => f.id) : null
                  });
                  
                  setShowRequestProModal(false);
                  
                  // Show success message based on whether friends were invited
                  if (inviteFriends && selectedFriends.length > 0) {
                    toast.success(`Request created! Invites sent to ${selectedFriends.length} friend${selectedFriends.length > 1 ? 's' : ''} (10 min to accept)`);
                  } else {
                    toast.success('Request created! Proceeding to payment...');
                  }
                  
                  // Store dispatch ID for selfie flow
                  const dispatchId = response.data.id;
                  setActiveDispatchId(dispatchId);
                  
                  // In a real app, this would open Stripe checkout
                  // For now, we'll simulate payment confirmation
                  setTimeout(async () => {
                    try {
                      await axios.post(`${API}/dispatch/${dispatchId}/pay?payer_id=${user?.id}`);
                      toast.success('Payment confirmed! Searching for a Pro...');
                      
                      // Apply boost if selected
                      if (boostHours > 0) {
                        try {
                          const boostResponse = await axios.post(`${API}/dispatch/request/${dispatchId}/boost?user_id=${user?.id}`, {
                            boost_hours: boostHours
                          });
                          toast.success(`🚀 Request boosted! You'll appear first for ${boostHours} hour(s)`);
                          setBoostHours(0); // Reset
                        } catch (boostErr) {
                          toast.error(boostErr.response?.data?.detail || 'Failed to boost request');
                        }
                      }
                      
                      // Show selfie modal after successful payment
                      // In production, this would be triggered when a Pro ACCEPTS
                      // For now, we trigger it immediately so the surfer can prepare
                      setTimeout(() => {
                        setShowRequestProSelfieModal(true);
                      }, 1500);
                      
                    } catch (err) {
                      toast.error('Payment failed');
                    }
                  }, 1000);
                  
                } catch (error) {
                  toast.error(getErrorMessage(error, 'Failed to create request'));
                } finally {
                  setRequestProLoading(false);
                }
              }}
              disabled={requestProLoading || !userLocation}
              className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold flex-1 sm:flex-none"
            >
              {requestProLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Pay ${(((requestProSelectedPro?.on_demand_hourly_rate || 75) * estimatedDuration) * 0.25).toFixed(0)} Deposit
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Request a Pro - Selfie Modal (after Pro accepts) */}
      <RequestProSelfieModal
        dispatchId={activeDispatchId}
        isOpen={showRequestProSelfieModal}
        onClose={() => setShowRequestProSelfieModal(false)}
        onSuccess={(selfieUrl) => {
          toast.success('Great! Your Pro will be able to spot you easily.');
        }}
      />

      {/* End Session Modal - Kill Switch Confirmation */}
      <EndSessionModal
        isOpen={showEndSessionModal}
        onClose={closeEndSessionModal}
        onConfirm={handleEndSessionConfirmed}
        session={currentLiveSession}
        isLoading={endSessionLoading}
      />

      {/* Conditions Modal - Mandatory media capture before Go Live */}
      <ConditionsModal
        isOpen={showConditionsModal}
        onClose={closeConditionsModal}
        onConfirm={handleConditionsConfirm}
        spotName={surfSpots.find(s => s.id === goLiveSpotId)?.name || 'Selected Spot'}
        isLoading={goLiveLoading}
      />

      {/* Permission Nudge Drawer - GPS instructions for Book/Go Live */}
      <PermissionNudgeDrawer
        isOpen={showPermissionNudge}
        onClose={() => setShowPermissionNudge(false)}
        onRetryLocation={getUserLocation}
        action={permissionNudgeAction}
      />
      
      {/* GPS Settings Guide Modal */}
      <GPSSettingsGuide
        isOpen={showGPSGuide}
        onClose={() => setShowGPSGuide(false)}
        onRetryLocation={getUserLocation}
        onManualLocation={() => setShowLocationPicker(true)}
        currentAccuracy={userLocation?.accuracy}
        isLoading={gpsLoading}
      />
      
      {/* Manual Location Picker Modal */}
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

// Export with Error Boundary wrapper
export const MapPage = () => (
  <MapErrorBoundary>
    <MapPageContent />
  </MapErrorBoundary>
);

export default MapPage;
