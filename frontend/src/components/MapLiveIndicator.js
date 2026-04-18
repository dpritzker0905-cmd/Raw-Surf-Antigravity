import React, { useState, useEffect } from 'react';
import { Square, Clock, MapPin } from 'lucide-react';
import { Button } from './ui/button';

/**
 * MapLiveIndicator - Map-Integrated Live Session HUD
 * 
 * Displays INSIDE the map UI layer (not as external bar) with:
 * - Left: Soft red pulsing 'LIVE' indicator
 * - Center: Session timer (elapsed time)
 * - Position: Top-left corner of map, below filters
 * 
 * The End button is rendered separately in the top-right corner.
 */

// Custom hook for session timer
const useSessionTimer = (startTime) => {
  const [elapsed, setElapsed] = useState(0);
  
  useEffect(() => {
    if (!startTime) return;
    
    const startDate = new Date(startTime);
    
    const updateElapsed = () => {
      const now = new Date();
      const diff = Math.floor((now - startDate) / 1000);
      setElapsed(Math.max(0, diff));
    };
    
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    
    return () => clearInterval(interval);
  }, [startTime]);
  
  return elapsed;
};

// Format seconds to HH:MM:SS or MM:SS
const formatTime = (seconds) => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// Soft Red Pulsing Live Indicator
const PulsingLiveIndicator = () => (
  <div className="flex items-center gap-2">
    <span 
      className="w-2.5 h-2.5 rounded-full"
      style={{ 
        backgroundColor: '#ef4444',
        boxShadow: '0 0 8px rgba(239, 68, 68, 0.5)',
        animation: 'softPulse 2s ease-in-out infinite'
      }} 
    />
    <span className="text-red-400 font-bold text-xs uppercase tracking-wider">LIVE</span>
    <style>{`
      @keyframes softPulse {
        0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(239, 68, 68, 0.5); }
        50% { opacity: 0.6; box-shadow: 0 0 12px rgba(239, 68, 68, 0.8); }
      }
    `}</style>
  </div>
);

// Main Map Live Indicator Component (Left side - Live status + Timer)
export const MapLiveIndicator = ({ session, className = '' }) => {
  const elapsed = useSessionTimer(session?.started_at);
  
  if (!session) return null;
  
  return (
    <div 
      className={`flex items-center gap-3 px-3 py-2 bg-zinc-900/80 backdrop-blur-sm rounded-xl border border-red-500/30 ${className}`}
      data-testid="map-live-indicator"
    >
      <PulsingLiveIndicator />
      
      <div className="h-4 w-px bg-zinc-600" />
      
      <div className="flex items-center gap-1.5 text-white/90">
        <Clock className="w-3.5 h-3.5 text-gray-400" />
        <span className="font-mono text-sm font-medium">{formatTime(elapsed)}</span>
      </div>
      
      {session.location && (
        <>
          <div className="h-4 w-px bg-zinc-600 hidden sm:block" />
          <div className="hidden sm:flex items-center gap-1.5 text-white/70">
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs truncate max-w-[100px]">{session.location}</span>
          </div>
        </>
      )}
    </div>
  );
};

/**
 * MapLiveFloatingIsland - Combined floating island with LIVE + End button
 * 
 * A single floating island "nestled" below the header containing:
 * - Left: Pulsing LIVE dot + Timer + Location
 * - Right: High-contrast End button
 */
export const MapLiveFloatingIsland = ({ session, onEndSession, className = '' }) => {
  const elapsed = useSessionTimer(session?.started_at);
  
  if (!session) return null;
  
  return (
    <div 
      className={`flex items-center justify-between gap-4 px-4 py-2.5 bg-zinc-900/90 backdrop-blur-md rounded-2xl border border-zinc-700/50 shadow-lg ${className}`}
      data-testid="map-live-floating-island"
    >
      {/* Left Side: LIVE indicator + Timer */}
      <div className="flex items-center gap-3">
        <PulsingLiveIndicator />
        
        <div className="h-4 w-px bg-zinc-600" />
        
        <div className="flex items-center gap-1.5 text-white/90">
          <Clock className="w-3.5 h-3.5 text-gray-400" />
          <span className="font-mono text-sm font-medium">{formatTime(elapsed)}</span>
        </div>
        
        {session.location && (
          <>
            <div className="h-4 w-px bg-zinc-600 hidden sm:block" />
            <div className="hidden sm:flex items-center gap-1.5 text-white/70">
              <MapPin className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs truncate max-w-[100px]">{session.location}</span>
            </div>
          </>
        )}
      </div>
      
      {/* Right Side: End Button */}
      <Button
        onClick={onEndSession}
        size="sm"
        className="bg-red-500 hover:bg-red-600 text-white font-bold text-xs px-3 py-1.5 h-7"
        data-testid="floating-island-end-btn"
      >
        <Square className="w-3 h-3 mr-1.5 fill-current" />
        End
      </Button>
    </div>
  );
};

// Compact End Session Button (Top right corner)
export const MapEndSessionButton = ({ onEndSession, className = '' }) => (
  <Button
    onClick={onEndSession}
    size="sm"
    className={`bg-red-500/90 hover:bg-red-600 text-white font-bold text-xs px-3 py-1.5 h-8 shadow-lg backdrop-blur-sm ${className}`}
    data-testid="map-end-session-btn"
  >
    <Square className="w-3 h-3 mr-1.5 fill-current" />
    End
  </Button>
);

// Combined export for convenience
const MapLiveHUD = {
  FloatingIsland: MapLiveFloatingIsland,
  Indicator: MapLiveIndicator,
  EndButton: MapEndSessionButton,
  useSessionTimer,
  formatTime
};

export default MapLiveHUD;
