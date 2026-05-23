/**
 * PostModal - Instagram-style post popup with image on left, details on right
 * Opens when clicking on a post in the feed
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactionIcon from './social/ReactionIcon';
import { ImageCarousel, CommentItem } from './social/PostModalComponents';
import CommentInputForm from './social/CommentInputForm';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { X, ChevronLeft, ChevronRight, MessageCircle, Send, Bookmark, MoreHorizontal, Loader2, Calendar, Waves } from 'lucide-react';
import { RichText } from './RichText';
import { SharePostModal } from './PostMenu';
import PostMenu from './PostMenu';
import { getFullUrl } from '../utils/media';
import { formatTimeAgo } from '../utils/formatTime';
import { REACTION_EMOJIS } from '../constants/emojis';
import useFocusTrap from '../hooks/useFocusTrap';
import usePostModal from '../hooks/usePostModal';
import PostModalMobileView from './social/PostModalMobileView';


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
  
  // Double-tap to like state
  const [showDoubleTapHeart, setShowDoubleTapHeart] = useState(false);
  const lastTapRef = useRef(0);
  
  // Guard: prevent modal close when reaction picker was just dismissed
  const pickerJustDismissedRef = useRef(false);
  
  const modalRef = useRef(null);
  const mobileCommentInputRef = useRef(null);
  const desktopCommentInputRef = useRef(null);
  
  // Trap focus within the modal for keyboard accessibility
  useFocusTrap(modalRef, isOpen);
  
 // Double-tap to like handler +GG toggles shaka on/off (desktop click-based)
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
      // Priority: optimistic user_reaction (set by feed) > reactions array (from server)
      const existingReaction = post.user_reaction || post.reactions?.find(r => r.user_id === user?.id) || null;
      setUserReaction(existingReaction);
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
 // Back button was pressed +GG close the modal WITHOUT calling history.back()
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
  

  // ============ HANDLERS EXTRACTED TO hooks/usePostModal.js ============
  const {
    inFlightRef, pressTimerRef,
    loadComments, handleLike, handleSave,
    handleReactionStart, handleReactionEnd, handleReactionCancel,
    handleReaction, handleSubmitComment, handleLikeComment,
    handleComment,
  } = usePostModal({
    user, post, onPostUpdated,
    liked, setLiked, likeCount, setLikeCount,
    saved, setSaved, userReaction, setUserReaction,
    setShowReactionPicker, showReactionPicker,
    setComments, setLoadingComments: setLoadingComments,
    commentInput, setCommentInput, setSubmittingComment,
    setIsPressing,
  });

  
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
      <PostModalMobileView
        post={post}
        onClose={onClose}
        user={user}
        isLight={isLight}
        m={m}
        t={t}
        mediaItems={mediaItems}
        truncatedCaption={truncatedCaption}
        comments={comments}
        commentInput={commentInput}
        setCommentInput={setCommentInput}
        submittingComment={submittingComment}
        liked={liked}
        likeCount={likeCount}
        saved={saved}
        showReactionPicker={showReactionPicker}
        setShowReactionPicker={setShowReactionPicker}
        isPressing={isPressing}
        userReaction={userReaction}
        showDoubleTapHeart={showDoubleTapHeart}
        showCommentEmoji={showCommentEmoji}
        setShowCommentEmoji={setShowCommentEmoji}
        handleMobileTouchEnd={handleMobileTouchEnd}
        handleReactionStart={handleReactionStart}
        handleReactionEnd={handleReactionEnd}
        handleReactionCancel={handleReactionCancel}
        handleReaction={handleReaction}
        handleSave={handleSave}
        handleComment={handleComment}
        handleLikeComment={handleLikeComment}
        mobileCommentInputRef={mobileCommentInputRef}
      />
    );
  }
  
  // ============ DESKTOP VIEW (Side-by-side layout) ============
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
 {/* Backdrop -- onMouseDown is the industry-standard close trigger.
          Unlike onClick on the outer container, mouseDown on a dedicated
          backdrop layer can never be accidentally triggered by events
          originating inside the modal content or picker overlays. */}
      <div
        className="absolute inset-0 bg-black/80"
        onMouseDown={(e) => {
          // Only react to clicks directly on the backdrop, never bubbled
          if (e.target !== e.currentTarget) return;
          if (pickerJustDismissedRef.current) {
            pickerJustDismissedRef.current = false;
            return;
          }
          onClose();
        }}
      />
      
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
                onClick={(e) => {
                  e.stopPropagation();
                  pickerJustDismissedRef.current = true;
                  setShowReactionPicker(false);
                  setTimeout(() => { pickerJustDismissedRef.current = false; }, 300);
                }}
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
                    onClick={() => {
                      pickerJustDismissedRef.current = true;
                      handleReaction(emoji);
                      setTimeout(() => { pickerJustDismissedRef.current = false; }, 400);
                    }}
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
                  onClick={() => {
                    pickerJustDismissedRef.current = true;
                    setShowReactionPicker(false);
                    setTimeout(() => { pickerJustDismissedRef.current = false; }, 400);
                  }}
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
                  <ReactionIcon post={post} userId={user?.id} isLiked={liked} isPressing={isPressing} userReactionOverride={userReaction} />
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
          
          {/* Comment input with rich media upload */}
          <div className={`border-t ${t.panelBorder} p-4`} data-testid={`comment-input-container-${post.id}`}>
            <CommentInputForm
              user={user}
              onSubmit={handleSubmitComment}
              placeholder="Add a comment..."
              isLight={isLight}
            />
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
