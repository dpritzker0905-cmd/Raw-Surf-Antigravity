import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { MapPin, Flame, Plus, X, Check, Loader2, Navigation, Play, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';


// Role badge component for post authors
const _RoleBadge = ({ role }) => {
  const roleInfo = getExpandedRoleInfo(role);
  return (
    <span className={`text-sm ${roleInfo.color}`} title={roleInfo.label}>
      {roleInfo.icon}
    </span>
  );
};

// Valid surf-themed reactions (same as messenger)
const POST_REACTIONS = ['🤙', '🌊', '❤️', '🔥'];

// Dynamic Reaction Icon - Shows user's reaction or default Shaka
// Uses spring transition for smooth morphing animation (both ways)
// Logic:
//   - hasNonShakaReaction: Show that emoji
//   - isLiked (checked Shaka): Show colored Shaka
//   - else: Show grayscale (unchecked) Shaka
const _ReactionIcon = ({ post, userId, isLiked }) => {
  // Find user's reaction on this post
  const userReaction = post.reactions?.find(r => r.user_id === userId);
  const hasNonShakaReaction = userReaction && userReaction.emoji !== '🤙';
  
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
        <img 
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
  <img 
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
const ReactionPicker = ({ show, onSelect, onClose, anchor }) => {
  if (!show) return null;

  // Position above the Shaka button, clamped within viewport
  // anchor = { x: button center X, y: button top Y } in page coords
  const PICKER_WIDTH = 220;  // approximate picker width in px
  const PICKER_HEIGHT = 52;  // approximate picker height in px
  const MARGIN = 8;           // gap above the button

  let left = (anchor?.x ?? window.innerWidth / 2) - PICKER_WIDTH / 2;
  let top = (anchor?.y ?? window.innerHeight / 2) - PICKER_HEIGHT - MARGIN;

  // Clamp horizontally within viewport
  left = Math.max(8, Math.min(left, window.innerWidth - PICKER_WIDTH - 8));
  // Clamp vertically — if goes off top, show below button instead
  if (top < 8) {
    top = (anchor?.y ?? window.innerHeight / 2) + MARGIN + 36; // 36 ≈ button height
  }

  return (
    <div 
      className="fixed bg-zinc-900/95 backdrop-blur-sm border border-zinc-600 rounded-full px-2 py-1.5 flex items-center gap-1 shadow-2xl animate-in zoom-in-95 duration-200"
      style={{ 
        zIndex: 99999,
        left: `${left}px`,
        top: `${top}px`,
        pointerEvents: 'auto'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {POST_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(emoji);
          }}
          className="w-10 h-10 flex items-center justify-center text-2xl hover:scale-125 transition-all duration-150 hover:bg-zinc-700/50 rounded-full active:scale-95"
          style={{ fontSize: '26px' }}
          data-testid={`feed-reaction-${emoji}`}
        >
          {emoji}
        </button>
      ))}
      <button 
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white border-l border-zinc-600 ml-1 hover:bg-zinc-700/50 rounded-full"
      >
        <X className="w-4 h-4" />
      </button>
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
  
  // Get effective role for UI rendering (respects God Mode persona masking)
  const effectiveRole = getEffectiveRole(user?.role);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [streak, setStreak] = useState({ current_streak: 0, checked_in_today: false });
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [showCreateStoryModal, setShowCreateStoryModal] = useState(false);
  const [showCreatePostModal, setShowCreatePostModal] = useState(false);
  const [showCreateWaveModal, setShowCreateWaveModal] = useState(false);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [spots, setSpots] = useState([]);
  const [activeTab, setActiveTab] = useState('for_you');
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
  
  // Live Stream Viewer state - for joining live broadcasts from feed
  const [liveStreamInfo, setLiveStreamInfo] = useState(null);
  const [showLiveViewer, setShowLiveViewer] = useState(false);
  const [liveUsers, setLiveUsers] = useState([]); // Track users who are currently live
  const [connectingToStream, setConnectingToStream] = useState(null); // Track which user's stream we're connecting to
  
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
  const isGromParent = effectiveRole === 'Grom Parent' || user?.is_grom_parent === true;
  
  // Can show session dashboard (photographers except Grom Parent)
  const canShowSessionDashboard = isPhotographer && !isGromParent;

  useEffect(() => {
    fetchPosts();
    fetchStreak();
    fetchSpots();
    fetchLiveUsers();
    if (user?.id) {
      fetchFollowing();
      fetchFeedLineups();
      fetchUpcomingSessions();
    }
    
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
      clearInterval(liveInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user?.id]);

  // Fetch feed lineups for display in feed
  const fetchFeedLineups = async () => {
    if (!user?.id) return;
    
    try {
      setFeedLineupsLoading(true);
      const response = await apiClient.get(`/feed/lineups`, {
        params: { user_id: user.id, limit: 3 }
      });
      setFeedLineups(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch feed lineups:', error);
    } finally {
      setFeedLineupsLoading(false);
    }
  };

  // Fetch upcoming booked sessions for countdown widget
  const fetchUpcomingSessions = async () => {
    if (!user?.id) return;
    
    try {
      setUpcomingSessionsLoading(true);
      
      let upcoming = [];
      const now = new Date();
      
      // For photographers, get bookings where they are the photographer (client bookings)
      if (isPhotographer) {
        const response = await apiClient.get(`/photographer/${user.id}/bookings`);
        upcoming = (response.data || []).filter(b => {
          const sessionDate = new Date(b.session_date);
          const isActive = ['Confirmed', 'Pending', 'PendingPayment'].includes(b.status);
          const isFuture = sessionDate > now;
          return isActive && isFuture;
        }).slice(0, 2);
      } else {
        // For surfers, get bookings where they are a participant
        const response = await apiClient.get(`/bookings/user/${user.id}`, {
          params: { status: 'upcoming', limit: 5 }
        });
        upcoming = (response.data || []).filter(b => {
          const sessionDate = new Date(b.session_date);
          const isActive = ['Confirmed', 'Pending', 'PendingPayment'].includes(b.status);
          const isFuture = sessionDate > now;
          // Also check participant status isn't cancelled/refunded
          const participantActive = !['cancelled', 'refunded'].includes(b.participant_status?.toLowerCase());
          return isActive && isFuture && participantActive;
        }).slice(0, 2);
      }
      
      setUpcomingSessions(upcoming);
    } catch (error) {
      logger.error('Failed to fetch upcoming sessions:', error);
    } finally {
      setUpcomingSessionsLoading(false);
    }
  };

  // Fetch currently live users
  const fetchLiveUsers = async () => {
    try {
      const response = await apiClient.get(`/livekit/active-streams`);
      const liveUserIds = response.data.streams?.map(s => s.broadcaster_id) || [];
      setLiveUsers(liveUserIds);
    } catch (e) {
      // Ignore errors
    }
  };

  // Fetch who the current user is following
  const fetchFollowing = async () => {
    if (!user?.id) return;
    try {
      const response = await apiClient.get(`/following/${user.id}`);
      const followingIds = new Set(response.data.map(f => f.id));
      setFollowingUsers(followingIds);
    } catch (e) {
      // Ignore errors
    }
  };

  // Handle following a photographer from the feed
  const handleFollowFromFeed = async (photographerId) => {
    if (!user?.id) {
      toast.error('Please log in to follow');
      return;
    }
    
    setFollowLoading(photographerId);
    try {
      await apiClient.post(`/follow/${photographerId}?follower_id=${user.id}`);
      setFollowingUsers(prev => new Set([...prev, photographerId]));
      toast.success('Following! Check their profile for availability');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to follow');
    } finally {
      setFollowLoading(null);
    }
  };

  // Handle unfollowing a user from the post menu
  const handleUnfollowFromMenu = async (userId) => {
    if (!user?.id) return;
    try {
      await apiClient.delete(`/follow/${userId}?follower_id=${user.id}`);
      setFollowingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(userId);
        return newSet;
      });
      toast.success('Unfollowed');
    } catch (error) {
      toast.error('Failed to unfollow');
    }
  };

  // Handle post updates from menu (edit, settings change)
  const handlePostUpdated = (updatedPost) => {
    setPosts(prevPosts => prevPosts.map(p => 
      p.id === updatedPost.id ? { ...p, ...updatedPost } : p
    ));
  };

  // Handle post deletion
  const handlePostDeleted = (postId) => {
    if (!postId) return;
    // Remove from posts array and also clear any modal state
    setPosts(prevPosts => prevPosts.filter(p => p && p.id !== postId));
    // Close any open modals that might be showing the deleted post
    if (postModalOpen?.id === postId) {
      setPostModalOpen(null);
    }
    if (postMenuOpen?.id === postId) {
      setPostMenuOpen(null);
    }
  };

  // Handle joining a live stream from post author
  const handleJoinLive = async (authorId, authorName, authorAvatar) => {
    // Set connecting state to show pulse animation
    setConnectingToStream(authorId);
    
    try {
      const response = await apiClient.get(`/livekit/active-streams`);
      const liveStream = response.data.streams?.find(s => s.broadcaster_id === authorId);
      
      if (liveStream) {
        setLiveStreamInfo({
          id: liveStream.id,
          room_name: liveStream.room_name,
          broadcaster_id: liveStream.broadcaster_id,
          broadcaster_name: liveStream.broadcaster_name || authorName,
          broadcaster_avatar: liveStream.broadcaster_avatar || authorAvatar,
          viewer_count: liveStream.viewer_count,
          title: liveStream.title
        });
        setShowLiveViewer(true);
      } else {
        toast.error('Stream is no longer live');
        fetchLiveUsers();
      }
    } catch (error) {
      logger.error('Failed to get live stream info:', error);
      toast.error('Failed to join stream');
    } finally {
      // Clear connecting state
      setConnectingToStream(null);
    }
  };

  const fetchPosts = async () => {
    try {
      const response = await apiClient.get(`/posts`, {
        params: { user_id: user?.id }
      });
      if (response.data && response.data.length > 0) {
        // Map is_liked_by_user to liked for frontend state
        setPosts(response.data.map(post => ({
          ...post,
          liked: post.is_liked_by_user
        })));
      } else {
        // Fallback demo posts if no real posts
        setPosts([
          {
            id: 'demo-1',
            author_name: 'Pro Surfer Mike',
            author_avatar: null,
            media_url: 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=600',
            media_type: 'image',
            caption: 'Dawn patrol at its finest! 🤙',
            location: 'Pipeline, Hawaii',
            likes_count: 247,
            liked: false,
            created_at: new Date().toISOString()
          },
          {
            id: 'demo-2',
            author_name: 'SurfPhotog_Sarah',
            author_avatar: null,
            media_url: 'https://images.unsplash.com/photo-1455729552865-3658a5d39692?w=600',
            media_type: 'image',
            caption: 'Caught this beauty yesterday morning',
            location: 'Sebastian Inlet',
            likes_count: 189,
            liked: false,
            created_at: new Date().toISOString()
          },
          {
            id: 'demo-3',
            author_name: 'GromDad_FL',
            author_avatar: null,
            media_url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600',
            media_type: 'image',
            caption: 'Little one is getting better every day!',
            location: 'Cocoa Beach',
            likes_count: 312,
            liked: false,
            created_at: new Date().toISOString()
          }
        ]);
      }
    } catch (error) {
      logger.error('Error fetching posts:', error);
      // Demo posts for error state
      setPosts([
        {
          id: 'demo-1',
          author_name: 'Pro Surfer Mike',
          author_avatar: null,
          media_url: 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=600',
          media_type: 'image',
          caption: 'Dawn patrol at its finest! 🤙',
          location: 'Pipeline, Hawaii',
          likes_count: 247,
          liked: false,
          created_at: new Date().toISOString()
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const fetchStreak = async () => {
    if (!user?.id) return;
    try {
      const response = await apiClient.get(`/streak/${user.id}`);
      setStreak(response.data);
    } catch (error) {
      logger.error('Error fetching streak:', error);
    }
  };

  const fetchSpots = async () => {
    try {
      const response = await apiClient.get(`/surf-spots`);
      setSpots(response.data);
    } catch (error) {
      logger.error('Error fetching spots:', error);
    }
  };

  // Calculate distance between two points
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Get GPS location for check-in
  const getGpsLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported');
      return;
    }

    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        
        // Find nearest spot
        let nearest = null;
        let minDistance = Infinity;
        
        spots.forEach(spot => {
          const distance = calculateDistance(latitude, longitude, spot.latitude, spot.longitude);
          if (distance < minDistance) {
            minDistance = distance;
            nearest = { ...spot, distance: distance.toFixed(1) };
          }
        });
        
        setCheckInData(prev => ({
          ...prev,
          latitude,
          longitude,
          use_gps: true,
          spot_id: nearest && minDistance < 10 ? nearest.id : prev.spot_id
        }));
        
        setNearestSpot(nearest);
        toast.success(`Location found! ${nearest ? `Nearest: ${nearest.name} (${nearest.distance}km)` : ''}`);
        setGpsLoading(false);
      },
      (_error) => {
        toast.error('Unable to get location');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleLike = async (postId) => {
    if (!user?.id) {
      toast.error('Please log in to like posts');
      return;
    }
    
    // Find current post state
    const currentPost = posts.find(p => p.id === postId);
    const isCurrentlyLiked = currentPost?.liked;
    const currentLikesCount = currentPost?.likes_count || 0;
    
    // Optimistic update with toggle using functional update
    setPosts(prevPosts => prevPosts.map(p =>
      p.id === postId ? { 
        ...p, 
        likes_count: isCurrentlyLiked ? Math.max(0, p.likes_count - 1) : p.likes_count + 1, 
        liked: !isCurrentlyLiked 
      } : p
    ));
    
    try {
      const response = await apiClient.post(`/posts/${postId}/like?user_id=${user.id}`);
      // Update with actual server response using functional update
      setPosts(prevPosts => prevPosts.map(p =>
        p.id === postId ? { 
          ...p, 
          likes_count: response.data.likes_count, 
          liked: response.data.is_liked 
        } : p
      ));
    } catch (error) {
      // Revert on error using functional update
      setPosts(prevPosts => prevPosts.map(p =>
        p.id === postId ? { 
          ...p, 
          likes_count: currentLikesCount, 
          liked: isCurrentlyLiked 
        } : p
      ));
      toast.error('Failed to update like');
    }
  };

  // Shaka button gesture handlers (500ms threshold)
  // Quick tap = instant Shaka like OR clear active reaction
  // Long press (500ms) = opens reaction menu which STAYS OPEN
  const longPressTriggeredRef = useRef(false);
  const touchStartTimeRef = useRef(0);
  
  // Handle tap on Shaka button - Toggle logic
  // Tap on ANY active state → revert to UNCHECKED Shaka
  // Tap on unchecked Shaka → check it (like)
  const handleShakaTapToggle = async (postId) => {
    if (!user?.id) {
      toast.error('Please log in to react');
      return;
    }
    
    const currentPost = posts.find(p => p.id === postId);
    const userReaction = currentPost?.reactions?.find(r => r.user_id === user.id);
    const isLiked = currentPost?.liked;
    
    // Case 1: User has an active non-Shaka reaction (Fire, Wave, Heart) → CLEAR IT & UNLIKE
    if (userReaction && userReaction.emoji !== '🤙') {
      // Optimistic update - remove reaction AND set liked to false (unchecked Shaka)
      setPosts(prevPosts => prevPosts.map(p => {
        if (p.id === postId) {
          return {
            ...p,
            liked: false, // Global reset to unchecked state
            reactions: (p.reactions || []).filter(r => r.user_id !== user.id)
          };
        }
        return p;
      }));
      
      try {
        // Call API to remove the reaction (toggle it off)
        await apiClient.post(`/posts/${postId}/reactions?user_id=${user.id}`, { 
          emoji: userReaction.emoji 
        });
        // Also unlike if was liked
        if (isLiked) {
          await apiClient.post(`/posts/${postId}/like?user_id=${user.id}`);
        }
      } catch (error) {
        toast.error('Failed to clear reaction');
        fetchPosts();
      }
      return;
    }
    
    // Case 2: User has liked (checked Shaka) → Unlike (revert to unchecked)
    // Case 3: User has unchecked Shaka → Like (check it)
    handleLike(postId);
  };
  
  const handleShakaPointerDown = (postId, e) => {
    // Prevent any default browser behavior
    if (e.cancelable) {
      e.preventDefault();
    }
    
    // Capture the button's position for the picker to anchor to
    if (e.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect();
      setPickerAnchor({ x: rect.left + rect.width / 2, y: rect.top });
    }
    
    // Clear any existing timer first
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    
    touchStartTimeRef.current = Date.now();
    longPressTriggeredRef.current = false;
    
    // Set pressing state for visual feedback
    setPressingPostId(postId);
    
    // Set timer for long-press (600ms for more reliable mobile detection)
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      // Trigger haptic feedback when reaction picker appears
      if ('vibrate' in navigator) {
        navigator.vibrate(10);
      }
      setShowReactionPicker(postId);
    }, 600); // 600ms threshold - slightly longer for mobile reliability
  };

  const handleShakaPointerUp = (postId, e) => {
    // Prevent any default browser behavior
    if (e.cancelable) {
      e.preventDefault();
    }
    e.stopPropagation();
    
    // Clear pressing state
    setPressingPostId(null);
    
    // Always clear the timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    
    // If long-press triggered the menu, do nothing - menu stays open
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false; // Reset for next interaction
      return;
    }
    
    // If menu is already showing, don't do anything (let overlay handle close)
    if (showReactionPicker === postId) {
      return;
    }
    
    // Quick tap (< 600ms) = toggle reaction with proper reversion logic
    const pressDuration = Date.now() - touchStartTimeRef.current;
    if (pressDuration < 600) {
      handleShakaTapToggle(postId); // Use new toggle function with reversion logic
    }
  };

  const handleShakaPointerLeave = () => {
    // Clear pressing state and timer if finger/mouse leaves the button
    setPressingPostId(null);
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleReaction = async (postId, emoji) => {
    if (!user?.id) {
      toast.error('Please log in to react');
      return;
    }
    
    setShowReactionPicker(null);
    setPickerAnchor(null);  // Clear anchor position
    setPressingPostId(null); // Clear pressing state when picker closes

    
    // Find the post to get author info for notification
    const targetPost = posts.find(p => p.id === postId);
    
    // Check if user already has this reaction (for toggle logic)
    const existingReaction = targetPost?.reactions?.find(r => r.user_id === user.id && r.emoji === emoji);
    const isRemoving = !!existingReaction;
    
    // Special handling for shaka emoji - it maps to the "liked" state
    const isShakaEmoji = emoji === '🤙';
    
    // Optimistic update with animation trigger
    setPosts(prevPosts => prevPosts.map(p => {
      if (p.id === postId) {
        const reactions = p.reactions || [];
        const existingIndex = reactions.findIndex(r => r.user_id === user.id && r.emoji === emoji);
        
        if (existingIndex >= 0) {
          // Remove reaction - revert to UNCHECKED Shaka (liked = false)
          return {
            ...p,
            liked: false,
            reactions: reactions.filter((_, i) => i !== existingIndex)
          };
        } else {
          // Add reaction - replace any existing reaction from this user
          const filteredReactions = reactions.filter(r => r.user_id !== user.id);
          
          // If selecting shaka, set liked=true; otherwise liked=false (emoji replaces shaka)
          return {
            ...p,
            liked: isShakaEmoji,
            reactions: isShakaEmoji 
              ? filteredReactions // Shaka uses liked state, not reactions array
              : [...filteredReactions, { emoji, user_id: user.id, user_name: user.full_name }]
          };
        }
      }
      return p;
    }));
    
    try {
      let response;
      if (isShakaEmoji) {
        // Shaka emoji uses the like endpoint
        response = await apiClient.post(`/posts/${postId}/like?user_id=${user.id}`);
      } else {
        response = await apiClient.post(`/posts/${postId}/reactions?user_id=${user.id}`, { emoji });
      }
      
      // Broadcast reaction update via Supabase Realtime for social sync
      try {
        await apiClient.post(`/realtime/broadcast`, {
          channel: `post:${postId}`,
          event: 'reaction_update',
          payload: {
            post_id: postId,
            user_id: user.id,
            user_name: user.full_name,
            emoji: isRemoving ? null : emoji,
            action: response?.data?.action || (isRemoving ? 'removed' : 'added')
          }
        });
      } catch (broadcastError) {
        // Silent fail for broadcast - not critical
        logger.debug('Broadcast skipped:', broadcastError.message);
      }
      
      // Send notification to post author if adding a reaction (not removing)
      const action = response?.data?.action || (isRemoving ? 'removed' : 'added');
      if (action === 'added' && targetPost && targetPost.author_id !== user.id) {
        // Create notification via API
        await apiClient.post(`/notifications`, {
          user_id: targetPost.author_id,
          type: 'post_reaction',
          title: `${user.full_name} reacted ${emoji}`,
          message: `${user.full_name} reacted with ${emoji} to your post`,
          data: {
            post_id: postId,
            reactor_id: user.id,
            reactor_name: user.full_name,
            emoji: emoji
          }
        }).catch(() => {}); // Silent fail for notification
      }
    } catch (error) {
      logger.error('Reaction error:', error);
      toast.error('Failed to add reaction');
      fetchPosts(); // Refresh to get correct state
    }
  };

  const handleSavePost = async (postId, isSaved) => {
    // Optimistic update
    setPosts(posts.map(p =>
      p.id === postId ? { ...p, saved: !isSaved } : p
    ));
    
    try {
      if (isSaved) {
        await apiClient.delete(`/posts/${postId}/save?user_id=${user.id}`);
        toast.success('Post removed from saved');
      } else {
        await apiClient.post(`/posts/${postId}/save?user_id=${user.id}`);
        toast.success('Post saved!');
      }
    } catch (error) {
      // Revert on error
      setPosts(posts.map(p =>
        p.id === postId ? { ...p, saved: isSaved } : p
      ));
      toast.error('Failed to save post');
    }
  };

  // Comment functions
  const handleCommentSubmit = async (postId) => {
    const content = commentInputs[postId]?.trim();
    if (!content || !user?.id) {
      if (!user?.id) toast.error('Please log in to comment');
      return;
    }

    try {
      const response = await apiClient.post(
        `/posts/${postId}/comments?user_id=${user.id}`,
        { content }
      );
      
      // Add new comment to the post's recent_comments
      setPosts(prevPosts => prevPosts.map(p => {
        if (p.id === postId) {
          const newComment = response.data;
          const updatedComments = [...(p.recent_comments || []), newComment].slice(-2);
          return {
            ...p,
            comments_count: (p.comments_count || 0) + 1,
            recent_comments: updatedComments
          };
        }
        return p;
      }));
      
      // Also add to allComments if viewing all
      if (showAllComments[postId]) {
        setAllComments(prev => ({
          ...prev,
          [postId]: [...(prev[postId] || []), response.data]
        }));
      }
      
      // Clear input
      setCommentInputs(prev => ({ ...prev, [postId]: '' }));
      toast.success('Comment posted!');
    } catch (error) {
      logger.error('Failed to post comment:', error);
      toast.error('Failed to post comment');
    }
  };

  const loadAllComments = async (postId) => {
    if (loadingComments[postId]) return;
    
    setLoadingComments(prev => ({ ...prev, [postId]: true }));
    try {
      const response = await apiClient.get(`/posts/${postId}/comments`, {
        params: { viewer_id: user?.id }
      });
      setAllComments(prev => ({ ...prev, [postId]: response.data }));
      setShowAllComments(prev => ({ ...prev, [postId]: true }));
    } catch (error) {
      logger.error('Failed to load comments:', error);
      toast.error('Failed to load comments');
    } finally {
      setLoadingComments(prev => ({ ...prev, [postId]: false }));
    }
  };

  const hideAllComments = (postId) => {
    setShowAllComments(prev => ({ ...prev, [postId]: false }));
  };

  // "I Was There" Collaboration handlers
  const handleIWasThere = async (postId) => {
    if (!user?.id) {
      toast.error('Please log in to join sessions');
      return;
    }
    
    setCollaborationLoading(postId);
    
    try {
      // Get GPS location if available
      let latitude = null;
      let longitude = null;
      
      if (navigator.geolocation) {
        try {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 5000,
              maximumAge: 0
            });
          });
          latitude = position.coords.latitude;
          longitude = position.coords.longitude;
        } catch (gpsError) {
          // GPS not available, continue without it
          logger.debug('GPS not available:', gpsError);
        }
      }
      
      await apiClient.post(
        `/posts/${postId}/request-collaboration?user_id=${user.id}`,
        {
          latitude,
          longitude
        }
      );
      
      toast.success('Request sent! The post owner will review your request.');
      
      // Update local state to show pending
      setPosts(prevPosts => prevPosts.map(p => {
        if (p.id === postId) {
          return {
            ...p,
            collaborators: [
              ...(p.collaborators || []),
              {
                id: 'pending-' + user.id,
                user_id: user.id,
                full_name: user.full_name,
                avatar_url: user.avatar_url,
                status: 'pending',
                verified_by_gps: !!latitude
              }
            ]
          };
        }
        return p;
      }));
    } catch (error) {
      const message = error.response?.data?.detail || 'Failed to send request';
      toast.error(message);
    } finally {
      setCollaborationLoading(null);
    }
  };

  const handleViewCollaborators = (postId) => {
    setShowCollaboratorsModal(postId);
  };

  const _formatTimeAgo = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
  };

  const handleCheckIn = async () => {
    if (streak.checked_in_today) {
      toast.info('You already checked in today! Keep the streak going tomorrow 🔥');
      return;
    }
    setShowCheckInModal(true);
  };

  const submitCheckIn = async () => {
    setCheckInLoading(true);
    
    // Determine spot ID - either manually selected or auto-detected from GPS
    const spotId = checkInData.spot_id || nearestSpot?.id;
    const spotName = spotId 
      ? (spots.find(s => s.id === spotId)?.name || nearestSpot?.name || 'Unknown Spot')
      : 'Custom Location';
    
    try {
      // If GPS enabled AND spot selected, use Passport GPS-validated check-in
      if (checkInData.use_gps && checkInData.latitude && checkInData.longitude && spotId) {
        // First, attempt Passport GPS-validated check-in (requires being within 500m)
        const passportResponse = await apiClient.post(`/passport/checkin?user_id=${user.id}`, {
          spot_id: spotId,
          latitude: checkInData.latitude,
          longitude: checkInData.longitude,
          notes: checkInData.notes || null
        });
        
        if (!passportResponse.data.success) {
          // User is too far from the spot - show distance feedback
          toast.error(passportResponse.data.message || `You're too far from ${spotName} to check in`);
          setCheckInLoading(false);
          return;
        }
        
        // GPS check-in successful! Now also update legacy streak
        try {
          const streakResponse = await apiClient.post(`/check-in?user_id=${user.id}`, {
            spot_id: spotId,
            spot_name: spotName,
            conditions: checkInData.conditions || null,
            wave_height: checkInData.wave_height || null,
            notes: checkInData.notes || null,
            latitude: checkInData.latitude,
            longitude: checkInData.longitude,
            use_gps: true
          });
          
          setStreak({
            current_streak: streakResponse.data.current_streak,
            longest_streak: streakResponse.data.longest_streak,
            total_check_ins: streakResponse.data.total_check_ins,
            checked_in_today: true
          });
        } catch (streakError) {
          // Legacy streak may fail if already checked in - that's OK
          if (streakError.response?.data?.detail !== 'Already checked in today') {
            logger.warn('Legacy streak update failed:', streakError);
          }
          setStreak(prev => ({ ...prev, checked_in_today: true }));
        }
        
        // Show Passport rewards
        const xpMsg = passportResponse.data.xp_earned > 0 ? ` +${passportResponse.data.xp_earned} XP!` : '';
        const badgeMsg = passportResponse.data.badge_earned ? ` 🏅 Badge: ${passportResponse.data.badge_earned}` : '';
        const firstVisitMsg = passportResponse.data.is_first_visit ? ' 🆕 First visit!' : '';
        
        toast.success(`${passportResponse.data.message}${xpMsg}${firstVisitMsg}${badgeMsg}`);
        
      } else {
        // Non-GPS check-in (manual selection) - use legacy endpoint only
        const response = await apiClient.post(`/check-in?user_id=${user.id}`, {
          spot_id: spotId || null,
          spot_name: spotName,
          conditions: checkInData.conditions || null,
          wave_height: checkInData.wave_height || null,
          notes: checkInData.notes || null,
          latitude: checkInData.latitude,
          longitude: checkInData.longitude,
          use_gps: checkInData.use_gps
        });
        
        setStreak({
          current_streak: response.data.current_streak,
          longest_streak: response.data.longest_streak,
          total_check_ins: response.data.total_check_ins,
          checked_in_today: true
        });
        
        toast.success(`Checked in! 🔥 ${response.data.current_streak} day streak!`);
      }
      
      setShowCheckInModal(false);
      setCheckInData({ spot_id: '', conditions: '', wave_height: '', notes: '', latitude: null, longitude: null, use_gps: false });
      setNearestSpot(null);
      
    } catch (error) {
      if (error.response?.data?.detail === 'Already checked in today') {
        toast.info('You already checked in today!');
        setStreak(prev => ({ ...prev, checked_in_today: true }));
      } else {
        const errorMsg = error.response?.data?.message || error.response?.data?.detail || 'Failed to check in';
        toast.error(errorMsg);
      }
    } finally {
      setCheckInLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 theme-main-content">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
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
    <div className={`max-w-xl mx-auto ${mainBgClass} min-h-screen transition-colors duration-300`} data-testid="feed-container">
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

      {/* Photographer Session Dashboard - NOT shown to Grom Parents */}
      {canShowSessionDashboard && (
        <div className="p-4">
          <PhotographerSessionDashboard />
        </div>
      )}

      {/* Live Photographers Section (for surfers) */}
      {!isPhotographer && <LivePhotographers />}

      {/* Feed Tabs */}
      <div className={`flex border-b ${borderClass}`}>
        <button
          onClick={() => setActiveTab('for_you')}
          className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
            activeTab === 'for_you' ? textPrimaryClass : textSecondaryClass
          }`}
          data-testid="tab-for-you"
        >
          For You
          {activeTab === 'for_you' && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-0.5 bg-gradient-to-r from-yellow-400 to-orange-400" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('waves')}
          className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
            activeTab === 'waves' ? textPrimaryClass : textSecondaryClass
          }`}
          data-testid="tab-waves"
        >
          <span className="flex items-center justify-center gap-1">
            <Play className="w-3.5 h-3.5" />
            Waves
          </span>
          {activeTab === 'waves' && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-0.5 bg-gradient-to-r from-cyan-400 to-blue-400" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('following')}
          className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
            activeTab === 'following' ? textPrimaryClass : textSecondaryClass
          }`}
          data-testid="tab-following"
        >
          Following
          {activeTab === 'following' && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-0.5 bg-gradient-to-r from-yellow-400 to-orange-400" />
          )}
        </button>
      </div>

      {/* Waves Tab - Full Screen Video Feed */}
      {activeTab === 'waves' && (
        <div className="relative" style={{ height: 'calc(100vh - 200px)', minHeight: '500px' }}>
          <WavesFeed feedType="for_you" onCreateWave={() => setShowCreateWaveModal(true)} />
          {/* Floating Create Wave Button */}
          <button
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

            <button
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
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className={textSecondaryClass}>No posts yet. Be the first to share!</p>
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

      {/* Check In Modal */}
      <Dialog open={showCheckInModal} onOpenChange={setShowCheckInModal}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md" aria-describedby="checkin-modal-description">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <MapPin className="w-5 h-5 text-yellow-400" />
              Check In
            </DialogTitle>
            <DialogDescription id="checkin-modal-description" className="sr-only">
              Check in to a surf spot
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 pt-4">
            {/* GPS Location Button */}
            <div>
              <Button
                onClick={getGpsLocation}
                disabled={gpsLoading}
                variant="outline"
                className={`w-full border-zinc-700 ${checkInData.latitude ? 'border-blue-500 bg-blue-500/10' : ''} text-white hover:bg-zinc-800`}
                data-testid="gps-checkin-btn"
              >
                {gpsLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Navigation className={`w-4 h-4 mr-2 ${checkInData.latitude ? 'text-blue-400' : ''}`} />
                )}
                {checkInData.latitude ? 'Location Detected' : 'Use My Location'}
              </Button>
              {nearestSpot && (
                <p className="text-xs text-blue-400 mt-2 text-center">
                  Nearest: {nearestSpot.name} ({nearestSpot.distance}km away)
                </p>
              )}
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-zinc-700" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-zinc-900 px-2 text-gray-500">or select manually</span>
              </div>
            </div>

            {/* Spot Selection */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">Surf Spot</label>
              <Select value={checkInData.spot_id} onValueChange={(v) => setCheckInData(prev => ({ ...prev, spot_id: v }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                  <SelectValue placeholder="Select a spot" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {spots.map((spot) => (
                    <SelectItem key={spot.id} value={spot.id} className="text-white hover:bg-zinc-700">
                      {spot.name}
                    </SelectItem>
                  ))}
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
                  <SelectItem value="Glassy" className="text-white hover:bg-zinc-700">🪞 Glassy</SelectItem>
                  <SelectItem value="Clean" className="text-white hover:bg-zinc-700">✨ Clean</SelectItem>
                  <SelectItem value="Choppy" className="text-white hover:bg-zinc-700">🌊 Choppy</SelectItem>
                  <SelectItem value="Messy" className="text-white hover:bg-zinc-700">💨 Messy</SelectItem>
                  <SelectItem value="Blown Out" className="text-white hover:bg-zinc-700">🌀 Blown Out</SelectItem>
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

            {/* GPS Passport Info */}
            {checkInData.use_gps && checkInData.latitude && (checkInData.spot_id || nearestSpot) && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <Navigation className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-emerald-300">
                  <span className="font-medium">GPS-Verified Check-In:</span> You must be within 500m of the spot to earn Passport XP & stamps.
                </div>
              </div>
            )}

            {/* Submit Button */}
            <Button
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
                  {checkInData.use_gps && (checkInData.spot_id || nearestSpot) ? 'Check In + Earn XP' : 'Check In & Keep Streak'}
                </>
              )}
            </Button>
          </div>
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
                    <img src={getFullUrl(collab.avatar_url)} alt="" className="w-full h-full object-cover" />
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
