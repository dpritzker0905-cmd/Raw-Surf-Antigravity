import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePersona, getExpandedRoleInfo } from '../contexts/PersonaContext';
import { useNavigate, useParams } from 'react-router-dom';

import { 
  Camera, Settings, DollarSign, MapPin, Flame, 
  Grid3X3, Bookmark, UserSquare2, Play, Waves, ExternalLink,
  Instagram, Globe, Check, Loader2, UserPlus, UserMinus, ArrowLeft, Heart, Award,
  Zap, CalendarClock, Clock, Calculator, Users, Radio, Image, Shield, Trophy, Pin, MoreHorizontal, Ban, Flag, AlertTriangle
} from 'lucide-react';

// Custom Surfboard Icon Component
const SurfboardIcon = ({ className = "w-5 h-5" }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
    className={className}
  >
    {/* Surfboard shape - elongated oval with pointed ends */}
    <path d="M12 2C9 2 6 5 5 9C4 13 4 17 5 19C6 21 9 22 12 22C15 22 18 21 19 19C20 17 20 13 19 9C18 5 15 2 12 2Z" />
    {/* Center stringer line */}
    <line x1="12" y1="4" x2="12" y2="20" />
    {/* Fin at bottom */}
    <path d="M12 18L10 21M12 18L14 21" />
  </svg>
);

import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { toast } from 'sonner';
import { TaggedPhotoModal } from './TaggedPhotoModal';
import { XPDisplay, BadgeRow } from './GamificationUI';
import { NumericStepper } from './ui/numeric-stepper';
import GoLiveModal from './GoLiveModal';
import { StokedTab } from './StokedTab';
import { CrewLeaderboard } from './CrewLeaderboard';
import { PhotographerAvailability } from './PhotographerAvailability';
import { ScheduledBookingDrawer } from './ScheduledBookingDrawer';
import { SurfboardsTab } from './SurfboardsTab';
import { FollowersModal } from './FollowersModal';
import logger from '../utils/logger';
import apiClient from '../lib/apiClient';
import { getFullUrl } from '../utils/media';
import { ROLES } from '../constants/roles';

// Resolve relative /api/uploads/... paths to backend absolute URLs

// Role badge component showing icon and label
const ProfileRoleBadge = ({ role }) => {
  const roleInfo = getExpandedRoleInfo(role);
  return (
    <Badge className={`${roleInfo.bgColor} ${roleInfo.color} text-xs flex items-center gap-1`} data-testid="profile-role-badge">
      <span>{roleInfo.icon}</span>
      {roleInfo.label}
    </Badge>
  );
};

export const Profile = () => {
  const { user, logout, updateUser, loading: authLoading } = useAuth();
  const { getEffectiveRole, _isMasked } = usePersona();
  const navigate = useNavigate();
  const { userId } = useParams(); // Get userId from URL if viewing someone else's profile
  
  // Get effective role for UI rendering (respects God Mode persona masking)
  const effectiveRole = getEffectiveRole(user?.role);
  
  // Determine if viewing own profile or someone else's
  // Wait for auth to load before determining this
  const isOwnProfile = !userId || (user && userId === user.id);
  const profileUserId = userId || user?.id;
  
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [streak, setStreak] = useState({ current_streak: 0, longest_streak: 0, total_check_ins: 0 });
  const [socialStats, setSocialStats] = useState({ followers: 0, following: 0 });
  const [contentStats, setContentStats] = useState({ posts: 0, photos: 0, videos: 0, session_shots: 0, saved: 0, tagged: 0 });
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  
  // Tab state
  const [activeTab, setActiveTab] = useState('posts');
  const [tabContent, setTabContent] = useState([]);
  const [tabLoading, setTabLoading] = useState(false);
  
  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editData, setEditData] = useState({
    full_name: '', bio: '', location: '', instagram_url: '', website_url: '',
    stance: '', wetsuit_color: '', rash_guard_color: ''
  });
  
  // Avatar upload
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef(null);
  
  // Tagged photo modal
  const [showTaggedPhotoModal, setShowTaggedPhotoModal] = useState(false);
  const [selectedTaggedPhoto, setSelectedTaggedPhoto] = useState(null);
  
  // Impact Score
  const [impactScore, setImpactScore] = useState(null);
  
  // Gamification
  const [gamificationStats, setGamificationStats] = useState({ total_xp: 0, badges: [], recent_xp_transactions: [] });

  // Go Live Modal
  const [showGoLiveModal, setShowGoLiveModal] = useState(false);

  // Followers/Following Modal
  const [showFollowersModal, setShowFollowersModal] = useState(false);
  const [followersModalType, setFollowersModalType] = useState('followers'); // 'followers' or 'following'

  // ============ BLOCK USER STATE ============
  const [isBlocked, setIsBlocked] = useState(false);
  const [isBlockedByThem, setIsBlockedByThem] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [blockNotes, setBlockNotes] = useState('');
  const [blockLoading, setBlockLoading] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // ============ NOTES STATE (Instagram-style) ============
  const [userNote, setUserNote] = useState(null);
  const [_isMutualFollower, setIsMutualFollower] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  // ============ QUICK BOOK STATE ============
  const [showQuickBookModal, setShowQuickBookModal] = useState(false);
  const [quickBookType, setQuickBookType] = useState('on-demand'); // 'on-demand' or 'scheduled'
  const [quickBookDuration, setQuickBookDuration] = useState(1);
  const [quickBookLoading, setQuickBookLoading] = useState(false);
  const [photographerPricing, setPhotographerPricing] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  
  // ============ SCHEDULED BOOKING DRAWER STATE ============
  const [showScheduledBookingDrawer, setShowScheduledBookingDrawer] = useState(false);

  // Check if profile is on-demand active (for Quick Book feature)
  const isOnDemandActive = profile?.on_demand_active === true;
  // Check if profile is a photographer (for Quick Book - uses actual profile role, not display role)
  const isProfilePhotographer = profile && ['Hobbyist', 'Photographer', 'Approved Pro', 'Pro'].includes(profile.role);

  useEffect(() => {
    // Wait for auth to finish loading before fetching profile data
    if (authLoading) return;
    
    if (profileUserId) {
      fetchProfile();
      fetchStreak();
      fetchSocialStats();
      fetchContentStats();
      fetchImpactScore();
      fetchGamificationStats();
      fetchUserNote(); // Fetch the profile user's note
      if (!isOwnProfile && user) {
        checkFollowStatus();
        checkBlockStatus();
      }
    }
  }, [profileUserId, isOwnProfile, authLoading, user]);

  useEffect(() => {
    if (authLoading) return;
    if (profileUserId) {
      fetchTabContent(activeTab);
    }
  }, [activeTab, profileUserId, authLoading]);

  const fetchProfile = async () => {
    if (!profileUserId) {
      setLoading(false);
      return;
    }
    
    try {
      const response = await apiClient.get(`/profiles/${profileUserId}`);
      setProfile(response.data);
      if (isOwnProfile && user) {
        setEditData({
          full_name: response.data.full_name || '',
          bio: response.data.bio || '',
          location: response.data.location || '',
          instagram_url: response.data.instagram_url || '',
          website_url: response.data.website_url || '',
          stance: response.data.stance || '',
          wetsuit_color: response.data.wetsuit_color || '',
          rash_guard_color: response.data.rash_guard_color || ''
        });
      }
    } catch (error) {
      logger.error('Failed to load profile:', error);
      // Only show error toast, don't redirect - let user stay on page
      if (error.response?.status === 404) {
        toast.error('User not found');
        navigate('/explore');
      } else {
        toast.error('Failed to load profile');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchStreak = async () => {
    try {
      const response = await apiClient.get(`/streak/${profileUserId}`);
      setStreak(response.data);
    } catch (error) {
      logger.error('Error fetching streak:', error);
    }
  };

  const fetchSocialStats = async () => {
    try {
      const [followersRes, followingRes] = await Promise.all([
        apiClient.get(`/followers/${profileUserId}`).catch(() => ({ data: [] })),
        apiClient.get(`/following/${profileUserId}`).catch(() => ({ data: [] }))
      ]);
      setSocialStats({
        followers: followersRes.data?.length || 0,
        following: followingRes.data?.length || 0
      });
    } catch (error) {
      logger.error('Error fetching social stats:', error);
    }
  };

  const fetchContentStats = async () => {
    try {
      const response = await apiClient.get(`/profile/${profileUserId}/stats`);
      setContentStats(response.data);
    } catch (error) {
      logger.error('Error fetching content stats:', error);
    }
  };

  const fetchImpactScore = async () => {
    try {
      const response = await apiClient.get(`/impact/public/${profileUserId}`);
      setImpactScore(response.data);
    } catch (error) {
      logger.error('Error fetching impact score:', error);
    }
  };

  const fetchGamificationStats = async () => {
    try {
      const response = await apiClient.get(`/gamification/user/${profileUserId}`);
      setGamificationStats(response.data);
    } catch (error) {
      logger.error('Error fetching gamification stats:', error);
    }
  };

  // Fetch the profile user's Note (Instagram-style)
  const fetchUserNote = async () => {
    if (!profileUserId || !user?.id) return;
    try {
      const response = await apiClient.get(`/notes/user/${profileUserId}?viewer_id=${user.id}`);
      setUserNote(response.data.note);
      setIsMutualFollower(response.data.is_mutual_follower);
    } catch (error) {
      logger.error('Error fetching user note:', error);
      setUserNote(null);
    }
  };

  // Create/update a note (for own profile)
  const handleCreateNote = async () => {
    if (!noteText.trim() || noteSubmitting) return;
    setNoteSubmitting(true);
    try {
      await apiClient.post(`/notes/create?user_id=${user.id}`, { content: noteText.trim() });
      toast.success('Note shared with mutual followers!');
      setShowNoteModal(false);
      setNoteText('');
      fetchUserNote();
    } catch (error) {
      toast.error('Failed to share note');
    } finally {
      setNoteSubmitting(false);
    }
  };

  // Delete note
  const handleDeleteNote = async () => {
    try {
      await apiClient.delete(`/notes/delete?user_id=${user.id}`);
      setUserNote(null);
      setShowNoteModal(false);
      toast.success('Note deleted');
    } catch (error) {
      toast.error('Failed to delete note');
    }
  };

  const checkFollowStatus = async () => {
    if (!user?.id || !profileUserId) return;
    try {
      // Use direct check: GET /follow/check?follower_id=X&following_id=Y
      // Fallback: load the following list and search
      try {
        const response = await apiClient.get(`/follow/check?follower_id=${user.id}&following_id=${profileUserId}`);
        setIsFollowing(response.data?.is_following === true);
        return;
      } catch (checkErr) {
        // Endpoint doesn't exist yet — fall back to list search
      }
      const response = await apiClient.get(`/following/${user.id}`);
      const following = response.data || [];
      // Compare as strings to avoid UUID type mismatch
      setIsFollowing(following.some(f => String(f.id) === String(profileUserId)));
    } catch (error) {
      logger.error('Error checking follow status:', error);
    }
  };

  const handleFollow = async () => {
    if (!user?.id) {
      toast.error('Please log in to follow users');
      return;
    }
    
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await apiClient.delete(`/follow/${profileUserId}?follower_id=${user.id}`);
        setIsFollowing(false);
        setSocialStats(prev => ({ ...prev, followers: Math.max(0, prev.followers - 1) }));
        toast.success(`Unfollowed ${profile.full_name}`);
      } else {
        await apiClient.post(`/follow/${profileUserId}?follower_id=${user.id}`);
        setIsFollowing(true);
        setSocialStats(prev => ({ ...prev, followers: prev.followers + 1 }));
        toast.success(`Following ${profile.full_name}`);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update follow status');
    } finally {
      setFollowLoading(false);
    }
  };

  // ============ BLOCK USER FUNCTIONS ============
  const checkBlockStatus = async () => {
    if (!user?.id || !profileUserId || isOwnProfile) return;
    try {
      const response = await apiClient.get(`/users/${user.id}/is-blocked/${profileUserId}`);
      setIsBlocked(response.data.user_blocked_other);
      setIsBlockedByThem(response.data.other_blocked_user);
    } catch (error) {
      logger.error('Error checking block status:', error);
    }
  };

  const handleBlockUser = async () => {
    if (!user?.id || !profileUserId) return;
    
    setBlockLoading(true);
    try {
      await apiClient.post(`/users/block`, {
        blocker_id: user.id,
        blocked_id: profileUserId,
        reason: blockReason || null,
        notes: blockNotes || null,
        auto_report: blockReason === 'harassment' || blockReason === 'scam'
      });
      
      setIsBlocked(true);
      setShowBlockModal(false);
      setBlockReason('');
      setBlockNotes('');
      toast.success(`${profile?.full_name || 'User'} has been blocked`);
      
      // Unfollowing happens automatically on backend
      if (isFollowing) {
        setIsFollowing(false);
        setSocialStats(prev => ({ ...prev, followers: Math.max(0, prev.followers - 1) }));
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to block user');
    } finally {
      setBlockLoading(false);
    }
  };

  const handleUnblockUser = async () => {
    if (!user?.id || !profileUserId) return;
    
    setBlockLoading(true);
    try {
      await apiClient.post(`/users/unblock`, {
        blocker_id: user.id,
        blocked_id: profileUserId
      });
      
      setIsBlocked(false);
      toast.success(`${profile?.full_name || 'User'} has been unblocked`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to unblock user');
    } finally {
      setBlockLoading(false);
    }
  };

  // ============ QUICK BOOK FUNCTIONS ============
  const fetchPhotographerPricing = async () => {
    if (!profileUserId) return;
    try {
      const res = await apiClient.get(`/photographer/${profileUserId}/pricing`);
      setPhotographerPricing(res.data);
    } catch (e) {
      logger.error('Error fetching photographer pricing:', e);
    }
  };

  const getUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error) => {
          logger.debug('Geolocation error:', error);
        }
      );
    }
  };

  const handleQuickBookOpen = (type) => {
    if (type === 'scheduled') {
      // Open ScheduledBookingDrawer directly with photographer pre-selected
      fetchPhotographerPricing();
      setShowScheduledBookingDrawer(true);
    } else {
      // On-demand flow - uses quick book modal
      setQuickBookType(type);
      setQuickBookDuration(1);
      fetchPhotographerPricing();
      getUserLocation();
      setShowQuickBookModal(true);
    }
  };

  const handleQuickBookSubmit = async () => {
    if (!user) {
      toast.error('Please log in to book');
      return;
    }

    setQuickBookLoading(true);
    try {
      if (quickBookType === 'on-demand') {
        // Submit On-Demand request using correct API format
        // API expects: requester_id as query param, CreateDispatchRequest in body
        await apiClient.post(`/dispatch/request?requester_id=${user.id}`, {
          latitude: userLocation?.latitude || 0,
          longitude: userLocation?.longitude || 0,
          estimated_duration_hours: quickBookDuration,
          is_immediate: true,
          target_photographer_id: profileUserId
        });
        toast.success('On-Demand request sent!');
        setShowQuickBookModal(false);
      } else {
        // Navigate to full booking page with pre-filled data
        navigate('/bookings', { 
          state: { 
            selectedPhotographer: profileUserId,
            bookingDuration: quickBookDuration,
            fromQuickBook: true
          }
        });
        setShowQuickBookModal(false);
      }
    } catch (error) {
      const detail = error.response?.data?.detail;
      // Handle off-duty / unavailable error specifically
      if (detail && detail.includes('not currently available')) {
        toast.error('Photographer is currently off-duty. Try scheduling a session instead.');
      } else {
        toast.error(detail || 'Failed to process booking');
      }
    } finally {
      setQuickBookLoading(false);
    }
  };

  // Calculate quick book pricing
  const quickBookHourlyRate = quickBookType === 'on-demand' 
    ? (photographerPricing?.on_demand_hourly_rate || profile?.on_demand_hourly_rate || 75)
    : (photographerPricing?.booking_hourly_rate || 75);
  const quickBookTotal = quickBookHourlyRate * quickBookDuration;

  const fetchTabContent = async (tab) => {
    setTabLoading(true);
    try {
      let endpoint = '';
      const qs = user?.id ? `?viewer_id=${user.id}` : '';
      switch (tab) {
        case 'posts':
          endpoint = `/profile/${profileUserId}/posts${qs}`;
          break;
        case 'photos':
          endpoint = `/profile/${profileUserId}/photos${qs}`;
          break;
        case 'session_shots':
          endpoint = `/profile/${profileUserId}/session-shots${qs}`;
          break;
        case 'videos':
          endpoint = `/profile/${profileUserId}/videos${qs}`;
          break;
        case 'saved':
          // Only show saved tab for own profile
          if (!isOwnProfile) {
            setTabContent([]);
            setTabLoading(false);
            return;
          }
          endpoint = `/profile/${profileUserId}/saved${qs}`;
          break;
        case 'tagged':
          endpoint = `/profile/${profileUserId}/tagged${qs}`;
          break;
        default:
          endpoint = `/profile/${profileUserId}/posts${qs}`;
      }
      const response = await apiClient.get(endpoint);
      // Handle both array and object responses (tagged returns {items, new_count})
      // Use the `tab` parameter (not activeTab state) to avoid stale closure issues
      if (tab === 'tagged' && response.data?.items) {
        setTabContent(response.data.items);
      } else {
        setTabContent(response.data);
      }
    } catch (error) {
      logger.error('Error fetching tab content:', error);
      setTabContent([]);
    } finally {
      setTabLoading(false);
    }
  };

  const _handleLogout = () => {
    logout();
    navigate('/auth');
    toast.success('Logged out successfully');
  };

  const toggleLive = async () => {
    if (!profile) return; // Guard against null profile
    if (!profile.is_live) {
      // Open the Go Live modal with camera
      setShowGoLiveModal(true);
    } else {
      // End live broadcast
      try {
        const activeStreams = await apiClient.get(`/social-live/active`);
        const myStream = activeStreams.data.streams?.find(s => s.broadcaster_id === user.id);
        if (myStream) {
          await apiClient.post(`/social-live/${myStream.id}/end?broadcaster_id=${user.id}`);
        }
        setProfile({ ...profile, is_live: false });
        toast.success('Live broadcast ended');
      } catch (error) {
        logger.error('End live error:', error);
        // Fallback: update profile directly
        try {
          await apiClient.patch(`/profiles/${user.id}`, { is_live: false });
          setProfile({ ...profile, is_live: false });
          toast.success('Live broadcast ended');
        } catch (e) {
          toast.error('Failed to end live broadcast');
        }
      }
    }
  };
  
  const handleGoLiveEnded = () => {
    if (!profile) return; // Guard against null profile
    setProfile({ ...profile, is_live: false });
  };

  const handleSaveProfile = async () => {
    setEditLoading(true);
    try {
      const response = await apiClient.patch(`/profiles/${user.id}`, editData);
      setProfile(response.data);
      updateUser({ ...user, full_name: response.data.full_name });
      setShowEditModal(false);
      toast.success('Profile updated!');
    } catch (error) {
      toast.error('Failed to update profile');
    } finally {
      setEditLoading(false);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    setAvatarUploading(true);

    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new window.Image();
        img.src = event.target.result;
        img.onload = async () => {
          // Native Image Compression to max 800px preserving 1:1 aspect ratio structurally
          const MAX_SIZE = 800;
          let width = img.width;
          let height = img.height;
          
          if (width > height && width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          } else if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
          
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // Encodes specifically down optimizing file bytes cleanly
          const base64 = canvas.toDataURL('image/jpeg', 0.85);

          try {
            const response = await apiClient.patch(`/profiles/${user.id}`, {
              avatar_url: base64
            });
            setProfile(response.data);
            updateUser({ 
              avatar_url: response.data.avatar_url,
              updated_at: new Date().toISOString()
            });
            toast.success('Avatar updated!');
          } catch (patchError) {
            toast.error('Failed to upload compressed avatar');
            console.error(patchError);
          } finally {
            setAvatarUploading(false);
          }
        };
        img.onerror = () => {
          toast.error('Corrupted image format');
          setAvatarUploading(false);
        };
      };
      reader.onerror = () => {
        toast.error('Failed to read file locally');
        setAvatarUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      toast.error('Upload sequence crashed');
      setAvatarUploading(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }

  if (!profile) return null;

  // Use effective role when viewing own profile (for God Mode), else use profile.role
  const displayRole = isOwnProfile ? effectiveRole : profile.role;
  const isPhotographer = ['Grom Parent', 'Hobbyist', 'Photographer', 'Approved Pro'].includes(displayRole);
  // Stoked eligible: Grom, Comp Surfer, Pro (NOT regular Surfer - they don't receive donations)
  const isStokedEligible = ['Grom', 'Comp Surfer', 'Pro'].includes(displayRole);
  // Grom Parent gets Grom Overview tab (Shield icon)
  const isGromParent = displayRole === ROLES.GROM_PARENT;

  // Tabs - Saved is only visible on own profile, Stoked for eligible surfers
  // Badges merged into Crew tab, Surfboards tab for all users
  // For photographers: Crew + Impact combined into "Swell" tab
  const tabs = [
    { id: 'posts', icon: Grid3X3, label: 'Posts', count: contentStats.posts },
    { id: 'photos', icon: Image, label: 'Photos', count: contentStats.photos },
    { id: 'videos', icon: Play, label: 'Videos', count: contentStats.videos },
    { id: 'session_shots', icon: Waves, label: 'Sessions', count: contentStats.session_shots },
    ...(isOwnProfile ? [{ id: 'saved', icon: Bookmark, label: 'Saved', count: contentStats.saved }] : []),
    { id: 'tagged', icon: UserSquare2, label: 'Tagged', count: contentStats.tagged },
    // Swell tab for photographers (combines Crew + Impact), Crew tab for non-photographers
    ...(!isGromParent && isPhotographer && impactScore?.is_photographer 
      ? [{ id: 'swell', icon: Waves, label: 'Swell', count: null }]
      : [{ id: 'crew', icon: Users, label: 'Crew', count: null }]
    ),
    // Surfboards tab: Show for all users (custom surfboard icon)
    { id: 'surfboards', icon: SurfboardIcon, label: 'Boards', count: null },
    // Grom Overview tab: Only for Grom Parent (Shield icon)
    ...(isGromParent ? [{ id: 'grom_overview', icon: Shield, label: 'Groms', count: null }] : []),
    // Stoked tab: Only show for Grom, Comp Surfer, Pro (NOT regular Surfer, NOT photographers)
    ...(isStokedEligible && !isPhotographer ? [{ id: 'stoked', icon: Zap, label: 'Stoked', count: null }] : []),
  ];

  return (
    <div className="pb-20 bg-background min-h-screen" data-testid="profile-page">
      {/* Back Button for viewing other profiles */}
      {!isOwnProfile && (
        <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border px-4 py-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-white hover:text-gray-300"
            data-testid="back-button"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">{profile.full_name}</span>
          </button>
        </div>
      )}

      {/* Profile Header - Centered Magazine Cover Style */}
      <div className="max-w-2xl mx-auto px-4 pt-6">
        
        {/* Blocked Banner - Show when either user has blocked the other */}
        {!isOwnProfile && (isBlocked || isBlockedByThem) && (
          <div className={`mb-4 p-3 rounded-xl border flex items-center gap-3 ${
            isBlockedByThem 
              ? 'bg-zinc-800/50 border-zinc-600' 
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            <Ban className={`w-5 h-5 flex-shrink-0 ${isBlockedByThem ? 'text-zinc-400' : 'text-red-400'}`} />
            <div className="flex-1">
              <p className={`text-sm font-medium ${isBlockedByThem ? 'text-zinc-300' : 'text-red-400'}`}>
                {isBlockedByThem 
                  ? 'This user has restricted their profile' 
                  : `You have blocked ${profile?.full_name || 'this user'}`
                }
              </p>
              <p className="text-xs text-zinc-500">
                {isBlockedByThem
                  ? 'You cannot view their posts or send them messages.'
                  : 'They cannot see your posts or contact you.'
                }
              </p>
            </div>
            {isBlocked && !isBlockedByThem && (
              <Button
                onClick={handleUnblockUser}
                disabled={blockLoading}
                size="sm"
                variant="outline"
                className="border-zinc-600 text-zinc-300 hover:text-white"
              >
                {blockLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Unblock'}
              </Button>
            )}
          </div>
        )}
        
        {/* Centered Avatar Section with subtle radial gradient background */}
        <div className="flex flex-col items-center mb-6 relative">
          {/* Radial gradient glow behind avatar */}
          <div 
            className="absolute top-4 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full pointer-events-none"
            style={{
              background: 'radial-gradient(circle, rgba(20, 184, 166, 0.5) 0%, rgba(6, 182, 212, 0.3) 30%, rgba(8, 145, 178, 0.15) 50%, transparent 70%)',
              filter: 'blur(40px)'
            }}
          />
          
          {/* Avatar with Note Bubble, Live/Shooting rings */}
          <div className="relative group mb-2 z-10">
            {/* Note Bubble - positioned ABOVE avatar (only when note exists) */}
            {userNote && (
              <button
                onClick={() => setShowNoteModal(true)}
                className="absolute -top-4 left-1/2 -translate-x-1/2 z-20 animate-in fade-in zoom-in duration-300"
                data-testid="profile-note-bubble"
              >
                <div className="bg-zinc-900/95 backdrop-blur-sm border border-emerald-400 rounded-full px-3 py-1.5 max-w-[160px] shadow-lg hover:scale-105 transition-transform">
                  <p className="text-xs text-gray-100 truncate text-center font-medium">{userNote.content}</p>
                </div>
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-zinc-900/95 border-r border-b border-emerald-400 rotate-45" />
              </button>
            )}
            
            {/* Large Centered Avatar with gradient ring */}
            <div 
              className={`p-[4px] rounded-full ${
                profile.is_live 
                  ? 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-500 animate-pulse' 
                  : profile.is_shooting
                    ? 'bg-gradient-to-tr from-cyan-400 via-blue-500 to-indigo-500'
                    : userNote 
                      ? 'bg-gradient-to-br from-emerald-400 via-green-500 to-teal-500'
                      : 'bg-gradient-to-br from-zinc-700 to-zinc-800'
              }`}
              onClick={() => userNote && setShowNoteModal(true)}
              style={{ cursor: userNote ? 'pointer' : 'default' }}
            >
              <Avatar className="w-28 h-28 md:w-32 md:h-32 border-4 border-black" data-testid="profile-avatar">
                <AvatarImage src={getFullUrl(profile.avatar_url)} className="object-cover" />
                <AvatarFallback className="text-4xl bg-zinc-800 text-white">
                  {profile.full_name?.[0] || 'U'}
                </AvatarFallback>
              </Avatar>
            </div>
            
            {/* Avatar upload overlay */}
            {isOwnProfile && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                data-testid="avatar-upload-btn"
              >
                {avatarUploading ? (
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                ) : (
                  <Camera className="w-8 h-8 text-white" />
                )}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="hidden"
            />
            
            {/* Status Badge: LIVE or SHOOTING */}
            {profile.is_live ? (
              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg animate-pulse flex items-center gap-1">
                <Radio className="w-3 h-3" />
                LIVE
              </span>
            ) : profile.is_shooting && (
              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-cyan-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg flex items-center gap-1">
                <Camera className="w-3 h-3" />
                SHOOTING
              </span>
            )}
          </div>

          {/* Add Note button - BELOW avatar, only when NO note exists */}
          {isOwnProfile && !userNote && (
            <button
              onClick={() => {
                setNoteText('');
                setShowNoteModal(true);
              }}
              className="mb-2"
              data-testid="add-note-btn"
            >
              <div className="bg-zinc-800/80 border border-dashed border-zinc-600 rounded-full px-4 py-1.5 flex items-center gap-1.5 hover:border-emerald-400 hover:bg-zinc-700/80 transition-colors">
                <span className="text-gray-400 text-xs">+ Add note</span>
              </div>
            </button>
          )}

          {/* Username - Instagram style primary display */}
          {profile.username && (
            <p className="text-lg font-medium text-foreground mb-0.5" data-testid="profile-username">
              @{profile.username}
            </p>
          )}

          {/* Name + Verification */}
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-lg font-semibold text-muted-foreground" data-testid="profile-name" style={{ fontFamily: 'Oswald, sans-serif' }}>
              {profile.full_name || 'Anonymous'}
            </h1>
            {profile.is_verified && (
              <div className="bg-blue-500 rounded-full p-1">
                <Check className="w-3.5 h-3.5 text-white" />
              </div>
            )}
          </div>

          {/* Location */}
          {profile.location && (
            <span className="flex items-center gap-1.5 text-muted-foreground text-sm mb-3">
              <MapPin className="w-4 h-4" />
              {profile.location}
            </span>
          )}

          {/* Stats Row - Horizontal centered */}
          <div className="flex items-center justify-center gap-8 mb-4">
            <div className="text-center">
              <p className="text-xl font-bold text-foreground">{contentStats.posts}</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">posts</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <button 
              onClick={() => {
                setFollowersModalType('followers');
                setShowFollowersModal(true);
              }}
              className="text-center cursor-pointer hover:opacity-70 transition-opacity"
              data-testid="followers-count-btn"
            >
              <p className="text-xl font-bold text-foreground">{socialStats.followers}</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">followers</p>
            </button>
            <div className="w-px h-8 bg-border" />
            <button 
              onClick={() => {
                setFollowersModalType('following');
                setShowFollowersModal(true);
              }}
              className="text-center cursor-pointer hover:opacity-70 transition-opacity"
              data-testid="following-count-btn"
            >
              <p className="text-xl font-bold text-foreground">{socialStats.following}</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">following</p>
            </button>
          </div>

          {/* Role Badges Row */}
          <div className="flex items-center justify-center gap-2 flex-wrap mb-3">
            <ProfileRoleBadge role={displayRole} />
            {profile.subscription_tier && profile.subscription_tier !== 'free' && (
              <Badge variant="outline" className="border-emerald-400 text-emerald-400 text-xs">
                {profile.subscription_tier}
              </Badge>
            )}
            {streak.current_streak > 0 && (
              <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">
                <Flame className="w-3 h-3 mr-1" />
                {streak.current_streak} day streak
              </Badge>
            )}
            {impactScore?.is_photographer && impactScore?.impact_score?.total_credits_given > 0 && (
              <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-xs">
                <Heart className="w-3 h-3 mr-1" />
                {impactScore.impact_score.level?.emoji} {impactScore.impact_score.total_credits_given.toFixed(0)} given
              </Badge>
            )}
            {gamificationStats.total_xp > 0 && (
              <XPDisplay xp={gamificationStats.total_xp} size="sm" />
            )}
            {profile.elite_tier === 'grom_rising' && (
              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs" data-testid="grom-competes-badge">
                <Trophy className="w-3 h-3 mr-1" />
                Competes
              </Badge>
            )}
          </div>

          {/* Earned Badges */}
          {gamificationStats.badges && gamificationStats.badges.length > 0 && (
            <div className="flex items-center justify-center gap-2 mb-3" data-testid="profile-badges">
              <BadgeRow badges={gamificationStats.badges} size="sm" maxDisplay={4} />
            </div>
          )}

          {/* Bio */}
          {profile.bio && (
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-3" data-testid="profile-bio">
              {profile.bio}
            </p>
          )}

          {/* Social Links - Centered */}
          <div className="flex items-center justify-center gap-4 text-sm mb-4">
            {profile.instagram_url && (
              <a 
                href={`https://instagram.com/${profile.instagram_url.replace('@', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Instagram className="w-4 h-4" />
                {profile.instagram_url}
              </a>
            )}
            {profile.website_url && (
              <a 
                href={profile.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Globe className="w-4 h-4" />
                Website
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {/* Action Buttons - Different for own profile vs others */}
        <div className="flex gap-2 mb-4">
          {isOwnProfile ? (
            <>
              <Button
                onClick={() => setShowEditModal(true)}
                className="flex-1 bg-secondary hover:bg-secondary/80 text-secondary-foreground text-sm h-10"
                data-testid="edit-profile-btn"
              >
                Edit profile
              </Button>
              {/* Social Go Live Button */}
              <Button
                onClick={toggleLive}
                className={`text-sm h-10 px-4 ${
                  profile.is_live
                    ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                    : 'bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-black font-semibold'
                }`}
                data-testid="go-live-btn"
              >
                <Radio className="w-4 h-4 mr-1" />
                {profile.is_live ? 'End Live' : 'Go Live'}
              </Button>
              {profile.is_shooting && !profile.is_live && (
                <div className="flex items-center gap-1 px-3 py-1.5 bg-cyan-500/20 border border-cyan-500/50 rounded-lg">
                  <Camera className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs text-cyan-400 font-medium">Shooting</span>
                </div>
              )}
              {isPhotographer && (
                <Button
                  onClick={() => navigate('/career/stoke-sponsor')}
                  variant="outline"
                  className="h-10 px-3 border-pink-500/50 text-pink-400 hover:bg-pink-500/10"
                  data-testid="stoke-sponsor-button"
                >
                  <Heart className="w-4 h-4 mr-1" />
                  Stoke
                </Button>
              )}
              <Button
                onClick={() => navigate('/settings')}
                variant="outline"
                className="h-10 w-10 p-0 border-border text-foreground hover:bg-accent"
                data-testid="settings-button"
              >
                <Settings className="w-4 h-4 text-foreground" />
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={handleFollow}
                disabled={followLoading}
                className={`flex-1 text-sm h-10 ${
                  isFollowing
                    ? 'bg-zinc-800 hover:bg-zinc-700 text-white'
                    : 'bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black'
                }`}
                data-testid="follow-button"
              >
                {followLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isFollowing ? (
                  <>
                    <UserMinus className="w-4 h-4 mr-2" />
                    Following
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Follow
                  </>
                )}
              </Button>
              <Button
                onClick={async () => {
                  // Lazy thread routing: check for existing conversation first
                  try {
                    const response = await apiClient.get(`/messages/check-thread/${user.id}/${profileUserId}`);
                    if (response.data.exists) {
                      // Navigate directly to existing conversation
                      navigate(`/messages/${response.data.conversation_id}`, { 
                        state: { fromProfile: profileUserId } 
                      });
                    } else {
                      // Navigate to new chat view with recipient info
                      navigate(`/messages/new/${profileUserId}`, { 
                        state: { 
                          fromProfile: profileUserId,
                          recipientName: response.data.recipient_name,
                          recipientAvatar: response.data.recipient_avatar
                        } 
                      });
                    }
                  } catch (error) {
                    toast.error('Failed to open chat');
                  }
                }}
                variant="outline"
                className="flex-1 h-10 border-border text-foreground hover:bg-muted"
                data-testid="message-button"
              >
                Message
              </Button>
              {/* View Gallery CTA for Photographers */}
              {['Photographer', 'Approved Pro', 'photographer', 'approved_pro'].includes(profile.role) && (
                <Button
                  onClick={() => navigate(`/photographer/${profileUserId}/gallery`)}
                  className="h-10 px-4 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-black font-semibold"
                  data-testid="view-gallery-button"
                >
                  <Image className="w-4 h-4 mr-2" />
                  Gallery
                </Button>
              )}
              
              {/* More Options (Block, Report) */}
              <div className="relative">
                <Button
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  variant="outline"
                  className="h-10 w-10 p-0 border-zinc-700"
                  data-testid="more-options-button"
                >
                  <MoreHorizontal className="w-4 h-4 text-white" />
                </Button>
                
                {showMoreMenu && (
                  <>
                    {/* Click outside to close */}
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setShowMoreMenu(false)} 
                    />
                    
                    {/* Menu dropdown */}
                    <div className="absolute right-0 top-12 z-50 w-48 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl py-1">
                      {isBlocked ? (
                        <button
                          onClick={() => {
                            setShowMoreMenu(false);
                            handleUnblockUser();
                          }}
                          disabled={blockLoading}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-green-400 hover:bg-zinc-700 transition-colors"
                          data-testid="unblock-user-btn"
                        >
                          {blockLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Ban className="w-4 h-4" />
                          )}
                          Unblock User
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setShowMoreMenu(false);
                            setShowBlockModal(true);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-zinc-700 transition-colors"
                          data-testid="block-user-btn"
                        >
                          <Ban className="w-4 h-4" />
                          Block User
                        </button>
                      )}
                      
                      <button
                        onClick={() => {
                          setShowMoreMenu(false);
                          // Could navigate to report page or open report modal
                          toast.info('Report functionality coming soon');
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-amber-400 hover:bg-zinc-700 transition-colors"
                        data-testid="report-user-btn"
                      >
                        <Flag className="w-4 h-4" />
                        Report User
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* ============ PHOTOGRAPHER AVAILABILITY BUTTON ============ */}
        {!isOwnProfile && isProfilePhotographer && (
          <div className="mb-4">
            <PhotographerAvailability
              photographerId={profileUserId}
              photographerName={profile?.full_name || 'Photographer'}
              onWatchLive={() => {
                // Navigate to live stream or open live viewer
                navigate(`/live/${profileUserId}`);
              }}
              onRequestOnDemand={() => handleQuickBookOpen('on-demand')}
              onBook={() => handleQuickBookOpen('scheduled')}
              trigger={
                <Button
                  className="w-full h-12 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold"
                  data-testid="photographer-availability-btn"
                >
                  <Camera className="w-5 h-5 mr-2" />
                  Check Availability
                  {isOnDemandActive && (
                    <span className="ml-2 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-xs text-green-300">Available</span>
                    </span>
                  )}
                </Button>
              }
            />
          </div>
        )}

        {/* Quick Stats Row - Only for own profile */}
        {isOwnProfile && (
          <div className="flex items-center justify-between bg-zinc-900/50 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="bg-orange-500/20 p-2 rounded-full">
                <Flame className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <p className="text-white font-bold">{streak.current_streak}</p>
                <p className="text-[10px] text-gray-400">Day Streak</p>
              </div>
            </div>
            <div className="h-8 w-px bg-zinc-700" />
            <div className="flex items-center gap-2">
              <div className="bg-emerald-500/20 p-2 rounded-full">
                <DollarSign className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-white font-bold">{(profile.credit_balance || 0).toFixed(0)}</p>
                <p className="text-[10px] text-gray-400">Credits</p>
              </div>
            </div>
            <Button
              onClick={() => navigate('/credits')}
              size="sm"
              className="h-8 text-xs bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              Add Credits
            </Button>
          </div>
        )}

        {/* Tabs */}
        <div className="border-t border-border">
          <div className="flex justify-around">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-3 flex flex-col items-center gap-1 relative transition-colors ${
                  activeTab === tab.id
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground/70'
                }`}
                data-testid={`tab-${tab.id}`}
              >
                {/* Active indicator bar — rides the border-t of the container */}
                {activeTab === tab.id && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-b-full bg-foreground" />
                )}
                <tab.icon className="w-5 h-5" />
                <span className="text-[10px]">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Content Grid */}
      <div className="max-w-2xl mx-auto">
        {activeTab === 'swell' && impactScore?.is_photographer ? (
          // Swell Tab - Combined Crew + Impact for photographers
          <div className="p-4 space-y-6">
            {/* Impact Section */}
            <div className="space-y-4">
              {/* Impact Level */}
              <div className="bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-xl p-6 text-center border border-cyan-500/30">
                <div className="text-4xl mb-2">
                  {impactScore.impact_score?.level?.emoji || '🌱'}
                </div>
                <p className="text-white font-bold text-xl mb-1">
                  {impactScore.impact_score?.level?.name || 'Starter'}
                </p>
                <p className="text-cyan-400 text-2xl font-bold">
                  {impactScore.impact_score?.total_credits_given?.toFixed(0) || 0} credits given
                </p>
              </div>
              
              {/* Impact Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-900/60 border border-amber-500/30 rounded-lg p-4 text-center">
                  <p className="text-3xl font-bold text-amber-400">
                    {impactScore.impact_score?.total_groms_supported || 0}
                  </p>
                  <p className="text-zinc-400 text-sm">Groms Supported</p>
                </div>
                <div className="bg-zinc-900/60 border border-blue-500/30 rounded-lg p-4 text-center">
                  <p className="text-3xl font-bold text-blue-400">
                    {impactScore.impact_score?.total_causes_supported || 0}
                  </p>
                  <p className="text-zinc-400 text-sm">Causes Supported</p>
                </div>
              </div>
              
              {/* CTA for own profile */}
              {isOwnProfile && (
                <button
                  onClick={() => navigate('/impact')}
                  className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold rounded-lg transition-all"
                >
                  View Impact Dashboard
                </button>
              )}
            </div>
            
            {/* Divider */}
            <div className="border-t border-zinc-800" />
            
            {/* Badges Section */}
            {(gamificationStats.badges?.length > 0 || gamificationStats.total_xp > 0) && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-bold flex items-center gap-2">
                    <Award className="w-5 h-5 text-yellow-400" />
                    Badges
                  </h3>
                  <span className="text-sm text-gray-400">{gamificationStats.badges?.length || 0} earned</span>
                </div>
                
                {/* XP Bar */}
                {gamificationStats.total_xp > 0 && (
                  <div className="bg-zinc-800/50 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-400">Level {gamificationStats.level || 1}</span>
                      <span className="text-sm text-yellow-400">{gamificationStats.total_xp} XP</span>
                    </div>
                    <div className="w-full h-2 bg-zinc-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-yellow-500 to-orange-500"
                        style={{ width: `${Math.min(100, (gamificationStats.total_xp % 1000) / 10)}%` }}
                      />
                    </div>
                  </div>
                )}
                
                {/* Badge Grid */}
                {gamificationStats.badges?.length > 0 && (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
                    {gamificationStats.badges.map((badge, idx) => (
                      <div 
                        key={badge.id || idx}
                        className="flex flex-col items-center p-2 rounded-xl bg-zinc-800/50 hover:bg-zinc-700/50 transition-colors"
                        title={badge.description}
                      >
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center mb-1">
                          {badge.icon_emoji || '🏆'}
                        </div>
                        <span className="text-[10px] text-gray-400 text-center truncate w-full">{badge.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Divider */}
                <div className="border-t border-zinc-800 pt-3" />
              </div>
            )}
            
            {/* Crew Leaderboard */}
            <CrewLeaderboard 
              userId={profileUserId} 
              variant="profile"
              showPrivacyControls={isOwnProfile}
            />
          </div>
        ) : activeTab === 'grom_overview' && isGromParent ? (
          // Grom Overview Tab - Quick stats for Grom Parent
          <div className="p-4 space-y-4" data-testid="grom-overview-tab">
            {/* Quick Stats */}
            <div className="bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-2xl p-6 border border-cyan-500/30">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-cyan-500/20 flex items-center justify-center">
                    <Shield className="w-6 h-6 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-lg">Grom HQ</h3>
                    <p className="text-cyan-400/80 text-sm">Parental Management</p>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-zinc-900/60 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-cyan-400">0</div>
                  <div className="text-xs text-gray-400">Linked Groms</div>
                </div>
                <div className="bg-zinc-900/60 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-400">$0</div>
                  <div className="text-xs text-gray-400">Total Earnings</div>
                </div>
              </div>
              
              <p className="text-center text-sm text-gray-400 mb-4">
                Manage your linked Grom accounts, monitor activity, and control spending
              </p>
            </div>
            
            {/* View Full Dashboard CTA */}
            {isOwnProfile && (
              <button
                onClick={() => navigate('/grom-hq')}
                className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold rounded-lg transition-all"
                data-testid="view-grom-hq-btn"
              >
                Open Grom HQ Dashboard
              </button>
            )}
          </div>
        ) : activeTab === 'stoked' && isStokedEligible ? (
          // Stoked Tab - Surfer impact/credits received
          <StokedTab userId={profileUserId} isOwnProfile={isOwnProfile} />
        ) : activeTab === 'crew' ? (
          // Crew Tab - Crew stats, leaderboard, AND Badges (merged)
          <div className="p-4 space-y-6">
            {/* Badges Section - Show if user has badges */}
            {(gamificationStats.badges?.length > 0 || gamificationStats.total_xp > 0) && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-bold flex items-center gap-2">
                    <Award className="w-5 h-5 text-yellow-400" />
                    Badges
                  </h3>
                  <span className="text-sm text-gray-400">{gamificationStats.badges?.length || 0} earned</span>
                </div>
                
                {/* XP Bar */}
                {gamificationStats.total_xp > 0 && (
                  <div className="bg-zinc-800/50 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-400">Level {gamificationStats.level || 1}</span>
                      <span className="text-sm text-yellow-400">{gamificationStats.total_xp} XP</span>
                    </div>
                    <div className="w-full h-2 bg-zinc-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-yellow-500 to-orange-500"
                        style={{ width: `${Math.min(100, (gamificationStats.total_xp % 1000) / 10)}%` }}
                      />
                    </div>
                  </div>
                )}
                
                {/* Badge Grid */}
                {gamificationStats.badges?.length > 0 && (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
                    {gamificationStats.badges.map((badge, idx) => (
                      <div 
                        key={badge.id || idx}
                        className="flex flex-col items-center p-2 rounded-xl bg-zinc-800/50 hover:bg-zinc-700/50 transition-colors"
                        title={badge.description}
                      >
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center mb-1">
                          {badge.icon_emoji || '🏆'}
                        </div>
                        <span className="text-[10px] text-gray-400 text-center truncate w-full">{badge.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Divider */}
                <div className="border-t border-zinc-800 pt-3" />
              </div>
            )}
            
            {/* Crew Leaderboard */}
            <CrewLeaderboard 
              userId={profileUserId} 
              variant="profile"
              showPrivacyControls={isOwnProfile}
            />
          </div>
        ) : activeTab === 'surfboards' ? (
          // Surfboards Tab
          <SurfboardsTab userId={profileUserId} isOwnProfile={isOwnProfile} />
        ) : tabLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-yellow-500 dark:text-yellow-400" />
          </div>
        ) : tabContent.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
              {activeTab === 'posts' && <Grid3X3 className="w-8 h-8 text-muted-foreground" />}
              {activeTab === 'photos' && <Image className="w-8 h-8 text-muted-foreground" />}
              {activeTab === 'session_shots' && <Waves className="w-8 h-8 text-muted-foreground" />}
              {activeTab === 'videos' && <Play className="w-8 h-8 text-muted-foreground" />}
              {activeTab === 'saved' && <Bookmark className="w-8 h-8 text-muted-foreground" />}
              {activeTab === 'tagged' && <UserSquare2 className="w-8 h-8 text-muted-foreground" />}
            </div>
            <h3 className="text-foreground font-semibold mb-1">
              {activeTab === 'posts' && 'No Posts Yet'}
              {activeTab === 'photos' && 'No Photos Yet'}
              {activeTab === 'session_shots' && 'No Session Shots Yet'}
              {activeTab === 'videos' && 'No Videos Yet'}
              {activeTab === 'saved' && 'No Saved Posts'}
              {activeTab === 'tagged' && 'No Tagged Photos'}
            </h3>
            <p className="text-muted-foreground text-sm">
              {activeTab === 'posts' && (isOwnProfile ? 'Share your surf moments with the community' : 'No posts to show')}
              {activeTab === 'photos' && (isOwnProfile ? 'Your photo posts will appear here' : 'No photos yet')}
              {activeTab === 'session_shots' && (isOwnProfile ? 'Pro shots from photographers will appear here' : 'No session shots yet')}
              {activeTab === 'videos' && (isOwnProfile ? 'Your video posts will show up here' : 'No videos yet')}
              {activeTab === 'saved' && 'Save posts from the feed to view them later'}
              {activeTab === 'tagged' && (isOwnProfile ? 'Photos you\'re tagged in will appear here' : 'No tagged photos')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-0.5">
            {tabContent
              .filter(item => {
                // Basic existence check — show all posts regardless of media URL type.
                // Previously this filter hid videos with local /api/uploads/ paths, but
                // that caused legitimately stored videos to disappear from profile grids.
                const mediaItem = activeTab === 'saved' ? item?.post : item;
                return !!mediaItem;
              })
              .filter(item => {
                // Filter out items without media (ghost placeholders from deleted posts)
                // But allow check-in posts that might not have media
                const mediaItem = activeTab === 'saved' ? item?.post : item;
                if (!mediaItem) return false;
                
                // Has media - show it
                if (mediaItem.media_url || mediaItem.thumbnail_url || (mediaItem.media_urls && mediaItem.media_urls.length > 0)) {
                  return true;
                }
                
                // Check-in posts without media - show with placeholder
                if (mediaItem.is_check_in && mediaItem.location) {
                  return true;
                }
                
                // Posts with caption but no media (text posts) - show with placeholder
                if (mediaItem.caption && mediaItem.caption.trim().length > 0) {
                  return true;
                }
                
                return false;
              })
              .sort((a, b) => {
                // Sort pinned post to the top (only for posts tab)
                if (activeTab === 'posts' && profile?.pinned_post_id) {
                  if (a.id === profile.pinned_post_id) return -1;
                  if (b.id === profile.pinned_post_id) return 1;
                }
                return 0;
              })
              .map((item) => (
              <MediaGridItem 
                key={item.id} 
                item={activeTab === 'saved' ? item.post : item}
                isPinned={activeTab === 'posts' && profile?.pinned_post_id === item.id}
                onClick={async () => {
                  const mediaItem = activeTab === 'saved' ? item.post : item;
                  
                  // Open tagged photo modal for tagged items on own profile
                  if (activeTab === 'tagged' && isOwnProfile) {
                    setSelectedTaggedPhoto(item);
                    setShowTaggedPhotoModal(true);
                    return;
                  }
                  
                  // For Sessions tab: Photographer's shot sessions link to their gallery
                  if (activeTab === 'session_shots' && mediaItem?.is_photographer_session && mediaItem?.gallery_id) {
                    navigate(`/gallery/${mediaItem.gallery_id}`);
                    return;
                  }
                  
                  // Navigate to single post view for all other content
                  if (mediaItem?.id) {
                    navigate(`/post/${mediaItem.id}`);
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Tagged Photo Modal */}
      {isOwnProfile && (
        <TaggedPhotoModal
          isOpen={showTaggedPhotoModal}
          onClose={() => {
            setShowTaggedPhotoModal(false);
            setSelectedTaggedPhoto(null);
          }}
          photo={selectedTaggedPhoto}
          onPhotoViewed={(photoId) => {
            // Update local state to remove NEW badge
            setTabContent(prev => prev.map(p => 
              p.id === photoId ? { ...p, is_new: false } : p
            ));
          }}
        />
      )}

      {/* Edit Profile Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="bg-zinc-900 border-zinc-800 border-t text-white max-w-md !fixed !bottom-[70px] !top-auto !translate-y-0 rounded-t-2xl rounded-b-none max-h-[calc(100dvh-6rem)] flex flex-col p-0">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-zinc-800 flex-shrink-0">
            <button
              onClick={() => setShowEditModal(false)}
              className="text-gray-400 hover:text-white text-sm"
            >
              Cancel
            </button>
            <DialogTitle className="text-lg font-bold">Edit Profile</DialogTitle>
            <Button
              onClick={handleSaveProfile}
              disabled={editLoading}
              size="sm"
              className="bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold px-4"
              data-testid="save-profile-btn"
            >
              {editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
          
          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-6">
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 mb-1.5 block">Name</label>
                <Input
                  value={editData.full_name}
                  onChange={(e) => setEditData(prev => ({ ...prev, full_name: e.target.value }))}
                  className="bg-zinc-800 border-zinc-700 text-white h-11"
                  data-testid="edit-name-input"
                />
              </div>

              <div>
                <label className="text-sm text-gray-400 mb-1.5 block">Bio</label>
                <Textarea
                  value={editData.bio}
                  onChange={(e) => setEditData(prev => ({ ...prev, bio: e.target.value }))}
                  className="bg-zinc-800 border-zinc-700 text-white min-h-[70px]"
                  placeholder="Tell us about yourself..."
                  data-testid="edit-bio-input"
                />
              </div>

              <div>
                <label className="text-sm text-gray-400 mb-1.5 block">Home Break</label>
                <Input
                  value={editData.location}
                  onChange={(e) => setEditData(prev => ({ ...prev, location: e.target.value }))}
                  className="bg-zinc-800 border-zinc-700 text-white h-11"
                  placeholder="e.g., Cocoa Beach Pier"
                  data-testid="edit-location-input"
                />
              </div>

              <div>
                <label className="text-sm text-gray-400 mb-1.5 block">Instagram</label>
                <Input
                  value={editData.instagram_url}
                  onChange={(e) => setEditData(prev => ({ ...prev, instagram_url: e.target.value }))}
                  className="bg-zinc-800 border-zinc-700 text-white h-11"
                  placeholder="@yourusername"
                  data-testid="edit-instagram-input"
                />
              </div>

              <div>
                <label className="text-sm text-gray-400 mb-1.5 block">Website</label>
                <Input
                  value={editData.website_url}
                  onChange={(e) => setEditData(prev => ({ ...prev, website_url: e.target.value }))}
                  className="bg-zinc-800 border-zinc-700 text-white h-11"
                  placeholder="https://yourwebsite.com"
                  data-testid="edit-website-input"
                />
              </div>
              
              {/* Surfer Identification Section */}
              <div className="pt-4 border-t border-zinc-700">
                <p className="text-sm text-cyan-400 font-medium mb-3 flex items-center gap-2">
                  <Camera className="w-4 h-4" />
                  Photographer Identification
                </p>
                <p className="text-xs text-gray-500 mb-4">
                  Help photographers identify you in the water during live sessions
                </p>
                
                {/* Stance */}
                <div className="mb-4">
                  <label className="text-sm text-gray-400 mb-1.5 block">Stance</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditData(prev => ({ ...prev, stance: 'regular' }))}
                      className={`flex-1 py-2.5 rounded-lg border transition-all ${
                        editData.stance === 'regular' 
                          ? 'bg-purple-500/20 border-purple-500 text-purple-400' 
                          : 'bg-zinc-800 border-zinc-700 text-gray-400 hover:border-zinc-600'
                      }`}
                    >
                      Regular
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditData(prev => ({ ...prev, stance: 'goofy' }))}
                      className={`flex-1 py-2.5 rounded-lg border transition-all ${
                        editData.stance === 'goofy' 
                          ? 'bg-purple-500/20 border-purple-500 text-purple-400' 
                          : 'bg-zinc-800 border-zinc-700 text-gray-400 hover:border-zinc-600'
                      }`}
                    >
                      Goofy
                    </button>
                  </div>
                </div>
                
                {/* Wetsuit Color */}
                <div className="mb-4">
                  <label className="text-sm text-gray-400 mb-1.5 block">Wetsuit Color</label>
                  <Input
                    value={editData.wetsuit_color}
                    onChange={(e) => setEditData(prev => ({ ...prev, wetsuit_color: e.target.value }))}
                    className="bg-zinc-800 border-zinc-700 text-white h-11"
                    placeholder="e.g., Full black, Blue/black, Black with red stripe"
                    data-testid="edit-wetsuit-input"
                  />
                </div>
                
                {/* Rash Guard Color */}
                <div>
                  <label className="text-sm text-gray-400 mb-1.5 block">Rash Guard Color</label>
                  <Input
                    value={editData.rash_guard_color}
                    onChange={(e) => setEditData(prev => ({ ...prev, rash_guard_color: e.target.value }))}
                    className="bg-zinc-800 border-zinc-700 text-white h-11"
                    placeholder="e.g., White, Red, Blue with logo"
                    data-testid="edit-rashguard-input"
                  />
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============ QUICK BOOK MODAL ============ */}
      <Dialog open={showQuickBookModal} onOpenChange={setShowQuickBookModal}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              {quickBookType === 'on-demand' ? (
                <>
                  <Zap className="w-5 h-5 text-yellow-400" />
                  Quick Book - On-Demand
                </>
              ) : (
                <>
                  <CalendarClock className="w-5 h-5 text-cyan-400" />
                  Quick Book - Scheduled
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Photographer Info */}
            <div className="flex items-center gap-4 p-4 rounded-xl bg-zinc-800">
              <Avatar className="w-14 h-14 border-2 border-cyan-400">
                <AvatarImage src={getFullUrl(profile?.avatar_url)} />
                <AvatarFallback className="bg-zinc-700 text-cyan-400">
                  {profile?.full_name?.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <h3 className="font-semibold text-white">{profile?.full_name}</h3>
                <p className="text-sm text-gray-400">{profile?.role}</p>
                {quickBookType === 'on-demand' && isOnDemandActive && (
                  <div className="flex items-center gap-1 mt-1">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-xs text-green-400">Available Now</span>
                  </div>
                )}
              </div>
            </div>

            {/* Live Price Calculator */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border border-yellow-400/30">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Calculator className="w-5 h-5 text-yellow-400" />
                  <span className="font-bold text-white">Price Calculator</span>
                </div>
                <span className="text-2xl font-bold text-yellow-400">${quickBookTotal.toFixed(2)}</span>
              </div>
              <p className="text-sm text-gray-400">
                ${quickBookHourlyRate}/hr × {quickBookDuration} hr{quickBookDuration > 1 ? 's' : ''} = ${quickBookTotal.toFixed(2)}
              </p>
            </div>

            {/* Duration Stepper */}
            <NumericStepper
              label="Session Duration"
              value={quickBookDuration}
              onChange={setQuickBookDuration}
              min={0.5}
              max={8}
              step={0.5}
              suffix="hours"
              description={`Rate: $${quickBookHourlyRate}/hour`}
              theme="dark"
            />

            {/* What's included */}
            <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/30">
              <p className="text-green-400 font-medium mb-2">What's Included:</p>
              <ul className="text-sm text-gray-400 space-y-1">
                <li className="flex items-center gap-2">
                  <Camera className="w-4 h-4 text-green-400" />
                  {photographerPricing?.on_demand_photos_included || 3} photos included
                </li>
                <li className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-green-400" />
                  {quickBookDuration} hour{quickBookDuration > 1 ? 's' : ''} of dedicated shooting
                </li>
                {quickBookType === 'on-demand' && (
                  <li className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-green-400" />
                    Immediate response from photographer
                  </li>
                )}
              </ul>
            </div>

            {/* Info note for scheduled */}
            {quickBookType === 'scheduled' && (
              <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                <p className="text-sm text-cyan-400">
                  You'll be redirected to the full booking page to select your preferred date and time.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowQuickBookModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleQuickBookSubmit}
              disabled={quickBookLoading}
              className={`flex-1 ${
                quickBookType === 'on-demand'
                  ? 'bg-gradient-to-r from-yellow-400 to-orange-400 text-black'
                  : 'bg-gradient-to-r from-cyan-400 to-blue-500 text-black'
              } font-bold`}
              data-testid="quick-book-submit-btn"
            >
              {quickBookLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : quickBookType === 'on-demand' ? (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Send Request - ${quickBookTotal.toFixed(2)}
                </>
              ) : (
                <>
                  <CalendarClock className="w-4 h-4 mr-2" />
                  Continue to Booking
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ SCHEDULED BOOKING DRAWER ============ */}
      <ScheduledBookingDrawer
        isOpen={showScheduledBookingDrawer}
        onClose={() => setShowScheduledBookingDrawer(false)}
        photographer={{
          id: profileUserId,
          full_name: profile?.full_name,
          avatar_url: profile?.avatar_url,
          role: profile?.role,
          home_break: profile?.home_break,
          booking_hourly_rate: photographerPricing?.booking_hourly_rate || profile?.booking_hourly_rate,
          hourly_rate: photographerPricing?.hourly_rate || profile?.hourly_rate,
          session_price: photographerPricing?.session_price || profile?.session_price,
          group_discount_2_plus: photographerPricing?.group_discount_2_plus || profile?.group_discount_2_plus,
          group_discount_3_plus: photographerPricing?.group_discount_3_plus || profile?.group_discount_3_plus,
          group_discount_5_plus: photographerPricing?.group_discount_5_plus || profile?.group_discount_5_plus,
          service_radius_miles: profile?.service_radius_miles,
          home_latitude: profile?.home_latitude,
          home_longitude: profile?.home_longitude,
          travel_surcharges: profile?.travel_surcharges,
          charges_travel_fees: profile?.charges_travel_fees
        }}
        onSuccess={(_result) => {
          setShowScheduledBookingDrawer(false);
          toast.success('Booking submitted successfully!');
        }}
      />

      {/* Go Live Modal with Camera */}
      <GoLiveModal
        isOpen={showGoLiveModal}
        onClose={() => setShowGoLiveModal(false)}
        onStreamEnded={handleGoLiveEnded}
      />

      {/* Note Modal - View/Create/Edit Note */}
      <Dialog open={showNoteModal} onOpenChange={setShowNoteModal}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-center">
              {isOwnProfile ? (userNote ? 'Your Note' : 'Share a Note') : `${profile.full_name}'s Note`}
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            {/* Viewing someone else's note */}
            {!isOwnProfile && userNote && (
              <div className="text-center space-y-4">
                <div className="bg-zinc-800 rounded-2xl p-6">
                  <p className="text-lg text-white">{userNote.content}</p>
                  <p className="text-sm text-emerald-400 mt-2">{userNote.time_remaining} remaining</p>
                </div>
                <p className="text-xs text-gray-500">
                  Notes are shared with mutual followers only
                </p>
              </div>
            )}
            
            {/* Own profile - create/edit note */}
            {isOwnProfile && (
              <div className="space-y-4">
                {userNote ? (
                  // Show existing note with option to delete
                  <div className="text-center space-y-4">
                    <div className="bg-zinc-800 rounded-2xl p-6">
                      <p className="text-lg text-white">{userNote.content}</p>
                      <p className="text-sm text-emerald-400 mt-2">{userNote.time_remaining} remaining</p>
                    </div>
                    <p className="text-xs text-gray-400">
                      Shared with {userNote.view_count || 0} mutual followers
                    </p>
                    <Button
                      variant="ghost"
                      onClick={handleDeleteNote}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      data-testid="delete-note-btn"
                    >
                      Delete Note
                    </Button>
                  </div>
                ) : (
                  // Create new note with emoji support
                  <div className="space-y-4">
                    <p className="text-sm text-gray-400 text-center">
                      Shared with followers you follow back
                    </p>
                    <p className="text-xs text-emerald-400 text-center">
                      Notes disappear after 24 hours
                    </p>
                    <Input
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value.slice(0, 60))}
                      placeholder="What's happening? 🤙"
                      className="bg-zinc-800 border-zinc-700 text-white text-lg text-center h-14"
                      maxLength={60}
                      data-testid="note-input"
                    />
                    {/* Quick Emoji Picker */}
                    <div className="flex justify-center flex-wrap gap-2" data-testid="emoji-picker">
                      {['🤙', '🌊', '🏄', '🔥', '💯', '😎', '🌅', '🐚', '🦈', '☀️', '🌴', '✨'].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setNoteText(prev => (prev + emoji).slice(0, 60))}
                          className="text-2xl hover:scale-125 transition-transform p-1"
                          data-testid={`emoji-${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{noteText.length}/60</span>
                      <span>Mutual followers only</span>
                    </div>
                    <div className="flex gap-3">
                      <Button
                        variant="ghost"
                        onClick={() => setShowNoteModal(false)}
                        className="flex-1 text-gray-400"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleCreateNote}
                        disabled={!noteText.trim() || noteSubmitting}
                        className="flex-1 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700"
                        data-testid="submit-note-btn"
                      >
                        {noteSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Share'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Followers/Following Modal */}
      <FollowersModal
        isOpen={showFollowersModal}
        onClose={() => setShowFollowersModal(false)}
        userId={profileUserId}
        type={followersModalType}
        userName={profile?.username ? `@${profile.username}` : profile?.full_name}
      />
      
      {/* Block User Modal */}
      <Dialog open={showBlockModal} onOpenChange={setShowBlockModal}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg text-red-400">
              <Ban className="w-5 h-5" />
              Block {profile?.full_name || 'User'}?
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 mt-2">
            {/* Warning about blocking */}
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-zinc-300">
                  <p className="font-medium text-red-400 mb-1">When you block someone:</p>
                  <ul className="space-y-1 text-zinc-400">
                    <li>• They won't be able to message you</li>
                    <li>• They won't see your posts or profile</li>
                    <li>• They won't be able to follow you</li>
                    <li>• Any existing follow will be removed</li>
                  </ul>
                </div>
              </div>
            </div>
            
            {/* Reason selector */}
            <div>
              <label className="text-sm font-medium text-zinc-300 mb-2 block">
                Reason (optional)
              </label>
              <select
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                data-testid="block-reason-select"
              >
                <option value="">Select a reason...</option>
                <option value="harassment">Harassment</option>
                <option value="spam">Spam</option>
                <option value="inappropriate">Inappropriate content</option>
                <option value="scam">Scam/Fraud</option>
                <option value="other">Other</option>
              </select>
            </div>
            
            {/* Notes (optional) */}
            <div>
              <label className="text-sm font-medium text-zinc-300 mb-2 block">
                Additional notes (private, optional)
              </label>
              <textarea
                value={blockNotes}
                onChange={(e) => setBlockNotes(e.target.value)}
                placeholder="Add any notes about why you're blocking this user..."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white resize-none h-20"
                data-testid="block-notes-input"
              />
            </div>
            
            {/* Auto-report notice for severe reasons */}
            {(blockReason === 'harassment' || blockReason === 'scam') && (
              <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <p className="text-xs text-amber-400 flex items-center gap-2">
                  <Flag className="w-4 h-4" />
                  This will also report the user to our safety team
                </p>
              </div>
            )}
            
            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <Button
                onClick={() => {
                  setShowBlockModal(false);
                  setBlockReason('');
                  setBlockNotes('');
                }}
                variant="outline"
                className="flex-1 border-zinc-700"
              >
                Cancel
              </Button>
              <Button
                onClick={handleBlockUser}
                disabled={blockLoading}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                data-testid="confirm-block-btn"
              >
                {blockLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Ban className="w-4 h-4 mr-2" />
                )}
                Block User
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Media Grid Item Component
const MediaGridItem = ({ item, onClick, isPinned = false }) => {
  if (!item) return null;
  
  // Helper to intercept Netlify HTML proxy traps on local backend arrays
  const _checkMediaUrl = getFullUrl(item.media_url || item.image_url);
  const isVideo = item.media_type === 'video' || (typeof _checkMediaUrl === 'string' && _checkMediaUrl.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i));
  const isNew = item.is_new;
  const hasMedia = item.media_url || item.thumbnail_url || (item.media_urls && item.media_urls.length > 0);
  const isCheckIn = item.is_check_in;
  const isPhotographerSession = item.is_photographer_session;
  
  return (
    <div 
      className="aspect-square relative cursor-pointer group bg-muted"
      onClick={onClick}
      data-testid={`media-item-${item.id}`}
    >
      {hasMedia ? (
        isVideo ? (
          <>
            <img
              src={getFullUrl(item.thumbnail_url || item.media_url)}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
            <div className="absolute top-2 right-2 bg-black/60 px-1.5 py-0.5 rounded text-white text-xs flex items-center gap-1">
              <Play className="w-3 h-3" fill="currentColor" />
              {item.video_duration ? `${Math.round(item.video_duration)}s` : ''}
            </div>
          </>
        ) : (
          <img
            src={getFullUrl(item.thumbnail_url || item.media_url)}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        )
      ) : isPhotographerSession ? (
        // Placeholder for photographer session without conditions media
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-cyan-900 to-zinc-900 p-2">
          <Camera className="w-8 h-8 text-cyan-400 mb-1" />
          <span className="text-[10px] text-gray-400 text-center line-clamp-2">{item.location || 'Session'}</span>
          {item.item_count > 0 && (
            <span className="text-[9px] text-cyan-400 mt-1">{item.item_count} photos</span>
          )}
        </div>
      ) : (
        // Placeholder for check-in or text-only posts
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 p-2">
          {isCheckIn ? (
            <>
              <MapPin className="w-8 h-8 text-cyan-400 mb-1" />
              <span className="text-[10px] text-gray-400 text-center line-clamp-2">{item.location || 'Check-in'}</span>
            </>
          ) : (
            <>
              <Grid3X3 className="w-8 h-8 text-yellow-400 mb-1" />
              <span className="text-[10px] text-gray-400 text-center line-clamp-2">{item.caption?.substring(0, 30) || 'Post'}</span>
            </>
          )}
        </div>
      )}
      
      {/* Photo count badge for photographer sessions */}
      {isPhotographerSession && hasMedia && item.item_count > 0 && (
        <div className="absolute bottom-2 left-2 bg-black/70 px-1.5 py-0.5 rounded text-white text-xs flex items-center gap-1">
          <Camera className="w-3 h-3" />
          {item.item_count}
        </div>
      )}
      
      {/* PINNED Badge - Instagram-style */}
      {isPinned && (
        <div className="absolute top-2 left-2 bg-white/90 dark:bg-black/80 px-2 py-0.5 rounded-full text-xs font-bold flex items-center gap-1 shadow-lg" data-testid="pinned-indicator">
          <Pin className="w-3 h-3 text-amber-500" />
          <span className="text-foreground">Pinned</span>
        </div>
      )}
      
      {/* NEW Badge for unviewed tagged photos */}
      {isNew && !isPinned && (
        <div className="absolute top-2 left-2 bg-gradient-to-r from-cyan-400 to-blue-500 px-2 py-0.5 rounded-full text-black text-xs font-bold animate-pulse">
          NEW
        </div>
      )}
      
      {/* Access granted indicator */}
      {item.access_granted && (
        <div className="absolute bottom-2 right-2 bg-green-500/80 p-1 rounded-full">
          <Check className="w-3 h-3 text-white" />
        </div>
      )}
      
      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <div className="flex items-center gap-4 text-white text-sm">
          {item.likes_count !== undefined && (
            <span className="flex items-center gap-1">
              ❤️ {item.likes_count}
            </span>
          )}
          {item.tagged_by && (
            <span className="flex items-center gap-1">
              Tagged by {item.tagged_by}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
