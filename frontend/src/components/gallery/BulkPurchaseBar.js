/**
 * BulkPurchaseBar - TICKET-005
 * Floating action bar for bulk photo/video purchases with volume discounts
 * Shows running total and applies automatic tier-based discounts
 */
import React, { useState, useMemo } from 'react';
import { 
  ShoppingCart, X, Loader2, Check, Tag, 
  ChevronUp, ChevronDown, Sparkles, Gift
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../ui/sheet';
import { toast } from 'sonner';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL;

// Default discount tiers (can be overridden by photographer settings)
const DEFAULT_DISCOUNT_TIERS = [
  { minItems: 3, discount: 0.10, label: '10% off' },
  { minItems: 5, discount: 0.15, label: '15% off' },
  { minItems: 10, discount: 0.20, label: '20% off' }
];

/**
 * Calculate discount based on item count and tiers
 */
const calculateDiscount = (itemCount, tiers = DEFAULT_DISCOUNT_TIERS) => {
  // Sort tiers by minItems descending to find the highest applicable tier
  const sortedTiers = [...tiers].sort((a, b) => b.minItems - a.minItems);
  
  for (const tier of sortedTiers) {
    if (itemCount >= tier.minItems) {
      return tier;
    }
  }
  
  return null;
};

/**
 * Get next discount tier hint
 */
const getNextTierHint = (itemCount, tiers = DEFAULT_DISCOUNT_TIERS) => {
  const sortedTiers = [...tiers].sort((a, b) => a.minItems - b.minItems);
  
  for (const tier of sortedTiers) {
    if (itemCount < tier.minItems) {
      return {
        itemsNeeded: tier.minItems - itemCount,
        discount: tier.discount,
        label: tier.label
      };
    }
  }
  
  return null; // Already at max tier
};

/**
 * Selected item thumbnail chip
 */
const SelectedItemChip = ({ item, onRemove }) => (
  <div className="relative group">
    <div className="w-12 h-12 rounded-lg overflow-hidden border border-zinc-700">
      <img 
        src={item.thumbnail_url || item.url} 
        alt="" 
        className="w-full h-full object-cover"
      />
    </div>
    <button
      onClick={() => onRemove(item.id)}
      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
    >
      <X className="w-3 h-3" />
    </button>
  </div>
);

/**
 * Main BulkPurchaseBar component
 */
export const BulkPurchaseBar = ({
  selectedItems = [],
  onRemoveItem,
  onClearAll,
  onPurchase,
  photographerDiscountTiers = null,
  qualityTier = 'standard',
  userId,
  disabled = false
}) => {
  const [purchasing, setPurchasing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  
  const discountTiers = photographerDiscountTiers || DEFAULT_DISCOUNT_TIERS;
  
  // Calculate totals and discount
  const totals = useMemo(() => {
    const baseTotal = selectedItems.reduce((sum, item) => {
      const price = item.price || item.custom_price || 5;
      return sum + price;
    }, 0);
    
    const appliedTier = calculateDiscount(selectedItems.length, discountTiers);
    const discountAmount = appliedTier ? baseTotal * appliedTier.discount : 0;
    const finalTotal = baseTotal - discountAmount;
    
    return {
      baseTotal,
      discountAmount,
      finalTotal,
      appliedTier,
      itemCount: selectedItems.length
    };
  }, [selectedItems, discountTiers]);
  
  const nextTier = getNextTierHint(selectedItems.length, discountTiers);
  
  // Handle bulk purchase
  const handlePurchase = async () => {
    if (selectedItems.length === 0 || purchasing) return;
    
    setPurchasing(true);
    try {
      // Build purchase request
      const itemIds = selectedItems.map(item => item.id);
      const qualityTiers = selectedItems.reduce((acc, item) => {
        acc[item.id] = qualityTier;
        return acc;
      }, {});
      
      const response = await axios.post(`${API}/api/gallery/bulk-purchase`, {
        item_ids: itemIds,
        quality_tiers: qualityTiers,
        buyer_id: userId
      });
      
      toast.success(`Purchased ${selectedItems.length} items for $${totals.finalTotal.toFixed(2)}!`);
      onPurchase?.(response.data);
      onClearAll?.();
    } catch (error) {
      const msg = error.response?.data?.detail || 'Purchase failed';
      toast.error(msg);
    } finally {
      setPurchasing(false);
    }
  };
  
  // Don't render if no items selected
  if (selectedItems.length === 0) {
    return null;
  }
  
  return (
    <div 
      className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900/95 backdrop-blur-sm border-t border-zinc-800 safe-area-bottom"
      data-testid="bulk-purchase-bar"
    >
      {/* Next tier hint banner */}
      {nextTier && (
        <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-b border-amber-500/20 px-4 py-2">
          <div className="flex items-center justify-center gap-2 text-sm">
            <Gift className="w-4 h-4 text-amber-400" />
            <span className="text-amber-400">
              Add <span className="font-bold">{nextTier.itemsNeeded} more</span> for <span className="font-bold">{nextTier.label}</span>!
            </span>
            <Progress 
              value={(selectedItems.length / (selectedItems.length + nextTier.itemsNeeded)) * 100} 
              className="w-20 h-1.5 bg-zinc-700"
            />
          </div>
        </div>
      )}
      
      {/* Main bar */}
      <div className="px-4 py-3">
        <div className="max-w-screen-lg mx-auto">
          {/* Expandable header */}
          <div className="flex items-center justify-between">
            {/* Left: Item count and expand toggle */}
            <button 
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity"
            >
              <div className="relative">
                <ShoppingCart className="w-6 h-6 text-cyan-400" />
                <Badge className="absolute -top-2 -right-2 bg-cyan-500 text-white text-[10px] px-1.5 min-w-[20px]">
                  {selectedItems.length}
                </Badge>
              </div>
              <div className="text-left">
                <p className="text-white font-medium">
                  {selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''} selected
                </p>
                {totals.appliedTier && (
                  <Badge className="bg-green-500/20 text-green-400 text-[10px] mt-0.5">
                    <Sparkles className="w-3 h-3 mr-1" />
                    {totals.appliedTier.label} applied!
                  </Badge>
                )}
              </div>
              {expanded ? (
                <ChevronDown className="w-5 h-5 text-zinc-400" />
              ) : (
                <ChevronUp className="w-5 h-5 text-zinc-400" />
              )}
            </button>
            
            {/* Right: Price and purchase button */}
            <div className="flex items-center gap-4">
              {/* Price display */}
              <div className="text-right">
                {totals.discountAmount > 0 && (
                  <div className="flex items-center gap-2 justify-end">
                    <span className="text-sm text-zinc-500 line-through">
                      ${totals.baseTotal.toFixed(2)}
                    </span>
                    <Badge className="bg-green-500/20 text-green-400 text-xs">
                      -{totals.appliedTier?.label}
                    </Badge>
                  </div>
                )}
                <p className="text-xl font-bold text-white">
                  ${totals.finalTotal.toFixed(2)}
                </p>
              </div>
              
              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onClearAll}
                        className="text-zinc-400 hover:text-red-400"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Clear selection</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                
                <Button
                  onClick={handlePurchase}
                  disabled={purchasing || disabled}
                  className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-medium px-6"
                  data-testid="bulk-purchase-btn"
                >
                  {purchasing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Purchase All
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
          
          {/* Expanded: Show selected items */}
          {expanded && (
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-zinc-400">Selected items:</p>
                <button 
                  onClick={onClearAll}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Clear all
                </button>
              </div>
              
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {selectedItems.map(item => (
                  <SelectedItemChip 
                    key={item.id} 
                    item={item} 
                    onRemove={onRemoveItem}
                  />
                ))}
              </div>
              
              {/* Discount tiers info */}
              <div className="mt-4 p-3 rounded-lg bg-zinc-800/50">
                <p className="text-xs text-zinc-400 mb-2 flex items-center gap-1">
                  <Tag className="w-3 h-3" />
                  Volume discounts:
                </p>
                <div className="flex gap-3">
                  {discountTiers.map((tier, idx) => {
                    const isActive = selectedItems.length >= tier.minItems;
                    const isNext = !isActive && 
                      (idx === 0 || selectedItems.length >= discountTiers[idx - 1].minItems);
                    
                    return (
                      <div 
                        key={tier.minItems}
                        className={`
                          text-center px-3 py-1.5 rounded-lg transition-all
                          ${isActive 
                            ? 'bg-green-500/20 border border-green-500/30' 
                            : isNext
                              ? 'bg-amber-500/10 border border-amber-500/30 animate-pulse'
                              : 'bg-zinc-800 border border-zinc-700'
                          }
                        `}
                      >
                        <p className={`text-xs font-medium ${
                          isActive ? 'text-green-400' : isNext ? 'text-amber-400' : 'text-zinc-400'
                        }`}>
                          {tier.minItems}+ items
                        </p>
                        <p className={`text-sm font-bold ${
                          isActive ? 'text-green-400' : isNext ? 'text-amber-400' : 'text-zinc-500'
                        }`}>
                          {tier.label}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Multi-select mode toggle button
 * Shows in gallery header to enable/disable bulk selection
 */
export const MultiSelectToggle = ({ 
  isActive, 
  onToggle, 
  selectedCount = 0 
}) => {
  return (
    <Button
      variant={isActive ? 'default' : 'outline'}
      size="sm"
      onClick={onToggle}
      className={isActive 
        ? 'bg-cyan-500 hover:bg-cyan-600 text-white' 
        : 'border-zinc-600 text-zinc-300 hover:bg-zinc-800'
      }
      data-testid="multi-select-toggle"
    >
      {isActive ? (
        <>
          <Check className="w-4 h-4 mr-1" />
          {selectedCount > 0 ? `${selectedCount} selected` : 'Selecting...'}
        </>
      ) : (
        <>
          <ShoppingCart className="w-4 h-4 mr-1" />
          Select Multiple
        </>
      )}
    </Button>
  );
};

export default BulkPurchaseBar;
