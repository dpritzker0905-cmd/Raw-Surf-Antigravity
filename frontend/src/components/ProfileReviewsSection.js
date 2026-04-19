/**
 * ProfileReviewsSection - Reviews display for photographer and surfer profiles
 * 
 * Shows:
 * - Average rating with star display
 * - Total review count
 * - Rating breakdown (5-star, 4-star, etc.)
 * - Recent review cards with reviewer info
 * - Theme-aware (light/dark/beach)
 */

import React, { useState, useEffect } from 'react';
import { Star, MessageSquare, Camera, Clock, User, Loader2 } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { getFullUrl } from '../utils/media';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

// Rating bar for breakdown
const RatingBar = ({ stars, count, total, theme }) => {
  const isLight = theme === 'light';
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`w-3 text-right ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>{stars}</span>
      <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
      <div className={`flex-1 h-2 rounded-full ${isLight ? 'bg-gray-200' : 'bg-zinc-700'} overflow-hidden`}>
        <div
          className="h-full bg-yellow-400 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-6 text-right text-xs ${isLight ? 'text-gray-400' : 'text-zinc-500'}`}>{count}</span>
    </div>
  );
};

// Single review card
const ReviewCard = ({ review, theme }) => {
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const cardBg = isLight ? 'bg-gray-50 border-gray-200' : isBeach ? 'bg-zinc-900 border-zinc-800' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  
  const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days < 1) return 'Today';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  };
  
  return (
    <div className={`p-4 rounded-xl border ${cardBg}`}>
      <div className="flex items-start gap-3">
        <Avatar className="w-9 h-9">
          <AvatarImage src={getFullUrl(review.reviewer_avatar)} />
          <AvatarFallback className={`${isLight ? 'bg-gray-200 text-gray-700' : 'bg-zinc-700 text-white'} text-sm`}>
            {(review.reviewer_name || 'U').charAt(0)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <p className={`font-medium text-sm truncate ${textPrimary}`}>{review.reviewer_name}</p>
            <span className={`text-xs ${textSecondary}`}>{timeAgo(review.created_at)}</span>
          </div>
          
          {/* Stars */}
          <div className="flex items-center gap-0.5 mb-2">
            {[1, 2, 3, 4, 5].map(s => (
              <Star
                key={s}
                className={`w-3.5 h-3.5 ${s <= review.rating ? 'text-yellow-400 fill-yellow-400' : isLight ? 'text-gray-300' : 'text-zinc-600'}`}
              />
            ))}
          </div>
          
          {/* Comment */}
          {review.comment && (
            <p className={`text-sm ${textSecondary} mt-1`}>{review.comment}</p>
          )}
          
          {/* Category ratings if present */}
          {(review.photo_quality_rating || review.communication_rating || review.punctuality_rating) && (
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {review.photo_quality_rating && (
                <div className="flex items-center gap-1">
                  <Camera className={`w-3 h-3 ${textSecondary}`} />
                  <span className={`text-xs ${textSecondary}`}>{review.photo_quality_rating}/5</span>
                </div>
              )}
              {review.communication_rating && (
                <div className="flex items-center gap-1">
                  <MessageSquare className={`w-3 h-3 ${textSecondary}`} />
                  <span className={`text-xs ${textSecondary}`}>{review.communication_rating}/5</span>
                </div>
              )}
              {review.punctuality_rating && (
                <div className="flex items-center gap-1">
                  <Clock className={`w-3 h-3 ${textSecondary}`} />
                  <span className={`text-xs ${textSecondary}`}>{review.punctuality_rating}/5</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


/**
 * Main ProfileReviewsSection Component
 */
export const ProfileReviewsSection = ({ profileUserId, isPhotographer = false, theme = 'dark' }) => {
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [reviews, setReviews] = useState([]);
  
  useEffect(() => {
    if (!profileUserId) return;
    
    const fetchReviews = async () => {
      setLoading(true);
      try {
        if (isPhotographer) {
          // Photographer: Get review stats from photographer endpoint
          const statsRes = await apiClient.get(`/reviews/photographer/${profileUserId}/stats`);
          setStats({
            average_rating: statsRes.data.average_rating,
            total_reviews: statsRes.data.total_reviews,
            rating_breakdown: statsRes.data.rating_breakdown
          });
          setReviews(statsRes.data.recent_reviews || []);
        } else {
          // Surfer: Get review stats from surfer endpoint
          const statsRes = await apiClient.get(`/reviews/surfer/${profileUserId}/stats`);
          setStats({
            average_rating: statsRes.data.average_rating,
            total_reviews: statsRes.data.total_reviews,
            rating_breakdown: null // Surfer endpoint doesn't have this yet
          });
          setReviews(statsRes.data.recent_reviews || []);
        }
      } catch (error) {
        logger.error('Failed to fetch profile reviews:', error);
        setStats(null);
        setReviews([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchReviews();
  }, [profileUserId, isPhotographer]);
  
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-yellow-500" />
      </div>
    );
  }
  
  if (!stats || stats.total_reviews === 0) {
    return (
      <div className="py-8 text-center">
        <Star className={`w-10 h-10 mx-auto mb-3 ${isLight ? 'text-gray-300' : 'text-zinc-600'}`} />
        <p className={textSecondary}>No reviews yet</p>
        <p className={`text-xs ${textSecondary} mt-1`}>
          {isPhotographer ? 'Surfers will leave reviews after sessions' : 'Photographers will review your sessions'}
        </p>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* Rating Summary */}
      <div className={`p-4 rounded-xl border ${isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-700' : 'bg-zinc-900 border-zinc-800'}`}>
        <div className="flex items-start gap-6">
          {/* Large rating */}
          <div className="text-center">
            <p className={`text-4xl font-bold ${textPrimary}`}>{stats.average_rating}</p>
            <div className="flex items-center gap-0.5 mt-1 justify-center">
              {[1, 2, 3, 4, 5].map(s => (
                <Star
                  key={s}
                  className={`w-4 h-4 ${s <= Math.round(stats.average_rating) ? 'text-yellow-400 fill-yellow-400' : isLight ? 'text-gray-300' : 'text-zinc-600'}`}
                />
              ))}
            </div>
            <p className={`text-xs mt-1 ${textSecondary}`}>
              {stats.total_reviews} review{stats.total_reviews !== 1 ? 's' : ''}
            </p>
          </div>
          
          {/* Breakdown bars */}
          {stats.rating_breakdown && (
            <div className="flex-1 space-y-1">
              {[5, 4, 3, 2, 1].map(stars => (
                <RatingBar
                  key={stars}
                  stars={stars}
                  count={stats.rating_breakdown[stars] || 0}
                  total={stats.total_reviews}
                  theme={theme}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* Recent Reviews */}
      {reviews.length > 0 && (
        <div className="space-y-3">
          <h3 className={`text-sm font-medium ${textSecondary} flex items-center gap-2`}>
            <MessageSquare className="w-4 h-4" />
            Recent Reviews
          </h3>
          {reviews.map((review, idx) => (
            <ReviewCard key={review.id || idx} review={review} theme={theme} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ProfileReviewsSection;
