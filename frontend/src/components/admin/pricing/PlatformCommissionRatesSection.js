import React from 'react';
import { DollarSign } from 'lucide-react';
import { Input } from '../../ui/input';
import { Badge } from '../../ui/badge';

export const PlatformCommissionRatesSection = ({
  commissionRates,
  handleCommissionRateChange,
  commissionHasChanges,
}) => {
  return (
    <div className="bg-background rounded-xl overflow-hidden border border-border" data-testid="commission-rates-section">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-foreground font-bold flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-yellow-400" />
              Platform Commission Rates
            </h3>
            <p className="text-muted-foreground text-sm mt-1">
              Set commission percentages charged to photographers by subscription tier
            </p>
          </div>
          {commissionHasChanges && (
            <Badge className="bg-yellow-500/20 text-yellow-400">Unsaved</Badge>
          )}
        </div>
      </div>
      
      <div className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Free/Hobbyist Tier */}
          <div className="bg-card/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground text-sm font-medium">Free / Hobbyist</span>
              <Badge className="bg-secondary text-muted-foreground text-xs">No Cash Payouts</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Input aria-label="Numeric input"
                type="number"
                min="0"
                max="100"
                value={commissionRates.free}
                onChange={(e) => handleCommissionRateChange('free', e.target.value)}
                className="bg-background border-border text-foreground text-lg font-bold w-20 text-center"
                data-testid="commission-rate-free"
              />
              <span className="text-muted-foreground text-xl">%</span>
            </div>
            <p className="text-muted-foreground text-xs mt-2">Hobbyists can't withdraw cash</p>
          </div>
          
          {/* Basic Tier */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-blue-400 text-sm font-medium">Basic (tier_2)</span>
              <Badge className="bg-blue-500/20 text-blue-400 text-xs">Paid Plan</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Input aria-label="Numeric input"
                type="number"
                min="0"
                max="100"
                value={commissionRates.tier_2}
                onChange={(e) => handleCommissionRateChange('tier_2', e.target.value)}
                className="bg-background border-blue-500/50 text-blue-400 text-lg font-bold w-20 text-center"
                data-testid="commission-rate-tier2"
              />
              <span className="text-blue-400 text-xl">%</span>
            </div>
            <p className="text-muted-foreground text-xs mt-2">Standard photographer tier</p>
          </div>
          
          {/* Premium Tier */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-yellow-400 text-sm font-medium">Premium (tier_3)</span>
              <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">Pro Plan</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Input aria-label="Numeric input"
                type="number"
                min="0"
                max="100"
                value={commissionRates.tier_3}
                onChange={(e) => handleCommissionRateChange('tier_3', e.target.value)}
                className="bg-background border-yellow-500/50 text-yellow-400 text-lg font-bold w-20 text-center"
                data-testid="commission-rate-tier3"
              />
              <span className="text-yellow-400 text-xl">%</span>
            </div>
            <p className="text-muted-foreground text-xs mt-2">Lowest commission rate</p>
          </div>
          
          {/* Quick Reference */}
          <div className="bg-card/30 rounded-lg p-4 flex flex-col justify-center">
            <p className="text-muted-foreground text-sm font-medium mb-2">Earnings Example</p>
            <p className="text-foreground text-sm">
              On <span className="text-green-400 font-bold">$100</span> sale:
            </p>
            <ul className="text-xs text-gray-500 mt-1 space-y-0.5">
              <li>Free: <span className="text-muted-foreground">${100 - (100 * commissionRates.free / 100)} net</span></li>
              <li>Basic: <span className="text-blue-400">${100 - (100 * commissionRates.tier_2 / 100)} net</span></li>
              <li>Premium: <span className="text-yellow-400">${100 - (100 * commissionRates.tier_3 / 100)} net</span></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlatformCommissionRatesSection;
