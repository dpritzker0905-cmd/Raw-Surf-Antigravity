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
 */
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Users, Camera, Lock, Unlock, UserPlus, X, Copy, Send, Clock, MapPin,
  AlertTriangle, Loader2, MessageCircle,
  Globe, UserCheck, Timer, Ban, Search, Mail, Settings, XCircle, CheckCircle,
  Hand, UserCircle
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Progress } from './ui/progress';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Surfboard colors for visual consistency with LineupManagerDrawer
const SURFBOARD_COLORS = [
  { fill: '#22D3EE', stroke: '#0891B2' }, // Cyan (primary surfer)
  { fill: '#F472B6', stroke: '#DB2777' }, // Pink
  { fill: '#A78BFA', stroke: '#7C3AED' }, // Purple
  { fill: '#34D399', stroke: '#059669' }, // Green
  { fill: '#FB923C', stroke: '#EA580C' }, // Orange
  { fill: '#60A5FA', stroke: '#2563EB' }, // Blue
  { fill: '#FCD34D', stroke: '#F59E0B' }, // Yellow
];

// Participant Card Component with Countdown Timer and Selfie Preview
const ParticipantCard = ({ 
  participant, 
  position, 
  canRemove, 
  onRemove, 
  isLight,
  loading 
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const boardColor = SURFBOARD_COLORS[position % SURFBOARD_COLORS.length];
  
  // Selfie preview state
  const [showSelfie, setShowSelfie] = useState(false);
  
  // Countdown timer state for pending invites
  const [timeLeft, setTimeLeft] = useState(null);
  
  useEffect(() => {
    if (!participant.expires_at) return;
    
    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const expiresAt = new Date(participant.expires_at).getTime();
      const diff = expiresAt - now;
      
      if (diff <= 0) {
        setTimeLeft({ expired: true });
        return;
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setTimeLeft({ hours, minutes, seconds, expired: false });
    };
    
    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [participant.expires_at]);
  
  const getStatusInfo = (status, paymentStatus) => {
    if (paymentStatus === 'Paid' || status === 'confirmed') {
      return { color: 'green', label: 'Confirmed', icon: CheckCircle };
    }
    if (paymentStatus === 'Pending' || status === 'pending') {
      return { color: 'yellow', label: 'Pending Payment', icon: Clock };
    }
    if (status === 'invited') {
      return { color: 'blue', label: 'Invited', icon: Mail };
    }
    return { color: 'gray', label: status || 'Unknown', icon: AlertTriangle };
  };
  
  const statusInfo = getStatusInfo(participant.status, participant.payment_status);
  const StatusIcon = statusInfo.icon;
  
  // Format countdown display
  const formatCountdown = () => {
    if (!timeLeft) return null;
    if (timeLeft.expired) return <span className="text-red-400 text-xs">Expired</span>;
    
    if (timeLeft.hours > 0) {
      return `${timeLeft.hours}h ${timeLeft.minutes}m`;
    }
    return `${timeLeft.minutes}m ${timeLeft.seconds}s`;
  };
  
  const hasSelfie = participant.selfie_url || participant.media_url;
  
  return (
    <>
      <div className={`flex items-center gap-3 p-3 rounded-xl ${
        isLight ? 'bg-gray-50 border border-gray-200' : 'bg-zinc-800/50 border border-zinc-700'
      } group transition-all hover:shadow-md ${timeLeft?.expired ? 'opacity-60' : ''}`}>
        {/* Surfboard + Avatar */}
        <div className="relative">
          <svg 
            viewBox="0 0 40 60" 
            className="absolute left-1/2 -translate-x-1/2 top-1 w-10 h-14 pointer-events-none"
            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }}
          >
            <ellipse cx="20" cy="30" rx="9" ry="26" fill={boardColor.fill} stroke={boardColor.stroke} strokeWidth="1.5" />
            <line x1="20" y1="6" x2="20" y2="54" stroke={boardColor.stroke} strokeWidth="1" opacity="0.5" />
          </svg>
          
          <div className={`relative z-10 w-10 h-10 rounded-full overflow-hidden ring-2 ${
            statusInfo.color === 'green' ? 'ring-green-400' :
            statusInfo.color === 'yellow' ? 'ring-yellow-400' :
            statusInfo.color === 'blue' ? 'ring-blue-400' : 'ring-gray-400'
          }`}>
            {participant.avatar_url ? (
              <img src={participant.avatar_url} alt={participant.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-cyan-400 to-blue-500 text-white font-bold">
                {participant.name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
          </div>
          
          {/* Selfie indicator badge */}
          {hasSelfie && (
            <button
              onClick={() => setShowSelfie(true)}
              className="absolute -bottom-1 -right-1 z-20 w-5 h-5 bg-cyan-500 rounded-full flex items-center justify-center shadow-lg hover:bg-cyan-400 transition-colors"
              title="View ID selfie"
            >
              <Camera className="w-3 h-3 text-white" />
            </button>
          )}
        </div>
        
        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${textPrimary} truncate`}>{participant.name || 'Unknown Surfer'}</p>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <StatusIcon className={`w-3 h-3 text-${statusInfo.color}-400`} />
              <span className={`text-xs text-${statusInfo.color}-400`}>{statusInfo.label}</span>
            </div>
            {/* Countdown Timer for Pending */}
            {timeLeft && !timeLeft.expired && (participant.status === 'pending' || participant.status === 'invited') && (
              <div className="flex items-center gap-1 text-xs text-amber-400">
                <Timer className="w-3 h-3" />
                <span>{formatCountdown()}</span>
              </div>
            )}
          </div>
        </div>
        
        {/* Selfie View Button (if available) */}
        {hasSelfie && (
          <button
            onClick={() => setShowSelfie(true)}
            className={`p-1.5 rounded-lg text-cyan-400 hover:bg-cyan-500/10 transition-colors ${
              isLight ? 'hover:bg-cyan-100' : ''
            }`}
            title="View ID selfie"
          >
            <UserCircle className="w-4 h-4" />
          </button>
        )}
        
        {/* Price */}
        <div className="text-right">
          <p className={`font-bold ${textPrimary}`}>${participant.paid_amount || participant.amount_paid || participant.price || '0'}</p>
          <p className={`text-xs ${textSecondary}`}>
            {participant.payment_status === 'Paid' ? 'Paid' : 'Due'}
          </p>
        </div>
        
        {/* Remove Button */}
        {canRemove && (
          <button
            onClick={() => onRemove(participant.participant_id || participant.id, participant.name)}
            disabled={loading}
            className="p-2 rounded-full text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
            title="Remove from session"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
          </button>
        )}
      </div>
      
      {/* Selfie Preview Modal */}
      {showSelfie && hasSelfie && (
        <div 
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowSelfie(false)}
        >
          <div 
            className="bg-zinc-900 rounded-2xl max-w-sm w-full overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {participant.avatar_url ? (
                  <img src={participant.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white font-bold">
                    {participant.name?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <div>
                  <p className="font-medium text-white">{participant.name}</p>
                  <p className="text-xs text-gray-400">ID Selfie for recognition</p>
                </div>
              </div>
              <button
                onClick={() => setShowSelfie(false)}
                className="p-2 rounded-full hover:bg-zinc-800 text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="relative aspect-[3/4] bg-black">
              <img 
                src={participant.selfie_url || participant.media_url} 
                alt={`${participant.name}'s ID selfie`}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="p-4 bg-zinc-800/50 text-center">
              <p className="text-xs text-gray-400">
                Use this photo to help identify {participant.name?.split(' ')[0]} during the session
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// Session Status Control Panel - Matching LineupManagerDrawer UX
const SessionStatusControl = ({ 
  booking, 
  isLight, 
  loading,
  localSplitMode,
  localAutoConfirm,
  localLineupStatus,
  onToggleOpen,
  onToggleSplitMode,
  onToggleAutoConfirm,
  onUpdateReservationSettings,
  onLockSession,
  onCancelSession 
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const sectionBg = isLight ? 'bg-gray-50' : 'bg-zinc-800/50';
  
  // Session is "open" if status is open, filling, or ready (any state that accepts bookings)
  // Session is "closed" only if status is 'closed' or null
  const isOpen = localLineupStatus && !['closed', 'locked'].includes(localLineupStatus);
  const isLocked = localLineupStatus === 'locked';
  
  return (
    <div className="space-y-4">
      {/* Session Open/Close Toggle */}
      <div className={`p-4 rounded-xl ${
        isLight 
          ? 'bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-200' 
          : 'bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isOpen ? 'bg-cyan-500/20' : 'bg-amber-500/20'
            }`}>
              {isOpen ? <Unlock className="w-5 h-5 text-cyan-400" /> : <Lock className="w-5 h-5 text-amber-400" />}
            </div>
            <div>
              <span className={`font-medium ${textPrimary}`}>
                {isOpen ? 'Session Open for Bookings' : 'Session Closed'}
              </span>
              <p className={`text-xs ${textSecondary}`}>
                {isOpen 
                  ? 'Surfers can discover and join this session' 
                  : 'No new bookings allowed'
                }
              </p>
            </div>
          </div>
          <button
            onClick={onToggleOpen}
            disabled={loading || isLocked}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              isOpen ? 'bg-cyan-500' : 'bg-zinc-600'
            } ${(loading || isLocked) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              isOpen ? 'translate-x-7' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>
      
      {/* Settings Section - Only show when open and not locked */}
      {isOpen && !isLocked && (
        <div className={`p-4 rounded-lg ${sectionBg} space-y-4`}>
          <div className="flex items-center gap-2 mb-2">
            <Settings className="w-4 h-4 text-cyan-400" />
            <span className={`font-medium ${textPrimary}`}>Session Settings</span>
          </div>
          
          {/* Open to Nearby Surfers Toggle */}
          <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center">
                <Globe className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className={`font-medium ${textPrimary}`}>Open to Nearby Surfers</p>
                <p className={`text-xs ${textSecondary}`}>
                  {localSplitMode === 'open_nearby' 
                    ? `Visible within ${booking.proximity_radius || 5} miles` 
                    : 'Friends & invite code only'}
                </p>
              </div>
            </div>
            <button
              onClick={onToggleSplitMode}
              disabled={loading}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                localSplitMode === 'open_nearby' ? 'bg-cyan-500' : 'bg-zinc-600'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              data-testid="toggle-open-nearby"
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                localSplitMode === 'open_nearby' ? 'translate-x-7' : 'translate-x-1'
              }`} />
            </button>
          </div>
          
          {/* Auto-Confirm When Ready Toggle */}
          <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                <UserCheck className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className={`font-medium ${textPrimary}`}>Auto-Lock When Full</p>
                <p className={`text-xs ${textSecondary}`}>
                  {localAutoConfirm ? 'Session locks automatically when crew is full' : 'Manual lock required'}
                </p>
              </div>
            </div>
            <button
              onClick={onToggleAutoConfirm}
              disabled={loading}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                localAutoConfirm ? 'bg-green-500' : 'bg-zinc-600'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              data-testid="toggle-auto-confirm"
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                localAutoConfirm ? 'translate-x-7' : 'translate-x-1'
              }`} />
            </button>
          </div>
        </div>
      )}
      
      {/* Seat Reservation Settings - Poker-Style */}
      {isOpen && !isLocked && (
        <div className={`p-4 rounded-lg ${sectionBg} space-y-4`}>
          <div className="flex items-center gap-2 mb-2">
            <Timer className="w-4 h-4 text-amber-400" />
            <span className={`font-medium ${textPrimary}`}>Seat Reservation Settings</span>
          </div>
          
          {/* Invite Expiry Window */}
          <div className={`p-3 rounded-lg ${isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className={`font-medium ${textPrimary}`}>Invite Expiry Window</p>
                <p className={`text-xs ${textSecondary}`}>How long invites last before spot opens up</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: '4hr', value: 4 },
                { label: '12hr', value: 12 },
                { label: '24hr', value: 24 },
                { label: '48hr', value: 48 }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => onUpdateReservationSettings?.({ invite_expiry_hours: opt.value })}
                  disabled={loading}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    (booking.invite_expiry_hours || 24) === opt.value
                      ? 'bg-amber-500 text-black'
                      : `${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-zinc-700 text-gray-300 hover:bg-zinc-600'}`
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              {/* Custom input */}
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="1"
                  max="168"
                  placeholder="Custom"
                  className={`w-16 px-2 py-1.5 rounded-lg text-sm ${
                    isLight ? 'bg-gray-100 border border-gray-200' : 'bg-zinc-700 border border-zinc-600'
                  } ${textPrimary}`}
                  onBlur={(e) => {
                    const val = parseFloat(e.target.value);
                    if (val >= 1 && val <= 168) {
                      onUpdateReservationSettings?.({ invite_expiry_hours: val });
                    }
                  }}
                />
                <span className={`text-xs ${textSecondary}`}>hrs</span>
              </div>
            </div>
          </div>
          
          {/* Waitlist Toggle */}
          <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-indigo-500 flex items-center justify-center">
                <Users className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className={`font-medium ${textPrimary}`}>Enable Waitlist</p>
                <p className={`text-xs ${textSecondary}`}>Auto-notify next in line when spots open</p>
              </div>
            </div>
            <button
              onClick={() => onUpdateReservationSettings?.({ waitlist_enabled: !(booking.waitlist_enabled ?? true) })}
              disabled={loading}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                (booking.waitlist_enabled ?? true) ? 'bg-purple-500' : 'bg-zinc-600'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                (booking.waitlist_enabled ?? true) ? 'translate-x-7' : 'translate-x-1'
              }`} />
            </button>
          </div>
          
          {/* Keep Seat Toggle */}
          <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
                <Hand className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className={`font-medium ${textPrimary}`}>Allow "Keep My Seat"</p>
                <p className={`text-xs ${textSecondary}`}>
                  Let pending surfers extend their hold ({booking.max_keep_seat_extensions || 2} times max)
                </p>
              </div>
            </div>
            <button
              onClick={() => onUpdateReservationSettings?.({ allow_keep_seat: !(booking.allow_keep_seat ?? true) })}
              disabled={loading}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                (booking.allow_keep_seat ?? true) ? 'bg-amber-500' : 'bg-zinc-600'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                (booking.allow_keep_seat ?? true) ? 'translate-x-7' : 'translate-x-1'
              }`} />
            </button>
          </div>
        </div>
      )}
      
      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2">
        {!isLocked && isOpen && (
          <Button
            onClick={onLockSession}
            disabled={loading}
            className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white"
            data-testid="lock-session-btn"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Lock className="w-4 h-4 mr-1" />}
            Lock & Finalize
          </Button>
        )}
        
        <Button
          onClick={onCancelSession}
          disabled={loading}
          variant="outline"
          className={`border-red-500/50 text-red-400 hover:bg-red-500/10 ${!isLocked && isOpen ? '' : 'col-span-2'}`}
          data-testid="cancel-session-btn"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Ban className="w-4 h-4 mr-1" />}
          Cancel & Refund
        </Button>
      </div>
      
      {/* Locked State Notice */}
      {isLocked && (
        <div className={`p-3 rounded-lg ${isLight ? 'bg-amber-50 border border-amber-200' : 'bg-amber-500/10 border border-amber-500/30'}`}>
          <div className="flex items-center gap-2 text-amber-500">
            <Lock className="w-4 h-4" />
            <span className="font-medium">Session Locked</span>
          </div>
          <p className={`text-sm ${textSecondary} mt-1`}>
            This session is finalized. No changes can be made.
          </p>
        </div>
      )}
    </div>
  );
};

// Main Component
export const PhotographerSessionManager = ({
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
        const response = await axios.get(`${API}/bookings/${booking.id}/participants`);
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
        const response = await axios.get(
          `${API}/bookings/${booking.id}/search-users?query=${encodeURIComponent(searchQuery)}&user_id=${user.id}`
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
      await axios.post(
        `${API}/bookings/${booking.id}/invite-by-handle?user_id=${user.id}`,
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
      await axios.post(`${API}/bookings/${booking.id}/lineup/remove-member?user_id=${user.id}`, {
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
      await axios.post(`${API}/bookings/${booking.id}/lineup/status?user_id=${user.id}`, {
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
      await axios.patch(`${API}/bookings/${booking.id}?user_id=${user.id}`, {
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
      await axios.patch(`${API}/bookings/${booking.id}?user_id=${user.id}`, {
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
      await axios.post(`${API}/bookings/${booking.id}/lineup/lock?user_id=${user.id}`);
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
      await axios.post(`${API}/bookings/${booking.id}/cancel?user_id=${user.id}`, {
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
      await axios.patch(`${API}/bookings/${booking.id}/reservation-settings?user_id=${user.id}`, updates);
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
            {booking.location} · {new Date(booking.session_date).toLocaleDateString()}
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
          <button
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
          <button
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
          <button
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
                    <Button variant="ghost" size="sm" onClick={copyInviteCode} className="text-pink-400">
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
                            <img src={result.avatar_url} alt="" className="w-full h-full object-cover" />
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
                      <Button
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
