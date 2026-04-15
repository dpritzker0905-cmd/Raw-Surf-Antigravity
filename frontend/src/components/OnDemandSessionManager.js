import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import axios from 'axios';
import { 
  Power, MapPin, Clock, DollarSign, Camera, Zap, Settings, 
  RefreshCw, ChevronRight, User, Navigation, Phone, Check, X,
  TrendingUp, Flame, Target, Bell, Volume2, VolumeX, Shield,
  AlertCircle, Loader2, Radio, Eye, Star, Award, Calendar,
  Play, Square, ChevronDown, ChevronUp, Wallet, History, Info, Waves, Users
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { NumericStepper } from './ui/numeric-stepper';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Helper to get full image URL
const getImageUrl = (url) => {
  if (!url) return null;
  // If URL starts with /api, prepend the backend URL
  if (url.startsWith('/api')) {
    return `${process.env.REACT_APP_BACKEND_URL}${url}`;
  }
  return url;
};

// ============ INCOMING REQUEST CARD ============
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
            <button 
              onClick={() => request.requester_selfie && setShowSelfieModal(true)}
              className="relative group"
            >
              {request.requester_selfie ? (
                <div className="w-14 h-14 rounded-xl overflow-hidden ring-2 ring-amber-400 flex-shrink-0 cursor-pointer group-hover:ring-cyan-400 transition-all">
                  <img src={getImageUrl(request.requester_selfie)} alt="Surfer" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                    <Eye className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              ) : request.requester_avatar ? (
                <div className="w-14 h-14 rounded-xl overflow-hidden ring-2 ring-amber-400/50 flex-shrink-0">
                  <img src={getImageUrl(request.requester_avatar)} alt="Surfer" className="w-full h-full object-cover" />
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
              <p className={`text-sm ${textSecondary}`}>{request.distance_miles?.toFixed(1) || '?'} mi away</p>
            </div>
          </div>
          <div className="text-right">
            <Badge className="bg-amber-500/20 text-amber-400 animate-pulse">
              <Radio className="w-3 h-3 mr-1" />
              LIVE
            </Badge>
            <p className={`text-xs ${textSecondary} mt-1`}>{requestAge}m ago</p>
          </div>
        </div>
        
        {/* Location */}
        <div className={`flex items-center gap-3 mb-4 p-3 rounded-xl ${sectionBg}`}>
          <MapPin className="w-5 h-5 text-cyan-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className={`font-medium truncate ${textPrimary}`}>{request.location?.name || 'Nearby Location'}</p>
            {request.requester_name && (
              <p className={`text-sm ${textSecondary}`}>Surfer: {request.requester_name}</p>
            )}
          </div>
          {request.requester_selfie && (
            <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">
              <Camera className="w-3 h-3 mr-1" />
              ID Photo
            </Badge>
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
                    <img src={getImageUrl(request.requester_selfie)} alt="" className="w-full h-full object-cover" />
                  ) : request.requester_avatar ? (
                    <img src={getImageUrl(request.requester_avatar)} alt="" className="w-full h-full object-cover" />
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
                      <img src={getImageUrl(member.selfie_url)} alt="" className="w-full h-full object-cover" />
                    ) : member.avatar_url ? (
                      <img src={getImageUrl(member.avatar_url)} alt="" className="w-full h-full object-cover" />
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
              <span className={textSecondary}>Deposit Paid</span>
              <span className="text-green-400 font-medium">${request.deposit_amount?.toFixed(2) || '0.00'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className={textSecondary}>Request Time</span>
              <span className={textPrimary}>{new Date(request.created_at).toLocaleTimeString()}</span>
            </div>
            {request.requester_selfie && (
              <div className="mt-3">
                <p className={`text-xs ${textSecondary} mb-2`}>Surfer Photo (for identification):</p>
                <img 
                  src={getImageUrl(request.requester_selfie)} 
                  alt="Surfer" 
                  className="w-24 h-24 rounded-xl object-cover border-2 border-cyan-400/30"
                />
              </div>
            )}
          </div>
        )}
        
        <button 
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
          <Button
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
            <img 
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
                <img src={getImageUrl(request.requester_avatar)} alt="" className="w-14 h-14 rounded-full object-cover ring-2 ring-cyan-400" />
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
                        <img 
                          src={getImageUrl(request.requester_selfie)} 
                          alt="" 
                          className="w-12 h-12 rounded-full object-cover ring-2 ring-cyan-400 cursor-pointer hover:ring-cyan-300"
                          onClick={() => window.open(getImageUrl(request.requester_selfie), '_blank')}
                        />
                      ) : request.requester_avatar ? (
                        <img src={getImageUrl(request.requester_avatar)} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-cyan-400/50" />
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
                          <img 
                            src={getImageUrl(member.selfie_url)} 
                            alt="" 
                            className="w-12 h-12 rounded-full object-cover ring-2 ring-purple-400/50 cursor-pointer hover:ring-purple-400"
                            onClick={() => setSelectedCrewSelfie(member)}
                          />
                        ) : member.avatar_url ? (
                          <img src={getImageUrl(member.avatar_url)} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-purple-400/30" />
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
            <Button
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
            <img 
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
                <img src={getImageUrl(selectedCrewSelfie.avatar_url)} alt="" className="w-14 h-14 rounded-full object-cover ring-2 ring-purple-400" />
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

// ============ ACTIVE SESSION CARD ============
const ActiveSessionCard = ({ 
  session, 
  onMarkArrived, 
  onComplete, 
  onCancel,
  cardBg,
  textPrimary, 
  textSecondary,
  sectionBg
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
  
  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  
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
              <img src={getImageUrl(session.requester_selfie)} alt="Surfer" className="w-full h-full object-cover" />
            ) : session.requester_avatar ? (
              <img src={getImageUrl(session.requester_avatar)} alt="Surfer" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User className="w-8 h-8 text-zinc-500" />
              </div>
            )}
          </div>
          <div className="flex-1">
            <p className={`font-bold text-lg ${textPrimary}`}>{session.requester_name || 'Surfer'}</p>
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
                    <img src={getImageUrl(session.requester_selfie)} alt="" className="w-full h-full object-cover" />
                  ) : session.requester_avatar ? (
                    <img src={getImageUrl(session.requester_avatar)} alt="" className="w-full h-full object-cover" />
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
                      <img src={getImageUrl(member.selfie_url)} alt="" className="w-full h-full object-cover" />
                    ) : member.avatar_url ? (
                      <img src={getImageUrl(member.avatar_url)} alt="" className="w-full h-full object-cover" />
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
        
        {/* Action Buttons */}
        <div className="space-y-3">
          {isEnRoute && (
            <Button
              onClick={() => onMarkArrived(session.id)}
              className="w-full py-5 bg-gradient-to-r from-green-400 to-cyan-400 hover:from-green-500 hover:to-cyan-500 text-black font-bold"
              data-testid="mark-arrived-btn"
            >
              <Check className="w-5 h-5 mr-2" />
              I've Arrived - Start Session
            </Button>
          )}
          
          {isArrived && (
            <Button
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
};

// ============ EARNINGS STATS CARD ============
const EarningsStatsCard = ({ stats, cardBg, textPrimary, textSecondary, sectionBg, borderClass }) => {
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
};

// ============ MAIN COMPONENT ============
export const OnDemandSessionManager = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  
  // Check for deep link to specific request
  const highlightDispatchId = location.state?.highlightDispatchId;
  const autoExpandRequest = location.state?.autoExpandRequest;
  
  // Status state
  const [isOnline, setIsOnline] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [selectedOnDemandSpot, setSelectedOnDemandSpot] = useState(null);
  const [isLiveShooting, setIsLiveShooting] = useState(false);
  
  // Session state
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [expandedRequestId, setExpandedRequestId] = useState(null);  // For auto-expanding specific request
  
  // Settings state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseRate, setBaseRate] = useState(75);
  const [peakPricingEnabled, setPeakPricingEnabled] = useState(false);
  const [peakMultiplier, setPeakMultiplier] = useState(1.5);
  const [onDemandPhotosIncluded, setOnDemandPhotosIncluded] = useState(3);
  const [onDemandFullGallery, setOnDemandFullGallery] = useState(false);
  
  // Coverage spots state
  const [nearbySpots, setNearbySpots] = useState([]);
  const [selectedSpots, setSelectedSpots] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [showSpotsList, setShowSpotsList] = useState(true);
  const [showPricingSection, setShowPricingSection] = useState(true);
  
  // Stats and history
  const [stats, setStats] = useState({});
  const [sessionHistory, setSessionHistory] = useState([]);
  
  // UI state
  const [activeTab, setActiveTab] = useState('dashboard');
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  const pollIntervalRef = useRef(null);
  const audioRef = useRef(null);
  const highlightedRequestRef = useRef(null);
  
  // Auto-expand and scroll to highlighted request when it loads
  useEffect(() => {
    if (highlightDispatchId && autoExpandRequest && incomingRequests.length > 0) {
      const targetRequest = incomingRequests.find(r => r.dispatch_id === highlightDispatchId);
      if (targetRequest) {
        setExpandedRequestId(highlightDispatchId);
        // Scroll to the request after a short delay
        setTimeout(() => {
          highlightedRequestRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    }
  }, [highlightDispatchId, autoExpandRequest, incomingRequests]);
  
  // ============ THEME CLASSES ============
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const cardBg = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-900 border-zinc-800';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-800';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  const sectionBg = isLight ? 'bg-gray-50' : isBeach ? 'bg-zinc-900' : 'bg-zinc-800/50';
  
  // Geographic Range Logic (Role-Based)
  const getGeographicRadius = () => {
    if (user?.role === 'Approved Pro') return { min: 30, max: 50, default: 40 };
    if (user?.role === 'Pro') return { min: 30, max: 50, default: 40 };
    return { min: 10, max: 20, default: 15 };
  };
  const geoRadius = getGeographicRadius();
  const isPro = ['Approved Pro', 'Pro'].includes(user?.role);
  
  // ============ FETCH FUNCTIONS ============
  useEffect(() => {
    if (!user?.id) return;
    
    fetchOnDemandStatus();
    fetchSettings();
    fetchStats();
    fetchSessionHistory();
    requestLocation();
  }, [user?.id]);
  
  // Polling for incoming requests when online
  useEffect(() => {
    if (!isOnline || !user?.id) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }
    
    fetchIncomingRequests();
    fetchActiveSession();
    
    pollIntervalRef.current = setInterval(() => {
      fetchIncomingRequests();
      fetchActiveSession();
    }, 5000);
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isOnline, user?.id]);
  
  // Play sound when new request arrives
  useEffect(() => {
    if (incomingRequests.length > 0 && soundEnabled) {
      playNotificationSound();
    }
  }, [incomingRequests.length]);
  
  const playNotificationSound = () => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio('/sounds/notification.mp3');
        audioRef.current.volume = 0.7;
      }
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } catch (e) {
      logger.debug('Could not play notification sound');
    }
  };
  
  const requestLocation = () => {
    setLocationLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          setUserLocation(location);
          fetchNearbySpots(location);
          setLocationLoading(false);
        },
        (error) => {
          logger.error('Geolocation error:', error);
          setLocationLoading(false);
          toast.error('Unable to get location. Please enable GPS.');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setLocationLoading(false);
      toast.error('Geolocation not supported by your browser');
    }
  };
  
  const fetchNearbySpots = async (location) => {
    try {
      const response = await axios.get(`${API}/surf-spots/nearby`, {
        params: {
          latitude: location.latitude,
          longitude: location.longitude,
          radius_miles: geoRadius.default
        }
      });
      setNearbySpots(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch nearby spots:', error);
      try {
        const fallbackResponse = await axios.get(`${API}/surf-spots?limit=30`);
        setNearbySpots(fallbackResponse.data || []);
      } catch (e) {
        logger.error('Fallback also failed:', e);
      }
    }
  };
  
  const fetchOnDemandStatus = async () => {
    try {
      const response = await axios.get(`${API}/photographer/${user.id}/on-demand-status`);
      setIsOnline(response.data.is_available || false);
      if (response.data.active_spot) {
        setSelectedOnDemandSpot(response.data.active_spot);
      }
      setIsLiveShooting(response.data.is_live_shooting || false);
    } catch (error) {
      logger.error('Failed to fetch on-demand status:', error);
    }
  };
  
  const fetchSettings = async () => {
    try {
      const response = await axios.get(`${API}/photographer/${user.id}/on-demand-settings`);
      if (response.data) {
        setBaseRate(response.data.base_rate || 75);
        setPeakPricingEnabled(response.data.peak_pricing_enabled || false);
        setPeakMultiplier(response.data.peak_multiplier || 1.5);
        setOnDemandPhotosIncluded(response.data.on_demand_photos_included || 3);
        setOnDemandFullGallery(response.data.on_demand_full_gallery || false);
        setSelectedSpots(response.data.claimed_spots || []);
      }
      setLoading(false);
    } catch (error) {
      logger.error('Failed to fetch settings:', error);
      setLoading(false);
    }
  };
  
  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API}/dispatch/photographer/${user.id}/stats`);
      setStats(response.data);
    } catch (error) {
      logger.error('Failed to fetch stats:', error);
      setStats({
        earnings_today: 0,
        sessions_today: 0,
        sessions_week: 0,
        streak: 0,
        total_sessions: 0
      });
    }
  };
  
  const fetchIncomingRequests = async () => {
    if (activeSession) return;
    
    try {
      const response = await axios.get(`${API}/dispatch/photographer/${user.id}/pending`);
      const pending = response.data.pending_dispatches || [];
      
      // The pending endpoint already returns all needed data including crew with selfies
      // No need to fetch additional details
      setIncomingRequests(pending);
    } catch (error) {
      logger.debug('No pending requests');
      setIncomingRequests([]);
    }
  };
  
  const fetchActiveSession = async () => {
    try {
      const response = await axios.get(`${API}/dispatch/user/${user.id}/active`);
      const active = response.data.active_dispatch;
      
      if (active && active.role === 'photographer') {
        // Use the selfie from active dispatch response (includes crew selfies too)
        const requesterSelfie = active.requester_selfie;
        
        // Also fetch full details for additional info
        const detailResponse = await axios.get(`${API}/dispatch/${active.id}`);
        
        setActiveSession({
          id: active.id,
          status: detailResponse.data.status,
          requester_name: active.requester_name || detailResponse.data.requester?.name,
          requester_avatar: detailResponse.data.requester?.avatar,
          requester_selfie: requesterSelfie || detailResponse.data.selfie_url,  // Prefer active dispatch selfie
          location_name: active.location_name || detailResponse.data.location?.name,
          estimated_duration: detailResponse.data.pricing?.estimated_duration,
          hourly_rate: detailResponse.data.pricing?.hourly_rate,
          eta_minutes: active.eta_minutes || detailResponse.data.gps?.eta_minutes,
          arrived_at: detailResponse.data.timestamps?.arrived,
          is_shared: active.is_shared,
          crew: active.crew  // Include crew with their selfies
        });
      } else {
        setActiveSession(null);
      }
    } catch (error) {
      setActiveSession(null);
    }
  };
  
  const fetchSessionHistory = async () => {
    try {
      const response = await axios.get(`${API}/dispatch/photographer/${user.id}/history?limit=20`);
      setSessionHistory(response.data.history || []);
    } catch (error) {
      logger.error('Failed to fetch history:', error);
      setSessionHistory([]);
    }
  };
  
  // ============ HANDLERS ============
  const handleToggleOnline = async () => {
    setIsTogglingStatus(true);
    try {
      // Check if live shooting is active
      if (isLiveShooting && !isOnline) {
        toast.error('Cannot go on-demand while Live Shooting is active. Please end your live session first.');
        setIsTogglingStatus(false);
        return;
      }
      
      // Get location
      let lat = userLocation?.latitude;
      let lng = userLocation?.longitude;
      
      if (!lat || !lng) {
        try {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
          });
          lat = position.coords.latitude;
          lng = position.coords.longitude;
        } catch {
          toast.error('Location required. Please enable location services.');
          setIsTogglingStatus(false);
          return;
        }
      }
      
      // Find the first selected spot to use
      const spotToUse = nearbySpots.find(s => selectedSpots.includes(s.id));
      
      const response = await axios.post(
        `${API}/photographer/${user.id}/on-demand-toggle`,
        { 
          is_available: !isOnline,
          latitude: spotToUse?.latitude || lat, 
          longitude: spotToUse?.longitude || lng,
          spot_id: spotToUse?.id,
          spot_name: spotToUse?.name
        }
      );
      
      const newStatus = response.data.is_available;
      setIsOnline(newStatus);
      
      if (newStatus) {
        setSelectedOnDemandSpot(spotToUse);
        toast.success(`On-Demand activated${spotToUse ? ` at ${spotToUse.name}` : ''}!`);
      } else {
        setSelectedOnDemandSpot(null);
        toast.info("You're now offline");
        setIncomingRequests([]);
      }
    } catch (error) {
      const detail = error.response?.data?.detail;
      if (detail?.includes('live')) {
        toast.error('Cannot go on-demand while Live Shooting is active. Please end your live session first.');
      } else {
        toast.error(detail || 'Failed to update status');
      }
    } finally {
      setIsTogglingStatus(false);
    }
  };
  
  const handleAcceptRequest = async (dispatchId) => {
    setIsAccepting(true);
    try {
      await axios.post(`${API}/dispatch/${dispatchId}/accept`, {
        photographer_id: user.id
      });
      
      toast.success('Request accepted! Head to the location.');
      setIncomingRequests([]);
      fetchActiveSession();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to accept request');
    } finally {
      setIsAccepting(false);
    }
  };
  
  const handleDeclineRequest = useCallback(async (dispatchId, isTimeout = false) => {
    try {
      // Call backend to decline
      await axios.post(`${API}/dispatch/${dispatchId}/decline?photographer_id=${user.id}`);
      
      // Remove from local state
      setIncomingRequests(prev => prev.filter(r => r.dispatch_id !== dispatchId));
      
      if (!isTimeout) {
        toast.info('Request declined');
      }
    } catch (error) {
      logger.error('Failed to decline request:', error);
      toast.error(error.response?.data?.detail || 'Failed to decline request');
      // Still remove from local state even if API fails
      setIncomingRequests(prev => prev.filter(r => r.dispatch_id !== dispatchId));
    }
  }, [user?.id]);
  
  const handleMarkArrived = async (dispatchId) => {
    try {
      await axios.post(`${API}/dispatch/${dispatchId}/arrived?photographer_id=${user.id}`);
      toast.success('Session started! Have fun shooting!');
      fetchActiveSession();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to mark arrival');
    }
  };
  
  const handleCompleteSession = async (dispatchId) => {
    try {
      await axios.post(`${API}/dispatch/${dispatchId}/complete?photographer_id=${user.id}`);
      toast.success('Session completed! Gallery created.');
      setActiveSession(null);
      fetchStats();
      fetchSessionHistory();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to complete session');
    }
  };
  
  const handleCancelSession = async (dispatchId) => {
    if (!confirm('Are you sure you want to cancel this session?')) return;
    
    try {
      await axios.post(`${API}/dispatch/${dispatchId}/cancel?user_id=${user.id}`, {
        reason: 'Photographer cancelled'
      });
      toast.info('Session cancelled');
      setActiveSession(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to cancel session');
    }
  };
  
  const toggleSpotSelection = (spotId) => {
    setSelectedSpots(prev => 
      prev.includes(spotId) 
        ? prev.filter(id => id !== spotId)
        : [...prev, spotId]
    );
  };
  
  const selectAllSpots = () => {
    setSelectedSpots(nearbySpots.map(s => s.id));
  };
  
  const clearAllSpots = () => {
    setSelectedSpots([]);
  };
  
  const saveSettings = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/photographer/${user.id}/on-demand-settings`, {
        base_rate: baseRate,
        peak_pricing_enabled: peakPricingEnabled,
        peak_multiplier: peakMultiplier,
        claimed_spots: selectedSpots,
        latitude: userLocation?.latitude,
        longitude: userLocation?.longitude,
        on_demand_photos_included: onDemandPhotosIncluded,
        on_demand_full_gallery: onDemandFullGallery
      });
      
      toast.success('On-Demand settings saved!');
    } catch (error) {
      logger.error('Failed to save settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }
  
  return (
    <div className="p-4 max-w-6xl mx-auto pb-24" data-testid="on-demand-session-manager">
      {/* Header with Save Button (Settings tab only) */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${textPrimary} flex items-center gap-2`}>
            <Zap className="w-7 h-7 text-yellow-400" />
            On-Demand Hub
          </h1>
          <p className={`${textSecondary} text-sm mt-1`}>
            {selectedSpots.length} coverage spots • {geoRadius.min}-{geoRadius.max} mile range
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-xl ${sectionBg} hover:opacity-80 transition-opacity`}
            data-testid="sound-toggle-btn"
          >
            {soundEnabled ? (
              <Volume2 className="w-5 h-5 text-cyan-400" />
            ) : (
              <VolumeX className={`w-5 h-5 ${textSecondary}`} />
            )}
          </button>
          
          {activeTab === 'settings' && (
            <Button
              onClick={saveSettings}
              disabled={saving}
              className="bg-gradient-to-r from-green-400 to-cyan-400 text-black font-bold"
              data-testid="save-settings-btn"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          )}
        </div>
      </div>
      
      {/* On-Demand Status Toggle Card - Shown on Dashboard */}
      {activeTab === 'dashboard' && (
        <Card className={`mb-6 ${isOnline 
          ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-400/50' 
          : cardBg}`}
          data-testid="on-demand-status-card"
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  isOnline ? 'bg-yellow-500/30' : sectionBg
                }`}>
                  <Zap className={`w-6 h-6 ${isOnline ? 'text-yellow-400' : textSecondary}`} />
                </div>
                <div>
                  <p className={`font-bold ${textPrimary}`}>On-Demand Status</p>
                  <p className={`text-sm ${isOnline ? 'text-yellow-300' : textSecondary}`}>
                    {isOnline 
                      ? `Active at: ${selectedOnDemandSpot?.name || 'Your Area'}` 
                      : selectedSpots.length > 0 
                        ? 'Ready to activate' 
                        : 'Select coverage spots in Settings'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleToggleOnline}
                disabled={isTogglingStatus || (selectedSpots.length === 0 && !isOnline)}
                className={`w-14 h-8 rounded-full transition-colors relative ${
                  isOnline 
                    ? 'bg-yellow-500' 
                    : selectedSpots.length > 0 
                      ? isLight ? 'bg-gray-300 hover:bg-gray-400' : 'bg-zinc-600 hover:bg-zinc-500' 
                      : isLight ? 'bg-gray-200 opacity-50 cursor-not-allowed' : 'bg-zinc-700 opacity-50 cursor-not-allowed'
                }`}
                data-testid="on-demand-status-toggle"
              >
                {isTogglingStatus ? (
                  <Loader2 className="w-5 h-5 animate-spin absolute top-1.5 left-1/2 -translate-x-1/2 text-white" />
                ) : (
                  <span className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-transform shadow-md ${
                    isOnline ? 'right-1' : 'left-1'
                  }`} />
                )}
              </button>
            </div>
            
            {/* Active spot info */}
            {isOnline && selectedOnDemandSpot && (
              <div className="mt-3 pt-3 border-t border-yellow-500/30 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-green-400" />
                <span className="text-sm text-green-300">
                  Accepting requests at {selectedOnDemandSpot.name}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      
      {/* Tab Navigation */}
      <div className={`flex rounded-xl ${sectionBg} p-1 mb-6`}>
        {[
          { id: 'dashboard', label: 'Dashboard', icon: Radio },
          { id: 'settings', label: 'Settings', icon: Settings },
          { id: 'history', label: 'History', icon: History }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-all ${
              activeTab === tab.id 
                ? `${cardBg} ${textPrimary} shadow-sm` 
                : `${textSecondary} hover:text-white`
            }`}
            data-testid={`tab-${tab.id}`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>
      
      {/* Main Content */}
      <div className="space-y-6">
        {activeTab === 'dashboard' && (
          <>
            {/* Active Session (top priority) */}
            {activeSession && (
              <ActiveSessionCard
                session={activeSession}
                onMarkArrived={handleMarkArrived}
                onComplete={handleCompleteSession}
                onCancel={handleCancelSession}
                cardBg={cardBg}
                textPrimary={textPrimary}
                textSecondary={textSecondary}
                sectionBg={sectionBg}
              />
            )}
            
            {/* Incoming Requests */}
            {!activeSession && incomingRequests.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-amber-400 animate-bounce" />
                  <h2 className={`font-bold text-lg ${textPrimary}`}>Incoming Requests</h2>
                  <Badge className="bg-amber-500 text-black">{incomingRequests.length}</Badge>
                </div>
                
                {incomingRequests.map((request) => (
                  <div
                    key={request.dispatch_id}
                    ref={request.dispatch_id === highlightDispatchId ? highlightedRequestRef : null}
                  >
                    <IncomingRequestCard
                      request={request}
                      onAccept={handleAcceptRequest}
                      onDecline={handleDeclineRequest}
                      isAccepting={isAccepting}
                      cardBg={cardBg}
                      textPrimary={textPrimary}
                      textSecondary={textSecondary}
                      sectionBg={sectionBg}
                      isHighlighted={request.dispatch_id === highlightDispatchId}
                      defaultExpanded={request.dispatch_id === expandedRequestId}
                    />
                  </div>
                ))}
              </div>
            )}
            
            {/* Waiting State */}
            {isOnline && !activeSession && incomingRequests.length === 0 && (
              <Card className={`${cardBg} text-center`}>
                <CardContent className="py-12 px-6">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-xl bg-green-500/20 flex items-center justify-center">
                    <Radio className="w-10 h-10 text-green-400 animate-pulse" />
                  </div>
                  <h3 className={`text-xl font-bold ${textPrimary} mb-2`}>Waiting for Requests</h3>
                  <p className={textSecondary}>
                    You'll be notified when a surfer nearby requests a session
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2 text-sm text-green-400">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    Actively listening...
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* Offline State */}
            {!isOnline && !activeSession && (
              <Card className={cardBg}>
                <CardContent className="py-12 px-6 text-center">
                  <div className={`w-20 h-20 mx-auto mb-6 rounded-xl ${sectionBg} flex items-center justify-center`}>
                    <Power className={`w-10 h-10 ${textSecondary}`} />
                  </div>
                  <h3 className={`text-xl font-bold ${textPrimary} mb-2`}>You're Offline</h3>
                  <p className={textSecondary}>
                    {selectedSpots.length === 0 
                      ? 'Configure coverage spots in Settings tab first'
                      : 'Toggle the switch above to start receiving requests'}
                  </p>
                </CardContent>
              </Card>
            )}
            
            {/* Earnings Stats */}
            <EarningsStatsCard
              stats={stats}
              cardBg={cardBg}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
              sectionBg={sectionBg}
              borderClass={borderClass}
            />
          </>
        )}
        
        {activeTab === 'settings' && (
          <>
            {/* On-Demand Pricing Card */}
            <Card className={cardBg}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className={`text-lg ${textPrimary} flex items-center gap-2`}>
                    <DollarSign className="w-5 h-5 text-green-400" />
                    On-Demand Pricing
                  </CardTitle>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setShowPricingSection(!showPricingSection)}
                    className={borderClass}
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    {showPricingSection ? 'Hide' : 'Show'}
                  </Button>
                </div>
              </CardHeader>
              {showPricingSection && (
                <CardContent className="space-y-6">
                  {/* Preview Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className={`p-3 rounded-xl ${sectionBg}`}>
                      <p className={`text-xs ${textSecondary} mb-1`}>Base Rate</p>
                      <p className="text-xl font-bold text-green-400">${baseRate}/hr</p>
                    </div>
                    <div className={`p-3 rounded-xl ${sectionBg}`}>
                      <p className={`text-xs ${textSecondary} mb-1`}>Peak Rate</p>
                      <p className="text-xl font-bold text-amber-400">
                        {peakPricingEnabled ? `$${(baseRate * peakMultiplier).toFixed(0)}/hr` : 'OFF'}
                      </p>
                    </div>
                    <div className={`p-3 rounded-xl ${sectionBg}`}>
                      <p className={`text-xs ${textSecondary} mb-1`}>Photos Included</p>
                      <p className={`text-xl font-bold ${onDemandFullGallery ? 'text-green-400' : textPrimary}`}>
                        {onDemandFullGallery ? '∞ Full' : onDemandPhotosIncluded}
                      </p>
                    </div>
                    <div className={`p-3 rounded-xl ${sectionBg}`}>
                      <p className={`text-xs ${textSecondary} mb-1`}>Coverage</p>
                      <p className="text-xl font-bold text-cyan-400">{selectedSpots.length} spots</p>
                    </div>
                  </div>
                  
                  {/* Base Rate - NUMERIC STEPPER */}
                  <NumericStepper
                    label="On-Demand Base Rate"
                    value={baseRate}
                    onChange={setBaseRate}
                    min={25}
                    max={300}
                    step={5}
                    prefix="$"
                    suffix="/hr"
                    description="Premium rate for On-Demand requests (above standard bookings)"
                    theme={theme}
                  />
                  
                  {/* Peak/Swell Pricing Toggle */}
                  <div className={`p-4 rounded-xl ${isLight ? 'bg-amber-50 border-amber-200' : 'bg-amber-500/10 border-amber-500/30'} border`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <Waves className="w-5 h-5 text-amber-400" />
                        <div>
                          <p className={`font-medium ${textPrimary}`}>Peak/Swell Pricing</p>
                          <p className={`text-xs ${textSecondary}`}>Auto-increase rate during high demand</p>
                        </div>
                      </div>
                      <Switch
                        checked={peakPricingEnabled}
                        onCheckedChange={setPeakPricingEnabled}
                      />
                    </div>
                    
                    {peakPricingEnabled && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm ${textPrimary}`}>Peak Multiplier</span>
                          <span className="text-lg font-bold text-amber-400">{peakMultiplier}x</span>
                        </div>
                        <div className="flex gap-2">
                          {[1.25, 1.5, 1.75, 2.0].map(mult => (
                            <button
                              key={mult}
                              onClick={() => setPeakMultiplier(mult)}
                              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                                peakMultiplier === mult
                                  ? 'bg-amber-500 text-black'
                                  : isLight ? 'bg-gray-200 text-gray-700' : 'bg-zinc-700 text-gray-300'
                              }`}
                            >
                              {mult}x
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Photos Included */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <label className={`font-medium ${textPrimary}`}>Photos Included</label>
                        {onDemandFullGallery && (
                          <Badge className="bg-green-500 text-white text-xs">FULL GALLERY</Badge>
                        )}
                      </div>
                    </div>
                    
                    {/* Full Gallery Toggle */}
                    <div className={`p-3 rounded-xl mb-4 ${isLight ? 'bg-green-50 border-green-200' : 'bg-green-500/10 border-green-500/30'} border`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Zap className="w-5 h-5 text-green-400" />
                          <div>
                            <p className={`font-medium ${textPrimary}`}>Full Gallery Access</p>
                            <p className={`text-xs ${textSecondary}`}>All photos included - unlimited downloads</p>
                          </div>
                        </div>
                        <Switch
                          checked={onDemandFullGallery}
                          onCheckedChange={setOnDemandFullGallery}
                        />
                      </div>
                    </div>
                    
                    {!onDemandFullGallery && (
                      <NumericStepper
                        value={onDemandPhotosIncluded}
                        onChange={setOnDemandPhotosIncluded}
                        min={0}
                        max={999}
                        step={1}
                        description="Photos included free with on-demand buy-in. Additional charged per resolution."
                        theme={theme}
                      />
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
            
            {/* Coverage Spots Card */}
            <Card className={cardBg}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className={`text-lg ${textPrimary} flex items-center gap-2`}>
                    <MapPin className="w-5 h-5 text-cyan-400" />
                    Coverage Spots
                    <Badge className={isPro ? 'bg-purple-500 text-white' : 'bg-cyan-500 text-white'}>
                      {geoRadius.min}-{geoRadius.max} mi
                    </Badge>
                  </CardTitle>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setShowSpotsList(!showSpotsList)}
                    className={borderClass}
                  >
                    {showSpotsList ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </Button>
                </div>
              </CardHeader>
              
              {showSpotsList && (
                <CardContent>
                  {/* Location Status */}
                  <div className={`p-3 rounded-xl mb-4 ${sectionBg} flex items-center gap-3`}>
                    <div className={`w-8 h-8 rounded-lg ${userLocation ? 'bg-green-500/20' : 'bg-amber-500/20'} flex items-center justify-center`}>
                      <Navigation className={`w-4 h-4 ${userLocation ? 'text-green-400' : 'text-amber-400'}`} />
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${textPrimary}`}>
                        {userLocation ? 'GPS Active' : 'Location unavailable'}
                      </p>
                    </div>
                    {!userLocation && !locationLoading && (
                      <Button onClick={requestLocation} size="sm" variant="outline">
                        Enable
                      </Button>
                    )}
                    {locationLoading && (
                      <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                    )}
                  </div>
                  
                  {/* Quick Actions */}
                  <div className="flex gap-2 mb-4">
                    <Button variant="outline" size="sm" onClick={selectAllSpots} className={`flex-1 ${borderClass}`}>
                      Select All
                    </Button>
                    <Button variant="outline" size="sm" onClick={clearAllSpots} className={`flex-1 ${borderClass}`}>
                      Clear All
                    </Button>
                  </div>
                  
                  {/* Spots List */}
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                    {nearbySpots.length === 0 ? (
                      <p className={`text-center py-4 ${textSecondary}`}>
                        {locationLoading ? 'Finding nearby spots...' : 'No spots found nearby'}
                      </p>
                    ) : (
                      nearbySpots.map(spot => (
                        <button
                          key={spot.id}
                          onClick={() => toggleSpotSelection(spot.id)}
                          className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all border-2 ${
                            selectedSpots.includes(spot.id)
                              ? 'bg-cyan-500/20 border-cyan-500'
                              : isLight ? 'bg-white border-gray-200 hover:border-gray-300' : 'bg-zinc-800/50 border-zinc-700 hover:border-zinc-600'
                          }`}
                          data-testid={`spot-${spot.id}`}
                        >
                          {/* Checkbox Style Circle */}
                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                            selectedSpots.includes(spot.id) 
                              ? 'border-cyan-500 bg-cyan-500' 
                              : isLight ? 'border-gray-400' : 'border-zinc-500'
                          }`}>
                            {selectedSpots.includes(spot.id) && (
                              <Check className="w-4 h-4 text-white" />
                            )}
                          </div>
                          
                          <div className="flex-1 text-left">
                            <p className={`font-medium ${textPrimary}`}>{spot.name}</p>
                            <p className={`text-xs ${textSecondary}`}>
                              {spot.region || spot.city || 'Florida'}
                              {spot.distance_miles && ` • ${spot.distance_miles.toFixed(1)} mi`}
                            </p>
                          </div>
                          
                          {spot.active_photographers_count > 0 && (
                            <Badge className="bg-green-500/20 text-green-400 text-xs">
                              {spot.active_photographers_count} active
                            </Badge>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  
                  <p className={`text-xs ${textSecondary} mt-3 flex items-start gap-1`}>
                    <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    Surfers searching at these spots will see you in On-Demand results
                  </p>
                </CardContent>
              )}
            </Card>
          </>
        )}
        
        {activeTab === 'history' && (
          <Card className={cardBg} data-testid="history-panel">
            <CardContent className="p-4">
              <h3 className={`font-bold text-lg ${textPrimary} flex items-center gap-2 mb-6`}>
                <History className="w-5 h-5 text-purple-400" />
                Session History
              </h3>
              
              {sessionHistory.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className={`w-12 h-12 mx-auto mb-4 ${textSecondary}`} />
                  <p className={`font-medium ${textPrimary}`}>No sessions yet</p>
                  <p className={`text-sm ${textSecondary}`}>Your completed sessions will appear here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sessionHistory.map((session, idx) => (
                    <div 
                      key={session.id || idx}
                      className={`p-4 rounded-xl ${sectionBg} flex justify-between items-start`}
                    >
                      <div>
                        <p className={`font-medium ${textPrimary}`}>{session.location_name}</p>
                        <p className={`text-sm ${textSecondary}`}>
                          {session.date ? new Date(session.date).toLocaleDateString() : 'Unknown'}
                          {session.requester_name && ` • ${session.requester_name}`}
                        </p>
                        <p className={`text-xs ${textSecondary} mt-1`}>
                          {session.duration_hours ? `${session.duration_hours * 60} min` : ''} @ ${session.hourly_rate || 75}/hr
                        </p>
                      </div>
                      <p className="text-green-400 font-bold text-lg">${(session.earnings || 0).toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default OnDemandSessionManager;
