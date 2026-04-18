/**
 * LiveNowTab - Live photographers available for jump-in sessions
 * Extracted from Bookings.js for better maintainability
 */

import React from 'react';
import { Camera, MapPin, Radio, Sparkles, Star } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

// Live Savings Badge Component (synced with Map drawer)
const LiveSavingsBadge = ({ generalPrice, livePrice, className = '' }) => {
  const savings = generalPrice - livePrice;
  const _savingsPercent = generalPrice > 0 ? Math.round((savings / generalPrice) * 100) : 0;
  
  if (savings <= 0) return null;
  
  return (
    <Badge className={`bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold ${className}`}>
      <Sparkles className="w-3 h-3 mr-1" />
      Save ${savings}/photo!
    </Badge>
  );
};

export const LiveNowTab = ({
  livePhotographers,
  subscriptionTier,
  trackingRadius,
  onJumpIn,
  onNavigateToMap,
  theme
}) => {
  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';

  return (
    <>
      {/* Subscription Tier Info */}
      <Card className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/30">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-yellow-400/20 flex items-center justify-center">
              <Radio className="w-5 h-5 text-yellow-400" />
            </div>
            <div className="flex-1">
              <p className={`text-sm font-medium ${textPrimaryClass}`}>
                {subscriptionTier} Tier: {trackingRadius} Tracking
              </p>
              <p className={`text-xs ${textSecondaryClass}`}>
                {subscriptionTier === 'Free' ? (
                  <>Upgrade to <span className="text-yellow-400">Basic ($9.99/mo)</span> for 5 Miles • <span className="text-yellow-400">Premium ($19.99/mo)</span> for unlimited</>
                ) : subscriptionTier === 'Basic' ? (
                  <>Upgrade to <span className="text-yellow-400">Premium ($19.99/mo)</span> for unlimited worldwide tracking</>
                ) : (
                  <>Unlimited worldwide photographer tracking</>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live Photographers List */}
      {livePhotographers.length === 0 ? (
        <Card className={`${cardBgClass} transition-colors duration-300`}>
          <CardContent className="py-12 text-center">
            <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
              <Camera className={`w-8 h-8 ${textSecondaryClass}`} />
            </div>
            <h3 className={`text-lg font-medium ${textPrimaryClass} mb-2`}>No Live Photographers Nearby</h3>
            <p className={`${textSecondaryClass} mb-6`}>
              No photographers live within {trackingRadius.toLowerCase()} of you.
            </p>
            <Button
              onClick={onNavigateToMap}
              className="bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-medium"
              data-testid="view-map-btn"
            >
              View Map
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {livePhotographers.map((photographer) => {
            // Calculate savings
            const livePhotoPrice = photographer.live_photo_price || photographer.session_photo_price || 5;
            const generalPhotoPrice = photographer.general_photo_price || photographer.gallery_photo_price || 10;
            const hasSavings = generalPhotoPrice > livePhotoPrice;
            
            return (
              <Card key={photographer.id} className={`${cardBgClass} transition-colors duration-300`} data-testid={`photographer-card-${photographer.id}`}>
                <CardContent className="p-4">
                  {/* Live Session Deal Badge */}
                  {hasSavings && (
                    <div className="mb-3 p-2 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-green-400" />
                          <span className="text-green-400 font-medium text-sm">Live Session Deal</span>
                        </div>
                        <LiveSavingsBadge generalPrice={generalPhotoPrice} livePrice={livePhotoPrice} />
                      </div>
                      <p className="text-gray-400 text-xs mt-1">
                        ${photographer.session_price || 25} buy-in • ${livePhotoPrice}/photo vs ${generalPhotoPrice} gallery
                      </p>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <div className={`w-14 h-14 rounded-full ${isLight ? 'bg-gray-200' : 'bg-zinc-700'} overflow-hidden flex items-center justify-center`}>
                        {photographer.avatar_url ? (
                          <img src={photographer.avatar_url} alt={photographer.full_name} className="w-full h-full object-cover" />
                        ) : (
                          <Camera className="w-6 h-6 text-gray-400" />
                        )}
                      </div>
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-black flex items-center justify-center">
                        <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className={`font-medium ${textPrimaryClass} truncate`}>{photographer.full_name}</h3>
                      <div className={`flex items-center gap-1 text-sm ${textSecondaryClass}`}>
                        <MapPin className="w-3 h-3" />
                        <span className="truncate">{photographer.location || photographer.spot_name || 'Nearby'}</span>
                      </div>
                      <div className={`flex items-center gap-3 mt-1 text-sm ${textSecondaryClass}`}>
                        <span>{photographer.distance ? `${photographer.distance.toFixed(1)} mi away` : 'Within range'}</span>
                        <span className="text-yellow-400 font-medium">${photographer.session_price || 25}/session</span>
                      </div>
                      {/* Star rating if available */}
                      {photographer.avg_rating && (
                        <div className="flex items-center gap-1 mt-1">
                          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                          <span className="text-yellow-400 text-xs">{photographer.avg_rating.toFixed(1)}</span>
                          <span className="text-gray-500 text-xs">({photographer.review_count || 0})</span>
                        </div>
                      )}
                    </div>
                    <Button
                      onClick={() => onJumpIn(photographer)}
                      size="sm"
                      className="bg-gradient-to-r from-emerald-400 to-green-500 hover:from-emerald-500 hover:to-green-600 text-black font-medium"
                      data-testid={`jump-in-btn-${photographer.id}`}
                    >
                      Jump In
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          
          {/* View Map Button */}
          <Button
            onClick={onNavigateToMap}
            variant="outline"
            className={`w-full ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
            data-testid="view-all-map-btn"
          >
            <MapPin className="w-4 h-4 mr-2" />
            View All on Map
          </Button>
        </>
      )}
    </>
  );
};

export default LiveNowTab;
