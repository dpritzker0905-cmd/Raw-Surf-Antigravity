/**
 * InCallView — Premium active call overlay.
 * 
 * FILTER IMPLEMENTATION — Matches GoLive exactly:
 *   - Uses CSS filter property (brightness/contrast/saturate/hue-rotate)
 *   - Presets map to slider values (same as GoLive VideoFilterPanel)
 *   - Applied via inline style={{ filter: '...' }} on the video element
 *   - No WebGL, no canvas, no pipeline teardown issues
 *
 * REMOTE VIDEO:
 *   - object-contain to prevent face cropping
 *   - Dark background for letterboxing
 * 
 * HAIR FILTERS:
 *   - Uses HairFilterPicker component (same as GoLive)
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { 
  Mic, MicOff, Video, VideoOff, PhoneOff, 
  Volume2, Maximize2, Minimize2, Signal, SignalLow, SignalZero,
  Sparkles, X, Scissors,
  Sunset, Waves, Moon, Zap, Eye, Grid, CircleDot
} from 'lucide-react';
import { HairFilterPicker } from '../HairFilterPicker';

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

// ── Filter Presets (same values as GoLive VideoFilterPanel) ─────────
const FILTER_PRESETS = [
  { 
    name: 'None', key: 'none', icon: CircleDot, description: 'Original camera',
    values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100 }
  },
  { 
    name: 'Golden Hour', key: 'goldenhour', icon: Sunset, description: 'Warm sunset vibes',
    values: { brightness: 105, contrast: 110, saturation: 120, warmth: 120 }
  },
  { 
    name: 'Pipeline', key: 'pipeline', icon: Waves, description: 'Deep barrel shadows',
    values: { brightness: 90, contrast: 130, saturation: 90, warmth: 110 }
  },
  { 
    name: 'Night Vision', key: 'nightvision', icon: Eye, description: 'Tactical green overlay',
    values: { brightness: 140, contrast: 130, saturation: 0, warmth: 170 }
  },
  { 
    name: 'Pixelate', key: 'pixelate', icon: Grid, description: 'Retro lo-fi aesthetic',
    values: { brightness: 95, contrast: 180, saturation: 30, warmth: 100 }
  },
  { 
    name: 'Bio-Lum', key: 'bioluminescence', icon: Moon, description: 'Neon glowing edges',
    values: { brightness: 85, contrast: 140, saturation: 150, warmth: 160 }
  },
  { 
    name: 'Cyber-Surf', key: 'cyber', icon: Zap, description: 'Hyper-cold glitch lens',
    values: { brightness: 110, contrast: 125, saturation: 140, warmth: 40 }
  },
];

// ── Build CSS filter string from preset values (same logic as GoLive) ──
function buildCSSFilter(values) {
  if (!values) return 'none';
  
  // Warmth → hue-rotate mapping (exact GoLive logic)
  let warmthDegrees = (values.warmth - 100) * 0.8;
  if (values.warmth >= 150) warmthDegrees = 300; // Neon blue/purple
  if (values.warmth <= 50) warmthDegrees = 180;  // Negative inversion
  
  return `brightness(${values.brightness}%) contrast(${values.contrast}%) saturate(${values.saturation}%) hue-rotate(${warmthDegrees}deg)`;
}

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
      className="absolute left-3 top-20 w-60 max-h-[55vh] overflow-y-auto p-3 rounded-2xl bg-black/80 backdrop-blur-xl border border-white/10 z-50"
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
  onEndCall,
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const [isPipExpanded, setIsPipExpanded] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [showHairPicker, setShowHairPicker] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [activeFilter, setActiveFilter] = useState('none');
  const [activeHairStyle, setActiveHairStyle] = useState(null);
  const controlsTimeoutRef = useRef(null);

  // ── Attach local stream to video element ──────────────────────────
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // ── Attach remote stream to video element ─────────────────────────
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
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

  // ── Build CSS filter style — exact GoLive pattern ─────────────────
  const videoFilterStyle = useMemo(() => {
    const preset = FILTER_PRESETS.find(p => p.key === activeFilter);
    if (!preset || activeFilter === 'none') return {};
    return { filter: buildCSSFilter(preset.values) };
  }, [activeFilter]);

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

          {/* ── Side Buttons (video calls only) ── */}
          {callType === 'video' && (
            <div className={`absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-10 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowFilters(f => !f); setShowHairPicker(false); }}
                className={`p-2.5 md:p-3 rounded-full bg-black/40 backdrop-blur-md border border-white/10 transition-all active:scale-95 shadow-md ${
                  showFilters ? 'bg-cyan-500/30 border-cyan-500/50' : activeFilter !== 'none' ? 'bg-cyan-500/20 border-cyan-500/30' : ''
                }`}
                title="Surf Filters"
              >
                <Sparkles className={`w-5 h-5 ${showFilters || activeFilter !== 'none' ? 'text-cyan-300' : 'text-white/80'}`} />
              </button>

              <button
                onClick={(e) => { e.stopPropagation(); setShowHairPicker(h => !h); setShowFilters(false); }}
                className={`p-2.5 md:p-3 rounded-full bg-black/40 backdrop-blur-md border border-white/10 transition-all active:scale-95 shadow-md ${
                  showHairPicker ? 'bg-yellow-500/30 border-yellow-500/50' : activeHairStyle ? 'bg-yellow-500/20 border-yellow-500/30' : ''
                }`}
                title="Surfer Hair"
              >
                <Scissors className={`w-5 h-5 ${showHairPicker || activeHairStyle ? 'text-yellow-300' : 'text-white/80'}`} />
              </button>
            </div>
          )}

          {/* ── Local Video PIP ── */}
          {callType === 'video' && localStream && (
            <div 
              className={`absolute transition-all duration-300 overflow-hidden shadow-2xl cursor-pointer z-10 ${
                showControls ? 'opacity-100' : 'opacity-70'
              } ${
                isPipExpanded 
                  ? 'bottom-3 left-3 md:bottom-4 md:right-4 md:left-auto w-[120px] h-[160px] md:w-44 md:h-56 rounded-2xl border-2 border-white/20' 
                  : 'bottom-3 left-3 md:bottom-4 md:right-4 md:left-auto w-16 h-16 md:w-28 md:h-36 rounded-full md:rounded-2xl border-2 border-white/20'
              }`}
              onClick={(e) => { e.stopPropagation(); setIsPipExpanded(!isPipExpanded); }}
            >
              {isCameraOff ? (
                <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                  <VideoOff className="w-5 h-5 text-zinc-500" />
                </div>
              ) : (
                /* Local video with CSS filter applied directly — same as GoLive */
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ 
                    transform: 'scaleX(-1)',
                    ...videoFilterStyle,
                  }}
                />
              )}
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
            <div className="absolute left-3 top-20 z-50" onClick={(e) => e.stopPropagation()}>
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

        {/* ── Bottom Controls Bar ── */}
        <div 
          className={`flex-shrink-0 transition-all duration-300 bg-zinc-950 border-t border-zinc-800 ${showControls ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}
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

            <ControlButton
              onClick={() => {}}
              icon={Volume2}
              label="Speaker"
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
