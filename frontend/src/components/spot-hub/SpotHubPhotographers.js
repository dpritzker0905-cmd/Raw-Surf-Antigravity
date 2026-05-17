/**
 * SpotHubPhotographers - Active photographers at this spot
 * Extracted from SpotHub.js for modularization (v72)
 */
import React from 'react';
import { Camera, Lock, Crown, Navigation } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { getFullUrl } from '../../utils/media';

var SpotHubPhotographers = ({
  activePhotographers, navigate, handleOpenBookingModal,
  isWithinProximity, userTier,
  cardBg, rowBg, textPrimary, textSecondary,
}) => {
  if (!activePhotographers.length) return null;

  return (
    <div className={`mx-4 mt-3 p-3 rounded-xl border backdrop-blur-md ${cardBg}`} data-testid="photographers-section">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs flex items-center gap-1 ${textSecondary}`}>
          <Camera className="w-3 h-3 text-cyan-400" />
          Photographers at this Spot
        </span>
        <div className="flex items-center gap-1">
          {activePhotographers.filter(p => p.status === 'live_shooting' || p.is_shooting).length > 0 && (
            <Badge className="bg-red-500/20 text-red-400 text-[10px]">
              {activePhotographers.filter(p => p.status === 'live_shooting' || p.is_shooting).length} live
            </Badge>
          )}
          {activePhotographers.filter(p => p.status === 'on_demand' || (p.is_on_demand && !p.is_shooting)).length > 0 && (
            <Badge className="bg-amber-500/20 text-amber-400 text-[10px]">
              {activePhotographers.filter(p => p.status === 'on_demand' || (p.is_on_demand && !p.is_shooting)).length} on-demand
            </Badge>
          )}
        </div>
      </div>
      
      <div className="space-y-2">
        {activePhotographers.map((photographer, index) => {
          const isHidden = !isWithinProximity && (
            (userTier === 'free' && index >= 1) ||
            (userTier === 'paid' && index >= 3)
          );
          
          if (isHidden) {
            return (
              <div 
                key={photographer.id}
                className={`flex items-center gap-3 p-2 rounded-lg opacity-50 ${rowBg}`}
              >
                <div className="w-10 h-10 rounded-full bg-zinc-700/50 flex items-center justify-center">
                  <Lock className="w-4 h-4 text-purple-400" />
                </div>
                <div className="flex-1">
                  <p className={`text-sm ${textSecondary}`}>Hidden Photographer</p>
                  <p className="text-[10px] text-purple-400">Upgrade to view</p>
                </div>
                <Button aria-label="Crown" 
                  size="sm" 
                  onClick={() => navigate('/settings?tab=billing')}
                  className="text-[10px] bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 h-7 px-2"
                >
                  <Crown className="w-3 h-3 mr-1" />
                  Unlock
                </Button>
              </div>
            );
          }
          
          return (
            <div 
              key={photographer.id}
              className={`flex items-center gap-3 p-2 rounded-lg ${rowBg}`}
            >
              <Avatar 
                className={`w-10 h-10 cursor-pointer ring-2 ${
                  photographer.status === 'live_shooting' || photographer.is_shooting
                    ? 'ring-red-500'
                    : photographer.status === 'on_demand' || photographer.is_on_demand
                      ? 'ring-amber-500'
                      : 'ring-cyan-500'
                }`}
                onClick={() => navigate(`/profile/${photographer.id}`)}
              >
                <AvatarImage src={getFullUrl(photographer.avatar_url)} />
                <AvatarFallback className="text-sm">{photographer.full_name?.[0]}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${textPrimary}`}>{photographer.full_name}</p>
                <div className="flex items-center gap-2 text-[10px]">
                  <Badge className={`py-0 px-1 ${
                    photographer.role === 'approved_pro' 
                      ? 'bg-yellow-500 text-black' 
                      : 'bg-zinc-600 text-gray-300'
                  }`}>
                    {photographer.role === 'approved_pro' ? 'PRO' : 'Regular'}
                  </Badge>
                  <span className={`flex items-center gap-0.5 ${
                    photographer.status === 'live_shooting' || photographer.is_shooting 
                      ? 'text-red-400' 
                      : photographer.status === 'on_demand' || photographer.is_on_demand
                        ? 'text-amber-400'
                        : 'text-cyan-400'
                  }`}>
                    <Camera className="w-2.5 h-2.5" />
                    {photographer.status === 'live_shooting' || photographer.is_shooting
                      ? 'Live Shooting'
                      : photographer.status === 'on_demand' || photographer.is_on_demand
                        ? 'On-Demand'
                        : 'Available'
                    }
                  </span>
                </div>
              </div>
              {(() => {
                const isOnDemand = photographer.status === 'on_demand' || photographer.is_on_demand;
                const isLive = photographer.status === 'live_shooting' || photographer.is_shooting;
                
                if (isOnDemand && photographer.on_demand_hourly_rate) {
                  return (
                    <div className="text-right">
                      <p className="text-sm font-bold text-amber-400">${photographer.on_demand_hourly_rate}</p>
                      <p className="text-[9px] text-gray-500">per hour</p>
                    </div>
                  );
                } else if (isLive && photographer.session_price) {
                  return (
                    <div className="text-right">
                      <p className="text-sm font-bold text-emerald-400">${photographer.session_price}</p>
                      <p className="text-[9px] text-gray-500">per session</p>
                    </div>
                  );
                } else if (photographer.booking_hourly_rate || photographer.hourly_rate) {
                  return (
                    <div className="text-right">
                      <p className="text-sm font-bold text-cyan-400">${photographer.booking_hourly_rate || photographer.hourly_rate}</p>
                      <p className="text-[9px] text-gray-500">per hour</p>
                    </div>
                  );
                }
                return null;
              })()}
              <Button 
                size="sm" 
                onClick={() => handleOpenBookingModal(photographer)}
                className={`text-[10px] h-7 px-2 ${
                  photographer.status === 'live_shooting' || photographer.is_shooting
                    ? 'bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white'
                    : photographer.status === 'on_demand' || photographer.is_on_demand
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white'
                      : 'bg-cyan-500 hover:bg-cyan-600 text-white'
                }`}
                data-testid={`book-photographer-${photographer.id}`}
              >
                {photographer.status === 'live_shooting' || photographer.is_shooting
                  ? 'Jump In'
                  : photographer.status === 'on_demand' || photographer.is_on_demand
                    ? 'Request'
                    : 'Book'
                }
              </Button>
            </div>
          );
        })}
      </div>
      
      {/* Upgrade prompt for free/paid users */}
      {!isWithinProximity && userTier !== 'premium' && activePhotographers.length > (userTier === 'free' ? 1 : 3) && (
        <div className="mt-2 pt-2 border-t border-zinc-700">
          <button aria-label="Crown" 
            onClick={() => navigate('/settings?tab=billing')}
            className="w-full flex items-center justify-center gap-1 text-xs text-purple-400 hover:text-purple-300"
          >
            <Crown className="w-3 h-3" />
            Upgrade to see all {activePhotographers.length} photographers
          </button>
        </div>
      )}
      
      {/* Proximity indicator */}
      {isWithinProximity && (
        <div className="mt-2 pt-2 border-t border-zinc-700">
          <p className="text-[10px] text-emerald-400 text-center flex items-center justify-center gap-1">
            <Navigation className="w-3 h-3" />
            You're within 1 mile - viewing all photographers
          </p>
        </div>
      )}
    </div>
  );
};

export default SpotHubPhotographers;
