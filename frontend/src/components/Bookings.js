import React, { useEffect, useState, useRef } from 'react';
import useSwipeNavigation from '../hooks/useSwipeNavigation';

import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import { usePersona } from '../contexts/PersonaContext';

import apiClient from '../lib/apiClient';

import { Users, Zap, Radio, History, CalendarClock, UserPlus, Copy, Mail, Target, Sparkles, Search, Loader2, AtSign, Send, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

import { Card, CardContent } from './ui/card';

import { Button } from './ui/button';

import { Badge } from './ui/badge';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';

import { Input } from './ui/input';

import { Label } from './ui/label';

import { toast } from 'sonner';

import { PhotographerDirectory } from './PhotographerDirectory';

import { ScheduledBookingDrawer } from './ScheduledBookingDrawer';

import LineupManagerDrawer from './LineupManagerDrawer';

// Tab components extracted for maintainability
import { LiveSessionsTab, OnDemandTab, ScheduledTab, FindBuddiesTab, PastTab, LiveNowTab, LineupTab, DirectoryTab, SubscriptionsTab } from './bookings/index';

import { OnDemandRequestDrawer } from './OnDemandRequestDrawer';

import { CrewPaymentModal } from './CrewPaymentModal';

import { JumpInSessionModal } from './JumpInSessionModal';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import useBookingsActions from '../hooks/useBookingsActions';
import InviteModalContent from './bookings/InviteModalContent';



// Surfer-capable roles that can join sessions
// Role IDs must match Auth.js signup roles exactly
const SURFER_ROLES = ['Grom', 'Surfer', 'Comp Surfer', 'Pro', 'Hobbyist', 'Grom Parent'];

// Live Savings Badge Component (synced with Map drawer)
const _LiveSavingsBadge = ({ generalPrice, livePrice, className = '' }) => {
  const savings = generalPrice - livePrice;
  const _savingsPercent = generalPrice > 0 ? Math.round((savings / generalPrice) * 100) : 0;
  
  if (savings <= 0) return null;
  
  return (
    <Badge className={`bg-gradient-to-r from-green-500 to-emerald-500 text-foreground font-bold ${className}`}>
      <Sparkles className="w-3 h-3 mr-1" />
      Save ${savings}/photo!
    </Badge>
  );
};



export const Bookings = () => {
  const { user, updateUser } = useAuth();
  const { theme } = useTheme();
  const { getEffectiveRole } = usePersona();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(tabFromUrl || 'lineup');  // Default to The Lineup tab, or use URL param
  const tabScrollRef = useRef(null);
  const stickyTabRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const scrollStartRef = useRef(0);

  // Swipe-to-navigate — uses shared hook (v81)

  // Check if scroll arrows should show (desktop only)
  const updateArrows = () => {
    const el = tabScrollRef.current;
    if (!el) return;
    setShowLeftArrow(el.scrollLeft > 4);
    setShowRightArrow(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  // Scroll arrows handler
  const scrollTabs = (dir) => {
    const el = tabScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 160, behavior: 'smooth' });
  };

  // loading must be declared before the useEffect that depends on it
  const [loading, setLoading] = useState(true);


  // Sliding indicator bar position (left + width track the active tab button)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  // Auto-scroll the active tab pill into view whenever activeTab changes
  // or when loading finishes (so the tab strip DOM is actually available).
  // Uses direct scrollTo math instead of scrollIntoView because scrollIntoView
  // is unreliable on mobile for horizontal centering in nested scroll containers.
  useEffect(() => {
    if (loading) return; // Tab strip not rendered yet
    const tabStrip = tabScrollRef.current;
    if (!tabStrip) return;

    // Wait one frame for DOM layout to complete before measuring
    requestAnimationFrame(() => {
      const activeBtn = tabStrip.querySelector(`[data-testid="tab-${activeTab}"]`);
      if (activeBtn) {
        const stripWidth = tabStrip.offsetWidth;
        const btnLeft = activeBtn.offsetLeft;
        const btnWidth = activeBtn.offsetWidth;
        const targetScroll = btnLeft - (stripWidth / 2) + (btnWidth / 2);
        // Always instant scroll - the sliding indicator CSS transition provides
        // the smooth visual feedback. Smooth scroll + indicator transition together
        // create competing animations that look like "spinning".
        tabStrip.scrollTo({ left: targetScroll, behavior: 'instant' });
        // Update the sliding indicator position
        setIndicatorStyle({ left: btnLeft, width: btnWidth });
      }
      updateArrows();
    });
    setTimeout(updateArrows, 350);
  }, [activeTab, loading]);

  // Keep arrows synced on resize
  useEffect(() => {
    window.addEventListener('resize', updateArrows);
    requestAnimationFrame(updateArrows);
    return () => window.removeEventListener('resize', updateArrows);
  }, []);

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
  }, [user?.id, location.key]); // eslint-disable-line

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
            toast.success(`You're in the session with ${response.data.photographer_name || 'the photographer'}! ðŸ¤™`, { duration: 5000 });
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

  // Shared swipe hook (v81) — replaces inline touch handlers
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
        <div
          ref={stickyTabRef}
          className="relative z-10"
          style={{
            backgroundColor: isLight ? '#f9fafb' : isBeach ? '#09090b' : '#18181b',
            backgroundImage: 'none',
          }}
        >
          <div className="relative">
            {/* Scrollable tab strip with orange underline indicator */}
            <div
              ref={tabScrollRef} role="tablist" aria-label="Booking sections"
              onScroll={updateArrows}
              onMouseDown={(e) => {
                isDraggingRef.current = true;
                dragStartXRef.current = e.pageX;
                scrollStartRef.current = tabScrollRef.current?.scrollLeft || 0;
                e.currentTarget.style.cursor = 'grabbing';
                e.currentTarget.style.userSelect = 'none';
              }}
              onMouseMove={(e) => {
                if (!isDraggingRef.current) return;
                const delta = dragStartXRef.current - e.pageX;
                if (tabScrollRef.current) tabScrollRef.current.scrollLeft = scrollStartRef.current + delta;
              }}
              onMouseUp={(e) => {
                isDraggingRef.current = false;
                e.currentTarget.style.cursor = '';
                e.currentTarget.style.userSelect = '';
              }}
              onMouseLeave={(e) => {
                if (isDraggingRef.current) {
                  isDraggingRef.current = false;
                  e.currentTarget.style.cursor = '';
                  e.currentTarget.style.userSelect = '';
                }
              }}
              className={`flex border-b ${borderClass} overflow-x-auto scrollbar-hide cursor-grab select-none relative`}
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    data-active={isActive ? 'true' : 'false'}
                    onClick={() => {
                      if (Math.abs((tabScrollRef.current?.scrollLeft || 0) - scrollStartRef.current) < 4) {
                        setActiveTab(tab.id);
                      }
                    }}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                      isActive ? textPrimaryClass : textSecondaryClass
                    }`}
                    style={{
                      borderBottom: '3px solid transparent',
                      marginBottom: '-1px',
                    }}
                    data-testid={`tab-${tab.id}`}
                    role="tab"
                    aria-selected={isActive}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                    {tab.count > 0 && (
                      <span className={`ml-1 px-1.5 py-0.5 text-xs rounded-full ${
                        isActive ? 'bg-amber-500/20 text-amber-500' : isLight ? 'bg-gray-200 text-gray-600' : 'bg-zinc-700 text-gray-300'
                      }`}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
              {/* Sliding orange indicator bar */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  height: 3,
                  backgroundColor: '#f59e0b',
                  borderRadius: '2px 2px 0 0',
                  transform: `translateX(${indicatorStyle.left}px)`,
                  width: indicatorStyle.width,
                  transition: 'transform 0.25s ease, width 0.25s ease',
                  pointerEvents: 'none',
                }}
              />
            </div>

            {/* Left fade + arrow */}
            {showLeftArrow && (
              <button
                onClick={() => scrollTabs(-1)}
                className={`absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 ${
                  isLight ? 'bg-gradient-to-r from-gray-50 to-transparent' : isBeach ? 'bg-gradient-to-r from-background to-transparent' : 'bg-gradient-to-r from-card to-transparent'
                }`}
                aria-label="Scroll tabs left"
              >
                <ChevronLeft className={`w-4 h-4 ${textSecondaryClass}`} />
              </button>
            )}

            {/* Right fade + arrow */}
            {showRightArrow && (
              <button
                onClick={() => scrollTabs(1)}
                className={`absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 ${
                  isLight ? 'bg-gradient-to-l from-gray-50 to-transparent' : isBeach ? 'bg-gradient-to-l from-background to-transparent' : 'bg-gradient-to-l from-card to-transparent'
                }`}
                aria-label="Scroll tabs right"
              >
                <ChevronRight className={`w-4 h-4 ${textSecondaryClass}`} />
              </button>
            )}
          </div>
        </div>

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

      {/* Join by Code Modal */}
      <Dialog open={showJoinCodeModal} onOpenChange={setShowJoinCodeModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-card'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Join with Invite Code</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label className={textSecondaryClass}>Invite Code</Label>
            <Input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter 6-character code"
              maxLength={6}
              className={`${inputBgClass} ${textPrimaryClass} uppercase tracking-widest text-center text-xl`}
            />
            <p className={`text-sm ${textSecondaryClass} mt-2`}>
              Enter the code shared by your friend to join their session.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowJoinCodeModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleJoinByCode(joinCode)}
              className="bg-gradient-to-r from-yellow-400 to-orange-400 text-black"
            >
              Join Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Friends Modal */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-card'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Invite Friends</DialogTitle>
          </DialogHeader>
          <InviteModalContent
            booking={selectedBooking}
            user={user}
            isLight={isLight}
            textPrimaryClass={textPrimaryClass}
            textSecondaryClass={textSecondaryClass}
            onCopyCode={copyInviteCode}
            onClose={() => setShowInviteModal(false)}
            onRefresh={fetchData}
          />
        </DialogContent>
      </Dialog>
      
      {/* Jump In Session Modal - Direct render without UnifiedSpotDrawer */}
      {showJumpInDrawer && selectedPhotographer && (
        <JumpInSessionModal
          photographer={selectedPhotographer}
          onClose={() => {
            setShowJumpInDrawer(false);
            setSelectedPhotographer(null);
          }}
          onSuccess={() => {
            setShowJumpInDrawer(false);
            setSelectedPhotographer(null);
            toast.success('Successfully joined session!');
          }}
        />
      )}
      
      {/* On-Demand Request Drawer */}
      {selectedOnDemandPro && (
        <OnDemandRequestDrawer
          photographer={selectedOnDemandPro}
          isOpen={showOnDemandDrawer}
          onClose={() => {
            setShowOnDemandDrawer(false);
            setSelectedOnDemandPro(null);
            setResumeDispatchId(null);
          }}
          onSuccess={handleOnDemandSuccess}
          userLocation={userLocation}
          userCredits={userCreditBalance || user?.credit_balance || 0}
          resumeDispatchId={resumeDispatchId}
        />
      )}
      
      {/* Photographer Directory for Scheduled Bookings */}
      <PhotographerDirectory
        isOpen={showPhotographerDirectory}
        onClose={() => setShowPhotographerDirectory(false)}
        onSelectPhotographer={(photographer) => {
          // Open the scheduled booking drawer with selected photographer
          setSelectedScheduledPhotographer(photographer);
          setShowPhotographerDirectory(false);
          setShowScheduledBookingDrawer(true);
        }}
      />
      
      {/* Scheduled Booking Drawer - Full booking flow */}
      <ScheduledBookingDrawer
        isOpen={showScheduledBookingDrawer}
        onClose={() => {
          setShowScheduledBookingDrawer(false);
          setSelectedScheduledPhotographer(null);
        }}
        photographer={selectedScheduledPhotographer}
        onSuccess={(_booking) => {
          setShowScheduledBookingDrawer(false);
          setSelectedScheduledPhotographer(null);
          fetchData();
          toast.success('Session booked! Check your scheduled sessions.');
        }}
      />

      {/* The Crew View Drawer - Surfboard lineup visualization */}
      <LineupManagerDrawer
        isOpen={showCrewViewDrawer}
        onClose={() => {
          setShowCrewViewDrawer(false);
          setSelectedCrewBooking(null);
        }}
        lineup={selectedCrewBooking}
        user={user}
        onRefresh={fetchData}
        onLineupUpdate={(updatedFields) => {
          // Immediately update the selectedCrewBooking with the new fields
          setSelectedCrewBooking(prev => prev ? { ...prev, ...updatedFields } : null);
          // Also update in bookings array
          setBookings(prev => prev.map(b => 
            b.id === selectedCrewBooking?.id ? { ...b, ...updatedFields } : b
          ));
        }}
      />
      
      {/* Crew Payment Modal for On-Demand Session Invites */}
      <CrewPaymentModal
        invite={selectedCrewInvite}
        isOpen={showCrewPaymentModal}
        onClose={() => {
          setShowCrewPaymentModal(false);
          setSelectedCrewInvite(null);
        }}
        onSuccess={() => {
          fetchData();
          setShowCrewPaymentModal(false);
          setSelectedCrewInvite(null);
          // Switch to "Live Now" tab so crew member can see their active session
          setActiveTab('on_demand');
          toast.success('Check your active session below!');
        }}
      />
    </div>
  );
};
