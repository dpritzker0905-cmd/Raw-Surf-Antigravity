/**
 * OnDemandSettingsTab - Extracted from OnDemandSessionManager.js
 * Contains the pricing configuration and coverage spots selection UI.
 */
import React from 'react';
import {
  MapPin, DollarSign, Settings, Check, Loader2, Navigation,
  ChevronDown, ChevronUp, Info, Waves, Zap
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { NumericStepper } from '../ui/numeric-stepper';

const OnDemandSettingsTab = ({
  // Theme classes
  theme, isLight, cardBg, borderClass, textPrimary, textSecondary, sectionBg,
  // Pricing state
  baseRate, setBaseRate,
  peakPricingEnabled, setPeakPricingEnabled,
  peakMultiplier, setPeakMultiplier,
  onDemandPhotosIncluded, setOnDemandPhotosIncluded,
  onDemandFullGallery, setOnDemandFullGallery,
  odPriceWeb, setOdPriceWeb,
  odPriceStandard, setOdPriceStandard,
  odPriceHigh, setOdPriceHigh,
  odVideo720p, setOdVideo720p,
  odVideo1080p, setOdVideo1080p,
  odVideo4k, setOdVideo4k,
  cancellationFeePct, setCancellationFeePct,
  // Coverage spots state
  showPricingSection, setShowPricingSection,
  showSpotsList, setShowSpotsList,
  nearbySpots, selectedSpots,
  userLocation, locationLoading,
  isPro, geoRadius,
  // Handlers
  toggleSpotSelection, selectAllSpots, clearAllSpots,
  requestLocation,
}) => {
  return (
    <>
      {/* On-Demand Pricing Card */}
      <Card className={cardBg}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className={`text-lg ${textPrimary} flex items-center gap-2`}>
              <DollarSign className="w-5 h-5 text-green-400" />
              On-Demand Pricing
            </CardTitle>
            <Button aria-label="Settings" 
              variant="outline" 
              size="sm"
              aria-expanded={showPricingSection} onClick={() => setShowPricingSection(!showPricingSection)}
              className={borderClass}
            >
              <Settings className="w-4 h-4 mr-2" />
              {showPricingSection ? 'Hide' : 'Show'}
            </Button>
          </div>
        </CardHeader>
        {showPricingSection && (
          <CardContent className="space-y-6">
            {/* Preview Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className={`p-3 rounded-xl ${sectionBg}`}>
                <p className={`text-xs ${textSecondary} mb-1`}>Base Rate</p>
                <p className="text-xl font-bold text-green-400">${baseRate}/hr</p>
              </div>
              <div className={`p-3 rounded-xl ${sectionBg}`}>
                <p className={`text-xs ${textSecondary} mb-1`}>Peak Rate</p>
                <p className="text-xl font-bold text-amber-400">
                  {peakPricingEnabled ? `$${(baseRate * peakMultiplier).toFixed(0)}/hr` : 'OFF'}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${sectionBg}`}>
                <p className={`text-xs ${textSecondary} mb-1`}>Photos Included</p>
                <p className={`text-xl font-bold ${onDemandFullGallery ? 'text-green-400' : textPrimary}`}>
                  {onDemandFullGallery ? '8 Full' : onDemandPhotosIncluded}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${sectionBg}`}>
                <p className={`text-xs ${textSecondary} mb-1`}>Coverage</p>
                <p className="text-xl font-bold text-cyan-400">{selectedSpots.length} spots</p>
              </div>
            </div>
            
            {/* Base Rate */}
            <NumericStepper
              label="On-Demand Base Rate"
              value={baseRate}
              onChange={setBaseRate}
              min={25}
              max={300}
              step={5}
              prefix="$"
              suffix="/hr"
              description="Premium rate for On-Demand requests (above standard bookings)"
              theme={theme}
            />
            
            {/* Peak/Swell Pricing Toggle */}
            <div className={`p-4 rounded-xl ${isLight ? 'bg-amber-50 border-amber-200' : 'bg-amber-500/10 border-amber-500/30'} border`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Waves className="w-5 h-5 text-amber-400" />
                  <div>
                    <p className={`font-medium ${textPrimary}`}>Peak/Swell Pricing</p>
                    <p className={`text-xs ${textSecondary}`}>Auto-increase rate during high demand</p>
                  </div>
                </div>
                <Switch
                  checked={peakPricingEnabled}
                  onCheckedChange={setPeakPricingEnabled}
                />
              </div>
              
              {peakPricingEnabled && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm ${textPrimary}`}>Peak Multiplier</span>
                    <span className="text-lg font-bold text-amber-400">{peakMultiplier}x</span>
                  </div>
                  <div className="flex gap-2">
                    {[1.25, 1.5, 1.75, 2.0].map(mult => (
                      <button
                        key={mult}
                        onClick={() => setPeakMultiplier(mult)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                          peakMultiplier === mult
                            ? 'bg-amber-500 text-black'
                            : isLight ? 'bg-gray-200 text-gray-700' : 'bg-zinc-700 text-gray-300'
                        }`}
                      >
                        {mult}x
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            {/* Photos Included */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <label className={`font-medium ${textPrimary}`}>Photos Included</label>
                  {onDemandFullGallery && (
                    <Badge className="bg-green-500 text-white text-xs">FULL GALLERY</Badge>
                  )}
                </div>
              </div>
              
              {/* Full Gallery Toggle */}
              <div className={`p-3 rounded-xl mb-4 ${isLight ? 'bg-green-50 border-green-200' : 'bg-green-500/10 border-green-500/30'} border`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-green-400" />
                    <div>
                      <p className={`font-medium ${textPrimary}`}>Full Gallery Access</p>
                      <p className={`text-xs ${textSecondary}`}>All photos included - unlimited downloads</p>
                    </div>
                  </div>
                  <Switch
                    checked={onDemandFullGallery}
                    onCheckedChange={setOnDemandFullGallery}
                  />
                </div>
              </div>
              
              {!onDemandFullGallery && (
                <NumericStepper
                  value={onDemandPhotosIncluded}
                  onChange={setOnDemandPhotosIncluded}
                  min={0}
                  max={999}
                  step={1}
                  description="Photos included free with on-demand buy-in. Additional charged per resolution."
                  theme={theme}
                />
              )}

              <div className={`mt-4 p-4 rounded-xl border ${isLight ? 'bg-blue-50 border-blue-200' : 'bg-blue-500/10 border-blue-500/20'}`}>
                <p className={`text-sm font-semibold mb-3 flex items-center gap-2 ${textPrimary}`}>
                  {String.fromCodePoint(0x1F4F7)} Photo Download Prices
                  <span className={`text-xs font-normal ${textSecondary}`}>(per resolution - independent from Gallery)</span>
                </p>
                <div className="grid grid-cols-1 gap-3">
                  <NumericStepper label="Web Quality (800px)" value={odPriceWeb} onChange={setOdPriceWeb} min={0} max={500} step={0.5} prefix="$" theme={theme} />
                  <NumericStepper label="Standard (1920px)" value={odPriceStandard} onChange={setOdPriceStandard} min={0} max={500} step={0.5} prefix="$" theme={theme} />
                  <NumericStepper label="High-Res (Original)" value={odPriceHigh} onChange={setOdPriceHigh} min={0} max={500} step={0.5} prefix="$" theme={theme} />
                </div>
              </div>

              <div className={`mt-4 p-4 rounded-xl border ${isLight ? 'bg-purple-50 border-purple-200' : 'bg-purple-500/10 border-purple-500/20'}`}>
                <p className={`text-sm font-semibold mb-3 flex items-center gap-2 ${textPrimary}`}>
                  {String.fromCodePoint(0x1F3AC)} Video Download Prices
                  <span className={`text-xs font-normal ${textSecondary}`}>(per resolution - independent from Gallery)</span>
                </p>
                <div className="grid grid-cols-1 gap-3">
                  <NumericStepper label="720p HD" value={odVideo720p} onChange={setOdVideo720p} min={0} max={500} step={0.5} prefix="$" theme={theme} />
                  <NumericStepper label="1080p Full HD" value={odVideo1080p} onChange={setOdVideo1080p} min={0} max={500} step={0.5} prefix="$" theme={theme} />
                  <NumericStepper label="4K Ultra HD" value={odVideo4k} onChange={setOdVideo4k} min={0} max={500} step={0.5} prefix="$" theme={theme} />
                </div>
              </div>

              <div className={`mt-4 p-4 rounded-xl border ${isLight ? 'bg-red-50 border-red-200' : 'bg-red-500/10 border-red-500/20'}`}>
                <p className={`text-sm font-semibold mb-1 flex items-center gap-2 ${textPrimary}`}>
                  {String.fromCodePoint(0x26A0, 0xFE0F)} Cancellation Fee
                </p>
                <p className={`text-xs ${textSecondary} mb-3`}>
                  Percentage of payment kept when a surfer cancels after you accept. 0% = fully refundable.
                </p>
                <NumericStepper
                  label="Fee Percentage"
                  value={cancellationFeePct}
                  onChange={setCancellationFeePct}
                  min={0}
                  max={100}
                  step={5}
                  suffix="%"
                  theme={theme}
                />
                <div className={`mt-2 text-xs ${textSecondary} flex items-center gap-1`}>
                  <Info className="w-3 h-3" />
                  {cancellationFeePct === 0 ? 'Fully refundable - surfers get full payment back' :
                   cancellationFeePct === 100 ? 'Non-refundable - you keep the entire payment' :
                   `Surfer receives ${100 - cancellationFeePct}% refund on cancellation`}
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>
      
      {/* Coverage Spots Card */}
      <Card className={cardBg}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className={`text-lg ${textPrimary} flex items-center gap-2`}>
              <MapPin className="w-5 h-5 text-cyan-400" />
              Coverage Spots
              <Badge className={isPro ? 'bg-purple-500 text-white' : 'bg-cyan-500 text-white'}>
                {geoRadius.min}-{geoRadius.max} mi
              </Badge>
            </CardTitle>
            <Button aria-label="Collapse" 
              variant="outline" 
              size="sm"
              aria-expanded={showSpotsList} onClick={() => setShowSpotsList(!showSpotsList)}
              className={borderClass}
            >
              {showSpotsList ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </CardHeader>
        
        {showSpotsList && (
          <CardContent>
            {/* Location Status */}
            <div className={`p-3 rounded-xl mb-4 ${sectionBg} flex items-center gap-3`}>
              <div className={`w-8 h-8 rounded-lg ${userLocation ? 'bg-green-500/20' : 'bg-amber-500/20'} flex items-center justify-center`}>
                <Navigation className={`w-4 h-4 ${userLocation ? 'text-green-400' : 'text-amber-400'}`} />
              </div>
              <div className="flex-1">
                <p className={`text-sm font-medium ${textPrimary}`}>
                  {userLocation ? 'GPS Active' : 'Location unavailable'}
                </p>
              </div>
              {!userLocation && !locationLoading && (
                <Button onClick={requestLocation} size="sm" variant="outline">
                  Enable
                </Button>
              )}
              {locationLoading && (
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
              )}
            </div>
            
            {/* Quick Actions */}
            <div className="flex gap-2 mb-4">
              <Button variant="outline" size="sm" onClick={selectAllSpots} className={`flex-1 ${borderClass}`}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={clearAllSpots} className={`flex-1 ${borderClass}`}>
                Clear All
              </Button>
            </div>
            
            {/* Spots List */}
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1 scroll-touch">
              {nearbySpots.length === 0 ? (
                <p className={`text-center py-4 ${textSecondary}`}>
                  {locationLoading ? 'Finding nearby spots...' : 'No spots found nearby'}
                </p>
              ) : (
                nearbySpots.map(spot => (
                  <button
                    key={spot.id}
                    onClick={() => toggleSpotSelection(spot.id)}
                    className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all border-2 ${
                      selectedSpots.includes(spot.id)
                        ? 'bg-cyan-500/20 border-cyan-500'
                        : isLight ? 'bg-white border-gray-200 hover:border-gray-300' : 'bg-zinc-800/50 border-zinc-700 hover:border-zinc-600'
                    }`}
                    data-testid={`spot-${spot.id}`}
                  >
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                      selectedSpots.includes(spot.id) 
                        ? 'border-cyan-500 bg-cyan-500' 
                        : isLight ? 'border-gray-400' : 'border-zinc-500'
                    }`}>
                      {selectedSpots.includes(spot.id) && (
                        <Check className="w-4 h-4 text-white" />
                      )}
                    </div>
                    
                    <div className="flex-1 text-left">
                      <p className={`font-medium ${textPrimary}`}>{spot.name}</p>
                      <p className={`text-xs ${textSecondary}`}>
                        {spot.region || spot.city || 'Florida'}
                        {spot.distance_miles && ` - ${spot.distance_miles.toFixed(1)} mi`}
                      </p>
                    </div>
                    
                    {spot.active_photographers_count > 0 && (
                      <Badge className="bg-green-500/20 text-green-400 text-xs">
                        {spot.active_photographers_count} active
                      </Badge>
                    )}
                  </button>
                ))
              )}
            </div>
            
            <p className={`text-xs ${textSecondary} mt-3 flex items-start gap-1`}>
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
              Surfers searching at these spots will see you in On-Demand results
            </p>
          </CardContent>
        )}
      </Card>
    </>
  );
};

export default OnDemandSettingsTab;
