import React, { useState, useEffect } from 'react';
import { Square, Clock, Users, DollarSign, MapPin, Eye, Camera, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from './ui/button';

/**
 * LiveStatusHUD - Persistent "Active Session" Heads-Up Display
 * 
 * Shows when a photographer has an active session:
 * - Blinking 'LIVE' indicator
 * - Session timer (counting up)
 * - High-contrast 'End Session' button
 * - Real-time stats (surfers, views, earnings)
 * 
 * Can be displayed in both compact (bar) and expanded modes.
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
      setElapsed(diff);
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

// Blinking Live Indicator Component
const BlinkingLiveIndicator = ({ size = 'default' }) => {
  const sizeClasses = {
    small: 'w-2 h-2',
    default: 'w-2.5 h-2.5',
    large: 'w-3 h-3'
  };
  
  return (
    <div className="flex items-center gap-1.5">
      <span className={`${sizeClasses[size]} bg-red-500 rounded-full animate-pulse`} 
        style={{ 
          animation: 'blink 1s ease-in-out infinite',
          boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)'
        }} 
      />
      <span className="text-red-400 font-bold text-xs uppercase tracking-wider">LIVE</span>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
};

// Compact Bar Version
const LiveStatusBar = ({ 
  session, 
  onEndSession, 
  onExpand,
  isExpanded = false 
}) => {
  const elapsed = useSessionTimer(session?.started_at);
  
  return (
    <div 
      className="w-full bg-gradient-to-r from-red-900/90 to-red-800/90 backdrop-blur-sm border-b border-red-500/30"
      data-testid="live-status-bar"
    >
      <div className="max-w-2xl mx-auto px-4 py-2 flex items-center justify-between">
        {/* Left: Live indicator + Timer */}
        <div className="flex items-center gap-4">
          <BlinkingLiveIndicator />
          
          <div className="flex items-center gap-1.5 text-white/90">
            <Clock className="w-3.5 h-3.5" />
            <span className="font-mono text-sm font-medium">{formatTime(elapsed)}</span>
          </div>
          
          {session?.location && (
            <div className="hidden sm:flex items-center gap-1.5 text-white/70">
              <MapPin className="w-3.5 h-3.5" />
              <span className="text-sm truncate max-w-[120px]">{session.location}</span>
            </div>
          )}
        </div>
        
        {/* Right: Stats + End Button */}
        <div className="flex items-center gap-3">
          {/* Quick stats - hidden on very small screens */}
          <div className="hidden xs:flex items-center gap-3 text-white/80">
            <div className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              <span className="text-sm font-medium">{session?.active_surfers || 0}</span>
            </div>
            <div className="flex items-center gap-1 text-green-400">
              <DollarSign className="w-3.5 h-3.5" />
              <span className="text-sm font-medium">{(session?.earnings || 0).toFixed(0)}</span>
            </div>
          </div>
          
          {/* Expand/Collapse button */}
          <button
            onClick={onExpand}
            className="p-1 text-white/60 hover:text-white transition-colors"
            data-testid="expand-hud-btn"
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
          
          {/* End Session Button */}
          <Button
            onClick={onEndSession}
            size="sm"
            className="bg-white hover:bg-gray-100 text-red-600 font-bold text-xs px-3 py-1 h-7"
            data-testid="end-session-btn-bar"
          >
            <Square className="w-3 h-3 mr-1 fill-current" />
            End
          </Button>
        </div>
      </div>
    </div>
  );
};

// Expanded Panel Version
const LiveStatusPanel = ({ 
  session, 
  onEndSession,
  onCollapse,
  onUploadPhotos
}) => {
  const elapsed = useSessionTimer(session?.started_at);
  
  return (
    <div 
      className="w-full bg-gradient-to-b from-red-900/95 to-zinc-900/95 backdrop-blur-md border-b border-red-500/30 shadow-xl"
      data-testid="live-status-panel"
    >
      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Header Row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <BlinkingLiveIndicator size="large" />
            <div className="h-4 w-px bg-red-500/30" />
            <div className="flex items-center gap-1.5 text-white">
              <Clock className="w-4 h-4" />
              <span className="font-mono text-lg font-bold">{formatTime(elapsed)}</span>
            </div>
          </div>
          
          <button
            onClick={onCollapse}
            className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded transition-colors"
          >
            <ChevronUp className="w-5 h-5" />
          </button>
        </div>
        
        {/* Location */}
        {session?.location && (
          <div className="flex items-center gap-2 mb-4 text-white/90">
            <MapPin className="w-4 h-4 text-cyan-400" />
            <span className="font-medium">{session.location}</span>
          </div>
        )}
        
        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Users className="w-4 h-4 text-cyan-400" />
            </div>
            <p className="text-white text-xl font-bold">{session?.active_surfers || 0}</p>
            <p className="text-white/50 text-xs">Surfers</p>
          </div>
          
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Eye className="w-4 h-4 text-yellow-400" />
            </div>
            <p className="text-white text-xl font-bold">{session?.views || 0}</p>
            <p className="text-white/50 text-xs">Views</p>
          </div>
          
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <DollarSign className="w-4 h-4 text-green-400" />
            </div>
            <p className="text-green-400 text-xl font-bold">${(session?.earnings || 0).toFixed(2)}</p>
            <p className="text-white/50 text-xs">Earned</p>
          </div>
        </div>
        
        {/* Active Participants Preview */}
        {session?.participants?.length > 0 && (
          <div className="mb-4">
            <p className="text-white/60 text-xs mb-2">Active Surfers</p>
            <div className="flex flex-wrap gap-2">
              {session.participants.slice(0, 5).map((p) => (
                <div 
                  key={p.id} 
                  className="flex items-center gap-2 px-2 py-1 bg-white/10 rounded-full"
                >
                  <div className="w-5 h-5 rounded-full bg-zinc-700 overflow-hidden">
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="flex items-center justify-center h-full text-[10px] text-white/70">
                        {p.name?.[0] || '?'}
                      </span>
                    )}
                  </div>
                  <span className="text-white text-xs">{p.name}</span>
                </div>
              ))}
              {session.participants.length > 5 && (
                <span className="text-white/50 text-xs self-center">
                  +{session.participants.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}
        
        {/* Action Buttons */}
        <div className="flex gap-3">
          {onUploadPhotos && (
            <Button
              onClick={onUploadPhotos}
              variant="outline"
              className="flex-1 border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
              data-testid="upload-photos-hud-btn"
            >
              <Camera className="w-4 h-4 mr-2" />
              Upload Photos
            </Button>
          )}
          
          <Button
            onClick={onEndSession}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold"
            data-testid="end-session-btn-panel"
          >
            <Square className="w-4 h-4 mr-2 fill-current" />
            End Session
          </Button>
        </div>
      </div>
    </div>
  );
};

// Main Component with toggle between bar and panel
const LiveStatusHUD = ({ 
  session, 
  onEndSession,
  onUploadPhotos,
  variant = 'auto', // 'bar' | 'panel' | 'auto'
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = useState(variant === 'panel');
  
  // Auto mode: start collapsed, expand on interaction
  useEffect(() => {
    if (variant === 'auto') {
      setIsExpanded(false);
    } else {
      setIsExpanded(variant === 'panel');
    }
  }, [variant]);
  
  if (!session) return null;
  
  return (
    <div className={`fixed top-0 left-0 right-0 z-[999] ${className}`} data-testid="live-status-hud">
      {isExpanded ? (
        <LiveStatusPanel
          session={session}
          onEndSession={onEndSession}
          onCollapse={() => setIsExpanded(false)}
          onUploadPhotos={onUploadPhotos}
        />
      ) : (
        <LiveStatusBar
          session={session}
          onEndSession={onEndSession}
          onExpand={() => setIsExpanded(true)}
          isExpanded={isExpanded}
        />
      )}
    </div>
  );
};

export default LiveStatusHUD;
export { LiveStatusBar, LiveStatusPanel, BlinkingLiveIndicator, useSessionTimer, formatTime };
