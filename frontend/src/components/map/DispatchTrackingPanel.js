import React from 'react';
import { MapPin, Camera } from 'lucide-react';
import { Button } from '../ui/button';

const DispatchTrackingPanel = ({ activeDispatch, onDismiss }) => {
  if (!activeDispatch || activeDispatch.status !== 'en_route') return null;

  return (
    <div 
      className="fixed z-[9998] left-4 right-4 top-24 bg-gradient-to-r from-cyan-900/95 to-blue-900/95 backdrop-blur-md rounded-2xl border border-cyan-500/30 shadow-2xl p-4"
      data-testid="dispatch-tracking-panel"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-cyan-400 rounded-full animate-pulse"></div>
          <span className="text-cyan-300 text-sm font-bold uppercase tracking-wide">Pro En Route</span>
        </div>
        <span className="text-2xl font-bold text-white">
          {activeDispatch.estimated_arrival_minutes || '?'}<span className="text-sm font-normal text-gray-400 ml-1">min</span>
        </span>
      </div>
      
      <div className="flex items-center gap-4 mb-3">
        {activeDispatch.photographer_avatar ? (
          <img loading="lazy" decoding="async" src={activeDispatch.photographer_avatar} alt="" className="w-12 h-12 rounded-full border-2 border-cyan-400" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-cyan-500/30 flex items-center justify-center">
            <Camera className="w-6 h-6 text-cyan-400" />
          </div>
        )}
        <div>
          <p className="text-white font-medium">{activeDispatch.photographer_name || 'Photographer'}</p>
          <p className="text-gray-400 text-sm">is heading to your location</p>
        </div>
      </div>
      
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-300 text-sm">
          <MapPin className="w-4 h-4" />
          <span>{activeDispatch.location_name || 'Your location'}</span>
        </div>
        <Button
          onClick={onDismiss}
          variant="outline"
          size="sm"
          className="border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/20"
        >
          Details
        </Button>
      </div>
    </div>
  );
};

export default DispatchTrackingPanel;
