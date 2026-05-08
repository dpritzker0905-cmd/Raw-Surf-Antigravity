import React from 'react';
import {
  Camera, MapPin, Flame, Radio, Heart, Trophy, Ban, Check, Loader2, UserPlus, UserMinus,
  Instagram, Globe, ExternalLink, Settings
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { getFullUrl } from '../utils/media';
import { getExpandedRoleInfo } from '../contexts/PersonaContext';
import { XPDisplay, BadgeRow } from './GamificationUI';
import TrustSignalBadges from './ui/TrustSignalBadges';

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

/**
 * ProfileHeader — Extracted from Profile.js
 * Renders the avatar, note bubble, name, username, stats row,
 * role badges, bio, social links, and action buttons.
 */
export const ProfileHeader = ({
  profile,
  profileUserId,
  isOwnProfile,
  displayRole,
  isPhotographer,
  isProfilePhotographer,
  // Stats
  contentStats,
  socialStats,
  streak,
  impactScore,
  gamificationStats,
  // Notes hook
  notesHook,
  // Block hook
  blockHook,
  // Follow
  isFollowing,
  followLoading,
  handleFollow,
  // Avatar
  avatarUploading,
  fileInputRef,
  handleAvatarUpload,
  // Actions
  navigate,
  setShowEditModal,
  toggleLive,
  setProfile,
  // UI state
  setFollowersModalType,
  setShowFollowersModal,
  // Auth
  user,
  apiClient,
}) => {
  return (
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
                  const { toast } = await import('sonner');
                  toast.success(newVal ? 'Avatar set to Logo mode' : 'Avatar set to Photo mode');
                } catch (e) {
                  const { toast } = await import('sonner');
                  toast.error('Failed to update avatar mode');
                }
              }}
              className="absolute -bottom-1 -right-1 z-20 w-7 h-7 rounded-full bg-zinc-800 border-2 border-zinc-600 hover:border-cyan-400 flex items-center justify-center transition-all group/logo"
              data-testid="avatar-mode-toggle"
              title={profile.is_logo_avatar ? 'Switch to Photo mode' : 'Switch to Logo mode'}
            >
              <span className="text-[10px] font-bold text-zinc-300 group-hover/logo:text-cyan-400">
                {profile.is_logo_avatar ? '🤙' : '???'}
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
                    navigate(`/messages/${response.data.conversation_id}`, { 
                      state: { fromProfile: profileUserId } 
                    });
                  } else {
                    navigate(`/messages/new/${profileUserId}`, { 
                      state: { 
                        recipientName: profile.full_name, 
                        recipientAvatar: profile.avatar_url 
                      } 
                    });
                  }
                } catch (error) {
                  navigate(`/messages/new/${profileUserId}`, {
                    state: { 
                      recipientName: profile.full_name, 
                      recipientAvatar: profile.avatar_url 
                    }
                  });
                }
              }}
              variant="outline"
              className="h-10 px-4 border-border text-foreground"
              data-testid="message-button"
            >
              Message
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
