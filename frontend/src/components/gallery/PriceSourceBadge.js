/**
 * PriceSourceBadge - TICKET-001
 * Shows pricing context: Session Deal, Custom Price, Standard Rate
 * Helps surfers understand why prices differ between photos
 */
import React from 'react';
import { Lock, Star, Zap, Tag, Gift, Sparkles, Crown, Camera } from 'lucide-react';
import { Badge } from '../ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';

const PRICE_SOURCE_CONFIG = {
  'free_from_buyin': { 
    label: 'Included Free', 
    color: 'bg-green-500 text-white', 
    icon: Gift,
    tooltip: 'This photo is included in your session buy-in at no extra cost'
  },
  'item_locked': { 
    label: 'Session Rate', 
    color: 'bg-cyan-500 text-white', 
    icon: Lock,
    tooltip: 'Price locked at the rate when this photo was uploaded during your session'
  },
  'participant_locked': { 
    label: 'Your Deal', 
    color: 'bg-emerald-500 text-white', 
    icon: Star,
    tooltip: 'Special rate you locked in when you joined this session'
  },
  'session_override': { 
    label: 'Session Price', 
    color: 'bg-blue-500 text-white', 
    icon: Zap,
    tooltip: 'Discounted session rate for participants'
  },
  'custom': {
    label: 'Special Price',
    color: 'bg-amber-500 text-black',
    icon: Sparkles,
    tooltip: 'Photographer set a custom price for this item'
  },
  'general': { 
    label: 'Standard', 
    color: 'bg-zinc-600 text-white', 
    icon: Tag,
    tooltip: 'Standard gallery pricing'
  }
};

export const PriceSourceBadge = ({ 
  source, 
  originalPrice, 
  currentPrice,
  showSavings = true,
  size = 'sm',
  className = ''
}) => {
  const config = PRICE_SOURCE_CONFIG[source] || PRICE_SOURCE_CONFIG['general'];
  const Icon = config.icon;
  
  // Calculate savings percentage
  const savings = originalPrice && currentPrice < originalPrice 
    ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
    : null;
  
  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-xs px-2 py-1',
    lg: 'text-sm px-2.5 py-1'
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`inline-flex items-center gap-1 ${className}`}>
            <Badge className={`${config.color} ${sizeClasses[size]} font-medium`}>
              <Icon className={`${size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} mr-1`} />
              {config.label}
            </Badge>
            {showSavings && savings > 0 && (
              <Badge className="bg-green-500/20 text-green-400 text-[10px]">
                Save {savings}%
              </Badge>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent className="bg-zinc-800 border-zinc-700 text-white max-w-[200px]">
          <p className="text-xs">{config.tooltip}</p>
          {showSavings && savings > 0 && (
            <p className="text-xs text-green-400 mt-1">
              You're saving ${(originalPrice - currentPrice).toFixed(2)} ({savings}% off)
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/**
 * PriceTierCard - Displays a pricing tier with source badge
 * Used in purchase modals for SmugMug-style tier selection
 */
export const PriceTierCard = ({
  tier,
  label,
  price,
  generalPrice,
  priceSource,
  isPurchased,
  isSelected,
  onSelect,
  isLocked = false,
  lockedReason = '',
  description = ''
}) => {
  const hasDeal = priceSource && priceSource !== 'general' && price < generalPrice;
  
  return (
    <button
      onClick={() => !isPurchased && !isLocked && onSelect?.(tier)}
      disabled={isPurchased || isLocked}
      className={`
        w-full p-3 rounded-lg text-left transition-all
        ${isPurchased 
          ? 'bg-green-500/10 border-2 border-green-500 cursor-default' 
          : isLocked
            ? 'bg-zinc-800/50 border border-zinc-700 cursor-not-allowed opacity-50'
            : isSelected 
              ? 'bg-cyan-500/20 border-2 border-cyan-500' 
              : 'bg-zinc-800 border border-zinc-700 hover:border-zinc-500'
        }
      `}
      data-testid={`price-tier-${tier}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-white">{label}</span>
        {isPurchased ? (
          <Badge className="bg-green-500 text-white text-xs">Owned</Badge>
        ) : isLocked ? (
          <Badge className="bg-zinc-600 text-zinc-400 text-xs">
            <Lock className="w-3 h-3 mr-1" />
            {lockedReason || 'Unavailable'}
          </Badge>
        ) : hasDeal ? (
          <PriceSourceBadge 
            source={priceSource} 
            originalPrice={generalPrice}
            currentPrice={price}
          />
        ) : null}
      </div>
      
      <div className="flex items-baseline gap-2">
        <span className={`text-xl font-bold ${
          isPurchased ? 'text-green-400' : price === 0 ? 'text-green-400' : 'text-white'
        }`}>
          {price === 0 ? 'FREE' : `$${price.toFixed(2)}`}
        </span>
        {hasDeal && generalPrice && (
          <span className="text-sm text-zinc-500 line-through">
            ${generalPrice.toFixed(2)}
          </span>
        )}
      </div>
      
      {description && (
        <p className="text-xs text-zinc-400 mt-1">{description}</p>
      )}
    </button>
  );
};

/**
 * QualityTierBadge - Shows service type quality limit at booking time
 * TICKET-001 extension for booking flow
 */
export const QualityTierBadge = ({ serviceType, className = '' }) => {
  const config = {
    'scheduled': {
      label: 'Pro Quality (4K)',
      icon: Crown,
      color: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      description: 'Full resolution, RAW files available'
    },
    'on_demand': {
      label: 'Standard Quality (1080p)',
      icon: Camera,
      color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      description: 'Social-optimized, up to 1080p'
    },
    'live_session': {
      label: 'Standard Quality (1080p)',
      icon: Camera,
      color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      description: 'Social-optimized, up to 1080p'
    }
  };
  
  const tier = config[serviceType] || config['on_demand'];
  const Icon = tier.icon;
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${tier.color} ${className}`}>
            <Icon className="w-4 h-4" />
            <span className="text-sm font-medium">{tier.label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent className="bg-zinc-800 border-zinc-700 text-white">
          <p className="text-xs">{tier.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default PriceSourceBadge;
