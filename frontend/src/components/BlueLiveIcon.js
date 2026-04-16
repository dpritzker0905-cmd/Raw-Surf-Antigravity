import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Radio, ChevronRight, MapPin, Users, Settings, Loader2, Play } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import axios from 'axios';
import { SpotSelector } from './SpotSelector';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * BlueLiveIcon - Live Duty Access for Pro/Verified Photographers
 * 
 * Features:
 * - NO MAP REDIRECT: Searchable spot selection in-drawer
 * - Toggle DISABLED until spot is selected
 * - Mutual exclusion with On-Demand mode
 * - GPS status in header (fades when loaded)
 * - "Live at: [Spot Name]" display when active
 */

const LiveMenuContent = ({ 
  onClose, 
  navigate, 
  liveActive, 
  selectedSpot,
  onSelectSpot,
  showSpotSelector,
  setShowSpotSelector,
  onToggle, 
  onConfirmGoLive,
  nearbyShooters, 
  loading,
  photographerTier
}) => {
  // Toggle is DISABLED until a spot is selected
  const canToggle = liveActive || selectedSpot;

  return (
    <div className="space-y-3">
      {/* Go Live Status Toggle - Primary (Unified UI matching On-Demand Duty) */}
      <div className={`p-4 rounded-xl border-2 transition-all ${
        liveActive 
          ? 'bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border-blue-400/50' 
          : 'bg-zinc-800/50 border-zinc-700'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
              liveActive ? 'bg-blue-500/30' : 'bg-zinc-700'
            }`}>
              <Radio className={`w-5 h-5 ${liveActive ? 'text-blue-400 animate-pulse' : 'text-gray-400'}`} />
            </div>
            <div>
              <p className="text-white font-medium text-sm">Go Live</p>
              <p className={`text-xs ${liveActive ? 'text-blue-300' : 'text-gray-400'}`}>
                {liveActive ? 'Currently shooting' : selectedSpot ? 'Ready to go live' : 'Select spot to enable'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Settings shortcut arrow */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate('/photographer/sessions');
                onClose?.();
              }}
              className="p-1.5 rounded-lg hover:bg-zinc-700/50 text-gray-400 hover:text-blue-400 transition-colors"
              title="Live Settings"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {/* Toggle switch */}
            <button
              onClick={() => {
                if (liveActive) {
                  onToggle(); // End session
                } else if (selectedSpot) {
                  onConfirmGoLive(); // Go live with spot
                } else {
                  setShowSpotSelector(true); // Show spot selector
                }
              }}
              disabled={loading || (!canToggle && !liveActive)}
              className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${
                liveActive 
                  ? 'bg-blue-500' 
                  : canToggle 
                    ? 'bg-zinc-600' 
                    : 'bg-zinc-700 opacity-50 cursor-not-allowed'
              }`}
              data-testid="go-live-toggle"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin absolute top-1 left-1/2 -translate-x-1/2 text-white" />
              ) : (
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                  liveActive ? 'left-[calc(100%-22px)]' : 'left-0.5'
                }`} />
              )}
            </button>
          </div>
        </div>
        
        {/* SpotSelector - Shows when selecting or no spot selected */}
        {(showSpotSelector || (!liveActive && !selectedSpot)) && !liveActive && (
          <div className="mt-3 pt-3 border-t border-zinc-700">
            <SpotSelector
              selectedSpot={selectedSpot}
              onSelectSpot={(spot) => {
                onSelectSpot(spot);
                setShowSpotSelector(false);
              }}
              photographerTier={photographerTier}
              disabled={false}
              compact={false}
            />
            {/* Go Live button after spot selection */}
            {selectedSpot && (
              <button
                onClick={onConfirmGoLive}
                disabled={loading}
                className="w-full mt-3 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-medium text-sm flex items-center justify-center gap-2"
                data-testid="start-live-btn"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Go Live
              </button>
            )}
          </div>
        )}
        
        {/* Show selected spot when live is active */}
        {liveActive && selectedSpot && (
          <div className="mt-3 pt-3 border-t border-blue-500/30 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-green-400" />
            <span className="text-sm text-green-300">Live at: {typeof selectedSpot === 'object' ? selectedSpot.name : selectedSpot}</span>
          </div>
        )}
        
        {/* Change spot option when active */}
        {liveActive && (
          <button
            onClick={() => setShowSpotSelector(true)}
            className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
          >
            Change spot
          </button>
        )}
      </div>

      {/* Other Shooters Nearby */}
      <button
        onClick={() => {
          navigate('/map?view=photographers');
          onClose?.();
        }}
        className="w-full flex items-center gap-3 p-3 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl transition-colors"
        data-testid="live-nearby-shooters"
      >
        <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
          <Users className="w-5 h-5 text-cyan-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-white font-medium text-sm">Other Shooters Nearby</p>
          <p className="text-gray-400 text-xs">See who's live in your area</p>
        </div>
        {nearbyShooters > 0 && (
          <Badge className="bg-cyan-500/20 text-cyan-400 border-0">
            {nearbyShooters}
          </Badge>
        )}
        <ChevronRight className="w-4 h-4 text-gray-500" />
      </button>

      {/* Live Session Settings */}
      <button
        onClick={() => {
          navigate('/photographer/sessions');
          onClose?.();
        }}
        className="w-full flex items-center gap-3 p-3 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl transition-colors"
        data-testid="live-settings"
      >
        <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
          <Settings className="w-5 h-5 text-purple-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-white font-medium text-sm">Live Session Settings</p>
          <p className="text-gray-400 text-xs">Pricing, preferences</p>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-500" />
      </button>
    </div>
  );
};

// Mobile Sheet Version
const MobileLiveMenu = ({ 
  children, 
  liveActive,
  selectedSpot,
  onSelectSpot,
  showSpotSelector,
  setShowSpotSelector, 
  onToggle,
  onConfirmGoLive, 
  nearbyShooters, 
  loading,
  photographerTier,
  gpsStatus,
  spotsLoaded
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {children}
      </SheetTrigger>
      <SheetContent 
        side="bottom" 
        className="bg-zinc-900 border-zinc-700 rounded-t-3xl h-auto max-h-[85vh] overflow-hidden flex flex-col"
      >
        <SheetHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-white flex items-center gap-2 text-base">
              <Radio className={`w-5 h-5 ${liveActive ? 'text-blue-400 animate-pulse' : 'text-gray-400'}`} />
              Live Duty
              {liveActive && (
                <Badge className="bg-blue-500/20 text-blue-400 text-xs">Active</Badge>
              )}
            </SheetTitle>
            {/* GPS Status - Header aligned right, fades when loaded */}
            {gpsStatus && !spotsLoaded && (
              <div className="flex items-center gap-1.5 text-xs text-cyan-400 animate-pulse">
                <span>🛰️</span>
                <span>{gpsStatus}</span>
              </div>
            )}
          </div>
        </SheetHeader>
        <div className="overflow-y-auto flex-1 pb-8 -mx-6 px-6 overscroll-contain touch-pan-y">
          <LiveMenuContent
            onClose={() => setOpen(false)}
            navigate={navigate}
            liveActive={liveActive}
            selectedSpot={selectedSpot}
            onSelectSpot={onSelectSpot}
            showSpotSelector={showSpotSelector}
            setShowSpotSelector={setShowSpotSelector}
            onToggle={onToggle}
            onConfirmGoLive={onConfirmGoLive}
            nearbyShooters={nearbyShooters}
            loading={loading}
            photographerTier={photographerTier}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};

// Desktop Popover Version
const DesktopLiveMenu = ({ 
  children, 
  liveActive,
  selectedSpot,
  onSelectSpot,
  showSpotSelector,
  setShowSpotSelector, 
  onToggle,
  onConfirmGoLive, 
  nearbyShooters, 
  loading,
  photographerTier,
  gpsStatus,
  spotsLoaded
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent 
        className="w-96 bg-zinc-900 border-zinc-700 p-3 max-h-[85vh] md:max-h-[70vh] overflow-y-auto"
        align="end"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-medium flex items-center gap-2 text-sm">
            <Radio className={`w-4 h-4 ${liveActive ? 'text-blue-400' : 'text-gray-400'}`} />
            Live Duty
            {liveActive && (
              <Badge className="bg-blue-500/20 text-blue-400 text-xs">Active</Badge>
            )}
          </h3>
          {/* GPS Status - Header aligned right, fades when loaded */}
          {gpsStatus && !spotsLoaded && (
            <div className="flex items-center gap-1.5 text-xs text-cyan-400 animate-pulse">
              <span>🛰️</span>
              <span>{gpsStatus}</span>
            </div>
          )}
        </div>
        <LiveMenuContent
          onClose={() => setOpen(false)}
          navigate={navigate}
          liveActive={liveActive}
          selectedSpot={selectedSpot}
          onSelectSpot={onSelectSpot}
          showSpotSelector={showSpotSelector}
          setShowSpotSelector={setShowSpotSelector}
          onToggle={onToggle}
          onConfirmGoLive={onConfirmGoLive}
          nearbyShooters={nearbyShooters}
          loading={loading}
          photographerTier={photographerTier}
        />
      </PopoverContent>
    </Popover>
  );
};

// Main Export
export const BlueLiveIcon = () => {
  const { user } = useAuth();
  const [liveActive, setLiveActive] = useState(false);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [showSpotSelector, setShowSpotSelector] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nearbyShooters, setNearbyShooters] = useState(0);
  const [onDemandActive, setOnDemandActive] = useState(false);
  
  // GPS status for header
  const [gpsStatus, setGpsStatus] = useState(null);
  const [spotsLoaded, setSpotsLoaded] = useState(false);
  
  // Photographer tier for radius filtering
  const photographerTier = user?.role === 'Approved Pro' || user?.is_approved_pro 
    ? 'pro' 
    : user?.role === 'Pro' 
      ? 'pro' 
      : 'standard';

  // Fetch initial statuses
  useEffect(() => {
    if (user?.id) {
      fetchLiveStatus();
      fetchOnDemandStatus();
      fetchNearbyShooters();
      initGpsTracking();
    }
  }, [user?.id]);

  // GPS tracking for header status
  const initGpsTracking = () => {
    if (navigator.geolocation) {
      setGpsStatus('Getting location...');
      navigator.geolocation.getCurrentPosition(
        () => {
          setGpsStatus(null);
          setSpotsLoaded(true);
        },
        () => {
          setGpsStatus('Location unavailable');
          setTimeout(() => setGpsStatus(null), 3000);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  };

  const fetchLiveStatus = async () => {
    try {
      const response = await axios.get(`${API}/photographer/${user.id}/status`);
      const data = response.data;
      setLiveActive(data?.is_shooting || false);
      
      if (data?.current_spot_name || data?.current_spot_id) {
        setSelectedSpot({
          id: data.current_spot_id,
          name: data.current_spot_name
        });
      }
    } catch (error) {
      logger.error('Failed to fetch live status:', error);
    }
  };

  const fetchOnDemandStatus = async () => {
    try {
      const response = await axios.get(`${API}/photographer/${user.id}/on-demand-status`);
      setOnDemandActive(response.data?.is_available || false);
    } catch (error) {
      logger.error('Failed to fetch on-demand status:', error);
    }
  };

  const fetchNearbyShooters = async () => {
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
          const response = await axios.get(`${API}/photographers/live`, {
            params: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              radius: 25
            }
          });
          const others = (response.data || []).filter(p => p.id !== user?.id);
          setNearbyShooters(others.length);
        });
      }
    } catch (error) {
      logger.error('Failed to fetch nearby shooters:', error);
    }
  };

  const handleSelectSpot = useCallback((spot) => {
    setSelectedSpot(spot);
  }, []);

  const handleEndSession = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/photographer/${user.id}/end-session`);
      setLiveActive(false);
      setSelectedSpot(null);
      toast.success('Live session ended');
    } catch (error) {
      toast.error('Failed to end session');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmGoLive = async () => {
    if (!selectedSpot) {
      toast.error('Please select a spot first');
      return;
    }

    setLoading(true);
    try {
      // MUTUAL EXCLUSION: Turn off On-Demand if active
      if (onDemandActive) {
        await axios.post(`${API}/photographer/${user.id}/on-demand-toggle`, {
          is_available: false
        });
        setOnDemandActive(false);
        toast.info('Switching to Live mode. On-Demand disabled.');
      }

      await axios.post(`${API}/photographer/${user.id}/go-live`, {
        spot_id: selectedSpot.id,
        spot_name: selectedSpot.name,
        latitude: selectedSpot.latitude,
        longitude: selectedSpot.longitude
      });
      setLiveActive(true);
      setShowSpotSelector(false);
      toast.success(`Now live at ${selectedSpot.name}!`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to go live');
    } finally {
      setLoading(false);
    }
  };

  const commonProps = {
    liveActive,
    selectedSpot,
    onSelectSpot: handleSelectSpot,
    showSpotSelector,
    setShowSpotSelector,
    onToggle: handleEndSession,
    onConfirmGoLive: handleConfirmGoLive,
    nearbyShooters,
    loading,
    photographerTier,
    gpsStatus,
    spotsLoaded
  };

  const iconButton = (
    <button 
      className={`relative p-1 transition-colors ${
        liveActive ? 'text-blue-400 hover:text-blue-300' : 'text-gray-400 hover:text-white'
      }`}
      data-testid="topnav-live"
      aria-label="Live Duty"
    >
      {/* Breathing ring indicator when live */}
      {liveActive && (
        <span 
          className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping" 
          style={{ animationDuration: '2s' }} 
        />
      )}
      <Radio className="w-5 h-5 relative z-10" />
    </button>
  );

  return (
    <>
      {/* Mobile */}
      <div className="md:hidden">
        <MobileLiveMenu {...commonProps}>
          {iconButton}
        </MobileLiveMenu>
      </div>
      
      {/* Desktop */}
      <div className="hidden md:block">
        <DesktopLiveMenu {...commonProps}>
          {iconButton}
        </DesktopLiveMenu>
      </div>
    </>
  );
};

export default BlueLiveIcon;
