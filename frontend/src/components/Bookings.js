import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePersona } from '../contexts/PersonaContext';
import axios from 'axios';
import { Users, Zap, Radio, History, CalendarClock, UserPlus, Copy, Mail, Target, Sparkles, Search, Loader2, AtSign, Send } from 'lucide-react';
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
import { LiveSessionsTab, OnDemandTab, ScheduledTab, FindBuddiesTab, PastTab, LiveNowTab, LineupTab } from './bookings/index';
import { GoldPassBookingsSection } from './bookings/GoldPassBookingsSection';
import { OnDemandRequestDrawer } from './OnDemandRequestDrawer';
import { CrewPaymentModal } from './CrewPaymentModal';
import { JumpInSessionModal } from './JumpInSessionModal';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

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

// Invite Modal Content Component - handles both code sharing and handle-based invites
const InviteModalContent = ({ booking, user, isLight, textPrimaryClass, textSecondaryClass, onCopyCode, onClose, onRefresh }) => {
  const [activeTab, setActiveTab] = useState('handle'); // 'handle' or 'code'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(null);
  const [sentInvites, setSentInvites] = useState([]);
  const [inviteMessage, setInviteMessage] = useState('');
  
  // Debounced search for users
  useEffect(() => {
    if (!booking?.id || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    
    const timeoutId = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await axios.get(
          `${API}/bookings/${booking.id}/search-users?query=${encodeURIComponent(searchQuery)}&user_id=${user.id}`
        );
        setSearchResults(response.data || []);
      } catch (error) {
        logger.error('Search error:', error);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [searchQuery, booking?.id, user?.id]);
  
  const handleInviteByHandle = async (targetUser) => {
    setInviting(targetUser.user_id);
    try {
      const _response = await axios.post(
        `${API}/bookings/${booking.id}/invite-by-handle?user_id=${user.id}`,
        {
          // Use username if available, otherwise fall back to full_name
          handle_query: targetUser.username || targetUser.full_name,
          message: inviteMessage || null
        }
      );
      
      const displayName = targetUser.username ? `@${targetUser.username}` : targetUser.full_name;
      toast.success(`Invite sent to ${displayName}!`);
      setSentInvites(prev => [...prev, targetUser.user_id]);
      setSearchQuery('');
      setSearchResults([]);
      onRefresh?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send invite');
    } finally {
      setInviting(null);
    }
  };
  
  return (
    <div className="py-4 space-y-4">
      {/* Tab Switcher */}
      <div className="flex border-b border-zinc-700">
        <button
          onClick={() => setActiveTab('handle')}
          className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'handle' 
              ? `${textPrimaryClass} border-b-2 border-cyan-400` 
              : textSecondaryClass
          }`}
        >
          <AtSign className="w-4 h-4" />
          Invite by Name
        </button>
        <button
          onClick={() => setActiveTab('code')}
          className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'code' 
              ? `${textPrimaryClass} border-b-2 border-cyan-400` 
              : textSecondaryClass
          }`}
        >
          <Copy className="w-4 h-4" />
          Share Code
        </button>
      </div>
      
      {/* Handle-based Invite Tab */}
      {activeTab === 'handle' && (
        <div className="space-y-4">
          <p className={`text-sm ${textSecondaryClass}`}>
            Search for friends by name to send them an invite notification.
          </p>
          
          {/* Search Input */}
          <div className="relative">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondaryClass}`} />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Type a name to search..."
              className={`pl-10 ${isLight ? 'bg-gray-100' : 'bg-muted'} ${textPrimaryClass}`}
              autoFocus
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-cyan-400" />
            )}
          </div>
          
          {/* Optional Message */}
          <div>
            <Label className={`text-sm ${textSecondaryClass}`}>Message (optional)</Label>
            <Input
              value={inviteMessage}
              onChange={(e) => setInviteMessage(e.target.value)}
              placeholder="e.g., Join me for the session!"
              className={`mt-1 ${isLight ? 'bg-gray-100' : 'bg-muted'} ${textPrimaryClass}`}
            />
          </div>
          
          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className={`rounded-lg border ${isLight ? 'border-gray-200' : 'border-zinc-700'} overflow-hidden`}>
              {searchResults.map((result) => {
                const alreadySent = sentInvites.includes(result.user_id);
                
                return (
                  <div
                    key={result.user_id}
                    className={`flex items-center justify-between p-3 ${isLight ? 'hover:bg-gray-50' : 'hover:bg-muted'} border-b last:border-b-0 ${isLight ? 'border-gray-100' : 'border-zinc-700'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-700">
                        {result.avatar_url ? (
                          <img src={result.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            {result.full_name?.[0] || '?'}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className={`font-medium ${textPrimaryClass}`}>{result.full_name}</p>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          @{result.handle}
                          {result.is_following && (
                            <span className="ml-2 text-cyan-400">Following</span>
                          )}
                        </p>
                      </div>
                    </div>
                    
                    <Button
                      size="sm"
                      onClick={() => handleInviteByHandle(result)}
                      disabled={inviting === result.user_id || alreadySent}
                      className={alreadySent 
                        ? 'bg-green-500/20 text-green-400 cursor-default'
                        : 'bg-cyan-500 hover:bg-cyan-600 text-black'
                      }
                    >
                      {inviting === result.user_id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : alreadySent ? (
                        <>
                          <Send className="w-3 h-3 mr-1" />
                          Sent
                        </>
                      ) : (
                        <>
                          <Send className="w-3 h-3 mr-1" />
                          Invite
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Empty state */}
          {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
            <div className={`text-center py-6 ${textSecondaryClass}`}>
              <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No users found matching "{searchQuery}"</p>
            </div>
          )}
          
          {/* Sent invites summary */}
          {sentInvites.length > 0 && (
            <div className={`p-3 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'} border ${isLight ? 'border-green-200' : 'border-green-500/30'}`}>
              <p className={`text-sm ${isLight ? 'text-green-700' : 'text-green-400'}`}>
                ✓ {sentInvites.length} invite{sentInvites.length > 1 ? 's' : ''} sent! They'll receive a notification.
              </p>
            </div>
          )}
        </div>
      )}
      
      {/* Code Sharing Tab */}
      {activeTab === 'code' && (
        <div className="space-y-4">
          <p className={textSecondaryClass}>
            Share this code with friends to split the session cost.
          </p>
          {booking && booking.invite_code ? (
            <>
              <div className={`p-4 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-muted'} text-center`}>
                <p className={`text-sm ${textSecondaryClass} mb-2`}>Invite Code</p>
                <div className="flex items-center justify-center gap-2">
                  <span className={`font-mono text-2xl font-bold tracking-widest ${textPrimaryClass}`}>
                    {booking.invite_code}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCopyCode(booking.invite_code)}
                    className="text-cyan-400"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className={`p-3 rounded-lg ${isLight ? 'bg-yellow-50' : 'bg-yellow-500/10'}`}>
                <p className={`text-sm ${textSecondaryClass}`}>
                  When friends join, the total session cost will be split equally among all participants.
                </p>
              </div>
            </>
          ) : (
            <div className={`p-4 rounded-lg ${isLight ? 'bg-orange-50' : 'bg-orange-500/10'} text-center`}>
              <p className={`text-sm ${isLight ? 'text-orange-700' : 'text-orange-400'}`}>
                No invite code available. This session was booked without split payment enabled.
              </p>
            </div>
          )}
        </div>
      )}
      
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </div>
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
  const [bookings, setBookings] = useState([]);
  const [liveSessions, setLiveSessions] = useState([]);
  const [livePhotographers, setLivePhotographers] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [crewInvites, setCrewInvites] = useState([]);  // On-demand crew invites
  const [nearbyBookings, setNearbyBookings] = useState([]);
  const [selectedSkillFilter, setSelectedSkillFilter] = useState(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    if (user?.id) {
      fetchData();
    }
  }, [activeTab, user?.id]);

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

  // Poll for active dispatch and crew invites updates (for real-time sync)
  useEffect(() => {
    if (!user?.id) return;
    
    const pollInterval = setInterval(async () => {
      // Refresh active dispatch
      try {
        const activeRes = await axios.get(`${API}/dispatch/user/${user.id}/active`);
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
        const crewRes = await axios.get(`${API}/dispatch/user/${user.id}/crew-invites`);
        setCrewInvites(crewRes.data.crew_invites || []);
      } catch (e) {
        // Silent fail
      }
    }, 5000); // Poll every 5 seconds
    
    return () => clearInterval(pollInterval);
  }, [user?.id]);

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
        console.log('Payment already processed, skipping duplicate call');
        return;
      }
      paymentProcessedRef.current = true;
      
      // Complete the session join after successful payment
      const completeSessionJoin = async () => {
        try {
          console.log('Completing session payment:', checkoutSessionId);
          const response = await axios.post(`${API}/sessions/complete-payment`, {
            checkout_session_id: checkoutSessionId
          });
          
          console.log('Complete payment response:', response.data);
          
          if (response.data.success) {
            toast.success(`You're in the session with ${response.data.photographer_name || 'the photographer'}! 🏄`, { duration: 5000 });
            // Switch to live_sessions tab to show the active session
            setActiveTab('live_sessions');
            // Refresh live sessions
            const sessionsRes = await axios.get(`${API}/sessions/user/${user.id}`);
            console.log('Live sessions:', sessionsRes.data);
            setLiveSessions(sessionsRes.data || []);
          }
        } catch (error) {
          console.error('Complete session payment error:', error);
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

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch user's credit balance first
      try {
        const creditsRes = await axios.get(`${API}/credits/${user.id}/balance`);
        if (creditsRes.data?.balance !== undefined) {
          setUserCreditBalance(creditsRes.data.balance);
          updateUser({ credit_balance: creditsRes.data.balance });
        }
      } catch (e) {
        // Silent fail for credits
        console.log('Credits fetch failed:', e);
      }
      
      // Fetch user's bookings
      try {
        const bookingsRes = await axios.get(`${API}/bookings/user/${user.id}`);
        setBookings(bookingsRes.data || []);
      } catch (e) {
        setBookings([]);
      }

      // Fetch live sessions user is part of
      try {
        const sessionsRes = await axios.get(`${API}/sessions/user/${user.id}`);
        setLiveSessions(sessionsRes.data || []);
      } catch (e) {
        setLiveSessions([]);
      }

      // Fetch live photographers nearby
      try {
        const liveRes = await axios.get(`${API}/photographers/live`);
        setLivePhotographers(liveRes.data || []);
      } catch (e) {
        setLivePhotographers([]);
      }

      // Fetch pending invites
      try {
        const invitesRes = await axios.get(`${API}/bookings/invites/${user.id}`);
        setPendingInvites(invitesRes.data || []);
      } catch (e) {
        setPendingInvites([]);
      }
      
      // Fetch on-demand crew invites (shared sessions)
      try {
        const crewRes = await axios.get(`${API}/dispatch/user/${user.id}/crew-invites`);
        setCrewInvites(crewRes.data.crew_invites || []);
      } catch (e) {
        setCrewInvites([]);
      }
      
      // Fetch active dispatch request (for returning to "Finding Your Photographer")
      try {
        const activeRes = await axios.get(`${API}/dispatch/user/${user.id}/active`);
        // Show dispatch for requester, crew_member, or photographer roles
        if (activeRes.data.active_dispatch && 
            ['requester', 'crew_member', 'photographer'].includes(activeRes.data.active_dispatch.role)) {
          setActiveDispatch(activeRes.data.active_dispatch);
        } else {
          setActiveDispatch(null);
        }
      } catch (e) {
        setActiveDispatch(null);
      }
      
      // Fetch nearby splittable bookings (if user has location)
      try {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(async (position) => {
            const { latitude, longitude } = position.coords;
            const params = new URLSearchParams({
              latitude,
              longitude,
              radius: 10,
              user_id: user.id
            });
            if (selectedSkillFilter) {
              params.append('skill_level', selectedSkillFilter);
            }
            const nearbyRes = await axios.get(`${API}/bookings/nearby?${params}`);
            setNearbyBookings(nearbyRes.data || []);
          }, () => {
            // Location denied - skip nearby bookings
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
    // Check if user is logged in
    if (!user) {
      toast.error('Please log in to join sessions');
      return;
    }
    
    // Check if user has a surfer-capable role
    if (!canJoinSessions) {
      toast.error(`Your current role (${effectiveRole}) cannot join sessions. Switch to a surfer role.`);
      return;
    }
    
    // Open the Unified Drawer with photographer info
    setSelectedPhotographer({
      ...photographer,
      current_spot_name: photographer.location || photographer.spot_name || 'Live Session'
    });
    setShowJumpInDrawer(true);
  };
  
  // Handle successful join from drawer
  const _handleJumpInSuccess = (data) => {
    setShowJumpInDrawer(false);
    setSelectedPhotographer(null);
    if (data?.remaining_credits !== undefined) {
      updateUser({ credit_balance: data.remaining_credits });
    }
    toast.success('Successfully joined session!');
    fetchData();
  };

  const handleJoinByCode = async () => {
    if (!joinCode.trim()) {
      toast.error('Please enter an invite code');
      return;
    }
    try {
      const _response = await axios.post(`${API}/bookings/join-by-code?user_id=${user.id}&invite_code=${joinCode.toUpperCase()}`);
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
      await axios.post(`${API}/bookings/invites/${inviteId}/respond?user_id=${user.id}&accept=${accept}`);
      toast.success(accept ? 'Invite accepted!' : 'Invite declined');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to respond to invite');
    }
  };

  const handleJoinNearbyBooking = async (bookingId) => {
    try {
      const response = await axios.post(`${API}/bookings/${bookingId}/join?user_id=${user.id}`);
      toast.success(`Joined booking! Paid ${response.data.amount_paid} credits`);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to join booking');
    }
  };
  
  // Auto-open crew payment modal when coming from notification
  useEffect(() => {
    if (location.state?.openCrewInvite && location.state?.dispatchId && crewInvites.length > 0) {
      const invite = crewInvites.find(inv => inv.dispatch_id === location.state.dispatchId);
      if (invite) {
        setSelectedCrewInvite(invite);
        setShowCrewPaymentModal(true);
        // Clear the state to prevent re-opening on refresh
        navigate(location.pathname + location.search, { replace: true, state: {} });
      }
    }
  }, [location.state, crewInvites, navigate, location.pathname, location.search]);

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
          const nearbyRes = await axios.get(`${API}/bookings/nearby?${params}`);
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

  // Handle crew share payment - opens the payment modal
  const handlePayCrewShare = (invite) => {
    setSelectedCrewInvite(invite);
    setShowCrewPaymentModal(true);
  };

  // Fetch on-demand photographers based on user location
  const fetchOnDemandPhotographers = async () => {
    setOnDemandLoading(true);
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            setUserLocation({ latitude, longitude });
            
            try {
              // Fetch photographers with on_demand_available = true
              const response = await axios.get(`${API}/photographers/on-demand`, {
                params: {
                  latitude,
                  longitude,
                  radius: 25 // 25 mile radius
                }
              });
              
              // Sort by priority: Pro > Photographer > Hobbyist
              const sorted = (response.data || []).sort((a, b) => {
                const priorityOrder = { 'Approved Pro': 0, 'Pro': 1, 'Photographer': 2, 'Hobbyist': 3 };
                const aPriority = priorityOrder[a.role] ?? 99;
                const bPriority = priorityOrder[b.role] ?? 99;
                return aPriority - bPriority;
              });
              
              setOnDemandPhotographers(sorted);
            } catch (e) {
              logger.error('Error fetching on-demand photographers:', e);
              setOnDemandPhotographers([]);
            }
            setOnDemandLoading(false);
          },
          (error) => {
            logger.error('Geolocation error:', error);
            toast.error('Location access required for On-Demand requests');
            setOnDemandLoading(false);
          }
        );
      } else {
        toast.error('Geolocation not supported');
        setOnDemandLoading(false);
      }
    } catch (e) {
      logger.error('Error in fetchOnDemandPhotographers:', e);
      setOnDemandLoading(false);
    }
  };

  // Handle On-Demand pro selection
  const handleSelectOnDemandPro = (pro) => {
    setSelectedOnDemandPro(pro);
    setShowOnDemandDrawer(true);
  };

  // Handle On-Demand request success
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
    // If needs to enable splitting first
    if (booking.needsEnableSplitting) {
      try {
        const response = await axios.post(`${API}/bookings/${booking.id}/enable-splitting?user_id=${user.id}`);
        if (response.data.success) {
          toast.success('Crew splitting enabled!');
          // Refresh booking with new invite code
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

  const tabs = [
    { id: 'lineup', label: 'The Lineup', icon: Users, count: 0, highlight: true },  // New Lineup tab
    { id: 'live_sessions', label: 'Live Sessions', icon: Zap, count: liveSessions.length },
    { id: 'on_demand', label: 'On-Demand', icon: Target, count: onDemandPhotographers.length },
    { id: 'find_buddies', label: 'Find Buddies', icon: Users, count: nearbyBookings.length },
    { id: 'scheduled', label: 'Scheduled', icon: CalendarClock, count: bookings.filter(b => b.status === 'Confirmed' || b.status === 'Pending').length },
    { id: 'past', label: 'Past', icon: History, count: bookings.filter(b => b.status === 'Completed').length },
    { id: 'live_now', label: 'Live Now', icon: Radio, count: livePhotographers.length },
  ];

  const scheduledBookings = bookings.filter(b => b.status === 'Confirmed' || b.status === 'Pending');
  const pastBookings = bookings.filter(b => b.status === 'Completed');

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
          <h1 className={`text-3xl font-bold ${textPrimaryClass}`} style={{ fontFamily: 'Oswald' }} data-testid="bookings-title">
            Sessions & Bookings
          </h1>
          <Button
            onClick={() => setShowJoinCodeModal(true)}
            variant="outline"
            size="sm"
            className={isLight ? 'border-gray-300' : 'border-zinc-700'}
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Join Code
          </Button>
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

        {/* Gold Pass Early Access Section - For all surfers */}
        {SURFER_ROLES.includes(user?.role) && (
          <GoldPassBookingsSection 
            user={user} 
            theme={theme} 
            onBookingComplete={fetchData}
          />
        )}

        {/* Tabs */}
        <div className={`flex border-b ${borderClass} mb-6 overflow-x-auto`}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors relative ${
                  isActive ? textPrimaryClass : textSecondaryClass
                }`}
                data-testid={`tab-${tab.id}`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.count > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 text-xs rounded-full ${
                    isActive ? 'bg-yellow-400 text-black' : isLight ? 'bg-gray-200 text-gray-600' : 'bg-zinc-700 text-gray-300'
                  }`}>
                    {tab.count}
                  </span>
                )}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-yellow-400 to-orange-400" />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="space-y-4">
          {/* The Lineup Tab - Surf Session Lobby */}
          {activeTab === 'lineup' && (
            <LineupTab
              user={user}
              theme={theme}
              onOpenDirectory={() => setShowPhotographerDirectory(true)}
              onRefresh={fetchData}
            />
          )}

          {/* Live Sessions Tab */}
          {activeTab === 'live_sessions' && (
            <LiveSessionsTab
              liveSessions={liveSessions}
              onGoToLiveNow={() => setActiveTab('live_now')}
              onSessionLeft={(sessionId) => {
                setLiveSessions(prev => prev.filter(s => s.id !== sessionId));
              }}
              userId={user?.id}
              theme={theme}
            />
          )}

          {/* On-Demand Tab - Request a Photographer */}
          {activeTab === 'on_demand' && (
            <OnDemandTab
              user={user}
              onDemandPhotographers={onDemandPhotographers}
              onDemandLoading={onDemandLoading}
              userLocation={userLocation}
              activeDispatch={activeDispatch}
              onRefresh={fetchOnDemandPhotographers}
              onSelectPhotographer={handleSelectOnDemandPro}
              onResumeDispatch={(dispatch) => {
                // Resume the "Finding Your Photographer" workflow
                setSelectedOnDemandPro({ 
                  id: dispatch.photographer_id || 'unknown', 
                  full_name: dispatch.photographer_name || 'Photographer'
                });
                setResumeDispatchId(dispatch.id);
                setShowOnDemandDrawer(true);
              }}
              theme={theme}
            />
          )}

          {/* Scheduled Tab */}
          {activeTab === 'scheduled' && (
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
          )}

          {/* Find Buddies Tab */}
          {activeTab === 'find_buddies' && (
            <FindBuddiesTab
              nearbyBookings={nearbyBookings}
              selectedSkillFilter={selectedSkillFilter}
              onSkillFilterChange={fetchNearbyWithSkillFilter}
              onJoinNearbyBooking={handleJoinNearbyBooking}
              theme={theme}
            />
          )}

          {/* Past Tab */}
          {activeTab === 'past' && (
            <PastTab
              pastBookings={pastBookings}
              theme={theme}
            />
          )}

          {/* Live Now Tab */}
          {activeTab === 'live_now' && (
            <LiveNowTab
              livePhotographers={livePhotographers}
              subscriptionTier={subscriptionTier}
              trackingRadius={trackingRadius}
              onJumpIn={handleJumpIn}
              onNavigateToMap={() => navigate('/map')}
              theme={theme}
            />
          )}
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
              onClick={handleJoinByCode}
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
