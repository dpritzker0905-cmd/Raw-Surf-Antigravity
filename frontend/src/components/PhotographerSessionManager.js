/**
 * PhotographerSessionManager - Photographer's Command Center for Session Management
 * 
 * This is the photographer's counterpart to the surfer's LineupManagerDrawer.
 * Features:
 * - Visual crew display (matching the surfer's view)
 * - Open/Close session controls
 * - Invite surfers, remove participants
 * - Real-time WebSocket updates
 * - Session status management (Open, Closed, Locked)
 *
 * ParticipantCard extracted to ./sessions/ParticipantCard.js (v77)
 * SessionStatusControl extracted to ./sessions/SessionStatusControl.js (v77)
 */
import React, { useState, useEffect } from 'react';
import apiClient from '../lib/apiClient';
import { 
  Users, Camera, Lock, Unlock, UserPlus, Copy, Send, MapPin,
  Loader2, MessageCircle, Search, Settings
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Progress } from './ui/progress';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import ParticipantCard from './sessions/ParticipantCard';
import SessionStatusControl from './sessions/SessionStatusControl';


// Main Component
export var PhotographerSessionManager = ({
  isOpen,
  onClose,
  booking,
  user,
  theme = 'dark',
  onRefresh,
  onBookingUpdate
}) => {
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null); // Track specific action loading
  const [activeTab, setActiveTab] = useState('participants'); // 'participants' | 'invite' | 'settings'
  const [participants, setParticipants] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(null);
  
  // Local state for instant UI feedback (matching LineupManagerDrawer pattern)
  const [localSplitMode, setLocalSplitMode] = useState(booking?.split_mode || 'friends_only');
  const [localAutoConfirm, setLocalAutoConfirm] = useState(booking?.lineup_auto_confirm || false);
  const [localLineupStatus, setLocalLineupStatus] = useState(booking?.lineup_status || 'open');
  
  const isLight = theme === 'light';
  
  // Sync local state with booking prop changes
  useEffect(() => {
    if (booking) {
      setLocalSplitMode(booking.split_mode || 'friends_only');
      setLocalAutoConfirm(booking.lineup_auto_confirm || false);
      setLocalLineupStatus(booking.lineup_status || 'open');
    }
  }, [booking?.split_mode, booking?.lineup_auto_confirm, booking?.lineup_status]);
  
  // Fetch participants when drawer opens
  useEffect(() => {
    const fetchParticipants = async () => {
      if (!isOpen || !booking?.id) return;
      
      setLoading(true);
      try {
        const response = await apiClient.get(`/bookings/${booking.id}/participants`);
        setParticipants(response.data || []);
      } catch (error) {
        logger.error('Failed to load participants:', error);
        // Use booking's participant data as fallback
        if (booking.participants) {
          setParticipants(booking.participants);
        }
      } finally {
        setLoading(false);
      }
    };
    
    fetchParticipants();
  }, [isOpen, booking?.id]);
  
  // Search for surfers to invite
  useEffect(() => {
    if (!booking?.id || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await apiClient.get(
          `/bookings/${booking.id}/search-users?query=${encodeURIComponent(searchQuery)}`
        );
        setSearchResults(response.data || []);
      } catch (error) {
        logger.error('Search error:', error);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    
    return () => clearTimeout(timeout);
  }, [searchQuery, booking?.id, user?.id]);

  // Action Handlers
  const handleInviteSurfer = async (surfer) => {
    setInviting(surfer.user_id);
    try {
      await apiClient.post(
        `/bookings/${booking.id}/invite-by-handle`,
        { handle_query: surfer.username || surfer.email || surfer.full_name }
      );
      const displayName = surfer.username ? `@${surfer.username}` : surfer.full_name;
      toast.success(`Invite sent to ${displayName}!`);
      setSearchQuery('');
      setSearchResults([]);
      onRefresh?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send invite');
    } finally {
      setInviting(null);
    }
  };

  const handleRemoveParticipant = async (participantId, name) => {
    if (!confirm(`Remove ${name} from this session? They will be refunded and notified.`)) return;
    
    setActionLoading('remove');
    try {
      await apiClient.post(`/bookings/${booking.id}/lineup/remove-member`, {
        member_id: participantId
      });
      toast.success(`${name} removed from session`);
      setParticipants(prev => prev.filter(p => (p.participant_id || p.id) !== participantId));
      onRefresh?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to remove participant');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleOpen = async () => {
    // Check if currently in an "open" state (open, filling, ready)
    const isCurrentlyOpen = localLineupStatus && !['closed', 'locked'].includes(localLineupStatus);
    const newStatus = isCurrentlyOpen ? 'closed' : 'open';
    
    // Immediately update local state for instant UI feedback
    setLocalLineupStatus(newStatus);
    setActionLoading('toggle');
    try {
      await apiClient.post(`/bookings/${booking.id}/lineup/status`, {
        status: newStatus
      });
      toast.success(newStatus === 'open' ? 'Session opened for bookings' : 'Session closed to new bookings');
      // Update parent state - no need for onRefresh since this updates state directly
      onBookingUpdate?.({ lineup_status: newStatus });
    } catch (error) {
      // Revert local state on error
      setLocalLineupStatus(booking?.lineup_status || 'open');
      toast.error(error.response?.data?.detail || 'Failed to update session status');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleSplitMode = async () => {
    const newMode = localSplitMode === 'open_nearby' ? 'friends_only' : 'open_nearby';
    // Immediately update local state for instant UI feedback
    setLocalSplitMode(newMode);
    setActionLoading('visibility');
    try {
      await apiClient.patch(`/bookings/${booking.id}`, {
        split_mode: newMode
      });
      toast.success(newMode === 'open_nearby' 
        ? 'Session visible to nearby surfers!' 
        : 'Session limited to friends only');
      // Update parent state - no need for onRefresh since this updates state directly
      onBookingUpdate?.({ split_mode: newMode });
    } catch (error) {
      // Revert local state on error
      setLocalSplitMode(booking?.split_mode || 'friends_only');
      toast.error(error.response?.data?.detail || 'Failed to update visibility');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleAutoConfirm = async () => {
    const newValue = !localAutoConfirm;
    // Immediately update local state for instant UI feedback
    setLocalAutoConfirm(newValue);
    setActionLoading('autoconfirm');
    try {
      await apiClient.patch(`/bookings/${booking.id}`, {
        lineup_auto_confirm: newValue
      });
      toast.success(newValue 
        ? 'Session will auto-lock when crew is full!' 
        : 'Auto-confirm disabled');
      // Update parent state - no need for onRefresh since this updates state directly
      onBookingUpdate?.({ lineup_auto_confirm: newValue });
    } catch (error) {
      // Revert local state on error
      setLocalAutoConfirm(booking?.lineup_auto_confirm || false);
      toast.error(error.response?.data?.detail || 'Failed to update auto-confirm');
    } finally {
      setActionLoading(null);
    }
  };

  const handleLockSession = async () => {
    if (!confirm('Lock this session? No more changes can be made after locking.')) return;
    
    setActionLoading('lock');
    try {
      await apiClient.post(`/bookings/${booking.id}/lineup/lock`);
      toast.success('Session locked and finalized');
      onRefresh?.();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to lock session');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelSession = async () => {
    if (!confirm('Cancel this entire session? All participants will be refunded and notified.')) return;
    
    setActionLoading('cancel');
    try {
      await apiClient.post(`/bookings/${booking.id}/cancel`, {
        reason: 'Cancelled by photographer'
      });
      toast.success('Session cancelled. All participants notified.');
      onRefresh?.();
      onClose();
    } catch (error) {
      const errorMessage = error.response?.data?.detail || 'Failed to cancel session';
      const displayMessage = typeof errorMessage === 'object' 
        ? (Array.isArray(errorMessage) ? errorMessage[0]?.msg : errorMessage.msg || 'Failed to cancel session')
        : errorMessage;
      toast.error(displayMessage);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateReservationSettings = async (updates) => {
    setActionLoading('reservation');
    try {
      await apiClient.patch(`/bookings/${booking.id}/reservation-settings`, updates);
      toast.success('Reservation settings updated');
      // Update parent state with new settings
      onBookingUpdate?.(updates);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update settings');
    } finally {
      setActionLoading(null);
    }
  };

  const copyInviteCode = () => {
    if (booking?.invite_code) {
      navigator.clipboard.writeText(booking.invite_code);
      toast.success('Invite code copied!');
    }
  };

  if (!booking) return null;

  const cardBg = isLight ? 'bg-white' : 'bg-zinc-900';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const sectionBg = isLight ? 'bg-gray-50' : 'bg-zinc-800/50';
  
  const totalRevenue = participants.reduce((sum, p) => sum + (parseFloat(p.amount_paid) || 0), 0);
  const confirmedCount = participants.filter(p => p.payment_status === 'Paid' || p.status === 'confirmed').length;
  const pendingCount = participants.filter(p => p.payment_status === 'Pending' || p.status === 'pending').length;
  const spotsLeft = (booking.max_participants || 4) - participants.length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${cardBg} border-zinc-700 max-w-lg max-h-[90vh] flex flex-col overflow-hidden`}>
        <DialogHeader className="pb-2">
          <div className="flex items-center justify-between">
            <DialogTitle className={`text-xl font-bold ${textPrimary} flex items-center gap-2`}>
              <Camera className="w-6 h-6 text-pink-400" />
              Session Manager
            </DialogTitle>
            <Badge className={
              booking.lineup_status === 'open' 
                ? 'bg-green-500/20 text-green-400 border-green-500/30'
                : booking.lineup_status === 'locked'
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                  : 'bg-zinc-500/20 text-gray-400 border-zinc-500/30'
            }>
              {booking.lineup_status === 'open' ? <Unlock className="w-3 h-3 mr-1" /> : <Lock className="w-3 h-3 mr-1" />}
              {booking.lineup_status || 'Pending'}
            </Badge>
          </div>
          <DialogDescription className={`${textSecondary} flex items-center gap-2`}>
            <MapPin className="w-4 h-4" />
            {booking.location} ? {new Date(booking.session_date).toLocaleDateString()}
          </DialogDescription>
        </DialogHeader>

        {/* Session Summary */}
        <div className={`grid grid-cols-3 gap-2 p-3 rounded-lg ${sectionBg}`}>
          <div className="text-center">
            <p className={`text-2xl font-bold text-green-400`}>${totalRevenue.toFixed(0)}</p>
            <p className={`text-xs ${textSecondary}`}>Revenue</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold ${textPrimary}`}>{confirmedCount}</p>
            <p className={`text-xs ${textSecondary}`}>Confirmed</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold text-yellow-400`}>{pendingCount}</p>
            <p className={`text-xs ${textSecondary}`}>Pending</p>
          </div>
        </div>
        
        {/* Capacity Progress */}
        <div className="px-1">
          <div className="flex justify-between text-sm mb-1">
            <span className={textSecondary}>Capacity: {participants.length}/{booking.max_participants || 4}</span>
            <span className={spotsLeft > 0 ? 'text-cyan-400' : 'text-green-400'}>
              {spotsLeft > 0 ? `${spotsLeft} spots open` : 'Full!'}
            </span>
          </div>
          <Progress value={(participants.length / (booking.max_participants || 4)) * 100} className="h-2" />
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-zinc-700">
          <button aria-label="Users"
            onClick={() => setActiveTab('participants')}
            className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'participants' 
                ? `${textPrimary} border-b-2 border-pink-400` 
                : textSecondary
            }`}
          >
            <Users className="w-4 h-4" />
            Surfers ({participants.length})
          </button>
          <button aria-label="User Plus"
            onClick={() => setActiveTab('invite')}
            className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'invite' 
                ? `${textPrimary} border-b-2 border-pink-400` 
                : textSecondary
            }`}
          >
            <UserPlus className="w-4 h-4" />
            Invite
          </button>
          <button aria-label="Settings"
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'settings' 
                ? `${textPrimary} border-b-2 border-pink-400` 
                : textSecondary
            }`}
          >
            <Settings className="w-4 h-4" />
            Controls
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto space-y-3 py-2">
          {/* Participants Tab */}
          {activeTab === 'participants' && (
            <>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-pink-400" />
                </div>
              ) : participants.length === 0 ? (
                <div className={`text-center py-8 ${textSecondary}`}>
                  <Users className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p>No participants yet</p>
                  <p className="text-sm">Share the invite code or invite surfers directly</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {participants.map((participant, idx) => (
                    <ParticipantCard
                      key={participant.participant_id || participant.id || idx}
                      participant={participant}
                      position={idx}
                      canRemove={booking.lineup_status !== 'locked'}
                      onRemove={handleRemoveParticipant}
                      isLight={isLight}
                      loading={actionLoading === 'remove'}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Invite Tab */}
          {activeTab === 'invite' && (
            <>
              {/* Invite Code */}
              {booking.invite_code && (
                <div className={`p-4 rounded-xl ${sectionBg} text-center`}>
                  <p className={`text-sm ${textSecondary} mb-2`}>Share this code with surfers</p>
                  <div className="flex items-center justify-center gap-2">
                    <span className={`font-mono text-2xl font-bold tracking-widest ${textPrimary}`}>
                      {booking.invite_code}
                    </span>
                    <Button variant="ghost" size="sm" onClick={copyInviteCode} className="text-pink-400" aria-label="Copy">
                      <Copy className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Search */}
              <div>
                <Label className={textSecondary}>Search surfers by name or email</Label>
                <div className="relative mt-2">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary}`} />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Type a name or email..."
                    className={`pl-10 ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} ${textPrimary}`}
                  />
                  {searching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-pink-400" />
                  )}
                </div>
              </div>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className={`rounded-lg border ${isLight ? 'border-gray-200' : 'border-zinc-700'} overflow-hidden`}>
                  {searchResults.map((result) => (
                    <div
                      key={result.user_id}
                      className={`flex items-center justify-between p-3 ${isLight ? 'hover:bg-gray-50' : 'hover:bg-zinc-800'} border-b last:border-b-0 ${isLight ? 'border-gray-100' : 'border-zinc-700'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-700">
                          {result.avatar_url ? (
                            <img loading="lazy" decoding="async" src={getFullUrl(result.avatar_url)} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                              {result.full_name?.[0] || '?'}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className={`font-medium ${textPrimary}`}>{result.full_name}</p>
                          <p className={`text-xs ${textSecondary}`}>{result.role || 'Surfer'}</p>
                        </div>
                      </div>
                      <Button aria-label="Loader2"
                        size="sm"
                        onClick={() => handleInviteSurfer(result)}
                        disabled={inviting === result.user_id}
                        className="bg-pink-500 hover:bg-pink-600 text-white"
                      >
                        {inviting === result.user_id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Send className="w-3 h-3 mr-1" />
                            Invite
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Tip */}
              <div className={`p-3 rounded-lg ${isLight ? 'bg-pink-50' : 'bg-pink-500/10'} border border-pink-500/30`}>
                <p className={`text-sm ${isLight ? 'text-pink-700' : 'text-pink-400'}`}>
                  <MessageCircle className="w-4 h-4 inline mr-2" />
                  Surfers can also join using the invite code on The Lineup page.
                </p>
              </div>
            </>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <SessionStatusControl
              booking={booking}
              isLight={isLight}
              loading={!!actionLoading}
              localSplitMode={localSplitMode}
              localAutoConfirm={localAutoConfirm}
              localLineupStatus={localLineupStatus}
              onToggleOpen={handleToggleOpen}
              onToggleSplitMode={handleToggleSplitMode}
              onToggleAutoConfirm={handleToggleAutoConfirm}
              onUpdateReservationSettings={handleUpdateReservationSettings}
              onLockSession={handleLockSession}
              onCancelSession={handleCancelSession}
            />
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-zinc-700">
          <Button variant="outline" onClick={onClose} className="w-full">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PhotographerSessionManager;
