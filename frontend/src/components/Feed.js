import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import apiClient from '../lib/apiClient';

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
import { MapPin, Flame, Plus, Check, Loader2, Navigation, Play, Users, Sparkles, RefreshCw } from 'lucide-react';
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
import useSwipeTabs from '../hooks/useSwipeTabs';
import usePullToRefresh from '../hooks/usePullToRefresh';
import PullToRefreshIndicator from './ui/PullToRefreshIndicator';
import CheckInModal from './feed/CheckInModal';
import { ReactionPicker, ReactionOverlay } from './feed/ReactionPicker';

// Tab order for the feed - used by swipe navigation and sliding indicator
const FEED_TABS = ['for_you', 'waves', 'following'];



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
    document.title = 'Feed - Raw Surf';
    setMeta('og:title', 'Feed - Raw Surf');
    setMeta('og:description', 'Your surf feed - posts, waves, live sessions, and community updates on Raw Surf.');
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
    loadMorePosts,
    feedHasMoreRef,
    loadingMoreRef,
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
    loadingComments,
    streak,
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

  // ============ INFINITE SCROLL OBSERVER ============
  const loadMoreSentinelRef = useRef(null);
  
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && feedHasMoreRef.current && !loadingMoreRef.current) {
          loadMorePosts();
        }
      },
      { rootMargin: '400px' } // Start loading 400px before the sentinel is visible
    );
    
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMorePosts, feedHasMoreRef, loadingMoreRef, posts.length]); // Re-attach when posts change

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

  // Get GPS location for check-in - two-attempt strategy for iPhone 16 / iOS Safari


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






  // Swipeable tab navigation - hooks must be called before any early returns
  const swipeHandlers = useSwipeTabs(FEED_TABS, activeTab, setActiveTab);
  const activeTabIndex = FEED_TABS.indexOf(activeTab);

  // Pull-to-refresh for mobile - triggers feed refresh on swipe-down
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

      {/* Feed Tabs - with sliding indicator */}
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
        {/* Sliding indicator - transitions smoothly between tabs */}
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

      {/* Swipeable content area - touch handlers enable left/right tab swiping */}
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
                onDoubleTapLike={(postId) => handleReaction(postId, '\u{1F919}')}
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

          {/* ============ INFINITE SCROLL SENTINEL ============ */}
          {posts.length > 0 && (
            <div ref={loadMoreSentinelRef} className="flex justify-center py-6" id="feed-load-more-sentinel">
              {loadingMoreRef.current ? (
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  <span className={`text-xs ${textSecondaryClass}`}>Loading more...</span>
                </div>
              ) : !feedHasMoreRef.current ? (
                <p className={`text-xs ${textSecondaryClass} opacity-60`}>{'\uD83C\uDFC4'} You've seen all the posts!</p>
              ) : null}
            </div>
          )}

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

      {/* Check In Modal (Extracted to feed/CheckInModal.js) */}
      <CheckInModal
        open={showCheckInModal}
        onClose={closeCheckInModal}
        checkInData={checkInData}
        setCheckInData={setCheckInData}
        checkInLoading={checkInLoading}
        checkInReward={checkInReward}
        gpsLoading={gpsLoading}
        nearestSpot={nearestSpot}
        spots={spots}
        locationHierarchy={locationHierarchy}
        selectedCountry={selectedCountry}
        setSelectedCountry={setSelectedCountry}
        selectedState={selectedState}
        setSelectedState={setSelectedState}
        selectedCity={selectedCity}
        setSelectedCity={setSelectedCity}
        calculateDistance={calculateDistance}
        getGpsLocation={getGpsLocation}
        submitCheckIn={submitCheckIn}
      />

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
