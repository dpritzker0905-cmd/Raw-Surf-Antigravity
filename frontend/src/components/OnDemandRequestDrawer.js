import React, { useEffect, useState } from 'react';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import apiClient from '../lib/apiClient';

import { MapPin, Camera, Zap, Clock, ChevronRight, Radio, Award, Plus, X, Calculator, Loader2, Wallet, Check, Bell, CreditCard } from 'lucide-react';

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



// ============ SURFBOARD COLORS FOR CREW VISUALIZATION ============
const SURFBOARD_COLORS = [
  { fill: '#FCD34D', stroke: '#F59E0B' }, // Yellow (captain/you)
  { fill: '#22D3EE', stroke: '#0891B2' }, // Cyan
  { fill: '#F472B6', stroke: '#DB2777' }, // Pink
  { fill: '#A78BFA', stroke: '#7C3AED' }, // Purple
  { fill: '#34D399', stroke: '#059669' }, // Green
  { fill: '#FB923C', stroke: '#EA580C' }, // Orange
  { fill: '#60A5FA', stroke: '#2563EB' }, // Blue
];

// Surfboard SVG Component for crew member
const SurfboardAvatar = ({ member, index, isCaptain, onRemove, isLight }) => {
  const boardColor = SURFBOARD_COLORS[index % SURFBOARD_COLORS.length];
  const textPrimary = isLight ? 'text-gray-900' : 'text-foreground';
  
  return (
    <div className="relative group flex flex-col items-center">
      {/* Surfboard SVG */}
      <svg 
        viewBox="0 0 60 100" 
        className="absolute left-1/2 -translate-x-1/2 top-2 w-12 h-20 pointer-events-none"
        style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
      >
        <ellipse cx="30" cy="50" rx="12" ry="38" fill={boardColor.fill} stroke={boardColor.stroke} strokeWidth="2" />
        <line x1="30" y1="14" x2="30" y2="86" stroke={boardColor.stroke} strokeWidth="1.5" opacity="0.6" />
        <ellipse cx="30" cy="16" rx="3" ry="2.5" fill={boardColor.stroke} opacity="0.4" />
        <path d="M30 78 L27 86 L30 83 L33 86 Z" fill={boardColor.stroke} opacity="0.7" />
      </svg>
      
      {/* Avatar Circle */}
      <div className="relative z-10">
        <div className={`w-11 h-11 rounded-full overflow-hidden ${isCaptain ? 'ring-2 ring-yellow-400' : 'ring-2 ring-cyan-400/50'} transition-all group-hover:scale-105`}>
          {member.avatar_url ? (
            <img src={getFullUrl(member.avatar_url)} alt={member.name || member.value} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${isCaptain ? 'bg-gradient-to-br from-yellow-400 to-orange-500' : 'bg-gradient-to-br from-cyan-400 to-blue-500'}`}>
              <span className="text-foreground font-bold text-sm">
                {(member.name || member.value)?.[0]?.toUpperCase() || '?'}
              </span>
            </div>
          )}
        </div>
        
        {/* Captain Crown */}
        {isCaptain && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2">
            <Award className="w-4 h-4 text-yellow-400 drop-shadow-lg" />
          </div>
        )}
        
        {/* Remove button for crew members */}
        {!isCaptain && onRemove && (
          <button
            onClick={() => onRemove(member.id)}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      
      {/* Name Label */}
      <div className="text-center mt-8 max-w-[70px]">
        <p className={`text-[10px] font-medium ${textPrimary} truncate`}>
          {isCaptain ? 'You' : (member.name || member.value?.split('@')[0] || 'Crew')}
        </p>
      </div>
    </div>
  );
};

// Empty Seat Surfboard
const EmptySeat = ({ onClick, isLight }) => {
  return (
    <div className="relative group cursor-pointer flex flex-col items-center" onClick={onClick}>
      <svg 
        viewBox="0 0 60 100" 
        className="absolute left-1/2 -translate-x-1/2 top-2 w-12 h-20 pointer-events-none opacity-40 group-hover:opacity-60 transition-opacity"
      >
        <ellipse cx="30" cy="50" rx="12" ry="38" fill="none" stroke="#64748B" strokeWidth="2" strokeDasharray="6 4" />
        <line x1="30" y1="18" x2="30" y2="82" stroke="#64748B" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
      </svg>
      
      <div className={`relative z-10 w-11 h-11 rounded-full border-2 border-dashed ${isLight ? 'border-cyan-300 bg-cyan-50/50' : 'border-cyan-500/50 bg-cyan-500/10'} flex items-center justify-center transition-all group-hover:scale-105 group-hover:border-cyan-400`}>
        <Plus className={`w-5 h-5 ${isLight ? 'text-cyan-400' : 'text-cyan-500'} group-hover:text-cyan-400`} />
      </div>
      
      <div className="text-center mt-8">
        <p className={`text-[10px] ${isLight ? 'text-muted-foreground' : 'text-gray-500'}`}>Add crew</p>
      </div>
    </div>
  );
};

// On-Demand Request Drawer Component
export const OnDemandRequestDrawer = ({ photographer, isOpen, onClose, onSuccess, userLocation, _userCredits = 0, resumeDispatchId }) => {
  const { user, updateUser } = useAuth();
  const { theme } = useTheme();
  // Flow: 'timing' -> 'duration' -> 'crew' -> 'confirm' -> 'selfie' -> 'waiting' -> 'success'
  const [step, setStep] = useState('timing');
  const [_selectedResolution, _setSelectedResolution] = useState('standard');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [requestId, setRequestId] = useState(null);
  const [acceptedData, setAcceptedData] = useState(null);
  const [showSelfieModal, setShowSelfieModal] = useState(false);
  const [localCredits, setLocalCredits] = useState(0);
  const [creditsFetched, setCreditsFetched] = useState(false);
  
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
          console.error('[OnDemandDrawer] Failed to fetch credits:', e);
          setCreditsFetched(true); // Mark as fetched even on error to prevent infinite loops
        }
      }
    };
    fetchCredits();
  }, [isOpen, user?.id, creditsFetched]);
  
  // Reset state when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setCreditsFetched(false);
    }
  }, [isOpen]);
  
  // ============ START TIME OPTIONS ============
  const [startTimeOption, setStartTimeOption] = useState(30); // 30, 60, or 90 minutes from now
  
  // ============ DURATION STATE (Photographer settings) ============
  const minDuration = photographer?.min_session_hours || 0.5;
  const maxDuration = photographer?.max_session_hours || 7;
  const [requestDuration, setRequestDuration] = useState(minDuration);
  
  // ============ CREW / SPLIT STATE ============
  const [splitEnabled, setSplitEnabled] = useState(false); // Whether user wants to split with crew
  const [crewMembers, setCrewMembers] = useState([]);
  const [newCrewInput, setNewCrewInput] = useState('');
  const [showAddCrewInput, setShowAddCrewInput] = useState(false);
  
  // ============ FRIEND AUTOCOMPLETE STATE ============
  const [friendSearchResults, setFriendSearchResults] = useState([]);
  const [searchingFriends, setSearchingFriends] = useState(false);
  
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
  
  // Debounced friend search for autocomplete
  useEffect(() => {
    if (newCrewInput.length < 2) {
      setFriendSearchResults([]);
      return;
    }
    
    const timeoutId = setTimeout(async () => {
      setSearchingFriends(true);
      try {
        const response = await apiClient.get(`/users/search?query=${encodeURIComponent(newCrewInput)}&limit=5`);
        const existingIds = new Set([user?.id, ...crewMembers.map(m => m.user_id || m.id)]);
        const filtered = (response.data.users || []).filter(u => !existingIds.has(u.id));
        setFriendSearchResults(filtered);
      } catch (error) {
        logger.error('Friend search error:', error);
        setFriendSearchResults([]);
      } finally {
        setSearchingFriends(false);
      }
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [newCrewInput, user?.id, crewMembers]);
  
  const isLight = theme === 'light';
  const textPrimary = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-500' : 'text-muted-foreground';
  const bgCard = isLight ? 'bg-white' : 'bg-card';
  
  // ============ PRICING ============
  const hourlyRate = photographer?.on_demand_hourly_rate || 75;
  const photosIncluded = Math.ceil((photographer?.on_demand_photos_included || 3) * requestDuration);
  const perSurferFee = photographer?.price_per_additional_surfer || 15;
  
  const baseSessionPrice = hourlyRate * requestDuration;
  const crewAdditionalCost = perSurferFee * crewMembers.length;
  const totalPrice = baseSessionPrice + crewAdditionalCost;
  
  const totalParticipants = crewMembers.length + 1;
  const perPersonSplit = (totalPrice / totalParticipants).toFixed(2);
  
  // Calculate crew payment splits (must be before hasEnoughCredits)
  // Crew members who are NOT covered by captain pay their share
  const crewCoversAmount = crewMembers.reduce((sum, m) => sum + (m.covered_by_captain ? 0 : (m.share_amount || parseFloat(perPersonSplit))), 0);
  const captainPayAmount = totalPrice - crewCoversAmount;
  
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
  
  // ============ CREW FUNCTIONS ============
  const handleAddCrewMember = () => {
    if (!newCrewInput.trim()) return;
    const isEmail = newCrewInput.includes('@') && !newCrewInput.startsWith('@');
    const newTotalParticipants = crewMembers.length + 2;
    const equalShare = totalPrice / newTotalParticipants;
    const member = {
      id: Date.now(),
      value: newCrewInput.trim(),
      type: isEmail ? 'email' : 'username',
      status: 'pending',
      share_amount: equalShare,
      share_percentage: 100 / newTotalParticipants,
      covered_by_captain: false
    };
    const updatedCrew = crewMembers.map(m => ({
      ...m,
      share_amount: m.covered_by_captain ? 0 : equalShare,
      share_percentage: 100 / newTotalParticipants
    }));
    setCrewMembers([...updatedCrew, member]);
    setNewCrewInput('');
    setFriendSearchResults([]);
    setShowAddCrewInput(false);
    toast.success(`Added ${member.value} to crew`);
  };
  
  const handleSelectFriend = (friend) => {
    const newTotalParticipants = crewMembers.length + 2;
    const equalShare = totalPrice / newTotalParticipants;
    const member = {
      id: friend.id,
      user_id: friend.id,
      value: friend.username ? `@${friend.username}` : friend.full_name,
      name: friend.full_name,
      username: friend.username,
      avatar_url: friend.avatar_url,
      type: 'user',
      status: 'pending',
      share_amount: equalShare,
      share_percentage: 100 / newTotalParticipants,
      covered_by_captain: false
    };
    const updatedCrew = crewMembers.map(m => ({
      ...m,
      share_amount: m.covered_by_captain ? 0 : equalShare,
      share_percentage: 100 / newTotalParticipants
    }));
    setCrewMembers([...updatedCrew, member]);
    setNewCrewInput('');
    setFriendSearchResults([]);
    setShowAddCrewInput(false);
    toast.success(`Added ${friend.full_name} to crew`);
  };

  const handleRemoveCrewMember = (memberId) => {
    const filtered = crewMembers.filter(m => m.id !== memberId);
    if (filtered.length > 0) {
      const newTotalParticipants = filtered.length + 1;
      const newEqualShare = totalPrice / newTotalParticipants;
      const updatedCrew = filtered.map(m => ({
        ...m,
        share_amount: m.covered_by_captain ? 0 : newEqualShare,
        share_percentage: 100 / newTotalParticipants
      }));
      setCrewMembers(updatedCrew);
    } else {
      setCrewMembers([]);
    }
  };
  
  // ============ CREW PAYMENT SPLIT FUNCTIONS ============
  
  const handleCrewPercentageChange = (memberId, newPercentage) => {
    // Calculate share based on full session price
    const newAmount = (newPercentage / 100) * totalPrice;
    setCrewMembers(prev => prev.map(m => 
      m.id === memberId 
        ? { ...m, share_percentage: newPercentage, share_amount: newAmount }
        : m
    ));
  };
  
  const handleToggleCoverMember = (memberId) => {
    setCrewMembers(prev => prev.map(m => 
      m.id === memberId 
        ? { 
            ...m, 
            covered_by_captain: !m.covered_by_captain,
            share_amount: !m.covered_by_captain ? 0 : parseFloat(perPersonSplit)
          }
        : m
    ));
  };
  
  const handleDistributeEvenly = () => {
    const equalShare = totalPrice / totalParticipants;
    const equalPercentage = 100 / totalParticipants;
    setCrewMembers(prev => prev.map(m => ({
      ...m,
      share_amount: equalShare,
      share_percentage: equalPercentage,
      covered_by_captain: false
    })));
    toast.success('Split evenly among all surfers');
  };
  
  const handleCoverAllCrew = () => {
    setCrewMembers(prev => prev.map(m => ({
      ...m,
      share_amount: 0,
      covered_by_captain: true
    })));
    toast.success("You're covering the whole crew!");
  };
  
  const handleSubmitRequest = async () => {
    setLoading(true);
    try {
      const lat = userLocation?.latitude || photographer?.on_demand_latitude || 28.3667;
      const lng = userLocation?.longitude || photographer?.on_demand_longitude || -80.6067;
      
      // Calculate requested start time based on user's timing selection
      const requestedStartTime = new Date(Date.now() + startTimeOption * 60000).toISOString();
      
      // Step 1: Create dispatch request (always pending payment)
      // Include captain's share amount and crew shares for split bookings
      const crewSharesPayload = crewMembers.length > 0 ? crewMembers.map(m => ({
        user_id: m.user_id || m.id || m.value,
        share_amount: m.covered_by_captain ? 0 : (m.share_amount || parseFloat(perPersonSplit)),
        covered_by_captain: m.covered_by_captain || false
      })) : null;
      
      const response = await apiClient.post(`/dispatch/request?requester_id=${user.id}`, {
        latitude: lat,
        longitude: lng,
        location_name: photographer?.on_demand_city || 'Current Location',
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
        
        toast.success('Payment confirmed! Add a selfie so the photographer can find you.');
        setShowSelfieModal(true);
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
          toast.success(`${data.photographer?.name || 'A photographer'} is on their way! ETA: ~${data.gps?.eta_minutes || estimatedResponse} min`, {
            duration: 5000,
            icon: '🏄'
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
        console.error('Poll error:', error);
      }
    };
    
    if (step === 'waiting' && requestId) {
      pollDispatchStatus();
      pollInterval = setInterval(pollDispatchStatus, 3000);
    }
    
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [step, requestId, photographer, estimatedResponse, onSuccess, onClose]);
  
  // Countdown timer (visual feedback)
  useEffect(() => {
    if (step === 'waiting' && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [step, countdown]);
  
  const isPro = photographer?.role === ROLES.APPROVED_PRO || photographer?.role === ROLES.PRO;
  
  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className={`${bgCard} border-border sm:max-w-lg w-full max-w-full sm:mx-auto mx-0 p-0 overflow-hidden h-[100dvh] sm:h-auto sm:max-h-[90vh] rounded-none sm:rounded-lg`}
        hideCloseButton={step === 'waiting'}
      >
        <DialogTitle className="sr-only">Dialog</DialogTitle>
        <div className="overflow-y-auto h-full sm:max-h-[85vh] pb-24 sm:pb-6 overscroll-contain"
             style={{ WebkitOverflowScrolling: 'touch' }}>
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
                  <img src={getFullUrl(photographer.avatar_url)} alt={photographer.full_name} className="w-full h-full object-cover" />
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
            
            <Button
              onClick={() => setStep('duration')}
              className="w-full py-6 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold text-lg rounded-xl"
            >
              Continue
              <ChevronRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        )}
        
        {/* ============ STEP 1: DURATION SELECTION ============ */}
        {step === 'duration' && (
          <div className="p-4 sm:p-6 space-y-5">
            {/* Header with back button */}
            <div className="flex items-center gap-3 mb-2">
              <button onClick={() => setStep('timing')} className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-muted'}`}>
                <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
              </button>
              <div>
                <h2 className={`text-xl font-bold ${textPrimary}`}>Session Duration</h2>
                <p className={`text-xs ${textSecondary}`}>
                  Starting in {startTimeOption} min • {photographer?.full_name}
                </p>
              </div>
            </div>
            
            {/* Photographer Card */}
            <div className={`flex items-center gap-4 p-4 rounded-2xl ${isLight ? 'bg-gray-50' : 'bg-muted/50'}`}>
              <div className={`w-14 h-14 rounded-full overflow-hidden ${isPro ? 'ring-2 ring-amber-400' : 'ring-2 ring-cyan-400/50'}`}>
                {photographer?.avatar_url ? (
                  <img src={getFullUrl(photographer.avatar_url)} alt={photographer.full_name} className="w-full h-full object-cover" />
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
                <input
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
            
            <Button
              onClick={() => setStep('split_choice')}
              className="w-full py-6 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold text-lg rounded-xl"
            >
              Continue - ${totalPrice.toFixed(2)}
              <ChevronRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        )}

        {/* ============ STEP 1.5: SPLIT CHOICE ============ */}
        {step === 'split_choice' && (
          <div className="p-4 sm:p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center gap-3">
              <button onClick={() => setStep('duration')} className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-muted'}`}>
                <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
              </button>
              <div>
                <h2 className={`text-xl font-bold ${textPrimary}`}>Just you, or bringing crew?</h2>
                <p className={`text-xs ${textSecondary}`}>{formatDuration(requestDuration)} session • {photographer?.full_name}</p>
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
                }`}>🏄</div>
                <div className="flex-1">
                  <p className={`font-bold text-base ${textPrimary}`}>Just Me</p>
                  <p className={`text-sm ${textSecondary}`}>Solo session — I'll pay the full rate</p>
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
                }`}>🤙</div>
                <div className="flex-1">
                  <p className={`font-bold text-base ${textPrimary}`}>Split with Crew</p>
                  <p className={`text-sm ${textSecondary}`}>Share the session cost with friends</p>
                  <p className="text-cyan-400 font-bold mt-1">
                    {crewMembers.length > 0 ? `$${perPersonSplit}/person` : 'Add crew → split the cost'}
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

            <Button
              onClick={() => {
                if (splitEnabled) setStep('crew');
                else setStep('confirm');
              }}
              className="w-full py-6 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold text-lg rounded-xl"
            >
              {splitEnabled ? 'Add My Crew' : 'Continue to Payment'}
              <ChevronRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        )}
        
        {/* ============ STEP 2: CREW SELECTION ============ */}
        {step === 'crew' && (
          <div className="p-4 sm:p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <button onClick={() => setStep('split_choice')} className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-muted'}`}>
                <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
              </button>
              <h2 className={`text-xl font-bold ${textPrimary}`}>Your Crew</h2>
            </div>
            
            {/* Ocean Background with Surfboards */}
            <div className={`relative p-4 sm:p-6 rounded-2xl overflow-visible ${isLight ? 'bg-gradient-to-b from-cyan-100 via-blue-50 to-white' : 'bg-gradient-to-b from-cyan-900/30 via-blue-900/20 to-zinc-900'}`}>
              {/* Wave pattern background */}
              <div className="absolute inset-0 opacity-20 overflow-hidden rounded-2xl">
                <svg viewBox="0 0 400 200" className="w-full h-full" preserveAspectRatio="none">
                  <path d="M0,100 Q50,80 100,100 T200,100 T300,100 T400,100 V200 H0 Z" fill="currentColor" className="text-cyan-500" opacity="0.3" />
                  <path d="M0,120 Q50,100 100,120 T200,120 T300,120 T400,120 V200 H0 Z" fill="currentColor" className="text-blue-500" opacity="0.2" />
                </svg>
              </div>
              
              {/* "PEAK" Label */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-cyan-400 font-medium flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                THE LINEUP
              </div>
              
              {/* Crew Members in Arc Layout */}
              <div className="relative pt-6">
                {/* Captain at center top */}
                <div className="flex justify-center mb-2">
                  <SurfboardAvatar 
                    member={{ 
                      name: user?.full_name || 'You', 
                      avatar_url: user?.avatar_url 
                    }} 
                    index={0} 
                    isCaptain={true}
                    isLight={isLight}
                  />
                </div>
                
                {/* Crew Members in row */}
                <div className="flex justify-center items-end gap-4 flex-wrap">
                  {crewMembers.map((member, idx) => (
                    <SurfboardAvatar 
                      key={member.id}
                      member={member} 
                      index={idx + 1} 
                      isCaptain={false}
                      onRemove={handleRemoveCrewMember}
                      isLight={isLight}
                    />
                  ))}
                  
                  {/* Empty Seats */}
                  {crewMembers.length < 6 && (
                    <EmptySeat onClick={() => setShowAddCrewInput(true)} isLight={isLight} />
                  )}
                </div>
              </div>
              
              {/* Add Crew Input with Autocomplete */}
              {showAddCrewInput && (
                <div className="mt-4 relative" style={{ zIndex: 50 }}>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Input
                        value={newCrewInput}
                        onChange={(e) => setNewCrewInput(e.target.value)}
                        placeholder="Search by name or @username"
                        className={`w-full ${isLight ? 'bg-white' : 'bg-card/80'}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && friendSearchResults.length === 0) {
                            handleAddCrewMember();
                          }
                        }}
                        autoFocus
                        data-testid="crew-search-input"
                      />
                      {/* Autocomplete Dropdown */}
                      {(friendSearchResults.length > 0 || searchingFriends) && (
                        <div 
                          className={`absolute top-full left-0 right-0 mt-1 rounded-xl shadow-2xl border ${isLight ? 'bg-white border-gray-200' : 'bg-zinc-800 border-zinc-600'}`}
                          style={{ zIndex: 9999 }}
                          data-testid="crew-autocomplete-dropdown"
                        >
                          {searchingFriends && (
                            <div className="p-3 flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Searching...
                            </div>
                          )}
                          {friendSearchResults.map((friend) => (
                            <button
                              key={friend.id}
                              onClick={() => handleSelectFriend(friend)}
                              className={`w-full p-3 flex items-center gap-3 text-left transition-colors ${isLight ? 'hover:bg-gray-50' : 'hover:bg-zinc-700'}`}
                              data-testid={`crew-friend-option-${friend.id}`}
                            >
                              <div className="w-9 h-9 rounded-full overflow-hidden bg-muted flex-shrink-0">
                                {friend.avatar_url ? (
                                  <img src={getFullUrl(friend.avatar_url)} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-xs font-bold text-muted-foreground">
                                    {friend.full_name?.[0]?.toUpperCase() || '?'}
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate ${textPrimary}`}>{friend.full_name}</p>
                                {friend.username && (
                                  <p className={`text-xs truncate ${textSecondary}`}>@{friend.username}</p>
                                )}
                              </div>
                              <Plus className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                            </button>
                          ))}
                          {!searchingFriends && friendSearchResults.length === 0 && newCrewInput.length >= 2 && (
                            <div className="p-3 text-sm text-muted-foreground">
                              No users found. Press Enter to add manually.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <Button 
                      onClick={handleAddCrewMember} 
                      size="sm" 
                      className="bg-cyan-500 hover:bg-cyan-600 flex-shrink-0"
                      disabled={!newCrewInput.trim()}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                    <Button 
                      onClick={() => {
                        setShowAddCrewInput(false);
                        setNewCrewInput('');
                        setFriendSearchResults([]);
                      }} 
                      size="sm" 
                      variant="outline"
                      className="flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
            
            {/* Crew Count & Price Summary */}
            <div className={`p-4 rounded-xl ${isLight ? 'bg-gradient-to-r from-purple-50 to-cyan-50' : 'bg-gradient-to-r from-purple-500/10 to-cyan-500/10'} border border-purple-400/30`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-yellow-400" />
                  <span className={`font-medium ${textPrimary}`}>Captain's Split</span>
                </div>
                <Badge className="bg-purple-500 text-foreground">{totalParticipants} surfer{totalParticipants > 1 ? 's' : ''}</Badge>
              </div>
              
              {/* Quality Tier Badge - On-Demand is always Standard */}
              <div className="mb-3">
                <QualityTierBadge serviceType="on_demand" className="w-full justify-center" />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className={textSecondary}>Session ({formatDuration(requestDuration)})</span>
                  <span className={textPrimary}>${baseSessionPrice.toFixed(2)}</span>
                </div>
                {crewMembers.length > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className={textSecondary}>+{crewMembers.length} crew @ ${perSurferFee}/ea</span>
                    <span className={textPrimary}>+${crewAdditionalCost.toFixed(2)}</span>
                  </div>
                )}
                <div className={`flex justify-between pt-2 border-t ${isLight ? 'border-purple-200' : 'border-purple-500/30'}`}>
                  <span className={`font-bold ${textPrimary}`}>Session Total</span>
                  <span className="font-bold text-amber-400">${totalPrice.toFixed(2)}</span>
                </div>
                {crewMembers.length > 0 && (
                  <div className="flex justify-between text-green-400 font-medium">
                    <span>Even split</span>
                    <span>${perPersonSplit}/person</span>
                  </div>
                )}
              </div>
            </div>
            
            <Button
              onClick={() => crewMembers.length > 0 ? setStep('crew_payment') : setStep('confirm')}
              className="w-full py-6 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold text-lg rounded-xl"
            >
              {crewMembers.length > 0 ? (
                <>
                  <Calculator className="w-5 h-5 mr-2" />
                  Set Payment Splits
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5 mr-2" />
                  Continue to Payment
                </>
              )}
            </Button>
          </div>
        )}
        
        {/* ============ STEP 2.5: CREW PAYMENT SPLITS ============ */}
        {step === 'crew_payment' && crewMembers.length > 0 && (
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <button onClick={() => setStep('crew')} className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-muted'}`}>
                <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
              </button>
              <div>
                <h2 className={`text-xl font-bold ${textPrimary} flex items-center gap-2`}>
                  <Award className="w-5 h-5 text-yellow-400" />
                  Captain's Hub
                </h2>
                <p className={`text-xs ${textSecondary}`}>Control how the crew splits the cost</p>
              </div>
            </div>
            
            {/* Real-Time Balance Summary */}
            <div className={`p-4 rounded-xl ${isLight ? 'bg-gradient-to-br from-cyan-50 to-blue-50' : 'bg-gradient-to-br from-cyan-500/10 to-blue-500/10'} border border-cyan-400/30`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`font-bold ${textPrimary}`}>Session Total</span>
                <span className="text-2xl font-bold text-cyan-400">${totalPrice.toFixed(2)}</span>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className={textSecondary}>Your Share (Captain)</span>
                  <span className="font-medium text-yellow-400">${captainPayAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className={textSecondary}>Crew Covers</span>
                  <span className={textPrimary}>${crewCoversAmount.toFixed(2)}</span>
                </div>
              </div>
            </div>
            
            {/* Quick Actions */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleDistributeEvenly}
                className={`flex-1 ${isLight ? 'border-gray-300' : 'border-zinc-600'}`}
              >
                <Calculator className="w-4 h-4 mr-1" />
                Even Split
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCoverAllCrew}
                className={`flex-1 ${isLight ? 'border-purple-300 text-purple-600' : 'border-purple-500/50 text-purple-400'}`}
              >
                <Wallet className="w-4 h-4 mr-1" />
                I'll Cover All
              </Button>
            </div>
            
            {/* Crew Member Payment Controls */}
            <div className="space-y-3">
              <h4 className={`text-sm font-medium ${textSecondary}`}>Crew Payment Controls</h4>
              
              {crewMembers.map((member, idx) => {
                const memberShare = member.share_amount || parseFloat(perPersonSplit);
                const memberPercentage = member.share_percentage || (100 / totalParticipants);
                const isCovered = member.covered_by_captain || false;
                
                return (
                  <div 
                    key={member.id}
                    className={`p-4 rounded-xl ${isLight ? 'bg-gray-50 border border-gray-100' : 'bg-muted/50 border border-zinc-700/50'}`}
                  >
                    {/* Member Header with Surfboard Color */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-foreground"
                          style={{ backgroundColor: SURFBOARD_COLORS[(idx + 1) % SURFBOARD_COLORS.length].fill }}
                        >
                          {(member.name || member.value)?.[0]?.toUpperCase() || 'C'}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${textPrimary}`}>
                            {member.name || member.value?.split('@')[0] || `Crew ${idx + 1}`}
                          </p>
                          <p className={`text-xs ${textSecondary}`}>
                            {member.type === 'email' ? 'Email invite' : 'Username invite'}
                          </p>
                        </div>
                      </div>
                      
                      {isCovered ? (
                        <Badge className="bg-purple-500/20 text-purple-400">
                          <Wallet className="w-3 h-3 mr-1" />
                          You Cover
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-500/20 text-amber-400">
                          ${memberShare.toFixed(2)}
                        </Badge>
                      )}
                    </div>

                    {/* Payment Controls */}
                    <div className="space-y-3">
                      {/* Percentage Slider */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs ${textSecondary}`}>
                            Share: {memberPercentage.toFixed(0)}%
                          </span>
                          <span className={`text-sm font-bold ${isCovered ? 'line-through text-gray-500' : textPrimary}`}>
                            ${memberShare.toFixed(2)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={memberPercentage}
                          onChange={(e) => handleCrewPercentageChange(member.id, parseFloat(e.target.value))}
                          disabled={isCovered}
                          className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-400 disabled:opacity-50"
                          style={{
                            background: isCovered ? '#3f3f46' : `linear-gradient(to right, ${SURFBOARD_COLORS[(idx + 1) % SURFBOARD_COLORS.length].fill} 0%, ${SURFBOARD_COLORS[(idx + 1) % SURFBOARD_COLORS.length].fill} ${memberPercentage}%, #3f3f46 ${memberPercentage}%, #3f3f46 100%)`
                          }}
                        />
                      </div>

                      {/* "I'll Cover This Member" Toggle */}
                      <div className={`flex items-center justify-between p-2 rounded-lg ${isCovered ? (isLight ? 'bg-purple-100' : 'bg-purple-500/20') : (isLight ? 'bg-gray-100' : 'bg-card')}`}>
                        <div className="flex items-center gap-2">
                          <Wallet className={`w-4 h-4 ${isCovered ? 'text-purple-400' : textSecondary}`} />
                          <span className={`text-sm ${isCovered ? 'text-purple-400' : textSecondary}`}>
                            I'll cover this surfer
                          </span>
                        </div>
                        <button
                          onClick={() => handleToggleCoverMember(member.id)}
                          className={`w-10 h-5 rounded-full transition-colors ${isCovered ? 'bg-purple-500' : 'bg-zinc-600'}`}
                        >
                          <div className={`w-4 h-4 rounded-full bg-white transform transition-transform ${isCovered ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* Final Summary */}
            <div className={`p-4 rounded-xl ${isLight ? 'bg-yellow-50' : 'bg-yellow-500/10'} border border-yellow-400/30`}>
              <div className="flex justify-between items-center">
                <div>
                  <p className={`text-sm ${textSecondary}`}>You'll pay now</p>
                  <p className="text-2xl font-bold text-yellow-400">${captainPayAmount.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className={`text-xs ${textSecondary}`}>Crew will be notified</p>
                  <p className={`text-sm ${textPrimary}`}>{crewMembers.filter(m => !m.covered_by_captain).length} payment requests</p>
                </div>
              </div>
            </div>
            
            {/* Payment Method Selection - Also in crew_payment step */}
            <div className="space-y-3">
              <p className={`text-sm font-medium ${textPrimary}`}>Payment Method</p>
              
              {localCredits > 0 && (
                <button
                  onClick={() => setPaymentMethod('credits')}
                  className={`w-full p-4 rounded-xl border-2 flex items-center gap-4 transition-all ${
                    paymentMethod === 'credits' 
                      ? 'border-amber-400 bg-amber-500/10' 
                      : `border-border ${isLight ? 'hover:bg-gray-50' : 'hover:bg-muted/50'}`
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <Wallet className="w-5 h-5 text-amber-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className={`font-medium ${textPrimary}`}>Surf Credits</p>
                    <p className={`text-xs ${textSecondary}`}>Balance: ${localCredits.toFixed(2)}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentMethod === 'credits' ? 'border-amber-400 bg-amber-400' : 'border-zinc-500'}`}>
                    {paymentMethod === 'credits' && <Check className="w-3 h-3 text-black" />}
                  </div>
                </button>
              )}
              
              <button
                onClick={() => setPaymentMethod('card')}
                className={`w-full p-4 rounded-xl border-2 flex items-center gap-4 transition-all ${
                  paymentMethod === 'card' 
                    ? 'border-cyan-400 bg-cyan-500/10' 
                    : `border-border ${isLight ? 'hover:bg-gray-50' : 'hover:bg-muted/50'}`
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-5 h-5 text-cyan-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className={`font-medium ${textPrimary}`}>Credit/Debit Card</p>
                  <p className={`text-xs ${textSecondary}`}>Pay with Stripe</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentMethod === 'card' ? 'border-cyan-400 bg-cyan-400' : 'border-zinc-500'}`}>
                  {paymentMethod === 'card' && <Check className="w-3 h-3 text-black" />}
                </div>
              </button>
            </div>
            
            <Button
              onClick={() => setStep('confirm')}
              className="w-full py-6 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold text-lg rounded-xl"
            >
              <Zap className="w-5 h-5 mr-2" />
              Confirm Splits & Pay ${captainPayAmount.toFixed(2)}
            </Button>
          </div>
        )}
        
        {/* ============ STEP 3: CONFIRM & PAY ============ */}
        {step === 'confirm' && (
          <div className="p-4 sm:p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <button onClick={() => setStep(crewMembers.length > 0 ? 'crew_payment' : splitEnabled ? 'crew' : 'split_choice')} className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-muted'}`}>
                <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
              </button>
              <h2 className={`text-xl font-bold ${textPrimary}`}>Confirm Request</h2>
            </div>
            
            {/* Summary Card */}
            <div className={`p-5 rounded-2xl ${isLight ? 'bg-gray-50' : 'bg-muted/50'}`}>
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-amber-400">
                  {photographer?.avatar_url ? (
                    <img src={getFullUrl(photographer.avatar_url)} alt="" className="w-full h-full object-cover" />
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
                  <p className="text-amber-400 font-bold">${totalPrice.toFixed(2)}</p>
                  {crewMembers.length > 0 && (
                    <p className="text-xs text-green-400">You: ${captainPayAmount.toFixed(2)}</p>
                  )}
                </div>
              </div>
              
              {/* Quick Details */}
              <div className={`grid grid-cols-3 gap-3 pt-4 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
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
            
            <Button
              onClick={handleSubmitRequest}
              disabled={loading || (paymentMethod === 'credits' && !hasEnoughCredits)}
              className="w-full py-6 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold text-lg rounded-xl disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Zap className="w-5 h-5 mr-2" />
                  {crewMembers.length > 0 
                    ? `Pay $${captainPayAmount.toFixed(2)} & Send Request`
                    : 'Send Request'
                  }
                </>
              )}
            </Button>
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
              <h3 className={`text-xl font-bold ${textPrimary}`}>Finding Your Photographer</h3>
              <p className={`${textSecondary} mt-2`}>
                Waiting for {photographer?.full_name} to accept...
              </p>
              <p className={`text-xs ${textSecondary} mt-1 animate-pulse`}>
                Checking for response every 3 seconds
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
                              <img 
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
                              <img src={getFullUrl(member.avatar_url)} 
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
                    📱 Your crew has been notified to complete payment. The photographer will see your request once all payments are confirmed.
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
                  <p className={`text-xs ${textSecondary}`}>${captainPayAmount.toFixed(2)} deposit secured</p>
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
            
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await apiClient.post(`/dispatch/${requestId}/cancel?user_id=${user.id}`, { reason: 'User cancelled' });
                  toast.info('Request cancelled');
                } catch (e) {
                  toast.error('Failed to cancel request');
                }
                onClose();
              }}
              className={`w-full ${isLight ? 'border-gray-300' : 'border-zinc-600'}`}
            >
              Cancel Request
            </Button>
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
                    <img src={getFullUrl(acceptedData?.photographer_avatar || photographer?.avatar_url)} alt="" className="w-full h-full object-cover" />
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
                onSuccess?.({ 
                  request_id: requestId,
                  photographer_id: acceptedData?.photographer_id,
                  photographer_name: acceptedData?.photographer_name
                });
                onClose();
              }}
              className="w-full py-5 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-foreground font-bold rounded-xl"
            >
              Got it, Let's Surf!
            </Button>
          </div>
        )}
        </div>
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
