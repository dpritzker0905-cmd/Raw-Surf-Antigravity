
import React, { useState, useCallback } from 'react';
import { MapPin, Navigation, Loader2, Check, Target, AlertTriangle, DollarSign } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';
import { toast } from 'sonner';

import { LocationDropdowns } from './impact-zone/LocationDropdowns';
import { QuickPicks } from './impact-zone/QuickPicks';
import { SpotList } from './impact-zone/SpotList';

var ImpactZonePicker = ({ 
  location, 
  onLocationChange,
  onRangeValidation,
  photographer,
  photographerHomeBreak,
  isLight 
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';

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
  
  const handleHomeBreakSelect = () => {
    const desc = photographerHomeBreak || "Photographer's Home Break";
    onLocationChange(photographerCoords.lat && photographerCoords.lng
      ? { latitude: photographerCoords.lat, longitude: photographerCoords.lng, description: desc, type: 'home_break' }
      : { latitude: null, longitude: null, description: desc, type: 'preset', preset_id: 'home' }
    );
    setRangeError(null);
    setTravelSurcharge(0);
    onRangeValidation?.(true, 0);
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
    const { surcharge } = getTravelSurchargeForDistance(spot.distanceFromPhotographer);
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
            <span className="text-[10px] text-green-400 ml-2">- {nearbySpots.length} spots found</span>
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
        <LocationDropdowns 
          isLight={isLight}
          textPrimary={textPrimary}
          textSecondary={textSecondary}
          locationLoading={locationLoading}
          locationData={locationData}
          selectedCountry={selectedCountry}
          selectedState={selectedState}
          handleCountryChange={handleCountryChange}
          handleStateChange={handleStateChange}
          nearbySpots={nearbySpots}
        />
      )}
      
      {/* Quick Picks - Photographer's Home Break & Nearest Pier */}
      <QuickPicks
        location={location}
        photographerHomeBreak={photographerHomeBreak}
        handleHomeBreakSelect={handleHomeBreakSelect}
        nearestPier={nearestPier}
        handleNearestPierSelect={handleNearestPierSelect}
        userCoords={userCoords}
        textPrimary={textPrimary}
        textSecondary={textSecondary}
      />
      
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
                ).join(' - ')}
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
        <SpotList 
          userCoords={userCoords}
          selectedState={selectedState}
          selectedCountry={selectedCountry}
          nearbySpots={nearbySpots}
          selectedTier={selectedTier}
          setSelectedTier={setSelectedTier}
          localSpots={localSpots}
          extendedSpots={extendedSpots}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isLight={isLight}
          textPrimary={textPrimary}
          textSecondary={textSecondary}
          displayedSpots={displayedSpots}
          handleSpotSelect={handleSpotSelect}
          getFeeBadge={getFeeBadge}
          location={location}
          showAllSpots={showAllSpots}
          setShowAllSpots={setShowAllSpots}
          filteredSpotsLength={filteredSpots.length}
        />
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

export default ImpactZonePicker;
