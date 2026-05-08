/**
 * ExploreSurfSpotsTab — Extracted from Explore.js
 * Renders the "Surf Spots" tab with Browse/Nearby mode toggle,
 * BrowseMode and NearbyMode sub-components, and a Map View CTA.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Navigation, Globe, Compass } from 'lucide-react';
import { Badge } from '../ui/badge';
import BrowseMode from './BrowseMode';
import NearbyMode from './NearbyMode';

const ExploreSurfSpotsTab = ({
  locationHierarchy,
  discoveryMode,
  setDiscoveryMode,
  activateNearbyMode,
  userLocation,
  spotSearchQuery,
  setSpotSearchQuery,
  // Browse props
  selectedCountry, selectedState, selectedCity,
  countryOptions, stateOptions, cityOptions,
  handleCountryChange, handleStateChange, handleCityChange,
  jumpToLocation, popularLocations,
  surfSpots, surfSpotsLoading,
  fetchSurfSpots,
  user, isLight,
  dropdownBg, dropdownBorder, dropdownText, dropdownFocus,
  labelClass, chipBg, breadcrumbText,
  setSurfSpots, setSelectedCountry, setSelectedState, setSelectedCity,
  // Nearby props
  nearbySpots, nearbyLoading, fetchNearbySpots,
}) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-4" data-testid="surf-spots-tab">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Navigation className="w-5 h-5 text-cyan-400" />
          <h2 className="font-bold text-foreground">Surf Spots</h2>
          {locationHierarchy && (
            <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">
              {locationHierarchy.total_countries || 0} countries
            </Badge>
          )}
        </div>
      </div>
      
      {/* Discovery Mode Toggle */}
      <div className="flex gap-2 p-1 bg-zinc-900 rounded-xl border border-zinc-800">
        <button aria-label="Globe"
          onClick={() => { setDiscoveryMode('browse'); setSpotSearchQuery(''); }}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
            discoveryMode === 'browse'
              ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/20'
              : 'text-gray-400 hover:text-gray-200 hover:bg-zinc-800'
          }`}
          data-testid="browse-mode-btn"
        >
          <Globe className="w-4 h-4" />
          Browse
        </button>
        <button aria-label="Explore"
          onClick={activateNearbyMode}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
            discoveryMode === 'nearby'
              ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20'
              : 'text-gray-400 hover:text-gray-200 hover:bg-zinc-800'
          }`}
          data-testid="nearby-mode-btn"
        >
          <Compass className="w-4 h-4" />
          Nearby
          {userLocation && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        </button>
      </div>
      
      {/* Browse Mode */}
      {discoveryMode === 'browse' && (
        <BrowseMode
          selectedCountry={selectedCountry}
          selectedState={selectedState}
          selectedCity={selectedCity}
          countryOptions={countryOptions}
          stateOptions={stateOptions}
          cityOptions={cityOptions}
          handleCountryChange={handleCountryChange}
          handleStateChange={handleStateChange}
          handleCityChange={handleCityChange}
          jumpToLocation={jumpToLocation}
          spotSearchQuery={spotSearchQuery}
          setSpotSearchQuery={setSpotSearchQuery}
          surfSpots={surfSpots}
          surfSpotsLoading={surfSpotsLoading}
          popularLocations={popularLocations}
          user={user}
          isLight={isLight}
          dropdownBg={dropdownBg}
          dropdownBorder={dropdownBorder}
          dropdownText={dropdownText}
          dropdownFocus={dropdownFocus}
          labelClass={labelClass}
          chipBg={chipBg}
          breadcrumbText={breadcrumbText}
          setSurfSpots={setSurfSpots}
          setSelectedCountry={setSelectedCountry}
          setSelectedState={setSelectedState}
          setSelectedCity={setSelectedCity}
        />
      )}
      
      {/* Nearby Mode */}
      {discoveryMode === 'nearby' && (
        <NearbyMode
          userLocation={userLocation}
          nearbySpots={nearbySpots}
          nearbyLoading={nearbyLoading}
          spotSearchQuery={spotSearchQuery}
          user={user}
          fetchNearbySpots={fetchNearbySpots}
          setDiscoveryMode={setDiscoveryMode}
          activateNearbyMode={activateNearbyMode}
        />
      )}
      
      {/* Map View CTA */}
      <div className="mt-6">
        <button aria-label="Location"
          onClick={() => navigate('/map')}
          className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 rounded-xl text-white font-medium transition-all shadow-lg shadow-cyan-500/10"
          data-testid="view-all-on-map"
        >
          <MapPin className="w-5 h-5" />
          View All Spots on Map
        </button>
      </div>
    </div>
  );
};

export default ExploreSurfSpotsTab;
