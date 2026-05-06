/**
 * ScheduledBookingDrawer - Complete booking flow for scheduled sessions
 * Integrates: ExactTimeSlotPicker, Impact Zone coordinates, Account Credit, Crew Split, Confirmation
 */

import React, { useState, useEffect, useCallback } from 'react';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import {

  Camera, MapPin, Clock, DollarSign, Zap, ChevronRight, ChevronLeft,
  Check, AlertTriangle, Star, Wallet, Target, Sparkles, Bell, Gift,
  Navigation, Map as MapIcon, X, Loader2, CheckCircle2, Radio, CreditCard, Users,
  UserPlus, Search, Crown, Percent, Anchor, Award, Plus
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

import { Button } from './ui/button';

import { Badge } from './ui/badge';

import { Input } from './ui/input';

import { Label } from './ui/label';

import { Slider } from './ui/slider';

import { Switch } from './ui/switch';

import { toast } from 'sonner';

import apiClient, { BACKEND_URL } from '../lib/apiClient';

import { ExactTimeSlotPicker } from './ExactTimeSlotPicker';

import { SavedCrewSelector } from './SavedCrewSelector';

import { SelfieCapture } from './SelfieCapture';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import { ROLES } from '../constants/roles';
import useHapticFeedback from '../hooks/useHapticFeedback';
import ImpactZonePicker from './booking/ImpactZonePicker';




// Extracted helper components
import { DURATION_PRICES, SchedSurfboardAvatar, SchedEmptySeat, SCHED_BOARD_COLORS, CrewSplitSection, CrossSellSuggestion, BookingConfirmation } from './booking/ScheduledBookingHelpers';


/**
 * Main Scheduled Booking Drawer Component
 */
export const ScheduledBookingDrawer = ({
  isOpen,
  onClose,
  photographer,
  _onSuccess
}) => {
  const { user, updateUser } = useAuth();
  const { theme } = useTheme();
  const haptic = useHapticFeedback();
  
  // Step management: 'time' -> 'location' -> 'crew' -> 'payment' -> 'selfie' -> 'confirm' -> 'success'
  const [step, setStep] = useState('time');
  const [selfieUrl, setSelfieUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Time slot state
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedDuration, setSelectedDuration] = useState(60);
  
  // Location state
  const [impactZone, setImpactZone] = useState(null);
  const [locationValid, setLocationValid] = useState(true);
  const [travelSurcharge, setTravelSurcharge] = useState(0);
  
  // Crew split state
  const [crewSplitEnabled, setCrewSplitEnabled] = useState(false);
  const [crewMembers, setCrewMembers] = useState([]);
  
  // Payment state
  const [appliedCredits, setAppliedCredits] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('card'); // Default to 'card' to ensure Stripe flow
  
  // Booking result
  const [bookingResult, setBookingResult] = useState(null);
  
  const isLight = theme === 'light';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const bgCard = isLight ? 'bg-white' : 'bg-zinc-900';
  
  // Calculate pricing - MUST match backend calculation
  // For scheduled bookings: booking_hourly_rate || hourly_rate || session_price || 75
  const baseRate = photographer?.booking_hourly_rate || photographer?.hourly_rate || photographer?.session_price || 75;
  const durationMultiplier = DURATION_PRICES[selectedDuration] || 1;
  const basePrice = baseRate * durationMultiplier;
  
  // Group discounts
  const groupDiscount2 = photographer?.group_discount_2_plus || 0;
  const groupDiscount3 = photographer?.group_discount_3_plus || 0;
  const groupDiscount5 = photographer?.group_discount_5_plus || 0;
  
  // Calculate participants based on crew
  const maxParticipants = crewSplitEnabled ? crewMembers.length + 1 : 1;
  let groupDiscountPercent = 0;
  if (maxParticipants >= 5 && groupDiscount5 > 0) groupDiscountPercent = groupDiscount5;
  else if (maxParticipants >= 3 && groupDiscount3 > 0) groupDiscountPercent = groupDiscount3;
  else if (maxParticipants >= 2 && groupDiscount2 > 0) groupDiscountPercent = groupDiscount2;
  
  const discountAmount = (basePrice * groupDiscountPercent) / 100;
  // Include travel surcharge in total price
  const totalPrice = basePrice - discountAmount + travelSurcharge;
  const pricePerPerson = totalPrice / maxParticipants;
  // Captain covers their own equal share + anything they chose to cover for crew
  const captainCoverageExtra = crewMembers.reduce(
    (sum, m) => sum + (pricePerPerson * ((m.captain_cover_percent || 0) / 100)), 0
  );
  const captainShare = pricePerPerson + captainCoverageExtra;
  const userCredits = user?.credit_balance || 0;
  
  // Check if group discounts are available (for display)
  const _hasGroupDiscounts = groupDiscount2 > 0 || groupDiscount3 > 0 || groupDiscount5 > 0;
  
  // Reset state when drawer opens
  useEffect(() => {
    if (isOpen) {
      setStep('time');
      setSelectedDate(null);
      setSelectedTime(null);
      setSelectedCategory(null);
      setSelectedDuration(60);
      setImpactZone(null);
      setLocationValid(true);
      setTravelSurcharge(0);
      setCrewSplitEnabled(false);
      setCrewMembers([]);
      setAppliedCredits(0);
      setBookingResult(null);
      setSelfieUrl(null);
    }
  }, [isOpen]);
  
  // Auto-apply credits only if payment method is 'credits'
  useEffect(() => {
    if (paymentMethod === 'credits') {
      const amountToPay = crewSplitEnabled ? captainShare : totalPrice;
      if (userCredits > 0 && amountToPay > 0) {
        setAppliedCredits(Math.min(userCredits, amountToPay));
      }
    } else if (paymentMethod === 'card') {
      // For card payment, reset applied credits to 0 (user can manually add via slider)
      setAppliedCredits(0);
    }
  }, [userCredits, totalPrice, captainShare, crewSplitEnabled, paymentMethod]);
  
  const canProceedFromTime = selectedDate && selectedTime && selectedDuration && selectedCategory;
  const canProceedFromLocation = impactZone && impactZone.description && locationValid;
  const canProceedFromCrew = !crewSplitEnabled || crewMembers.length >= 1; // Need at least 1 crew member if split enabled
  
  // Handler for range validation from ImpactZonePicker
  const handleRangeValidation = (isValid, surcharge) => {
    setLocationValid(isValid);
    setTravelSurcharge(surcharge);
  };
  
  const handleBack = () => {
    if (step === 'location') setStep('time');
    else if (step === 'crew') setStep('location');
    else if (step === 'payment') setStep('crew');
    else if (step === 'selfie') setStep('payment');
    else if (step === 'confirm') setStep('selfie');
  };
  
  const handleNext = () => {
    if (step === 'time' && canProceedFromTime) setStep('location');
    else if (step === 'location' && canProceedFromLocation) setStep('crew');
    else if (step === 'crew' && canProceedFromCrew) setStep('payment');
    else if (step === 'payment') setStep('selfie');
    else if (step === 'selfie') setStep('confirm');
  };
  
  // Calculate payment window based on session time
  const calculatePaymentWindow = () => {
    if (!selectedDate || !selectedTime) return null;
    
    const sessionDateTime = new Date(selectedDate);
    const [hours, minutes] = selectedTime.split(':');
    sessionDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    
    const now = new Date();
    const hoursUntilSession = (sessionDateTime - now) / (1000 * 60 * 60);
    
    // If session is within 72 hours, payment window is 24 hours before session
    // Otherwise, payment window is 72 hours from booking
    if (hoursUntilSession <= 72) {
      // Payment due 24 hours before session
      const paymentDeadline = new Date(sessionDateTime);
      paymentDeadline.setHours(paymentDeadline.getHours() - 24);
      return paymentDeadline;
    } else {
      // Payment due in 72 hours
      const paymentDeadline = new Date(now);
      paymentDeadline.setHours(paymentDeadline.getHours() + 72);
      return paymentDeadline;
    }
  };
  
  const handleSubmitBooking = async () => {
    setLoading(true);
    
    try {
      // Build the exact session datetime
      const sessionDateTime = new Date(selectedDate);
      const [hours, minutes] = selectedTime.split(':');
      sessionDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      
      // Calculate captain's payment amount
      const captainPaymentAmount = crewSplitEnabled ? captainShare : totalPrice;
      const amountToCharge = Math.max(0, captainPaymentAmount - appliedCredits);
      
      // Calculate payment window for crew
      const paymentWindowExpires = calculatePaymentWindow();
      
      // Prepare crew member data for backend (use actual out-of-pocket per member)
      const crewMemberData = crewMembers.map(m => ({
        user_id: m.user_id,
        name: m.name,
        share_amount: parseFloat((pricePerPerson * (1 - (m.captain_cover_percent || 0) / 100)).toFixed(2))
      }));
      
      // If there's an amount to charge and user selected card payment
      if (amountToCharge > 0 && paymentMethod === 'card') {
        // Create booking with pending payment status and redirect to Stripe
        const response = await apiClient.post(`/bookings/create-with-stripe`, {
          photographer_id: photographer.id,
          location: impactZone.description,
          session_date: sessionDateTime.toISOString(),
          duration: selectedDuration,
          max_participants: maxParticipants,
          allow_splitting: crewSplitEnabled,
          split_mode: 'friends_only',
          crew_members: crewMemberData,
          payment_window_expires: paymentWindowExpires?.toISOString(),
          latitude: impactZone.latitude || null,
          longitude: impactZone.longitude || null,
          description: `${selectedCategory} session`,
          apply_credits: appliedCredits,
          impact_zone_type: impactZone.type,
          impact_zone_preset: impactZone.preset_id || null,
          origin_url: window.location.origin
        });
        
        // Update credits if partially applied
        if (appliedCredits > 0 && response.data.remaining_credits !== undefined) {
          updateUser({ credit_balance: response.data.remaining_credits });
        }
        
        // Redirect to Stripe checkout
        if (response.data.checkout_url) {
          window.location.href = response.data.checkout_url;
          return;
        }
      }
      
      // Full credit payment or credits cover everything
      const response = await apiClient.post(`/bookings/create`, {
        photographer_id: photographer.id,
        location: impactZone.description,
        session_date: sessionDateTime.toISOString(),
        duration: selectedDuration,
        max_participants: maxParticipants,
        allow_splitting: crewSplitEnabled,
        split_mode: 'friends_only',
        crew_members: crewMemberData,
        payment_window_expires: paymentWindowExpires?.toISOString(),
        latitude: impactZone.latitude || null,
        longitude: impactZone.longitude || null,
        description: `${selectedCategory} session`,
        // Credit application
        apply_credits: appliedCredits,
        // Impact zone details
        impact_zone_type: impactZone.type,
        impact_zone_preset: impactZone.preset_id || null
      });
      
      // Update user credits if applied
      if (appliedCredits > 0 && response.data.remaining_credits !== undefined) {
        updateUser({ credit_balance: response.data.remaining_credits });
      }
      
      // If crew split is enabled, send payment requests to crew members
      if (crewSplitEnabled && crewMembers.length > 0 && response.data.booking?.id) {
        try {
          await apiClient.post(`/bookings/${response.data.booking.id}/send-crew-requests`, {
            crew_members: crewMemberData,
            price_per_person: pricePerPerson,
            payment_deadline: paymentWindowExpires?.toISOString(),
            session_date: sessionDateTime.toISOString(),
            photographer_name: photographer.full_name
          });
        } catch (crewError) {
          logger.error('Failed to send crew payment requests:', crewError);
          // Don't fail the booking, just notify
          toast.warning('Booking created but crew notifications may be delayed');
        }
      }
      
      setBookingResult({
        ...response.data,
        session_date: sessionDateTime.toISOString(),
        location: impactZone.description,
        duration: selectedDuration,
        total_paid: crewSplitEnabled ? captainShare : totalPrice,
        credits_applied: appliedCredits,
        crew_split: crewSplitEnabled,
        crew_count: maxParticipants,
        price_per_person: pricePerPerson
      });
      
      // Upload selfie for the booking if captured
      if (selfieUrl && response.data.booking?.id) {
        try {
          await apiClient.patch(`/bookings/${response.data.booking.id}/participant-selfie`, {
            participant_id: user.id,
            selfie_url: selfieUrl
          });
          logger.info('Selfie uploaded for booking');
        } catch (selfieError) {
          logger.error('Failed to upload selfie:', selfieError);
          // Don't fail the booking, selfie can be added later
        }
      }
      
      setStep('success');
      toast.success('Session booked successfully!');
      // Haptic feedback for premium mobile feel
      if (typeof haptic === 'function') haptic('success');
      
    } catch (error) {
      logger.error('Booking error:', error);
      
      // Handle time slot conflict specifically
      if (error.response?.status === 409) {
        toast.error(error.response?.data?.detail || 'This time slot is already booked. Please select a different time.');
      } else {
        toast.error(error.response?.data?.detail || 'Failed to create booking');
      }
    } finally {
      setLoading(false);
    }
  };
  
  const handleCrossSellAction = (action) => {
    if (action === 'live_now') {
      onClose();
      // Navigate to live now tab - will be handled by parent
      window.location.href = '/bookings?tab=live_now';
    }
  };
  
  const isPro = photographer?.role === ROLES.APPROVED_PRO || photographer?.role === ROLES.PRO;
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className={`${bgCard} border-zinc-800 sm:max-w-lg`}
      >
        {/* Fixed Header */}
        <div className="shrink-0 px-4 sm:px-6 pt-4 pb-2 border-b border-zinc-800">
          <DialogHeader>
            <DialogTitle className={`text-base font-bold ${textPrimary} flex items-center gap-2`}>
              <Camera className="w-4 h-4 text-yellow-400" />
              Book Session
            </DialogTitle>
          </DialogHeader>
        </div>
        
        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-3"
          style={{ minHeight: 0 }}>
        
        
          {/* Photographer Info Header - Compact */}
          {step !== 'success' && (
            <div className={`p-2 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800'} mb-3`}>
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full overflow-hidden flex-shrink-0 ${isPro ? 'ring-2 ring-yellow-400' : 'ring-1 ring-cyan-400/50'}`}>
                  {photographer?.avatar_url ? (
                    <img loading="lazy" decoding="async" src={getFullUrl(photographer.avatar_url)} alt={photographer.full_name} className="w-full h-full object-cover" />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`}>
                      <Camera className="w-3 h-3 text-gray-400" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className={`font-semibold text-xs ${textPrimary} truncate`}>{photographer?.full_name}</h3>
                    {isPro && (
                      <Badge className="bg-yellow-500/20 text-yellow-400 text-[10px] px-1 py-0">PRO</Badge>
                    )}
                  </div>
                  <p className={`text-[10px] ${textSecondary}`}>
                    From <span className="text-yellow-400 font-bold">${baseRate}</span>/session
                  </p>
                </div>
              </div>
            </div>
          )}
        
          {/* Step Progress - Ultra Compact */}
          {step !== 'success' && (
            <div className="flex items-center justify-center gap-0.5 mb-3">
              {['time', 'location', 'crew', 'payment', 'selfie', 'confirm'].map((s, idx) => (
                <React.Fragment key={s}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                    step === s 
                      ? 'bg-yellow-500 text-black' 
                      : idx < ['time', 'location', 'crew', 'payment', 'selfie', 'confirm'].indexOf(step)
                        ? 'bg-green-500 text-white'
                        : 'bg-zinc-700 text-gray-400'
                  }`}>
                    {idx < ['time', 'location', 'crew', 'payment', 'selfie', 'confirm'].indexOf(step) ? (
                      <Check className="w-2.5 h-2.5" />
                    ) : (
                      idx + 1
                    )}
                  </div>
                  {idx < 5 && (
                    <div className={`w-2 h-0.5 flex-shrink-0 ${
                      idx < ['time', 'location', 'crew', 'payment', 'selfie', 'confirm'].indexOf(step) 
                        ? 'bg-green-500' 
                        : 'bg-zinc-700'
                    }`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
        
          {/* Step 1: Time Selection */}
          {step === 'time' && (
            <div className="space-y-3 pb-2">
              <ExactTimeSlotPicker
                selectedDate={selectedDate}
                selectedTime={selectedTime}
                selectedCategory={selectedCategory}
                selectedDuration={selectedDuration}
                onDateChange={setSelectedDate}
                onTimeChange={setSelectedTime}
                onCategoryChange={setSelectedCategory}
                onDurationChange={setSelectedDuration}
              />
              
              {/* Cross-sell - Live Now suggestion - Hidden on mobile to save space */}
              <div className="hidden sm:block">
                <CrossSellSuggestion 
                  type="live_now" 
                  photographerName={photographer?.full_name}
                  onAction={handleCrossSellAction}
                  isLight={isLight}
                />
              </div>
            </div>
          )}
        
          {/* Step 2: Impact Zone Location */}
          {step === 'location' && (
            <div className="space-y-3 pb-2">
              <ImpactZonePicker
                location={impactZone}
                onLocationChange={setImpactZone}
                onRangeValidation={handleRangeValidation}
                photographer={photographer}
                photographerHomeBreak={photographer?.home_break}
                isLight={isLight}
              />
            </div>
          )}
        
          {/* Step 3: Crew Split */}
          {step === 'crew' && (
            <div className="space-y-4 pb-4">
              <div className="text-center mb-2">
                <h3 className={`font-semibold ${textPrimary}`}>Split the Cost?</h3>
                <p className={`text-sm ${textSecondary}`}>Share this session with friends</p>
              </div>
              
              <CrewSplitSection
                user={user}
                enabled={crewSplitEnabled}
                onToggle={setCrewSplitEnabled}
                crewMembers={crewMembers}
                onCrewChange={setCrewMembers}
                totalPrice={totalPrice}
                isLight={isLight}
              />
              
              {/* Group Discount Applied Notice */}
              {crewSplitEnabled && groupDiscountPercent > 0 && (
                <div className={`p-3 rounded-lg bg-gradient-to-r ${isLight ? 'from-green-50 to-emerald-50' : 'from-green-500/10 to-emerald-500/10'} border border-green-500/30`}>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-green-400" />
                    <span className={`text-sm font-medium text-green-400`}>
                      {groupDiscountPercent}% Group Discount Applied!
                    </span>
                  </div>
                  <p className={`text-xs ${textSecondary} mt-1`}>
                    You're saving ${discountAmount.toFixed(2)} with {maxParticipants} surfers
                  </p>
                </div>
              )}
            </div>
          )}
        
          {/* Step 4: Payment */}
          {step === 'payment' && (
            <div className="space-y-4 pb-4">
              {/* Session Summary */}
              <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                <h4 className={`font-medium text-sm ${textPrimary} mb-2`}>Session Summary</h4>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className={textSecondary}>Date & Time</span>
                    <span className={textPrimary}>
                      {selectedDate?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {selectedTime}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className={textSecondary}>Duration</span>
                    <span className={textPrimary}>{selectedDuration} min</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={textSecondary}>Location</span>
                    <span className={`${textPrimary} truncate ml-2 max-w-[150px]`}>{impactZone?.description}</span>
                  </div>
                  {crewSplitEnabled && (
                    <>
                      <div className="flex justify-between">
                        <span className={textSecondary}>Crew Size</span>
                        <span className={textPrimary}>{maxParticipants} surfers</span>
                      </div>
                      {groupDiscountPercent > 0 && (
                        <div className="flex justify-between text-green-400">
                          <span>Group Discount ({groupDiscountPercent}%)</span>
                          <span>-${discountAmount.toFixed(2)}</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className={`flex justify-between pt-2 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
                    <span className={`font-bold ${textPrimary}`}>Total</span>
                    <span className="font-bold text-yellow-400">${totalPrice.toFixed(2)}</span>
                  </div>
                  {crewSplitEnabled && (
                    <div className="flex justify-between">
                      <span className={`font-bold ${textPrimary} flex items-center gap-1`}>
                        <Crown className="w-3 h-3 text-yellow-400" />
                        Your Share
                      </span>
                      <span className="font-bold text-cyan-400">${captainShare.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Crew Payment Info */}
              {crewSplitEnabled && crewMembers.length > 0 && (
                <div className={`p-2 rounded-lg ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'} border ${isLight ? 'border-cyan-200' : 'border-cyan-500/30'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="w-3 h-3 text-cyan-400" />
                    <span className={`text-xs font-medium ${textPrimary}`}>Crew Payments</span>
                  </div>
                  <p className={`text-xs ${textSecondary}`}>
                    ${pricePerPerson.toFixed(2)} each sent to crew via Messages.
                  </p>
                </div>
              )}
              
              {/* Payment Method Selection */}
              {(() => {
                const amountToPay = crewSplitEnabled ? captainShare : totalPrice;
                const canPayFullWithCredits = userCredits >= amountToPay;
                
                return (
                  <div className="space-y-2">
                    <Label className={`font-medium text-sm ${textPrimary}`}>Payment Method</Label>
                    
                    {/* Option 1: Pay with Credits */}
                    {userCredits > 0 && (
                      <button
                        onClick={() => {
                          setPaymentMethod('credits');
                          setAppliedCredits(Math.min(userCredits, amountToPay));
                        }}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                          paymentMethod === 'credits'
                            ? 'border-yellow-400 bg-yellow-500/10'
                            : isLight ? 'border-gray-200 bg-white' : 'border-zinc-700 bg-zinc-800/50'
                        }`}
                        data-testid="pay-with-credits-btn"
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          paymentMethod === 'credits' ? 'bg-yellow-400 text-black' : 'bg-zinc-700 text-gray-400'
                        }`}>
                          <Wallet className="w-4 h-4" />
                        </div>
                        <div className="flex-1 text-left">
                          <div className={`font-medium text-sm ${textPrimary}`}>Account Credits</div>
                          <div className={`text-xs ${textSecondary}`}>
                            ${userCredits.toFixed(2)} available
                            {canPayFullWithCredits && <span className="text-green-400 ml-1">(covers all!)</span>}
                          </div>
                        </div>
                        {paymentMethod === 'credits' && (
                          <Check className="w-4 h-4 text-yellow-400" />
                        )}
                      </button>
                    )}
                    
                    {/* Option 2: Pay with Card */}
                    <button
                      onClick={() => {
                        setPaymentMethod('card');
                        setAppliedCredits(0);
                      }}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                        paymentMethod === 'card'
                          ? 'border-cyan-400 bg-cyan-500/10'
                          : isLight ? 'border-gray-200 bg-white' : 'border-zinc-700 bg-zinc-800/50'
                      }`}
                      data-testid="pay-with-card-btn"
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        paymentMethod === 'card' ? 'bg-cyan-400 text-white' : 'bg-zinc-700 text-gray-400'
                      }`}>
                        <CreditCard className="w-4 h-4" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className={`font-medium text-sm ${textPrimary}`}>Pay with Card</div>
                        <div className={`text-xs ${textSecondary}`}>Secure via Stripe</div>
                      </div>
                      {paymentMethod === 'card' && (
                        <Check className="w-4 h-4 text-cyan-400" />
                      )}
                    </button>
                    
                    {/* Credit Slider for Card */}
                    {paymentMethod === 'card' && userCredits > 0 && (
                      <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800/50'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-xs ${textSecondary}`}>Also apply credits?</span>
                          <span className="text-xs text-yellow-400">${appliedCredits.toFixed(2)}</span>
                        </div>
                        <Slider
                          value={[appliedCredits]}
                          onValueChange={([value]) => setAppliedCredits(value)}
                          max={Math.min(userCredits, amountToPay)}
                          min={0}
                          step={0.5}
                          className="w-full"
                        />
                      </div>
                    )}
                    
                    {/* Payment Summary */}
                    <div className={`p-3 rounded-lg ${isLight ? 'bg-green-50 border-green-200' : 'bg-green-500/10 border-green-500/30'} border`}>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className={textSecondary}>Session Total</span>
                          <span className={textPrimary}>${amountToPay.toFixed(2)}</span>
                        </div>
                        {appliedCredits > 0 && (
                          <div className="flex justify-between text-yellow-500">
                            <span>Credits Applied</span>
                            <span>-${appliedCredits.toFixed(2)}</span>
                          </div>
                        )}
                        <div className={`flex justify-between pt-1 border-t ${isLight ? 'border-green-200' : 'border-green-500/30'} font-bold`}>
                          <span className={textPrimary}>
                            {paymentMethod === 'credits' && appliedCredits >= amountToPay 
                              ? 'Pay with Credits' 
                              : 'Card Payment via Stripe'}
                          </span>
                          <span className="text-green-400">
                            ${Math.max(0, amountToPay - appliedCredits).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Compact Protection Notice */}
                    <p className={`text-xs ${textSecondary}`}>
                      <Check className="w-3 h-3 inline mr-1 text-green-400" />
                      Payment held until session complete. Cancel 48hrs+ for 90% refund.
                    </p>
                  </div>
                );
              })()}
            </div>
          )}
        
          {/* Step 5: Selfie for Identification */}
          {step === 'selfie' && (
            <div className="space-y-4 pb-4">
              <div className={`p-4 rounded-xl ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'} border border-cyan-500/30`}>
                <h4 className={`font-bold text-sm ${textPrimary} mb-2 flex items-center gap-2`}>
                  <Camera className="w-4 h-4 text-cyan-400" />
                  Help the Photographer Find You!
                </h4>
                <p className={`text-xs ${textSecondary}`}>
                  Take a quick selfie with your board. This helps the photographer identify you in their photos so you don't miss any shots!
                </p>
              </div>
              
              {selfieUrl ? (
                <div className="space-y-3">
                  <div className="relative aspect-[4/3] rounded-xl overflow-hidden">
                    <img loading="lazy" decoding="async" src={selfieUrl} alt="Your selfie" className="w-full h-full object-cover" />
                    <Badge className="absolute top-2 right-2 bg-green-500 text-white">
                      <Check className="w-3 h-3 mr-1" /> Saved
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button aria-label="Camera"
                      variant="outline"
                      onClick={() => setSelfieUrl(null)}
                      className="flex-1"
                    >
                      <Camera className="w-4 h-4 mr-2" />
                      Retake
                    </Button>
                    <Button aria-label="Next"
                      onClick={() => setStep('confirm')}
                      className="flex-1 bg-gradient-to-r from-yellow-500 to-orange-500 text-black font-bold"
                    >
                      Continue
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              ) : (
                <SelfieCapture
                  onCapture={(url) => {
                    setSelfieUrl(url);
                    toast.success('Selfie captured! The photographer will use this to find you.');
                  }}
                  onSkip={() => {
                    setStep('confirm');
                  }}
                  title="Selfie with Your Board"
                  subtitle="Hold your board so the photographer can spot you in the lineup"
                  skipAllowed={true}
                  theme={isLight ? 'light' : 'dark'}
                />
              )}
            </div>
          )}
        
          {/* Step 6: Confirmation */}
          {step === 'confirm' && (
            <div className="space-y-4 pb-4">
              <div className={`p-3 rounded-xl ${isLight ? 'bg-yellow-50' : 'bg-yellow-500/10'} border border-yellow-500/30`}>
                <h4 className={`font-bold text-sm ${textPrimary} mb-2 flex items-center gap-2`}>
                  <CheckCircle2 className="w-4 h-4 text-yellow-400" />
                  Confirm Your Booking
                </h4>
                
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Camera className="w-3 h-3 text-gray-500" />
                    <span className={textPrimary}>{photographer?.full_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-gray-500" />
                    <span className={textPrimary}>
                      {selectedDate?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {selectedTime}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3 h-3 text-gray-500" />
                    <span className={`${textPrimary} truncate`}>{impactZone?.description}</span>
                  </div>
                  
                  <div className={`pt-2 border-t ${isLight ? 'border-yellow-200' : 'border-yellow-500/30'}`}>
                    <div className="flex justify-between">
                      <span className={textSecondary}>Total</span>
                      <span className={textPrimary}>${totalPrice.toFixed(2)}</span>
                    </div>
                    {appliedCredits > 0 && (
                      <div className="flex justify-between text-yellow-500">
                        <span>Credits</span>
                        <span>-${appliedCredits.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-sm mt-1">
                      <span className={textPrimary}>Pay Now</span>
                      <span className="text-green-400">${(totalPrice - appliedCredits).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Step 6: Success */}
          {step === 'success' && (
            <div className="pb-4">
              <BookingConfirmation
                booking={bookingResult}
                photographer={photographer}
                onClose={onClose}
                onViewBookings={() => {
                  onClose();
                  // Navigate to scheduled bookings tab with highlight on the new booking
                  const newBookingId = bookingResult?.booking?.id || bookingResult?.id || '';
                  window.location.href = `/bookings?tab=scheduled${newBookingId ? `&highlight=${newBookingId}` : ''}`;
                }}
                onAddAnotherSpot={() => {
                  setStep('time');
                  setSelectedDate(null);
                  setSelectedTime(null);
                  setSelectedCategory(null);
                  setImpactZone(null);
                  setBookingResult(null);
                  toast.info('Select time and location for your next spot!');
                }}
                isLight={isLight}
              />
            </div>
          )}
        </div>
        
        {/* Sticky Footer Navigation */}
        {step !== 'success' && (
          <div className={`flex-shrink-0 px-4 py-2 border-t ${isLight ? 'border-gray-200 bg-white' : 'border-zinc-800 bg-zinc-900'}`}>
            {step === 'time' && (
              <Button aria-label="Next"
                onClick={handleNext}
                disabled={!canProceedFromTime}
                className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold h-10"
                data-testid="continue-to-location-btn"
              >
                Continue
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
            
            {step === 'location' && (
              <div className="flex gap-2">
                <Button aria-label="Previous"
                  variant="outline"
                  onClick={handleBack}
                  className={`flex-1 h-10 ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <Button aria-label="Next"
                  onClick={handleNext}
                  disabled={!canProceedFromLocation}
                  className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-bold h-10"
                  data-testid="continue-to-crew-btn"
                >
                  Continue
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            )}
            
            {step === 'crew' && (
              <div className="flex gap-2">
                <Button aria-label="Previous"
                  variant="outline"
                  onClick={handleBack}
                  className={`flex-1 h-10 ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <Button aria-label="Next"
                  onClick={handleNext}
                  disabled={!canProceedFromCrew}
                  className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-bold h-10"
                  data-testid="continue-to-payment-btn"
                >
                  Payment
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            )}
            
            {step === 'payment' && (
              <div className="flex gap-2">
                <Button aria-label="Previous"
                  variant="outline"
                  onClick={handleBack}
                  className={`flex-1 h-10 ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <Button aria-label="Next"
                  onClick={handleNext}
                  className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-bold h-10"
                  data-testid="review-booking-btn"
                >
                  Review
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            )}
            
            {step === 'confirm' && (
              <div className="flex gap-2">
                <Button aria-label="Previous"
                  variant="outline"
                  onClick={handleBack}
                  className="flex-1 h-10 border-zinc-700"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <Button aria-label="Loader2"
                  onClick={handleSubmitBooking}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold h-10"
                  data-testid="confirm-booking-btn"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-1" />
                      Confirm & Pay
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ScheduledBookingDrawer;
