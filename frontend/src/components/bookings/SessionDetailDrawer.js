/**
 * SessionDetailDrawer - Full-screen slide-up drawer for session history details
 * 
 * Used by both surfers (PastTab) and photographers (PhotographerSessionsManager)
 * to view enriched session metadata: pricing, participants, reviews, gallery link.
 * 
 * Design: Premium glassmorphism, dark mode primary, mobile-first.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  X, MapPin, Calendar, Clock, DollarSign, Users, Star,
  ChevronRight, ImageIcon, Award, Zap, Send,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Button } from '../ui/button';
import { getFullUrl } from '../../utils/media';
import apiClient from '../../lib/apiClient';
import ReviewModal from '../ReviewModal';

// --- Session Type Icon (small indicator, NOT a status badge) ----------------
const SessionTypeIcon = ({ type }) => {
  const config = {
    live_join: { label: 'Live', color: 'from-cyan-500 to-blue-500', icon: Zap },
    live: { label: 'Live', color: 'from-cyan-500 to-blue-500', icon: Zap },
    on_demand: { label: 'On-Demand', color: 'from-purple-500 to-indigo-500', icon: Send },
    scheduled: { label: 'Booked', color: 'from-amber-500 to-orange-500', icon: Calendar },
  };
  const c = config[type] || config.live;
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-white/80 bg-gradient-to-r ${c.color} opacity-80`}>
      <Icon className="w-2.5 h-2.5" />
      {c.label}
    </span>
  );
};

// --- Outcome Badge (Completed / Expired / Missed) ---------------------------
const OutcomeBadge = ({ session, isLight }) => {
  // Determine display status from session data
  const displayStatus = session._displayStatus || session.status || 'Completed';
  
  const config = {
    Completed: {
      label: '? Completed',
      className: isLight
        ? 'bg-green-100 text-green-700 border-green-200'
        : 'bg-green-500/15 text-green-400 border border-green-500/20',
    },
    Expired: {
      label: 'Expired',
      className: isLight
        ? 'bg-gray-100 text-gray-600 border-gray-200'
        : 'bg-zinc-700/50 text-gray-400 border border-zinc-600/40',
    },
    Missed: {
      label: 'Missed',
      className: isLight
        ? 'bg-red-50 text-red-600 border-red-200'
        : 'bg-red-500/10 text-red-400 border border-red-500/20',
    },
  };
  const c = config[displayStatus] || config.Completed;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${c.className}`}>
      {c.label}
    </span>
  );
};

// --- Stat Pill --------------------------------------------------------------
const StatPill = ({ icon: Icon, label, value, color = 'text-cyan-400', isLight }) => (
  <div className={`flex flex-col items-center p-3 rounded-xl ${isLight ? 'bg-gray-50 border border-gray-200' : 'bg-white/5 border border-white/10'} backdrop-blur-sm`}>
    <Icon className={`w-5 h-5 ${color} mb-1`} />
    <span className={`text-lg font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>{value}</span>
    <span className={`text-[10px] uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>{label}</span>
  </div>
);

// --- Price Row --------------------------------------------------------------
const PriceRow = ({ label, price, isLight }) => {
  if (price == null) return null;
  return (
    <div className="flex items-center justify-between py-2">
      <span className={`text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>{label}</span>
      <span className={`text-sm font-semibold ${isLight ? 'text-gray-900' : 'text-white'}`}>${price.toFixed(2)}</span>
    </div>
  );
};

// --- Participant Row --------------------------------------------------------
const ParticipantRow = ({ participant, isLight, isPhotographer, onReview, hasReviewed }) => (
  <div className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${isLight ? 'hover:bg-gray-50' : 'hover:bg-white/5'}`}>
    <Avatar className={`w-10 h-10 border-2 ${isLight ? 'border-gray-200' : 'border-white/20'}`}>
      <AvatarImage src={getFullUrl(participant.avatar_url)} />
      <AvatarFallback className={`${isLight ? 'bg-gray-100 text-gray-700' : 'bg-zinc-700 text-white'} text-sm font-semibold`}>
        {(participant.full_name || 'U').charAt(0)}
      </AvatarFallback>
    </Avatar>
    <div className="flex-1 min-w-0">
      <p className={`font-medium truncate ${isLight ? 'text-gray-900' : 'text-white'}`}>
        {participant.full_name || 'Surfer'}
      </p>
      {participant.amount_paid > 0 && (
        <p className="text-xs text-green-400 font-medium">${participant.amount_paid.toFixed(2)} paid</p>
      )}
    </div>
    {isPhotographer && (
      hasReviewed ? (
        <Badge variant="secondary" className="bg-green-500/20 text-green-400 border-0 text-xs">
          <Star className="w-3 h-3 mr-1 fill-green-400" /> Reviewed
        </Badge>
      ) : (
        <Button aria-label="Favorite"
          size="sm"
          variant="ghost"
          onClick={() => onReview?.(participant)}
          className="text-yellow-400 hover:bg-yellow-500/10 text-xs px-2"
        >
          <Star className="w-3.5 h-3.5 mr-1" /> Rate
        </Button>
      )
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const SessionDetailDrawer = ({
  isOpen,
  onClose,
  session,
  theme = 'dark',
  userRole = 'surfer', // 'surfer' | 'photographer'
  userId,
  onNavigateToGallery,
}) => {
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  
  // Review modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewedIds, setReviewedIds] = useState({});
  
  // Check existing reviews
  useEffect(() => {
    if (!isOpen || !session || !userId) return;
    
    const checkReviews = async () => {
      const sessionId = session.live_session_id || session.id;
      if (!sessionId) return;
      
      if (userRole === 'photographer' && session.participants?.length > 0) {
        // More accurate: batch check
        try {
          const res = await apiClient.get(`/reviews/check?reviewer_id=${userId}&live_session_id=${sessionId}`);
          if (res.data?.has_reviewed) {
            // Mark all participants as reviewed (simplified - real check would be per-reviewee)
            const allReviewed = {};
            for (const p of session.participants) {
              allReviewed[p.id] = true;
            }
            setReviewedIds(allReviewed);
          }
        } catch { /* silent */ }
      } else {
        // Surfer checking if they reviewed the photographer
        try {
          const res = await apiClient.get(`/reviews/check?reviewer_id=${userId}&live_session_id=${sessionId}`);
          if (res.data?.has_reviewed) {
            setReviewedIds({ [session.photographer_id]: res.data.rating });
          }
        } catch { /* silent */ }
      }
    };
    
    checkReviews();
  }, [isOpen, session, userId, userRole]);
  
  const handleReviewParticipant = useCallback((participant) => {
    setReviewTarget({
      id: participant.id,
      full_name: participant.full_name,
      avatar_url: participant.avatar_url,
    });
    setShowReviewModal(true);
  }, []);
  
  const handleReviewSubmitted = useCallback(() => {
    if (reviewTarget) {
      setReviewedIds(prev => ({ ...prev, [reviewTarget.id]: true }));
    }
    setShowReviewModal(false);
  }, [reviewTarget]);
  
  if (!session) return null;
  
  // Derive data
  const sessionDate = session.session_date || session.started_at || session.created_at;
  const formattedDate = sessionDate ? new Date(sessionDate).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  }) : 'Unknown date';
  const formattedTime = sessionDate ? new Date(sessionDate).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit'
  }) : '';
  
  const sessionType = session.session_type || 'live';
  const location = session.location || session.spot_name || 'Unknown location';
  const durationMins = session.duration_mins || session.duration || 0;
  const durationDisplay = durationMins >= 60
    ? `${Math.floor(durationMins / 60)}h ${durationMins % 60}m`
    : `${durationMins}m`;
  
  const totalSurfers = session.total_surfers || session.participants?.length || 0;
  const totalEarnings = session.total_earnings || 0;
  const galleryPhotoCount = session.gallery_photo_count || 0;
  const hasPricing = session.buyin_price != null || session.photo_price_web != null || session.photo_price_standard != null;
  const isPhotographer = userRole === 'photographer';

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-50 transition-all duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Drawer - bottom-sheet mobile, centered modal desktop */}
      <div
        className={`fixed z-50 transition-transform duration-300 ease-out
          inset-x-0 bottom-0
          md:inset-0 md:flex md:items-center md:justify-center
          ${isOpen ? 'translate-y-0 md:translate-y-0' : 'translate-y-full md:translate-y-full'}`}
        style={{ pointerEvents: isOpen ? 'auto' : 'none' }}
      >
        <div
          className={`w-full rounded-t-3xl md:rounded-3xl overflow-hidden shadow-2xl
            md:max-w-[560px] md:mx-auto
            ${isLight ? 'bg-white' : isBeach ? 'bg-zinc-950' : 'bg-zinc-900'}
            border-t md:border ${isLight ? 'border-gray-200' : 'border-white/10'}`}
          style={{ maxHeight: '85vh' }}
          onClick={(e) => e.stopPropagation()}
        >
          
          {/* Drag Handle (mobile) / Close hint */}
          <div className="flex justify-center pt-3 pb-1 md:hidden">
            <div className={`w-10 h-1 rounded-full ${isLight ? 'bg-gray-300' : 'bg-white/20'}`} />
          </div>

          {/* Scrollable Content */}
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(85vh - 20px)', WebkitOverflowScrolling: 'touch' }}>
            
            {/* --- Header ----------------------------------------------- */}
            <div className={`px-5 pb-4 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <OutcomeBadge session={session} isLight={isLight} />
                    <SessionTypeIcon type={sessionType} />
                  </div>
                  <h2 className={`text-xl font-bold ${isLight ? 'text-gray-900' : 'text-white'} font-oswald`} >
                    {location}
                  </h2>
                </div>
                <button aria-label="Close"
                  onClick={onClose}
                  className={`p-2 rounded-full transition-colors ${isLight ? 'hover:bg-gray-100 text-gray-500' : 'hover:bg-white/10 text-gray-400'}`}
                ><X className="w-5 h-5" />
                </button>
              </div>
              
              {/* Date & Time */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className={`flex items-center gap-1.5 text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                  <Calendar className="w-4 h-4" />
                  <span>{formattedDate}</span>
                </div>
                {formattedTime && (
                  <div className={`flex items-center gap-1.5 text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                    <Clock className="w-4 h-4" />
                    <span>{formattedTime}</span>
                  </div>
                )}
                <div className={`flex items-center gap-1.5 text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                  <MapPin className="w-4 h-4" />
                  <span>{location}</span>
                </div>
              </div>
            </div>

            {/* --- Stats Grid ------------------------------------------- */}
            <div className="px-5 py-4">
              <div className={`grid ${isPhotographer ? 'grid-cols-4' : 'grid-cols-3'} gap-2`}>
                <StatPill icon={Clock} label="Duration" value={durationDisplay} color="text-cyan-400" isLight={isLight} />
                <StatPill icon={Users} label="Surfers" value={totalSurfers} color="text-purple-400" isLight={isLight} />
                {isPhotographer && (
                  <StatPill icon={DollarSign} label="Earned" value={`$${totalEarnings.toFixed(0)}`} color="text-green-400" isLight={isLight} />
                )}
                <StatPill icon={ImageIcon} label="Photos" value={galleryPhotoCount} color="text-amber-400" isLight={isLight} />
              </div>
            </div>

            {/* --- Pricing Breakdown ------------------------------------ */}
            {hasPricing && (
              <div className={`mx-5 mb-4 p-4 rounded-2xl ${isLight ? 'bg-gray-50 border border-gray-200' : 'bg-white/5 border border-white/10'} backdrop-blur-sm`}>
                <h3 className={`text-sm font-semibold uppercase tracking-wider mb-3 flex items-center gap-2 ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>
                  <DollarSign className="w-4 h-4 text-green-400" />
                  Session Pricing
                </h3>
                <div className={`divide-y ${isLight ? 'divide-gray-200' : 'divide-white/10'}`}>
                  <PriceRow label="Buy-in Price" price={session.buyin_price} isLight={isLight} />
                  <PriceRow label="Web Quality" price={session.photo_price_web} isLight={isLight} />
                  <PriceRow label="Standard Quality" price={session.photo_price_standard} isLight={isLight} />
                  <PriceRow label="High-Res / Print" price={session.photo_price_high} isLight={isLight} />
                </div>
              </div>
            )}

            {/* --- Gallery Link ----------------------------------------- */}
            {session.gallery_id && (
              <div className="px-5 mb-4">
                <button aria-label="div"
                  onClick={() => onNavigateToGallery?.(session.gallery_id)}
                  className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all group ${
                    isLight
                      ? 'bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 hover:border-amber-300'
                      : 'bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 hover:border-amber-500/40'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                      <ImageIcon className="w-5 h-5 text-black" />
                    </div>
                    <div className="text-left">
                      <p className={`font-semibold ${isLight ? 'text-gray-900' : 'text-white'}`}>Session Gallery</p>
                      <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                        {galleryPhotoCount} photo{galleryPhotoCount !== 1 ? 's' : ''} available
                      </p>
                    </div>
                  </div>
                  <ChevronRight className={`w-5 h-5 transition-transform group-hover:translate-x-1 ${isLight ? 'text-gray-400' : 'text-gray-500'}`} />
                </button>
              </div>
            )}

            {/* --- Participants ------------------------------------------ */}
            {session.participants?.length > 0 && (
              <div className="px-5 mb-4">
                <h3 className={`text-sm font-semibold uppercase tracking-wider mb-3 flex items-center gap-2 ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>
                  <Users className="w-4 h-4 text-purple-400" />
                  Participants ({session.participants.length})
                </h3>
                <div className={`rounded-2xl overflow-hidden ${isLight ? 'bg-gray-50 border border-gray-200' : 'bg-white/5 border border-white/10'}`}>
                  {session.participants.map((p, idx) => (
                    <div key={p.id || idx} className={idx > 0 ? `border-t ${isLight ? 'border-gray-100' : 'border-white/5'}` : ''}>
                      <ParticipantRow
                        participant={p}
                        isLight={isLight}
                        isPhotographer={isPhotographer}
                        onReview={handleReviewParticipant}
                        hasReviewed={!!reviewedIds[p.id]}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* --- Photographer Review CTA (Surfer View) ---------------- */}
            {!isPhotographer && session.photographer_id && (
              <div className="px-5 mb-4">
                <h3 className={`text-sm font-semibold uppercase tracking-wider mb-3 flex items-center gap-2 ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>
                  <Star className="w-4 h-4 text-yellow-400" />
                  Review
                </h3>
                {reviewedIds[session.photographer_id] ? (
                  <div className={`flex items-center gap-3 p-4 rounded-2xl ${isLight ? 'bg-green-50 border border-green-200' : 'bg-green-500/10 border border-green-500/20'}`}>
                    <div className="flex items-center gap-1">
                      {[1,2,3,4,5].map(s => (
                        <Star
                          key={s}
                          className={`w-4 h-4 ${s <= (typeof reviewedIds[session.photographer_id] === 'number' ? reviewedIds[session.photographer_id] : 5) ? 'text-yellow-400 fill-yellow-400' : isLight ? 'text-gray-300' : 'text-zinc-600'}`}
                        />
                      ))}
                    </div>
                    <span className={`text-sm font-medium ${isLight ? 'text-green-700' : 'text-green-400'}`}>Review submitted</span>
                  </div>
                ) : (
                  <Button
                    onClick={() => {
                      setReviewTarget({
                        id: session.photographer_id,
                        full_name: session.photographer_name || 'Photographer',
                        avatar_url: session.photographer_avatar,
                      });
                      setShowReviewModal(true);
                    }}
                    className="w-full bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600 text-black font-semibold rounded-xl h-12"
                  >
                    <Star className="w-4 h-4 mr-2" />
                    Leave a Review
                  </Button>
                )}
              </div>
            )}

            {/* --- Photographer Review Summary -------------------------- */}
            {isPhotographer && session.participants?.length > 0 && (
              <div className="px-5 mb-4">
                <div className={`flex items-center justify-between p-4 rounded-2xl ${isLight ? 'bg-gray-50 border border-gray-200' : 'bg-white/5 border border-white/10'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      session.has_pending_reviews
                        ? 'bg-gradient-to-br from-yellow-400 to-amber-500'
                        : 'bg-gradient-to-br from-green-400 to-emerald-500'
                    }`}>
                      <Award className="w-5 h-5 text-black" />
                    </div>
                    <div>
                      <p className={`font-semibold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                        {session.has_pending_reviews ? 'Reviews Pending' : 'All Reviewed'}
                      </p>
                      <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                        {session.reviews_given || Object.keys(reviewedIds).length} of {session.participants.length} surfers rated
                      </p>
                    </div>
                  </div>
                  {session.has_pending_reviews && (
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500" />
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Bottom safe area padding - clears mobile BottomNav */}
            <div className="h-24" />
          </div>
        </div>
      </div>

      {/* Review Modal */}
      {showReviewModal && reviewTarget && (
        <ReviewModal
          isOpen={showReviewModal}
          onClose={() => setShowReviewModal(false)}
          reviewerId={userId}
          sessionId={session.live_session_id || session.id}
          sessionType={sessionType === 'live_join' ? 'live' : sessionType}
          reviewee={reviewTarget}
          onReviewSubmitted={handleReviewSubmitted}
          theme={theme}
        />
      )}
    </>
  );
};

export default SessionDetailDrawer;
