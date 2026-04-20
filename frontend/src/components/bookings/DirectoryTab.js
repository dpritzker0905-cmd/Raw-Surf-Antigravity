/**
 * DirectoryTab - First-class photographer discovery tab under Bookings
 * 
 * Features:
 * - Search by name/location
 * - Filter by region, gear type, skill level
 * - Sort by rating, price, sessions, distance
 * - Subscription-gated live badges (Free=1mi, Basic=5mi, Premium=unlimited)
 * - Portfolio preview (locked for Free tier)
 * - Review snippets on each card
 * - Theme-aware (light/dark/beach)
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, MapPin, Camera, Filter, Star, ChevronRight, Loader2, Plane, CheckCircle,
  Map, SlidersHorizontal, Waves, ArrowUpDown, Lock, Radio, Crown, Image, User, CalendarPlus
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';
import { getFullUrl } from '../../utils/media';
import { ROLES } from '../../constants/roles';
import { useNavigate } from 'react-router-dom';

// Gear type options
const GEAR_TYPES = [
  { id: 'all', label: 'All Gear', icon: Camera },
  { id: 'land', label: 'Land', icon: Camera, description: 'Beach/pier shots' },
  { id: 'water', label: 'Water', icon: Waves, description: 'In-water photography' },
  { id: 'drone', label: 'Drone', icon: Plane, description: 'Aerial footage' },
];

// Skill level options
const SKILL_LEVELS = [
  { id: 'all', label: 'All Levels' },
  { id: 'hobbyist', label: 'Hobbyist' },
  { id: 'photographer', label: 'Photographer' },
  { id: 'approved_pro', label: 'Verified Pro' },
];

// Region options
const REGIONS = [
  { id: 'all', label: 'All Regions' },
  { id: 'ny', label: 'New York', flag: '🗽' },
  { id: 'fl', label: 'Florida', flag: '🌴' },
  { id: 'ca', label: 'California', flag: '☀️' },
  { id: 'hi', label: 'Hawaii', flag: '🌺' },
  { id: 'cr', label: 'Costa Rica', flag: '🇨🇷' },
  { id: 'pr', label: 'Puerto Rico', flag: '🇵🇷' },
  { id: 'mx', label: 'Mexico', flag: '🇲🇽' },
  { id: 'id', label: 'Indonesia', flag: '🇮🇩' },
  { id: 'au', label: 'Australia', flag: '🇦🇺' },
];

// Sort options
const SORT_OPTIONS = [
  { id: 'rating', label: 'Highest Rated' },
  { id: 'price_asc', label: 'Price: Low → High' },
  { id: 'price_desc', label: 'Price: High → Low' },
  { id: 'sessions', label: 'Most Sessions' },
  { id: 'distance', label: 'Nearest First' },
];

// Subscription tier radii for live badge visibility
const TIER_RADIUS = {
  Free: 1,
  Basic: 5,
  Premium: 999999, // unlimited
};

/**
 * Enhanced Photographer Card Component with review snippets and live status
 */
const DirectoryPhotographerCard = ({ photographer, onSelect, onBook, theme, subscriptionTier, userLocation }) => {
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';
  const cardBg = isLight
    ? 'bg-white border-gray-200 hover:border-yellow-400/60'
    : isBeach
      ? 'bg-zinc-950 border-zinc-700 hover:border-yellow-500/50'
      : 'bg-zinc-900 border-zinc-800 hover:border-yellow-500/50';
  
  const isPremium = subscriptionTier === 'Premium';
  const isVerified = photographer.role === ROLES.APPROVED_PRO || photographer.is_approved_pro;
  
  // Check if live badge should show based on subscription radius
  const tierRadius = TIER_RADIUS[subscriptionTier] || TIER_RADIUS.Free;
  const isWithinLiveRadius = photographer.is_shooting && (
    isPremium || 
    (photographer.distance_miles != null && photographer.distance_miles <= tierRadius) ||
    !userLocation // If no location, show to premium only
  );
  
  return (
    <Card
      className={`${cardBg} transition-all duration-200 cursor-pointer ${isPremium ? 'ring-1 ring-yellow-500/10' : ''}`}
      onClick={() => onSelect(photographer)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Avatar with live indicator */}
          <div className="relative shrink-0">
            <Avatar className={`w-14 h-14 border-2 ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
              <AvatarImage src={getFullUrl(photographer.avatar_url)} />
              <AvatarFallback className={`${isLight ? 'bg-gray-100 text-gray-700' : 'bg-zinc-800 text-white'} text-lg`}>
                {photographer.full_name?.charAt(0) || 'P'}
              </AvatarFallback>
            </Avatar>
            {isWithinLiveRadius && (
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-black animate-pulse" />
            )}
          </div>
          
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className={`font-semibold truncate ${textPrimary}`}>
                {photographer.full_name}
              </h3>
              {isVerified && (
                <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30 text-[10px] px-1.5 py-0">
                  <CheckCircle className="w-3 h-3 mr-0.5" /> Pro
                </Badge>
              )}
              {isWithinLiveRadius && (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px] px-1.5 py-0">
                  <Radio className="w-3 h-3 mr-0.5" /> Live
                </Badge>
              )}
            </div>
            
            {/* Location */}
            <div className="flex items-center gap-1 mb-1.5">
              <MapPin className={`w-3 h-3 ${textSecondary}`} />
              <span className={`text-xs ${textSecondary} truncate`}>
                {photographer.home_break || photographer.region || 'Location not set'}
              </span>
              {photographer.distance_miles != null && subscriptionTier !== 'Free' && (
                <span className={`text-xs ${textSecondary} ml-1`}>
                  • {photographer.distance_miles.toFixed(1)} mi
                </span>
              )}
            </div>
            
            {/* Gear badges */}
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              {photographer.gear_types?.includes('land') && (
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${isLight ? 'border-gray-300 text-gray-600' : 'border-zinc-600 text-gray-400'}`}>
                  <Camera className="w-2.5 h-2.5 mr-0.5" /> Land
                </Badge>
              )}
              {photographer.gear_types?.includes('water') && (
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${isLight ? 'border-blue-300 text-blue-600' : 'border-blue-500/40 text-blue-400'}`}>
                  <Waves className="w-2.5 h-2.5 mr-0.5" /> Water
                </Badge>
              )}
              {photographer.gear_types?.includes('drone') && (
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${isLight ? 'border-purple-300 text-purple-600' : 'border-purple-500/40 text-purple-400'}`}>
                  <Plane className="w-2.5 h-2.5 mr-0.5" /> Drone
                </Badge>
              )}
            </div>
            
            {/* Rating & sessions */}
            <div className="flex items-center gap-3">
              {photographer.avg_rating ? (
                <div className="flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                  <span className={`text-sm font-medium ${textPrimary}`}>
                    {Number(photographer.avg_rating).toFixed(1)}
                  </span>
                  {photographer.total_reviews > 0 && (
                    <span className={`text-xs ${textSecondary}`}>({photographer.total_reviews})</span>
                  )}
                </div>
              ) : null}
              <span className={`text-xs ${textSecondary}`}>
                {photographer.total_sessions || 0} sessions
              </span>
            </div>
            
            {/* Review snippet */}
            {photographer.latest_review_snippet && (
              <p className={`text-xs italic mt-1.5 ${textSecondary} line-clamp-1`}>
                "{photographer.latest_review_snippet}"
              </p>
            )}
          </div>
          
          {/* Price & actions */}
          <div className="text-right flex flex-col items-end gap-1 shrink-0">
            {photographer.session_rate && (
              <div>
                <p className={`text-lg font-bold ${textPrimary}`}>${photographer.session_rate}</p>
                <p className={`text-[10px] ${textSecondary}`}>/hr</p>
              </div>
            )}
          </div>
        </div>
        
        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-dashed border-zinc-700/50">
          <Button
            variant="outline"
            size="sm"
            className={`flex-1 ${isLight ? 'border-gray-300 text-gray-700 hover:bg-gray-50' : 'border-zinc-600 text-gray-300 hover:bg-zinc-700'}`}
            onClick={(e) => { e.stopPropagation(); onSelect(photographer); }}
          >
            <User className="w-3.5 h-3.5 mr-1.5" />
            View Profile
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600 text-black font-semibold"
            onClick={(e) => { e.stopPropagation(); onBook(photographer); }}
          >
            <CalendarPlus className="w-3.5 h-3.5 mr-1.5" />
            Book Now
          </Button>
        </div>
        
        {/* Portfolio preview (locked for Free tier) */}
        {photographer.portfolio_images && photographer.portfolio_images.length > 0 && (
          <div className="mt-3 pt-3 border-t border-dashed border-zinc-700/50">
            {subscriptionTier === 'Free' ? (
              <div className="flex items-center gap-2 py-2">
                <Lock className="w-4 h-4 text-gray-500" />
                <span className={`text-xs ${textSecondary}`}>
                  Upgrade to <span className="text-yellow-400 font-medium">Basic</span> to preview portfolios
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {photographer.portfolio_images.slice(0, 4).map((url, i) => (
                  <div key={i} className="aspect-square rounded-lg overflow-hidden bg-zinc-800">
                    <img
                      src={getFullUrl(url)}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* Gallery link for those without portfolio images */}
        {(!photographer.portfolio_images || photographer.portfolio_images.length === 0) && photographer.gallery_count > 0 && (
          <div className="mt-3 pt-3 border-t border-dashed border-zinc-700/50">
            <div className="flex items-center gap-2 py-1">
              <Image className={`w-4 h-4 ${textSecondary}`} />
              <span className={`text-xs ${textSecondary}`}>
                {photographer.gallery_count} gallery photos • No portfolio preview yet
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

/**
 * Filter Sheet Component (same pattern as existing PhotographerDirectory)
 */
const DirectoryFilterSheet = ({ isOpen, onClose, filters, onFiltersChange, theme }) => {
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const sheetBg = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-700' : 'bg-zinc-900 border-zinc-800';
  const textSecondary = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';
  
  const chipActive = (active) => active
    ? 'bg-yellow-500 text-black border-yellow-500'
    : isLight ? 'border-gray-300 text-gray-600' : 'border-zinc-700 text-gray-300';
  
  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="bottom" className={`${sheetBg} rounded-t-3xl h-auto max-h-[80vh]`}>
        <SheetHeader className="pb-4">
          <SheetTitle className={`${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2`}>
            <SlidersHorizontal className="w-5 h-5" />
            Filter Photographers
          </SheetTitle>
        </SheetHeader>
        
        <div className="space-y-6 pb-6">
          {/* Region */}
          <div>
            <label className={`text-sm font-medium ${textSecondary} mb-2 block`}>Region</label>
            <div className="flex flex-wrap gap-2">
              {REGIONS.map((region) => (
                <Button
                  key={region.id}
                  variant="outline"
                  size="sm"
                  onClick={() => onFiltersChange({ ...filters, region: region.id })}
                  className={chipActive(filters.region === region.id)}
                >
                  {region.flag && <span className="mr-1">{region.flag}</span>}
                  {region.label}
                </Button>
              ))}
            </div>
          </div>
          
          {/* Gear Type */}
          <div>
            <label className={`text-sm font-medium ${textSecondary} mb-2 block`}>Gear Type</label>
            <div className="flex flex-wrap gap-2">
              {GEAR_TYPES.map((gear) => {
                const Icon = gear.icon;
                return (
                  <Button
                    key={gear.id}
                    variant="outline"
                    size="sm"
                    onClick={() => onFiltersChange({ ...filters, gearType: gear.id })}
                    className={chipActive(filters.gearType === gear.id)}
                  >
                    <Icon className="w-4 h-4 mr-1" />
                    {gear.label}
                  </Button>
                );
              })}
            </div>
          </div>
          
          {/* Skill Level */}
          <div>
            <label className={`text-sm font-medium ${textSecondary} mb-2 block`}>Skill Level</label>
            <div className="flex flex-wrap gap-2">
              {SKILL_LEVELS.map((level) => (
                <Button
                  key={level.id}
                  variant="outline"
                  size="sm"
                  onClick={() => onFiltersChange({ ...filters, skillLevel: level.id })}
                  className={chipActive(filters.skillLevel === level.id)}
                >
                  {level.label}
                </Button>
              ))}
            </div>
          </div>
          
          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              className={`flex-1 ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
              onClick={() => onFiltersChange({ region: 'all', gearType: 'all', skillLevel: 'all' })}
            >
              Clear All
            </Button>
            <Button
              className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
              onClick={onClose}
            >
              Apply Filters
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};


/**
 * Main DirectoryTab Component
 */
export const DirectoryTab = ({
  user,
  theme,
  subscriptionTier = 'Free',
  onSelectPhotographer
}) => {
  const navigate = useNavigate();
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';
  const inputBg = isLight
    ? 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400'
    : isBeach
      ? 'bg-zinc-800 border-zinc-600 text-white placeholder:text-gray-500'
      : 'bg-zinc-800 border-zinc-700 text-white placeholder:text-gray-500';
  
  // State
  const [photographers, setPhotographers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('rating');
  const [showFilters, setShowFilters] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [filters, setFilters] = useState({
    region: 'all',
    gearType: 'all',
    skillLevel: 'all'
  });
  
  // Get user GPS for distance calculations
  useEffect(() => {
    if (subscriptionTier !== 'Free' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {} // Silently fail if denied
      );
    }
  }, [subscriptionTier]);
  
  // Fetch photographers with debounced search
  useEffect(() => {
    const tid = setTimeout(() => fetchPhotographers(), searchQuery.length > 0 ? 350 : 0);
    return () => clearTimeout(tid);
  }, [filters, searchQuery, sortBy]); // eslint-disable-line
  
  const fetchPhotographers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.region !== 'all') params.append('region', filters.region);
      if (filters.gearType !== 'all') params.append('gear_type', filters.gearType);
      if (filters.skillLevel !== 'all') params.append('skill_level', filters.skillLevel);
      if (searchQuery) params.append('search', searchQuery);
      if (sortBy) params.append('sort_by', sortBy);
      if (userLocation) {
        params.append('latitude', userLocation.lat);
        params.append('longitude', userLocation.lng);
      }
      params.append('include_reviews', 'true');
      params.append('include_live_status', 'true');
      params.append('limit', '50');
      
      const response = await apiClient.get(`/photographers/directory?${params.toString()}`);
      setPhotographers(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch photographers for directory:', error);
      setPhotographers([]);
    } finally {
      setLoading(false);
    }
  }, [filters, searchQuery, sortBy, userLocation]);
  
  // Client-side sort — only as a defensive fallback.
  // The server already returns results sorted by `sort_by`, so we skip
  // re-sorting for server-handled fields to avoid wasted CPU.
  // Distance is the exception: the server only sorts by distance if
  // lat/lng were provided, so we re-sort client-side as a safety net.
  const sortedPhotographers = useMemo(() => {
    if (sortBy === 'distance' && userLocation) {
      return [...photographers].sort(
        (a, b) => (a.distance_miles || 9999) - (b.distance_miles || 9999)
      );
    }
    // Server already returned in correct order for rating, price, sessions
    return photographers;
  }, [photographers, sortBy, userLocation]);
  
  // Active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.region !== 'all') count++;
    if (filters.gearType !== 'all') count++;
    if (filters.skillLevel !== 'all') count++;
    return count;
  }, [filters]);
  
  const handleSelectPhotographer = (photographer) => {
    // Navigate to profile page with reviews tab pre-selected
    navigate(`/profile/${photographer.id}?tab=reviews`);
  };

  const handleBookPhotographer = (photographer) => {
    // Direct booking flow via callback or navigate with book param
    if (onSelectPhotographer) {
      onSelectPhotographer(photographer);
    } else {
      navigate(`/profile/${photographer.id}?book=scheduled`);
    }
  };
  
  const handleViewOnMap = () => {
    navigate('/map?filter=photographers');
  };
  
  return (
    <div className="space-y-4">
      {/* Directory Hub title */}
      <div className="flex items-center gap-2">
        <Camera className={`w-5 h-5 ${isLight ? 'text-yellow-600' : 'text-yellow-400'}`} />
        <h2 className={`text-lg font-bold ${textPrimary}`}>Directory Hub</h2>
      </div>
      
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <Input
          placeholder="Search by name or location..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={`pl-10 ${inputBg}`}
        />
      </div>
      
      {/* Filter & Sort row */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(true)}
          className={`${isLight ? 'border-gray-300 text-gray-600' : 'border-zinc-700 text-gray-300'}`}
        >
          <Filter className="w-4 h-4 mr-1.5" />
          Filters
          {activeFilterCount > 0 && (
            <Badge className="ml-1.5 bg-yellow-500 text-black text-[10px] px-1.5 py-0">{activeFilterCount}</Badge>
          )}
        </Button>
        
        {/* Sort selector */}
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSortMenu(!showSortMenu)}
            className={`${isLight ? 'border-gray-300 text-gray-600' : 'border-zinc-700 text-gray-300'}`}
          >
            <ArrowUpDown className="w-4 h-4 mr-1.5" />
            {SORT_OPTIONS.find(s => s.id === sortBy)?.label || 'Sort'}
          </Button>
          
          {showSortMenu && (
            <div className={`absolute top-full left-0 mt-1 z-50 w-48 rounded-lg border shadow-xl ${isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-800 border-zinc-700'}`}>
              {SORT_OPTIONS.map((option) => {
                // Block distance sort for Free tier
                const isDisabled = option.id === 'distance' && subscriptionTier === 'Free';
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      if (!isDisabled) {
                        setSortBy(option.id);
                        setShowSortMenu(false);
                      }
                    }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      sortBy === option.id
                        ? 'bg-yellow-500/20 text-yellow-400 font-medium'
                        : isDisabled
                          ? `${isLight ? 'text-gray-300' : 'text-zinc-600'} cursor-not-allowed`
                          : `${isLight ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-300 hover:bg-zinc-700'}`
                    }`}
                  >
                    {option.label}
                    {isDisabled && <Lock className="w-3 h-3 inline ml-1.5 opacity-50" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        
        <div className="flex-1" />
        
        <Button
          variant="outline"
          size="sm"
          onClick={handleViewOnMap}
          className={`${isLight ? 'border-gray-300 text-gray-600' : 'border-zinc-700 text-gray-300'}`}
        >
          <Map className="w-4 h-4 mr-1.5" />
          Map
        </Button>
      </div>
      
      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
        </div>
      ) : sortedPhotographers.length === 0 ? (
        <Card className={`${isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-700' : 'bg-zinc-900 border-zinc-800'}`}>
          <CardContent className="py-12 text-center">
            <Camera className={`w-12 h-12 mx-auto mb-3 ${isLight ? 'text-gray-300' : 'text-zinc-600'}`} />
            <p className={textSecondary}>No photographers found</p>
            <p className={`text-sm ${textSecondary} mt-1`}>Try adjusting your filters or search</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className={`text-sm ${textSecondary}`}>
            {sortedPhotographers.length} photographer{sortedPhotographers.length !== 1 ? 's' : ''} available
          </p>
          <div className="space-y-3">
            {sortedPhotographers.map((photographer) => (
              <DirectoryPhotographerCard
                key={photographer.id}
                photographer={photographer}
                onSelect={handleSelectPhotographer}
                onBook={handleBookPhotographer}
                theme={theme}
                subscriptionTier={subscriptionTier}
                userLocation={userLocation}
              />
            ))}
          </div>
        </>
      )}
      
      {/* Close sort menu on outside click */}
      {showSortMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
      )}
      
      {/* Filter Sheet */}
      <DirectoryFilterSheet
        isOpen={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        onFiltersChange={setFilters}
        theme={theme}
      />
    </div>
  );
};

export default DirectoryTab;
