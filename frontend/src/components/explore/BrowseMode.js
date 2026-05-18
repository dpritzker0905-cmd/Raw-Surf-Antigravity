/**
 * BrowseMode G Location-based spot discovery with cascading dropdowns.
 * Extracted from Explore.js to reduce file size.
 * 
 * Features:
 * - Cascading Country G State G City dropdowns
 * - Spot name search within selected location
 * - Popular destinations quick-jump chips
 * - Breadcrumb navigation with clear button
 * - Skeleton loading state
 */
import React from 'react';
import { Globe, MapPin, Navigation, ChevronDown, ChevronRight, Search, X, Waves } from 'lucide-react';
import { Badge } from '../ui/badge';
import ExploreSpotCard from '../ExploreSpotCard';
import { getCountryFlag } from '../../utils/countryFlags';

const BrowseMode = ({
  // Location state
  selectedCountry,
  selectedState,
  selectedCity,
  countryOptions,
  stateOptions,
  cityOptions,
  // Handlers
  handleCountryChange,
  handleStateChange,
  handleCityChange,
  jumpToLocation,
  // Spot search
  spotSearchQuery,
  setSpotSearchQuery,
  // Data
  surfSpots,
  surfSpotsLoading,
  popularLocations,
  user,
  // Theme
  isLight,
  // CSS class props
  dropdownBg,
  dropdownBorder,
  dropdownText,
  dropdownFocus,
  labelClass,
  chipBg,
  breadcrumbText,
  // Clear handler
  setSurfSpots,
  setSelectedCountry,
  setSelectedState,
  setSelectedCity,
}) => {
  return (
    <>
      {/* Cascading Location Dropdowns */}
      <div className="space-y-3">
        {/* Country Dropdown */}
        <div>
          <label className={`block text-xs uppercase tracking-wider font-medium mb-1.5 ${labelClass}`}>Country</label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400 pointer-events-none z-10" />
            <select
              value={selectedCountry}
              onChange={(e) => handleCountryChange(e.target.value)}
              className={`w-full pl-10 pr-10 py-3 ${dropdownBg} border ${dropdownBorder} rounded-xl ${dropdownText} text-sm focus:outline-none ${dropdownFocus} focus:ring-1 transition-all appearance-none cursor-pointer`}
              data-testid="country-dropdown"
              aria-label="Select country"
            >
              <option value="">Select a country...</option>
              {countryOptions.map(name => (
                <option key={name} value={name}>{getCountryFlag(name)} {name}</option>
              ))}
            </select>
            <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isLight ? 'text-gray-400' : 'text-gray-500'} pointer-events-none`} />
          </div>
        </div>
        
        {/* State/Province Dropdown */}
        {selectedCountry && stateOptions.length > 0 && (
          <div>
            <label className={`block text-xs uppercase tracking-wider font-medium mb-1.5 ${labelClass}`}>State / Province</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 pointer-events-none z-10" />
              <select
                value={selectedState}
                onChange={(e) => handleStateChange(e.target.value)}
                className={`w-full pl-10 pr-10 py-3 ${dropdownBg} border ${dropdownBorder} rounded-xl ${dropdownText} text-sm focus:outline-none ${isLight ? 'focus:border-blue-500 focus:ring-blue-200/30' : 'focus:border-blue-500/50 focus:ring-blue-500/20'} focus:ring-1 transition-all appearance-none cursor-pointer`}
                data-testid="state-dropdown"
                aria-label="Select state or province"
              >
                <option value="">Select state / province...</option>
                {stateOptions.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isLight ? 'text-gray-400' : 'text-gray-500'} pointer-events-none`} />
            </div>
          </div>
        )}
        
        {/* City/Area Dropdown */}
        {selectedState && cityOptions.length > 0 && (
          <div>
            <label className={`block text-xs uppercase tracking-wider font-medium mb-1.5 ${labelClass}`}>City / Area</label>
            <div className="relative">
              <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400 pointer-events-none z-10" />
              <select
                value={selectedCity}
                onChange={(e) => handleCityChange(e.target.value)}
                className={`w-full pl-10 pr-10 py-3 ${dropdownBg} border ${dropdownBorder} rounded-xl ${dropdownText} text-sm focus:outline-none ${isLight ? 'focus:border-emerald-500 focus:ring-emerald-200/30' : 'focus:border-emerald-500/50 focus:ring-emerald-500/20'} focus:ring-1 transition-all appearance-none cursor-pointer`}
                data-testid="city-dropdown"
                aria-label="Select city or area"
              >
                <option value="">Select city / area...</option>
                {cityOptions.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isLight ? 'text-gray-400' : 'text-gray-500'} pointer-events-none`} />
            </div>
          </div>
        )}
      </div>
      
      {/* Spot Name Search */}
      {selectedCountry && (
        <div className="relative">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isLight ? 'text-gray-400' : 'text-gray-500'}`} />
          <input aria-label="Search spots by name..."
            type="text"
            placeholder="Search spots by name..."
            value={spotSearchQuery}
            onChange={(e) => setSpotSearchQuery(e.target.value)}
            className={`w-full pl-10 pr-10 py-3 ${dropdownBg} border ${dropdownBorder} rounded-xl ${dropdownText} ${isLight ? 'placeholder-gray-400' : 'placeholder-gray-500'} text-sm focus:outline-none ${dropdownFocus} focus:ring-1 transition-all`}
            data-testid="spot-search-input"
            aria-label="Search spots by name"
          />
          {spotSearchQuery && (
            <button onClick={() => setSpotSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" aria-label="Clear search">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
      
      {/* Popular Destinations */}
      {!selectedCountry && (
        <div>
          <p className={`text-xs uppercase tracking-wider font-medium mb-2 ${labelClass}`}>Popular Destinations</p>
          <div className="flex flex-wrap gap-2">
            {popularLocations.map((loc, i) => (
              <button
                key={i}
                onClick={() => jumpToLocation(loc)}
                className={`px-3 py-1.5 border rounded-full text-xs transition-all ${chipBg}`}
                data-testid={`quick-loc-${i}`}
              >
                {loc.label}
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Selection breadcrumb + Clear */}
      {selectedCountry && (
        <div className="flex items-center gap-1.5 text-sm flex-wrap">
          <span className="text-lg">{getCountryFlag(selectedCountry)}</span>
          <span className={`${breadcrumbText} font-medium`}>{selectedCountry}</span>
          {selectedState && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
              <span className={isLight ? 'text-blue-600' : 'text-blue-400'}>{selectedState}</span>
            </>
          )}
          {selectedCity && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
              <span className={isLight ? 'text-emerald-600' : 'text-emerald-400'}>{selectedCity}</span>
            </>
          )}
          <button
            onClick={() => { setSelectedCountry(''); setSelectedState(''); setSelectedCity(''); setSurfSpots([]); setSpotSearchQuery(''); }}
            className={`ml-auto text-xs flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${isLight ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gray-500 hover:text-gray-300 hover:bg-zinc-800'}`}
            aria-label="Clear location selection"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        </div>
      )}
      
      {/* Loading State */}
      {surfSpotsLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-card/80 border border-border rounded-xl overflow-hidden animate-pulse">
              <div className="h-32 bg-muted" />
              <div className="px-3 py-2 border-b border-border flex items-center gap-3">
                <div className="h-5 w-12 bg-zinc-700 rounded" />
                <div className="h-4 w-16 bg-zinc-700 rounded" />
              </div>
              <div className="px-3 py-2 flex gap-2">
                <div className="flex-1 h-9 bg-zinc-700 rounded-lg" />
                <div className="h-9 w-16 bg-muted rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Spot Cards */}
      {!surfSpotsLoading && surfSpots.length > 0 && (
        <>
          <div className="p-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-lg">
            <div className="flex items-center gap-2 text-xs text-cyan-400">
              <Waves className="w-4 h-4" />
              <span>
 <strong>Today</strong> = Current Conditions G <strong>Forecast:</strong> 3 days free, 7 paid, 10 premium
              </span>
            </div>
          </div>
          
          <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">
            {surfSpots.filter(s => !spotSearchQuery || s.name?.toLowerCase().includes(spotSearchQuery.toLowerCase())).length} spots
            {selectedCity ? ` in ${selectedCity}` : selectedState ? ` in ${selectedState}` : ` in ${selectedCountry}`}
          </Badge>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {surfSpots
              .filter(s => !spotSearchQuery || s.name?.toLowerCase().includes(spotSearchQuery.toLowerCase()))
              .map((spot) => (
              <ExploreSpotCard 
                key={spot.id} 
                spot={spot} 
                userSubscriptionTier={user?.subscription_tier || 'free'}
              />
            ))}
          </div>
        </>
      )}
      
      {/* Empty State */}
      {selectedCountry && !surfSpotsLoading && surfSpots.length === 0 && (selectedCity || (stateOptions.length === 0) || (selectedState && cityOptions.length === 0)) && (
        <div className="text-center py-12 text-muted-foreground">
          <Navigation className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium mb-1">No spots found</p>
          <p className="text-sm text-gray-500">Try selecting a different area</p>
        </div>
      )}
    </>
  );
};

export default BrowseMode;
