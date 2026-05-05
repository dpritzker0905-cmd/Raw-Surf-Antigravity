import React, { useState, useRef, useEffect, useCallback } from 'react';

import { useNavigate } from 'react-router-dom';

import { MapPin, Camera, Radio, Users, Waves, AlertTriangle, DollarSign, Zap, Check, ArrowLeft, Image, Tag, Sparkles, Star, CreditCard, Coins, Loader2, RefreshCw, ChevronDown, ChevronRight, Calendar, Lock, Crown, Trophy, CheckCircle, ExternalLink, MessageCircle, X } from 'lucide-react';

import { Button } from './ui/button';

import { SpotConditions } from './SpotConditions';

import { SpotVerificationNudge } from './SpotVerificationNudge';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';

import { Drawer, DrawerContent } from './ui/drawer';

import { Input } from './ui/input';

import { Switch } from './ui/switch';

import { Badge } from './ui/badge';

import { useAuth } from '../contexts/AuthContext';

import { usePersona } from '../contexts/PersonaContext';

import { useTheme } from '../contexts/ThemeContext';

import { getThemeTokens } from '../utils/themeTokens';

import { JumpInSessionModal } from './JumpInSessionModal';

import { LockerSelfieModal } from './LockerSelfieModal';

import { ScanFace } from 'lucide-react';

import apiClient from '../lib/apiClient';

import { toast } from 'sonner';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';




// Extracted sub-components
import { DRAWER_MODE, CAMERA_AUTHORIZED_KEY, SpotOfTheDayBadge, LiveSavingsBadge, StarRating, ReviewsCarousel, GeofenceUpgradeCTA } from './spot-drawer/SpotDrawerHelpers';
import { PhotographerProfile, PhotographerProfileContent } from './spot-drawer/PhotographerProfileContent';
import JumpInFlow from './spot-drawer/JumpInFlow';

const UnifiedSpotDrawer = ({
  spot,
  isOpen,
  onClose,
  onStartShooting,
  onSwitchLocation,
  activeShooters = [],
  isPhotographer = false,
  isUserLive = false,
  currentLiveSpot = null,
  goLiveLoading = false,
  userId = null
}) => {
  // Privacy Shield: Check if spot is within user's geofence
  const { user } = useAuth();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const t = getThemeTokens(theme);
  const isLight = t.isLight;
  const isBeach = t.isBeach;
  
  // Theme-aware tokens from shared utility
  const drawerBg = t.pageBg;
  const drawerBorder = t.borderLight;
  const headerBorder = t.border;
  const textPrimary = t.textPrimary;
  const textSecondary = t.textSecondary;
  const cardBg = t.cardBgBorder;
  
  const isWithinGeofence = spot?.is_within_geofence !== false;
  const distanceMiles = spot?.distance_miles;
  const visibilityRadius = spot?.visibility_radius_miles;
  
  // Drawer mode
  const [drawerMode, setDrawerMode] = useState(DRAWER_MODE.REPORT);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);
  const [selectedPhotographer, setSelectedPhotographer] = useState(null);
  const _drawerRef = useRef(null);
  
  // Snap point control for drawer height
  const [activeSnapPoint, setActiveSnapPoint] = useState(0.92);
  
  // Jump In Session Modal state
  const [showJumpInModal, setShowJumpInModal] = useState(false);
  
  // Refine Location Modal state
  const [showRefineModal, setShowRefineModal] = useState(false);
  const [refinePosition, setRefinePosition] = useState(null);
  const [refineLoading, setRefineLoading] = useState(false);
  const refineMapRef = useRef(null);
  const refineMapInstanceRef = useRef(null);
  const refineMarkerRef = useRef(null);
  
  // Check if user is live at THIS specific spot
  const isLiveAtThisSpot = isUserLive && currentLiveSpot?.id === spot?.id;
  
  // Session pricing settings
  const [sessionSettings, setSessionSettings] = useState({
    price_per_join: 25,
    auto_accept: true,
    max_surfers: 10,
    estimated_duration: 2,
    live_photo_price: 5,
    photos_included: 3,
    general_photo_price: 10,
    photo_price_high: 10,
    pricing_mode: 'tiered' // 'tiered' or 'promotional'
  });

  // Spot of the Day state
  const [spotOfTheDay, setSpotOfTheDay] = useState(null);

  // Real-Time Wave Height state (NOAA/Open-Meteo data)
  const [liveWaveHeight, setLiveWaveHeight] = useState(null);
  
  // User's current location for verification nudge
  const [userLocation, setUserLocation] = useState(null);

  // Helper function to get wave badge color based on wave height
  const getWaveBadgeColor = (height) => {
    if (height >= 10) return 'bg-red-500 text-white';
    if (height >= 8) return 'bg-orange-500 text-white';
    if (height >= 6) return 'bg-yellow-500 text-black';
    if (height >= 4) return 'bg-emerald-500 text-white';
    if (height >= 2) return 'bg-blue-500 text-white';
    return 'bg-gray-500 text-white';
  };

  // Fetch user's existing pricing when drawer opens
  useEffect(() => {
    if (isOpen && isPhotographer && userId) {
      fetchPricing();
    }
  }, [isOpen, isPhotographer, userId]);

  // Fetch Spot of the Day when drawer opens
  useEffect(() => {
    if (isOpen && spot?.region) {
      fetchSpotOfTheDay();
    }
  }, [isOpen, spot?.region]);

  // Fetch Real-Time Wave Height when drawer opens
  useEffect(() => {
    if (isOpen && spot?.id) {
      fetchLiveWaveHeight();
    }
  }, [isOpen, spot?.id]);

  // Get user location for verification nudge (photographers only)
  useEffect(() => {
    if (isOpen && isPhotographer && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          logger.debug('Geolocation error:', error);
        },
        { enableHighAccuracy: true }
      );
    }
  }, [isOpen, isPhotographer]);

  const fetchLiveWaveHeight = async () => {
    try {
      const response = await apiClient.get(`/conditions/${spot.id}`);
      if (response.data?.current?.wave_height_ft) {
        setLiveWaveHeight(Math.round(response.data?.current?.wave_height_ft || 0));
      }
    } catch (error) {
      logger.debug('Wave height data not available');
      setLiveWaveHeight(null);
    }
  };

  const fetchSpotOfTheDay = async () => {
    try {
      const response = await apiClient.get(`/spot-of-the-day`, {
        params: { region: spot?.region }
      });
      if (response.data.has_spot_of_the_day) {
        // Only show if it's for THIS spot
        if (response.data.spot?.id === spot?.id) {
          setSpotOfTheDay(response.data);
        } else {
          setSpotOfTheDay(null);
        }
      }
    } catch (error) {
      logger.debug('Spot of the Day not available');
    }
  };

  // Fetch condition reports and pro photos when drawer opens
  useEffect(() => {
    if (isOpen && spot?.id) {
      fetchConditionReports();
      fetchProPhotos();
      fetchCommunityPhotos();
      setDrawerTab('reports');
    }
  }, [isOpen, spot?.id]);

  const fetchConditionReports = async () => {
    try {
      const response = await apiClient.get(`/condition-reports/spot/${spot.id}?limit=5`);
      setConditionReports(response.data?.reports || response.data || []);
    } catch (error) {
      logger.debug('Condition reports not available');
      setConditionReports([]);
    }
  };

  const fetchProPhotos = async () => {
    try {
      const response = await apiClient.get(`/posts/spot/${spot.id}?limit=9&type=photographer`);
      setProPhotos(response.data?.posts || response.data || []);
    } catch (error) {
      logger.debug('Pro photos not available');
      setProPhotos([]);
    }
  };

  const fetchCommunityPhotos = async () => {
    try {
      const response = await apiClient.get(`/posts/spot/${spot.id}?limit=9&type=community`);
      setCommunityPhotos(response.data?.posts || response.data || []);
    } catch (error) {
      logger.debug('Community photos not available');
      setCommunityPhotos([]);
    }
  };

  // Reset drawer mode when spot changes or drawer closes
  useEffect(() => {
    if (spot) {
      setDrawerMode(DRAWER_MODE.REPORT);
      setSelectedPhotographer(null);
    }
  }, [spot?.id]);

  useEffect(() => {
    if (!isOpen) {
      setDrawerMode(DRAWER_MODE.REPORT);
      setSelectedPhotographer(null);
    }
  }, [isOpen]);

  const fetchPricing = async () => {
    try {
      const [pricingRes, galleryRes] = await Promise.all([
        apiClient.get(`/photographer/${userId}/pricing`),
        apiClient.get(`/photographer/${userId}/gallery-pricing`).catch(() => ({ data: {} }))
      ]);
      
      const generalPrice = galleryRes.data?.photo_pricing?.standard || 10;
      
      setSessionSettings(prev => ({
        ...prev,
        price_per_join: pricingRes.data.live_buyin_price || 25,
        live_photo_price: pricingRes.data.live_photo_price || 5,
        photos_included: pricingRes.data.photo_package_size || 3,
        general_photo_price: generalPrice
      }));
    } catch (e) {
      logger.error('Error fetching pricing:', e);
    }
  };

  // Calculate live savings - only show in promotional mode
  const liveSavings = sessionSettings.pricing_mode === 'promotional'
    ? (sessionSettings.photo_price_high || sessionSettings.general_photo_price) - sessionSettings.live_photo_price
    : sessionSettings.general_photo_price - sessionSettings.live_photo_price;
  const hasSavings = liveSavings > 0 && sessionSettings.pricing_mode === 'promotional';

  const handleStartShooting = () => {
    if (isUserLive && currentLiveSpot?.id !== spot.id) {
      setShowSwitchConfirm(true);
    } else {
      setDrawerMode(DRAWER_MODE.SETUP);
    }
  };

  const confirmSwitchLocation = () => {
    setShowSwitchConfirm(false);
    onSwitchLocation?.(spot?.id, sessionSettings);
  };

  // Find Me Spot Scanner State
  const [scanModalOpen, setScanModalOpen] = useState(false);
  
  // Condition reports state
  const [conditionReports, setConditionReports] = useState([]);
  const [proPhotos, setProPhotos] = useState([]);
  const [communityPhotos, setCommunityPhotos] = useState([]);
  const [drawerTab, setDrawerTab] = useState('reports');
  const [lightboxUrl, setLightboxUrl] = useState(null);

  // ============ REFINE LOCATION FUNCTIONS ============
  const openRefineModal = () => {
    setRefinePosition({ lat: spot.latitude, lng: spot.longitude });
    setShowRefineModal(true);
  };

  const initRefineMap = useCallback(() => {
    if (!refineMapRef.current || !window.L || !spot) return;
    
    // Clean up existing map
    if (refineMapInstanceRef.current) {
      refineMapInstanceRef.current.remove();
      refineMapInstanceRef.current = null;
    }
    
    const map = window.L.map(refineMapRef.current, {
      center: [spot.latitude, spot.longitude],
      zoom: 17,
      zoomControl: true
    });
    
    // Satellite layer (Esri World Imagery)
    window.L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Esri', maxZoom: 19 }
    ).addTo(map);
    
    // Create draggable marker
    const icon = window.L.divIcon({
      className: 'refine-pin-marker',
      html: `
        <div class="relative">
          <div class="w-8 h-8 rounded-full bg-gradient-to-r from-cyan-400 to-green-400 border-4 border-white shadow-lg flex items-center justify-center">
            <div class="w-3 h-3 bg-white rounded-full"></div>
          </div>
          <div class="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[10px] border-t-cyan-400"></div>
        </div>
      `,
      iconSize: [32, 40],
      iconAnchor: [16, 40]
    });
    
    const marker = window.L.marker([spot.latitude, spot.longitude], {
      icon,
      draggable: true
    }).addTo(map);
    
    // Track drag events
    marker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      setRefinePosition({ lat: pos.lat, lng: pos.lng });
    });
    
    refineMarkerRef.current = marker;
    refineMapInstanceRef.current = map;
  }, [spot]);

  // Initialize refine map when modal opens
  useEffect(() => {
    if (showRefineModal && spot) {
      setTimeout(() => initRefineMap(), 100);
    }
    
    return () => {
      if (refineMapInstanceRef.current) {
        refineMapInstanceRef.current.remove();
        refineMapInstanceRef.current = null;
      }
    };
  }, [showRefineModal, spot, initRefineMap]);

  // Submit refinement
  const submitRefinement = async () => {
    if (!userId || !spot?.id || !refinePosition) return;
    
    setRefineLoading(true);
    try {
      await apiClient.post(`/spots/${spot.id}/refine-location`, null, {
        params: {
          photographer_id: userId,
          new_latitude: refinePosition.lat,
          new_longitude: refinePosition.lng
        }
      });
      toast.success('Peak location submitted for review!', {
        description: 'Thanks for helping improve spot accuracy'
      });
      setShowRefineModal(false);
    } catch (error) {
      const msg = error.response?.data?.detail || 'Failed to submit refinement';
      toast.error(msg);
    } finally {
      setRefineLoading(false);
    }
  };

  const handleConfirmGoLive = () => {
    // Pass spot.id (not entire spot object) and session settings
    onStartShooting?.(spot?.id, sessionSettings);
  };

  const handleJumpInClick = (shooter) => {
    setSelectedPhotographer({
      ...shooter,
      current_spot_name: spot?.name
    });
    // Open the Jump In modal directly instead of going to profile first
    setShowJumpInModal(true);
  };

  // Handler for viewing photographer profile without joining
  const _handleViewPhotographerProfile = (shooter) => {
    setSelectedPhotographer({
      ...shooter,
      current_spot_name: spot?.name
    });
    setDrawerMode(DRAWER_MODE.PHOTOGRAPHER_PROFILE);
    // Expand drawer to full height when viewing photographer profile
    setActiveSnapPoint(1);
  };

  const _handleJumpInSuccess = (_data) => {
    setShowJumpInModal(false);
    setDrawerMode(DRAWER_MODE.REPORT);
    setSelectedPhotographer(null);
    setActiveSnapPoint(0.6); // Reset to default snap point
    // Could trigger a refresh of active shooters here
  };

  if (!spot) return null;

  return (
    <>
      {/* Main Drawer - Using vaul for proper mobile scrolling */}
      <Drawer 
        open={isOpen && !showJumpInModal} 
        onOpenChange={(open) => {
          if (!open && !showJumpInModal) {
            onClose();
            setActiveSnapPoint(0.92); // Reset on close
          }
        }} 
        snapPoints={[0.5, 0.75, 0.92]}
        activeSnapPoint={activeSnapPoint}
        setActiveSnapPoint={setActiveSnapPoint}
        dismissible={true}
      >
        <DrawerContent 
          className={`${drawerBg} border-t ${drawerBorder} max-h-[92vh] focus:outline-none md:max-w-[520px] md:mx-auto md:rounded-t-2xl`}
          data-testid="unified-spot-drawer"
        >
          {/* Close / Pull-down button - always visible at top */}
          <button
            onClick={onClose}
            className={`w-full flex flex-col items-center pt-2 pb-1 cursor-grab active:cursor-grabbing`}
            aria-label="Close drawer"
          >
            <div className={`w-12 h-1.5 rounded-full mb-1 ${isLight ? 'bg-gray-300' : isBeach ? 'bg-amber-300' : 'bg-zinc-600'}`} />
            <ChevronDown className={`w-5 h-5 ${textSecondary} opacity-60`} />
          </button>
          {drawerMode === DRAWER_MODE.PHOTOGRAPHER_PROFILE && selectedPhotographer && (
            <div className="flex flex-col" style={{ height: '85vh', maxHeight: '85vh' }}>
              {/* Header - Fixed */}
              <div className="flex items-center gap-3 p-4 border-b border-zinc-800 shrink-0">
                <button aria-label="Go back" onClick={() => {
                  setDrawerMode(DRAWER_MODE.REPORT);
                  setActiveSnapPoint(0.6);
                }} className="text-gray-400 hover:text-white p-2 -ml-2">
                  <ArrowLeft className="w-6 h-6" />
                </button>
                <h3 className="text-white font-bold flex-1">Photographer Profile</h3>
              </div>
              
              {/* Scrollable Content */}
              <div 
                className="flex-1 overflow-y-auto p-4 space-y-4"
                style={{ 
                  WebkitOverflowScrolling: 'touch',
                  touchAction: 'pan-y'
                }}
              >
                <PhotographerProfileContent 
                  photographer={selectedPhotographer}
                />
                {/* Bottom spacer for scroll */}
                <div className="h-4" />
              </div>
              
              {/* Fixed Bottom Button - Opens Jump In Modal */}
              <div className="shrink-0 p-4 border-t border-zinc-800 bg-zinc-900" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
                <Button aria-label="Users"
                  onClick={() => setShowJumpInModal(true)}
                  className="w-full h-12 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold text-lg"
                  data-testid="jump-in-session-btn"
                >
                  <Users className="w-5 h-5 mr-2" />
                  Jump In - ${selectedPhotographer?.live_buyin_price || selectedPhotographer?.session_price || 25}
                </Button>
              </div>
            </div>
          )}

          {/* Standard Views (REPORT and SETUP) */}
          {(drawerMode === DRAWER_MODE.REPORT || drawerMode === DRAWER_MODE.SETUP) && (
            <div className="flex flex-col max-h-[85vh]">
              {/* Header */}
              <div className={`flex items-center justify-between px-4 py-3 border-b ${headerBorder} shrink-0`}>
                <div className="flex items-center gap-3">
                  {drawerMode === DRAWER_MODE.SETUP && (
                    <button aria-label="Go back"
                      onClick={() => setDrawerMode(DRAWER_MODE.REPORT)}
                      className="text-gray-400 hover:text-white"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 p-0.5">
                    <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center">
                      <MapPin className="w-5 h-5 text-cyan-400" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2
                        className={`${textPrimary} font-bold text-lg cursor-pointer hover:text-cyan-400 transition-colors truncate font-oswald`}
                        
                        onClick={() => { navigate(`/spot-hub/${spot.id}`); onClose?.(); }}
                        title="View Spot Hub"
                      >
                        {spot.name}
                      </h2>
                      {/* Real-Time Wave Height Badge - NOAA/Open-Meteo data */}
                      {liveWaveHeight !== null && (
                        <Badge className={`text-xs px-1.5 py-0.5 shrink-0 ${getWaveBadgeColor(liveWaveHeight)}`} data-testid="live-wave-badge">
                          <Waves className="w-3 h-3 mr-0.5" />
                          {liveWaveHeight}ft
                        </Badge>
                      )}
                      {/* Community Verified Badge */}
                      {spot.community_verified && (
                        <Badge className="bg-emerald-500 text-white text-xs px-1.5 py-0.5 shrink-0" data-testid="community-verified-badge">
                          <CheckCircle className="w-3 h-3 mr-0.5" />
                          Verified
                        </Badge>
                      )}
                    </div>
                    <p className={`${textSecondary} text-xs`}>{spot.region}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Refine Peak button - shows when photographer is LIVE at THIS spot */}
                  {isPhotographer && isLiveAtThisSpot && drawerMode === DRAWER_MODE.REPORT && (
                    <Button aria-label="Location"
                      onClick={openRefineModal}
                      size="sm"
                      variant="outline"
                      className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                      data-testid="refine-peak-btn"
                    >
                      <MapPin className="w-4 h-4 mr-1" />
                      Refine Peak
                    </Button>
                  )}
                  
                  {/* Start Shooting button - only for photographers in REPORT mode */}
                  {isPhotographer && drawerMode === DRAWER_MODE.REPORT && (
                    <Button aria-label="Loader2"
                      onClick={handleStartShooting}
                      disabled={goLiveLoading}
                      size="sm"
                      className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-medium"
                      data-testid="start-shooting-btn"
                    >
                      {goLiveLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Camera className="w-4 h-4 mr-1" />
                          Start Shooting
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {/* Scrollable Content */}
              <div 
                className="flex-1 overflow-y-auto overscroll-contain pb-6"
                style={{ 
                  WebkitOverflowScrolling: 'touch',
                  touchAction: 'pan-y'
                }}
              >
                {/* ==================== REPORT MODE ==================== */}
                {drawerMode === DRAWER_MODE.REPORT && (
                  <>
                    {/* Live Session Savings Banner */}
                    {activeShooters.length > 0 && (
                      <div className="px-4 py-3 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-b border-green-500/20">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-green-400" />
                          <span className="text-green-400 font-medium text-sm">Live Session Savings!</span>
                        </div>
                        <p className="text-gray-400 text-xs mt-1">
                          Join a session now and get photos at discounted rates
                        </p>
                      </div>
                    )}

                    {/* Spot of the Day Badge - Social Discovery Engine */}
                    {spotOfTheDay && (
                      <SpotOfTheDayBadge 
                        spotOfTheDay={spotOfTheDay}
                        onClick={() => {
                          // Scroll to photographer list or open booking
                          if (activeShooters.length > 0) {
                            handleJumpInClick(activeShooters[0]);
                          }
                        }}
                      />
                    )}

                    {/* Surf Conditions - Always visible */}
                    <div className="px-4">
                      <SpotConditions spotId={spot?.id} spotName={spot?.name} />
                      
                      {/* Targeted Spot AI Scan Feature */}
                      {user && (
                        <div className="mt-4 p-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-xl">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h4 className="text-white font-medium flex items-center gap-2">
                                <ScanFace className="w-4 h-4 text-cyan-400" />
                                Scan {spot?.name} for My Photos
                              </h4>
                              <p className="text-gray-400 text-xs mt-1">
                                Did you shred here recently? We'll sweep this exact spot searching for your wetsuit, board, and face.
                              </p>
                            </div>
                            <Button
                              onClick={() => setScanModalOpen(true)}
                              className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold shrink-0"
                              size="sm"
                              data-testid="spot-scan-btn"
                            >
                              Scan Spot
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Photographer Verification Nudge - Show when photographer is within 200m */}
                    {isPhotographer && (
                      <div className="px-4 py-3">
                        <SpotVerificationNudge 
                          spot={spot}
                          userLocation={userLocation}
                        />
                      </div>
                    )}

                    {/* Privacy Shield: Show upgrade CTA if outside geofence */}
                    {!isWithinGeofence && (
                      <GeofenceUpgradeCTA 
                        distanceMiles={distanceMiles}
                        visibilityRadius={visibilityRadius}
                        activePhotographersCount={spot?.active_photographers_count || 0}
                      />
                    )}

                    {/* Active Photographers - Only show if within geofence */}
                    {isWithinGeofence && (
                      <div className="px-4 py-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Radio className="w-4 h-4 text-green-400" />
                          <h3 className="text-white font-medium text-sm">
                            Live Now ({activeShooters.length})
                          </h3>
                        </div>

                        {activeShooters.length > 0 ? (
                          <div className="space-y-3">
                            {activeShooters.map((shooter) => (
                              <div 
                                key={shooter.id} 
                                className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-xl cursor-pointer hover:bg-zinc-800 transition-colors"
                                onClick={() => handleJumpInClick(shooter)}
                                data-testid={`photographer-card-${shooter.id}`}
                              >
                                <div className="relative">
                                  <div className="w-12 h-12 rounded-full p-[2px] bg-gradient-to-r from-green-400 to-cyan-400">
                                    <div className="w-full h-full rounded-full bg-zinc-800 overflow-hidden">
                                      {shooter.avatar_url ? (
                                        <img loading="lazy" decoding="async" src={getFullUrl(shooter.avatar_url)} className="w-full h-full object-cover" alt="" />
                                      ) : (
                                        <span className="flex items-center justify-center h-full text-cyan-400">
                                          {shooter.full_name?.[0]}
                                        </span>
                                      )}
                                    </div>
                                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full border-2 border-zinc-900" />
                                  </div>
                                </div>
                                <div className="flex-1">
                                  <p className="text-white font-medium text-sm">{shooter.full_name}</p>
                                  <div className="flex items-center gap-2">
                                    <p className="text-gray-400 text-xs">
                                      ${shooter.session_price || 25} buy-in
                                    </p>
                                    {shooter.live_photo_price && shooter.general_photo_price && 
                                     shooter.live_photo_price < shooter.general_photo_price && (
                                      <Badge className="bg-green-500/20 text-green-400 text-[10px] px-1.5 py-0">
                                        Save ${shooter.general_photo_price - shooter.live_photo_price}/photo
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <Button aria-label="Users"
                                  size="sm"
                                  variant="outline"
                                  className="border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10 text-xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleJumpInClick(shooter);
                                  }}
                                  data-testid={`jump-in-btn-${shooter.id}`}
                                >
                                  <Users className="w-3 h-3 mr-1" />
                                  Jump In
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-6 text-gray-500">
                            <Camera className="w-8 h-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No photographers shooting here yet</p>
                            {isPhotographer && (
                              <p className="text-xs text-cyan-400 mt-1">Be the first to go live!</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Difficulty Badge */}
                    {spot.difficulty && (
                      <div className="px-4 py-3">
                        <span className="inline-block px-3 py-1 bg-zinc-800 rounded-lg text-xs text-gray-300">
                          {spot.difficulty}
                        </span>
                      </div>
                    )}

                    {/* Open Sessions - Bookings with split_mode='open_nearby' */}
                    {isWithinGeofence && spot.open_bookings?.length > 0 && (
                      <div className="px-4 py-4 border-t border-zinc-800">
                        <div className="flex items-center gap-2 mb-3">
                          <Users className="w-4 h-4 text-cyan-400" />
                          <h3 className="text-white font-medium text-sm">
                            Join a Crew ({spot.open_bookings.length})
                          </h3>
                          <Badge className="bg-cyan-500/20 text-cyan-400 text-[10px] px-1.5 py-0">
                            Open to Nearby
                          </Badge>
                        </div>
                        
                        <div className="space-y-3">
                          {spot.open_bookings.map((booking) => (
                            <div 
                              key={booking.id}
                              className="p-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-xl border border-cyan-500/30 cursor-pointer hover:border-cyan-500/50 transition-colors"
                              onClick={() => {
                                // Navigate to bookings page with this invite code
                                navigate(`/bookings?join=${booking.invite_code}`);
                                onClose?.();
                              }}
                              data-testid={`open-booking-${booking.id}`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  {booking.photographer_avatar ? (
                                    <img loading="lazy" decoding="async" 
                                      src={booking.photographer_avatar}
                                      alt=""
                                      className="w-8 h-8 rounded-full object-cover border border-cyan-500/30"
                                    />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-sm font-bold">
                                      {booking.photographer_name?.[0] || '?'}
                                    </div>
                                  )}
                                  <div>
                                    <p className="text-white text-sm font-medium">
                                      {booking.photographer_name || 'Session'}
                                    </p>
                                    <p className="text-gray-400 text-xs">
                                      {new Date(booking.session_date).toLocaleDateString(undefined, { 
                                        weekday: 'short', 
                                        month: 'short', 
                                        day: 'numeric',
                                        hour: 'numeric',
                                        minute: '2-digit'
                                      })}
                                    </p>
                                  </div>
                                </div>
                                <Badge className="bg-green-500/20 text-green-400 text-xs px-2 py-0.5">
                                  {booking.spots_left} spot{booking.spots_left > 1 ? 's' : ''} left
                                </Badge>
                              </div>
                              
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 text-xs text-gray-400">
                                  <span className="flex items-center gap-1">
                                    <DollarSign className="w-3 h-3" />
                                    ${booking.price_per_person?.toFixed(2)}/person
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Users className="w-3 h-3" />
                                    {booking.max_participants - booking.spots_left}/{booking.max_participants}
                                  </span>
                                </div>
                                <Button
                                  size="sm"
                                  className="bg-cyan-500 hover:bg-cyan-600 text-black text-xs h-7"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/bookings?join=${booking.invite_code}`);
                                    onClose?.();
                                  }}
                                >
                                  Join Crew
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* -- Tab Navigation (mirrors SpotHub) ------------ */}
                    <div className={`flex border-t border-b ${headerBorder} mt-2`}>
                      {[
                        { id: 'reports', label: 'Reports', icon: MessageCircle, count: conditionReports.length },
                        { id: 'pro', label: 'Pro', icon: Camera, count: proPhotos.length },
                        { id: 'community', label: 'Community', icon: Users, count: communityPhotos.length },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setDrawerTab(tab.id)}
                          className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors relative ${
                            drawerTab === tab.id ? textPrimary : textSecondary
                          }`}
                        >
                          <tab.icon className="w-3.5 h-3.5" />
                          {tab.label}
                          {tab.count > 0 && (
                            <span className={`text-[10px] ${textSecondary}`}>({tab.count})</span>
                          )}
                          {drawerTab === tab.id && (
                            <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-cyan-400 rounded-full" />
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="px-4 py-3">
                      {drawerTab === 'reports' && (
                        <div className="space-y-2">
                          {conditionReports.length > 0 ? conditionReports.slice(0, 5).map((report) => (
                            <div key={report.id} className={`p-2.5 rounded-lg border ${cardBg}`}>
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-cyan-500 shrink-0">
                                  {report.photographer_avatar ? (
                                    <img loading="lazy" decoding="async" src={getFullUrl(report.photographer_avatar)} className="w-full h-full object-cover" alt="" />
                                  ) : (
                                    <div className="w-full h-full bg-cyan-500 flex items-center justify-center text-xs font-bold text-white">{report.photographer_name?.[0]}</div>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-sm font-medium truncate ${textPrimary}`}>{report.photographer_name}</p>
                                  <p className={`text-[10px] ${textSecondary}`}>{report.time_ago}</p>
                                </div>
                                {report.conditions_label && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 font-medium shrink-0">{report.conditions_label}</span>
                                )}
                              </div>
                              {/* Captured timestamp - exact time the media was shot */}
                              <p className={`text-xs mt-1.5 ${textSecondary}`}>
                                Captured {new Date(report.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {new Date(report.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })} - {report.spot_name || spot?.name || 'Unknown Spot'}
                              </p>
                              <div className="flex items-center gap-3 mt-1.5">
                                {report.wave_height_ft && (<span className="text-xs flex items-center gap-1"><Waves className="w-3 h-3 text-cyan-400" /><span className={textPrimary}>{report.wave_height_ft}ft</span></span>)}
                                {report.wind_conditions && (<span className={`text-xs ${textSecondary}`}>{report.wind_conditions}</span>)}
                                {report.crowd_level && (<span className="text-xs flex items-center gap-1"><Users className="w-3 h-3 text-purple-400" /><span className={textPrimary}>{report.crowd_level}</span></span>)}
                              </div>
                              {(() => {
                                const urls = [report.thumbnail_url, report.media_url].filter(u => u && u.trim() && !u.startsWith('/api/uploads/'));
                                if (!urls[0]) return null;
                                return (<img loading="lazy" decoding="async" src={getFullUrl(urls[0])} alt="" className="mt-2 w-full h-48 object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setLightboxUrl(getFullUrl(urls[0]))} onError={(e) => { if (urls[1] && e.target.src !== getFullUrl(urls[1])) { e.target.src = getFullUrl(urls[1]); } else { e.target.style.display = 'none'; } }} />);
                              })()}
                            </div>
                          )) : (
                            <div className={`text-center py-8 ${textSecondary}`}>
                              <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
                              <p className="text-sm">No condition reports yet</p>
                              <p className="text-xs">Photographers will post when they start shooting</p>
                            </div>
                          )}
                        </div>
                      )}
                      {drawerTab === 'pro' && (
                        <div>
                          {proPhotos.length > 0 ? (<>
                            <p className={`text-[10px] ${textSecondary} mb-2`}>Photos/videos tagged to this spot by photographers</p>
                            <div className="grid grid-cols-3 gap-1.5">
                              {proPhotos.slice(0, 9).map((post) => (
                                <div key={post.id} className="aspect-square rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity" onClick={() => { navigate(`/post/${post.id}`); onClose?.(); }}>
                                  <img loading="lazy" decoding="async" src={getFullUrl(post.thumbnail_url || post.media_url)} alt="" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
                                </div>
                              ))}
                            </div>
                          </>) : (
                            <div className={`text-center py-8 ${textSecondary}`}>
                              <Camera className="w-10 h-10 mx-auto mb-2 opacity-30" />
                              <p className="text-sm">No pro photos tagged here</p>
                              <p className="text-xs">Photographers can tag their photos to this spot</p>
                            </div>
                          )}
                        </div>
                      )}
                      {drawerTab === 'community' && (
                        <div>
                          {communityPhotos.length > 0 ? (<>
                            <p className={`text-[10px] ${textSecondary} mb-2`}>Photos/videos tagged to this spot by surfers</p>
                            <div className="grid grid-cols-3 gap-1.5">
                              {communityPhotos.slice(0, 9).map((post) => (
                                <div key={post.id} className="aspect-square rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity" onClick={() => { navigate(`/post/${post.id}`); onClose?.(); }}>
                                  <img loading="lazy" decoding="async" src={getFullUrl(post.thumbnail_url || post.media_url)} alt="" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
                                </div>
                              ))}
                            </div>
                          </>) : (
                            <div className={`text-center py-8 ${textSecondary}`}>
                              <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                              <p className="text-sm">No community posts tagged here</p>
                              <p className="text-xs">Tag your photos to this spot to appear here</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="px-4 py-3">
                      <button aria-label="div" onClick={() => { navigate(`/spot-hub/${spot.id}`); onClose?.(); }} className={`w-full group overflow-hidden rounded-xl border ${isLight ? 'border-cyan-400/40 bg-gradient-to-r from-cyan-50 via-blue-50 to-purple-50 hover:from-cyan-100 hover:via-blue-100 hover:to-purple-100' : 'border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10 hover:from-cyan-500/20 hover:via-blue-500/20 hover:to-purple-500/20'} transition-all duration-300`} data-testid="view-spot-hub-btn">
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 p-0.5 shrink-0">
                              <div className={`w-full h-full rounded-full ${isLight ? 'bg-white' : isBeach ? 'bg-amber-50' : 'bg-zinc-900'} flex items-center justify-center`}>
                                <ExternalLink className="w-4 h-4 text-cyan-400" />
                              </div>
                            </div>
                            <div>
                              <p className={`${textPrimary} font-semibold text-sm`}>View Full Spot Hub</p>
                              <p className={`${textSecondary} text-xs`}>Forecast, reports, galleries & more</p>
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-cyan-400 group-hover:translate-x-1 transition-transform" />
                        </div>
                      </button>
                    </div>
                    {/* Bottom safe area padding for mobile */}
                    <div className="h-20" aria-hidden="true" />
                  </>
                )}

                {/* ==================== SETUP MODE ==================== */}
                {drawerMode === DRAWER_MODE.SETUP && (
                  <div className="px-4 py-6 space-y-5">
                    {/* Setup Header Info */}
                    <div className="text-center mb-4">
                      <p className="text-gray-400 text-sm">
                        Set your <span className="text-cyan-400 font-semibold">Live Session Rates</span> for
                      </p>
                      <p className="text-white font-medium">{spot.name}</p>
                    </div>

                    {/* Live Savings Preview - Shows only in Promotional mode */}
                    {hasSavings && (
                      <div className="p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-5 h-5 text-green-400" />
                          <span className="text-green-400 font-bold text-sm">Promotional Rate Active</span>
                        </div>
                        <p className="text-gray-300 text-xs">
                          Surfers will see: "Save <span className="text-green-400 font-bold">${liveSavings}</span> per photo by joining now!"
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-gray-500 line-through text-sm">${sessionSettings.photo_price_high || sessionSettings.general_photo_price}</span>
                          <span className="text-white font-bold text-lg">${sessionSettings.live_photo_price}</span>
                          <Badge className="bg-green-500 text-white text-xs">
                            {Math.round((liveSavings / (sessionSettings.photo_price_high || sessionSettings.general_photo_price)) * 100)}% OFF
                          </Badge>
                        </div>
                      </div>
                    )}
                    
                    {/* Standard Rates Info - Shows when NOT in promotional mode */}
                    {!hasSavings && sessionSettings.pricing_mode !== 'promotional' && (
                      <div className="p-3 bg-zinc-800/50 border border-zinc-700 rounded-xl">
                        <div className="flex items-center gap-2">
                          <Tag className="w-4 h-4 text-purple-400" />
                          <span className="text-gray-300 text-sm">Standard Tiered Pricing</span>
                        </div>
                        <p className="text-gray-500 text-xs mt-1">
                          Surfers will choose Web/Standard/High resolution at checkout
                        </p>
                      </div>
                    )}

                    {/* Buy-in Price */}
                    <div className="space-y-2">
                      <label className="text-gray-400 text-sm flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-green-400" />
                        Session Buy-in Price
                      </label>
                      <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-xl">
                        <span className="text-2xl font-bold text-white">$</span>
                        <Input aria-label="Numeric input"
                          type="number"
                          value={sessionSettings.price_per_join}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, price_per_join: parseInt(e.target.value) || 0 }))}
                          className="bg-transparent border-none text-2xl font-bold text-white text-center"
                          min="0"
                          max="500"
                        />
                        <span className="text-gray-400 text-sm whitespace-nowrap">per surfer</span>
                      </div>
                    </div>

                    {/* Photos Included */}
                    <div className="space-y-2">
                      <label className="text-gray-400 text-sm flex items-center gap-2">
                        <Image className="w-4 h-4 text-blue-400" />
                        Photos Included in Buy-in
                      </label>
                      <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-xl">
                        <Input aria-label="Numeric input"
                          type="number"
                          value={sessionSettings.photos_included}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, photos_included: parseInt(e.target.value) || 0 }))}
                          className="bg-transparent border-none text-xl font-bold text-white text-center w-20"
                          min="0"
                          max="50"
                        />
                        <span className="text-gray-400 text-sm">digital downloads included</span>
                      </div>
                    </div>

                    {/* Live Photo Price - Promotional Rate */}
                    <div className="space-y-2">
                      <label className="text-gray-400 text-sm flex items-center gap-2">
                        <Tag className="w-4 h-4 text-purple-400" />
                        Price per Additional Photo
                        {sessionSettings.pricing_mode === 'promotional' && (
                          <Badge className="bg-green-500/20 text-green-400 text-[10px] ml-1">PROMO</Badge>
                        )}
                      </label>
                      <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-xl">
                        <span className="text-xl font-bold text-white">$</span>
                        <Input aria-label="Numeric input"
                          type="number"
                          value={sessionSettings.live_photo_price}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, live_photo_price: parseFloat(e.target.value) || 0 }))}
                          className="bg-transparent border-none text-xl font-bold text-white text-center w-20"
                          min="0"
                          max="100"
                          step="0.50"
                        />
                        <div className="flex-1">
                          <span className="text-gray-400 text-sm">per photo</span>
                          {hasSavings && (
                            <p className="text-green-400 text-xs">${liveSavings} less than high-res!</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Max Surfers */}
                    <div className="flex items-center justify-between p-3 bg-zinc-800 rounded-xl">
                      <div className="flex items-center gap-3">
                        <Users className="w-5 h-5 text-blue-400" />
                        <div>
                          <span className="text-white font-medium">Max Surfers</span>
                          <p className="text-gray-500 text-xs">Session capacity</p>
                        </div>
                      </div>
                      <Input aria-label="Numeric input"
                        type="number"
                        value={sessionSettings.max_surfers}
                        onChange={(e) => setSessionSettings(prev => ({ ...prev, max_surfers: parseInt(e.target.value) || 1 }))}
                        className="bg-zinc-900 border-zinc-700 text-white font-bold text-center w-20"
                        min="1"
                        max="50"
                      />
                    </div>

                    {/* Auto-Accept Toggle */}
                    <div className="flex items-center justify-between p-3 bg-zinc-800 rounded-xl">
                      <div className="flex items-center gap-3">
                        <Zap className="w-5 h-5 text-yellow-400" />
                        <div>
                          <span className="text-white font-medium">Auto-Accept</span>
                          <p className="text-gray-500 text-xs">Allow walk-ups without approval</p>
                        </div>
                      </div>
                      <Switch
                        checked={sessionSettings.auto_accept}
                        onCheckedChange={(checked) => setSessionSettings(prev => ({ ...prev, auto_accept: checked }))}
                      />
                    </div>

                    {/* Continue Button - Opens Conditions Modal */}
                    <Button aria-label="Loader2"
                      onClick={handleConfirmGoLive}
                      disabled={goLiveLoading}
                      className="w-full h-12 bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-lg"
                      data-testid="continue-to-conditions-btn"
                    >
                      {goLiveLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          Continue
                          <ChevronDown className="w-5 h-5 ml-2 rotate-[-90deg]" />
                        </>
                      )}
                    </Button>
                    <p className="text-center text-gray-500 text-xs mt-2">
                      You'll capture current conditions next
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>

      {/* Switch Location Confirmation Dialog */}
      <Dialog open={showSwitchConfirm} onOpenChange={setShowSwitchConfirm}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-sm z-[1100]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              Switch Location?
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            <p className="text-gray-400 text-sm mb-3">
              You're currently live at <span className="text-white font-medium">{currentLiveSpot?.name}</span>.
            </p>
            <p className="text-gray-400 text-sm">
              Do you want to end that session and start shooting at <span className="text-cyan-400 font-medium">{spot?.name}</span>?
            </p>
          </div>

          <DialogFooter className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowSwitchConfirm(false)}
              className="flex-1 border-zinc-600 text-white"
            >
              Stay Here
            </Button>
            <Button
              onClick={confirmSwitchLocation}
              className="flex-1 bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold"
            >
              Switch Location
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refine Location Modal - Photographer crowdsourced peak accuracy */}
      <Dialog open={showRefineModal} onOpenChange={setShowRefineModal}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-lg z-[1100]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <MapPin className="w-5 h-5 text-cyan-400" />
              Refine Peak Location
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Instructions */}
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
              <p className="text-sm text-cyan-300">
                Drag the pin to where waves actually break. Your input helps make this spot more accurate for everyone.
              </p>
            </div>
            
            {/* Map Container */}
            <div 
              ref={refineMapRef} 
              className="w-full h-[300px] rounded-lg border border-zinc-700 overflow-hidden"
              style={{ background: '#1a1a1a' }}
            />
            
            {/* Coordinates Display */}
            {refinePosition && (
              <div className="flex justify-between text-xs text-gray-400">
                <span>Original: {spot?.latitude?.toFixed(6)}, {spot?.longitude?.toFixed(6)}</span>
                <span className="text-cyan-400">New: {refinePosition.lat.toFixed(6)}, {refinePosition.lng.toFixed(6)}</span>
              </div>
            )}
            
            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowRefineModal(false)}
                className="flex-1 border-zinc-600 text-white"
              >
                Cancel
              </Button>
              <Button aria-label="Loader2"
                onClick={submitRefinement}
                disabled={refineLoading}
                className="flex-1 bg-gradient-to-r from-cyan-400 to-green-400 text-black font-bold"
              >
                {refineLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-1" />
                    Submit Refinement
                  </>
                )}
              </Button>
            </div>
            
            <p className="text-center text-gray-500 text-xs">
              When 3+ photographers agree, location is queued for admin approval
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Jump In Session Modal - Full selfie + payment flow */}
      {showJumpInModal && selectedPhotographer && (
        <JumpInSessionModal
          photographer={selectedPhotographer}
          onClose={() => setShowJumpInModal(false)}
          onSuccess={() => {
            setShowJumpInModal(false);
            setDrawerMode(DRAWER_MODE.REPORT);
            setSelectedPhotographer(null);
            setActiveSnapPoint(0.6);
            // Could trigger a refresh of active shooters here
          }}
        />
      )}
      {/* LockerSelfieModal bound to this spot */}
      <LockerSelfieModal 
        isOpen={scanModalOpen}
        onClose={() => setScanModalOpen(false)}
        user={user}
        spotId={spot?.id}
        spotName={spot?.name}
      />
      {/* Lightbox Modal for Condition Report Media */}
      {lightboxUrl && (
        <div 
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <button 
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10"
            onClick={() => setLightboxUrl(null)}
          >
            <X className="w-8 h-8" />
          </button>
          <img loading="lazy" decoding="async" 
            src={lightboxUrl} 
            alt="Condition report" 
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
};

export default UnifiedSpotDrawer;
