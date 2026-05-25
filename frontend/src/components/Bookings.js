import React, { useEffect, useState, useRef } from 'react';
import useSwipeNavigation from '../hooks/useSwipeNavigation';

import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import { usePersona } from '../contexts/PersonaContext';

import apiClient from '../lib/apiClient';

import { Users, Zap, Radio, History, CalendarClock, UserPlus, Mail, Target, Search, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

import { Card, CardContent } from './ui/card';

import { Button } from './ui/button';



import { toast } from 'sonner';

// Tab components extracted for maintainability
import { LiveSessionsTab, OnDemandTab, ScheduledTab, FindBuddiesTab, PastTab, LiveNowTab, LineupTab, DirectoryTab, SubscriptionsTab } from './bookings/index';

import logger from '../utils/logger';
import useBookingsActions from '../hooks/useBookingsActions';
import BookingsModals from './bookings/BookingsModals';
import { BookingsTabStrip } from './bookings/BookingsTabStrip';

// Surfer-capable roles that can join sessions
// Role IDs must match Auth.js signup roles exactly
const SURFER_ROLES = ['Grom', 'Surfer', 'Comp Surfer', 'Pro', 'Hobbyist', 'Grom Parent'];



export const Bookings = () => {
  const { user, updateUser } = useAuth();
  const { theme } = useTheme();
  const { getEffectiveRole } = usePersona();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(tabFromUrl || 'lineup');  // Default to The Lineup tab, or use URL param
  const [loading, setLoading] = useState(true);

  // Scroll <main> to top on mount so page always loads at the top
  useEffect(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
  }, []);

  // Static Open Graph meta tags for Bookings page SEO
  useEffect(() => {
    const ogTags = [];
    const setMeta = (property, content) => {
      if (!content) return;
      let tag = document.querySelector(`meta[property="${property}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('property', property);
        document.head.appendChild(tag);
        ogTags.push(tag);
      }
      tag.setAttribute('content', content);
    };
    document.title = 'Bookings - Raw Surf';
    setMeta('og:title', 'Bookings - Raw Surf');
    setMeta('og:description', 'Book surf photography sessions, find live photographers, and manage your upcoming shoots on Raw Surf.');
    setMeta('og:url', `${window.location.origin}/bookings`);
    setMeta('og:type', 'website');
    setMeta('og:site_name', 'Raw Surf');
    return () => {
      document.title = 'Raw Surf';
      ogTags.forEach(tag => tag.remove());
    };
  }, []);

  const [bookings, setBookings] = useState([]);
  const [liveSessions, setLiveSessions] = useState([]);
  const [sessionHistory, setSessionHistory] = useState([]);  // Past live session participations

  const [livePhotographers, setLivePhotographers] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [crewInvites, setCrewInvites] = useState([]);  // On-demand crew invites
  const [nearbyBookings, setNearbyBookings] = useState([]);
  const [selectedSkillFilter, setSelectedSkillFilter] = useState(null);

  const [showJoinCodeModal, setShowJoinCodeModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [userCreditBalance, setUserCreditBalance] = useState(0);  // Local state for credits
  
  // Photographer Directory state (for Scheduled bookings)
  const [showPhotographerDirectory, setShowPhotographerDirectory] = useState(false);
  const [selectedScheduledPhotographer, setSelectedScheduledPhotographer] = useState(null);
  const [showScheduledBookingDrawer, setShowScheduledBookingDrawer] = useState(false);
  
  // Unified Drawer state for Jump In flow
  const [showJumpInDrawer, setShowJumpInDrawer] = useState(false);
  const [selectedPhotographer, setSelectedPhotographer] = useState(null);
  
  // The Crew view drawer state
  const [showCrewViewDrawer, setShowCrewViewDrawer] = useState(false);
  const [selectedCrewBooking, setSelectedCrewBooking] = useState(null);
  
  // On-Demand Request state
  const [onDemandPhotographers, setOnDemandPhotographers] = useState([]);
  const [onDemandLoading, setOnDemandLoading] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [gpsUnavailable, setGpsUnavailable] = useState(false);
  const [showOnDemandDrawer, setShowOnDemandDrawer] = useState(false);
  const [selectedOnDemandPro, setSelectedOnDemandPro] = useState(null);
  const [resumeDispatchId, setResumeDispatchId] = useState(null);
  
  // Crew Payment Modal state
  const [showCrewPaymentModal, setShowCrewPaymentModal] = useState(false);
  const [selectedCrewInvite, setSelectedCrewInvite] = useState(null);
  
  // Active On-Demand Request state (for returning to "Finding Your Photographer")
  const [activeDispatch, setActiveDispatch] = useState(null);
  
  // Get effective role (respects God Mode persona)
  const effectiveRole = getEffectiveRole(user?.role);
  const canJoinSessions = SURFER_ROLES.includes(effectiveRole);

  // Theme-specific classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const mainBgClass = isLight ? 'bg-gray-50' : isBeach ? 'bg-background' : 'bg-card';
  const _cardBgClass = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-border' : 'bg-muted/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondaryClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-muted-foreground';
  const borderClass = isLight ? 'border-gray-200' : isBeach ? 'border-border' : 'border-zinc-700';
  const inputBgClass = isLight ? 'bg-white' : 'bg-card';

  // Get subscription tier info
  const subscriptionTier = user?.subscription_tier || 'Free';
  const trackingRadius = subscriptionTier === 'Premium' ? 'Unlimited' : subscriptionTier === 'Basic' ? '5 Miles' : '1 Mile';

  // Update active tab when URL changes
  useEffect(() => {
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  // Fetch all data on mount and when navigating back to this page.
  // location.key changes on every navigation entry, ensuring we re-fetch
  // stale data (e.g., after cancelling from the DispatchLobby).
  useEffect(() => {
    if (user?.id) {
      fetchData();
    }
  }, [user?.id, location.key]);  

  // Fetch on-demand photographers when On-Demand tab is selected
  useEffect(() => {
    if (activeTab === 'on_demand' && user?.id) {
      fetchOnDemandPhotographers();
    }
  }, [activeTab, user?.id]);

  // Sync selectedCrewBooking with latest bookings data when bookings update
  useEffect(() => {
    if (bookings.length > 0) {
      setSelectedCrewBooking(prev => {
        if (!prev) return null;
        const updatedBooking = bookings.find(b => b.id === prev.id);
        return updatedBooking || prev;
      });
    }
  }, [bookings]);

  // Poll for active dispatch and crew invites updates (only when On-Demand tab is active)
  useEffect(() => {
    if (!user?.id || activeTab !== 'on_demand') return;
    
    const pollInterval = setInterval(async () => {
      // Skip polling when browser tab is hidden (saves battery & bandwidth)
      if (document.visibilityState === 'hidden') return;
      
      // Refresh active dispatch
      try {
        const activeRes = await apiClient.get(`/dispatch/user/${user.id}/active`);
        // Show dispatch for requester, crew_member, or photographer roles
        if (activeRes.data.active_dispatch && 
            ['requester', 'crew_member', 'photographer'].includes(activeRes.data.active_dispatch.role)) {
          setActiveDispatch(activeRes.data.active_dispatch);
        } else {
          setActiveDispatch(null);
        }
      } catch (e) {
        // Silent fail
      }
      
      // Refresh crew invites
      try {
        const crewRes = await apiClient.get(`/dispatch/user/${user.id}/crew-invites`);
        setCrewInvites(crewRes.data.crew_invites || []);
      } catch (e) {
        // Silent fail
      }
    }, 5000); // Poll every 5 seconds
    
    return () => clearInterval(pollInterval);
  }, [user?.id, activeTab]);

  // Ref to prevent duplicate Stripe payment completion calls (race condition fix)
  const paymentProcessedRef = useRef(false);
  
  // Handle return from Stripe session payment
  useEffect(() => {
    const sessionPayment = searchParams.get('session_payment');
    const checkoutSessionId = searchParams.get('checkout_session_id');
    
    // Wait for user to be loaded
    if (!user?.id) return;
    
    if (sessionPayment === 'success' && checkoutSessionId) {
      // Guard: Only process once per mount/redirect
      if (paymentProcessedRef.current) {
        return;
      }
      paymentProcessedRef.current = true;
      
      // Complete the session join after successful payment
      const completeSessionJoin = async () => {
        try {
          const response = await apiClient.post(`/sessions/complete-payment`, {
            checkout_session_id: checkoutSessionId
          });
          
          
          if (response.data.success) {
 toast.success(`You're in the session with ${response.data.photographer_name || 'the photographer'}! +++-G`, { duration: 5000 });
            // Switch to live_sessions tab to show the active session
            setActiveTab('live_sessions');
            // Refresh live sessions
            const sessionsRes = await apiClient.get(`/sessions/user/${user.id}`);
            setLiveSessions(sessionsRes.data || []);
          }
        } catch (error) {
          logger.error('Complete session payment error:', error);
          toast.error(error.response?.data?.detail || 'Payment received - session will be activated shortly');
        }
        
        // Clear the URL params
        navigate('/bookings?tab=live_sessions', { replace: true });
      };
      
      completeSessionJoin();
    } else if (sessionPayment === 'cancelled') {
      toast.info('Payment cancelled');
      navigate('/bookings', { replace: true });
    }
  }, [searchParams, user?.id, navigate]);

  // ============ HANDLERS EXTRACTED TO hooks/useBookingsActions.js ============
  const {
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
  } = useBookingsActions({
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
  });

  // --- Date-based booking lifecycle helper ------------------------------------
  // A booking is "past" if its session_date + duration has elapsed.
  // This catches sessions the photographer never explicitly ended.
  const isBookingPast = (b) => {
    if (!b.session_date) return false;
    const sessionEnd = new Date(b.session_date);
    sessionEnd.setMinutes(sessionEnd.getMinutes() + (b.duration || 60));
    return sessionEnd < new Date();
  };

  const LOBBY_PHASE = ['open', 'filling', 'ready'];

  // --- Derived lists ---------------------------------------------------------
  // Scheduled = future confirmed/pending bookings only
  const scheduledBookings = bookings.filter(b => {
    if (isBookingPast(b)) return false; // past-dated ? Past tab
    if (b.status === 'Confirmed') return true;
    if (b.status === 'Pending' && LOBBY_PHASE.includes(b.lineup_status)) return false;
    return b.status === 'Pending';
  });

  // Past = explicitly completed OR past-dated sessions (expired/missed)
  // Also merge in past live session participations
  const pastBookings = [
    ...bookings.filter(b => {
      if (b.status === 'Completed') return true;
      // Past-dated sessions that were never completed
      if (isBookingPast(b) && ['Confirmed', 'Pending'].includes(b.status)) return true;
      return false;
    }),
    ...sessionHistory, // Past live session participations (already normalized by backend)
  ].sort((a, b) => new Date(b.session_date || b.created_at) - new Date(a.session_date || a.created_at));

  const tabs = [
    { id: 'lineup', label: 'The Lineup', icon: Users, count: 0, highlight: true },
    { id: 'directory', label: 'Find Photogs', icon: Search, count: 0 },
    { id: 'live_sessions', label: 'Live Sessions', icon: Zap, count: liveSessions.length },
    { id: 'on_demand', label: 'On-Demand', icon: Target, count: onDemandPhotographers.length },
    { id: 'find_buddies', label: 'Open Sessions', icon: Users, count: nearbyBookings.length },
    { id: 'scheduled', label: 'Scheduled', icon: CalendarClock, count: scheduledBookings.length },
    { id: 'past', label: 'Past', icon: History, count: pastBookings.length },
    { id: 'live_now', label: 'Live Now', icon: Radio, count: livePhotographers.length },
    { id: 'subscriptions', label: 'Subscriptions', icon: RefreshCw, count: 0 },
  ];

 // Shared swipe hook (v81) G replaces inline touch handlers
  const { contentRef, swipeHandlers } = useSwipeNavigation({
    tabs,
    activeTab,
    setActiveTab,
  });

  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-screen ${mainBgClass}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400"></div>
      </div>
    );
  }

  return (
    <div className={`pb-20 min-h-screen ${mainBgClass} transition-colors duration-300`} data-testid="bookings-page">
      <div className="max-w-lg mx-auto p-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className={`text-3xl font-bold ${textPrimaryClass} font-oswald`}  data-testid="bookings-title">
            Sessions & Bookings
          </h1>
          <div className="flex items-center gap-2">
            <Button aria-label="Search"
              onClick={() => setActiveTab('directory')}
              size="sm"
              className="bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600 text-black font-semibold"
            >
              <Search className="w-4 h-4 mr-1.5" />
              Find Photogs
            </Button>
            <Button aria-label="User Plus"
              onClick={() => setShowJoinCodeModal(true)}
              variant="outline"
              size="sm"
              className={isLight ? 'border-gray-300' : 'border-zinc-700'}
            >
              <UserPlus className="w-4 h-4 mr-1.5" />
              Join Code
            </Button>
          </div>
        </div>

        {/* Pending Invites Banner */}
        {pendingInvites.length > 0 && (
          <Card className="mb-4 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/30">
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-yellow-400" />
                  <span className={`text-sm font-medium ${textPrimaryClass}`}>
                    You have {pendingInvites.length} pending invite{pendingInvites.length > 1 ? 's' : ''}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-yellow-400"
                  onClick={() => setActiveTab('scheduled')}
                >
                  View
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs - scrolls with content */}
        <BookingsTabStrip activeTab={activeTab} setActiveTab={setActiveTab} tabs={tabs} theme={theme} />

        {/* Tab Content -- swipeable via useSwipeNavigation hook (v81) */}
        <div className="relative overflow-hidden" {...swipeHandlers}>
          <div ref={contentRef} className="space-y-4">
          {/* The Lineup Tab - Surf Session Lobby */}
          <div style={{ display: activeTab === 'lineup' ? 'block' : 'none' }}>
            <LineupTab
              user={user}
              theme={theme}
              onOpenDirectory={() => setShowPhotographerDirectory(true)}
              onRefresh={fetchData}
            />
          </div>

          {/* Live Sessions Tab */}
          <div style={{ display: activeTab === 'live_sessions' ? 'block' : 'none' }}>
            <LiveSessionsTab
              liveSessions={liveSessions}
              onGoToLiveNow={() => setActiveTab('live_now')}
              onSessionLeft={(sessionId) => {
                setLiveSessions(prev => prev.filter(s => s.id !== sessionId));
              }}
              userId={user?.id}
              theme={theme}
            />
          </div>

          {/* On-Demand Tab - Request a Photographer */}
          <div style={{ display: activeTab === 'on_demand' ? 'block' : 'none' }}>
            <OnDemandTab
              user={user}
              onDemandPhotographers={onDemandPhotographers}
              onDemandLoading={onDemandLoading}
              userLocation={userLocation}
              gpsUnavailable={gpsUnavailable}
              activeDispatch={activeDispatch}
              onRefresh={fetchOnDemandPhotographers}
              onManualLocationSelect={fetchOnDemandByManualLocation}
              onSelectPhotographer={handleSelectOnDemandPro}
              onResumeDispatch={(dispatch) => {
                // Always navigate to the full-featured lobby page
                // It handles all states: searching, accepted, en_route, arrived
                navigate(`/dispatch/${dispatch.id}/lobby`);
              }}
              crewInvites={crewInvites}
              onPayCrewShare={handlePayCrewShare}
              theme={theme}
            />
          </div>

          {/* Scheduled Tab */}
          <div style={{ display: activeTab === 'scheduled' ? 'block' : 'none' }}>
            <ScheduledTab
              user={user}
              scheduledBookings={scheduledBookings}
              pendingInvites={pendingInvites}
              crewInvites={crewInvites}
              onOpenDirectory={() => setShowPhotographerDirectory(true)}
              onInvite={openInviteModal}
              onRespondToInvite={handleRespondToInvite}
              onPayCrewShare={handlePayCrewShare}
              onRefresh={fetchData}
              onOpenCrewHub={(booking) => {
                // Open the invite modal for crew management
                openInviteModal(booking);
              }}
              onOpenModify={(booking) => {
                // Navigate to modify booking - use scheduled booking drawer with existing data
                setSelectedScheduledPhotographer({ id: booking.photographer_id, full_name: booking.photographer_name });
                setShowScheduledBookingDrawer(true);
                toast.info('Modify session: Select a new time slot');
              }}
              onOpenCrewView={(booking) => {
                // Open The Crew lineup visualization drawer
                setSelectedCrewBooking(booking);
                setShowCrewViewDrawer(true);
              }}
              theme={theme}
            />
          </div>

          {/* Find Buddies Tab */}
          <div style={{ display: activeTab === 'find_buddies' ? 'block' : 'none' }}>
            <FindBuddiesTab
              nearbyBookings={nearbyBookings}
              selectedSkillFilter={selectedSkillFilter}
              onSkillFilterChange={fetchNearbyWithSkillFilter}
              onJoinNearbyBooking={handleJoinNearbyBooking}
              theme={theme}
            />
          </div>

          {/* Past Tab */}
          <div style={{ display: activeTab === 'past' ? 'block' : 'none' }}>
            <PastTab
              pastBookings={pastBookings}
              theme={theme}
              userId={user?.id}
            />
          </div>

          {/* Live Now Tab */}
          <div style={{ display: activeTab === 'live_now' ? 'block' : 'none' }}>
            <LiveNowTab
              livePhotographers={livePhotographers}
              subscriptionTier={subscriptionTier}
              trackingRadius={trackingRadius}
              onJumpIn={handleJumpIn}
              onNavigateToMap={() => navigate('/map')}
              theme={theme}
            />
          </div>

          {/* Directory Tab */}
          <div style={{ display: activeTab === 'directory' ? 'block' : 'none' }}>
            <DirectoryTab
              user={user}
              theme={theme}
              subscriptionTier={subscriptionTier}
              onSelectPhotographer={(photographer) => {
                setSelectedScheduledPhotographer(photographer);
                setShowScheduledBookingDrawer(true);
              }}
            />
          </div>

          {/* Subscriptions Tab */}
          <div style={{ display: activeTab === 'subscriptions' ? 'block' : 'none' }}>
            <SubscriptionsTab />
          </div>
          </div>
        </div>
      </div>

 {/* Modals & Drawers -- Extracted to bookings/BookingsModals.js (v82) */}
      <BookingsModals
        isLight={isLight}
        textPrimaryClass={textPrimaryClass}
        textSecondaryClass={textSecondaryClass}
        borderClass={borderClass}
        inputBgClass={inputBgClass}
        user={user}
        showJoinCodeModal={showJoinCodeModal}
        setShowJoinCodeModal={setShowJoinCodeModal}
        joinCode={joinCode}
        setJoinCode={setJoinCode}
        handleJoinByCode={handleJoinByCode}
        showInviteModal={showInviteModal}
        setShowInviteModal={setShowInviteModal}
        selectedBooking={selectedBooking}
        copyInviteCode={copyInviteCode}
        fetchData={fetchData}
        showJumpInDrawer={showJumpInDrawer}
        setShowJumpInDrawer={setShowJumpInDrawer}
        selectedPhotographer={selectedPhotographer}
        setSelectedPhotographer={setSelectedPhotographer}
        selectedOnDemandPro={selectedOnDemandPro}
        showOnDemandDrawer={showOnDemandDrawer}
        setShowOnDemandDrawer={setShowOnDemandDrawer}
        setSelectedOnDemandPro={setSelectedOnDemandPro}
        resumeDispatchId={resumeDispatchId}
        setResumeDispatchId={setResumeDispatchId}
        handleOnDemandSuccess={handleOnDemandSuccess}
        userLocation={userLocation}
        userCreditBalance={userCreditBalance}
        showPhotographerDirectory={showPhotographerDirectory}
        setShowPhotographerDirectory={setShowPhotographerDirectory}
        setSelectedScheduledPhotographer={setSelectedScheduledPhotographer}
        showScheduledBookingDrawer={showScheduledBookingDrawer}
        setShowScheduledBookingDrawer={setShowScheduledBookingDrawer}
        selectedScheduledPhotographer={selectedScheduledPhotographer}
        showCrewViewDrawer={showCrewViewDrawer}
        setShowCrewViewDrawer={setShowCrewViewDrawer}
        selectedCrewBooking={selectedCrewBooking}
        setSelectedCrewBooking={setSelectedCrewBooking}
        setBookings={setBookings}
        selectedCrewInvite={selectedCrewInvite}
        showCrewPaymentModal={showCrewPaymentModal}
        setShowCrewPaymentModal={setShowCrewPaymentModal}
        setSelectedCrewInvite={setSelectedCrewInvite}
        setActiveTab={setActiveTab}
      />
    </div>
  );
};
