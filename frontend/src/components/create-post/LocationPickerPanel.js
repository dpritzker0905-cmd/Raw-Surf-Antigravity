/**
 * LocationPickerPanel.js - Extracted from CreatePost.js (v61)
 * Hierarchical location/spot picker: Country > State > City > Spot.
 * 
 * FIXED (v76): All parent-scope dependencies now received as props.
 */
import React from 'react';
import { MapPin, ChevronDown, Loader2, Navigation } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const LocationPickerPanel = ({
  // Toggle state
  showLocationPicker, setShowLocationPicker,
  // Hierarchy selection state
  selectedCountry, setSelectedCountry,
  selectedState, setSelectedState,
  selectedCity, setSelectedCity,
  selectedSpot, setSelectedSpot,
  // Data
  locationHierarchy,
  location, setLocation,
  nearestSpot, userLat, userLon,
  gpsLoading, getGpsLocation,
  recentLocations,
  knownSpots, allSpots,
  // Handlers
  handleHierarchySpotSelect,
  handleRecentLocationSelect,
  handleSpotSelect,
  fetchConditions,
  calculateDistance,
  // Theme classes
  cardBg, cardBorder, isLight,
  labelClass, bgInput, borderInput, textInput,
  selectContentBg, selectItemClass,
  hoverBg, pillBg,
}) => {
  return (
    <>
            {/* Location Picker */}
            <div className={`rounded-xl border ${cardBorder} overflow-hidden`}>
              {/* Location header / selected value */}
              <button
                type="button"
                aria-expanded={showLocationPicker} onClick={() => setShowLocationPicker(!showLocationPicker)}
                className={`w-full flex items-center justify-between p-3 ${cardBg} transition-all`}
              >
                <div className="flex items-center gap-2">
                  <MapPin className={`w-5 h-5 ${location ? 'text-cyan-500' : labelClass}`} />
                  <span className={location ? 'text-foreground font-medium' : labelClass}>
                    {location || 'Add a location'}
                  </span>
                  {nearestSpot && userLat && (
                    <span className="text-xs text-cyan-500 bg-cyan-500/10 px-2 py-0.5 rounded-full">
                      📍 {nearestSpot.distance}km
                    </span>
                  )}
                </div>
                <ChevronDown className={`w-4 h-4 ${labelClass} transition-transform ${showLocationPicker ? 'rotate-180' : ''}`} />
              </button>

              {/* Expanded location picker */}
              {showLocationPicker && (
                <div className={`p-3 space-y-3 border-t ${cardBorder}`}>
                  {/* GPS Button */}
                  <Button aria-label="Loader2"
                    type="button"
                    onClick={getGpsLocation}
                    disabled={gpsLoading}
                    variant="outline"
                    className={`w-full border-cyan-500/50 text-cyan-500 hover:bg-cyan-500/10 ${isLight ? 'hover:text-cyan-600' : ''}`}
                  >
                    {gpsLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Navigation className="w-4 h-4 mr-2" />
                    )}
                    {gpsLoading ? 'Finding location...' : 'Use My GPS Location'}
                  </Button>

                  {/* Nearest spot result */}
                  {nearestSpot && userLat && (
                    <div className={`p-3 rounded-lg ${isLight ? 'bg-cyan-50 border border-cyan-200' : 'bg-cyan-500/10 border border-cyan-500/20'}`}>
                      <p className={`text-xs ${labelClass} mb-1`}>Nearest spot detected</p>
                      <button
                        type="button"
                        onClick={() => {
                          setLocation(nearestSpot.name);
                          if (nearestSpot.latitude && nearestSpot.longitude) {
                            fetchConditions(nearestSpot.latitude, nearestSpot.longitude, nearestSpot.name);
                          }
                          setShowLocationPicker(false);
                        }}
                        className={`flex items-center gap-2 w-full text-left p-2 rounded-lg ${isLight ? 'hover:bg-cyan-100' : 'hover:bg-cyan-500/20'} transition-colors`}
                      >
                        <MapPin className="w-4 h-4 text-cyan-500 flex-shrink-0" />
                        <div>
                          <p className="text-foreground font-medium text-sm">{nearestSpot.name}</p>
                          <p className="text-xs text-cyan-500">{nearestSpot.distance}km away</p>
                        </div>
                      </button>
                    </div>
                  )}

                  {/* Divider */}
                  <div className="flex items-center gap-3">
                    <div className={`flex-1 h-px ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`} />
                    <span className={`text-xs ${labelClass}`}>or select manually</span>
                    <div className={`flex-1 h-px ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`} />
                  </div>

                  {/* Hierarchical Pickers: Country → State → City → Spot */}
                  <div className="space-y-2">
                    {/* Country */}
                    <Select value={selectedCountry} onValueChange={(val) => { setSelectedCountry(val); setSelectedState(''); setSelectedCity(''); }}>
                      <SelectTrigger className={`${bgInput} ${borderInput} ${textInput} text-sm`}>
                        <SelectValue placeholder="Country" />
                      </SelectTrigger>
                      <SelectContent className={selectContentBg}>
                        {(locationHierarchy.countries || []).map(c => (
                          <SelectItem key={c.name} value={c.name} className={selectItemClass}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* State / Region */}
                    {selectedCountry && (() => {
                      const country = (locationHierarchy.countries || []).find(c => c.name === selectedCountry);
                      const states = country?.states || [];
                      if (states.length === 0) return null;
                      return (
                        <Select value={selectedState} onValueChange={(val) => { setSelectedState(val); setSelectedCity(''); }}>
                          <SelectTrigger className={`${bgInput} ${borderInput} ${textInput} text-sm`}>
                            <SelectValue placeholder="State / Region" />
                          </SelectTrigger>
                          <SelectContent className={selectContentBg}>
                            {states.map(s => (
                              <SelectItem key={s.name} value={s.name} className={selectItemClass}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })()}

                    {/* City / Area */}
                    {selectedState && (() => {
                      const country = (locationHierarchy.countries || []).find(c => c.name === selectedCountry);
                      const state = (country?.states || []).find(s => s.name === selectedState);
                      const cities = state?.cities || [];
                      if (cities.length === 0) return null;
                      return (
                        <Select value={selectedCity} onValueChange={setSelectedCity}>
                          <SelectTrigger className={`${bgInput} ${borderInput} ${textInput} text-sm`}>
                            <SelectValue placeholder="City / Area" />
                          </SelectTrigger>
                          <SelectContent className={selectContentBg}>
                            {cities.map(c => (
                              <SelectItem key={c.name} value={c.name} className={selectItemClass}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })()}

                    {/* Spots in selected city */}
                    {selectedCity && (() => {
                      const country = (locationHierarchy.countries || []).find(c => c.name === selectedCountry);
                      const state = (country?.states || []).find(s => s.name === selectedState);
                      const city = (state?.cities || []).find(c => c.name === selectedCity);
                      const citySpots = city?.spots || [];
                      if (citySpots.length === 0) {
                        // No spots? Set city as location
                        return (
                          <Button aria-label="Location"
                            type="button"
                            variant="outline"
                            className="w-full border-cyan-500/50 text-cyan-500"
                            onClick={() => {
                              setLocation(`${selectedCity}, ${selectedState}`);
                              setShowLocationPicker(false);
                            }}
                          >
                            <MapPin className="w-4 h-4 mr-2" />
                            Use "{selectedCity}, {selectedState}"
                          </Button>
                        );
                      }
                      return (
                        <div className={`rounded-lg ${cardBg} p-2 space-y-1`}>
                          <p className={`text-xs ${labelClass} px-2 py-1`}>Surf spots in {selectedCity}</p>
                          {citySpots.map(spot => (
                            <button aria-label="Location"
                              key={spot.id || spot.name}
                              type="button"
                              onClick={() => {
                                setLocation(spot.name);
                                handleHierarchySpotSelect(spot.id);
                                setShowLocationPicker(false);
                              }}
                              className={`w-full text-left px-3 py-2 rounded-lg text-sm text-foreground ${hoverBg} transition-colors flex items-center gap-2`}
                            >
                              <MapPin className="w-3.5 h-3.5 text-cyan-500 flex-shrink-0" />
                              <span>{spot.name}</span>
                              {userLat && spot.latitude && (
                                <span className="ml-auto text-xs text-cyan-500">
                                  {calculateDistance(userLat, userLon, spot.latitude, spot.longitude).toFixed(1)}km
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Recent Locations */}
                  {recentLocations.length > 0 && (
                    <div>
                      <p className={`text-xs ${labelClass} mb-2`}>Recent locations</p>
                      <div className="flex flex-wrap gap-2">
                        {recentLocations.slice(0, 5).map((loc, i) => (
                          <button aria-label="Location"
                            key={i}
                            type="button"
                            onClick={() => {
                              handleRecentLocationSelect(loc);
                              setShowLocationPicker(false);
                            }}
                            className={`px-3 py-1.5 ${pillBg} rounded-full text-sm flex items-center gap-1`}
                          >
                            <MapPin className="w-3 h-3" />
                            {loc.location}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick Select Dropdown - populated from city spots or knownSpots */}
                  {(() => {
                    // If a city is selected, show spots from that city directly
                    if (selectedCity && selectedCountry && selectedState) {
                      const country = (locationHierarchy.countries || []).find(c => c.name === selectedCountry);
                      const state = (country?.states || []).find(s => s.name === selectedState);
                      const city = (state?.cities || []).find(c => c.name === selectedCity);
                      const citySpots = city?.spots || [];
                      
                      if (citySpots.length > 0) {
                        return (
                          <div>
                            <p className={`text-xs ${labelClass} mb-1`}>
                              Surf spots in {selectedCity}
                            </p>
                            <Select 
                              value="" 
                              onValueChange={(spotName) => {
                                // Find this spot in allSpots for lat/lon to fetch conditions
                                const fullSpot = allSpots.find(s => s.name === spotName);
                                setLocation(spotName);
                                if (fullSpot?.latitude && fullSpot?.longitude) {
                                  fetchConditions(fullSpot.latitude, fullSpot.longitude, spotName);
                                }
                                setShowLocationPicker(false);
                              }}
                            >
                              <SelectTrigger className={`${bgInput} ${borderInput} ${textInput} text-sm`}>
                                <SelectValue placeholder={`Select from ${citySpots.length} spots...`} />
                              </SelectTrigger>
                              <SelectContent className={selectContentBg}>
                                {citySpots.map(spot => (
                                  <SelectItem key={spot.id || spot.name} value={spot.name} className={selectItemClass}>
                                    {spot.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      }
                    }
                    
                    // Fallback: show all knownSpots (conditions-enabled)
                    if (knownSpots.length === 0) return null;
                    return (
                      <div>
                        <p className={`text-xs ${labelClass} mb-1`}>Quick select (auto-fills conditions)</p>
                        <Select value={selectedSpot} onValueChange={handleSpotSelect}>
                          <SelectTrigger className={`${bgInput} ${borderInput} ${textInput} text-sm`}>
                            <SelectValue placeholder="Select a surf spot..." />
                          </SelectTrigger>
                          <SelectContent className={selectContentBg}>
                            {knownSpots.map(spot => (
                              <SelectItem key={spot.key} value={spot.key} className={selectItemClass}>
                                {spot.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })()}

                  {/* Manual input fallback */}
                  <div className="relative">
                    <Input aria-label="Or type a location..."
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Or type a location..."
                      className={`${bgInput} ${borderInput} ${textInput} text-sm`}
                      data-testid="location-input"
                    />
                  </div>
                </div>
              )}
            </div>
    </>
  );
};

export default LocationPickerPanel;
