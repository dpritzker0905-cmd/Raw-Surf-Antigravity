/**
 * LineupTab - The Lineup: Surf Session Lobby System
 * 
 * Like an online poker lobby - surfers wait for crew to join before session locks.
 * Lineup stays open until 96 hours before session, then auto-locks.
 * 
 * Features:
 * - View all open lineups (your own + ones you're invited to)
 * - Join/leave lineups
 * - Captain can manage their lineup (invite friends, adjust visibility, lock early)
 * - Countdown timer to lineup close (96hrs before session)
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { 
  Users, Clock, MapPin, Calendar, ChevronRight, 
  Loader2, UserPlus, Lock, Unlock, Eye, EyeOff,
  Crown, Timer, DollarSign, Waves, CheckCircle,
  AlertCircle, Globe, UserCheck
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { toast } from 'sonner';
import { LineupManagerDrawer } from '../LineupManagerDrawer';
import { useUserWebSocket } from '../../hooks/useLineupWebSocket';
import logger from '../../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Lineup status badges
const STATUS_CONFIG = {
  open: { label: 'Open', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: Unlock },
  filling: { label: 'Filling Up', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Users },
  ready: { label: 'Ready!', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30', icon: CheckCircle },
  locked: { label: 'Locked', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', icon: Lock },
  confirmed: { label: 'Confirmed', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: CheckCircle },
  closed: { label: 'Closed', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', icon: Lock }
};

// Calculate time remaining until lineup closes
const getTimeRemaining = (closesAt) => {
  if (!closesAt) return null;
  const now = new Date();
  const closes = new Date(closesAt);
  const diff = closes - now;
  
  if (diff <= 0) return { expired: true, text: 'Closed' };
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) return { expired: false, text: `${days}d ${hours}h left` };
  if (hours > 0) return { expired: false, text: `${hours}h ${minutes}m left` };
  return { expired: false, text: `${minutes}m left`, urgent: true };
};

// Single Lineup Card component
const LineupCard = ({ 
  lineup, 
  user, 
  isLight, 
  onJoin, 
  onLeave, 
  onManage,
  onRefresh,
  onToggleStatus // New prop for toggling open/closed
}) => {
  const [loading, setLoading] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(getTimeRemaining(lineup.lineup_closes_at));
  
  const isCaptain = lineup.creator_id === user?.id;
  const isInLineup = lineup.participants?.some(p => p.participant_id === user?.id);
  const currentCrew = (lineup.participants?.filter(p => ['confirmed', 'pending'].includes(p.status)).length || 0) + 1; // +1 for captain
  const maxCrew = lineup.lineup_max_crew || lineup.max_participants || 10;
  const minCrew = lineup.lineup_min_crew || 2;
  const progress = (currentCrew / maxCrew) * 100;
  const isReady = currentCrew >= minCrew;
  const isSessionOpen = lineup.lineup_status === 'open' || lineup.lineup_status === 'filling' || lineup.lineup_status === 'ready';
  
  const statusConfig = STATUS_CONFIG[lineup.lineup_status] || STATUS_CONFIG.closed;
  const StatusIcon = statusConfig.icon;
  
  // Update timer every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeRemaining(getTimeRemaining(lineup.lineup_closes_at));
    }, 60000);
    return () => clearInterval(interval);
  }, [lineup.lineup_closes_at]);

  const handleJoin = async () => {
    setLoading(true);
    try {
      await onJoin(lineup.id);
      toast.success('Joined the lineup! 🤙');
      onRefresh?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to join lineup');
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async () => {
    setLoading(true);
    try {
      await onLeave(lineup.id);
      toast.success('Left the lineup');
      onRefresh?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to leave lineup');
    } finally {
      setLoading(false);
    }
  };

  // Toggle session open/closed status
  const handleToggleStatus = async () => {
    if (toggleLoading || lineup.lineup_status === 'locked') return;
    
    setToggleLoading(true);
    try {
      const newStatus = isSessionOpen ? 'closed' : 'open';
      await onToggleStatus(lineup.id, newStatus);
      toast.success(
        newStatus === 'open' 
          ? 'Session opened for new surfers!' 
          : 'Session closed to new bookings'
      );
      onRefresh?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update session status');
    } finally {
      setToggleLoading(false);
    }
  };

  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';

  return (
    <Card className={`${cardBg} overflow-hidden transition-all hover:border-cyan-500/50`}>
      <CardContent className="p-4">
        {/* Header: Location + Status */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            {isCaptain && <Crown className="w-4 h-4 text-yellow-400" />}
            <div>
              <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                <MapPin className="w-4 h-4 text-cyan-400" />
                {lineup.location || 'TBD'}
              </h3>
              <p className={`text-sm ${textSecondary}`}>
                {lineup.photographer_name || 'Photographer TBD'}
              </p>
            </div>
          </div>
          <Badge className={statusConfig.color}>
            <StatusIcon className="w-3 h-3 mr-1" />
            {statusConfig.label}
          </Badge>
        </div>

        {/* Session Time */}
        <div className={`flex items-center gap-4 mb-3 text-sm ${textSecondary}`}>
          <div className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            {new Date(lineup.session_date).toLocaleDateString('en-US', { 
              weekday: 'short', month: 'short', day: 'numeric' 
            })}
          </div>
          {lineup.session_time && (
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {lineup.session_time}
            </div>
          )}
        </div>

        {/* Crew Progress */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className={`text-sm ${textSecondary}`}>
              <Users className="w-4 h-4 inline mr-1" />
              {currentCrew}/{maxCrew} crew
            </span>
            <span className={`text-xs ${isReady ? 'text-green-400' : 'text-yellow-400'}`}>
              {isReady ? 'Ready to lock!' : `Need ${minCrew - currentCrew} more`}
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Price per person */}
        <div className={`flex items-center justify-between mb-3 text-sm ${textSecondary}`}>
          <div className="flex items-center gap-1">
            <DollarSign className="w-4 h-4 text-green-400" />
            <span>${(lineup.total_price / currentCrew).toFixed(2)}/person</span>
          </div>
          {/* Visibility indicator */}
          <div className="flex items-center gap-1">
            {lineup.lineup_visibility === 'both' ? (
              <><Globe className="w-3 h-3" /> Open to all</>
            ) : lineup.lineup_visibility === 'area' ? (
              <><Eye className="w-3 h-3" /> Nearby surfers</>
            ) : (
              <><UserCheck className="w-3 h-3" /> Friends only</>
            )}
          </div>
        </div>

        {/* Countdown Timer */}
        {timeRemaining && !timeRemaining.expired && (
          <div className={`flex items-center gap-2 mb-3 p-2 rounded-lg ${
            timeRemaining.urgent 
              ? 'bg-red-500/10 border border-red-500/30' 
              : 'bg-cyan-500/10 border border-cyan-500/30'
          }`}>
            <Timer className={`w-4 h-4 ${timeRemaining.urgent ? 'text-red-400' : 'text-cyan-400'}`} />
            <span className={`text-sm ${timeRemaining.urgent ? 'text-red-400' : 'text-cyan-400'}`}>
              Lineup closes in {timeRemaining.text}
            </span>
          </div>
        )}

        {/* Captain's Message */}
        {lineup.lineup_message && (
          <p className={`text-sm ${textSecondary} italic mb-3 p-2 rounded-lg ${
            isLight ? 'bg-gray-100' : 'bg-zinc-900/50'
          }`}>
            "{lineup.lineup_message}"
          </p>
        )}

        {/* Captain Controls: Open/Closed Toggle (PROMINENT) */}
        {isCaptain && lineup.lineup_status !== 'locked' && (
          <div className={`mb-3 p-3 rounded-xl border ${
            isSessionOpen 
              ? isLight ? 'bg-green-50 border-green-200' : 'bg-green-500/10 border-green-500/30'
              : isLight ? 'bg-gray-100 border-gray-200' : 'bg-zinc-800 border-zinc-600'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isSessionOpen ? (
                  <Unlock className="w-5 h-5 text-green-400" />
                ) : (
                  <Lock className="w-5 h-5 text-gray-400" />
                )}
                <div>
                  <p className={`font-medium text-sm ${textPrimary}`}>
                    {isSessionOpen ? 'Open for Bookings' : 'Closed to New Surfers'}
                  </p>
                  <p className={`text-xs ${textSecondary}`}>
                    {isSessionOpen 
                      ? 'Surfers can discover & join this session' 
                      : 'Only existing crew can see this session'
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={handleToggleStatus}
                disabled={toggleLoading}
                className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  isSessionOpen 
                    ? 'bg-green-500 focus:ring-green-500' 
                    : isLight ? 'bg-gray-300 focus:ring-gray-400' : 'bg-zinc-600 focus:ring-zinc-500'
                }`}
                data-testid={`toggle-session-status-${lineup.id}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${
                    isSessionOpen ? 'translate-x-8' : 'translate-x-1'
                  }`}
                >
                  {toggleLoading && (
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  )}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Locked session notice */}
        {isCaptain && lineup.lineup_status === 'locked' && (
          <div className={`mb-3 p-3 rounded-xl border ${
            isLight ? 'bg-amber-50 border-amber-200' : 'bg-amber-500/10 border-amber-500/30'
          }`}>
            <div className="flex items-center gap-2 text-amber-500">
              <Lock className="w-5 h-5" />
              <div>
                <p className="font-medium text-sm">Session Locked</p>
                <p className={`text-xs ${textSecondary}`}>
                  Crew is finalized. No changes can be made.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          {isCaptain ? (
            <Button
              onClick={() => onManage(lineup)}
              className="flex-1 bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black"
              data-testid={`manage-lineup-${lineup.id}`}
            >
              Manage Lineup
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : isInLineup ? (
            <Button
              onClick={handleLeave}
              disabled={loading || lineup.lineup_status === 'locked'}
              variant="outline"
              className="flex-1 border-red-500/50 text-red-400 hover:bg-red-500/10"
              data-testid={`leave-lineup-${lineup.id}`}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Leave Lineup'}
            </Button>
          ) : (
            <Button
              onClick={handleJoin}
              disabled={loading || lineup.lineup_status === 'locked' || currentCrew >= maxCrew}
              className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white"
              data-testid={`join-lineup-${lineup.id}`}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Join Lineup
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

// Main LineupTab component
export const LineupTab = ({
  user,
  theme,
  onOpenDirectory,
  onRefresh
}) => {
  const [lineups, setLineups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLineup, setSelectedLineup] = useState(null);
  
  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';

  // Real-time WebSocket updates for user notifications
  const handleWebSocketNotification = useCallback((data) => {
    // Refresh lineups when we get a notification
    fetchLineups();
  }, []);
  
  useUserWebSocket(user?.id, handleWebSocketNotification);

  // Fetch lineups
  const fetchLineups = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      setLoading(true);
      const response = await axios.get(`${API}/bookings/lineups`, {
        params: { user_id: user.id }
      });
      setLineups(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch lineups:', error);
      toast.error('Failed to load lineups');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchLineups();
  }, [fetchLineups]);

  const handleJoinLineup = async (bookingId) => {
    await axios.post(`${API}/bookings/${bookingId}/lineup/join`, null, {
      params: { user_id: user.id }
    });
  };

  const handleLeaveLineup = async (bookingId) => {
    await axios.post(`${API}/bookings/${bookingId}/lineup/leave`, null, {
      params: { user_id: user.id }
    });
  };

  const handleManageLineup = (lineup) => {
    setSelectedLineup(lineup);
  };

  const handleCloseManager = () => {
    setSelectedLineup(null);
  };

  // Toggle session open/closed status
  const handleToggleStatus = async (bookingId, newStatus) => {
    await axios.post(`${API}/bookings/${bookingId}/lineup/status`, 
      { status: newStatus },
      { params: { user_id: user.id } }
    );
  };

  // Separate lineups into categories
  const myLineups = lineups.filter(l => l.creator_id === user?.id);
  const joinedLineups = lineups.filter(l => 
    l.creator_id !== user?.id && 
    l.participants?.some(p => p.participant_id === user?.id)
  );
  const openLineups = lineups.filter(l => 
    l.creator_id !== user?.id && 
    !l.participants?.some(p => p.participant_id === user?.id) &&
    l.lineup_status === 'open'
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Create New Lineup CTA */}
      <Card className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-cyan-500/20 flex items-center justify-center">
                <Waves className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <h3 className={`font-semibold ${textPrimaryClass}`}>Start a Lineup</h3>
                <p className={`text-sm ${textSecondaryClass}`}>
                  Book a session & invite your crew to join
                </p>
              </div>
            </div>
            <Button
              onClick={onOpenDirectory}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white"
              data-testid="start-lineup-btn"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              New Lineup
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* My Lineups (Captain) */}
      {myLineups.length > 0 && (
        <div>
          <h3 className={`text-sm font-medium ${textSecondaryClass} mb-3 flex items-center gap-2`}>
            <Crown className="w-4 h-4 text-yellow-400" />
            Your Lineups ({myLineups.length})
          </h3>
          <div className="space-y-3">
            {myLineups.map(lineup => (
              <LineupCard
                key={lineup.id}
                lineup={lineup}
                user={user}
                isLight={isLight}
                onJoin={handleJoinLineup}
                onLeave={handleLeaveLineup}
                onManage={handleManageLineup}
                onRefresh={fetchLineups}
                onToggleStatus={handleToggleStatus}
              />
            ))}
          </div>
        </div>
      )}

      {/* Lineups You've Joined */}
      {joinedLineups.length > 0 && (
        <div>
          <h3 className={`text-sm font-medium ${textSecondaryClass} mb-3 flex items-center gap-2`}>
            <UserCheck className="w-4 h-4 text-green-400" />
            Lineups You've Joined ({joinedLineups.length})
          </h3>
          <div className="space-y-3">
            {joinedLineups.map(lineup => (
              <LineupCard
                key={lineup.id}
                lineup={lineup}
                user={user}
                isLight={isLight}
                onJoin={handleJoinLineup}
                onLeave={handleLeaveLineup}
                onManage={handleManageLineup}
                onRefresh={fetchLineups}
                onToggleStatus={handleToggleStatus}
              />
            ))}
          </div>
        </div>
      )}

      {/* Open Lineups to Join */}
      {openLineups.length > 0 && (
        <div>
          <h3 className={`text-sm font-medium ${textSecondaryClass} mb-3 flex items-center gap-2`}>
            <Globe className="w-4 h-4 text-cyan-400" />
            Open Lineups Near You ({openLineups.length})
          </h3>
          <div className="space-y-3">
            {openLineups.map(lineup => (
              <LineupCard
                key={lineup.id}
                lineup={lineup}
                user={user}
                isLight={isLight}
                onJoin={handleJoinLineup}
                onLeave={handleLeaveLineup}
                onManage={handleManageLineup}
                onRefresh={fetchLineups}
                onToggleStatus={handleToggleStatus}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {lineups.length === 0 && (
        <Card className={cardBgClass}>
          <CardContent className="py-12 text-center">
            <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
              <Users className={`w-8 h-8 ${textSecondaryClass}`} />
            </div>
            <h3 className={`text-lg font-medium ${textPrimaryClass} mb-2`}>No Active Lineups</h3>
            <p className={`${textSecondaryClass} mb-6`}>
              Start a lineup to book a session with friends, or join an open one nearby!
            </p>
            <Button
              onClick={onOpenDirectory}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Start Your First Lineup
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Lineup Manager Drawer */}
      <LineupManagerDrawer
        isOpen={!!selectedLineup}
        onClose={handleCloseManager}
        lineup={selectedLineup}
        user={user}
        theme={theme}
        onRefresh={fetchLineups}
      />
    </div>
  );
};

export default LineupTab;
