import React from 'react';
import { Map as MapIcon, Loader2, Check } from 'lucide-react';

export const LocationDropdowns = ({
  isLight,
  textPrimary,
  textSecondary,
  locationLoading,
  locationData,
  selectedCountry,
  selectedState,
  handleCountryChange,
  handleStateChange,
  nearbySpots
}) => {
  return (
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
          
          {/* State/Province Dropdown */}
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
  );
};
