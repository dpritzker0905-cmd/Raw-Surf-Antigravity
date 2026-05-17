/**
 * GalleryPricingPanel - Session pricing summary and inline settings
 * Extracted from PhotographerGalleryManager.js for modularization (v74)
 */
import React from 'react';
import { Image as ImageIcon, Video } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';

/**
 * PricingTierRow - Displays a single service tier with pricing details
 */
const PricingTierRow = ({
  label, emoji, color, photosIncluded, videosIncluded,
  buyinPrice, buyinLabel, photo, video,
  textSecondaryClass, textPrimaryClass, isActive,
}) => {
  const colorMap = {
    emerald: { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)', text: 'text-emerald-400', ring: 'ring-emerald-400/30' },
    blue:    { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)', text: 'text-blue-400', ring: 'ring-blue-400/30' },
    amber:   { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', text: 'text-amber-400', ring: 'ring-amber-400/30' },
  };
  const c = colorMap[color] || colorMap.emerald;

  return (
    <div
      className={`rounded-xl p-3 ${isActive ? `ring-1 ${c.ring}` : ''}`}
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-bold ${c.text}`}>{emoji} {label}</span>
        {buyinPrice != null && (
          <span className={`text-xs ${textSecondaryClass}`}>
            ${buyinPrice}{buyinLabel || ' buy-in'}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {photosIncluded != null && (
          <Badge variant="outline" className={`border-${color}-500/30 ${c.text} text-[10px]`}>
            {photosIncluded} photos incl.
          </Badge>
        )}
        {videosIncluded != null && (
          <Badge variant="outline" className={`border-${color}-500/30 ${c.text} text-[10px]`}>
            {videosIncluded} video{videosIncluded !== 1 ? 's' : ''} incl.
          </Badge>
        )}
        {photo && (
          <span className={`text-[10px] ${textSecondaryClass}`}>
            =ƒô+ ${photo}
          </span>
        )}
        {video && (
          <span className={`text-[10px] ${textSecondaryClass}`}>
            =ƒÄ¼ ${video}
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * GalleryPricingPanel - Full pricing card with session settings and per-tier rows
 */
const GalleryPricingPanel = ({
  gallery, galleryId, pricing, user, showPricing,
  cardBgClass, textPrimaryClass, textSecondaryClass,
  setGallery, fetchSessionParticipants,
}) => {
  if (!showPricing) return null;

  const updateSessionSetting = async (key, val) => {
    try {
      await apiClient.patch(
        `/galleries/${galleryId}/session-settings?photographer_id=${user?.id}`,
        { [key]: val }
      );
      setGallery(prev => ({
        ...prev,
        session_settings: { ...prev.session_settings, [key]: val },
      }));
      toast.success(`${key.replace(/_/g, ' ')} updated to ${val}`);
      fetchSessionParticipants();
    } catch (e) {
      toast.error('Failed to update');
    }
  };

  return (
    <Card className={`mb-6 ${cardBgClass}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className={`text-sm ${textSecondaryClass}`}>Gallery Pricing & Session Settings</CardTitle>
          {gallery?.session_settings && (
            <Badge variant="outline" className={
              gallery.session_settings.session_type === 'live' ? 'border-emerald-500/50 text-emerald-400' :
              gallery.session_settings.session_type === 'booking' ? 'border-blue-500/50 text-blue-400' :
              gallery.session_settings.session_type === 'on_demand' ? 'border-amber-500/50 text-amber-400' :
              'border-zinc-500/50 text-zinc-400'
            }>
              {gallery.session_settings.session_type === 'live' ? '=ƒô+ Live Session' :
               gallery.session_settings.session_type === 'booking' ? '=ƒôà Booking' :
               gallery.session_settings.session_type === 'on_demand' ? 'GÜí On-Demand' : 'G£Ån+Å Manual'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Included Content - editable */}
        {gallery?.session_settings && (
          <div className="rounded-xl p-4" style={{
            background: 'linear-gradient(135deg, rgba(6,182,212,0.08), rgba(59,130,246,0.06))',
            border: '1px solid rgba(6,182,212,0.2)'
          }}>
            <div className="flex items-center justify-between mb-3">
              <h4 className={`text-xs font-bold uppercase tracking-wider ${textSecondaryClass}`}>
                This Session GÇö Included Content
              </h4>
              <span className="text-[10px] text-cyan-400/70">
                {gallery.session_settings.buyin_price > 0 ? `$${gallery.session_settings.buyin_price} buy-in` : 'Free'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* Photos Included */}
              <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <ImageIcon className="w-4 h-4 text-cyan-400" />
                  <span className={`text-xs font-semibold ${textPrimaryClass}`}>Photos Included</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateSessionSetting('photos_included', Math.max(0, (gallery.session_settings?.photos_included || 3) - 1))}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold text-white hover:bg-white/10 transition-colors"
                    style={{ border: '1px solid rgba(255,255,255,0.15)' }}
                  >-</button>
                  <span className="text-xl font-bold text-cyan-400 w-8 text-center">{gallery.session_settings?.photos_included ?? 3}</span>
                  <button
                    onClick={() => updateSessionSetting('photos_included', (gallery.session_settings?.photos_included || 3) + 1)}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold text-white hover:bg-white/10 transition-colors"
                    style={{ border: '1px solid rgba(255,255,255,0.15)' }}
                  >+</button>
                </div>
              </div>
              {/* Videos Included */}
              <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Video className="w-4 h-4 text-purple-400" />
                  <span className={`text-xs font-semibold ${textPrimaryClass}`}>Videos Included</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateSessionSetting('videos_included', Math.max(0, (gallery.session_settings?.videos_included || 0) - 1))}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold text-white hover:bg-white/10 transition-colors"
                    style={{ border: '1px solid rgba(255,255,255,0.15)' }}
                  >-</button>
                  <span className="text-xl font-bold text-purple-400 w-8 text-center">{gallery.session_settings?.videos_included ?? 0}</span>
                  <button
                    onClick={() => updateSessionSetting('videos_included', (gallery.session_settings?.videos_included || 0) + 1)}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold text-white hover:bg-white/10 transition-colors"
                    style={{ border: '1px solid rgba(255,255,255,0.15)' }}
                  >+</button>
                </div>
              </div>
            </div>
            <p className={`text-[10px] mt-2 ${textSecondaryClass}`}>
              Additional items beyond included count are charged per the pricing tiers below
            </p>
          </div>
        )}

        {/* Per-Service Pricing Tiers */}
        {gallery?.photographer_pricing && (
          <div className="space-y-3">
            <PricingTierRow
              label="Live Session" emoji={String.fromCodePoint(0x1F4F8)} color="emerald"
              photosIncluded={gallery.photographer_pricing.live_session?.photos_included}
              videosIncluded={gallery.photographer_pricing.live_session?.videos_included}
              buyinPrice={gallery.photographer_pricing.live_session?.buyin_price}
              photo={gallery.photographer_pricing.live_session?.photo}
              video={gallery.photographer_pricing.live_session?.video}
              textSecondaryClass={textSecondaryClass} textPrimaryClass={textPrimaryClass}
              isActive={gallery.session_settings?.session_type === 'live'}
            />
            <PricingTierRow
              label="Booking" emoji={String.fromCodePoint(0x1F4C5)} color="blue"
              photosIncluded={gallery.photographer_pricing.booking?.photos_included}
              videosIncluded={gallery.photographer_pricing.booking?.videos_included}
              buyinPrice={gallery.photographer_pricing.booking?.hourly_rate} buyinLabel="/hr"
              photo={gallery.photographer_pricing.booking?.photo}
              video={gallery.photographer_pricing.booking?.video}
              textSecondaryClass={textSecondaryClass} textPrimaryClass={textPrimaryClass}
              isActive={gallery.session_settings?.session_type === 'booking'}
            />
            <PricingTierRow
              label="On-Demand" emoji={String.fromCodePoint(0x26A1)} color="amber"
              photosIncluded={gallery.photographer_pricing.on_demand?.photos_included}
              videosIncluded={gallery.photographer_pricing.on_demand?.videos_included}
              photo={gallery.photographer_pricing.on_demand?.photo}
              video={gallery.photographer_pricing.on_demand?.video}
              textSecondaryClass={textSecondaryClass} textPrimaryClass={textPrimaryClass}
              isActive={gallery.session_settings?.session_type === 'on_demand'}
            />
          </div>
        )}

        {/* Fallback: Gallery-level pricing if no photographer_pricing */}
        {!gallery?.photographer_pricing && (
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-cyan-500/50 text-cyan-400">Photo</Badge>
              <span className={textSecondaryClass}>Web: ${pricing.price_web}</span>
              <span className={textSecondaryClass}>HD: ${pricing.price_standard}</span>
              <span className={textSecondaryClass}>4K: ${pricing.price_high}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-purple-500/50 text-purple-400">Video</Badge>
              <span className={textSecondaryClass}>720p: ${pricing.price_720p}</span>
              <span className={textSecondaryClass}>1080p: ${pricing.price_1080p}</span>
              <span className={textSecondaryClass}>4K: ${pricing.price_4k}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GalleryPricingPanel;
