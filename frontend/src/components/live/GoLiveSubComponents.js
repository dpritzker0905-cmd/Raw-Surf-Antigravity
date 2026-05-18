/**
 * GoLive Sub-Components G Extracted from GoLiveModal.js (v46 decomposition)
 * 
 * Components: ConnectionQualityBadge, VideoFilterPanel, EmojiBurst,
 *             CommentTile, LiveCommentsFeed, QuickReactions, EndStreamDialog
 * Utility:    getThemeColors
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Loader2, AlertTriangle, MessageCircle, Heart, Send, X, Sparkles, Sun,
  Contrast, Wifi, WifiOff, ChevronUp, ChevronDown, Droplets, Thermometer,
  CircleDot, Sunset, Waves, Signal, SignalHigh, SignalLow, SignalMedium,
  RotateCcw, Zap, Moon, Grid, Eye
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { motion, AnimatePresence } from 'framer-motion';
import { ConnectionState } from 'livekit-client';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';
import { getFullUrl } from '../../utils/media';


/**
 * Connection Quality Indicator Component
 */
export const ConnectionQualityBadge = ({ state, quality }) => {
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
export const getThemeColors = (theme) => {
  return {
    overlayBg: theme === 'light' 
      ? 'bg-white/70 backdrop-blur-md' 
      : theme === 'beach'
        ? 'bg-amber-900/60 backdrop-blur-md'
        : 'bg-zinc-900/70 backdrop-blur-md',
    primaryText: theme === 'light' ? 'text-slate-900' : 'text-white',
    secondaryText: theme === 'light' ? 'text-slate-600' : theme === 'beach' ? 'text-amber-100' : 'text-zinc-400',
    accentBg: theme === 'light' 
      ? 'bg-blue-500' 
      : theme === 'beach' 
        ? 'bg-orange-500' 
        : 'bg-cyan-500',
    accentText: theme === 'light' ? 'text-blue-500' : theme === 'beach' ? 'text-orange-400' : 'text-cyan-400',
    buttonBg: theme === 'light' 
      ? 'bg-slate-200 hover:bg-slate-300' 
      : theme === 'beach'
        ? 'bg-amber-800/50 hover:bg-amber-700/50'
        : 'bg-white/20 hover:bg-white/30',
    commentBg: theme === 'light' 
      ? 'bg-white/90' 
      : theme === 'beach'
        ? 'bg-amber-900/80'
        : 'bg-zinc-800/90',
    border: theme === 'light' ? 'border-slate-200' : theme === 'beach' ? 'border-amber-700/50' : 'border-zinc-700',
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
    sliderBg: theme === 'light' ? 'bg-slate-300' : theme === 'beach' ? 'bg-amber-700' : 'bg-zinc-600',
    sliderThumb: theme === 'light' ? 'bg-blue-500' : theme === 'beach' ? 'bg-orange-400' : 'bg-cyan-400',
  };
};

/**
 * Video Filter Panel - Surfer-optimized filters
 * Positioned on LEFT side to avoid collision with controls
 */
export const VideoFilterPanel = ({ isOpen, onClose, filters, onFilterChange, onPresetSelect, colors }) => {
  if (!isOpen) return null;
  
  const presets = [
    { name: 'None', icon: CircleDot, values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0 }, description: 'Original camera' },
    { name: 'AI Night Vision', icon: Eye, values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0 }, description: 'Tactical green overlay' },
    { name: 'AI Pixelate', icon: Grid, values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0 }, description: 'Retro 8-bit aesthetic' },
    { name: 'Golden Hour', icon: Sunset, values: { brightness: 105, contrast: 110, saturation: 120, warmth: 120, vignette: 20 }, description: 'Warm sunset vibes' },
    { name: 'AI Pipeline', icon: Waves, values: { brightness: 90, contrast: 130, saturation: 90, warmth: 110, vignette: 40 }, description: 'Deep barrel shadows' },
    { name: 'AI Bio-Lum', icon: Moon, values: { brightness: 85, contrast: 140, saturation: 150, warmth: 160, vignette: 30 }, description: 'Neon glowing night surf' },
    { name: 'AI Cyber-Surf', icon: Zap, values: { brightness: 110, contrast: 125, saturation: 140, warmth: 40, vignette: 0 }, description: 'Hyper-performance cold lens' },
  ];
  
  const sliders = [
    { key: 'brightness', icon: Sun, label: 'Brightness', min: 50, max: 150 },
    { key: 'contrast', icon: Contrast, label: 'Contrast', min: 50, max: 150 },
    { key: 'saturation', icon: Droplets, label: 'Saturation', min: 50, max: 150 },
    { key: 'warmth', icon: Thermometer, label: 'Warmth', min: 50, max: 150 },
    { key: 'vignette', icon: CircleDot, label: 'Vignette', min: 0, max: 50 },
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
        <button onClick={onClose} className={`p-1.5 rounded-full ${colors.buttonBg}`} aria-label="Close filter panel">
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
      
      {/* Sliders */}
      {sliders.map(({ key, icon: SliderIcon, label, min, max }) => (
        <div className="mb-2.5" key={key}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <SliderIcon className={`w-3 h-3 ${colors.secondaryText}`} />
              <span className={`text-xs ${colors.secondaryText}`}>{label}</span>
            </div>
            <span className={`text-xs ${colors.primaryText}`}>{filters[key]}%</span>
          </div>
          <input aria-label="Range slider"
            type="range" min={min} max={max}
            value={filters[key]}
            onChange={(e) => onFilterChange(key, parseInt(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-cyan-500"
          />
        </div>
      ))}
      
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
 */
export const EmojiBurst = ({ emoji, x, y, theme, id }) => {
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
export const CommentTile = React.memo(({ comment, colors, onReply, onLike, currentUserId }) => {
  const [liked, setLiked] = useState(comment.liked_by?.includes(currentUserId) || false);
  const [likeCount, setLikeCount] = useState(comment.likes || 0);
  
  const handleLike = async () => {
    const wasLiked = liked;
    setLiked(!liked);
    setLikeCount(prev => wasLiked ? prev - 1 : prev + 1);
    try {
      await onLike(comment.id, !wasLiked);
    } catch {
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
        {likeCount > 0 && (
          <span className={`text-[10px] ${colors.secondaryText}`}>
            {likeCount} {likeCount === 1 ? 'like' : 'likes'}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <button 
          onClick={handleLike}
          className={`p-1 rounded-full ${colors.buttonBg} transition-all ${liked ? 'scale-110' : 'opacity-60 hover:opacity-100'}`}
          aria-label={liked ? 'Unlike comment' : 'Like comment'}
        >
          <Heart className={`w-3 h-3 ${liked ? 'text-red-500 fill-red-500' : colors.secondaryText}`} />
        </button>
        <button 
          onClick={() => onReply(comment)}
          className={`p-1 rounded-full ${colors.buttonBg} opacity-60 hover:opacity-100`}
          aria-label="Reply to comment"
        >
          <MessageCircle className={`w-3 h-3 ${colors.secondaryText}`} />
        </button>
      </div>
    </motion.div>
  );
});

/**
 * Live Comments Feed - Real-time with delta sync
 */
export const LiveCommentsFeed = ({ streamId, colors, onSendComment, onLikeComment, isExpanded, onToggleExpand, currentUserId }) => {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const commentsRef = useRef(null);
  const lastFetchRef = useRef(Date.now());
  
  useEffect(() => {
    if (!streamId) return;
    const fetchComments = async () => {
      try {
        const response = await apiClient.get(`/social-live/${streamId}/comments`);
        if (response.data?.comments) {
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
      logger.error('Comment send error:', err);
    } finally {
      setSending(false);
    }
  };

  const handleReply = (comment) => {
    setReplyingTo(comment);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: isExpanded ? '100%' : 'auto', overflow: 'hidden', background: 'rgba(9,9,11,0.92)', backdropFilter: 'blur(12px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(39,39,42,0.8)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
            <div className="animate-ping" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#f59e0b', opacity: 0.6 }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#f59e0b' }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>LIVE CHAT</span>
          <span style={{ fontSize: 11, color: '#71717a', background: 'rgba(39,39,42,0.7)', padding: '1px 6px', borderRadius: 8 }}>{comments.length}</span>
        </div>
        <button onClick={onToggleExpand} className={`sm:hidden p-1.5 rounded-lg ${colors.buttonBg} transition-colors`} aria-label={isExpanded ? 'Collapse chat' : 'Expand chat'}>
          {isExpanded ? <ChevronDown className={`w-4 h-4 ${colors.secondaryText}`} /> : <ChevronUp className={`w-4 h-4 ${colors.secondaryText}`} />}
        </button>
      </div>

      {isExpanded && (
        <>
          <div ref={commentsRef} style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
            <AnimatePresence mode="popLayout">
              {comments.slice(-50).map((comment) => (
                <CommentTile key={comment.id} comment={comment} colors={colors} onReply={handleReply} onLike={onLikeComment} currentUserId={currentUserId} />
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

          <AnimatePresence>
            {replyingTo && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                style={{ padding: '6px 12px', borderTop: '1px solid #27272a', background: '#18181b', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span className={`text-xs ${colors.secondaryText}`}>Replying to</span>
                <span className={`text-xs font-semibold ${colors.accentText}`}>@{replyingTo.user_name}</span>
                <button onClick={() => setReplyingTo(null)} className="ml-auto" aria-label="Cancel reply">
                  <X className={`w-3 h-3 ${colors.secondaryText}`} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSend} style={{ padding: '10px 12px', borderTop: '1px solid #27272a', background: '#09090b', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input aria-label="Text input"
                value={newComment} onChange={(e) => setNewComment(e.target.value)}
                placeholder={replyingTo ? `Reply to @${replyingTo.user_name}...` : 'Say something...'}
                className="flex-1 h-9 text-sm bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                maxLength={200} disabled={sending}
              />
              <Button aria-label="Loader2" type="submit" size="sm" disabled={!newComment.trim() || sending} className={`${colors.accentBg} text-white h-9 px-3`}>
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
 * Quick Reaction Buttons - Surf-themed emoji reactions with haptic burst
 */
export const QuickReactions = ({ onReact, colors }) => {
  const reactions = [
    { emoji: String.fromCodePoint(0x1F919), label: 'shaka' },
    { emoji: '\u{1F30A}', label: 'wave' },
    { emoji: '\u{1F525}', label: 'fire' },
    { emoji: '\u{2764}\u{FE0F}', label: 'love' },
    { emoji: String.fromCodePoint(0x1F3C4), label: 'surf' },
    { emoji: '\u{1F62E}', label: 'wow' },
  ];

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full ${colors.overlayBg} backdrop-blur-md border ${colors.border}`}>
      {reactions.map(({ emoji, label }) => (
        <button key={emoji} onClick={() => onReact(emoji)} aria-label={label}
          className="text-lg sm:text-xl hover:scale-130 transition-all duration-150 active:scale-90 p-1 rounded-full hover:bg-white/10">
          {emoji}
        </button>
      ))}
    </div>
  );
};

/**
 * End Stream Confirmation Dialog - Theme-aware
 */
export const EndStreamDialog = ({ isOpen, onConfirm, onCancel, duration, colors }) => {
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
          <Button onClick={onCancel} variant="outline" className={`flex-1 ${colors.border} ${colors.primaryText} ${colors.buttonBg}`}>
            Keep Streaming
          </Button>
          <Button onClick={onConfirm} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold">
            End Live
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
