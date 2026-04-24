/**
 * ReviewModal - Post-session review modal with double-blind pattern
 * 
 * Supports:
 * - Single review (surfer → photographer)
 * - Multi-review Uber-style (photographer → multiple surfers at once)
 * - All 3 session types: live, on-demand, scheduled
 * - Star rating (1-5) with tap/hover animation
 * - Category ratings: Photo Quality, Communication, Punctuality
 * - Text comment with character count
 * - Theme-aware (light/dark/beach)
 */

import React, { useState, useCallback } from 'react';
import { Star, Camera, MessageSquare, Clock, Send, X, Loader2, ChevronRight, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { getFullUrl } from '../utils/media';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

// Star rating component with hover/tap animation
const StarRating = ({ value, onChange, size = 'md', disabled = false, theme }) => {
  const [hoverValue, setHoverValue] = useState(0);
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  
  const sizeClasses = {
    sm: 'w-5 h-5',
    md: 'w-8 h-8',
    lg: 'w-10 h-10'
  };
  const starSize = sizeClasses[size] || sizeClasses.md;
  
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= (hoverValue || value);
        return (
          <button
            key={star}
            type="button"
            disabled={disabled}
            onClick={() => onChange(star)}
            onMouseEnter={() => !disabled && setHoverValue(star)}
            onMouseLeave={() => setHoverValue(0)}
            className={`transition-all duration-150 ${disabled ? 'cursor-default' : 'cursor-pointer hover:scale-110 active:scale-95'}`}
          >
            <Star
              className={`${starSize} transition-colors duration-150 ${
                filled
                  ? 'text-yellow-400 fill-yellow-400'
                  : isLight
                    ? 'text-gray-300'
                    : isBeach
                      ? 'text-zinc-600'
                      : 'text-zinc-600'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
};

// Category rating row
const CategoryRating = ({ label, icon: Icon, value, onChange, theme }) => {
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const textClass = isLight ? 'text-gray-700' : isBeach ? 'text-gray-200' : 'text-gray-300';
  
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${isLight ? 'text-gray-500' : 'text-gray-400'}`} />
        <span className={`text-sm font-medium ${textClass}`}>{label}</span>
      </div>
      <StarRating value={value} onChange={onChange} size="sm" theme={theme} />
    </div>
  );
};

// Single person review card (used in multi-review mode)
const PersonReviewCard = ({ person, review, onUpdate, index, theme }) => {
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const cardBg = isLight ? 'bg-gray-50 border-gray-200' : isBeach ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-800/60 border-zinc-700';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  const inputBg = isLight ? 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400' : isBeach ? 'bg-zinc-800 border-zinc-600 text-white placeholder:text-gray-500' : 'bg-zinc-700 border-zinc-600 text-white placeholder:text-gray-500';
  
  return (
    <div className={`rounded-xl border ${cardBg} p-4 space-y-3`}>
      {/* Person header */}
      <div className="flex items-center gap-3">
        <Avatar className="w-10 h-10 border-2 border-yellow-500/30">
          <AvatarImage src={getFullUrl(person.counterpart_avatar || person.avatar_url)} />
          <AvatarFallback className="bg-zinc-700 text-white text-sm">
            {(person.counterpart_name || person.full_name || 'U').charAt(0)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className={`font-medium truncate ${textPrimary}`}>
            {person.counterpart_name || person.full_name || 'Surfer'}
          </p>
          <p className={`text-xs ${textSecondary}`}>Tap stars to rate</p>
        </div>
        {review.rating > 0 && (
          <div className="flex items-center gap-1 bg-yellow-500/20 px-2 py-0.5 rounded-full">
            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
            <span className="text-xs font-bold text-yellow-400">{review.rating}</span>
          </div>
        )}
      </div>
      
      {/* Stars */}
      <div className="flex justify-center">
        <StarRating value={review.rating} onChange={(val) => onUpdate(index, 'rating', val)} theme={theme} />
      </div>
      
      {/* Comment */}
      {review.rating > 0 && (
        <textarea
          value={review.comment || ''}
          onChange={(e) => onUpdate(index, 'comment', e.target.value)}
          placeholder="Add a comment (optional)..."
          maxLength={500}
          rows={2}
          className={`w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-yellow-500/30 ${inputBg}`}
        />
      )}
    </div>
  );
};

/**
 * Main ReviewModal Component
 */
export const ReviewModal = ({
  isOpen,
  onClose,
  // Review context
  reviewerId,
  sessionId,         // live_session_id, booking_id, or dispatch_id
  sessionType = 'live', // 'live', 'on_demand', 'scheduled'
  // For single review (surfer → photographer)
  reviewee = null,   // { id, full_name, avatar_url }
  // For multi review (photographer → multiple surfers)
  participants = [], // [{ counterpart_id, counterpart_name, counterpart_avatar }]
  // Callbacks
  onReviewSubmitted,
  // Theme
  theme = 'dark'
}) => {
  const isMultiReview = participants.length > 0;
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  
  // Single review state
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [photoQualityRating, setPhotoQualityRating] = useState(0);
  const [communicationRating, setCommunicationRating] = useState(0);
  const [punctualityRating, setPunctualityRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  
  // Multi review state (Uber-style: all surfers at once)
  const [multiReviews, setMultiReviews] = useState(
    participants.map(p => ({
      reviewee_id: p.counterpart_id || p.id,
      rating: 0,
      comment: '',
      punctuality_rating: 0,
      communication_rating: 0
    }))
  );
  const [multiSubmitting, setMultiSubmitting] = useState(false);
  const [multiSubmittedCount, setMultiSubmittedCount] = useState(0);
  
  // Theme classes
  const overlayBg = isLight ? 'bg-white' : isBeach ? 'bg-zinc-950' : 'bg-zinc-900';
  const borderColor = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-700' : 'border-zinc-800';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  const inputBg = isLight
    ? 'bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400'
    : isBeach
      ? 'bg-zinc-800 border-zinc-600 text-white placeholder:text-gray-500'
      : 'bg-zinc-800 border-zinc-700 text-white placeholder:text-gray-500';
  
  // Build session ID payload based on type
  const getSessionPayload = useCallback(() => {
    const payload = { session_type: sessionType };
    if (sessionType === 'live') payload.live_session_id = sessionId;
    else if (sessionType === 'on_demand') payload.dispatch_id = sessionId;
    else if (sessionType === 'scheduled') payload.booking_id = sessionId;
    return payload;
  }, [sessionId, sessionType]);
  
  // Submit single review (surfer → photographer)
  const handleSubmitSingle = useCallback(async () => {
    if (rating === 0) {
      toast.error('Please select a star rating');
      return;
    }
    
    setSubmitting(true);
    try {
      const sessionPayload = getSessionPayload();
      
      await apiClient.post(`/reviews?reviewer_id=${reviewerId}`, {
        reviewee_id: reviewee.id,
        rating,
        comment: comment.trim() || null,
        photo_quality_rating: photoQualityRating || null,
        communication_rating: communicationRating || null,
        punctuality_rating: punctualityRating || null,
        ...sessionPayload
      });
      
      setSubmitted(true);
      toast.success('Review submitted! +10 XP 🎉');
      onReviewSubmitted?.();
      
      // Auto-close after brief delay
      setTimeout(() => {
        onClose();
      }, 1500);
      
    } catch (error) {
      const detail = error?.response?.data?.detail;
      if (typeof detail === 'string' && detail.includes('already reviewed')) {
        toast.info('You already reviewed this session');
        onClose();
      } else if (typeof detail === 'string' && detail.includes('20 minutes')) {
        toast.error('Session too short for reviews (minimum 20 minutes)');
        onClose();
      } else if (typeof detail === 'string' && detail.includes('14-day')) {
        toast.error('Review window has expired');
        onClose();
      } else {
        toast.error(detail || 'Failed to submit review');
        logger.error('Review submission error:', error?.response?.status, detail, error);
      }
    } finally {
      setSubmitting(false);
    }
  }, [rating, comment, photoQualityRating, communicationRating, punctualityRating, reviewerId, reviewee, getSessionPayload, onReviewSubmitted, onClose]);
  
  // Update multi-review item
  const handleUpdateMultiReview = useCallback((index, field, value) => {
    setMultiReviews(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);
  
  // Submit all multi-reviews (Uber-style: all at once)
  const handleSubmitMulti = useCallback(async () => {
    const validReviews = multiReviews.filter(r => r.rating > 0);
    
    if (validReviews.length === 0) {
      toast.error('Please rate at least one surfer');
      return;
    }
    
    setMultiSubmitting(true);
    const sessionPayload = getSessionPayload();
    let successCount = 0;
    
    for (const review of validReviews) {
      try {
        await apiClient.post(`/reviews?reviewer_id=${reviewerId}`, {
          reviewee_id: review.reviewee_id,
          rating: review.rating,
          comment: review.comment?.trim() || null,
          punctuality_rating: review.punctuality_rating || null,
          communication_rating: review.communication_rating || null,
          ...sessionPayload
        });
        successCount++;
        setMultiSubmittedCount(successCount);
      } catch (error) {
        logger.error(`Review submission error for ${review.reviewee_id}:`, error);
      }
    }
    
    if (successCount > 0) {
      toast.success(`${successCount} review${successCount > 1 ? 's' : ''} submitted! +${successCount * 10} XP 🎉`);
      onReviewSubmitted?.();
    }
    
    setMultiSubmitting(false);
    setTimeout(() => onClose(), 1500);
  }, [multiReviews, reviewerId, getSessionPayload, onReviewSubmitted, onClose]);
  
  // Skip handler
  const handleSkip = useCallback(() => {
    onClose();
    toast.info('You can leave a review anytime from your Past Sessions tab');
  }, [onClose]);
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${overlayBg} ${borderColor} max-w-md mx-auto p-0 overflow-hidden`}>
        {/* Header */}
        <DialogHeader className="p-5 pb-0">
          <DialogTitle className={`flex items-center gap-2 ${textPrimary}`}>
            <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
            {isMultiReview ? 'Rate Your Surfers' : 'How was your session?'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="px-5 pb-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Double-blind notice */}
          <div className={`flex items-start gap-2 p-3 rounded-lg ${isLight ? 'bg-blue-50 border border-blue-200' : isBeach ? 'bg-blue-950/30 border border-blue-800/30' : 'bg-blue-950/30 border border-blue-900/30'}`}>
            <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <p className={`text-xs ${isLight ? 'text-blue-700' : 'text-blue-300'}`}>
              Reviews are private until both parties submit, or after 14 days — encouraging honest feedback.
            </p>
          </div>
          
          {/* ===== SINGLE REVIEW MODE (Surfer → Photographer) ===== */}
          {!isMultiReview && reviewee && !submitted && (
            <>
              {/* Reviewee header */}
              <div className="flex items-center gap-3">
                <Avatar className="w-14 h-14 border-2 border-yellow-500/30">
                  <AvatarImage src={getFullUrl(reviewee.avatar_url)} />
                  <AvatarFallback className="bg-zinc-700 text-white text-lg">
                    {reviewee.full_name?.charAt(0) || 'P'}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className={`font-semibold ${textPrimary}`}>{reviewee.full_name}</p>
                  <p className={`text-sm ${textSecondary}`}>
                    {sessionType === 'live' ? 'Live Session' : sessionType === 'on_demand' ? 'On-Demand Session' : 'Scheduled Session'}
                  </p>
                </div>
              </div>
              
              {/* Overall rating */}
              <div className="text-center space-y-2 py-2">
                <p className={`text-sm font-medium ${textSecondary}`}>Overall Rating</p>
                <div className="flex justify-center">
                  <StarRating value={rating} onChange={setRating} size="lg" theme={theme} />
                </div>
                <p className={`text-xs ${textSecondary}`}>
                  {rating === 0 ? 'Tap a star' : ['', 'Poor', 'Below Average', 'Good', 'Great', 'Amazing!'][rating]}
                </p>
              </div>
              
              {/* Category ratings (optional) */}
              {rating > 0 && (
                <div className={`border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'} pt-3 space-y-1`}>
                  <p className={`text-xs font-medium uppercase tracking-wide ${textSecondary} mb-2`}>Category Ratings (Optional)</p>
                  <CategoryRating label="Photo Quality" icon={Camera} value={photoQualityRating} onChange={setPhotoQualityRating} theme={theme} />
                  <CategoryRating label="Communication" icon={MessageSquare} value={communicationRating} onChange={setCommunicationRating} theme={theme} />
                  <CategoryRating label="Punctuality" icon={Clock} value={punctualityRating} onChange={setPunctualityRating} theme={theme} />
                </div>
              )}
              
              {/* Comment */}
              {rating > 0 && (
                <div className="space-y-2">
                  <label className={`text-sm font-medium ${textSecondary}`}>
                    Leave a comment (optional)
                  </label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Share your experience..."
                    maxLength={500}
                    rows={3}
                    className={`w-full rounded-xl border px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-yellow-500/40 transition-colors ${inputBg}`}
                  />
                  <p className={`text-xs text-right ${textSecondary}`}>{comment.length}/500</p>
                </div>
              )}
              
              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className={`flex-1 ${isLight ? 'border-gray-300 text-gray-600' : 'border-zinc-700 text-gray-400'}`}
                  onClick={handleSkip}
                >
                  Skip
                </Button>
                <Button
                  className="flex-1 bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600 text-black font-semibold"
                  onClick={handleSubmitSingle}
                  disabled={rating === 0 || submitting}
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  Submit Review
                </Button>
              </div>
            </>
          )}
          
          {/* ===== MULTI REVIEW MODE (Photographer → Surfers, Uber-style) ===== */}
          {isMultiReview && !submitted && (
            <>
              <p className={`text-sm ${textSecondary}`}>
                Rate {participants.length} surfer{participants.length > 1 ? 's' : ''} from your session
              </p>
              
              <div className="space-y-3">
                {participants.map((person, idx) => (
                  <PersonReviewCard
                    key={person.counterpart_id || person.id || idx}
                    person={person}
                    review={multiReviews[idx]}
                    onUpdate={handleUpdateMultiReview}
                    index={idx}
                    theme={theme}
                  />
                ))}
              </div>
              
              {/* Submit/Skip */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className={`flex-1 ${isLight ? 'border-gray-300 text-gray-600' : 'border-zinc-700 text-gray-400'}`}
                  onClick={handleSkip}
                >
                  Skip All
                </Button>
                <Button
                  className="flex-1 bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600 text-black font-semibold"
                  onClick={handleSubmitMulti}
                  disabled={multiReviews.every(r => r.rating === 0) || multiSubmitting}
                >
                  {multiSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      {multiSubmittedCount}/{multiReviews.filter(r => r.rating > 0).length}
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Submit {multiReviews.filter(r => r.rating > 0).length} Review{multiReviews.filter(r => r.rating > 0).length !== 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
          
          {/* ===== SUCCESS STATE ===== */}
          {submitted && (
            <div className="text-center py-8 space-y-3">
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center animate-bounce">
                <Star className="w-8 h-8 text-black fill-black" />
              </div>
              <h3 className={`text-lg font-bold ${textPrimary}`}>Review Submitted!</h3>
              <p className={`text-sm ${textSecondary}`}>+10 XP earned. Thanks for your feedback! 🤙</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReviewModal;
