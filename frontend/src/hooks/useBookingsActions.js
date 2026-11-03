/**
 * useBookingsActions.js
 * Extracted from Bookings.js -- handler logic for the Bookings page.
 * 
 * Extraction checklist (v30):
 * G Step 1: JSX scan -- zero JSX in extraction range
 * G Step 2: Closure param audit -- all state/setters listed
 * G Step 3: Phantom param check -- every param used in handler body
 * G Step 4: React hooks scan -- committed ownership guards the balance read
 * G Step 5: Utility/import scan -- apiClient, toast, logger
 * G Step 6: Hook placement -- called AFTER all useState declarations
 * G Step 7: Cross-module export -- SURFER_ROLES is local const, not needed
 */
import { useLayoutEffect, useRef } from 'react';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import useBookingsLiveSessionsList from './useBookingsLiveSessionsList';

const useBookingsActions = ({
  user,
  updateUser,
  navigate,
  canJoinSessions,
  effectiveRole,
  selectedSkillFilter,
  setLoading,
  setBookings,
  setLiveSessions,
  setSessionHistory,
  setLivePhotographers,
  setPendingInvites,
  setCrewInvites,
  setNearbyBookings,
  setActiveDispatch,
  setUserCreditBalance,
  setSelectedSkillFilter,
  setActiveTab,
  setSelectedPhotographer,
  setShowJumpInDrawer,
  setShowJoinCodeModal,
  setJoinCode,
  setSelectedCrewInvite,
  setShowCrewPaymentModal,
  setOnDemandPhotographers,
  setOnDemandLoading,
  setUserLocation,
  setGpsUnavailable,
  setSelectedOnDemandPro,
  setShowOnDemandDrawer,
  setSelectedBooking,
  setShowInviteModal,
}) => {
  const balanceOwner = useRef(null);
  const inviteOwner = useRef(null);
  const userId = user?.id;
  const session = user?.access_token;
  const liveSessionsList = useBookingsLiveSessionsList({ user, setLiveSessions });

  useLayoutEffect(() => {
    const owner = { userId, session, request: 0, mutation: false, uncertain: new Set() };
    inviteOwner.current = owner;
    setPendingInvites([]);
    return () => {
      if (inviteOwner.current === owner) inviteOwner.current = null;
    };
    // Setter changes below do not restart the same committed session.
  }, [userId, session]);

  useLayoutEffect(() => {
    if (inviteOwner.current) inviteOwner.current.setInvites = setPendingInvites;
  });

  useLayoutEffect(() => {
    const owner = { userId, session, request: 0 };
    balanceOwner.current = owner;
    // Clear the previous session's local value; this is not a confirmed profile balance.
    setUserCreditBalance(0);
    return () => {
      if (balanceOwner.current === owner) balanceOwner.current = null;
    };
    // Callback updates below must not restart ownership for the same session.
  }, [userId, session]);

  useLayoutEffect(() => {
    if (balanceOwner.current) {
      balanceOwner.current.setBalance = setUserCreditBalance;
      balanceOwner.current.updateUser = updateUser;
    }
  });

  // Helper: sort photographers by priority
  const sortPhotographers = (photographers) => {
    return (photographers || []).sort((a, b) => {
      const priorityOrder = { 'Approved Pro': 0, 'Pro': 1, 'Photographer': 2, 'Hobbyist': 3 };
      return (priorityOrder[a.role] ?? 99) - (priorityOrder[b.role] ?? 99);
    });
  };

  const fetchData = async () => {
    const owner = balanceOwner.current;
    const ownsBalance = owner && owner.userId && owner.userId === userId && owner.session === session;
    const balanceRequest = ownsBalance ? ++owner.request : null;
    const invitesOwner = inviteOwner.current;
    const ownsInvites = invitesOwner && invitesOwner.userId
      && invitesOwner.userId === userId && invitesOwner.session === session;
    const invitesRequest = ownsInvites ? ++invitesOwner.request : null;
    setLoading(true);
    try {
      const [creditsRes, bookingsRes, , liveRes, invitesRes, crewRes, activeRes, historyRes] = await Promise.allSettled([
        ownsBalance ? apiClient.get(`/credits/balance/${userId}`) : Promise.resolve(null),
        apiClient.get(`/bookings/user/${user.id}`),
        // Start in the existing order; this list settles independently of the other seven reads.
        (() => { void liveSessionsList.refresh(); return null; })(),
        apiClient.get(`/photographers/live`),
        ownsInvites ? apiClient.get(`/bookings/invites/${userId}`) : Promise.resolve(null),
        apiClient.get(`/dispatch/user/${user.id}/crew-invites`),
        apiClient.get(`/dispatch/user/${user.id}/active`),
        apiClient.get(`/sessions/user/${user.id}/history`),
      ]);

      const creditData = creditsRes.status === 'fulfilled' ? creditsRes.value?.data : null;
      if (ownsBalance && balanceOwner.current === owner && balanceRequest === owner.request
          && creditData?.user_id === userId && Number.isFinite(creditData.balance)) {
        owner.setBalance(creditData.balance);
        owner.updateUser({ credit_balance: creditData.balance });
      }
      setBookings(bookingsRes.status === 'fulfilled' ? (bookingsRes.value.data || []) : []);
      setLivePhotographers(liveRes.status === 'fulfilled' ? (liveRes.value.data || []) : []);
      if (ownsInvites && inviteOwner.current === invitesOwner && invitesRequest === invitesOwner.request) {
        const data = invitesRes.status === 'fulfilled' ? invitesRes.value?.data : null;
        const nullableFields = ['inviter_name', 'inviter_avatar', 'location', 'session_date',
          'photographer_name', 'message', 'created_at'];
        const valid = Array.isArray(data) && data.every(invite => invite && typeof invite === 'object'
          && typeof invite.id === 'string' && invite.id.length > 0
          && typeof invite.booking_id === 'string' && invite.booking_id.length > 0
          && nullableFields.every(field => invite[field] === null || typeof invite[field] === 'string'));
        invitesOwner.setInvites(valid ? data : []);
      }
      setCrewInvites(crewRes.status === 'fulfilled' ? (crewRes.value.data?.crew_invites || []) : []);

      if (activeRes.status === 'fulfilled') {
        const dispatch = activeRes.value.data?.active_dispatch;
        if (dispatch && ['requester', 'crew_member', 'photographer'].includes(dispatch.role)) {
          setActiveDispatch(dispatch);
        } else {
          setActiveDispatch(null);
        }
      } else {
        setActiveDispatch(null);
      }

      setSessionHistory(historyRes.status === 'fulfilled' ? (historyRes.value.data || []) : []);
      
      try {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(async (position) => {
            const { latitude, longitude } = position.coords;
            const params = new URLSearchParams({ latitude, longitude, radius: 10 });
            if (selectedSkillFilter) {
              params.append('skill_level', selectedSkillFilter);
            }
            const nearbyRes = await apiClient.get(`/bookings/nearby?${params}`);
            setNearbyBookings(nearbyRes.data || []);
          }, () => {
            setNearbyBookings([]);
          });
        }
      } catch (e) {
        setNearbyBookings([]);
      }
    } catch (error) {
      logger.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleJumpIn = async (photographer) => {
    if (!user) {
      toast.error('Please log in to join sessions');
      return;
    }
    if (!canJoinSessions) {
      toast.error(`Your current role (${effectiveRole}) cannot join sessions. Switch to a surfer role.`);
      return;
    }
    setSelectedPhotographer({
      ...photographer,
      current_spot_name: photographer.location || photographer.spot_name || 'Live Session'
    });
    setShowJumpInDrawer(true);
  };

  const handleJoinByCode = async (joinCode) => {
    if (!joinCode.trim()) {
      toast.error('Please enter an invite code');
      return;
    }
    try {
      await apiClient.post(`/bookings/join-by-code?invite_code=${joinCode.toUpperCase()}`);
      toast.success('Successfully joined the booking!');
      setShowJoinCodeModal(false);
      setJoinCode('');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Invalid invite code');
    }
  };

  const handleRespondToInvite = async (inviteId, accept, options = {}) => {
    const owner = inviteOwner.current;
    const isCurrent = () => owner && inviteOwner.current === owner
      && owner.userId === userId && owner.session === session;
    if (!isCurrent() || !userId) return { status: 'stale' };
    if (options.quoteOnly) {
      if (owner.uncertain.has(inviteId)) {
        return { status: 'uncertain', message: 'Check your bookings before trying again.' };
      }
      try {
        const response = await apiClient.get(`/bookings/invites/${inviteId}/accept-quote`);
        return isCurrent() ? { status: 'quoted', quote: response.data } : { status: 'stale' };
      } catch (error) {
        return isCurrent() ? { status: 'error', message: error.response?.data?.detail || 'Could not load invite price' }
          : { status: 'stale' };
      }
    }
    if (owner.mutation || owner.uncertain.has(inviteId)) {
      return { status: 'uncertain', message: 'Check your bookings before trying again.' };
    }
    if (accept && !/^[a-f0-9]{64}$/.test(options.consentQuote || '')) {
      return { status: 'error', message: 'Review the current invite price before accepting.' };
    }
    owner.mutation = true;
    try {
      const consent = accept ? `&consent_quote=${options.consentQuote}` : '';
      const response = await apiClient.post(`/bookings/invites/${inviteId}/respond?accept=${accept}${consent}`);
      if (!isCurrent()) return { status: 'stale' };
      const paid = response.data?.amount_paid_credits;
      if (accept && (response.data?.status !== 'accepted' || typeof paid !== 'string'
          || !/^(0|[1-9]\d*)\.\d{2}$/.test(paid))) {
        owner.uncertain.add(inviteId);
        return { status: 'uncertain', message: 'Payment result is unconfirmed. Check your bookings before trying again.' };
      }
      toast.success(accept ? `Invite accepted! Paid ${paid} credits` : 'Invite declined');
      fetchData();
      return { status: accept ? 'accepted' : 'declined', amount_paid_credits: paid };
    } catch (error) {
      if (!isCurrent()) return { status: 'stale' };
      if (accept && error.response?.status === 409) {
        return { status: 'changed', message: 'Price changed. Review again.' };
      }
      if (!error.response || error.response.status >= 500) {
        owner.uncertain.add(inviteId);
        return { status: 'uncertain', message: 'Response unconfirmed. Check your bookings before trying again.' };
      }
      const message = error.response?.data?.detail || 'Failed to respond to invite';
      toast.error(message);
      return { status: 'error', message };
    } finally {
      owner.mutation = false;
    }
  };

  const handleJoinNearbyBooking = async (bookingId) => {
    try {
      const response = await apiClient.post(`/bookings/${bookingId}/join`);
      toast.success(`Joined booking! Paid ${response.data.amount_paid} credits`);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to join booking');
    }
  };

  const fetchNearbyWithSkillFilter = async (skillLevel) => {
    setSelectedSkillFilter(skillLevel);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        const params = new URLSearchParams({
          latitude: latitude.toString(),
          longitude: longitude.toString(),
          radius: '10',
          user_id: user.id
        });
        if (skillLevel) {
          params.append('skill_level', skillLevel);
        }
        try {
          const nearbyRes = await apiClient.get(`/bookings/nearby?${params}`);
          setNearbyBookings(nearbyRes.data || []);
        } catch (e) {
          logger.error('Error fetching nearby bookings:', e);
        }
      });
    }
  };

  const copyInviteCode = (code) => {
    navigator.clipboard.writeText(code);
    toast.success('Invite code copied!');
  };

  const handlePayCrewShare = (invite) => {
    setSelectedCrewInvite(invite);
    setShowCrewPaymentModal(true);
  };

  const fetchOnDemandPhotographers = async () => {
    setOnDemandLoading(true);
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            setUserLocation({ latitude, longitude });
            setGpsUnavailable(false);
            try {
              const response = await apiClient.get(`/photographers/on-demand`, {
                params: { latitude, longitude, radius: 25 }
              });
              setOnDemandPhotographers(sortPhotographers(response.data));
            } catch (e) {
              logger.error('Error fetching on-demand photographers:', e);
              setOnDemandPhotographers([]);
            }
            setOnDemandLoading(false);
          },
          (_error) => {
            setGpsUnavailable(true);
            setOnDemandLoading(false);
          }
        );
      } else {
        setGpsUnavailable(true);
        setOnDemandLoading(false);
      }
    } catch (e) {
      logger.error('Error in fetchOnDemandPhotographers:', e);
      setOnDemandLoading(false);
    }
  };

  const fetchOnDemandByManualLocation = async (latitude, longitude, locationLabel) => {
    setOnDemandLoading(true);
    setUserLocation({ latitude, longitude, label: locationLabel });
    try {
      const response = await apiClient.get(`/photographers/on-demand`, {
        params: { latitude, longitude, radius: 50 }
      });
      setOnDemandPhotographers(sortPhotographers(response.data));
    } catch (e) {
      logger.error('Error fetching on-demand photographers by manual location:', e);
      setOnDemandPhotographers([]);
    } finally {
      setOnDemandLoading(false);
    }
  };

  const handleSelectOnDemandPro = (pro) => {
    setSelectedOnDemandPro(pro);
    setShowOnDemandDrawer(true);
  };

  const handleOnDemandSuccess = (data) => {
    setShowOnDemandDrawer(false);
    setSelectedOnDemandPro(null);
    if (data?.remaining_credits !== undefined) {
      updateUser({ credit_balance: data.remaining_credits });
    }
    toast.success('On-Demand request sent!');
    fetchData();
  };

  const openInviteModal = async (booking) => {
    if (booking.needsEnableSplitting) {
      try {
        const response = await apiClient.post(`/bookings/${booking.id}/enable-splitting`);
        if (response.data.success) {
          toast.success('Crew splitting enabled!');
          await fetchData();
          setSelectedBooking({ ...booking, invite_code: response.data.invite_code });
          setShowInviteModal(true);
        }
      } catch (error) {
        toast.error(error.response?.data?.detail || 'Failed to enable splitting');
      }
      return;
    }
    setSelectedBooking(booking);
    setShowInviteModal(true);
  };

  return {
    liveSessionsList,
    fetchData,
    handleJumpIn,
    handleJoinByCode,
    handleRespondToInvite,
    handleJoinNearbyBooking,
    fetchNearbyWithSkillFilter,
    copyInviteCode,
    handlePayCrewShare,
    fetchOnDemandPhotographers,
    fetchOnDemandByManualLocation,
    handleSelectOnDemandPro,
    handleOnDemandSuccess,
    openInviteModal,
  };
};

export default useBookingsActions;
