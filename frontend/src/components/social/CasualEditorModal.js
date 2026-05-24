// File: frontend/src/components/social/CasualEditorModal.js
import React, { useState, useEffect, useRef } from 'react';
import { X, Crop, Wind, Sun, RotateCw, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { toast } from 'sonner';

export const CasualEditorModal = ({ isOpen, onClose, file, fileIndex, weatherData, onSave, theme }) => {
  const [activeTab, setActiveTab] = useState('horizon'); // 'horizon' | 'filters' | 'telemetry'
  const [rotation, setRotation] = useState(0); // -45 to 45 degrees
  const [activeFilter, setActiveFilter] = useState('none'); // 'none' | 'sunrise' | 'teal' | 'overcast'
  const [telemetry, setTelemetry] = useState({
    spotName: true,
    surfStats: true,
    windStats: false,
  });

  const canvasRef = useRef(null);
  const imageRef = useRef(null);

  // Theme-aware classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  
  const mainBgClass = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-black border-zinc-800' : 'bg-zinc-950 border-zinc-800';
  const sidebarBgClass = isLight ? 'bg-gray-50 border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-900/50 border-zinc-800';
  const textPrimaryClass = isLight ? 'text-gray-900' : isBeach ? 'text-amber-50/90' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-500' : isBeach ? 'text-amber-200/50' : 'text-zinc-400';
  const tabBorderClass = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-800' : 'border-zinc-800';
  const itemBgClass = isLight ? 'bg-white border-gray-200 hover:border-blue-400' : isBeach ? 'bg-zinc-950 border-zinc-800 hover:border-amber-400' : 'bg-zinc-900 border-zinc-800 hover:border-cyan-500';
  const activeTabClass = isLight ? 'bg-blue-500/10 text-blue-600' : isBeach ? 'bg-amber-400/10 text-amber-400' : 'bg-cyan-500/10 text-cyan-400';
  const sliderAccentClass = isLight ? 'accent-blue-500' : isBeach ? 'accent-amber-400' : 'accent-cyan-400';
  const submitButtonClass = isLight ? 'bg-blue-600 hover:bg-blue-700 text-white font-bold' : isBeach ? 'bg-amber-400 hover:bg-amber-500 text-black font-bold' : 'bg-cyan-500 hover:bg-cyan-600 text-black font-bold';

  // Load image when file changes or when adjustments update
  useEffect(() => {
    if (!file || !isOpen) return;
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      imageRef.current = img;
      renderCanvas();
    };
    return () => URL.revokeObjectURL(img.src);
  }, [file, rotation, activeFilter, telemetry, isOpen]);

  const renderCanvas = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    
    // Clear and match canvas size to photo
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    
    // 1. Draw image with Rotation (Horizon Leveling)
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    
    // Auto-crop zoom factor to hide border corners during rotation
    const scaleFactor = 1 + Math.abs(rotation) / 45; 
    ctx.drawImage(
      img, 
      -img.width / 2 * scaleFactor, 
      -img.height / 2 * scaleFactor, 
      img.width * scaleFactor, 
      img.height * scaleFactor
    );
    ctx.restore();

    // 2. Apply Custom Marine CSS/Canvas filter overlays
    applyFilterOverlay(ctx, canvas.width, canvas.height);

    // 3. Draw Telemetry HUD Stems
    drawTelemetryHUD(ctx, canvas.width, canvas.height);
  };

  const applyFilterOverlay = (ctx, w, h) => {
    if (activeFilter === 'sunrise') {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(251, 191, 36, 0.15)'); // Warm Golden
      grad.addColorStop(1, 'rgba(244, 63, 94, 0.1)');   // Sunset Pink
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    } else if (activeFilter === 'teal') {
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, 'rgba(6, 182, 212, 0.15)');  // Seafoam Cyan
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    } else if (activeFilter === 'overcast') {
      // Contrast boost logic
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.fillRect(0, 0, w, h);
    }
  };

  const getDirAngle = (dirStr) => {
    const directions = {
      N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
      E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
      S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
      W: 270, WNW: 292.5, NW: 315, NNW: 337.5
    };
    return directions[dirStr?.toUpperCase()] ?? 0;
  };

  const drawTelemetryHUD = (ctx, w, h) => {
    if (!weatherData) return;

    ctx.save();
    
    const isLight = theme === 'light';
    const isBeach = theme === 'beach';
    const accentColor = isBeach ? '#fbbf24' : isLight ? '#2563eb' : '#06b6d4';
    const panelBg = 'rgba(10, 10, 10, 0.75)';
    const textColor = '#ffffff';
    const subTextColor = 'rgba(255, 255, 255, 0.7)';

    const margin = Math.round(w * 0.04);
    
    // Calculate layout based on activated fields
    let activeCount = 0;
    if (telemetry.spotName) activeCount++;
    if (telemetry.surfStats) activeCount++;
    if (telemetry.windStats) activeCount++;
    
    if (activeCount === 0) {
      ctx.restore();
      return;
    }

    const panelWidth = Math.round(w * 0.48);
    const panelHeight = Math.round(w * 0.16);
    const panelX = margin;
    const panelY = h - margin - panelHeight;

    // 1. Draw Glassmorphism Card Shadow & Panel
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;

    ctx.fillStyle = panelBg;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(panelX, panelY, panelWidth, panelHeight, 12);
    } else {
      ctx.rect(panelX, panelY, panelWidth, panelHeight);
    }
    ctx.fill();

    // Draw Accent Outline
    ctx.shadowColor = 'transparent'; // Reset shadow for stroke
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 2. Draw Text and Info on the Left Side
    const textX = panelX + 16;
    let textY = panelY + 24;
    const stepY = (panelHeight - 20) / Math.max(1, activeCount);

    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;

    if (telemetry.spotName && weatherData.spotName) {
      ctx.fillStyle = textColor;
      ctx.font = `bold ${Math.round(w * 0.016)}px Oswald, sans-serif`;
      ctx.fillText(`📍 ${weatherData.spotName.toUpperCase()}`, textX, textY);
      textY += stepY;
    }

    if (telemetry.surfStats && weatherData.waveHeight) {
      ctx.fillStyle = subTextColor;
      ctx.font = `${Math.round(w * 0.013)}px Inter, sans-serif`;
      ctx.fillText(`🌊 Swell: ${weatherData.waveHeight}ft @ ${weatherData.wavePeriod}s`, textX, textY);
      textY += stepY;
    }

    if (telemetry.windStats && weatherData.windSpeed) {
      ctx.fillStyle = subTextColor;
      ctx.font = `${Math.round(w * 0.013)}px Inter, sans-serif`;
      ctx.fillText(`💨 Wind: ${weatherData.windSpeed}kts ${weatherData.windDir}`, textX, textY);
    }

    // 3. Draw Synchronous Vector Compass Face and Swell Arrow on the Right Side
    const compassRadius = Math.round(panelHeight * 0.35);
    const compassX = panelX + panelWidth - compassRadius - 20;
    const compassY = panelY + panelHeight / 2;

    // Outer dial ring
    ctx.shadowBlur = 0; // turn off shadow
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(compassX, compassY, compassRadius, 0, 2 * Math.PI);
    ctx.stroke();

    // Ticks & Labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = `bold ${Math.round(w * 0.01)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', compassX, compassY - compassRadius + 6);
    ctx.fillText('S', compassX, compassY + compassRadius - 6);

    // Parse swell/wind direction angle
    const swellAngle = getDirAngle(weatherData.windDir || 'N');
    
    // Swell direction arrow
    ctx.save();
    ctx.translate(compassX, compassY);
    ctx.rotate((swellAngle * Math.PI) / 180);
    
    // Draw dynamic indicator arrow
    ctx.beginPath();
    ctx.moveTo(0, -compassRadius + 8); // Tip
    ctx.lineTo(4, -compassRadius + 18);
    ctx.lineTo(1.5, -compassRadius + 16);
    ctx.lineTo(1.5, compassRadius - 10);
    ctx.lineTo(-1.5, compassRadius - 10);
    ctx.lineTo(-1.5, -compassRadius + 16);
    ctx.lineTo(-4, -compassRadius + 18);
    ctx.closePath();
    
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.restore();

    ctx.restore();
  };

  const handleAutoHorizon = () => {
    setRotation(-2.5); 
    toast.success("Horizon aligned perfectly!");
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.toBlob((blob) => {
      const editedFile = new File([blob], file.name, { type: file.type });
      onSave(editedFile, fileIndex);
      onClose();
    }, file.type);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-md">
      <div className={`border rounded-2xl w-full max-w-4xl overflow-hidden flex flex-col md:flex-row h-[90vh] md:h-[80vh] ${mainBgClass}`}>
        
        {/* Left Side: Canvas Preview Area */}
        <div className="flex-1 bg-black flex items-center justify-center p-6 relative">
          <canvas ref={canvasRef} className="max-w-full max-h-full rounded-lg object-contain shadow-2xl" />
          <button onClick={onClose} className="absolute top-4 right-4 bg-zinc-800 hover:bg-zinc-700 p-2 rounded-full text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Right Side: Sidebar Controls */}
        <div className={`w-full md:w-80 border-t md:border-t-0 md:border-l flex flex-col ${sidebarBgClass}`}>
          {/* Navigation Tabs */}
          <div className={`flex border-b p-2 gap-1 ${tabBorderClass}`}>
            <button
              onClick={() => setActiveTab('horizon')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                activeTab === 'horizon' ? activeTabClass : `${textSecondaryClass} hover:text-white`
              }`}
            >
              <Crop className="w-3.5 h-3.5" /> Horizon
            </button>
            <button
              onClick={() => setActiveTab('filters')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                activeTab === 'filters' ? activeTabClass : `${textSecondaryClass} hover:text-white`
              }`}
            >
              <Sun className="w-3.5 h-3.5" /> Filters
            </button>
            <button
              onClick={() => setActiveTab('telemetry')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                activeTab === 'telemetry' ? activeTabClass : `${textSecondaryClass} hover:text-white`
              }`}
            >
              <Wind className="w-3.5 h-3.5" /> HUD Overlay
            </button>
          </div>

          {/* Active Tab Panel */}
          <div className="flex-1 p-4 overflow-y-auto space-y-6">
            
            {/* Horizon Panel */}
            {activeTab === 'horizon' && (
              <div className="space-y-4">
                <div>
                  <h3 className={`text-sm font-bold mb-1 ${textPrimaryClass}`}>Horizon Leveling</h3>
                  <p className="text-xs text-zinc-400">Align the ocean surface exactly flat.</p>
                </div>
                <Button onClick={handleAutoHorizon} className={submitButtonClass}>
                  <RotateCw className="w-4 h-4 mr-2 animate-spin-slow" /> Auto-Level Horizon
                </Button>
                <div className="space-y-2 pt-2">
                  <div className="flex justify-between text-xs font-semibold text-zinc-300">
                    <span className={textSecondaryClass}>Manual Correction</span>
                    <span className={isBeach ? 'text-amber-400' : isLight ? 'text-blue-500' : 'text-cyan-400'}>{rotation}°</span>
                  </div>
                  <input
                    type="range" min="-45" max="45" value={rotation}
                    onChange={(e) => setRotation(parseFloat(e.target.value))}
                    className={`w-full h-1 rounded-lg appearance-none cursor-pointer ${sliderAccentClass} bg-zinc-800`}
                  />
                </div>
              </div>
            )}

            {/* Filters Panel */}
            {activeTab === 'filters' && (
              <div className="space-y-4">
                <div>
                  <h3 className={`text-sm font-bold mb-1 ${textPrimaryClass}`}>Ocean Presets</h3>
                  <p className="text-xs text-zinc-400">Color grades engineered for surf and water glare.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'none', label: 'Original' },
                    { id: 'sunrise', label: '🌅 Sunrise Glow' },
                    { id: 'teal', label: '🌊 Deep Teal' },
                    { id: 'overcast', label: '🌫️ Storm Pop' }
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() => setActiveFilter(filter.id)}
                      className={`p-3 rounded-xl border text-left text-xs font-semibold flex items-center justify-between transition-colors ${
                        activeFilter === filter.id 
                          ? isBeach 
                            ? 'border-amber-400 bg-amber-400/5 text-amber-400' 
                            : isLight 
                              ? 'border-blue-500 bg-blue-500/5 text-blue-600' 
                              : 'border-cyan-400 bg-cyan-500/5 text-cyan-400' 
                          : itemBgClass
                      }`}
                    >
                      <span className={activeFilter === filter.id ? '' : textSecondaryClass}>{filter.label}</span>
                      {activeFilter === filter.id && <Check className="w-3.5 h-3.5" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Telemetry HUD Panel */}
            {activeTab === 'telemetry' && (
              <div className="space-y-4">
                <div>
                  <h3 className={`text-sm font-bold mb-1 ${textPrimaryClass}`}>Conditions HUD</h3>
                  <p className="text-xs text-zinc-400">Inject live offshore check-in telemetry overlays.</p>
                </div>
                <div className="space-y-3">
                  {[
                    { key: 'spotName', label: '📍 Show Surf Spot Name' },
                    { key: 'surfStats', label: '🌊 Show Swell Height & Period' },
                    { key: 'windStats', label: '💨 Show Wind Speed & Direction' }
                  ].map((opt) => (
                    <label key={opt.key} className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer ${itemBgClass}`}>
                      <span className={`text-xs font-semibold ${textSecondaryClass}`}>{opt.label}</span>
                      <input
                        type="checkbox"
                        checked={telemetry[opt.key]}
                        onChange={(e) => setTelemetry(prev => ({ ...prev, [opt.key]: e.target.checked }))}
                        className={`w-4 h-4 rounded border-zinc-700 focus:ring-offset-zinc-900 bg-zinc-800 ${
                          isBeach ? 'text-amber-400' : isLight ? 'text-blue-500' : 'text-cyan-500'
                        }`}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* Action Footer */}
          <div className={`p-4 border-t flex gap-2 ${tabBorderClass}`}>
            <Button variant="ghost" onClick={onClose} className="flex-1 text-zinc-400 hover:text-white">
              Cancel
            </Button>
            <Button onClick={handleSave} className={submitButtonClass}>
              Save Changes
            </Button>
          </div>

        </div>

      </div>
    </div>
  );
};
