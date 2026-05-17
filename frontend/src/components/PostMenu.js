/**
 * PostMenu - Instagram-style post options menu
 * Different options for own posts vs other users' posts
 */

import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigate } from 'react-router-dom';
import apiClient from '../lib/apiClient';
import { 
  Trash2, Edit2, EyeOff, ExternalLink, Share2, Link, Flag, UserMinus, Star, Users,
  Loader2, Pin, MessageSquareOff, UserCircle
} from 'lucide-react';
import { Button } from './ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription
} from './ui/dialog';
import { 
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from './ui/drawer';
import { toast } from 'sonner';
import { useMediaQuery } from '../hooks/useMediaQuery';
import logger from '../utils/logger';


/**
 * Menu item component
 */
var MenuItem = ({ 
  icon: Icon, 
  label, 
  onClick, 
  variant = 'default', 
  loading = false,
  disabled = false,
  isLight 
}) => {
  const variants = {
    default: isLight ? 'text-gray-700 hover:bg-gray-100' : 'text-white hover:bg-zinc-800',
    danger: 'text-red-500 hover:bg-red-500/10',
    warning: 'text-yellow-500 hover:bg-yellow-500/10',
    success: 'text-green-500 hover:bg-green-500/10'
  };

  return (
    <button aria-label="Loader2"
      onClick={onClick}
      disabled={disabled || loading}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left ${variants[variant]} transition-colors disabled:opacity-50`}
      data-testid={`menu-item-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : (
        <Icon className="w-5 h-5" />
      )}
      <span className="font-medium">{label}</span>
    </button>
  );
};

/**
 * Divider component
 */
var _MenuDivider = ({ isLight }) => (
  <div className={`h-px ${isLight ? 'bg-gray-200' : 'bg-zinc-700'} my-1`} />
);

/**
 * Edit Post Modal - Full session metadata editing
 */
import EditPostModal from './post-menu/EditPostModal';
import DeleteConfirmModal from './post-menu/DeleteConfirmModal';
import ReportPostModal from './post-menu/ReportPostModal';
import SharePostModal from './post-menu/SharePostModal';


/**
 * Main Post Menu Component
 */
export var PostMenu = ({ 
  post, 
  open, 
  onClose,
  onPostUpdated,
  onPostDeleted,
  onIWasThere,
  isFollowingAuthor = false,
  _onFollow,
  onUnfollow
}) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const isLight = theme === 'light';
  const isMobile = useMediaQuery('(max-width: 768px)');
  
  // Store the post data locally so it's available even after parent closes
  const [localPost, setLocalPost] = useState(post);
  
  // Update local post when prop changes
  React.useEffect(() => {
    if (post) {
      setLocalPost(post);
    }
  }, [post]);
  
  // Use localPost for all operations to avoid null reference
  const activePost = localPost || post;
  
  // Check if this is user's own post (must be after activePost definition)
  const isOwnPost = activePost?.author_id === user?.id;
  
  // Sub-modal states
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  
  // Loading states
  const [actionLoading, setActionLoading] = useState(null);
  
  // Pinned state
  const [isPinned, setIsPinned] = useState(false);

  // Handle pin/unpin post to profile
  const handlePinPost = async () => {
    if (!activePost?.id || !user?.id) return;
    setActionLoading('pin');
    try {
      const response = await apiClient.post(`/posts/${activePost.id}/pin`);
      if (response.data.pinned) {
        setIsPinned(true);
        toast.success('Post pinned to profile');
      } else {
        setIsPinned(false);
        toast.success('Post unpinned from profile');
      }
      onClose();
    } catch (error) {
      toast.error('Failed to update pin');
    } finally {
      setActionLoading(null);
    }
  };

  // Handle edit post - now supports all session metadata
  const handleEditPost = async (updates) => {
    if (!activePost?.id || !user?.id) {
      toast.error('Unable to update post');
      return;
    }
    try {
      logger.debug('Updating post:', activePost.id, 'with user:', user.id, 'updates:', updates);
      await apiClient.patch(`/posts/${activePost.id}?user_id=${user.id}`, updates);
      toast.success('Post updated');
      onPostUpdated?.({ ...activePost, ...updates });
    } catch (error) {
      logger.error('Edit error:', error.response?.data || error);
      toast.error(error.response?.data?.detail || 'Failed to update post');
      throw error; // Re-throw so the modal can handle it
    }
  };

  // Handle delete post
  const handleDeletePost = async () => {
    if (!activePost?.id || !user?.id) {
      toast.error('Unable to delete post');
      return;
    }
    try {
      await apiClient.delete(`/posts/${activePost.id}?user_id=${user.id}`);
      toast.success('Post deleted');
      onPostDeleted?.(activePost.id);
      onClose();
    } catch (error) {
      logger.error('Delete error:', error.response?.data || error);
      toast.error(error.response?.data?.detail || 'Failed to delete post');
    }
  };

  // Handle toggle like count visibility
  const handleToggleLikeCount = async () => {
    if (!activePost?.id || !user?.id) return;
    setActionLoading('like-count');
    try {
      await apiClient.patch(`/posts/${activePost.id}/settings?user_id=${user.id}`, {
        hide_like_count: !activePost.hide_like_count
      });
      toast.success(activePost.hide_like_count ? 'Like count shown' : 'Like count hidden');
      onPostUpdated?.({ ...activePost, hide_like_count: !activePost.hide_like_count });
      onClose();
    } catch (error) {
      toast.error('Failed to update setting');
    } finally {
      setActionLoading(null);
    }
  };

  // Handle toggle commenting
  const handleToggleCommenting = async () => {
    if (!activePost?.id || !user?.id) return;
    setActionLoading('commenting');
    try {
      await apiClient.patch(`/posts/${activePost.id}/settings?user_id=${user.id}`, {
        comments_disabled: !activePost.comments_disabled
      });
      toast.success(activePost.comments_disabled ? 'Comments enabled' : 'Comments disabled');
      onPostUpdated?.({ ...activePost, comments_disabled: !activePost.comments_disabled });
      onClose();
    } catch (error) {
      toast.error('Failed to update setting');
    } finally {
      setActionLoading(null);
    }
  };

  // Handle unfollow
  const handleUnfollow = async () => {
    if (!activePost?.author_id) return;
    setActionLoading('unfollow');
    try {
      await onUnfollow?.(activePost.author_id);
      onClose();
    } catch (error) {
      toast.error('Failed to unfollow');
    } finally {
      setActionLoading(null);
    }
  };

  // Handle add to favorites
  const handleAddToFavorites = async () => {
    if (!activePost?.id || !user?.id) return;
    setActionLoading('favorites');
    try {
      await apiClient.post(`/users/${user.id}/favorites`, {
        post_id: activePost.id
      });
      toast.success('Added to favorites');
      onClose();
    } catch (error) {
      if (error.response?.status === 409) {
        toast.info('Already in favorites');
      } else {
        toast.error('Failed to add to favorites');
      }
    } finally {
      setActionLoading(null);
    }
  };

  // Handle copy link
  const handleCopyLink = () => {
    if (!activePost?.id) return;
    const postUrl = `${window.location.origin}/post/${activePost.id}`;
    navigator.clipboard.writeText(postUrl);
    toast.success('Link copied to clipboard');
    onClose();
  };

  // Handle go to post
  const handleGoToPost = () => {
    if (!activePost?.id) return;
    navigate(`/post/${activePost.id}`);
    onClose();
  };

  // Handle view profile
  const handleViewProfile = () => {
    if (!activePost?.author_id) return;
    navigate(`/profile/${activePost.author_id}`);
    onClose();
  };

  // Menu content - close menu BEFORE opening sub-modals to avoid overlay stacking
  const MenuContent = () => (
    <div className={`${isLight ? 'divide-gray-200' : 'divide-zinc-700'} divide-y`}>
      {isOwnPost ? (
        // Own post menu options
        <>
          <div>
            <MenuItem 
              icon={Trash2} 
              label="Delete" 
              onClick={() => { onClose(); setTimeout(() => setShowDeleteModal(true), 100); }}
              variant="danger"
              isLight={isLight}
            />
          </div>
          <div>
            <MenuItem 
              icon={Edit2} 
              label="Edit" 
              onClick={() => { onClose(); setTimeout(() => setShowEditModal(true), 100); }}
              isLight={isLight}
            />
            <MenuItem 
              icon={Pin} 
              label={isPinned ? "Unpin from profile" : "Pin to profile"} 
              onClick={handlePinPost}
              loading={actionLoading === 'pin'}
              isLight={isLight}
            />
            <MenuItem 
              icon={EyeOff} 
              label={activePost?.hide_like_count ? "Show like count" : "Hide like count to others"} 
              onClick={handleToggleLikeCount}
              loading={actionLoading === 'like-count'}
              isLight={isLight}
            />
            <MenuItem 
              icon={MessageSquareOff} 
              label={activePost?.comments_disabled ? "Turn on commenting" : "Turn off commenting"} 
              onClick={handleToggleCommenting}
              loading={actionLoading === 'commenting'}
              isLight={isLight}
            />
          </div>
          <div>
            <MenuItem 
              icon={ExternalLink} 
              label="Go to post" 
              onClick={handleGoToPost}
              isLight={isLight}
            />
            <MenuItem 
              icon={Share2} 
              label="Share to..." 
              onClick={() => { onClose(); setTimeout(() => setShowShareModal(true), 100); }}
              isLight={isLight}
            />
            <MenuItem 
              icon={Link} 
              label="Copy link" 
              onClick={handleCopyLink}
              isLight={isLight}
            />
          </div>
          <div>
            <MenuItem 
              icon={UserCircle} 
              label="About this account" 
              onClick={handleViewProfile}
              isLight={isLight}
            />
          </div>
        </>
      ) : (
        // Other user's post menu options
        <>
          <div>
            <MenuItem 
              icon={Flag} 
              label="Report" 
              onClick={() => { onClose(); setTimeout(() => setShowReportModal(true), 100); }}
              variant="danger"
              isLight={isLight}
            />
          </div>
          <div>
            {isFollowingAuthor && (
              <MenuItem 
                icon={UserMinus} 
                label="Unfollow" 
                onClick={handleUnfollow}
                loading={actionLoading === 'unfollow'}
                variant="warning"
                isLight={isLight}
              />
            )}
            <MenuItem 
              icon={Star} 
              label="Add to favorites" 
              onClick={handleAddToFavorites}
              loading={actionLoading === 'favorites'}
              isLight={isLight}
            />
            <MenuItem 
              icon={Users} 
              label="I was there too" 
              onClick={() => { onClose(); onIWasThere?.(); }}
              variant="success"
              isLight={isLight}
            />
          </div>
          <div>
            <MenuItem 
              icon={UserCircle} 
              label="About this account" 
              onClick={handleViewProfile}
              isLight={isLight}
            />
            <MenuItem 
              icon={ExternalLink} 
              label="Go to post" 
              onClick={handleGoToPost}
              isLight={isLight}
            />
          </div>
          <div>
            <MenuItem 
              icon={Share2} 
              label="Share to..." 
              onClick={() => { onClose(); setShowShareModal(true); }}
              isLight={isLight}
            />
            <MenuItem 
              icon={Link} 
              label="Copy link" 
              onClick={handleCopyLink}
              isLight={isLight}
            />
          </div>
        </>
      )}
    </div>
  );

  // Render drawer on mobile, dialog on desktop
  if (isMobile) {
    return (
      <>
        <Drawer open={open} onOpenChange={onClose}>
          <DrawerContent className={isLight ? 'bg-white' : 'bg-zinc-900'} aria-describedby="post-menu-drawer-description">
            <DrawerHeader className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
              <DrawerTitle>Post Options</DrawerTitle>
              <p id="post-menu-drawer-description">Actions for this post</p>
            </DrawerHeader>
            <MenuContent />
            <DrawerFooter>
              <DrawerClose asChild>
                <Button variant="outline" className="w-full">
                  Cancel
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
        
        {/* Sub-modals */}
        <EditPostModal 
          post={activePost} 
          open={showEditModal} 
          onClose={() => setShowEditModal(false)} 
          onSave={handleEditPost}
          isLight={isLight}
        />
        <DeleteConfirmModal 
          open={showDeleteModal} 
          onClose={() => setShowDeleteModal(false)} 
          onConfirm={handleDeletePost}
          isLight={isLight}
        />
        <ReportPostModal 
          post={activePost}
          open={showReportModal} 
          onClose={() => setShowReportModal(false)}
          isLight={isLight}
        />
        <SharePostModal 
          post={activePost}
          open={showShareModal} 
          onClose={() => setShowShareModal(false)}
          isLight={isLight}
        />
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent 
          className={`${isLight ? 'bg-white' : 'bg-zinc-900'} p-0 max-w-xs overflow-hidden`}
          aria-describedby="post-menu-description"
          hideCloseButton
        >
          <DialogHeader className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', padding: 0 }}>
            <DialogTitle>Post Options</DialogTitle>
            <DialogDescription id="post-menu-description">
              Actions for this post
            </DialogDescription>
          </DialogHeader>
          <MenuContent />
          <div className={`p-2 ${isLight ? 'bg-gray-50' : 'bg-zinc-800/50'}`}>
            <Button 
              variant="ghost" 
              onClick={onClose}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Sub-modals */}
      <EditPostModal 
        post={activePost} 
        open={showEditModal} 
        onClose={() => setShowEditModal(false)} 
        onSave={handleEditPost}
        isLight={isLight}
      />
      <DeleteConfirmModal 
        open={showDeleteModal} 
        onClose={() => setShowDeleteModal(false)} 
        onConfirm={handleDeletePost}
        isLight={isLight}
      />
      <ReportPostModal 
        post={activePost}
        open={showReportModal} 
        onClose={() => setShowReportModal(false)}
        isLight={isLight}
      />
      <SharePostModal 
        post={activePost}
        open={showShareModal} 
        onClose={() => setShowShareModal(false)}
        isLight={isLight}
      />
    </>
  );
};

export { SharePostModal };
export default PostMenu;
