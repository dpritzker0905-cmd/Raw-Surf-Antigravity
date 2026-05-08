import React, { useState, useRef, useEffect, useCallback } from 'react';

import { useNavigate } from 'react-router-dom';

import { MapPin, Camera, Users, Waves, AlertTriangle, Check, ArrowLeft, Loader2, ChevronDown, CheckCircle, X } from 'lucide-react';

import { Button } from './ui/button';



import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';

import { Drawer, DrawerContent } from './ui/drawer';



import { Badge } from './ui/badge';

import { useAuth } from '../contexts/AuthContext';


import { useTheme } from '../contexts/ThemeContext';

import { getThemeTokens } from '../utils/themeTokens';

import { JumpInSessionModal } from './JumpInSessionModal';

import { LockerSelfieModal } from './LockerSelfieModal';


import apiClient from '../lib/apiClient';

import { toast } from 'sonner';

import logger from '../utils/logger';




// Extracted sub-components
import { DRAWER_MODE } from './spot-drawer/SpotDrawerHelpers';
import { PhotographerProfileContent } from './spot-drawer/PhotographerProfileContent';
import SpotReportContent from './spot-drawer/SpotReportContent';
import SpotSetupPanel from './spot-drawer/SpotSetupPanel';

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
                  <SpotReportContent
                    spot={spot}
                    user={user}
                    isPhotographer={isPhotographer}
                    isWithinGeofence={isWithinGeofence}
                    activeShooters={activeShooters}
                    spotOfTheDay={spotOfTheDay}
                    userLocation={userLocation}
                    distanceMiles={distanceMiles}
                    visibilityRadius={visibilityRadius}
                    drawerTab={drawerTab}
                    setDrawerTab={setDrawerTab}
                    conditionReports={conditionReports}
                    proPhotos={proPhotos}
                    communityPhotos={communityPhotos}
                    handleJumpInClick={handleJumpInClick}
                    setScanModalOpen={setScanModalOpen}
                    setLightboxUrl={setLightboxUrl}
                    onClose={onClose}
                    textPrimary={textPrimary}
                    textSecondary={textSecondary}
                    cardBg={cardBg}
                    headerBorder={headerBorder}
                    isLight={isLight}
                    isBeach={isBeach}
                  />
                )}

                {drawerMode === DRAWER_MODE.SETUP && (
                  <SpotSetupPanel
                    spot={spot}
                    sessionSettings={sessionSettings}
                    setSessionSettings={setSessionSettings}
                    goLiveLoading={goLiveLoading}
                    onConfirmGoLive={handleConfirmGoLive}
                  />
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
