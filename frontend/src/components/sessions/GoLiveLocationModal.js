import React from 'react';
import {
  MapPin, Radio, Target, Search, X, AlertTriangle, Check, RefreshCw, Play
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

var GoLiveLocationModal = ({
  isOpen, onClose, sessionSettings, setSessionSettings, userLocation,
  nearbySpots, nearbySpotsLoading, surfSpots, spotSearchQuery, setSpotSearchQuery,
  distanceToSpot, setDistanceToSpot, setManualConfirm, manualConfirm,
  isWithinRange, canProceed, handleGoLiveConfirmed, locationError,
  REQUIRED_DISTANCE_MILES, NEARBY_RADIUS_MILES,
  isLight, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass
}) => {
  return (
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader className="border-b border-inherit">
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <Radio className="w-5 h-5 text-green-400 animate-pulse" />
              Go Live - Select Location
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 scroll-touch">
            <div className="space-y-4 py-4">
            {/* Current Settings Summary */}
            <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
              <p className={`text-xs ${textSecondaryClass} mb-2`}>Your current session rates:</p>
              <div className="flex items-center gap-4 flex-wrap">
                <span className={`text-sm ${textPrimaryClass}`}>
                  <span className="text-green-400 font-bold">${sessionSettings.price_per_join}</span> buy-in
                </span>
                <span className={`text-sm ${textPrimaryClass}`}>
                  <span className="text-cyan-400 font-bold">{sessionSettings.photos_included}</span> photos included
                </span>
                <span className={`text-sm ${textPrimaryClass}`}>
                  {sessionSettings.pricing_mode === 'promotional' ? (
                    <><span className="text-purple-400 font-bold">${sessionSettings.live_photo_price}</span> promo rate</>
                  ) : (
                    <span className="text-purple-400">Tiered pricing</span>
                  )}
                </span>
              </div>
            </div>

            {/* GPS-Based Nearby Spots OR Search Input */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className={`${textSecondaryClass} flex items-center gap-2`}>
                  <MapPin className="w-4 h-4 text-blue-400" />
                  {userLocation ? 'Nearby Surf Spots' : 'Search Surf Spots'}
                </Label>
                {userLocation ? (
                  <Badge variant="outline" className="text-xs border-green-500/50 text-green-400">
                    <Target className="w-3 h-3 mr-1" />
                    GPS Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-400">
                    <Search className="w-3 h-3 mr-1" />
                    Manual Search
                  </Badge>
                )}
              </div>
              
              {/* GPS Unavailable - Show Search Input */}
              {!userLocation && !nearbySpotsLoading && (
                <>
                  <div className={`p-3 rounded-xl mb-3 ${isLight ? 'bg-amber-50 border border-amber-200' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-amber-500 font-medium text-sm">GPS unavailable</p>
                        <p className={`text-xs ${textSecondaryClass} mt-1`}>
                          Search for your spot below. You'll need to confirm you're at the location before going live.
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Search Input */}
                  <div className="relative mb-3">
                    <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondaryClass}`} />
                    <Input aria-label="Type to search spots..."
                      type="text"
                      placeholder="Type to search spots..."
                      value={spotSearchQuery}
                      onChange={(e) => setSpotSearchQuery(e.target.value)}
                      className={`pl-10 pr-10 ${inputBgClass} ${textPrimaryClass} border ${borderClass}`}
                      data-testid="spot-search-input"
                    />
                    {spotSearchQuery && (
                      <button
                        onClick={() => setSpotSearchQuery('')}
                        className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-zinc-700`}
                      >
                        <X className={`w-4 h-4 ${textSecondaryClass}`} />
                      </button>
                    )}
                  </div>
                </>
              )}
              
              {nearbySpotsLoading ? (
                <div className={`flex flex-col items-center justify-center py-8 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                  <RefreshCw className="w-6 h-6 animate-spin text-cyan-400 mb-2" />
                  <p className={`text-sm ${textSecondaryClass}`}>Finding nearby spots...</p>
                </div>
              ) : userLocation ? (
                /* GPS Available - Show Nearby Spots List */
                nearbySpots.length === 0 ? (
                  <div className={`flex flex-col items-center justify-center py-8 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                    <MapPin className={`w-8 h-8 ${textSecondaryClass} mb-2 opacity-50`} />
                    <p className={`text-sm ${textPrimaryClass} font-medium`}>No spots nearby</p>
                    <p className={`text-xs ${textSecondaryClass} text-center mt-1`}>
                      No surf spots found within {NEARBY_RADIUS_MILES} miles of your location
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                    {nearbySpots.map((spot) => {
                      const isSelected = sessionSettings.surf_spot_id === spot.id;
                      const hasDistance = spot.distance !== null && spot.distance !== undefined;
                      const isWithinLiveRange = hasDistance && spot.distance <= REQUIRED_DISTANCE_MILES;
                    
                    return (
                      <button
                        key={spot.id}
                        onClick={() => {
                          setSessionSettings({ 
                            ...sessionSettings, 
                            surf_spot_id: spot.id,
                            location: spot.name
                          });
                          setDistanceToSpot(spot.distance);
                          setManualConfirm(false);
                        }}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                          isSelected
                            ? isWithinLiveRange
                              ? `${isLight ? 'bg-green-50 border-2 border-green-400' : 'bg-green-500/20 border-2 border-green-500/50'}`
                              : `${isLight ? 'bg-blue-50 border-2 border-blue-400' : 'bg-blue-500/20 border-2 border-blue-500/50'}`
                            : `${isLight ? 'bg-gray-50 border border-gray-200 hover:bg-gray-100' : 'bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-800'}`
                        }`}
                        data-testid={`nearby-spot-${spot.id}`}
                      >
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          isSelected
                            ? isWithinLiveRange ? 'bg-green-500/30' : 'bg-blue-500/30'
                            : isLight ? 'bg-gray-200' : 'bg-zinc-700'
                        }`}>
                          {isWithinLiveRange ? (
                            <Check className={`w-5 h-5 ${isSelected ? 'text-green-400' : 'text-green-500'}`} />
                          ) : (
                            <MapPin className={`w-5 h-5 ${isSelected ? 'text-blue-400' : textSecondaryClass}`} />
                          )}
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <p className={`font-medium truncate ${isSelected ? (isWithinLiveRange ? 'text-green-400' : 'text-blue-400') : textPrimaryClass}`}>
                            {spot.name}
                          </p>
                          <p className={`text-xs truncate ${textSecondaryClass}`}>
                            {spot.region || spot.city || 'Unknown region'}
                          </p>
                        </div>
                        <div className="flex flex-col items-end flex-shrink-0">
                          {hasDistance ? (
                            <>
                              <span className={`text-sm font-bold ${
                                isWithinLiveRange 
                                  ? 'text-green-400' 
                                  : spot.distance <= 1 
                                    ? 'text-cyan-400' 
                                    : textSecondaryClass
                              }`}>
                                {spot.distance < 0.1 ? '<0.1' : spot.distance.toFixed(1)} mi
                              </span>
                              {isWithinLiveRange && (
                                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs mt-1">
                                  In Range
                                </Badge>
                              )}
                            </>
                          ) : (
                            <span className={`text-xs ${textSecondaryClass}`}>
                              No GPS
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                )
              ) : (
                /* GPS Unavailable - Show Search Results */
                <>
                  {spotSearchQuery.trim() === '' ? (
                    <div className={`flex flex-col items-center justify-center py-8 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                      <Search className={`w-8 h-8 ${textSecondaryClass} mb-2 opacity-50`} />
                      <p className={`text-sm ${textPrimaryClass} font-medium`}>Start typing to search</p>
                      <p className={`text-xs ${textSecondaryClass} text-center mt-1`}>
                        Enter a spot name, city, or region to find your location
                      </p>
                    </div>
                  ) : (
                    (() => {
                      const query = spotSearchQuery.toLowerCase().trim();
                      const filteredSpots = surfSpots.filter(spot => 
                        spot.name?.toLowerCase().includes(query) ||
                        spot.region?.toLowerCase().includes(query) ||
                        spot.city?.toLowerCase().includes(query) ||
                        spot.country?.toLowerCase().includes(query)
                      ).slice(0, 10); // Limit to 10 results
                      
                      if (filteredSpots.length === 0) {
                        return (
                          <div className={`flex flex-col items-center justify-center py-8 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                            <MapPin className={`w-8 h-8 ${textSecondaryClass} mb-2 opacity-50`} />
                            <p className={`text-sm ${textPrimaryClass} font-medium`}>No spots found</p>
                            <p className={`text-xs ${textSecondaryClass} text-center mt-1`}>
                              Try a different search term
                            </p>
                          </div>
                        );
                      }
                      
                      return (
                        <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                          {filteredSpots.map((spot) => {
                            const isSelected = sessionSettings.surf_spot_id === spot.id;
                            
                            return (
                              <button
                                key={spot.id}
                                onClick={() => {
                                  setSessionSettings({ 
                                    ...sessionSettings, 
                                    surf_spot_id: spot.id,
                                    location: spot.name
                                  });
                                  setDistanceToSpot(null); // No distance without GPS
                                  setManualConfirm(false);
                                }}
                                className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                                  isSelected
                                    ? `${isLight ? 'bg-blue-50 border-2 border-blue-400' : 'bg-blue-500/20 border-2 border-blue-500/50'}`
                                    : `${isLight ? 'bg-gray-50 border border-gray-200 hover:bg-gray-100' : 'bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-800'}`
                                }`}
                                data-testid={`search-spot-${spot.id}`}
                              >
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                  isSelected ? 'bg-blue-500/30' : isLight ? 'bg-gray-200' : 'bg-zinc-700'
                                }`}>
                                  <MapPin className={`w-5 h-5 ${isSelected ? 'text-blue-400' : textSecondaryClass}`} />
                                </div>
                                <div className="flex-1 text-left min-w-0">
                                  <p className={`font-medium truncate ${isSelected ? 'text-blue-400' : textPrimaryClass}`}>
                                    {spot.name}
                                  </p>
                                  <p className={`text-xs truncate ${textSecondaryClass}`}>
                                    {[spot.city, spot.region, spot.country].filter(Boolean).join(', ') || 'Unknown location'}
                                  </p>
                                </div>
                                {isSelected && (
                                  <Check className="w-5 h-5 text-blue-400 flex-shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()
                  )}
                </>
              )}
            </div>

            {/* Location Verification Status - Shows after spot is selected */}
            {sessionSettings.surf_spot_id && distanceToSpot !== null && (
              <div className="space-y-3">
                {/* Within Range - Good to go */}
                {isWithinRange && (
                  <div className={`p-3 rounded-xl ${isLight ? 'bg-green-50 border border-green-200' : 'bg-green-500/10 border border-green-500/30'}`}>
                    <div className="flex items-center gap-2">
                      <Check className="w-5 h-5 text-green-400" />
                      <div>
                        <p className="text-green-400 font-medium text-sm">You're at the spot!</p>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          {distanceToSpot.toFixed(2)} miles away - Ready to go live
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Not at spot - Distance Warning + Manual Override */}
                {!isWithinRange && (
                  <>
                    <div className={`p-3 rounded-xl ${isLight ? 'bg-amber-50 border border-amber-300' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-amber-500" />
                        <div>
                          <p className="text-amber-500 font-medium text-sm">Not at the spot yet</p>
                          <p className="text-amber-500 text-xs">
                            You're {distanceToSpot.toFixed(2)} miles away (need to be within {REQUIRED_DISTANCE_MILES} miles)
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Manual Override Option */}
                    <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100 border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Target className="w-4 h-4 text-muted-foreground" />
                        <span className={`font-medium text-sm ${textPrimaryClass}`}>GPS not accurate?</span>
                      </div>
                      <p className={`text-xs ${textSecondaryClass} mb-2`}>
                        If you're physically at {nearbySpots.find(s => s.id === sessionSettings.surf_spot_id)?.name} but GPS shows otherwise, you can manually confirm.
                      </p>
                      <p className="text-amber-500 text-xs mb-3 flex items-start gap-1">
                        <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span>Warning: Going live when not at the spot may result in negative reviews, selling suspension, or account action.</span>
                      </p>
                      <button
                        onClick={() => setManualConfirm(true)}
                        className={`w-full py-2 rounded-lg border text-sm font-medium transition-colors ${
                          manualConfirm
                            ? 'bg-green-500/20 border-green-500/50 text-green-400'
                            : `${isLight ? 'border-gray-300 hover:bg-gray-50' : 'border-zinc-600 hover:bg-zinc-700'} ${textPrimaryClass}`
                        }`}
                        data-testid="manual-confirm-location"
                      >
                        {manualConfirm ? (
                          <span className="flex items-center justify-center gap-2">
                            <Check className="w-4 h-4" />
                            Confirmed - I'm at this spot
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-2">
                            <Check className="w-4 h-4" />
                            I confirm I'm at this spot
                          </span>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* GPS Unavailable - Manual Confirmation Required */}
            {sessionSettings.surf_spot_id && (distanceToSpot === null || distanceToSpot === undefined) && !userLocation && (
              <div className="space-y-3">
                <div className={`p-3 rounded-xl ${isLight ? 'bg-amber-50 border border-amber-300' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    <div>
                      <p className="text-amber-500 font-medium text-sm">GPS unavailable - Manual confirmation required</p>
                      <p className={`text-xs ${textSecondaryClass} mt-1`}>
                        Without GPS, we can't verify your location. Please confirm you're at the selected spot.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Required Manual Confirmation */}
                <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100 border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
                  <p className="text-amber-500 text-xs mb-3 flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>Warning: Going live when not at the spot may result in negative reviews, selling suspension, or account action.</span>
                  </p>
                  <button
                    onClick={() => setManualConfirm(true)}
                    className={`w-full py-2 rounded-lg border text-sm font-medium transition-colors ${
                      manualConfirm
                        ? 'bg-green-500/20 border-green-500/50 text-green-400'
                        : `${isLight ? 'border-gray-300 hover:bg-gray-50' : 'border-zinc-600 hover:bg-zinc-700'} ${textPrimaryClass}`
                    }`}
                    data-testid="manual-confirm-location-no-gps"
                  >
                    {manualConfirm ? (
                      <span className="flex items-center justify-center gap-2">
                        <Check className="w-4 h-4" />
                        Confirmed - I'm at {nearbySpots.find(s => s.id === sessionSettings.surf_spot_id)?.name}
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <Check className="w-4 h-4" />
                        I confirm I'm at this spot
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Location Error */}
            {locationError && (
              <div className={`p-3 rounded-xl ${isLight ? 'bg-red-50 border border-red-200' : 'bg-red-500/10 border border-red-500/30'}`}>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <div>
                    <p className="text-red-400 font-medium text-sm">Location Error</p>
                    <p className={`text-xs ${textSecondaryClass}`}>{locationError}</p>
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button aria-label="Play"
              onClick={handleGoLiveConfirmed}
              disabled={!sessionSettings.surf_spot_id || !canProceed}
              className="bg-gradient-to-r from-green-400 to-emerald-500 text-black font-medium disabled:opacity-50"
              data-testid="go-live-next-btn"
            >
              <Play className="w-4 h-4 mr-2" />
              Next: Add Conditions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
};

export default GoLiveLocationModal;
