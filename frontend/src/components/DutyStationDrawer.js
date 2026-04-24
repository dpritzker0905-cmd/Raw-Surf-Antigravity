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
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { 
  Radio, Zap, MapPin, Users, Settings, ChevronRight, 
  Loader2, X, Navigation, AlertTriangle, CheckCircle2,
  MapPinOff, Check, XCircle, Shield
} from 'lucide-react';
import { Sheet, SheetContent } from './ui/sheet';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { toast } from 'sonner';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { SpotSelector } from './SpotSelector';
import { motion, AnimatePresence } from 'framer-motion';
import logger from '../utils/logger';
import ConditionsModal from './ConditionsModal';
import { ROLES } from '../constants/roles';


// Distance constants
const LIVE_PROXIMITY_MILES = 0.2; // Must be within 0.2 miles to go live
const LIVE_PROXIMITY_METERS = LIVE_PROXIMITY_MILES * 1609.34;

// On-Demand radius by role (in miles)
const ON_DEMAND_RADIUS = {
  standard: { min: 10, max: 20 },  // Regular Photographer
  pro: { min: 10, max: 50 }        // Approved Pro
};

// Mode configurations with theming
const MODE_CONFIG = {
  live: {
    id: 'live',
    label: 'Live',
    icon: Radio,
    description: 'Actively shooting at a spot',
    activeText: 'Currently shooting',
    inactiveText: 'Ready to go live',
    colors: {
      primary: 'bg-blue-500',
      primaryHover: 'hover:bg-blue-400',
      text: 'text-blue-400',
      textLight: 'text-blue-300',
      border: 'border-blue-500/50',
      glow: 'shadow-[0_0_20px_rgba(59,130,246,0.4)]',
      gradient: 'from-blue-500/20 to-cyan-500/20',
      ring: 'bg-blue-500/20'
    }
  },
  onDemand: {
    id: 'onDemand',
    label: 'On-Demand',
    icon: Zap,
    description: 'Available for requests nearby',
    activeText: 'Accepting requests',
    inactiveText: 'Ready to activate',
    colors: {
      primary: 'bg-amber-500',
      primaryHover: 'hover:bg-amber-400',
      text: 'text-amber-400',
      textLight: 'text-amber-300',
      border: 'border-amber-500/50',
      glow: 'shadow-[0_0_20px_rgba(245,158,11,0.4)]',
      gradient: 'from-amber-500/20 to-orange-500/20',
      ring: 'bg-amber-500/20'
    }
  }
};

/**
 * Calculate distance between two coordinates in meters (Haversine formula)
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

const metersToMiles = (meters) => meters / 1609.34;

/**
 * Mode Selector - Segmented control for switching between Live and On-Demand
 */
const ModeSelector = ({ selectedMode, onModeChange, showOnDemand, isActive }) => {
  const modes = showOnDemand ? ['live', 'onDemand'] : ['live'];
  
  if (!showOnDemand) return null;
  
  return (
    <div 
      className="p-1 bg-muted/80 rounded-full flex gap-1 border border-border"
      data-testid="mode-selector"
    >
      {modes.map((modeId) => {
        const mode = MODE_CONFIG[modeId];
        const Icon = mode.icon;
        const isSelected = selectedMode === modeId;
        
        return (
          <button
            key={modeId}
            onClick={() => !isActive && onModeChange(modeId)}
            disabled={isActive}
            className={`
              relative flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-full
              font-medium text-sm transition-all duration-200
              ${isActive ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
              ${isSelected ? 'text-white' : 'text-muted-foreground hover:text-foreground'}
            `}
            data-testid={`mode-${modeId}-button`}
          >
            {isSelected && (
              <motion.div
                layoutId="modeBackground"
                className={`absolute inset-0 rounded-full ${mode.colors.primary} ${mode.colors.glow}`}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              />
            )}
            <Icon className="w-4 h-4 relative z-10" />
            <span className="relative z-10">{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
};

/**
 * GPS Warning Banner - Shows when GPS is unavailable
 */
const GpsWarningBanner = ({ onConfirmAnyway }) => {
  const [confirmed, setConfirmed] = useState(false);
  
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="p-4 rounded-xl bg-red-500/10 border-2 border-red-500/50"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-red-300 font-semibold">GPS Location Required</p>
          <p className="text-red-400/80 text-sm mt-1">
            Your GPS is unavailable or inaccurate. Activating without accurate location 
            may result in:
          </p>
          <ul className="text-red-400/70 text-xs mt-2 space-y-1 list-disc list-inside">
            <li>Negative customer reviews</li>
            <li>Selling suspension</li>
            <li>Account action or termination</li>
          </ul>
          
          <div className="mt-4 flex items-start gap-2">
            <Checkbox 
              id="gps-warning-confirm"
              checked={confirmed}
              onCheckedChange={setConfirmed}
              className="mt-0.5 border-red-500/50"
            />
            <label htmlFor="gps-warning-confirm" className="text-xs text-red-300 cursor-pointer">
              I understand the risks and confirm I am at the correct location
            </label>
          </div>
          
          {confirmed && (
            <Button
              onClick={onConfirmAnyway}
              size="sm"
              className="mt-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/50"
            >
              <Shield className="w-4 h-4 mr-2" />
              Proceed Anyway
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

/**
 * GPS Proximity Check Component for Live Mode
 */
const GpsProximityCheck = ({ 
  selectedSpot, 
  userLocation, 
  gpsAvailable,
  onProximityConfirmed,
  onManualConfirm
}) => {
  const distance = userLocation && selectedSpot?.latitude 
    ? calculateDistance(userLocation.lat, userLocation.lng, selectedSpot.latitude, selectedSpot.longitude)
    : null;
  
  const isWithinRange = distance !== null && distance <= LIVE_PROXIMITY_METERS;
  const distanceMiles = distance ? metersToMiles(distance).toFixed(2) : null;
  
  useEffect(() => {
    if (isWithinRange) {
      onProximityConfirmed(true);
    }
  }, [isWithinRange, onProximityConfirmed]);
  
  if (!selectedSpot) return null;
  
  // GPS not available
  if (!gpsAvailable) {
    return <GpsWarningBanner onConfirmAnyway={onManualConfirm} />;
  }
  
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="space-y-3"
    >
      <div className={`
        p-4 rounded-xl border-2 
        ${isWithinRange 
          ? 'bg-emerald-500/10 border-emerald-500/50' 
          : distance !== null 
            ? 'bg-amber-500/10 border-amber-500/50'
            : 'bg-muted/50 border-border'
        }
      `}>
        <div className="flex items-start gap-3">
          {isWithinRange ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
          ) : distance !== null ? (
            <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
          ) : (
            <Navigation className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0 animate-pulse" />
          )}
          
          <div className="flex-1">
            {isWithinRange ? (
              <>
                <p className="text-emerald-300 font-medium">You're at the spot!</p>
                <p className="text-emerald-400/70 text-sm">
                  GPS confirmed: {distanceMiles} miles from {selectedSpot.name}
                </p>
              </>
            ) : distance !== null ? (
              <>
                <p className="text-amber-300 font-medium">Not at the spot yet</p>
                <p className="text-amber-400/70 text-sm">
                  You're {distanceMiles} miles away (need to be within {LIVE_PROXIMITY_MILES} miles)
                </p>
              </>
            ) : (
              <>
                <p className="text-foreground font-medium">Checking GPS location...</p>
                <p className="text-muted-foreground text-sm">Please allow location access</p>
              </>
            )}
          </div>
        </div>
      </div>
      
      {/* Manual Confirmation Option (when GPS says not at spot) */}
      {distance !== null && !isWithinRange && (
        <div className="p-4 rounded-xl bg-card border border-border">
          <div className="flex items-start gap-3">
            <MapPinOff className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-foreground font-medium text-sm">GPS not accurate?</p>
              <p className="text-muted-foreground text-xs mt-1">
                If you're physically at {selectedSpot.name} but GPS shows otherwise, 
                you can manually confirm.
              </p>
              <p className="text-red-400 text-xs mt-2 font-medium">
                ⚠️ Warning: Going live when not at the spot may result in negative reviews, 
                selling suspension, or account action.
              </p>
              <Button
                onClick={onManualConfirm}
                variant="outline"
                size="sm"
                className="mt-3 border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                data-testid="manual-confirm-location"
              >
                <Check className="w-4 h-4 mr-2" />
                I confirm I'm at this spot
              </Button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

/**
 * Selected Spot Display with Deselect for Live Mode
 */
const SelectedSpotDisplay = ({ spot, onDeselect }) => {
  if (!spot) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-between"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
          <MapPin className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <p className="text-foreground font-medium text-sm">{spot.name}</p>
          <p className="text-blue-400/70 text-xs">{spot.region || 'Selected for Live'}</p>
        </div>
      </div>
      <button
        onClick={onDeselect}
        className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
        data-testid="deselect-live-spot"
        aria-label="Deselect spot"
      >
        <XCircle className="w-5 h-5" />
      </button>
    </motion.div>
  );
};

/**
 * Multi-Spot Selector for On-Demand Mode
 */
const OnDemandSpotSelector = ({ 
  spots, 
  selectedSpots, 
  onToggleSpot, 
  onSelectAll,
  onDeselectAll,
  loading,
  radiusInfo
}) => {
  const allSelected = spots.length > 0 && selectedSpots.length === spots.length;
  
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-medium text-foreground">Select Coverage Areas</span>
        </div>
        <div className="flex items-center gap-2">
          {selectedSpots.length > 0 && (
            <button
              onClick={onDeselectAll}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
              data-testid="deselect-all-spots"
            >
              Clear All
            </button>
          )}
          <button
            onClick={onSelectAll}
            className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
            data-testid="select-all-spots"
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
        </div>
      </div>
      
      {/* Radius info badge */}
      {radiusInfo && (
        <div className="flex items-center gap-2">
          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
            {radiusInfo.max} mile radius
          </Badge>
          <span className="text-muted-foreground text-xs">based on your tier</span>
        </div>
      )}
      
      <p className="text-xs text-muted-foreground">
        Choose which spots you want to be available for on-demand requests
      </p>
      
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
        </div>
      ) : spots.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <MapPinOff className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No spots within your service range</p>
          <p className="text-xs mt-1">Enable GPS to find nearby spots</p>
        </div>
      ) : (
        <div className="max-h-[250px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
          {spots.map((spot) => {
            const isSelected = selectedSpots.some(s => s.id === spot.id);
            return (
              <motion.div
                key={spot.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`
                  flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all
                  ${isSelected 
                    ? 'bg-amber-500/20 border border-amber-500/50' 
                    : 'bg-muted/50 border border-border hover:bg-muted'
                  }
                `}
                onClick={() => onToggleSpot(spot)}
                data-testid={`spot-checkbox-${spot.id}`}
              >
                <Checkbox 
                  checked={isSelected}
                  className={isSelected ? 'border-amber-500 bg-amber-500' : 'border-muted-foreground'}
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isSelected ? 'text-amber-300' : 'text-foreground'}`}>
                    {spot.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {spot.region || spot.city || 'Unknown region'}
                    {spot.distance && ` • ${spot.distance.toFixed(1)} mi`}
                  </p>
                </div>
                {isSelected && (
                  <CheckCircle2 className="w-5 h-5 text-amber-400 flex-shrink-0" />
                )}
              </motion.div>
            );
          })}
        </div>
      )}
      
      {selectedSpots.length > 0 && (
        <div className="pt-2 border-t border-border">
          <p className="text-sm text-amber-400">
            {selectedSpots.length} spot{selectedSpots.length !== 1 ? 's' : ''} selected
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Status Card - Shows current duty status with toggle
 */
const StatusCard = ({ 
  mode, 
  isActive, 
  selectedSpot,
  selectedSpots,
  onToggle, 
  loading,
  canActivate
}) => {
  const config = MODE_CONFIG[mode];
  const Icon = config.icon;
  const spotCount = mode === 'onDemand' ? selectedSpots?.length : (selectedSpot ? 1 : 0);
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`
        p-5 rounded-2xl border-2 transition-all duration-300
        ${isActive 
          ? `bg-gradient-to-br ${config.colors.gradient} ${config.colors.border} ${config.colors.glow}` 
          : 'bg-card border-border'
        }
      `}
      data-testid="status-card"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`
            relative w-14 h-14 rounded-2xl flex items-center justify-center
            ${isActive ? config.colors.ring : 'bg-muted'}
          `}>
            {isActive && (
              <span 
                className={`absolute inset-0 rounded-2xl ${config.colors.ring} animate-ping`}
                style={{ animationDuration: '2s' }}
              />
            )}
            <Icon className={`w-7 h-7 relative z-10 ${isActive ? config.colors.text : 'text-muted-foreground'}`} />
          </div>
          
          <div>
            <p className="text-foreground font-semibold text-lg tracking-tight">
              {mode === 'live' ? 'Go Live' : 'Go On-Demand'}
            </p>
            <p className={`text-sm ${isActive ? config.colors.textLight : 'text-muted-foreground'}`}>
              {isActive 
                ? `${config.activeText} at ${spotCount} spot${spotCount !== 1 ? 's' : ''}`
                : spotCount > 0 
                  ? config.inactiveText
                  : 'Select spot(s) to enable'
              }
            </p>
          </div>
        </div>
        
        {/* Toggle Switch */}
        <button
          onClick={onToggle}
          disabled={loading}
          className={`
            w-14 h-7 rounded-full transition-all duration-300 relative flex-shrink-0
            ${isActive 
              ? config.colors.primary 
              : canActivate 
                ? 'bg-muted hover:bg-muted/80 cursor-pointer' 
                : 'bg-muted hover:bg-muted/80 cursor-pointer opacity-70'
            }
          `}
          data-testid="duty-toggle"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin absolute top-1.5 left-1/2 -translate-x-1/2 text-white" />
          ) : (
            <motion.span 
              className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-lg"
              animate={{ left: isActive ? 'calc(100% - 24px)' : '4px' }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}
        </button>
      </div>
    </motion.div>
  );
};

/**
 * Stats Preview
 */
const StatsPreview = ({ mode, stats }) => {
  const config = MODE_CONFIG[mode];
  
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="p-4 rounded-xl bg-card border border-border text-center">
        <p className={`text-2xl font-bold tracking-tight ${config.colors.text}`}>
          ${stats?.todayEarnings?.toFixed(0) || '0'}
        </p>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Today</p>
      </div>
      <div className="p-4 rounded-xl bg-card border border-border text-center">
        <p className={`text-2xl font-bold tracking-tight ${config.colors.text}`}>
          {stats?.sessionsToday || 0}
        </p>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Sessions</p>
      </div>
    </div>
  );
};

/**
 * Quick Actions
 */
const QuickActions = ({ mode, onClose, nearbyShooters }) => {
  const navigate = useNavigate();
  
  return (
    <div className="space-y-2">
      <button
        onClick={() => {
          navigate('/map?view=photographers');
          onClose?.();
        }}
        className="w-full flex items-center gap-3 p-4 bg-card hover:bg-muted rounded-xl border border-border transition-colors"
        data-testid="duty-nearby-shooters"
      >
        <div className="w-11 h-11 rounded-xl bg-cyan-500/10 flex items-center justify-center">
          <Users className="w-5 h-5 text-cyan-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-foreground font-medium">Other Shooters</p>
          <p className="text-muted-foreground text-sm">See who's active nearby</p>
        </div>
        {nearbyShooters > 0 && (
          <Badge className="bg-cyan-500/20 text-cyan-400 border-0">{nearbyShooters}</Badge>
        )}
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </button>
      
      <button
        onClick={() => {
          navigate(mode === 'live' ? '/photographer/sessions' : '/photographer/on-demand-settings');
          onClose?.();
        }}
        className="w-full flex items-center gap-3 p-4 bg-card hover:bg-muted rounded-xl border border-border transition-colors"
        data-testid="duty-settings"
      >
        <div className="w-11 h-11 rounded-xl bg-purple-500/10 flex items-center justify-center">
          <Settings className="w-5 h-5 text-purple-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-foreground font-medium">
            {mode === 'live' ? 'Live Settings' : 'On-Demand Settings'}
          </p>
          <p className="text-muted-foreground text-sm">Pricing & preferences</p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </button>
    </div>
  );
};

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
  
  // Role-based permissions
  const effectiveRole = getEffectiveRole(user?.role);
  const isHobbyist = effectiveRole === ROLES.HOBBYIST;
  const isApprovedPro = effectiveRole === ROLES.APPROVED_PRO;
  const showOnDemand = !isHobbyist;
  
  // Get radius based on tier
  const photographerTier = isApprovedPro ? 'pro' : 'standard';
  const radiusConfig = ON_DEMAND_RADIUS[photographerTier];
  
  const isActive = mode === 'live' ? liveActive : onDemandActive;
  
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
  
  // Fetch statuses on mount
  useEffect(() => {
    if (user?.id && isOpen) {
      fetchStatuses();
      fetchNearbyShooters();
    }
  }, [user?.id, isOpen]);
  
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
  
  const fetchStatuses = async () => {
    try {
      const liveResponse = await apiClient.get(`/photographer/${user.id}/status`);
      const liveData = liveResponse.data;
      setLiveActive(liveData?.is_shooting || false);
      
      if (liveData?.is_shooting && liveData?.current_spot_id) {
        setSelectedSpot({
          id: liveData.current_spot_id,
          name: liveData.current_spot_name,
          latitude: liveData.current_spot_latitude,
          longitude: liveData.current_spot_longitude
        });
        setMode('live');
        setProximityConfirmed(true);
      }
      
      if (showOnDemand) {
        const onDemandResponse = await apiClient.get(`/photographer/${user.id}/on-demand-status`);
        const onDemandData = onDemandResponse.data;
        setOnDemandActive(onDemandData?.is_available || false);
        
        if (onDemandData?.is_available && onDemandData?.active_spots) {
          setSelectedSpots(onDemandData.active_spots || []);
          setMode('onDemand');
        }
      }
      
      try {
        const statsResponse = await apiClient.get(`/photographer/${user.id}/daily-stats`);
        setStats(statsResponse.data || { todayEarnings: 0, sessionsToday: 0 });
      } catch (e) { /* daily stats are optional - don't block on failure */ }
    } catch (error) {
      logger.error('Failed to fetch statuses:', error);
      // If status fetch fails but the user has a stale session, the backend will
      // still report is_shooting=true.  Fallback: assume not active so the user
      // can at least attempt to go live (the backend will catch conflicts).
      setLiveActive(false);
      setOnDemandActive(false);
    }
  };
  
  // Force-end a stale session that's blocking new go-live attempts
  const forceEndStaleSession = async () => {
    try {
      setLoading(true);
      await apiClient.post(`/photographer/${user.id}/end-session`);
      setLiveActive(false);
      setSelectedSpot(null);
      toast.success('Previous session ended. You can now go live again.');
      // Re-fetch clean status
      await fetchStatuses();
    } catch (err) {
      const errDetail = err.response?.data?.detail;
      // "No active session to end" means the DB is already clean — clear local state
      if (errDetail && errDetail.toLowerCase().includes('no active session')) {
        setLiveActive(false);
        toast.success('Session already cleared. You can go live now.');
      } else {
        toast.error(`Could not end session: ${errDetail || err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };
  
  const fetchAvailableSpots = async () => {
    if (!userLocation) return;
    
    setSpotsLoading(true);
    try {
      // Use correct endpoint: /surf-spots/nearby with radius_miles parameter
      const response = await apiClient.get(`/surf-spots/nearby`, {
        params: {
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          radius_miles: radiusConfig.max // Use max radius for the tier
        }
      });
      
      // Map response and filter spots within the tier's radius
      const spotsWithDistance = (response.data || []).map(spot => {
        // Backend already provides distance_miles, but calculate if missing
        const distance = spot.distance_miles || spot.distance || metersToMiles(
          calculateDistance(userLocation.lat, userLocation.lng, spot.latitude, spot.longitude)
        );
        return { ...spot, distance };
      }).filter(spot => spot.distance <= radiusConfig.max);
      
      setAvailableSpots(spotsWithDistance);
    } catch (error) {
      logger.error('Failed to fetch spots:', error);
      setAvailableSpots([]);
    } finally {
      setSpotsLoading(false);
    }
  };
  
  const fetchNearbyShooters = async () => {
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
          const response = await apiClient.get(`/photographers/live`, {
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
  
  // Handle conditions report confirmation - actually goes live
  // Uses two-step flow: (1) pre-upload media to /upload/conditions, (2) send URL to go-live
  const handleConditionsConfirm = async (conditionsData) => {
    setLoading(true);
    try {
      if (onDemandActive) {
        try {
          await apiClient.post(`/photographer/${user.id}/on-demand-toggle`, { is_available: false });
          setOnDemandActive(false);
          toast.info('Switching to Live mode. On-Demand disabled.');
        } catch (odErr) {
          // Don't block go-live if on-demand toggle fails — backend will auto-disable
          logger.warn('[DutyStation] On-Demand toggle failed, backend will handle:', odErr);
        }
      }
      
      // Step 1: Pre-upload condition media via multipart form to avoid large JSON body
      let conditionMediaUrl = null;
      let conditionMediaType = conditionsData?.mediaType || null;
      if (conditionsData?.media instanceof Blob) {
        try {
          const ext = conditionMediaType === 'video' ? '.webm' : '.jpg';
          const mimeType = conditionMediaType === 'video' ? 'video/webm' : 'image/jpeg';
          const formData = new FormData();
          formData.append('file', conditionsData.media, `conditions${ext}`);
          formData.append('user_id', user.id);
          logger.log('[DutyStation] Pre-uploading condition media…', { size: conditionsData.media.size, type: mimeType });
          const uploadRes = await apiClient.post('/upload/conditions', formData, {
            headers: { 'Content-Type': undefined }, // Let browser set multipart boundary
            timeout: 60000 // 60s for large video uploads
          });
          conditionMediaUrl = uploadRes.data?.media_url;
          conditionMediaType = uploadRes.data?.media_type || conditionMediaType;
          logger.log('[DutyStation] Condition media uploaded:', conditionMediaUrl);
        } catch (uploadErr) {
          logger.warn('[DutyStation] Condition media pre-upload failed, will try inline:', uploadErr.message);
          // Fallback: convert to base64 inline (legacy path)
          const reader = new FileReader();
          const mediaBase64 = await new Promise((resolve) => {
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(conditionsData.media);
          });
          // Will use condition_media (base64) below
          conditionMediaUrl = null;
          // Store base64 for fallback
          conditionsData._base64Fallback = mediaBase64;
        }
      }
      
      // Step 2: Build go-live request — prefer URL over base64
      const goLivePayload = {
        spot_id: selectedSpot.id,
        spot_name: selectedSpot.name,
        location: selectedSpot.name,  // Backend reads data.location for display name
        latitude: selectedSpot.latitude,
        longitude: selectedSpot.longitude,
        // Preferred: pre-uploaded URL (avoids large JSON body)
        condition_media_url: conditionMediaUrl || null,
        // Fallback: inline base64 (only if pre-upload failed)
        condition_media: conditionMediaUrl ? null : (conditionsData?._base64Fallback || null),
        condition_media_type: conditionMediaType,
        // Spot notes from the ConditionsModal
        spot_notes: conditionsData?.spotNotes || null
      };
      
      logger.log('[DutyStation] Go-live payload:', {
        ...goLivePayload,
        condition_media: goLivePayload.condition_media ? '[base64-fallback]' : null,
        condition_media_url: goLivePayload.condition_media_url || null
      });
      
      await apiClient.post(`/photographer/${user.id}/go-live`, goLivePayload, {
        timeout: 120000 // 120s — matches PSM; accommodates Render cold starts
      });
      setLiveActive(true);
      setShowConditionsModal(false);
      toast.success(`Now live at ${selectedSpot.name}!`);
    } catch (error) {
      const detail = error.response?.data?.detail || '';
      const status = error.response?.status;
      logger.error('[DutyStation] Go-live failed:', { status, detail, message: error.message });
      
      // Check specific statuses FIRST — before the generic detail fallback
      if (status === 413) {
        toast.error('Media file too large. Please use a shorter video or lower-quality photo.');
      } else if (status === 400 && detail.toLowerCase().includes('already')) {
        // Stale session blocking new go-live — offer recovery action
        toast.error('You have a stale live session blocking new activations.', {
          duration: 8000,
          action: {
            label: 'End Stale Session',
            onClick: () => forceEndStaleSession()
          }
        });
      } else if (status === 409) {
        toast.error('Session conflict detected. Please refresh and try again.');
      } else if (detail) {
        // Generic backend error message (covers 403 role errors, etc.)
        toast.error(`Go-live error: ${detail}`);
      } else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        toast.error('Request timed out. The server may be waking up — please try again in a moment.', { duration: 6000 });
      } else if (!error.response) {
        toast.error('Network error — please check your connection and try again.');
      } else {
        toast.error('Failed to go live. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };
  
  const handleActivateOnDemand = async () => {
    if (selectedSpots.length === 0) {
      toast.error('Please select at least one spot');
      return;
    }
    
    // Check GPS availability
    if (!gpsAvailable) {
      toast.error('GPS is required for On-Demand mode');
      return;
    }
    
    setLoading(true);
    try {
      if (liveActive) {
        await apiClient.post(`/photographer/${user.id}/end-session`);
        setLiveActive(false);
        toast.info('Switching to On-Demand mode. Live session ended.');
      }
      
      await apiClient.post(`/photographer/${user.id}/on-demand-toggle`, {
        is_available: true,
        spots: selectedSpots.map(s => ({ id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude }))
      });
      setOnDemandActive(true);
      toast.success(`On-Demand activated for ${selectedSpots.length} spot${selectedSpots.length !== 1 ? 's' : ''}!`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to activate On-Demand');
    } finally {
      setLoading(false);
    }
  };
  
  const handleDeactivateLive = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/photographer/${user.id}/end-session`);
      setLiveActive(false);
      setSelectedSpot(null);
      setProximityConfirmed(false);
      toast.success('Live session ended');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to end session');
    } finally {
      setLoading(false);
    }
  };
  
  const handleDeactivateOnDemand = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/photographer/${user.id}/on-demand-toggle`, { is_available: false });
      setOnDemandActive(false);
      setSelectedSpots([]);
      toast.success('On-Demand mode deactivated');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update status');
    } finally {
      setLoading(false);
    }
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
                  ? `${mode === 'live' ? 'Live' : 'On-Demand'} • Active`
                  : 'Manage your availability'
                }
              </p>
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            data-testid="duty-drawer-close"
          >
            <X className="w-5 h-5" />
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

/**
 * DutyStationIcon - TopNav icon that triggers the drawer
 */
export const DutyStationIcon = ({ className }) => {
  const { user } = useAuth();
  const { getEffectiveRole } = usePersona();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [liveActive, setLiveActive] = useState(false);
  const [onDemandActive, setOnDemandActive] = useState(false);
  
  const effectiveRole = getEffectiveRole(user?.role);
  const isHobbyist = effectiveRole === ROLES.HOBBYIST;
  
  // Close drawer when route changes
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);
  
  useEffect(() => {
    if (user?.id) {
      fetchActiveStatus();
    }
  }, [user?.id]);
  
  const fetchActiveStatus = async () => {
    try {
      const liveResponse = await apiClient.get(`/photographer/${user.id}/status`);
      setLiveActive(liveResponse.data?.is_shooting || false);
      
      if (!isHobbyist) {
        const onDemandResponse = await apiClient.get(`/photographer/${user.id}/on-demand-status`);
        setOnDemandActive(onDemandResponse.data?.is_available || false);
      }
    } catch (error) {
      logger.error('Failed to fetch active status');
    }
  };
  
  const isActive = liveActive || onDemandActive;
  const activeMode = liveActive ? 'live' : onDemandActive ? 'onDemand' : null;
  const config = activeMode ? MODE_CONFIG[activeMode] : MODE_CONFIG.live;
  const Icon = liveActive ? Radio : Zap;
  
  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`relative p-1 transition-colors ${isActive ? config.colors.text : 'text-zinc-400 hover:text-white'} ${className}`}
        data-testid="topnav-duty-station"
        aria-label="Duty Station"
      >
        {isActive && (
          <span 
            className={`absolute inset-0 rounded-full ${config.colors.ring} animate-ping`}
            style={{ animationDuration: '2s' }}
          />
        )}
        <Icon className="w-5 h-5 relative z-10" />
      </button>
      
      <DutyStationDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
};

export default DutyStationDrawer;
