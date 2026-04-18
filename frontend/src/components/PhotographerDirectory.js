/**
 * PhotographerDirectory - Primary discovery layer for scheduled bookings
 * List-based directory with smart filters and "View on Map" toggle
 */

import React, { useState, useEffect, useMemo } from 'react';

import { useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import {

  Search, MapPin, Camera, Filter, Star, ChevronRight, Loader2, Plane, CheckCircle, Map, SlidersHorizontal, Waves
} from 'lucide-react';
import { Card, CardContent } from './ui/card';

import { Button } from './ui/button';

import { Badge } from './ui/badge';

import { Input } from './ui/input';

import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

import apiClient from '../lib/apiClient';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';



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
  { id: 'hobbyist', label: 'Hobbyist', color: 'blue' },
  { id: 'photographer', label: 'Photographer', color: 'green' },
  { id: 'approved_pro', label: 'Verified Pro', color: 'yellow' },
];

// Region/Peak options (expandable)
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

/**
 * Photographer Card Component
 */
const PhotographerCard = ({ photographer, onSelect, isLight }) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-800';
  
  const isVerified = photographer.role === 'Approved Pro';
  const isOnline = photographer.is_available || photographer.is_on_duty;
  
  return (
    <Card 
      className={`${cardBg} hover:border-yellow-500/50 transition-all cursor-pointer`}
      onClick={() => onSelect(photographer)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="relative">
            <Avatar className="w-16 h-16 border-2 border-zinc-700">
              <AvatarImage src={getFullUrl(photographer.avatar_url)} />
              <AvatarFallback className="bg-zinc-800 text-white text-lg">
                {photographer.full_name?.charAt(0) || 'P'}
              </AvatarFallback>
            </Avatar>
            {isOnline && (
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-black" />
            )}
          </div>
          
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className={`font-semibold ${textPrimary} truncate`}>
                {photographer.full_name}
              </h3>
              {isVerified && (
                <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                  <CheckCircle className="w-3 h-3 mr-1" /> Pro
                </Badge>
              )}
            </div>
            
            {/* Location */}
            <div className="flex items-center gap-1 mb-2">
              <MapPin className="w-3 h-3 text-gray-500" />
              <span className={`text-sm ${textSecondary} truncate`}>
                {photographer.home_break || photographer.region || 'Location not set'}
              </span>
            </div>
            
            {/* Gear Types */}
            <div className="flex items-center gap-2 mb-2">
              {photographer.gear_types?.includes('land') && (
                <Badge variant="outline" className="text-xs border-zinc-600">
                  <Camera className="w-3 h-3 mr-1" /> Land
                </Badge>
              )}
              {photographer.gear_types?.includes('water') && (
                <Badge variant="outline" className="text-xs border-blue-500/50 text-blue-400">
                  <Waves className="w-3 h-3 mr-1" /> Water
                </Badge>
              )}
              {photographer.gear_types?.includes('drone') && (
                <Badge variant="outline" className="text-xs border-purple-500/50 text-purple-400">
                  <Plane className="w-3 h-3 mr-1" /> Drone
                </Badge>
              )}
            </div>
            
            {/* Rating & Sessions */}
            <div className="flex items-center gap-4">
              {photographer.avg_rating && (
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                  <span className={`text-sm ${textPrimary}`}>
                    {photographer.avg_rating.toFixed(1)}
                  </span>
                </div>
              )}
              <span className={`text-xs ${textSecondary}`}>
                {photographer.total_sessions || 0} sessions
              </span>
            </div>
          </div>
          
          {/* Price & Arrow */}
          <div className="text-right flex flex-col items-end gap-2">
            {photographer.session_rate && (
              <div>
                <p className={`text-lg font-bold ${textPrimary}`}>
                  ${photographer.session_rate}
                </p>
                <p className={`text-xs ${textSecondary}`}>/hr</p>
              </div>
            )}
            <ChevronRight className="w-5 h-5 text-gray-500" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * Filter Sheet Component
 */
const FilterSheet = ({ isOpen, onClose, filters, onFiltersChange, isLight }) => {
  const _textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="bottom" className="bg-zinc-900 border-zinc-800 rounded-t-3xl h-auto max-h-[80vh]">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-white flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5" />
            Filter Photographers
          </SheetTitle>
        </SheetHeader>
        
        <div className="space-y-6 pb-6">
          {/* Region Filter */}
          <div>
            <label className={`text-sm font-medium ${textSecondary} mb-2 block`}>
              Surgical Peak / Region
            </label>
            <div className="flex flex-wrap gap-2">
              {REGIONS.map((region) => (
                <Button
                  key={region.id}
                  variant={filters.region === region.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onFiltersChange({ ...filters, region: region.id })}
                  className={filters.region === region.id 
                    ? 'bg-yellow-500 text-black' 
                    : 'border-zinc-700 text-gray-300'
                  }
                >
                  {region.flag && <span className="mr-1">{region.flag}</span>}
                  {region.label}
                </Button>
              ))}
            </div>
          </div>
          
          {/* Gear Type Filter */}
          <div>
            <label className={`text-sm font-medium ${textSecondary} mb-2 block`}>
              Gear Type
            </label>
            <div className="flex flex-wrap gap-2">
              {GEAR_TYPES.map((gear) => {
                const Icon = gear.icon;
                return (
                  <Button
                    key={gear.id}
                    variant={filters.gearType === gear.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onFiltersChange({ ...filters, gearType: gear.id })}
                    className={filters.gearType === gear.id 
                      ? 'bg-cyan-500 text-black' 
                      : 'border-zinc-700 text-gray-300'
                    }
                  >
                    <Icon className="w-4 h-4 mr-1" />
                    {gear.label}
                  </Button>
                );
              })}
            </div>
          </div>
          
          {/* Skill Level Filter */}
          <div>
            <label className={`text-sm font-medium ${textSecondary} mb-2 block`}>
              Verified Skill Level
            </label>
            <div className="flex flex-wrap gap-2">
              {SKILL_LEVELS.map((level) => (
                <Button
                  key={level.id}
                  variant={filters.skillLevel === level.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onFiltersChange({ ...filters, skillLevel: level.id })}
                  className={filters.skillLevel === level.id 
                    ? 'bg-green-500 text-black' 
                    : 'border-zinc-700 text-gray-300'
                  }
                >
                  {level.label}
                </Button>
              ))}
            </div>
          </div>
          
          {/* Apply & Clear */}
          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              className="flex-1 border-zinc-700"
              onClick={() => onFiltersChange({ region: 'all', gearType: 'all', skillLevel: 'all' })}
            >
              Clear All
            </Button>
            <Button
              className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black"
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
 * Main Photographer Directory Component
 */
export const PhotographerDirectory = ({ isOpen, onClose, onSelectPhotographer }) => {
  const { _user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  const [photographers, setPhotographers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [_viewMode, _setViewMode] = useState('list'); // 'list' or 'map'
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    region: 'all',
    gearType: 'all',
    skillLevel: 'all'
  });
  
  const isLight = theme === 'light';
  const _textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  // Fetch photographers
  useEffect(() => {
    if (isOpen) {
      fetchPhotographers();
    }
  }, [isOpen]);
  
  const fetchPhotographers = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/photographers/directory`);
      setPhotographers(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch photographers:', error);
      // Use mock data for now
      setPhotographers(mockPhotographers);
    } finally {
      setLoading(false);
    }
  };
  
  // Mock photographers data
  const mockPhotographers = [
    {
      id: '1',
      full_name: 'Jake Martinez',
      avatar_url: null,
      role: 'Approved Pro',
      home_break: 'Pipeline, Oahu',
      region: 'hi',
      gear_types: ['water', 'drone'],
      avg_rating: 4.9,
      total_sessions: 156,
      session_rate: 150,
      is_available: true
    },
    {
      id: '2',
      full_name: 'Sarah Chen',
      avatar_url: null,
      role: 'Photographer',
      home_break: 'Huntington Beach, CA',
      region: 'ca',
      gear_types: ['land', 'water'],
      avg_rating: 4.7,
      total_sessions: 89,
      session_rate: 100,
      is_available: false
    },
    {
      id: '3',
      full_name: 'Miguel Santos',
      avatar_url: null,
      role: 'Approved Pro',
      home_break: 'Tamarindo, Costa Rica',
      region: 'cr',
      gear_types: ['water', 'drone', 'land'],
      avg_rating: 5.0,
      total_sessions: 234,
      session_rate: 175,
      is_available: true
    },
    {
      id: '4',
      full_name: 'Emma Thompson',
      avatar_url: null,
      role: 'Hobbyist',
      home_break: 'Cocoa Beach, FL',
      region: 'fl',
      gear_types: ['land'],
      avg_rating: 4.5,
      total_sessions: 23,
      session_rate: 60,
      is_available: true
    },
    {
      id: '5',
      full_name: 'Kai Nakamura',
      avatar_url: null,
      role: 'Approved Pro',
      home_break: 'Banzai Pipeline, HI',
      region: 'hi',
      gear_types: ['water'],
      avg_rating: 4.8,
      total_sessions: 312,
      session_rate: 200,
      is_available: false
    },
  ];
  
  // Filter photographers
  const filteredPhotographers = useMemo(() => {
    let result = photographers;
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(p => 
        p.full_name?.toLowerCase().includes(query) ||
        p.username?.toLowerCase().includes(query) ||
        p.home_break?.toLowerCase().includes(query) ||
        p.location?.toLowerCase().includes(query) ||
        p.region?.toLowerCase().includes(query)
      );
    }
    
    // Region filter
    if (filters.region !== 'all') {
      result = result.filter(p => p.region === filters.region);
    }
    
    // Gear type filter
    if (filters.gearType !== 'all') {
      result = result.filter(p => p.gear_types?.includes(filters.gearType));
    }
    
    // Skill level filter
    if (filters.skillLevel !== 'all') {
      const roleMap = {
        'hobbyist': ['hobbyist', 'Hobbyist'],
        'photographer': ['photographer', 'Photographer'],
        'approved_pro': ['approved_pro', 'Approved Pro']
      };
      const validRoles = roleMap[filters.skillLevel] || [];
      result = result.filter(p => validRoles.includes(p.role) || (filters.skillLevel === 'approved_pro' && p.is_approved_pro));
    }
    
    return result;
  }, [photographers, searchQuery, filters]);
  
  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.region !== 'all') count++;
    if (filters.gearType !== 'all') count++;
    if (filters.skillLevel !== 'all') count++;
    return count;
  }, [filters]);
  
  const handleSelectPhotographer = (photographer) => {
    if (onSelectPhotographer) {
      onSelectPhotographer(photographer);
    } else {
      // Navigate to photographer profile with booking intent
      navigate(`/profile/${photographer.id}?book=scheduled`);
    }
    onClose();
  };
  
  const handleViewOnMap = () => {
    onClose();
    navigate('/map?filter=photographers');
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-lg h-[85vh] flex flex-col p-0">
        {/* Header */}
        <DialogHeader className="p-4 pb-0 shrink-0">
          <DialogTitle className="text-white flex items-center gap-2">
            <Camera className="w-5 h-5 text-yellow-400" />
            Find a Photographer
          </DialogTitle>
        </DialogHeader>
        
        {/* Search & View Toggle */}
        <div className="px-4 py-3 space-y-3 shrink-0">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input
              placeholder="Search by name or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-zinc-800 border-zinc-700 text-white"
            />
          </div>
          
          {/* Filters & View Toggle Row */}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(true)}
              className="border-zinc-700 text-gray-300"
            >
              <Filter className="w-4 h-4 mr-2" />
              Filters
              {activeFilterCount > 0 && (
                <Badge className="ml-2 bg-yellow-500 text-black text-xs">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleViewOnMap}
              className="border-zinc-700 text-gray-300"
            >
              <Map className="w-4 h-4 mr-2" />
              View on Map
            </Button>
          </div>
        </div>
        
        {/* Photographers List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
            </div>
          ) : filteredPhotographers.length === 0 ? (
            <div className="text-center py-12">
              <Camera className="w-12 h-12 mx-auto mb-3 text-zinc-600" />
              <p className={textSecondary}>No photographers found</p>
              <p className={`text-sm ${textSecondary} mt-1`}>Try adjusting your filters</p>
            </div>
          ) : (
            <>
              <p className={`text-sm ${textSecondary}`}>
                {filteredPhotographers.length} photographer{filteredPhotographers.length !== 1 ? 's' : ''} available
              </p>
              {filteredPhotographers.map((photographer) => (
                <PhotographerCard
                  key={photographer.id}
                  photographer={photographer}
                  onSelect={handleSelectPhotographer}
                  isLight={isLight}
                />
              ))}
            </>
          )}
        </div>
        
        {/* Filter Sheet */}
        <FilterSheet
          isOpen={showFilters}
          onClose={() => setShowFilters(false)}
          filters={filters}
          onFiltersChange={setFilters}
          isLight={isLight}
        />
      </DialogContent>
    </Dialog>
  );
};

export default PhotographerDirectory;
