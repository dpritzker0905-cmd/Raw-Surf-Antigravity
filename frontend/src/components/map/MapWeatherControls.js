import React, { useState } from 'react';
import { Wind, Waves, CloudRain, Thermometer, Lock, ChevronDown, ChevronUp, X, Cloud, Globe, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { getAllowedModels, resolveForecastWindow } from './LayerAccessResolver';

/**
 * Compact weather controls — chip-based layer selector + integrated timeline.
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
    { id: 'rain', label: 'Rain', icon: CloudRain, color: 'text-blue-400' },
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

  const legendConfig = {
    satellite: { label: 'Cloud Cover (%)', gradient: 'from-transparent via-gray-300 via-gray-400 to-white', stops: ['0','20','40','60','80','100'] },
    waves: { label: 'Combined Waves (ft)', gradient: 'from-blue-100 via-cyan-400 via-blue-600 via-purple-600 to-rose-700', stops: ['0','2','4','8','12','20+'] },
    swell_1: { label: 'Primary Swell (ft)', gradient: 'from-cyan-100 via-cyan-400 via-blue-500 via-indigo-600 to-violet-700', stops: ['0','2','4','8','12','20+'] },
    swell_2: { label: 'Secondary Swell (ft)', gradient: 'from-purple-100 via-purple-400 via-fuchsia-500 via-pink-600 to-rose-700', stops: ['0','1','2','4','6','10+'] },
    wind_waves: { label: 'Wind Waves (ft)', gradient: 'from-emerald-100 via-emerald-400 via-teal-500 via-cyan-600 to-blue-700', stops: ['0','1','2','4','6','10+'] },
    fog: { label: 'Visibility / Fog', gradient: 'from-gray-500 via-gray-400 via-gray-300 to-transparent', stops: ['<1km','5km','10km','20km','40km','Clear'] },
    wind: { label: 'Wind (kts)', gradient: 'from-teal-100 via-emerald-400 via-yellow-400 via-orange-500 to-rose-600', stops: ['0','5','10','20','30','50+'] },
    rain: { label: 'Rain Forecast (in/h)', gradient: 'from-gray-300 via-blue-400 via-indigo-500 via-purple-600 to-fuchsia-600', stops: ['0','.1','.3','.5','1.0','2+'] },
    radar: { label: 'Live Radar (in/h)', gradient: 'from-gray-300 via-blue-400 via-indigo-500 via-purple-600 to-fuchsia-600', stops: ['0','.1','.3','.5','1.0','2+'] },
    pressure: { label: 'Pressure (hPa)', gradient: 'from-gray-100 via-blue-300 via-emerald-300 via-yellow-400 to-red-600', stops: ['980','990','1000','1010','1020','1030'] },
  };

  const maxForecastDays = resolveForecastWindow(userTier);
  const maxForecastHours = maxForecastDays * 24;
  const isRadar = radarMode && radarFrames.length > 0;
  
  const formatTime = () => {
    if (isRadar) {
      const frame = radarFrames[radarFrameIndex];
      if (!frame?.time) return '--:--';
      const d = new Date(frame.time * 1000);
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else {
      if (currentTimeOffset === 0) return 'Live';
      const d = new Date();
      d.setHours(d.getHours() + currentTimeOffset);
      return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.toLocaleTimeString('en-US', { hour: 'numeric' })}`;
    }
  };

  const progress = isRadar
    ? ((radarFrameIndex + 1) / radarFrames.length) * 100
    : (currentTimeOffset / maxForecastHours) * 100;

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
              step={isRadar ? 1 : 3}
              value={isRadar ? radarFrameIndex : currentTimeOffset}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                isRadar ? onRadarFrameChange(val) : onTimeChange(val);
              }}
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
          <div className="relative h-4 mt-1 mx-8" style={{ position: 'relative', height: 16, marginTop: 4 }}>
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
              <span style={{ fontSize: 8, color: '#06b6d4', fontWeight: 700, marginTop: 1 }}>Now</span>
            </div>
            {/* Day labels */}
            {Array.from({ length: Math.min(Math.floor(maxForecastHours / 24), 7) }, (_, i) => {
              const dayOffset = (i + 1) * 24;
              const pct = (dayOffset / maxForecastHours) * 100;
              if (pct > 100) return null;
              const d = new Date();
              d.setDate(d.getDate() + i + 1);
              const label = i === 0 ? 'Tmrw' : d.toLocaleDateString('en-US', { weekday: 'short' });
              return (
                <div key={i} style={{
                  position: 'absolute',
                  left: `${pct}%`,
                  top: 0,
                  transform: 'translateX(-50%)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center'
                }}>
                  <div style={{
                    width: 1, height: 6,
                    background: isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)'
                  }} />
                  <span style={{
                    fontSize: 8,
                    color: isLight ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)',
                    fontWeight: 600
                  }}>{label}</span>
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
      return (
        <div
          className={`${desktopClass} w-12 h-12 p-0 overflow-hidden flex items-center justify-center cursor-pointer`}
          onClick={() => setIsCollapsed(false)}
          aria-label="Expand weather controls"
        >
          <ChevronDown className={`w-5 h-5 ${textClass}`} />
        </div>
      );
    }

    return (
      <div className={`${desktopClass} w-60 p-3 max-h-[calc(100vh-120px)] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${textMuted}`}>Weather</span>
          <button onClick={() => setIsCollapsed(true)} className={`p-1 rounded ${btnHover}`}>
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
            <div className={`h-1.5 w-full rounded-full bg-gradient-to-r ${legendConfig[activeLayer].gradient}`} />
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
                <div className={`h-1.5 w-full rounded-full bg-gradient-to-r ${legendConfig[activeLayer].gradient}`} />
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
            <button onClick={onClose} className={`p-1.5 rounded-full ${btnHover} transition-colors`}>
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
                  <div className={`h-1.5 w-full rounded-full bg-gradient-to-r ${legendConfig[activeLayer].gradient}`} />
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
