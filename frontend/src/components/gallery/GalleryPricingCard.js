/**
 * GalleryPricingCard.js
 * Extracted pricing display card from GalleryPage.js
 * Shows per-service tabbed pricing (Gallery, Live, Booking, On-Demand)
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DollarSign, Image, Radio, Calendar, MapPin,
  Settings, ChevronDown, ChevronUp
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';

export var GalleryPricingCard = ({
  pricingCollapsed, setPricingCollapsed,
  pricingTab, setPricingTab,
  galleryPricing,
  setShowGalleryPricingModal,
}) => {
  const navigate = useNavigate();

  return (
        <Card className="mb-6 bg-card border-border">
          <CardHeader className="cursor-pointer md:cursor-default" onClick={() => setPricingCollapsed(!pricingCollapsed)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg text-foreground flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-400" />
                Gallery Pricing
                <button className="md:hidden ml-1 text-muted-foreground" aria-label="Collapse">
                  {pricingCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
              </CardTitle>
              <Button aria-label="Settings" 
                variant="outline" 
                size="sm"
                onClick={(e) => { e.stopPropagation(); setShowGalleryPricingModal(true); }}
                className="border-border"
                data-testid="edit-gallery-pricing-btn"
              >
                <Settings className="w-4 h-4 mr-2" />
                Edit Pricing
              </Button>
            </div>
          </CardHeader>
          <CardContent className={`${pricingCollapsed ? 'hidden md:block' : ''}`}>
            {/* Service Type Tabs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              {[
                { key: 'gallery', label: 'Gallery', icon: <Image className="w-3.5 h-3.5" />, color: 'cyan' },
                { key: 'live', label: 'Live Session', icon: <Radio className="w-3.5 h-3.5" />, color: 'red' },
                { key: 'booking', label: 'Booking', icon: <Calendar className="w-3.5 h-3.5" />, color: 'blue' },
                { key: 'ondemand', label: 'On-Demand', icon: <MapPin className="w-3.5 h-3.5" />, color: 'emerald' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setPricingTab?.(tab.key)}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    (pricingTab || 'gallery') === tab.key
                      ? `bg-${tab.color}-500/20 text-${tab.color}-400 ring-1 ring-${tab.color}-500/40`
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  }`}
                  style={(pricingTab || 'gallery') === tab.key ? {
                    background: tab.color === 'cyan' ? 'rgba(6,182,212,0.15)' :
                                tab.color === 'red' ? 'rgba(239,68,68,0.15)' :
                                tab.color === 'blue' ? 'rgba(59,130,246,0.15)' :
                                'rgba(16,185,129,0.15)',
                    color: tab.color === 'cyan' ? '#06b6d4' :
                           tab.color === 'red' ? '#ef4444' :
                           tab.color === 'blue' ? '#3b82f6' :
                           '#10b981',
                    boxShadow: `inset 0 0 0 1px ${tab.color === 'cyan' ? 'rgba(6,182,212,0.4)' :
                                tab.color === 'red' ? 'rgba(239,68,68,0.4)' :
                                tab.color === 'blue' ? 'rgba(59,130,246,0.4)' :
                                'rgba(16,185,129,0.4)'}`
                  } : {}}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {/* --- Gallery Tab --- */}
            {(pricingTab || 'gallery') === 'gallery' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{"\u{1F4F7}"} Photo Pricing</p>
                  <div className="space-y-1.5">
                    {[
                      { label: 'Web (800px)', val: galleryPricing.photo_price_web },
                      { label: 'Standard (1920px)', val: galleryPricing.photo_price_standard },
                      { label: 'High Res (Original)', val: galleryPricing.photo_price_high },
                    ].map(r => (
                      <div key={r.label} className="p-2 rounded bg-muted/50 flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">{r.label}</span>
                        <span className="text-xs font-semibold text-cyan-400">${r.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{"\u{1F3AC}"} Video Pricing</p>
                  <div className="space-y-1.5">
                    {[
                      { label: '720p HD', val: galleryPricing.video_price_720p },
                      { label: '1080p Full HD', val: galleryPricing.video_price_1080p },
                      { label: '4K Ultra HD', val: galleryPricing.video_price_4k },
                    ].map(r => (
                      <div key={r.label} className="p-2 rounded bg-muted/50 flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">{r.label}</span>
                        <span className="text-xs font-semibold text-purple-400">${r.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* --- Live Session Tab --- */}
            {pricingTab === 'live' && (
              <div>
                <div className="p-2.5 rounded-lg mb-3 flex items-center justify-between" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <span className="text-xs text-muted-foreground">{"\u{1F3DF}\uFE0F"} Session Buy-In</span>
                  <span className="text-sm font-bold text-red-400">${galleryPricing.live_buyin_price}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{"\u{1F4F7}"} Photo Pricing</p>
                    <div className="space-y-1.5">
                      {[
                        { label: 'Web (800px)', val: galleryPricing.live_price_web },
                        { label: 'Standard (1920px)', val: galleryPricing.live_price_standard },
                        { label: 'High Res (Original)', val: galleryPricing.live_price_high },
                      ].map(r => (
                        <div key={r.label} className="p-2 rounded flex justify-between items-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
                          <span className="text-xs text-muted-foreground">{r.label}</span>
                          <span className="text-xs font-semibold text-red-400">${r.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{"\u{1F3AC}"} Video Pricing</p>
                    <div className="space-y-1.5">
                      {[
                        { label: '720p HD', val: galleryPricing.live_video_720p },
                        { label: '1080p Full HD', val: galleryPricing.live_video_1080p },
                        { label: '4K Ultra HD', val: galleryPricing.live_video_4k },
                      ].map(r => (
                        <div key={r.label} className="p-2 rounded flex justify-between items-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
                          <span className="text-xs text-muted-foreground">{r.label}</span>
                          <span className="text-xs font-semibold text-red-400">${r.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 pt-2 border-t border-red-500/20">
                  <div className="p-2 rounded flex-1 text-center" style={{ background: 'rgba(239,68,68,0.1)' }}>
                    <p className="text-[10px] text-muted-foreground uppercase">Photos Included</p>
                    <p className="text-lg font-bold text-red-400">{galleryPricing.live_session_photos_included}</p>
                  </div>
                  <div className="p-2 rounded flex-1 text-center" style={{ background: 'rgba(239,68,68,0.1)' }}>
                    <p className="text-[10px] text-muted-foreground uppercase">Videos Included</p>
                    <p className="text-lg font-bold text-red-400">{galleryPricing.live_session_videos_included}</p>
                  </div>
                </div>
                {/* Advanced settings deep-link */}
                <button aria-label="Radio"
                  onClick={() => navigate('/photographer/sessions')}
                  className="w-full mt-3 p-3 rounded-lg flex items-center justify-between group/link transition-all hover:scale-[1.01]"
                  style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(245,158,11,0.08))', border: '1px dashed rgba(239,68,68,0.3)' }}
                >
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-red-400" />
                    <div className="text-left">
                      <p className="text-xs font-semibold text-foreground">Configure Advanced Session Rates</p>
                      <p className="text-[10px] text-muted-foreground">Buy-in pricing, full gallery access, session settings</p>
                    </div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-red-400 -rotate-90 group-hover/link:translate-x-0.5 transition-transform" />
                </button>
              </div>
            )}

            {/* --- Booking Tab --- */}
            {pricingTab === 'booking' && (
              <div>
                <div className="p-2.5 rounded-lg mb-3 flex items-center justify-between" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>
                  <span className="text-xs text-muted-foreground">{"\u23F1"} Hourly Rate</span>
                  <span className="text-sm font-bold text-blue-400">${galleryPricing.booking_hourly_rate}/hr</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{"\u{1F4F7}"} Photo Pricing</p>
                    <div className="space-y-1.5">
                      {[
                        { label: 'Web (800px)', val: galleryPricing.booking_price_web },
                        { label: 'Standard (1920px)', val: galleryPricing.booking_price_standard },
                        { label: 'High Res (Original)', val: galleryPricing.booking_price_high },
                      ].map(r => (
                        <div key={r.label} className="p-2 rounded flex justify-between items-center" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
                          <span className="text-xs text-muted-foreground">{r.label}</span>
                          <span className="text-xs font-semibold text-blue-400">${r.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{"\u{1F3AC}"} Video Pricing</p>
                    <div className="space-y-1.5">
                      {[
                        { label: '720p HD', val: galleryPricing.booking_video_720p },
                        { label: '1080p Full HD', val: galleryPricing.booking_video_1080p },
                        { label: '4K Ultra HD', val: galleryPricing.booking_video_4k },
                      ].map(r => (
                        <div key={r.label} className="p-2 rounded flex justify-between items-center" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
                          <span className="text-xs text-muted-foreground">{r.label}</span>
                          <span className="text-xs font-semibold text-blue-400">${r.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 pt-2 border-t border-blue-500/20">
                  <div className="p-2 rounded flex-1 text-center" style={{ background: 'rgba(59,130,246,0.1)' }}>
                    <p className="text-[10px] text-muted-foreground uppercase">Photos Included</p>
                    <p className="text-lg font-bold text-blue-400">{galleryPricing.booking_photos_included}</p>
                  </div>
                  <div className="p-2 rounded flex-1 text-center" style={{ background: 'rgba(59,130,246,0.1)' }}>
                    <p className="text-[10px] text-muted-foreground uppercase">Videos Included</p>
                    <p className="text-lg font-bold text-blue-400">{galleryPricing.booking_videos_included}</p>
                  </div>
                </div>
                {/* Advanced settings summary + deep-link */}
                <div className="mt-3 space-y-2">
                  {/* Quick-glance pills for advanced settings */}
                  <div className="flex flex-wrap gap-1.5">
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px]" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
                      <span className="text-muted-foreground">{"\u23F1"} Min Hours:</span>
                      <span className="font-semibold text-blue-400">{galleryPricing.booking_min_hours}h</span>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px]" style={{ background: galleryPricing.charges_travel_fees ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.08)', border: `1px solid ${galleryPricing.charges_travel_fees ? 'rgba(245,158,11,0.2)' : 'rgba(59,130,246,0.15)'}` }}>
                      <span className="text-muted-foreground">{"\u{1F697}"} Travel Fees:</span>
                      <span className={`font-semibold ${galleryPricing.charges_travel_fees ? 'text-amber-400' : 'text-muted-foreground'}`}>
                        {galleryPricing.charges_travel_fees ? 'Enabled' : 'Off'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px]" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
                      <span className="text-muted-foreground">{"\u{1F4CD}"} Radius:</span>
                      <span className="font-semibold text-blue-400">{galleryPricing.service_radius_miles} mi</span>
                    </div>
                    {(galleryPricing.group_discount_2_plus > 0 || galleryPricing.group_discount_3_plus > 0 || galleryPricing.group_discount_5_plus > 0) && (
                      <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px]" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}>
                        <span className="text-muted-foreground">{"\u{1F465}"} Group Discounts:</span>
                        <span className="font-semibold text-emerald-400">Active</span>
                      </div>
                    )}
                  </div>
                  {/* Deep-link to full booking settings */}
                  <button aria-label="Settings"
                    onClick={() => navigate('/photographer/bookings')}
                    className="w-full p-3 rounded-lg flex items-center justify-between group/link transition-all hover:scale-[1.01]"
                    style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.08))', border: '1px dashed rgba(59,130,246,0.3)' }}
                  >
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-blue-400" />
                      <div className="text-left">
                        <p className="text-xs font-semibold text-foreground">Configure Advanced Booking Rates</p>
                        <p className="text-[10px] text-muted-foreground">Group discounts, travel surcharges, cancellation policy, deposit %</p>
                      </div>
                    </div>
                    <ChevronDown className="w-4 h-4 text-blue-400 -rotate-90 group-hover/link:translate-x-0.5 transition-transform" />
                  </button>
                </div>
              </div>
            )}

            {/* --- On-Demand Tab --- */}
            {pricingTab === 'ondemand' && (
              <div>
                <div className="p-2.5 rounded-lg mb-3 flex items-center justify-between" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <span className="text-xs text-muted-foreground">{"\u26A1"} Hourly Rate</span>
                  <span className="text-sm font-bold text-emerald-400">${galleryPricing.on_demand_hourly_rate}/hr</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{"\u{1F4F7}"} Photo Pricing</p>
                    <div className="space-y-1.5">
                      {[
                        { label: 'Web (800px)', val: galleryPricing.on_demand_price_web },
                        { label: 'Standard (1920px)', val: galleryPricing.on_demand_price_standard },
                        { label: 'High Res (Original)', val: galleryPricing.on_demand_price_high },
                      ].map(r => (
                        <div key={r.label} className="p-2 rounded flex justify-between items-center" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}>
                          <span className="text-xs text-muted-foreground">{r.label}</span>
                          <span className="text-xs font-semibold text-emerald-400">${r.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{"\u{1F3AC}"} Video Pricing</p>
                    <div className="space-y-1.5">
                      {[
                        { label: '720p HD', val: galleryPricing.on_demand_video_720p },
                        { label: '1080p Full HD', val: galleryPricing.on_demand_video_1080p },
                        { label: '4K Ultra HD', val: galleryPricing.on_demand_video_4k },
                      ].map(r => (
                        <div key={r.label} className="p-2 rounded flex justify-between items-center" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}>
                          <span className="text-xs text-muted-foreground">{r.label}</span>
                          <span className="text-xs font-semibold text-emerald-400">${r.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 pt-2 border-t border-emerald-500/20">
                  <div className="p-2 rounded flex-1 text-center" style={{ background: 'rgba(16,185,129,0.1)' }}>
                    <p className="text-[10px] text-muted-foreground uppercase">Photos Included</p>
                    <p className="text-lg font-bold text-emerald-400">{galleryPricing.on_demand_photos_included}</p>
                  </div>
                  <div className="p-2 rounded flex-1 text-center" style={{ background: 'rgba(16,185,129,0.1)' }}>
                    <p className="text-[10px] text-muted-foreground uppercase">Videos Included</p>
                    <p className="text-lg font-bold text-emerald-400">{galleryPricing.on_demand_videos_included}</p>
                  </div>
                </div>
                {/* Advanced settings deep-link */}
                <button aria-label="Location"
                  onClick={() => navigate('/photographer/bookings')}
                  className="w-full mt-3 p-3 rounded-lg flex items-center justify-between group/link transition-all hover:scale-[1.01]"
                  style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(6,182,212,0.08))', border: '1px dashed rgba(16,185,129,0.3)' }}
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-emerald-400" />
                    <div className="text-left">
                      <p className="text-xs font-semibold text-foreground">Advanced On-Demand Settings</p>
                      <p className="text-[10px] text-muted-foreground">Service radius, peak pricing, availability zone</p>
                    </div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-emerald-400 -rotate-90 group-hover/link:translate-x-0.5 transition-transform" />
                </button>
              </div>
            )}
          </CardContent>
        </Card>
  );
};
