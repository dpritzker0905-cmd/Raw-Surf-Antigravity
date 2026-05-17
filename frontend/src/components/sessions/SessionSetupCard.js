/**
 * SessionSetupCard GÇö Session configuration preview card for photographers.
 * Extracted from PhotographerSessionsManager.js.
 * 
 * Shows current session settings: buy-in, photos/videos included,
 * photo/video pricing (promotional or tiered), max surfers, auto-accept.
 */
import React from 'react';
import { Settings, Zap, Users, Tag, Video } from 'lucide-react';
import { Image as ImageIcon } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

const SessionSetupCard = ({
  sessionSettings,
  isLight,
  textPrimaryClass,
  textSecondaryClass,
  cardBgClass,
  onOpenSettings,
}) => {
  return (
    <Card className={`mb-6 ${cardBgClass}`}>
      <CardHeader>
        <CardTitle className={`text-lg ${textPrimaryClass} flex items-center gap-2`}>
          <Settings className="w-5 h-5" />
          Session Setup
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Buy-in Price */}
        <div className="flex items-center justify-between">
          <div>
            <p className={textPrimaryClass}>Session Buy-in</p>
            <p className={`text-sm ${textSecondaryClass}`}>${sessionSettings.price_per_join} per surfer</p>
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={onOpenSettings}
            className={isLight ? 'border-gray-300' : 'border-zinc-700'}
          >
            Edit
          </Button>
        </div>
        
        {/* Photos Included */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-cyan-400" />
            <div>
              <p className={textPrimaryClass}>Photos Included</p>
              <p className={`text-sm ${textSecondaryClass}`}>{sessionSettings.photos_included} with buy-in</p>
            </div>
          </div>
        </div>
        
        {/* Videos Included */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-red-400" />
            <div>
              <p className={textPrimaryClass}>Videos Included</p>
              <p className={`text-sm ${textSecondaryClass}`}>{sessionSettings.videos_included} with buy-in</p>
            </div>
          </div>
        </div>
        
        {/* Photo Pricing */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-purple-400" />
            <div>
              <p className={textPrimaryClass}>Photo Pricing</p>
              <div className="flex items-center gap-2">
                {sessionSettings.pricing_mode === 'promotional' ? (
                  <>
                    <span className={`text-sm ${textSecondaryClass}`}>${sessionSettings.live_photo_price}/photo</span>
                    {sessionSettings.live_photo_price < sessionSettings.photo_price_high && (
                      <>
                        <span className="text-gray-500 line-through text-xs">${sessionSettings.photo_price_high}</span>
                        <Badge className="bg-green-500/20 text-green-400 text-xs">
                          Save ${sessionSettings.photo_price_high - sessionSettings.live_photo_price}
                        </Badge>
                      </>
                    )}
                  </>
                ) : (
                  <span className={`text-sm ${textSecondaryClass}`}>
                    ${sessionSettings.photo_price_web} / ${sessionSettings.photo_price_standard} / ${sessionSettings.photo_price_high}
                  </span>
                )}
              </div>
              <p className={`text-xs ${textSecondaryClass}`}>
                {sessionSettings.pricing_mode === 'promotional' ? 'Promo rate (high-res)' : 'Web / Standard / High-res'}
              </p>
            </div>
          </div>
        </div>
        
        {/* Video Pricing */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-red-400" />
            <div>
              <p className={textPrimaryClass}>Video Pricing</p>
              <div className="flex items-center gap-2">
                {sessionSettings.video_pricing_mode === 'promotional' ? (
                  <>
                    <span className={`text-sm ${textSecondaryClass}`}>${sessionSettings.live_video_price}/video</span>
                    {sessionSettings.live_video_price < sessionSettings.video_price_4k && (
                      <>
                        <span className="text-gray-500 line-through text-xs">${sessionSettings.video_price_4k}</span>
                        <Badge className="bg-green-500/20 text-green-400 text-xs">
                          Save ${sessionSettings.video_price_4k - sessionSettings.live_video_price}
                        </Badge>
                      </>
                    )}
                  </>
                ) : (
                  <span className={`text-sm ${textSecondaryClass}`}>
                    ${sessionSettings.video_price_720p} / ${sessionSettings.video_price_1080p} / ${sessionSettings.video_price_4k}
                  </span>
                )}
              </div>
              <p className={`text-xs ${textSecondaryClass}`}>
                {sessionSettings.video_pricing_mode === 'promotional' ? 'Promo rate (4K quality)' : '720p / 1080p / 4K'}
              </p>
            </div>
          </div>
        </div>
        
        {/* Max Surfers */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-400" />
            <div>
              <p className={textPrimaryClass}>Max Surfers</p>
              <p className={`text-sm ${textSecondaryClass}`}>{sessionSettings.max_surfers} capacity</p>
            </div>
          </div>
        </div>
        
        {/* Auto-Accept */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            <div>
              <p className={textPrimaryClass}>Auto-accept Surfers</p>
              <p className={`text-sm ${textSecondaryClass}`}>
                {sessionSettings.auto_accept ? 'Walk-ups welcome' : 'Manual approval'}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default SessionSetupCard;
