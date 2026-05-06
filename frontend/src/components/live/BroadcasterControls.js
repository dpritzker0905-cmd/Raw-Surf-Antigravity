import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Radio, Clock, Mic, MicOff, Camera, CameraOff,
  RefreshCw, MessageCircle, Heart, Sparkles,
  Share2, Eye, Scissors
} from 'lucide-react';

import { useTheme } from '../../contexts/ThemeContext';
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

import {
  useLocalParticipant,
  useTracks,
  RoomAudioRenderer,
  useConnectionState,
  useDataChannel,
} from '@livekit/components-react';
import { WebGLBroadcastController } from '../WebGLBroadcastController';

import { Track, ConnectionState, DataPacket_Kind } from 'livekit-client';

import logger from '../../utils/logger';
import { HairFilterEngine } from '../../utils/HairFilterEngine';
import { HairFilterPicker } from '../HairFilterPicker';

import {
  ConnectionQualityBadge,
  getThemeColors,
  VideoFilterPanel,
  EmojiBurst,
  LiveCommentsFeed,
  QuickReactions,
} from './GoLiveSubComponents';

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

  // ── LiveKit DataChannel for real-time emoji reactions ──
  // Reactions received from viewers appear as floating emoji bursts on the broadcaster's screen.
  const onReactionReceived = useCallback((msg) => {
    try {
      const strData = new TextDecoder().decode(msg.payload);
      const { emoji } = JSON.parse(strData);
      if (!emoji) return;
      const id = Date.now() + Math.random();
      const x = Math.random() * 100 + 100;
      const y = window.innerHeight - 200;
      setEmojiBursts(prev => [...prev, { id, emoji, x, y }]);
      setLikeCount(prev => prev + 1);
      setTimeout(() => setEmojiBursts(prev => prev.filter(b => b.id !== id)), 1500);
    } catch { /* ignore malformed */ }
  }, []);

  const { send: sendReaction } = useDataChannel('reactions', onReactionReceived);

  const handleReaction = useCallback((emoji) => {
    // Show locally immediately
    const id = Date.now();
    const x = Math.random() * 100 + 100;
    const y = window.innerHeight - 200;
    
    setEmojiBursts(prev => [...prev, { id, emoji, x, y }]);
    setLikeCount(prev => prev + 1);
    
    // Broadcast to all room participants
    try {
      const encoder = new TextEncoder();
      const payload = encoder.encode(JSON.stringify({ emoji }));
      sendReaction(payload, { kind: DataPacket_Kind.RELIABLE });
    } catch (err) {
      logger.warn('[GoLive] Failed to send reaction via DataChannel:', err.message);
    }
    
    // Remove after animation
    setTimeout(() => {
      setEmojiBursts(prev => prev.filter(b => b.id !== id));
    }, 1500);
  }, [sendReaction]);

  // -- Hair Filter Engine lifecycle --
  useEffect(() => {
    const engine = new HairFilterEngine();
    hairEngineRef.current = engine;
    
    const initWithRetry = async (retries = 2) => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          await engine.init();
          logger.info(`[HairFilter] Engine initialized on attempt ${attempt}`);
          return;
        } catch (err) {
          logger.warn(`[HairFilter] Init attempt ${attempt}/${retries} failed:`, err.message);
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
          }
        }
      }
      // All retries exhausted — non-fatal, hair filter simply won't work
      logger.error('[HairFilter] All init attempts failed — MediaPipe CDN may be unreachable');
    };
    
    initWithRetry();
    
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
        logger.info('[HairFilter] Found video element, starting engine');
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
      
      // Give up after 12 seconds (MediaPipe CDN can be slow on mobile)
      const timeout = setTimeout(() => {
        clearInterval(timer);
        logger.warn('[HairFilter] Timed out waiting for video element (12s)');
      }, 12000);
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
      toast.success('Hair filter applied! \u{2728}');
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
      {/* -- Main Video Section -- */}
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
              {/* Hair filter canvas overlay - matches WebGL canvas: video-resolution buffer + object-cover + mirror */}
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
              aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}
              className={`p-3 rounded-full ${colors.overlayBg} ${colors.border} border transition-all active:scale-95 shadow-md ${showFilters ? colors.accentBg : ''}`}
              title="Surf Filters"
            >
              <Sparkles className={`w-5 h-5 ${showFilters ? 'text-white' : colors.primaryText}`} />
            </button>

            <button
              aria-expanded={showHairPicker} onClick={() => setShowHairPicker(!showHairPicker)}
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

          {/* -- BROADCASTER CONTROLS: float over video bottom -- */}
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

      {/* -- Desktop Sidebar: Live Chat -- */}
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

export default BroadcasterControls;
