/**
 * PostModal - Instagram-style post popup with image on left, details on right
 * Opens when clicking on a post in the feed
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import ShakaIcon from './social/ShakaIcon';
import { ModalVideoPlayer, ImageCarousel, CommentItem } from './social/PostModalComponents';
import { useNavigate } from 'react-router-dom';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { X, ChevronLeft, ChevronRight, Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Loader2, Calendar, Waves, Play, Pause, Volume2, Volume1, VolumeX, Smile } from 'lucide-react';
import { toast } from 'sonner';
import { RichText, CommentText } from './RichText';
import { SharePostModal } from './PostMenu';
import PostMenu from './PostMenu';
import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import { formatTimeAgo, formatDuration } from '../utils/formatTime';
import { REACTION_EMOJIS } from '../constants/emojis';
import EmojiPicker from './EmojiPicker';
import useFocusTrap from '../hooks/useFocusTrap';


// Reaction emojis - imported from centralized constants/emojis.js

// Shaka Icon Component
// ShakaIcon extracted to ./social/ShakaIcon.js



// Custom Video Player for PostModal - TikTok/Instagram style
// Tap to play/pause, custom progress bar, volume slider, no native controls
// ModalVideoPlayer, ImageCarousel, CommentItem extracted to ./social/PostModalComponents.js

const PostModal = ({ post, isOpen, onClose, onPostUpdated, posts, onNavigatePost }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  
  // Theme tokens for the desktop detail panel
  // Mobile overlay stays dark regardless (media backdrop)
  const t = {
    panelBg: isLight ? 'bg-white' : isBeach ? 'bg-black' : 'bg-zinc-900',
    panelBorder: isLight ? 'border-gray-200' : isBeach ? 'border-zinc-900' : 'border-zinc-800',
    textPrimary: isLight ? 'text-gray-900' : 'text-white',
    textSecondary: isLight ? 'text-gray-500' : isBeach ? 'text-gray-300' : 'text-gray-400',
    textMuted: isLight ? 'text-gray-400' : 'text-gray-500',
    avatarFallbackBg: isLight ? 'bg-gray-200' : isBeach ? 'bg-zinc-800' : 'bg-zinc-700',
    avatarFallbackText: isLight ? 'text-gray-600' : 'text-gray-400',
    captionText: isLight ? 'text-gray-700' : 'text-gray-300',
    hoverText: isLight ? 'hover:text-gray-900' : 'hover:text-white',
    inputBg: isLight ? 'bg-transparent' : 'bg-transparent',
    inputText: isLight ? 'text-gray-900' : 'text-white',
    inputPlaceholder: isLight ? 'placeholder-gray-400' : 'placeholder-gray-500',
    reactionPickerBg: isLight ? 'bg-white/95' : isBeach ? 'bg-black/95' : 'bg-zinc-900/95',
    reactionPickerBorder: isLight ? 'border-gray-200' : 'border-zinc-600',
    reactionHover: isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-700/60',
    iconDefault: isLight ? 'text-gray-700' : 'text-white',
    iconHover: isLight ? 'hover:opacity-80' : 'hover:opacity-70',
    likeCountText: isLight ? 'text-gray-900' : 'text-white',
    commentBtnActive: isLight ? 'bg-yellow-500/15 text-yellow-600' : 'bg-yellow-500/20 text-yellow-400',
    commentBtnInactive: isLight ? 'text-gray-400 hover:text-gray-700' : 'text-gray-400 hover:text-white',
    savedColor: 'text-yellow-400',
    unsavedColor: isLight ? 'text-gray-700' : 'text-white',
  };

  // Mobile-specific tokens (fullscreen media viewer)
  const m = {
    containerBg: isLight ? 'bg-gray-50' : 'bg-black',
    topGradient: isLight
      ? 'bg-gradient-to-b from-white/80 to-transparent'
      : 'bg-gradient-to-b from-black/70 to-transparent',
    bottomGradient: isLight
      ? 'bg-gradient-to-t from-white/95 via-white/70 to-transparent'
      : 'bg-gradient-to-t from-black/90 via-black/60 to-transparent',
    textPrimary: isLight ? 'text-gray-900' : 'text-white',
    textSecondary: isLight ? 'text-gray-500' : 'text-white/70',
    textMuted: isLight ? 'text-gray-400' : 'text-white/40',
    textCaption: isLight ? 'text-gray-800' : 'text-white',
    moreBtn: isLight ? 'text-gray-400' : 'text-white/60',
    avatarRing: isLight ? 'ring-gray-300' : 'ring-white/20',
    avatarFallbackBg: isLight ? 'bg-gray-200' : 'bg-zinc-700',
    menuBtnHover: isLight ? 'active:bg-gray-200/50' : 'active:bg-white/10',
    iconColor: isLight ? 'text-gray-700' : 'text-white',
    commentText: isLight ? 'text-gray-800' : 'text-white/90',
    commentAuthor: isLight ? 'text-gray-900' : 'text-white',
    heartInactive: isLight ? 'text-gray-300' : 'text-white/40',
    inputText: isLight ? 'text-gray-900' : 'text-white',
    inputPlaceholder: isLight ? 'placeholder-gray-400' : 'placeholder-white/40',
    emojiActive: isLight ? 'bg-yellow-500/15 text-yellow-600' : 'bg-yellow-500/20 text-yellow-400',
    emojiInactive: isLight ? 'text-gray-400 hover:text-gray-700' : 'text-white/50 hover:text-white',
    savedColor: 'text-yellow-400',
    unsavedColor: isLight ? 'text-gray-700' : 'text-white',
    pickerCloseHover: isLight ? 'hover:text-gray-900 hover:bg-gray-200/50' : 'hover:text-white hover:bg-zinc-700/50',
  };
  
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
  const [showCommentEmoji, setShowCommentEmoji] = useState(false);
  
  // Shaka reaction state
  const [userReaction, setUserReaction] = useState(null);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const pressTimerRef = useRef(null);
  const isPressingRef = useRef(false); // Ref for synchronous checking
  const pickerShownRef = useRef(false); // Track if picker was shown during this press
  const inFlightRef = useRef(false); // Concurrency guard for like/reaction API calls
  
  // Double-tap to like state
  const [showDoubleTapHeart, setShowDoubleTapHeart] = useState(false);
  const lastTapRef = useRef(0);
  
  const modalRef = useRef(null);
  
  // Trap focus within the modal for keyboard accessibility
  useFocusTrap(modalRef, isOpen);
  
  // Double-tap to like handler — toggles shaka on/off (desktop click-based)
  const handleDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 400) {
      // Double tap detected - toggle shaka reaction
      if (user?.id && post?.id) {
        handleReaction('\u{1F919}');
      }
      // Show shaka animation
      setShowDoubleTapHeart(true);
      setTimeout(() => setShowDoubleTapHeart(false), 800);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }, [user?.id, post?.id]);
  
  // Touch-based double-tap for mobile PostModal (bypasses 300ms click delay)
  const handleMobileTouchEnd = useCallback((e) => {
    if (e.changedTouches?.length !== 1) return;
    const now = Date.now();
    if (now - lastTapRef.current < 400) {
      e.preventDefault();
      e.stopPropagation();
      if (user?.id && post?.id) {
        handleReaction('\u{1F919}');
      }
      setShowDoubleTapHeart(true);
      setTimeout(() => setShowDoubleTapHeart(false), 800);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }, [user?.id, post?.id]);
  
  // Keyboard navigation for swipe between posts
  useEffect(() => {
    if (!isOpen || !posts || !onNavigatePost) return;
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const idx = posts.findIndex(p => p.id === post?.id);
        if (idx < posts.length - 1) onNavigatePost(posts[idx + 1]);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = posts.findIndex(p => p.id === post?.id);
        if (idx > 0) onNavigatePost(posts[idx - 1]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, posts, post?.id, onNavigatePost]);
  
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
  // IMPORTANT: We must track whether close was triggered by popstate to avoid double-popping.
  const closedByPopstateRef = useRef(false);
  
  useEffect(() => {
    if (isOpen) {
      closedByPopstateRef.current = false;
      // Push a state to history when modal opens
      window.history.pushState({ modal: 'post' }, '');
      
      const handlePopState = () => {
        // Back button was pressed — close the modal WITHOUT calling history.back()
        closedByPopstateRef.current = true;
        onClose();
      };
      
      window.addEventListener('popstate', handlePopState);
      
      return () => {
        window.removeEventListener('popstate', handlePopState);
        // If modal was closed by X button / overlay (not by popstate),
        // we need to pop the orphaned history entry we pushed.
        if (!closedByPopstateRef.current && window.history.state?.modal === 'post') {
          window.history.back();
        }
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
    
    // Concurrency guard
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    
    // Optimistic update
    const wasLiked = liked;
    const prevCount = likeCount;
    setLiked(!wasLiked);
    setLikeCount(wasLiked ? Math.max(0, prevCount - 1) : prevCount + 1);
    
    try {
      // Always use toggle endpoint for consistency
      const response = await apiClient.post(`/posts/${post.id}/like`);
      // Sync with authoritative server state
      setLiked(response.data.is_liked);
      setLikeCount(response.data.likes_count);
      // Propagate to parent (Feed) so card state stays in sync
      onPostUpdated?.({ ...post, liked: response.data.is_liked, likes_count: response.data.likes_count });
    } catch (err) {
      // Revert optimistic update
      setLiked(wasLiked);
      setLikeCount(prevCount);
      toast.error('Failed to update like');
    } finally {
      inFlightRef.current = false;
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
      logger.error('Save error:', err);
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
      await handleReaction('\u{1F919}');
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
    
    // Concurrency guard
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    
    setShowReactionPicker(false);
    
    const isRemoving = userReaction?.emoji === emoji;
    
    // Snapshot for rollback
    const prevLiked = liked;
    const prevCount = likeCount;
    const prevReaction = userReaction;
    
    // Optimistic update
    if (isRemoving) {
      setUserReaction(null);
      setLiked(false);
      setLikeCount(Math.max(0, prevCount - 1));
    } else {
      setUserReaction({ emoji });
      setLiked(true); // Any active reaction = liked
      // Only increment if user didn't already have a reaction (swap = no count change)
      if (!prevReaction) {
        setLikeCount(prevCount + 1);
      }
    }
    
    try {
      // ALWAYS use /reactions endpoint for ALL emojis (including shaka)
      const response = await apiClient.post(`/posts/${post.id}/reactions`, { emoji });
      
      // Always sync with authoritative server count
      if (response.data?.likes_count !== undefined) {
        setLikeCount(response.data.likes_count);
      }
      
      const action = response.data?.action;
      const newLiked = action === 'removed' ? false : true;
      const newCount = response.data?.likes_count ?? likeCount;
      if (action === 'removed') {
        setUserReaction(null);
        setLiked(false);
      } else if (action === 'added' || action === 'changed') {
        setUserReaction({ emoji });
        setLiked(true);
      }
      // Propagate to parent (Feed) so card state stays in sync.
      // IMPORTANT: Don't spread ...post here — the prop is a stale snapshot
      // from when the modal opened. Only send the changed fields so the Feed
      // merges them into its live state without overwriting other updates.
      const otherReactions = (post.reactions || []).filter(r => r.user_id !== user.id);
      const newReactions = action === 'removed'
        ? otherReactions
        : [...otherReactions, { emoji, user_id: user.id, user_name: user.full_name }];
      onPostUpdated?.({ id: post.id, liked: newLiked, likes_count: newCount, reactions: newReactions });
    } catch (err) {
      // Revert optimistic update
      setLiked(prevLiked);
      setLikeCount(prevCount);
      setUserReaction(prevReaction);
      toast.error('Failed to add reaction');
    } finally {
      inFlightRef.current = false;
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
      await apiClient.post(`/posts/${post.id}/comments`, {
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
  
  // Ref for comment input (mobile)
  const mobileCommentInputRef = useRef(null);
  // Ref for comment input (desktop)
  const desktopCommentInputRef = useRef(null);
  
  // Like/unlike a comment
  const handleLikeComment = async (commentId) => {
    if (!user?.id) {
      toast.error('Please log in to like comments');
      return;
    }
    
    try {
      const _response = await apiClient.post(
        `/comments/${commentId}/reactions`,
        { emoji: '\u{1F919}' }
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
              : [...(c.reactions || []), { user_id: user.id, emoji: '\u{1F919}' }]
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
        className={`fixed inset-0 z-[9999] ${m.containerBg}`}
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
        
        {/* Fullscreen Image/Video - with touch double-tap handler for mobile */}
        <div 
          className="absolute inset-0 flex items-center justify-center"
          style={{ zIndex: 2 }}
          onTouchEnd={handleMobileTouchEnd}
        >
          {/* Double-tap shaka animation (mobile) */}
          {showDoubleTapHeart && (
            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
              <img loading="lazy" decoding="async" 
                src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f919.svg"
                alt="shaka"
                className="w-24 h-24 animate-ping"
                style={{ animationDuration: '0.6s', filter: 'drop-shadow(0 4px 12px rgba(234, 179, 8, 0.5))' }}
                draggable={false}
              />
            </div>
          )}
          <div>
            <ImageCarousel images={mediaItems} mediaType={post.media_type} />
          </div>
        </div>
        
        <div 
          className={`absolute top-0 left-0 right-0 ${m.topGradient} pb-12 pt-4`}
          style={{ zIndex: 10, pointerEvents: 'none' }}
        >
          <div className="flex items-center justify-between px-4 pt-2" style={{ pointerEvents: 'auto' }}>
            <button aria-label="Close"
              onClick={onClose}
              className={`p-2 ${m.textPrimary} touch-manipulation`}
              data-testid="close-post-modal"
            ><X className="w-6 h-6" />
            </button>
            
            {/* Author Info */}
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full ${m.avatarFallbackBg} overflow-hidden ring-2 ${m.avatarRing}`}>
                {post.author_avatar ? (
                  <img loading="lazy" decoding="async" src={getFullUrl(post.author_avatar)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className={`w-full h-full flex items-center justify-center text-sm ${m.textPrimary}`}>
                    {post.author_name?.charAt(0)}
                  </span>
                )}
              </div>
              <div>
                <p className={`font-semibold ${m.textPrimary} text-sm`}>{post.author_name}</p>
                {post.location && (
                  <p className={`text-xs ${m.textSecondary}`}>{post.location}</p>
                )}
              </div>
            </div>
            
            <button 
              className={`p-3 ${m.textPrimary} touch-manipulation ${m.menuBtnHover} rounded-full`}
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
            {/* Centered Picker - 2-row grid for mobile */}
            <div 
              className={`absolute ${t.reactionPickerBg} backdrop-blur-md border ${t.reactionPickerBorder} rounded-2xl px-3 py-3 shadow-2xl animate-in zoom-in-95 duration-200`}
              style={{ 
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: `${Math.min(window.innerWidth - 24, 300)}px`
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button 
                onClick={() => setShowReactionPicker(false)}
                className={`absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center ${t.textMuted} ${m.pickerCloseHover} rounded-full touch-manipulation`}
                style={{ zIndex: 1 }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="grid grid-cols-5 gap-1 justify-items-center">
                {REACTION_EMOJIS.map((emoji, _index) => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className={`w-11 h-11 flex items-center justify-center rounded-full ${t.reactionHover} active:scale-90 transition-transform duration-100 touch-manipulation`}
                    style={{ fontSize: '24px' }}
                    data-testid={`post-reaction-${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        
        {/* Bottom Overlay - Caption & Actions - highest z-index for touch */}
        <div 
          className={`absolute bottom-0 left-0 right-0 ${m.bottomGradient} pt-20 pb-6`}
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
                <span className={`${m.textPrimary} font-semibold text-sm ml-1`}>
                  {likeCount.toLocaleString()}
                </span>
              )}
              
              <button
                className={`p-3 ${m.iconColor} ml-2`}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowComments(true);
                  // Focus comment input after expanding
                  setTimeout(() => {
                    if (mobileCommentInputRef.current) mobileCommentInputRef.current.focus();
                  }, 100);
                }}
              >
                <MessageCircle className="w-7 h-7" />
              </button>
              <button aria-label="Send" 
                className={`p-3 ${m.iconColor} touch-manipulation`}
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
              className={`p-3 active:scale-95 touch-manipulation select-none ${saved ? m.savedColor : m.unsavedColor}`}
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
              <p className={`${m.textCaption} text-sm`}>
                <span className={`font-semibold mr-1 cursor-pointer hover:underline ${m.textPrimary}`} onClick={(e) => { e.stopPropagation(); navigate(`/profile/${post.author_id}`); }}>{post.author_name}</span>
                <RichText 
                  text={captionExpanded ? post.caption : truncatedCaption}
                  hashtagClassName="text-cyan-400 hover:text-cyan-300 cursor-pointer"
                  mentionClassName="text-blue-400 hover:text-blue-300 cursor-pointer"
                />
              </p>
              {post.caption?.length > 100 && !captionExpanded && (
                <button className={`${m.moreBtn} text-sm mt-1`}>more</button>
              )}
            </div>
          )}
          
          {/* Comments preview */}
          {comments.length > 0 && !showComments && (
            <button 
              className={`${m.moreBtn} text-sm px-4 mb-2`} 
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
                className={`${m.moreBtn} text-sm mb-2`}
                onClick={() => setShowComments(false)}
              >
                Hide comments
              </button>
              {comments.map((comment) => {
                const isLiked = comment.reactions?.some(r => r.user_id === user?.id);
                return (
                  <div key={comment.id} className="mb-3 flex items-start gap-2">
                    <div className="flex-1">
                      <p className={`${m.commentAuthor} text-sm`}>
                        <span className="font-semibold mr-1 cursor-pointer hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/profile/${comment.author_id}`); }}>{comment.author_name}</span>
                        <span className={m.commentText}>{comment.content}</span>
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className={`${m.textMuted} text-xs`}>{formatTimeAgo(comment.created_at)}</span>
                        {(comment.likes_count > 0 || comment.reactions?.length > 0) && (
                          <span className={`${m.textMuted} text-xs`}>
                            {comment.likes_count || comment.reactions?.length || 0} likes
                          </span>
                        )}
                        <button 
                          className={`${m.textMuted} text-xs font-semibold`}
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
                        className={`w-4 h-4 ${isLiked ? 'text-red-500 fill-red-500' : m.heartInactive}`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Comment Input with Emoji Picker */}
          <div className="relative px-4 pb-2 flex items-center gap-2" style={{ pointerEvents: 'auto' }}>
            <button aria-label="Emoji"
              aria-expanded={showCommentEmoji} onClick={() => setShowCommentEmoji(!showCommentEmoji)}
              className={`flex-shrink-0 p-1.5 rounded-full transition-colors ${
                showCommentEmoji ? m.emojiActive : m.emojiInactive
              }`}
            >
              <Smile className="w-5 h-5" />
            </button>
            <input aria-label="Add a comment..."
              ref={mobileCommentInputRef}
              type="text"
              placeholder="Add a comment..."
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && commentInput.trim()) {
                  handleComment();
                  setShowCommentEmoji(false);
                }
              }}
              className={`flex-1 bg-transparent ${m.inputText} text-sm ${m.inputPlaceholder} outline-none`}
            />
            {commentInput.trim() && (
              <button
                onClick={() => { handleComment(); setShowCommentEmoji(false); }}
                disabled={submittingComment}
                className="text-cyan-400 font-semibold text-sm"
              >
                {submittingComment ? '...' : 'Post'}
              </button>
            )}
            <EmojiPicker
              isOpen={showCommentEmoji}
              onClose={() => setShowCommentEmoji(false)}
              onSelect={(emoji) => {
                setCommentInput(prev => prev + emoji);
              }}
              position="above"
            />
          </div>
          
          {/* Timestamp */}
          <p className={`${m.textMuted} text-xs uppercase px-4 pb-4`}>
            {formatTimeAgo(post.created_at)}
          </p>
        </div>
        
        {/* Share Modal */}
        <SharePostModal
          post={post}
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          isLight={isLight}
        />
        
        {/* Post Menu */}
        <PostMenu
          post={post}
          open={postMenuOpen}
          onClose={() => setPostMenuOpen(false)}
          isLight={isLight}
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
      <button aria-label="Close"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 text-white hover:opacity-80 transition-opacity"
        data-testid="close-post-modal"
      ><X className="w-6 h-6" />
      </button>
      
      {/* Modal content */}
      <div 
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className={`relative ${t.panelBg} rounded-lg overflow-hidden flex max-w-6xl w-[95vw] max-h-[90vh] shadow-2xl`}
        style={{ minHeight: '500px' }}
      >
        {/* Left side - Image/Carousel */}
        <div className="flex-1 bg-black flex items-center justify-center min-w-0 relative" style={{ maxWidth: '60%' }} onClick={handleDoubleTap}>
          {/* Double-tap shaka animation */}
          {showDoubleTapHeart && (
            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
              <img loading="lazy" decoding="async" 
                src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f919.svg"
                alt="shaka"
                className="w-24 h-24 animate-ping"
                style={{ animationDuration: '0.6s', filter: 'drop-shadow(0 4px 12px rgba(234, 179, 8, 0.5))' }}
                draggable={false}
              />
            </div>
          )}
          <ImageCarousel images={mediaItems} mediaType={post.media_type} />
        </div>
        
        {/* Right side - Details & Comments */}
        <div className={`w-[340px] flex flex-col border-l ${t.panelBorder} ${t.panelBg}`}>
          {/* Header */}
          <div className={`flex items-center gap-3 p-4 border-b ${t.panelBorder}`}>
            <div className={`w-8 h-8 rounded-full ${t.avatarFallbackBg} overflow-hidden`}>
              {post.author_avatar ? (
                <img loading="lazy" decoding="async" src={getFullUrl(post.author_avatar)} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className={`w-full h-full flex items-center justify-center text-sm ${t.avatarFallbackText}`}>
                  {post.author_name?.charAt(0)}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold ${t.textPrimary} text-sm truncate cursor-pointer hover:underline`} onClick={(e) => { e.stopPropagation(); navigate(`/profile/${post.author_id}`); }}>{post.author_name}</p>
              {post.location && (
                <p className={`text-xs ${t.textSecondary} truncate`}>{post.location}</p>
              )}
            </div>
            <button className={`${t.textSecondary} ${t.hoverText} p-1`} onClick={(e) => { e.stopPropagation(); setPostMenuOpen(true); }} aria-label="More options">
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
          
          {/* Session metadata if available */}
          {(post.session_date || post.wave_height_ft) && (
            <div className={`px-4 py-2 border-b ${t.panelBorder} space-y-1`}>
              {post.session_date && (
                <div className={`flex items-center gap-2 text-xs ${t.textSecondary}`}>
                  <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{new Date(post.session_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                </div>
              )}
              {post.wave_height_ft && (
                <div className={`flex items-center gap-2 text-xs ${t.textSecondary}`}>
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
                <div className={`w-8 h-8 rounded-full ${t.avatarFallbackBg} overflow-hidden flex-shrink-0`}>
                  {post.author_avatar ? (
                    <img loading="lazy" decoding="async" src={getFullUrl(post.author_avatar)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className={`w-full h-full flex items-center justify-center text-sm ${t.avatarFallbackText}`}>
                      {post.author_name?.charAt(0)}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className={`font-semibold ${t.textPrimary} mr-1 cursor-pointer hover:underline`} onClick={(e) => { e.stopPropagation(); navigate(`/profile/${post.author_id}`); }}>{post.author_name}</span>
                    <RichText 
                      text={post.caption}
                      className={t.captionText}
                      hashtagClassName="text-cyan-400 hover:text-cyan-300 cursor-pointer"
                      mentionClassName="text-blue-400 hover:text-blue-300 cursor-pointer"
                    />
                  </p>
                  <p className={`text-xs ${t.textMuted} mt-1`}>{formatTimeAgo(post.created_at)}</p>
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
                <p className={`text-center ${t.textMuted} text-sm py-4`}>
                  No comments yet. Be the first!
                </p>
              )}
            </div>
          </div>
          
          {/* Reaction Picker Overlay - Desktop */}
          {showReactionPicker && (
            <div className="fixed inset-0 z-[200]">
              <div 
                className="absolute inset-0 bg-black/30"
                onClick={() => setShowReactionPicker(false)}
              />
              <div 
                className={`absolute ${t.reactionPickerBg} backdrop-blur-md border ${t.reactionPickerBorder} rounded-full px-2 py-2 shadow-2xl animate-in zoom-in-95 duration-200 flex items-center`}
                style={{ 
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className={`w-10 h-10 flex items-center justify-center rounded-full ${t.reactionHover} active:scale-90 transition-transform duration-100 touch-manipulation ${
                      userReaction?.emoji === emoji ? (isLight ? 'bg-gray-200 ring-1 ring-cyan-400/50' : 'bg-zinc-700/50 ring-1 ring-cyan-400/50') : ''
                    }`}
                    style={{ fontSize: '22px' }}
                    data-testid={`desktop-reaction-${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
                <button 
                  onClick={() => setShowReactionPicker(false)}
                  className={`w-8 h-8 flex items-center justify-center ${t.textSecondary} ${t.hoverText} border-l ${t.reactionPickerBorder} ml-1 ${t.reactionHover} rounded-full`}
                  aria-label="Close reaction picker"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          
          {/* Actions */}
          <div className={`border-t ${t.panelBorder} p-4 space-y-3`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
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
                  className={`transition-all duration-300 select-none transform ${
                    isPressing ? 'scale-125' : 'hover:scale-110'
                  }`}
                  style={{
                    transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                    WebkitTouchCallout: 'none',
                    WebkitUserSelect: 'none',
                    userSelect: 'none'
                  }}
                  data-testid="desktop-reaction-button"
                  title="Tap to react, hold for emoji picker"
                >
                  {userReaction ? (
                    <span className="text-2xl select-none">{userReaction.emoji}</span>
                  ) : (
                    <ShakaIcon filled={liked} size={24} />
                  )}
                </button>
                <button aria-label="Message"
                  className={`${t.iconDefault} ${t.iconHover} transition-opacity`}
                  onClick={() => {
                    if (desktopCommentInputRef.current) desktopCommentInputRef.current.focus();
                  }}
                >
                  <MessageCircle className="w-6 h-6" />
                </button>
                <button aria-label="Send" 
                  className={`${t.iconDefault} ${t.iconHover} transition-opacity`}
                  onClick={() => setShareModalOpen(true)}
                >
                  <Send className="w-6 h-6" />
                </button>
              </div>
              <button aria-label="Bookmark" 
                onClick={(e) => {
                  e.stopPropagation();
                  handleSave();
                }}
                className={`transition-opacity touch-manipulation active:scale-95 ${saved ? t.savedColor : t.unsavedColor} ${t.iconHover}`}
              >
                <Bookmark className="w-6 h-6" fill={saved ? 'currentColor' : 'none'} />
              </button>
            </div>
            
            {/* Like count */}
            {likeCount > 0 && (
              <p className={`${t.likeCountText} text-sm font-semibold`}>
                {likeCount.toLocaleString()} like{likeCount !== 1 ? 's' : ''}
              </p>
            )}
            
            {/* Timestamp */}
            <p className={`${t.textMuted} text-xs uppercase`}>
              {formatTimeAgo(post.created_at)}
            </p>
          </div>
          
          {/* Comment input with Emoji Picker */}
          <div className={`border-t ${t.panelBorder} p-4`}>
            <div className="relative flex items-center gap-2">
              <button aria-label="Emoji"
                aria-expanded={showCommentEmoji} onClick={() => setShowCommentEmoji(!showCommentEmoji)}
                className={`flex-shrink-0 p-1.5 rounded-full transition-colors ${
                  showCommentEmoji ? t.commentBtnActive : t.commentBtnInactive
                }`}
              >
                <Smile className="w-5 h-5" />
              </button>
              <input aria-label="Text input"
                ref={desktopCommentInputRef}
                type="text"
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && commentInput.trim()) {
                    handleSubmitComment();
                    setShowCommentEmoji(false);
                  }
                }}
                placeholder="Add a comment..."
                className={`flex-1 bg-transparent ${t.inputText} text-sm ${t.inputPlaceholder} focus:outline-none`}
                disabled={submittingComment}
              />
              {commentInput.trim() && (
                <button aria-label="Loader2"
                  onClick={() => { handleSubmitComment(); setShowCommentEmoji(false); }}
                  disabled={submittingComment}
                  className="text-blue-500 hover:text-blue-400 text-sm font-semibold"
                >
                  {submittingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Post'}
                </button>
              )}
              <EmojiPicker
                isOpen={showCommentEmoji}
                onClose={() => setShowCommentEmoji(false)}
                onSelect={(emoji) => {
                  setCommentInput(prev => prev + emoji);
                }}
                position="above"
              />
            </div>
          </div>
        </div>
      </div>
      
      {/* Share Modal */}
      <SharePostModal
        post={post}
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        isLight={isLight}
      />
      
      {/* Post Menu - Desktop */}
      <PostMenu
        post={post}
        open={postMenuOpen}
        onClose={() => setPostMenuOpen(false)}
        isLight={isLight}
        onPostUpdated={() => {}}
        onPostDeleted={() => { onClose(); }}
      />
      
      {/* Swipe navigation arrows - positioned on the viewport edges */}
      {!isMobile && posts && onNavigatePost && (() => {
        const idx = posts.findIndex(p => p.id === post?.id);
        if (idx === -1) return null;
        return (
          <>
            {idx > 0 && (
              <button aria-label="Previous"
                onClick={(e) => { e.stopPropagation(); onNavigatePost(posts[idx - 1]); }}
                className="fixed left-3 top-1/2 -translate-y-1/2 z-[60] w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 backdrop-blur-sm flex items-center justify-center text-white transition-all shadow-lg"
                data-testid="post-modal-prev"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}
            {idx < posts.length - 1 && (
              <button aria-label="Next"
                onClick={(e) => { e.stopPropagation(); onNavigatePost(posts[idx + 1]); }}
                className="fixed right-3 top-1/2 -translate-y-1/2 z-[60] w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 backdrop-blur-sm flex items-center justify-center text-white transition-all shadow-lg"
                data-testid="post-modal-next"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </>
        );
      })()}
    </div>
  );
};

export default PostModal;