import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePersona, getExpandedRoleInfo } from '../contexts/PersonaContext';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { 
  Camera, Settings, DollarSign, MapPin, Flame, 
  Grid3X3, Bookmark, UserSquare2, Play, Waves, ExternalLink,
  Instagram, Globe, Check, Loader2, UserPlus, UserMinus, ArrowLeft, Heart,
  Users, Radio, Image, Shield, Trophy, MoreHorizontal, Ban, Flag,
  Star, Zap, Award
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
import { toast } from 'sonner';
import useProfileActions from '../hooks/useProfileActions';
import { TaggedPhotoModal } from './TaggedPhotoModal';
import { XPDisplay, BadgeRow } from './GamificationUI';
import GoLiveModal from './GoLiveModal';
import { StokedTab } from './StokedTab';
import { CrewLeaderboard } from './CrewLeaderboard';
import { PhotographerAvailability } from './PhotographerAvailability';
import { ScheduledBookingDrawer } from './ScheduledBookingDrawer';
import { SurfboardsTab } from './SurfboardsTab';
import { FollowersModal } from './FollowersModal';
import { ProfileReviewsSection } from './ProfileReviewsSection';
import logger from '../utils/logger';
import apiClient from '../lib/apiClient';
import { getFullUrl } from '../utils/media';
import { ROLES } from '../constants/roles';
import AvatarCropModal from './AvatarCropModal';
import { PhotographerSubscriptionPlans } from './PhotographerSubscriptionPlans';
import TrustSignalBadges from './ui/TrustSignalBadges';

// Extracted hooks
import { useProfileBlock } from '../hooks/useProfileBlock';
import { useProfileNotes } from '../hooks/useProfileNotes';
import { useProfileQuickBook } from '../hooks/useProfileQuickBook';

// Extracted sub-components
import { ProfileEditModal } from './ProfileEditModal';
import { ProfileQuickBookModal } from './ProfileQuickBookModal';
import { ProfileNoteModal } from './ProfileNoteModal';
import { ProfileBlockModal } from './ProfileBlockModal';
import { BadgeSection } from './BadgeSection';
import { MediaGridItem } from './MediaGridItem';
import ProfileTabContent from './ProfileTabContent';

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
  const { theme } = useTheme();
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
  
  // Tab state - read ?tab= param from URL to deep-link to a specific tab (e.g. reviews)
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'posts';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [tabContent, setTabContent] = useState([]);
  const [tabLoading, setTabLoading] = useState(false);
  
  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editData, setEditData] = useState({
    full_name: '', bio: '', location: '', instagram_url: '', website_url: '',
    stance: '', wetsuit_color: '', rash_guard_color: ''
  });
  
  // Avatar upload + crop modal
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [cropFile, setCropFile] = useState(null); // File pending crop
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

  // ============ BLOCK USER (extracted hook) ============
  const blockHook = useProfileBlock(user?.id, profileUserId, isOwnProfile, {
    onBlocked: () => {
      if (isFollowing) {
        setIsFollowing(false);
        setSocialStats(prev => ({ ...prev, followers: Math.max(0, prev.followers - 1) }));
      }
    }
  });

  // ============ NOTES (extracted hook) ============
  const notesHook = useProfileNotes(profileUserId, user?.id);

  // ============ QUICK BOOK (extracted hook) ============
  const quickBookHook = useProfileQuickBook(user, profileUserId, profile);

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
      notesHook.fetchUserNote(); // Fetch the profile user's note
      if (!isOwnProfile && user) {
        checkFollowStatus();
        blockHook.checkBlockStatus();
      }
    }
  }, [profileUserId, isOwnProfile, authLoading, user]);

  useEffect(() => {
    if (authLoading) return;
    if (profileUserId) {
      fetchTabContent(activeTab);
    }
  }, [activeTab, profileUserId, authLoading]);

  // Dynamic Open Graph meta tags for social sharing / link previews
  useEffect(() => {
    if (!profile) return;
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
    const setName = (name, content) => {
      if (!content) return;
      let tag = document.querySelector(`meta[name="${name}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('name', name);
        document.head.appendChild(tag);
        ogTags.push(tag);
      }
      tag.setAttribute('content', content);
    };

    const title = `${profile.full_name || 'User'} - Raw Surf`;
    const description = profile.bio || `Check out ${profile.full_name || 'this user'}'s profile on Raw Surf`;
    const image = profile.avatar_url ? getFullUrl(profile.avatar_url) : null;
    const url = `${window.location.origin}/profile/${profileUserId}`;

    document.title = title;
    setMeta('og:title', title);
    setMeta('og:description', description);
    setMeta('og:image', image);
    setMeta('og:url', url);
    setMeta('og:type', 'profile');
    setMeta('og:site_name', 'Raw Surf');
    setName('twitter:card', image ? 'summary_large_image' : 'summary');
    setName('twitter:title', title);
    setName('twitter:description', description);
    setName('twitter:image', image);

    return () => {
      document.title = 'Raw Surf';
      ogTags.forEach(tag => tag.remove());
    };
  }, [profile, profileUserId]);

  // ============ HANDLERS EXTRACTED ============






  // Note handlers moved to notesHook (useProfileNotes)

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
        // Endpoint doesn't exist yet - fall back to list search
      }
      const response = await apiClient.get(`/following/${user.id}`);
      const following = response.data || [];
      // Compare as strings to avoid UUID type mismatch
      setIsFollowing(following.some(f => String(f.id) === String(profileUserId)));
    } catch (error) {
      logger.error('Error checking follow status:', error);
    }
  };


  // Block/Notes/QuickBook handlers are now in extracted hooks (blockHook, notesHook, quickBookHook)


  const _handleLogout = () => {
    logout();
    navigate('/auth');
    toast.success('Logged out successfully');
  };

  


  // Step 1: User selects file ? open crop modal

  // Step 2: Crop confirmed ? upload the cropped base64


  const {
    fetchProfile,
    fetchStreak,
    fetchSocialStats,
    fetchContentStats,
    fetchImpactScore,
    fetchGamificationStats,
    handleFollow,
    fetchTabContent,
    toggleLive,
    handleGoLiveEnded,
    handleSaveProfile,
    handleAvatarUpload,
    handleCropConfirm,
  } = useProfileActions({
    user, navigate,
    profileUserId,
    profile,
    editData,
    updateUser,
    fileInputRef,
    isFollowing,
    isOwnProfile,
    socialStats,
    streak,
    setAvatarUploading,
    setContentStats,
    setCropFile,
    setEditData,
    setEditLoading,
    setFollowLoading,
    setGamificationStats,
    setImpactScore,
    setIsFollowing,
    setLoading,
    setProfile,
    setShowEditModal,
    setShowGoLiveModal,
    setSocialStats,
    setStreak,
    setTabContent,
    setTabLoading,
  });

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
    // Reviews tab: Show on all profiles
    { id: 'reviews', icon: Star, label: 'Reviews', count: null },
    // Grom Overview tab: Only for Grom Parent (Shield icon)
    ...(isGromParent ? [{ id: 'grom_overview', icon: Shield, label: 'Groms', count: null }] : []),
    // Stoked tab: Only show for Grom, Comp Surfer, Pro (NOT regular Surfer, NOT photographers)
    ...(isStokedEligible && !isPhotographer ? [{ id: 'stoked', icon: Zap, label: 'Stoked', count: null }] : []),
  ];

  return (
    <div className="pb-20 bg-background min-h-screen" data-testid="profile-page">
      {/* JSON-LD Person structured data for SEO */}
      {profile && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Person',
          name: profile.full_name || 'Raw Surf User',
          image: profile.avatar_url ? getFullUrl(profile.avatar_url) : undefined,
          url: `${window.location.origin}/profile/${profileUserId}`,
          description: profile.bio || undefined,
          jobTitle: profile.role || undefined,
        }) }} />
      )}
      {/* Back Button for viewing other profiles */}
      {!isOwnProfile && (
        <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border px-4 py-3">
          <button aria-label="Go back"
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
        {!isOwnProfile && (blockHook.isBlocked || blockHook.isBlockedByThem) && (
          <div className={`mb-4 p-3 rounded-xl border flex items-center gap-3 ${
            blockHook.isBlockedByThem 
              ? 'bg-zinc-800/50 border-zinc-600' 
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            <Ban className={`w-5 h-5 flex-shrink-0 ${blockHook.isBlockedByThem ? 'text-zinc-400' : 'text-red-400'}`} />
            <div className="flex-1">
              <p className={`text-sm font-medium ${blockHook.isBlockedByThem ? 'text-zinc-300' : 'text-red-400'}`}>
                {blockHook.isBlockedByThem 
                  ? 'This user has restricted their profile' 
                  : `You have blocked ${profile?.full_name || 'this user'}`
                }
              </p>
              <p className="text-xs text-zinc-500">
                {blockHook.isBlockedByThem
                  ? 'You cannot view their posts or send them messages.'
                  : 'They cannot see your posts or contact you.'
                }
              </p>
            </div>
            {blockHook.isBlocked && !blockHook.isBlockedByThem && (
              <Button aria-label="Loader2"
                onClick={() => blockHook.handleUnblockUser(profile?.full_name)}
                disabled={blockHook.blockLoading}
                size="sm"
                variant="outline"
                className="border-zinc-600 text-zinc-300 hover:text-white"
              >
                {blockHook.blockLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Unblock'}
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
            {notesHook.userNote && (
              <button
                onClick={() => notesHook.setShowNoteModal(true)}
                className="absolute -top-4 left-1/2 -translate-x-1/2 z-20 animate-in fade-in zoom-in duration-300"
                data-testid="profile-note-bubble"
              >
                <div className="bg-zinc-900/95 backdrop-blur-sm border border-emerald-400 rounded-full px-3 py-1.5 max-w-[160px] shadow-lg hover:scale-105 transition-transform">
                  <p className="text-xs text-gray-100 truncate text-center font-medium">{notesHook.userNote.content}</p>
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
                    : notesHook.userNote 
                      ? 'bg-gradient-to-br from-emerald-400 via-green-500 to-teal-500'
                      : 'bg-gradient-to-br from-zinc-700 to-zinc-800'
              }`}
              onClick={() => notesHook.userNote && notesHook.setShowNoteModal(true)}
              style={{ cursor: notesHook.userNote ? 'pointer' : 'default' }}
            >
              <Avatar className={`w-28 h-28 md:w-32 md:h-32 border-4 border-black ${profile.is_logo_avatar ? 'bg-black' : ''}`} data-testid="profile-avatar">
                <AvatarImage 
                  src={getFullUrl(profile.avatar_url)} 
                  objectFit={profile.is_logo_avatar ? 'contain' : 'cover'}
                  className={profile.is_logo_avatar ? 'p-2' : ''}
                />
                <AvatarFallback className="text-4xl bg-zinc-800 text-white">
                  {profile.full_name?.[0] || 'U'}
                </AvatarFallback>
              </Avatar>
            </div>
            
            {/* Avatar upload overlay */}
            {isOwnProfile && (
              <button aria-label="Loader2"
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
            <input aria-label="Upload file"
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="hidden"
            />

            {/* Logo / Photo Toggle - Only for own profile with avatar */}
            {isOwnProfile && profile.avatar_url && (
              <button
                onClick={async () => {
                  try {
                    const newVal = !profile.is_logo_avatar;
                    await apiClient.patch(`/profiles/${user.id}`, { is_logo_avatar: newVal });
                    setProfile({ ...profile, is_logo_avatar: newVal });
                    toast.success(newVal ? 'Avatar set to Logo mode' : 'Avatar set to Photo mode');
                  } catch (e) {
                    toast.error('Failed to update avatar mode');
                  }
                }}
                className="absolute -bottom-1 -right-1 z-20 w-7 h-7 rounded-full bg-zinc-800 border-2 border-zinc-600 hover:border-cyan-400 flex items-center justify-center transition-all group/logo"
                data-testid="avatar-mode-toggle"
                title={profile.is_logo_avatar ? 'Switch to Photo mode' : 'Switch to Logo mode'}
              >
                <span className="text-[10px] font-bold text-zinc-300 group-hover/logo:text-cyan-400">
                  {profile.is_logo_avatar ? 'ðŸ¤™' : '???'}
                </span>
              </button>
            )}
            
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
          {isOwnProfile && !notesHook.userNote && (
            <button
              onClick={() => {
                notesHook.setNoteText('');
                notesHook.setShowNoteModal(true);
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

          {/* Trust Signal Badges - Photographer social proof */}
          {isProfilePhotographer && profileUserId && (
            <div className="w-full max-w-sm mb-3">
              <TrustSignalBadges profileId={profileUserId} compact />
            </div>
          )}

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
                href={profile.instagram_url.startsWith('http') ? profile.instagram_url : `https://instagram.com/${profile.instagram_url.replace(/^@/, '')}`}
                target="_blank" rel="noopener noreferrer"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Instagram className="w-4 h-4" />
                @{profile.instagram_url.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '')}
              </a>
            )}
            {profile.website_url && (
              <a 
                href={profile.website_url}
                target="_blank" rel="noopener noreferrer"
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
              <Button aria-label="Radio"
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
                <Button aria-label="Like"
                  onClick={() => navigate('/career/stoke-sponsor')}
                  variant="outline"
                  className="h-10 px-3 border-pink-500/50 text-pink-400 hover:bg-pink-500/10"
                  data-testid="stoke-sponsor-button"
                >
                  <Heart className="w-4 h-4 mr-1" />
                  Stoke
                </Button>
              )}
              <Button aria-label="Settings"
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
                <Button aria-label="Image"
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
                <Button aria-label="More options"
                  aria-expanded={blockHook.showMoreMenu} onClick={() => blockHook.setShowMoreMenu(!blockHook.showMoreMenu)}
                  variant="outline"
                  className="h-10 w-10 p-0 border-zinc-700"
                  data-testid="more-options-button"
                >
                  <MoreHorizontal className="w-4 h-4 text-white" />
                </Button>
                
                {blockHook.showMoreMenu && (
                  <>
                    {/* Click outside to close */}
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => blockHook.setShowMoreMenu(false)} 
                    />
                    
                    {/* Menu dropdown */}
                    <div className="absolute right-0 top-12 z-50 w-48 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl py-1">
                      {blockHook.isBlocked ? (
                        <button aria-label="Loader2"
                          onClick={() => {
                            blockHook.setShowMoreMenu(false);
                            blockHook.handleUnblockUser(profile?.full_name);
                          }}
                          disabled={blockHook.blockLoading}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-green-400 hover:bg-zinc-700 transition-colors"
                          data-testid="unblock-user-btn"
                        >
                          {blockHook.blockLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Ban className="w-4 h-4" />
                          )}
                          Unblock User
                        </button>
                      ) : (
                        <button aria-label="Ban"
                          onClick={() => {
                            blockHook.setShowMoreMenu(false);
                            blockHook.setShowBlockModal(true);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-zinc-700 transition-colors"
                          data-testid="block-user-btn"
                        >
                          <Ban className="w-4 h-4" />
                          Block User
                        </button>
                      )}
                      
                      <button aria-label="Report"
                        onClick={() => {
                          blockHook.setShowMoreMenu(false);
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
              onRequestOnDemand={() => quickBookHook.handleQuickBookOpen('on-demand')}
              onBook={() => quickBookHook.handleQuickBookOpen('scheduled')}
              trigger={
                <Button aria-label="Camera"
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

        {/* ============ PHOTOGRAPHER SUBSCRIPTION PLANS ============ */}
        {!isOwnProfile && isProfilePhotographer && (
          <PhotographerSubscriptionPlans
            photographerId={profileUserId}
            photographerName={profile?.full_name || 'Photographer'}
          />
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
          <div className="flex justify-around" role="tablist" aria-label="Profile sections">
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
                role="tab"
                aria-selected={activeTab === tab.id}
              >
                {/* Active indicator bar - rides the border-t of the container */}
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
        <ProfileTabContent
          activeTab={activeTab}
          impactScore={impactScore}
          isOwnProfile={isOwnProfile}
          navigate={navigate}
          profile={profile}
          gamificationStats={gamificationStats}
          tabLoading={tabLoading}
          tabContent={tabContent}
          profileUserId={profileUserId}
          isPhotographer={isPhotographer}
          theme={theme}
          isStokedEligible={isStokedEligible}
          isGromParent={isGromParent}
          setSelectedTaggedPhoto={setSelectedTaggedPhoto}
          setShowTaggedPhotoModal={setShowTaggedPhotoModal}
        />
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

      {/* Avatar Crop Modal */}
      {cropFile && (
        <AvatarCropModal
          imageFile={cropFile}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropFile(null)}
        />
      )}

      {/* Edit Profile Modal (extracted component) */}
      <ProfileEditModal
        isOpen={showEditModal}
        onClose={setShowEditModal}
        editData={editData}
        setEditData={setEditData}
        onSave={handleSaveProfile}
        editLoading={editLoading}
      />

      {/* ============ SCHEDULED BOOKING DRAWER ============ */}
      <ScheduledBookingDrawer
        isOpen={quickBookHook.showScheduledBookingDrawer}
        onClose={() => quickBookHook.setShowScheduledBookingDrawer(false)}
        photographer={{
          id: profileUserId,
          full_name: profile?.full_name,
          avatar_url: profile?.avatar_url,
          role: profile?.role,
          home_break: profile?.home_break,
          booking_hourly_rate: quickBookHook.photographerPricing?.booking_hourly_rate || profile?.booking_hourly_rate,
          hourly_rate: quickBookHook.photographerPricing?.hourly_rate || profile?.hourly_rate,
          session_price: quickBookHook.photographerPricing?.session_price || profile?.session_price,
          group_discount_2_plus: quickBookHook.photographerPricing?.group_discount_2_plus || profile?.group_discount_2_plus,
          group_discount_3_plus: quickBookHook.photographerPricing?.group_discount_3_plus || profile?.group_discount_3_plus,
          group_discount_5_plus: quickBookHook.photographerPricing?.group_discount_5_plus || profile?.group_discount_5_plus,
          service_radius_miles: profile?.service_radius_miles,
          home_latitude: profile?.home_latitude,
          home_longitude: profile?.home_longitude,
          travel_surcharges: profile?.travel_surcharges,
          charges_travel_fees: profile?.charges_travel_fees
        }}
        onSuccess={(_result) => {
          quickBookHook.setShowScheduledBookingDrawer(false);
          toast.success('Booking submitted successfully!');
        }}
      />

      {/* Go Live Modal with Camera */}
      <GoLiveModal
        isOpen={showGoLiveModal}
        onClose={() => setShowGoLiveModal(false)}
        onStreamEnded={handleGoLiveEnded}
      />

      {/* Note Modal (extracted component) */}
      <ProfileNoteModal
        isOpen={notesHook.showNoteModal}
        onClose={notesHook.setShowNoteModal}
        isOwnProfile={isOwnProfile}
        profileName={profile.full_name}
        userNote={notesHook.userNote}
        noteText={notesHook.noteText}
        setNoteText={notesHook.setNoteText}
        noteSubmitting={notesHook.noteSubmitting}
        onCreateNote={notesHook.handleCreateNote}
        onDeleteNote={notesHook.handleDeleteNote}
      />

      {/* Followers/Following Modal */}
      <FollowersModal
        isOpen={showFollowersModal}
        onClose={() => setShowFollowersModal(false)}
        userId={profileUserId}
        type={followersModalType}
        userName={profile?.username ? `@${profile.username}` : profile?.full_name}
      />
      
      {/* Block User Modal (extracted component) */}
      <ProfileBlockModal
        isOpen={blockHook.showBlockModal}
        onClose={blockHook.setShowBlockModal}
        profileName={profile?.full_name}
        blockReason={blockHook.blockReason}
        setBlockReason={blockHook.setBlockReason}
        blockNotes={blockHook.blockNotes}
        setBlockNotes={blockHook.setBlockNotes}
        blockLoading={blockHook.blockLoading}
        onBlock={() => blockHook.handleBlockUser(profile?.full_name)}
      />
    </div>
  );
};
