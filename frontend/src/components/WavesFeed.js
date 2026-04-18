/**
 * WavesFeed - Full-screen vertical video feed (TikTok/Reels style)
 * Swipe up/down to navigate, double-tap to like
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Heart, MessageCircle, Share2, Volume2, VolumeX, Play, ChevronUp, ChevronDown, MapPin, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';


/**
 * Single Wave Card - Full screen vertical video
 */
const WaveCard = ({ 
  wave, 
  isActive, 
  isMuted, 
  onToggleMute, 
  onLike, 
  onComment, 
  onShare,
  onViewProfile,
  _userId
}) => {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showHeart, setShowHeart] = useState(false);
  const [localLiked, setLocalLiked] = useState(wave.is_liked);
  const [localLikes, setLocalLikes] = useState(wave.likes_count);
  const lastTapRef = useRef(0);
  
  // Auto-play when active
  useEffect(() => {
    if (videoRef.current) {
      if (isActive) {
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
        // Record view
        apiClient.post(`/waves/${wave.id}/view`).catch(() => {});
      } else {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
        setIsPlaying(false);
      }
    }
  }, [isActive, wave.id]);
  
  // Sync mute state
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);
  
  // Handle tap - single tap = play/pause, double tap = like
  const handleTap = useCallback((e) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // Double tap - like
      e.preventDefault();
      handleDoubleTapLike();
    } else {
      // Single tap - toggle play/pause (delayed to check for double tap)
      setTimeout(() => {
        if (Date.now() - lastTapRef.current >= DOUBLE_TAP_DELAY) {
          if (videoRef.current) {
            if (videoRef.current.paused) {
              videoRef.current.play();
              setIsPlaying(true);
            } else {
              videoRef.current.pause();
              setIsPlaying(false);
            }
          }
        }
      }, DOUBLE_TAP_DELAY);
    }
    lastTapRef.current = now;
  }, []);
  
  const handleDoubleTapLike = async () => {
    // Show heart animation
    setShowHeart(true);
    setTimeout(() => setShowHeart(false), 800);
    
    // Like if not already liked
    if (!localLiked) {
      setLocalLiked(true);
      setLocalLikes(prev => prev + 1);
      onLike(wave.id);
    }
  };
  
  const handleLikeButton = async () => {
    if (localLiked) {
      setLocalLiked(false);
      setLocalLikes(prev => Math.max(0, prev - 1));
    } else {
      setLocalLiked(true);
      setLocalLikes(prev => prev + 1);
    }
    onLike(wave.id);
  };
  
  const formatCount = (count) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count?.toString() || '0';
  };
  
  const formatDuration = (seconds) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  return (
    <div 
      className="relative w-full h-full bg-black flex items-center justify-center snap-start snap-always"
      onClick={handleTap}
      data-testid={`wave-card-${wave.id}`}
    >
      {/* Video */}
      <video
        ref={videoRef}
        src={wave.media_url?.startsWith('/api') ? `${process.env.REACT_APP_BACKEND_URL}${wave.media_url}` : wave.media_url}
        className="absolute inset-0 w-full h-full object-cover"
        loop
        playsInline
        muted={isMuted}
        poster={wave.thumbnail_url?.startsWith('/api') ? `${process.env.REACT_APP_BACKEND_URL}${wave.thumbnail_url}` : wave.thumbnail_url}
      />
      
      {/* Double-tap heart animation */}
      {showHeart && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <Heart 
            className="w-32 h-32 text-red-500 animate-ping" 
            fill="currentColor"
          />
        </div>
      )}
      
      {/* Play/Pause indicator */}
      {!isPlaying && isActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-20 h-20 rounded-full bg-black/40 flex items-center justify-center">
            <Play className="w-10 h-10 text-white ml-1" fill="white" />
          </div>
        </div>
      )}
      
      {/* Gradient overlays for readability */}
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/40 to-transparent pointer-events-none" />
      
      {/* Right side action buttons */}
      <div className="absolute right-3 bottom-32 flex flex-col items-center gap-5 z-10">
        {/* Author Avatar */}
        <button
          onClick={(e) => { e.stopPropagation(); onViewProfile(wave.author_id); }}
          className="relative"
          data-testid="wave-author-avatar"
        >
          {wave.author_avatar ? (
            <img 
              src={wave.author_avatar} 
              alt={wave.author_name}
              className="w-12 h-12 rounded-full border-2 border-white object-cover"
            />
          ) : (
            <div className="w-12 h-12 rounded-full border-2 border-white bg-zinc-700 flex items-center justify-center text-white font-bold">
              {wave.author_name?.charAt(0) || '?'}
            </div>
          )}
          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
            <Plus className="w-3 h-3 text-white" />
          </div>
        </button>
        
        {/* Like */}
        <button
          onClick={(e) => { e.stopPropagation(); handleLikeButton(); }}
          className="flex flex-col items-center gap-1"
          data-testid="wave-like-btn"
        >
          <div className={`w-12 h-12 rounded-full bg-black/30 flex items-center justify-center transition-transform active:scale-90 ${localLiked ? 'text-red-500' : 'text-white'}`}>
            <Heart className="w-7 h-7" fill={localLiked ? 'currentColor' : 'none'} />
          </div>
          <span className="text-white text-xs font-semibold">{formatCount(localLikes)}</span>
        </button>
        
        {/* Comments */}
        <button
          onClick={(e) => { e.stopPropagation(); onComment(wave); }}
          className="flex flex-col items-center gap-1"
          data-testid="wave-comment-btn"
        >
          <div className="w-12 h-12 rounded-full bg-black/30 flex items-center justify-center text-white transition-transform active:scale-90">
            <MessageCircle className="w-7 h-7" />
          </div>
          <span className="text-white text-xs font-semibold">{formatCount(wave.comments_count)}</span>
        </button>
        
        {/* Share */}
        <button
          onClick={(e) => { e.stopPropagation(); onShare(wave); }}
          className="flex flex-col items-center gap-1"
          data-testid="wave-share-btn"
        >
          <div className="w-12 h-12 rounded-full bg-black/30 flex items-center justify-center text-white transition-transform active:scale-90">
            <Share2 className="w-7 h-7" />
          </div>
          <span className="text-white text-xs font-semibold">Share</span>
        </button>
        
        {/* Sound toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
          className="flex flex-col items-center gap-1"
          data-testid="wave-sound-btn"
        >
          <div className="w-10 h-10 rounded-full bg-black/30 flex items-center justify-center text-white transition-transform active:scale-90">
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </div>
        </button>
      </div>
      
      {/* Bottom info */}
      <div className="absolute left-3 right-20 bottom-6 z-10" onClick={(e) => e.stopPropagation()}>
        {/* Author info */}
        <button 
          onClick={() => onViewProfile(wave.author_id)}
          className="flex items-center gap-2 mb-2"
        >
          <span className="text-white font-bold text-base">
            @{wave.author_username || wave.author_name?.toLowerCase().replace(/\s+/g, '')}
          </span>
          {wave.author_verified && (
            <span className="text-blue-400 text-sm">✓</span>
          )}
        </button>
        
        {/* Caption */}
        {wave.caption && (
          <p className="text-white text-sm line-clamp-2 mb-2">
            {wave.caption}
          </p>
        )}
        
        {/* Location */}
        {wave.location && (
          <div className="flex items-center gap-1 text-white/80 text-xs">
            <MapPin className="w-3 h-3" />
            <span>{wave.location}</span>
          </div>
        )}
        
        {/* Duration badge */}
        {wave.video_duration && (
          <div className="absolute right-0 bottom-0 bg-black/50 px-2 py-0.5 rounded text-white text-xs">
            {formatDuration(wave.video_duration)}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * WavesFeed - Main feed container with swipe navigation
 */
export const WavesFeed = ({ feedType = 'for_you', onCreateWave }) => {
  const { user } = useAuth();
  const { _theme } = useTheme();
  const navigate = useNavigate();
  
  const [waves, setWaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const containerRef = useRef(null);
  
  // Fetch waves
  const fetchWaves = useCallback(async (reset = false) => {
    try {
      const offset = reset ? 0 : waves.length;
      const response = await apiClient.get(`/waves`, {
        params: {
          user_id: user?.id,
          feed_type: feedType,
          limit: 10,
          offset
        }
      });
      
      if (reset) {
        setWaves(response.data.waves);
      } else {
        setWaves(prev => [...prev, ...response.data.waves]);
      }
      setHasMore(response.data.has_more);
    } catch (error) {
      console.error('Failed to fetch waves:', error);
      toast.error('Failed to load waves');
    } finally {
      setLoading(false);
    }
  }, [user?.id, feedType, waves.length]);
  
  useEffect(() => {
    fetchWaves(true);
  }, [feedType]);
  
  // Handle scroll/swipe
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    
    const container = containerRef.current;
    const scrollTop = container.scrollTop;
    const itemHeight = container.clientHeight;
    const newIndex = Math.round(scrollTop / itemHeight);
    
    if (newIndex !== currentIndex) {
      setCurrentIndex(newIndex);
      
      // Load more when near end
      if (newIndex >= waves.length - 3 && hasMore && !loading) {
        fetchWaves();
      }
    }
  }, [currentIndex, waves.length, hasMore, loading, fetchWaves]);
  
  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        scrollToIndex(Math.min(currentIndex + 1, waves.length - 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        scrollToIndex(Math.max(currentIndex - 1, 0));
      } else if (e.key === 'm') {
        setIsMuted(prev => !prev);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, waves.length]);
  
  const scrollToIndex = (index) => {
    if (containerRef.current) {
      const itemHeight = containerRef.current.clientHeight;
      containerRef.current.scrollTo({
        top: index * itemHeight,
        behavior: 'smooth'
      });
    }
  };
  
  const handleLike = async (waveId) => {
    if (!user) {
      toast.error('Please log in to like');
      return;
    }
    
    try {
      await apiClient.post(`/posts/${waveId}/like?user_id=${user.id}`);
    } catch (error) {
      console.error('Failed to like:', error);
    }
  };
  
  const handleComment = (wave) => {
    // Navigate to post detail with comments
    navigate(`/feed?post=${wave.id}`);
  };
  
  const handleShare = async (wave) => {
    const shareUrl = `${window.location.origin}/wave/${wave.id}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Wave by @${wave.author_username || wave.author_name}`,
          text: wave.caption || 'Check out this wave!',
          url: shareUrl
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          copyToClipboard(shareUrl);
        }
      }
    } else {
      copyToClipboard(shareUrl);
    }
  };
  
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Link copied!');
  };
  
  const handleViewProfile = (authorId) => {
    navigate(`/profile/${authorId}`);
  };
  
  if (loading && waves.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-black">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }
  
  if (waves.length === 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-black text-white p-6 text-center">
        <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
          <Play className="w-10 h-10 text-zinc-500" />
        </div>
        <h3 className="text-xl font-bold mb-2">No Waves Yet</h3>
        <p className="text-zinc-400 mb-6">Be the first to share a Wave!</p>
        <Button
          onClick={() => {
            if (onCreateWave) {
              onCreateWave();
            } else {
              toast.error('Unable to create wave from here.');
            }
          }}
          className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white"
          data-testid="create-first-wave-btn"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Wave
        </Button>
      </div>
    );
  }
  
  return (
    <div 
      ref={containerRef}
      className="h-full w-full overflow-y-scroll snap-y snap-mandatory scrollbar-hide"
      onScroll={handleScroll}
      data-testid="waves-feed-container"
    >
      {waves.map((wave, index) => (
        <div 
          key={wave.id} 
          className="h-full w-full"
          style={{ scrollSnapAlign: 'start' }}
        >
          <WaveCard
            wave={wave}
            isActive={index === currentIndex}
            isMuted={isMuted}
            onToggleMute={() => setIsMuted(prev => !prev)}
            onLike={handleLike}
            onComment={handleComment}
            onShare={handleShare}
            onViewProfile={handleViewProfile}
            userId={user?.id}
          />
        </div>
      ))}
      
      {/* Loading indicator at bottom */}
      {loading && waves.length > 0 && (
        <div className="h-20 flex items-center justify-center bg-black">
          <Loader2 className="w-6 h-6 text-white animate-spin" />
        </div>
      )}
      
      {/* Navigation hints */}
      <div className="fixed right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-20 pointer-events-none opacity-50">
        {currentIndex > 0 && (
          <ChevronUp className="w-6 h-6 text-white animate-bounce" />
        )}
        {currentIndex < waves.length - 1 && (
          <ChevronDown className="w-6 h-6 text-white animate-bounce" />
        )}
      </div>
    </div>
  );
};

export default WavesFeed;
