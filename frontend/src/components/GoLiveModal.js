import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Radio, Clock, Mic, MicOff, Camera, CameraOff, Loader2, AlertTriangle,
  RefreshCw, MessageCircle, Heart, X, Sparkles,
  Share2, Eye, Film, Power, Play, ArrowLeft, ChevronRight,
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
  useDataChannel,
} from '@livekit/components-react';
import { WebGLBroadcastController } from './WebGLBroadcastController';

import '@livekit/components-styles';

import { Track, ConnectionState, DataPacket_Kind } from 'livekit-client';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import { HairFilterEngine } from '../utils/HairFilterEngine';
import { HairFilterPicker } from './HairFilterPicker';

// Extracted sub-components (v46 decomposition)
import {
  ConnectionQualityBadge,
  getThemeColors,
  VideoFilterPanel,
  EmojiBurst,
  CommentTile,
  LiveCommentsFeed,
  QuickReactions,
  EndStreamDialog,
} from './live/GoLiveSubComponents';

import BroadcasterControls from './live/BroadcasterControls';


/**
 * GoLiveModal - Full-screen live streaming with LiveKit
 * Phase machine: pre_live ? countdown ? live
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

  // -- Reset phase when modal opens/closes --
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

  // -- Camera preview for pre-live screen --
  const startCameraPreview = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      setCameraPreviewStream(stream);
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      logger.warn('[GoLiveModal] Camera preview unavailable:', err);
      // Not fatal - user may grant camera on actual go-live
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

  // -- Signal quality estimation via navigator.connection or RTT probe --
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

  // -- Start stream (called after countdown) --
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

      // Stop camera preview - LiveKit will take over camera
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

  // -- Initiate countdown then start stream --
  const handleGoLive = useCallback(() => {
    if (signalQuality === 'poor') {
      toast.warning('Ã¢Å¡Â Ã¯Â¸Â Poor signal detected. Your stream may be unstable.');
      // Don't block - let user decide
    }
    setPhase('countdown');
    setCountdownValue(3);
  }, [signalQuality]);

  // -- Countdown tick ? triggers startStream when done --
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdownValue <= 0) {
      startStream();
      return;
    }
    const timer = setTimeout(() => setCountdownValue(v => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, countdownValue, startStream]);

  // -- End stream --
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

  // -- Phase-aware close handler --
  const handleClose = useCallback(() => {
    if (phase === 'live' || phase === 'countdown') {
      // During live or countdown: require confirmation
      if (phase === 'countdown') {
        // Abort countdown - just go back to pre-live
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
    /* -- Mobile: fullscreen  |  Desktop: centred popup -- */
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-0 sm:p-6" data-testid="go-live-modal" data-theme={theme}>
      {/* Dark backdrop - click away closes only if pre-live or shows confirmation if live */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm hidden sm:block"
        onClick={handleClose}
      />
      {/* Inner container - fullscreen on mobile, popup on desktop */}
      <div className="relative w-full h-full sm:w-[1100px] sm:h-[720px] sm:max-h-[90vh] sm:rounded-2xl sm:overflow-hidden bg-black shadow-2xl shadow-black/60">

        {/* -- PRE-LIVE SCREEN -- */}
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
                <button aria-label="Close"
                  onClick={handleClose}
                  className="p-2 rounded-full hover:bg-zinc-800 transition-colors"
                ><X className="w-5 h-5 text-zinc-400" />
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

                {/* Signal quality overlay - top right */}
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
                <button aria-label="Refresh"
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
                  <input aria-label="Add a title for your live (optional)"
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
                <button aria-label="Radio"
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

        {/* -- COUNTDOWN OVERLAY -- */}
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
              <button aria-label="Go back"
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
                  <span className="text-red-300 text-sm">Poor signal - stream may be unstable</span>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* -- LOADING (connecting after countdown) -- */}
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

        {/* -- ERROR STATE -- */}
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

        {/* -- LIVE BROADCAST -- */}
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

        {/* -- End stream confirmation dialog -- */}
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
