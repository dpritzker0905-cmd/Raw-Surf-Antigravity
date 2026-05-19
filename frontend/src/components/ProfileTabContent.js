/**
 * ProfileTabContent.js
 * Extracted from Profile.js -- renders the tab content grid (swell, grom_overview,
 * stoked, crew, surfboards, reviews, and media grid tabs).
 * 
 * This extraction reduces the Profile.js render method by ~330 lines.
 */
import React from 'react';
import {
  Grid3X3, Bookmark, UserSquare2, Play, Waves, Image,
  Loader2, Shield, Award
} from 'lucide-react';
import { StokedTab } from './StokedTab';
import { CrewLeaderboard } from './CrewLeaderboard';
import { SurfboardsTab } from './SurfboardsTab';
import { ProfileReviewsSection } from './ProfileReviewsSection';
import { MediaGridItem } from './MediaGridItem';

const ProfileTabContent = ({
  activeTab,
  impactScore,
  isOwnProfile,
  navigate,
  profile,
  gamificationStats,
  tabLoading,
  tabContent,
  profileUserId,
  isPhotographer,
  theme,
  isStokedEligible,
  isGromParent,
  setSelectedTaggedPhoto,
  setShowTaggedPhotoModal,
}) => {
  // === Stats Tab (photographers) ===
  if (activeTab === 'stats' && impactScore?.is_photographer) {
    return (
      <div className="p-4 space-y-6">
        {/* Impact Section */}
        <div className="space-y-4">
          {/* Impact Level */}
          <div className="bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-xl p-6 text-center border border-cyan-500/30">
            <div className="text-4xl mb-2">
 {impactScore.impact_score?.level?.emoji || '='}
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
        {gamificationStats.badges?.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold flex items-center gap-2">
                <Award className="w-5 h-5 text-yellow-400" />
                Badges
              </h3>
              <span className="text-sm text-gray-400">{gamificationStats.badges.length} earned</span>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
              {gamificationStats.badges.map((badge, idx) => (
                <div 
                  key={badge.id || idx}
                  className="flex flex-col items-center p-2 rounded-xl bg-zinc-800/50 hover:bg-zinc-700/50 transition-colors"
                  title={badge.description}
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center mb-1">
 {badge.icon_emoji || '='}
                  </div>
                  <span className="text-[10px] text-gray-400 text-center truncate w-full">{badge.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Crew Leaderboard */}
        <CrewLeaderboard 
          userId={profileUserId} 
          variant="profile"
          showPrivacyControls={isOwnProfile}
        />
      </div>
    );
  }

  // === Grom Overview Tab (Grom Parents) ===
  if (activeTab === 'grom_overview' && isGromParent) {
    return (
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
    );
  }

  // === Stoked Tab ===
  if (activeTab === 'stoked' && isStokedEligible) {
    return <StokedTab userId={profileUserId} isOwnProfile={isOwnProfile} />;
  }

  // === Crew Tab ===
  if (activeTab === 'crew') {
    return (
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
 {badge.icon_emoji || '='}
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
    );
  }

  // === Surfboards Tab ===
  if (activeTab === 'surfboards') {
    return <SurfboardsTab userId={profileUserId} isOwnProfile={isOwnProfile} />;
  }

  // === Reviews Tab ===
  if (activeTab === 'reviews') {
    return (
      <div className="p-4">
        <ProfileReviewsSection
          profileUserId={profileUserId}
          isPhotographer={isPhotographer}
          theme={theme}
        />
      </div>
    );
  }

  // === Loading State ===
  if (tabLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-500 dark:text-yellow-400" />
      </div>
    );
  }

  // === Empty State ===
  if (tabContent.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        {activeTab === 'posts' && <Grid3X3 className="w-8 h-8 text-muted-foreground" />}
        {activeTab === 'photos' && <Image className="w-8 h-8 text-muted-foreground" />}
        {activeTab === 'session_shots' && <Waves className="w-8 h-8 text-muted-foreground" />}
        {activeTab === 'videos' && <Play className="w-8 h-8 text-muted-foreground" />}
        {activeTab === 'saved' && <Bookmark className="w-8 h-8 text-muted-foreground" />}
        {activeTab === 'tagged' && <UserSquare2 className="w-8 h-8 text-muted-foreground" />}
        <p className="text-sm text-muted-foreground mt-2 font-semibold">
          {activeTab === 'posts' && 'No Posts Yet'}
          {activeTab === 'photos' && 'No Photos Yet'}
          {activeTab === 'session_shots' && 'No Session Shots Yet'}
          {activeTab === 'videos' && 'No Videos Yet'}
          {activeTab === 'saved' && 'No Saved Posts'}
          {activeTab === 'tagged' && 'No Tagged Photos'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {activeTab === 'posts' && (isOwnProfile ? 'Share your surf moments with the community' : 'No posts to show')}
          {activeTab === 'photos' && (isOwnProfile ? 'Your photo posts will appear here' : 'No photos yet')}
          {activeTab === 'session_shots' && (isOwnProfile ? 'Pro shots from photographers will appear here' : 'No session shots yet')}
          {activeTab === 'videos' && (isOwnProfile ? 'Your video posts will show up here' : 'No videos yet')}
          {activeTab === 'saved' && 'Save posts from the feed to view them later'}
          {activeTab === 'tagged' && (isOwnProfile ? 'Photos you\'re tagged in will appear here' : 'No tagged photos')}
        </p>
      </div>
    );
  }

  // === Media Grid (posts, photos, session_shots, videos, saved, tagged) ===
  return (
    <div className="grid grid-cols-3 gap-0.5">
      {tabContent
        .filter(item => {
          const mediaItem = activeTab === 'saved' ? item?.post : item;
          return !!mediaItem;
        })
        .filter(item => {
          const mediaItem = activeTab === 'saved' ? item?.post : item;
          if (!mediaItem) return false;
          if (mediaItem.media_url || mediaItem.thumbnail_url || (mediaItem.media_urls && mediaItem.media_urls.length > 0)) return true;
          if (mediaItem.is_check_in && mediaItem.location) return true;
          if (mediaItem.caption && mediaItem.caption.trim().length > 0) return true;
          return false;
        })
        .sort((a, b) => {
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
              navigate(`/photographer/${profileUserId}/gallery?gallery=${mediaItem.gallery_id}`);
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
  );
};

export default ProfileTabContent;
