/**
 * SpotSetupPanel -- Extracted from UnifiedSpotDrawer.js (v79)
 *
 * The Go-Live session setup form: buy-in price, photos included,
 * live photo price, max surfers, auto-accept toggle, and the
 * Continue button that fires onConfirmGoLive.
 */
import React from 'react';
import { DollarSign, Image, Tag, Users, Zap, Sparkles, Loader2, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

const SpotSetupPanel = ({
  spot,
  sessionSettings,
  setSessionSettings,
  goLiveLoading,
  onConfirmGoLive,
}) => {
  // Calculate live savings - only show in promotional mode
  const liveSavings = sessionSettings.pricing_mode === 'promotional'
    ? (sessionSettings.photo_price_high || sessionSettings.general_photo_price) - sessionSettings.live_photo_price
    : sessionSettings.general_photo_price - sessionSettings.live_photo_price;
  const hasSavings = liveSavings > 0 && sessionSettings.pricing_mode === 'promotional';

  return (
    <div className="px-4 py-6 space-y-5">
      {/* Setup Header Info */}
      <div className="text-center mb-4">
        <p className="text-gray-400 text-sm">
          Set your <span className="text-cyan-400 font-semibold">Live Session Rates</span> for
        </p>
        <p className="text-white font-medium">{spot.name}</p>
      </div>

      {/* Live Savings Preview - Shows only in Promotional mode */}
      {hasSavings && (
        <div className="p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-green-400" />
            <span className="text-green-400 font-bold text-sm">Promotional Rate Active</span>
          </div>
          <p className="text-gray-300 text-xs">
            Surfers will see: "Save <span className="text-green-400 font-bold">${liveSavings}</span> per photo by joining now!"
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-gray-500 line-through text-sm">${sessionSettings.photo_price_high || sessionSettings.general_photo_price}</span>
            <span className="text-white font-bold text-lg">${sessionSettings.live_photo_price}</span>
            <Badge className="bg-green-500 text-white text-xs">
              {Math.round((liveSavings / (sessionSettings.photo_price_high || sessionSettings.general_photo_price)) * 100)}% OFF
            </Badge>
          </div>
        </div>
      )}
      
      {/* Standard Rates Info - Shows when NOT in promotional mode */}
      {!hasSavings && sessionSettings.pricing_mode !== 'promotional' && (
        <div className="p-3 bg-zinc-800/50 border border-zinc-700 rounded-xl">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-purple-400" />
            <span className="text-gray-300 text-sm">Standard Tiered Pricing</span>
          </div>
          <p className="text-gray-500 text-xs mt-1">
            Surfers will choose Web/Standard/High resolution at checkout
          </p>
        </div>
      )}

      {/* Buy-in Price */}
      <div className="space-y-2">
        <label className="text-gray-400 text-sm flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-green-400" />
          Session Buy-in Price
        </label>
        <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-xl">
          <span className="text-2xl font-bold text-white">$</span>
          <Input aria-label="Numeric input"
            type="number"
            value={sessionSettings.price_per_join}
            onChange={(e) => setSessionSettings(prev => ({ ...prev, price_per_join: parseInt(e.target.value) || 0 }))}
            className="bg-transparent border-none text-2xl font-bold text-white text-center"
            min="0"
            max="500"
          />
          <span className="text-gray-400 text-sm whitespace-nowrap">per surfer</span>
        </div>
      </div>

      {/* Photos Included */}
      <div className="space-y-2">
        <label className="text-gray-400 text-sm flex items-center gap-2">
          <Image className="w-4 h-4 text-blue-400" />
          Photos Included in Buy-in
        </label>
        <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-xl">
          <Input aria-label="Numeric input"
            type="number"
            value={sessionSettings.photos_included}
            onChange={(e) => setSessionSettings(prev => ({ ...prev, photos_included: parseInt(e.target.value) || 0 }))}
            className="bg-transparent border-none text-xl font-bold text-white text-center w-20"
            min="0"
            max="50"
          />
          <span className="text-gray-400 text-sm">digital downloads included</span>
        </div>
      </div>

      {/* Live Photo Price - Promotional Rate */}
      <div className="space-y-2">
        <label className="text-gray-400 text-sm flex items-center gap-2">
          <Tag className="w-4 h-4 text-purple-400" />
          Price per Additional Photo
          {sessionSettings.pricing_mode === 'promotional' && (
            <Badge className="bg-green-500/20 text-green-400 text-[10px] ml-1">PROMO</Badge>
          )}
        </label>
        <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-xl">
          <span className="text-xl font-bold text-white">$</span>
          <Input aria-label="Numeric input"
            type="number"
            value={sessionSettings.live_photo_price}
            onChange={(e) => setSessionSettings(prev => ({ ...prev, live_photo_price: parseFloat(e.target.value) || 0 }))}
            className="bg-transparent border-none text-xl font-bold text-white text-center w-20"
            min="0"
            max="100"
            step="0.50"
          />
          <div className="flex-1">
            <span className="text-gray-400 text-sm">per photo</span>
            {hasSavings && (
              <p className="text-green-400 text-xs">${liveSavings} less than high-res!</p>
            )}
          </div>
        </div>
      </div>

      {/* Max Surfers */}
      <div className="flex items-center justify-between p-3 bg-zinc-800 rounded-xl">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-blue-400" />
          <div>
            <span className="text-white font-medium">Max Surfers</span>
            <p className="text-gray-500 text-xs">Session capacity</p>
          </div>
        </div>
        <Input aria-label="Numeric input"
          type="number"
          value={sessionSettings.max_surfers}
          onChange={(e) => setSessionSettings(prev => ({ ...prev, max_surfers: parseInt(e.target.value) || 1 }))}
          className="bg-zinc-900 border-zinc-700 text-white font-bold text-center w-20"
          min="1"
          max="50"
        />
      </div>

      {/* Auto-Accept Toggle */}
      <div className="flex items-center justify-between p-3 bg-zinc-800 rounded-xl">
        <div className="flex items-center gap-3">
          <Zap className="w-5 h-5 text-yellow-400" />
          <div>
            <span className="text-white font-medium">Auto-Accept</span>
            <p className="text-gray-500 text-xs">Allow walk-ups without approval</p>
          </div>
        </div>
        <Switch
          checked={sessionSettings.auto_accept}
          onCheckedChange={(checked) => setSessionSettings(prev => ({ ...prev, auto_accept: checked }))}
        />
      </div>

      {/* Continue Button - Opens Conditions Modal */}
      <Button aria-label="Loader2"
        onClick={onConfirmGoLive}
        disabled={goLiveLoading}
        className="w-full h-12 bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-lg"
        data-testid="continue-to-conditions-btn"
      >
        {goLiveLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <>
            Continue
            <ChevronDown className="w-5 h-5 ml-2 rotate-[-90deg]" />
          </>
        )}
      </Button>
      <p className="text-center text-gray-500 text-xs mt-2">
        You'll capture current conditions next
      </p>
    </div>
  );
};

export default SpotSetupPanel;
