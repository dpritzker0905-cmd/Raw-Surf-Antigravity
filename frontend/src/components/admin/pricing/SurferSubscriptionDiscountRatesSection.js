import React from 'react';
import { Tag } from 'lucide-react';
import { Input } from '../../ui/input';
import { Badge } from '../../ui/badge';

export const SurferSubscriptionDiscountRatesSection = ({
  surferDiscountRates,
  handleSurferDiscountChange,
  surferDiscountHasChanges,
}) => {
  return (
    <div className="bg-background rounded-xl overflow-hidden border border-border" data-testid="surfer-discount-rates-section">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-foreground font-bold flex items-center gap-2">
              <Tag className="w-5 h-5 text-cyan-400" />
              Surfer Subscription Discounts
            </h3>
            <p className="text-muted-foreground text-sm mt-1">
              Discount percentages applied to media purchases for surfer subscribers
            </p>
          </div>
          {surferDiscountHasChanges && (
            <Badge className="bg-yellow-500/20 text-yellow-400">Unsaved</Badge>
          )}
        </div>
      </div>
      
      <div className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Free Tier */}
          <div className="bg-card/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground text-sm font-medium">Free Tier</span>
              <Badge className="bg-secondary text-muted-foreground text-xs">No Discount</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Input aria-label="Numeric input"
                type="number"
                min="0"
                max="100"
                value={surferDiscountRates.free}
                onChange={(e) => handleSurferDiscountChange('free', e.target.value)}
                className="bg-background border-border text-foreground text-lg font-bold w-20 text-center"
                data-testid="surfer-discount-free"
              />
              <span className="text-muted-foreground text-xl">%</span>
            </div>
            <p className="text-muted-foreground text-xs mt-2">Free users pay full price</p>
          </div>
          
          {/* Basic Tier */}
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-cyan-400 text-sm font-medium">Basic (tier_2)</span>
              <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">Subscriber</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Input aria-label="Numeric input"
                type="number"
                min="0"
                max="100"
                value={surferDiscountRates.tier_2}
                onChange={(e) => handleSurferDiscountChange('tier_2', e.target.value)}
                className="bg-background border-cyan-500/50 text-cyan-400 text-lg font-bold w-20 text-center"
                data-testid="surfer-discount-tier2"
              />
              <span className="text-cyan-400 text-xl">%</span>
            </div>
            <p className="text-muted-foreground text-xs mt-2">Off media purchases</p>
          </div>
          
          {/* Premium Tier */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-amber-400 text-sm font-medium">Premium (tier_3)</span>
              <Badge className="bg-amber-500/20 text-amber-400 text-xs">Pro Subscriber</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Input aria-label="Numeric input"
                type="number"
                min="0"
                max="100"
                value={surferDiscountRates.tier_3}
                onChange={(e) => handleSurferDiscountChange('tier_3', e.target.value)}
                className="bg-background border-amber-500/50 text-amber-400 text-lg font-bold w-20 text-center"
                data-testid="surfer-discount-tier3"
              />
              <span className="text-amber-400 text-xl">%</span>
            </div>
            <p className="text-muted-foreground text-xs mt-2">Best discount rate</p>
          </div>
          
          {/* Quick Reference */}
          <div className="bg-card/30 rounded-lg p-4 flex flex-col justify-center">
            <p className="text-muted-foreground text-sm font-medium mb-2">Surfer Savings</p>
            <p className="text-foreground text-sm">
              On <span className="text-green-400 font-bold">$10</span> photo:
            </p>
            <ul className="text-xs text-gray-500 mt-1 space-y-0.5">
              <li>Free: <span className="text-muted-foreground">${(10).toFixed(2)} (no discount)</span></li>
              <li>Basic: <span className="text-cyan-400">${(10 - (10 * surferDiscountRates.tier_2 / 100)).toFixed(2)} ({surferDiscountRates.tier_2}% off)</span></li>
              <li>Premium: <span className="text-amber-400">${(10 - (10 * surferDiscountRates.tier_3 / 100)).toFixed(2)} ({surferDiscountRates.tier_3}% off)</span></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SurferSubscriptionDiscountRatesSection;
