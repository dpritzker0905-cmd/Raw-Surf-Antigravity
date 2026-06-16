import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Wind, Waves, CloudRain, Snowflake, Thermometer, Lock, ChevronDown, ChevronUp, X, Cloud, Globe, Play, Pause, SkipBack, SkipForward, Sun } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { getAllowedModels, resolveForecastWindow } from './LayerAccessResolver';
import { BASE_CUSTOM_COLOR_SCALES, applyThemePressureScale, applyThemeWaveScale } from './mapUtils';

// Convert meters to feet
const M_TO_FT = 3.28084;

/**
 * Build a CSS linear-gradient string from RGBA color array + breakpoints.
 * Colors are positioned proportionally along the gradient.
 */
function buildGradientCSS(scale) {
  if (!scale?.colors?.length || !scale?.breakpoints?.length) return 'linear-gradient(to right, #888, #888)';
  const colors = scale.colors;
  const bp = scale.breakpoints;
  const maxBp = bp[bp.length - 1];
  const minBp = bp[0];
  const range = maxBp - minBp || 1;

  const stops = colors.map((c, i) => {
    const pct = ((bp[i] - minBp) / range) * 100;
    return `rgba(${c[0]},${c[1]},${c[2]},${Math.min(c[3] + 0.2, 1).toFixed(2)}) ${pct.toFixed(1)}%`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/**
 * Build legend stops (labels) from breakpoints. Converts meters to feet for wave variables.
 */
function buildStops(scale, layerId) {
  if (!scale?.breakpoints?.length) return [];
  const isFeet = scale.unit === 'm' && ['wave_height', 'wave', 'swell_wave_height', 'secondary_swell_wave_height', 'wind_wave_height'].includes(layerId);
  return scale.breakpoints.map((bp, i) => {
    const val = isFeet ? bp * M_TO_FT : bp;
    const isLast = i === scale.breakpoints.length - 1;
    // Round nicely
    const display = val < 1 ? val.toFixed(1) : Math.round(val);
    return isLast ? `${display}+` : `${display}`;
  });
}

/**
 * Compact weather controls chip-based layer selector + integrated timeline.
 * Mobile: renders as a slim bottom-sheet panel.
 * Desktop: renders as a collapsible sidebar card.
 */
export var MapWeatherControls = ({
  isDesktop = true,
  isMobileExpanded = false,
  activeModel,
  onModelChange,
  activeLayers,
  onLayerToggle,
  userTier = 'tier_1',
  onUpgradeClick,
  onClose,
  
  // Timeline props
  radarMode = false,
  radarFrames = [],
  radarFrameIndex = 0,
  onRadarFrameChange,
  currentTimeOffset = 0,
  onTimeChange,
  isPlaying = false,
  onTogglePlay,
  isTimelineCollapsed = false,
  onTimelineCollapseToggle,
  isImmersiveMode = false,
}) => {
  const { theme } = useTheme();
  const [isCollapsed, setIsCollapsed] = useState(false);
  // Remove local isTimelineCollapsed since we lift it up, or use the prop directly if provided.
  const [localTimelineCollapsed, setLocalTimelineCollapsed] = useState(false);

  useEffect(() => {
    setIsCollapsed(isImmersiveMode);
  }, [isImmersiveMode]);
  
  const collapsedState = onTimelineCollapseToggle ? isTimelineCollapsed : localTimelineCollapsed;
  const setCollapsedState = onTimelineCollapseToggle || setLocalTimelineCollapsed;

  const isLight = theme === 'light';
  const isBeach = theme === 'beach';

  const bgClass = isLight
    ? 'bg-white/95 border-gray-200 shadow-xl'
    : isBeach
      ? 'bg-black/90 border-cyan-900/50 shadow-cyan-900/20'
      : 'bg-zinc-900/95 border-zinc-800 shadow-2xl';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textMuted = isLight ? 'text-gray-500' : 'text-gray-400';
  const btnHover = isLight ? 'hover:bg-gray-200' : 'hover:bg-zinc-700';
  const chipBg = isLight ? 'bg-gray-100 border-gray-200' : 'bg-zinc-800 border-zinc-700';
  const chipActive = 'bg-cyan-500/20 border-cyan-500 ring-1 ring-cyan-500/30';
  const trackBg = isLight ? '#e5e7eb' : '#3f3f46';

  const allowedModels = getAllowedModels(userTier);

  const models = [
    { id: 'GFS', label: 'GFS', locked: !allowedModels.includes('GFS') },
    { id: 'EURO', label: 'EURO', locked: !allowedModels.includes('EURO') },
    { id: 'ICON', label: 'ICON', locked: !allowedModels.includes('ICON') }
  ];

  const layers = [
    { id: 'rain', label: 'Precip', icon: CloudRain, color: 'text-blue-400' },
    { id: 'radar', label: 'Radar', icon: CloudRain, color: 'text-indigo-400' },
    { id: 'satellite', label: 'Satellite', icon: Globe, color: 'text-sky-400' },
    { id: 'wind', label: 'Wind', icon: Wind, color: 'text-teal-400' },
    { id: 'waves', label: 'Waves', icon: Waves, color: 'text-blue-300' },
    { id: 'swell_1', label: 'Swell', icon: Waves, color: 'text-cyan-400' },
    { id: 'swell_2', label: 'Swell 2', icon: Waves, color: 'text-purple-400' },
    { id: 'wind_waves', label: 'Wind Waves', icon: Wind, color: 'text-emerald-400' },
    { id: 'fog', label: 'Fog', icon: Cloud, color: 'text-gray-400' },
    { id: 'pressure', label: 'Pressure', icon: Thermometer, color: 'text-rose-400' }
  ];

  const handleModelClick = (model) => {
    if (model.locked) { onUpgradeClick?.(); } else { onModelChange(model.id); }
  };

  const activeLayer = activeLayers[0] || null;

  // Map layer IDs to their omVariable names for color scale lookup
  const LAYER_TO_VARIABLE = {
    waves: 'wave_height',
    swell_1: 'swell_wave_height',
    swell_2: 'secondary_swell_wave_height',
    wind_waves: 'wind_wave_height',
    rain: 'precipitation',
    pressure: 'pressure_msl',
  };

  // Legend labels and units per layer
  const LEGEND_LABELS = {
    waves: 'Combined Waves (ft)',
    swell_1: 'Primary Swell (ft)',
    swell_2: 'Secondary Swell (ft)',
    wind_waves: 'Wind Waves (ft)',
    rain: 'Rain / Snow (in/h)',
    radar: 'Live Radar (dBZ)',
    satellite: 'Cloud Cover (%)',
    fog: 'Visibility / Fog',
    wind: 'Wind Speed (kts)',
    pressure: 'Pressure (hPa)',
  };

  // Build legend config dynamically from actual color scale data
  const legendConfig = useMemo(() => {
    // Ensure color scales are updated with the current theme before building gradients/stops
    applyThemePressureScale(theme);
    applyThemeWaveScale(theme);

    const config = {};

    // Data-driven legends from BASE_CUSTOM_COLOR_SCALES
    Object.entries(LAYER_TO_VARIABLE).forEach(([layerId, variable]) => {
      const scale = BASE_CUSTOM_COLOR_SCALES[variable];
      if (scale) {
        config[layerId] = {
          label: LEGEND_LABELS[layerId] || layerId,
          gradientCSS: buildGradientCSS(scale),
          stops: buildStops(scale, variable),
        };
      }
    });

    // Static legends for layers without custom color scales
    config.satellite = {
      label: LEGEND_LABELS.satellite,
      gradientCSS: 'linear-gradient(to right, transparent, rgba(200,200,200,0.4), rgba(180,180,180,0.6), rgba(240,240,240,0.8), white)',
      stops: ['0%', '25%', '50%', '75%', '100%'],
    };
    config.fog = {
      label: LEGEND_LABELS.fog,
      gradientCSS: 'linear-gradient(to right, rgba(120,120,120,0.8), rgba(160,160,160,0.6), rgba(200,200,200,0.4), transparent)',
      stops: ['<1km', '5km', '10km', '20km', 'Clear'],
    };
    config.wind = {
      label: LEGEND_LABELS.wind,
      // Gradient matches WindColorRamp.js stops: calm blue → cyan → teal → green → yellow → amber → red → magenta → purple
      gradientCSS: isLight
        ? 'linear-gradient(to right, rgba(166,191,224,0.3), rgba(97,191,224,0.5), rgba(56,204,184,0.6), rgba(97,209,97,0.65), rgba(199,209,51,0.7), rgba(242,173,38,0.8), rgba(230,56,38,0.85), rgba(191,26,89,0.9), rgba(140,13,128,0.95))'
        : isBeach
        ? 'linear-gradient(to right, rgba(166,191,224,0.25), rgba(97,191,224,0.45), rgba(56,204,184,0.55), rgba(97,209,97,0.6), rgba(199,209,51,0.65), rgba(242,173,38,0.75), rgba(230,56,38,0.8), rgba(191,26,89,0.9), rgba(140,13,128,0.95))'
        : 'linear-gradient(to right, rgba(166,191,224,0.25), rgba(97,191,224,0.45), rgba(56,204,184,0.55), rgba(97,209,97,0.6), rgba(199,209,51,0.65), rgba(242,173,38,0.75), rgba(230,56,38,0.8), rgba(191,26,89,0.9), rgba(140,13,128,0.95))',
      stops: ['0', '5', '15', '30', '50+'],
    };
    config.radar = {
      label: LEGEND_LABELS.radar,
      gradientCSS: 'linear-gradient(to right, rgba(200,200,200,0.3), rgba(96,165,250,0.6), rgba(99,102,241,0.7), rgba(147,51,234,0.85), rgba(219,39,119,0.95))',
      stops: ['0', '.1', '.3', '.5', '2+'],
    };

    return config;
  }, [theme]);

  const maxForecastDays = resolveForecastWindow(userTier, activeModel, activeLayers && activeLayers[0]);
  const maxForecastHours = maxForecastDays * 24;
  const isRadar = radarMode && radarFrames.length > 0;

  // Local state and refs for decoupled and rAF-throttled slider dragging
  const [sliderVal, setSliderVal] = useState(isRadar ? radarFrameIndex : currentTimeOffset);
  const isDraggingRef = useRef(false);
  const requestRef = useRef(null);
  const latestValueRef = useRef(null);

  // Synchronize local slider state with parent prop updates when not dragging (e.g. autoplay)
  useEffect(() => {
    if (!isDraggingRef.current) {
      setSliderVal(isRadar ? radarFrameIndex : currentTimeOffset);
    }
  }, [isRadar, radarFrameIndex, currentTimeOffset]);

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, []);

  const formatTime = () => {
    if (isRadar) {
      const frame = radarFrames[sliderVal];
      if (!frame?.time) return '--:--';
      const d = new Date(frame.time * 1000);
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else {
      if (sliderVal === 0) return 'Live';
      const d = new Date();
      d.setHours(d.getHours() + sliderVal);
      return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.toLocaleTimeString('en-US', { hour: 'numeric' })}`;
    }
  };

  const progress = isRadar
    ? (radarFrames.length > 0 ? ((sliderVal + 1) / radarFrames.length) * 100 : 0)
    : (sliderVal / maxForecastHours) * 100;

  const handleSliderChange = (e) => {
    const val = parseInt(e.target.value, 10);
    setSliderVal(val);

    if (isDraggingRef.current) {
      latestValueRef.current = val;
      if (requestRef.current === null) {
        requestRef.current = requestAnimationFrame(() => {
          const targetVal = latestValueRef.current;
          requestRef.current = null;
          if (isRadar) {
            onRadarFrameChange(targetVal);
          } else {
            onTimeChange(targetVal);
          }
        });
      }
    } else {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
      latestValueRef.current = null;
      if (isRadar) {
        onRadarFrameChange(val);
      } else {
        onTimeChange(val);
      }
    }
  };

  const handleDragStart = () => {
    isDraggingRef.current = true;
    if (typeof window !== 'undefined') {
      window.isScrubbingTimeline = true;
    }
  };

  const handleDragEnd = () => {
    isDraggingRef.current = false;
    if (typeof window !== 'undefined') {
      window.isScrubbingTimeline = false;
      window.lastScrubTime = Date.now();
    }
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }
    // Commit final location instantly on pointer release to guarantee alignment
    if (isRadar) {
      onRadarFrameChange(sliderVal);
    } else {
      onTimeChange(sliderVal);
    }
  };

  // Integrated Timeline UI block
  const renderTimeline = (isMobile = false) => {
    if (!activeLayer) return null;
    return (
      <div className={isMobile ? "" : `mt-2 pt-2 border-t ${isLight ? 'border-gray-200' : 'border-zinc-800'}`}>
        <div className="flex items-center gap-2">
          {/* Play/Pause */}
          <button
            onClick={onTogglePlay}
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 shadow-md ${isPlaying ? 'bg-rose-500 text-white' : 'bg-cyan-500 text-black'}`}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
          </button>

          {/* Step Back (Radar only) */}
          {isRadar && (
            <button
              onClick={() => onRadarFrameChange(Math.max(0, radarFrameIndex - 1))}
              className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${btnHover}`}
              aria-label="Step back"
            >
              <SkipBack className={`w-3 h-3 ${textMuted}`} />
            </button>
          )}

          {/* Scrubber */}
          <div className="flex-1 px-1 flex flex-col justify-center">
            <input
              type="range"
              min={0}
              max={isRadar ? Math.max(radarFrames.length - 1, 0) : maxForecastHours}
              step={1}
              value={sliderVal}
              onChange={handleSliderChange}
              onMouseDown={handleDragStart}
              onTouchStart={handleDragStart}
              onMouseUp={handleDragEnd}
              onTouchEnd={handleDragEnd}
              className="w-full h-2 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #06b6d4 ${progress}%, ${trackBg} ${progress}%)`
              }}
              aria-label="Timeline scrubber"
            />
          </div>

          {/* Step Forward (Radar only) */}
          {isRadar && (
            <button
              onClick={() => onRadarFrameChange(Math.min(radarFrames.length - 1, radarFrameIndex + 1))}
              className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${btnHover}`}
              aria-label="Step forward"
            >
              <SkipForward className={`w-3 h-3 ${textMuted}`} />
            </button>
          )}

          {/* Time Readout */}
          <div className={`text-[10px] font-bold shrink-0 text-right min-w-[50px] ${textClass}`}>
            {formatTime()}
          </div>
        </div>

        {/* v3.8: Day tick labels beneath scrubber */}
        {!isRadar && maxForecastHours > 24 && (
          <div className="relative h-6 mt-2 mx-8" style={{ position: 'relative', height: 24, marginTop: 8 }}>
            {/* Now indicator */}
            <div style={{
              position: 'absolute',
              left: '0%',
              top: 0,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#06b6d4',
                boxShadow: '0 0 6px #06b6d4',
                animation: 'nowPulse 2s ease-in-out infinite'
              }} />
              <span style={{ fontSize: 8, color: '#06b6d4', fontWeight: 700, marginTop: '5px' }}>Now</span>
            </div>
            {/* Day labels */}
            {Array.from({ length: Math.min(Math.floor(maxForecastHours / 6), 56) }, (_, i) => {
              const hrOff = (i + 1) * 6;
              if (hrOff > maxForecastHours) return null;
              const pct = (hrOff / maxForecastHours) * 100;
              if (pct > 100) return null;
              const isDay = hrOff % 24 === 0;
              const d = new Date();
              d.setHours(d.getHours() + hrOff);
              const label = isDay
                ? (hrOff === 24 ? 'Tmrw' : d.toLocaleDateString('en-US', { weekday: 'short' }))
                : '';
              return (
                <div key={i} style={{
                  position: 'absolute', left: `${pct}%`, top: 0,
                  transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center'
                }}>
                  <div style={{
                    width: 1, height: isDay ? 6 : 4,
                    background: isLight
                      ? (isDay ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.12)')
                      : (isDay ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)')
                  }} />
                  {isDay && (
                    <span style={{
                      fontSize: 8,
                      color: isLight ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)',
                      fontWeight: 600,
                      marginTop: '5px',
                      whiteSpace: 'nowrap'
                    }}>{label}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <style>{`
          input[type=range]::-webkit-slider-thumb {
            appearance: none; width: 16px; height: 16px;
            background: white; border: 2px solid #06b6d4;
            border-radius: 50%; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          }
          @keyframes nowPulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.4); }
          }
        `}</style>
      </div>
    );
  };

  // ==================== DESKTOP LAYOUT ====================
  if (isDesktop) {
    const desktopClass = `absolute top-24 right-2 z-[1000] backdrop-blur-xl border rounded-xl transition-all duration-300 ease-in-out hidden md:block ${bgClass}`;

    if (isCollapsed) {
      const activeLayerObj = layers.find(l => l.id === activeLayer);
      const ActiveIcon = activeLayerObj ? activeLayerObj.icon : Sun;
      const activeColor = activeLayerObj ? activeLayerObj.color : textMuted;

      return (
        <div
          className={`${desktopClass} w-12 h-12 p-0 overflow-hidden flex flex-col items-center justify-center cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-lg group`}
          onClick={() => setIsCollapsed(false)}
          aria-label="Expand weather controls"
          style={{ borderRadius: '12px' }}
        >
          <div className="relative flex flex-col items-center justify-center w-full h-full gap-0.5">
            <ActiveIcon className={`w-5 h-5 ${activeColor} transition-transform group-hover:rotate-12`} />
            <ChevronDown className={`w-3.5 h-3.5 ${textMuted}`} />
          </div>
        </div>
      );
    }

    return (
      <div className={`${desktopClass} w-60 p-3 max-h-[calc(100vh-120px)] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${textMuted}`}>Weather</span>
          <button onClick={() => setIsCollapsed(true)} className={`p-1 rounded ${btnHover}`} aria-label="Collapse weather controls">
            <ChevronUp className={`w-4 h-4 ${textMuted}`} />
          </button>
        </div>

        <div className="flex gap-1 mb-3">
          {models.map(m => (
            <button
              key={m.id}
              onClick={() => handleModelClick(m)}
              className={`flex-1 py-1 text-[10px] font-bold rounded-md transition-all ${activeModel === m.id ? 'bg-cyan-500 text-black' : `${chipBg} ${textMuted} ${btnHover}`}`}
            >
              {m.label}{m.locked && <Lock className="w-2.5 h-2.5 ml-0.5 inline opacity-70" />}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {layers.map(layer => {
            const isActive = activeLayer === layer.id;
            const Icon = layer.icon;
            return (
              <button
                key={layer.id}
                onClick={() => onLayerToggle(layer.id)}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${isActive ? chipActive : `${chipBg} ${btnHover}`}`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? layer.color : textMuted}`} />
                <span className={isActive ? textClass : textMuted}>{layer.label}</span>
              </button>
            );
          })}
        </div>

        {activeLayer && legendConfig[activeLayer] && (
          <div className="mt-1">
            <div className={`text-[9px] ${textMuted} mb-0.5`}>{legendConfig[activeLayer].label}</div>
            <div className="h-1.5 w-full rounded-full" style={{ background: legendConfig[activeLayer].gradientCSS }} />
            <div className={`flex justify-between text-[8px] ${textMuted} mt-0.5 px-0.5`}>
              {legendConfig[activeLayer].stops.map((s, i) => <span key={i}>{s}</span>)}
            </div>
          </div>
        )}

        {renderTimeline()}
      </div>
    );
  }

  // ==================== MOBILE LAYOUT ====================
  if (!isMobileExpanded) {
    // Collapsed mobile state: Just show timeline and legend floating above bottom nav
    if (!activeLayer) return null;
    return (
      <div className="absolute left-0 right-0 z-[900] md:hidden px-4 pointer-events-none transition-all duration-300" style={{ bottom: isImmersiveMode ? '16px' : '72px' }}>
        <div className={`pointer-events-auto rounded-xl backdrop-blur-xl border shadow-2xl ${bgClass} ${collapsedState ? 'pt-2 pb-2' : 'p-3'} transition-all duration-300`}>
          <div className="flex justify-center gap-24 items-center pb-2 -mt-2">
            <button 
              className="py-1 px-3 -mx-3 group cursor-pointer active:scale-95 transition-transform"
              onClick={() => setCollapsedState(!collapsedState)}
              aria-label="Toggle timeline"
            >
              <svg viewBox="0 0 120 40" className="w-8 h-auto opacity-60 group-hover:opacity-100 transition-opacity duration-300" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M 85 18 C 86 5, 95 2, 98 2 C 95 10, 95 16, 95 20 Z" className="fill-zinc-500 group-hover:fill-cyan-400 transition-colors duration-300" />
                <path d="M 10 24 C 30 14, 90 14, 110 24 C 113 25, 113 27, 110 28 C 90 20, 30 20, 10 28 C 7 27, 7 25, 10 24 Z" className="fill-zinc-600 group-hover:fill-blue-500 transition-colors duration-300" />
                <path d="M 10 26 C 30 17, 90 17, 110 26" className="stroke-zinc-800 group-hover:stroke-amber-600 transition-colors duration-300" strokeWidth="0.5" fill="none" />
              </svg>
            </button>
            <button 
              className="py-1 px-3 -mx-3 group cursor-pointer active:scale-95 transition-transform"
              onClick={() => setCollapsedState(!collapsedState)}
              aria-label="Toggle timeline"
            >
              <svg viewBox="0 0 120 40" className="w-8 h-auto opacity-60 group-hover:opacity-100 transition-opacity duration-300 transform -scale-x-100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M 85 18 C 86 5, 95 2, 98 2 C 95 10, 95 16, 95 20 Z" className="fill-zinc-500 group-hover:fill-cyan-400 transition-colors duration-300" />
                <path d="M 10 24 C 30 14, 90 14, 110 24 C 113 25, 113 27, 110 28 C 90 20, 30 20, 10 28 C 7 27, 7 25, 10 24 Z" className="fill-zinc-600 group-hover:fill-blue-500 transition-colors duration-300" />
                <path d="M 10 26 C 30 17, 90 17, 110 26" className="stroke-zinc-800 group-hover:stroke-amber-600 transition-colors duration-300" strokeWidth="0.5" fill="none" />
              </svg>
            </button>
          </div>
          <div className={`overflow-hidden transition-all duration-300 ${collapsedState ? 'max-h-0 opacity-0' : 'max-h-[200px] opacity-100'}`}>
            {legendConfig[activeLayer] && (
              <div className="mb-2">
                <div className={`text-[9px] font-bold uppercase tracking-wider ${textMuted} mb-1 flex justify-between`}>
                  <span>{legendConfig[activeLayer].label}</span>
                </div>
                <div className="h-1.5 w-full rounded-full" style={{ background: legendConfig[activeLayer].gradientCSS }} />
                <div className={`flex justify-between text-[9px] ${textMuted} mt-1`}>
                  {legendConfig[activeLayer].stops.map((s, i) => <span key={i}>{s}</span>)}
                </div>
              </div>
            )}
            {renderTimeline(true)}
          </div>
        </div>
      </div>
    );
  }

  // Expanded mobile state (Bottom Sheet)
  return (
    <>
      <div className="absolute inset-0 z-[999] bg-black/40 backdrop-blur-sm md:hidden" onClick={onClose} />
      <div className={`absolute left-0 right-0 z-[1000] md:hidden rounded-t-3xl backdrop-blur-xl border-t ${bgClass} shadow-[0_-20px_40px_rgba(0,0,0,0.4)]`} style={{ bottom: '64px' }}>
        <div className="flex flex-col items-center pt-2 pb-1">
          <div className="w-12 h-1.5 bg-gray-500/30 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b border-zinc-800/30">
          <span className={`text-xs font-bold uppercase tracking-wider ${textClass}`}>Map Layers</span>
          {onClose && (
            <button onClick={onClose} className={`p-1.5 rounded-full ${btnHover} transition-colors`} aria-label="Close">
              <X className={`w-5 h-5 ${textMuted}`} />
            </button>
          )}
        </div>

        <div className="px-5 py-4">
          <div className={`text-[10px] font-bold uppercase tracking-wider ${textMuted} mb-2`}>Forecasting Model</div>
          <div className="flex gap-2 mb-6">
            {models.map(m => (
              <button
                key={m.id}
                onClick={() => handleModelClick(m)}
                className={`flex-1 py-2 text-xs font-bold rounded-xl border transition-all ${activeModel === m.id ? 'bg-cyan-500 text-black border-cyan-500 shadow-lg shadow-cyan-500/20' : `${chipBg} ${textMuted} border-transparent`}`}
              >
                {m.label}{m.locked && <Lock className="w-3.5 h-3.5 ml-1.5 inline opacity-70" />}
              </button>
            ))}
          </div>

          <div className={`text-[10px] font-bold uppercase tracking-wider ${textMuted} mb-2`}>Weather Overlays</div>
          <div className="flex flex-wrap gap-2 pb-2">
            {layers.map(layer => {
              const isActive = activeLayer === layer.id;
              const Icon = layer.icon;
              return (
                <button
                  key={layer.id}
                  onClick={() => onLayerToggle(layer.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm font-medium transition-all shrink-0 ${isActive ? chipActive : `${chipBg} ${btnHover}`}`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? layer.color : textMuted}`} />
                  <span className={isActive ? textClass : textMuted}>{layer.label}</span>
                </button>
              );
            })}
          </div>

          {/* Timeline in expanded view */}
          {activeLayer && (
            <div className={`mt-3 pt-3 border-t ${isLight ? 'border-gray-200' : 'border-zinc-800'}`}>
              {legendConfig[activeLayer] && (
                <div className="mb-2">
                  <div className={`text-[9px] font-bold uppercase tracking-wider ${textMuted} mb-1`}>
                    {legendConfig[activeLayer].label}
                  </div>
                  <div className="h-1.5 w-full rounded-full" style={{ background: legendConfig[activeLayer].gradientCSS }} />
                  <div className={`flex justify-between text-[8px] ${textMuted} mt-0.5`}>
                    {legendConfig[activeLayer].stops.map((s, i) => <span key={i}>{s}</span>)}
                  </div>
                </div>
              )}
              {renderTimeline(true)}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default MapWeatherControls;
