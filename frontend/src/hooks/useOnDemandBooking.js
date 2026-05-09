
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';
import useHapticFeedback from './useHapticFeedback';
import { useOnDemandCrew } from './useOnDemandCrew';
import { useOnDemandLocation } from './useOnDemandLocation';

const useOnDemandBooking = ({ photographer, isOpen, onClose, onSuccess, userLocation, resumeDispatchId }) => {
  const { user, updateUser } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const haptic = useHapticFeedback();

  const [step, setStep] = useState('timing');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [requestId, setRequestId] = useState(null);
  const [acceptedData, setAcceptedData] = useState(null);
  const [showSelfieModal, setShowSelfieModal] = useState(false);
  const selfieShownRef = useRef(false); // gates selfie modal to open exactly once
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [localCredits, setLocalCredits] = useState(0);
  const [creditsFetched, setCreditsFetched] = useState(false);
  const [subscriptionDiscount, setSubscriptionDiscount] = useState(null);
  
  // Always fetch credits when drawer opens
  useEffect(() => {
    const fetchCredits = async () => {
      if (user?.id && isOpen && !creditsFetched) {
        try {
          const res = await apiClient.get(`/credits/balance/${user.id}`);
          if (res.data?.balance !== undefined) {
            const balance = res.data.balance;
            setLocalCredits(balance);
            setCreditsFetched(true);
            // Auto-select credits if user has them
            if (balance > 0) {
              setPaymentMethod('credits');
            }
          }
        } catch (e) {
          logger.error('[OnDemandDrawer] Failed to fetch credits:', e);
          setCreditsFetched(true); // Mark as fetched even on error to prevent infinite loops
        }
      }
    };
    fetchCredits();
  }, [isOpen, user?.id, creditsFetched]);
  
  // Fetch subscription discount for this photographer
  useEffect(() => {
    const fetchSubDiscount = async () => {
      if (!user?.id || !photographer?.id || !isOpen) return;
      try {
        const res = await apiClient.get(
          `/photo-subscriptions/check-quota?surfer_id=${user.id}&photographer_id=${photographer.id}&quota_type=session`
        );
        if (res.data?.subscription_active) {
          setSubscriptionDiscount(res.data);
        } else {
          setSubscriptionDiscount(null);
        }
      } catch {
        setSubscriptionDiscount(null);
      }
    };
    fetchSubDiscount();
  }, [isOpen, user?.id, photographer?.id]);

  // Reset state when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setCreditsFetched(false);
      setShowCancelConfirm(false);
      setSubscriptionDiscount(null);
    }
  }, [isOpen]);
  
  const [startTimeOption, setStartTimeOption] = useState(30); // 30, 60, or 90 minutes from now
  
  const minDuration = photographer?.min_session_hours || 0.5;
  const maxDuration = photographer?.max_session_hours || 7;
  const [requestDuration, setRequestDuration] = useState(minDuration);

  const hourlyRate = photographer?.on_demand_hourly_rate || 75;
  const photosIncluded = Math.ceil((photographer?.on_demand_photos_included || 3) * requestDuration);
  const perSurferFee = photographer?.price_per_additional_surfer || 15;
  const baseSessionPrice = hourlyRate * requestDuration;

  const {
    selectedSpot, setSelectedSpot,
    customLocationName, setCustomLocationName,
    customLocationAddress, setCustomLocationAddress,
    nearbySpots, setNearbySpots,
    loadingSpots, setLoadingSpots,
    spotSearchQuery, setSpotSearchQuery,
    useCustomLocation, setUseCustomLocation,
    recentSpots, setRecentSpots,
    customLocationCoords, setCustomLocationCoords,
    geocodingAddress, setGeocodingAddress,
    saveRecentSpot
  } = useOnDemandLocation(step, userLocation, photographer, user);

  const {
    splitEnabled, setSplitEnabled,
    crewMembers, setCrewMembers,
    newCrewInput, setNewCrewInput,
    showAddCrewInput, setShowAddCrewInput,
    recentBuddies, following,
    friendSearchResults, searchingFriends,
    totalPrice, totalParticipants, perPersonSplit,
    crewCoversAmount, captainPayAmount,
    handleAddCrewMember, handleSelectFriend, handleRemoveCrewMember,
    handleCrewPercentageChange, handleToggleCoverMember,
    handleDistributeEvenly, handleCoverAllCrew
  } = useOnDemandCrew(user, baseSessionPrice, perSurferFee, step);

  
  // Countdown timer for photographer response
  useEffect(() => {
    if (step === 'waiting' && countdown === null) {
      setCountdown(60);
    }
    if (step === 'waiting' && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [step, countdown]);
  
  // Countdown timer for photographer response
  
  const scrollContainerRef = useRef(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return; // Desktop or unsupported browser
    
    const isMobile = () => window.innerWidth < 640;
    
    const handleResize = () => {
      if (!isMobile()) {
        setKeyboardOpen(false);
        return;
      }
      const keyboardHeight = window.innerHeight - vv.height;
      setKeyboardOpen(keyboardHeight > 100);
    };
    
    vv.addEventListener('resize', handleResize);
    return () => vv.removeEventListener('resize', handleResize);
  }, []);
  
  const isLight = theme === 'light';
  const textPrimary = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-500' : 'text-muted-foreground';
  const bgCard = isLight ? 'bg-white' : 'bg-card';
  
  const crewAdditionalCost = perSurferFee * crewMembers.length;

  // Subscription discount (on-demand sessions)
  const subDiscountPct = subscriptionDiscount?.on_demand_discount_pct || 0;
  const subDiscountAmount = subDiscountPct > 0 ? (totalPrice * subDiscountPct / 100) : 0;
  const discountedTotalPrice = totalPrice - subDiscountAmount;
  
  const hasEnoughCredits = crewMembers.length > 0 
    ? (captainPayAmount === 0 || localCredits >= captainPayAmount)  // Allow $0 captain share
    : localCredits >= totalPrice;
  
  const estimatedResponse = photographer?.distance 
    ? Math.max(2, Math.ceil(photographer.distance * 3))
    : 5;
  
  // Resume from existing dispatch if provided
  useEffect(() => {
    if (resumeDispatchId && isOpen) {
      setRequestId(resumeDispatchId);
      setStep('waiting');
    }
  }, [resumeDispatchId, isOpen]);
  
  const formatDuration = (hours) => {
    if (hours < 1) return `${Math.round(hours * 60)} min`;
    if (hours === 1) return '1 hour';
    if (hours % 1 === 0) return `${hours} hours`;
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  };
  
  const handleSubmitRequest = async () => {
    setLoading(true);
    try {
      // Determine coordinates based on location selection mode:
      // 1. Mapped spot selected -> use spot coordinates
      // 2. Custom location with geocoded address -> use geocoded coordinates
      // 3. Custom location without address -> use surfer's GPS ("meet me here")
      // 4. "Use Current Location" (neither spot nor custom) -> use surfer's GPS
      let lat, lng;
      if (selectedSpot?.latitude && selectedSpot?.longitude) {
        // Case 1: Mapped surf spot
        lat = selectedSpot.latitude;
        lng = selectedSpot.longitude;
      } else if (useCustomLocation && customLocationCoords?.latitude && customLocationCoords?.longitude) {
        // Case 2: Custom address was geocoded successfully
        lat = customLocationCoords.latitude;
        lng = customLocationCoords.longitude;
      } else {
        // Case 3 & 4: Fall back to surfer's GPS
        lat = userLocation?.latitude || photographer?.on_demand_latitude || 28.3667;
        lng = userLocation?.longitude || photographer?.on_demand_longitude || -80.6067;
      }
      
      // Determine the location name from selection (include address if provided)
      const baseLocationName = selectedSpot?.name || (useCustomLocation && customLocationName ? customLocationName : null) || photographer?.on_demand_city || 'Current Location';
      const locationName = useCustomLocation && customLocationAddress
        ? `${baseLocationName} - ${customLocationAddress}`
        : baseLocationName;
      
      // Calculate requested start time based on user's timing selection
      const requestedStartTime = new Date(Date.now() + startTimeOption * 60000).toISOString();
      
      // Step 1: Create dispatch request (always pending payment)
      // Include captain's share amount and crew shares for split bookings
      const crewSharesPayload = crewMembers.length > 0 ? crewMembers.map(m => ({
        user_id: m.user_id || m.id || m.value,
        share_amount: m.covered_by_captain ? 0 : (m.share_amount ?? parseFloat(perPersonSplit)),
        covered_by_captain: m.covered_by_captain || false
      })) : null;
      
      const response = await apiClient.post(`/dispatch/request?requester_id=${user.id}`, {
        latitude: lat,
        longitude: lng,
        location_name: locationName,
        spot_id: selectedSpot?.id || null,
        estimated_duration_hours: requestDuration,
        is_immediate: true,  // On-demand is always immediate (same-day)
        requested_start_time: requestedStartTime,
        arrival_window_minutes: startTimeOption,  // 30, 60, or 90 minutes
        is_shared: crewMembers.length > 0,
        friend_ids: crewMembers.length > 0 ? crewMembers.map(c => c.user_id || c.id || c.value) : null,
        target_photographer_id: photographer.id,
        captain_share_amount: crewMembers.length > 0 ? captainPayAmount : null,  // Captain's portion
        crew_shares: crewSharesPayload
      });
      
      const dispatchId = response.data.id;
      setRequestId(dispatchId);
      
      // Step 2: Process payment based on method selected
      if (paymentMethod === 'credits') {
        // Pay with credits - immediate confirmation
        const payResponse = await apiClient.post(`/dispatch/${dispatchId}/pay?payer_id=${user.id}`);
        
        if (payResponse.data.remaining_credits !== undefined) {
          updateUser({ credit_balance: payResponse.data.remaining_credits });
        }
        
        toast.success('Payment confirmed! \u{2705} Setting up your session...');
        haptic('success');
        // Navigate to full lobby page - selfie prompt lives there
        const lobbyState = {
          crewMembers,
          photographer,
          captainPayAmount,
          needsSelfie: true,
        };
        onClose();
        navigate(`/dispatch/${dispatchId}/lobby`, { state: lobbyState });
      } else {
        // Pay with card - redirect to Stripe Checkout
        const amountToCharge = crewMembers.length > 0 ? captainPayAmount : totalPrice;
        
        const checkoutResponse = await apiClient.post(`/dispatch/checkout`, {
          dispatch_id: dispatchId,
          payer_id: user.id,
          amount: amountToCharge,
          origin_url: window.location.origin
        });
        
        if (checkoutResponse.data.checkout_url) {
          // Redirect to Stripe checkout
          toast.info('Redirecting to secure payment...');
          window.location.href = checkoutResponse.data.checkout_url;
        } else {
          throw new Error('Failed to create checkout session');
        }
      }
      
    } catch (error) {
      const errorDetail = error.response?.data?.detail;
      if (typeof errorDetail === 'object' && errorDetail.refunded) {
        toast.info(`Request failed but ${errorDetail.refund_amount?.toFixed(2) || '0.00'} credits refunded.`);
        if (errorDetail.new_balance !== undefined) {
          updateUser({ credit_balance: errorDetail.new_balance });
        }
      } else {
        const message = typeof errorDetail === 'string' ? errorDetail : 'Failed to send request';
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  };
  
  // Real-time polling for photographer acceptance
  useEffect(() => {
    let pollInterval = null;
    
    const pollDispatchStatus = async () => {
      if (!requestId) return;
      
      try {
        const response = await apiClient.get(`/dispatch/${requestId}`);
        const data = response.data;
        
        // Update crew member payment status from backend
        if (data.participants && data.participants.length > 0) {
          setCrewMembers(prev => prev.map(member => {
            const backendParticipant = data.participants.find(
              p => p.user_id === (member.user_id || member.id || member.value)
            );
            if (backendParticipant) {
              return {
                ...member,
                name: backendParticipant.name || member.name,
                username: backendParticipant.username || member.username,
                avatar_url: backendParticipant.avatar_url || member.avatar_url,
                selfie_url: backendParticipant.selfie_url || member.selfie_url,
                share_amount: backendParticipant.share_amount,
                payment_status: backendParticipant.status,
                paid_at: backendParticipant.paid_at
              };
            }
            return member;
          }));
        }
        
        if (data.status === 'accepted' || data.status === 'en_route') {
          if (pollInterval) clearInterval(pollInterval);
          
          try {
            const audio = new Audio('/sounds/notification.mp3');
            audio.volume = 0.5;
            audio.play().catch(() => {});
          } catch (e) { /* audio playback unavailable - ignore silently */ }
          
          setAcceptedData({
            photographer_id: data.photographer?.id,
            photographer_name: data.photographer?.name || photographer?.full_name,
            photographer_avatar: data.photographer?.avatar || photographer?.avatar_url,
            eta_minutes: data.gps?.eta_minutes || estimatedResponse
          });
          
          setStep('success');
          haptic('success');
          toast.success(`${data.photographer?.name || 'A photographer'} is on their way! ETA: ~${data.gps?.eta_minutes || estimatedResponse} min`, {
            duration: 5000,
            icon: String.fromCodePoint(0x1F4F8)
          });
          
          setTimeout(() => {
            onSuccess?.({ 
              request_id: requestId,
              photographer_id: data.photographer?.id,
              photographer_name: data.photographer?.name
            });
          }, 3000);
        }
        
        if (data.status === 'cancelled') {
          if (pollInterval) clearInterval(pollInterval);
          
          // Check if it was declined by photographer
          const wasDeclined = data.cancelled_reason?.includes('declined');
          
          if (wasDeclined) {
            toast.error('The photographer is unavailable right now. Your credits have been refunded.', {
              duration: 5000
            });
          } else {
            toast.error('Request was cancelled');
          }
          
          // Update user credits if refunded
          if (data.refund_amount) {
            const newBalance = (user?.credit_balance || 0) + data.refund_amount;
            updateUser({ credit_balance: newBalance });
          }
          
          onClose();
        }
        
      } catch (error) {
        logger.error('Poll error:', error);
      }
    };
    
    if (step === 'waiting' && requestId) {
      pollDispatchStatus();
      pollInterval = setInterval(pollDispatchStatus, 8000);
    }
    
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [step, requestId, photographer, estimatedResponse, onSuccess, onClose]);
  
  const isPro = photographer?.role === ROLES.APPROVED_PRO || photographer?.role === ROLES.PRO;
  
  return {
    // Flow state
    step, setStep,
    loading, setLoading,
    countdown, setCountdown,
    requestId, setRequestId,
    acceptedData, setAcceptedData,
    showSelfieModal, setShowSelfieModal,
    selfieShownRef,
    showCancelConfirm, setShowCancelConfirm,
    
    // Payment state
    paymentMethod, setPaymentMethod,
    localCredits, setLocalCredits,
    creditsFetched, setCreditsFetched,
    subscriptionDiscount, setSubscriptionDiscount,
    
    // Timing state
    startTimeOption, setStartTimeOption,
    
    // Duration state
    minDuration, maxDuration,
    requestDuration, setRequestDuration,
    
    // Crew state
    splitEnabled, setSplitEnabled,
    crewMembers, setCrewMembers,
    newCrewInput, setNewCrewInput,
    showAddCrewInput, setShowAddCrewInput,
    recentBuddies, following,
    friendSearchResults, searchingFriends,
    
    // Location state
    selectedSpot, setSelectedSpot,
    customLocationName, setCustomLocationName,
    customLocationAddress, setCustomLocationAddress,
    nearbySpots, setNearbySpots,
    loadingSpots, setLoadingSpots,
    spotSearchQuery, setSpotSearchQuery,
    useCustomLocation, setUseCustomLocation,
    recentSpots, setRecentSpots,
    customLocationCoords, setCustomLocationCoords,
    geocodingAddress, setGeocodingAddress,
    
    // Keyboard state
    scrollContainerRef,
    keyboardOpen, setKeyboardOpen,
    
    // Theme
    isLight,
    textPrimary, textSecondary, bgCard,
    
    // Pricing (derived)
    hourlyRate, photosIncluded, perSurferFee,
    baseSessionPrice, crewAdditionalCost, totalPrice,
    subDiscountPct, subDiscountAmount, discountedTotalPrice,
    totalParticipants, perPersonSplit,
    crewCoversAmount, captainPayAmount,
    hasEnoughCredits, estimatedResponse,
    isPro,
    
    // Handlers
    formatDuration,
    handleAddCrewMember, handleSelectFriend, handleRemoveCrewMember,
    handleCrewPercentageChange, handleToggleCoverMember,
    handleDistributeEvenly, handleCoverAllCrew,
    handleSubmitRequest,
    saveRecentSpot,
    
    // Auth/context
    user, updateUser, navigate,
  };
};

export default useOnDemandBooking;
