import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Zap, Settings, MapPin, Users, ChevronRight, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import axios from 'axios';
import { SpotSelector } from './SpotSelector';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * OnDemandDutyIcon - On-Demand Duty Access for Photographers (Lightning Bolt)
 * 
 * Features:
 * - Searchable spot selection with radius filtering
 * - Toggle DISABLED until spot is selected
 * - Mutual exclusion with Live mode
 * - GPS status in header (fades when loaded)
 * - "Active at: [Spot Name]" display
 */

const OnDemandMenuContent = ({ 
  onClose, 
  navigate, 
  onDemandActive, 
  selectedSpot,
  onSelectSpot,
  showSpotSelector,
  setShowSpotSelector,
  onToggle, 
  onConfirmActivate,
  nearbyShooters, 
  loading,
  photographerTier
}) => {
  // Toggle is DISABLED until a spot is selected
  const canToggle = onDemandActive || selectedSpot;

  return (
    <div className="space-y-3">
      {/* On-Demand Status Toggle - Primary (Unified UI matching Active Duty) */}
      <div className={`p-4 rounded-xl border-2 transition-all ${
        onDemandActive 
          ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-400/50' 
          : 'bg-zinc-800/50 border-zinc-700'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
              onDemandActive ? 'bg-yellow-500/30' : 'bg-zinc-700'
            }`}>
              <Zap className={`w-5 h-5 ${onDemandActive ? 'text-yellow-400' : 'text-gray-400'}`} />
            </div>
            <div>
              <p className="text-white font-medium text-sm">Go On-Demand</p>
              <p className={`text-xs ${onDemandActive ? 'text-yellow-300' : 'text-gray-400'}`}>
                {onDemandActive ? 'Accepting requests' : selectedSpot ? 'Ready to activate' : 'Select spot to enable'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Settings shortcut arrow */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate('/photographer/on-demand-settings');
                onClose?.();
              }}
              className="p-1.5 rounded-lg hover:bg-zinc-700/50 text-gray-400 hover:text-yellow-400 transition-colors"
              title="On-Demand Settings"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {/* Toggle switch */}
            <button
              onClick={() => {
                if (onDemandActive) {
                  onToggle(); // Turn off
                } else if (selectedSpot) {
                  onConfirmActivate(); // Activate with spot
                } else {
                  setShowSpotSelector(true); // Show spot selector
                }
              }}
              disabled={loading || (!canToggle && !onDemandActive)}
              className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${
                onDemandActive 
                  ? 'bg-yellow-500' 
                  : canToggle 
                    ? 'bg-zinc-600' 
                    : 'bg-zinc-700 opacity-50 cursor-not-allowed'
              }`}
              data-testid="on-demand-toggle"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin absolute top-1 left-1/2 -translate-x-1/2 text-white" />
              ) : (
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                  onDemandActive ? 'left-[calc(100%-22px)]' : 'left-0.5'
                }`} />
              )}
            </button>
          </div>
        </div>
        
        {/* SpotSelector - Shows when selecting or no spot selected */}
        {(showSpotSelector || (!onDemandActive && !selectedSpot)) && !onDemandActive && (
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
            {/* Activate button after spot selection */}
            {selectedSpot && (
              <button
                onClick={onConfirmActivate}
                disabled={loading}
                className="w-full mt-3 py-2.5 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-black font-medium text-sm flex items-center justify-center gap-2"
                data-testid="activate-on-demand-btn"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Activate On-Demand
              </button>
            )}
          </div>
        )}
        
        {/* Show selected spot when on-demand is active */}
        {onDemandActive && selectedSpot && (
          <div className="mt-3 pt-3 border-t border-yellow-500/30 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-green-400" />
            <span className="text-sm text-green-300">Active at: {typeof selectedSpot === 'object' ? selectedSpot.name : selectedSpot}</span>
          </div>
        )}
        
        {/* Change spot option when active */}
        {onDemandActive && (
          <button
            onClick={() => setShowSpotSelector(true)}
            className="mt-2 text-xs text-yellow-400 hover:text-yellow-300 underline"
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
        data-testid="on-demand-nearby-shooters"
      >
        <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
          <Users className="w-5 h-5 text-cyan-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-white font-medium text-sm">Other Shooters Nearby</p>
          <p className="text-gray-400 text-xs">See who's active in your area</p>
        </div>
        {nearbyShooters > 0 && (
          <Badge className="bg-cyan-500/20 text-cyan-400 border-0">
            {nearbyShooters}
          </Badge>
        )}
        <ChevronRight className="w-4 h-4 text-gray-500" />
      </button>

      {/* On-Demand Settings */}
      <button
        onClick={() => {
          navigate('/photographer/on-demand-settings');
          onClose?.();
        }}
        className="w-full flex items-center gap-3 p-3 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl transition-colors"
        data-testid="on-demand-settings"
      >
        <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
          <Settings className="w-5 h-5 text-purple-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-white font-medium text-sm">On-Demand Settings</p>
          <p className="text-gray-400 text-xs">Pricing, radius, preferences</p>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-500" />
      </button>
    </div>
  );
};

// Mobile Sheet Version
const MobileOnDemandMenu = ({ 
  children, 
  onDemandActive,
  selectedSpot,
  onSelectSpot,
  showSpotSelector,
  setShowSpotSelector, 
  onToggle,
  onConfirmActivate, 
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
              <Zap className={`w-5 h-5 ${onDemandActive ? 'text-yellow-400 animate-pulse' : 'text-gray-400'}`} />
              On-Demand Duty
              {onDemandActive && (
                <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">Active</Badge>
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
          <OnDemandMenuContent
            onClose={() => setOpen(false)}
            navigate={navigate}
            onDemandActive={onDemandActive}
            selectedSpot={selectedSpot}
            onSelectSpot={onSelectSpot}
            showSpotSelector={showSpotSelector}
            setShowSpotSelector={setShowSpotSelector}
            onToggle={onToggle}
            onConfirmActivate={onConfirmActivate}
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
const DesktopOnDemandMenu = ({ 
  children, 
  onDemandActive,
  selectedSpot,
  onSelectSpot,
  showSpotSelector,
  setShowSpotSelector, 
  onToggle,
  onConfirmActivate, 
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
            <Zap className={`w-4 h-4 ${onDemandActive ? 'text-yellow-400' : 'text-gray-400'}`} />
            On-Demand Duty
            {onDemandActive && (
              <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">Active</Badge>
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
        <OnDemandMenuContent
          onClose={() => setOpen(false)}
          navigate={navigate}
          onDemandActive={onDemandActive}
          selectedSpot={selectedSpot}
          onSelectSpot={onSelectSpot}
          showSpotSelector={showSpotSelector}
          setShowSpotSelector={setShowSpotSelector}
          onToggle={onToggle}
          onConfirmActivate={onConfirmActivate}
          nearbyShooters={nearbyShooters}
          loading={loading}
          photographerTier={photographerTier}
        />
      </PopoverContent>
    </Popover>
  );
};

// Main Export
export const OnDemandDutyIcon = () => {
  const { user } = useAuth();
  const [onDemandActive, setOnDemandActive] = useState(false);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [showSpotSelector, setShowSpotSelector] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nearbyShooters, setNearbyShooters] = useState(0);
  const [liveActive, setLiveActive] = useState(false);
  
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
      fetchOnDemandStatus();
      fetchLiveStatus();
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

  const fetchOnDemandStatus = async () => {
    try {
      const response = await axios.get(`${API}/photographer/${user.id}/on-demand-status`);
      const data = response.data;
      setOnDemandActive(data?.is_available || false);
      
      if (data?.spot_name || data?.spot_id) {
        setSelectedSpot({
          id: data.spot_id,
          name: data.spot_name || data.city,
          latitude: data.latitude,
          longitude: data.longitude
        });
      }
    } catch (error) {
      logger.error('Failed to fetch on-demand status:', error);
    }
  };

  const fetchLiveStatus = async () => {
    try {
      const response = await axios.get(`${API}/photographer/${user.id}/status`);
      setLiveActive(response.data?.is_shooting || false);
    } catch (error) {
      logger.error('Failed to fetch live status:', error);
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

  const handleToggleOff = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/photographer/${user.id}/on-demand-toggle`, {
        is_available: false
      });
      setOnDemandActive(false);
      setSelectedSpot(null);
      toast.success('On-Demand mode deactivated');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmActivate = async () => {
    if (!selectedSpot) {
      toast.error('Please select a spot first');
      return;
    }

    setLoading(true);
    try {
      // MUTUAL EXCLUSION: Turn off Live if active
      if (liveActive) {
        await axios.post(`${API}/photographer/${user.id}/end-session`);
        setLiveActive(false);
        toast.info('Switching to On-Demand mode. Live session ended.');
      }

      await axios.post(`${API}/photographer/${user.id}/on-demand-toggle`, {
        is_available: true,
        spot_id: selectedSpot.id,
        spot_name: selectedSpot.name,
        latitude: selectedSpot.latitude,
        longitude: selectedSpot.longitude
      });
      setOnDemandActive(true);
      setShowSpotSelector(false);
      toast.success(`On-Demand activated at ${selectedSpot.name}!`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to activate On-Demand');
    } finally {
      setLoading(false);
    }
  };

  const commonProps = {
    onDemandActive,
    selectedSpot,
    onSelectSpot: handleSelectSpot,
    showSpotSelector,
    setShowSpotSelector,
    onToggle: handleToggleOff,
    onConfirmActivate: handleConfirmActivate,
    nearbyShooters,
    loading,
    photographerTier,
    gpsStatus,
    spotsLoaded
  };

  const iconButton = (
    <button 
      className={`relative p-1 transition-colors ${
        onDemandActive ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-400 hover:text-white'
      }`}
      data-testid="topnav-on-demand"
      aria-label="On-Demand Duty"
    >
      {/* Breathing ring indicator when active */}
      {onDemandActive && (
        <span 
          className="absolute inset-0 rounded-full bg-yellow-500/20 animate-ping" 
          style={{ animationDuration: '2s' }} 
        />
      )}
      <Zap className="w-5 h-5 relative z-10" />
    </button>
  );

  return (
    <>
      {/* Mobile */}
      <div className="md:hidden">
        <MobileOnDemandMenu {...commonProps}>
          {iconButton}
        </MobileOnDemandMenu>
      </div>
      
      {/* Desktop */}
      <div className="hidden md:block">
        <DesktopOnDemandMenu {...commonProps}>
          {iconButton}
        </DesktopOnDemandMenu>
      </div>
    </>
  );
};

export default OnDemandDutyIcon;
