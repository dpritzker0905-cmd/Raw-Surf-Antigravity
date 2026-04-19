import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Radio, Users, Heart, MessageCircle, Send, Loader2, WifiOff,
  ArrowLeft, Share2, UserPlus, Sparkles, RotateCcw,
  Sun, Contrast, Droplets, Thermometer, CircleDot,
  Eye, Grid, Waves, Moon, Zap, Sunset
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';

// LiveKit
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  RoomAudioRenderer,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';

const CONNECTION_TIMEOUT = 15000;

// ─── Theme colours (mirrors GoLiveModal.getThemeColors) ───────────────────────
const getThemeColors = (theme) => {
  if (theme === 'light') return {
    overlayBg: 'bg-white/90',   border: 'border-gray-200',
    primaryText: 'text-gray-900', secondaryText: 'text-gray-600',
    buttonBg: 'bg-gray-100 hover:bg-gray-200',
    accentText: 'text-blue-600', accentBg: 'bg-blue-600',
    gradientTop: 'from-white/70',
  };
  if (theme === 'beach') return {
    overlayBg: 'bg-zinc-950/90', border: 'border-amber-700/40',
    primaryText: 'text-amber-100', secondaryText: 'text-amber-300',
    buttonBg: 'bg-amber-900/50 hover:bg-amber-800/50',
    accentText: 'text-orange-400', accentBg: 'bg-orange-500',
    gradientTop: 'from-zinc-950/80',
  };
  // dark (default)
  return {
    overlayBg: 'bg-zinc-900/90',  border: 'border-zinc-700',
    primaryText: 'text-white',    secondaryText: 'text-zinc-400',
    buttonBg: 'bg-zinc-800/80 hover:bg-zinc-700',
    accentText: 'text-cyan-400',  accentBg: 'bg-cyan-500',
    gradientTop: 'from-black/80',
  };
};

// ─── AI Filter presets (identical to GoLiveModal broadcaster) ─────────────────
const FILTER_PRESETS = [
  { name: 'None',           icon: CircleDot, values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0  }, description: 'Original' },
  { name: 'Golden Hour',    icon: Sunset,    values: { brightness: 105, contrast: 110, saturation: 120, warmth: 120, vignette: 20 }, description: 'Warm sunset vibes' },
  { name: 'AI Pipeline',    icon: Waves,     values: { brightness: 90,  contrast: 130, saturation: 90,  warmth: 110, vignette: 40 }, description: 'Deep barrel shadows' },
  { name: 'AI Bio-Lum',     icon: Moon,      values: { brightness: 85,  contrast: 140, saturation: 150, warmth: 160, vignette: 30 }, description: 'Neon glowing night surf' },
  { name: 'AI Cyber-Surf',  icon: Zap,       values: { brightness: 110, contrast: 125, saturation: 140, warmth: 40,  vignette: 0  }, description: 'Hyper-performance cold lens' },
  { name: 'AI Night Vision',icon: Eye,       values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0  }, description: 'Tactical green overlay' },
  { name: 'AI Pixelate',    icon: Grid,      values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0  }, description: 'Retro 8-bit aesthetic' },
];

// ─── Surf Filters Panel (mirrors GoLiveModal VideoFilterPanel) ────────────────
const ViewerFilterPanel = ({ isOpen, onClose, filters, onFilterChange, onPresetSelect, colors }) => {
  if (!isOpen) return null;
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={`absolute left-3 top-24 w-64 max-h-[58vh] overflow-y-auto p-3 rounded-2xl ${colors.overlayBg} ${colors.border} border z-50 shadow-2xl`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className={`w-4 h-4 ${colors.accentText}`} />
          <span className={`text-sm font-medium ${colors.primaryText}`}>Surf Filters</span>
        </div>
        <button onClick={onClose} className={`p-1.5 rounded-full ${colors.buttonBg}`}>
          <X className={`w-4 h-4 ${colors.secondaryText}`} />
        </button>
      </div>

      {/* AI Presets grid */}
      <div className="mb-3 space-y-1.5">
        <span className={`text-xs font-medium ${colors.secondaryText}`}>Quick Presets</span>
        <div className="grid grid-cols-3 gap-1.5">
          {FILTER_PRESETS.map((preset) => {
            const Icon = preset.icon;
            const isActive = filters.presetName === preset.name;
            return (
              <button
                key={preset.name}
                onClick={() => onPresetSelect(preset)}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-all hover:scale-105 ${isActive ? colors.accentBg : colors.buttonBg}`}
                title={preset.description}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : colors.accentText}`} />
                <span className={`text-[9px] text-center leading-tight ${isActive ? 'text-white' : colors.primaryText}`}>{preset.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Manual sliders */}
      {[
        { key: 'brightness', label: 'Brightness', Icon: Sun,         min: 50,  max: 150 },
        { key: 'contrast',   label: 'Contrast',   Icon: Contrast,    min: 50,  max: 150 },
        { key: 'saturation', label: 'Saturation', Icon: Droplets,    min: 50,  max: 200 },
        { key: 'warmth',     label: 'Warmth',     Icon: Thermometer, min: 50,  max: 150 },
        { key: 'vignette',   label: 'Vignette',   Icon: CircleDot,   min: 0,   max: 50  },
      ].map(({ key, label, Icon, min, max }) => (
        <div key={key} className="mb-2.5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <Icon className={`w-3 h-3 ${colors.secondaryText}`} />
              <span className={`text-xs ${colors.secondaryText}`}>{label}</span>
            </div>
            <span className={`text-xs ${colors.primaryText}`}>{filters[key]}%</span>
          </div>
          <input
            type="range" min={min} max={max} value={filters[key]}
            onChange={(e) => onFilterChange(key, parseInt(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-cyan-500"
          />
        </div>
      ))}

      {/* Reset */}
      <Button
        onClick={() => {
          onFilterChange('brightness', 100); onFilterChange('contrast', 100);
          onFilterChange('saturation', 100); onFilterChange('warmth', 100);
          onFilterChange('vignette', 0);     onFilterChange('presetName', 'None');
        }}
        size="sm" variant="outline"
        className={`w-full mt-1 ${colors.buttonBg} ${colors.primaryText}`}
      >
        <RotateCcw className="w-3 h-3 mr-2" />
        Reset All
      </Button>
    </motion.div>
  );
};

// ─── Live Chat ────────────────────────────────────────────────────────────────
const ChatMessage = ({ message, isOwn }) => (
  <div className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
    <Avatar className="w-7 h-7 flex-shrink-0">
      <AvatarImage src={getFullUrl(message.avatar_url)} />
      <AvatarFallback className="bg-zinc-700 text-xs">{message.user_name?.[0] || '?'}</AvatarFallback>
    </Avatar>
    <div className={`max-w-[80%] ${isOwn ? 'text-right' : ''}`}>
      <span className="text-xs text-cyan-400 font-medium">{message.user_name}</span>
      <p className="text-sm text-white break-words">{message.text}</p>
    </div>
  </div>
);

const LiveChat = ({ streamId, userId, userName, userAvatar }) => {
  const [comments, setComments]   = useState([]);
  const [newComment, setNewComment] = useState('');
  const [sending, setSending]     = useState(false);
  const endRef    = useRef(null);
  const pollRef   = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [comments]);

  useEffect(() => {
    const fetch = async () => {
      try {
        const r = await apiClient.get(`/social-live/${streamId}/comments`);
        if (r.data?.comments) setComments(r.data.comments);
      } catch { /* silent */ }
    };
    fetch();
    pollRef.current = setInterval(fetch, 3000);
    return () => clearInterval(pollRef.current);
  }, [streamId]);

  const send = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || sending) return;
    setSending(true);
    try {
      await apiClient.post(`/social-live/${streamId}/comments`, {
        user_id: userId, user_name: userName, avatar_url: userAvatar, text: newComment.trim()
      });
      setComments(prev => [...prev, {
        id: Date.now().toString(), user_id: userId, user_name: userName,
        avatar_url: userAvatar, text: newComment.trim(), created_at: new Date().toISOString()
      }]);
      setNewComment('');
    } catch { toast.error('Failed to send'); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'rgba(9,9,11,0.92)', backdropFilter: 'blur(12px)' }}>
      {/* Header — live pulse dot matching broadcaster */}
      <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'rgba(39,39,42,0.8)', flexShrink: 0 }}>
        <div style={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
          <div className="animate-ping" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#f59e0b', opacity: 0.6 }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#f59e0b' }} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>LIVE CHAT</span>
        <span style={{ fontSize: 11, color: '#71717a', background: 'rgba(39,39,42,0.7)', padding: '1px 6px', borderRadius: 8 }}>({comments.length})</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {comments.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm py-8">
            <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No comments yet</p>
            <p className="text-xs">Be the first to say something!</p>
          </div>
        ) : comments.map(msg => (
          <ChatMessage key={msg.id} message={msg} isOwn={msg.user_id === userId} />
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="p-3 border-t border-zinc-800">
        <div className="flex gap-2">
          <Input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Say something..."
            className="flex-1 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 h-10"
            maxLength={200} disabled={sending}
          />
          <Button type="submit" size="icon"
            disabled={!newComment.trim() || sending}
            className="bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 h-10 w-10"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
};

// ─── Stream Unavailable ───────────────────────────────────────────────────────
const StreamUnavailable = ({ onBack, broadcasterName, onRetry }) => (
  <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
    <div className="text-center p-6 max-w-md">
      <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
        <WifiOff className="w-10 h-10 text-gray-500" />
      </div>
      <h3 className="text-white text-xl font-bold mb-2">Stream Ended</h3>
      <p className="text-gray-400 mb-6">
        {broadcasterName ? `${broadcasterName}'s live stream` : 'This stream'} has ended or is unavailable.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button onClick={onRetry} variant="outline" className="border-zinc-700 text-white hover:bg-zinc-800 gap-2">
          <Radio className="w-4 h-4" /> Try Again
        </Button>
        <Button onClick={onBack} className="bg-white text-black hover:bg-gray-200 gap-2">
          <ArrowLeft className="w-4 h-4" /> Back to Feed
        </Button>
      </div>
    </div>
  </div>
);

// ─── Viewer Room Content (inside LiveKitRoom) ─────────────────────────────────
const ViewerRoomContent = ({
  broadcaster, onLeave, viewerCount, onViewProfile,
  streamId, userId, userName, userAvatar, colors
}) => {
  const [isChatOpen, setIsChatOpen]   = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0, presetName: 'None'
  });

  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const broadcasterTrack = tracks.find(t => !t.participant?.isLocal);

  const handleFilterChange = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const handlePresetSelect = useCallback((preset) => {
    setFilters({ ...preset.values, presetName: preset.name });
    toast.success(`Filter: ${preset.name}`);
  }, []);

  // CSS filter computed from slider values (mirrors GoLiveModal.videoFilterStyle)
  const videoFilterStyle = useMemo(() => {
    let warmthDeg = (filters.warmth - 100) * 0.8;
    if (filters.warmth >= 150) warmthDeg = 300; // Bio-Lum neon
    if (filters.warmth <= 50)  warmthDeg = 180; // Cyber cold
    return {
      filter: `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturation}%) hue-rotate(${warmthDeg}deg)`,
      position: 'relative', width: '100%', height: '100%'
    };
  }, [filters]);

  const vignetteStyle = useMemo(() => {
    if (!filters.vignette) return null;
    return {
      position: 'absolute', inset: 0, pointerEvents: 'none',
      background: `radial-gradient(circle, transparent ${100 - filters.vignette}%, rgba(0,0,0,${filters.vignette / 100}) 100%)`
    };
  }, [filters.vignette]);

  return (
    <div className="w-full h-full flex flex-col sm:flex-row overflow-hidden">

      {/* ── Left: Video ── */}
      <div className="flex-1 relative bg-black flex flex-col min-w-0">
        <div className="flex-1 relative overflow-hidden">

          {/* Video with CSS filters */}
          <div style={videoFilterStyle} className="absolute inset-0 flex items-center justify-center">
            {broadcasterTrack ? (
              <VideoTrack trackRef={broadcasterTrack} className="max-w-full max-h-full object-contain" />
            ) : (
              <div className="text-center">
                <Loader2 className="w-12 h-12 animate-spin text-red-500 mx-auto mb-4" />
                <p className="text-gray-400">Waiting for video...</p>
              </div>
            )}
            {/* Vignette overlay */}
            {vignetteStyle && <div style={vignetteStyle} />}
          </div>

          {/* Top bar */}
          <div className={`absolute top-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-b ${colors.gradientTop} to-transparent z-10`}>
            <div className="flex items-center justify-between">
              {/* Left: broadcaster info */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-red-500 flex-shrink-0">
                  {broadcaster?.avatar_url
                    ? <img src={getFullUrl(broadcaster.avatar_url)} alt={broadcaster.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full bg-zinc-700 flex items-center justify-center text-white font-bold">{broadcaster?.name?.[0] || '?'}</div>
                  }
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold text-sm">{broadcaster?.name || 'Live Stream'}</span>
                    <div className="flex items-center gap-1 bg-red-600 px-2 py-0.5 rounded-full animate-pulse">
                      <Radio className="w-3 h-3 text-white" />
                      <span className="text-white text-[10px] font-bold">LIVE</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-gray-400 text-[10px]">
                    <Users className="w-3 h-3" />
                    <span>{viewerCount} watching</span>
                  </div>
                </div>
              </div>

              {/* Right: controls */}
              <div className="flex items-center gap-2">
                {/* Filters */}
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`p-2 rounded-full transition-all ${showFilters ? `${colors.accentBg} text-white` : `${colors.overlayBg} ${colors.primaryText} hover:opacity-80`}`}
                  title="Surf Filters"
                >
                  <Sparkles className="w-5 h-5" />
                </button>

                {/* Chat toggle (desktop) */}
                <button
                  onClick={() => setIsChatOpen(!isChatOpen)}
                  className={`hidden sm:flex p-2 rounded-full transition-all ${colors.overlayBg} ${isChatOpen ? colors.accentBg : ''}`}
                  title={isChatOpen ? 'Hide Chat' : 'Show Chat'}
                >
                  <MessageCircle className={`w-5 h-5 ${isChatOpen ? 'text-white' : colors.primaryText}`} />
                </button>

                {/* Exit */}
                <button
                  onClick={onLeave}
                  className="p-2 bg-black/60 hover:bg-red-600 rounded-full transition-colors"
                  title="Leave Stream"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>
          </div>

          {/* Surf Filters Panel */}
          <AnimatePresence>
            {showFilters && (
              <ViewerFilterPanel
                isOpen={showFilters}
                onClose={() => setShowFilters(false)}
                filters={filters}
                onFilterChange={handleFilterChange}
                onPresetSelect={handlePresetSelect}
                colors={colors}
              />
            )}
          </AnimatePresence>

          {/* Bottom controls */}
          <div className="absolute bottom-4 left-0 right-0 px-6 flex items-center justify-between pointer-events-none z-10">
            <div className="flex items-center gap-4 pointer-events-auto">
              <button className="p-3 bg-black/40 hover:bg-red-500/20 text-white hover:text-red-400 rounded-full transition-all group backdrop-blur-md">
                <Heart className="w-6 h-6 group-active:scale-125 transition-transform" />
              </button>
              <button className="p-3 bg-black/40 hover:bg-blue-500/20 text-white hover:text-blue-400 rounded-full transition-all group backdrop-blur-md">
                <Share2 className="w-6 h-6 group-active:scale-125 transition-transform" />
              </button>
            </div>
            <div className="pointer-events-auto">
              <Button
                variant="outline" size="sm"
                className="bg-black/40 border-white/20 text-white hover:bg-white/10 backdrop-blur-md px-6 rounded-full"
                onClick={onViewProfile}
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Follow
              </Button>
            </div>
          </div>

          {/* Mobile chat overlay (bottom 40%) */}
          <div className="sm:hidden absolute bottom-0 left-0 right-0 h-[40%] pointer-events-auto z-20">
            <LiveChat streamId={streamId} userId={userId} userName={userName} userAvatar={userAvatar} />
          </div>
        </div>
      </div>

      {/* ── Right: Desktop Chat Sidebar (animated slide) ── */}
      <AnimatePresence>
        {isChatOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 310, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="hidden sm:flex flex-col h-full bg-zinc-900 border-l border-zinc-800 shrink-0 overflow-hidden"
          >
            <LiveChat streamId={streamId} userId={userId} userName={userName} userAvatar={userAvatar} />
          </motion.div>
        )}
      </AnimatePresence>

      <RoomAudioRenderer />
    </div>
  );
};

// ─── Main LiveStreamViewer ────────────────────────────────────────────────────
const LiveStreamViewer = ({ isOpen, onClose, streamInfo }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme } = useTheme();
  const colors = useMemo(() => getThemeColors(theme), [theme]);

  const [isLoading, setIsLoading]             = useState(true);
  const [connectionTimedOut, setTimedOut]     = useState(false);
  const [viewerToken, setViewerToken]         = useState(null);
  const [viewerCount, setViewerCount]         = useState(streamInfo?.viewer_count || 0);
  const [isConnected, setIsConnected]         = useState(false);

  const timeoutRef      = useRef(null);
  const isMountedRef    = useRef(true);
  const hasFetchedRef   = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearTimeout(timeoutRef.current);
    };
  }, []);

  // ── Fetch viewer token ────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen && streamInfo?.room_name && user?.id && !hasFetchedRef.current) {
      hasFetchedRef.current = true;

      const fetchToken = async () => {
        setIsLoading(true);
        setTimedOut(false);

        timeoutRef.current = setTimeout(() => {
          if (isMountedRef.current && !isConnected) {
            logger.warn('[Viewer] Connection timeout');
            setTimedOut(true);
            setIsLoading(false);
          }
        }, CONNECTION_TIMEOUT);

        try {
          const res = await apiClient.get(
            `/livekit/viewer-token/${streamInfo.room_name}?viewer_id=${user.id}&viewer_name=${encodeURIComponent(user.full_name || 'Viewer')}`
          );
          if (!isMountedRef.current) return;
          clearTimeout(timeoutRef.current);
          setViewerToken({ token: res.data.token, server_url: res.data.server_url });
          setViewerCount(c => c + 1);
          setIsLoading(false);
        } catch (err) {
          if (!isMountedRef.current) return;
          clearTimeout(timeoutRef.current);
          if (err.response?.status === 404) toast.info('This stream has ended');
          setTimedOut(true);
          setIsLoading(false);
        }
      };

      fetchToken();
    }

    if (!isOpen) {
      hasFetchedRef.current = false;
      setViewerToken(null);
      setIsLoading(true);
      setTimedOut(false);
      setIsConnected(false);
      clearTimeout(timeoutRef.current);
    }
  }, [isOpen, streamInfo?.room_name, user?.id, user?.full_name, isConnected]);

  const handleRetry = useCallback(() => {
    hasFetchedRef.current = false;
    setViewerToken(null);
    setIsLoading(true);
    setTimedOut(false);
    setIsConnected(false);
  }, []);

  const handleLeave = useCallback(async () => {
    clearTimeout(timeoutRef.current);
    if (streamInfo?.id && user?.id) {
      apiClient.post(`/social-live/${streamInfo.id}/leave?viewer_id=${user.id}`).catch(() => {});
    }
    onClose();
  }, [streamInfo, user, onClose]);

  const handleBack = useCallback(() => {
    clearTimeout(timeoutRef.current);
    onClose();
  }, [onClose]);

  const handleConnected = useCallback(() => {
    logger.info('[Viewer] Connected to LiveKit room');
    if (isMountedRef.current) {
      setIsConnected(true);
      clearTimeout(timeoutRef.current);
    }
  }, []);

  const handleDisconnected = useCallback(() => {
    logger.info('[Viewer] Disconnected');
    if (isMountedRef.current) {
      toast.info('Stream has ended');
      setTimedOut(true);
    }
  }, []);

  const handleViewProfile = useCallback(() => {
    if (streamInfo?.broadcaster_id) {
      onClose();
      navigate(`/profile/${streamInfo.broadcaster_id}`);
    }
  }, [streamInfo?.broadcaster_id, navigate, onClose]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  const broadcaster = {
    id: streamInfo?.broadcaster_id,
    name: streamInfo?.broadcaster_name,
    avatar_url: streamInfo?.broadcaster_avatar
  };

  return (
    /* Fullscreen on mobile │ Centred 1100×720 popup on desktop — matches GoLiveModal exactly */
    <div className="fixed inset-0 z-[100] flex items-center justify-center" data-testid="live-stream-viewer">
      {/* Desktop backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm hidden sm:block"
        onClick={handleLeave}
      />

      {/* ── Container: fullscreen mobile / 1100×720 desktop ── */}
      <div className="relative w-full h-full sm:w-[1100px] sm:h-[720px] sm:max-h-[90vh] sm:rounded-2xl sm:overflow-hidden bg-black shadow-2xl shadow-black/60">

        {/* Loading */}
        {isLoading && !connectionTimedOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 z-20">
            <div className="text-center">
              <div className="relative w-20 h-20 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full border-4 border-red-500/30 animate-ping" />
                <div className="absolute inset-0 rounded-full border-4 border-red-500 border-t-transparent animate-spin" />
              </div>
              <p className="text-white text-lg">Joining live stream...</p>
              <p className="text-gray-500 text-sm mt-2">{broadcaster?.name}</p>
            </div>
          </div>
        )}

        {/* Unavailable / timed out */}
        {connectionTimedOut && (
          <StreamUnavailable
            onBack={handleBack}
            broadcasterName={broadcaster?.name}
            onRetry={handleRetry}
          />
        )}

        {/* Live viewer content */}
        {viewerToken && !connectionTimedOut && (
          <LiveKitRoom
            token={viewerToken.token}
            serverUrl={viewerToken.server_url}
            video={false}
            audio={true}
            connect={true}
            onConnected={handleConnected}
            onDisconnected={handleDisconnected}
            style={{ height: '100%', width: '100%' }}
          >
            <ViewerRoomContent
              broadcaster={broadcaster}
              onLeave={handleLeave}
              viewerCount={viewerCount}
              onViewProfile={handleViewProfile}
              streamId={streamInfo?.id}
              userId={user?.id}
              userName={user?.full_name || user?.username}
              userAvatar={user?.avatar_url}
              colors={colors}
            />
          </LiveKitRoom>
        )}
      </div>
    </div>
  );
};

export default LiveStreamViewer;
