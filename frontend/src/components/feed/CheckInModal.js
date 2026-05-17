/**
 * CheckInModal.js - Extracted from Feed.js (v60)
 * Self-contained GPS-based surf spot check-in modal with gamification rewards.
 */
import React from 'react';
import { MapPin, Flame, Loader2, Navigation, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const CheckInModal = ({
  open, onClose,
  checkInData, setCheckInData,
  checkInLoading, checkInReward,
  gpsLoading, nearestSpot, spots,
  locationHierarchy, selectedCountry, setSelectedCountry,
  selectedState, setSelectedState,
  selectedCity, setSelectedCity,
  calculateDistance, getGpsLocation, submitCheckIn,
}) => {
  return (
        <Dialog open={open} onOpenChange={onClose}>
          <DialogContent className="bg-zinc-900 border border-zinc-700 text-white max-w-md w-full max-h-[90vh] flex flex-col p-0 overflow-hidden" aria-describedby="checkin-modal-description">
            {/* Fixed header */}
            <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-zinc-800">
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                <MapPin className="w-5 h-5 text-yellow-400" />
                Check In
              </DialogTitle>
              <DialogDescription id="checkin-modal-description" className="sr-only">
                Check in to a surf spot
              </DialogDescription>
            </DialogHeader>
  
            {/* Gamification Reward Card - shown after GPS check-in */}
            {checkInReward ? (
              <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 text-center">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center mb-4 shadow-lg shadow-yellow-400/30">
                  <Flame className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-2xl font-black text-white mb-1">Checked In! ??</h3>
                <p className="text-gray-400 text-sm mb-6">{checkInReward.spot_name}</p>
  
                {/* XP earned */}
                {checkInReward.xp_earned > 0 && (
                  <div className="flex items-center gap-2 bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-6 py-3 mb-3">
                    <Sparkles className="w-5 h-5 text-yellow-400" />
                    <span className="text-2xl font-black text-yellow-400">+{checkInReward.xp_earned} XP</span>
                  </div>
                )}
  
                {/* First visit bonus */}
                {checkInReward.is_first_visit && (
                  <div className="text-blue-400 text-sm font-medium mb-2">?? First visit to this spot!</div>
                )}
  
                {/* Badge earned */}
                {checkInReward.badge_earned && (
                  <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-500/30 rounded-xl px-5 py-3 mb-3">
                    <span className="text-lg">??</span>
                    <div className="text-left">
                      <div className="text-xs text-purple-400 uppercase tracking-wide">Badge Earned</div>
                      <div className="text-white font-semibold capitalize">{checkInReward.badge_earned.replace(/_/g, ' ')}</div>
                    </div>
                  </div>
                )}
  
                {/* Streak */}
                {checkInReward.streak_days > 0 && (
                  <div className="text-orange-400 text-sm mb-6">
                    ?? {checkInReward.streak_days} day streak
                    {checkInReward.streak_days >= 7 ? ' - on fire!' : ' - keep it going!'}
                  </div>
                )}
  
                <Button
                  onClick={onClose}
                  className="w-full bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold h-12"
                >
                  Awesome! ??
                </Button>
              </div>
            ) : (
              <>
                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
  
                  {/* GPS Location Button */}
                  <div>
                    <Button
                      onClick={getGpsLocation}
                      disabled={gpsLoading}
                      variant="outline"
                      className={`w-full ${
                        checkInData.latitude
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                          : 'border-zinc-700 text-white hover:bg-zinc-800'
                      }`}
                      data-testid="gps-checkin-btn"
                    >
                      {gpsLoading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Navigation className={`w-4 h-4 mr-2 ${checkInData.latitude ? 'text-emerald-400' : ''}`} />
                      )}
                      {gpsLoading ? 'Finding your location\u2026' : checkInData.latitude ? '\u2713 GPS Location Detected' : 'Use My GPS Location'}
                    </Button>
  
                    {/* GPS accuracy progress bar */}
                    {gpsLoading && (
                      <div className="mt-2 space-y-1.5">
                        <div className="h-1.5 rounded-full bg-zinc-700 overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 rounded-full animate-pulse" style={{ width: '65%', transition: 'width 2s ease-out' }} />
                        </div>
                        <p className="text-xs text-zinc-400 text-center">Acquiring GPS signal - keep screen on</p>
                      </div>
                    )}
  
                    {/* GPS feedback */}
                    {nearestSpot && checkInData.latitude && (
                      <div className={`mt-2 p-2.5 rounded-lg text-xs ${
                        parseFloat(nearestSpot.distance) < 10
                          ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                          : 'bg-zinc-800 border border-zinc-700 text-gray-400'
                      }`}>
                        <span className="font-medium">{nearestSpot.name}</span>
                        {' '}&mdash; {nearestSpot.distance}km away
                        {parseFloat(nearestSpot.distance) < 10
                          ? ' - +¦++GÇ£-ì Within range - you\'ll earn Passport XP!'
                          : ' - Outside 10km check-in zone'}
                      </div>
                    )}
                  </div>
  
                  {/* Divider */}
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-zinc-700" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-zinc-900 px-2 text-gray-500">or select your spot</span>
                    </div>
                  </div>
  
                  {/* Country selector */}
                  <div>
                    <span className="text-sm text-gray-400 mb-2 block">Country</span>
                    <Select
                      value={selectedCountry}
                      onValueChange={(v) => { setSelectedCountry(v); setSelectedState(''); setCheckInData(prev => ({ ...prev, spot_id: '' })); }}
                    >
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                        <SelectValue placeholder="Select a country" />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700 max-h-60 overflow-y-auto">
                        {locationHierarchy.countries.map(c => (
                          <SelectItem key={c.name} value={c.name} className="text-white hover:bg-zinc-700">
                            {c.name} <span className="text-gray-500 text-xs ml-1">({c.spot_count} spots)</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
  
                  {/* State/Province selector - only shown when country selected */}
                  {selectedCountry && (() => {
                    const countryData = locationHierarchy.countries.find(c => c.name === selectedCountry);
                    const states = countryData?.states || [];
                    if (states.length === 0) return null;
                    return (
                      <div>
                        <span className="text-sm text-gray-400 mb-2 block">State / Province</span>
                        <Select
                          value={selectedState}
                          onValueChange={(v) => { setSelectedState(v); setSelectedCity(''); setCheckInData(prev => ({ ...prev, spot_id: '' })); }}
                        >
                          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                            <SelectValue placeholder="Select a state / province" />
                          </SelectTrigger>
                          <SelectContent className="bg-zinc-800 border-zinc-700 max-h-60 overflow-y-auto">
                            {states.map(s => (
                              <SelectItem key={s.name} value={s.name} className="text-white hover:bg-zinc-700">
                                {s.name} <span className="text-gray-500 text-xs ml-1">({s.spot_count})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })()}
  
                  {/* City / Area selector - shown when state is selected */}
                  {selectedState && (() => {
                    // First try cities from the hierarchy API response
                    const countryData = locationHierarchy.countries.find(c => c.name === selectedCountry);
                    const stateData = countryData?.states?.find(s => s.name === selectedState);
                    const apiCities = stateData?.cities || [];
  
                    // Fallback: derive cities directly from the loaded spots list
                    // (handles spots where state_province is null in the DB but region is set)
                    const spotsInState = spots.filter(s =>
                      s.country === selectedCountry &&
                      (selectedState ? s.state_province === selectedState : true)
                    );
                    const derivedCities = apiCities.length > 0
                      ? apiCities
                      : [...new Set(spotsInState.map(s => s.region).filter(Boolean))]
                          .sort()
                          .map(r => ({ name: r, spot_count: spotsInState.filter(s => s.region === r).length }));
  
                    if (derivedCities.length === 0) return null; // No regional data at all
                    return (
                      <div>
                        <span className="text-sm text-gray-400 mb-2 block">City / Area <span className="text-zinc-600 text-xs">(optional)</span></span>
                        <Select
                          value={selectedCity}
                          onValueChange={(v) => { setSelectedCity(v === '__all__' ? '' : v); setCheckInData(prev => ({ ...prev, spot_id: '' })); }}
                        >
                          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                            <SelectValue placeholder="All areas (or pick one to narrow)" />
                          </SelectTrigger>
                          <SelectContent className="bg-zinc-800 border-zinc-700 max-h-60 overflow-y-auto">
                            <SelectItem value="__all__" className="text-zinc-400 hover:bg-zinc-700 italic">- All areas -</SelectItem>
                            {derivedCities.map(c => (
                              <SelectItem key={c.name} value={c.name} className="text-white hover:bg-zinc-700">
                                {c.name} <span className="text-gray-500 text-xs ml-1">({c.spot_count} {c.spot_count === 1 ? 'spot' : 'spots'})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })()}
  
                  {/* Spot selector - GPS-sorted when GPS active, filtered by hierarchy when manual */}
                  <div>
                    <span className="text-sm text-gray-400 mb-2 block">
                      Surf Spot
                      {checkInData.use_gps && checkInData.latitude && (
                        <span className="ml-2 text-xs text-cyan-400">?? sorted by distance</span>
                      )}
                    </span>
                    <Select
                      value={checkInData.spot_id}
                      onValueChange={(v) => setCheckInData(prev => ({ ...prev, spot_id: v }))}
                    >
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                        <SelectValue placeholder={
                          checkInData.use_gps && checkInData.latitude
                            ? 'Nearest spots listed first'
                            : selectedCountry ? 'Select a spot' : 'Select country first (or use GPS)'
                        } />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700 max-h-72 overflow-y-auto">
                        {(() => {
                          // GPS MODE: sort all spots by distance from user, show nearest first
                          if (checkInData.use_gps && checkInData.latitude && checkInData.longitude) {
                            return spots
                              .map(spot => ({
                                ...spot,
                                _dist: spot.latitude && spot.longitude
                                  ? calculateDistance(checkInData.latitude, checkInData.longitude, spot.latitude, spot.longitude)
                                  : Infinity
                              }))
                              .sort((a, b) => a._dist - b._dist)
                              .slice(0, 30) // limit to 30 nearest spots for readability
                              .map(spot => (
                                <SelectItem key={spot.id} value={spot.id} className="text-white hover:bg-zinc-700">
                                  <span className="flex items-center justify-between w-full">
                                    <span>{spot.name}</span>
                                    <span className={`text-xs ml-2 ${
                                      spot._dist < 2 ? 'text-green-400' :
                                      spot._dist < 10 ? 'text-cyan-400' :
                                      'text-gray-500'
                                    }`}>
                                      {spot._dist === Infinity ? '' : `${spot._dist.toFixed(1)}km`}
                                    </span>
                                  </span>
                                </SelectItem>
                              ));
                          }
  
                          // MANUAL MODE: filter by country ? state ? city hierarchy, sorted alphabetically
                          return spots
                            .filter(spot => {
                              if (!selectedCountry) return true;
                              if (spot.country !== selectedCountry) return false;
                              if (selectedState && spot.state_province !== selectedState) return false;
                              if (selectedCity && spot.region !== selectedCity) return false;
                              return true;
                            })
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((spot) => (
                              <SelectItem key={spot.id} value={spot.id} className="text-white hover:bg-zinc-700">
                                {spot.name}
                                {spot.region && <span className="text-gray-500 text-xs ml-1"> - {spot.region}</span>}
                              </SelectItem>
                            ));
                        })()}
                      </SelectContent>
                    </Select>
                  </div>
  
                  {/* Conditions */}
                  <div>
                    <span className="text-sm text-gray-400 mb-2 block">Conditions</span>
                    <Select value={checkInData.conditions} onValueChange={(v) => setCheckInData(prev => ({ ...prev, conditions: v }))}>
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                        <SelectValue placeholder="How's it looking?" />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        <SelectItem value="Glassy" className="text-white hover:bg-zinc-700">?? Glassy</SelectItem>
                        <SelectItem value="Clean" className="text-white hover:bg-zinc-700">? Clean</SelectItem>
                        <SelectItem value="Choppy" className="text-white hover:bg-zinc-700">?? Choppy</SelectItem>
                        <SelectItem value="Messy" className="text-white hover:bg-zinc-700">?? Messy</SelectItem>
                    <SelectItem value="Blown Out" className="text-white hover:bg-zinc-700">{String.fromCodePoint(0x1F4A5)} Blown Out</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
  
                  {/* Wave Height */}
                  <div>
                    <span className="text-sm text-gray-400 mb-2 block">Wave Height</span>
                    <Select value={checkInData.wave_height} onValueChange={(v) => setCheckInData(prev => ({ ...prev, wave_height: v }))}>
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                        <SelectValue placeholder="How big?" />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        <SelectItem value="Flat" className="text-white hover:bg-zinc-700">Flat</SelectItem>
                        <SelectItem value="1-2ft" className="text-white hover:bg-zinc-700">1-2ft</SelectItem>
                        <SelectItem value="2-3ft" className="text-white hover:bg-zinc-700">2-3ft</SelectItem>
                        <SelectItem value="3-4ft" className="text-white hover:bg-zinc-700">3-4ft</SelectItem>
                        <SelectItem value="4-6ft" className="text-white hover:bg-zinc-700">4-6ft</SelectItem>
                        <SelectItem value="6-8ft" className="text-white hover:bg-zinc-700">6-8ft</SelectItem>
                        <SelectItem value="8ft+" className="text-white hover:bg-zinc-700">8ft+ (Overhead+)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
  
                  {/* Notes */}
                  <div>
                    <label htmlFor="notes-input" className="text-sm text-gray-400 mb-2 block">Notes (optional)</label>
                    <Input id="notes-input"
                      placeholder="How was your session?"
                      value={checkInData.notes}
                      onChange={(e) => setCheckInData(prev => ({ ...prev, notes: e.target.value }))}
                      className="bg-zinc-800 border-zinc-700 text-white placeholder-gray-500"
                    />
                  </div>
  
                  {/* GPS Passport XP info banner */}
                  {checkInData.use_gps && checkInData.latitude && (checkInData.spot_id || nearestSpot) && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                      <Navigation className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                      <div className="text-xs text-emerald-300">
                        <span className="font-medium">GPS-Verified Check-In:</span> Must be within 500m of the spot to earn Passport XP &amp; stamps.
                      </div>
                    </div>
                  )}
                </div>
  
                {/* Fixed footer */}
                <div className="px-6 pb-6 pt-3 shrink-0 border-t border-zinc-800">
                  <Button aria-label="Loader2"
                    onClick={submitCheckIn}
                    disabled={checkInLoading}
                    className="w-full h-12 bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold"
                    data-testid="feed-checkin-submit-btn"
                  >
                    {checkInLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Flame className="w-5 h-5 mr-2" />
                        {checkInData.use_gps && (checkInData.spot_id || nearestSpot)
                          ? 'Check In + Earn XP +¦++-ÅGÇP'
                          : 'Check In & Keep Streak +¦++GÇ¥-Ñ'}
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
  );
};

export default CheckInModal;
