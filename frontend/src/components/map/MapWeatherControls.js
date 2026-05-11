import React, { useState } from 'react';
import { Wind, Waves, CloudRain, Thermometer, Lock, ChevronDown, ChevronUp, X, Cloud, Globe, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Compact weather controls — chip-based layer selector + integrated timeline.
 * Mobile: renders as a slim bottom-sheet panel.
 * Desktop: renders as a collapsible sidebar card.
 */
export const MapWeatherControls = ({
  isDesktop = true,
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
}) => {
  const { theme } = useTheme();
  const [isCollapsed, setIsCollapsed] = useState(false);

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

  const isBasicOrPremium = userTier === 'tier_2' || userTier === 'tier_3' || userTier === 'admin' || userTier === 'tier_4';

  const models = [
    { id: 'GFS', label: 'GFS', locked: false },
    { id: 'EURO', label: 'EURO', locked: !isBasicOrPremium },
    { id: 'ICON', label: 'ICON', locked: !isBasicOrPremium }
  ];

  const layers = [
    { id: 'radar', label: 'Radar', icon: CloudRain, color: 'text-indigo-400' },
    { id: 'satellite', label: 'Satellite', icon: Globe, color: 'text-sky-400' },
    { id: 'precipitation', label: 'Rain', icon: CloudRain, color: 'text-blue-400' },
    { id: 'wind', label: 'Wind', icon: Wind, color: 'text-teal-400' },
    { id: 'swell_height', label: 'Waves', icon: Waves, color: 'text-blue-300' },
    { id: 'swell_period', label: 'Period', icon: Waves, color: 'text-cyan-400' },
    { id: 'fog', label: 'Fog', icon: Cloud, color: 'text-gray-400' },
    { id: 'pressure', label: 'Pressure', icon: Thermometer, color: 'text-rose-400' }
  ];

  const handleModelClick = (model) => {
    if (model.locked) { onUpgradeClick?.(); } else { onModelChange(model.id); }
  };

  const activeLayer = activeLayers[0] || null;

  const legendConfig = {
    satellite: { label: 'Cloud Cover (%)', gradient: 'from-transparent via-gray-300 via-gray-400 to-white', stops: ['0','20','40','60','80','100'] },
    swell_height: { label: 'Waves (ft)', gradient: 'from-blue-100 via-cyan-400 via-blue-600 via-purple-600 to-rose-700', stops: ['0','2','4','8','12','20+'] },
    swell_period: { label: 'Period (s)', gradient: 'from-blue-100 via-cyan-400 via-blue-600 via-purple-600 to-rose-700', stops: ['0','4','8','12','16','20+'] },
    fog: { label: 'Visibility (m)', gradient: 'from-gray-700 via-gray-400 to-transparent', stops: ['0','1k','5k','10k','24k'] },
    wind: { label: 'Wind (kts)', gradient: 'from-teal-100 via-emerald-400 via-yellow-400 via-orange-500 to-rose-600', stops: ['0','5','10','20','30','50+'] },
    precipitation: { label: 'Rain (in/h)', gradient: 'from-gray-300 via-blue-400 via-indigo-500 via-purple-600 to-fuchsia-600', stops: ['0','.1','.3','.5','1.0','2+'] },
    radar: { label: 'Rain (in/h)', gradient: 'from-gray-300 via-blue-400 via-indigo-500 via-purple-600 to-fuchsia-600', stops: ['0','.1','.3','.5','1.0','2+'] },
    pressure: { label: 'Pressure (hPa)', gradient: 'from-gray-100 via-blue-300 via-emerald-300 via-yellow-400 to-red-600', stops: ['980','990','1000','1010','1020','1030'] },
  };

  const maxForecastHours = 14 * 24;
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
  const renderTimeline = () => {
    if (!activeLayer) return null;
    return (
      <div className={`mt-2 pt-2 border-t ${isLight ? 'border-gray-200' : 'border-zinc-800'}`}>
        <div className="flex items-center gap-2">
          {/* Play/Pause */}
          <button
            onClick={onTogglePlay}
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 ${isPlaying ? 'bg-rose-500 text-white' : 'bg-cyan-500 text-black'}`}
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
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
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
        <style>{`
          input[type=range]::-webkit-slider-thumb {
            appearance: none; width: 14px; height: 14px;
            background: white; border: 2px solid #06b6d4;
            border-radius: 50%; cursor: pointer;
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
  return (
    <div className={`w-full rounded-t-2xl backdrop-blur-xl border-t ${bgClass} block md:hidden shadow-[0_-10px_40px_rgba(0,0,0,0.3)]`} style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-1 bg-gray-500/40 rounded-full" />
          <span className={`text-[11px] font-bold uppercase tracking-wider ${textMuted}`}>Weather Controls</span>
        </div>
        {onClose && (
          <button onClick={onClose} className={`p-1 rounded-full ${btnHover}`}>
            <X className={`w-5 h-5 ${textMuted}`} />
          </button>
        )}
      </div>

      <div className="flex gap-1.5 px-4 mb-3">
        {models.map(m => (
          <button
            key={m.id}
            onClick={() => handleModelClick(m)}
            className={`flex-1 py-1 text-[11px] font-bold rounded-lg transition-all ${activeModel === m.id ? 'bg-cyan-500 text-black' : `${chipBg} ${textMuted}`}`}
          >
            {m.label}{m.locked && <Lock className="w-3 h-3 ml-1 inline opacity-70" />}
          </button>
        ))}
      </div>

      <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
        {layers.map(layer => {
          const isActive = activeLayer === layer.id;
          const Icon = layer.icon;
          return (
            <button
              key={layer.id}
              onClick={() => onLayerToggle(layer.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border whitespace-nowrap text-[12px] font-medium transition-all shrink-0 ${isActive ? chipActive : `${chipBg} ${btnHover}`}`}
            >
              <Icon className={`w-4 h-4 ${isActive ? layer.color : textMuted}`} />
              <span className={isActive ? textClass : textMuted}>{layer.label}</span>
            </button>
          );
        })}
      </div>

      {activeLayer && legendConfig[activeLayer] && (
        <div className="px-4 pb-1">
          <div className={`text-[10px] ${textMuted} mb-1`}>{legendConfig[activeLayer].label}</div>
          <div className={`h-1.5 w-full rounded-full bg-gradient-to-r ${legendConfig[activeLayer].gradient}`} />
          <div className={`flex justify-between text-[9px] ${textMuted} mt-1`}>
            {legendConfig[activeLayer].stops.map((s, i) => <span key={i}>{s}</span>)}
          </div>
        </div>
      )}

      {activeLayer && (
        <div className="px-3">
          {renderTimeline()}
        </div>
      )}
    </div>
  );
};

export default MapWeatherControls;
