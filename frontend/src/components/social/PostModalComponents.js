/**
 * PostModalComponents.js - Sub-components extracted from PostModal.js.
 * ModalVideoPlayer, ImageCarousel, CommentItem.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, Volume1, Volume2, VolumeX, Maximize, ChevronLeft, ChevronRight, Heart } from 'lucide-react';
import { getFullUrl } from '../../utils/media';
import { getExpandedRoleInfo } from '../../contexts/PersonaContext';
import { formatTimeAgo, formatDuration } from '../../utils/formatTime';
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';
import { CommentText } from '../RichText';

const ModalVideoPlayer = ({ src, poster, className = '' }) => {
  const videoRef = useRef(null);
  const progressRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.7); // 0-1 range
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTimeState] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const hideTimerRef = useRef(null);
  const volumeTimerRef = useRef(null);

  // Auto-play when mounted
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = true; // Required for autoplay
      videoRef.current.play().then(() => {
        setPlaying(true);
        setMuted(true);
      }).catch(() => {});
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
    };
  }, [src]);

  // Update progress bar
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => {
      setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0);
      setCurrentTimeState(video.currentTime);
    };
    const onLoaded = () => setDuration(video.duration || 0);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoaded);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoaded);
    };
  }, []);

  const togglePlay = (e) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    if (playing) {
      videoRef.current.pause();
      setPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setPlaying(true);
    }
    // Show controls briefly then auto-hide
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowControls(false), 2500);
  };

  const toggleMute = (e) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    const newMuted = !muted;
    videoRef.current.muted = newMuted;
    if (!newMuted) {
      videoRef.current.volume = volume;
    }
    setMuted(newMuted);
  };

  const handleVolumeChange = (e) => {
    e.stopPropagation();
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      if (newVolume === 0) {
        setMuted(true);
        videoRef.current.muted = true;
      } else if (muted) {
        setMuted(false);
        videoRef.current.muted = false;
      }
    }
    // Keep slider visible while interacting
    if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
    volumeTimerRef.current = setTimeout(() => setShowVolumeSlider(false), 2000);
  };

  const handleVolumeAreaEnter = () => {
    setShowVolumeSlider(true);
    if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
  };

  const handleVolumeAreaLeave = () => {
    volumeTimerRef.current = setTimeout(() => setShowVolumeSlider(false), 1200);
  };

  // Get appropriate volume icon
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const handleSeek = (e) => {
    e.stopPropagation();
    if (!videoRef.current || !progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    videoRef.current.currentTime = ratio * videoRef.current.duration;
  };

  const formatTime = formatDuration;

  return (
    <div
      className={`relative w-full h-full bg-black flex items-center justify-center group ${className}`}
      onClick={togglePlay}
      onMouseMove={() => {
        setShowControls(true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => setShowControls(false), 2500);
      }}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="max-w-full max-h-full object-contain"
        playsInline
        webkit-playsinline="true"
        loop
        muted={muted}
        preload="metadata"
      />

      {/* Play/Pause center overlay - fades in/out */}
      <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-300 ${showControls || !playing ? 'opacity-100' : 'opacity-0'}`}>
        {!playing && (
          <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <Play className="w-8 h-8 text-white ml-1" fill="white" />
          </div>
        )}
      </div>

      {/* Bottom control bar */}
      <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 flex flex-col gap-2 transition-opacity duration-300 ${showControls || !playing ? 'opacity-100' : 'opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="w-full h-1 bg-white/30 rounded-full cursor-pointer relative group/progress"
          onClick={handleSeek}
        >
          <div
            className="h-full bg-white rounded-full transition-all relative"
            style={{ width: `${progress}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity" />
          </div>
        </div>
        {/* Time + controls row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="text-white hover:opacity-80 transition-opacity"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" fill="white" />}
            </button>
            <span className="text-white/80 text-xs font-mono">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
          {/* Volume control group */}
          <div
            className="flex items-center gap-1.5"
            onMouseEnter={handleVolumeAreaEnter}
            onMouseLeave={handleVolumeAreaLeave}
            onTouchStart={handleVolumeAreaEnter}
          >
            {/* Volume slider - progressive disclosure */}
            <div
              className="overflow-hidden transition-all duration-300 ease-out flex items-center"
              style={{
                width: showVolumeSlider ? '80px' : '0px',
                opacity: showVolumeSlider ? 1 : 0,
              }}
            >
              <input aria-label="Range slider"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                onClick={(e) => e.stopPropagation()}
                className="w-full h-1 appearance-none bg-white/30 rounded-full cursor-pointer"
                aria-label="Volume"
                style={{
                  background: `linear-gradient(to right, rgba(255,255,255,0.9) ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.2) ${(muted ? 0 : volume) * 100}%)`,
                }}
              />
            </div>
            <button aria-label="Volume Icon"
              onClick={(e) => {
                toggleMute(e);
                setShowVolumeSlider(true);
                if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
                volumeTimerRef.current = setTimeout(() => setShowVolumeSlider(false), 2000);
              }}
              className="text-white hover:opacity-80 transition-opacity p-1 min-w-[28px] min-h-[28px] flex items-center justify-center"
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

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
  const posterUrl = typeof currentItem === 'object' ? currentItem?.poster : undefined;
  
  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center">
      {isVideo ? (
        <ModalVideoPlayer
          src={mediaUrl}
          poster={posterUrl}
          className="w-full h-full"
        />
      ) : (
        <img loading="lazy" decoding="async"
          src={mediaUrl}
          alt="Post media"
          className="max-w-full max-h-full object-contain"
          draggable="false"
        />
      )}
      
      {/* Navigation arrows */}
      {mediaItems.length > 1 && (
        <>
          <button aria-label="Previous"
            onClick={goPrev}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-colors z-10"
          >
            <ChevronLeft className="w-5 h-5 text-gray-800" />
          </button>
          <button aria-label="Next"
            onClick={goNext}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-colors z-10"
          >
            <ChevronRight className="w-5 h-5 text-gray-800" />
          </button>
          
          {/* Dots indicator */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
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

const CommentItem = ({ comment, userId, _onReact }) => {
  const navigate = useNavigate();
  const [liked, setLiked] = useState(comment.viewer_reaction !== null);
  const [likeCount, setLikeCount] = useState(comment.reaction_count || 0);
  
  const handleLike = async () => {
    if (!userId) {
      toast.error('Please log in to like');
      return;
    }
    
    try {
      const response = await apiClient.post(
        `/comments/${comment.id}/reactions`,
        { emoji: '🤙' }
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
          <img loading="lazy" decoding="async" src={getFullUrl(comment.author_avatar)} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs text-gray-400">{comment.author_name?.charAt(0)}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-semibold text-white mr-1 cursor-pointer hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/profile/${comment.author_id}`); }}>{comment.author_name}</span>
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
      <button aria-label="Like"
        onClick={handleLike}
        className={`flex-shrink-0 p-1 ${liked ? 'text-red-500' : 'text-gray-500 hover:text-gray-300'}`}
      >
        <Heart className="w-3.5 h-3.5" fill={liked ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
};

export { ModalVideoPlayer, ImageCarousel, CommentItem };
