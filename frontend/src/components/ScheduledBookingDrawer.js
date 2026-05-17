/**
 * ScheduledBookingDrawer - Complete booking flow for scheduled sessions
 * Integrates: ExactTimeSlotPicker, Impact Zone coordinates, Account Credit, Crew Split, Confirmation
 */

import React, { useState, useEffect } from 'react';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import {

  Camera,
  Check, Sparkles
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';


import { Badge } from './ui/badge';

import { toast } from 'sonner';

import apiClient from '../lib/apiClient';

import { ExactTimeSlotPicker } from './ExactTimeSlotPicker';


import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import { ROLES } from '../constants/roles';
import useHapticFeedback from '../hooks/useHapticFeedback';
import ImpactZonePicker from './booking/ImpactZonePicker';
import BookingPaymentStep from './booking/BookingPaymentStep';
import BookingSessionSummary from './booking/BookingSessionSummary';

// Extracted helper components
import { DURATION_PRICES, CrewSplitSection, CrossSellSuggestion, BookingConfirmation } from './booking/ScheduledBookingHelpers';
import { BookingSelfieStep } from './booking/BookingSelfieStep';
import { BookingConfirmStep } from './booking/BookingConfirmStep';
import { BookingFooter } from './booking/BookingFooter';

/**
 * Main Scheduled Booking Drawer Component
 */
export var ScheduledBookingDrawer = ({
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
              {/* Session Summary + Crew Payment — Extracted */}
              <BookingSessionSummary
                selectedDate={selectedDate}
                selectedTime={selectedTime}
                selectedDuration={selectedDuration}
                impactZone={impactZone}
                crewSplitEnabled={crewSplitEnabled}
                crewMembers={crewMembers}
                maxParticipants={maxParticipants}
                groupDiscountPercent={groupDiscountPercent}
                discountAmount={discountAmount}
                totalPrice={totalPrice}
                captainShare={captainShare}
                pricePerPerson={pricePerPerson}
                isLight={isLight}
                textPrimary={textPrimary}
                textSecondary={textSecondary}
              />
              
              {/* Payment Method Selection - Extracted Component */}
              <BookingPaymentStep
                crewSplitEnabled={crewSplitEnabled}
                captainShare={captainShare}
                totalPrice={totalPrice}
                userCredits={userCredits}
                appliedCredits={appliedCredits}
                setAppliedCredits={setAppliedCredits}
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                isLight={isLight}
                textPrimary={textPrimary}
                textSecondary={textSecondary}
              />
            </div>
          )}
        
          {/* Step 5: Selfie for Identification */}
          {step === 'selfie' && (
            <BookingSelfieStep
              selfieUrl={selfieUrl}
              setSelfieUrl={setSelfieUrl}
              setStep={setStep}
              isLight={isLight}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
            />
          )}
        
          {/* Step 6: Confirmation */}
          {step === 'confirm' && (
            <BookingConfirmStep
              photographer={photographer}
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              impactZone={impactZone}
              totalPrice={totalPrice}
              appliedCredits={appliedCredits}
              isLight={isLight}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
            />
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
        <BookingFooter
          step={step}
          isLight={isLight}
          handleNext={handleNext}
          handleBack={handleBack}
          handleSubmitBooking={handleSubmitBooking}
          loading={loading}
          canProceedFromTime={canProceedFromTime}
          canProceedFromLocation={canProceedFromLocation}
          canProceedFromCrew={canProceedFromCrew}
        />
      </DialogContent>
    </Dialog>
  );
};

export default ScheduledBookingDrawer;
