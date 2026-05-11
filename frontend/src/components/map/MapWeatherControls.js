import React, { useState } from 'react';
import { Wind, Waves, CloudRain, Thermometer, Lock, ChevronRight, ChevronLeft, Info, Globe } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

export const MapWeatherControls = ({
  isDesktop = true,
  activeModel,
  onModelChange,
  activeLayers,
  onLayerToggle,
  userTier = 'tier_1',
  onUpgradeClick
}) => {
  const { theme } = useTheme();
  const [isCollapsed, setIsCollapsed] = useState(false);

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
  const btnBg = isLight ? 'bg-gray-100' : 'bg-zinc-800/50';
  const btnHover = isLight ? 'hover:bg-gray-200' : 'hover:bg-zinc-700';
  const panelBg = isLight ? 'bg-gray-100' : 'bg-zinc-800';

  const isBasicOrPremium = userTier === 'tier_2' || userTier === 'tier_3' || userTier === 'admin' || userTier === 'tier_4';

  const models = [
    { id: 'GFS', label: 'GFS', locked: false },
    { id: 'EURO', label: 'EURO', locked: !isBasicOrPremium },
    { id: 'ICON', label: 'ICON', locked: !isBasicOrPremium }
  ];

  const layers = [
    { id: 'satellite', label: 'Satellite', icon: Globe, color: 'text-zinc-400' },
    { id: 'swell', label: 'Swell Energy', icon: Waves, color: 'text-blue-400' },
    { id: 'wind', label: 'Wind', icon: Wind, color: 'text-teal-400' },
    { id: 'rain', label: 'Precip', icon: CloudRain, color: 'text-indigo-400' },
    { id: 'pressure', label: 'Pressure', icon: Thermometer, color: 'text-rose-400' }
  ];

  const handleModelClick = (model) => {
    if (model.locked) {
      if (onUpgradeClick) onUpgradeClick();
    } else {
      onModelChange(model.id);
    }
  };

  const containerClass = isDesktop
    ? `absolute top-24 right-2 z-[1000] backdrop-blur-xl border rounded-xl transition-all duration-300 ease-in-out ${bgClass} ${isCollapsed ? 'w-12 h-12 p-0 overflow-hidden flex items-center justify-center cursor-pointer' : 'w-64 p-4 max-h-[calc(100vh-120px)] overflow-y-auto'}`
    : `w-full max-h-[60vh] overflow-y-auto rounded-xl p-4 backdrop-blur-xl border ${bgClass}`;

  if (isDesktop && isCollapsed) {
    return (
      <div className={containerClass} onClick={() => setIsCollapsed(false)}>
        <ChevronLeft className={`w-6 h-6 ${textClass}`} />
      </div>
    );
  }

  return (
    <div className={`${containerClass} hidden md:block`}>
      {isDesktop && (
        <button 
          onClick={() => setIsCollapsed(true)}
          className={`absolute top-3 right-3 p-1 rounded-md ${btnHover} transition-colors`}
        >
          <ChevronRight className={`w-5 h-5 ${textMuted}`} />
        </button>
      )}

      <h3 className={`${textClass} font-bold text-xs mb-3 uppercase tracking-wider`}>Forecast Models</h3>
      
      {/* Model Toggle */}
      <div className={`flex ${panelBg} rounded-lg p-1 mb-5`}>
        {models.map(model => (
          <button
            key={model.id}
            onClick={() => handleModelClick(model)}
            className={`flex-1 flex items-center justify-center gap-1 py-1 text-xs font-semibold rounded-md transition-all ${
              activeModel === model.id
                ? 'bg-cyan-500 text-black shadow-sm'
                : `${textMuted} hover:${textClass} ${btnHover}`
            }`}
          >
            {model.label}
            {model.locked && <Lock className="w-3 h-3 ml-0.5 opacity-70" />}
          </button>
        ))}
      </div>

      <h3 className={`${textClass} font-bold text-xs mb-3 uppercase tracking-wider`}>Weather Layers</h3>
      
      {/* Layer Toggles */}
      <div className="flex flex-col gap-1.5 mb-5">
        {layers.map(layer => {
          const isActive = activeLayers.includes(layer.id);
          const Icon = layer.icon;
          return (
            <button
              key={layer.id}
              onClick={() => onLayerToggle(layer.id)}
              className={`flex items-center justify-between px-3 py-1.5 rounded-lg border transition-all ${
                isActive 
                  ? `${panelBg} border-cyan-500/50` 
                  : `${btnBg} border-transparent ${btnHover}`
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${isActive ? layer.color : textMuted}`} />
                <span className={`text-xs font-medium ${isActive ? textClass : textMuted}`}>
                  {layer.label}
                </span>
              </div>
              <div className={`w-7 h-3.5 rounded-full p-[2px] transition-colors ${isActive ? 'bg-cyan-500' : (isLight ? 'bg-gray-300' : 'bg-zinc-600')}`}>
                <div className={`w-2.5 h-2.5 bg-white rounded-full transition-transform ${isActive ? 'translate-x-3.5' : 'translate-x-0'}`} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Legend / Key */}
      <div className={`p-3 rounded-lg ${panelBg} border border-transparent ${isBeach ? 'border-cyan-900/30' : ''}`}>
        <div className="flex items-center gap-1.5 mb-2">
          <Info className={`w-3.5 h-3.5 ${textMuted}`} />
          <span className={`text-[10px] font-bold uppercase tracking-wide ${textMuted}`}>Map Legend</span>
        </div>
        
        {activeLayers.includes('swell') && (
          <div className="mb-3">
            <div className={`text-[10px] ${textClass} mb-1 flex justify-between`}>
              <span>Waves (ft)</span>
            </div>
            <div className="h-2 w-full rounded-full bg-gradient-to-r from-blue-100 via-cyan-400 via-blue-600 via-purple-600 to-rose-700" />
            <div className={`text-[9px] ${textMuted} mt-0.5 flex justify-between px-1`}>
              <span>0</span><span>2</span><span>4</span><span>8</span><span>12</span><span>20+</span>
            </div>
          </div>
        )}
        
        {activeLayers.includes('wind') && (
          <div className="mb-3">
            <div className={`text-[10px] ${textClass} mb-1 flex justify-between`}>
              <span>Wind (kts)</span>
            </div>
            <div className="h-2 w-full rounded-full bg-gradient-to-r from-teal-100 via-emerald-400 via-yellow-400 via-orange-500 to-rose-600" />
            <div className={`text-[9px] ${textMuted} mt-0.5 flex justify-between px-1`}>
              <span>0</span><span>5</span><span>10</span><span>20</span><span>30</span><span>50+</span>
            </div>
          </div>
        )}

        {activeLayers.includes('rain') && (
          <div className="mb-3">
            <div className={`text-[10px] ${textClass} mb-1 flex justify-between`}>
              <span>Rain (in/h)</span>
            </div>
            <div className="h-2 w-full rounded-full bg-gradient-to-r from-gray-300 via-blue-400 via-indigo-500 via-purple-600 to-fuchsia-600" />
            <div className={`text-[9px] ${textMuted} mt-0.5 flex justify-between px-1`}>
              <span>0</span><span>.1</span><span>.3</span><span>.5</span><span>1.0</span><span>2+</span>
            </div>
          </div>
        )}

        {activeLayers.includes('pressure') && (
          <div className="mb-3">
            <div className={`text-[10px] ${textClass} mb-1 flex justify-between`}>
              <span>Pressure (hPa)</span>
            </div>
            <div className="h-2 w-full rounded-full bg-gradient-to-r from-gray-100 via-blue-300 via-emerald-300 via-yellow-400 to-red-600" />
            <div className={`text-[9px] ${textMuted} mt-0.5 flex justify-between px-1`}>
              <span>980</span><span>990</span><span>1000</span><span>1010</span><span>1020</span><span>1030</span>
            </div>
          </div>
        )}

        {!activeLayers.includes('swell') && !activeLayers.includes('wind') && !activeLayers.includes('rain') && !activeLayers.includes('pressure') && (
          <div className={`text-[10px] ${textMuted} italic`}>
            Enable a weather layer to see legend.
          </div>
        )}
      </div>
    </div>
  );
};

export default MapWeatherControls;
