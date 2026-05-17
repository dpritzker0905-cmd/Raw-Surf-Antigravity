/**
 * ProfileActionButtons - Own-profile and other-profile action buttons
 * Extracted from Profile.js for modularization (v72)
 */
import React from 'react';
import {
  Camera, Settings, Loader2, UserPlus, UserMinus, Heart,
  Radio, Image, MoreHorizontal, Ban, Flag,
} from 'lucide-react';
import { Button } from '../ui/button';

var ProfileActionButtons = ({
  isOwnProfile, profile, navigate,
  // Own-profile props
  setShowEditModal, toggleLive, isPhotographer,
  // Other-profile props
  handleFollow, followLoading, isFollowing,
  apiClient, toast, user, profileUserId,
  blockHook,
}) => (
  <div className="flex gap-2 mb-4">
    {isOwnProfile ? (
      <>
        <Button
          onClick={() => setShowEditModal(true)}
          className="flex-1 bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border shadow-sm font-medium text-sm h-10"
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
            try {
              const response = await apiClient.get(`/messages/check-thread/${user.id}/${profileUserId}`);
              if (response.data.exists) {
                navigate(`/messages/${response.data.conversation_id}`, { 
                  state: { fromProfile: profileUserId } 
                });
              } else {
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
);

export default ProfileActionButtons;
