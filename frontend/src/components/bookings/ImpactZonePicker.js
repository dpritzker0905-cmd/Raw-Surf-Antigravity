/**
 * ImpactZonePicker � Location selection for scheduled bookings.
 * Features: GPS-based nearest spots, photographer range validation,
 * travel surcharge calculation, manual browse by country/state.
 * 
 * Extracted from ScheduledBookingDrawer.js for maintainability.
 */
import React, { useState, useCallback } from 'react';
import {
  MapPin, DollarSign, Navigation, Check, AlertTriangle, Star,
  Target, Loader2, MapIcon, Anchor, Search, X
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';
import { Map as MapIconLucide } from 'lucide-react';
// Duration prices multiplier
const DURATION_PRICES = {
  60: 1,
  120: 1.8,
  180: 2.5,
  240: 3,
  480: 5
};

/**
 * Impact Zone Location Picker - Select meetup coordinates with range validation
 * Features:
 * - GPS-based nearest spots dropdown
 * - Validates if photographer is within range
 * - Shows travel surcharge if applicable
 */
const ImpactZonePicker = ({ 
  location, 
  onLocationChange,
  onRangeValidation,
  photographer,
  photographerHomeBreak,
  isLight 
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const _cardBg = isLight ? 'bg-gray-100' : 'bg-zinc-800';
  
  const [gpsLoading, setGpsLoading] = useState(false);
  const [manualInput, setManualInput] = useState(location?.description || '');
  const [userCoords, setUserCoords] = useState(null);
  const [nearbySpots, setNearbySpots] = useState([]);
  const [spotsLoading, setSpotsLoading] = useState(false);
  const [rangeError, setRangeError] = useState(null);
  const [travelSurcharge, setTravelSurcharge] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllSpots, setShowAllSpots] = useState(false);
  const [nearestPier, setNearestPier] = useState(null);
  const [selectedTier, setSelectedTier] = useState('all'); // 'all', 'local', 'extended'
  const [gpsError, setGpsError] = useState(false); // Track GPS failure
  const [showBrowseSpots, setShowBrowseSpots] = useState(false); // Manual browse mode
  
  // Location filtering state (for manual browse)
  const [locationData, setLocationData] = useState(null); // Countries/states data
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);
  
  // Photographer service area settings - default to wider coverage
  const serviceRadius = photographer?.service_radius_miles || 75; // Default to 75 miles for extended coverage
  const photographerCoords = {
    lat: photographer?.home_latitude,
    lng: photographer?.home_longitude
  };
  // Default travel fee tiers if photographer hasn't set them
  const defaultTravelTiers = [
    { min_miles: 0, max_miles: 15, surcharge: 0, label: 'Local' },
    { min_miles: 15, max_miles: 30, surcharge: 25, label: 'Nearby' },
    { min_miles: 30, max_miles: 50, surcharge: 50, label: 'Extended' },
    { min_miles: 50, max_miles: 100, surcharge: 100, label: 'Far' }
  ];
  const travelSurcharges = photographer?.travel_surcharges?.length > 0 
    ? photographer.travel_surcharges 
    : defaultTravelTiers;
  const chargesTravelFees = true; // Always show fees by default
  
  // Calculate distance between two coordinates (Haversine formula)
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    
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
  
  // Get travel surcharge for a given distance from photographer's home
  const getTravelSurchargeForDistance = useCallback((distance) => {
    if (distance === null || distance === undefined) return { surcharge: 0, label: 'Unknown' };
    
    for (const tier of travelSurcharges) {
      if (distance >= tier.min_miles && distance < tier.max_miles) {
        return { surcharge: tier.surcharge || 0, label: tier.label || '' };
      }
    }
    // Beyond all tiers - check if in last tier
    const lastTier = travelSurcharges[travelSurcharges.length - 1];
    if (lastTier && distance >= lastTier.max_miles) {
      return { surcharge: -1, label: 'Out of Range' }; // -1 means out of range
    }
    return { surcharge: 0, label: 'Local' };
  }, [travelSurcharges]);
  
  // Get distance from photographer's home base for a spot
  const getDistanceFromPhotographer = useCallback((spot) => {
    if (!photographerCoords.lat || !photographerCoords.lng) return null;
    if (!spot.latitude || !spot.longitude) return null;
    return calculateDistance(photographerCoords.lat, photographerCoords.lng, spot.latitude, spot.longitude);
  }, [photographerCoords]);
  
  // Validate if location is within photographer's service area
  const validateRange = useCallback((coords, spotDistance = null) => {
    if (!coords?.latitude || !coords?.longitude) {
      setRangeError(null);
      setTravelSurcharge(0);
      return true;
    }
    
    // Calculate distance from photographer's home if we have coords
    const distance = spotDistance ?? (photographerCoords.lat && photographerCoords.lng 
      ? calculateDistance(photographerCoords.lat, photographerCoords.lng, coords.latitude, coords.longitude)
      : null);
    
    if (distance !== null && distance > serviceRadius) {
      setRangeError({
        distance: distance.toFixed(1),
        maxRange: serviceRadius,
        message: `${distance.toFixed(1)} mi away - outside ${photographer?.full_name || 'photographer'}'s ${serviceRadius} mi coverage`
      });
      onRangeValidation?.(false, 0);
      return false;
    }
    
    const { surcharge } = getTravelSurchargeForDistance(distance);
    if (surcharge === -1) {
      setRangeError({
        distance: distance?.toFixed(1) || '?',
        maxRange: serviceRadius,
        message: `Location is outside ${photographer?.full_name || 'photographer'}'s coverage area`
      });
      onRangeValidation?.(false, 0);
      return false;
    }
    
    setTravelSurcharge(surcharge);
    setRangeError(null);
    onRangeValidation?.(true, surcharge);
    return true;
  }, [photographerCoords, serviceRadius, photographer?.full_name, onRangeValidation, getTravelSurchargeForDistance]);
  
  // Fetch nearby spots - use wider radius to show extended options
  const fetchNearbySpots = useCallback(async (lat, lng) => {
    setSpotsLoading(true);
    try {
      // Fetch spots within full service radius
      const response = await apiClient.get(`/surf-spots/nearby`, {
        params: { latitude: lat, longitude: lng, radius_miles: serviceRadius }
      });
      let spots = response.data || [];
      
      // Enhance spots with distance from photographer's home (for fee calculation)
      spots = spots.map(spot => ({
        ...spot,
        distanceFromPhotographer: getDistanceFromPhotographer(spot),
        distanceFromUser: spot.distance_miles
      }));
      
      // Sort by distance from user
      spots.sort((a, b) => (a.distanceFromUser || 999) - (b.distanceFromUser || 999));
      
      setNearbySpots(spots);
      
      // Find nearest pier from spots (case insensitive search)
      const piers = spots.filter(s => 
        s.name.toLowerCase().includes('pier') || 
        s.name.toLowerCase().includes('jetty') ||
        s.name.toLowerCase().includes('wharf')
      );
      setNearestPier(piers.length > 0 ? piers[0] : null);
    } catch (error) {
      logger.error('Failed to fetch nearby spots:', error);
      setNearbySpots([]);
      setNearestPier(null);
    } finally {
      setSpotsLoading(false);
    }
  }, [serviceRadius, getDistanceFromPhotographer]);
  
  // Handle GPS location
  const handleUseGPS = async () => {
    setGpsLoading(true);
    setGpsError(false);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            description: 'My Current Location',
            type: 'gps'
          };
          
          setUserCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
          setGpsError(false);
          
          // Validate range
          const isValid = validateRange(coords);
          
          if (isValid) {
            onLocationChange(coords);
            toast.success('Location captured! Select a nearby spot below.');
          }
          
          // Fetch nearby spots
          await fetchNearbySpots(position.coords.latitude, position.coords.longitude);
          
          setGpsLoading(false);
        },
        (error) => {
          logger.error('GPS Error:', error);
          setGpsError(true);
          setGpsLoading(false);
          toast.error('GPS unavailable. You can browse spots manually below.');
          // Auto-expand browse spots when GPS fails
          setShowBrowseSpots(true);
          // Fetch spots near photographer's location as fallback
          if (photographerCoords.lat && photographerCoords.lng) {
            fetchNearbySpots(photographerCoords.lat, photographerCoords.lng);
          }
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setGpsError(true);
      setGpsLoading(false);
      toast.error('GPS not supported. Please browse spots manually.');
      setShowBrowseSpots(true);
      // Fetch spots near photographer's location as fallback
      if (photographerCoords.lat && photographerCoords.lng) {
        fetchNearbySpots(photographerCoords.lat, photographerCoords.lng);
      }
    }
  };
  
  // Browse spots without GPS (around photographer's area)
  const handleBrowseSpots = async () => {
    setShowBrowseSpots(true);
    setLocationLoading(true);
    
    try {
      // Fetch available locations for filtering
      const locResponse = await apiClient.get(`/surf-spots/locations`);
      setLocationData(locResponse.data);
      
      // If photographer has coordinates, also fetch nearby spots
      if (photographerCoords.lat && photographerCoords.lng) {
        setSpotsLoading(true);
        await fetchNearbySpots(photographerCoords.lat, photographerCoords.lng);
      }
    } catch (error) {
      logger.error('Failed to fetch locations:', error);
      setLocationData(null);
    } finally {
      setLocationLoading(false);
      setSpotsLoading(false);
    }
  };
  
  // Fetch spots by country/state selection
  const fetchSpotsByLocation = async (country, state) => {
    setSpotsLoading(true);
    try {
      const params = {};
      if (country) params.country = country;
      if (state) params.state_province = state;
      
      const response = await apiClient.get(`/surf-spots`, { params });
      const spots = response.data || [];
      
      // Enhance spots with distance from photographer if available
      const enhancedSpots = spots.map(spot => ({
        ...spot,
        distanceFromPhotographer: getDistanceFromPhotographer(spot),
        distanceFromUser: null
      }));
      
      // Sort by name since we don't have user distance
      enhancedSpots.sort((a, b) => a.name.localeCompare(b.name));
      
      setNearbySpots(enhancedSpots);
    } catch (error) {
      logger.error('Failed to fetch spots by location:', error);
      setNearbySpots([]);
    } finally {
      setSpotsLoading(false);
    }
  };
  
  // Handle country selection change
  const handleCountryChange = (country) => {
    setSelectedCountry(country);
    setSelectedState(''); // Reset state when country changes
    if (country) {
      fetchSpotsByLocation(country, '');
    } else {
      setNearbySpots([]);
    }
  };
  
  // Handle state selection change  
  const handleStateChange = (state) => {
    setSelectedState(state);
    if (selectedCountry) {
      fetchSpotsByLocation(selectedCountry, state);
    }
  };
  
  // Handle photographer's home break selection
  const handleHomeBreakSelect = () => {
    if (photographerCoords.lat && photographerCoords.lng) {
      const coords = {
        latitude: photographerCoords.lat,
        longitude: photographerCoords.lng,
        description: photographerHomeBreak || "Photographer's Home Break",
        type: 'home_break'
      };
      setRangeError(null);
      setTravelSurcharge(0);
      onLocationChange(coords);
      onRangeValidation?.(true, 0);
    } else {
      onLocationChange({
        latitude: null,
        longitude: null,
        description: photographerHomeBreak || "Photographer's Home Break",
        type: 'preset',
        preset_id: 'home'
      });
      setRangeError(null);
      setTravelSurcharge(0);
      onRangeValidation?.(true, 0);
    }
  };
  
  // Handle nearest pier selection
  const handleNearestPierSelect = () => {
    if (nearestPier) {
      handleSpotSelect(nearestPier);
    } else if (userCoords) {
      toast.info('No pier found nearby. Try selecting a surf spot instead.');
    } else {
      toast.info('Enable GPS to find the nearest pier automatically.');
    }
  };
  
  // Handle spot selection
  const handleSpotSelect = (spot) => {
    const coords = {
      latitude: spot.latitude,
      longitude: spot.longitude,
      description: spot.name,
      type: 'spot',
      spot_id: spot.id
    };
    
    const isValid = validateRange(coords, spot.distanceFromPhotographer);
    
    if (isValid) {
      onLocationChange(coords);
    }
  };
  
  // Handle manual input
  const handleManualSubmit = () => {
    if (manualInput.trim()) {
      setRangeError(null);
      setTravelSurcharge(0);
      onLocationChange({
        latitude: null,
        longitude: null,
        description: manualInput.trim(),
        type: 'manual'
      });
      onRangeValidation?.(true, 0);
      toast.info('Location set. Note: Travel fees may apply based on distance.');
    }
  };
  
  // Get fee badge for a spot
  const getFeeBadge = (spot) => {
    const { surcharge, _label } = getTravelSurchargeForDistance(spot.distanceFromPhotographer);
    if (surcharge === -1) return { text: 'Out of Range', color: 'text-red-400 bg-red-500/20' };
    if (surcharge === 0) return { text: 'No fee', color: 'text-green-400 bg-green-500/20' };
    return { text: `+$${surcharge}`, color: 'text-yellow-400 bg-yellow-500/20' };
  };
  
  // Filter and group spots
  const getFilteredSpots = () => {
    let filtered = nearbySpots;
    
    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    
    // Apply tier filter
    if (selectedTier === 'local') {
      filtered = filtered.filter(s => {
        const { surcharge } = getTravelSurchargeForDistance(s.distanceFromPhotographer);
        return surcharge === 0;
      });
    } else if (selectedTier === 'extended') {
      filtered = filtered.filter(s => {
        const { surcharge } = getTravelSurchargeForDistance(s.distanceFromPhotographer);
        return surcharge > 0 && surcharge !== -1;
      });
    }
    
    return filtered;
  };
  
  const filteredSpots = getFilteredSpots();
  const displayedSpots = showAllSpots ? filteredSpots : filteredSpots.slice(0, 6);
  
  // Count spots by tier for badges
  const localSpots = nearbySpots.filter(s => {
    const { surcharge } = getTravelSurchargeForDistance(s.distanceFromPhotographer);
    return surcharge === 0;
  });
  const extendedSpots = nearbySpots.filter(s => {
    const { surcharge } = getTravelSurchargeForDistance(s.distanceFromPhotographer);
    return surcharge > 0 && surcharge !== -1;
  });
  
  return (
    <div className="space-y-3">
      {/* Header with coverage info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Target className="w-4 h-4 text-orange-400" />
          <span className={`text-sm font-medium ${textPrimary}`}>Where to Meet</span>
        </div>
        {photographerCoords.lat && (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">
            Covers {serviceRadius} mi
          </Badge>
        )}
      </div>
      
      {/* GPS Location Button - Primary Action */}
      <Button
        variant="outline"
        onClick={handleUseGPS}
        disabled={gpsLoading}
        className={`w-full justify-start h-11 ${
          userCoords 
            ? 'border-green-500 bg-green-500/10' 
            : gpsError
              ? 'border-red-500/50 bg-red-500/5'
              : 'border-zinc-700 hover:border-green-500/50'
        }`}
      >
        {gpsLoading ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin text-green-400" />
        ) : gpsError ? (
          <AlertTriangle className="w-4 h-4 mr-2 text-red-400" />
        ) : (
          <Navigation className="w-4 h-4 mr-2 text-green-400" />
        )}
        <div className="flex-1 text-left">
          <span className={`text-sm ${textPrimary}`}>
            {userCoords ? 'GPS Active' : gpsError ? 'GPS Unavailable' : 'Use My Location'}
          </span>
          {userCoords && nearbySpots.length > 0 && (
            <span className="text-[10px] text-green-400 ml-2">• {nearbySpots.length} spots found</span>
          )}
        </div>
        {userCoords && <Check className="w-4 h-4 text-green-400" />}
      </Button>
      
      {/* GPS Fallback - Browse Spots Manually */}
      {(gpsError || (!userCoords && !showBrowseSpots)) && (
        <Button aria-label="Loader2"
          variant="outline"
          onClick={handleBrowseSpots}
          disabled={spotsLoading || locationLoading}
          className={`w-full justify-start h-10 border-zinc-700 hover:border-cyan-500/50 ${
            showBrowseSpots ? 'border-cyan-500 bg-cyan-500/10' : ''
          }`}
        >
          {(spotsLoading || locationLoading) ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin text-cyan-400" />
          ) : (
            <MapPin className="w-4 h-4 mr-2 text-cyan-400" />
          )}
          <span className={`text-sm ${textPrimary}`}>
            {gpsError ? 'Browse Spots by Location' : 'Browse Spots Manually'}
          </span>
        </Button>
      )}
      
      {/* Location Picker - Country/State/Region selection */}
      {showBrowseSpots && !userCoords && (
        <div className={`p-3 rounded-lg border ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800/50 border-zinc-700'}`}>
          <div className="flex items-center gap-2 mb-3">
            <MapIcon className="w-4 h-4 text-cyan-400" />
            <span className={`text-sm font-medium ${textPrimary}`}>Select Location</span>
          </div>
          
          {locationLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
              <span className={`ml-2 text-xs ${textSecondary}`}>Loading locations...</span>
            </div>
          ) : locationData?.countries?.length > 0 ? (
            <div className="space-y-2">
              {/* Country Dropdown */}
              <div>
                <label className={`text-[10px] ${textSecondary} block mb-1`}>Country</label>
                <select
                  value={selectedCountry}
                  onChange={(e) => handleCountryChange(e.target.value)}
                  className={`w-full h-9 px-3 rounded-md text-sm ${
                    isLight 
                      ? 'bg-white border-gray-300 text-gray-900' 
                      : 'bg-zinc-900 border-zinc-600 text-white'
                  } border focus:outline-none focus:ring-2 focus:ring-cyan-500/50`}
                >
                  <option value="">Select a country...</option>
                  {locationData.countries.map(country => (
                    <option key={country.name} value={country.name}>
                      {country.name} ({country.spot_count} spots)
                    </option>
                  ))}
                </select>
              </div>
              
              {/* State/Province Dropdown - only show if country selected and has states */}
              {selectedCountry && locationData.countries.find(c => c.name === selectedCountry)?.states?.length > 0 && (
                <div>
                  <label className={`text-[10px] ${textSecondary} block mb-1`}>State / Province</label>
                  <select
                    value={selectedState}
                    onChange={(e) => handleStateChange(e.target.value)}
                    className={`w-full h-9 px-3 rounded-md text-sm ${
                      isLight 
                        ? 'bg-white border-gray-300 text-gray-900' 
                        : 'bg-zinc-900 border-zinc-600 text-white'
                    } border focus:outline-none focus:ring-2 focus:ring-cyan-500/50`}
                  >
                    <option value="">All states in {selectedCountry}</option>
                    {locationData.countries
                      .find(c => c.name === selectedCountry)?.states
                      .map(state => (
                        <option key={state.name} value={state.name}>
                          {state.name} ({state.spot_count} spots)
                        </option>
                      ))
                    }
                  </select>
                </div>
              )}
              
              {/* Selected location indicator */}
              {selectedCountry && (
                <div className={`text-[10px] ${textSecondary} flex items-center gap-1`}>
                  <Check className="w-3 h-3 text-cyan-400" />
                  Showing spots in {selectedState || selectedCountry}
                  {nearbySpots.length > 0 && ` (${nearbySpots.length} found)`}
                </div>
              )}
            </div>
          ) : (
            <div className={`text-xs ${textSecondary} text-center py-2`}>
              No locations available. Try using GPS instead.
            </div>
          )}
        </div>
      )}
      
      {/* Quick Picks - Photographer's Home Break & Nearest Pier */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleHomeBreakSelect}
          className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all text-left ${
            location?.type === 'home_break' || location?.preset_id === 'home'
              ? 'border-yellow-500 bg-yellow-500/10' 
              : 'border-zinc-700 hover:border-zinc-600'
          }`}
        >
          <Star className={`w-3.5 h-3.5 flex-shrink-0 ${
            location?.type === 'home_break' || location?.preset_id === 'home' ? 'text-yellow-400' : 'text-gray-500'
          }`} />
          <div className="flex-1 min-w-0">
            <span className={`text-xs font-medium ${textPrimary} block truncate`}>
              {photographerHomeBreak ? photographerHomeBreak.split(',')[0].trim() : 'Home Break'}
            </span>
            <span className={`text-[10px] ${textSecondary} truncate block`}>No travel fee</span>
          </div>
        </button>
        
        <button
          onClick={handleNearestPierSelect}
          disabled={!userCoords && !nearestPier}
          className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all text-left ${
            nearestPier && location?.spot_id === nearestPier.id
              ? 'border-cyan-500 bg-cyan-500/10' 
              : !userCoords
                ? 'border-zinc-700 opacity-60'
                : 'border-zinc-700 hover:border-zinc-600'
          }`}
        >
          <Anchor className={`w-3.5 h-3.5 flex-shrink-0 ${
            nearestPier && location?.spot_id === nearestPier.id ? 'text-cyan-400' : 'text-gray-500'
          }`} />
          <div className="flex-1 min-w-0">
            <span className={`text-xs font-medium ${textPrimary} block truncate`}>
              {nearestPier ? nearestPier.name : 'Nearest Pier'}
            </span>
            <span className={`text-[10px] ${textSecondary} truncate block`}>
              {nearestPier 
                ? `${nearestPier.distance_miles?.toFixed(1) || '?'} mi away`
                : userCoords 
                  ? 'No pier nearby' 
                  : 'Use GPS first'
              }
            </span>
          </div>
        </button>
      </div>
      
      {/* Travel Fee Notice */}
      {chargesTravelFees && travelSurcharges.some(t => t.surcharge > 0) && (
        <div className={`p-2 rounded-lg ${isLight ? 'bg-amber-50' : 'bg-amber-500/10'} border border-amber-500/30`}>
          <div className="flex items-start gap-2">
            <DollarSign className="w-3.5 h-3.5 text-amber-400 mt-0.5" />
            <div className="text-[10px] space-y-0.5">
              <p className={`${textPrimary} font-medium`}>Travel fees for distant locations</p>
              <p className={textSecondary}>
                {travelSurcharges.filter(t => t.surcharge > 0).slice(0, 3).map(t => 
                  `${t.min_miles}-${t.max_miles}mi: +$${t.surcharge}`
                ).join(' • ')}
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* Loading state for spots */}
      {spotsLoading && (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
          <span className={`ml-2 text-xs ${textSecondary}`}>Finding surf spots...</span>
        </div>
      )}
      
      {/* Nearby Spots List - Show after GPS enabled OR manual browse with location selected */}
      {(userCoords || (showBrowseSpots && selectedCountry)) && !spotsLoading && nearbySpots.length > 0 && (
        <div className="space-y-2">
          {/* Section Header */}
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${textPrimary}`}>
              <MapPin className="w-3 h-3 inline mr-1 text-cyan-400" />
              {userCoords 
                ? `Spots Near You (${nearbySpots.length})` 
                : `Spots in ${selectedState || selectedCountry} (${nearbySpots.length})`
              }
            </span>
          </div>
          
          {/* Tier Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            <button
              onClick={() => setSelectedTier('all')}
              className={`px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-all ${
                selectedTier === 'all' 
                  ? 'bg-cyan-500 text-black' 
                  : 'bg-zinc-700 text-gray-300 hover:bg-zinc-600'
              }`}
            >
              All ({nearbySpots.length})
            </button>
            <button
              onClick={() => setSelectedTier('local')}
              className={`px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-all ${
                selectedTier === 'local' 
                  ? 'bg-green-500 text-black' 
                  : 'bg-zinc-700 text-gray-300 hover:bg-zinc-600'
              }`}
            >
              No Fee ({localSpots.length})
            </button>
            {extendedSpots.length > 0 && (
              <button
                onClick={() => setSelectedTier('extended')}
                className={`px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-all ${
                  selectedTier === 'extended' 
                    ? 'bg-yellow-500 text-black' 
                    : 'bg-zinc-700 text-gray-300 hover:bg-zinc-600'
                }`}
              >
                +Fee ({extendedSpots.length})
              </button>
            )}
          </div>
          
          {/* Search within spots */}
          {nearbySpots.length > 8 && (
            <Input aria-label="Search spots..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search spots..."
              className={`h-8 text-xs ${isLight ? 'bg-white' : 'bg-zinc-900'}`}
            />
          )}
          
          {/* Spots List */}
          <div className="space-y-1 max-h-[180px] overflow-y-auto">
            {displayedSpots.length === 0 ? (
              <p className={`text-xs ${textSecondary} text-center py-2`}>No spots match filter</p>
            ) : (
              displayedSpots.map((spot) => {
                const feeBadge = getFeeBadge(spot);
                const isOutOfRange = feeBadge.text === 'Out of Range';
                const isSelected = location?.spot_id === spot.id;
                const isPier = spot.name.toLowerCase().includes('pier') || spot.name.toLowerCase().includes('jetty');
                
                return (
                  <button
                    key={spot.id}
                    onClick={() => handleSpotSelect(spot)}
                    disabled={isOutOfRange}
                    className={`w-full flex items-center gap-2 p-2 rounded-lg border transition-all ${
                      isOutOfRange
                        ? 'border-red-500/30 bg-red-500/5 opacity-50 cursor-not-allowed'
                        : isSelected 
                          ? 'border-cyan-500 bg-cyan-500/10' 
                          : 'border-zinc-700 hover:border-zinc-600'
                    }`}
                  >
                    {isPier ? (
                      <Anchor className={`w-3.5 h-3.5 flex-shrink-0 ${
                        isOutOfRange ? 'text-red-400' : isSelected ? 'text-cyan-400' : 'text-gray-500'
                      }`} />
                    ) : (
                      <MapPin className={`w-3.5 h-3.5 flex-shrink-0 ${
                        isOutOfRange ? 'text-red-400' : isSelected ? 'text-cyan-400' : 'text-gray-500'
                      }`} />
                    )}
                    <div className="flex-1 min-w-0 text-left">
                      <span className={`text-xs block truncate ${textPrimary}`}>{spot.name}</span>
                      {spot.distanceFromUser != null && (
                        <span className={`text-[10px] ${textSecondary}`}>
                          {spot.distanceFromUser.toFixed(1)} mi from you
                        </span>
                      )}
                    </div>
                    <Badge className={`text-[10px] px-1.5 py-0 ${feeBadge.color}`}>
                      {feeBadge.text}
                    </Badge>
                    {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
          
          {/* Show more button */}
          {filteredSpots.length > 6 && (
            <button 
              aria-expanded={showAllSpots} onClick={() => setShowAllSpots(!showAllSpots)}
              className={`w-full text-center text-[10px] text-cyan-400 hover:underline py-1`}
            >
              {showAllSpots ? 'Show less' : `Show all ${filteredSpots.length} spots`}
            </button>
          )}
        </div>
      )}
      
      {/* No spots found message */}
      {(userCoords || showBrowseSpots) && !spotsLoading && nearbySpots.length === 0 && (
        <p className={`text-xs ${textSecondary} text-center py-2`}>No spots found within {serviceRadius} miles</p>
      )}
      
      {/* Manual Input - Collapsed by default */}
      <div className="space-y-1.5">
        <span className={`text-xs ${textSecondary}`}>Or describe a meetup spot:</span>
        <div className="flex gap-2">
          <Input aria-label="e.g., North side of the pier"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="e.g., North side of the pier"
            className={`flex-1 h-9 text-xs ${isLight ? 'bg-white' : 'bg-zinc-900'} ${textPrimary}`}
            onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
          />
          <Button
            size="sm"
            onClick={handleManualSubmit}
            disabled={!manualInput.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-black h-9 px-3 text-xs"
          >
            Set
          </Button>
        </div>
      </div>
      
      {/* Range Error */}
      {rangeError && (
        <div className={`p-2 rounded-lg ${isLight ? 'bg-red-50' : 'bg-red-500/10'} border border-red-500/30`}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className={`text-xs ${textSecondary}`}>{rangeError.message}</p>
          </div>
        </div>
      )}
      
      {/* Travel Surcharge Notice */}
      {travelSurcharge > 0 && !rangeError && (
        <div className={`p-2 rounded-lg ${isLight ? 'bg-yellow-50' : 'bg-yellow-500/10'} border border-yellow-500/30`}>
          <div className="flex items-center gap-2">
            <DollarSign className="w-3.5 h-3.5 text-yellow-400" />
            <span className={`text-xs ${textPrimary}`}>
              Travel fee: <strong className="text-yellow-400">+${travelSurcharge.toFixed(2)}</strong>
            </span>
          </div>
        </div>
      )}
      
      {/* Selected Location Confirmation */}
      {location && !rangeError && (
        <div className={`p-2 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'} border border-green-500/30`}>
          <div className="flex items-center gap-2">
            <Check className="w-3.5 h-3.5 text-green-400" />
            <span className={`text-xs ${textPrimary} truncate`}>{location.description}</span>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Account Credit Application Component
 */
const _AccountCreditSection = ({
  userCredits,
  totalPrice,
  appliedCredits,
  onAppliedCreditsChange,
  isLight
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  const maxApplicable = Math.min(userCredits, totalPrice);
  const remainingToPay = Math.max(0, totalPrice - appliedCredits);
  
  if (userCredits <= 0) return null;
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-yellow-400" />
          <Label className={`font-medium ${textPrimary}`}>Account Credit</Label>
        </div>
        <Badge className="bg-yellow-500/20 text-yellow-400">
          ${userCredits.toFixed(2)} available
        </Badge>
      </div>
      
      {/* Slider for partial credit application */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className={textSecondary}>Apply credits:</span>
          <span className="font-bold text-yellow-400">${appliedCredits.toFixed(2)}</span>
        </div>
        
        <Slider
          value={[appliedCredits]}
          onValueChange={([value]) => onAppliedCreditsChange(value)}
          max={maxApplicable}
          min={0}
          step={0.5}
          className="w-full"
        />
        
        <div className="flex justify-between text-xs">
          <span className={textSecondary}>$0</span>
          <span className={textSecondary}>${maxApplicable.toFixed(2)}</span>
        </div>
      </div>
      
      {/* Quick buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAppliedCreditsChange(0)}
          className={`flex-1 ${appliedCredits === 0 ? 'border-yellow-500' : 'border-zinc-700'}`}
        >
          None
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAppliedCreditsChange(maxApplicable / 2)}
          className="flex-1 border-zinc-700"
        >
          Half
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAppliedCreditsChange(maxApplicable)}
          className={`flex-1 ${appliedCredits === maxApplicable ? 'border-yellow-500 bg-yellow-500/10' : 'border-zinc-700'}`}
        >
          Max
        </Button>
      </div>
      
      {/* Payment Summary */}
      <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
        <div className="flex justify-between mb-1">
          <span className={textSecondary}>Session Total</span>
          <span className={textPrimary}>${totalPrice.toFixed(2)}</span>
        </div>
        {appliedCredits > 0 && (
          <div className="flex justify-between mb-1 text-yellow-400">
            <span>Credit Applied</span>
            <span>-${appliedCredits.toFixed(2)}</span>
          </div>
        )}
        <div className={`flex justify-between pt-2 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
          <span className={`font-bold ${textPrimary}`}>Pay with Card</span>
          <span className="font-bold text-green-400">${remainingToPay.toFixed(2)}</span>
        </div>
      </div>
      
      {/* Refund & Protection Policy Notice */}
      <div className="space-y-2">
        <div className={`flex items-start gap-2 p-3 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'} border ${isLight ? 'border-green-200' : 'border-green-500/30'}`}>
          <Check className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
          <p className={`text-xs ${isLight ? 'text-green-700' : 'text-green-300'}`}>
            <strong>Payment Protected:</strong> Your payment is held securely until the session is completed and your content is delivered through our gallery system.
          </p>
        </div>
        
        <div className={`flex items-start gap-2 p-3 rounded-lg ${isLight ? 'bg-amber-50' : 'bg-amber-500/10'} border ${isLight ? 'border-amber-200' : 'border-amber-500/30'}`}>
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className={`text-xs ${isLight ? 'text-amber-700' : 'text-amber-300'}`}>
            <strong>Cancellation Policy:</strong>
            <ul className="mt-1 ml-2 space-y-0.5">
              <li>• More than 48hrs before: 90% refund</li>
              <li>• 24-48hrs before: 50% refund</li>
              <li>• Less than 24hrs: No refund</li>
            </ul>
            <p className="mt-1">Refunds go to your Account Credit balance.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImpactZonePicker;

