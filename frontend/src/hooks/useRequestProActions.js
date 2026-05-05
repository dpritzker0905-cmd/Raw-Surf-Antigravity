/**
 * useRequestProActions.js
 * Extracted from map/RequestProModal.js — crew management + submit handler.
 * v33: Rewritten from actual RequestProModal.js implementations.
 * 
 * Strategy: useCallback wrappers converted to plain functions.
 * The parent passes current state values; the hook returns stable handlers.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

const useRequestProActions = ({
  // Auth
  userId,
  user,
  authUser,
  updateUser,
  navigate,
  // State (read)
  crewMembers,
  newCrewInput,
  totalCost,
  totalParticipants,
  perPersonSplit,
  captainPayAmount,
  amountToCharge,
  selectedPro,
  userLocation,
  nearestSpot,
  duration,
  startTimeOption,
  boostHours,
  paymentMethod,
  // Callbacks
  onClose,
  onSuccess,
  onBoostApplied,
  // Setters
  setCrewMembers,
  setNewCrewInput,
  setFriendSearchResults,
  setShowAddCrewInput,
  setLoading,
}) => {

  // -- Crew helpers ---------------------------------------------------------
  const addCrewMember = (friend) => {
    const newTotal = crewMembers.length + 2;
    const share = totalCost / newTotal;
    const updated = crewMembers.map(m => ({
      ...m,
      share_amount: m.covered_by_captain ? 0 : share,
      share_percentage: 100 / newTotal,
    }));
    setCrewMembers([...updated, {
      id: friend?.id || Date.now(),
      user_id: friend?.id || null,
      value: friend ? (friend.username ? `@${friend.username}` : friend.full_name) : newCrewInput.trim(),
      name: friend?.full_name || newCrewInput.trim(),
      username: friend?.username || null,
      avatar_url: friend?.avatar_url || null,
      type: friend ? 'user' : (newCrewInput.includes('@') && !newCrewInput.startsWith('@') ? 'email' : 'username'),
      status: 'pending',
      share_amount: share,
      share_percentage: 100 / newTotal,
      covered_by_captain: false,
    }]);
    setNewCrewInput('');
    setFriendSearchResults([]);
    setShowAddCrewInput(false);
    toast.success(`Added ${friend?.full_name || newCrewInput.trim()} to crew`);
  };

  const removeCrewMember = (memberId) => {
    const filtered = crewMembers.filter(m => m.id !== memberId);
    if (filtered.length > 0) {
      const newTotal = filtered.length + 1;
      const share = totalCost / newTotal;
      setCrewMembers(filtered.map(m => ({
        ...m,
        share_amount: m.covered_by_captain ? 0 : share,
        share_percentage: 100 / newTotal,
      })));
    } else {
      setCrewMembers([]);
    }
  };

  const handlePercentageChange = (memberId, pct) => {
    const amount = (pct / 100) * totalCost;
    setCrewMembers(prev => prev.map(m =>
      m.id === memberId ? { ...m, share_percentage: pct, share_amount: amount } : m
    ));
  };

  const toggleCoverMember = (memberId) => {
    setCrewMembers(prev => prev.map(m =>
      m.id === memberId
        ? { ...m, covered_by_captain: !m.covered_by_captain, share_amount: !m.covered_by_captain ? 0 : parseFloat(perPersonSplit) }
        : m
    ));
  };

  const distributeEvenly = () => {
    const share = totalCost / totalParticipants;
    const pct = 100 / totalParticipants;
    setCrewMembers(prev => prev.map(m => ({
      ...m, share_amount: share, share_percentage: pct, covered_by_captain: false,
    })));
    toast.success('Split evenly among all surfers');
  };

  const coverAll = () => {
    setCrewMembers(prev => prev.map(m => ({ ...m, share_amount: 0, covered_by_captain: true })));
    toast.success("You're covering the whole crew!");
  };

  // -- Submit ---------------------------------------------------------------
  const handleSubmit = async () => {
    if (!userLocation) { toast.error('Location required to request a Pro'); return; }
    setLoading(true);
    try {
      const uid = userId || user?.id || authUser?.id;
      const requestedStartTime = new Date(Date.now() + startTimeOption * 60000).toISOString();

      const crewSharesPayload = crewMembers.length > 0
        ? crewMembers.map(m => ({
            user_id: m.user_id || m.id || m.value,
            share_amount: m.covered_by_captain ? 0 : (m.share_amount || parseFloat(perPersonSplit)),
            covered_by_captain: m.covered_by_captain || false,
          }))
        : null;

      // Step 1: Create dispatch request
      const response = await apiClient.post(
        `/dispatch/request?requester_id=${uid}`,
        {
          latitude:                 userLocation.lat,
          longitude:                userLocation.lng,
          location_name:            nearestSpot?.name || 'Current Location',
          spot_id:                  nearestSpot?.id || null,
          estimated_duration_hours: duration,
          is_immediate:             true,
          requested_start_time:     requestedStartTime,
          arrival_window_minutes:   startTimeOption,
          is_shared:                crewMembers.length > 0,
          target_photographer_id:   selectedPro?.id || null,
          friend_ids:               crewMembers.length > 0 ? crewMembers.map(m => m.user_id || m.id || m.value) : null,
          captain_share_amount:     crewMembers.length > 0 ? captainPayAmount : null,
          crew_shares:              crewSharesPayload,
        }
      );

      const dispatchId = response.data.id;

      // Step 2: Process payment based on selected method
      if (paymentMethod === 'credits') {
        // Pay with credits - immediate confirmation
        const payResponse = await apiClient.post(`/dispatch/${dispatchId}/pay?payer_id=${uid}`);

        if (payResponse.data.remaining_credits !== undefined) {
          updateUser({ credit_balance: payResponse.data.remaining_credits });
        }

        // Apply boost if selected
        if (boostHours > 0) {
          try {
            await apiClient.post(`/dispatch/request/${dispatchId}/boost`, { boost_hours: boostHours });
            toast.success(`Boosted! You'll appear first for ${boostHours}h`);
            onBoostApplied?.();
          } catch (e) {
            toast.error(e.response?.data?.detail || 'Failed to boost');
          }
        }

        toast.success('Payment confirmed! Setting up your session...');
        onClose();
        // Navigate to full lobby page - has chat, waiting UI, selfie prompt
        navigate(`/dispatch/${dispatchId}/lobby`, {
          state: {
            crewMembers,
            photographer: selectedPro,
            captainPayAmount,
            needsSelfie: true,
          }
        });
      } else {
        // Pay with card - redirect to Stripe Checkout
        const checkoutResponse = await apiClient.post('/dispatch/checkout', {
          dispatch_id: dispatchId,
          payer_id:    uid,
          amount:      amountToCharge,
          origin_url:  window.location.origin,
        });

        if (checkoutResponse.data?.checkout_url) {
          toast.info('Redirecting to secure payment...');
          window.location.href = checkoutResponse.data.checkout_url;
        } else {
          throw new Error('Failed to create checkout session');
        }
      }

      onSuccess?.(dispatchId);

    } catch (error) {
      const errorDetail = error?.response?.data?.detail;
      if (typeof errorDetail === 'object' && errorDetail.refunded) {
        toast.info(`Request failed but $${errorDetail.refund_amount?.toFixed(2) || '0.00'} credits refunded.`);
        if (errorDetail.new_balance !== undefined) {
          updateUser({ credit_balance: errorDetail.new_balance });
        }
      } else {
        const message = typeof errorDetail === 'string' ? errorDetail : 'Failed to create request';
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return {
    addCrewMember,
    removeCrewMember,
    handlePercentageChange,
    toggleCoverMember,
    distributeEvenly,
    coverAll,
    handleSubmit,
  };
};

export default useRequestProActions;
