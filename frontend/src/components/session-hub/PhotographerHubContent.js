/**
 * PhotographerHubContent -- Extracted from SurferSessionHub.js (v79)
 *
 * "Active Duty" console for photographers:
 * 1. Go On-Demand -- Toggle availability with spot selection
 * 2. Go Live -- Start active shooting session
 * 3. Other Shooters -- See who's nearby
 * 4. Scheduled Sessions -- Today's agenda only
 */
import React from 'react';
import { Radio, MapPin, Calendar, ChevronRight, Zap, Play } from 'lucide-react';
import { SpotSelector } from '../SpotSelector';

const PhotographerHubContent = ({ 
  onClose, 
  navigate, 
  liveCount, 
  onDemandActive, 
  onToggleOnDemand, 
  selectedSpot,
  onSelectSpot,
  photographerTier,
  showSpotSelector,
  setShowSpotSelector,
  _pendingToggle,
  onConfirmToggle,
  // Go Live state
  liveActive,
  selectedLiveSpot,
  onSelectLiveSpot,
  showLiveSpotSelector,
  setShowLiveSpotSelector,
  onGoLive
  // GPS state now handled ONLY in parent header - removed from here
}) => {
  // Toggle is DISABLED until a spot is selected (only when trying to activate)
  const canToggle = onDemandActive || selectedSpot;
  
  const handleToggleClick = () => {
    if (!onDemandActive && !selectedSpot) {
      // Show spot selector first if trying to enable without a spot
      setShowSpotSelector(true);
      return;
    }
    onToggleOnDemand();
  };

  return (
    <div className="space-y-3">
      {/* GPS Status REMOVED - Now shown ONLY in parent header (MobileSessionHub/DesktopSessionHub) */}
      
      {/* 1. Go On-Demand - Primary Action with Status */}
      <div className={`p-4 rounded-xl border-2 transition-all ${
        onDemandActive 
          ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-400/50' 
          : 'bg-zinc-800/50 border-zinc-700'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
              onDemandActive ? 'bg-yellow-500/30' : 'bg-zinc-700'
            }`}>
              <Zap className={`w-5 h-5 ${onDemandActive ? 'text-yellow-400' : 'text-gray-400'}`} />
            </div>
            <div>
              <p className="text-white font-medium text-sm">Go On-Demand</p>
              <p className={`text-xs ${onDemandActive ? 'text-yellow-300' : 'text-gray-400'}`}>
                {onDemandActive ? 'Accepting requests' : selectedSpot ? 'Ready to activate' : 'Select spot to enable'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Settings shortcut arrow */}
            <button aria-label="Next"
              onClick={(e) => {
                e.stopPropagation();
                navigate('/photographer/on-demand-settings');
                onClose?.();
              }}
              className="p-1.5 rounded-lg hover:bg-zinc-700/50 text-gray-400 hover:text-yellow-400 transition-colors"
              title="On-Demand Settings"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={handleToggleClick}
              disabled={!canToggle && !onDemandActive}
              className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${
                onDemandActive ? 'bg-yellow-500' : canToggle ? 'bg-zinc-600' : 'bg-zinc-700 opacity-50 cursor-not-allowed'
              }`}
              data-testid="on-demand-toggle"
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                onDemandActive ? 'left-[calc(100%-22px)]' : 'left-0.5'
              }`} />
            </button>
          </div>
        </div>
        
        {/* Selected Spot Display or SpotSelector */}
        {(showSpotSelector || (!onDemandActive && !selectedSpot)) && !onDemandActive && (
          <div className="mt-3 pt-3 border-t border-zinc-700">
            <SpotSelector
              selectedSpot={selectedSpot}
              onSelectSpot={(spot) => {
                onSelectSpot(spot);
                setShowSpotSelector(false);
              }}
              photographerTier={photographerTier}
              disabled={false}
              compact={false}
            />
            {/* Activate button after spot selection */}
            {selectedSpot && (
              <button aria-label="Zap"
                onClick={onConfirmToggle}
                className="w-full mt-3 py-2.5 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-black font-medium text-sm flex items-center justify-center gap-2"
                data-testid="activate-on-demand-btn"
              >
                <Zap className="w-4 h-4" />
                Activate On-Demand
              </button>
            )}
          </div>
        )}
        
        {/* Show selected spot when on-demand is active */}
        {onDemandActive && selectedSpot && (
          <div className="mt-3 pt-3 border-t border-yellow-500/30 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-green-400" />
            <span className="text-sm text-green-300">Active at: {typeof selectedSpot === 'object' ? selectedSpot.name : selectedSpot}</span>
          </div>
        )}
        
        {/* Change spot option when active */}
        {onDemandActive && (
          <button
            onClick={() => setShowSpotSelector(true)}
            className="mt-2 text-xs text-yellow-400 hover:text-yellow-300 underline"
          >
            Change spot
          </button>
        )}
      </div>

    {/* 2. Go Live / Start Session - UNIFIED UI with toggle (matches On-Demand) */}
    <div className={`p-4 rounded-xl border-2 transition-all ${
      liveActive 
        ? 'bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border-emerald-400/50' 
        : 'bg-zinc-800/50 border-zinc-700'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
            liveActive ? 'bg-emerald-500/30' : 'bg-zinc-700'
          }`}>
            <Play className={`w-5 h-5 ${liveActive ? 'text-emerald-400' : 'text-gray-400'}`} />
          </div>
          <div>
            <p className="text-white font-medium text-sm">Go Live</p>
            <p className={`text-xs ${liveActive ? 'text-emerald-300' : 'text-gray-400'}`}>
              {liveActive ? 'Currently shooting' : selectedLiveSpot ? 'Ready to go live' : 'Select spot to enable'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Settings shortcut arrow - mirrors On-Demand */}
          <button aria-label="Next"
            onClick={(e) => {
              e.stopPropagation();
              navigate('/photographer/sessions');
              onClose?.();
            }}
            className="p-1.5 rounded-lg hover:bg-zinc-700/50 text-gray-400 hover:text-emerald-400 transition-colors"
            title="Live Settings"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {/* Toggle switch - identical to On-Demand */}
          <button
            onClick={() => {
              if (liveActive) {
                // End live session
                onGoLive(null);
              } else if (selectedLiveSpot) {
                // Start live at selected spot
                onGoLive(selectedLiveSpot);
              } else {
                // Show spot selector
                setShowLiveSpotSelector(true);
              }
            }}
            disabled={!liveActive && !selectedLiveSpot}
            className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${
              liveActive 
                ? 'bg-emerald-500' 
                : selectedLiveSpot 
                  ? 'bg-zinc-600' 
                  : 'bg-zinc-700 opacity-50 cursor-not-allowed'
            }`}
            data-testid="go-live-toggle"
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
              liveActive ? 'left-[calc(100%-22px)]' : 'left-0.5'
            }`} />
          </button>
        </div>
      </div>
      
      {/* Live Spot Selector - identical layout to On-Demand */}
      {(showLiveSpotSelector || (!liveActive && !selectedLiveSpot)) && !liveActive && (
        <div className="mt-3 pt-3 border-t border-zinc-700">
          <SpotSelector
            selectedSpot={selectedLiveSpot}
            onSelectSpot={(spot) => {
              onSelectLiveSpot(spot);
              setShowLiveSpotSelector(false);
            }}
            photographerTier={photographerTier}
            disabled={false}
            compact={false}
          />
          {/* Activate button after spot selection - matches On-Demand */}
          {selectedLiveSpot && (
            <button aria-label="Play"
              onClick={() => {
                onGoLive(selectedLiveSpot);
                setShowLiveSpotSelector(false);
              }}
              className="w-full mt-3 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-medium text-sm flex items-center justify-center gap-2"
              data-testid="activate-live-btn"
            >
              <Play className="w-4 h-4" />
              Go Live
            </button>
          )}
        </div>
      )}
      
      {/* Show current live spot - identical to On-Demand display */}
      {liveActive && selectedLiveSpot && (
        <div className="mt-3 pt-3 border-t border-emerald-500/30 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-green-400" />
          <span className="text-sm text-green-300">Live at: {typeof selectedLiveSpot === 'object' ? selectedLiveSpot.name : selectedLiveSpot}</span>
        </div>
      )}
      
      {/* Change spot option when active - matches On-Demand */}
      {liveActive && (
        <button
          onClick={() => setShowLiveSpotSelector(true)}
          className="mt-2 text-xs text-emerald-400 hover:text-emerald-300 underline"
        >
          Change spot
        </button>
      )}
    </div>

    {/* 3. Other Shooters Nearby */}
    <button
      onClick={() => {
        navigate('/map?filter=photographers');
        onClose?.();
      }}
      className="w-full flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl transition-colors"
      data-testid="session-hub-live"
    >
      <div className="w-11 h-11 rounded-xl bg-cyan-500/20 flex items-center justify-center">
        <Radio className="w-5 h-5 text-cyan-400" />
      </div>
      <div className="flex-1 text-left">
        <p className="text-white font-medium text-sm">Other Shooters</p>
        <p className="text-gray-400 text-xs">See who else is live nearby</p>
      </div>
      <div className="flex items-center gap-2">
        {liveCount > 0 && (
          <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-400 text-xs font-medium rounded-full">
            {liveCount}
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-gray-500" />
      </div>
    </button>

    {/* 4. Scheduled Sessions (Today's Agenda Only) */}
    <button
      onClick={() => {
        navigate('/photographer/bookings?view=today');
        onClose?.();
      }}
      className="w-full flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl transition-colors"
      data-testid="session-hub-bookings"
    >
      <div className="w-11 h-11 rounded-xl bg-purple-500/20 flex items-center justify-center">
        <Calendar className="w-5 h-5 text-purple-400" />
      </div>
      <div className="flex-1 text-left">
        <p className="text-white font-medium text-sm">Scheduled Sessions</p>
        <p className="text-gray-400 text-xs">Today's agenda</p>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-500" />
    </button>
  </div>
  );
};

export default PhotographerHubContent;
