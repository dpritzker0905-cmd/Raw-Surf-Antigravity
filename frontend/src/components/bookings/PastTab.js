/**
 * PastTab - Completed session history for surfers
 * 
 * Features:
 * - Premium glassmorphism card UI matching gallery design standards
 * - Photographer avatar, session type badge, and metadata
 * - "Leave a Review" CTA or existing rating stars
 * - Tap-to-expand SessionDetailDrawer with normalized booking data
 * - Theme-aware (light/dark/beach)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, MapPin, History, Star, Camera, Clock, ChevronRight, DollarSign, Zap, Send } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { getFullUrl } from '../../utils/media';
import apiClient from '../../lib/apiClient';
import ReviewModal from '../ReviewModal';
import SessionDetailDrawer from './SessionDetailDrawer';

// GöÇGöÇGöÇ Session Type Icon GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ
const SessionTypeConfig = {
  on_demand: { label: 'On-Demand', gradient: 'from-purple-500 to-indigo-500', icon: Send },
  scheduled: { label: 'Scheduled', gradient: 'from-amber-500 to-orange-500', icon: Calendar },
  live: { label: 'Live Session', gradient: 'from-cyan-500 to-blue-500', icon: Zap },
  live_join: { label: 'Live Session', gradient: 'from-cyan-500 to-blue-500', icon: Zap },
};

/**
 * Infer display status for a past session:
 * - 'Completed' = photographer explicitly ended session (status === 'Completed')
 * - 'Expired'   = session date passed but was never started/completed (was Confirmed)
 * - 'Missed'    = session date passed but user never confirmed (was Pending)
 */
const inferDisplayStatus = (booking) => {
  if (booking.status === 'Completed') return 'Completed';
  if (booking.status === 'Pending') return 'Missed';
  return 'Expired'; // Confirmed that passed without being completed
};

/**
 * Normalize a raw booking object (from /bookings/user) into the shape
 * that SessionDetailDrawer expects so all stats render correctly.
 */
const normalizeBookingForDrawer = (booking) => ({
  ...booking,
  // Map duration GåÆ duration_mins (bookings use `duration` in minutes)
  duration_mins: booking.duration_mins || booking.duration || 0,
  // Session type GÇö bookings don't have this, infer from booking_type
  session_type: booking.booking_type || booking.session_type || 'scheduled',
  // Surfer count from participants array or current_participants
  total_surfers: booking.current_participants || booking.participants?.length || 1,
  // Pricing GÇö map booking fields for the drawer's PriceRow
  buyin_price: booking.price_per_person || booking.total_price,
  // Gallery data GÇö if the booking has associated gallery info
  gallery_photo_count: booking.gallery_photo_count || 0,
  gallery_id: booking.gallery_id || null,
  // Display status for the OutcomeBadge in SessionDetailDrawer
  _displayStatus: inferDisplayStatus(booking),
  // Ensure participants have expected shape
  participants: (booking.participants || []).map(p => ({
    id: p.participant_id || p.user_id || p.id,
    full_name: p.name || p.full_name || 'Surfer',
    avatar_url: p.avatar_url,
    amount_paid: p.paid_amount || p.amount_paid || 0,
  })),
});

export const PastTab = ({
  pastBookings,
  theme,
  userId
}) => {
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  
  // Glassmorphism card styles matching gallery/premium standards
  const cardBg = isLight
    ? 'bg-white border border-gray-200/80 shadow-sm'
    : isBeach
      ? 'bg-zinc-950/80 border border-zinc-700/60 backdrop-blur-sm'
      : 'bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : isBeach ? 'text-gray-400' : 'text-gray-400';
  
  // Review modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewSessionId, setReviewSessionId] = useState(null);
  const [reviewSessionType, setReviewSessionType] = useState('live');
  
  // Session detail drawer state
  const [showDetailDrawer, setShowDetailDrawer] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  
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
    // Properly detect session type and ID to avoid FK constraint violations
    // The Review model's live_session_id has a FK to live_sessions table,
    // so we must NOT pass a booking UUID as live_session_id
    if (booking.live_session_id) {
      setReviewSessionId(booking.live_session_id);
      setReviewSessionType('live');
    } else if (booking.dispatch_id) {
      setReviewSessionId(booking.dispatch_id);
      setReviewSessionType('on_demand');
    } else {
      setReviewSessionId(booking.id);
      setReviewSessionType('scheduled');
    }
    setShowReviewModal(true);
  }, []);
  
  const handleReviewSubmitted = useCallback(() => {
    const sessionId = reviewSessionId;
    if (sessionId) {
      setReviewedSessions(prev => ({ ...prev, [sessionId]: true }));
    }
  }, [reviewSessionId]);
  
  const handleViewDetails = useCallback((booking) => {
    // Normalize booking data to match SessionDetailDrawer expectations
    setSelectedSession(normalizeBookingForDrawer(booking));
    setShowDetailDrawer(true);
  }, []);

  if (pastBookings.length === 0) {
    return (
      <Card className={`${cardBg} transition-colors duration-300`}>
        <CardContent className="py-16 text-center">
          <div className={`w-20 h-20 mx-auto mb-5 rounded-2xl ${
            isLight ? 'bg-gray-100' : isBeach ? 'bg-zinc-900' : 'bg-white/5'
          } flex items-center justify-center`}>
            <History className={`w-10 h-10 ${textSecondary}`} />
          </div>
          <h3 className={`text-xl font-bold ${textPrimary} mb-2 font-oswald`} >
            No Past Sessions
          </h3>
          <p className={`text-sm ${textSecondary} max-w-xs mx-auto`}>
            Your completed sessions will appear here after you join a photographer&apos;s session.
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
          
          // Session type config
          const sessionType = booking.booking_type || booking.session_type || 'scheduled';
          const typeConfig = SessionTypeConfig[sessionType] || SessionTypeConfig.live;
          const TypeIcon = typeConfig.icon;
          
          // Duration display
          const durationMins = booking.duration_mins || booking.duration || 0;
          const durationDisplay = durationMins >= 60
            ? `${Math.floor(durationMins / 60)}h ${durationMins % 60}m`
            : `${durationMins} min`;
          
          // Price display
          const pricePaid = booking.paid_amount || booking.price_per_person || booking.total_price;
          
          return (
            <div 
              key={booking.id} 
              className={`${cardBg} rounded-2xl p-4 transition-all duration-200 cursor-pointer
                hover:ring-1 ${isLight ? 'hover:ring-amber-300/80 hover:shadow-md' : 'hover:ring-amber-500/30'}
                active:scale-[0.98]`}
              onClick={() => handleViewDetails(booking)}
            >
              {/* Top row: Avatar + Name + Badge */}
              <div className="flex items-start gap-3 mb-3">
                {/* Photographer Avatar */}
                <div className="relative flex-shrink-0">
                  {booking.photographer_avatar ? (
                    <Avatar className={`w-12 h-12 ring-2 ${isLight ? 'ring-gray-200' : 'ring-white/10'}`}>
                      <AvatarImage src={getFullUrl(booking.photographer_avatar)} />
                      <AvatarFallback className={`${isLight ? 'bg-gray-100 text-gray-700' : 'bg-zinc-700 text-white'} text-sm font-bold`}>
                        {(booking.photographer_name || 'P').charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ring-2 ${
                      isLight ? 'bg-gray-100 ring-gray-200' : 'bg-zinc-700 ring-white/10'
                    }`}>
                      <Camera className={`w-6 h-6 ${textSecondary}`} />
                    </div>
                  )}
                  {/* Session type indicator dot */}
                  <div className={`absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-gradient-to-br ${typeConfig.gradient} flex items-center justify-center ring-2 ${isLight ? 'ring-white' : 'ring-zinc-900'}`}>
                    <TypeIcon className="w-2.5 h-2.5 text-white" />
                  </div>
                </div>
                
                {/* Name + Type */}
                <div className="flex-1 min-w-0">
                  <h3 className={`font-semibold ${textPrimary} truncate`}>
                    {booking.photographer_name || 'Surf Photo Session'}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs font-medium bg-gradient-to-r ${typeConfig.gradient} bg-clip-text text-transparent`}>
                      {typeConfig.label}
                    </span>
                  </div>
                </div>
                
                {/* Outcome badge + Chevron */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {(() => {
                    const displayStatus = inferDisplayStatus(booking);
                    if (displayStatus === 'Completed') {
                      return (
                        <Badge variant="secondary" className={`text-[10px] font-semibold px-2 py-0.5 ${
                          isLight ? 'bg-green-100 text-green-700' : 'bg-green-500/15 text-green-400 border border-green-500/20'
                        }`}>
                          G£ô Completed
                        </Badge>
                      );
                    } else if (displayStatus === 'Missed') {
                      return (
                        <Badge variant="secondary" className={`text-[10px] font-semibold px-2 py-0.5 ${
                          isLight ? 'bg-red-50 text-red-600 border-red-200' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          Missed
                        </Badge>
                      );
                    } else {
                      return (
                        <Badge variant="secondary" className={`text-[10px] font-semibold px-2 py-0.5 ${
                          isLight ? 'bg-gray-100 text-gray-500' : 'bg-zinc-700/50 text-gray-400 border border-zinc-600/40'
                        }`}>
                          Expired
                        </Badge>
                      );
                    }
                  })()}
                  <ChevronRight className={`w-4 h-4 ${textSecondary} opacity-60`} />
                </div>
              </div>
              
              {/* Metadata row: Location + Date + Duration + Price */}
              <div className={`flex items-center gap-3 flex-wrap text-xs ${textSecondary} mb-3`}>
                <div className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate max-w-[120px]">{booking.location || 'Unknown'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 flex-shrink-0" />
                  <span>{new Date(booking.session_date || booking.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric'
                  })}</span>
                </div>
                {durationMins > 0 && (
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    <span>{durationDisplay}</span>
                  </div>
                )}
                {pricePaid > 0 && (
                  <div className="flex items-center gap-1">
                    <DollarSign className="w-3 h-3 flex-shrink-0" />
                    <span className={isLight ? 'text-gray-700 font-medium' : 'text-green-400 font-medium'}>
                      ${typeof pricePaid === 'number' ? pricePaid.toFixed(2) : pricePaid}
                    </span>
                  </div>
                )}
              </div>
              
              {/* Review section GÇö only Completed sessions are reviewable */}
              <div className={`pt-2.5 border-t ${isLight ? 'border-gray-100' : isBeach ? 'border-zinc-800' : 'border-white/[0.06]'}`}>
                {(() => {
                  const displayStatus = inferDisplayStatus(booking);
                  
                  // Already reviewed GÇö show rating stars
                  if (hasReviewed) {
                    return (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map(s => (
                            <Star
                              key={s}
                              className={`w-3.5 h-3.5 transition-colors ${
                                s <= (existingRating || 5) 
                                  ? 'text-yellow-400 fill-yellow-400' 
                                  : isLight ? 'text-gray-200' : 'text-zinc-700'
                              }`}
                            />
                          ))}
                        </div>
                        <span className={`text-xs font-medium ${isLight ? 'text-green-600' : 'text-green-400'}`}>
                          Reviewed
                        </span>
                      </div>
                    );
                  }
                  
                  // Completed but not yet reviewed GÇö show review CTA
                  if (displayStatus === 'Completed') {
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLeaveReview(booking);
                        }}
                        className={`w-full h-9 rounded-xl text-xs font-semibold transition-all ${
                          isLight
                            ? 'border-yellow-300/80 text-yellow-700 hover:bg-yellow-50 hover:border-yellow-400'
                            : 'border-yellow-500/25 text-yellow-400 hover:bg-yellow-500/10 hover:border-yellow-500/40'
                        }`}
                      >
                        <Star className="w-3.5 h-3.5 mr-1.5" />
                        Leave a Review
                      </Button>
                    );
                  }
                  
                  // Missed or Expired GÇö no review allowed
                  return (
                    <p className={`text-xs ${textSecondary} italic`}>
                      {displayStatus === 'Missed' ? 'Session not confirmed GÇö review unavailable' : 'Session expired GÇö review unavailable'}
                    </p>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Session Detail Drawer */}
      <SessionDetailDrawer
        isOpen={showDetailDrawer}
        onClose={() => {
          setShowDetailDrawer(false);
          setSelectedSession(null);
        }}
        session={selectedSession}
        theme={theme}
        userRole="surfer"
        userId={userId}
        onNavigateToGallery={(galleryId) => {
          // Navigate to gallery page
          window.location.href = `/gallery/${galleryId}`;
        }}
      />
      
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
