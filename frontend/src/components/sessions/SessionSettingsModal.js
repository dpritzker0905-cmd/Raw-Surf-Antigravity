import React from 'react';
import {
  DollarSign, Clock, Users, Zap, ChevronDown, Heart, Video, Tag, Percent,
  Sparkles, Check, ImageIcon
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import PotentialEarningsCalculator from './PotentialEarningsCalculator';
import { Settings } from 'lucide-react';

const SessionSettingsModal = ({
  isOpen, onClose, sessionSettings, setSessionSettings, expandedSections,
  toggleSection, isHobbyist, causes, groms, commissionRate, hasSavings,
  liveSavings, handleSaveSettings, isLight, textPrimaryClass, textSecondaryClass,
  borderClass, inputBgClass
}) => {
  return (
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader className="border-b border-inherit">
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <Settings className="w-5 h-5 text-cyan-400" />
              Session Rates & Settings
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 scroll-touch">
            <div className="space-y-3 py-4">
            {/* Live Savings Preview - Shows only in Promotional mode with savings */}
            {hasSavings && sessionSettings.pricing_mode === 'promotional' && (
              <div className={`p-3 rounded-xl bg-gradient-to-r ${isLight ? 'from-green-50 to-emerald-50 border border-green-200' : 'from-green-500/10 to-emerald-500/10 border border-green-500/30'}`}>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-green-400" />
                  <span className="text-green-400 font-bold text-sm">
                    Promo Active: Surfers save ${liveSavings}/photo
                  </span>
                  <span className="text-gray-500 line-through text-xs ml-auto">${sessionSettings.photo_price_high}</span>
                  <span className={`font-bold ${textPrimaryClass}`}>${sessionSettings.live_photo_price}</span>
                </div>
              </div>
            )}
            
            {/* Standard Rates Info - Shows in Standard mode */}
            {sessionSettings.pricing_mode === 'tiered' && (
              <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100 border border-gray-200' : 'bg-zinc-800/50 border border-zinc-700'}`}>
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-purple-400" />
                  <span className={`text-sm ${textPrimaryClass}`}>
                    Standard Tiered Pricing Active
                  </span>
                  <span className={`text-xs ${textSecondaryClass} ml-auto`}>
                    ${sessionSettings.photo_price_web} / ${sessionSettings.photo_price_standard} / ${sessionSettings.photo_price_high}
                  </span>
                </div>
              </div>
            )}

            {/* Video Pricing Summary - Shows current video pricing mode */}
            {sessionSettings.video_pricing_mode === 'promotional' && sessionSettings.live_video_price < sessionSettings.video_price_4k && (
              <div className={`p-3 rounded-xl bg-gradient-to-r ${isLight ? 'from-red-50 to-orange-50 border border-red-200' : 'from-red-500/10 to-orange-500/10 border border-red-500/30'}`}>
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-red-400" />
                  <span className="text-red-400 font-bold text-sm">
                    Video Promo: Surfers save ${sessionSettings.video_price_4k - sessionSettings.live_video_price}/video
                  </span>
                  <span className="text-gray-500 line-through text-xs ml-auto">${sessionSettings.video_price_4k}</span>
                  <span className={`font-bold ${textPrimaryClass}`}>${sessionSettings.live_video_price}</span>
                </div>
              </div>
            )}
            {sessionSettings.video_pricing_mode === 'tiered' && (
              <div className={`p-3 rounded-xl ${isLight ? 'bg-red-50/50 border border-red-200' : 'bg-red-900/20 border border-red-700/30'}`}>
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-red-400" />
                  <span className={`text-sm ${textPrimaryClass}`}>
                    Video Tiered Pricing
                  </span>
                  <span className={`text-xs ${textSecondaryClass} ml-auto`}>
                    ${sessionSettings.video_price_720p} / ${sessionSettings.video_price_1080p} / ${sessionSettings.video_price_4k}
                  </span>
                </div>
              </div>
            )}

            {/* Collapsible Section: Session Buy-in */}
            <div className={`rounded-xl border ${borderClass} overflow-hidden`}>
              <button aria-label="Dollar Sign"
                onClick={() => toggleSection('buyin')}
                className={`w-full flex items-center justify-between p-3 ${isLight ? 'bg-gray-50 hover:bg-gray-100' : 'bg-zinc-800/50 hover:bg-zinc-800'} transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-green-400" />
                  <span className={`font-bold ${textPrimaryClass}`}>Session Buy-in</span>
                  <span className={`text-sm ${textSecondaryClass}`}>(${sessionSettings.price_per_join})</span>
                </div>
                <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.buyin ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.buyin && (
                <div className="p-3 space-y-3 border-t border-inherit">
                  <div className="space-y-2">
                    <Label className={textSecondaryClass}>Buy-in Price (to join session)</Label>
                    <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                      <span className={`text-2xl font-bold ${textPrimaryClass}`}>$</span>
                      <Input
                        type="number"
                        value={sessionSettings.price_per_join}
                        onChange={(e) => setSessionSettings(prev => ({ ...prev, price_per_join: parseInt(e.target.value) || 0 }))}
                        className={`${inputBgClass} ${textPrimaryClass} text-2xl font-bold h-12 text-center`}
                        min="0"
                        max="500"
                      />
                      <span className={`text-sm whitespace-nowrap ${textSecondaryClass}`}>per surfer</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className={`flex items-center gap-2 ${textSecondaryClass}`}>
                      <ImageIcon className="w-4 h-4 text-blue-400" />
                      Photos Included in Buy-in
                    </Label>
                    <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                      <Input aria-label="Numeric input"
                        type="number"
                        value={sessionSettings.photos_included}
                        onChange={(e) => setSessionSettings(prev => ({ ...prev, photos_included: parseInt(e.target.value) || 0 }))}
                        className={`${inputBgClass} ${textPrimaryClass} text-xl font-bold h-12 text-center w-24`}
                        min="0"
                        max="50"
                      />
                      <span className={`text-sm ${textSecondaryClass}`}>digital downloads included</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className={`flex items-center gap-2 ${textSecondaryClass}`}>
                      <Video className="w-4 h-4 text-red-400" />
                      Videos Included in Buy-in
                    </Label>
                    <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                      <Input aria-label="Numeric input"
                        type="number"
                        value={sessionSettings.videos_included}
                        onChange={(e) => setSessionSettings(prev => ({ ...prev, videos_included: parseInt(e.target.value) || 0 }))}
                        className={`${inputBgClass} ${textPrimaryClass} text-xl font-bold h-12 text-center w-24`}
                        min="0"
                        max="20"
                      />
                      <span className={`text-sm ${textSecondaryClass}`}>digital downloads included</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Collapsible Section: Resolution-Based Pricing */}
            <div className={`rounded-xl border ${borderClass} overflow-hidden`}>
              <button aria-label="Tag"
                onClick={() => toggleSection('pricing')}
                className={`w-full flex items-center justify-between p-3 ${isLight ? 'bg-gray-50 hover:bg-gray-100' : 'bg-zinc-800/50 hover:bg-zinc-800'} transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <Tag className="w-5 h-5 text-purple-400" />
                  <span className={`font-bold ${textPrimaryClass}`}>Photo Pricing</span>
                  <Badge variant="outline" className={`text-xs ${sessionSettings.pricing_mode === 'promotional' ? 'border-green-500/50 text-green-400' : 'border-purple-500/50 text-purple-400'}`}>
                    {sessionSettings.pricing_mode === 'promotional' ? 'Promo Active' : 'Per Photo'}
                  </Badge>
                </div>
                <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.pricing ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.pricing && (
                <div className="p-3 space-y-3 border-t border-inherit">
                  {/* Pricing Mode Toggle */}
                  <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                    <p className={`text-xs ${textSecondaryClass} mb-3`}>
                      Choose how surfers are charged for photos:
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setSessionSettings(prev => ({ ...prev, pricing_mode: 'tiered' }))}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          sessionSettings.pricing_mode === 'tiered'
                            ? `${isLight ? 'bg-purple-50 border-purple-300' : 'bg-purple-500/20 border-purple-500/50'} ring-2 ring-purple-400/50`
                            : `${isLight ? 'bg-white border-gray-200 hover:bg-gray-50' : 'bg-zinc-900 border-zinc-700 hover:bg-zinc-800'}`
                        }`}
                      >
                        <Tag className={`w-5 h-5 mx-auto mb-1 ${sessionSettings.pricing_mode === 'tiered' ? 'text-purple-400' : textSecondaryClass}`} />
                        <span className={`text-sm font-medium ${sessionSettings.pricing_mode === 'tiered' ? 'text-purple-400' : textPrimaryClass}`}>Standard Rates</span>
                        <p className={`text-xs ${textSecondaryClass} mt-1`}>Web/Standard/High tiers</p>
                      </button>
                      <button
                        onClick={() => setSessionSettings(prev => ({ ...prev, pricing_mode: 'promotional' }))}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          sessionSettings.pricing_mode === 'promotional'
                            ? `${isLight ? 'bg-green-50 border-green-300' : 'bg-green-500/20 border-green-500/50'} ring-2 ring-green-400/50`
                            : `${isLight ? 'bg-white border-gray-200 hover:bg-gray-50' : 'bg-zinc-900 border-zinc-700 hover:bg-zinc-800'}`
                        }`}
                      >
                        <Sparkles className={`w-5 h-5 mx-auto mb-1 ${sessionSettings.pricing_mode === 'promotional' ? 'text-green-400' : textSecondaryClass}`} />
                        <span className={`text-sm font-medium ${sessionSettings.pricing_mode === 'promotional' ? 'text-green-400' : textPrimaryClass}`}>Promotional</span>
                        <p className={`text-xs ${textSecondaryClass} mt-1`}>Single flat rate</p>
                      </button>
                    </div>
                  </div>

                  {/* Standard Tiered Pricing */}
                  {sessionSettings.pricing_mode === 'tiered' && (
                    <>
                      <p className={`text-xs ${textSecondaryClass}`}>
                        Set prices for each resolution tier. Surfers choose their preferred quality at checkout.
                      </p>

                      <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'}`}>
                        <span className="w-3 h-3 rounded-full bg-blue-400"></span>
                        <span className={`text-sm ${textSecondaryClass} flex-1`}>Web-Res</span>
                        <span className={`font-bold ${textPrimaryClass}`}>$</span>
                        <Input aria-label="Numeric input"
                          type="number"
                          value={sessionSettings.photo_price_web}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, photo_price_web: parseFloat(e.target.value) || 0 }))}
                          className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                          min="0"
                          max="100"
                          step="0.50"
                        />
                      </div>

                      <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'}`}>
                        <span className="w-3 h-3 rounded-full bg-cyan-400"></span>
                        <span className={`text-sm ${textSecondaryClass} flex-1`}>Standard</span>
                        <span className={`font-bold ${textPrimaryClass}`}>$</span>
                        <Input aria-label="Numeric input"
                          type="number"
                          value={sessionSettings.photo_price_standard}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, photo_price_standard: parseFloat(e.target.value) || 0 }))}
                          className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                          min="0"
                          max="100"
                          step="0.50"
                        />
                      </div>

                      <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-purple-50' : 'bg-purple-500/10'}`}>
                        <span className="w-3 h-3 rounded-full bg-purple-400"></span>
                        <span className={`text-sm ${textSecondaryClass} flex-1`}>High-Res</span>
                        <span className={`font-bold ${textPrimaryClass}`}>$</span>
                        <Input aria-label="Numeric input"
                          type="number"
                          value={sessionSettings.photo_price_high}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, photo_price_high: parseFloat(e.target.value) || 0 }))}
                          className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                          min="0"
                          max="100"
                          step="0.50"
                        />
                      </div>

                      <div className={`p-2 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          <span className="font-medium">Note:</span> Photos beyond the {sessionSettings.photos_included} included in buy-in will use these tiered prices.
                        </p>
                      </div>
                    </>
                  )}

                  {/* Promotional Flat Rate */}
                  {sessionSettings.pricing_mode === 'promotional' && (
                    <>
                      <div className={`p-3 rounded-xl border ${isLight ? 'bg-green-50 border-green-200' : 'bg-green-500/10 border-green-500/30'}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-4 h-4 text-green-400" />
                          <span className={`text-sm font-medium ${textPrimaryClass}`}>Promotional Rate</span>
                          <Badge className="bg-green-500 text-white text-xs ml-auto">All High-Res</Badge>
                        </div>
                        <p className={`text-xs ${textSecondaryClass} mb-3`}>
                          All photos delivered at full high-resolution quality at one promotional price (including photos beyond buy-in).
                        </p>
                        <div className={`flex items-center gap-3`}>
                          <span className={`text-2xl font-bold ${textPrimaryClass}`}>$</span>
                          <Input aria-label="Numeric input"
                            type="number"
                            value={sessionSettings.live_photo_price}
                            onChange={(e) => setSessionSettings(prev => ({ ...prev, live_photo_price: parseFloat(e.target.value) || 0 }))}
                            className={`${inputBgClass} ${textPrimaryClass} text-2xl font-bold h-14 text-center w-24`}
                            min="0"
                            max="100"
                            step="0.50"
                          />
                          <span className={`text-sm ${textSecondaryClass}`}>per photo</span>
                        </div>
                      </div>
                      
                      {sessionSettings.live_photo_price < sessionSettings.photo_price_high && (
                        <div className={`flex items-center gap-2 p-2 rounded-lg ${isLight ? 'bg-amber-50' : 'bg-amber-500/10'}`}>
                          <Percent className="w-4 h-4 text-amber-400" />
                          <span className={`text-sm ${textSecondaryClass}`}>
                            Surfers save <span className="text-green-400 font-bold">${(sessionSettings.photo_price_high - sessionSettings.live_photo_price).toFixed(0)}</span> vs standard high-res (${sessionSettings.photo_price_high})
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Collapsible Section: Video Pricing */}
            <div className={`rounded-xl border ${borderClass} overflow-hidden`}>
              <button aria-label="Video"
                onClick={() => toggleSection('videoPricing')}
                className={`w-full flex items-center justify-between p-3 ${isLight ? 'bg-gray-50 hover:bg-gray-100' : 'bg-zinc-800/50 hover:bg-zinc-800'} transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <Video className="w-5 h-5 text-red-400" />
                  <span className={`font-bold ${textPrimaryClass}`}>Video Pricing</span>
                  <Badge variant="outline" className={`text-xs ${sessionSettings.video_pricing_mode === 'promotional' ? 'border-green-500/50 text-green-400' : 'border-red-500/50 text-red-400'}`}>
                    {sessionSettings.video_pricing_mode === 'promotional' ? 'Promo Active' : 'Per Video'}
                  </Badge>
                </div>
                <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.videoPricing ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.videoPricing && (
                <div className="p-3 space-y-3 border-t border-inherit">
                  {/* Video Pricing Mode Toggle */}
                  <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                    <p className={`text-xs ${textSecondaryClass} mb-3`}>
                      Choose how surfers are charged for video clips:
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setSessionSettings(prev => ({ ...prev, video_pricing_mode: 'tiered' }))}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          sessionSettings.video_pricing_mode === 'tiered'
                            ? `${isLight ? 'bg-red-50 border-red-300' : 'bg-red-500/20 border-red-500/50'} ring-2 ring-red-400/50`
                            : `${isLight ? 'bg-white border-gray-200 hover:bg-gray-50' : 'bg-zinc-900 border-zinc-700 hover:bg-zinc-800'}`
                        }`}
                      >
                        <Video className={`w-5 h-5 mx-auto mb-1 ${sessionSettings.video_pricing_mode === 'tiered' ? 'text-red-400' : textSecondaryClass}`} />
                        <span className={`text-sm font-medium ${sessionSettings.video_pricing_mode === 'tiered' ? 'text-red-400' : textPrimaryClass}`}>Standard Rates</span>
                        <p className={`text-xs ${textSecondaryClass} mt-1`}>720p/1080p/4K tiers</p>
                      </button>
                      <button
                        onClick={() => setSessionSettings(prev => ({ ...prev, video_pricing_mode: 'promotional' }))}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          sessionSettings.video_pricing_mode === 'promotional'
                            ? `${isLight ? 'bg-green-50 border-green-300' : 'bg-green-500/20 border-green-500/50'} ring-2 ring-green-400/50`
                            : `${isLight ? 'bg-white border-gray-200 hover:bg-gray-50' : 'bg-zinc-900 border-zinc-700 hover:bg-zinc-800'}`
                        }`}
                      >
                        <Sparkles className={`w-5 h-5 mx-auto mb-1 ${sessionSettings.video_pricing_mode === 'promotional' ? 'text-green-400' : textSecondaryClass}`} />
                        <span className={`text-sm font-medium ${sessionSettings.video_pricing_mode === 'promotional' ? 'text-green-400' : textPrimaryClass}`}>Promotional</span>
                        <p className={`text-xs ${textSecondaryClass} mt-1`}>Single flat rate</p>
                      </button>
                    </div>
                  </div>

                  {/* Standard Tiered Video Pricing */}
                  {sessionSettings.video_pricing_mode === 'tiered' && (
                    <>
                      <p className={`text-xs ${textSecondaryClass}`}>
                        Set prices for each video quality tier. Surfers choose their preferred resolution at checkout.
                      </p>

                      <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-orange-50' : 'bg-orange-500/10'}`}>
                        <span className="w-3 h-3 rounded-full bg-orange-400"></span>
                        <span className={`text-sm ${textSecondaryClass} flex-1`}>720p HD</span>
                        <span className={`font-bold ${textPrimaryClass}`}>$</span>
                        <Input aria-label="Numeric input"
                          type="number"
                          value={sessionSettings.video_price_720p}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, video_price_720p: parseFloat(e.target.value) || 0 }))}
                          className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                          min="0"
                          max="200"
                          step="1"
                        />
                      </div>

                      <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-red-50' : 'bg-red-500/10'}`}>
                        <span className="w-3 h-3 rounded-full bg-red-400"></span>
                        <span className={`text-sm ${textSecondaryClass} flex-1`}>1080p Full HD</span>
                        <span className={`font-bold ${textPrimaryClass}`}>$</span>
                        <Input aria-label="Numeric input"
                          type="number"
                          value={sessionSettings.video_price_1080p}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, video_price_1080p: parseFloat(e.target.value) || 0 }))}
                          className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                          min="0"
                          max="200"
                          step="1"
                        />
                      </div>

                      <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-pink-50' : 'bg-pink-500/10'}`}>
                        <span className="w-3 h-3 rounded-full bg-pink-400"></span>
                        <span className={`text-sm ${textSecondaryClass} flex-1`}>4K Ultra HD</span>
                        <span className={`font-bold ${textPrimaryClass}`}>$</span>
                        <Input aria-label="Numeric input"
                          type="number"
                          value={sessionSettings.video_price_4k}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, video_price_4k: parseFloat(e.target.value) || 0 }))}
                          className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                          min="0"
                          max="200"
                          step="1"
                        />
                      </div>

                      <div className={`p-2 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          <span className="font-medium">Note:</span> Video clips are priced separately from photos. Surfers select quality at purchase.
                        </p>
                      </div>
                    </>
                  )}

                  {/* Promotional Flat Rate for Videos */}
                  {sessionSettings.video_pricing_mode === 'promotional' && (
                    <>
                      <div className={`p-3 rounded-xl border ${isLight ? 'bg-green-50 border-green-200' : 'bg-green-500/10 border-green-500/30'}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-4 h-4 text-green-400" />
                          <span className={`text-sm font-medium ${textPrimaryClass}`}>Promotional Rate</span>
                          <Badge className="bg-green-500 text-white text-xs ml-auto">All 4K Quality</Badge>
                        </div>
                        <p className={`text-xs ${textSecondaryClass} mb-3`}>
                          All videos delivered at full 4K quality at one promotional price.
                        </p>
                        <div className={`flex items-center gap-3`}>
                          <span className={`text-2xl font-bold ${textPrimaryClass}`}>$</span>
                          <Input aria-label="Numeric input"
                            type="number"
                            value={sessionSettings.live_video_price}
                            onChange={(e) => setSessionSettings(prev => ({ ...prev, live_video_price: parseFloat(e.target.value) || 0 }))}
                            className={`${inputBgClass} ${textPrimaryClass} text-2xl font-bold h-14 text-center w-24`}
                            min="0"
                            max="200"
                            step="1"
                          />
                          <span className={`text-sm ${textSecondaryClass}`}>per video</span>
                        </div>
                      </div>
                      
                      {sessionSettings.live_video_price < sessionSettings.video_price_4k && (
                        <div className={`flex items-center gap-2 p-2 rounded-lg ${isLight ? 'bg-amber-50' : 'bg-amber-500/10'}`}>
                          <Percent className="w-4 h-4 text-amber-400" />
                          <span className={`text-sm ${textSecondaryClass}`}>
                            Surfers save <span className="text-green-400 font-bold">${(sessionSettings.video_price_4k - sessionSettings.live_video_price).toFixed(0)}</span> vs standard 4K (${sessionSettings.video_price_4k})
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Collapsible Section: Session Settings */}
            <div className={`rounded-xl border ${borderClass} overflow-hidden`}>
              <button aria-label="Clock"
                onClick={() => toggleSection('settings')}
                className={`w-full flex items-center justify-between p-3 ${isLight ? 'bg-gray-50 hover:bg-gray-100' : 'bg-zinc-800/50 hover:bg-zinc-800'} transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-orange-400" />
                  <span className={`font-bold ${textPrimaryClass}`}>Session Settings</span>
                  <span className={`text-sm ${textSecondaryClass}`}>({sessionSettings.max_surfers} surfers, {sessionSettings.estimated_duration}h)</span>
                </div>
                <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.settings ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.settings && (
                <div className="p-3 space-y-3 border-t border-inherit">
                  <div className={`flex items-center justify-between p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                    <div className="flex items-center gap-3">
                      <Users className="w-5 h-5 text-blue-400" />
                      <div>
                        <span className={`font-medium ${textPrimaryClass}`}>Max Surfers</span>
                        <p className={`text-xs ${textSecondaryClass}`}>Limit session capacity</p>
                      </div>
                    </div>
                    <Input aria-label="Numeric input"
                      type="number"
                      value={sessionSettings.max_surfers}
                      onChange={(e) => setSessionSettings(prev => ({ ...prev, max_surfers: parseInt(e.target.value) || 1 }))}
                      className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                      min="1"
                      max="50"
                    />
                  </div>

                  <div className={`flex items-center justify-between p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                    <div className="flex items-center gap-3">
                      <Clock className="w-5 h-5 text-orange-400" />
                      <div>
                        <span className={`font-medium ${textPrimaryClass}`}>Duration</span>
                        <p className={`text-xs ${textSecondaryClass}`}>Estimated session length</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input aria-label="Numeric input"
                        type="number"
                        value={sessionSettings.estimated_duration}
                        onChange={(e) => setSessionSettings(prev => ({ ...prev, estimated_duration: parseInt(e.target.value) || 1 }))}
                        className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-16`}
                        min="1"
                        max="8"
                      />
                      <span className={`text-sm ${textSecondaryClass}`}>hrs</span>
                    </div>
                  </div>

                  <div className={`flex items-center justify-between p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                    <div className="flex items-center gap-3">
                      <Zap className="w-5 h-5 text-yellow-400" />
                      <div>
                        <span className={`font-medium ${textPrimaryClass}`}>Auto-Accept</span>
                        <p className={`text-xs ${textSecondaryClass}`}>Allow walk-ups without approval</p>
                      </div>
                    </div>
                    <Switch
                      checked={sessionSettings.auto_accept}
                      onCheckedChange={(checked) => setSessionSettings(prev => ({ ...prev, auto_accept: checked }))}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Collapsible Section: Earnings Destination (Hobbyists only) */}
            {isHobbyist && (
              <div className={`rounded-xl border ${isLight ? 'border-amber-200' : 'border-amber-500/30'} overflow-hidden`}>
                <button aria-label="Like"
                  onClick={() => toggleSection('earnings')}
                  className={`w-full flex items-center justify-between p-3 ${isLight ? 'bg-amber-50 hover:bg-amber-100' : 'bg-amber-900/20 hover:bg-amber-900/30'} transition-colors`}
                >
                  <div className="flex items-center gap-2">
                    <Heart className="w-5 h-5 text-amber-400" />
                    <span className={`font-bold ${textPrimaryClass}`}>Earnings Destination</span>
                  </div>
                  <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.earnings ? 'rotate-180' : ''}`} />
                </button>
                {expandedSections.earnings && (
                  <div className="p-3 space-y-3 border-t border-inherit">
                    <Label className={textSecondaryClass}>Where should session earnings go?</Label>
                    <select
                      value={sessionSettings.earnings_destination_type || ''}
                      onChange={(e) => {
                        const type = e.target.value;
                        setSessionSettings({
                          ...sessionSettings,
                          earnings_destination_type: type || null,
                          earnings_destination_id: null,
                          earnings_cause_name: null
                        });
                      }}
                      className={`w-full px-3 py-2 rounded-md border ${borderClass} ${inputBgClass} ${textPrimaryClass}`}
                    >
                      <option value="">Gear Credits (default)</option>
                      <option value="grom">Support a Grom</option>
                      <option value="cause">Support a Cause</option>
                    </select>
                    
                    {sessionSettings.earnings_destination_type === 'grom' && (
                      <select
                        value={sessionSettings.earnings_destination_id || ''}
                        onChange={(e) => setSessionSettings({
                          ...sessionSettings,
                          earnings_destination_id: e.target.value || null
                        })}
                        className={`w-full px-3 py-2 rounded-md border ${borderClass} ${inputBgClass} ${textPrimaryClass}`}
                      >
                        <option value="">Select a Grom...</option>
                        {groms.map(grom => (
                          <option key={grom.id} value={grom.id}>
                            {grom.full_name} {grom.location ? `- ${grom.location}` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    
                    {sessionSettings.earnings_destination_type === 'cause' && (
                      <select
                        value={sessionSettings.earnings_cause_name || ''}
                        onChange={(e) => setSessionSettings({
                          ...sessionSettings,
                          earnings_cause_name: e.target.value || null
                        })}
                        className={`w-full px-3 py-2 rounded-md border ${borderClass} ${inputBgClass} ${textPrimaryClass}`}
                      >
                        <option value="">Select a cause...</option>
                        {causes.map(cause => (
                          <option key={cause.id} value={cause.name}>
                            {cause.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Potential Earnings Preview */}
            <PotentialEarningsCalculator
              buyinPrice={sessionSettings.price_per_join}
              maxSurfers={sessionSettings.max_surfers}
              photoPrice={sessionSettings.live_photo_price}
              commissionRate={commissionRate}
              isLight={isLight}
              textPrimaryClass={textPrimaryClass}
              textSecondaryClass={textSecondaryClass}
            />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button aria-label="Confirm"
              onClick={handleSaveSettings}
              className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-medium"
              data-testid="save-settings-btn"
            >
              <Check className="w-4 h-4 mr-2" />
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
};

export default SessionSettingsModal;
