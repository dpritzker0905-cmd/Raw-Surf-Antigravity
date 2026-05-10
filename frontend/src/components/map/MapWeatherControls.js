import React from 'react';
import { Wind, Waves, CloudRain, Thermometer, Lock } from 'lucide-react';
import { Button } from '../ui/button';

export const MapWeatherControls = ({
  isDesktop = true,
  activeModel,
  onModelChange,
  activeLayers,
  onLayerToggle,
  userTier = 'tier_1',
  onUpgradeClick
}) => {
  // Free: GFS only. Basic/Premium: GFS, EURO, ICON
  const isBasicOrPremium = userTier === 'tier_2' || userTier === 'tier_3' || userTier === 'admin' || userTier === 'tier_4';

  const models = [
    { id: 'GFS', label: 'GFS', locked: false },
    { id: 'EURO', label: 'EURO', locked: !isBasicOrPremium },
    { id: 'ICON', label: 'ICON', locked: !isBasicOrPremium }
  ];

  const layers = [
    { id: 'swell', label: 'Swell Energy', icon: Waves, color: 'text-blue-400' },
    { id: 'wind', label: 'Wind', icon: Wind, color: 'text-teal-400' },
    { id: 'rain', label: 'Precipitation', icon: CloudRain, color: 'text-indigo-400' },
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
    ? "absolute top-24 right-4 z-[1000] w-64 bg-zinc-900/90 backdrop-blur-md border border-zinc-800 rounded-xl shadow-2xl p-4 hidden md:block"
    : "w-full bg-zinc-900/90 rounded-xl p-4";

  return (
    <div className={containerClass}>
      <h3 className="text-white font-bold text-sm mb-3 uppercase tracking-wider">Forecast Models</h3>
      
      {/* Model Toggle */}
      <div className="flex bg-zinc-800 rounded-lg p-1 mb-6">
        {models.map(model => (
          <button
            key={model.id}
            onClick={() => handleModelClick(model)}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeModel === model.id
                ? 'bg-cyan-500 text-black shadow-sm'
                : 'text-gray-400 hover:text-white hover:bg-zinc-700'
            }`}
          >
            {model.label}
            {model.locked && <Lock className="w-3 h-3 ml-0.5 opacity-70" />}
          </button>
        ))}
      </div>

      <h3 className="text-white font-bold text-sm mb-3 uppercase tracking-wider">Weather Layers</h3>
      
      {/* Layer Toggles */}
      <div className="flex flex-col gap-2">
        {layers.map(layer => {
          const isActive = activeLayers.includes(layer.id);
          const Icon = layer.icon;
          return (
            <button
              key={layer.id}
              onClick={() => onLayerToggle(layer.id)}
              className={`flex items-center justify-between px-3 py-2 rounded-lg border transition-all ${
                isActive 
                  ? 'bg-zinc-800 border-cyan-500/50' 
                  : 'bg-zinc-800/50 border-transparent hover:bg-zinc-700'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? layer.color : 'text-gray-400'}`} />
                <span className={`text-sm font-medium ${isActive ? 'text-white' : 'text-gray-400'}`}>
                  {layer.label}
                </span>
              </div>
              <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${isActive ? 'bg-cyan-500' : 'bg-zinc-600'}`}>
                <div className={`w-3 h-3 bg-white rounded-full transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default MapWeatherControls;
