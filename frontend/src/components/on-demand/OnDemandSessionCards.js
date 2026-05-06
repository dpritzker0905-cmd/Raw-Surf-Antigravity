/**
 * OnDemandSessionCards.js
 * Extracted from OnDemandSessionManager.js - Self-contained card components
 * for the photographer's on-demand session management dashboard.
 * Includes: IncomingRequestCard, ActiveSessionCard, EarningsStatsCard
 */
import React, { useState, useEffect } from 'react';
import { MapPin, Clock, DollarSign, Camera, Zap, User, Navigation, Check, X, Flame, Loader2, Eye, Square, ChevronDown, ChevronUp, Wallet, Users, MessageCircle, Mic } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { getFullUrl } from '../../utils/media';
import { formatDuration } from '../../utils/formatTime';

// Helper to get full image URL
const getImageUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('/api')) {
    return `${process.env.REACT_APP_BACKEND_URL}${url}`;
  }
  return url;
};

// ============ INCOMING REQUEST CARD ============
const IncomingRequestCard = React.memo(({ 
  request, 
  onAccept, 
  onDecline, 
  isAccepting,
  cardBg, 
  textPrimary, 
  textSecondary,
  sectionBg,
  isHighlighted = false,
  defaultExpanded = false
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [showSelfieModal, setShowSelfieModal] = useState(false);
  const [selectedCrewSelfie, setSelectedCrewSelfie] = useState(null);  // For crew member selfie enlargement
  
  // Update expanded state if defaultExpanded changes
  useEffect(() => {
    if (defaultExpanded) {
      setIsExpanded(true);
    }
  }, [defaultExpanded]);
  
  const estimatedEarnings = (request.hourly_rate || 75) * (request.estimated_duration || 1);
  const requestAge = Math.floor((Date.now() - new Date(request.created_at).getTime()) / 60000); // minutes ago
  
  return (
    <>
    <Card 
      className={`relative overflow-hidden ${cardBg} shadow-lg border-2 ${
        isHighlighted 
          ? 'border-green-400 ring-2 ring-green-400/50 animate-pulse' 
          : 'border-amber-500/50'
      }`} 
      data-testid="incoming-request-card"
    >
      {/* New Request Badge */}
      <div className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${
        isHighlighted 
          ? 'from-green-400 via-cyan-500 to-green-400' 
          : 'from-amber-400 via-orange-500 to-amber-400'
      } animate-pulse`} />
      
      <CardContent className="p-4 pt-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {/* Clickable Selfie/Avatar */}
            <button aria-label="div" 
              onClick={() => request.requester_selfie && setShowSelfieModal(true)}
              className="relative group"
            >
              {request.requester_selfie ? (
                <div className="w-14 h-14 rounded-xl overflow-hidden ring-2 ring-amber-400 flex-shrink-0 cursor-pointer group-hover:ring-cyan-400 transition-all">
                  <img loading="lazy" decoding="async" src={getImageUrl(request.requester_selfie)} alt="Surfer" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                    <Eye className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              ) : request.requester_avatar ? (
                <div className="w-14 h-14 rounded-xl overflow-hidden ring-2 ring-amber-400/50 flex-shrink-0">
                  <img loading="lazy" decoding="async" src={getFullUrl(getImageUrl(request.requester_avatar))} alt="Surfer" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                  <Zap className="w-6 h-6 text-black" />
                </div>
              )}
            </button>
            <div>
              <p className={`font-bold text-lg ${textPrimary}`}>
                {request.requester_name || 'New Request!'}
              </p>
              {request.requester_username && (
                <button
                  onClick={(e) => { e.stopPropagation(); window.open(`/profile/${request.requester_username}`, '_blank'); }}
                  className="text-sm text-cyan-400 hover:text-cyan-300 hover:underline transition-colors"
                >
                  @{request.requester_username}
                </button>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-sm ${textSecondary}`}>{request.distance_miles?.toFixed(1) || '?'} mi away</span>
                {request.requester_stance && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 uppercase tracking-wide">
                    {request.requester_stance === 'goofy' ? 'ðŸ¦¶ Goofy' : 'ðŸ¦¶ Regular'}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-xs ${textSecondary} mt-1`}>{requestAge}m ago</p>
          </div>
        </div>
        
        {/* Location - Uber-style navigation block */}
        <div className={`mb-4 rounded-xl overflow-hidden border ${
          'border-cyan-500/30'
        }`}>
          {/* Location header */}
          <div className={`flex items-center gap-3 p-3 ${sectionBg}`}>
            <div className="w-9 h-9 rounded-lg bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
              <MapPin className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-sm truncate ${textPrimary}`}>
                {request.location?.name || 'Nearby Location'}
              </p>
              {request.location?.lat && request.location?.lng && (
                <p className={`text-[10px] font-mono ${textSecondary}`}>
                  {Number(request.location.lat).toFixed(5)}, {Number(request.location.lng).toFixed(5)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {request.distance_miles && (
                <Badge className="bg-purple-500/20 text-purple-400 text-xs">
                  <Navigation className="w-3 h-3 mr-1" />
                  {request.distance_miles.toFixed(1)} mi
                </Badge>
              )}
              {request.requester_selfie && (
                <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">
                  <Camera className="w-3 h-3 mr-1" />
                  ID
                </Badge>
              )}
            </div>
          </div>
          {/* Navigate button */}
          {request.location?.lat && request.location?.lng && (
            <button aria-label="Navigation"
              onClick={(e) => {
                e.stopPropagation();
                const url = `https://www.google.com/maps/dir/?api=1&destination=${request.location.lat},${request.location.lng}`;
                window.open(url, '_blank');
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 hover:from-cyan-500/30 hover:to-blue-500/30 transition-all text-cyan-400 font-semibold text-sm border-t border-cyan-500/20"
              data-testid="navigate-to-surfer-btn"
            >
              <Navigation className="w-4 h-4" />
              Navigate to Surfer
            </button>
          )}
        </div>
        
        {/* Crew Info (for shared sessions) */}
        {request.is_shared && request.crew_count > 1 && (
          <div className={`flex items-center gap-3 mb-4 p-3 rounded-xl bg-purple-500/10 border border-purple-500/30`}>
            <Users className="w-5 h-5 text-purple-400 flex-shrink-0" />
            <div className="flex-1">
              <p className={`font-medium ${textPrimary}`}>Group Session ({request.crew_count} surfers)</p>
              <div className="flex items-center gap-1 mt-1">
                {/* Captain/Requester first */}
                <div className="relative w-7 h-7 rounded-full overflow-hidden ring-2 ring-cyan-400 first:ml-0">
                  {request.requester_selfie ? (
                    <img loading="lazy" decoding="async" src={getImageUrl(request.requester_selfie)} alt="" className="w-full h-full object-cover" />
                  ) : request.requester_avatar ? (
                    <img loading="lazy" decoding="async" src={getFullUrl(getImageUrl(request.requester_avatar))} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-cyan-500/30 flex items-center justify-center text-[8px] text-cyan-300">
                      {request.requester_name?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border border-zinc-900" />
                </div>
                {/* Crew Members */}
                {request.crew?.slice(0, 3).map((member, idx) => (
                  <div key={member.id || idx} className="relative w-7 h-7 rounded-full overflow-hidden ring-1 ring-purple-400/50 -ml-1">
                    {member.selfie_url ? (
                      <img loading="lazy" decoding="async" src={getImageUrl(member.selfie_url)} alt="" className="w-full h-full object-cover" />
                    ) : member.avatar_url ? (
                      <img loading="lazy" decoding="async" src={getFullUrl(getImageUrl(member.avatar_url))} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-purple-500/30 flex items-center justify-center text-[8px] text-purple-300">
                        {member.name?.[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                    {member.status === 'paid' && (
                      <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border border-zinc-900" />
                    )}
                  </div>
                ))}
                {request.crew_count > 4 && (
                  <span className="text-xs text-purple-400 ml-1">+{request.crew_count - 4}</span>
                )}
              </div>
            </div>
            <Badge className={`text-xs ${request.crew?.every(c => c.status === 'paid') ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
              {(request.crew?.filter(c => c.status === 'paid').length || 0) + 1}/{(request.crew?.length || 0) + 1} Paid
            </Badge>
          </div>
        )}
        
        {/* Arrival Window - When surfer expects you */}
        <div className={`flex items-center gap-3 mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-400/30`}>
          <Clock className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <div className="flex-1">
            <p className={`font-medium ${textPrimary}`}>
              Arrive within {request.arrival_window_minutes || 30} minutes
            </p>
            <p className={`text-xs ${textSecondary}`}>
              {request.requested_start_time 
                ? `By ${new Date(request.requested_start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
                : `Requested ${requestAge}m ago`
              }
            </p>
          </div>
          <Badge className={`text-xs ${
            (request.arrival_window_minutes || 30) >= 60 
              ? 'bg-green-500/20 text-green-400' 
              : 'bg-amber-500/20 text-amber-400'
          }`}>
            {request.arrival_window_minutes === 30 ? 'Quick' : 
             request.arrival_window_minutes === 60 ? 'Standard' : 'Relaxed'}
          </Badge>
        </div>
        
        {/* Quick Stats Row */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className={`text-center p-3 rounded-xl ${sectionBg}`}>
            <p className="text-green-400 font-bold text-lg">${estimatedEarnings.toFixed(0)}</p>
            <p className={`text-xs ${textSecondary}`}>Est. Earn</p>
          </div>
          <div className={`text-center p-3 rounded-xl ${sectionBg}`}>
            <p className="text-cyan-400 font-bold text-lg">{((request.estimated_duration || 1) * 60).toFixed(0)}m</p>
            <p className={`text-xs ${textSecondary}`}>Duration</p>
          </div>
          <div className={`text-center p-3 rounded-xl ${sectionBg}`}>
            <p className="text-purple-400 font-bold text-lg">${request.hourly_rate || 75}</p>
            <p className={`text-xs ${textSecondary}`}>/hr Rate</p>
          </div>
        </div>
        
        {/* Expandable details */}
        {isExpanded && (
          <div className={`mb-4 p-4 rounded-xl ${sectionBg} space-y-3`}>
            <div className="flex justify-between text-sm">
              <span className={textSecondary}>Payment Secured</span>
              <span className="text-green-400 font-medium">${request.deposit_amount?.toFixed(2) || '0.00'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className={textSecondary}>Request Time</span>
              <span className={textPrimary}>{new Date(request.created_at).toLocaleTimeString()}</span>
            </div>
            {/* Surfer Identification Section */}
            {(request.requester_stance || request.requester_board_description) && (
              <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-400/20 space-y-2">
                <p className={`text-xs font-semibold ${textSecondary} uppercase tracking-wider`}>ðŸ” Surfer ID</p>
                {request.requester_stance && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className={textSecondary}>Stance:</span>
                    <span className={`font-medium ${textPrimary} capitalize`}>
                      {request.requester_stance === 'goofy' ? 'ðŸ¦¶ Goofy Foot' : 'ðŸ¦¶ Regular'}
                    </span>
                  </div>
                )}
                {request.requester_board_description && (
                  <div className="flex items-start gap-2 text-sm">
                    <span className={`${textSecondary} flex-shrink-0`}>Board:</span>
                    <span className={`font-medium ${textPrimary}`}>{request.requester_board_description}</span>
                  </div>
                )}
              </div>
            )}
            {request.requester_selfie && (
              <div className="mt-3">
                <p className={`text-xs ${textSecondary} mb-2`}>Surfer Photo (for identification):</p>
                <img loading="lazy" decoding="async" 
                  src={getImageUrl(request.requester_selfie)} 
                  alt="Surfer" 
                  className="w-24 h-24 rounded-xl object-cover border-2 border-cyan-400/30"
                />
              </div>
            )}
          </div>
        )}
        
        <button aria-label="Collapse" 
          onClick={() => setIsExpanded(!isExpanded)}
          className={`w-full text-center text-sm ${textSecondary} mb-4 flex items-center justify-center gap-1 hover:text-cyan-400 transition-colors`}
        >
          {isExpanded ? 'Less details' : 'More details'}
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        
        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button
            onClick={() => onDecline(request.dispatch_id)}
            variant="outline"
            className="flex-1 py-5 border-zinc-600 hover:bg-zinc-800"
            disabled={isAccepting}
            data-testid="decline-request-btn"
          >
            <X className="w-5 h-5 mr-2" />
            Decline
          </Button>
          <Button aria-label="Loader2"
            onClick={() => onAccept(request.dispatch_id)}
            className="flex-1 py-5 bg-gradient-to-r from-green-400 to-cyan-400 hover:from-green-500 hover:to-cyan-500 text-black font-bold"
            disabled={isAccepting}
            data-testid="accept-request-btn"
          >
            {isAccepting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Check className="w-5 h-5 mr-2" />
                Accept
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
    
    {/* Selfie Modal with Profile Info */}
    {showSelfieModal && (
      <div 
        className="fixed inset-0 z-50 bg-black/80 flex items-start justify-center p-4 overflow-y-auto"
        onClick={() => setShowSelfieModal(false)}
      >
        <div 
          className="bg-zinc-900 rounded-2xl w-full max-w-md my-8 overflow-hidden shadow-2xl border border-zinc-700"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close Button */}
          <button 
            onClick={() => setShowSelfieModal(false)}
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          
          {/* Large Selfie */}
          <div className="relative aspect-square">
            <img loading="lazy" decoding="async" 
              src={getImageUrl(request.requester_selfie)} 
              alt="Surfer Identification" 
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
              <Badge className="bg-cyan-500/80 text-white mb-2">
                <Camera className="w-3 h-3 mr-1" />
                ID Photo for Session
              </Badge>
            </div>
          </div>
          
          {/* Profile Info */}
          <div className="p-5 space-y-4">
            {/* Name & Basic Info */}
            <div className="flex items-center gap-4">
              {request.requester_avatar ? (
                <img loading="lazy" decoding="async" src={getFullUrl(getImageUrl(request.requester_avatar))} alt="" className="w-14 h-14 rounded-full object-cover ring-2 ring-cyan-400" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-cyan-500/20 flex items-center justify-center">
                  <User className="w-7 h-7 text-cyan-400" />
                </div>
              )}
              <div>
                <h3 className="text-xl font-bold text-white">{request.requester_name || 'Surfer'}</h3>
                <p className="text-sm text-gray-400">Requesting on-demand session</p>
              </div>
            </div>
            
            {/* Session Details */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-zinc-800">
                <div className="flex items-center gap-2 text-cyan-400 mb-1">
                  <MapPin className="w-4 h-4" />
                  <span className="text-xs">Location</span>
                </div>
                <p className="text-sm text-white font-medium truncate">{request.location?.name || 'Nearby'}</p>
              </div>
              <div className="p-3 rounded-xl bg-zinc-800">
                <div className="flex items-center gap-2 text-purple-400 mb-1">
                  <Navigation className="w-4 h-4" />
                  <span className="text-xs">Distance</span>
                </div>
                <p className="text-sm text-white font-medium">{request.distance_miles?.toFixed(1) || '?'} miles</p>
              </div>
              <div className="p-3 rounded-xl bg-zinc-800">
                <div className="flex items-center gap-2 text-amber-400 mb-1">
                  <Clock className="w-4 h-4" />
                  <span className="text-xs">Duration</span>
                </div>
                <p className="text-sm text-white font-medium">{((request.estimated_duration || 1) * 60).toFixed(0)} min</p>
              </div>
              <div className="p-3 rounded-xl bg-zinc-800">
                <div className="flex items-center gap-2 text-green-400 mb-1">
                  <DollarSign className="w-4 h-4" />
                  <span className="text-xs">Your Rate</span>
                </div>
                <p className="text-sm text-white font-medium">${request.hourly_rate || 75}/hr</p>
              </div>
            </div>
            
            {/* Crew Info if shared */}
            {request.is_shared && (
              <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/30">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-5 h-5 text-purple-400" />
                  <span className="font-medium text-white">Group Session ({request.crew_count} surfers)</span>
                </div>
                <div className="space-y-3">
                  {/* Requester/Captain */}
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-zinc-800/50 border border-cyan-500/30">
                    <div className="relative">
                      {request.requester_selfie ? (
                        <img loading="lazy" decoding="async" 
                          src={getImageUrl(request.requester_selfie)} 
                          alt="" 
                          className="w-12 h-12 rounded-full object-cover ring-2 ring-cyan-400 cursor-pointer hover:ring-cyan-300"
                          onClick={() => window.open(getImageUrl(request.requester_selfie), '_blank')}
                        />
                      ) : request.requester_avatar ? (
                        <img loading="lazy" decoding="async" src={getFullUrl(getImageUrl(request.requester_avatar))} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-cyan-400/50" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-cyan-500/30 flex items-center justify-center text-lg text-cyan-300 ring-2 ring-cyan-400/30">
                          {request.requester_name?.[0]?.toUpperCase() || '?'}
                        </div>
                      )}
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center">
                        <Camera className="w-3 h-3 text-white" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{request.requester_name}</p>
                      <p className="text-xs text-cyan-400">
                        {request.requester_username ? `@${request.requester_username} - ` : ''}Captain (Paid)
                      </p>
                    </div>
                    <Badge className="text-xs flex-shrink-0 bg-cyan-500/20 text-cyan-400">
                      Captain
                    </Badge>
                  </div>
                  
                  {/* Crew Members */}
                  {request.crew?.map((member, idx) => (
                    <div key={member.id || idx} className="flex items-center gap-3 p-2 rounded-lg bg-zinc-800/50">
                      <div className="relative">
                        {member.selfie_url ? (
                          <img loading="lazy" decoding="async" 
                            src={getImageUrl(member.selfie_url)} 
                            alt="" 
                            className="w-12 h-12 rounded-full object-cover ring-2 ring-purple-400/50 cursor-pointer hover:ring-purple-400"
                            onClick={() => setSelectedCrewSelfie(member)}
                          />
                        ) : member.avatar_url ? (
                          <img loading="lazy" decoding="async" src={getFullUrl(getImageUrl(member.avatar_url))} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-purple-400/30" />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-purple-500/30 flex items-center justify-center text-lg text-purple-300 ring-2 ring-purple-400/30">
                            {member.name?.[0]?.toUpperCase() || '?'}
                          </div>
                        )}
                        {member.selfie_url && (
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center">
                            <Camera className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium truncate">{member.name}</p>
                        {member.username && (
                          <p className="text-xs text-purple-400">@{member.username}</p>
                        )}
                      </div>
                      <Badge className={`text-xs flex-shrink-0 ${member.status === 'paid' ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
                        {member.status === 'paid' ? 'Paid' : 'Pending'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Quick Accept Button */}
            <Button aria-label="Loader2"
              onClick={() => {
                setShowSelfieModal(false);
                onAccept(request.dispatch_id);
              }}
              className="w-full py-5 bg-gradient-to-r from-green-400 to-cyan-400 hover:from-green-500 hover:to-cyan-500 text-black font-bold"
              disabled={isAccepting}
            >
              {isAccepting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Check className="w-5 h-5 mr-2" />
                  Accept This Session
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    )}
    
    {/* Crew Member Selfie Enlargement Modal */}
    {selectedCrewSelfie && (
      <div 
        className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        onClick={() => setSelectedCrewSelfie(null)}
      >
        <div 
          className="bg-zinc-900 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-purple-500/50"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close Button */}
          <button 
            onClick={() => setSelectedCrewSelfie(null)}
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          
          {/* Large Selfie */}
          <div className="relative aspect-square">
            <img loading="lazy" decoding="async" 
              src={getImageUrl(selectedCrewSelfie.selfie_url)} 
              alt="Crew Member Identification" 
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
              <Badge className="bg-purple-500/80 text-white mb-2">
                <Camera className="w-3 h-3 mr-1" />
                Crew Member ID Photo
              </Badge>
            </div>
          </div>
          
          {/* Profile Info */}
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-4">
              {selectedCrewSelfie.avatar_url ? (
                <img loading="lazy" decoding="async" src={getFullUrl(getImageUrl(selectedCrewSelfie.avatar_url))} alt="" className="w-14 h-14 rounded-full object-cover ring-2 ring-purple-400" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <User className="w-7 h-7 text-purple-400" />
                </div>
              )}
              <div>
                <h3 className="text-xl font-bold text-white">{selectedCrewSelfie.name || 'Crew Member'}</h3>
                {selectedCrewSelfie.username && (
                  <p className="text-purple-400">@{selectedCrewSelfie.username}</p>
                )}
              </div>
              <Badge className="bg-green-500/20 text-green-400 ml-auto">
                {selectedCrewSelfie.status === 'paid' ? 'Paid' : 'Pending'}
              </Badge>
            </div>
            
            <p className="text-sm text-gray-400">
              Part of the crew session. Look for this surfer in the water!
            </p>
            
            <Button
              onClick={() => setSelectedCrewSelfie(null)}
              variant="outline"
              className="w-full border-purple-500/50 text-purple-400 hover:bg-purple-500/10"
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  );
});

// ============ ACTIVE SESSION CARD ============
const ActiveSessionCard = React.memo(({ 
  session, 
  onMarkArrived, 
  onComplete, 
  onCancel,
  onOpenChat,
  _cardBg,
  textPrimary, 
  textSecondary,
  sectionBg,
  chatUnreadCount = 0,
  chatLatestMessage = null
}) => {
  const [elapsedTime, setElapsedTime] = useState(0);
  
  useEffect(() => {
    if (session.status !== 'arrived') return;
    
    const startTime = session.arrived_at ? new Date(session.arrived_at) : new Date();
    const updateTimer = () => {
      setElapsedTime(Math.floor((Date.now() - startTime.getTime()) / 1000));
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [session.status, session.arrived_at]);
  
  const formatTime = formatDuration;
  
  const isEnRoute = session.status === 'en_route';
  const isArrived = session.status === 'arrived';
  
  return (
    <Card className={`overflow-hidden ${isArrived 
      ? 'bg-gradient-to-r from-green-500/20 to-cyan-500/20 border-green-400/50' 
      : 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-amber-400/50'}`}
      data-testid="active-session-card"
    >
      {/* Status Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${isArrived ? 'bg-green-500/30' : 'bg-amber-500/30'}`}>
        <div className="flex items-center gap-2 text-white">
          {isArrived ? (
            <Camera className="w-5 h-5" />
          ) : (
            <Navigation className="w-5 h-5" />
          )}
          <span className="font-bold">{isArrived ? 'In Session' : 'En Route'}</span>
        </div>
        {isArrived && (
          <div className="text-white font-mono text-xl font-bold">
            {formatTime(elapsedTime)}
          </div>
        )}
        {isEnRoute && session.eta_minutes && (
          <div className="text-white font-bold">
            ETA: ~{session.eta_minutes} min
          </div>
        )}
      </div>
      
      <CardContent className="p-4 space-y-4">
        {/* Surfer Info */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl overflow-hidden bg-zinc-700 flex-shrink-0 ring-2 ring-cyan-400/30">
            {session.requester_selfie ? (
              <img loading="lazy" decoding="async" src={getImageUrl(session.requester_selfie)} alt="Surfer" className="w-full h-full object-cover" />
            ) : session.requester_avatar ? (
              <img loading="lazy" decoding="async" src={getFullUrl(getImageUrl(session.requester_avatar))} alt="Surfer" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User className="w-8 h-8 text-zinc-500" />
              </div>
            )}
          </div>
          <div className="flex-1">
            <p className={`font-bold text-lg ${textPrimary}`}>{session.requester_name || 'Surfer'}</p>
            {session.requester_username && (
              <button
                onClick={(e) => { e.stopPropagation(); window.open(`/profile/${session.requester_username}`, '_blank'); }}
                className="text-sm text-cyan-400 hover:text-cyan-300 hover:underline transition-colors"
              >
                @{session.requester_username}
              </button>
            )}
            <div className="flex items-center gap-2 mt-1">
              <MapPin className="w-4 h-4 text-cyan-400" />
              <span className={`text-sm ${textSecondary}`}>{session.location_name || 'Meeting Point'}</span>
            </div>
          </div>
        </div>
        
        {/* Session Details */}
        <div className={`grid grid-cols-2 gap-3 p-4 rounded-xl ${sectionBg}`}>
          <div>
            <p className={`text-xs ${textSecondary}`}>Duration</p>
            <p className={`font-bold ${textPrimary}`}>{(session.estimated_duration || 1) * 60} min</p>
          </div>
          <div>
            <p className={`text-xs ${textSecondary}`}>Earnings</p>
            <p className="font-bold text-green-400">${((session.hourly_rate || 75) * (session.estimated_duration || 1)).toFixed(0)}</p>
          </div>
        </div>

        {/* Surfer Identification Details */}
        {(session.requester_stance || session.requester_board_description) && (
          <div className={`p-3 rounded-xl bg-cyan-500/10 border border-cyan-400/20`}>
            <p className={`text-[10px] font-semibold ${textSecondary} uppercase tracking-wider mb-2`}>ðŸ” Surfer Identification</p>
            <div className="flex flex-wrap items-center gap-2">
              {session.requester_stance && (
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-purple-500/20 text-purple-400">
                  {session.requester_stance === 'goofy' ? 'ðŸ¦¶ Goofy Foot' : 'ðŸ¦¶ Regular'}
                </span>
              )}
              {session.requester_board_description && (
                <span className={`text-xs font-medium ${textPrimary}`}>{String.fromCodePoint(0x1F3C4)} {session.requester_board_description}</span>
              )}
            </div>
          </div>
        )}
        
        {/* Crew Selfies Section - Show all surfers the photographer needs to identify */}
        {session.is_shared && session.crew && session.crew.length > 0 && (
          <div className={`p-4 rounded-xl ${sectionBg}`}>
            <p className={`text-xs font-semibold ${textSecondary} uppercase tracking-wider mb-3`}>
              Crew Members ({session.crew.length + 1} total surfers)
            </p>
            <div className="grid grid-cols-2 gap-3">
              {/* Captain's selfie */}
              <div 
                className="flex items-center gap-3 p-2 rounded-lg bg-zinc-800/50 cursor-pointer hover:bg-zinc-700/50"
                onClick={() => session.requester_selfie && window.open(getImageUrl(session.requester_selfie), '_blank')}
              >
                <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-amber-400/50 flex-shrink-0">
                  {session.requester_selfie ? (
                    <img loading="lazy" decoding="async" src={getImageUrl(session.requester_selfie)} alt="" className="w-full h-full object-cover" />
                  ) : session.requester_avatar ? (
                    <img loading="lazy" decoding="async" src={getFullUrl(getImageUrl(session.requester_avatar))} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-amber-500/30 flex items-center justify-center">
                      <User className="w-6 h-6 text-amber-400" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">{session.requester_name}</p>
                  <p className="text-xs text-amber-400">Captain</p>
                </div>
              </div>
              
              {/* Crew member selfies */}
              {session.crew.filter(m => m.paid).map((member, idx) => (
                <div 
                  key={member.id || idx}
                  className="flex items-center gap-3 p-2 rounded-lg bg-zinc-800/50 cursor-pointer hover:bg-zinc-700/50"
                  onClick={() => member.selfie_url && window.open(getImageUrl(member.selfie_url), '_blank')}
                >
                  <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-purple-400/50 flex-shrink-0">
                    {member.selfie_url ? (
                      <img loading="lazy" decoding="async" src={getImageUrl(member.selfie_url)} alt="" className="w-full h-full object-cover" />
                    ) : member.avatar_url ? (
                      <img loading="lazy" decoding="async" src={getFullUrl(getImageUrl(member.avatar_url))} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-purple-500/30 flex items-center justify-center">
                        <User className="w-6 h-6 text-purple-400" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{member.name}</p>
                    <p className="text-xs text-purple-400">@{member.username}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Pro Tip */}
        {isEnRoute && session.requester_selfie && (
          <div className={`p-3 rounded-xl bg-cyan-500/10 border border-cyan-400/30`}>
            <p className="text-cyan-400 text-sm font-medium flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Surfer uploaded an ID photo - check above!
            </p>
          </div>
        )}
        
        {/* Inline Message Preview (shows latest surfer message) */}
        {chatLatestMessage && (
          <button
            onClick={onOpenChat}
            className={`w-full flex items-start gap-3 p-3 rounded-xl border transition-all active:scale-[0.99] ${
              chatUnreadCount > 0
                ? 'bg-cyan-500/10 border-cyan-400/40 ring-1 ring-cyan-400/30'
                : 'bg-zinc-800/50 border-zinc-700/50'
            }`}
            data-testid="inline-message-preview"
          >
            <div className="relative flex-shrink-0">
              <MessageCircle className={`w-5 h-5 mt-0.5 ${
                chatUnreadCount > 0 ? 'text-cyan-400' : 'text-zinc-500'
              }`} />
              {chatUnreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center animate-bounce">
                  {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="flex items-center justify-between gap-2">
                <p className={`text-xs font-semibold ${
                  chatUnreadCount > 0 ? 'text-cyan-400' : 'text-zinc-400'
                }`}>
                  {session.requester_name || 'Surfer'}
                </p>
                <span className="text-[10px] text-zinc-500 flex-shrink-0">
                  {new Date(chatLatestMessage.created_at).toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit'
                  })}
                </span>
              </div>
              <p className={`text-sm truncate ${
                chatUnreadCount > 0 ? 'text-white font-medium' : 'text-zinc-400'
              }`}>
                {chatLatestMessage.message_type === 'voice_note'
                  ? 'ðŸŽ™ï¸ Voice note'
                  : (chatLatestMessage.content || String.fromCodePoint(0x1F4F7) + ' Media')}
              </p>
            </div>
          </button>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          {/* Communication Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button aria-label="Message"
              onClick={onOpenChat}
              className="relative flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white"
              data-testid="photographer-chat-btn"
            >
              <MessageCircle className="w-4 h-4" />
              Chat Surfer
              {chatUnreadCount > 0 && (
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center animate-bounce shadow-lg">
                  {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
                </span>
              )}
            </button>
            <button aria-label="Microphone"
              onClick={onOpenChat}
              className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700"
              data-testid="photographer-voice-btn"
            >
              <Mic className="w-4 h-4" />
              Voice Note
            </button>
          </div>

          {isEnRoute && (
            <Button aria-label="Confirm"
              onClick={() => onMarkArrived(session.id)}
              className="w-full py-5 bg-gradient-to-r from-green-400 to-cyan-400 hover:from-green-500 hover:to-cyan-500 text-black font-bold"
              data-testid="mark-arrived-btn"
            >
              <Check className="w-5 h-5 mr-2" />
              I've Arrived - Start Session
            </Button>
          )}
          
          {isArrived && (
            <Button aria-label="Square"
              onClick={() => onComplete(session.id)}
              className="w-full py-5 bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-black font-bold"
              data-testid="complete-session-btn"
            >
              <Square className="w-5 h-5 mr-2" />
              Complete Session
            </Button>
          )}
          
          <Button
            onClick={() => onCancel(session.id)}
            variant="outline"
            className="w-full border-zinc-600 hover:bg-zinc-800"
            data-testid="cancel-session-btn"
          >
            Cancel Session
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});

// ============ EARNINGS STATS CARD ============
const EarningsStatsCard = React.memo(({ stats, cardBg, textPrimary, textSecondary, borderClass }) => {
  const hasStreak = (stats.streak || 0) >= 3;
  
  return (
    <Card className={cardBg} data-testid="earnings-stats-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
            <Wallet className="w-5 h-5 text-green-400" />
            Today's Earnings
          </h3>
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            {stats.sessions_today || 0} sessions
          </Badge>
        </div>
        
        <div className="text-center py-6">
          <p className="text-5xl font-bold text-green-400">${(stats.earnings_today || 0).toFixed(2)}</p>
          <p className={`text-sm ${textSecondary} mt-2`}>Net earnings after fees</p>
        </div>
        
        <div className={`grid grid-cols-3 gap-3 pt-4 border-t ${borderClass}`}>
          <div className="text-center">
            <p className={`text-xl font-bold ${textPrimary}`}>{stats.sessions_week || 0}</p>
            <p className={`text-xs ${textSecondary}`}>This Week</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-amber-400">{stats.streak || 0}</p>
            <p className={`text-xs ${textSecondary}`}>Day Streak</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-purple-400">{stats.total_sessions || 0}</p>
            <p className={`text-xs ${textSecondary}`}>All Time</p>
          </div>
        </div>
        
        {/* Streak Bonus Indicator */}
        {hasStreak && (
          <div className={`mt-4 p-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-400/30`}>
            <div className="flex items-center gap-3">
              <Flame className="w-6 h-6 text-amber-400" />
              <div>
                <p className="text-amber-400 font-bold">Hot Streak Active!</p>
                <p className={`text-sm ${textSecondary}`}>2x XP on all sessions</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});


export { IncomingRequestCard, ActiveSessionCard, EarningsStatsCard, getImageUrl };

