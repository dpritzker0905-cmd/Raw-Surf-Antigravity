/**
 * DutyStationDrawer - Unified Photographer Duty Management
 * 
 * Features:
 * - Mode Selector (Live vs On-Demand) - mutually exclusive
 * - Role-based visibility (Hobbyists only see Live mode)
 * - GPS validation for Live mode (must be within 0.2 miles of spot)
 * - Multi-spot selection for On-Demand mode with role-based radius:
 *   - Regular Photographer: 10-20 miles
 *   - Approved Pro: up to 50 miles
 * - Deselection capability for both modes
 * - Warning messages for GPS issues and compliance
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { X, Navigation } from 'lucide-react';
import { Sheet, SheetContent } from './ui/sheet';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { GpsProximityCheck, OnDemandSpotSelector, StatusCard, ModeSelector, GpsWarningBanner, SelectedSpotDisplay, StatsPreview, QuickActions } from './on-demand/DutyStationComponents';
import apiClient from '../lib/apiClient';
import { SpotSelector } from './SpotSelector';
import { motion, AnimatePresence } from 'framer-motion';
import logger from '../utils/logger';
import ConditionsModal from './ConditionsModal';
import { ROLES } from '../constants/roles';
import useDutyStationActions from '../hooks/useDutyStationActions';

// Constants & geo utilities G extracted to on-demand/dutyStationConstants.js (v81)
import {
  LIVE_PROXIMITY_MILES,
  LIVE_PROXIMITY_METERS,
  ON_DEMAND_RADIUS,
  MODE_CONFIG,
  calculateDistance,
  metersToMiles,
} from './on-demand/dutyStationConstants';

// Re-export for backward compatibility (DutyStationComponents, DutyStationIcon, etc.)
export { LIVE_PROXIMITY_MILES, LIVE_PROXIMITY_METERS, MODE_CONFIG, calculateDistance, metersToMiles };

/**
 * DutyStationDrawer - Main exported component
 */
export const DutyStationDrawer = ({ isOpen, onClose }) => {
  const _navigate = useNavigate();
  const { user } = useAuth();
  const { getEffectiveRole } = usePersona();
  
  // State
  const [mode, setMode] = useState('live');
  const [liveActive, setLiveActive] = useState(false);
  const [onDemandActive, setOnDemandActive] = useState(false);
  const [selectedSpot, setSelectedSpot] = useState(null); // For Live mode
  const [selectedSpots, setSelectedSpots] = useState([]); // For On-Demand mode
  const [availableSpots, setAvailableSpots] = useState([]);
  const [spotsLoading, setSpotsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nearbyShooters, setNearbyShooters] = useState(0);
  const [userLocation, setUserLocation] = useState(null);
  const [gpsAvailable, setGpsAvailable] = useState(true);
  const [proximityConfirmed, setProximityConfirmed] = useState(false);
  const [stats, setStats] = useState({ todayEarnings: 0, sessionsToday: 0 });
  const [showConditionsModal, setShowConditionsModal] = useState(false);
  // Photographer pricing config - fetched on mount, included in go-live payload
  const [pricingConfig, setPricingConfig] = useState({
    price_per_join: 25,
    live_photo_price: 5,
    photos_included: 3,
    videos_included: 1,
    general_photo_price: 10,
    photo_price_web: 3,
    photo_price_standard: 5,
    photo_price_high: 10,
    estimated_duration: 2,
    max_surfers: 10,
    auto_accept: true,
    // Earnings destination (Hobbyist cause/grom)
    earnings_destination_type: null,
    earnings_destination_id: null,
    earnings_cause_name: null
  });
  
  // Role-based permissions
  const effectiveRole = getEffectiveRole(user?.role);
  const isHobbyist = effectiveRole === ROLES.HOBBYIST;
  const isApprovedPro = effectiveRole === ROLES.APPROVED_PRO;
  const showOnDemand = !isHobbyist;
  
  // Get radius based on tier
  const photographerTier = isApprovedPro ? 'pro' : 'standard';
  const radiusConfig = ON_DEMAND_RADIUS[photographerTier];
  
  // isActive tracks whether the CURRENTLY VIEWED mode is active
  const isActive = mode === 'live' ? liveActive : onDemandActive;
  // anyModeActive is true if EITHER mode is active (used to lock tab switching)
  const anyModeActive = liveActive || onDemandActive;
  
  // Determine if can activate
  const canActivateLive = selectedSpot && proximityConfirmed;
  const canActivateOnDemand = selectedSpots.length > 0;
  const canActivate = mode === 'live' ? canActivateLive : canActivateOnDemand;
  
  // Fetch user's GPS location
  useEffect(() => {
    if (isOpen && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
          setGpsAvailable(true);
        },
        (error) => {
          logger.error('GPS error:', error);
          setUserLocation(null);
          setGpsAvailable(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    }
  }, [isOpen]);
  
  // Fetch statuses + pricing on mount
  useEffect(() => {
    if (user?.id && isOpen) {
      fetchStatuses();
      fetchNearbyShooters();
      fetchPricingConfig();
    }
  }, [user?.id, isOpen]);

  // Fetch photographer pricing to include in go-live payload (mirrors PSM)
  const fetchPricingConfig = async () => {
    try {
      const [pricingRes, galleryRes] = await Promise.allSettled([
        apiClient.get(`/photographer/${user.id}/pricing`),
        apiClient.get(`/photographer/${user.id}/gallery-pricing`)
      ]);
      const p = pricingRes.status === 'fulfilled' ? pricingRes.value.data : {};
      const g = galleryRes.status === 'fulfilled' ? galleryRes.value.data : {};
      setPricingConfig(prev => ({
        ...prev,
        price_per_join: p.live_buyin_price ?? prev.price_per_join,
        live_photo_price: g.session_pricing?.live_session_photo_price ?? p.live_photo_price ?? prev.live_photo_price,
        photos_included: g.session_pricing?.live_session_photos_included ?? p.photo_package_size ?? prev.photos_included,
        videos_included: g.session_pricing?.live_session_videos_included ?? prev.videos_included,
        general_photo_price: g.photo_pricing?.standard ?? p.gallery_photo_price ?? prev.general_photo_price,
        photo_price_web: g.photo_pricing?.web ?? prev.photo_price_web,
        photo_price_standard: g.photo_pricing?.standard ?? prev.photo_price_standard,
        photo_price_high: g.photo_pricing?.high ?? prev.photo_price_high
      }));
    } catch (err) {
      logger.warn('[DutyStation] Could not fetch pricing - using defaults:', err.message);
    }
  };
  
  // Fetch spots when location becomes available (for On-Demand)
  useEffect(() => {
    if (userLocation && showOnDemand && isOpen) {
      fetchAvailableSpots();
    }
  }, [userLocation, showOnDemand, isOpen]);
  
  // Reset proximity confirmation when spot changes
  useEffect(() => {
    setProximityConfirmed(false);
  }, [selectedSpot?.id]);
  
  const {
    fetchStatuses,
    forceEndStaleSession,
    fetchAvailableSpots,
    fetchNearbyShooters,
    handleConditionsConfirm,
    handleActivateOnDemand,
    handleDeactivateLive,
    handleDeactivateOnDemand
  } = useDutyStationActions({
    user,
    userLocation,
    radiusConfig,
    showOnDemand,
    onDemandActive,
    selectedSpot,
    selectedSpots,
    pricingConfig,
    setLiveActive,
    setOnDemandActive,
    setSelectedSpot,
    setSelectedSpots,
    setAvailableSpots,
    setSpotsLoading,
    setLoading,
    setNearbyShooters,
    setProximityConfirmed,
    setStats,
    setShowConditionsModal,
    gpsAvailable,
    setGpsAvailable
  });
  
  const handleSelectSpot = useCallback((spot) => {
    setSelectedSpot(spot);
    setProximityConfirmed(false);
  }, []);
  
  const handleDeselectSpot = useCallback(() => {
    setSelectedSpot(null);
    setProximityConfirmed(false);
  }, []);
  
  const handleToggleOnDemandSpot = useCallback((spot) => {
    setSelectedSpots(prev => {
      const exists = prev.some(s => s.id === spot.id);
      if (exists) {
        return prev.filter(s => s.id !== spot.id);
      }
      return [...prev, spot];
    });
  }, []);
  
  const handleSelectAllSpots = useCallback(() => {
    if (selectedSpots.length === availableSpots.length) {
      setSelectedSpots([]);
    } else {
      setSelectedSpots([...availableSpots]);
    }
  }, [availableSpots, selectedSpots.length]);
  
  const handleDeselectAllSpots = useCallback(() => {
    setSelectedSpots([]);
  }, []);
  
  const handleManualConfirm = () => {
    setProximityConfirmed(true);
    toast.warning('Location manually confirmed. Remember: going live when not at the spot may result in negative reviews or account action.');
  };
  
  const handleActivateLive = async () => {
    if (!selectedSpot) {
      toast.error('Please select a spot first');
      return;
    }
    
    if (!proximityConfirmed) {
      toast.error('Please confirm you are at the spot location');
      return;
    }
    
    // Show conditions modal - actual go-live happens in handleConditionsConfirm
    setShowConditionsModal(true);
  };
  

  
  const handleActivate = mode === 'live' ? handleActivateLive : handleActivateOnDemand;
  const handleDeactivate = mode === 'live' ? handleDeactivateLive : handleDeactivateOnDemand;
  
  const config = MODE_CONFIG[mode];
  const Icon = config.icon;
  
  return (
    <Sheet open={isOpen} modal={false} onOpenChange={onClose}>
      <SheetContent 
        side="bottom"
        hideCloseButton
        className="bg-background/95 backdrop-blur-2xl border-t border-border rounded-t-3xl overflow-hidden flex flex-col p-0
          h-auto
          md:rounded-2xl md:border md:w-[600px] md:max-w-[90vw] md:max-h-[85vh] md:!bottom-4
          lg:w-[700px]"
        style={{
          bottom: 'var(--safe-bottom, 84px)',
          maxHeight: 'calc(100dvh - var(--safe-bottom, 84px) - 56px)',
        }}
      >
        {/* Drag Handle - hide on desktop */}
        <div className="flex justify-center pt-3 pb-2 md:pt-4 md:pb-3">
          <div className="w-12 h-1.5 rounded-full bg-muted-foreground/30 md:hidden" />
        </div>
        
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 pb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isActive ? config.colors.ring : 'bg-muted'}`}>
              <Icon className={`w-5 h-5 ${isActive ? config.colors.text : 'text-muted-foreground'}`} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground tracking-tight">Duty Station</h2>
              <p className="text-xs text-muted-foreground">
                {isActive 
                  ? `${mode === 'live' ? 'Live' : 'On-Demand'} - Active`
                  : 'Manage your availability'
                }
              </p>
            </div>
          </div>
          
          <button aria-label="Close"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            data-testid="duty-drawer-close"
          ><X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Scrollable Content */}
        <div 
          className="overflow-y-auto flex-1 px-4 sm:px-6 space-y-5 overscroll-contain"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 24px)' }}
        >
          {/* Mode Selector */}
          <ModeSelector 
            selectedMode={mode}
            onModeChange={setMode}
            showOnDemand={showOnDemand}
            isActive={isActive}
            liveActive={liveActive}
            onDemandActive={onDemandActive}
          />
          
          {/* Status Card */}
          <StatusCard
            mode={mode}
            isActive={isActive}
            selectedSpot={selectedSpot}
            selectedSpots={selectedSpots}
            onToggle={isActive ? handleDeactivate : handleActivate}
            loading={loading}
            canActivate={canActivate}
          />
          
          {/* Mode-specific content */}
          {!isActive && (
            <AnimatePresence mode="wait">
              {mode === 'live' ? (
                <motion.div
                  key="live-content"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  {/* Selected Spot Display with Deselect */}
                  {selectedSpot ? (
                    <SelectedSpotDisplay 
                      spot={selectedSpot} 
                      onDeselect={handleDeselectSpot} 
                    />
                  ) : (
                    /* Spot Selector for Live */
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Navigation className="w-4 h-4 text-cyan-400" />
                        <span className="text-sm font-medium text-foreground">Select Your Spot</span>
                        <Badge className="bg-blue-500/20 text-blue-400 border-0 text-xs ml-auto">
                          Within 0.2 mi
                        </Badge>
                      </div>
                      <SpotSelector
                        selectedSpot={selectedSpot}
                        onSelectSpot={handleSelectSpot}
                        photographerTier={photographerTier}
                        disabled={false}
                        compact={false}
                      />
                    </div>
                  )}
                  
                  {/* GPS Proximity Check for Live */}
                  {selectedSpot && (
                    <GpsProximityCheck
                      selectedSpot={selectedSpot}
                      userLocation={userLocation}
                      gpsAvailable={gpsAvailable}
                      onProximityConfirmed={setProximityConfirmed}
                      onManualConfirm={handleManualConfirm}
                    />
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="ondemand-content"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  {/* GPS Warning for On-Demand */}
                  {!gpsAvailable && (
                    <GpsWarningBanner onConfirmAnyway={() => setGpsAvailable(true)} />
                  )}
                  
                  {/* Multi-spot selector for On-Demand */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <OnDemandSpotSelector
                      spots={availableSpots}
                      selectedSpots={selectedSpots}
                      onToggleSpot={handleToggleOnDemandSpot}
                      onSelectAll={handleSelectAllSpots}
                      onDeselectAll={handleDeselectAllSpots}
                      loading={spotsLoading}
                      radiusInfo={radiusConfig}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
          
          {/* Stats Preview */}
          <StatsPreview mode={mode} stats={stats} />
          
          {/* Quick Actions */}
          <QuickActions mode={mode} onClose={onClose} nearbyShooters={nearbyShooters} />
        </div>
      </SheetContent>
      
      {/* Conditions Modal - Required before going live */}
      <ConditionsModal
        isOpen={showConditionsModal}
        onClose={() => setShowConditionsModal(false)}
        onConfirm={handleConditionsConfirm}
        spotName={selectedSpot?.name}
        isLoading={loading}
      />
    </Sheet>
  );
};

// DutyStationIcon extracted to ./on-demand/DutyStationIcon.js
export { default as DutyStationIcon } from './on-demand/DutyStationIcon';

export default DutyStationDrawer;
