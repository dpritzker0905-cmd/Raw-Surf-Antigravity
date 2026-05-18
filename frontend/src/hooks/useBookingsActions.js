/**
 * useBookingsActions.js
 * Extracted from Bookings.js G handler logic for the Bookings page.
 * 
 * Extraction checklist (v30):
 * G Step 1: JSX scan G zero JSX in extraction range
 * G Step 2: Closure param audit G all state/setters listed
 * G Step 3: Phantom param check G every param used in handler body
 * G Step 4: React hooks scan G no React hooks needed (pure handlers)
 * G Step 5: Utility/import scan G apiClient, toast, logger
 * G Step 6: Hook placement G called AFTER all useState declarations
 * G Step 7: Cross-module export G SURFER_ROLES is local const, not needed
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

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

  // Helper: sort photographers by priority
  const sortPhotographers = (photographers) => {
    return (photographers || []).sort((a, b) => {
      const priorityOrder = { 'Approved Pro': 0, 'Pro': 1, 'Photographer': 2, 'Hobbyist': 3 };
      return (priorityOrder[a.role] ?? 99) - (priorityOrder[b.role] ?? 99);
    });
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [creditsRes, bookingsRes, sessionsRes, liveRes, invitesRes, crewRes, activeRes, historyRes] = await Promise.allSettled([
        apiClient.get(`/credits/${user.id}/balance`),
        apiClient.get(`/bookings/user/${user.id}`),
        apiClient.get(`/sessions/user/${user.id}`),
        apiClient.get(`/photographers/live`),
        apiClient.get(`/bookings/invites/${user.id}`),
        apiClient.get(`/dispatch/user/${user.id}/crew-invites`),
        apiClient.get(`/dispatch/user/${user.id}/active`),
        apiClient.get(`/sessions/user/${user.id}/history`),
      ]);

      if (creditsRes.status === 'fulfilled' && creditsRes.value.data?.balance !== undefined) {
        setUserCreditBalance(creditsRes.value.data.balance);
        updateUser({ credit_balance: creditsRes.value.data.balance });
      }
      setBookings(bookingsRes.status === 'fulfilled' ? (bookingsRes.value.data || []) : []);
      setLiveSessions(sessionsRes.status === 'fulfilled' ? (sessionsRes.value.data || []) : []);
      setLivePhotographers(liveRes.status === 'fulfilled' ? (liveRes.value.data || []) : []);
      setPendingInvites(invitesRes.status === 'fulfilled' ? (invitesRes.value.data || []) : []);
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

  const handleRespondToInvite = async (inviteId, accept) => {
    try {
      await apiClient.post(`/bookings/invites/${inviteId}/respond?accept=${accept}`);
      toast.success(accept ? 'Invite accepted!' : 'Invite declined');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to respond to invite');
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
