/**
 * ScheduledBookingDrawer - Complete booking flow for scheduled sessions
 * Integrates: ExactTimeSlotPicker, Impact Zone coordinates, Account Credit, Crew Split, Confirmation
 */

import React, { useState, useEffect, useCallback } from 'react';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import {

  Camera, MapPin, Clock, DollarSign, Zap, ChevronRight, ChevronLeft,
  Check, AlertTriangle, Star, Wallet, Target, Sparkles, Bell, Gift,
  Navigation, Map as MapIcon, X, Loader2, CheckCircle2, Radio, CreditCard, Users,
  UserPlus, Search, Crown, Percent, Anchor, Award, Plus
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

import { Button } from './ui/button';

import { Badge } from './ui/badge';

import { Input } from './ui/input';

import { Label } from './ui/label';

import { Slider } from './ui/slider';

import { Switch } from './ui/switch';

import { toast } from 'sonner';

import apiClient, { BACKEND_URL } from '../lib/apiClient';

import { ExactTimeSlotPicker } from './ExactTimeSlotPicker';

import { SavedCrewSelector } from './SavedCrewSelector';

import { SelfieCapture } from './SelfieCapture';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import { ROLES } from '../constants/roles';



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
          console.error('GPS Error:', error);
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
        <Button
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
            <Input
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
              onClick={() => setShowAllSpots(!showAllSpots)}
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
          <Input
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


// ====================================================================
// SHARED SURFBOARD VISUALIZATION (mirrored from OnDemandRequestDrawer)
// ====================================================================
const SCHED_BOARD_COLORS = [
  { fill: '#FCD34D', stroke: '#F59E0B' }, // Yellow — captain
  { fill: '#22D3EE', stroke: '#0891B2' }, // Cyan
  { fill: '#F472B6', stroke: '#DB2777' }, // Pink
  { fill: '#A78BFA', stroke: '#7C3AED' }, // Purple
  { fill: '#34D399', stroke: '#059669' }, // Green
  { fill: '#FB923C', stroke: '#EA580C' }, // Orange
  { fill: '#60A5FA', stroke: '#2563EB' }, // Blue
];

const SchedSurfboardAvatar = ({ member, index, isCaptain, onRemove, isLight }) => {
  const color = SCHED_BOARD_COLORS[index % SCHED_BOARD_COLORS.length];
  return (
    <div className="relative group flex flex-col items-center">
      <svg viewBox="0 0 60 100" className="absolute left-1/2 -translate-x-1/2 top-2 w-12 h-20 pointer-events-none"
        style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>
        <ellipse cx="30" cy="50" rx="12" ry="38" fill={color.fill} stroke={color.stroke} strokeWidth="2" />
        <line x1="30" y1="14" x2="30" y2="86" stroke={color.stroke} strokeWidth="1.5" opacity="0.6" />
        <ellipse cx="30" cy="16" rx="3" ry="2.5" fill={color.stroke} opacity="0.4" />
        <path d="M30 78 L27 86 L30 83 L33 86 Z" fill={color.stroke} opacity="0.7" />
      </svg>
      <div className="relative z-10">
        <div className={`w-11 h-11 rounded-full overflow-hidden ${
          isCaptain ? 'ring-2 ring-yellow-400' : 'ring-2 ring-cyan-400/50'
        } transition-all group-hover:scale-105`}>
          {member.avatar_url ? (
            <img src={getFullUrl(member.avatar_url)} alt={member.name} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${
              isCaptain ? 'bg-gradient-to-br from-yellow-400 to-orange-500' : 'bg-gradient-to-br from-cyan-400 to-blue-500'
            }`}>
              <span className="text-white font-bold text-sm">
                {(member.name || '?')[0].toUpperCase()}
              </span>
            </div>
          )}
        </div>
        {isCaptain && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2">
            <Award className="w-4 h-4 text-yellow-400 drop-shadow-lg" />
          </div>
        )}
        {!isCaptain && onRemove && (
          <button
            onClick={() => onRemove(member.user_id)}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="text-center mt-8 max-w-[70px]">
        <p className={`text-[10px] font-medium ${isLight ? 'text-gray-900' : 'text-white'} truncate`}>
          {isCaptain ? 'You' : (member.name?.split(' ')[0] || 'Crew')}
        </p>
      </div>
    </div>
  );
};

const SchedEmptySeat = ({ onClick, isLight }) => (
  <div className="relative group cursor-pointer flex flex-col items-center" onClick={onClick}>
    <svg viewBox="0 0 60 100" className="absolute left-1/2 -translate-x-1/2 top-2 w-12 h-20 pointer-events-none opacity-40 group-hover:opacity-60 transition-opacity">
      <ellipse cx="30" cy="50" rx="12" ry="38" fill="none" stroke="#64748B" strokeWidth="2" strokeDasharray="6 4" />
      <line x1="30" y1="18" x2="30" y2="82" stroke="#64748B" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
    </svg>
    <div className={`relative z-10 w-11 h-11 rounded-full border-2 border-dashed ${
      isLight ? 'border-cyan-300 bg-cyan-50/50' : 'border-cyan-500/50 bg-cyan-500/10'
    } flex items-center justify-center transition-all group-hover:scale-105 group-hover:border-cyan-400`}>
      <Plus className={`w-5 h-5 ${isLight ? 'text-cyan-400' : 'text-cyan-500'} group-hover:text-cyan-400`} />
    </div>
    <div className="text-center mt-8">
      <p className={`text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>Add crew</p>
    </div>
  </div>
);

/**
 * Crew Split Section - Select crew members to split the cost
 */
const CrewSplitSection = ({
  user,
  enabled,
  onToggle,
  crewMembers,
  onCrewChange,
  totalPrice,
  isLight
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const cardBg = isLight ? 'bg-gray-100' : 'bg-zinc-800';

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [recentBuddies, setRecentBuddies] = useState([]);
  const [following, setFollowing] = useState([]);
  const [_loadingRecent, setLoadingRecent] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Load recent buddies and following when crew split is enabled
  useEffect(() => {
    if (enabled && user?.id) loadRecentAndFollowing();
  }, [enabled, user?.id]);

  const loadRecentAndFollowing = async () => {
    setLoadingRecent(true);
    try {
      const [buddiesRes, followingRes] = await Promise.all([
        apiClient.get(`/users/${user.id}/recent-buddies?limit=10`).catch(() => ({ data: { buddies: [] } })),
        apiClient.get(`/users/${user.id}/following?limit=20`).catch(() => ({ data: { following: [] } }))
      ]);
      setRecentBuddies(buddiesRes.data.buddies || []);
      setFollowing(followingRes.data.following || []);
    } catch (error) {
      logger.error('Failed to load recent/following:', error);
    } finally {
      setLoadingRecent(false);
    }
  };

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await apiClient.get(`/users/search?query=${encodeURIComponent(query)}&limit=10`);
      const selectedIds = crewMembers.map(m => m.user_id);
      setSearchResults((res.data.users || []).filter(u => u.id !== user.id && !selectedIds.includes(u.id)));
    } catch { /* silent */ } finally { setSearching(false); }
  };

  const addMember = (member) => {
    if (crewMembers.some(m => m.user_id === member.id)) return;
    onCrewChange([...crewMembers, {
      user_id: member.id,
      name: member.full_name || member.username,
      username: member.username,
      avatar_url: member.avatar_url,
      payment_status: 'Pending',
      share_amount: 0,
      captain_cover_percent: 0   // 0 = crew member pays their full share
    }]);
    setSearchQuery('');
    setSearchResults([]);
    setShowSearch(false);
    toast.success(`Added ${member.full_name || member.username} to crew!`);
  };

  const removeMember = (userId) => {
    onCrewChange(crewMembers.filter(m => m.user_id !== userId));
  };

  // Update captain coverage % for a specific member
  const updateCoverPercent = (userId, percent) => {
    onCrewChange(crewMembers.map(m =>
      m.user_id === userId ? { ...m, captain_cover_percent: percent } : m
    ));
  };

  // Pricing
  const totalCrew = crewMembers.length + 1; // +1 captain
  const pricePerPerson = totalPrice / totalCrew;

  // Captain's actual payment = their share + whatever they cover for crew members
  const captainCovers = crewMembers.reduce((sum, m) =>
    sum + (pricePerPerson * ((m.captain_cover_percent || 0) / 100)), 0
  );
  const captainActualPay = pricePerPerson + captainCovers;

  // Suggestions (recent buddies + following, deduped)
  const suggestions = [...recentBuddies, ...following].filter((item, idx, self) =>
    idx === self.findIndex(t => t.id === item.id) &&
    item.id !== user.id &&
    !crewMembers.some(m => m.user_id === item.id)
  ).slice(0, 8);

  return (
    <div className="space-y-4">
      {/* ── Split Toggle ── */}
      <div className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
        enabled
          ? isLight ? 'bg-cyan-50 border-cyan-200' : 'bg-cyan-500/10 border-cyan-500/30'
          : cardBg + ' border-transparent'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full ${enabled ? 'bg-cyan-500/20' : 'bg-zinc-700'} flex items-center justify-center`}>
            <Users className={`w-5 h-5 ${enabled ? 'text-cyan-400' : 'text-gray-400'}`} />
          </div>
          <div>
            <p className={`font-medium ${textPrimary}`}>Split with Crew?</p>
            <p className={`text-sm ${textSecondary}`}>
              {enabled ? `${totalCrew} surfers • you pay $${captainActualPay.toFixed(2)}` : 'Share the cost with friends'}
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} data-testid="crew-split-toggle" />
      </div>

      {enabled && (
        <div className="space-y-4">

          {/* ── Ocean / Surfboard Viz ── */}
          <div className={`relative p-4 rounded-2xl overflow-visible ${
            isLight
              ? 'bg-gradient-to-b from-cyan-100 via-blue-50 to-white'
              : 'bg-gradient-to-b from-cyan-900/30 via-blue-900/20 to-zinc-900'
          }`}>
            {/* Wave pattern */}
            <div className="absolute inset-0 opacity-20 overflow-hidden rounded-2xl">
              <svg viewBox="0 0 400 200" className="w-full h-full" preserveAspectRatio="none">
                <path d="M0,100 Q50,80 100,100 T200,100 T300,100 T400,100 V200 H0 Z" fill="currentColor" className="text-cyan-500" opacity="0.3" />
                <path d="M0,120 Q50,100 100,120 T200,120 T300,120 T400,120 V200 H0 Z" fill="currentColor" className="text-blue-500" opacity="0.2" />
              </svg>
            </div>

            {/* Label */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-cyan-400 font-medium flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              THE LINEUP
            </div>

            {/* Boards row */}
            <div className="relative pt-6 flex justify-center items-end gap-4 flex-wrap">
              {/* Captain */}
              <SchedSurfboardAvatar
                member={{ name: user?.full_name || 'You', avatar_url: user?.avatar_url }}
                index={0}
                isCaptain={true}
                isLight={isLight}
              />
              {/* Crew members */}
              {crewMembers.map((m, idx) => (
                <SchedSurfboardAvatar
                  key={m.user_id}
                  member={m}
                  index={idx + 1}
                  isCaptain={false}
                  onRemove={removeMember}
                  isLight={isLight}
                />
              ))}
              {/* Empty seat */}
              {crewMembers.length < 6 && (
                <SchedEmptySeat onClick={() => setShowSearch(true)} isLight={isLight} />
              )}
            </div>
          </div>

          {/* ── Per-Member Coverage Sliders ── */}
          {crewMembers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className={`text-sm font-medium ${textSecondary}`}>Coverage per crew member</h4>
                {/* Quick actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => onCrewChange(crewMembers.map(m => ({ ...m, captain_cover_percent: Math.round(100 / totalCrew) })))}
                    className={`text-xs px-2 py-1 rounded-full ${
                      isLight ? 'bg-gray-100 text-gray-600' : 'bg-zinc-700 text-gray-300'
                    } hover:text-cyan-400 transition-colors`}
                  >
                    Split Even
                  </button>
                  <button
                    onClick={() => onCrewChange(crewMembers.map(m => ({ ...m, captain_cover_percent: 100 })))}
                    className={`text-xs px-2 py-1 rounded-full ${
                      isLight ? 'bg-purple-50 text-purple-600' : 'bg-purple-500/20 text-purple-400'
                    } hover:opacity-80 transition-opacity`}
                  >
                    Cover All
                  </button>
                  <button
                    onClick={() => onCrewChange(crewMembers.map(m => ({ ...m, captain_cover_percent: 0 })))}
                    className={`text-xs px-2 py-1 rounded-full ${
                      isLight ? 'bg-gray-100 text-gray-600' : 'bg-zinc-700 text-gray-300'
                    } hover:text-amber-400 transition-colors`}
                  >
                    Reset
                  </button>
                </div>
              </div>

              {crewMembers.map((member, idx) => {
                const coverPct = member.captain_cover_percent || 0;
                const memberPays = pricePerPerson * (1 - coverPct / 100);
                const captainCoversAmt = pricePerPerson * (coverPct / 100);
                const boardColor = SCHED_BOARD_COLORS[(idx + 1) % SCHED_BOARD_COLORS.length];

                return (
                  <div key={member.user_id} className={`p-4 rounded-xl ${
                    isLight ? 'bg-gray-50 border border-gray-100' : 'bg-muted/50 border border-zinc-700/50'
                  }`}>
                    {/* Member header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                          style={{ backgroundColor: boardColor.fill, color: '#000' }}
                        >
                          {(member.name || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${textPrimary}`}>{member.name}</p>
                          {member.username && (
                            <p className={`text-xs ${textSecondary}`}>@{member.username}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-cyan-400 font-medium">They pay: ${memberPays.toFixed(2)}</p>
                        {captainCoversAmt > 0 && (
                          <p className="text-xs text-purple-400">You cover: ${captainCoversAmt.toFixed(2)}</p>
                        )}
                      </div>
                    </div>

                    {/* % Slider — how much captain covers of this member's share */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs ${textSecondary}`}>
                          You cover {coverPct}% of their share
                        </span>
                        <span className={`text-xs font-bold ${
                          coverPct === 100 ? 'text-purple-400' : coverPct > 0 ? 'text-cyan-400' : textSecondary
                        }`}>
                          {coverPct === 0 ? 'They pay full' : coverPct === 100 ? 'You cover all' : `$${captainCoversAmt.toFixed(2)} covered`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={coverPct}
                        onChange={(e) => updateCoverPercent(member.user_id, parseInt(e.target.value))}
                        className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                        style={{
                          background: `linear-gradient(to right, ${boardColor.fill} 0%, ${boardColor.fill} ${coverPct}%, #3f3f46 ${coverPct}%, #3f3f46 100%)`
                        }}
                      />
                      <div className="flex justify-between mt-1">
                        <span className={`text-[10px] ${textSecondary}`}>0% (they pay)</span>
                        <span className={`text-[10px] ${textSecondary}`}>100% (you cover)</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Search / Add Crew ── */}
          <div className="space-y-2">
            {!showSearch ? (
              <button
                onClick={() => setShowSearch(true)}
                className={`w-full flex items-center gap-2 p-3 rounded-xl border-2 border-dashed ${
                  isLight ? 'border-cyan-300 text-cyan-600' : 'border-cyan-500/40 text-cyan-400'
                } hover:border-cyan-400 transition-colors`}
              >
                <UserPlus className="w-4 h-4" />
                <span className="text-sm font-medium">Add crew member</span>
              </button>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary}`} />
                  <Input
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Search by name or @username..."
                    className={`pl-10 ${isLight ? 'bg-white' : 'bg-zinc-900'}`}
                    autoFocus
                    data-testid="crew-search-input"
                  />
                  {searching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-cyan-400" />
                  )}
                  <button
                    onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}
                    className={`absolute right-9 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full ${
                      isLight ? 'text-gray-400' : 'text-gray-500'
                    } hover:text-red-400`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Search results dropdown */}
                {searchResults.length > 0 && (
                  <div className={`rounded-xl border ${
                    isLight ? 'border-gray-200 bg-white' : 'border-zinc-700 bg-zinc-900'
                  } max-h-48 overflow-y-auto shadow-xl`}>
                    {searchResults.map((result) => (
                      <button
                        key={result.id}
                        onClick={() => addMember(result)}
                        className={`w-full flex items-center gap-3 p-3 hover:${
                          isLight ? 'bg-gray-50' : 'bg-zinc-800'
                        } transition-colors`}
                      >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center overflow-hidden">
                          {result.avatar_url ? (
                            <img src={getFullUrl(result.avatar_url)} alt={result.full_name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-white font-bold text-xs">{result.full_name?.[0]?.toUpperCase() || '?'}</span>
                          )}
                        </div>
                        <div className="text-left flex-1">
                          <p className={`text-sm font-medium ${textPrimary}`}>{result.full_name}</p>
                          <p className={`text-xs ${textSecondary}`}>@{result.username}</p>
                        </div>
                        <UserPlus className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Quick Add Pills (Recent / Following) ── */}
          {suggestions.length > 0 && searchQuery.length < 2 && (
            <div className="space-y-2">
              <Label className={textSecondary}>Quick Add</Label>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((person) => (
                  <button
                    key={person.id}
                    onClick={() => addMember(person)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-full ${cardBg} hover:ring-2 ring-cyan-500/50 transition-all`}
                  >
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center overflow-hidden">
                      {person.avatar_url ? (
                        <img src={getFullUrl(person.avatar_url)} alt={person.full_name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-white font-bold text-xs">{person.full_name?.[0]?.toUpperCase() || '?'}</span>
                      )}
                    </div>
                    <span className={`text-sm ${textPrimary}`}>{person.full_name?.split(' ')[0]}</span>
                    <UserPlus className="w-3 h-3 text-cyan-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Saved Crews ── */}
          <SavedCrewSelector
            onSelect={(members) => {
              onCrewChange(members.map(m => ({
                user_id: m.user_id,
                name: m.name || m.value,
                username: m.value,
                avatar_url: m.avatar_url,
                payment_status: 'Pending',
                share_amount: 0,
                captain_cover_percent: 0
              })));
            }}
            selectedCrew={null}
            currentMembers={crewMembers}
            compact={true}
          />

          {/* ── Split Summary ── */}
          <div className={`p-4 rounded-xl ${
            isLight
              ? 'bg-gradient-to-r from-cyan-50 to-blue-50'
              : 'bg-gradient-to-r from-cyan-500/10 to-blue-500/10'
          } border border-cyan-500/30`}>
            <div className="flex items-center gap-2 mb-3">
              <Percent className="w-5 h-5 text-cyan-400" />
              <span className={`font-medium ${textPrimary}`}>Split Summary</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className={textSecondary}>Total Session</span>
                <span className={textPrimary}>${totalPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className={textSecondary}>Equal share / person</span>
                <span className={textPrimary}>${pricePerPerson.toFixed(2)}</span>
              </div>
              {captainCovers > 0 && (
                <div className="flex justify-between text-purple-400">
                  <span>You cover for crew</span>
                  <span>+${captainCovers.toFixed(2)}</span>
                </div>
              )}
              <div className={`flex justify-between pt-2 border-t ${
                isLight ? 'border-cyan-200' : 'border-cyan-500/30'
              }`}>
                <span className={`font-bold ${textPrimary} flex items-center gap-1`}>
                  <Crown className="w-3 h-3 text-yellow-400" />
                  Your Total (Captain)
                </span>
                <span className="font-bold text-cyan-400">${captainActualPay.toFixed(2)}</span>
              </div>
              {crewMembers.length > 0 && (
                <div className="space-y-1 mt-1">
                  {crewMembers.map((m, idx) => {
                    const coverPct = m.captain_cover_percent || 0;
                    const memberPays = pricePerPerson * (1 - coverPct / 100);
                    return (
                      <div key={m.user_id} className="flex justify-between text-xs">
                        <span className={textSecondary}>
                          {m.name?.split(' ')[0] || 'Crew'}{coverPct > 0 ? ` (${coverPct}% covered)` : ''}
                        </span>
                        <span className={coverPct === 100 ? 'text-purple-400' : textPrimary}>
                          {coverPct === 100 ? 'You cover' : `$${memberPays.toFixed(2)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className={`mt-3 flex items-center gap-2 p-2 rounded-lg ${
              isLight ? 'bg-yellow-50' : 'bg-yellow-500/10'
            }`}>
              <Crown className="w-4 h-4 text-yellow-400" />
              <span className={`text-xs ${textSecondary}`}>
                As Captain, you pay first. Crew receives payment requests via Messages.
              </span>
            </div>
          </div>

        </div>
      )}
    </div>
  );
};

/**
 * Cross-Sell Suggestion Component
 */
const CrossSellSuggestion = ({ type, _photographerName, onAction, isLight }) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  if (type === 'live_now') {
    return (
      <div className={`p-4 rounded-xl ${isLight ? 'bg-gradient-to-r from-green-50 to-emerald-50' : 'bg-gradient-to-r from-green-500/10 to-emerald-500/10'} border border-green-500/30`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
            <Radio className="w-5 h-5 text-green-400 animate-pulse" />
          </div>
          <div className="flex-1">
            <p className={`font-medium ${textPrimary}`}>Can't Wait?</p>
            <p className={`text-sm ${textSecondary}`}>Check if photographers are live NOW</p>
          </div>
          <Button
            size="sm"
            onClick={() => onAction('live_now')}
            className="bg-green-500 hover:bg-green-600 text-black"
          >
            <Zap className="w-4 h-4 mr-1" />
            Live Now
          </Button>
        </div>
      </div>
    );
  }
  
  return null;
};

/**
 * Success Confirmation Modal
 */
const BookingConfirmation = ({ 
  booking, 
  photographer, 
  onClose, 
  onViewBookings,
  onAddAnotherSpot,
  isLight 
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  return (
    <div className="text-center py-6 space-y-6">
      {/* Success Animation */}
      <div className="relative">
        <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-r from-green-500 to-emerald-500 flex items-center justify-center animate-pulse">
          <CheckCircle2 className="w-12 h-12 text-white" />
        </div>
        <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-yellow-400 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-black" />
        </div>
      </div>
      
      <div>
        <h3 className={`text-2xl font-bold ${textPrimary}`}>Session Booked!</h3>
        <p className={textSecondary}>
          Your session with {photographer?.full_name} is confirmed
        </p>
      </div>
      
      {/* Booking Details */}
      <div className={`p-4 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} text-left space-y-3`}>
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-yellow-400" />
          <div>
            <p className={`font-medium ${textPrimary}`}>
              {booking?.session_date ? new Date(booking.session_date).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              }) : 'Date TBD'}
            </p>
            <p className={`text-sm ${textSecondary}`}>{booking?.duration || 60} minutes</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-orange-400" />
          <div>
            <p className={`font-medium ${textPrimary}`}>Impact Zone</p>
            <p className={`text-sm ${textSecondary}`}>{booking?.location || 'Location set'}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <DollarSign className="w-5 h-5 text-green-400" />
          <div>
            <p className={`font-medium ${textPrimary}`}>${booking?.total_paid?.toFixed(2) || '0.00'}</p>
            <p className={`text-sm ${textSecondary}`}>Total Paid</p>
          </div>
        </div>
      </div>
      
      {/* Push Notification Notice */}
      <div className={`flex items-center gap-2 p-3 rounded-lg ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'} border ${isLight ? 'border-blue-200' : 'border-blue-500/30'}`}>
        <Bell className="w-5 h-5 text-blue-400" />
        <p className={`text-sm ${isLight ? 'text-blue-700' : 'text-blue-300'}`}>
          You'll receive a notification when it's time to head out!
        </p>
      </div>
      
      {/* Gamification - XP Earned */}
      <div className={`flex items-center justify-center gap-2 p-3 rounded-lg bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30`}>
        <Gift className="w-5 h-5 text-purple-400" />
        <span className={`font-medium ${textPrimary}`}>+50 XP earned!</span>
        <Badge className="bg-purple-500/20 text-purple-400 text-xs">Passport</Badge>
      </div>
      
      {/* Escrow Protection Notice */}
      <div className={`flex items-center gap-2 p-3 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'} border ${isLight ? 'border-green-200' : 'border-green-500/30'}`}>
        <Check className="w-5 h-5 text-green-400" />
        <p className={`text-sm ${isLight ? 'text-green-700' : 'text-green-300'}`}>
          Payment protected until session complete & content delivered
        </p>
      </div>
      
      {/* Actions */}
      <div className="flex flex-col gap-3">
        <Button
          onClick={onAddAnotherSpot}
          className="w-full bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-500 hover:to-blue-600 text-black font-bold"
          data-testid="add-another-spot-btn"
        >
          <MapPin className="w-4 h-4 mr-2" />
          Add Another Spot to This Trip
        </Button>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 border-zinc-700"
          >
            Close
          </Button>
          <Button
            onClick={onViewBookings}
            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black"
          >
            View My Bookings
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Main Scheduled Booking Drawer Component
 */
export const ScheduledBookingDrawer = ({
  isOpen,
  onClose,
  photographer,
  _onSuccess
}) => {
  const { user, updateUser } = useAuth();
  const { theme } = useTheme();
  
  // Step management: 'time' -> 'location' -> 'crew' -> 'payment' -> 'selfie' -> 'confirm' -> 'success'
  const [step, setStep] = useState('time');
  const [selfieUrl, setSelfieUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Time slot state
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedDuration, setSelectedDuration] = useState(60);
  
  // Location state
  const [impactZone, setImpactZone] = useState(null);
  const [locationValid, setLocationValid] = useState(true);
  const [travelSurcharge, setTravelSurcharge] = useState(0);
  
  // Crew split state
  const [crewSplitEnabled, setCrewSplitEnabled] = useState(false);
  const [crewMembers, setCrewMembers] = useState([]);
  
  // Payment state
  const [appliedCredits, setAppliedCredits] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('card'); // Default to 'card' to ensure Stripe flow
  
  // Booking result
  const [bookingResult, setBookingResult] = useState(null);
  
  const isLight = theme === 'light';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const bgCard = isLight ? 'bg-white' : 'bg-zinc-900';
  
  // Calculate pricing - MUST match backend calculation
  // For scheduled bookings: booking_hourly_rate || hourly_rate || session_price || 75
  const baseRate = photographer?.booking_hourly_rate || photographer?.hourly_rate || photographer?.session_price || 75;
  const durationMultiplier = DURATION_PRICES[selectedDuration] || 1;
  const basePrice = baseRate * durationMultiplier;
  
  // Group discounts
  const groupDiscount2 = photographer?.group_discount_2_plus || 0;
  const groupDiscount3 = photographer?.group_discount_3_plus || 0;
  const groupDiscount5 = photographer?.group_discount_5_plus || 0;
  
  // Calculate participants based on crew
  const maxParticipants = crewSplitEnabled ? crewMembers.length + 1 : 1;
  let groupDiscountPercent = 0;
  if (maxParticipants >= 5 && groupDiscount5 > 0) groupDiscountPercent = groupDiscount5;
  else if (maxParticipants >= 3 && groupDiscount3 > 0) groupDiscountPercent = groupDiscount3;
  else if (maxParticipants >= 2 && groupDiscount2 > 0) groupDiscountPercent = groupDiscount2;
  
  const discountAmount = (basePrice * groupDiscountPercent) / 100;
  // Include travel surcharge in total price
  const totalPrice = basePrice - discountAmount + travelSurcharge;
  const pricePerPerson = totalPrice / maxParticipants;
  // Captain covers their own equal share + anything they chose to cover for crew
  const captainCoverageExtra = crewMembers.reduce(
    (sum, m) => sum + (pricePerPerson * ((m.captain_cover_percent || 0) / 100)), 0
  );
  const captainShare = pricePerPerson + captainCoverageExtra;
  const userCredits = user?.credit_balance || 0;
  
  // Check if group discounts are available (for display)
  const _hasGroupDiscounts = groupDiscount2 > 0 || groupDiscount3 > 0 || groupDiscount5 > 0;
  
  // Reset state when drawer opens
  useEffect(() => {
    if (isOpen) {
      setStep('time');
      setSelectedDate(null);
      setSelectedTime(null);
      setSelectedCategory(null);
      setSelectedDuration(60);
      setImpactZone(null);
      setLocationValid(true);
      setTravelSurcharge(0);
      setCrewSplitEnabled(false);
      setCrewMembers([]);
      setAppliedCredits(0);
      setBookingResult(null);
      setSelfieUrl(null);
    }
  }, [isOpen]);
  
  // Auto-apply credits only if payment method is 'credits'
  useEffect(() => {
    if (paymentMethod === 'credits') {
      const amountToPay = crewSplitEnabled ? captainShare : totalPrice;
      if (userCredits > 0 && amountToPay > 0) {
        setAppliedCredits(Math.min(userCredits, amountToPay));
      }
    } else if (paymentMethod === 'card') {
      // For card payment, reset applied credits to 0 (user can manually add via slider)
      setAppliedCredits(0);
    }
  }, [userCredits, totalPrice, captainShare, crewSplitEnabled, paymentMethod]);
  
  const canProceedFromTime = selectedDate && selectedTime && selectedDuration && selectedCategory;
  const canProceedFromLocation = impactZone && impactZone.description && locationValid;
  const canProceedFromCrew = !crewSplitEnabled || crewMembers.length >= 1; // Need at least 1 crew member if split enabled
  
  // Handler for range validation from ImpactZonePicker
  const handleRangeValidation = (isValid, surcharge) => {
    setLocationValid(isValid);
    setTravelSurcharge(surcharge);
  };
  
  const handleBack = () => {
    if (step === 'location') setStep('time');
    else if (step === 'crew') setStep('location');
    else if (step === 'payment') setStep('crew');
    else if (step === 'selfie') setStep('payment');
    else if (step === 'confirm') setStep('selfie');
  };
  
  const handleNext = () => {
    if (step === 'time' && canProceedFromTime) setStep('location');
    else if (step === 'location' && canProceedFromLocation) setStep('crew');
    else if (step === 'crew' && canProceedFromCrew) setStep('payment');
    else if (step === 'payment') setStep('selfie');
    else if (step === 'selfie') setStep('confirm');
  };
  
  // Calculate payment window based on session time
  const calculatePaymentWindow = () => {
    if (!selectedDate || !selectedTime) return null;
    
    const sessionDateTime = new Date(selectedDate);
    const [hours, minutes] = selectedTime.split(':');
    sessionDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    
    const now = new Date();
    const hoursUntilSession = (sessionDateTime - now) / (1000 * 60 * 60);
    
    // If session is within 72 hours, payment window is 24 hours before session
    // Otherwise, payment window is 72 hours from booking
    if (hoursUntilSession <= 72) {
      // Payment due 24 hours before session
      const paymentDeadline = new Date(sessionDateTime);
      paymentDeadline.setHours(paymentDeadline.getHours() - 24);
      return paymentDeadline;
    } else {
      // Payment due in 72 hours
      const paymentDeadline = new Date(now);
      paymentDeadline.setHours(paymentDeadline.getHours() + 72);
      return paymentDeadline;
    }
  };
  
  const handleSubmitBooking = async () => {
    setLoading(true);
    
    try {
      // Build the exact session datetime
      const sessionDateTime = new Date(selectedDate);
      const [hours, minutes] = selectedTime.split(':');
      sessionDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      
      // Calculate captain's payment amount
      const captainPaymentAmount = crewSplitEnabled ? captainShare : totalPrice;
      const amountToCharge = Math.max(0, captainPaymentAmount - appliedCredits);
      
      // Calculate payment window for crew
      const paymentWindowExpires = calculatePaymentWindow();
      
      // Prepare crew member data for backend (use actual out-of-pocket per member)
      const crewMemberData = crewMembers.map(m => ({
        user_id: m.user_id,
        name: m.name,
        share_amount: parseFloat((pricePerPerson * (1 - (m.captain_cover_percent || 0) / 100)).toFixed(2))
      }));
      
      // If there's an amount to charge and user selected card payment
      if (amountToCharge > 0 && paymentMethod === 'card') {
        // Create booking with pending payment status and redirect to Stripe
        const response = await apiClient.post(`/bookings/create-with-stripe?user_id=${user.id}`, {
          photographer_id: photographer.id,
          location: impactZone.description,
          session_date: sessionDateTime.toISOString(),
          duration: selectedDuration,
          max_participants: maxParticipants,
          allow_splitting: crewSplitEnabled,
          split_mode: 'friends_only',
          crew_members: crewMemberData,
          payment_window_expires: paymentWindowExpires?.toISOString(),
          latitude: impactZone.latitude || null,
          longitude: impactZone.longitude || null,
          description: `${selectedCategory} session`,
          apply_credits: appliedCredits,
          impact_zone_type: impactZone.type,
          impact_zone_preset: impactZone.preset_id || null,
          origin_url: window.location.origin
        });
        
        // Update credits if partially applied
        if (appliedCredits > 0 && response.data.remaining_credits !== undefined) {
          updateUser({ credit_balance: response.data.remaining_credits });
        }
        
        // Redirect to Stripe checkout
        if (response.data.checkout_url) {
          window.location.href = response.data.checkout_url;
          return;
        }
      }
      
      // Full credit payment or credits cover everything
      const response = await apiClient.post(`/bookings/create?user_id=${user.id}`, {
        photographer_id: photographer.id,
        location: impactZone.description,
        session_date: sessionDateTime.toISOString(),
        duration: selectedDuration,
        max_participants: maxParticipants,
        allow_splitting: crewSplitEnabled,
        split_mode: 'friends_only',
        crew_members: crewMemberData,
        payment_window_expires: paymentWindowExpires?.toISOString(),
        latitude: impactZone.latitude || null,
        longitude: impactZone.longitude || null,
        description: `${selectedCategory} session`,
        // Credit application
        apply_credits: appliedCredits,
        // Impact zone details
        impact_zone_type: impactZone.type,
        impact_zone_preset: impactZone.preset_id || null
      });
      
      // Update user credits if applied
      if (appliedCredits > 0 && response.data.remaining_credits !== undefined) {
        updateUser({ credit_balance: response.data.remaining_credits });
      }
      
      // If crew split is enabled, send payment requests to crew members
      if (crewSplitEnabled && crewMembers.length > 0 && response.data.booking?.id) {
        try {
          await apiClient.post(`/bookings/${response.data.booking.id}/send-crew-requests?user_id=${user.id}`, {
            crew_members: crewMemberData,
            price_per_person: pricePerPerson,
            payment_deadline: paymentWindowExpires?.toISOString(),
            session_date: sessionDateTime.toISOString(),
            photographer_name: photographer.full_name
          });
        } catch (crewError) {
          logger.error('Failed to send crew payment requests:', crewError);
          // Don't fail the booking, just notify
          toast.warning('Booking created but crew notifications may be delayed');
        }
      }
      
      setBookingResult({
        ...response.data,
        session_date: sessionDateTime.toISOString(),
        location: impactZone.description,
        duration: selectedDuration,
        total_paid: crewSplitEnabled ? captainShare : totalPrice,
        credits_applied: appliedCredits,
        crew_split: crewSplitEnabled,
        crew_count: maxParticipants,
        price_per_person: pricePerPerson
      });
      
      // Upload selfie for the booking if captured
      if (selfieUrl && response.data.booking?.id) {
        try {
          await apiClient.patch(`/bookings/${response.data.booking.id}/participant-selfie`, {
            participant_id: user.id,
            selfie_url: selfieUrl
          });
          logger.info('Selfie uploaded for booking');
        } catch (selfieError) {
          logger.error('Failed to upload selfie:', selfieError);
          // Don't fail the booking, selfie can be added later
        }
      }
      
      setStep('success');
      toast.success('Session booked successfully!');
      
    } catch (error) {
      logger.error('Booking error:', error);
      
      // Handle time slot conflict specifically
      if (error.response?.status === 409) {
        toast.error(error.response?.data?.detail || 'This time slot is already booked. Please select a different time.');
      } else {
        toast.error(error.response?.data?.detail || 'Failed to create booking');
      }
    } finally {
      setLoading(false);
    }
  };
  
  const handleCrossSellAction = (action) => {
    if (action === 'live_now') {
      onClose();
      // Navigate to live now tab - will be handled by parent
      window.location.href = '/bookings?tab=live_now';
    }
  };
  
  const isPro = photographer?.role === ROLES.APPROVED_PRO || photographer?.role === ROLES.PRO;
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className={`${bgCard} border-zinc-800 sm:max-w-lg`}
      >
        {/* Fixed Header */}
        <div className="shrink-0 px-4 sm:px-6 pt-4 pb-2 border-b border-zinc-800">
          <DialogHeader>
            <DialogTitle className={`text-base font-bold ${textPrimary} flex items-center gap-2`}>
              <Camera className="w-4 h-4 text-yellow-400" />
              Book Session
            </DialogTitle>
          </DialogHeader>
        </div>
        
        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-3"
          style={{ minHeight: 0 }}>
        
        
          {/* Photographer Info Header - Compact */}
          {step !== 'success' && (
            <div className={`p-2 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800'} mb-3`}>
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full overflow-hidden flex-shrink-0 ${isPro ? 'ring-2 ring-yellow-400' : 'ring-1 ring-cyan-400/50'}`}>
                  {photographer?.avatar_url ? (
                    <img src={getFullUrl(photographer.avatar_url)} alt={photographer.full_name} className="w-full h-full object-cover" />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`}>
                      <Camera className="w-3 h-3 text-gray-400" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className={`font-semibold text-xs ${textPrimary} truncate`}>{photographer?.full_name}</h3>
                    {isPro && (
                      <Badge className="bg-yellow-500/20 text-yellow-400 text-[10px] px-1 py-0">PRO</Badge>
                    )}
                  </div>
                  <p className={`text-[10px] ${textSecondary}`}>
                    From <span className="text-yellow-400 font-bold">${baseRate}</span>/session
                  </p>
                </div>
              </div>
            </div>
          )}
        
          {/* Step Progress - Ultra Compact */}
          {step !== 'success' && (
            <div className="flex items-center justify-center gap-0.5 mb-3">
              {['time', 'location', 'crew', 'payment', 'selfie', 'confirm'].map((s, idx) => (
                <React.Fragment key={s}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                    step === s 
                      ? 'bg-yellow-500 text-black' 
                      : idx < ['time', 'location', 'crew', 'payment', 'selfie', 'confirm'].indexOf(step)
                        ? 'bg-green-500 text-white'
                        : 'bg-zinc-700 text-gray-400'
                  }`}>
                    {idx < ['time', 'location', 'crew', 'payment', 'selfie', 'confirm'].indexOf(step) ? (
                      <Check className="w-2.5 h-2.5" />
                    ) : (
                      idx + 1
                    )}
                  </div>
                  {idx < 5 && (
                    <div className={`w-2 h-0.5 flex-shrink-0 ${
                      idx < ['time', 'location', 'crew', 'payment', 'selfie', 'confirm'].indexOf(step) 
                        ? 'bg-green-500' 
                        : 'bg-zinc-700'
                    }`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
        
          {/* Step 1: Time Selection */}
          {step === 'time' && (
            <div className="space-y-3 pb-2">
              <ExactTimeSlotPicker
                selectedDate={selectedDate}
                selectedTime={selectedTime}
                selectedCategory={selectedCategory}
                selectedDuration={selectedDuration}
                onDateChange={setSelectedDate}
                onTimeChange={setSelectedTime}
                onCategoryChange={setSelectedCategory}
                onDurationChange={setSelectedDuration}
              />
              
              {/* Cross-sell - Live Now suggestion - Hidden on mobile to save space */}
              <div className="hidden sm:block">
                <CrossSellSuggestion 
                  type="live_now" 
                  photographerName={photographer?.full_name}
                  onAction={handleCrossSellAction}
                  isLight={isLight}
                />
              </div>
            </div>
          )}
        
          {/* Step 2: Impact Zone Location */}
          {step === 'location' && (
            <div className="space-y-3 pb-2">
              <ImpactZonePicker
                location={impactZone}
                onLocationChange={setImpactZone}
                onRangeValidation={handleRangeValidation}
                photographer={photographer}
                photographerHomeBreak={photographer?.home_break}
                isLight={isLight}
              />
            </div>
          )}
        
          {/* Step 3: Crew Split */}
          {step === 'crew' && (
            <div className="space-y-4 pb-4">
              <div className="text-center mb-2">
                <h3 className={`font-semibold ${textPrimary}`}>Split the Cost?</h3>
                <p className={`text-sm ${textSecondary}`}>Share this session with friends</p>
              </div>
              
              <CrewSplitSection
                user={user}
                enabled={crewSplitEnabled}
                onToggle={setCrewSplitEnabled}
                crewMembers={crewMembers}
                onCrewChange={setCrewMembers}
                totalPrice={totalPrice}
                isLight={isLight}
              />
              
              {/* Group Discount Applied Notice */}
              {crewSplitEnabled && groupDiscountPercent > 0 && (
                <div className={`p-3 rounded-lg bg-gradient-to-r ${isLight ? 'from-green-50 to-emerald-50' : 'from-green-500/10 to-emerald-500/10'} border border-green-500/30`}>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-green-400" />
                    <span className={`text-sm font-medium text-green-400`}>
                      {groupDiscountPercent}% Group Discount Applied!
                    </span>
                  </div>
                  <p className={`text-xs ${textSecondary} mt-1`}>
                    You're saving ${discountAmount.toFixed(2)} with {maxParticipants} surfers
                  </p>
                </div>
              )}
            </div>
          )}
        
          {/* Step 4: Payment */}
          {step === 'payment' && (
            <div className="space-y-4 pb-4">
              {/* Session Summary */}
              <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                <h4 className={`font-medium text-sm ${textPrimary} mb-2`}>Session Summary</h4>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className={textSecondary}>Date & Time</span>
                    <span className={textPrimary}>
                      {selectedDate?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {selectedTime}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className={textSecondary}>Duration</span>
                    <span className={textPrimary}>{selectedDuration} min</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={textSecondary}>Location</span>
                    <span className={`${textPrimary} truncate ml-2 max-w-[150px]`}>{impactZone?.description}</span>
                  </div>
                  {crewSplitEnabled && (
                    <>
                      <div className="flex justify-between">
                        <span className={textSecondary}>Crew Size</span>
                        <span className={textPrimary}>{maxParticipants} surfers</span>
                      </div>
                      {groupDiscountPercent > 0 && (
                        <div className="flex justify-between text-green-400">
                          <span>Group Discount ({groupDiscountPercent}%)</span>
                          <span>-${discountAmount.toFixed(2)}</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className={`flex justify-between pt-2 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
                    <span className={`font-bold ${textPrimary}`}>Total</span>
                    <span className="font-bold text-yellow-400">${totalPrice.toFixed(2)}</span>
                  </div>
                  {crewSplitEnabled && (
                    <div className="flex justify-between">
                      <span className={`font-bold ${textPrimary} flex items-center gap-1`}>
                        <Crown className="w-3 h-3 text-yellow-400" />
                        Your Share
                      </span>
                      <span className="font-bold text-cyan-400">${captainShare.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Crew Payment Info */}
              {crewSplitEnabled && crewMembers.length > 0 && (
                <div className={`p-2 rounded-lg ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'} border ${isLight ? 'border-cyan-200' : 'border-cyan-500/30'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="w-3 h-3 text-cyan-400" />
                    <span className={`text-xs font-medium ${textPrimary}`}>Crew Payments</span>
                  </div>
                  <p className={`text-xs ${textSecondary}`}>
                    ${pricePerPerson.toFixed(2)} each sent to crew via Messages.
                  </p>
                </div>
              )}
              
              {/* Payment Method Selection */}
              {(() => {
                const amountToPay = crewSplitEnabled ? captainShare : totalPrice;
                const canPayFullWithCredits = userCredits >= amountToPay;
                
                return (
                  <div className="space-y-2">
                    <Label className={`font-medium text-sm ${textPrimary}`}>Payment Method</Label>
                    
                    {/* Option 1: Pay with Credits */}
                    {userCredits > 0 && (
                      <button
                        onClick={() => {
                          setPaymentMethod('credits');
                          setAppliedCredits(Math.min(userCredits, amountToPay));
                        }}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                          paymentMethod === 'credits'
                            ? 'border-yellow-400 bg-yellow-500/10'
                            : isLight ? 'border-gray-200 bg-white' : 'border-zinc-700 bg-zinc-800/50'
                        }`}
                        data-testid="pay-with-credits-btn"
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          paymentMethod === 'credits' ? 'bg-yellow-400 text-black' : 'bg-zinc-700 text-gray-400'
                        }`}>
                          <Wallet className="w-4 h-4" />
                        </div>
                        <div className="flex-1 text-left">
                          <div className={`font-medium text-sm ${textPrimary}`}>Account Credits</div>
                          <div className={`text-xs ${textSecondary}`}>
                            ${userCredits.toFixed(2)} available
                            {canPayFullWithCredits && <span className="text-green-400 ml-1">(covers all!)</span>}
                          </div>
                        </div>
                        {paymentMethod === 'credits' && (
                          <Check className="w-4 h-4 text-yellow-400" />
                        )}
                      </button>
                    )}
                    
                    {/* Option 2: Pay with Card */}
                    <button
                      onClick={() => {
                        setPaymentMethod('card');
                        setAppliedCredits(0);
                      }}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                        paymentMethod === 'card'
                          ? 'border-cyan-400 bg-cyan-500/10'
                          : isLight ? 'border-gray-200 bg-white' : 'border-zinc-700 bg-zinc-800/50'
                      }`}
                      data-testid="pay-with-card-btn"
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        paymentMethod === 'card' ? 'bg-cyan-400 text-white' : 'bg-zinc-700 text-gray-400'
                      }`}>
                        <CreditCard className="w-4 h-4" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className={`font-medium text-sm ${textPrimary}`}>Pay with Card</div>
                        <div className={`text-xs ${textSecondary}`}>Secure via Stripe</div>
                      </div>
                      {paymentMethod === 'card' && (
                        <Check className="w-4 h-4 text-cyan-400" />
                      )}
                    </button>
                    
                    {/* Credit Slider for Card */}
                    {paymentMethod === 'card' && userCredits > 0 && (
                      <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800/50'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-xs ${textSecondary}`}>Also apply credits?</span>
                          <span className="text-xs text-yellow-400">${appliedCredits.toFixed(2)}</span>
                        </div>
                        <Slider
                          value={[appliedCredits]}
                          onValueChange={([value]) => setAppliedCredits(value)}
                          max={Math.min(userCredits, amountToPay)}
                          min={0}
                          step={0.5}
                          className="w-full"
                        />
                      </div>
                    )}
                    
                    {/* Payment Summary */}
                    <div className={`p-3 rounded-lg ${isLight ? 'bg-green-50 border-green-200' : 'bg-green-500/10 border-green-500/30'} border`}>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className={textSecondary}>Session Total</span>
                          <span className={textPrimary}>${amountToPay.toFixed(2)}</span>
                        </div>
                        {appliedCredits > 0 && (
                          <div className="flex justify-between text-yellow-500">
                            <span>Credits Applied</span>
                            <span>-${appliedCredits.toFixed(2)}</span>
                          </div>
                        )}
                        <div className={`flex justify-between pt-1 border-t ${isLight ? 'border-green-200' : 'border-green-500/30'} font-bold`}>
                          <span className={textPrimary}>
                            {paymentMethod === 'credits' && appliedCredits >= amountToPay 
                              ? 'Pay with Credits' 
                              : 'Card Payment via Stripe'}
                          </span>
                          <span className="text-green-400">
                            ${Math.max(0, amountToPay - appliedCredits).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Compact Protection Notice */}
                    <p className={`text-xs ${textSecondary}`}>
                      <Check className="w-3 h-3 inline mr-1 text-green-400" />
                      Payment held until session complete. Cancel 48hrs+ for 90% refund.
                    </p>
                  </div>
                );
              })()}
            </div>
          )}
        
          {/* Step 5: Selfie for Identification */}
          {step === 'selfie' && (
            <div className="space-y-4 pb-4">
              <div className={`p-4 rounded-xl ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'} border border-cyan-500/30`}>
                <h4 className={`font-bold text-sm ${textPrimary} mb-2 flex items-center gap-2`}>
                  <Camera className="w-4 h-4 text-cyan-400" />
                  Help the Photographer Find You!
                </h4>
                <p className={`text-xs ${textSecondary}`}>
                  Take a quick selfie with your board. This helps the photographer identify you in their photos so you don't miss any shots!
                </p>
              </div>
              
              {selfieUrl ? (
                <div className="space-y-3">
                  <div className="relative aspect-[4/3] rounded-xl overflow-hidden">
                    <img src={selfieUrl} alt="Your selfie" className="w-full h-full object-cover" />
                    <Badge className="absolute top-2 right-2 bg-green-500 text-white">
                      <Check className="w-3 h-3 mr-1" /> Saved
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setSelfieUrl(null)}
                      className="flex-1"
                    >
                      <Camera className="w-4 h-4 mr-2" />
                      Retake
                    </Button>
                    <Button
                      onClick={() => setStep('confirm')}
                      className="flex-1 bg-gradient-to-r from-yellow-500 to-orange-500 text-black font-bold"
                    >
                      Continue
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              ) : (
                <SelfieCapture
                  onCapture={(url) => {
                    setSelfieUrl(url);
                    toast.success('Selfie captured! The photographer will use this to find you.');
                  }}
                  onSkip={() => {
                    setStep('confirm');
                  }}
                  title="Selfie with Your Board"
                  subtitle="Hold your board so the photographer can spot you in the lineup"
                  skipAllowed={true}
                  theme={isLight ? 'light' : 'dark'}
                />
              )}
            </div>
          )}
        
          {/* Step 6: Confirmation */}
          {step === 'confirm' && (
            <div className="space-y-4 pb-4">
              <div className={`p-3 rounded-xl ${isLight ? 'bg-yellow-50' : 'bg-yellow-500/10'} border border-yellow-500/30`}>
                <h4 className={`font-bold text-sm ${textPrimary} mb-2 flex items-center gap-2`}>
                  <CheckCircle2 className="w-4 h-4 text-yellow-400" />
                  Confirm Your Booking
                </h4>
                
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Camera className="w-3 h-3 text-gray-500" />
                    <span className={textPrimary}>{photographer?.full_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-gray-500" />
                    <span className={textPrimary}>
                      {selectedDate?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {selectedTime}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3 h-3 text-gray-500" />
                    <span className={`${textPrimary} truncate`}>{impactZone?.description}</span>
                  </div>
                  
                  <div className={`pt-2 border-t ${isLight ? 'border-yellow-200' : 'border-yellow-500/30'}`}>
                    <div className="flex justify-between">
                      <span className={textSecondary}>Total</span>
                      <span className={textPrimary}>${totalPrice.toFixed(2)}</span>
                    </div>
                    {appliedCredits > 0 && (
                      <div className="flex justify-between text-yellow-500">
                        <span>Credits</span>
                        <span>-${appliedCredits.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-sm mt-1">
                      <span className={textPrimary}>Pay Now</span>
                      <span className="text-green-400">${(totalPrice - appliedCredits).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Step 6: Success */}
          {step === 'success' && (
            <div className="pb-4">
              <BookingConfirmation
                booking={bookingResult}
                photographer={photographer}
                onClose={onClose}
                onViewBookings={() => {
                  onClose();
                  // Navigate to scheduled bookings tab
                  window.location.href = '/bookings?tab=scheduled';
                }}
                onAddAnotherSpot={() => {
                  setStep('time');
                  setSelectedDate(null);
                  setSelectedTime(null);
                  setSelectedCategory(null);
                  setImpactZone(null);
                  setBookingResult(null);
                  toast.info('Select time and location for your next spot!');
                }}
                isLight={isLight}
              />
            </div>
          )}
        </div>
        
        {/* Sticky Footer Navigation */}
        {step !== 'success' && (
          <div className={`flex-shrink-0 px-4 py-2 border-t ${isLight ? 'border-gray-200 bg-white' : 'border-zinc-800 bg-zinc-900'}`}>
            {step === 'time' && (
              <Button
                onClick={handleNext}
                disabled={!canProceedFromTime}
                className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold h-10"
                data-testid="continue-to-location-btn"
              >
                Continue
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
            
            {step === 'location' && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className={`flex-1 h-10 ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <Button
                  onClick={handleNext}
                  disabled={!canProceedFromLocation}
                  className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-bold h-10"
                  data-testid="continue-to-crew-btn"
                >
                  Continue
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            )}
            
            {step === 'crew' && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className={`flex-1 h-10 ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <Button
                  onClick={handleNext}
                  disabled={!canProceedFromCrew}
                  className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-bold h-10"
                  data-testid="continue-to-payment-btn"
                >
                  Payment
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            )}
            
            {step === 'payment' && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className={`flex-1 h-10 ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <Button
                  onClick={handleNext}
                  className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-bold h-10"
                  data-testid="review-booking-btn"
                >
                  Review
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            )}
            
            {step === 'confirm' && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="flex-1 h-10 border-zinc-700"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <Button
                  onClick={handleSubmitBooking}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold h-10"
                  data-testid="confirm-booking-btn"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-1" />
                      Confirm & Pay
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ScheduledBookingDrawer;
