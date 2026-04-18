/**
 * PostModal - Instagram-style post popup with image on left, details on right
 * Opens when clicking on a post in the feed
 */
import React, { useState, useEffect, useRef } from 'react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { X, ChevronLeft, ChevronRight, Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Loader2, Calendar, Waves } from 'lucide-react';
import { toast } from 'sonner';
import { RichText, CommentText } from './RichText';
import { SharePostModal } from './PostMenu';
import PostMenu from './PostMenu';
import logger from '../utils/logger';


// Reaction emojis (Shaka plus others)
const POST_REACTIONS = ['🤙', '❤️', '🔥', '🌊', '👏'];

// Shaka Icon Component
const ShakaIcon = ({ filled, size = 28 }) => (
  <img 
    src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f919.svg"
    alt="shaka"
    style={{ 
      width: `${size}px`, 
      height: `${size}px`,
      filter: filled ? 'none' : 'grayscale(100%) brightness(1.5)',
      transition: 'filter 0.2s ease, transform 0.2s ease'
    }}
    draggable="false"
  />
);

// Format time ago helper
const formatTimeAgo = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

// Image Carousel Component
const ImageCarousel = ({ images, mediaType }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // Handle single image/video
  const mediaItems = Array.isArray(images) ? images : [images];
  
  const goNext = () => {
    setCurrentIndex((prev) => (prev + 1) % mediaItems.length);
  };
  
  const goPrev = () => {
    setCurrentIndex((prev) => (prev - 1 + mediaItems.length) % mediaItems.length);
  };
  
  if (mediaItems.length === 0) return null;
  
  const currentItem = mediaItems[currentIndex];
  const isVideo = mediaType === 'video' || (typeof currentItem === 'object' && currentItem?.type === 'video');
  const mediaUrl = typeof currentItem === 'string' ? currentItem : currentItem?.url;
  
  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center">
      {isVideo ? (
        <video
          src={mediaUrl}
          controls
          className="max-w-full max-h-full object-contain"
          playsInline
        />
      ) : (
        <img
          src={mediaUrl}
          alt="Post media"
          className="max-w-full max-h-full object-contain"
          draggable="false"
        />
      )}
      
      {/* Navigation arrows */}
      {mediaItems.length > 1 && (
        <>
          <button
            onClick={goPrev}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-800" />
          </button>
          <button
            onClick={goNext}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-gray-800" />
          </button>
          
          {/* Dots indicator */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
            {mediaItems.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  idx === currentIndex ? 'bg-blue-500' : 'bg-white/50'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// Comment Item
const CommentItem = ({ comment, userId, _onReact }) => {
  const [liked, setLiked] = useState(comment.viewer_reaction !== null);
  const [likeCount, setLikeCount] = useState(comment.reaction_count || 0);
  
  const handleLike = async () => {
    if (!userId) {
      toast.error('Please log in to like');
      return;
    }
    
    try {
      const response = await axios.post(
        `${API}/comments/${comment.id}/reactions?user_id=${userId}`,
        { emoji: '❤️' }
      );
      
      if (response.data.action === 'added') {
        setLiked(true);
        setLikeCount(prev => prev + 1);
      } else if (response.data.action === 'removed') {
        setLiked(false);
        setLikeCount(prev => Math.max(0, prev - 1));
      }
    } catch (err) {
      toast.error('Failed to like');
    }
  };
  
  return (
    <div className="flex gap-3 py-2">
      <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0">
        {comment.author_avatar ? (
          <img src={comment.author_avatar} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs text-gray-400">{comment.author_name?.charAt(0)}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-semibold text-white mr-1">{comment.author_name}</span>
          <CommentText 
            text={comment.content}
            className="text-gray-300"
          />
        </p>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span>{formatTimeAgo(comment.created_at)}</span>
          {likeCount > 0 && <span>{likeCount} like{likeCount !== 1 ? 's' : ''}</span>}
          <button className="hover:text-gray-300">Reply</button>
        </div>
      </div>
      <button
        onClick={handleLike}
        className={`flex-shrink-0 p-1 ${liked ? 'text-red-500' : 'text-gray-500 hover:text-gray-300'}`}
      >
        <Heart className="w-3.5 h-3.5" fill={liked ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
};

const PostModal = ({ post, isOpen, onClose, _onPostUpdated }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const _isLight = theme === 'light';
  
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [liked, setLiked] = useState(post?.liked || false);
  const [likeCount, setLikeCount] = useState(post?.likes_count || 0);
  const [saved, setSaved] = useState(post?.saved || post?.is_saved_by_user || false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  
  // Shaka reaction state
  const [userReaction, setUserReaction] = useState(null);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const pressTimerRef = useRef(null);
  const isPressingRef = useRef(false); // Ref for synchronous checking
  const pickerShownRef = useRef(false); // Track if picker was shown during this press
  
  const modalRef = useRef(null);
  
  // Check for mobile viewport
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Load comments when modal opens
  useEffect(() => {
    if (isOpen && post?.id) {
      loadComments();
      setLiked(post.liked || false);
      setLikeCount(post.likes_count || 0);
      setSaved(post.saved || post.is_saved_by_user || false);
      setCaptionExpanded(false);
      // Set initial reaction state from post data
      const existingReaction = post.reactions?.find(r => r.user_id === user?.id);
      setUserReaction(existingReaction || null);
    }
  }, [isOpen, post?.id]);
  
  // Handle browser back button - close modal instead of navigating away
  useEffect(() => {
    if (isOpen) {
      // Push a state to history when modal opens
      window.history.pushState({ modal: 'post' }, '');
      
      const handlePopState = (_e) => {
        // When back is pressed, close the modal
        onClose();
      };
      
      window.addEventListener('popstate', handlePopState);
      
      return () => {
        window.removeEventListener('popstate', handlePopState);
      };
    }
  }, [isOpen, onClose]);
  
  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        // Go back in history to remove the modal state we pushed
        if (window.history.state?.modal === 'post') {
          window.history.back();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);
  
  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);
  
  const loadComments = async () => {
    setLoadingComments(true);
    try {
      const response = await apiClient.get(`/posts/${post.id}/comments`, {
        params: { viewer_id: user?.id }
      });
      setComments(response.data || []);
    } catch (err) {
      logger.error('Failed to load comments:', err);
    } finally {
      setLoadingComments(false);
    }
  };
  
  const handleLike = async () => {
    if (!user?.id) {
      toast.error('Please log in to like');
      return;
    }
    
    try {
      if (liked) {
        await apiClient.delete(`/posts/${post.id}/like`, { params: { user_id: user.id } });
        setLiked(false);
        setLikeCount(prev => Math.max(0, prev - 1));
      } else {
        await apiClient.post(`/posts/${post.id}/like`, null, { params: { user_id: user.id } });
        setLiked(true);
        setLikeCount(prev => prev + 1);
      }
    } catch (err) {
      toast.error('Failed to update like');
    }
  };
  
  const handleSave = async () => {
    if (!user?.id) {
      toast.error('Please log in to save');
      return;
    }
    
    try {
      if (saved) {
        await apiClient.delete(`/posts/${post.id}/save?user_id=${user.id}`);
        setSaved(false);
        toast.success('Removed from saved');
      } else {
        await apiClient.post(`/posts/${post.id}/save?user_id=${user.id}`);
        setSaved(true);
        toast.success('Saved!');
      }
    } catch (err) {
      console.error('Save error:', err);
      toast.error(err.response?.data?.detail || 'Failed to save');
    }
  };
  
  // ============ SHAKA REACTION HANDLERS (copied from Feed.js pattern) ============
  const handleReactionStart = () => {
    // Clear any existing timer first
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    
    isPressingRef.current = true;
    pickerShownRef.current = false;
    setIsPressing(true);
    
    // Set timer for long-press (600ms for reliable mobile detection)
    pressTimerRef.current = setTimeout(() => {
      pickerShownRef.current = true;
      // Trigger haptic feedback
      if ('vibrate' in navigator) {
        navigator.vibrate(10);
      }
      setShowReactionPicker(true);
      setIsPressing(false);
    }, 600);
  };
  
  const handleReactionEnd = async () => {
    const wasPressing = isPressingRef.current;
    const pickerWasShown = pickerShownRef.current;
    
    // Clear pressing state
    setIsPressing(false);
    isPressingRef.current = false;
    
    // Always clear the timer
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    
    // If long-press triggered the picker, don't do quick tap
    if (pickerWasShown) {
      pickerShownRef.current = false;
      return;
    }
    
    // If picker is showing, don't do anything
    if (showReactionPicker) {
      return;
    }
    
    // Quick tap = toggle shaka
    if (wasPressing) {
      await handleReaction('🤙');
    }
  };
  
  const handleReactionCancel = () => {
    setIsPressing(false);
    isPressingRef.current = false;
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };
  
  const handleReaction = async (emoji) => {
    if (!user?.id) {
      toast.error('Please log in to react');
      return;
    }
    
    setShowReactionPicker(false);
    
    try {
      const isRemovingReaction = userReaction?.emoji === emoji;
      
      const response = await axios.post(
        `${API}/posts/${post.id}/reactions?user_id=${user.id}`,
        { emoji }
      );
      
      if (response.data.action === 'removed' || isRemovingReaction) {
        setUserReaction(null);
        setLiked(false);
        setLikeCount(prev => Math.max(0, prev - 1));
      } else {
        setUserReaction({ emoji, user_id: user.id });
        if (!liked && !userReaction) {
          setLikeCount(prev => prev + 1);
        }
        setLiked(true);
      }
    } catch (err) {
      toast.error('Failed to add reaction');
    }
  };
  
  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    };
  }, []);
  
  const handleSubmitComment = async () => {
    if (!commentInput.trim() || !user?.id) return;
    
    setSubmittingComment(true);
    try {
      await apiClient.post(`/posts/${post.id}/comments?user_id=${user.id}`, {
        content: commentInput.trim()
      });
      setCommentInput('');
      loadComments();
      toast.success('Comment added');
    } catch (err) {
      toast.error('Failed to add comment');
    } finally {
      setSubmittingComment(false);
    }
  };
  
  // Alias for mobile view
  const handleComment = handleSubmitComment;
  
  // Like/unlike a comment
  const handleLikeComment = async (commentId) => {
    if (!user?.id) {
      toast.error('Please log in to like comments');
      return;
    }
    
    try {
      const _response = await axios.post(
        `${API}/comments/${commentId}/reactions?user_id=${user.id}`,
        { emoji: '❤️' }
      );
      
      // Update comments state with new like
      setComments(prev => prev.map(c => {
        if (c.id === commentId) {
          const wasLiked = c.reactions?.some(r => r.user_id === user.id);
          return {
            ...c,
            likes_count: wasLiked ? (c.likes_count || 1) - 1 : (c.likes_count || 0) + 1,
            reactions: wasLiked 
              ? (c.reactions || []).filter(r => r.user_id !== user.id)
              : [...(c.reactions || []), { user_id: user.id, emoji: '❤️' }]
          };
        }
        return c;
      }));
    } catch (err) {
      toast.error('Failed to like comment');
    }
  };
  
  if (!isOpen || !post) return null;
  
  // Get media items (support for carousel)
  const mediaItems = post.media_urls || [post.media_url || post.image_url];
  
  // Truncated caption for mobile overlay
  const truncatedCaption = post.caption?.length > 100 
    ? post.caption.slice(0, 100) + '...' 
    : post.caption;
  
  // ============ MOBILE VIEW (Instagram-style fullscreen) ============
  if (isMobile) {
    return (
      <div 
        className="fixed inset-0 z-[9999] bg-black"
        data-testid="post-modal-mobile"
      >
        {/* Tap-to-close backdrop - ONLY in the image area, not top bar or bottom */}
        <div 
          className="absolute inset-0 top-[60px] bottom-[200px]"
          onClick={onClose}
          onTouchEnd={(e) => {
            // Only close if tapping the backdrop itself
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
          style={{ zIndex: 1 }}
        />
        
        {/* Fullscreen Image/Video - no click handler here */}
        <div 
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ zIndex: 2 }}
        >
          <div className="pointer-events-auto">
            <ImageCarousel images={mediaItems} mediaType={post.media_type} />
          </div>
        </div>
        
        {/* Top Bar - Close & Author */}
        <div 
          className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent pb-12 pt-4"
          style={{ zIndex: 10, pointerEvents: 'none' }}
        >
          <div className="flex items-center justify-between px-4 pt-2" style={{ pointerEvents: 'auto' }}>
            <button
              onClick={onClose}
              className="p-2 text-white touch-manipulation"
              data-testid="close-post-modal"
            >
              <X className="w-6 h-6" />
            </button>
            
            {/* Author Info */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-zinc-700 overflow-hidden ring-2 ring-white/20">
                {post.author_avatar ? (
                  <img src={post.author_avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-sm text-white">
                    {post.author_name?.charAt(0)}
                  </span>
                )}
              </div>
              <div>
                <p className="font-semibold text-white text-sm">{post.author_name}</p>
                {post.location && (
                  <p className="text-xs text-white/70">{post.location}</p>
                )}
              </div>
            </div>
            
            <button 
              className="p-3 text-white touch-manipulation active:bg-white/10 rounded-full"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setPostMenuOpen(true);
              }}
              style={{ WebkitTapHighlightColor: 'transparent' }}
              data-testid="post-modal-menu-button"
            >
              <MoreHorizontal className="w-6 h-6" />
            </button>
          </div>
        </div>
        
        {/* Reaction Picker Overlay - highest z-index when visible */}
        {showReactionPicker && (
          <div className="fixed inset-0 z-[200]">
            {/* Backdrop to close picker */}
            <div 
              className="absolute inset-0 bg-black/30"
              onClick={() => setShowReactionPicker(false)}
            />
            {/* Centered Picker - ensure all 5 emojis fit */}
            <div 
              className="absolute bg-zinc-900/95 backdrop-blur-sm border border-zinc-600 rounded-full px-2 py-2 flex items-center shadow-2xl animate-in zoom-in-95 duration-200"
              style={{ 
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {POST_REACTIONS.map((emoji, _index) => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                  className="w-10 h-10 flex items-center justify-center hover:scale-110 transition-all duration-150 hover:bg-zinc-700/50 rounded-full active:scale-95 touch-manipulation"
                  style={{ fontSize: '22px' }}
                  data-testid={`post-reaction-${emoji}`}
                >
                  {emoji}
                </button>
              ))}
              <button 
                onClick={() => setShowReactionPicker(false)}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white border-l border-zinc-600 ml-1 hover:bg-zinc-700/50 rounded-full touch-manipulation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        
        {/* Bottom Overlay - Caption & Actions - highest z-index for touch */}
        <div 
          className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-20 pb-6"
          style={{ zIndex: 50 }}
        >
          {/* Actions Row */}
          <div className="flex items-center justify-between px-4 mb-3">
            <div className="flex items-center gap-1">
              {/* Shaka Reaction Button - copy exact pattern from PostCard */}
              <button
                onPointerDown={(e) => {
                  e.preventDefault();
                  handleReactionStart();
                }}
                onPointerUp={(e) => {
                  e.preventDefault();
                  handleReactionEnd();
                }}
                onPointerCancel={handleReactionCancel}
                onPointerLeave={handleReactionCancel}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  return false;
                }}
                className={`transition-all duration-300 select-none transform touch-manipulation ${isPressing ? 'scale-125' : 'hover:scale-105'}`}
                style={{
                  transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                  WebkitTouchCallout: 'none',
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTapHighlightColor: 'transparent'
                }}
                data-testid="reaction-button"
              >
                {userReaction ? (
                  <span className="text-3xl select-none">{userReaction.emoji}</span>
                ) : (
                  <ShakaIcon filled={liked} size={28} />
                )}
              </button>
              
              {/* Like Count */}
              {likeCount > 0 && (
                <span className="text-white font-semibold text-sm ml-1">
                  {likeCount.toLocaleString()}
                </span>
              )}
              
              <button className="p-3 text-white ml-2">
                <MessageCircle className="w-7 h-7" />
              </button>
              <button 
                className="p-3 text-white touch-manipulation"
                onClick={() => setShareModalOpen(true)}
              >
                <Send className="w-7 h-7" />
              </button>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleSave();
              }}
              className={`p-3 active:scale-95 touch-manipulation select-none ${saved ? 'text-yellow-400' : 'text-white'}`}
              style={{ 
                WebkitTapHighlightColor: 'transparent'
              }}
              data-testid="save-button"
            >
              <Bookmark 
                className="w-7 h-7"
                fill={saved ? 'currentColor' : 'none'}
              />
            </button>
          </div>
          
          {/* Caption - Truncated, expand on tap */}
          {post.caption && (
            <div 
              className="px-4 mb-2"
              onClick={() => setCaptionExpanded(!captionExpanded)}
              style={{ pointerEvents: 'auto' }}
            >
              <p className="text-white text-sm">
                <span className="font-semibold mr-1">{post.author_name}</span>
                <RichText 
                  text={captionExpanded ? post.caption : truncatedCaption}
                  hashtagClassName="text-cyan-400 hover:text-cyan-300 cursor-pointer"
                  mentionClassName="text-blue-400 hover:text-blue-300 cursor-pointer"
                />
              </p>
              {post.caption?.length > 100 && !captionExpanded && (
                <button className="text-white/60 text-sm mt-1">more</button>
              )}
            </div>
          )}
          
          {/* Comments preview */}
          {comments.length > 0 && !showComments && (
            <button 
              className="text-white/60 text-sm px-4 mb-2" 
              style={{ pointerEvents: 'auto' }}
              onClick={() => setShowComments(true)}
            >
              View all {comments.length} comment{comments.length !== 1 ? 's' : ''}
            </button>
          )}
          
          {/* Expanded Comments Section */}
          {showComments && (
            <div className="px-4 mb-2 max-h-40 overflow-y-auto" style={{ pointerEvents: 'auto' }}>
              <button 
                className="text-white/60 text-sm mb-2"
                onClick={() => setShowComments(false)}
              >
                Hide comments
              </button>
              {comments.map((comment) => {
                const isLiked = comment.reactions?.some(r => r.user_id === user?.id);
                return (
                  <div key={comment.id} className="mb-3 flex items-start gap-2">
                    <div className="flex-1">
                      <p className="text-white text-sm">
                        <span className="font-semibold mr-1">{comment.author_name}</span>
                        <span className="text-white/90">{comment.content}</span>
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-white/40 text-xs">{formatTimeAgo(comment.created_at)}</span>
                        {(comment.likes_count > 0 || comment.reactions?.length > 0) && (
                          <span className="text-white/40 text-xs">
                            {comment.likes_count || comment.reactions?.length || 0} likes
                          </span>
                        )}
                        <button 
                          className="text-white/40 text-xs font-semibold"
                          onClick={() => {/* Reply functionality */}}
                        >
                          Reply
                        </button>
                      </div>
                    </div>
                    <button 
                      className="p-1 touch-manipulation"
                      onClick={() => handleLikeComment(comment.id)}
                    >
                      <Heart 
                        className={`w-4 h-4 ${isLiked ? 'text-red-500 fill-red-500' : 'text-white/40'}`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Comment Input */}
          <div className="px-4 pb-2 flex items-center gap-2" style={{ pointerEvents: 'auto' }}>
            <input
              type="text"
              placeholder="Add a comment..."
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && commentInput.trim()) {
                  handleComment();
                }
              }}
              className="flex-1 bg-transparent text-white text-sm placeholder-white/40 outline-none"
            />
            {commentInput.trim() && (
              <button
                onClick={handleComment}
                disabled={submittingComment}
                className="text-cyan-400 font-semibold text-sm"
              >
                {submittingComment ? '...' : 'Post'}
              </button>
            )}
          </div>
          
          {/* Timestamp */}
          <p className="text-white/40 text-xs uppercase px-4 pb-4">
            {formatTimeAgo(post.created_at)}
          </p>
        </div>
        
        {/* Share Modal */}
        <SharePostModal
          post={post}
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
        />
        
        {/* Post Menu */}
        <PostMenu
          post={post}
          open={postMenuOpen}
          onClose={() => setPostMenuOpen(false)}
          isLight={false}
          onPostUpdated={(_updatedPost) => {
            // Handle post update if needed
          }}
          onPostDeleted={() => {
            onClose();
          }}
        />
      </div>
    );
  }
  
  // ============ DESKTOP VIEW (Side-by-side layout) ============
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80" />
      
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 text-white hover:opacity-80 transition-opacity"
        data-testid="close-post-modal"
      >
        <X className="w-6 h-6" />
      </button>
      
      {/* Modal content */}
      <div 
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className="relative bg-zinc-900 rounded-lg overflow-hidden flex max-w-6xl w-[95vw] max-h-[90vh] shadow-2xl"
        style={{ minHeight: '500px' }}
      >
        {/* Left side - Image/Carousel */}
        <div className="flex-1 bg-black flex items-center justify-center min-w-0" style={{ maxWidth: '60%' }}>
          <ImageCarousel images={mediaItems} mediaType={post.media_type} />
        </div>
        
        {/* Right side - Details & Comments */}
        <div className="w-[340px] flex flex-col border-l border-zinc-800 bg-zinc-900">
          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-zinc-800">
            <div className="w-8 h-8 rounded-full bg-zinc-700 overflow-hidden">
              {post.author_avatar ? (
                <img src={post.author_avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full flex items-center justify-center text-sm text-gray-400">
                  {post.author_name?.charAt(0)}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm truncate">{post.author_name}</p>
              {post.location && (
                <p className="text-xs text-gray-400 truncate">{post.location}</p>
              )}
            </div>
            <button className="text-gray-400 hover:text-white p-1">
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
          
          {/* Session metadata if available */}
          {(post.session_date || post.wave_height_ft) && (
            <div className="px-4 py-2 border-b border-zinc-800 space-y-1">
              {post.session_date && (
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{new Date(post.session_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                </div>
              )}
              {post.wave_height_ft && (
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <Waves className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{post.wave_height_ft}ft @ {post.wave_period_sec || '?'}s</span>
                </div>
              )}
            </div>
          )}
          
          {/* Caption & Comments scroll area */}
          <div className="flex-1 overflow-y-auto">
            {/* Caption */}
            {post.caption && (
              <div className="flex gap-3 p-4">
                <div className="w-8 h-8 rounded-full bg-zinc-700 overflow-hidden flex-shrink-0">
                  {post.author_avatar ? (
                    <img src={post.author_avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-sm text-gray-400">
                      {post.author_name?.charAt(0)}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold text-white mr-1">{post.author_name}</span>
                    <RichText 
                      text={post.caption}
                      className="text-gray-300"
                      hashtagClassName="text-cyan-400 hover:text-cyan-300 cursor-pointer"
                      mentionClassName="text-blue-400 hover:text-blue-300 cursor-pointer"
                    />
                  </p>
                  <p className="text-xs text-gray-500 mt-1">{formatTimeAgo(post.created_at)}</p>
                </div>
              </div>
            )}
            
            {/* Comments */}
            <div className="px-4 pb-4">
              {loadingComments ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              ) : comments.length > 0 ? (
                <div className="space-y-1">
                  {comments.map((comment) => (
                    <CommentItem 
                      key={comment.id} 
                      comment={comment} 
                      userId={user?.id}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 text-sm py-4">
                  No comments yet. Be the first!
                </p>
              )}
            </div>
          </div>
          
          {/* Actions */}
          <div className="border-t border-zinc-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button onClick={handleLike} className="hover:opacity-70 transition-opacity">
                  <img 
                    src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f919.svg"
                    alt="shaka"
                    className="w-6 h-6"
                    style={{ filter: liked ? 'none' : 'grayscale(100%) brightness(1.5)' }}
                  />
                </button>
                <button className="text-white hover:opacity-70 transition-opacity">
                  <MessageCircle className="w-6 h-6" />
                </button>
                <button 
                  className="text-white hover:opacity-70 transition-opacity"
                  onClick={() => setShareModalOpen(true)}
                >
                  <Send className="w-6 h-6" />
                </button>
              </div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleSave();
                }}
                className={`transition-opacity touch-manipulation active:scale-95 ${saved ? 'text-yellow-400' : 'text-white'} hover:opacity-70`}
              >
                <Bookmark className="w-6 h-6" fill={saved ? 'currentColor' : 'none'} />
              </button>
            </div>
            
            {/* Like count */}
            {likeCount > 0 && (
              <p className="text-white text-sm font-semibold">
                {likeCount.toLocaleString()} like{likeCount !== 1 ? 's' : ''}
              </p>
            )}
            
            {/* Timestamp */}
            <p className="text-gray-500 text-xs uppercase">
              {formatTimeAgo(post.created_at)}
            </p>
          </div>
          
          {/* Comment input */}
          <div className="border-t border-zinc-800 p-4">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && commentInput.trim()) {
                    handleSubmitComment();
                  }
                }}
                placeholder="Add a comment..."
                className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none"
                disabled={submittingComment}
              />
              {commentInput.trim() && (
                <button
                  onClick={handleSubmitComment}
                  disabled={submittingComment}
                  className="text-blue-500 hover:text-blue-400 text-sm font-semibold"
                >
                  {submittingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Post'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Share Modal */}
      <SharePostModal
        post={post}
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
      />
    </div>
  );
};

export default PostModal;
