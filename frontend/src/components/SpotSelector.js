import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { MapPin, Search, Check, Loader2, Navigation, X, ChevronRight, ChevronLeft, Globe, Map as MapIcon, AlertTriangle } from 'lucide-react';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';


/**
 * SpotSelector - In-Drawer Searchable Spot Selection
 * 
 * Used in Active Duty console for On-Demand and Live spot selection
 * 
 * Features:
 * - GPS-based nearby spots (primary — auto-attempts on mount)
 * - Hierarchical browse fallback: Country → State/Province → Spot
 *   (same pattern as ScheduledBookingDrawer & Feed check-in)
 * - Radius filtering based on photographer tier:
 *   - Standard: 10-20 miles
 *   - Verified Pro: 30-50 miles
 * - Searchable spot list
 */

export const SpotSelector = ({ 
  selectedSpot, 
  onSelectSpot, 
  photographerTier = 'standard',
  disabled = false,
  compact = false
}) => {
  const { _user } = useAuth();
  const [spots, setSpots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // GPS fallback: hierarchical browse state
  const [gpsAvailable, setGpsAvailable] = useState(null); // null = not yet attempted
  const [browseMode, setBrowseMode] = useState(false);
  const [locationData, setLocationData] = useState(null); // hierarchy: { countries: [...] }
  const [locationDataLoading, setLocationDataLoading] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedState, setSelectedState] = useState('');

  // Radius limits based on photographer tier
  const radiusConfig = useMemo(() => {
    if (photographerTier === 'pro' || photographerTier === 'verified' || photographerTier === ROLES.APPROVED_PRO) {
      return { min: 30, max: 50, label: 'Pro Range (30-50mi)' };
    }
    return { min: 10, max: 20, label: 'Standard Range (10-20mi)' };
  }, [photographerTier]);

  // Get user's current location
  useEffect(() => {
    getUserLocation();
  }, []);

  // Fetch spots when location is available (GPS mode)
  useEffect(() => {
    if (userLocation) {
      fetchNearbySpots();
    }
  }, [userLocation, radiusConfig]);

  const getUserLocation = () => {
    setLocationLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
          setGpsAvailable(true);
          setLocationLoading(false);
        },
        (error) => {
          logger.error('Geolocation error:', error);
          setGpsAvailable(false);
          setLocationLoading(false);
          // Auto-open browse mode when GPS fails
          handleOpenBrowseMode();
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setGpsAvailable(false);
      setLocationLoading(false);
      // Auto-open browse mode when GPS not supported
      handleOpenBrowseMode();
    }
  };

  const fetchNearbySpots = async () => {
    if (!userLocation) return;
    
    setLoading(true);
    try {
      const response = await apiClient.get(`/surf-spots/nearby`, {
        params: {
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          radius_miles: radiusConfig.max
        }
      });
      
      // Map backend response to frontend format and filter by radius
      const filteredSpots = (response.data || [])
        .filter(spot => {
          const distance = spot.distance_miles || spot.distance || calculateDistance(
            userLocation.latitude,
            userLocation.longitude,
            spot.latitude,
            spot.longitude
          );
          return distance <= radiusConfig.max;
        })
        .map(spot => ({
          ...spot,
          distance: spot.distance_miles || spot.distance
        }))
        .sort((a, b) => (a.distance || 0) - (b.distance || 0));
      
      setSpots(filteredSpots);
    } catch (error) {
      logger.error('Failed to fetch spots:', error);
      setSpots([]);
    } finally {
      setLoading(false);
    }
  };

  // ============ BROWSE MODE (GPS Fallback) ============

  // Open browse mode & fetch the location hierarchy
  const handleOpenBrowseMode = useCallback(async () => {
    setBrowseMode(true);
    if (locationData) return; // Already fetched

    setLocationDataLoading(true);
    try {
      const response = await apiClient.get('/surf-spots/locations');
      setLocationData(response.data);
    } catch (error) {
      logger.error('Failed to fetch location hierarchy:', error);
      setLocationData(null);
    } finally {
      setLocationDataLoading(false);
    }
  }, [locationData]);

  // Fetch spots filtered by country + optional state
  const fetchSpotsByLocation = async (country, state) => {
    setLoading(true);
    try {
      const params = {};
      if (country) params.country = country;
      if (state) params.state_province = state;

      const response = await apiClient.get('/surf-spots', { params });
      const fetchedSpots = (response.data || [])
        .map(spot => ({
          ...spot,
          distance: null // No distance info in browse mode
        }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      setSpots(fetchedSpots);
    } catch (error) {
      logger.error('Failed to fetch spots by location:', error);
      setSpots([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCountryChange = (country) => {
    setSelectedCountry(country);
    setSelectedState('');
    if (country) {
      fetchSpotsByLocation(country, '');
    } else {
      setSpots([]);
    }
  };

  const handleStateChange = (state) => {
    setSelectedState(state);
    if (selectedCountry) {
      fetchSpotsByLocation(selectedCountry, state);
    }
  };

  // Back to GPS mode (retry)
  const handleRetryGps = () => {
    setBrowseMode(false);
    setSelectedCountry('');
    setSelectedState('');
    setSpots([]);
    getUserLocation();
  };

  // Simple distance calculation (Haversine formula approximation)
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Filter spots by search query
  const filteredSpots = useMemo(() => {
    if (!searchQuery.trim()) return spots;
    const query = searchQuery.toLowerCase();
    return spots.filter(spot => 
      spot.name?.toLowerCase().includes(query) ||
      spot.location?.toLowerCase().includes(query) ||
      spot.region?.toLowerCase().includes(query)
    );
  }, [spots, searchQuery]);

  const handleSelectSpot = (spot) => {
    onSelectSpot({
      id: spot.id,
      name: spot.name,
      latitude: spot.latitude,
      longitude: spot.longitude,
      distance: spot.distance
    });
    setIsExpanded(false);
    setSearchQuery('');
  };

  // Compact view - just shows selected spot with edit option
  if (compact && !isExpanded) {
    return (
      <button
        onClick={() => !disabled && setIsExpanded(true)}
        disabled={disabled}
        className={`w-full flex items-center gap-2 p-3 rounded-xl transition-colors ${
          selectedSpot 
            ? 'bg-green-500/10 border border-green-500/30 hover:bg-green-500/20'
            : 'bg-zinc-800 border border-zinc-700 hover:bg-zinc-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <MapPin className={`w-4 h-4 ${selectedSpot ? 'text-green-400' : 'text-gray-400'}`} />
        <span className={`flex-1 text-left text-sm ${selectedSpot ? 'text-green-300' : 'text-gray-400'}`}>
          {selectedSpot?.name || 'Select your spot...'}
        </span>
        {selectedSpot?.distance && (
          <Badge className="bg-green-500/20 text-green-400 text-xs">
            {selectedSpot.distance.toFixed(1)}mi
          </Badge>
        )}
      </button>
    );
  }

  // Helper: get available states for selected country
  const selectedCountryData = locationData?.countries?.find(c => c.name === selectedCountry);
  const availableStates = selectedCountryData?.states || [];

  return (
    <div className="space-y-3">
      {/* Header with mode indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-cyan-400" />
          <span className="text-foreground text-sm font-medium">Select Spot</span>
        </div>
        {!browseMode && gpsAvailable && (
          <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">
            {radiusConfig.label}
          </Badge>
        )}
        {browseMode && (
          <Badge className="bg-amber-500/20 text-amber-400 text-xs">
            <Globe className="w-3 h-3 mr-1" />
            Browse Mode
          </Badge>
        )}
      </div>

      {/* GPS Status / Mode Switcher */}
      {gpsAvailable === false && !browseMode && (
        <div className="flex items-center gap-2 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-amber-300 text-xs flex-1">
            GPS unavailable on this device. Browse spots by location instead.
          </p>
        </div>
      )}

      {/* Mode Toggle Buttons */}
      {gpsAvailable !== null && (
        <div className="flex gap-2">
          {/* GPS Mode Button */}
          <button
            onClick={handleRetryGps}
            disabled={locationLoading}
            className={`flex-1 flex items-center justify-center gap-1.5 p-2 rounded-lg text-xs font-medium transition-all ${
              !browseMode
                ? 'bg-green-500/20 border border-green-500/50 text-green-400'
                : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground'
            }`}
          >
            {locationLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Navigation className="w-3.5 h-3.5" />
            )}
            {locationLoading ? 'Getting GPS...' : gpsAvailable ? 'Nearby' : 'Retry GPS'}
          </button>

          {/* Browse Mode Button */}
          <button
            onClick={handleOpenBrowseMode}
            disabled={locationDataLoading}
            className={`flex-1 flex items-center justify-center gap-1.5 p-2 rounded-lg text-xs font-medium transition-all ${
              browseMode
                ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-400'
                : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground'
            }`}
          >
            {locationDataLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Globe className="w-3.5 h-3.5" />
            )}
            Browse by Location
          </button>
        </div>
      )}

      {/* ============ BROWSE MODE: Country → State Drill-Down ============ */}
      {browseMode && (
        <div className="p-3 rounded-xl border border-border bg-card/50 space-y-2.5">
          <div className="flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-cyan-400" />
            <span className="text-foreground text-sm font-medium">Find Your Spot</span>
          </div>

          {locationDataLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
              <span className="ml-2 text-muted-foreground text-xs">Loading locations...</span>
            </div>
          ) : locationData?.countries?.length > 0 ? (
            <div className="space-y-2">
              {/* Country Picker */}
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">Country</label>
                <select
                  value={selectedCountry}
                  onChange={(e) => handleCountryChange(e.target.value)}
                  className="w-full h-9 px-3 rounded-md text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50 appearance-none"
                >
                  <option value="">Select a country...</option>
                  {locationData.countries.map(country => (
                    <option key={country.name} value={country.name}>
                      {country.name} ({country.spot_count} spots)
                    </option>
                  ))}
                </select>
              </div>

              {/* State/Province Picker — appears when country has states */}
              {selectedCountry && availableStates.length > 0 && (
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">State / Province</label>
                  <select
                    value={selectedState}
                    onChange={(e) => handleStateChange(e.target.value)}
                    className="w-full h-9 px-3 rounded-md text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50 appearance-none"
                  >
                    <option value="">All states in {selectedCountry}</option>
                    {availableStates.map(state => (
                      <option key={state.name} value={state.name}>
                        {state.name} ({state.spot_count} spots)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Selected location breadcrumb */}
              {selectedCountry && (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Check className="w-3 h-3 text-cyan-400" />
                  <span>
                    Showing spots in {selectedState || selectedCountry}
                    {spots.length > 0 && ` (${spots.length} found)`}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground text-xs text-center py-3">
              No locations available. Try retrying GPS.
            </div>
          )}
        </div>
      )}

      {/* ============ SEARCH INPUT (both modes) ============ */}
      {(userLocation || (browseMode && selectedCountry)) && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search spots..."
            className="pl-10 bg-card border-border text-foreground placeholder:text-muted-foreground"
            disabled={disabled}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* ============ SPOTS LIST ============ */}
      <div className="max-h-[200px] overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-zinc-700">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
          </div>
        ) : filteredSpots.length > 0 ? (
          filteredSpots.map((spot) => {
            const isSelected = selectedSpot?.id === spot.id;
            return (
              <button
                key={spot.id}
                onClick={() => handleSelectSpot(spot)}
                disabled={disabled}
                className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
                  isSelected
                    ? 'bg-green-500/20 border border-green-500/50'
                    : 'bg-card/50 hover:bg-muted/50 border border-transparent'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  isSelected ? 'bg-green-500/30' : 'bg-cyan-500/20'
                }`}>
                  {isSelected ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <MapPin className="w-4 h-4 text-cyan-400" />
                  )}
                </div>
                <div className="flex-1 text-left">
                  <p className={`text-sm font-medium ${isSelected ? 'text-green-300' : 'text-foreground'}`}>
                    {spot.name}
                  </p>
                  {(spot.region || spot.location) && (
                    <p className="text-xs text-muted-foreground">{spot.region || spot.location}</p>
                  )}
                </div>
                {spot.distance !== undefined && spot.distance !== null && (
                  <span className={`text-xs ${isSelected ? 'text-green-400' : 'text-muted-foreground'}`}>
                    {spot.distance.toFixed(1)} mi
                  </span>
                )}
              </button>
            );
          })
        ) : (userLocation || (browseMode && selectedCountry)) ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {searchQuery ? 'No spots match your search' : 'No spots found in this area'}
          </div>
        ) : !browseMode && !locationLoading ? (
          /* Initial state — GPS hasn't been tried yet or is loading */
          <div className="text-center py-6 space-y-2">
            <Navigation className="w-6 h-6 text-muted-foreground mx-auto opacity-50" />
            <p className="text-muted-foreground text-xs">
              {locationLoading ? 'Getting your location...' : 'Enable GPS or browse by location to see spots'}
            </p>
          </div>
        ) : null}
      </div>

      {/* Close button when expanded from compact mode */}
      {compact && isExpanded && (
        <button
          onClick={() => setIsExpanded(false)}
          className="w-full p-2 text-muted-foreground hover:text-foreground text-sm"
        >
          Cancel
        </button>
      )}
    </div>
  );
};

export default SpotSelector;
