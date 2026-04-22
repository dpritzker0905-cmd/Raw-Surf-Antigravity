/**
 * InCallView — Premium active call overlay.
 * 
 * FILTER IMPLEMENTATION — Uses the SAME WebGL GPU shader pipeline as GoLive:
 *   - WebGLVideoProcessor from WebGLFilterEngine.js
 *   - Real GLSL fragment shaders running on the GPU
 *   - Hidden <video> feeds into WebGL <canvas> for filtered display
 *   - Works reliably on all platforms including mobile (bypasses CSS filter limitations)
 *
 * REMOTE VIDEO:
 *   - object-contain to prevent face cropping
 *   - Dark background for letterboxing
 * 
 * HAIR FILTERS:
 *   - Uses HairFilterPicker component (same as GoLive)
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { 
  Mic, MicOff, Video, VideoOff, PhoneOff, 
  Volume2, VolumeX, Maximize2, Minimize2, Signal, SignalLow, SignalZero,
  Sparkles, X, Scissors, SwitchCamera,
  Sunset, Waves, Moon, Zap, Eye, Grid, CircleDot
} from 'lucide-react';
import { HairFilterPicker } from '../HairFilterPicker';
import { WebGLVideoProcessor } from '../../utils/WebGLFilterEngine';
import { HairFilterEngine } from '../../utils/HairFilterEngine';

// ── Duration formatter ──────────────────────────────────────────────
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ── Connection Quality Badge ────────────────────────────────────────
function ConnectionQualityBadge({ quality }) {
  const config = {
    good: { icon: Signal, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Strong' },
    fair: { icon: SignalLow, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Fair' },
    poor: { icon: SignalZero, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Weak' },
  };
  const info = config[quality] || config.good;
  const Icon = info.icon;
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${info.bg} backdrop-blur-md`}>
      <Icon className={`w-3.5 h-3.5 ${info.color}`} />
      <span className={`text-[10px] font-medium ${info.color}`}>{info.label}</span>
    </div>
  );
}

// ── Filter Presets — maps to WebGL shader keys in WebGLFilterEngine ──
const FILTER_PRESETS = [
  { name: 'None',         key: 'none',             icon: CircleDot, description: 'Original camera' },
  { name: 'Golden Hour',  key: 'goldenhour',        icon: Sunset,    description: 'Warm sunset vibes' },
  { name: 'Pipeline',     key: 'gopro',             icon: Waves,     description: 'Deep barrel shadows' },
  { name: 'Night Vision', key: 'nightvision',        icon: Eye,       description: 'Tactical green overlay' },
  { name: 'Pixelate',     key: 'pixelate',           icon: Grid,      description: 'Retro lo-fi aesthetic' },
  { name: 'Bio-Lum',      key: 'bioluminescence',    icon: Moon,      description: 'Neon glowing edges' },
  { name: 'Cyber-Surf',   key: 'cyber',              icon: Zap,       description: 'Hyper-cold glitch lens' },
];

// ── Theme colors for HairFilterPicker ───────────────────────────────
const CALL_COLORS = {
  overlayBg: 'bg-black/80 backdrop-blur-xl',
  border: 'border-white/10',
  buttonBg: 'bg-white/5 hover:bg-white/10',
  primaryText: 'text-white/90',
  secondaryText: 'text-white/50',
  accentText: 'text-cyan-400',
  accentBg: 'bg-cyan-500/20',
};

// ── Filter Picker panel ─────────────────────────────────────────────
const FilterPicker = ({ isOpen, onClose, activeFilter, onSelectFilter }) => {
  if (!isOpen) return null;
  return (
    <div 
      className="fixed left-3 top-20 w-60 max-h-[55vh] overflow-y-auto p-3 rounded-2xl bg-black/80 backdrop-blur-xl border border-white/10 z-[9999]"
      style={{ animation: 'slideInLeft 0.25s ease-out' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-white">Surf Filters</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors">
          <X className="w-4 h-4 text-white/70" />
        </button>
      </div>
      <div className="space-y-1">
        {FILTER_PRESETS.map((preset) => {
          const Icon = preset.icon;
          const isActive = activeFilter === preset.key;
          return (
            <button
              key={preset.key}
              onClick={() => onSelectFilter(preset.key)}
              className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-all ${
                isActive 
                  ? 'bg-gradient-to-r from-cyan-500/30 to-blue-500/20 border border-cyan-500/50 shadow-lg shadow-cyan-500/10' 
                  : 'bg-white/5 hover:bg-white/10 border border-transparent'
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isActive ? 'bg-cyan-500/30' : 'bg-white/5'}`}>
                <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-300' : 'text-white/60'}`} />
              </div>
              <div className="text-left">
                <span className={`text-xs font-medium block ${isActive ? 'text-cyan-300' : 'text-white/90'}`}>{preset.name}</span>
                <span className="text-[10px] text-white/40">{preset.description}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════
export default function InCallView({
  callType = 'audio',
  localStream,
  remoteStream,
  isMuted = false,
  isCameraOff = false,
  callDuration = 0,
  remoteUserInfo = {},
  connectionQuality = 'good',
  onToggleMute,
  onToggleCamera,
  onFlipCamera,
  facingMode = 'user',
  onEndCall,
  onReplaceVideoTrack,
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const webglCanvasRef = useRef(null);
  const webglProcessorRef = useRef(null);
  const hairCanvasRef = useRef(null);
  const hairEngineRef = useRef(null);
  const compositeCanvasRef = useRef(null);
  const compositeRafRef = useRef(null);

  const [isPipExpanded, setIsPipExpanded] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [showHairPicker, setShowHairPicker] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [activeFilter, setActiveFilter] = useState('none');
  const [activeHairStyle, setActiveHairStyle] = useState(null);
  const [speakerOff, setSpeakerOff] = useState(false);
  const controlsTimeoutRef = useRef(null);

  // ── Attach local stream to hidden video element ───────────────────
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream]);

  // ── Attach remote stream to video element ─────────────────────────
  useEffect(() => {
    const videoEl = remoteVideoRef.current;
    if (!videoEl || !remoteStream) return;

    videoEl.srcObject = remoteStream;
    // Explicitly play — browsers may pause video when tracks are replaced
    videoEl.play().catch(() => {});

    // When remote replaces their video track, the video element may stall.
    // Listen for track additions and nudge playback.
    const handleTrackAdded = () => {
      videoEl.play().catch(() => {});
    };
    remoteStream.addEventListener('addtrack', handleTrackAdded);

    return () => {
      remoteStream.removeEventListener('addtrack', handleTrackAdded);
    };
  }, [remoteStream]);

  // ── Always attach remote stream to hidden <audio> for sound ───────
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  // ── Auto-hide controls after 4s ───────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (!showFilters && !showHairPicker) setShowControls(false);
    }, 4000);
  }, [showFilters, showHairPicker]);

  useEffect(() => {
    resetControlsTimer();
    return () => clearTimeout(controlsTimeoutRef.current);
  }, []);

  // ── WebGL Filter Engine Lifecycle (same as GoLive) ────────────────
  // Initialize WebGL processor when local stream is available
  useEffect(() => {
    if (!localVideoRef.current || !webglCanvasRef.current || !localStream) return;

    const video = localVideoRef.current;
    const canvas = webglCanvasRef.current;

    // Wait for video metadata to load so we know dimensions
    const initWebGL = () => {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      try {
        const processor = new WebGLVideoProcessor(canvas);
        processor.setFilter(activeFilter === 'none' ? 'none' : activeFilter);
        processor.start(video);
        webglProcessorRef.current = processor;

        // Start a composite canvas that merges WebGL + hair, then send over WebRTC
        if (onReplaceVideoTrack) {
          try {
            if (!compositeCanvasRef.current) {
              compositeCanvasRef.current = document.createElement('canvas');
            }
            const comp = compositeCanvasRef.current;
            comp.width = canvas.width;
            comp.height = canvas.height;
            const ctx = comp.getContext('2d');

            // Composite render loop: WebGL canvas + hair canvas → 2D composite
            const compositeLoop = () => {
              ctx.clearRect(0, 0, comp.width, comp.height);
              ctx.drawImage(canvas, 0, 0, comp.width, comp.height);
              const hc = hairCanvasRef.current;
              if (hc && hc.width > 0 && hc.height > 0) {
                ctx.drawImage(hc, 0, 0, comp.width, comp.height);
              }
              compositeRafRef.current = requestAnimationFrame(compositeLoop);
            };
            compositeRafRef.current = requestAnimationFrame(compositeLoop);

            const compStream = comp.captureStream(30);
            const filteredTrack = compStream.getVideoTracks()[0];
            if (filteredTrack) {
              onReplaceVideoTrack(filteredTrack);
            }
          } catch (capErr) {
            console.warn('[InCallView] composite captureStream failed:', capErr);
          }
        }
      } catch (err) {
        console.error('[InCallView] WebGL init failed:', err);
      }
    };

    if (video.readyState >= 2) {
      initWebGL();
    } else {
      video.addEventListener('loadeddata', initWebGL, { once: true });
    }

    return () => {
      if (compositeRafRef.current) {
        cancelAnimationFrame(compositeRafRef.current);
        compositeRafRef.current = null;
      }
      if (webglProcessorRef.current) {
        webglProcessorRef.current.stop();
        webglProcessorRef.current = null;
      }
    };
  }, [localStream, onReplaceVideoTrack]); // Re-init when stream changes

  // ── Hair Filter Engine Lifecycle ──────────────────────────────────
  useEffect(() => {
    const engine = new HairFilterEngine();
    hairEngineRef.current = engine;
    engine.init().catch(() => {});
    return () => {
      engine.dispose();
      hairEngineRef.current = null;
    };
  }, []);

  // Start hair engine when local stream is available
  useEffect(() => {
    const engine = hairEngineRef.current;
    if (!engine || !localStream) return;
    const videoEl = localVideoRef.current;
    const hairCanvas = hairCanvasRef.current;
    if (videoEl && hairCanvas) {
      const tryStart = () => {
        if (videoEl.readyState >= 1) {
          engine.start(videoEl, hairCanvas);
          return true;
        }
        return false;
      };
      if (!tryStart()) {
        const timer = setInterval(() => {
          if (tryStart()) clearInterval(timer);
        }, 500);
        const timeout = setTimeout(() => clearInterval(timer), 5000);
        return () => { clearInterval(timer); clearTimeout(timeout); engine.stop(); };
      }
      return () => { engine.stop(); };
    }
  }, [localStream]);

  // Update hair style when selection changes
  useEffect(() => {
    const engine = hairEngineRef.current;
    if (engine) engine.setHairStyle(activeHairStyle);
  }, [activeHairStyle]);

  // ── Update WebGL filter when user selects a new one ───────────────
  useEffect(() => {
    if (webglProcessorRef.current) {
      webglProcessorRef.current.setFilter(activeFilter === 'none' ? 'none' : activeFilter);
    }
  }, [activeFilter]);

  // ── Filter selection handler (auto-closes picker) ─────────────────
  const handleSelectFilter = useCallback((key) => {
    setActiveFilter(key);
    setShowFilters(false);
  }, []);

  // ── Hair selection handler (auto-closes picker) ───────────────────
  const handleSelectHairStyle = useCallback((styleId) => {
    setActiveHairStyle(styleId);
    setShowHairPicker(false);
  }, []);

  // ── Control Button Component ──────────────────────────────────────
  const ControlButton = ({ onClick, active, danger, icon: Icon, label, size = 'normal' }) => {
    const sizeClass = size === 'large' ? 'w-14 h-14 md:w-16 md:h-16' : 'w-11 h-11 md:w-12 md:h-12';
    const iconSize = size === 'large' ? 'w-6 h-6 md:w-7 md:h-7' : 'w-5 h-5';
    return (
      <div className="flex flex-col items-center gap-1">
        <button
          onClick={onClick}
          className={`${sizeClass} rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 ${
            danger 
              ? 'bg-red-500 hover:bg-red-400 shadow-lg shadow-red-500/30' 
              : active 
                ? 'bg-cyan-500/20 ring-2 ring-cyan-500/50 backdrop-blur-md' 
                : 'bg-white/10 hover:bg-white/20 backdrop-blur-md'
          }`}
        >
          <Icon className={`${iconSize} ${active ? 'text-cyan-400' : danger ? 'text-white' : 'text-white'}`} />
        </button>
        {label && <span className="text-[9px] md:text-[10px] text-white/50 font-medium">{label}</span>}
      </div>
    );
  };

  return (
    <div 
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-zinc-950 select-none"
      onClick={resetControlsTimer}
    >
      {/* Hidden audio element for remote stream */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="relative w-full h-full md:w-[calc(100%-48px)] md:h-[calc(100%-48px)] md:max-w-[1100px] md:max-h-[700px] md:rounded-2xl overflow-hidden flex flex-col shadow-2xl shadow-black/50">

        {/* ── Video Area ── */}
        <div className="flex-1 relative overflow-hidden bg-black">
          {callType === 'video' && remoteStream ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-contain bg-zinc-950"
            />
          ) : (
            /* Audio-only: avatar + waveform */
            <div className="w-full h-full flex flex-col items-center justify-center"
              style={{
                background: 'radial-gradient(ellipse at 30% 20%, rgba(6,182,212,0.08) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(99,102,241,0.06) 0%, transparent 50%), linear-gradient(135deg, #0a0e1a 0%, #0d1f3c 40%, #0a1628 100%)',
              }}
            >
              <div className="relative">
                <div className="absolute inset-0 -m-4 rounded-full border-2 border-cyan-400/20 animate-ping" style={{ animationDuration: '2s' }} />
                <div className="absolute inset-0 -m-2 rounded-full border border-cyan-400/10" />
                <div className="w-28 h-28 md:w-32 md:h-32 rounded-full overflow-hidden ring-4 ring-cyan-400/30 shadow-[0_0_60px_rgba(6,182,212,0.2)]">
                  {remoteUserInfo.avatar ? (
                    <img src={remoteUserInfo.avatar} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                      <span className="text-3xl md:text-4xl text-white font-bold">
                        {remoteUserInfo.name?.charAt(0)?.toUpperCase() || '?'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <h3 className="text-white text-lg md:text-xl font-semibold mt-5 mb-1">{remoteUserInfo.name || 'User'}</h3>
              <p className="text-white/40 text-sm mb-4">Audio Call</p>
              <div className="flex items-end gap-[3px] h-8">
                {[...Array(9)].map((_, i) => (
                  <div
                    key={i}
                    className="w-[3px] bg-gradient-to-t from-cyan-500 to-cyan-300 rounded-full"
                    style={{
                      height: `${8 + Math.random() * 24}px`,
                      animation: `waveform 0.6s ease-in-out ${i * 0.08}s infinite alternate`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Top Overlay ── */}
          <div 
            className={`absolute top-0 left-0 right-0 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 60%, transparent 100%)' }}
          >
            <div className="flex items-center justify-between px-3 md:px-4 py-2.5 md:py-3">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 rounded-full bg-white/10 backdrop-blur-md">
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-white text-[11px] md:text-xs font-mono tabular-nums">
                    {formatDuration(callDuration)}
                  </span>
                </div>
                <ConnectionQualityBadge quality={connectionQuality} />
              </div>
              <span className="text-white/60 text-[11px] md:text-xs px-2 py-1 rounded-full bg-white/5 backdrop-blur-md">
                {callType === 'video' ? '📹 Video' : '🎙️ Audio'}
              </span>
            </div>

            {/* Remote user name bar */}
            <div className="px-3 md:px-4 pb-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 md:w-8 md:h-8 rounded-full overflow-hidden ring-2 ring-white/20">
                  {remoteUserInfo.avatar ? (
                    <img src={remoteUserInfo.avatar} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                      <span className="text-[10px] md:text-xs text-white font-bold">
                        {remoteUserInfo.name?.charAt(0)?.toUpperCase() || '?'}
                      </span>
                    </div>
                  )}
                </div>
                <span className="text-white text-sm font-medium">{remoteUserInfo.name || 'User'}</span>
              </div>
            </div>
          </div>

          {/* Side buttons removed — filter/hair toggles moved to bottom bar for always-visible access */}

          {/* ── Local Video PIP — positioned top-right to avoid overlap with controls on iPhone 16 ── */}
          {callType === 'video' && localStream && (
            <div 
              className={`absolute transition-all duration-300 overflow-hidden shadow-2xl cursor-pointer z-10 ${
                showControls ? 'opacity-100' : 'opacity-70'
              } ${
                isPipExpanded 
                  ? 'top-[env(safe-area-inset-top,44px)] right-3 md:top-4 md:right-4 w-[100px] h-[140px] md:w-40 md:h-52 rounded-2xl border-2 border-white/20' 
                  : 'top-[env(safe-area-inset-top,44px)] right-3 md:top-4 md:right-4 w-14 h-14 md:w-24 md:h-32 rounded-full md:rounded-2xl border-2 border-white/20'
              }`}
              style={{ marginTop: isPipExpanded ? '52px' : '52px' }}
              onClick={(e) => { e.stopPropagation(); setIsPipExpanded(!isPipExpanded); }}
            >
              {isCameraOff ? (
                <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                  <VideoOff className="w-5 h-5 text-zinc-500" />
                </div>
              ) : (
                <>
                <div className="w-full h-full relative">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ display: 'none' }}
                  />
                  <canvas
                    ref={webglCanvasRef}
                    className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
                  />
                  <canvas
                    ref={hairCanvasRef}
                    className={`absolute inset-0 w-full h-full object-cover pointer-events-none ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
                  />
                </div>
                <div className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/50 backdrop-blur-sm ${!isPipExpanded ? 'hidden md:block' : ''}`}>
                  <span className="text-[9px] text-white/70 font-medium">You</span>
                </div>
                {activeFilter !== 'none' && isPipExpanded && (
                  <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-cyan-500/30 backdrop-blur-sm">
                    <span className="text-[8px] text-cyan-300 font-medium">
                      {FILTER_PRESETS.find(f => f.key === activeFilter)?.name || ''}
                    </span>
                  </div>
                )}
                <div className={`absolute bottom-1.5 right-1.5 ${!isPipExpanded ? 'hidden md:block' : ''}`}>
                  {isPipExpanded ? <Minimize2 className="w-3 h-3 text-white/60" /> : <Maximize2 className="w-3 h-3 text-white/60" />}
                </div>
                </>
              )}
            </div>
          )}

          {/* ── Filter Picker Panel ── */}
          <FilterPicker
            isOpen={showFilters}
            onClose={() => setShowFilters(false)}
            activeFilter={activeFilter}
            onSelectFilter={handleSelectFilter}
          />

          {/* ── Hair Filter Picker Panel ── */}
          {showHairPicker && (
            <div className="fixed left-3 top-20 bottom-auto z-[9999]" onClick={(e) => e.stopPropagation()}>
              <HairFilterPicker
                isOpen={showHairPicker}
                onClose={() => setShowHairPicker(false)}
                activeStyleId={activeHairStyle}
                onSelectHair={handleSelectHairStyle}
                colors={CALL_COLORS}
              />
            </div>
          )}
        </div>

        {/* ── Bottom Controls Bar — always visible, includes filter toggles ── */}
        <div 
          className="flex-shrink-0 bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}
        >
          <div className="flex items-end justify-center gap-3 md:gap-5 py-3 md:py-4 px-3 md:px-4">
            <ControlButton
              onClick={onToggleMute}
              active={isMuted}
              icon={isMuted ? MicOff : Mic}
              label={isMuted ? 'Unmute' : 'Mute'}
            />

            {callType === 'video' && (
              <ControlButton
                onClick={onToggleCamera}
                active={isCameraOff}
                icon={isCameraOff ? VideoOff : Video}
                label={isCameraOff ? 'Camera On' : 'Camera Off'}
              />
            )}

            {/* Flip Camera — only shown during video calls when camera is on */}
            {callType === 'video' && !isCameraOff && onFlipCamera && (
              <ControlButton
                onClick={onFlipCamera}
                active={facingMode === 'environment'}
                icon={SwitchCamera}
                label="Flip"
              />
            )}

            {/* Filter toggle — always visible in bottom bar */}
            {callType === 'video' && (
              <ControlButton
                onClick={() => { setShowFilters(f => !f); setShowHairPicker(false); }}
                active={showFilters || activeFilter !== 'none'}
                icon={Sparkles}
                label="Filters"
              />
            )}

            {/* Hair toggle — always visible in bottom bar */}
            {callType === 'video' && (
              <ControlButton
                onClick={() => { setShowHairPicker(h => !h); setShowFilters(false); }}
                active={showHairPicker || !!activeHairStyle}
                icon={Scissors}
                label="Hair"
              />
            )}

            <ControlButton
              onClick={() => {
                const newMuted = !speakerOff;
                // Disable audio tracks on the remote stream — this is the most
                // reliable cross-browser approach (same pattern as toggleMute
                // for the mic). Element-level .muted can be reset by .play().
                if (remoteStream) {
                  remoteStream.getAudioTracks().forEach(track => {
                    track.enabled = !newMuted;
                  });
                }
                // Also set element-level muted as a belt-and-suspenders fallback
                if (remoteAudioRef.current) remoteAudioRef.current.muted = newMuted;
                if (remoteVideoRef.current) remoteVideoRef.current.muted = newMuted;
                setSpeakerOff(newMuted);
              }}
              active={speakerOff}
              icon={speakerOff ? VolumeX : Volume2}
              label={speakerOff ? 'Speaker On' : 'Speaker'}
            />

            <ControlButton
              onClick={onEndCall}
              danger
              icon={PhoneOff}
              label="End"
              size="large"
            />
          </div>
        </div>

      </div>

      {/* ── CSS Animations ── */}
      <style>{`
        @keyframes waveform {
          0% { height: 6px; }
          100% { height: 28px; }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
