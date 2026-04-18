import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Users, Clock, DollarSign, MapPin, RefreshCw, Radio, X } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { DutyStationDrawer } from './DutyStationDrawer';
import logger from '../utils/logger';


export const PhotographerSessionDashboard = ({ onClose }) => {
  const { user } = useAuth();
  const { getEffectiveRole } = usePersona();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [activeDispatch, setActiveDispatch] = useState(null);  // On-demand dispatch session
  const [pendingRequests, setPendingRequests] = useState([]);  // Incoming on-demand requests
  const [loading, setLoading] = useState(true);
  const [isLiveIconActive, setIsLiveIconActive] = useState(false);
  const [isDutyStationOpen, setIsDutyStationOpen] = useState(false);
  
  // Get effective role
  const effectiveRole = getEffectiveRole(user?.role);
  const _isPhotographer = ['Hobbyist', 'Photographer', 'Approved Pro'].includes(effectiveRole);

  const fetchSession = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      // Check for live broadcast session
      const response = await apiClient.get(`/sessions/active/${user.id}`);
      setSession(response.data);
    } catch (error) {
      if (error.response?.status === 400) {
        setSession(null);
      } else {
        logger.error('Failed to fetch session:', error);
      }
    }
    
    // Check for active on-demand dispatch session (photographer role)
    try {
      const dispatchRes = await apiClient.get(`/dispatch/user/${user.id}/active`);
      if (dispatchRes.data.active_dispatch && dispatchRes.data.active_dispatch.role === 'photographer') {
        setActiveDispatch(dispatchRes.data.active_dispatch);
      } else {
        setActiveDispatch(null);
      }
    } catch (error) {
      setActiveDispatch(null);
    }
    
    // Check for PENDING on-demand requests (incoming bookings)
    try {
      const pendingRes = await apiClient.get(`/dispatch/photographer/${user.id}/pending`);
      setPendingRequests(pendingRes.data.pending_dispatches || []);
    } catch (error) {
      setPendingRequests([]);
    }
    
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    fetchSession();
    // Refresh every 10 seconds
    const interval = setInterval(fetchSession, 10000);
    return () => clearInterval(interval);
  }, [fetchSession]);

  const handleStopSession = async () => {
    try {
      await apiClient.post(`/photographers/${user.id}/stop-live`, {});
      toast.success('Session ended');
      setSession(null);
      onClose?.();
    } catch (error) {
      toast.error('Failed to stop session');
    }
  };

  const formatTime = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getSessionDuration = () => {
    if (!session?.participants?.[0]?.joined_at) return '';
    // Use first participant's join time as approximation
    const start = new Date(session.participants[0].joined_at);
    const now = new Date();
    const diffMs = now - start;
    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
      </div>
    );
  }

  // PRIORITY 1: Show PENDING incoming requests (surfers wanting to book)
  if (pendingRequests.length > 0 && !session && !activeDispatch) {
    const firstRequest = pendingRequests[0];
    const totalRequests = pendingRequests.length;
    
    return (
      <>
        <div 
          className="p-4 cursor-pointer"
          data-testid="pending-requests-card"
          onClick={() => navigate('/photographer/on-demand', { 
            state: { 
              highlightDispatchId: firstRequest.dispatch_id,
              autoExpandRequest: true 
            } 
          })}
        >
          {/* Incoming Request Badge with Count */}
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="relative">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-ping"></div>
              <div className="absolute inset-0 w-2 h-2 bg-green-400 rounded-full"></div>
            </div>
            <p className="text-xs font-semibold text-green-400 uppercase tracking-wider">
              {totalRequests === 1 ? 'New Request' : `${totalRequests} New Requests`}
            </p>
          </div>
          
          {/* Requester Avatar/Selfie */}
          <div className="relative w-20 h-20 mx-auto mb-3">
            {/* Pulsing ring */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-green-400 to-cyan-400 animate-ping opacity-30"></div>
            
            {/* Profile image or selfie */}
            {firstRequest.requester_selfie ? (
              <img 
                src={firstRequest.requester_selfie.startsWith('/') 
                  ? `${process.env.REACT_APP_BACKEND_URL}${firstRequest.requester_selfie}`
                  : firstRequest.requester_selfie
                }
                alt="Surfer"
                className="relative w-full h-full rounded-full object-cover border-4 border-green-400"
              />
            ) : firstRequest.requester_avatar ? (
              <img 
                src={firstRequest.requester_avatar}
                alt="Surfer"
                className="relative w-full h-full rounded-full object-cover border-4 border-green-400"
              />
            ) : (
              <div className="relative w-full h-full rounded-full bg-gradient-to-r from-green-500 to-cyan-500 flex items-center justify-center border-4 border-green-400">
                <Users className="w-10 h-10 text-white" />
              </div>
            )}
            
            {/* Crew indicator */}
            {firstRequest.is_shared && firstRequest.crew_count > 1 && (
              <div className="absolute -bottom-1 -right-1 bg-purple-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center border-2 border-zinc-900">
                +{firstRequest.crew_count - 1}
              </div>
            )}
          </div>
          
          {/* Requester Info */}
          <h3 className="text-lg font-bold text-white mb-1 text-center" style={{ fontFamily: 'Oswald' }}>
            {firstRequest.requester_name || 'Surfer'}
            {firstRequest.requester_username && (
              <span className="text-cyan-400 text-sm font-normal ml-2">@{firstRequest.requester_username}</span>
            )}
          </h3>
          
          {/* Session Details */}
          <div className="flex items-center justify-center gap-4 text-sm text-gray-400 mb-3">
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>{Math.round((firstRequest.estimated_duration || 1) * 60)} min</span>
            </div>
            <div className="flex items-center gap-1">
              <DollarSign className="w-4 h-4 text-green-400" />
              <span className="text-green-400 font-semibold">
                ${((firstRequest.hourly_rate || 75) * (firstRequest.estimated_duration || 1)).toFixed(0)}
              </span>
            </div>
          </div>
          
          {/* Location */}
          {firstRequest.location?.name && (
            <div className="flex items-center justify-center gap-2 text-gray-400 text-xs mb-3">
              <MapPin className="w-3 h-3" />
              <span>{firstRequest.location.name}</span>
              {firstRequest.distance_miles && (
                <span className="text-cyan-400">({firstRequest.distance_miles.toFixed(1)} mi)</span>
              )}
            </div>
          )}
          
          {/* CTA */}
          <div className="bg-gradient-to-r from-green-500 to-cyan-500 rounded-lg py-2 px-4 text-center">
            <p className="text-black font-bold text-sm">
              Tap to View & Accept →
            </p>
          </div>
          
          {/* More requests indicator */}
          {totalRequests > 1 && (
            <p className="text-xs text-center text-gray-500 mt-2">
              +{totalRequests - 1} more {totalRequests - 1 === 1 ? 'request' : 'requests'} waiting
            </p>
          )}
        </div>
        
        {/* Duty Station Drawer */}
        <DutyStationDrawer 
          isOpen={isDutyStationOpen} 
          onClose={() => setIsDutyStationOpen(false)} 
        />
      </>
    );
  }

  // PRIORITY 2: Show On-Demand Session Card if active (already accepted)
  if (activeDispatch && !session) {
    const statusMessages = {
      'searching_for_pro': 'Finding surfers nearby...',
      'accepted': 'Session confirmed!',
      'en_route': 'Heading to location',
      'arrived': 'At the spot - shooting!'
    };
    
    return (
      <>
        <div 
          className="p-4 cursor-pointer"
          data-testid="on-demand-session-card"
          onClick={() => navigate('/bookings?tab=on_demand')}
        >
          {/* Active On-Demand Badge */}
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></div>
            <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
              On-Demand Active
            </p>
          </div>
          
          {/* Session Icon with Pulsing Ring */}
          <div className="relative w-16 h-16 mx-auto mb-3">
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 animate-ping opacity-30"></div>
            <div className="relative w-full h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 flex items-center justify-center">
              <Radio className="w-8 h-8 text-black" />
            </div>
          </div>
          
          {/* Session Info */}
          <h3 className="text-lg font-bold text-white mb-1 text-center" style={{ fontFamily: 'Oswald' }}>
            {activeDispatch.status === 'arrived' ? 'Now Shooting' : 'On-Demand Session'}
          </h3>
          
          <p className="text-amber-400 text-sm text-center mb-3">
            {statusMessages[activeDispatch.status] || 'Session in progress'}
          </p>
          
          {/* Surfer Info */}
          {activeDispatch.requester_name && (
            <div className="flex items-center justify-center gap-2 bg-zinc-800/50 rounded-lg p-2 mb-2">
              <Users className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-gray-300">
                with <span className="text-white font-medium">{activeDispatch.requester_name}</span>
                {activeDispatch.is_shared && activeDispatch.crew?.length > 0 && (
                  <span className="text-gray-400"> +{activeDispatch.crew.length} crew</span>
                )}
              </span>
            </div>
          )}
          
          {/* Location */}
          {activeDispatch.location_name && (
            <div className="flex items-center justify-center gap-2 text-gray-400 text-xs">
              <MapPin className="w-3 h-3" />
              <span>{activeDispatch.location_name}</span>
            </div>
          )}
          
          {/* View Details Link */}
          <p className="text-xs text-center text-cyan-400 mt-3 hover:text-cyan-300">
            Tap to view session details →
          </p>
        </div>
        
        {/* Duty Station Drawer - still accessible */}
        <DutyStationDrawer 
          isOpen={isDutyStationOpen} 
          onClose={() => setIsDutyStationOpen(false)} 
        />
      </>
    );
  }

  if (!session) {
    // No Active Session - Show "Start Shooting" trigger that opens Duty Station
    return (
      <>
        <div 
          className="p-6 text-center cursor-pointer"
          data-testid="start-shooting-trigger"
          onClick={() => setIsDutyStationOpen(true)}
        >
          {/* Breathing "Start Shooting" text */}
          <p 
            className="text-xs font-medium mb-2 animate-pulse"
            style={{ 
              color: '#00D26A', // Brand logo green
              animationDuration: '2s'
            }}
          >
            Start Shooting
          </p>
          
          {/* Live Icon Container - Only this turns blue on interaction */}
          <div 
            className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center transition-all duration-300 ${
              isLiveIconActive
                ? 'bg-blue-600'
                : 'bg-zinc-800 hover:bg-zinc-700'
            }`}
            onMouseDown={() => setIsLiveIconActive(true)}
            onMouseUp={() => setIsLiveIconActive(false)}
            onMouseLeave={() => setIsLiveIconActive(false)}
            onTouchStart={() => setIsLiveIconActive(true)}
            onTouchEnd={() => setIsLiveIconActive(false)}
          >
            <Radio 
              className={`w-8 h-8 transition-colors duration-300 ${
                isLiveIconActive ? 'text-white' : 'text-gray-500'
              }`} 
            />
          </div>
          
          <h3 className="text-lg font-bold text-white mb-2" style={{ fontFamily: 'Oswald' }}>
            No Active Session
          </h3>
          <p className="text-gray-400 text-sm">
            Click to open Duty Station
          </p>
        </div>
        
        {/* Duty Station Drawer */}
        <DutyStationDrawer 
          isOpen={isDutyStationOpen} 
          onClose={() => setIsDutyStationOpen(false)} 
        />
      </>
    );
  }

  const totalEarnings = session.participants.reduce((sum, p) => sum + p.amount_paid, 0);

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-700 overflow-hidden">
      {/* Header */}
      <div className="p-4 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border-b border-zinc-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-white font-bold" style={{ fontFamily: 'Oswald' }}>Live Session</span>
          </div>
          <Button
            onClick={handleStopSession}
            variant="ghost"
            size="sm"
            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            <X className="w-4 h-4 mr-1" />
            End Session
          </Button>
        </div>
        <div className="flex items-center gap-2 mt-2 text-gray-300 text-sm">
          <MapPin className="w-4 h-4" />
          {session.spot_name}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 divide-x divide-zinc-700 border-b border-zinc-700">
        <div className="p-4 text-center">
          <div className="text-2xl font-bold text-white">{session.participants_count}</div>
          <div className="text-xs text-gray-400 flex items-center justify-center gap-1">
            <Users className="w-3 h-3" />
            Surfers
          </div>
        </div>
        <div className="p-4 text-center">
          <div className="text-2xl font-bold text-emerald-400">${totalEarnings.toFixed(0)}</div>
          <div className="text-xs text-gray-400 flex items-center justify-center gap-1">
            <DollarSign className="w-3 h-3" />
            Earned
          </div>
        </div>
        <div className="p-4 text-center">
          <div className="text-2xl font-bold text-white">{getSessionDuration() || '-'}</div>
          <div className="text-xs text-gray-400 flex items-center justify-center gap-1">
            <Clock className="w-3 h-3" />
            Duration
          </div>
        </div>
      </div>

      {/* Participants List */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-gray-400">Participants</h4>
          <button
            onClick={fetchSession}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {session.participants.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm">No surfers have joined yet</p>
            <p className="text-gray-600 text-xs mt-1">They'll appear here when they join</p>
          </div>
        ) : (
          <div className="space-y-3">
            {session.participants.map((participant) => (
              <div
                key={participant.id}
                className="flex items-center gap-3 p-3 bg-zinc-800 rounded-lg"
              >
                {/* Selfie / Avatar */}
                <div className="w-12 h-12 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0">
                  {participant.selfie_url ? (
                    <img
                      src={participant.selfie_url}
                      alt={participant.surfer_name}
                      className="w-full h-full object-cover"
                    />
                  ) : participant.surfer_avatar ? (
                    <img
                      src={participant.surfer_avatar}
                      alt={participant.surfer_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      {participant.surfer_name?.charAt(0) || '?'}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white truncate">
                    {participant.surfer_name || 'Anonymous'}
                  </div>
                  <div className="text-xs text-gray-400">
                    Joined {formatTime(participant.joined_at)}
                  </div>
                </div>

                {/* Amount */}
                <div className="text-right">
                  <div className="text-emerald-400 font-bold">${participant.amount_paid.toFixed(2)}</div>
                  <div className="text-xs text-gray-500">{participant.payment_method}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tip */}
      <div className="p-4 bg-zinc-800/50 border-t border-zinc-800">
        <p className="text-xs text-gray-500 text-center">
          💡 Surfers take selfies when joining so you can identify them in the water
        </p>
      </div>
    </div>
  );
};
