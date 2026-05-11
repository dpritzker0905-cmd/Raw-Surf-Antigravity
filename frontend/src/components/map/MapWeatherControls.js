import React, { useState } from 'react';
import { Wind, Waves, CloudRain, Thermometer, Lock, ChevronDown, ChevronUp, Globe, X } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Compact weather controls — chip-based layer selector.
 * Mobile: renders as a slim bottom-sheet panel (~120px vs old 60vh).
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
}) => {
  const { theme } = useTheme();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  const isLight = theme === 'light';
  const isBeach = theme === 'beach';

  // Theming
  const bgClass = isLight
    ? 'bg-white/90 border-gray-200 shadow-xl'
    : isBeach
      ? 'bg-black/80 border-cyan-900/50 shadow-cyan-900/20'
      : 'bg-zinc-900/90 border-zinc-800 shadow-2xl';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textMuted = isLight ? 'text-gray-500' : 'text-gray-400';
  const btnHover = isLight ? 'hover:bg-gray-200' : 'hover:bg-zinc-700';
  const chipBg = isLight ? 'bg-gray-100 border-gray-200' : 'bg-zinc-800 border-zinc-700';
  const chipActive = 'bg-cyan-500/20 border-cyan-500 ring-1 ring-cyan-500/30';

  const isBasicOrPremium = userTier === 'tier_2' || userTier === 'tier_3' || userTier === 'admin' || userTier === 'tier_4';

  const models = [
    { id: 'GFS', label: 'GFS', locked: false },
    { id: 'EURO', label: 'EURO', locked: !isBasicOrPremium },
    { id: 'ICON', label: 'ICON', locked: !isBasicOrPremium }
  ];

  const layers = [
    { id: 'satellite', label: 'Satellite', icon: Globe, color: 'text-zinc-300' },
    { id: 'radar', label: 'Radar', icon: CloudRain, color: 'text-indigo-400' },
    { id: 'precipitation', label: 'Rain', icon: CloudRain, color: 'text-blue-400' },
    { id: 'wind', label: 'Wind', icon: Wind, color: 'text-teal-400' },
    { id: 'swell_height', label: 'Waves', icon: Waves, color: 'text-blue-300' },
    { id: 'swell_period', label: 'Period', icon: Waves, color: 'text-cyan-400' },
    { id: 'pressure', label: 'Pressure', icon: Thermometer, color: 'text-rose-400' }
  ];

  const handleModelClick = (model) => {
    if (model.locked) { onUpgradeClick?.(); } else { onModelChange(model.id); }
  };

  const activeLayer = activeLayers[0] || null;

  // Legend data per active layer
  const legendConfig = {
    swell_height: { label: 'Waves (ft)', gradient: 'from-blue-100 via-cyan-400 via-blue-600 via-purple-600 to-rose-700', stops: ['0','2','4','8','12','20+'] },
    swell_period: { label: 'Period (s)', gradient: 'from-blue-100 via-cyan-400 via-blue-600 via-purple-600 to-rose-700', stops: ['0','4','8','12','16','20+'] },
    wind: { label: 'Wind (kts)', gradient: 'from-teal-100 via-emerald-400 via-yellow-400 via-orange-500 to-rose-600', stops: ['0','5','10','20','30','50+'] },
    precipitation: { label: 'Rain (in/h)', gradient: 'from-gray-300 via-blue-400 via-indigo-500 via-purple-600 to-fuchsia-600', stops: ['0','.1','.3','.5','1.0','2+'] },
    radar: { label: 'Rain (in/h)', gradient: 'from-gray-300 via-blue-400 via-indigo-500 via-purple-600 to-fuchsia-600', stops: ['0','.1','.3','.5','1.0','2+'] },
    pressure: { label: 'Pressure (hPa)', gradient: 'from-gray-100 via-blue-300 via-emerald-300 via-yellow-400 to-red-600', stops: ['980','990','1000','1010','1020','1030'] },
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
      <div className={`${desktopClass} w-56 p-3 max-h-[calc(100vh-120px)] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${textMuted}`}>Weather</span>
          <button onClick={() => setIsCollapsed(true)} className={`p-1 rounded ${btnHover}`} aria-label="Collapse weather controls">
            <ChevronUp className={`w-4 h-4 ${textMuted}`} />
          </button>
        </div>

        {/* Model pills */}
        <div className="flex gap-1 mb-3">
          {models.map(m => (
            <button
              key={m.id}
              onClick={() => handleModelClick(m)}
              className={`flex-1 py-1 text-[10px] font-bold rounded-md transition-all ${activeModel === m.id ? 'bg-cyan-500 text-black' : `${chipBg} ${textMuted} ${btnHover}`}`}
              aria-label={`${m.label} forecast model${m.locked ? ' (locked)' : ''}`}
            >
              {m.label}{m.locked && <Lock className="w-2.5 h-2.5 ml-0.5 inline opacity-70" />}
            </button>
          ))}
        </div>

        {/* Layer chips — 2-column grid */}
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {layers.map(layer => {
            const isActive = activeLayer === layer.id;
            const Icon = layer.icon;
            return (
              <button
                key={layer.id}
                onClick={() => onLayerToggle(layer.id)}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${isActive ? chipActive : `${chipBg} ${btnHover}`}`}
                aria-pressed={isActive}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? layer.color : textMuted}`} />
                <span className={isActive ? textClass : textMuted}>{layer.label}</span>
              </button>
            );
          })}
        </div>

        {/* Compact legend */}
        {activeLayer && legendConfig[activeLayer] && (
          <div className="mt-1">
            <div className={`text-[9px] ${textMuted} mb-0.5`}>{legendConfig[activeLayer].label}</div>
            <div className={`h-1.5 w-full rounded-full bg-gradient-to-r ${legendConfig[activeLayer].gradient}`} />
            <div className={`flex justify-between text-[8px] ${textMuted} mt-0.5 px-0.5`}>
              {legendConfig[activeLayer].stops.map((s, i) => <span key={i}>{s}</span>)}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==================== MOBILE LAYOUT ====================
  // Compact chip-row panel — NOT a full-screen overlay
  return (
    <div className={`w-full rounded-t-2xl backdrop-blur-xl border-t ${bgClass} block md:hidden`} style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
      {/* Handle bar + header */}
      <div className="flex items-center justify-between px-4 pt-2 pb-1">
        <div className="flex items-center gap-3">
          <div className="w-8 h-1 bg-gray-500/40 rounded-full" />
          <span className={`text-[10px] font-bold uppercase tracking-wider ${textMuted}`}>Weather</span>
        </div>
        {onClose && (
          <button onClick={onClose} className={`p-1 rounded-full ${btnHover}`} aria-label="Close weather panel">
            <X className={`w-4 h-4 ${textMuted}`} />
          </button>
        )}
      </div>

      {/* Model selector — tiny inline pills */}
      <div className="flex gap-1 px-4 mb-2">
        {models.map(m => (
          <button
            key={m.id}
            onClick={() => handleModelClick(m)}
            className={`px-3 py-0.5 text-[10px] font-bold rounded-full transition-all ${activeModel === m.id ? 'bg-cyan-500 text-black' : `${chipBg} ${textMuted}`}`}
            aria-label={`${m.label} forecast model${m.locked ? ' (locked)' : ''}`}
          >
            {m.label}{m.locked && <Lock className="w-2.5 h-2.5 ml-0.5 inline opacity-70" />}
          </button>
        ))}
      </div>

      {/* Layer chips — horizontal scrolling row */}
      <div className="flex gap-2 px-4 pb-2 overflow-x-auto no-scrollbar">
        {layers.map(layer => {
          const isActive = activeLayer === layer.id;
          const Icon = layer.icon;
          return (
            <button
              key={layer.id}
              onClick={() => onLayerToggle(layer.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border whitespace-nowrap text-[11px] font-medium transition-all shrink-0 ${isActive ? chipActive : `${chipBg} ${btnHover}`}`}
              aria-pressed={isActive}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? layer.color : textMuted}`} />
              <span className={isActive ? textClass : textMuted}>{layer.label}</span>
            </button>
          );
        })}
      </div>

      {/* Compact legend strip (only when a layer is active) */}
      {activeLayer && legendConfig[activeLayer] && (
        <div className="px-4 pb-2">
          <div className={`text-[9px] ${textMuted} mb-0.5`}>{legendConfig[activeLayer].label}</div>
          <div className={`h-1.5 w-full rounded-full bg-gradient-to-r ${legendConfig[activeLayer].gradient}`} />
          <div className={`flex justify-between text-[8px] ${textMuted} mt-0.5`}>
            {legendConfig[activeLayer].stops.map((s, i) => <span key={i}>{s}</span>)}
          </div>
        </div>
      )}
    </div>
  );
};

export default MapWeatherControls;
