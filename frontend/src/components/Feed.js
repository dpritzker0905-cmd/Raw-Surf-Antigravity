import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import apiClient from '../lib/apiClient';
import { createNotification } from '../services/notificationService';

import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePersona, getExpandedRoleInfo } from '../contexts/PersonaContext';
import { LivePhotographers } from './LivePhotographers';
import { PhotographerSessionDashboard } from './PhotographerSessionDashboard';
import { StoriesBar, CreateStoryModal } from './Stories';
import LiveStreamViewer from './LiveStreamViewer';
import { SocialAdCard, injectAdsIntoPosts } from './SocialAdCard';
import PostMenu, { SharePostModal } from './PostMenu';
import CreatePostModal from './CreatePostModal';
import PostCard from './PostCard';
import PostModal from './PostModal';
import FeedLineupCard from './FeedLineupCard';
import SessionCountdownWidget from './SessionCountdownWidget';
import WavesFeed from './WavesFeed';
import CreateWaveModal from './CreateWaveModal';
import { MapPin, Flame, Plus, X, Check, Loader2, Navigation, Play, Users, Sparkles, RefreshCw } from 'lucide-react';
import FeedSkeleton from './ui/FeedSkeleton';
import LastUpdatedBanner from './ui/LastUpdatedBanner';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { toast } from 'sonner';
import useFeedActions from '../hooks/useFeedActions';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import { ROLES } from '../constants/roles';
import { REACTION_EMOJIS } from '../constants/emojis';
import useSwipeTabs from '../hooks/useSwipeTabs';
import usePullToRefresh from '../hooks/usePullToRefresh';
import PullToRefreshIndicator from './ui/PullToRefreshIndicator';

// Tab order for the feed � used by swipe navigation and sliding indicator
const FEED_TABS = ['for_you', 'waves', 'following'];


// Role badge component for post authors
const _RoleBadge = ({ role }) => {
  const roleInfo = getExpandedRoleInfo(role);
  return (
    <span className={`text-sm ${roleInfo.color}`} title={roleInfo.label}>
      {roleInfo.icon}
    </span>
  );
};

// Reaction emojis � imported from centralized constants/emojis.js

// Dynamic Reaction Icon - Shows user's reaction or default Shaka
// Uses spring transition for smooth morphing animation (both ways)
// Logic:
//   - hasNonShakaReaction: Show that emoji
//   - isLiked (checked Shaka): Show colored Shaka
//   - else: Show grayscale (unchecked) Shaka
const _ReactionIcon = ({ post, userId, isLiked }) => {
  // Find user's reaction on this post
  const userReaction = post.reactions?.find(r => r.user_id === userId);
  const hasNonShakaReaction = userReaction && userReaction.emoji !== '??';
  
  // Determine if Shaka should be colored (checked) or grayscale (unchecked)
  // Only colored if liked AND no other reaction
  const shakaIsChecked = isLiked && !hasNonShakaReaction;
  
  // Spring animation CSS for both icon swap and reversion
  const springTransition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  
  return (
    <div 
      className="relative w-7 h-7 flex items-center justify-center overflow-visible"
      style={{ transition: springTransition }}
    >
      {hasNonShakaReaction ? (
        // Show the selected emoji (Fire, Wave, Heart) with spring animation
        <span 
          key={userReaction.emoji} // Key forces re-render for animation
          className="text-2xl animate-in zoom-in-75 duration-300"
          style={{ 
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
            transform: 'scale(1.1)',
            transition: springTransition
          }}
        >
          {userReaction.emoji}
        </span>
      ) : (
        // Show default Shaka - colored if checked, grayscale if unchecked
        <img loading="lazy" decoding="async" 
          key={shakaIsChecked ? "shaka-checked" : "shaka-unchecked"} // Key forces re-render
          src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f919.svg"
          alt="shaka"
          className="animate-in zoom-in-75 duration-300"
          style={{ 
            width: '28px', 
            height: '28px',
            filter: shakaIsChecked ? 'none' : 'grayscale(100%) brightness(1.5)',
            transition: springTransition
          }}
          draggable="false"
        />
      )}
    </div>
  );
};

// Shaka icon using Twemoji image for consistent rendering (kept for backwards compat)
const _ShakaIcon = ({ filled }) => (
  <img loading="lazy" decoding="async" 
    src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f919.svg"
    alt="shaka"
    style={{ 
      width: '28px', 
      height: '28px',
      filter: filled ? 'none' : 'grayscale(100%) brightness(1.5)',
      transition: 'filter 0.2s ease'
    }}
    draggable="false"
  />
);

// Reaction Picker Component - Anchored near the Shaka button, not screen center
// Uses a 2-row grid on mobile so all 10 emojis fit without overflow
const ReactionPicker = ({ show, onSelect, onClose, anchor }) => {
  if (!show) return null;

  // Container width: 5 emojis per row at 44px each + 8px gaps + padding
  const EDGE_PAD = 12;
  const PICKER_W = Math.min(window.innerWidth - EDGE_PAD * 2, 300);
  const PICKER_H = 108;       // approx height for 2-row layout
  const MARGIN = 10;

  let left = (anchor?.x ?? window.innerWidth / 2) - PICKER_W / 2;
  let top = (anchor?.y ?? window.innerHeight / 2) - PICKER_H - MARGIN;

  // Clamp horizontally
  left = Math.max(EDGE_PAD, Math.min(left, window.innerWidth - PICKER_W - EDGE_PAD));
  // If goes off top, show below the button
  if (top < EDGE_PAD) {
    top = (anchor?.y ?? window.innerHeight / 2) + MARGIN + 36;
  }

  return (
    <div 
      className="fixed bg-zinc-900/95 backdrop-blur-md border border-zinc-600 rounded-2xl px-3 py-3 shadow-2xl animate-in zoom-in-95 duration-200"
      style={{ 
        zIndex: 99999,
        left: `${left}px`,
        top: `${top}px`,
        width: `${PICKER_W}px`,
        pointerEvents: 'auto'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Close button top-right */}
      <button 
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center text-gray-500 hover:text-white rounded-full hover:bg-zinc-700/50"
        style={{ zIndex: 1 }}
      >
        <X className="w-3.5 h-3.5" />
      </button>
      {/* 5�2 grid of emojis */}
      <div className="grid grid-cols-5 gap-1 justify-items-center">
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={(e) => { e.stopPropagation(); onSelect(emoji); }}
            className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-zinc-700/60 active:scale-90 transition-transform duration-100"
            style={{ fontSize: '24px' }}
            data-testid={`feed-reaction-${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
};

// Overlay backdrop for reaction picker - tapping outside closes the menu
const ReactionOverlay = ({ show, onClose }) => {
  if (!show) return null;
  
  return (
    <div 
      className="fixed inset-0 bg-black/30"
      style={{ zIndex: 99998 }}
      onClick={onClose}
    />
  );
};

export const Feed = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { getEffectiveRole, _isMasked } = usePersona();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get effective role for UI rendering (respects God Mode persona masking)
  const effectiveRole = getEffectiveRole(user?.role);
  // Stale-while-revalidate: load cached feed instantly, refresh in background
  const [posts, setPosts] = useState(() => {
    try {
      const cached = localStorage.getItem('rawsurf_cached_feed');
      if (cached) return JSON.parse(cached);
    } catch { /* ignore parse errors */ }
    return [];
  });
  const [loading, setLoading] = useState(() => {
    try { return !localStorage.getItem('rawsurf_cached_feed'); } catch { return true; }
  });
  const [feedLastUpdated, setFeedLastUpdated] = useState(null);
  const { isOnline, _queueAction } = useOfflineQueue();
  const [streak, setStreak] = useState({ current_streak: 0, checked_in_today: false });
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [showCreateStoryModal, setShowCreateStoryModal] = useState(false);
  const [showCreatePostModal, setShowCreatePostModal] = useState(false);
  const [showCreateWaveModal, setShowCreateWaveModal] = useState(false);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [spots, setSpots] = useState([]);
  // Read ?tab= from URL to allow deep-linking (e.g. from Explore ? View All Waves)
  const initialTab = (() => {
    const params = new URLSearchParams(location.search);
    const t = params.get('tab');
    return ['for_you', 'waves', 'following'].includes(t) ? t : 'for_you';
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [storyTier, setStoryTier] = useState('all'); // Synced with StoriesBar: 'all', 'photographers', 'surfers'
  const [checkInData, setCheckInData] = useState({
    spot_id: '',
    conditions: '',
    wave_height: '',
    notes: '',
    latitude: null,
    longitude: null,
    use_gps: false
  });
  const [gpsLoading, setGpsLoading] = useState(false);
  const [nearestSpot, setNearestSpot] = useState(null);
  const [storiesKey, setStoriesKey] = useState(0);
  // Location hierarchy for manual drill-down: Country ? State/Province ? City/Area ? Spot
  const [locationHierarchy, setLocationHierarchy] = useState({ countries: [] });
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  // Gamification reward card shown after successful GPS check-in
  const [checkInReward, setCheckInReward] = useState(null);

  
  // Live Stream Viewer state - for joining live broadcasts from feed
  const [liveStreamInfo, setLiveStreamInfo] = useState(null);
  const [showLiveViewer, setShowLiveViewer] = useState(false);
  const [liveUsers, setLiveUsers] = useState([]);
  const [connectingToStream, setConnectingToStream] = useState(null);

  // -- Instagram-style "new posts" chip state --------------------------------------
  const [newPostsChip, setNewPostsChip] = useState(0); // count of new posts waiting to load
  const [isRefreshing, setIsRefreshing] = useState(false);
  const latestPostIdRef = useRef(null); // track the most-recent post id we've rendered
  
  // Post modal state - Instagram-style popup
  const [postModalOpen, setPostModalOpen] = useState(null);
  
  // Feed Lineup Cards state - The Lineup integration
  const [feedLineups, setFeedLineups] = useState([]);
  const [_feedLineupsLoading, setFeedLineupsLoading] = useState(false);
  
  // Upcoming Sessions state - Session Countdown Widget
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [_upcomingSessionsLoading, setUpcomingSessionsLoading] = useState(false);
  
  // Comment state
  const [commentInputs, setCommentInputs] = useState({});  // Track comment text per post
  const [showAllComments, setShowAllComments] = useState({});  // Track which posts show all comments
  const [allComments, setAllComments] = useState({});  // Store all comments per post
  const [loadingComments, setLoadingComments] = useState({});
  
  // Reaction state
  const [showReactionPicker, setShowReactionPicker] = useState(null);  // post ID or null
  const [pickerAnchor, setPickerAnchor] = useState(null);  // {x, y} for positioning picker near the button
  const [pressingPostId, setPressingPostId] = useState(null);  // Track which shaka is being pressed
  const longPressTimerRef = useRef(null);
  
  // Collaboration state - "I Was There" feature
  const [showCollaboratorsModal, setShowCollaboratorsModal] = useState(null);  // post ID or null
  const [_collaborationLoading, setCollaborationLoading] = useState(null);  // post ID when loading
  
  // Following state for photographer posts
  const [followingUsers, setFollowingUsers] = useState(new Set());
  const [_followLoading, setFollowLoading] = useState(null);  // user ID when loading
  
  // Post menu state
  const [postMenuOpen, setPostMenuOpen] = useState(null);  // post object or null
  
  // Share modal state
  const [sharePostOpen, setSharePostOpen] = useState(null);  // post object or null
  
  // Check if user is a photographer (use effective role for God Mode)
  const isPhotographer = ['Grom Parent', 'Hobbyist', 'Photographer', 'Approved Pro'].includes(effectiveRole);
  
  // Grom Parent has restricted access - no active session dashboard or commerce features
  const isGromParent = effectiveRole === ROLES.GROM_PARENT || user?.is_grom_parent === true;
  
  // Can show session dashboard (photographers except Grom Parent)
  const canShowSessionDashboard = isPhotographer && !isGromParent;

  useEffect(() => {
    // Critical path: posts load first (blocks UI skeleton)
    fetchPosts();
    if (user?.id) fetchStreak();

    // Deferred: secondary data loads after posts render (~1.5s delay)
    // Prevents 8 simultaneous API calls competing on Render cold-starts
    const deferTimer = setTimeout(() => {
      fetchLiveUsers();
      if (user?.id) {
        fetchFollowing();
        fetchFeedLineups();
        fetchUpcomingSessions();
      }
    }, 1500);

    // Spots + location hierarchy lazy-loaded on check-in modal open

    // Poll for live users every 30 seconds
    const liveInterval = setInterval(fetchLiveUsers, 30000);
    
    // Refresh upcoming sessions when user returns to the page/tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user?.id) {
        fetchUpcomingSessions();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Also refresh when window gets focus
    const handleFocus = () => {
      if (user?.id) {
        fetchUpcomingSessions();
      }
    };
    window.addEventListener('focus', handleFocus);
    
    return () => {
      clearTimeout(deferTimer);
      clearInterval(liveInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user?.id]);

  // Static Open Graph meta tags for Feed page social sharing
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
    document.title = 'Feed � Raw Surf';
    setMeta('og:title', 'Feed � Raw Surf');
    setMeta('og:description', 'Your surf feed � posts, waves, live sessions, and community updates on Raw Surf.');
    setMeta('og:url', `${window.location.origin}/feed`);
    setMeta('og:type', 'website');
    setMeta('og:site_name', 'Raw Surf');
    return () => {
      document.title = 'Raw Surf';
      ogTags.forEach(tag => tag.remove());
    };
  }, []);

  // -- feed:refresh event listener (logo click + 60s auto-refresh from Sidebar) --
  // ============ HANDLERS EXTRACTED TO hooks/useFeedActions.js ============
  const {
    handleFeedRefresh,
    handleLoadNewPosts,
    fetchFeedLineups,
    fetchUpcomingSessions,
    fetchLiveUsers,
    fetchFollowing,
    handleFollowFromFeed,
    handleUnfollowFromMenu,
    handlePostUpdated,
    handlePostDeleted,
    handleJoinLive,
    fetchPosts,
    fetchStreak,
    fetchSpots,
    fetchLocationHierarchy,
    calculateDistance,
    getGpsLocation,
    handleLike,
    handleShakaTapToggle,
    handleShakaPointerDown,
    handleShakaPointerUp,
    handleShakaPointerLeave,
    handleReaction,
    handleSavePost,
    handleCommentSubmit,
    loadAllComments,
    hideAllComments,
    handleIWasThere,
    handleViewCollaborators,
    handleCheckIn,
    submitCheckIn,
    closeCheckInModal,
  } = useFeedActions({
    user, navigate, activeTab, selectedCountry, selectedState, selectedCity,
    posts,
    latestPostIdRef,
    isPhotographer,
    spots,
    showReactionPicker,
    commentInputs,
    postModalOpen,
    postMenuOpen,
    showAllComments,
    nearestSpot,
    checkInData,
    setAllComments,
    setCheckInData,
    setCheckInLoading,
    setCheckInReward,
    setCollaborationLoading,
    setCommentInputs,
    setConnectingToStream,
    setFeedLastUpdated,
    setFeedLineups,
    setFeedLineupsLoading,
    setFollowLoading,
    setFollowingUsers,
    setGpsLoading,
    setIsRefreshing,
    setLiveStreamInfo,
    setLiveUsers,
    setLoading,
    setLoadingComments,
    setLocationHierarchy,
    setNearestSpot,
    setNewPostsChip,
    setPickerAnchor,
    setPostMenuOpen,
    setPostModalOpen,
    setPosts,
    setPressingPostId,
    setSelectedCity,
    setSelectedCountry,
    setSelectedState,
    setShowAllComments,
    setShowCheckInModal,
    setShowCollaboratorsModal,
    setShowLiveViewer,
    setShowReactionPicker,
    setSpots,
    setStreak,
    setUpcomingSessions,
    setUpcomingSessionsLoading,
  });

  useEffect(() => {
    window.addEventListener('feed:refresh', handleFeedRefresh);
    return () => window.removeEventListener('feed:refresh', handleFeedRefresh);
  }, [handleFeedRefresh]);

  // Track the latest rendered post id so we can detect new arrivals
  useEffect(() => {
    if (posts.length > 0 && !latestPostIdRef.current) {
      latestPostIdRef.current = posts[0]?.id ?? null;
    }
  }, [posts]);

  // Load new posts when user taps the chip

  // Fetch feed lineups for display in feed

  // Fetch upcoming booked sessions for countdown widget

  // Fetch currently live users

  // Fetch who the current user is following

  // Handle following a photographer from the feed

  // Handle unfollowing a user from the post menu

  // Handle post updates from menu (edit, settings change)

  // Handle post deletion

  // Handle joining a live stream from post author





  // Calculate distance between two points

  // Get GPS location for check-in � two-attempt strategy for iPhone 16 / iOS Safari


  // Shaka button gesture handlers (500ms threshold)
  // Quick tap = instant Shaka like OR clear active reaction
  // Long press (500ms) = opens reaction menu which STAYS OPEN
  const longPressTriggeredRef = useRef(false);
  const touchStartTimeRef = useRef(0);
  
  // Handle tap on Shaka button - Toggle logic
  // Tap on ANY active state ? revert to UNCHECKED Shaka
  // Tap on unchecked Shaka ? check it (like)
  





  // Comment functions



  // "I Was There" Collaboration handlers






  // Swipeable tab navigation � hooks must be called before any early returns
  const swipeHandlers = useSwipeTabs(FEED_TABS, activeTab, setActiveTab);
  const activeTabIndex = FEED_TABS.indexOf(activeTab);

  // Pull-to-refresh for mobile � triggers feed refresh on swipe-down
  const { pullRef, isPulling, pullProgress, isRefreshing: isPtrRefreshing } = usePullToRefresh(
    async () => { await fetchPosts(); },
    { threshold: 60, enabled: !loading }
  );

  if (loading) {
    return (
      <div className="max-w-xl mx-auto theme-main-content pt-4 px-2">
        <FeedSkeleton count={4} />
      </div>
    );
  }

  // Get theme-specific classes
  const isLight = theme === 'light';
  const _isDark = theme === 'dark';
  const isBeach = theme === 'beach';
  
  // Main background: white for light, dark gray for dark, pure black for beach
  const mainBgClass = isLight ? 'bg-white' : isBeach ? 'bg-black' : 'bg-zinc-900';
  // Post card: white for light, dark gray for dark, slightly lighter black for beach
  const postCardBgClass = isLight ? 'bg-white' : isBeach ? 'bg-zinc-950' : 'bg-zinc-800/50';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  // Beach mode gets brighter secondary text for better visibility on the beach
  const textSecondaryClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-900' : 'border-zinc-800';

  return (
    <div ref={pullRef} className={`max-w-xl mx-auto ${mainBgClass} min-h-screen transition-colors duration-300`} data-testid="feed-container">
      {/* Pull to Refresh Indicator */}
      <PullToRefreshIndicator isPulling={isPulling} progress={pullProgress} isRefreshing={isPtrRefreshing} />
      {/* Offline / stale data banner */}
      <LastUpdatedBanner
        lastUpdatedAt={feedLastUpdated}
        isOnline={isOnline}
        onRefresh={fetchPosts}
      />
      {/* Stories Bar at Top */}
      <StoriesBar 
        key={storiesKey}
        onCreateStory={() => setShowCreateStoryModal(true)}
        selectedTier={storyTier}
        onTierChange={(tier) => setStoryTier(tier)}
      />

      {/* Create Story Modal */}
      <CreateStoryModal
        isOpen={showCreateStoryModal}
        onClose={() => setShowCreateStoryModal(false)}
        onCreated={() => setStoriesKey(k => k + 1)}
      />

      {/* -- Instagram-style "New Posts" chip -- */}
      {newPostsChip > 0 && (
        <div className="flex justify-center py-2 sticky top-14 z-20" aria-live="polite" aria-atomic="true">
          <button
            onClick={handleLoadNewPosts}
            aria-label={`Load ${newPostsChip} new post${newPostsChip !== 1 ? 's' : ''}`}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold shadow-lg transition-all active:scale-95
              bg-yellow-400 text-black hover:bg-yellow-300"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {newPostsChip} new post{newPostsChip !== 1 ? 's' : ''}
          </button>
        </div>
      )}
      {/* Subtle spinner on manual refresh (no new posts chip) */}
      {isRefreshing && newPostsChip === 0 && (
        <div className="flex justify-center py-1">
          <RefreshCw className="w-4 h-4 text-yellow-400 animate-spin" />
        </div>
      )}

      {/* Photographer Session Dashboard - NOT shown to Grom Parents */}
      {canShowSessionDashboard && (
        <div className="p-4">
          <PhotographerSessionDashboard />
        </div>
      )}

      {/* Live Photographers Section (for surfers) */}
      {!isPhotographer && <LivePhotographers />}

      {/* Feed Tabs � with sliding indicator */}
      <div className={`relative flex border-b ${borderClass}`}>
        <button
          onClick={() => setActiveTab('for_you')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === 'for_you' ? textPrimaryClass : textSecondaryClass
          }`}
          data-testid="tab-for-you"
          aria-label="For You feed tab"
        >
          For You
        </button>
        <button aria-label="Play"
          onClick={() => setActiveTab('waves')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === 'waves' ? textPrimaryClass : textSecondaryClass
          }`}
          data-testid="tab-waves"
          aria-label="Waves video tab"
        >
          <span className="flex items-center justify-center gap-1">
            <Play className="w-3.5 h-3.5" />
            Waves
          </span>
        </button>
        <button
          onClick={() => setActiveTab('following')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === 'following' ? textPrimaryClass : textSecondaryClass
          }`}
          data-testid="tab-following"
          aria-label="Following feed tab"
        >
          Following
        </button>
        {/* Sliding indicator � transitions smoothly between tabs */}
        <div
          className="absolute bottom-0 h-0.5 rounded-full transition-all duration-300 ease-out"
          style={{
            width: `${100 / FEED_TABS.length}%`,
            left: `${(activeTabIndex * 100) / FEED_TABS.length}%`,
            background: activeTab === 'waves'
              ? 'linear-gradient(to right, #22d3ee, #3b82f6)'
              : 'linear-gradient(to right, #facc15, #f97316)',
          }}
        />
      </div>

      {/* Swipeable content area � touch handlers enable left/right tab swiping */}
      <div {...swipeHandlers} style={{ touchAction: 'pan-y' }}>

      {/* Waves Tab - Full Screen Video Feed */}
      {activeTab === 'waves' && (
        <div className="relative" style={{ height: 'calc(100vh - 200px)', minHeight: '500px' }}>
          <WavesFeed feedType="for_you" onCreateWave={() => setShowCreateWaveModal(true)} />
          {/* Floating Create Wave Button */}
          <button aria-label="Add"
            onClick={() => setShowCreateWaveModal(true)}
            className="absolute bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 shadow-lg flex items-center justify-center text-white z-10 hover:scale-105 transition-transform"
            data-testid="create-wave-fab"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      )}

      {/* Regular Feed Content (For You / Following) */}
      {activeTab !== 'waves' && (
        <>
          {/* Action Bar: Check In, Streak, Post */}
          <div className={`flex items-center gap-3 px-4 py-3 border-b ${borderClass}`}>
            <button
              onClick={handleCheckIn}
              disabled={streak.checked_in_today}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-colors ${
                streak.checked_in_today
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : isLight ? 'bg-gray-100 hover:bg-gray-200 text-gray-800' : 'bg-zinc-800 hover:bg-zinc-700 text-white'
              }`}
              data-testid="check-in-btn"
            >
              {streak.checked_in_today ? (
                <Check className="w-4 h-4" />
              ) : (
                <MapPin className="w-4 h-4" />
              )}
              {streak.checked_in_today ? 'Checked In' : 'Check In'}
            </button>

            <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/30 rounded-full">
              <Flame className="w-4 h-4 text-orange-400" />
              <span className="text-sm text-orange-400 font-medium">
                {streak.current_streak} day{streak.current_streak !== 1 ? 's' : ''}
              </span>
            </div>

            <button aria-label="Add"
              onClick={() => setShowCreatePostModal(true)}
              className="ml-auto flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 rounded-full text-sm text-black font-medium transition-colors"
              data-testid="create-post-btn"
            >
              <Plus className="w-4 h-4" />
              Post
            </button>
          </div>

          {/* Session Countdown Widget - Show upcoming booked sessions */}
          {upcomingSessions.length > 0 && (
            <div className={`px-4 py-3 border-b ${borderClass}`}>
              <SessionCountdownWidget
                bookings={upcomingSessions}
                isLight={isLight}
                onViewDetails={(booking) => {
                  // Photographers go to their booking manager, surfers go to bookings page
                  if (isPhotographer) {
                    navigate(`/photographer/bookings?session=${booking.id}`);
                  } else {
                    navigate(`/bookings?tab=scheduled&session=${booking.id}`);
                  }
                }}
                maxDisplay={2}
              />
            </div>
          )}

          {/* Posts Feed */}
          <div className={`divide-y ${borderClass}`}>
            {/* Lineup Cards at top of feed */}
            {feedLineups.length > 0 && (
              <div className="px-4 py-2">
                {feedLineups.slice(0, 1).map(lineup => (
                  <FeedLineupCard
                    key={`lineup-${lineup.id}`}
                    lineup={lineup}
                    user={user}
                    isLight={isLight}
                    onJoinSuccess={() => {
                      fetchFeedLineups();
                      toast.success('You joined the lineup!');
                    }}
                  />
                ))}
              </div>
            )}
            
            {posts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                {activeTab === 'following' ? (
                  <>
                    <Users className={`w-12 h-12 mb-3 ${textSecondaryClass} opacity-40`} />
                    <p className={`font-semibold text-lg mb-1 ${textPrimaryClass}`}>Your feed is empty</p>
                    <p className={`text-sm mb-5 ${textSecondaryClass}`}>Follow photographers and surfers to see their latest posts here.</p>
                    <button
                      onClick={() => navigate('/explore')}
                      className="px-6 py-2.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-semibold shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all active:scale-95"
                      aria-label="Discover photographers to follow"
                    >
                      Discover Photographers
                    </button>
                  </>
                ) : activeTab === 'waves' ? (
                  <>
                    <Play className={`w-12 h-12 mb-3 ${textSecondaryClass} opacity-40`} />
                    <p className={`font-semibold text-lg mb-1 ${textPrimaryClass}`}>No waves yet</p>
                    <p className={`text-sm ${textSecondaryClass}`}>Short video clips from the surf community will appear here.</p>
                  </>
                ) : (
                  <>
                    <Sparkles className={`w-12 h-12 mb-3 ${textSecondaryClass} opacity-40`} />
                    <p className={`font-semibold text-lg mb-1 ${textPrimaryClass}`}>No posts yet</p>
                    <p className={`text-sm ${textSecondaryClass}`}>Be the first to share a moment from the water!</p>
                  </>
                )}
              </div>
            ) : (
          injectAdsIntoPosts(posts, user?.is_ad_supported).map((post, index) => (
            <React.Fragment key={post.id}>
              {/* Inject lineup card after every 5th post */}
              {index > 0 && index % 5 === 0 && feedLineups[Math.floor(index / 5)] && (
                <div className="px-4">
                  <FeedLineupCard
                    lineup={feedLineups[Math.floor(index / 5)]}
                    user={user}
                    isLight={isLight}
                    onJoinSuccess={() => fetchFeedLineups()}
                  />
                </div>
              )}
              {/* Render Ad Card if this is an ad slot */}
              {post.isAd ? (
                <SocialAdCard position={post.adPosition} />
              ) : (
                <PostCard
                key={post.id}
                post={post}
                user={user}
                isLight={isLight}
                textPrimaryClass={textPrimaryClass}
                textSecondaryClass={textSecondaryClass}
                borderClass={borderClass}
                postCardBgClass={postCardBgClass}
                liveUsers={liveUsers}
                connectingToStream={connectingToStream}
                followingUsers={followingUsers}
                commentInputs={commentInputs}
                showAllComments={showAllComments}
                allComments={allComments}
                loadingComments={loadingComments}
                isPressing={pressingPostId === post.id}
                onNavigateProfile={(authorId) => navigate(`/profile/${authorId}`)}
                onPostMenuOpen={setPostMenuOpen}
                onSharePost={setSharePostOpen}
                onSavePost={handleSavePost}
                onLikeStart={handleShakaPointerDown}
                onLikeEnd={handleShakaPointerUp}
                onLikeLeave={handleShakaPointerLeave}
                onCommentChange={(postId, val) => setCommentInputs(prev => ({ ...prev, [postId]: val }))}
                onCommentSubmit={handleCommentSubmit}
                onLoadAllComments={loadAllComments}
                onHideAllComments={hideAllComments}
                onJoinLive={handleJoinLive}
                onIWasThere={handleIWasThere}
                onViewCollaborators={handleViewCollaborators}
                onFollowFromFeed={handleFollowFromFeed}
                onImageClick={setPostModalOpen}
              />
              )}
            </React.Fragment>
          ))
        )}
          </div>

          {/* Global Reaction Picker Overlay - renders on top of everything */}
          <ReactionOverlay 
            show={showReactionPicker !== null} 
            onClose={() => { setShowReactionPicker(null); setPickerAnchor(null); }} 
          />
          {showReactionPicker !== null && (
            <ReactionPicker 
              show={true}
              anchor={pickerAnchor}
              onSelect={(emoji) => handleReaction(showReactionPicker, emoji)}
              onClose={() => { setShowReactionPicker(null); setPickerAnchor(null); }}
            />
          )}

          {/* Live Stream Viewer - for joining live broadcasts from feed */}
          <LiveStreamViewer
            isOpen={showLiveViewer}
            onClose={() => {
              setShowLiveViewer(false);
              setLiveStreamInfo(null);
              fetchLiveUsers(); // Refresh live status
            }}
            streamInfo={liveStreamInfo}
          />
        </>
      )}

      </div>{/* end swipeable content area */}

      {/* Check In Modal */}
      <Dialog open={showCheckInModal} onOpenChange={closeCheckInModal}>
        <DialogContent className="bg-zinc-900 border border-zinc-700 text-white max-w-md w-full max-h-[90vh] flex flex-col p-0 overflow-hidden" aria-describedby="checkin-modal-description">
          {/* Fixed header */}
          <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-zinc-800">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <MapPin className="w-5 h-5 text-yellow-400" />
              Check In
            </DialogTitle>
            <DialogDescription id="checkin-modal-description" className="sr-only">
              Check in to a surf spot
            </DialogDescription>
          </DialogHeader>

          {/* Gamification Reward Card � shown after GPS check-in */}
          {checkInReward ? (
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 text-center">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center mb-4 shadow-lg shadow-yellow-400/30">
                <Flame className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-2xl font-black text-white mb-1">Checked In! ??</h3>
              <p className="text-gray-400 text-sm mb-6">{checkInReward.spot_name}</p>

              {/* XP earned */}
              {checkInReward.xp_earned > 0 && (
                <div className="flex items-center gap-2 bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-6 py-3 mb-3">
                  <Sparkles className="w-5 h-5 text-yellow-400" />
                  <span className="text-2xl font-black text-yellow-400">+{checkInReward.xp_earned} XP</span>
                </div>
              )}

              {/* First visit bonus */}
              {checkInReward.is_first_visit && (
                <div className="text-blue-400 text-sm font-medium mb-2">?? First visit to this spot!</div>
              )}

              {/* Badge earned */}
              {checkInReward.badge_earned && (
                <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-500/30 rounded-xl px-5 py-3 mb-3">
                  <span className="text-lg">??</span>
                  <div className="text-left">
                    <div className="text-xs text-purple-400 uppercase tracking-wide">Badge Earned</div>
                    <div className="text-white font-semibold capitalize">{checkInReward.badge_earned.replace(/_/g, ' ')}</div>
                  </div>
                </div>
              )}

              {/* Streak */}
              {checkInReward.streak_days > 0 && (
                <div className="text-orange-400 text-sm mb-6">
                  ?? {checkInReward.streak_days} day streak
                  {checkInReward.streak_days >= 7 ? ' � on fire!' : ' � keep it going!'}
                </div>
              )}

              <Button
                onClick={closeCheckInModal}
                className="w-full bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold h-12"
              >
                Awesome! ??
              </Button>
            </div>
          ) : (
            <>
              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

                {/* GPS Location Button */}
                <div>
                  <Button
                    onClick={getGpsLocation}
                    disabled={gpsLoading}
                    variant="outline"
                    className={`w-full ${
                      checkInData.latitude
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                        : 'border-zinc-700 text-white hover:bg-zinc-800'
                    }`}
                    data-testid="gps-checkin-btn"
                  >
                    {gpsLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Navigation className={`w-4 h-4 mr-2 ${checkInData.latitude ? 'text-emerald-400' : ''}`} />
                    )}
                    {gpsLoading ? 'Finding your location\u2026' : checkInData.latitude ? '\u2713 GPS Location Detected' : 'Use My GPS Location'}
                  </Button>

                  {/* GPS accuracy progress bar */}
                  {gpsLoading && (
                    <div className="mt-2 space-y-1.5">
                      <div className="h-1.5 rounded-full bg-zinc-700 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 rounded-full animate-pulse" style={{ width: '65%', transition: 'width 2s ease-out' }} />
                      </div>
                      <p className="text-xs text-zinc-400 text-center">Acquiring GPS signal � keep screen on</p>
                    </div>
                  )}

                  {/* GPS feedback */}
                  {nearestSpot && checkInData.latitude && (
                    <div className={`mt-2 p-2.5 rounded-lg text-xs ${
                      parseFloat(nearestSpot.distance) < 10
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                        : 'bg-zinc-800 border border-zinc-700 text-gray-400'
                    }`}>
                      <span className="font-medium">{nearestSpot.name}</span>
                      {' '}&mdash; {nearestSpot.distance}km away
                      {parseFloat(nearestSpot.distance) < 10
                        ? ' � ?? Within range � you\'ll earn Passport XP!'
                        : ' � Outside 10km check-in zone'}
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-zinc-700" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-zinc-900 px-2 text-gray-500">or select your spot</span>
                  </div>
                </div>

                {/* Country selector */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Country</label>
                  <Select
                    value={selectedCountry}
                    onValueChange={(v) => { setSelectedCountry(v); setSelectedState(''); setCheckInData(prev => ({ ...prev, spot_id: '' })); }}
                  >
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                      <SelectValue placeholder="Select a country" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700 max-h-60 overflow-y-auto">
                      {locationHierarchy.countries.map(c => (
                        <SelectItem key={c.name} value={c.name} className="text-white hover:bg-zinc-700">
                          {c.name} <span className="text-gray-500 text-xs ml-1">({c.spot_count} spots)</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* State/Province selector � only shown when country selected */}
                {selectedCountry && (() => {
                  const countryData = locationHierarchy.countries.find(c => c.name === selectedCountry);
                  const states = countryData?.states || [];
                  if (states.length === 0) return null;
                  return (
                    <div>
                      <label className="text-sm text-gray-400 mb-2 block">State / Province</label>
                      <Select
                        value={selectedState}
                        onValueChange={(v) => { setSelectedState(v); setSelectedCity(''); setCheckInData(prev => ({ ...prev, spot_id: '' })); }}
                      >
                        <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                          <SelectValue placeholder="Select a state / province" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700 max-h-60 overflow-y-auto">
                          {states.map(s => (
                            <SelectItem key={s.name} value={s.name} className="text-white hover:bg-zinc-700">
                              {s.name} <span className="text-gray-500 text-xs ml-1">({s.spot_count})</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })()}

                {/* City / Area selector � shown when state is selected */}
                {selectedState && (() => {
                  // First try cities from the hierarchy API response
                  const countryData = locationHierarchy.countries.find(c => c.name === selectedCountry);
                  const stateData = countryData?.states?.find(s => s.name === selectedState);
                  const apiCities = stateData?.cities || [];

                  // Fallback: derive cities directly from the loaded spots list
                  // (handles spots where state_province is null in the DB but region is set)
                  const spotsInState = spots.filter(s =>
                    s.country === selectedCountry &&
                    (selectedState ? s.state_province === selectedState : true)
                  );
                  const derivedCities = apiCities.length > 0
                    ? apiCities
                    : [...new Set(spotsInState.map(s => s.region).filter(Boolean))]
                        .sort()
                        .map(r => ({ name: r, spot_count: spotsInState.filter(s => s.region === r).length }));

                  if (derivedCities.length === 0) return null; // No regional data at all
                  return (
                    <div>
                      <label className="text-sm text-gray-400 mb-2 block">City / Area <span className="text-zinc-600 text-xs">(optional)</span></label>
                      <Select
                        value={selectedCity}
                        onValueChange={(v) => { setSelectedCity(v === '__all__' ? '' : v); setCheckInData(prev => ({ ...prev, spot_id: '' })); }}
                      >
                        <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                          <SelectValue placeholder="All areas (or pick one to narrow)" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700 max-h-60 overflow-y-auto">
                          <SelectItem value="__all__" className="text-zinc-400 hover:bg-zinc-700 italic">� All areas �</SelectItem>
                          {derivedCities.map(c => (
                            <SelectItem key={c.name} value={c.name} className="text-white hover:bg-zinc-700">
                              {c.name} <span className="text-gray-500 text-xs ml-1">({c.spot_count} {c.spot_count === 1 ? 'spot' : 'spots'})</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })()}

                {/* Spot selector � GPS-sorted when GPS active, filtered by hierarchy when manual */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">
                    Surf Spot
                    {checkInData.use_gps && checkInData.latitude && (
                      <span className="ml-2 text-xs text-cyan-400">?? sorted by distance</span>
                    )}
                  </label>
                  <Select
                    value={checkInData.spot_id}
                    onValueChange={(v) => setCheckInData(prev => ({ ...prev, spot_id: v }))}
                  >
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                      <SelectValue placeholder={
                        checkInData.use_gps && checkInData.latitude
                          ? 'Nearest spots listed first'
                          : selectedCountry ? 'Select a spot' : 'Select country first (or use GPS)'
                      } />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700 max-h-72 overflow-y-auto">
                      {(() => {
                        // GPS MODE: sort all spots by distance from user, show nearest first
                        if (checkInData.use_gps && checkInData.latitude && checkInData.longitude) {
                          return spots
                            .map(spot => ({
                              ...spot,
                              _dist: spot.latitude && spot.longitude
                                ? calculateDistance(checkInData.latitude, checkInData.longitude, spot.latitude, spot.longitude)
                                : Infinity
                            }))
                            .sort((a, b) => a._dist - b._dist)
                            .slice(0, 30) // limit to 30 nearest spots for readability
                            .map(spot => (
                              <SelectItem key={spot.id} value={spot.id} className="text-white hover:bg-zinc-700">
                                <span className="flex items-center justify-between w-full">
                                  <span>{spot.name}</span>
                                  <span className={`text-xs ml-2 ${
                                    spot._dist < 2 ? 'text-green-400' :
                                    spot._dist < 10 ? 'text-cyan-400' :
                                    'text-gray-500'
                                  }`}>
                                    {spot._dist === Infinity ? '' : `${spot._dist.toFixed(1)}km`}
                                  </span>
                                </span>
                              </SelectItem>
                            ));
                        }

                        // MANUAL MODE: filter by country ? state ? city hierarchy, sorted alphabetically
                        return spots
                          .filter(spot => {
                            if (!selectedCountry) return true;
                            if (spot.country !== selectedCountry) return false;
                            if (selectedState && spot.state_province !== selectedState) return false;
                            if (selectedCity && spot.region !== selectedCity) return false;
                            return true;
                          })
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((spot) => (
                            <SelectItem key={spot.id} value={spot.id} className="text-white hover:bg-zinc-700">
                              {spot.name}
                              {spot.region && <span className="text-gray-500 text-xs ml-1"> � {spot.region}</span>}
                            </SelectItem>
                          ));
                      })()}
                    </SelectContent>
                  </Select>
                </div>

                {/* Conditions */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Conditions</label>
                  <Select value={checkInData.conditions} onValueChange={(v) => setCheckInData(prev => ({ ...prev, conditions: v }))}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                      <SelectValue placeholder="How's it looking?" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      <SelectItem value="Glassy" className="text-white hover:bg-zinc-700">?? Glassy</SelectItem>
                      <SelectItem value="Clean" className="text-white hover:bg-zinc-700">? Clean</SelectItem>
                      <SelectItem value="Choppy" className="text-white hover:bg-zinc-700">?? Choppy</SelectItem>
                      <SelectItem value="Messy" className="text-white hover:bg-zinc-700">?? Messy</SelectItem>
                      <SelectItem value="Blown Out" className="text-white hover:bg-zinc-700">?? Blown Out</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Wave Height */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Wave Height</label>
                  <Select value={checkInData.wave_height} onValueChange={(v) => setCheckInData(prev => ({ ...prev, wave_height: v }))}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                      <SelectValue placeholder="How big?" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      <SelectItem value="Flat" className="text-white hover:bg-zinc-700">Flat</SelectItem>
                      <SelectItem value="1-2ft" className="text-white hover:bg-zinc-700">1-2ft</SelectItem>
                      <SelectItem value="2-3ft" className="text-white hover:bg-zinc-700">2-3ft</SelectItem>
                      <SelectItem value="3-4ft" className="text-white hover:bg-zinc-700">3-4ft</SelectItem>
                      <SelectItem value="4-6ft" className="text-white hover:bg-zinc-700">4-6ft</SelectItem>
                      <SelectItem value="6-8ft" className="text-white hover:bg-zinc-700">6-8ft</SelectItem>
                      <SelectItem value="8ft+" className="text-white hover:bg-zinc-700">8ft+ (Overhead+)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Notes */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Notes (optional)</label>
                  <Input
                    placeholder="How was your session?"
                    value={checkInData.notes}
                    onChange={(e) => setCheckInData(prev => ({ ...prev, notes: e.target.value }))}
                    className="bg-zinc-800 border-zinc-700 text-white placeholder-gray-500"
                  />
                </div>

                {/* GPS Passport XP info banner */}
                {checkInData.use_gps && checkInData.latitude && (checkInData.spot_id || nearestSpot) && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <Navigation className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-emerald-300">
                      <span className="font-medium">GPS-Verified Check-In:</span> Must be within 500m of the spot to earn Passport XP &amp; stamps.
                    </div>
                  </div>
                )}
              </div>

              {/* Fixed footer */}
              <div className="px-6 pb-6 pt-3 shrink-0 border-t border-zinc-800">
                <Button aria-label="Loader2"
                  onClick={submitCheckIn}
                  disabled={checkInLoading}
                  className="w-full h-12 bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold"
                  data-testid="feed-checkin-submit-btn"
                >
                  {checkInLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Flame className="w-5 h-5 mr-2" />
                      {checkInData.use_gps && (checkInData.spot_id || nearestSpot)
                        ? 'Check In + Earn XP ??'
                        : 'Check In & Keep Streak ??'}
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Collaborators Modal - "I Was There" Session Crew */}
      <Dialog open={showCollaboratorsModal !== null} onOpenChange={() => setShowCollaboratorsModal(null)}>
        <DialogContent className={`${isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-800'} max-w-md`} aria-describedby="collaborators-modal-description">
          <DialogHeader>
            <DialogTitle className={`text-xl font-bold flex items-center gap-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>
              <Users className="w-5 h-5 text-cyan-400" />
              Session Crew
            </DialogTitle>
            <DialogDescription id="collaborators-modal-description" className="sr-only">
              Surfers who were at this session
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3 pt-4 max-h-96 overflow-y-auto">
            {showCollaboratorsModal && posts.find(p => p.id === showCollaboratorsModal)?.collaborators?.filter(c => c.status === 'accepted').map((collab) => (
              <div 
                key={collab.id}
                className={`flex items-center gap-3 p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800'}`}
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center overflow-hidden">
                  {collab.avatar_url ? (
                    <img loading="lazy" decoding="async" src={getFullUrl(collab.avatar_url)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white font-bold">{collab.full_name?.charAt(0) || '?'}</span>
                  )}
                </div>
                <div className="flex-1">
                  <p className={`font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>
                    {collab.full_name}
                  </p>
                  <div className="flex items-center gap-2">
                    {collab.verified_by_gps && (
                      <span className="text-xs text-green-400 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        GPS Verified
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowCollaboratorsModal(null);
                    navigate(`/profile/${collab.user_id}`);
                  }}
                  className={isLight ? 'border-gray-300 text-gray-700' : 'border-zinc-600 text-white'}
                >
                  View
                </Button>
              </div>
            ))}
            
            {showCollaboratorsModal && (!posts.find(p => p.id === showCollaboratorsModal)?.collaborators?.some(c => c.status === 'accepted')) && (
              <div className={`text-center py-8 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No one else in this session yet</p>
                <p className="text-sm mt-1">Be the first to say "I Was There"!</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Post Modal */}
      <CreatePostModal
        isOpen={showCreatePostModal}
        onClose={() => setShowCreatePostModal(false)}
        onCreated={() => {
          fetchPosts();
          setShowCreatePostModal(false);
        }}
      />

      {/* Post Menu - Instagram-style options */}
      <PostMenu
        post={postMenuOpen}
        open={postMenuOpen !== null}
        onClose={() => setPostMenuOpen(null)}
        onPostUpdated={handlePostUpdated}
        onPostDeleted={handlePostDeleted}
        onIWasThere={() => postMenuOpen && handleIWasThere(postMenuOpen.id)}
        isFollowingAuthor={postMenuOpen ? followingUsers.has(postMenuOpen.author_id) : false}
        onFollow={handleFollowFromFeed}
        onUnfollow={handleUnfollowFromMenu}
      />
      
      {/* Share Post Modal - Direct share from feed */}
      <SharePostModal
        post={sharePostOpen}
        open={sharePostOpen !== null}
        onClose={() => setSharePostOpen(null)}
        isLight={isLight}
      />
      
      {/* Instagram-style Post Modal */}
      <PostModal
        post={postModalOpen}
        isOpen={postModalOpen !== null}
        onClose={() => setPostModalOpen(null)}
        onPostUpdated={handlePostUpdated}
        posts={posts.filter(p => !p.isAd)}
        onNavigatePost={(nextPost) => setPostModalOpen(nextPost)}
      />
      
      {/* Create Wave Modal */}
      <CreateWaveModal
        isOpen={showCreateWaveModal}
        onClose={() => setShowCreateWaveModal(false)}
        onSuccess={() => {
          setShowCreateWaveModal(false);
          // Refresh waves if on waves tab
          if (activeTab === 'waves') {
            // WavesFeed will handle its own refresh
          }
        }}
      />
    </div>
  );
};
