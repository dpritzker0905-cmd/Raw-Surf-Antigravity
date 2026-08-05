import React from 'react';



import apiClient from '../lib/apiClient';

import { MapPin, Camera, Zap, Clock, ChevronRight, Radio, Award, Calculator, Loader2, Wallet, Check, Bell, CreditCard, Navigation, Sparkles } from 'lucide-react';

import { Button } from './ui/button';


import { Dialog, DialogContent, DialogTitle } from './ui/dialog';


import { toast } from 'sonner';

import { RequestProSelfieModal } from './RequestProSelfieModal';


import { getFullUrl } from '../utils/media';
import { CrewStepPanel, CrewPaymentStepPanel } from './on-demand/OnDemandStepPanels';
import { TimingStep, DurationStep, SplitChoiceStep, LocationStep } from './on-demand/OnDemandEarlySteps';

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
    recentSpots, customLocationCoords, setCustomLocationCoords, geocodingAddress,
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
    handleSubmitRequest, saveRecentSpot, setCrewMembers,
    setFriendSearchResults,
    maxCrew, showCrewHelp, isKeyboardOpen, crewSearchQuery, crewSearchResults,
    crewSearchLoading, showManualEntry, manualCrewName, manualCrewEmail, manualCrewPhone,
    handleCrewSearch, addManualCrewMember, setShowCrewHelp, setShowManualEntry,
    setCrewSearchQuery, setManualCrewName, setManualCrewEmail, setManualCrewPhone,
    splitConfig, crewPriceBreakdown, handleCrewPaymentToggle, handleSplitRatioChange,
    handleSplitPercentageChange, handleCoverForCrewMember,
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
        {/* ============ STEP 0: START TIME SELECTION (Extracted) ============ */}
        <TimingStep booking={booking} photographer={photographer} />

        {/* ============ STEP 0.5: LOCATION SELECTION (Extracted) ============ */}
        <LocationStep booking={booking} photographer={photographer} />

 {/* Remaining location JSX removed now in LocationStep */}
        
        {/* ============ STEP 1: DURATION SELECTION (Extracted) ============ */}
        <DurationStep booking={booking} photographer={photographer} />

        {/* ============ STEP 1.5: SPLIT CHOICE (Extracted) ============ */}
        <SplitChoiceStep booking={booking} photographer={photographer} />
        
        {/* ============ STEP 2: CREW SELECTION ============ */}
              <CrewStepPanel
                booking={booking}
                crewMembers={crewMembers}
                handleRemoveCrewMember={handleRemoveCrewMember}
                handleAddCrewMember={handleAddCrewMember}
                getFullUrl={getFullUrl}
              />
              <CrewPaymentStepPanel
                booking={booking}
                crewMembers={crewMembers}
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
                <button
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
              
              <button
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
