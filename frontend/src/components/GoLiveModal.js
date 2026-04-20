import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Radio, Clock, Mic, MicOff, Camera, CameraOff, Loader2, AlertTriangle,
  RefreshCw, MessageCircle, Heart, Send, X, Sparkles, Sun, Contrast,
  Share2, Eye, Wifi, WifiOff, ChevronUp, ChevronDown, Droplets, Thermometer,
  CircleDot, Sunset, Waves, Film, RotateCcw, Power, Zap, Moon, Grid,
  Signal, SignalHigh, SignalLow, SignalMedium, Play, ArrowLeft, ChevronRight,
  Info, TrendingUp, Award, Star, Scissors
} from 'lucide-react';
import { Button } from './ui/button';

import { Input } from './ui/input';

import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import apiClient, { BACKEND_URL } from '../lib/apiClient';

import { toast } from 'sonner';

import { motion, AnimatePresence } from 'framer-motion';

import {
  LiveKitRoom,
  VideoTrack,
  useLocalParticipant,
  useTracks,
  RoomAudioRenderer,
  useConnectionState,
} from '@livekit/components-react';
import { WebGLBroadcastController } from './WebGLBroadcastController';

import '@livekit/components-styles';

import { Track, ConnectionState } from 'livekit-client';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import { HairFilterEngine } from '../utils/HairFilterEngine';
import { HairFilterPicker } from './HairFilterPicker';


const API = process.env.REACT_APP_BACKEND_URL + '/api';

/**
 * Connection Quality Indicator Component
 */
const ConnectionQualityBadge = ({ state, quality }) => {
  // quality: 'excellent' | 'good' | 'poor' | 'unknown'
  const getConnectionInfo = () => {
    if (quality === 'poor') {
      return { icon: SignalLow, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Poor Signal' };
    }
    if (quality === 'good') {
      return { icon: SignalMedium, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Good' };
    }
    if (quality === 'excellent') {
      return { icon: SignalHigh, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Excellent' };
    }
    switch (state) {
      case ConnectionState.Connected:
        return { icon: Wifi, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Connected' };
      case ConnectionState.Connecting:
        return { icon: Wifi, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Connecting...' };
      case ConnectionState.Reconnecting:
        return { icon: Wifi, color: 'text-orange-400', bg: 'bg-orange-500/20', label: 'Reconnecting...' };
      case ConnectionState.Disconnected:
        return { icon: WifiOff, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Disconnected' };
      default:
        return { icon: Signal, color: 'text-gray-400', bg: 'bg-gray-500/20', label: 'Checking...' };
    }
  };
  
  const info = getConnectionInfo();
  const Icon = info.icon;
  
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${info.bg}`}
    >
      <Icon className={`w-3 h-3 ${info.color}`} />
      <span className={`text-xs font-medium ${info.color}`}>{info.label}</span>
    </motion.div>
  );
};

/**
 * Theme-aware color system using CSS variables
 * Maps to existing Raw Surf theme engine - NO hardcoded hex values
 */
const getThemeColors = (theme) => {
  return {
    // Overlay backgrounds - semi-transparent
    overlayBg: theme === 'light' 
      ? 'bg-white/70 backdrop-blur-md' 
      : theme === 'beach'
        ? 'bg-amber-900/60 backdrop-blur-md'
        : 'bg-zinc-900/70 backdrop-blur-md',
    
    // Text colors
    primaryText: theme === 'light' ? 'text-slate-900' : 'text-white',
    secondaryText: theme === 'light' ? 'text-slate-600' : theme === 'beach' ? 'text-amber-100' : 'text-zinc-400',
    
    // Action/Accent colors (theme-specific highlights)
    accentBg: theme === 'light' 
      ? 'bg-blue-500' 
      : theme === 'beach' 
        ? 'bg-orange-500' 
        : 'bg-cyan-500',
    accentText: theme === 'light' ? 'text-blue-500' : theme === 'beach' ? 'text-orange-400' : 'text-cyan-400',
    
    // Button styles
    buttonBg: theme === 'light' 
      ? 'bg-slate-200 hover:bg-slate-300' 
      : theme === 'beach'
        ? 'bg-amber-800/50 hover:bg-amber-700/50'
        : 'bg-white/20 hover:bg-white/30',
    
    // Comment tile backgrounds
    commentBg: theme === 'light' 
      ? 'bg-white/90' 
      : theme === 'beach'
        ? 'bg-amber-900/80'
        : 'bg-zinc-800/90',
    
    // Border colors
    border: theme === 'light' ? 'border-slate-200' : theme === 'beach' ? 'border-amber-700/50' : 'border-zinc-700',
    
    // Gradient for top/bottom overlays
    gradientTop: theme === 'light'
      ? 'from-white/90 via-white/50 to-transparent'
      : theme === 'beach'
        ? 'from-amber-950/90 via-amber-950/50 to-transparent'
        : 'from-black/90 via-black/50 to-transparent',
    gradientBottom: theme === 'light'
      ? 'from-transparent via-white/50 to-white/90'
      : theme === 'beach'
        ? 'from-transparent via-amber-950/50 to-amber-950/90'
        : 'from-transparent via-black/50 to-black/90',
    
    // Slider/filter panel colors
    sliderBg: theme === 'light' ? 'bg-slate-300' : theme === 'beach' ? 'bg-amber-700' : 'bg-zinc-600',
    sliderThumb: theme === 'light' ? 'bg-blue-500' : theme === 'beach' ? 'bg-orange-400' : 'bg-cyan-400',
  };
};

/**
 * Video Filter Panel - Surfer-optimized filters
 * Positioned on LEFT side to avoid collision with controls
 */
const VideoFilterPanel = ({ isOpen, onClose, filters, onFilterChange, onPresetSelect, colors }) => {
  if (!isOpen) return null;
  
  // Surfer-specific AI Filter presets
  const presets = [
    { 
      name: 'None', 
      icon: CircleDot,
      values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0 },
      description: 'Original camera'
    },
    { 
      name: 'AI Night Vision', 
      icon: Eye,
      values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0 },
      description: 'Tactical green overlay'
    },
    { 
      name: 'AI Pixelate', 
      icon: Grid,
      values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0 },
      description: 'Retro 8-bit aesthetic'
    },
    { 
      name: 'Golden Hour', 
      icon: Sunset,
      values: { brightness: 105, contrast: 110, saturation: 120, warmth: 120, vignette: 20 },
      description: 'Warm sunset vibes'
    },
    { 
      name: 'AI Pipeline', 
      icon: Waves,
      values: { brightness: 90, contrast: 130, saturation: 90, warmth: 110, vignette: 40 },
      description: 'Deep barrel shadows'
    },
    { 
      name: 'AI Bio-Lum', 
      icon: Moon,
      values: { brightness: 85, contrast: 140, saturation: 150, warmth: 160, vignette: 30 },
      description: 'Neon glowing night surf'
    },
    { 
      name: 'AI Cyber-Surf', 
      icon: Zap,
      values: { brightness: 110, contrast: 125, saturation: 140, warmth: 40, vignette: 0 },
      description: 'Hyper-performance cold lens'
    },
  ];
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={`absolute left-3 top-24 w-64 max-h-[55vh] overflow-y-auto p-3 rounded-2xl ${colors.overlayBg} ${colors.border} border z-50`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className={`w-4 h-4 ${colors.accentText}`} />
          <span className={`text-sm font-medium ${colors.primaryText}`}>Surf Filters</span>
        </div>
        <button onClick={onClose} className={`p-1.5 rounded-full ${colors.buttonBg}`}>
          <X className={`w-4 h-4 ${colors.secondaryText}`} />
        </button>
      </div>
      
      {/* Preset Buttons */}
      <div className="mb-3 space-y-1.5">
        <span className={`text-xs font-medium ${colors.secondaryText}`}>Quick Presets</span>
        <div className="grid grid-cols-3 gap-1.5">
          {presets.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
                key={preset.name}
                onClick={() => onPresetSelect(preset)}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg ${colors.buttonBg} hover:scale-105 transition-transform`}
                title={preset.description}
              >
                <Icon className={`w-4 h-4 ${colors.accentText}`} />
                <span className={`text-[9px] ${colors.primaryText} text-center leading-tight`}>{preset.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      
      {/* Brightness */}
      <div className="mb-2.5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Sun className={`w-3 h-3 ${colors.secondaryText}`} />
            <span className={`text-xs ${colors.secondaryText}`}>Brightness</span>
          </div>
          <span className={`text-xs ${colors.primaryText}`}>{filters.brightness}%</span>
        </div>
        <input
          type="range"
          min="50"
          max="150"
          value={filters.brightness}
          onChange={(e) => onFilterChange('brightness', parseInt(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-cyan-500"
        />
      </div>
      
      {/* Contrast */}
      <div className="mb-2.5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Contrast className={`w-3 h-3 ${colors.secondaryText}`} />
            <span className={`text-xs ${colors.secondaryText}`}>Contrast</span>
          </div>
          <span className={`text-xs ${colors.primaryText}`}>{filters.contrast}%</span>
        </div>
        <input
          type="range"
          min="50"
          max="150"
          value={filters.contrast}
          onChange={(e) => onFilterChange('contrast', parseInt(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-cyan-500"
        />
      </div>
      
      {/* Saturation */}
      <div className="mb-2.5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Droplets className={`w-3 h-3 ${colors.secondaryText}`} />
            <span className={`text-xs ${colors.secondaryText}`}>Saturation</span>
          </div>
          <span className={`text-xs ${colors.primaryText}`}>{filters.saturation}%</span>
        </div>
        <input
          type="range"
          min="50"
          max="150"
          value={filters.saturation}
          onChange={(e) => onFilterChange('saturation', parseInt(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-cyan-500"
        />
      </div>
      
      {/* Warmth */}
      <div className="mb-2.5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Thermometer className={`w-3 h-3 ${colors.secondaryText}`} />
            <span className={`text-xs ${colors.secondaryText}`}>Warmth</span>
          </div>
          <span className={`text-xs ${colors.primaryText}`}>{filters.warmth}%</span>
        </div>
        <input
          type="range"
          min="50"
          max="150"
          value={filters.warmth}
          onChange={(e) => onFilterChange('warmth', parseInt(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-cyan-500"
        />
      </div>
      
      {/* Vignette */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <CircleDot className={`w-3 h-3 ${colors.secondaryText}`} />
            <span className={`text-xs ${colors.secondaryText}`}>Vignette</span>
          </div>
          <span className={`text-xs ${colors.primaryText}`}>{filters.vignette}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="50"
          value={filters.vignette}
          onChange={(e) => onFilterChange('vignette', parseInt(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-cyan-500"
        />
      </div>
      
      {/* Reset Button */}
      <Button
        onClick={() => {
          onFilterChange('brightness', 100);
          onFilterChange('contrast', 100);
          onFilterChange('saturation', 100);
          onFilterChange('warmth', 100);
          onFilterChange('vignette', 0);
        }}
        size="sm"
        variant="outline"
        className={`w-full ${colors.buttonBg} ${colors.primaryText}`}
      >
        <RotateCcw className="w-3 h-3 mr-2" />
        Reset All
      </Button>
    </motion.div>
  );
};

/**
 * Emoji Burst Animation - Instagram/TikTok style floating emoji burst
 * Emojis float upward in a slight random arc, fade at top
 */
const EmojiBurst = ({ emoji, x, y, theme, id }) => {
  // Slight random horizontal drift so emojis don't stack
  const drift = useMemo(() => (Math.random() - 0.5) * 60, []);
  const glowClass = theme === 'dark' ? 'drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]'
    : theme === 'beach' ? 'drop-shadow-[0_0_8px_rgba(251,146,60,0.7)]'
    : 'drop-shadow-md';

  return (
    <motion.div
      key={id}
      initial={{ opacity: 1, scale: 0.6, y: 0, x: 0 }}
      animate={{ opacity: 0, scale: 1.8, y: -140, x: drift }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
      className={`absolute text-4xl ${glowClass} pointer-events-none select-none z-50`}
      style={{ left: x, top: y }}
    >
      {emoji}
    </motion.div>
  );
};

/**
 * Live Comment Tile - Theme-aware styling with likes
 */
const CommentTile = React.memo(({ comment, colors, onReply, onLike, currentUserId }) => {
  const [liked, setLiked] = useState(comment.liked_by?.includes(currentUserId) || false);
  const [likeCount, setLikeCount] = useState(comment.likes || 0);
  
  const handleLike = async () => {
    const wasLiked = liked;
    setLiked(!liked);
    setLikeCount(prev => wasLiked ? prev - 1 : prev + 1);
    
    try {
      await onLike(comment.id, !wasLiked);
    } catch {
      // Revert on error
      setLiked(wasLiked);
      setLikeCount(prev => wasLiked ? prev + 1 : prev - 1);
    }
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className={`flex items-start gap-2 p-2 rounded-xl ${colors.commentBg} ${colors.border} border`}
    >
      <Avatar className="w-8 h-8 flex-shrink-0">
        <AvatarImage src={getFullUrl(comment.avatar_url)} />
        <AvatarFallback className="bg-zinc-600 text-xs text-white">
          {comment.user_name?.[0] || '?'}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <span className={`text-xs font-semibold ${colors.accentText}`}>
          {comment.user_name}
        </span>
        <p className={`text-sm ${colors.primaryText} break-words`}>
          {comment.text}
        </p>
        {/* Like count display */}
        {likeCount > 0 && (
          <span className={`text-[10px] ${colors.secondaryText}`}>
            {likeCount} {likeCount === 1 ? 'like' : 'likes'}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {/* Like button */}
        <button 
          onClick={handleLike}
          className={`p-1 rounded-full ${colors.buttonBg} transition-all ${liked ? 'scale-110' : 'opacity-60 hover:opacity-100'}`}
        >
          <Heart className={`w-3 h-3 ${liked ? 'text-red-500 fill-red-500' : colors.secondaryText}`} />
        </button>
        {/* Reply button */}
        <button 
          onClick={() => onReply(comment)}
          className={`p-1 rounded-full ${colors.buttonBg} opacity-60 hover:opacity-100`}
        >
          <MessageCircle className={`w-3 h-3 ${colors.secondaryText}`} />
        </button>
      </div>
    </motion.div>
  );
});

/**
 * Live Comments Feed - Real-time with delta sync
 * Broadcaster can comment and reply, viewers can like comments
 */
const LiveCommentsFeed = ({ streamId, colors, onSendComment, onLikeComment, isExpanded, onToggleExpand, currentUserId }) => {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const commentsRef = useRef(null);
  const lastFetchRef = useRef(Date.now());
  
  // Delta sync - only fetch new comments since last fetch
  useEffect(() => {
    if (!streamId) return;
    
    const fetchComments = async () => {
      try {
        const response = await apiClient.get(`/social-live/${streamId}/comments`);
        if (response.data?.comments) {
          // Lightweight update check — compare length + latest ID instead of full JSON serialize
          setComments(prev => {
            const newComments = response.data.comments;
            const lastPrevId = prev.length > 0 ? prev[prev.length - 1]?.id : null;
            const lastNewId = newComments.length > 0 ? newComments[newComments.length - 1]?.id : null;
            if (prev.length !== newComments.length || lastPrevId !== lastNewId) {
              return newComments;
            }
            return prev;
          });
          lastFetchRef.current = Date.now();
        }
      } catch (err) {
        // Silent fail
      }
    };

    fetchComments();
    const interval = setInterval(fetchComments, 2000);
    return () => clearInterval(interval);
  }, [streamId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (commentsRef.current) {
      commentsRef.current.scrollTop = commentsRef.current.scrollHeight;
    }
  }, [comments]);

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!newComment.trim() || sending) return;
    
    setSending(true);
    const text = replyingTo 
      ? `@${replyingTo.user_name} ${newComment.trim()}`
      : newComment.trim();
    
    try {
      await onSendComment(text);
      setNewComment('');
      setReplyingTo(null);
    } catch (err) {
      // Error already handled in onSendComment
      console.error('Comment send error:', err);
    } finally {
      setSending(false);
    }
  };

  const handleReply = (comment) => {
    setReplyingTo(comment);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: isExpanded ? '100%' : 'auto', overflow: 'hidden', background: 'rgba(9,9,11,0.92)', backdropFilter: 'blur(12px)' }}>
      {/* Header — Live pulse + count */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(39,39,42,0.8)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Animated live pulse dot */}
          <div style={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
            <div className="animate-ping" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#f59e0b', opacity: 0.6 }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#f59e0b' }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>LIVE CHAT</span>
          <span style={{ fontSize: 11, color: '#71717a', background: 'rgba(39,39,42,0.7)', padding: '1px 6px', borderRadius: 8 }}>{comments.length}</span>
        </div>
        <button onClick={onToggleExpand} className={`sm:hidden p-1.5 rounded-lg ${colors.buttonBg} transition-colors`}>
          {isExpanded ? <ChevronDown className={`w-4 h-4 ${colors.secondaryText}`} /> : <ChevronUp className={`w-4 h-4 ${colors.secondaryText}`} />}
        </button>
      </div>

      {isExpanded && (
        <>
          {/* Comments list - flex-1 fills all remaining height */}
          <div
            ref={commentsRef}
            style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}
          >
            <AnimatePresence mode="popLayout">
              {comments.slice(-50).map((comment) => (
                <CommentTile
                  key={comment.id}
                  comment={comment}
                  colors={colors}
                  onReply={handleReply}
                  onLike={onLikeComment}
                  currentUserId={currentUserId}
                />
              ))}
            </AnimatePresence>

            {comments.length === 0 && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#52525b' }}>
                <MessageCircle style={{ width: 28, height: 28, opacity: 0.3, marginBottom: 8 }} />
                <p style={{ fontSize: 13, margin: 0 }}>No comments yet</p>
                <p style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>Be the first to say something!</p>
              </div>
            )}
          </div>

          {/* Reply indicator */}
          <AnimatePresence>
            {replyingTo && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                style={{ padding: '6px 12px', borderTop: '1px solid #27272a', background: '#18181b', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
              >
                <span className={`text-xs ${colors.secondaryText}`}>Replying to</span>
                <span className={`text-xs font-semibold ${colors.accentText}`}>@{replyingTo.user_name}</span>
                <button onClick={() => setReplyingTo(null)} className="ml-auto">
                  <X className={`w-3 h-3 ${colors.secondaryText}`} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input - pinned to bottom */}
          <form onSubmit={handleSend} style={{ padding: '10px 12px', borderTop: '1px solid #27272a', background: '#09090b', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder={replyingTo ? `Reply to @${replyingTo.user_name}...` : 'Say something...'}
                className={`flex-1 h-9 text-sm bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500`}
                maxLength={200}
                disabled={sending}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!newComment.trim() || sending}
                className={`${colors.accentBg} text-white h-9 px-3`}
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
};

/**
 * Quick Reaction Buttons - Surf-themed emoji reactions with haptic burst animation
 * Best practice: keep to 6 reactions max, most-used first (Instagram Live pattern)
 */
const QuickReactions = ({ onReact, colors }) => {
  const reactions = [
    { emoji: '🤙', label: 'shaka' },
    { emoji: '🌊', label: 'wave' },
    { emoji: '🔥', label: 'fire' },
    { emoji: '❤️', label: 'love' },
    { emoji: '🏄', label: 'surf' },
    { emoji: '😮', label: 'wow' },
  ];

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full ${colors.overlayBg} backdrop-blur-md border ${colors.border}`}>
      {reactions.map(({ emoji, label }) => (
        <button
          key={emoji}
          onClick={() => onReact(emoji)}
          aria-label={label}
          className="text-lg sm:text-xl hover:scale-130 transition-all duration-150 active:scale-90 p-1 rounded-full hover:bg-white/10"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
};

/**
 * End Stream Confirmation Dialog - Theme-aware
 */
const EndStreamDialog = ({ isOpen, onConfirm, onCancel, duration, colors }) => {
  if (!isOpen) return null;

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={`${colors.overlayBg} ${colors.border} border rounded-2xl p-6 max-w-sm mx-4`}
      >
        <div className="flex items-center justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
        </div>
        
        <h3 className={`${colors.primaryText} text-xl font-bold text-center mb-2`}>
          End Live Stream?
        </h3>
        
        <p className={`${colors.secondaryText} text-center mb-4`}>
          You've been live for <span className={`${colors.primaryText} font-semibold`}>{formatDuration(duration)}</span>. 
          Are you sure you want to end your broadcast?
        </p>
        
        <div className="flex gap-3">
          <Button
            onClick={onCancel}
            variant="outline"
            className={`flex-1 ${colors.border} ${colors.primaryText} ${colors.buttonBg}`}
          >
            Keep Streaming
          </Button>
          <Button
            onClick={onConfirm}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold"
          >
            End Live
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

/**
 * Broadcaster Controls Component - Main broadcasting interface
 * Modern features: Connection quality, surfer video filters, comment likes
 */
const BroadcasterControls = ({ 
  _onEnd, 
  onEndRequest, 
  streamDuration, 
  viewerCount,
  streamId,
  userId,
  userName,
  userAvatar
}) => {
  const { theme } = useTheme();
  const colors = useMemo(() => getThemeColors(theme), [theme]);
  
  const { localParticipant } = useLocalParticipant();
  const connectionState = useConnectionState();
  
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [showComments, _setShowComments] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(true); // Desktop sidebar toggle
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [emojiBursts, setEmojiBursts] = useState([]);
  const [likeCount, setLikeCount] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [showHairPicker, setShowHairPicker] = useState(false);
  const [activeHairStyle, setActiveHairStyle] = useState(null);
  const [videoFilters, setVideoFilters] = useState({ 
    brightness: 100, 
    contrast: 100,
    saturation: 100,
    warmth: 100,
    vignette: 0
  });
  
  const videoRef = useRef(null);
  const hairCanvasRef = useRef(null);
  const hairEngineRef = useRef(null);

  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const _localVideoTrack = tracks.find(t => t.participant?.isLocal);

  const toggleMute = async () => {
    if (localParticipant) {
      await localParticipant.setMicrophoneEnabled(isMuted);
      setIsMuted(!isMuted);
    }
  };

  const toggleCamera = async () => {
    if (localParticipant) {
      await localParticipant.setCameraEnabled(isCameraOff);
      setIsCameraOff(!isCameraOff);
    }
  };

  const flipCamera = async () => {
    if (localParticipant) {
      try {
        const newFacingMode = isFrontCamera ? 'environment' : 'user';
        
        // Stop current camera, then re-enable with new facing mode
        // This is more reliable on mobile than restartTrack
        await localParticipant.setCameraEnabled(false);
        
        // Small delay to let hardware release
        await new Promise(r => setTimeout(r, 300));
        
        await localParticipant.setCameraEnabled(true, {
          facingMode: newFacingMode,
        });
        
        setIsFrontCamera(!isFrontCamera);
        toast.success(isFrontCamera ? 'Switched to back camera' : 'Switched to front camera');
      } catch (err) {
        logger.error('Failed to flip camera:', err);
        // Try fallback: just re-enable camera without specifying facing mode
        try {
          await localParticipant.setCameraEnabled(true);
        } catch { /* silent */ }
        toast.error('Camera switch not supported on this device');
      }
    }
  };

  const handleFilterChange = useCallback((filter, value) => {
    setVideoFilters(prev => ({ ...prev, [filter]: value }));
  }, []);

  // Apply preset filter values mapping directly to WebGL state string bounds
  const handlePresetSelect = useCallback((preset) => {
    setVideoFilters({
      ...preset.values,
      presetName: preset.name
    });
    setShowFilters(false); // Auto-close panel on selection
    toast.success('AI Filter applied!');
  }, []);

  // Handle comment likes
  const handleLikeComment = useCallback(async (commentId, isLiked) => {
    await apiClient.post(`/social-live/${streamId}/comments/${commentId}/like`, {
      user_id: userId,
      liked: isLiked
    });
    // Throws on error so CommentTile can revert the optimistic update
  }, [streamId, userId]);

  const handleReaction = useCallback((emoji) => {
    // Add emoji burst animation
    const id = Date.now();
    const x = Math.random() * 100 + 100; // Random x position
    const y = window.innerHeight - 200;
    
    setEmojiBursts(prev => [...prev, { id, emoji, x, y }]);
    setLikeCount(prev => prev + 1);
    
    // Remove after animation
    setTimeout(() => {
      setEmojiBursts(prev => prev.filter(b => b.id !== id));
    }, 1500);
  }, []);

  // ── Hair Filter Engine lifecycle ──
  useEffect(() => {
    const engine = new HairFilterEngine();
    hairEngineRef.current = engine;
    engine.init().catch(() => {});
    
    return () => {
      engine.dispose();
      hairEngineRef.current = null;
    };
  }, []);
  
  // Start/stop hair engine when video element changes or camera toggles
  useEffect(() => {
    const engine = hairEngineRef.current;
    if (!engine) return;
    
    if (isCameraOff) {
      engine.stop();
      return;
    }
    
    // Find the video element inside the ref container
    const videoContainer = videoRef.current;
    if (!videoContainer) return;
    
    // Retry finding video element (LiveKit may render it async)
    const tryStart = () => {
      const videoEl = videoContainer.querySelector('video');
      const canvasEl = hairCanvasRef.current;
      
      if (videoEl && canvasEl && videoEl.readyState >= 1) {
        engine.start(videoEl, canvasEl); // start() now awaits init internally
        return true;
      }
      return false;
    };
    
    // Try immediately, then retry a few times
    if (!tryStart()) {
      const timer = setInterval(() => {
        if (tryStart()) clearInterval(timer);
      }, 500);
      
      // Give up after 5 seconds
      const timeout = setTimeout(() => clearInterval(timer), 5000);
      return () => { clearInterval(timer); clearTimeout(timeout); engine.stop(); };
    }
    
    return () => { engine.stop(); };
  }, [isCameraOff, connectionState]);
  
  // Update hair style when selection changes
  useEffect(() => {
    const engine = hairEngineRef.current;
    if (engine) {
      engine.setHairStyle(activeHairStyle);
    }
  }, [activeHairStyle]);
  
  const handleSelectHairStyle = useCallback((styleId) => {
    setActiveHairStyle(styleId);
    setShowHairPicker(false); // Auto-close picker on selection
    if (styleId) {
      toast.success('Hair filter applied! 💇');
    }
  }, []);

  const handleSendComment = useCallback(async (text) => {
    logger.info('[GoLiveModal] Attempting to send comment, streamId:', streamId, 'userName:', userName);
    if (!streamId) {
      logger.error('[GoLiveModal] No streamId available');
      toast.error('Stream not ready yet');
      return;
    }
    if (!userId) {
      logger.error('[GoLiveModal] No userId available');
      toast.error('Not logged in');
      return;
    }
    try {
      const response = await apiClient.post(`/social-live/${streamId}/comments`, {
        user_id: userId,
        user_name: userName || 'You',
        avatar_url: userAvatar || '',
        text
      });
      logger.info('[GoLiveModal] Comment sent successfully:', response.data);
    } catch (err) {
      logger.error('[GoLiveModal] Failed to send comment:', err.response?.data || err.message);
      toast.error('Failed to send comment');
    }
  }, [streamId, userId, userName, userAvatar]);

  const handleShare = useCallback(async () => {
    const shareUrl = `${window.location.origin}/live/${streamId}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${userName} is LIVE!`,
          text: 'Watch my live stream on Raw Surf',
          url: shareUrl
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          toast.error('Failed to share');
        }
      }
    } else {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success('Stream link copied!');
      } catch {
        toast.error('Failed to copy link');
      }
    }
  }, [streamId, userName]);

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // CSS filter styles for video - includes all surfer-specific filters
  const videoFilterStyle = useMemo(() => {
    // Calculate AI mapping: warmth controls hue-rotate shift aggressively
    let warmthDegrees = (videoFilters.warmth - 100) * 0.8;
    
    // Extreme overrides for AI Lenses (if warmth is pushed to max/min limits, it triggers hyper-neon shifts)
    if (videoFilters.warmth >= 150) warmthDegrees = 300; // Neon blue/purple (AI Bioluminescence)
    if (videoFilters.warmth <= 50) warmthDegrees = 180; // Negative inversion vibe (Cyber)
    
    return {
      filter: `brightness(${videoFilters.brightness}%) contrast(${videoFilters.contrast}%) saturate(${videoFilters.saturation}%) hue-rotate(${warmthDegrees}deg)`,
      position: 'relative'
    };
  }, [videoFilters]);

  // Vignette overlay style
  const vignetteStyle = useMemo(() => {
    if (videoFilters.vignette === 0) return null;
    return {
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      background: `radial-gradient(circle, transparent ${100 - videoFilters.vignette}%, rgba(0,0,0,${videoFilters.vignette / 100}) 100%)`
    };
  }, [videoFilters.vignette]);

  return (
    <div className="w-full h-full flex flex-col sm:flex-row overflow-hidden" data-theme={theme}>
      {/* ── Main Video Section ── */}
      <div className="flex-1 relative bg-black flex flex-col min-w-0">
        {/* Actual Video */}
        <div className="flex-1 relative overflow-hidden">
          {!isCameraOff ? (
            <div ref={videoRef} className="w-full h-full relative" style={videoFilterStyle}>
              <WebGLBroadcastController 
                activeFilter={videoFilters.presetName || 'none'}
                isCameraOff={isCameraOff}
                isFrontCamera={isFrontCamera}
              />
              {/* Hair filter canvas overlay — matches WebGL canvas: video-resolution buffer + object-cover + mirror */}
              <canvas
                ref={hairCanvasRef}
                className={`absolute inset-0 w-full h-full object-cover pointer-events-none ${isFrontCamera ? 'scale-x-[-1]' : ''}`}
                style={{ zIndex: 5 }}
              />
              {/* Vignette overlay */}
              {vignetteStyle && <div style={vignetteStyle} />}
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-900">
              <CameraOff className="w-20 h-20 text-zinc-600" />
            </div>
          )}

          {/* Emoji burst animations */}
          <AnimatePresence>
            {emojiBursts.map(burst => (
              <EmojiBurst key={burst.id} {...burst} theme={theme} />
            ))}
          </AnimatePresence>

          {/* Top bar - Overlaid ONLY on video */}
          <div className={`absolute top-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-b ${colors.gradientTop} safe-area-top z-10`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <div className="flex items-center gap-2 bg-red-600 px-3 py-1.5 rounded-full animate-pulse">
                  <Radio className="w-4 h-4 text-white" />
                  <span className="text-white font-bold text-sm">LIVE</span>
                </div>
                
                <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full ${colors.overlayBg}`}>
                  <Clock className={`w-3.5 h-3.5 ${colors.primaryText}`} />
                  <span className={`${colors.primaryText} font-mono text-sm`}>{formatDuration(streamDuration)}</span>
                </div>
                
                <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full ${colors.overlayBg}`}>
                  <Eye className={`w-3.5 h-3.5 ${colors.primaryText}`} />
                  <span className={`${colors.primaryText} text-sm`}>{viewerCount}</span>
                </div>
                
                <ConnectionQualityBadge state={connectionState} />
              </div>

              <div className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full ${colors.overlayBg}`}>
                  <Heart className={`w-3.5 h-3.5 text-red-500 ${likeCount > 0 ? 'fill-red-500' : ''}`} />
                  <span className={`${colors.primaryText} text-sm`}>{likeCount}</span>
                </div>
                
                {/* Desktop: Sidebar Toggle Button */}
                <button
                  onClick={() => setIsChatOpen(!isChatOpen)}
                  className={`hidden sm:flex p-2 rounded-full ${colors.overlayBg} ${isChatOpen ? colors.accentBg : ''} transition-all`}
                  title={isChatOpen ? "Close Chat" : "Open Chat"}
                >
                  <MessageCircle className={`w-4 h-4 ${isChatOpen ? 'text-white' : colors.primaryText}`} />
                </button>

                <button
                  onClick={handleShare}
                  className={`p-2 rounded-full ${colors.overlayBg} transition-transform active:scale-95`}
                  title="Share Stream"
                >
                  <Share2 className={`w-4 h-4 ${colors.primaryText}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Floating Side items - Filters/Camera Flip (Desktop & Mobile Matrix Shifted vertically) */}
          <div className="absolute right-3 top-1/4 sm:top-1/2 -translate-y-1/2 flex flex-col gap-3 z-10">
            <button
              onClick={flipCamera}
              className={`p-3 rounded-full ${colors.overlayBg} ${colors.border} border transition-all active:scale-95 shadow-md`}
              title="Flip Camera"
            >
              <RefreshCw className={`w-5 h-5 ${colors.primaryText}`} />
            </button>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-3 rounded-full ${colors.overlayBg} ${colors.border} border transition-all active:scale-95 shadow-md ${showFilters ? colors.accentBg : ''}`}
              title="Surf Filters"
            >
              <Sparkles className={`w-5 h-5 ${showFilters ? 'text-white' : colors.primaryText}`} />
            </button>

            <button
              onClick={() => setShowHairPicker(!showHairPicker)}
              className={`p-3 rounded-full ${colors.overlayBg} ${colors.border} border transition-all active:scale-95 shadow-md ${showHairPicker ? 'bg-yellow-500' : activeHairStyle ? 'bg-yellow-500/30 border-yellow-500/50' : ''}`}
              title="Hair Filters"
            >
              <Scissors className={`w-5 h-5 ${showHairPicker || activeHairStyle ? 'text-white' : colors.primaryText}`} />
            </button>
          </div>

          {/* Video Filter Panel */}
          <AnimatePresence>
            {showFilters && (
              <VideoFilterPanel
                isOpen={showFilters}
                onClose={() => setShowFilters(false)}
                filters={videoFilters}
                onFilterChange={handleFilterChange}
                onPresetSelect={handlePresetSelect}
                colors={colors}
              />
            )}
          </AnimatePresence>

          {/* Hair Filter Picker Panel */}
          <AnimatePresence>
            {showHairPicker && (
              <HairFilterPicker
                isOpen={showHairPicker}
                onClose={() => setShowHairPicker(false)}
                activeStyleId={activeHairStyle}
                onSelectHair={handleSelectHairStyle}
                colors={colors}
              />
            )}
          </AnimatePresence>
          
          {/* Reaction Overlay */}
          <div className="absolute bottom-[84px] left-4 z-10">
            <QuickReactions onReact={handleReaction} colors={colors} />
          </div>

          {/* ── BROADCASTER CONTROLS: float over video bottom ── */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 24px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 60%, transparent 100%)'
          }}>
            {/* Left: Mic + Camera */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={toggleMute}
                style={{ padding: 11, borderRadius: '50%', border: 'none', cursor: 'pointer', backdropFilter: 'blur(6px)', background: isMuted ? '#dc2626' : 'rgba(255,255,255,0.18)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <MicOff style={{ width: 20, height: 20 }} /> : <Mic style={{ width: 20, height: 20 }} />}
              </button>
              <button
                onClick={toggleCamera}
                style={{ padding: 11, borderRadius: '50%', border: 'none', cursor: 'pointer', backdropFilter: 'blur(6px)', background: isCameraOff ? '#dc2626' : 'rgba(255,255,255,0.18)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title={isCameraOff ? 'Camera On' : 'Camera Off'}
              >
                {isCameraOff ? <CameraOff style={{ width: 20, height: 20 }} /> : <Camera style={{ width: 20, height: 20 }} />}
              </button>
            </div>

            {/* Center: End Live */}
            <button
              onClick={onEndRequest}
              style={{ padding: '11px 28px', background: '#dc2626', color: '#fff', fontWeight: 700, fontSize: 15, borderRadius: 999, border: 'none', cursor: 'pointer', boxShadow: '0 4px 18px rgba(220,38,38,0.45)' }}
            >
              End Live
            </button>

            {/* Right: Status */}
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, textAlign: 'right', maxWidth: 110, margin: 0, lineHeight: 1.4 }}>
              {connectionState === ConnectionState.Connected
                ? (viewerCount > 0 ? `${viewerCount} watching` : 'Waiting for surfers...')
                : 'Connection issue'}
            </p>
          </div>
        </div>{/* end video+overlay area */}
      </div>{/* end video column */}

      {/* ── Desktop Sidebar: Live Chat ── */}
      <AnimatePresence>
        {isChatOpen && (
          <motion.div
            className="hidden sm:flex flex-col"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 310, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            style={{ height: '100%', background: '#09090b', borderLeft: '1px solid #27272a', flexShrink: 0, overflow: 'hidden' }}
          >
            <LiveCommentsFeed
              streamId={streamId}
              colors={colors}
              onSendComment={handleSendComment}
              onLikeComment={handleLikeComment}
              currentUserId={userId}
              isExpanded={true} // Always expanded in sidebar
              onToggleExpand={() => {}} // No toggle in sidebar
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile-only overlay elements */}
      <div className="sm:hidden absolute bottom-[140px] left-3 right-3 z-30 pointer-events-none">
        {showComments && (
          <div className="pointer-events-auto">
            <LiveCommentsFeed
              streamId={streamId}
              colors={colors}
              onSendComment={handleSendComment}
              onLikeComment={handleLikeComment}
              currentUserId={userId}
              isExpanded={commentsExpanded}
              onToggleExpand={() => setCommentsExpanded(!commentsExpanded)}
            />
          </div>
        )}
      </div>

      <RoomAudioRenderer />
    </div>
  );
};

/**
 * GoLiveModal - Full-screen live streaming with LiveKit
 * Phase machine: pre_live → countdown → live
 * No auto-start. User must explicitly press Go Live.
 */
const GoLiveModal = ({ isOpen, onClose, onStreamEnded }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const colors = useMemo(() => getThemeColors(theme), [theme]);
  
  // Phase state: 'pre_live' | 'countdown' | 'live'
  const [phase, setPhase] = useState('pre_live');
  const [streamTitle, setStreamTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [broadcasterToken, setBroadcasterToken] = useState(null);
  const [streamData, setStreamData] = useState(null);
  const [streamDuration, setStreamDuration] = useState(0);
  const [viewerCount, setViewerCount] = useState(0);
  const [showEndDialog, setShowEndDialog] = useState(false);
  const [_isConnected, setIsConnected] = useState(false);
  const [countdownValue, setCountdownValue] = useState(3);
  const [signalQuality, setSignalQuality] = useState('unknown'); // 'excellent'|'good'|'poor'|'unknown'
  const [cameraPreviewStream, setCameraPreviewStream] = useState(null);
  const previewVideoRef = useRef(null);
  
  const streamDurationRef = useRef(0);
  const durationIntervalRef = useRef(null);
  const viewerPollRef = useRef(null);
  const streamDataRef = useRef(null);
  const userIdRef = useRef(user?.id);

  useEffect(() => {
    streamDataRef.current = streamData;
  }, [streamData]);

  // Keep userIdRef in sync to avoid stale closure in cleanup
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  // ── Reset phase when modal opens/closes ──
  useEffect(() => {
    if (isOpen) {
      setPhase('pre_live');
      setError(null);
      setBroadcasterToken(null);
      setStreamData(null);
      setStreamDuration(0);
      setViewerCount(0);
      setCountdownValue(3);
      startCameraPreview();
      checkSignalQuality();
    } else {
      stopCameraPreview();
    }
    return () => {
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
      if (viewerPollRef.current) clearInterval(viewerPollRef.current);
      // Auto-teardown orphan stream if user force-closes while live
      if (streamDataRef.current?.id && userIdRef.current) {
        logger.info('[GoLiveModal] Unmount trapped active stream. Firing orphan teardown.');
        apiClient.post(`/livekit/end-stream/${streamDataRef.current.id}?broadcaster_id=${userIdRef.current}`).catch(() => {});
      }
    };
  }, [isOpen]);

  // ── Camera preview for pre-live screen ──
  const startCameraPreview = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      setCameraPreviewStream(stream);
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      logger.warn('[GoLiveModal] Camera preview unavailable:', err);
      // Not fatal — user may grant camera on actual go-live
    }
  }, []);

  const stopCameraPreview = useCallback(() => {
    setCameraPreviewStream(prev => {
      if (prev) prev.getTracks().forEach(t => t.stop());
      return null;
    });
  }, []);

  // Wire preview video element to stream when ref + stream are both ready
  useEffect(() => {
    if (previewVideoRef.current && cameraPreviewStream) {
      previewVideoRef.current.srcObject = cameraPreviewStream;
    }
  }, [cameraPreviewStream]);

  // ── Signal quality estimation via navigator.connection or RTT probe ──
  const checkSignalQuality = useCallback(async () => {
    setSignalQuality('unknown');
    try {
      // navigator.connection (Chrome/Android)
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) {
        const rtt = conn.rtt || 0;
        const downlink = conn.downlink || 10;
        if (rtt > 300 || downlink < 1) {
          setSignalQuality('poor');
        } else if (rtt > 100 || downlink < 5) {
          setSignalQuality('good');
        } else {
          setSignalQuality('excellent');
        }
        return;
      }
      // Fallback: time a small fetch
      const start = Date.now();
      await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/health`, { method: 'HEAD', cache: 'no-store' }).catch(() => {});
      const rtt = Date.now() - start;
      if (rtt > 500) setSignalQuality('poor');
      else if (rtt > 200) setSignalQuality('good');
      else setSignalQuality('excellent');
    } catch {
      setSignalQuality('unknown');
    }
  }, []);

  // ── Start stream (called after countdown) ──
  const startStream = useCallback(async () => {
    if (!user?.id) {
      setError('Please log in to go live');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      logger.info('[GoLiveModal] Starting social live stream...');
      
      const response = await apiClient.post(`/livekit/start-social-live`, {
        broadcaster_id: user.id,
        broadcaster_name: user.full_name || user.username || 'Broadcaster',
        title: streamTitle || undefined
      });

      logger.info('[GoLiveModal] Stream started:', response.data);

      // Stop camera preview — LiveKit will take over camera
      stopCameraPreview();

      setBroadcasterToken({
        token: response.data.token,
        server_url: response.data.server_url
      });
      
      setStreamData({
        id: response.data.stream_id,
        room_name: response.data.room_name
      });

      // Duration timer
      streamDurationRef.current = 0;
      durationIntervalRef.current = setInterval(() => {
        streamDurationRef.current += 1;
        setStreamDuration(streamDurationRef.current);
      }, 1000);

      // Viewer count polling
      viewerPollRef.current = setInterval(async () => {
        try {
          const activeStreams = await apiClient.get(`/livekit/active-streams`);
          const myStream = activeStreams.data.streams?.find(
            s => s.room_name === response.data.room_name
          );
          if (myStream) setViewerCount(myStream.viewer_count);
        } catch (e) { /* non-critical */ }
      }, 5000);

      setPhase('live');

    } catch (err) {
      logger.error('[GoLiveModal] Failed to start stream:', err);
      setError(err.response?.data?.detail || 'Failed to start live stream');
      setPhase('pre_live'); // Return to pre-live on error
    } finally {
      setIsLoading(false);
    }
  }, [user, streamTitle, stopCameraPreview]);

  // ── Initiate countdown then start stream ──
  const handleGoLive = useCallback(() => {
    if (signalQuality === 'poor') {
      toast.warning('⚠️ Poor signal detected. Your stream may be unstable.');
      // Don't block — let user decide
    }
    setPhase('countdown');
    setCountdownValue(3);
  }, [signalQuality]);

  // ── Countdown tick → triggers startStream when done ──
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdownValue <= 0) {
      startStream();
      return;
    }
    const timer = setTimeout(() => setCountdownValue(v => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, countdownValue, startStream]);

  // ── End stream ──
  const endStream = useCallback(async () => {
    logger.info('[GoLiveModal] Ending stream...');
    
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (viewerPollRef.current) {
      clearInterval(viewerPollRef.current);
      viewerPollRef.current = null;
    }

    if (streamData?.id) {
      try {
        await apiClient.post(`/livekit/end-stream/${streamData.id}?broadcaster_id=${user.id}`);
      } catch (e) {
        logger.error('[GoLiveModal] Error ending stream on backend:', e);
      }
    }

    setBroadcasterToken(null);
    setStreamData(null);
    setStreamDuration(0);
    setViewerCount(0);
    setShowEndDialog(false);
    setIsConnected(false);
    setPhase('pre_live');
    
    onStreamEnded?.();
    onClose();
  }, [streamData, user, onStreamEnded, onClose]);

  // ── Phase-aware close handler ──
  const handleClose = useCallback(() => {
    if (phase === 'live' || phase === 'countdown') {
      // During live or countdown: require confirmation
      if (phase === 'countdown') {
        // Abort countdown — just go back to pre-live
        setPhase('pre_live');
        return;
      }
      setShowEndDialog(true);
    } else {
      // Pre-live: clean close
      stopCameraPreview();
      onClose();
    }
  }, [phase, stopCameraPreview, onClose]);

  // Prevent body scroll
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    /* ── Mobile: fullscreen  |  Desktop: centred popup ── */
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-0 sm:p-6" data-testid="go-live-modal" data-theme={theme}>
      {/* Dark backdrop — click away closes only if pre-live or shows confirmation if live */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm hidden sm:block"
        onClick={handleClose}
      />
      {/* Inner container — fullscreen on mobile, popup on desktop */}
      <div className="relative w-full h-full sm:w-[1100px] sm:h-[720px] sm:max-h-[90vh] sm:rounded-2xl sm:overflow-hidden bg-black shadow-2xl shadow-black/60">

        {/* ── PRE-LIVE SCREEN ── */}
        <AnimatePresence>
          {phase === 'pre_live' && (
            <motion.div
              key="pre-live"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col bg-zinc-950"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
                <button
                  onClick={handleClose}
                  className="p-2 rounded-full hover:bg-zinc-800 transition-colors"
                >
                  <X className="w-5 h-5 text-zinc-400" />
                </button>
                <span className="text-white font-semibold text-base">Live Video</span>
                <div className="w-9" />{/* spacer */}
              </div>

              {/* Camera Preview */}
              <div className="flex-1 relative bg-zinc-900 overflow-hidden">
                <video
                  ref={previewVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)' }}
                />
                {/* Mirror front camera for natural selfie view */}
                {/* No camera fallback */}
                {!cameraPreviewStream && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <CameraOff className="w-16 h-16 text-zinc-600" />
                    <p className="text-zinc-500 text-sm">Camera preview unavailable</p>
                    <p className="text-zinc-600 text-xs">Camera access will be requested when you go live</p>
                  </div>
                )}

                {/* Signal quality overlay — top right */}
                <div className="absolute top-3 right-3">
                  <ConnectionQualityBadge quality={signalQuality} />
                  {signalQuality === 'poor' && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-2 flex items-start gap-2 bg-red-950/90 border border-red-700/50 rounded-xl px-3 py-2 max-w-[200px]"
                    >
                      <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      <p className="text-red-300 text-xs leading-snug">
                        Poor signal detected. Your stream may buffer or disconnect.
                      </p>
                    </motion.div>
                  )}
                </div>

                {/* Recheck signal button */}
                <button
                  onClick={checkSignalQuality}
                  className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800/80 text-zinc-400 text-xs hover:bg-zinc-700/80 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  Check signal
                </button>
              </div>

              {/* Bottom controls */}
              <div className="flex-shrink-0 bg-zinc-950 border-t border-zinc-800 p-4">
                {/* Stream title input */}
                <div className="mb-4">
                  <input
                    type="text"
                    value={streamTitle}
                    onChange={e => setStreamTitle(e.target.value)}
                    placeholder="Add a title for your live (optional)"
                    maxLength={80}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-red-500/60 transition-colors"
                  />
                </div>

                {/* Tips row */}
                <div className="flex items-center gap-2 mb-4 text-zinc-500">
                  <Info className="w-3.5 h-3.5 flex-shrink-0" />
                  <p className="text-xs">Your followers will be notified when you go live. You can mute or flip your camera at any time.</p>
                </div>

                {/* Go Live button */}
                <button
                  onClick={handleGoLive}
                  className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-red-600 hover:bg-red-500 active:scale-[0.98] transition-all font-bold text-white text-lg shadow-lg shadow-red-900/40"
                >
                  <Radio className="w-5 h-5" />
                  Go Live
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── COUNTDOWN OVERLAY ── */}
        <AnimatePresence>
          {phase === 'countdown' && (
            <motion.div
              key="countdown"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-black z-50"
            >
              {/* Abort countdown button */}
              <button
                onClick={() => setPhase('pre_live')}
                className="absolute top-4 left-4 flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-800/80 text-zinc-400 text-sm hover:bg-zinc-700 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Cancel
              </button>

              <AnimatePresence mode="wait">
                {countdownValue > 0 ? (
                  <motion.div
                    key={countdownValue}
                    initial={{ scale: 2, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                    className="text-center"
                  >
                    <div className="relative w-48 h-48 mx-auto mb-6">
                      {/* Pulsing ring */}
                      <div className="absolute inset-0 rounded-full border-4 border-red-500/30 animate-ping" />
                      <div className="absolute inset-0 rounded-full border-4 border-red-500/60" />
                      {/* Countdown number */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-8xl font-black text-white tabular-nums">{countdownValue}</span>
                      </div>
                    </div>
                    <p className="text-zinc-400 text-lg font-medium">Get ready...</p>
                    <p className="text-zinc-600 text-sm mt-1">Your live stream is about to begin</p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="go"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-center"
                  >
                    <div className="w-24 h-24 rounded-full bg-red-600 flex items-center justify-center mx-auto mb-4 animate-pulse">
                      <Radio className="w-12 h-12 text-white" />
                    </div>
                    <p className="text-white text-2xl font-black tracking-widest">LIVE</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Signal quality reminder */}
              {signalQuality === 'poor' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute bottom-8 flex items-center gap-2 bg-red-950/80 border border-red-700/40 rounded-xl px-4 py-2.5"
                >
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-red-300 text-sm">Poor signal — stream may be unstable</span>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── LOADING (connecting after countdown) ── */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black z-40">
            <div className="text-center">
              <div className="relative w-20 h-20 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full border-4 border-red-500/30 animate-ping" />
                <div className="absolute inset-0 rounded-full border-4 border-red-500 border-t-transparent animate-spin" />
              </div>
              <p className="text-white text-lg">Connecting your live stream...</p>
              <p className="text-zinc-500 text-sm mt-1">Hang tight, almost there</p>
            </div>
          </div>
        )}

        {/* ── ERROR STATE ── */}
        {error && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black p-6 z-40">
            <div className={`${colors.overlayBg} rounded-2xl p-6 max-w-sm text-center`}>
              <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <h3 className={`${colors.primaryText} text-lg font-bold mb-2`}>Unable to Go Live</h3>
              <p className={`${colors.secondaryText} mb-6`}>{error}</p>
              <div className="flex gap-3">
                <Button onClick={handleClose} variant="outline" className="flex-1">
                  Cancel
                </Button>
                <Button onClick={() => { setError(null); handleGoLive(); }} className="flex-1 bg-red-600 hover:bg-red-700 text-white">
                  Try Again
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── LIVE BROADCAST ── */}
        {phase === 'live' && broadcasterToken && !error && (
          <div className="relative w-full h-full">
            <LiveKitRoom
              token={broadcasterToken.token}
              serverUrl={broadcasterToken.server_url}
              video={false}
              audio={true}
              connect={true}
              onConnected={() => setIsConnected(true)}
              onDisconnected={() => {
                logger.info('[GoLiveModal] Disconnected from room');
              }}
              style={{ position: 'relative', width: '100%', height: '100%' }}
            >
              <BroadcasterControls
                onEnd={endStream}
                onEndRequest={() => setShowEndDialog(true)}
                streamDuration={streamDuration}
                viewerCount={viewerCount}
                streamId={streamData?.id}
                userId={user?.id}
                userName={user?.username ? `@${user.username}` : (user?.full_name || user?.email?.split('@')[0] || 'You')}
                userAvatar={user?.avatar_url}
              />
            </LiveKitRoom>
          </div>
        )}

        {/* ── End stream confirmation dialog ── */}
        <EndStreamDialog
          isOpen={showEndDialog}
          onConfirm={endStream}
          onCancel={() => setShowEndDialog(false)}
          duration={streamDuration}
          colors={colors}
        />
      </div>{/* End of inner container */}
    </div>
  );
};

export default GoLiveModal;
