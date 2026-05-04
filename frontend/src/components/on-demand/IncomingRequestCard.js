/**
 * IncomingRequestCard ? Displays an incoming on-demand session request.
 * Shows surfer info, location, earnings, crew details, and accept/decline actions.
 * 
 * Extracted from OnDemandSessionManager.js for maintainability.
 */
import React, { useState, useEffect } from 'react';
import {
  MapPin, Clock, DollarSign, Camera, Zap, User, Navigation,
  Check, X, Eye, Loader2, ChevronDown, ChevronUp, Users, MessageCircle
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { getFullUrl } from '../../utils/media';
const getImageUrl = (url) => {
  if (!url) return null;
  // If URL starts with /api, prepend the backend URL
  if (url.startsWith('/api')) {
    return `${process.env.REACT_APP_BACKEND_URL}${url}`;
  }
  return url;
};

const IncomingRequestCard = ({ 
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
                    {request.requester_stance === 'goofy' ? '?? Goofy' : '?? Regular'}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-xs ${textSecondary} mt-1`}>{requestAge}m ago</p>
          </div>
        </div>
        
        {/* Location — Uber-style navigation block */}
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
                <p className={`text-xs font-semibold ${textSecondary} uppercase tracking-wider`}>?? Surfer ID</p>
                {request.requester_stance && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className={textSecondary}>Stance:</span>
                    <span className={`font-medium ${textPrimary} capitalize`}>
                      {request.requester_stance === 'goofy' ? '?? Goofy Foot' : '?? Regular'}
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
                        {request.requester_username ? `@${request.requester_username} • ` : ''}Captain (Paid)
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
};

export default IncomingRequestCard;

