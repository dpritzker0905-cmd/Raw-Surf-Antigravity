/**
 * SpotHubLivePulse - Live shooting pulse banner
 * Extracted from SpotHub.js for modularization (v72)
 */
import React from 'react';
import { Camera, Radio, Crown, Zap } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { getFullUrl } from '../../utils/media';

const SpotHubLivePulse = ({ livePulse, navigate, spotId }) => {
  if (!livePulse?.pulse_active || !livePulse.live_photographers?.length) return null;

  return (
    <div 
      className="mx-4 mt-3 relative overflow-hidden rounded-xl border border-red-500/30"
      data-testid="live-pulse-banner"
    >
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-r from-red-600/20 via-orange-500/20 to-red-600/20 animate-pulse" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(239,68,68,0.3),transparent_70%)] animate-ping opacity-30 animate-duration-2s" />
      
      <div className="relative p-3 bg-black/60 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {/* Pulsing live indicator */}
            <div className="relative">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <div className="absolute inset-0 w-3 h-3 bg-red-500 rounded-full animate-ping opacity-75" />
            </div>
            <span className="text-sm font-bold text-white">LIVE SHOOTING</span>
            <Badge className="bg-red-500 text-white text-[10px] animate-pulse">
              {livePulse.total_live} {livePulse.total_live === 1 ? 'Photographer' : 'Photographers'}
            </Badge>
          </div>
          <Radio className="w-5 h-5 text-red-400 animate-pulse" />
        </div>
        
        {/* Live photographers list */}
        <div className="flex flex-wrap gap-2">
          {livePulse.live_photographers.map((photographer) => (
            <div 
              key={photographer.photographer_id}
              onClick={() => navigate(`/profile/${photographer.photographer_id}`)}
              className="flex items-center gap-2 p-2 bg-zinc-800/80 rounded-lg cursor-pointer hover:bg-zinc-700/80 transition-all group"
            >
              {/* Animated ring around avatar */}
              <div className="relative">
                <div 
                  className="absolute -inset-1 bg-gradient-to-r from-red-500 to-orange-500 rounded-full opacity-75" 
                  style={{ animation: 'spin 3s linear infinite' }} 
                />
                <Avatar className="w-8 h-8 relative ring-2 ring-red-500">
                  <AvatarImage src={getFullUrl(photographer.avatar_url)} />
                  <AvatarFallback className="text-xs bg-red-500 text-white">
                    {photographer.photographer_name?.[0]}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-white truncate max-w-[100px] group-hover:text-red-300 transition-colors">
                  {photographer.photographer_name}
                </p>
                <div className="flex items-center gap-1 text-[10px] text-gray-400">
                  {photographer.is_approved_pro && (
                    <Crown className="w-2.5 h-2.5 text-yellow-400" />
                  )}
                  <Camera className="w-2.5 h-2.5 text-red-400" />
                  <span>{photographer.photo_count || 0} shots</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Book Now CTA */}
        {livePulse.live_photographers.length > 0 && (
          <div className="mt-2 pt-2 border-t border-red-500/20">
            <button aria-label="Zap"
              onClick={() => {
                const firstPhotographer = livePulse.live_photographers[0];
                navigate(`/bookings?tab=live_now&photographer=${firstPhotographer.photographer_id}&spot=${spotId}`);
              }}
              className="w-full flex items-center justify-center gap-2 py-2 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white text-sm font-medium rounded-lg transition-all"
              data-testid="live-pulse-book-now"
            >
              <Zap className="w-4 h-4" />
              Get Photos Now
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SpotHubLivePulse;
