/**
 * SpotDrawerHelpers.js
 * Extracted from UnifiedSpotDrawer.js — Shared small UI components used by the spot drawer.
 * Includes: SpotOfTheDayBadge, LiveSavingsBadge, StarRating, ReviewsCarousel, GeofenceUpgradeCTA, DRAWER_MODE
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Camera, Check, Lock, Sparkles, Star, Crown, Trophy } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { getFullUrl } from '../../utils/media';

// Drawer modes — shared constant
export const DRAWER_MODE = {
  REPORT: 'REPORT',
  SETUP: 'SETUP',
  JUMP_IN: 'JUMP_IN',
  PHOTOGRAPHER_PROFILE: 'PHOTOGRAPHER_PROFILE'
};

// LocalStorage key for camera permission persistence
export const CAMERA_AUTHORIZED_KEY = 'raw_surf_camera_authorized';

// =====================================
// SPOT OF THE DAY BADGE COMPONENT
// =====================================
export const SpotOfTheDayBadge = React.memo(({ spotOfTheDay, onClick }) => {
  if (!spotOfTheDay || !spotOfTheDay.has_spot_of_the_day) return null;
  
  const getRatingColor = (rating) => {
    switch (rating?.toUpperCase()) {
      case 'EPIC': return 'from-orange-500 to-red-500';
      case 'GOOD_TO_EPIC': return 'from-yellow-500 to-orange-500';
      case 'GOOD': return 'from-green-500 to-emerald-500';
      case 'FAIR_TO_GOOD': return 'from-cyan-500 to-green-500';
      default: return 'from-cyan-500 to-blue-500';
    }
  };
  
  return (
    <div 
      onClick={onClick}
      className={`mx-4 my-3 p-3 bg-gradient-to-r ${getRatingColor(spotOfTheDay.rating)} rounded-xl cursor-pointer hover:scale-[1.02] transition-transform`}
      data-testid="spot-of-the-day-banner"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
            <Trophy className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <span className="text-white font-bold text-sm">Spot of the Day</span>
              {spotOfTheDay.rating && (
                <Badge className="bg-white/20 text-white text-[10px] ml-1">
                  {spotOfTheDay.rating}
                </Badge>
              )}
            </div>
            <p className="text-white/80 text-xs">
              {spotOfTheDay.active_photographers > 0 
                ? `${spotOfTheDay.active_photographers} Pro${spotOfTheDay.active_photographers > 1 ? 's' : ''} shooting now`
                : 'Best conditions today'}
            </p>
          </div>
        </div>
        
        {spotOfTheDay.featured_photographer && (
          <div className="flex items-center gap-2">
            <img loading="lazy" decoding="async" src={getFullUrl(spotOfTheDay.featured_photographer.avatar_url || '/default-avatar.png')}
              alt={spotOfTheDay.featured_photographer.full_name}
              className="w-8 h-8 rounded-full border-2 border-white/30"
            />
          </div>
        )}
      </div>
      
      {spotOfTheDay.featured_photo_url && (
        <div className="mt-2 rounded-lg overflow-hidden">
          <img loading="lazy" decoding="async" 
            src={spotOfTheDay.featured_photo_url} 
            alt="Conditions" 
            className="w-full h-24 object-cover"
          />
        </div>
      )}
      
      <p className="text-center text-white/70 text-[10px] mt-2">
        Tap to book instantly
      </p>
    </div>
  );
});

// Live Savings Badge Component - Shows only when promotional pricing is active
export const LiveSavingsBadge = React.memo(({ generalPrice, livePrice, pricingMode = 'tiered', highResPrice, className = '' }) => {
  if (pricingMode !== 'promotional') return null;
  const comparePrice = highResPrice || generalPrice;
  const savings = comparePrice - livePrice;
  if (savings <= 0) return null;
  
  return (
    <Badge className={`bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold animate-pulse ${className}`}>
      <Sparkles className="w-3 h-3 mr-1" />
      Save ${savings} per photo!
    </Badge>
  );
});

// Star Rating Component
export const StarRating = React.memo(({ rating, size = 'sm' }) => {
  const stars = [];
  const sizeClass = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <Star 
        key={i} 
        className={`${sizeClass} ${i <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`} 
      />
    );
  }
  return <div className="flex items-center gap-0.5">{stars}</div>;
});

// Reviews Carousel Component
export const ReviewsCarousel = React.memo(({ reviews }) => {
  if (!reviews || reviews.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500 text-sm">
        No reviews yet
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      {reviews.slice(0, 3).map((review, i) => (
        <div key={i} className="p-3 bg-zinc-800/50 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-full bg-zinc-700 overflow-hidden">
              {review.reviewer_avatar ? (
                <img loading="lazy" decoding="async" src={review.reviewer_avatar} className="w-full h-full object-cover" alt="" />
              ) : (
                <span className="flex items-center justify-center h-full text-xs text-gray-400">
                  {review.reviewer_name?.[0]}
                </span>
              )}
            </div>
            <span className="text-gray-300 text-xs font-medium">{review.reviewer_name}</span>
            <StarRating rating={review.rating} />
          </div>
          <p className="text-gray-400 text-xs line-clamp-2">{review.comment}</p>
        </div>
      ))}
    </div>
  );
});

// Privacy Shield Upgrade CTA Component
export const GeofenceUpgradeCTA = React.memo(({ distanceMiles, _visibilityRadius, activePhotographersCount = 0 }) => {
  const navigate = useNavigate();
  
  return (
    <div className="mx-4 my-4 p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-xl">
      {activePhotographersCount > 0 && (
        <div className="bg-gradient-to-r from-cyan-500/20 to-green-500/20 border border-cyan-500/40 rounded-lg p-3 mb-3 animate-pulse">
          <div className="flex items-center justify-center gap-2">
            <Camera className="w-5 h-5 text-cyan-400" />
            <span className="text-white font-bold text-lg">
              {activePhotographersCount} Pro{activePhotographersCount > 1 ? 's' : ''} Shooting Now
            </span>
          </div>
          <p className="text-center text-cyan-300 text-sm mt-1">
            Upgrade to Premium to Book
          </p>
        </div>
      )}
      
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
          <Lock className="w-5 h-5 text-purple-400" />
        </div>
        <div>
          <h3 className="text-white font-medium">Outside Your Coverage Area</h3>
          <p className="text-gray-400 text-xs">
            {distanceMiles ? `${distanceMiles.toFixed(1)} miles away` : 'Expand your range to view live activity'}
          </p>
        </div>
      </div>
      
      <div className="bg-zinc-800/50 rounded-lg p-3 mb-3">
        <p className="text-gray-300 text-sm mb-2">
          Upgrade to see:
        </p>
        <ul className="space-y-1 text-xs text-gray-400">
          <li className="flex items-center gap-2">
            <Check className="w-3 h-3 text-green-400" />
            Live photographers at this spot
          </li>
          <li className="flex items-center gap-2">
            <Check className="w-3 h-3 text-green-400" />
            Real-time conditions & session reports
          </li>
          <li className="flex items-center gap-2">
            <Check className="w-3 h-3 text-green-400" />
            Instant booking capability
          </li>
        </ul>
      </div>
      
      <div className="grid grid-cols-2 gap-2">
        <Button aria-label="Upgrade plan"
          onClick={() => navigate('/settings?tab=billing')}
          className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium"
          data-testid="upgrade-plan-btn"
        >
          <Crown className="w-4 h-4 mr-1" />
          Upgrade Plan
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate('/wallet')}
          className="border-purple-500/50 text-purple-400"
          data-testid="view-plans-btn"
        >
          View Plans
        </Button>
      </div>
      
      <p className="text-center text-gray-500 text-[10px] mt-2">
        Premium members get unlimited range access
      </p>
    </div>
  );
});
