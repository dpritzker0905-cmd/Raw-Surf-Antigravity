/**
 * PostCard - Extracted from Feed.js for better maintainability
 * Renders a single post in the feed with all interactions
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../lib/apiClient';
import { getExpandedRoleInfo } from '../contexts/PersonaContext';
import SessionLogHeader from './SessionLogHeader';
import { CommentInputWithEmoji } from './EmojiPicker';
import WhoReactedModal from './WhoReactedModal';
import SessionJoinCard from './SessionJoinCard';
import { RichText, CommentText } from './RichText';
import { MapPin, MessageCircle, Send, Bookmark, MoreHorizontal, Loader2, Play, Radio, Heart, ShoppingBag, ChevronRight, RefreshCw, Volume2, VolumeX, Pause } from 'lucide-react';
import { toast } from 'sonner';
import { getFullUrl } from '../utils/media';
import { formatTimeAgo } from '../utils/formatTime';


// Comment reaction emojis
const COMMENT_REACTIONS = ['❤️', '🤙', '🌊', '🔥'];

/**
 * ReplyItem - Simpler component for reply rendering (non-recursive)
 */
const ReplyItem = ({ reply, userId, _postId, textPrimaryClass, textSecondaryClass, _isLight }) => {
  const navigate = useNavigate();
  const [reactionCount, setReactionCount] = useState(reply.reaction_count || 0);
  const [viewerReaction, setViewerReaction] = useState(reply.viewer_reaction || null);
  const [loading, setLoading] = useState(false);

  const handleReaction = async (emoji = '❤️') => {
    if (!userId) {
      toast.error('Please log in to react');
      return;
    }
    
    setLoading(true);
    try {
      const response = await apiClient.post(
        `/comments/${reply.id}/reactions?user_id=${userId}`,
        { emoji }
      );
      
      if (response.data.action === 'added') {
        setReactionCount(prev => prev + 1);
        setViewerReaction(emoji);
      } else if (response.data.action === 'removed') {
        setReactionCount(prev => Math.max(0, prev - 1));
        setViewerReaction(null);
      } else if (response.data.action === 'updated') {
        setViewerReaction(emoji);
      }
    } catch (err) {
      toast.error('Failed to react');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

  return (
    <div className="ml-6 pl-3 border-l-2 border-zinc-700/50">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <span className={`font-medium ${textPrimaryClass} text-sm cursor-pointer hover:underline`}
            onClick={(e) => { e.stopPropagation(); navigate(`/profile/${reply.author_id}`); }}>
            {reply.author_name}
          </span>
          <CommentText 
            text={reply.content}
            className={`${textSecondaryClass} text-sm ml-1`}
          />
        </div>
      </div>
      <div className={`flex items-center gap-3 mt-1 ${textSecondaryClass} text-xs`}>
        <span className="opacity-70">{formatTime(reply.created_at)}</span>
        {reactionCount > 0 && (
          <span className="font-medium">{reactionCount} like{reactionCount !== 1 ? 's' : ''}</span>
        )}
        <button
          onClick={() => handleReaction('❤️')}
          disabled={loading}
          className={`ml-auto p-1 rounded transition-all ${
            viewerReaction ? 'text-red-500' : `${textSecondaryClass} hover:text-red-400`
          }`}
        >
          <Heart className="w-3.5 h-3.5" fill={viewerReaction ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  );
};

/**
 * CommentWithReaction - Individual comment with like/reaction button and reply support
 */
const CommentWithReaction = ({ 
  comment, 
  userId, 
  postId,
  textPrimaryClass, 
  textSecondaryClass, 
  isLight,
  onReplyAdded,
  onCommentUpdated
}) => {
  const navigate = useNavigate();
  const [reactionCount, setReactionCount] = useState(comment.reaction_count || 0);
  const [viewerReaction, setViewerReaction] = useState(comment.viewer_reaction || null);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [localReplies, setLocalReplies] = useState(comment.replies || []);
  const [showReplies, setShowReplies] = useState(true);
  
  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [savingEdit, setSavingEdit] = useState(false);
  const [localContent, setLocalContent] = useState(comment.content);
  const [localIsEdited, setLocalIsEdited] = useState(comment.is_edited || false);
  const [showMenu, setShowMenu] = useState(false);

  const handleReaction = async (emoji = '❤️') => {
    if (!userId) {
      toast.error('Please log in to react');
      return;
    }
    
    setLoading(true);
    try {
      const response = await apiClient.post(
        `/comments/${comment.id}/reactions?user_id=${userId}`,
        { emoji }
      );
      
      if (response.data.action === 'added') {
        setReactionCount(prev => prev + 1);
        setViewerReaction(emoji);
      } else if (response.data.action === 'removed') {
        setReactionCount(prev => Math.max(0, prev - 1));
        setViewerReaction(null);
      } else if (response.data.action === 'updated') {
        setViewerReaction(emoji);
      }
      
      setShowReactionPicker(false);
    } catch (err) {
      toast.error('Failed to react');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitReply = async () => {
    if (!replyContent.trim()) return;
    
    if (!userId) {
      toast.error('Please log in to reply');
      return;
    }
    
    setSubmittingReply(true);
    try {
      const response = await apiClient.post(
        `/posts/${postId}/comments?user_id=${userId}`,
        { 
          content: replyContent.trim(),
          parent_id: comment.id
        }
      );
      
      const newReply = {
        ...response.data,
        reaction_count: 0,
        viewer_reaction: null
      };
      setLocalReplies(prev => [...prev, newReply]);
      setReplyContent('');
      setShowReplyInput(false);
      setShowReplies(true);
      toast.success('Reply added');
      
      if (onReplyAdded) onReplyAdded();
    } catch (err) {
      toast.error('Failed to add reply');
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editContent.trim() || editContent.trim() === comment.content) {
      setIsEditing(false);
      setEditContent(localContent);
      return;
    }
    
    setSavingEdit(true);
    try {
      const response = await apiClient.put(
        `/posts/${postId}/comments/${comment.id}?user_id=${userId}`,
        { content: editContent.trim() }
      );
      
      setLocalContent(response.data.content);
      setLocalIsEdited(true);
      setIsEditing(false);
      toast.success('Comment updated');
      
      if (onCommentUpdated) onCommentUpdated(comment.id, response.data);
    } catch (err) {
      toast.error('Failed to update comment');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(localContent);
  };

  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

  const replyCount = localReplies.length;
  const isOwner = userId && comment.author_id === userId;

  return (
    <div data-testid={`comment-${comment.id}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className={`w-full p-2 rounded-lg text-sm resize-none ${
                  isLight 
                    ? 'bg-gray-100 border border-gray-200 text-gray-900' 
                    : 'bg-zinc-800 border border-zinc-700 text-white'
                } focus:outline-none focus:ring-1 focus:ring-cyan-500`}
                rows={2}
                autoFocus
                data-testid={`edit-comment-input-${comment.id}`}
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleCancelEdit}
                  className={`px-2 py-1 text-xs rounded ${
                    isLight ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-400 hover:bg-zinc-700'
                  }`}
                  data-testid={`cancel-edit-${comment.id}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={savingEdit || !editContent.trim()}
                  className={`px-2 py-1 text-xs rounded bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50`}
                  data-testid={`save-edit-${comment.id}`}
                >
                  {savingEdit ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <span className={`font-medium ${textPrimaryClass} text-sm cursor-pointer hover:underline`}
                onClick={(e) => { e.stopPropagation(); navigate(`/profile/${comment.author_id}`); }}>
                {comment.author_username ? `@${comment.author_username}` : comment.author_name}
              </span>
              <CommentText 
                text={localContent}
                className={`${textSecondaryClass} text-sm ml-1`}
              />
              {localIsEdited && (
                <span className={`${textSecondaryClass} text-xs ml-1 opacity-60`}>(edited)</span>
              )}
            </>
          )}
        </div>
        
        {/* Edit/Delete menu for owner */}
        {isOwner && !isEditing && (
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className={`p-1 rounded ${textSecondaryClass} hover:opacity-80`}
              data-testid={`comment-menu-${comment.id}`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className={`absolute right-0 top-full mt-1 py-1 rounded-lg shadow-lg z-50 min-w-[100px] ${
                  isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'
                }`}>
                  <button
                    onClick={() => { setIsEditing(true); setShowMenu(false); }}
                    className={`w-full px-3 py-1.5 text-left text-sm ${
                      isLight ? 'hover:bg-gray-100 text-gray-700' : 'hover:bg-zinc-700 text-gray-200'
                    }`}
                    data-testid={`edit-comment-btn-${comment.id}`}
                  >
                    Edit
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      
      {/* Comment actions row */}
      <div className={`flex items-center gap-3 mt-1 ${textSecondaryClass} text-xs`}>
        <span className="opacity-70">{formatTime(comment.created_at)}</span>
        
        {reactionCount > 0 && (
          <span className="font-medium">{reactionCount} like{reactionCount !== 1 ? 's' : ''}</span>
        )}
        
        <button 
          onClick={() => setShowReplyInput(!showReplyInput)}
          className="hover:opacity-80 font-medium"
          data-testid={`reply-btn-${comment.id}`}
        >
          Reply
        </button>
        
        <div className="relative ml-auto">
          <button
            onClick={() => viewerReaction ? handleReaction(viewerReaction) : handleReaction('❤️')}
            onContextMenu={(e) => { e.preventDefault(); setShowReactionPicker(true); }}
            disabled={loading}
            className={`p-1 rounded transition-all ${
              viewerReaction ? 'text-red-500' : `${textSecondaryClass} hover:text-red-400`
            } ${loading ? 'opacity-50' : ''}`}
            data-testid={`comment-like-${comment.id}`}
          >
            {viewerReaction && viewerReaction !== '❤️' ? (
              <span className="text-sm">{viewerReaction}</span>
            ) : (
              <Heart className="w-3.5 h-3.5" fill={viewerReaction ? 'currentColor' : 'none'} />
            )}
          </button>
          
          {showReactionPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowReactionPicker(false)} />
              <div className={`absolute bottom-full right-0 mb-1 flex gap-1 p-1.5 rounded-full shadow-lg z-50 ${
                isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'
              }`}>
                {COMMENT_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className={`w-7 h-7 flex items-center justify-center text-base hover:scale-125 transition-transform rounded-full ${
                      viewerReaction === emoji ? isLight ? 'bg-blue-100' : 'bg-blue-900/30' : ''
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Reply Input */}
      {showReplyInput && (
        <div className="mt-2 ml-6 flex gap-2" data-testid={`reply-input-container-${comment.id}`}>
          <input
            type="text"
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            placeholder={`Reply to ${comment.author_name}...`}
            className={`flex-1 text-sm px-3 py-1.5 rounded-full ${
              isLight ? 'bg-gray-100 border border-gray-200 text-gray-900' : 'bg-zinc-800 border border-zinc-700 text-white'
            } focus:outline-none focus:ring-1 focus:ring-blue-500`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && replyContent.trim()) {
                e.preventDefault();
                handleSubmitReply();
              }
            }}
            data-testid={`reply-input-${comment.id}`}
          />
          <button
            onClick={handleSubmitReply}
            disabled={!replyContent.trim() || submittingReply}
            className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
              replyContent.trim() ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-zinc-700 text-gray-400 cursor-not-allowed'
            }`}
            data-testid={`reply-submit-${comment.id}`}
          >
            {submittingReply ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Post'}
          </button>
        </div>
      )}
      
      {/* View/Hide Replies Toggle */}
      {replyCount > 0 && !showReplies && (
        <button
          onClick={() => setShowReplies(true)}
          className={`mt-2 ml-6 text-xs ${textSecondaryClass} hover:opacity-80 flex items-center gap-1`}
        >
          <span className="w-6 h-px bg-current opacity-50" />
          View {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </button>
      )}
      
      {/* Replies - Use simple ReplyItem instead of recursive CommentWithReaction */}
      {showReplies && localReplies.length > 0 && (
        <div className="mt-2 space-y-2">
          {localReplies.length > 0 && (
            <button
              onClick={() => setShowReplies(false)}
              className={`ml-6 text-xs ${textSecondaryClass} hover:opacity-80 flex items-center gap-1`}
            >
              <span className="w-6 h-px bg-current opacity-50" />
              Hide replies
            </button>
          )}
          {localReplies.map((reply) => (
            <ReplyItem
              key={reply.id}
              reply={reply}
              userId={userId}
              postId={postId}
              textPrimaryClass={textPrimaryClass}
              textSecondaryClass={textSecondaryClass}
              isLight={isLight}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Role badge component for post authors
const RoleBadge = ({ role }) => {
  const roleInfo = getExpandedRoleInfo(role);
  return (
    <span className={`text-sm ${roleInfo.color}`} title={roleInfo.label}>
      {roleInfo.icon}
    </span>
  );
};

// Reaction icon component - Shows user's reaction or default Shaka
const ReactionIcon = ({ post, userId, isLiked, isPressing }) => {
  const userReaction = post.reactions?.find(r => r.user_id === userId);
  const hasNonShakaReaction = userReaction && userReaction.emoji !== '🤙';
  
  // Determine if Shaka should be colored (checked) or grayscale (unchecked)
  // Also show colored when pressing (holding down) for visual feedback
  const shakaIsChecked = (isLiked && !hasNonShakaReaction) || isPressing;
  
  const springTransition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  
  // Prevent browser context menu on long-press
  const preventContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };
  
  return (
    <div 
      className="relative w-7 h-7 flex items-center justify-center overflow-visible"
      style={{ transition: springTransition }}
      onContextMenu={preventContextMenu}
    >
      {hasNonShakaReaction ? (
        <span 
          key={userReaction.emoji}
          className="text-2xl animate-in zoom-in-75 duration-300 select-none"
          style={{ 
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
            transform: 'scale(1.1)',
            transition: springTransition,
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
            pointerEvents: 'none'
          }}
          onContextMenu={preventContextMenu}
        >
          {userReaction.emoji}
        </span>
      ) : (
        <img 
          key={shakaIsChecked ? "shaka-checked" : "shaka-unchecked"}
          src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f919.svg"
          alt="shaka"
          className="animate-in zoom-in-75 duration-300 select-none"
          style={{ 
            width: '28px', 
            height: '28px',
            filter: shakaIsChecked ? 'none' : 'grayscale(100%) brightness(0.8)',
            opacity: shakaIsChecked ? 1 : 0.7,
            transform: isPressing ? 'scale(1.15)' : 'scale(1)',
            transition: springTransition,
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
            pointerEvents: 'none'
          }}
          draggable={false}
          onContextMenu={preventContextMenu}
          onDragStart={(e) => e.preventDefault()}
        />
      )}
    </div>
  );
};

// Shaka icon using Twemoji image for consistent rendering
const _ShakaIcon = ({ filled }) => (
  <img 
    src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f919.svg"
    alt="shaka"
    style={{ 
      width: '28px', 
      height: '28px',
      filter: filled ? 'none' : 'grayscale(100%) brightness(0.8)',
      opacity: filled ? 1 : 0.7,
      transition: 'filter 0.2s ease, opacity 0.2s ease'
    }}
    draggable="false"
  />
);



const PostCard = ({
  post,
  user,
  isLight,
  textPrimaryClass,
  textSecondaryClass,
  borderClass,
  postCardBgClass,
  liveUsers,
  connectingToStream,
  followingUsers,
  commentInputs,
  showAllComments,
  allComments,
  loadingComments,
  isPressing,  // Track if shaka is being pressed for visual feedback
  onNavigateProfile,
  onPostMenuOpen,
  onSharePost,
  onSavePost,
  onLikeStart,
  onLikeEnd,
  onLikeLeave,
  onCommentChange,
  onCommentSubmit,
  onLoadAllComments,
  onHideAllComments,
  onJoinLive,
  onIWasThere,
  onViewCollaborators,
  onFollowFromFeed,
  onImageClick  // Opens Instagram-style modal
}) => {
  const navigate = useNavigate();
  
  // Who Reacted Modal state
  const [showWhoReacted, setShowWhoReacted] = useState(false);
  const [detailedReactions, setDetailedReactions] = useState([]);
  const [loadingReactions, setLoadingReactions] = useState(false);

  // Video Autoplay Setup
  const videoRef = useRef(null);
  const programmaticTarget = useRef(false);
  const [userManuallyPaused, setUserManuallyPaused] = useState(false);
  // Track if video source failed to load (dead ephemeral URL or network error)
  const [videoError, setVideoError] = useState(false);
  // Mute state for in-feed video (defaults muted for autoplay)
  const [isMuted, setIsMuted] = useState(true);
  // Track if video is currently playing (for play/pause overlay)
  const [isPlaying, setIsPlaying] = useState(false);

  // Double-tap to like state
  const [showDoubleTapHeart, setShowDoubleTapHeart] = useState(false);
  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef(null);

  const handleMediaTap = useCallback((e) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // Double tap detected — cancel pending single tap, trigger like
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      e.stopPropagation();
      e.preventDefault();
      if (user?.id && post?.id && onLikeStart) {
        onLikeStart(post, e);
        setTimeout(() => onLikeEnd && onLikeEnd(post, e), 50);
      }
      setShowDoubleTapHeart(true);
      setTimeout(() => setShowDoubleTapHeart(false), 800);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
      // Delay single tap to allow double tap detection
      singleTapTimerRef.current = setTimeout(() => {
        onImageClick && onImageClick(post);
        singleTapTimerRef.current = null;
      }, 300);
    }
  }, [user?.id, post?.id, onLikeStart, onLikeEnd, onImageClick, post]);

  // Helper to ensure media paths map to backend directly natively preventing Netlify 404 traps
  const _checkMediaUrl = getFullUrl(post?.media_url || post?.image_url);
  const isVideoItem = post?.media_type === 'video' || (typeof _checkMediaUrl === 'string' && _checkMediaUrl.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i));

  // Local /api/uploads/ paths are served by the backend and are valid during normal operation.
  // Always render the full video player and let the onError handler deal with broken URLs.
  const isDeadLocalVideo = false;

  useEffect(() => {
    if (!isVideoItem || !videoRef.current) return;

    const currentVideo = videoRef.current;
    currentVideo.muted = true; // Secure modern browsers autoplay policy

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Autoplay only if user hasn't explicitly disabled playback on this specific video
            if (!userManuallyPaused) {
              programmaticTarget.current = true;
              currentVideo.play().catch(() => {}).finally(() => {
                programmaticTarget.current = false;
              });
            }
          } else {
            // Safely stall video sequentially on viewport exit
            if (!currentVideo.paused) {
              programmaticTarget.current = true;
              currentVideo.pause();
              programmaticTarget.current = false;
            }
          }
        });
      },
      { threshold: 0.6 } // Fire intersection only when heavily visible to avoid buffer overlaps
    );

    observer.observe(currentVideo);
    return () => observer.disconnect();
  }, [isVideoItem, userManuallyPaused]);

  if (!post) return null;
  
  // Fetch detailed reactions when modal opens
  const handleLikesCountClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowWhoReacted(true);
    
    // Fetch detailed data
    setLoadingReactions(true);
    try {
      const response = await apiClient.get(`/posts/${post.id}/reactions-detail`);
      // Combine likers and reactors for full list
      const allReactors = [
        ...(response.data.all_reactors || []).map(r => ({
          user_id: r.user_id,
          user_name: r.full_name,
          avatar_url: r.avatar_url,
          user_role: r.role,
          emoji: r.emoji
        })),
        ...(response.data.likers || []).map(l => ({
          user_id: l.user_id,
          user_name: l.full_name,
          avatar_url: l.avatar_url,
          user_role: l.role,
          emoji: '❤️'
        }))
      ];
      setDetailedReactions(allReactors);
    } catch (err) {
      // Fallback to inline data
      setDetailedReactions(post.reactions || []);
    } finally {
      setLoadingReactions(false);
    }
  };

  // Video URL resolution — extracted here to keep JSX clean (no IIFE needed)
  const videoSrc = isVideoItem ? getFullUrl(post.media_url) : null;
  const videoPoster = isVideoItem ? getFullUrl(post.thumbnail_url) : null;
  const videoMimeType = (() => {
    if (!post.media_url) return 'video/mp4';
    const ext = post.media_url.split('?')[0].split('.').pop().toLowerCase();
    return { mp4: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg' }[ext] || 'video/mp4';
  })();

  // Determine thumbnail fallback URL (show image instead of broken video player)
  const videoFallbackSrc = getFullUrl(post.thumbnail_url || post.media_url);

  return (
    <>
    <article 
      className={`${postCardBgClass} transition-colors duration-300 ${
        post.is_check_in ? 'border-l-4 border-l-cyan-500' : ''
      }`} 
      data-testid={`post-card-${post.id}`}
    >
      {/* Check-In Banner */}
      {post.is_check_in && (
        <div className="bg-gradient-to-r from-cyan-500/20 via-blue-500/10 to-transparent px-4 py-2 flex items-center gap-2">
          <div className="w-6 h-6 bg-cyan-500 rounded-full flex items-center justify-center">
            <MapPin className="w-3 h-3 text-white" />
          </div>
          <span className="text-cyan-400 font-medium text-sm">Jumped In</span>
          {post.check_in_spot_name && (
            <span className="text-zinc-400 text-sm">at {post.check_in_spot_name}</span>
          )}
          {post.check_in_conditions && (
            <span className="text-zinc-500 text-xs ml-auto">{post.check_in_conditions}</span>
          )}
        </div>
      )}
      
      {/* Post Header */}
      <div className="flex items-center justify-between p-4">
        <div 
          className="flex items-center gap-3 cursor-pointer"
          onClick={() => onNavigateProfile(post.author_id)}
          data-testid={`post-author-${post.id}`}
        >
          {/* Avatar with LIVE ring indicator */}
          <div className="relative">
            <div className={`${liveUsers.includes(post.author_id) ? 'p-[2px] rounded-full bg-gradient-to-r from-red-500 via-red-600 to-red-500 animate-pulse' : ''}`}>
              <div className={`w-10 h-10 rounded-full ${isLight ? 'bg-gray-200' : 'bg-zinc-700'} ${liveUsers.includes(post.author_id) ? 'border-2 border-black' : ''} flex items-center justify-center overflow-hidden`}>
                {post.author_avatar ? (
                  <img 
                    src={getFullUrl(post.author_avatar)} 
                    alt={post.author_name} 
                    className="w-full h-full object-cover"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <span className={textSecondaryClass + " font-medium"}>
                    {post.author_name?.charAt(0) || '?'}
                  </span>
                )}
              </div>
            </div>
            {/* LIVE badge */}
            {liveUsers.includes(post.author_id) && (
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[7px] font-bold px-1.5 py-0.5 rounded uppercase">
                LIVE
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              {/* Instagram-style: username primary, real name secondary */}
              {post.author_username ? (
                <span className={`font-semibold ${textPrimaryClass} hover:underline`}>@{post.author_username}</span>
              ) : (
                <span className={`font-medium ${textPrimaryClass} hover:underline`}>{post.author_name || 'Anonymous'}</span>
              )}
              {post.author_role && <RoleBadge role={post.author_role} />}
              {/* Join Live button with connecting pulse */}
              {liveUsers.includes(post.author_id) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onJoinLive(post.author_id, post.author_name, post.author_avatar);
                  }}
                  disabled={connectingToStream === post.author_id}
                  className={`ml-2 flex items-center gap-1 px-2 py-0.5 text-white text-xs font-bold rounded-full transition-all ${
                    connectingToStream === post.author_id 
                      ? 'bg-red-400 scale-105 animate-[pulse_0.5s_ease-in-out_infinite]' 
                      : 'bg-red-500 hover:bg-red-600 animate-pulse'
                  }`}
                  data-testid={`join-live-${post.id}`}
                >
                  <Radio className={`w-3 h-3 ${connectingToStream === post.author_id ? 'animate-spin' : ''}`} />
                  {connectingToStream === post.author_id ? 'Joining...' : 'Join'}
                </button>
              )}
            </div>
          {/* Timestamp + location row */}
          <p className={`text-xs ${textSecondaryClass} flex items-center gap-1`}>
            {post.created_at && (
              <span>{formatTimeAgo(post.created_at)}</span>
            )}
            {post.location && post.created_at && (
              <span className="opacity-50">·</span>
            )}
            {post.location && (
              <span>{post.location}</span>
            )}
          </p>
        </div>
        </div>
        <button 
          onClick={() => onPostMenuOpen(post)}
          className={`${textSecondaryClass} hover:${textPrimaryClass} p-2`}
          data-testid={`post-menu-btn-${post.id}`}
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>

      {/* Shop This Photographer's Work CTA - for verified photographers */}
      {['Photographer', 'Approved Pro'].includes(post.author_role) && post.author_id !== user?.id && (
        <div className="px-4 py-2 border-b border-border/50">
          <button
            onClick={() => navigate(`/photographer/${post.author_id}/gallery`)}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-gradient-to-r from-amber-500/10 to-yellow-500/10 hover:from-amber-500/20 hover:to-yellow-500/20 border border-amber-500/30 transition-all group"
            data-testid={`shop-photographer-${post.id}`}
          >
            <ShoppingBag className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform" />
            <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
              Shop {post.author_username ? `@${post.author_username}` : post.author_name}'s Gallery
            </span>
            <ChevronRight className="w-4 h-4 text-amber-500/70" />
          </button>
        </div>
      )}

      {/* Post Image/Video - click to open modal, double-tap to like */}
      <div 
        className={`aspect-[4/5] ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} relative select-none cursor-pointer`}
        onClick={handleMediaTap}
        data-testid={`post-image-container-${post.id}`}
      >
        {/* Double-tap shaka animation */}
        {showDoubleTapHeart && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <img 
              src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f919.svg"
              alt="shaka"
              className="w-24 h-24 animate-ping"
              style={{ animationDuration: '0.6s', filter: 'drop-shadow(0 4px 12px rgba(234, 179, 8, 0.5))' }}
              draggable={false}
            />
          </div>
        )}
        {isVideoItem ? (
          // If video source errored (404 / network failure), show fallback
          (isDeadLocalVideo || videoError) ? (
            <div className="relative w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
              <Play className="w-12 h-12 text-zinc-500 mb-2" />
              <span className="text-zinc-400 text-sm font-medium">Video Unavailable</span>
              <span className="text-zinc-500 text-xs mt-1">This video is no longer accessible</span>
              {/* Retry button — clears error to re-attempt load */}
              {videoError && !isDeadLocalVideo && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setVideoError(false);
                    // Force a fresh network fetch by appending cache-bust param
                    if (videoRef.current) {
                      const src = videoRef.current.querySelector('source');
                      if (src) {
                        const url = new URL(src.src, window.location.origin);
                        url.searchParams.set('_retry', Date.now());
                        src.src = url.toString();
                      }
                      videoRef.current.load();
                    }
                  }}
                  className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm font-medium transition-colors"
                  data-testid={`video-retry-${post.id}`}
                >
                  <RefreshCw className="w-4 h-4" />
                  Tap to retry
                </button>
              )}
              {/* Video duration badge */}
              <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-xs text-white flex items-center gap-1">
                <Play className="w-3 h-3" />
                {post.video_duration ? `${Math.round(post.video_duration)}s` : 'Video'}
              </div>
            </div>
          ) : (
          /* TikTok/Instagram pattern: video plays as muted preview in feed.
             NO native controls — tapping opens PostModal for social interaction.
             Mute toggle is a separate button that stops propagation. */
          <>
          <video
            ref={videoRef}
            poster={videoPoster}
            className="w-full h-full object-cover"
            playsInline
            webkit-playsinline="true"
            preload="auto"
            muted={isMuted}
            autoPlay
            loop
            onPlay={() => {
              setIsPlaying(true);
              if (!programmaticTarget.current) setUserManuallyPaused(false);
            }}
            onPause={() => {
              setIsPlaying(false);
              if (!programmaticTarget.current) setUserManuallyPaused(true);
            }}
            onError={() => setVideoError(true)}
          >
            <source src={videoSrc} type={videoMimeType} onError={() => setVideoError(true)} />
            {videoMimeType !== 'video/mp4' && <source src={videoSrc} type="video/mp4" onError={() => setVideoError(true)} />}
          </video>
          {/* Transparent click overlay — ensures tap opens PostModal, not native player */}
          <div className="absolute inset-0 z-[1]" />
          {/* Centered play icon — shows when paused (tap to open modal, not to play) */}
          {!isPlaying && (
            <div className="absolute inset-0 z-[2] flex items-center justify-center pointer-events-none">
              <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
                <Play className="w-8 h-8 text-white ml-1" fill="white" />
              </div>
            </div>
          )}
          {/* Mute toggle — bottom-right, TikTok style (stops propagation so it doesn't open modal) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              const newMuted = !isMuted;
              setIsMuted(newMuted);
              if (videoRef.current) videoRef.current.muted = newMuted;
            }}
            className="absolute bottom-3 right-3 z-[3] w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/80 transition-colors"
            data-testid={`video-mute-${post.id}`}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          </>
          )
        ) : (
          <img
            src={getFullUrl(post.media_url || post.image_url)}
            alt={post.caption || 'Surf photo'}
            className="w-full h-full object-cover"
            loading="lazy"
            draggable="false"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        )}
        {isVideoItem && !(isDeadLocalVideo || videoError) && (
          <div className="absolute top-2 right-2 z-[2] bg-black/60 px-2 py-1 rounded text-xs text-white flex items-center gap-1 pointer-events-none">
            <Play className="w-3 h-3" />
            {post.video_duration ? `${Math.round(post.video_duration)}s` : 'Video'}
          </div>
        )}
      </div>

      {/* Session Log Header - "Strava for Surfing" metadata */}
      {(post.session_date || post.session_start_time || post.location || post.spot || 
        post.wave_height_ft || post.collaborators?.length > 0) && (
        <div className="px-4 pt-2">
          <SessionLogHeader
            post={post}
            collaborators={post.collaborators || []}
            currentUserId={user?.id}
            isOwnPost={post.author_id === user?.id}
            onIWasThere={() => onIWasThere(post.id)}
            onViewCollaborators={() => onViewCollaborators(post.id)}
            showBookCTA={['Photographer', 'Approved Pro'].includes(post.author_role) && post.author_id !== user?.id}
            isFollowingPhotographer={followingUsers.has(post.author_id)}
            photographerId={post.author_id}
            photographerName={post.author_name}
            onFollowPhotographer={onFollowFromFeed}
            onBookPhotographer={(photographerId) => navigate(`/profile/${photographerId}`)}
          />
        </div>
      )}

      {/* Post Actions */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4 relative">
            {/* Shaka Button with count next to it - Instagram style */}
            <div className="flex items-center gap-1.5">
              <button
                onTouchStart={(e) => {
                  e.preventDefault();
                  onLikeStart(post.id, e);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  onLikeEnd(post.id, e);
                }}
                onTouchCancel={(e) => {
                  e.preventDefault();
                  onLikeLeave();
                }}
                onMouseDown={(e) => onLikeStart(post.id, e)}
                onMouseUp={(e) => onLikeEnd(post.id, e)}
                onMouseLeave={onLikeLeave}
                onClick={(e) => {
                  // Prevent default click - we handle everything via touch/mouse events
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onContextMenu={(e) => {
                  // Prevent browser context menu on long-press
                  e.preventDefault();
                  e.stopPropagation();
                  return false;
                }}
                className={`transition-all duration-300 select-none transform touch-manipulation ${
                  post.liked || post.reactions?.some(r => r.user_id === user?.id) || isPressing
                    ? 'scale-110' 
                    : 'hover:scale-105'
                }`}
                style={{
                  transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                  WebkitTouchCallout: 'none',
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTapHighlightColor: 'transparent'
                }}
                data-testid={`like-btn-${post.id}`}
                title="Tap to like, hold for reactions"
              >
                <ReactionIcon post={post} userId={user?.id} isLiked={post.liked} isPressing={isPressing} />
              </button>
              {/* Count next to shaka - Click to see who reacted */}
              {!post.hide_like_count && post.likes_count > 0 && (
                <button
                  onClick={handleLikesCountClick}
                  className={`font-semibold ${textPrimaryClass} text-sm hover:opacity-70 transition-opacity select-none cursor-pointer`}
                  data-testid={`likes-count-${post.id}`}
                  title="Click to see who reacted"
                >
                  {post.likes_count.toLocaleString()}
                </button>
              )}
            </div>
            {/* Comment button - hidden if comments are disabled */}
            {!post.comments_disabled && (
              <button 
                className={`${textPrimaryClass} hover:${textSecondaryClass} transition-colors`}
                onClick={() => {
                  const input = document.querySelector(`[data-testid="comment-input-${post.id}"]`);
                  if (input) input.focus();
                }}
                data-testid={`comment-btn-${post.id}`}
              >
                <MessageCircle className="w-6 h-6" />
              </button>
            )}
            <button 
              className={`${textPrimaryClass} hover:${textSecondaryClass} transition-colors`}
              onClick={() => onSharePost(post)}
              data-testid={`share-btn-${post.id}`}
            >
              <Send className="w-6 h-6" />
            </button>
          </div>
          <button 
            onClick={(e) => {
              e.preventDefault();
              onSavePost(post.id, post.saved);
            }}
            className={`transition-colors touch-manipulation ${post.saved ? 'text-yellow-400' : `${textPrimaryClass} hover:${textSecondaryClass}`}`}
            style={{ WebkitTapHighlightColor: 'transparent' }}
            data-testid={`save-btn-${post.id}`}
          >
            <Bookmark className="w-6 h-6" fill={post.saved ? 'currentColor' : 'none'} />
          </button>
        </div>

        {/* Caption */}
        <p className={textPrimaryClass}>
          <span 
            className="font-medium cursor-pointer hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/profile/${post.author_id}`);
            }}
          >
            {post.author_name}
          </span>{' '}
          <RichText 
            text={post.caption}
            className={textSecondaryClass}
            maxLength={150}
            showExpand={true}
          />
        </p>

        {/* Session Join Card - Show if post is a shared session with open spots */}
        {post.is_session_log && post.session_invite_open && post.session_spots_left > 0 && (
          <SessionJoinCard
            post={post}
            user={user}
            isLight={isLight}
          />
        )}

        {/* Comments Section */}
        <div className="mt-3 space-y-2">
          {/* View all comments link */}
          {(post.comments_count > 0) && !showAllComments[post.id] && (
            <button 
              onClick={() => onLoadAllComments(post.id)}
              className={`${textSecondaryClass} text-sm hover:opacity-80`}
              data-testid={`view-comments-${post.id}`}
            >
              {loadingComments[post.id] ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                </span>
              ) : (
                `View all ${post.comments_count} comment${post.comments_count !== 1 ? 's' : ''}`
              )}
            </button>
          )}

          {/* Show all comments when expanded */}
          {showAllComments[post.id] && allComments[post.id] && (
            <div className="space-y-3">
              <button 
                onClick={() => onHideAllComments(post.id)}
                className={`${textSecondaryClass} text-sm hover:opacity-80`}
              >
                Hide comments
              </button>
              {allComments[post.id].map((comment) => (
                <CommentWithReaction
                  key={comment.id}
                  comment={comment}
                  userId={user?.id}
                  postId={post.id}
                  textPrimaryClass={textPrimaryClass}
                  textSecondaryClass={textSecondaryClass}
                  isLight={isLight}
                />
              ))}
            </div>
          )}

          {/* Show recent comments inline (when not expanded) - click to expand */}
          {!showAllComments[post.id] && post.recent_comments && post.recent_comments.length > 0 && (
            <div className="space-y-1">
              {post.recent_comments.map((comment) => (
                <div 
                  key={comment.id} 
                  className="flex gap-2 cursor-pointer hover:opacity-80"
                  onClick={() => onLoadAllComments(post.id)}
                  title="Click to view all comments and reply"
                >
                  <span className={`font-medium ${textPrimaryClass} text-sm cursor-pointer hover:underline`}
                    onClick={(e) => { e.stopPropagation(); navigate(`/profile/${comment.author_id}`); }}>
                    {comment.author_name}
                  </span>
                  <span className={`${textSecondaryClass} text-sm flex-1 truncate`}>{comment.content}</span>
                </div>
              ))}
              <button 
                onClick={() => onLoadAllComments(post.id)}
                className={`${textSecondaryClass} text-xs hover:opacity-80 mt-1`}
              >
                Click to reply...
              </button>
            </div>
          )}
        </div>

        {/* Comment Input with Emoji Picker - hidden if comments are disabled */}
        {!post.comments_disabled && (
          <div className="mt-3">
            <CommentInputWithEmoji
              value={commentInputs[post.id] || ''}
              onChange={(val) => onCommentChange(post.id, val)}
              onSubmit={() => onCommentSubmit(post.id)}
              placeholder="Add a comment..."
              postId={post.id}
              textClass={textSecondaryClass}
              borderClass={borderClass}
            />
          </div>
        )}
        
        {/* Comments disabled message */}
        {post.comments_disabled && (
          <p className={`text-xs ${textSecondaryClass} mt-3 italic`}>
            Comments are turned off for this post.
          </p>
        )}
      </div>
    </article>
    
    {/* Who Reacted Modal */}
    <WhoReactedModal
      isOpen={showWhoReacted}
      onClose={() => setShowWhoReacted(false)}
      reactions={detailedReactions.length > 0 ? detailedReactions : (post.reactions || [])}
      postAuthorName={post.author_name}
      loading={loadingReactions}
    />
    </>
  );
};

export default PostCard;
