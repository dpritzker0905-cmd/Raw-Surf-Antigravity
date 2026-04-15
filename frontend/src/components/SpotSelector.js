import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { MapPin, Search, Check, Loader2, Navigation, X } from 'lucide-react';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * SpotSelector - In-Drawer Searchable Spot Selection
 * 
 * Used in Active Duty console for On-Demand spot selection
 * 
 * Features:
 * - Searchable list of nearby surf spots
 * - Radius filtering based on photographer tier:
 *   - Standard: 10-20 miles
 *   - Verified Pro: 30-50 miles
 * - Current location detection
 * - Shows distance from current location
 */

export const SpotSelector = ({ 
  selectedSpot, 
  onSelectSpot, 
  photographerTier = 'standard',
  disabled = false,
  compact = false
}) => {
  const { user } = useAuth();
  const [spots, setSpots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Radius limits based on photographer tier
  const radiusConfig = useMemo(() => {
    if (photographerTier === 'pro' || photographerTier === 'verified' || photographerTier === 'Approved Pro') {
      return { min: 30, max: 50, label: 'Pro Range (30-50mi)' };
    }
    return { min: 10, max: 20, label: 'Standard Range (10-20mi)' };
  }, [photographerTier]);

  // Get user's current location
  useEffect(() => {
    getUserLocation();
  }, []);

  // Fetch spots when location is available
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
          setLocationLoading(false);
        },
        (error) => {
          logger.error('Geolocation error:', error);
          setLocationLoading(false);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setLocationLoading(false);
    }
  };

  const fetchNearbySpots = async () => {
    if (!userLocation) return;
    
    setLoading(true);
    try {
      const response = await axios.get(`${API}/surf-spots/nearby`, {
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
      spot.location?.toLowerCase().includes(query)
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

  return (
    <div className="space-y-3">
      {/* Header with radius info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-cyan-400" />
          <span className="text-white text-sm font-medium">Select Spot</span>
        </div>
        <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">
          {radiusConfig.label}
        </Badge>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search spots..."
          className="pl-10 bg-zinc-800 border-zinc-700 text-white placeholder:text-gray-500"
          disabled={disabled}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Location Status - Only show button to enable, not "Getting location" (moved to header) */}
      {!userLocation && !locationLoading && (
        <button
          onClick={getUserLocation}
          className="flex items-center gap-2 text-cyan-400 text-xs p-2 bg-cyan-500/10 rounded-lg hover:bg-cyan-500/20 w-full"
        >
          <Navigation className="w-3 h-3" />
          <span>Enable location to find nearby spots</span>
        </button>
      )}

      {/* Spots List */}
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
                    : 'bg-zinc-800/50 hover:bg-zinc-700/50 border border-transparent'
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
                  <p className={`text-sm font-medium ${isSelected ? 'text-green-300' : 'text-white'}`}>
                    {spot.name}
                  </p>
                  {spot.location && (
                    <p className="text-xs text-gray-400">{spot.location}</p>
                  )}
                </div>
                {spot.distance !== undefined && (
                  <span className={`text-xs ${isSelected ? 'text-green-400' : 'text-gray-400'}`}>
                    {spot.distance.toFixed(1)} mi
                  </span>
                )}
              </button>
            );
          })
        ) : userLocation ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            {searchQuery ? 'No spots match your search' : 'No spots found nearby'}
          </div>
        ) : null}
      </div>

      {/* Close button when expanded from compact mode */}
      {compact && isExpanded && (
        <button
          onClick={() => setIsExpanded(false)}
          className="w-full p-2 text-gray-400 hover:text-white text-sm"
        >
          Cancel
        </button>
      )}
    </div>
  );
};

export default SpotSelector;
