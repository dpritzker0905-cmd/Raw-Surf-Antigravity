/**
 * PostCardMedia — Extracted from PostCard.js
 * Handles all media rendering: carousel (multi-slide), video (with autoplay/mute/retry),
 * and static image display. Includes double-tap-to-like shaka animation.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, ChevronLeft, ChevronRight, RefreshCw, Volume2, Volume1, VolumeX } from 'lucide-react';
import { getFullUrl } from '../../utils/media';

var PostCardMedia = ({
  post,
  user,
  isLight,
  onImageClick,
  onDoubleTapLike,
}) => {
  // Video state
  const videoRef = useRef(null);
  const programmaticTarget = useRef(false);
  const [userManuallyPaused, setUserManuallyPaused] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [videoVolume, setVideoVolume] = useState(0.7);
  const [showVolSlider, setShowVolSlider] = useState(false);
  const volTimerRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Double-tap state
  const [showDoubleTapHeart, setShowDoubleTapHeart] = useState(false);
  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef(null);
  const touchHandledRef = useRef(false);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const SCROLL_THRESHOLD = 10;

  // Carousel state
  const [activeSlide, setActiveSlide] = useState(0);
  const carouselTouchStartRef = useRef({ x: 0, y: 0 });
  const carouselDragging = useRef(false);
  const carouselDragStartX = useRef(0);
  const isCarousel = post?.is_carousel && post?.carousel_media?.length > 0;
  const carouselItems = isCarousel ? post.carousel_media : [];

  // Media type detection
  const _checkMediaUrl = getFullUrl(post?.media_url || post?.image_url);
  const isVideoItem = post?.media_type === 'video' || (typeof _checkMediaUrl === 'string' && _checkMediaUrl.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i));
  const isDeadLocalVideo = false;

  // Video URL resolution
  const videoSrc = isVideoItem ? getFullUrl(post.media_url) : null;
  const videoPoster = isVideoItem ? getFullUrl(post.thumbnail_url) : null;
  const videoMimeType = (() => {
    if (!post.media_url) return 'video/mp4';
    const ext = post.media_url.split('?')[0].split('.').pop().toLowerCase();
    return { mp4: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg' }[ext] || 'video/mp4';
  })();

  // Tap handlers
  const handleMediaTap = useCallback((e) => {
    if (touchHandledRef.current) {
      touchHandledRef.current = false;
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < 400) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      e.stopPropagation();
      e.preventDefault();
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

  const handleNativeDoubleClick = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
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

  const handleTouchStart = useCallback((e) => {
    if (e.touches?.length === 1) {
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (e.changedTouches?.length !== 1) return;
    const touch = e.changedTouches[0];
    const dx = Math.abs(touch.clientX - touchStartRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);
    if (dx > SCROLL_THRESHOLD || dy > SCROLL_THRESHOLD) return;
    touchHandledRef.current = true;
    const now = Date.now();
    if (now - lastTapRef.current < 400) {
      e.preventDefault();
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

  // Video autoplay via IntersectionObserver
  useEffect(() => {
    if (!isVideoItem || !videoRef.current) return;
    const currentVideo = videoRef.current;
    currentVideo.muted = true;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (!userManuallyPaused) {
              programmaticTarget.current = true;
              currentVideo.play().catch(() => {}).finally(() => {
                programmaticTarget.current = false;
              });
            }
          } else {
            if (!currentVideo.paused) {
              programmaticTarget.current = true;
              currentVideo.pause();
              programmaticTarget.current = false;
            }
          }
        });
      },
      { threshold: 0.6 }
    );
    observer.observe(currentVideo);
    return () => observer.disconnect();
  }, [isVideoItem, userManuallyPaused]);

  return (
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

      {/* ============ CAROUSEL ============ */}
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
            const cdx = e.changedTouches[0].clientX - carouselTouchStartRef.current.x;
            const cdy = Math.abs(e.changedTouches[0].clientY - carouselTouchStartRef.current.y);
            if (Math.abs(cdx) > 40 && cdy < 80) {
              if (cdx < 0 && activeSlide < carouselItems.length - 1) setActiveSlide(prev => prev + 1);
              else if (cdx > 0 && activeSlide > 0) setActiveSlide(prev => prev - 1);
            }
          }}
          onMouseDown={(e) => {
            carouselDragging.current = true;
            carouselDragStartX.current = e.clientX;
            e.currentTarget.style.cursor = 'grabbing';
          }}
          onMouseMove={(e) => { if (carouselDragging.current) e.preventDefault(); }}
          onMouseUp={(e) => {
            if (!carouselDragging.current) return;
            carouselDragging.current = false;
            e.currentTarget.style.cursor = 'grab';
            const mdx = e.clientX - carouselDragStartX.current;
            if (Math.abs(mdx) > 40) {
              if (mdx < 0 && activeSlide < carouselItems.length - 1) setActiveSlide(prev => prev + 1);
              else if (mdx > 0 && activeSlide > 0) setActiveSlide(prev => prev - 1);
            }
          }}
          onMouseLeave={() => { if (carouselDragging.current) carouselDragging.current = false; }}
          onClick={(e) => {
            if (Math.abs(e.clientX - carouselDragStartX.current) > 10) return;
            handleMediaTap(e);
          }}
          onDoubleClick={handleNativeDoubleClick}
        >
          <div 
            className="flex h-full transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${activeSlide * 100}%)` }}
          >
            {carouselItems.map((item, idx) => (
              <div key={idx} className="w-full h-full flex-shrink-0 relative">
                {item.type === 'video' ? (
                  <video className="w-full h-full object-cover" playsInline muted loop autoPlay={idx === activeSlide} poster={item.thumbnail_url ? getFullUrl(item.thumbnail_url) : undefined}>
                    <source src={getFullUrl(item.url)} type="video/mp4" />
                  </video>
                ) : (
                  <>
                    <img loading="lazy" decoding="async" src={getFullUrl(item.url)} alt={`Slide ${idx + 1}`} className="w-full h-full object-cover" draggable={false}
                      onError={(e) => { e.target.style.display = 'none'; const placeholder = e.target.nextElementSibling; if (placeholder) placeholder.style.display = 'flex'; }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 to-zinc-900 items-center justify-center flex-col gap-2" style={{ display: 'none' }}>
                      <RefreshCw className="w-8 h-8 text-zinc-500" />
                      <span className="text-zinc-400 text-sm font-medium">Photo unavailable</span>
                      <span className="text-zinc-500 text-xs">Slide {idx + 1}</span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          {activeSlide > 0 && (
            <button onClick={(e) => { e.stopPropagation(); setActiveSlide(prev => prev - 1); }} className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors" aria-label="Previous slide">
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          {activeSlide < carouselItems.length - 1 && (
            <button onClick={(e) => { e.stopPropagation(); setActiveSlide(prev => prev + 1); }} className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors" aria-label="Next slide">
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5">
            {carouselItems.map((_, idx) => (
              <button key={idx} onClick={(e) => { e.stopPropagation(); setActiveSlide(idx); }}
                className={`rounded-full transition-all duration-200 ${idx === activeSlide ? 'w-2 h-2 bg-white shadow-lg' : 'w-1.5 h-1.5 bg-white/50 hover:bg-white/70'}`}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
          </div>
          <div className="absolute top-3 right-3 z-10 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-full text-xs text-white font-medium">
            {activeSlide + 1} / {carouselItems.length}
          </div>
        </div>
      ) : isVideoItem ? (
        (isDeadLocalVideo || videoError) ? (
          <div className="relative w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
            <Play className="w-12 h-12 text-zinc-500 mb-2" />
            <span className="text-zinc-400 text-sm font-medium">Video Unavailable</span>
            <span className="text-zinc-500 text-xs mt-1">This video is no longer accessible</span>
            {videoError && !isDeadLocalVideo && (
              <button onClick={(e) => {
                e.stopPropagation();
                setVideoError(false);
                if (videoRef.current) {
                  const src = videoRef.current.querySelector('source');
                  if (src) { const url = new URL(src.src, window.location.origin); url.searchParams.set('_retry', Date.now()); src.src = url.toString(); }
                  videoRef.current.load();
                }
              }} className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm font-medium transition-colors" data-testid={`video-retry-${post.id}`}>
                <RefreshCw className="w-4 h-4" />
                Tap to retry
              </button>
            )}
            <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-xs text-white flex items-center gap-1">
              <Play className="w-3 h-3" />
              {post.video_duration ? `${Math.round(post.video_duration)}s` : 'Video'}
            </div>
          </div>
        ) : (
          <>
          <video ref={videoRef} poster={videoPoster} className="w-full h-full object-cover" playsInline webkit-playsinline="true" preload="none" muted={isMuted} autoPlay loop
            onPlay={() => { setIsPlaying(true); if (!programmaticTarget.current) setUserManuallyPaused(false); }}
            onPause={() => { setIsPlaying(false); if (!programmaticTarget.current) setUserManuallyPaused(true); }}
            onError={() => setVideoError(true)}
          >
            <source src={videoSrc} type={videoMimeType} onError={() => setVideoError(true)} />
            {videoMimeType !== 'video/mp4' && <source src={videoSrc} type="video/mp4" onError={() => setVideoError(true)} />}
          </video>
          <div className="absolute inset-0 z-[1]" />
          {!isPlaying && (
            <div className="absolute inset-0 z-[2] flex items-center justify-center pointer-events-none">
              <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
                <Play className="w-8 h-8 text-white ml-1" fill="white" />
              </div>
            </div>
          )}
          {/* Volume control */}
          <div className="absolute bottom-3 right-3 z-[3] flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={() => { setShowVolSlider(true); if (volTimerRef.current) clearTimeout(volTimerRef.current); }}
            onMouseLeave={() => { volTimerRef.current = setTimeout(() => setShowVolSlider(false), 1200); }}
          >
            <div className="overflow-hidden transition-all duration-300 ease-out flex items-center" style={{ width: showVolSlider ? '60px' : '0px', opacity: showVolSlider ? 1 : 0 }}>
              <input aria-label="Range slider" type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : videoVolume}
                onChange={(e) => {
                  e.stopPropagation();
                  const newVol = parseFloat(e.target.value);
                  setVideoVolume(newVol);
                  if (videoRef.current) {
                    videoRef.current.volume = newVol;
                    if (newVol === 0) { setIsMuted(true); videoRef.current.muted = true; }
                    else if (isMuted) { setIsMuted(false); videoRef.current.muted = false; }
                  }
                  if (volTimerRef.current) clearTimeout(volTimerRef.current);
                  volTimerRef.current = setTimeout(() => setShowVolSlider(false), 2000);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full h-1 appearance-none rounded-full cursor-pointer"
                aria-label="Volume"
                style={{ background: `linear-gradient(to right, rgba(255,255,255,0.9) ${(isMuted ? 0 : videoVolume) * 100}%, rgba(255,255,255,0.25) ${(isMuted ? 0 : videoVolume) * 100}%)` }}
              />
            </div>
            <button onClick={(e) => {
              e.stopPropagation();
              const newMuted = !isMuted;
              setIsMuted(newMuted);
              if (videoRef.current) { videoRef.current.muted = newMuted; if (!newMuted) videoRef.current.volume = videoVolume; }
              setShowVolSlider(true);
              if (volTimerRef.current) clearTimeout(volTimerRef.current);
              volTimerRef.current = setTimeout(() => setShowVolSlider(false), 2000);
            }} className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/80 transition-colors" data-testid={`video-mute-${post.id}`} aria-label={isMuted ? 'Unmute' : 'Mute'}>
              {isMuted || videoVolume === 0 ? <VolumeX className="w-4 h-4" /> : videoVolume < 0.5 ? <Volume1 className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
          </>
        )
      ) : (
        <img loading="lazy" decoding="async" 
          src={getFullUrl(post.media_url || post.image_url)}
          alt={post.caption || 'Surf photo'}
          className="w-full h-full object-cover"
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
  );
};

export default React.memo(PostCardMedia);
