import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import apiClient from '../lib/apiClient';

import { MapPin, Camera, Zap, Clock, ChevronRight, Radio, Award, Plus, X, Calculator, Loader2, Wallet, Check, Bell, CreditCard, Search, Navigation, History, Sparkles } from 'lucide-react';

import { Button } from './ui/button';

import { Badge } from './ui/badge';

import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

import { Input } from './ui/input';

import { toast } from 'sonner';

import { RequestProSelfieModal } from './RequestProSelfieModal';

import { QualityTierBadge } from './gallery/PriceSourceBadge';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import { ROLES } from '../constants/roles';
import useHapticFeedback from '../hooks/useHapticFeedback';
import SurfboardAvatar from './on-demand/SurfboardAvatar';

// EmptySeat - placeholder for unfilled crew slots
const EmptySeat = ({ index }) => (
  <div className='relative flex flex-col items-center opacity-50'>
    <div className='w-10 h-20 rounded-full border-2 border-dashed border-border/40 flex items-center justify-center'>
      <span className='text-xs text-muted-foreground'>+</span>
    </div>
    <span className='text-[10px] text-muted-foreground mt-1'>Invite</span>
  </div>
);



// ============ SURFBOARD COLORS FOR CREW VISUALIZATION ============
// SURFBOARD_COLORS, SurfboardAvatar, EmptySeat extracted


import useOnDemandBooking from '../hooks/useOnDemandBooking';

// On-Demand Request Drawer Component
export const OnDemandRequestDrawer = ({ photographer, isOpen, onClose, onSuccess, userLocation, _userCredits = 0, resumeDispatchId }) => {
  const booking = useOnDemandBooking({ photographer, isOpen, onClose, onSuccess, userLocation, resumeDispatchId });

  // Destructure all values from the hook for JSX consumption
  const {
    step, setStep, loading, countdown, requestId, acceptedData,
    showSelfieModal, setShowSelfieModal, selfieShownRef,
    showCancelConfirm, setShowCancelConfirm,
    paymentMethod, setPaymentMethod, localCredits, subscriptionDiscount,
    startTimeOption, setStartTimeOption,
    minDuration, maxDuration, requestDuration, setRequestDuration,
    splitEnabled, setSplitEnabled, crewMembers, newCrewInput, setNewCrewInput,
    showAddCrewInput, setShowAddCrewInput, recentBuddies, following,
    friendSearchResults, searchingFriends,
    selectedSpot, setSelectedSpot, customLocationName, setCustomLocationName,
    customLocationAddress, setCustomLocationAddress, nearbySpots, loadingSpots,
    spotSearchQuery, setSpotSearchQuery, useCustomLocation, setUseCustomLocation,
    recentSpots, customLocationCoords, geocodingAddress,
    scrollContainerRef, keyboardOpen,
    isLight, textPrimary, textSecondary, bgCard,
    hourlyRate, photosIncluded, perSurferFee,
    baseSessionPrice, crewAdditionalCost, totalPrice,
    subDiscountPct, subDiscountAmount, discountedTotalPrice,
    totalParticipants, perPersonSplit,
    crewCoversAmount, captainPayAmount, hasEnoughCredits, estimatedResponse,
    isPro, formatDuration,
    handleAddCrewMember, handleSelectFriend, handleRemoveCrewMember,
    handleCrewPercentageChange, handleToggleCoverMember,
    handleDistributeEvenly, handleCoverAllCrew,
    handleSubmitRequest, saveRecentSpot,
    user, navigate,
  } = booking;

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => {
        if (!open) {
          // During waiting step, show cancel confirmation instead of closing immediately
          if (step === 'waiting') {
            setShowCancelConfirm(true);
            return; // Don't close
          }
          onClose();
        }
      }}>
      <DialogContent 
        className={`${bgCard} border-border sm:max-w-lg p-0`}
        hideCloseButton={step === 'waiting' || step === 'success'}
        onInteractOutside={(e) => {
          // Block overlay clicks from closing during waiting/success steps
          if (step === 'waiting' || step === 'success') e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          // Block Escape key from closing during waiting step
          if (step === 'waiting') {
            e.preventDefault();
            setShowCancelConfirm(true);
          }
        }}
      >
        <DialogTitle className="sr-only">On-Demand Session Booking</DialogTitle>
        {/* DialogContent is flex-col: this div fills remaining space and scrolls */}
        <div style={{ flex: '1 1 0%', minHeight: 0, overflowY: 'auto', paddingBottom: '88px', WebkitOverflowScrolling: 'touch' }}>
        {/* ============ STEP 0: START TIME SELECTION ============ */}
        {step === 'timing' && (
          <div className="p-4 sm:p-6 space-y-5">
            {/* Header */}
            <div className="text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-medium mb-3">
                <Zap className="w-3 h-3" />
                ON-DEMAND SESSION
              </div>
              <h2 className={`text-2xl font-bold ${textPrimary}`}>When do you want to surf?</h2>
              <p className={`text-sm ${textSecondary} mt-1`}>
                Choose when you'd like the photographer to arrive
              </p>
            </div>
            
            {/* Photographer Preview */}
            <div className={`flex items-center gap-4 p-4 rounded-2xl ${isLight ? 'bg-gray-50' : 'bg-muted/50'}`}>
              <div className={`w-12 h-12 rounded-full overflow-hidden ${isPro ? 'ring-2 ring-amber-400' : 'ring-2 ring-cyan-400/50'}`}>
                {photographer?.avatar_url ? (
                  <img loading="lazy" decoding="async" src={getFullUrl(photographer.avatar_url)} alt={photographer.full_name} className="w-full h-full object-cover" />
                ) : (
                  <div className={`w-full h-full flex items-center justify-center ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`}>
                    <Camera className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <span className={`font-semibold ${textPrimary}`}>{photographer?.full_name}</span>
                <p className={`text-xs ${textSecondary}`}>{photographer?.distance?.toFixed(1) || '?'} mi away</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-green-400 flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  Available
                </span>
              </div>
            </div>
            
            {/* Timing Options */}
            <div className="space-y-3">
              {[
                { value: 30, label: '30 minutes', desc: 'Quick session - photographer arrives soon' },
                { value: 60, label: '1 hour', desc: 'Standard - time to prep and get there' },
                { value: 90, label: '90 minutes', desc: 'Relaxed - no rush for either party' }
              ].map((option) => {
                const startTime = new Date(Date.now() + option.value * 60000);
                const timeStr = startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                
                return (
                  <button
                    key={option.value}
                    onClick={() => setStartTimeOption(option.value)}
                    className={`w-full p-4 rounded-xl border-2 flex items-center gap-4 transition-all ${
                      startTimeOption === option.value
                        ? 'border-amber-400 bg-amber-500/10'
                        : `${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-muted/30'} hover:border-amber-400/50`
                    }`}
                  >
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      startTimeOption === option.value 
                        ? 'bg-amber-500 text-black' 
                        : `${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`
                    }`}>
                      <Clock className="w-6 h-6" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className={`font-bold ${textPrimary}`}>{option.label}</p>
                      <p className={`text-xs ${textSecondary}`}>{option.desc}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-amber-400 font-bold">{timeStr}</p>
                      <p className={`text-xs ${textSecondary}`}>arrival</p>
                    </div>
                  </button>
                );
              })}
            </div>
            
            {/* Info note */}
            <div className={`flex items-start gap-3 p-3 rounded-xl ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'} border border-blue-400/30`}>
              <Bell className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <p className={`text-sm ${textSecondary}`}>
                The photographer will see this timeframe and can accept if they can make it. You'll be notified when they confirm.
              </p>
            </div>
          </div>
        )}

        {/* ============ STEP 0.5: LOCATION SELECTION ============ */}
        {step === 'location' && (
          <div className="p-4 sm:p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
              <button onClick={() => setStep('timing')} className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-muted'}`} aria-label="Next">
                <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
              </button>
              <div>
                <h2 className={`text-xl font-bold ${textPrimary}`}>Where do you want to surf?</h2>
                <p className={`text-xs ${textSecondary}`}>
                  Starting in {startTimeOption} min - {photographer?.full_name}
                </p>
              </div>
            </div>

            {/* Search / Filter - hidden when typing custom location on mobile */}
            {!(keyboardOpen && useCustomLocation) && (
            <div className="relative">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary}`} />
              <Input aria-label="Search surf spots..."
                value={spotSearchQuery}
                onChange={(e) => setSpotSearchQuery(e.target.value)}
                placeholder="Search surf spots..."
                className={`pl-9 ${isLight ? 'bg-gray-50' : 'bg-muted/50'}`}
                data-testid="spot-search-input"
              />
            </div>
            )}

            {/* Spots List */}
            {loadingSpots ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                <p className={`text-sm ${textSecondary}`}>Finding spots near you...</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[40vh] sm:max-h-[320px] overflow-y-auto pr-1 scroll-touch">
                {/* Use Current Location - hidden when typing custom location */}
                {!(keyboardOpen && useCustomLocation) && (
                <button
                  onClick={() => {
                    setSelectedSpot(null);
                    setUseCustomLocation(false);
                    setCustomLocationName('');
                    setCustomLocationAddress('');
                    setCustomLocationCoords(null);
                  }}
                  className={`w-full p-3 rounded-xl border-2 flex items-center gap-3 transition-all text-left ${
                    !selectedSpot && !useCustomLocation
                      ? 'border-cyan-400 bg-cyan-500/10'
                      : `${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-muted/30'} hover:border-cyan-400/50`
                  }`}
                  data-testid="spot-current-location"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    !selectedSpot && !useCustomLocation ? 'bg-cyan-500' : isLight ? 'bg-gray-200' : 'bg-zinc-700'
                  }`}>
                    <Navigation className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className={`font-medium text-sm ${textPrimary}`}>Use Current Location</p>
                    <p className={`text-xs ${textSecondary}`}>Photographer meets you where you are</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    !selectedSpot && !useCustomLocation ? 'border-cyan-400 bg-cyan-400' : isLight ? 'border-gray-300' : 'border-zinc-600'
                  }`}>
                    {!selectedSpot && !useCustomLocation && <Check className="w-3 h-3 text-black" />}
                  </div>
                </button>
                )}

                {/* Recently Visited Spots - hidden when typing custom location */}
                {!(keyboardOpen && useCustomLocation) && recentSpots.length > 0 && !spotSearchQuery && (
                  <>
                    <div className={`flex items-center gap-2 mt-3 mb-1 px-1`}>
                      <History className={`w-3.5 h-3.5 ${textSecondary}`} />
                      <span className={`text-xs font-semibold uppercase tracking-wider ${textSecondary}`}>Recently Visited</span>
                    </div>
                    {recentSpots.map((spot, idx) => (
                      <button
                        key={`recent-${spot.id || spot.name}-${idx}`}
                        onClick={() => {
                          if (spot.is_custom) {
                            setUseCustomLocation(true);
                            setCustomLocationName(spot.name);
                            setSelectedSpot(null);
                            // Restore geocoded coords from recent spot if available
                            if (spot.latitude && spot.longitude) {
                              setCustomLocationCoords({ latitude: spot.latitude, longitude: spot.longitude });
                            } else {
                              setCustomLocationCoords(null);
                            }
                          } else {
                            setSelectedSpot(spot);
                            setUseCustomLocation(false);
                            setCustomLocationName('');
                            setCustomLocationCoords(null);
                          }
                        }}
                        className={`w-full p-3 rounded-xl border-2 flex items-center gap-3 transition-all text-left ${
                          (spot.is_custom && useCustomLocation && customLocationName === spot.name) ||
                          (!spot.is_custom && selectedSpot?.id === spot.id)
                            ? 'border-teal-400 bg-teal-500/10'
                            : `${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-muted/30'} hover:border-teal-400/50`
                        }`}
                        data-testid={`spot-recent-${idx}`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          (spot.is_custom && useCustomLocation && customLocationName === spot.name) ||
                          (!spot.is_custom && selectedSpot?.id === spot.id)
                            ? 'bg-teal-500' : isLight ? 'bg-gray-200' : 'bg-zinc-700'
                        }`}>
                          <History className={`w-4 h-4 ${
                            (spot.is_custom && useCustomLocation && customLocationName === spot.name) ||
                            (!spot.is_custom && selectedSpot?.id === spot.id)
                              ? 'text-white' : textSecondary
                          }`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium text-sm truncate ${textPrimary}`}>{spot.name}</p>
                          <p className={`text-xs ${textSecondary} truncate`}>
                            {spot.is_custom ? 'Custom spot' : (spot.region || 'Mapped spot')}
                          </p>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          (spot.is_custom && useCustomLocation && customLocationName === spot.name) ||
                          (!spot.is_custom && selectedSpot?.id === spot.id)
                            ? 'border-teal-400 bg-teal-400' : isLight ? 'border-gray-300' : 'border-zinc-600'
                        }`}>
                          {((spot.is_custom && useCustomLocation && customLocationName === spot.name) ||
                            (!spot.is_custom && selectedSpot?.id === spot.id)) && <Check className="w-3 h-3 text-black" />}
                        </div>
                      </button>
                    ))}
                    <div className={`flex items-center gap-2 mt-3 mb-1 px-1`}>
                      <MapPin className={`w-3.5 h-3.5 ${textSecondary}`} />
                      <span className={`text-xs font-semibold uppercase tracking-wider ${textSecondary}`}>Nearby Spots</span>
                    </div>
                  </>
                )}

                {/* Nearby Mapped Spots - hidden when typing custom location */}
                {!(keyboardOpen && useCustomLocation) && nearbySpots
                  .filter(s => !spotSearchQuery || s.name?.toLowerCase().includes(spotSearchQuery.toLowerCase()) || s.region?.toLowerCase().includes(spotSearchQuery.toLowerCase()))
                  .slice(0, 20)
                  .map((spot) => (
                    <button
                      key={spot.id}
                      onClick={() => {
                        setSelectedSpot(spot);
                        setUseCustomLocation(false);
                        setCustomLocationName('');
                        setCustomLocationCoords(null);
                      }}
                      className={`w-full p-3 rounded-xl border-2 flex items-center gap-3 transition-all text-left ${
                        selectedSpot?.id === spot.id
                          ? 'border-amber-400 bg-amber-500/10'
                          : `${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-muted/30'} hover:border-amber-400/50`
                      }`}
                      data-testid={`spot-option-${spot.id}`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden ${
                        selectedSpot?.id === spot.id ? 'bg-amber-500' : isLight ? 'bg-gray-200' : 'bg-zinc-700'
                      }`}>
                        {spot.image_url ? (
                          <img loading="lazy" decoding="async" src={getFullUrl(spot.image_url)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <MapPin className={`w-5 h-5 ${selectedSpot?.id === spot.id ? 'text-black' : textSecondary}`} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-sm truncate ${textPrimary}`}>{spot.name}</p>
                        <div className="flex items-center gap-2">
                          {spot.region && (
                            <p className={`text-xs ${textSecondary} truncate`}>{spot.region}</p>
                          )}
                          {spot.distance_miles != null && (
                            <span className={`text-xs ${textSecondary} flex-shrink-0`}>
                              {spot.distance_miles < 1 ? `${(spot.distance_miles * 5280).toFixed(0)} ft` : `${spot.distance_miles.toFixed(1)} mi`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        selectedSpot?.id === spot.id ? 'border-amber-400 bg-amber-400' : isLight ? 'border-gray-300' : 'border-zinc-600'
                      }`}>
                        {selectedSpot?.id === spot.id && <Check className="w-3 h-3 text-black" />}
                      </div>
                    </button>
                  ))}

                {/* Custom Location */}
                <button
                  onClick={() => {
                    setUseCustomLocation(true);
                    setSelectedSpot(null);
                    setCustomLocationCoords(null);
                  }}
                  className={`w-full p-3 rounded-xl border-2 flex items-center gap-3 transition-all text-left ${
                    useCustomLocation
                      ? 'border-purple-400 bg-purple-500/10'
                      : `${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-muted/30'} hover:border-purple-400/50`
                  }`}
                  data-testid="spot-custom-location"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    useCustomLocation ? 'bg-purple-500' : isLight ? 'bg-gray-200' : 'bg-zinc-700'
                  }`}>
                    <Plus className={`w-5 h-5 ${useCustomLocation ? 'text-white' : textSecondary}`} />
                  </div>
                  <div className="flex-1">
                    <p className={`font-medium text-sm ${textPrimary}`}>Custom Location</p>
                    <p className={`text-xs ${textSecondary}`}>Spot not listed? Type it in</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    useCustomLocation ? 'border-purple-400 bg-purple-400' : isLight ? 'border-gray-300' : 'border-zinc-600'
                  }`}>
                    {useCustomLocation && <Check className="w-3 h-3 text-black" />}
                  </div>
                </button>

                {/* Custom Location Text Input */}
                {useCustomLocation && (
                  <div className="mt-2 pl-2 space-y-2">
                    <Input aria-label="Spot name (e.g. North side of pier)"
                      value={customLocationName}
                      onChange={(e) => setCustomLocationName(e.target.value)}
                      placeholder="Spot name (e.g. North side of pier)"
                      className={`${isLight ? 'bg-white' : 'bg-card/80'}`}
                      autoFocus
                      data-testid="custom-location-input"
                    />
                    <Input aria-label="Street address (e.g. 401 Meade Ave, Cocoa Beach, FL)"
                      value={customLocationAddress}
                      onChange={(e) => setCustomLocationAddress(e.target.value)}
                      placeholder="Street address (e.g. 401 Meade Ave, Cocoa Beach, FL)"
                      className={`${isLight ? 'bg-white' : 'bg-card/80'}`}
                      data-testid="custom-location-address"
                    />
                    <p className={`text-xs ${textSecondary} mt-1`}>
                      {geocodingAddress
                        ? String.fromCodePoint(0x1F4CD) + ' Finding location...'
                        : customLocationCoords
                          ? '? Address found - photographer will be directed here'
                          : customLocationAddress && customLocationAddress.trim().length >= 5
                            ? String.fromCodePoint(0x1F4CD) + ' Could not find address - photographer will use your GPS'
                            : 'Optional: add a street address for more precise directions'}
                    </p>
                  </div>
                )}

                {/* No spots message */}
                {nearbySpots.length === 0 && !loadingSpots && (
                  <div className={`py-6 text-center`}>
                    <MapPin className={`w-8 h-8 mx-auto mb-2 ${textSecondary}`} />
                    <p className={`text-sm ${textSecondary}`}>No mapped spots found nearby.</p>
                    <p className={`text-xs ${textSecondary} mt-1`}>Use "Custom Location" or "Current Location" instead.</p>
                  </div>
                )}
              </div>
            )}

            {/* Selected spot summary - hidden when keyboard is up */}
            {!keyboardOpen && (selectedSpot || useCustomLocation) && (
              <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-green-50' : 'bg-green-500/10'} border border-green-400/30`}>
                <MapPin className="w-4 h-4 text-green-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${textPrimary} truncate`}>
                    {selectedSpot ? selectedSpot.name : (customLocationName || 'Custom Location (GPS)')}
                  </p>
                  {useCustomLocation && customLocationAddress && (
                    <p className={`text-xs ${textSecondary} truncate`}>{customLocationAddress}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* ============ STEP 1: DURATION SELECTION ============ */}
        {step === 'duration' && (
          <div className="p-4 sm:p-6 space-y-5">
            {/* Header with back button */}
            <div className="flex items-center gap-3 mb-2">
              <button onClick={() => setStep('location')} className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-muted'}`} aria-label="Next">
                <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
              </button>
              <div>
                <h2 className={`text-xl font-bold ${textPrimary}`}>Session Duration</h2>
                <p className={`text-xs ${textSecondary}`}>
                  Starting in {startTimeOption} min - {selectedSpot?.name || customLocationName || 'Current Location'} - {photographer?.full_name}
                </p>
              </div>
            </div>
            
            {/* Photographer Card */}
            <div className={`flex items-center gap-4 p-4 rounded-2xl ${isLight ? 'bg-gray-50' : 'bg-muted/50'}`}>
              <div className={`w-14 h-14 rounded-full overflow-hidden ${isPro ? 'ring-2 ring-amber-400' : 'ring-2 ring-cyan-400/50'}`}>
                {photographer?.avatar_url ? (
                  <img loading="lazy" decoding="async" src={getFullUrl(photographer.avatar_url)} alt={photographer.full_name} className="w-full h-full object-cover" />
                ) : (
                  <div className={`w-full h-full flex items-center justify-center ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`}>
                    <Camera className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-semibold ${textPrimary}`}>{photographer?.full_name}</span>
                  {isPro && <Badge className="bg-amber-500 text-black text-xs">PRO</Badge>}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    Online
                  </span>
                  <span className={`text-xs ${textSecondary}`}>~{estimatedResponse} min ETA</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-amber-400 font-bold text-lg">${hourlyRate}</p>
                <p className={`text-xs ${textSecondary}`}>/hour</p>
              </div>
            </div>
            
            {/* Duration Slider */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className={`text-sm font-medium ${textPrimary}`}>Session Duration</p>
                <div className="text-right">
                  <span className="text-xl font-bold text-amber-400">{formatDuration(requestDuration)}</span>
                  <p className={`text-xs ${textSecondary}`}>${(hourlyRate * requestDuration).toFixed(0)} base</p>
                </div>
              </div>
              
              <div className="px-2">
                <input aria-label="Range slider"
                  type="range"
                  min={minDuration}
                  max={maxDuration}
                  step={0.5}
                  value={requestDuration}
                  onChange={(e) => setRequestDuration(parseFloat(e.target.value))}
                  className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                  style={{
                    background: `linear-gradient(to right, #F59E0B 0%, #F59E0B ${((requestDuration - minDuration) / (maxDuration - minDuration)) * 100}%, #3f3f46 ${((requestDuration - minDuration) / (maxDuration - minDuration)) * 100}%, #3f3f46 100%)`
                  }}
                />
                <div className="flex justify-between mt-1">
                  <span className={`text-xs ${textSecondary}`}>{formatDuration(minDuration)}</span>
                  <span className={`text-xs ${textSecondary}`}>{formatDuration(maxDuration)}</span>
                </div>
              </div>
              
              {/* Quick Duration Buttons */}
              <div className="flex gap-2 flex-wrap">
                {[0.5, 1, 2, 3].filter(d => d >= minDuration && d <= maxDuration).map((d) => (
                  <button
                    key={d}
                    onClick={() => setRequestDuration(d)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      requestDuration === d
                        ? 'bg-amber-500 text-black'
                        : `${isLight ? 'bg-gray-100 text-gray-600' : 'bg-muted text-muted-foreground'} hover:bg-amber-500/20 hover:text-amber-400`
                    }`}
                  >
                    {formatDuration(d)}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Photos Included */}
            <div className={`flex items-center justify-between p-3 rounded-xl ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'} border border-cyan-400/30`}>
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-cyan-400" />
                <span className={`text-sm ${textPrimary}`}>Photos included</span>
              </div>
              <span className="text-cyan-400 font-bold">{photosIncluded} photos</span>
            </div>
            

          </div>
        )}

        {/* ============ STEP 1.5: SPLIT CHOICE ============ */}
        {step === 'split_choice' && (
          <div className="p-4 sm:p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center gap-3">
              <button onClick={() => setStep('duration')} className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-muted'}`} aria-label="Next">
                <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
              </button>
              <div>
                <h2 className={`text-xl font-bold ${textPrimary}`}>Just you, or bringing crew?</h2>
                <p className={`text-xs ${textSecondary}`}>{formatDuration(requestDuration)} session - {photographer?.full_name}</p>
              </div>
            </div>

            {/* Two big choice cards */}
            <div className="space-y-3">
              {/* Solo */}
              <button
                onClick={() => { setSplitEnabled(false); setCrewMembers([]); }}
                className={`w-full p-5 rounded-2xl border-2 flex items-center gap-4 transition-all text-left ${
                  !splitEnabled
                    ? 'border-amber-400 bg-amber-500/10'
                    : `${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-muted/30'} hover:border-amber-400/50`
                }`}
              >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 ${
                  !splitEnabled ? 'bg-amber-500' : isLight ? 'bg-gray-200' : 'bg-zinc-700'
                }`}>{String.fromCodePoint(0x1F4F8)}</div>
                <div className="flex-1">
                  <p className={`font-bold text-base ${textPrimary}`}>Just Me</p>
                  <p className={`text-sm ${textSecondary}`}>Solo session - I'll pay the full rate</p>
                  <p className="text-amber-400 font-bold mt-1">${totalPrice.toFixed(2)}</p>
                </div>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  !splitEnabled ? 'border-amber-400 bg-amber-400' : isLight ? 'border-gray-300' : 'border-zinc-600'
                }`}>
                  {!splitEnabled && <Check className="w-4 h-4 text-black" />}
                </div>
              </button>

              {/* Split with Crew */}
              <button
                onClick={() => setSplitEnabled(true)}
                className={`w-full p-5 rounded-2xl border-2 flex items-center gap-4 transition-all text-left ${
                  splitEnabled
                    ? 'border-cyan-400 bg-cyan-500/10'
                    : `${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-muted/30'} hover:border-cyan-400/50`
                }`}
              >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 ${
                  splitEnabled ? 'bg-cyan-500' : isLight ? 'bg-gray-200' : 'bg-zinc-700'
                }`}>{String.fromCodePoint(0x1F4F8)}</div>
                <div className="flex-1">
                  <p className={`font-bold text-base ${textPrimary}`}>Split with Crew</p>
                  <p className={`text-sm ${textSecondary}`}>Share the session cost with friends</p>
                  <p className="text-cyan-400 font-bold mt-1">
                    {crewMembers.length > 0 ? `$${perPersonSplit}/person` : 'Add crew ? split the cost'}
                  </p>
                </div>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  splitEnabled ? 'border-cyan-400 bg-cyan-400' : isLight ? 'border-gray-300' : 'border-zinc-600'
                }`}>
                  {splitEnabled && <Check className="w-4 h-4 text-black" />}
                </div>
              </button>
            </div>

            {/* Tip */}
            <div className={`flex items-start gap-3 p-3 rounded-xl ${
              isLight ? 'bg-blue-50' : 'bg-blue-500/10'
            } border border-blue-400/30`}>
              <Bell className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
              <p className={`text-xs ${textSecondary}`}>
                {splitEnabled
                  ? "You'll add crew in the next step. You can cover any percentage of a friend's share."
                  : 'You can switch to crew split anytime by going back.'}
              </p>
            </div>


          </div>
        )}
        
        {/* ============ STEP 2: CREW SELECTION ============ */}
              <CrewStepPanel
                crewMembers={crewMembers}
                maxCrew={maxCrew}
                showCrewHelp={showCrewHelp}
                isKeyboardOpen={isKeyboardOpen}
                crewSearchQuery={crewSearchQuery}
                crewSearchResults={crewSearchResults}
                crewSearchLoading={crewSearchLoading}
                showManualEntry={showManualEntry}
                manualCrewName={manualCrewName}
                manualCrewEmail={manualCrewEmail}
                manualCrewPhone={manualCrewPhone}
                handleRemoveCrewMember={handleRemoveCrewMember}
                handleCrewSearch={handleCrewSearch}
                handleAddCrewMember={handleAddCrewMember}
                addManualCrewMember={addManualCrewMember}
                setShowCrewHelp={setShowCrewHelp}
                setShowManualEntry={setShowManualEntry}
                setCrewSearchQuery={setCrewSearchQuery}
                setManualCrewName={setManualCrewName}
                setManualCrewEmail={setManualCrewEmail}
                setManualCrewPhone={setManualCrewPhone}
                getFullUrl={getFullUrl}
              />
              <CrewPaymentStepPanel
                crewMembers={crewMembers}
                splitConfig={splitConfig}
                crewPriceBreakdown={crewPriceBreakdown}
                handleCrewPaymentToggle={handleCrewPaymentToggle}
                handleSplitRatioChange={handleSplitRatioChange}
                handleSplitPercentageChange={handleSplitPercentageChange}
                handleCoverForCrewMember={handleCoverForCrewMember}
                getFullUrl={getFullUrl}
              />
        {step === 'confirm' && (
          <div className="p-4 sm:p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <button onClick={() => setStep(crewMembers.length > 0 ? 'crew_payment' : splitEnabled ? 'crew' : 'split_choice')} className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-muted'}`} aria-label="Next">
                <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
              </button>
              <h2 className={`text-xl font-bold ${textPrimary}`}>Confirm Request</h2>
            </div>
            
            {/* Summary Card */}
            <div className={`p-5 rounded-2xl ${isLight ? 'bg-gray-50' : 'bg-muted/50'}`}>
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-amber-400">
                  {photographer?.avatar_url ? (
                    <img loading="lazy" decoding="async" src={getFullUrl(photographer.avatar_url)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`}>
                      <Camera className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <p className={`font-semibold ${textPrimary}`}>{photographer?.full_name}</p>
                  <p className={`text-sm ${textSecondary}`}>{requestDuration * 60} min session</p>
                </div>
                <div className="text-right">
                  {subDiscountPct > 0 ? (
                    <>
                      <p className="text-xs text-muted-foreground line-through">${totalPrice.toFixed(2)}</p>
                      <p className="text-amber-400 font-bold">${discountedTotalPrice.toFixed(2)}</p>
                    </>
                  ) : (
                    <p className="text-amber-400 font-bold">${totalPrice.toFixed(2)}</p>
                  )}
                  {crewMembers.length > 0 && (
                    <p className="text-xs text-green-400">You: ${captainPayAmount.toFixed(2)}</p>
                  )}
                </div>
              </div>
              
              {/* Quick Details */}
              {/* Location row */}
              <div className={`flex items-center gap-2 pt-3 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
                <MapPin className="w-4 h-4 text-green-400 flex-shrink-0" />
                <p className={`text-sm ${textPrimary} truncate`}>
                  {selectedSpot?.name || (useCustomLocation && customLocationName ? customLocationName : 'Current Location')}
                </p>
              </div>

              <div className={`grid grid-cols-3 gap-3 pt-3 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
                <div className="text-center">
                  <Clock className="w-4 h-4 mx-auto text-cyan-400 mb-1" />
                  <p className={`text-xs ${textSecondary}`}>Duration</p>
                  <p className={`font-medium ${textPrimary}`}>{requestDuration * 60} min</p>
                </div>
                <div className="text-center">
                  <Camera className="w-4 h-4 mx-auto text-purple-400 mb-1" />
                  <p className={`text-xs ${textSecondary}`}>Photos</p>
                  <p className={`font-medium ${textPrimary}`}>{photosIncluded}</p>
                </div>
                <div className="text-center">
                  <Award className="w-4 h-4 mx-auto text-green-400 mb-1" />
                  <p className={`text-xs ${textSecondary}`}>Surfers</p>
                  <p className={`font-medium ${textPrimary}`}>{totalParticipants}</p>
                </div>
              </div>

              {/* Subscription Discount Banner */}
              {subDiscountPct > 0 && (
                <div className={`flex items-center gap-2 pt-3 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/20">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-xs font-semibold text-purple-400">SUBSCRIBER</span>
                  </div>
                  <p className={`text-sm ${textPrimary} flex-1`}>
                    {subDiscountPct}% off &mdash; saving <span className="font-semibold text-green-400">${subDiscountAmount.toFixed(2)}</span>
                  </p>
                </div>
              )}

              {/* Subscription active but no on-demand discount */}
              {subscriptionDiscount?.subscription_active && subDiscountPct === 0 && (
                <div className={`flex items-center gap-2 pt-3 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/10">
                    <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                    <span className="text-xs font-medium text-purple-300">SUBSCRIBER</span>
                  </div>
                  <p className={`text-xs ${textSecondary}`}>
                    {subscriptionDiscount.plan_name || 'Active plan'} &mdash; on-demand discount not included
                  </p>
                </div>
              )}
            </div>
            
            {/* Payment Selection */}
            <div className="space-y-3">
              <p className={`text-sm font-medium ${textPrimary}`}>Payment Method</p>
              
              {localCredits > 0 && (
                <button aria-label="div"
                  onClick={() => setPaymentMethod('credits')}
                  className={`w-full p-4 rounded-xl border-2 flex items-center justify-between ${
                    paymentMethod === 'credits' 
                      ? 'border-amber-400 bg-amber-500/10' 
                      : `${isLight ? 'border-gray-200' : 'border-zinc-700'}`
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                      <Wallet className="w-5 h-5 text-amber-400" />
                    </div>
                    <div className="text-left">
                      <p className={`font-medium ${textPrimary}`}>Surf Credits</p>
                      <p className={`text-xs ${textSecondary}`}>Balance: ${localCredits.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 ${paymentMethod === 'credits' ? 'border-amber-400 bg-amber-400' : 'border-zinc-500'}`}>
                    {paymentMethod === 'credits' && <Check className="w-4 h-4 text-black" />}
                  </div>
                </button>
              )}
              
              <button aria-label="div"
                onClick={() => setPaymentMethod('card')}
                className={`w-full p-4 rounded-xl border-2 flex items-center justify-between ${
                  paymentMethod === 'card' 
                    ? 'border-cyan-400 bg-cyan-500/10' 
                    : `${isLight ? 'border-gray-200' : 'border-zinc-700'}`
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div className="text-left">
                    <p className={`font-medium ${textPrimary}`}>Card Payment</p>
                    <p className={`text-xs ${textSecondary}`}>Visa, Mastercard, etc.</p>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 ${paymentMethod === 'card' ? 'border-cyan-400 bg-cyan-400' : 'border-zinc-500'}`}>
                  {paymentMethod === 'card' && <Check className="w-4 h-4 text-black" />}
                </div>
              </button>
            </div>
            

          </div>
        )}
        
        {/* ============ STEP 4: WAITING FOR RESPONSE ============ */}
        {step === 'waiting' && (
          <div className="p-4 sm:p-6 pt-8 sm:pt-10 text-center space-y-6">
            {/* Animated waiting indicator */}
            <div className="relative w-24 h-24 sm:w-32 sm:h-32 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-amber-500/20" />
              <div 
                className="absolute inset-0 rounded-full border-4 border-amber-400 border-t-transparent animate-spin"
                style={{ animationDuration: '1.5s' }}
              />
              <div className="absolute inset-3 sm:inset-4 rounded-full bg-muted flex items-center justify-center">
                <div className="text-center">
                  <Radio className="w-6 h-6 sm:w-8 sm:h-8 text-amber-400 animate-pulse" />
                </div>
              </div>
            </div>
            
            <div>
              <h3 className={`text-xl font-bold ${textPrimary}`}>Waiting for Confirmation</h3>
              <p className={`${textSecondary} mt-2`}>
                {photographer?.full_name} is reviewing your request...
              </p>
              {crewMembers.length > 0 && (
                <p className={`text-xs ${textSecondary} mt-1`}>
                  Also waiting for crew to complete payment
                </p>
              )}
              <p className={`text-xs ${textSecondary} mt-1 animate-pulse`}>
                Auto-checking every 3 seconds
              </p>
            </div>
            
            {/* Crew Payment Status (if split session) */}
            {crewMembers.length > 0 && (
              <div className={`p-4 rounded-xl ${isLight ? 'bg-purple-50' : 'bg-purple-500/10'} border border-purple-400/30 text-left`}>
                <div className="flex items-center gap-2 mb-3">
                  <Wallet className="w-5 h-5 text-purple-400" />
                  <span className={`font-bold ${textPrimary}`}>Crew Payment Status</span>
                </div>
                <div className="space-y-2">
                  {/* Captain (You) */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                        <Check className="w-3 h-3 text-green-400" />
                      </div>
                      <span className={`text-sm ${textPrimary}`}>You</span>
                    </div>
                    <span className="text-sm text-green-400 font-medium">${captainPayAmount.toFixed(2)} Paid</span>
                  </div>
                  {/* Crew Members */}
                  {crewMembers.map((member, idx) => {
                    const isCovered = member.covered_by_captain;
                    const isPaid = member.payment_status === 'paid' || member.paid_at;
                    const memberAmount = member.share_amount || parseFloat(perPersonSplit);
                    return (
                      <div key={member.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {/* Show selfie if available, else status icon */}
                          {member.selfie_url ? (
                            <div className="relative">
                              <img loading="lazy" decoding="async" 
                                src={member.selfie_url} 
                                alt="" 
                                className="w-7 h-7 rounded-full object-cover ring-2 ring-green-400"
                              />
                              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center">
                                <Check className="w-2 h-2 text-white" />
                              </div>
                            </div>
                          ) : member.avatar_url ? (
                            <div className="relative">
                              <img loading="lazy" decoding="async" src={getFullUrl(member.avatar_url)} 
                                alt="" 
                                className={`w-7 h-7 rounded-full object-cover ring-2 ${isPaid ? 'ring-green-400' : 'ring-amber-400'}`}
                              />
                              {isPaid && (
                                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center">
                                  <Check className="w-2 h-2 text-white" />
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center ${(isCovered || isPaid) ? 'bg-green-500/20' : 'bg-amber-500/20 animate-pulse'}`}>
                              {(isCovered || isPaid) ? (
                                <Check className="w-3 h-3 text-green-400" />
                              ) : (
                                <Clock className="w-3 h-3 text-amber-400" />
                              )}
                            </div>
                          )}
                          <div>
                            <span className={`text-sm ${textPrimary}`}>
                              {member.name || member.value?.split('@')[0] || `Crew ${idx + 1}`}
                            </span>
                            {member.username && (
                              <span className={`text-xs ${textSecondary} ml-1`}>@{member.username}</span>
                            )}
                          </div>
                        </div>
                        <span className={`text-sm font-medium ${(isCovered || isPaid) ? 'text-green-400' : 'text-amber-400'}`}>
                          {isCovered ? 'Covered by you' : isPaid ? `$${memberAmount.toFixed(2)} Paid` : `$${memberAmount.toFixed(2)} Pending`}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {crewMembers.some(m => !m.covered_by_captain) && (
                  <p className={`text-xs ${textSecondary} mt-3 pt-3 border-t border-purple-400/20`}>
              {String.fromCodePoint(0x1F4E2)} Your crew has been notified to complete payment. The photographer will see your request once all
                  </p>
                )}
              </div>
            )}
            
            {/* Live status updates */}
            <div className={`p-4 rounded-xl ${isLight ? 'bg-gray-50' : 'bg-muted/50'} text-left space-y-3`}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Check className="w-4 h-4 text-green-400" />
                </div>
                <div>
                  <p className={`font-medium ${textPrimary}`}>Your Payment Confirmed</p>
                  <p className={`text-xs ${textSecondary}`}>${captainPayAmount.toFixed(2)} payment held in escrow</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Check className="w-4 h-4 text-green-400" />
                </div>
                <div>
                  <p className={`font-medium ${textPrimary}`}>Request Sent</p>
                  <p className={`text-xs ${textSecondary}`}>Notification delivered to {photographer?.full_name}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center animate-pulse">
                  <Bell className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <p className={`font-medium ${textPrimary}`}>Awaiting Response</p>
                  <p className={`text-xs ${textSecondary}`}>Real-time monitoring active...</p>
                </div>
              </div>
              <div className="flex items-center gap-3 opacity-50">
                <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center">
                  <MapPin className="w-4 h-4 text-zinc-400" />
                </div>
                <div>
                  <p className={`font-medium ${textPrimary}`}>On Their Way</p>
                  <p className={`text-xs ${textSecondary}`}>Pending acceptance...</p>
                </div>
              </div>
            </div>
            
            {/* Cancel with confirmation + I'm Confirmed button */}
            {!showCancelConfirm ? (
              <div className="space-y-3">
                <Button aria-label="Confirm"
                  onClick={() => {
                    toast.success("You're all set! Check your Bookings tab for updates.");
                    onClose();
                  }}
                  className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold rounded-xl"
                >
                  <Check className="w-5 h-5 mr-2" />
                  I'm Confirmed - Close Window
                </Button>
                <p className={`text-xs ${textSecondary} text-center`}>
                  Your booking is saved. Check the Bookings tab anytime for updates.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setShowCancelConfirm(true)}
                  className={`w-full ${isLight ? 'border-gray-300 text-gray-600' : 'border-zinc-600 text-zinc-400'}`}
                >
                  Cancel Request
                </Button>
              </div>
            ) : (
              <div className={`p-4 rounded-xl border-2 ${isLight ? 'bg-red-50 border-red-200' : 'bg-red-500/10 border-red-500/30'} space-y-3`}>
                <p className={`text-sm font-medium ${textPrimary} text-center`}>
                  Are you sure you want to cancel this on-demand booking?
                </p>
                <p className={`text-xs ${textSecondary} text-center`}>
                  {photographer?.on_demand_cancellation_fee_pct === 0
                    ? 'Your payment will be fully refunded to your account credits.'
                    : photographer?.on_demand_cancellation_fee_pct === 100
                      ? 'This photographer has a non-refundable cancellation policy.'
                      : `A ${photographer?.on_demand_cancellation_fee_pct || 100}% cancellation fee will be applied. You may request an emergency exception after cancelling.`}
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setShowCancelConfirm(false)}
                    className={`flex-1 ${isLight ? 'border-gray-300' : 'border-zinc-600'}`}
                  >
                    Keep Booking
                  </Button>
                  <Button
                    onClick={async () => {
                      try {
                        const res = await apiClient.post(`/dispatch/${requestId}/cancel?user_id=${user.id}`, { reason: 'User cancelled' });
                        const feeAmt = res.data?.fee_amount || 0;
                        const refundAmt = res.data?.refund_amount || 0;
                        if (feeAmt > 0) {
                          toast.info(`Cancelled. $${refundAmt.toFixed(2)} refunded, $${feeAmt.toFixed(2)} fee applied.`, { duration: 6000 });
                        } else {
                          toast.info('Request cancelled. Your payment has been refunded to credits.');
                        }
                      } catch (e) {
                        toast.error('Failed to cancel request');
                      }
                      onClose();
                    }}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold"
                  >
                    Yes, Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* ============ STEP 5: SUCCESS ============ */}
        {step === 'success' && (
          <div className="p-4 sm:p-6 text-center space-y-6">
            <div className="w-24 h-24 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="w-12 h-12 text-green-400" />
            </div>
            
            <div>
              <h3 className={`text-2xl font-bold ${textPrimary}`}>Request Accepted!</h3>
              <p className={`${textSecondary} mt-2`}>
                {acceptedData?.photographer_name || photographer?.full_name} is on the way!
              </p>
            </div>
            
            {/* ETA Card */}
            <div className={`p-5 rounded-2xl ${isLight ? 'bg-green-50' : 'bg-green-500/10'} border border-green-500/30`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm ${textSecondary}`}>Estimated Arrival</p>
                  <p className="text-2xl font-bold text-green-400">~{acceptedData?.eta_minutes || estimatedResponse} min</p>
                </div>
                <div className="w-14 h-14 rounded-full overflow-hidden ring-2 ring-green-400">
                  {(acceptedData?.photographer_avatar || photographer?.avatar_url) ? (
                    <img loading="lazy" decoding="async" src={getFullUrl(acceptedData?.photographer_avatar || photographer?.avatar_url)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-6 h-6 text-muted-foreground m-auto" />
                  )}
                </div>
              </div>
              <p className={`text-xs ${textSecondary} mt-3`}>
                You'll receive a notification when they arrive at your spot
              </p>
            </div>
            
            <Button
              onClick={() => {
                // Navigate to the interactive DispatchLobby for chat, voice notes, and cancel options
                onClose();
                navigate(`/dispatch/${requestId}/lobby`);
              }}
              className="w-full py-5 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-foreground font-bold rounded-xl"
            >
              Got it, Let's Surf! {String.fromCodePoint(0x1F3C4)}
            </Button>
            <p className={`text-xs ${textSecondary} text-center`}>
              Chat with your photographer, track their arrival, or manage your session
            </p>
          </div>
        )}
        </div>

        {/* -- Sticky Footer CTA \u2014 always visible above mobile chrome -- */}
        {!['waiting', 'success'].includes(step) && (
          <div className={`absolute bottom-0 left-0 right-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t ${isLight ? 'bg-white border-gray-200' : 'bg-card border-border'} shadow-[0_-8px_24px_rgba(0,0,0,0.15)]`}>
            {step === 'timing' && (
              <Button aria-label="Next"
                onClick={() => setStep('location')}
                className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold text-base rounded-xl"
              >
                Continue <ChevronRight className="w-5 h-5 ml-1" />
              </Button>
            )}
            {step === 'location' && (
              <Button
                onClick={() => {
                  // Save selection to recently visited
                  if (selectedSpot) {
                    saveRecentSpot(selectedSpot);
                  } else if (useCustomLocation && customLocationName.trim()) {
                    saveRecentSpot({
                      name: customLocationName.trim(),
                      is_custom: true,
                      latitude: customLocationCoords?.latitude || null,
                      longitude: customLocationCoords?.longitude || null
                    });
                  }
                  setStep('duration');
                }}
                disabled={useCustomLocation && !customLocationName.trim()}
                className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold text-base rounded-xl disabled:opacity-50"
              >
                {selectedSpot ? (
                  <><MapPin className="w-5 h-5 mr-2" />{selectedSpot.name}</>
                ) : useCustomLocation ? (
                  <><MapPin className="w-5 h-5 mr-2" />Continue</>
                ) : (
                  <><Navigation className="w-5 h-5 mr-2" />Use My Location</>
                )}
                <ChevronRight className="w-5 h-5 ml-1" />
              </Button>
            )}
            {step === 'duration' && (
              <Button aria-label="Next"
                onClick={() => setStep('split_choice')}
                className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold text-base rounded-xl"
              >
                Continue - ${totalPrice.toFixed(2)} <ChevronRight className="w-5 h-5 ml-1" />
              </Button>
            )}
            {step === 'split_choice' && (
              <Button aria-label="Next"
                onClick={() => { if (splitEnabled) setStep('crew'); else setStep('confirm'); }}
                className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold text-base rounded-xl"
              >
                {splitEnabled ? 'Add My Crew' : 'Continue to Payment'} <ChevronRight className="w-5 h-5 ml-1" />
              </Button>
            )}
            {step === 'crew' && (
              <Button aria-label="Calculator"
                onClick={() => crewMembers.length > 0 ? setStep('crew_payment') : setStep('confirm')}
                className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold text-base rounded-xl"
              >
                {crewMembers.length > 0 ? (
                  <><Calculator className="w-5 h-5 mr-2" />Set Payment Splits</>
                ) : (
                  <><Zap className="w-5 h-5 mr-2" />Continue Solo</>
                )}
              </Button>
            )}
            {step === 'crew_payment' && (
              <Button aria-label="Next"
                onClick={() => setStep('confirm')}
                className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold text-base rounded-xl"
              >
                Review &amp; Confirm <ChevronRight className="w-5 h-5 ml-1" />
              </Button>
            )}
            {step === 'confirm' && (
              <Button aria-label="Loader2"
                onClick={handleSubmitRequest}
                disabled={loading || (paymentMethod === 'credits' && !hasEnoughCredits)}
                className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold text-base rounded-xl disabled:opacity-50"
              >
                {loading ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Sending Request...</>
                ) : (
                  <><Zap className="w-5 h-5 mr-2" />Send Request</>
                )}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>

    
    {/* Selfie Modal for photographer identification */}
    <RequestProSelfieModal
      dispatchId={requestId}
      isOpen={showSelfieModal}
      onClose={() => {
        setShowSelfieModal(false);
        setStep('waiting');
      }}
      onSuccess={(_selfieUrl) => {
        setShowSelfieModal(false);
        toast.success('Selfie uploaded! The photographer can now find you.');
        setStep('waiting');
      }}
    />
    </>
  );
};

export default OnDemandRequestDrawer;
