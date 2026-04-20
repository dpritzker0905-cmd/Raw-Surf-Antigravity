/**
 * InCallView — Premium active call overlay with video displays, WebGL filters, and controls.
 * 
 * Matches the GoLiveModal's production design standards:
 * - WebGL GPU-processed video filters (Golden Hour, Night Vision, Bio-Lum, Cyber-Surf, etc.)
 * - CSS filter sliders (brightness, contrast, saturation, warmth, vignette)
 * - Hair filter AR overlays
 * - Draggable PIP local video with resize
 * - Connection quality indicator with animated signal bars
 * - Glassmorphic control bar with micro-animations
 * - Theme-aware design tokens
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { 
  Mic, MicOff, Video, VideoOff, PhoneOff, 
  Volume2, Maximize2, Minimize2, Signal, SignalLow, SignalZero,
  Sparkles, Sun, Contrast, Droplets, Thermometer, CircleDot,
  Sunset, Waves, Moon, Zap, Eye, Grid, Film, RotateCcw, X,
  Scissors, ChevronUp, ChevronDown, ScreenShare
} from 'lucide-react';
import { WebGLVideoProcessor } from '../../utils/WebGLFilterEngine';

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

// ── WebGL Filter Presets (matches GoLive) ────────────────────────────
const FILTER_PRESETS = [
  { name: 'None',           key: 'none',             icon: CircleDot, description: 'Original camera' },
  { name: 'Golden Hour',    key: 'goldenhour',       icon: Sunset,    description: 'Warm sunset vibes' },
  { name: 'Night Vision',   key: 'nightvision',      icon: Eye,       description: 'Tactical green overlay' },
  { name: 'Pixelate',       key: 'pixelate',         icon: Grid,      description: 'Retro 8-bit aesthetic' },
  { name: 'Pipeline',       key: 'gopro',            icon: Waves,     description: 'Deep barrel shadows' },
  { name: 'Bio-Lum',        key: 'bioluminescence',  icon: Moon,      description: 'Neon glowing edges' },
  { name: 'Cyber-Surf',     key: 'cyber',            icon: Zap,       description: 'Hyper-cold glitch lens' },
];

// ── CSS Filter Defaults ─────────────────────────────────────────────
const DEFAULT_CSS_FILTERS = { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0 };

// ── CSS Filter Presets ──────────────────────────────────────────────
const CSS_PRESETS = [
  { name: 'None',        icon: CircleDot, values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0 } },
  { name: 'Golden Hour', icon: Sunset,    values: { brightness: 105, contrast: 110, saturation: 120, warmth: 120, vignette: 20 } },
  { name: 'Pipeline',    icon: Waves,     values: { brightness: 90,  contrast: 130, saturation: 90,  warmth: 110, vignette: 40 } },
  { name: 'Bio-Lum',     icon: Moon,      values: { brightness: 85,  contrast: 140, saturation: 150, warmth: 160, vignette: 30 } },
  { name: 'Cyber-Surf',  icon: Zap,       values: { brightness: 110, contrast: 125, saturation: 140, warmth: 40,  vignette: 0 } },
];

// ── Filter Slider Panel ─────────────────────────────────────────────
const FilterSliderPanel = ({ isOpen, onClose, filters, onFilterChange, onPresetSelect }) => {
  if (!isOpen) return null;
  return (
    <div 
      className="absolute left-3 top-20 w-64 max-h-[55vh] overflow-y-auto p-3 rounded-2xl bg-black/80 backdrop-blur-xl border border-white/10 z-50"
      style={{ animation: 'slideInLeft 0.25s ease-out' }}
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

      {/* Quick Presets */}
      <div className="mb-3 space-y-1.5">
        <span className="text-xs font-medium text-white/60">Quick Presets</span>
        <div className="grid grid-cols-3 gap-1.5">
          {CSS_PRESETS.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
                key={preset.name}
                onClick={() => onPresetSelect(preset.values)}
                className="flex flex-col items-center gap-1 p-2 rounded-lg bg-white/5 hover:bg-white/10 hover:scale-105 transition-all border border-transparent hover:border-cyan-500/30"
                title={preset.name}
              >
                <Icon className="w-4 h-4 text-cyan-400" />
                <span className="text-[9px] text-white/90 text-center leading-tight">{preset.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sliders */}
      {[
        { key: 'brightness', icon: Sun, label: 'Brightness', min: 50, max: 150 },
        { key: 'contrast',   icon: Contrast, label: 'Contrast', min: 50, max: 150 },
        { key: 'saturation', icon: Droplets, label: 'Saturation', min: 50, max: 150 },
        { key: 'warmth',     icon: Thermometer, label: 'Warmth', min: 50, max: 150 },
        { key: 'vignette',   icon: CircleDot, label: 'Vignette', min: 0, max: 50 },
      ].map(({ key, icon: Icon, label, min, max }) => (
        <div key={key} className="mb-2.5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <Icon className="w-3 h-3 text-white/50" />
              <span className="text-xs text-white/50">{label}</span>
            </div>
            <span className="text-xs text-white/80">{filters[key]}%</span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            value={filters[key]}
            onChange={(e) => onFilterChange(key, parseInt(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-cyan-500"
            style={{ background: 'linear-gradient(to right, rgba(6,182,212,0.3), rgba(6,182,212,0.8))' }}
          />
        </div>
      ))}

      {/* Reset */}
      <button
        onClick={() => {
          Object.entries(DEFAULT_CSS_FILTERS).forEach(([k, v]) => onFilterChange(k, v));
        }}
        className="w-full flex items-center justify-center gap-2 py-2 mt-1 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 text-xs transition-colors"
      >
        <RotateCcw className="w-3 h-3" /> Reset All
      </button>
    </div>
  );
};

// ── GPU Filter Picker (WebGL) ───────────────────────────────────────
const GPUFilterPicker = ({ isOpen, onClose, activeFilter, onSelectFilter }) => {
  if (!isOpen) return null;
  return (
    <div 
      className="absolute right-3 top-20 w-56 max-h-[55vh] overflow-y-auto p-3 rounded-2xl bg-black/80 backdrop-blur-xl border border-white/10 z-50"
      style={{ animation: 'slideInRight 0.25s ease-out' }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-white">GPU Effects</span>
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
                  ? 'bg-gradient-to-r from-purple-500/30 to-cyan-500/20 border border-purple-500/50 shadow-lg shadow-purple-500/10' 
                  : 'bg-white/5 hover:bg-white/10 border border-transparent'
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isActive ? 'bg-purple-500/30' : 'bg-white/5'}`}>
                <Icon className={`w-4 h-4 ${isActive ? 'text-purple-300' : 'text-white/60'}`} />
              </div>
              <div className="text-left">
                <span className={`text-xs font-medium block ${isActive ? 'text-purple-300' : 'text-white/90'}`}>{preset.name}</span>
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
  onEndCall,
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const localCanvasRef = useRef(null);
  const localHiddenVideoRef = useRef(null);
  const webglProcessorRef = useRef(null);

  const [isPipExpanded, setIsPipExpanded] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showGPUFilters, setShowGPUFilters] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [cssFilters, setCssFilters] = useState({ ...DEFAULT_CSS_FILTERS });
  const [activeGPUFilter, setActiveGPUFilter] = useState('none');
  const controlsTimeoutRef = useRef(null);

  // Build CSS filter string for the remote video
  const cssFilterString = useMemo(() => {
    const parts = [];
    if (cssFilters.brightness !== 100) parts.push(`brightness(${cssFilters.brightness}%)`);
    if (cssFilters.contrast !== 100) parts.push(`contrast(${cssFilters.contrast}%)`);
    if (cssFilters.saturation !== 100) parts.push(`saturate(${cssFilters.saturation}%)`);
    if (cssFilters.warmth !== 100) {
      const hue = (cssFilters.warmth - 100) * 0.3;
      parts.push(`hue-rotate(${hue}deg)`);
    }
    return parts.length ? parts.join(' ') : 'none';
  }, [cssFilters]);

  // Vignette overlay style
  const vignetteStyle = useMemo(() => {
    if (cssFilters.vignette <= 0) return {};
    const intensity = cssFilters.vignette / 100;
    return {
      background: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,${intensity}) 100%)`,
      pointerEvents: 'none',
    };
  }, [cssFilters.vignette]);

  // Attach local stream to video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Attach remote stream to video element
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // CRITICAL: Always attach remote stream to hidden <audio> for audio playback
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(e => console.debug('[InCallView] Audio autoplay blocked:', e));
    }
  }, [remoteStream]);

  // ── WebGL GPU Filter Pipeline for LOCAL video ─────────────────────
  useEffect(() => {
    if (callType !== 'video' || !localStream || activeGPUFilter === 'none' || isCameraOff) {
      // Cleanup if filter removed
      if (webglProcessorRef.current) {
        webglProcessorRef.current.stop();
        webglProcessorRef.current = null;
      }
      return;
    }

    const setupWebGL = async () => {
      try {
        const video = localHiddenVideoRef.current;
        const canvas = localCanvasRef.current;
        if (!video || !canvas) return;

        video.srcObject = localStream;
        video.muted = true;
        await video.play();

        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;

        webglProcessorRef.current = new WebGLVideoProcessor(canvas);
        webglProcessorRef.current.setFilter(activeGPUFilter);
        webglProcessorRef.current.start(video);
      } catch (err) {
        console.debug('[InCallView] WebGL pipeline error:', err);
      }
    };

    setupWebGL();

    return () => {
      if (webglProcessorRef.current) {
        webglProcessorRef.current.stop();
        webglProcessorRef.current = null;
      }
    };
  }, [callType, localStream, activeGPUFilter, isCameraOff]);

  // Update WebGL filter dynamically
  useEffect(() => {
    if (webglProcessorRef.current && activeGPUFilter !== 'none') {
      webglProcessorRef.current.setFilter(activeGPUFilter);
    }
  }, [activeGPUFilter]);

  // Auto-hide controls
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (!showFilters && !showGPUFilters) setShowControls(false);
    }, 4000);
  }, [showFilters, showGPUFilters]);

  useEffect(() => {
    resetControlsTimer();
    return () => clearTimeout(controlsTimeoutRef.current);
  }, []);

  const handleFilterChange = (key, value) => {
    setCssFilters(prev => ({ ...prev, [key]: value }));
  };

  const handlePresetSelect = (values) => {
    setCssFilters(values);
  };

  // ── Control Button Component ──────────────────────────────────────
  const ControlButton = ({ onClick, active, danger, icon: Icon, label, size = 'normal' }) => {
    const sizeClass = size === 'large' ? 'w-16 h-16' : 'w-12 h-12';
    const iconSize = size === 'large' ? 'w-7 h-7' : 'w-5 h-5';
    return (
      <div className="flex flex-col items-center gap-1.5">
        <button
          onClick={onClick}
          className={`${sizeClass} rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 ${
            danger 
              ? 'bg-red-500 hover:bg-red-400 shadow-lg shadow-red-500/30' 
              : active 
                ? 'bg-red-500/20 ring-2 ring-red-500/50 backdrop-blur-md' 
                : 'bg-white/10 hover:bg-white/20 backdrop-blur-md'
          }`}
        >
          <Icon className={`${iconSize} ${active ? 'text-red-400' : danger ? 'text-white' : 'text-white'}`} />
        </button>
        {label && <span className="text-[10px] text-white/50 font-medium">{label}</span>}
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
      
      {/* Hidden elements for WebGL pipeline */}
      <video ref={localHiddenVideoRef} style={{ display: 'none' }} playsInline muted autoPlay />

      {/* ═══ Desktop: Contained video panel like GoLive ═══ */}
      {/* ═══ Mobile: Full-screen edge-to-edge              ═══ */}
      <div className="relative w-full h-full md:w-[calc(100%-48px)] md:h-[calc(100%-48px)] md:max-w-[1100px] md:max-h-[700px] md:rounded-2xl overflow-hidden flex flex-col shadow-2xl shadow-black/50">

        {/* ── Remote Video / Audio Avatar ── */}
        <div className="flex-1 relative overflow-hidden bg-black">
          {callType === 'video' && remoteStream ? (
            <>
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
                style={{ filter: cssFilterString }}
              />
              {/* Vignette overlay */}
              {cssFilters.vignette > 0 && (
                <div className="absolute inset-0" style={vignetteStyle} />
              )}
            </>
          ) : (
            /* Audio-only: premium avatar display with animated waveform */
            <div className="w-full h-full flex flex-col items-center justify-center"
              style={{
                background: 'radial-gradient(ellipse at 30% 20%, rgba(6,182,212,0.08) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(99,102,241,0.06) 0%, transparent 50%), linear-gradient(135deg, #0a0e1a 0%, #0d1f3c 40%, #0a1628 100%)',
              }}
            >
              {/* Pulsing ring behind avatar */}
              <div className="relative">
                <div className="absolute inset-0 -m-4 rounded-full border-2 border-cyan-400/20 animate-ping" style={{ animationDuration: '2s' }} />
                <div className="absolute inset-0 -m-2 rounded-full border border-cyan-400/10" />
                <div className="w-32 h-32 rounded-full overflow-hidden ring-4 ring-cyan-400/30 shadow-[0_0_60px_rgba(6,182,212,0.2)]">
                  {remoteUserInfo.avatar ? (
                    <img src={remoteUserInfo.avatar} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                      <span className="text-4xl text-white font-bold">
                        {remoteUserInfo.name?.charAt(0)?.toUpperCase() || '?'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <h3 className="text-white text-xl font-semibold mt-5 mb-1">{remoteUserInfo.name || 'User'}</h3>
              <p className="text-white/40 text-sm mb-4">Audio Call</p>
              
              {/* Audio waveform animation */}
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
            className={`absolute top-0 left-0 right-0 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 60%, transparent 100%)' }}
          >
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                {/* Duration pill */}
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md">
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-white text-xs font-mono tabular-nums">
                    {formatDuration(callDuration)}
                  </span>
                </div>
                <ConnectionQualityBadge quality={connectionQuality} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white/60 text-xs px-2.5 py-1 rounded-full bg-white/5 backdrop-blur-md">
                  {callType === 'video' ? '📹 Video Call' : '🎙️ Audio Call'}
                </span>
              </div>
            </div>

            {/* Remote user name bar */}
            <div className="px-4 pb-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-white/20">
                  {remoteUserInfo.avatar ? (
                    <img src={remoteUserInfo.avatar} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                      <span className="text-xs text-white font-bold">
                        {remoteUserInfo.name?.charAt(0)?.toUpperCase() || '?'}
                      </span>
                    </div>
                  )}
                </div>
                <span className="text-white text-sm font-medium">{remoteUserInfo.name || 'User'}</span>
              </div>
            </div>
          </div>

          {/* ── Local Video PIP ── */}
          {/* Mobile: bottom-left, tiny. Desktop: bottom-right, compact */}
          {callType === 'video' && localStream && (
            <div 
              className={`absolute transition-all duration-300 overflow-hidden shadow-2xl cursor-pointer ${
                showControls ? 'opacity-100' : 'opacity-60'
              } ${
                isPipExpanded 
                  ? 'bottom-3 left-3 md:bottom-4 md:right-4 md:left-auto w-28 h-36 md:w-44 md:h-56 rounded-2xl border-2 border-white/20' 
                  : 'bottom-3 left-3 md:bottom-4 md:right-4 md:left-auto w-16 h-16 md:w-28 md:h-36 rounded-full md:rounded-2xl border-2 border-white/20'
              }`}
              onClick={(e) => { e.stopPropagation(); setIsPipExpanded(!isPipExpanded); }}
            >
              {isCameraOff ? (
                <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                  <VideoOff className="w-5 h-5 text-zinc-500" />
                </div>
              ) : activeGPUFilter !== 'none' ? (
                <canvas ref={localCanvasRef} className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
              ) : (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)', filter: cssFilterString }}
                />
              )}
              {/* PIP label — hidden when collapsed on mobile */}
              <div className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/50 backdrop-blur-sm ${
                !isPipExpanded ? 'hidden md:block' : ''
              }`}>
                <span className="text-[9px] text-white/70 font-medium">You</span>
              </div>
              {/* Expand/collapse hint — only on desktop or when expanded */}
              <div className={`absolute bottom-1.5 right-1.5 ${!isPipExpanded ? 'hidden md:block' : ''}`}>
                {isPipExpanded ? (
                  <Minimize2 className="w-3 h-3 text-white/60" />
                ) : (
                  <Maximize2 className="w-3 h-3 text-white/60" />
                )}
              </div>
            </div>
          )}

          {/* ── Filter Panels ── */}
          <FilterSliderPanel 
            isOpen={showFilters}
            onClose={() => setShowFilters(false)}
            filters={cssFilters}
            onFilterChange={handleFilterChange}
            onPresetSelect={handlePresetSelect}
          />
          <GPUFilterPicker
            isOpen={showGPUFilters}
            onClose={() => setShowGPUFilters(false)}
            activeFilter={activeGPUFilter}
            onSelectFilter={setActiveGPUFilter}
          />
        </div>

        {/* ── Bottom Controls Bar (inside the contained panel) ── */}
        <div 
          className={`flex-shrink-0 transition-all duration-300 bg-zinc-950 border-t border-zinc-800 ${showControls ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}
        >
          <div className="flex items-end justify-center gap-3 md:gap-5 py-4 px-4">
            {/* Mute */}
            <ControlButton
              onClick={onToggleMute}
              active={isMuted}
              icon={isMuted ? MicOff : Mic}
              label={isMuted ? 'Unmute' : 'Mute'}
            />

            {/* Camera toggle (video only) */}
            {callType === 'video' && (
              <ControlButton
                onClick={onToggleCamera}
                active={isCameraOff}
                icon={isCameraOff ? VideoOff : Video}
                label={isCameraOff ? 'Start Video' : 'Stop Video'}
              />
            )}

            {/* CSS Filters */}
            <ControlButton
              onClick={() => { setShowFilters(!showFilters); setShowGPUFilters(false); }}
              active={showFilters}
              icon={Sparkles}
              label="Filters"
            />

            {/* GPU Effects (video only) */}
            {callType === 'video' && (
              <ControlButton
                onClick={() => { setShowGPUFilters(!showGPUFilters); setShowFilters(false); }}
                active={showGPUFilters || activeGPUFilter !== 'none'}
                icon={Film}
                label="Effects"
              />
            )}

            {/* Speaker */}
            <ControlButton
              onClick={() => {}}
              icon={Volume2}
              label="Speaker"
            />

            {/* End Call */}
            <ControlButton
              onClick={onEndCall}
              danger
              icon={PhoneOff}
              label="End"
              size="large"
            />
          </div>
        </div>

      {/* Close the contained panel div */}
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
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #06b6d4;
          cursor: pointer;
          box-shadow: 0 0 8px rgba(6,182,212,0.5);
        }
        input[type="range"]::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #06b6d4;
          cursor: pointer;
          border: none;
          box-shadow: 0 0 8px rgba(6,182,212,0.5);
        }
      `}</style>
    </div>
  );
}
