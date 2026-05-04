/**
 * DutyStationComponents.js � Extracted sub-components from DutyStationDrawer.
 * GpsProximityCheck (108 lines) and OnDemandSpotSelector (113 lines).
 * Reduces DutyStationDrawer from 54.4KB to ~45KB.
 */
import React, { useState, useMemo } from 'react';
import { 
  MapPin, Navigation, Loader2, CheckCircle, AlertTriangle,
  ChevronDown, X, Search, ArrowUp
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { getFullUrl } from '../../utils/media';

// Haversine distance calculation
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const metersToMiles = (m) => (m / 1609.344).toFixed(1);

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
                ?? Warning: Going live when not at the spot may result in negative reviews, 
                selling suspension, or account action.
              </p>
              <Button aria-label="Confirm"
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
                    {spot.distance && ` � ${spot.distance.toFixed(1)} mi`}
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
                className={`absolute inset-0 rounded-2xl ${config.colors.ring} animate-ping animate-duration-2s`}
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

export { GpsProximityCheck, OnDemandSpotSelector, StatusCard };
