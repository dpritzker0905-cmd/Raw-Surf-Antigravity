/**
 * PostCard - Extracted from Feed.js for better maintainability
 * Renders a single post in the feed with all interactions
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../lib/apiClient';
import SessionLogHeader from './SessionLogHeader';
import { CommentInputWithEmoji } from './EmojiPicker';
import WhoReactedModal from './WhoReactedModal';
import SessionJoinCard from './SessionJoinCard';
import { RichText } from './RichText';
import { MapPin, MessageCircle, Send, Bookmark, MoreHorizontal, Loader2, Play, Radio, Heart, ShoppingBag, ChevronLeft, ChevronRight, RefreshCw, Volume2, Volume1, VolumeX, Pause } from 'lucide-react';
import { toast } from 'sonner';
import { getFullUrl } from '../utils/media';



// Comment reaction emojis - imported from centralized constants/emojis.js

/**
 * ReplyItem - Simpler component for reply rendering (non-recursive)
 */
// ReplyItem extracted to ./social/ReplyItem.js

/**
 * CommentWithReaction - Individual comment with like/reaction button and reply support
 */
import CommentWithReaction from './social/CommentWithReaction';
import RoleBadge from './social/RoleBadge';
import ReactionIcon from './social/ReactionIcon';




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
  onImageClick,  // Opens Instagram-style modal
  onDoubleTapLike  // Direct like function for double-tap (bypasses pointer events)
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
  const [videoVolume, setVideoVolume] = useState(0.7);
  const [showVolSlider, setShowVolSlider] = useState(false);
  const volTimerRef = useRef(null);
  // Track if video is currently playing (for play/pause overlay)
  const [isPlaying, setIsPlaying] = useState(false);

  // Double-tap to like state
  const [showDoubleTapHeart, setShowDoubleTapHeart] = useState(false);
  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef(null);
  // Prevents synthesized click from double-firing after touch on mobile.
  // Touch fires first, then browser synthesizes a click event ~50-100ms later.
  // Without this guard, the click handler sees the touch's timestamp and
  // falsely detects a "double tap" from a single finger tap.
  const touchHandledRef = useRef(false);
  // Track touch start position to distinguish scrolls from taps.
  // If finger moves >10px between touchstart and touchend, it's a scroll, not a tap.
  const touchStartRef = useRef({ x: 0, y: 0 });
  const SCROLL_THRESHOLD = 10; // pixels

  // Carousel state
  const [activeSlide, setActiveSlide] = useState(0);
  const carouselTouchStartRef = useRef({ x: 0, y: 0 });
  const carouselDragging = useRef(false);
  const carouselDragStartX = useRef(0);
  const isCarousel = post?.is_carousel && post?.carousel_media?.length > 0;
  const carouselItems = isCarousel ? post.carousel_media : [];

  const handleMediaTap = useCallback((e) => {
    // Skip if touch already handled this interaction (prevents touch→click double-fire)
    if (touchHandledRef.current) {
      touchHandledRef.current = false;
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < 400) {
      // Double tap detected → cancel pending single tap
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      e.stopPropagation();
      e.preventDefault();
      
      // Double-tap toggles shaka reaction on/off
      if (user?.id && post?.id && onDoubleTapLike) {
        onDoubleTapLike(post.id);
      }
      
      // Always show the shaka animation (even if already liked)
      setShowDoubleTapHeart(true);
      setTimeout(() => setShowDoubleTapHeart(false), 800);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
      // Delay single tap to allow double tap detection
      singleTapTimerRef.current = setTimeout(() => {
        onImageClick && onImageClick(post);
        singleTapTimerRef.current = null;
      }, 350);
    }
  }, [user?.id, post?.id, post?.liked, onDoubleTapLike, onImageClick, post]);

  // Native onDoubleClick handler — failsafe for browsers where onClick double-tap detection fails
  const handleNativeDoubleClick = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    // Cancel any pending single-tap timer
    if (singleTapTimerRef.current) {
      clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = null;
    }
    if (user?.id && post?.id && onDoubleTapLike) {
      onDoubleTapLike(post.id);
    }
    setShowDoubleTapHeart(true);
    setTimeout(() => setShowDoubleTapHeart(false), 800);
    lastTapRef.current = 0;
  }, [user?.id, post?.id, post?.liked, onDoubleTapLike]);

  // Record touch start position to detect scrolls vs taps
  const handleTouchStart = useCallback((e) => {
    if (e.touches?.length === 1) {
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, []);

  // Touch-based double-tap for mobile (bypasses 300ms click delay)
  const handleTouchEnd = useCallback((e) => {
    // Only handle single-finger taps
    if (e.changedTouches?.length !== 1) return;

    // ── Scroll detection: if finger moved >10px, this is a scroll, not a tap ──
    const touch = e.changedTouches[0];
    const dx = Math.abs(touch.clientX - touchStartRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);
    if (dx > SCROLL_THRESHOLD || dy > SCROLL_THRESHOLD) return;

    // Mark that touch handled this interaction so the synthesized click skips
    touchHandledRef.current = true;
    const now = Date.now();
    if (now - lastTapRef.current < 400) {
      // Double-tap via touch
      e.preventDefault(); // Prevent click from also firing
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      if (user?.id && post?.id && onDoubleTapLike) {
        onDoubleTapLike(post.id);
      }
      setShowDoubleTapHeart(true);
      setTimeout(() => setShowDoubleTapHeart(false), 800);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
      singleTapTimerRef.current = setTimeout(() => {
        onImageClick && onImageClick(post);
        singleTapTimerRef.current = null;
      }, 350);
    }
  }, [user?.id, post?.id, post?.liked, onDoubleTapLike, onImageClick, post]);

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
          emoji: '🤙'
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

  // Video URL resolution - extracted here to keep JSX clean (no IIFE needed)
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
                  <img loading="lazy" decoding="async" 
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
              <span className="opacity-50">-</span>
            )}
            {post.location && (
              <span>{post.location}</span>
            )}
          </p>
        </div>
        </div>
        <button aria-label="More options" 
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
          <button aria-label="Shopping Bag"
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

      {/* Post Image/Video/Carousel - click to open modal, double-tap to like */}
      <div 
        className={`aspect-[4/5] ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} relative select-none cursor-pointer overflow-hidden`}
        onClick={!isCarousel ? handleMediaTap : undefined}
        onDoubleClick={!isCarousel ? handleNativeDoubleClick : undefined}
        onTouchStart={!isCarousel ? handleTouchStart : undefined}
        onTouchEnd={!isCarousel ? handleTouchEnd : undefined}
        data-testid={`post-image-container-${post.id}`}
      >
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

        {/* ============ CAROUSEL RENDERING ============ */}
        {isCarousel ? (
          <div className="relative w-full h-full"
            style={{ touchAction: 'pan-y', cursor: 'grab' }}
            onTouchStart={(e) => {
              if (e.touches?.length === 1) {
                carouselTouchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              }
            }}
            onTouchEnd={(e) => {
              if (e.changedTouches?.length !== 1) return;
              const dx = e.changedTouches[0].clientX - carouselTouchStartRef.current.x;
              const dy = Math.abs(e.changedTouches[0].clientY - carouselTouchStartRef.current.y);
              // Only horizontal swipes (not vertical scrolls)
              if (Math.abs(dx) > 40 && dy < 80) {
                if (dx < 0 && activeSlide < carouselItems.length - 1) {
                  setActiveSlide(prev => prev + 1);
                } else if (dx > 0 && activeSlide > 0) {
                  setActiveSlide(prev => prev - 1);
                }
              }
            }}
            onMouseDown={(e) => {
              carouselDragging.current = true;
              carouselDragStartX.current = e.clientX;
              e.currentTarget.style.cursor = 'grabbing';
            }}
            onMouseMove={(e) => {
              if (!carouselDragging.current) return;
              e.preventDefault();
            }}
            onMouseUp={(e) => {
              if (!carouselDragging.current) return;
              carouselDragging.current = false;
              e.currentTarget.style.cursor = 'grab';
              const dx = e.clientX - carouselDragStartX.current;
              if (Math.abs(dx) > 40) {
                if (dx < 0 && activeSlide < carouselItems.length - 1) {
                  setActiveSlide(prev => prev + 1);
                } else if (dx > 0 && activeSlide > 0) {
                  setActiveSlide(prev => prev - 1);
                }
              }
            }}
            onMouseLeave={() => {
              if (carouselDragging.current) {
                carouselDragging.current = false;
              }
            }}
            onClick={(e) => {
              // Don't fire click if this was a drag
              if (Math.abs(e.clientX - carouselDragStartX.current) > 10) return;
              handleMediaTap(e);
            }}
            onDoubleClick={handleNativeDoubleClick}
          >
            {/* Carousel slides container */}
            <div 
              className="flex h-full transition-transform duration-300 ease-out"
              style={{ transform: `translateX(-${activeSlide * 100}%)` }}
            >
              {carouselItems.map((item, idx) => (
                <div key={idx} className="w-full h-full flex-shrink-0">
                  {item.type === 'video' ? (
                    <video
                      className="w-full h-full object-cover"
                      playsInline
                      muted
                      loop
                      autoPlay={idx === activeSlide}
                      poster={item.thumbnail_url ? getFullUrl(item.thumbnail_url) : undefined}
                    >
                      <source src={getFullUrl(item.url)} type="video/mp4" />
                    </video>
                  ) : (
                    <img
                      loading="lazy"
                      decoding="async"
                      src={getFullUrl(item.url)}
                      alt={`Slide ${idx + 1}`}
                      className="w-full h-full object-cover"
                      draggable={false}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Carousel navigation arrows (desktop) */}
            {activeSlide > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setActiveSlide(prev => prev - 1); }}
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                aria-label="Previous slide"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {activeSlide < carouselItems.length - 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); setActiveSlide(prev => prev + 1); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                aria-label="Next slide"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}

            {/* Carousel dot indicators */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5">
              {carouselItems.map((_, idx) => (
                <button
                  key={idx}
                  onClick={(e) => { e.stopPropagation(); setActiveSlide(idx); }}
                  className={`rounded-full transition-all duration-200 ${idx === activeSlide 
                    ? 'w-2 h-2 bg-white shadow-lg' 
                    : 'w-1.5 h-1.5 bg-white/50 hover:bg-white/70'
                  }`}
                  aria-label={`Go to slide ${idx + 1}`}
                />
              ))}
            </div>

            {/* Slide counter badge */}
            <div className="absolute top-3 right-3 z-10 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-full text-xs text-white font-medium">
              {activeSlide + 1} / {carouselItems.length}
            </div>
          </div>
        ) : isVideoItem ? (
          // If video source errored (404 / network failure), show fallback
          (isDeadLocalVideo || videoError) ? (
            <div className="relative w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
              <Play className="w-12 h-12 text-zinc-500 mb-2" />
              <span className="text-zinc-400 text-sm font-medium">Video Unavailable</span>
              <span className="text-zinc-500 text-xs mt-1">This video is no longer accessible</span>
              {/* Retry button - clears error to re-attempt load */}
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
          /* TikTok/Instagram pattern: video plays as muted preview in feed. */
          <>
          <video
            ref={videoRef}
            poster={videoPoster}
            className="w-full h-full object-cover"
            playsInline
            webkit-playsinline="true"
            preload="none"
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
          {/* Transparent click overlay */}
          <div className="absolute inset-0 z-[1]" />
          {/* Centered play icon - shows when paused */}
          {!isPlaying && (
            <div className="absolute inset-0 z-[2] flex items-center justify-center pointer-events-none">
              <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
                <Play className="w-8 h-8 text-white ml-1" fill="white" />
              </div>
            </div>
          )}
          {/* Volume control */}
          <div
            className="absolute bottom-3 right-3 z-[3] flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={() => {
              setShowVolSlider(true);
              if (volTimerRef.current) clearTimeout(volTimerRef.current);
            }}
            onMouseLeave={() => {
              volTimerRef.current = setTimeout(() => setShowVolSlider(false), 1200);
            }}
          >
            {/* Horizontal slider */}
            <div
              className="overflow-hidden transition-all duration-300 ease-out flex items-center"
              style={{
                width: showVolSlider ? '60px' : '0px',
                opacity: showVolSlider ? 1 : 0,
              }}
            >
              <input aria-label="Range slider"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : videoVolume}
                onChange={(e) => {
                  e.stopPropagation();
                  const newVol = parseFloat(e.target.value);
                  setVideoVolume(newVol);
                  if (videoRef.current) {
                    videoRef.current.volume = newVol;
                    if (newVol === 0) {
                      setIsMuted(true);
                      videoRef.current.muted = true;
                    } else if (isMuted) {
                      setIsMuted(false);
                      videoRef.current.muted = false;
                    }
                  }
                  if (volTimerRef.current) clearTimeout(volTimerRef.current);
                  volTimerRef.current = setTimeout(() => setShowVolSlider(false), 2000);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full h-1 appearance-none rounded-full cursor-pointer"
                aria-label="Volume"
                style={{
                  background: `linear-gradient(to right, rgba(255,255,255,0.9) ${(isMuted ? 0 : videoVolume) * 100}%, rgba(255,255,255,0.25) ${(isMuted ? 0 : videoVolume) * 100}%)`,
                }}
              />
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const newMuted = !isMuted;
                setIsMuted(newMuted);
                if (videoRef.current) {
                  videoRef.current.muted = newMuted;
                  if (!newMuted) videoRef.current.volume = videoVolume;
                }
                setShowVolSlider(true);
                if (volTimerRef.current) clearTimeout(volTimerRef.current);
                volTimerRef.current = setTimeout(() => setShowVolSlider(false), 2000);
              }}
              className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/80 transition-colors"
              data-testid={`video-mute-${post.id}`}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || videoVolume === 0 ? <VolumeX className="w-4 h-4" /> : videoVolume < 0.5 ? <Volume1 className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
          </>
          )
        ) : (
          <img
loading="lazy" decoding="async" 
            src={getFullUrl(post.media_url || post.image_url)}
            alt={post.caption || 'Surf photo'}
            className="w-full h-full object-cover"
            loading="lazy"
            draggable="false"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        )}
        {isVideoItem && !(isDeadLocalVideo || videoError) && !isCarousel && (
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
                onPointerDown={(e) => {
                  e.preventDefault();
                  onLikeStart(post.id, e);
                }}
                onPointerUp={(e) => {
                  e.preventDefault();
                  onLikeEnd(post.id, e);
                }}
                onPointerCancel={() => onLikeLeave()}
                onPointerLeave={() => onLikeLeave()}
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
                  WebkitTapHighlightColor: 'transparent',
                  touchAction: 'none' // Prevent browser from handling touch gestures
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
              <button aria-label="Message" 
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
            <button aria-label="Send" 
              className={`${textPrimaryClass} hover:${textSecondaryClass} transition-colors`}
              onClick={() => onSharePost(post)}
              data-testid={`share-btn-${post.id}`}
            >
              <Send className="w-6 h-6" />
            </button>
          </div>
          <button aria-label="Bookmark" 
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
            <button aria-label="Loader2" 
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

export default React.memo(PostCard);
