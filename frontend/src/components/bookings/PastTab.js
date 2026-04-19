/**
 * PastTab - Completed session history with review CTAs
 * 
 * Features:
 * - Shows completed sessions with photographer info
 * - "Leave a Review" button if session hasn't been reviewed
 * - Shows existing review snippet if already reviewed
 * - Theme-aware (light/dark/beach)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, MapPin, History, Star, MessageSquare, ChevronDown, Camera, Clock } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { getFullUrl } from '../../utils/media';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';
import ReviewModal from '../ReviewModal';

export const PastTab = ({
  pastBookings,
  theme,
  userId
}) => {
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const cardBgClass = isLight
    ? 'bg-white border-gray-200'
    : isBeach
      ? 'bg-zinc-950 border-zinc-700'
      : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';
  
  // Review modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null); // { id, full_name, avatar_url }
  const [reviewSessionId, setReviewSessionId] = useState(null);
  const [reviewSessionType, setReviewSessionType] = useState('live');
  
  // Review status tracking
  const [reviewedSessions, setReviewedSessions] = useState({});
  
  // Check which bookings have already been reviewed
  useEffect(() => {
    if (!userId || pastBookings.length === 0) return;
    
    const checkReviews = async () => {
      const reviewed = {};
      for (const booking of pastBookings.slice(0, 20)) { // Check up to 20
        const sessionId = booking.live_session_id || booking.id;
        try {
          const res = await apiClient.get(`/reviews/check?reviewer_id=${userId}&live_session_id=${sessionId}`);
          if (res.data?.has_reviewed) {
            reviewed[sessionId] = res.data.rating;
          }
        } catch {
          // Silent fail per booking
        }
      }
      setReviewedSessions(reviewed);
    };
    
    checkReviews();
  }, [userId, pastBookings]);
  
  const handleLeaveReview = useCallback((booking) => {
    setReviewTarget({
      id: booking.photographer_id,
      full_name: booking.photographer_name || 'Photographer',
      avatar_url: booking.photographer_avatar
    });
    setReviewSessionId(booking.live_session_id || booking.id);
    setReviewSessionType(booking.session_type || 'live');
    setShowReviewModal(true);
  }, []);
  
  const handleReviewSubmitted = useCallback(() => {
    const sessionId = reviewSessionId;
    if (sessionId) {
      setReviewedSessions(prev => ({ ...prev, [sessionId]: true }));
    }
  }, [reviewSessionId]);

  if (pastBookings.length === 0) {
    return (
      <Card className={`${cardBgClass} transition-colors duration-300`}>
        <CardContent className="py-12 text-center">
          <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : isBeach ? 'bg-zinc-900' : 'bg-zinc-800'} flex items-center justify-center`}>
            <History className={`w-8 h-8 ${textSecondaryClass}`} />
          </div>
          <h3 className={`text-lg font-medium ${textPrimaryClass} mb-2`}>No Past Sessions</h3>
          <p className={textSecondaryClass}>
            Your completed sessions will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {pastBookings.map((booking) => {
          const sessionId = booking.live_session_id || booking.id;
          const hasReviewed = reviewedSessions[sessionId];
          const existingRating = typeof hasReviewed === 'number' ? hasReviewed : null;
          
          return (
            <Card key={booking.id} className={`${cardBgClass} transition-colors duration-300`}>
              <CardContent className="p-4">
                {/* Session header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {booking.photographer_avatar ? (
                      <Avatar className={`w-10 h-10 border ${isLight ? 'border-gray-200' : 'border-zinc-600'}`}>
                        <AvatarImage src={getFullUrl(booking.photographer_avatar)} />
                        <AvatarFallback className={`${isLight ? 'bg-gray-100 text-gray-700' : 'bg-zinc-700 text-white'} text-sm`}>
                          {(booking.photographer_name || 'P').charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isLight ? 'bg-gray-100' : 'bg-zinc-700'}`}>
                        <Camera className={`w-5 h-5 ${textSecondaryClass}`} />
                      </div>
                    )}
                    <div>
                      <h3 className={`font-medium ${textPrimaryClass}`}>
                        {booking.photographer_name || 'Surf Photo Session'}
                      </h3>
                      <p className={`text-xs ${textSecondaryClass}`}>
                        {booking.session_type === 'on_demand' ? 'On-Demand' : booking.session_type === 'scheduled' ? 'Scheduled' : 'Live Session'}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className={isLight ? 'bg-green-100 text-green-700' : 'bg-green-900/30 text-green-400'}>
                    Completed
                  </Badge>
                </div>
                
                {/* Session details */}
                <div className="space-y-1 ml-13 mb-3">
                  <div className={`flex items-center gap-2 text-sm ${textSecondaryClass}`}>
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{booking.location || 'Unknown location'}</span>
                  </div>
                  <div className={`flex items-center gap-2 text-sm ${textSecondaryClass}`}>
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{new Date(booking.session_date || booking.created_at).toLocaleDateString()}</span>
                  </div>
                  {booking.duration_mins && (
                    <div className={`flex items-center gap-2 text-sm ${textSecondaryClass}`}>
                      <Clock className="w-3.5 h-3.5" />
                      <span>{booking.duration_mins} min</span>
                    </div>
                  )}
                </div>
                
                {/* Review section */}
                <div className={`pt-3 border-t ${isLight ? 'border-gray-100' : isBeach ? 'border-zinc-800' : 'border-zinc-700/50'}`}>
                  {hasReviewed ? (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map(s => (
                          <Star
                            key={s}
                            className={`w-3.5 h-3.5 ${s <= (existingRating || 5) ? 'text-yellow-400 fill-yellow-400' : isLight ? 'text-gray-300' : 'text-zinc-600'}`}
                          />
                        ))}
                      </div>
                      <span className={`text-xs ${textSecondaryClass}`}>Reviewed</span>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLeaveReview(booking)}
                      className={`w-full ${
                        isLight
                          ? 'border-yellow-300 text-yellow-700 hover:bg-yellow-50'
                          : 'border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10'
                      }`}
                    >
                      <Star className="w-4 h-4 mr-2" />
                      Leave a Review
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {/* Review Modal */}
      {showReviewModal && reviewTarget && (
        <ReviewModal
          isOpen={showReviewModal}
          onClose={() => setShowReviewModal(false)}
          reviewerId={userId}
          sessionId={reviewSessionId}
          sessionType={reviewSessionType}
          reviewee={reviewTarget}
          onReviewSubmitted={handleReviewSubmitted}
          theme={theme}
        />
      )}
    </>
  );
};

export default PastTab;
