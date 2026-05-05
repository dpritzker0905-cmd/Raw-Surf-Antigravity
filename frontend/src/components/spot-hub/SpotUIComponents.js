/**
 * Spot UI Components - Reusable sub-components for the UnifiedSpotDrawer.
 * Includes: SpotOfTheDayBadge, LiveSavingsBadge, StarRating, ReviewsCarousel.
 * 
 * Extracted from UnifiedSpotDrawer.js for maintainability.
 */
import React, { useState, useEffect } from 'react';
import { Star, Award, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { Badge } from '../ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
const SpotOfTheDayBadge = ({ spotOfTheDay, onClick }) => {
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
};

// Live Savings Badge Component - Shows only when promotional pricing is active
const LiveSavingsBadge = ({ generalPrice, livePrice, pricingMode = 'tiered', highResPrice, className = '' }) => {
  // Only show savings badge in promotional mode
  if (pricingMode !== 'promotional') return null;
  
  // Compare against high-res price in promotional mode
  const comparePrice = highResPrice || generalPrice;
  const savings = comparePrice - livePrice;
  
  if (savings <= 0) return null;
  
  return (
    <Badge className={`bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold animate-pulse ${className}`}>
      <Sparkles className="w-3 h-3 mr-1" />
      Save ${savings} per photo!
    </Badge>
  );
};

// Star Rating Component
const StarRating = ({ rating, size = 'sm' }) => {
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
};

// Reviews Carousel Component
const ReviewsCarousel = ({ reviews }) => {
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
};

// Expanded Photographer Profile Component (In-Drawer) - OLD VERSION (keeping for reference)
export { SpotOfTheDayBadge, LiveSavingsBadge, StarRating, ReviewsCarousel };
