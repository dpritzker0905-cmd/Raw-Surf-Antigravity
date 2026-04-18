/**
 * LineupManagerDrawer - Captain's Command Center for managing a Lineup
 * 
 * Visual Concept: "The Lineup" - Surfers positioned in the water waiting for waves
 * - Captain at "Peak Position" (priority spot)
 * - Crew arranged in arc like a real surf lineup
 * - Open seats as empty surfboard silhouettes
 * 
 * Features:
 * - Visual surf lineup layout with crew positions
 * - Quick actions panel (poker-style controls)
 * - Countdown timer to auto-lock
 * - Replacement Finder with auto-fill
 * - Real-time WebSocket updates
 */
import React, { useState, useEffect, useCallback } from 'react';

import apiClient, { BACKEND_URL } from '../lib/apiClient';

import { 

  Users, Crown, Lock, Unlock, UserPlus, X, Copy, Send,
  DollarSign, Clock, MapPin, Loader2, MessageCircle,
  Globe, UserCheck, Timer, Ban, Search,
  Sparkles, Zap, Waves, Anchor, Navigation,
  UserMinus, Settings, ChevronDown, ChevronUp
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';

import { Button } from './ui/button';

import { Badge } from './ui/badge';

import { Input } from './ui/input';

import { Label } from './ui/label';

import { Progress } from './ui/progress';

import { toast } from 'sonner';

import { useLineupWebSocket } from '../hooks/useLineupWebSocket';

import logger from '../utils/logger';

const getFullUrl = (url) => {
  if (!url) return url;
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('http')) return url;
  return `\\`;
};



// Surfboard colors for each position
const SURFBOARD_COLORS = [
  { fill: '#FCD34D', stroke: '#F59E0B' }, // Yellow (captain)
  { fill: '#22D3EE', stroke: '#0891B2' }, // Cyan
  { fill: '#F472B6', stroke: '#DB2777' }, // Pink
  { fill: '#A78BFA', stroke: '#7C3AED' }, // Purple
  { fill: '#34D399', stroke: '#059669' }, // Green
  { fill: '#FB923C', stroke: '#EA580C' }, // Orange
  { fill: '#60A5FA', stroke: '#2563EB' }, // Blue
];

// Surfer Position Component - Individual crew member in the lineup with surfboard
const SurferPosition = ({ 
  member, 
  position, 
  isCaptain, 
  isCurrentUser,
  canRemove,
  onRemove,
  _pricePerPerson,
  isLight,
  loading
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const _textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  // Countdown timer state for pending invites
  const [timeLeft, setTimeLeft] = useState(null);
  
  useEffect(() => {
    if (!member.expires_at) return;
    
    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const expiresAt = new Date(member.expires_at).getTime();
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
    const timer = setInterval(calculateTimeLeft, 1000);
    
    return () => clearInterval(timer);
  }, [member.expires_at]);
  
  // Get surfboard color based on position
  const boardColor = SURFBOARD_COLORS[position % SURFBOARD_COLORS.length];
  
  // Status colors - with pulsing animation for pending
  const getStatusColor = (status) => {
    switch (status) {
      case 'confirmed':
      case 'Paid':
        return { bg: 'bg-green-500', ring: 'ring-green-400', badge: 'In Position', animate: '' };
      case 'pending':
      case 'Pending':
        return { bg: 'bg-yellow-500', ring: 'ring-yellow-400', badge: 'Paddling Out', animate: 'animate-pulse' };
      case 'invited':
        return { bg: 'bg-blue-500', ring: 'ring-blue-400', badge: 'On the Beach', animate: 'animate-pulse' };
      default:
        return { bg: 'bg-gray-500', ring: 'ring-gray-400', badge: status, animate: '' };
    }
  };
  
  const statusInfo = getStatusColor(member.payment_status || member.status);
  const isPending = member.status === 'pending' || member.status === 'invited' || member.payment_status === 'Pending';
  
  // Format countdown display
  const formatCountdown = () => {
    if (!timeLeft || timeLeft.expired) return null;
    if (timeLeft.hours > 0) {
      return `${timeLeft.hours}h ${timeLeft.minutes}m`;
    }
    return `${timeLeft.minutes}m ${timeLeft.seconds}s`;
  };
  
  return (
    <div className={`relative group ${isCaptain ? 'z-20' : 'z-10'}`}>
      {/* Surfboard underneath the avatar */}
      <div className="relative">
        {/* Surfboard SVG */}
        <svg 
          viewBox="0 0 60 100" 
          className="absolute left-1/2 -translate-x-1/2 top-4 w-16 h-24 pointer-events-none"
          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
        >
          {/* Surfboard shape */}
          <ellipse 
            cx="30" 
            cy="50" 
            rx="14" 
            ry="42" 
            fill={boardColor.fill}
            stroke={boardColor.stroke}
            strokeWidth="2"
          />
          {/* Stringer line */}
          <line 
            x1="30" 
            y1="10" 
            x2="30" 
            y2="90" 
            stroke={boardColor.stroke}
            strokeWidth="1.5"
            opacity="0.6"
          />
          {/* Nose detail */}
          <ellipse 
            cx="30" 
            cy="14" 
            rx="4" 
            ry="3" 
            fill={boardColor.stroke}
            opacity="0.4"
          />
          {/* Fin */}
          <path 
            d="M30 82 L26 92 L30 88 L34 92 Z" 
            fill={boardColor.stroke}
            opacity="0.7"
          />
        </svg>
        
        {/* Surfer Avatar - positioned on top of surfboard */}
        <div className="relative z-10">
          <div className={`w-14 h-14 rounded-full overflow-hidden ring-2 ${statusInfo.ring} ${
            isCaptain ? 'ring-4 ring-yellow-400' : ''
          } transition-all group-hover:scale-105`}>
            {member.avatar_url ? (
              <img src={getFullUrl(member.avatar_url)} alt={member.name} className="w-full h-full object-cover" />
            ) : (
              <div className={`w-full h-full flex items-center justify-center ${
                isCaptain ? 'bg-gradient-to-br from-yellow-400 to-orange-500' : 'bg-gradient-to-br from-cyan-400 to-blue-500'
              }`}>
                <span className="text-white font-bold text-lg">
                  {member.name?.[0]?.toUpperCase() || '?'}
                </span>
              </div>
            )}
          </div>
          
          {/* Captain Crown */}
          {isCaptain && (
            <div className="absolute -top-2 left-1/2 -translate-x-1/2">
              <Crown className="w-5 h-5 text-yellow-400 drop-shadow-lg" />
            </div>
          )}
          
          {/* Status indicator dot */}
          <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full ${statusInfo.bg} ${statusInfo.animate} border-2 ${
            isLight ? 'border-white' : 'border-zinc-900'
          }`} />
          
          {/* Remove button - only for captain to remove others */}
          {canRemove && !isCaptain && (
            <button
              onClick={() => onRemove(member.participant_id, member.name)}
              disabled={loading}
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
              title="Remove from lineup"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      
      {/* Name & Status Label - pushed down to accommodate surfboard */}
      <div className="text-center mt-10 max-w-[80px]">
        <p className={`text-xs font-medium ${textPrimary} truncate`}>
          {isCurrentUser ? 'You' : member.name?.split(' ')[0]}
        </p>
        <Badge className={`text-[10px] px-1.5 py-0 ${statusInfo.animate} ${
          statusInfo.bg === 'bg-green-500' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
          statusInfo.bg === 'bg-yellow-500' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
          'bg-blue-500/20 text-blue-400 border-blue-500/30'
        }`}>
          {statusInfo.badge}
        </Badge>
        
        {/* Countdown Timer for pending invites */}
        {isPending && timeLeft && !timeLeft.expired && (
          <div className="mt-1 flex items-center justify-center gap-1">
            <Timer className="w-3 h-3 text-orange-400" />
            <span className={`text-[10px] font-mono ${
              timeLeft.hours === 0 && timeLeft.minutes < 30 ? 'text-red-400' : 'text-orange-400'
            }`}>
              {formatCountdown()}
            </span>
          </div>
        )}
        {isPending && timeLeft?.expired && (
          <div className="mt-1 flex items-center justify-center gap-1 text-red-400">
            <span className="text-[10px]">Expired</span>
          </div>
        )}
      </div>
    </div>
  );
};

// Empty Seat Component - Surfboard silhouette waiting to be filled
const EmptySeat = ({ seatNumber, isLight, onClick }) => {
  const textSecondary = isLight ? 'text-gray-400' : 'text-gray-500';
  
  // Empty seat surfboard colors (desaturated/ghost colors)
  const emptyBoardColors = [
    { fill: '#94A3B8', stroke: '#64748B' }, // Slate
    { fill: '#A1A1AA', stroke: '#71717A' }, // Gray
    { fill: '#9CA3AF', stroke: '#6B7280' }, // Cool gray
  ];
  const boardColor = emptyBoardColors[(seatNumber - 1) % emptyBoardColors.length];
  
  return (
    <div className="relative group cursor-pointer" onClick={onClick}>
      {/* Ghost Surfboard */}
      <div className="relative">
        <svg 
          viewBox="0 0 60 100" 
          className="absolute left-1/2 -translate-x-1/2 top-4 w-16 h-24 pointer-events-none opacity-40 group-hover:opacity-60 transition-opacity"
          style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }}
        >
          {/* Surfboard shape - dashed outline */}
          <ellipse 
            cx="30" 
            cy="50" 
            rx="14" 
            ry="42" 
            fill="none"
            stroke={boardColor.stroke}
            strokeWidth="2"
            strokeDasharray="6 4"
          />
          {/* Stringer line */}
          <line 
            x1="30" 
            y1="14" 
            x2="30" 
            y2="86" 
            stroke={boardColor.stroke}
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.5"
          />
        </svg>
        
        {/* Empty seat circle */}
        <div className={`relative z-10 w-14 h-14 rounded-full border-2 border-dashed ${
          isLight ? 'border-cyan-300 bg-cyan-50/50' : 'border-cyan-500/50 bg-cyan-500/10'
        } flex items-center justify-center transition-all group-hover:scale-105 group-hover:border-cyan-400`}>
          {/* Plus icon */}
          <svg viewBox="0 0 24 24" className={`w-6 h-6 ${textSecondary} group-hover:text-cyan-400 transition-colors`}>
            <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      </div>
      
      {/* Label - pushed down to match filled seats */}
      <div className="text-center mt-10">
        <p className={`text-xs ${textSecondary}`}>Open #{seatNumber}</p>
        <Badge className="text-[10px] px-1.5 py-0 bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
          Paddle Out
        </Badge>
      </div>
    </div>
  );
};

// Quick Actions Panel - Poker-style control bar
const QuickActionsPanel = ({ 
  lineup, 
  isCaptain, 
  isReady, 
  loading,
  onLock,
  onCloseToInvites,
  onCancelAll,
  onLeave,
  isLight 
}) => {
  const _textPrimary = isLight ? 'text-gray-900' : 'text-white';
  
  if (!isCaptain && lineup.lineup_status === 'open') {
    // Non-captain view - only leave option
    return (
      <div className={`p-3 rounded-xl ${isLight ? 'bg-orange-50 border border-orange-200' : 'bg-orange-500/10 border border-orange-500/30'}`}>
        <Button
          onClick={onLeave}
          disabled={loading}
          variant="outline"
          className="w-full border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserMinus className="w-4 h-4 mr-2" />}
          Leave This Lineup
        </Button>
        <p className={`text-xs text-center mt-2 ${isLight ? 'text-orange-600' : 'text-orange-400/70'}`}>
          Your spot will open for someone else
        </p>
      </div>
    );
  }
  
  if (!isCaptain) return null;
  
  return (
    <div className="space-y-2">
      {/* Primary Action - Lock & Confirm */}
      {isReady && lineup.lineup_status === 'open' && (
        <Button
          onClick={onLock}
          disabled={loading}
          className="w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white py-6 text-base font-bold"
          data-testid="lock-lineup-btn"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <Lock className="w-5 h-5 mr-2" />
              Lock Lineup & Confirm Session
            </>
          )}
        </Button>
      )}
      
      {/* Secondary Actions Grid */}
      {lineup.lineup_status === 'open' && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={onCloseToInvites}
            disabled={loading}
            variant="outline"
            size="sm"
            className={`${isLight ? 'border-amber-300 text-amber-600 hover:bg-amber-50' : 'border-amber-500/50 text-amber-400 hover:bg-amber-500/10'}`}
            data-testid="close-to-invites-btn"
          >
            <Unlock className="w-4 h-4 mr-1" />
            <span className="text-xs">Close to New</span>
          </Button>
          
          <Button
            onClick={onCancelAll}
            disabled={loading}
            variant="outline"
            size="sm"
            className={`${isLight ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-red-500/50 text-red-400 hover:bg-red-500/10'}`}
            data-testid="cancel-all-btn"
          >
            <Ban className="w-4 h-4 mr-1" />
            <span className="text-xs">Cancel & Refund</span>
          </Button>
        </div>
      )}
      
      {/* Locked state - only cancel available */}
      {lineup.lineup_status === 'locked' && (
        <Button
          onClick={onCancelAll}
          disabled={loading}
          variant="outline"
          className="w-full border-red-500/50 text-red-400 hover:bg-red-500/10"
          data-testid="cancel-locked-btn"
        >
          <Ban className="w-4 h-4 mr-2" />
          Cancel Session & Refund All
        </Button>
      )}
    </div>
  );
};

// Countdown Timer Component
const LineupCountdown = ({ closesAt, isLight }) => {
  const [timeLeft, setTimeLeft] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  
  useEffect(() => {
    if (!closesAt) return;
    
    const updateTimer = () => {
      const now = new Date();
      const closes = new Date(closesAt);
      const diff = closes - now;
      
      if (diff <= 0) {
        setTimeLeft('Auto-locking...');
        setIsUrgent(true);
        return;
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      
      if (hours > 24) {
        const days = Math.floor(hours / 24);
        setTimeLeft(`${days}d ${hours % 24}h left`);
        setIsUrgent(false);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m left`);
        setIsUrgent(hours < 6);
      } else {
        setTimeLeft(`${minutes}m left`);
        setIsUrgent(true);
      }
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [closesAt]);
  
  if (!closesAt) return null;
  
  const textColor = isUrgent ? 'text-red-400' : 'text-cyan-400';
  const bgColor = isUrgent 
    ? (isLight ? 'bg-red-50 border-red-200' : 'bg-red-500/10 border-red-500/30')
    : (isLight ? 'bg-cyan-50 border-cyan-200' : 'bg-cyan-500/10 border-cyan-500/30');
  
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${bgColor}`}>
      <Timer className={`w-4 h-4 ${textColor} ${isUrgent ? 'animate-pulse' : ''}`} />
      <span className={`text-sm font-medium ${textColor}`}>{timeLeft}</span>
    </div>
  );
};

// Auto-Fill Suggestions Panel
const AutoFillPanel = ({ 
  suggestions, 
  spotsLeft, 
  onInvite, 
  onInviteAll,
  inviting, 
  isLight 
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const _textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const [expanded, setExpanded] = useState(true);
  
  const allSuggestions = [
    ...suggestions.mutual_friends.map(f => ({ ...f, type: 'friend' })),
    ...suggestions.nearby_public.map(u => ({ ...u, type: 'nearby' }))
  ].slice(0, 6);
  
  if (allSuggestions.length === 0) return null;
  
  return (
    <div className={`rounded-xl overflow-hidden ${
      isLight 
        ? 'bg-gradient-to-br from-purple-50 to-cyan-50 border border-purple-200' 
        : 'bg-gradient-to-br from-purple-500/10 to-cyan-500/10 border border-purple-500/30'
    }`}>
      {/* Header - Collapsible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <span className={`font-medium ${textPrimary}`}>Quick Fill {spotsLeft} Seat{spotsLeft > 1 ? 's' : ''}</span>
          <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
            <Zap className="w-3 h-3 mr-1" />
            Auto-Suggest
          </Badge>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      
      {expanded && (
        <div className="p-3 pt-0 space-y-3">
          {/* Invite All Button */}
          {allSuggestions.length >= 2 && spotsLeft >= 2 && (
            <Button
              onClick={() => onInviteAll(allSuggestions.slice(0, spotsLeft))}
              disabled={inviting}
              size="sm"
              className="w-full bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white"
            >
              <Users className="w-4 h-4 mr-2" />
              Invite All ({Math.min(allSuggestions.length, spotsLeft)}) to Fill Lineup
            </Button>
          )}
          
          {/* Individual suggestions */}
          <div className="grid grid-cols-2 gap-2">
            {allSuggestions.slice(0, 4).map((person) => (
              <button
                key={person.user_id}
                onClick={() => onInvite(person)}
                disabled={inviting === person.user_id}
                className={`flex items-center gap-2 p-2 rounded-lg ${
                  isLight ? 'bg-white hover:bg-gray-50' : 'bg-zinc-800/80 hover:bg-zinc-700'
                } border ${isLight ? 'border-gray-200' : 'border-zinc-600'} transition-all disabled:opacity-50`}
              >
                <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
                  {person.avatar_url ? (
                    <img src={getFullUrl(person.avatar_url)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br from-cyan-400 to-blue-500 text-white text-sm font-bold`}>
                      {person.full_name?.[0] || '?'}
                    </div>
                  )}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className={`text-sm font-medium ${textPrimary} truncate`}>{person.full_name?.split(' ')[0]}</p>
                  <p className={`text-xs ${person.type === 'friend' ? 'text-green-400' : 'text-blue-400'}`}>
                    {person.type === 'friend' ? 'Friend' : 'Nearby'}
                  </p>
                </div>
                {inviting === person.user_id ? (
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                ) : (
                  <Send className="w-4 h-4 text-cyan-400" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Main Component
export const LineupManagerDrawer = ({
  isOpen,
  onClose,
  lineup,
  user,
  theme = 'dark',
  onRefresh,
  onLineupUpdate
}) => {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('lineup'); // 'lineup' | 'invite'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(null);
  const [suggestions, setSuggestions] = useState({ mutual_friends: [], nearby_public: [] });
  const [_loadingSuggestions, setLoadingSuggestions] = useState(false);
  
  // Local state for toggle values to ensure immediate UI updates
  const [localSplitMode, setLocalSplitMode] = useState(lineup?.split_mode);
  const [localAutoConfirm, setLocalAutoConfirm] = useState(lineup?.lineup_auto_confirm);
  
  // Sync local state with lineup prop when it changes
  useEffect(() => {
    setLocalSplitMode(lineup?.split_mode);
    setLocalAutoConfirm(lineup?.lineup_auto_confirm);
  }, [lineup?.split_mode, lineup?.lineup_auto_confirm]);
  
  // Real-time WebSocket updates
  const handleLineupUpdate = useCallback((_data) => {
    onRefresh?.();
  }, [onRefresh]);
  
  const { _isConnected } = useLineupWebSocket(
    isOpen ? lineup?.id : null,
    user?.id,
    handleLineupUpdate
  );
  
  const isLight = theme === 'light';
  const isCaptain = lineup?.creator_id === user?.id;
  
  // Crew calculations
  const confirmedCrew = lineup?.participants?.filter(p => ['confirmed', 'pending'].includes(p.status)) || [];
  const currentCrew = confirmedCrew.length + 1; // +1 for captain
  const maxCrew = lineup?.lineup_max_crew || lineup?.max_participants || 4;
  const minCrew = lineup?.lineup_min_crew || 2;
  const spotsLeft = maxCrew - currentCrew;
  const isReady = currentCrew >= minCrew;
  const pricePerPerson = lineup?.total_price ? (lineup.total_price / currentCrew).toFixed(2) : '0.00';

  // Load suggestions when drawer opens
  useEffect(() => {
    const loadSuggestions = async () => {
      if (!isOpen || !lineup?.id || !user?.id) return;
      
      setLoadingSuggestions(true);
      try {
        const response = await apiClient.get(
          `/bookings/${lineup.id}/invite-suggestions?user_id=${user.id}`
        );
        setSuggestions(response.data || { mutual_friends: [], nearby_public: [] });
      } catch (error) {
        logger.error('Failed to load suggestions:', error);
      } finally {
        setLoadingSuggestions(false);
      }
    };
    
    loadSuggestions();
  }, [isOpen, lineup?.id, user?.id]);
  
  // Search for users
  useEffect(() => {
    if (!lineup?.id || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await apiClient.get(
          `/bookings/${lineup.id}/search-users?query=${encodeURIComponent(searchQuery)}&user_id=${user.id}`
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
  }, [searchQuery, lineup?.id, user?.id]);

  // Action Handlers
  const handleInvite = async (targetUser) => {
    setInviting(targetUser.user_id);
    try {
      await apiClient.post(
        `/bookings/${lineup.id}/invite-by-handle?user_id=${user.id}`,
        { handle_query: targetUser.username || targetUser.full_name }
      );
      const displayName = targetUser.username ? `@${targetUser.username}` : targetUser.full_name;
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

  const handleInviteAll = async (users) => {
    setInviting('all');
    let successCount = 0;
    
    for (const targetUser of users) {
      try {
        await apiClient.post(
          `/bookings/${lineup.id}/invite-by-handle?user_id=${user.id}`,
          { handle_query: targetUser.username || targetUser.full_name }
        );
        successCount++;
      } catch (error) {
        logger.error(`Failed to invite ${targetUser.full_name}:`, error);
      }
    }
    
    if (successCount > 0) {
      toast.success(`Sent ${successCount} invite${successCount > 1 ? 's' : ''}!`);
      onRefresh?.();
    } else {
      toast.error('Failed to send invites');
    }
    
    setInviting(null);
  };

  const handleLockLineup = async () => {
    if (!confirm('Lock this lineup? No more surfers can join after locking.')) return;
    
    setLoading(true);
    try {
      await apiClient.post(`/bookings/${lineup.id}/lineup/lock?user_id=${user.id}`);
      toast.success('Lineup locked! Payment requests sent to crew.');
      onRefresh?.();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to lock lineup');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseToInvites = async () => {
    if (!confirm('Close this lineup to new members? Current crew will keep their spots.')) return;
    
    setLoading(true);
    try {
      await apiClient.post(`/bookings/${lineup.id}/lineup/close?user_id=${user.id}`);
      toast.success('Lineup closed to new members');
      onRefresh?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to close lineup');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelAll = async () => {
    if (!confirm('Cancel this session entirely? All crew members will be refunded and notified.')) return;
    
    setLoading(true);
    try {
      await apiClient.post(`/bookings/${lineup.id}/cancel?user_id=${user.id}`, {
        reason: 'Cancelled by captain'
      });
      toast.success('Session cancelled. All participants have been notified.');
      onRefresh?.();
      onClose();
    } catch (error) {
      const errorMessage = error.response?.data?.detail || 'Failed to cancel session';
      const displayMessage = typeof errorMessage === 'object' 
        ? (Array.isArray(errorMessage) ? errorMessage[0]?.msg : errorMessage.msg || 'Failed to cancel session')
        : errorMessage;
      toast.error(displayMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveCrewMember = async (memberId, memberName) => {
    if (!confirm(`Remove ${memberName} from this lineup? They will be notified.`)) return;
    
    setLoading(true);
    try {
      await apiClient.post(`/bookings/${lineup.id}/lineup/remove-member?user_id=${user.id}`, {
        member_id: memberId
      });
      toast.success(`${memberName} removed from lineup. Spot is now open.`);
      onRefresh?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to remove crew member');
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveLineup = async () => {
    if (!confirm('Leave this lineup? Your spot will open for someone else.')) return;
    
    setLoading(true);
    try {
      await apiClient.post(`/bookings/${lineup.id}/lineup/leave?user_id=${user.id}`);
      toast.success('You left the lineup. The captain has been notified.');
      onRefresh?.();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to leave lineup');
    } finally {
      setLoading(false);
    }
  };

  const copyInviteCode = () => {
    if (lineup?.invite_code) {
      navigator.clipboard.writeText(lineup.invite_code);
      toast.success('Invite code copied!');
    }
  };

  if (!lineup) return null;

  const cardBg = isLight ? 'bg-white' : 'bg-zinc-900';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const sectionBg = isLight ? 'bg-gray-50' : 'bg-zinc-800/50';

  // Build crew array with captain first
  const captainMember = {
    participant_id: 'captain',
    name: user?.full_name || 'You',
    avatar_url: user?.avatar_url,
    status: 'confirmed',
    payment_status: 'Paid'
  };
  
  const _allCrew = [captainMember, ...confirmedCrew];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${cardBg} border-zinc-700 sm:max-w-[500px]`} hideCloseButton>
        {/* Fixed Header with Close Button */}
        <div className={`shrink-0 ${cardBg} border-b ${isLight ? 'border-gray-200' : 'border-zinc-700'} px-4 pt-4 pb-3`}>
          <div className="flex items-center justify-between">
            <DialogTitle className={`text-xl font-bold ${textPrimary} flex items-center gap-2`}>
              <Waves className="w-6 h-6 text-cyan-400" />
              The Lineup
            </DialogTitle>
            <button 
              onClick={onClose}
              className={`p-2 rounded-full ${isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800'} transition-colors`}
              data-testid="close-lineup-drawer"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
          <DialogDescription className={`${textSecondary} flex items-center gap-2 mt-1`}>
            <MapPin className="w-4 h-4" />
            {lineup.location} · {new Date(lineup.session_date).toLocaleDateString()}
          </DialogDescription>
          <LineupCountdown closesAt={lineup.lineup_closes_at} isLight={isLight} />
        </div>
        
        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Session Info Bar */}
        <div className={`flex items-center justify-between p-3 rounded-lg ${sectionBg} mb-3`}>
          <div className="flex items-center gap-4 text-sm">
            <span className={textSecondary}>
              <Clock className="w-4 h-4 inline mr-1 text-yellow-400" />
              {lineup.session_time || new Date(lineup.session_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="text-green-400 font-bold">
              <DollarSign className="w-4 h-4 inline" />
              {pricePerPerson}/person
            </span>
          </div>
          <Badge className={lineup.lineup_status === 'open' 
            ? 'bg-green-500/20 text-green-400 border-green-500/30'
            : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
          }>
            {lineup.lineup_status === 'open' ? <Unlock className="w-3 h-3 mr-1" /> : <Lock className="w-3 h-3 mr-1" />}
            {lineup.lineup_status}
          </Badge>
        </div>
        
        {/* Crew Progress */}
        <div className="px-1 mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span className={textSecondary}>Crew: {currentCrew}/{maxCrew}</span>
            <span className={isReady ? 'text-green-400' : 'text-yellow-400'}>
              {isReady ? 'Ready to confirm!' : `Need ${minCrew - currentCrew} more`}
            </span>
          </div>
          <Progress value={(currentCrew / maxCrew) * 100} className="h-2" />
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-zinc-700">
          <button
            onClick={() => setActiveTab('lineup')}
            className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'lineup' 
                ? `${textPrimary} border-b-2 border-cyan-400` 
                : textSecondary
            }`}
          >
            <Anchor className="w-4 h-4" />
            Lineup ({currentCrew})
          </button>
          <button
            onClick={() => setActiveTab('invite')}
            className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'invite' 
                ? `${textPrimary} border-b-2 border-cyan-400` 
                : textSecondary
            }`}
          >
            <UserPlus className="w-4 h-4" />
            Invite ({spotsLeft} open)
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* Lineup Tab - Visual Surf Lineup */}
          {activeTab === 'lineup' && (
            <>
              {/* Visual Lineup Display - No animation to prevent scrollbar flicker */}
              <div className={`relative rounded-xl p-4 overflow-hidden ${
                isLight 
                  ? 'bg-gradient-to-b from-cyan-100 via-blue-50 to-white border border-cyan-200' 
                  : 'bg-gradient-to-b from-cyan-900/30 via-blue-900/20 to-zinc-900 border border-cyan-500/30'
              }`} style={{ minHeight: '280px' }}>
                {/* Ocean wave pattern background */}
                <div className="absolute inset-0 opacity-20 overflow-hidden rounded-xl">
                  <svg viewBox="0 0 400 200" className="w-full h-full" preserveAspectRatio="none">
                    <path d="M0,100 Q50,80 100,100 T200,100 T300,100 T400,100 V200 H0 Z" fill="currentColor" className="text-cyan-500" opacity="0.3" />
                    <path d="M0,120 Q50,100 100,120 T200,120 T300,120 T400,120 V200 H0 Z" fill="currentColor" className="text-blue-500" opacity="0.2" />
                  </svg>
                </div>
                
                {/* "Peak" Label */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-cyan-400 font-medium flex items-center gap-1">
                  <Navigation className="w-3 h-3" />
                  PEAK
                </div>
                
                {/* Crew Positions - Arc Layout */}
                <div className="relative flex flex-wrap justify-center gap-4 pt-8 pb-4">
                  {/* Captain at center top */}
                  <div className="w-full flex justify-center mb-2">
                    <SurferPosition
                      member={captainMember}
                      position={0}
                      isCaptain={true}
                      isCurrentUser={true}
                      canRemove={false}
                      pricePerPerson={pricePerPerson}
                      isLight={isLight}
                      loading={loading}
                    />
                  </div>
                  
                  {/* Crew members in row */}
                  <div className="flex flex-wrap justify-center gap-4">
                    {confirmedCrew.map((member, idx) => (
                      <SurferPosition
                        key={member.participant_id || idx}
                        member={member}
                        position={idx + 1}
                        isCaptain={false}
                        isCurrentUser={member.user_id === user?.id}
                        canRemove={isCaptain && lineup.lineup_status === 'open'}
                        onRemove={handleRemoveCrewMember}
                        pricePerPerson={pricePerPerson}
                        isLight={isLight}
                        loading={loading}
                      />
                    ))}
                    
                    {/* Empty seats */}
                    {Array.from({ length: spotsLeft }).map((_, idx) => (
                      <EmptySeat
                        key={`empty-${idx}`}
                        seatNumber={currentCrew + idx + 1}
                        isLight={isLight}
                        onClick={() => setActiveTab('invite')}
                      />
                    ))}
                  </div>
                </div>
                
                {/* "Shore" Label */}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-yellow-600 font-medium flex items-center gap-1">
                  <span>🏖️</span>
                  SHORE
                </div>
              </div>
              
              {/* Auto-Fill Suggestions - Only for captain with open spots */}
              {isCaptain && spotsLeft > 0 && lineup.lineup_status === 'open' && (
                <AutoFillPanel
                  suggestions={suggestions}
                  spotsLeft={spotsLeft}
                  onInvite={handleInvite}
                  onInviteAll={handleInviteAll}
                  inviting={inviting}
                  isLight={isLight}
                />
              )}
            </>
          )}

          {/* Invite Tab */}
          {activeTab === 'invite' && (
            <>
              {/* Invite Code */}
              {lineup.invite_code && (
                <div className={`p-4 rounded-xl ${sectionBg} text-center`}>
                  <p className={`text-sm ${textSecondary} mb-2`}>Share this code</p>
                  <div className="flex items-center justify-center gap-2">
                    <span className={`font-mono text-2xl font-bold tracking-widest ${textPrimary}`}>
                      {lineup.invite_code}
                    </span>
                    <Button variant="ghost" size="sm" onClick={copyInviteCode} className="text-cyan-400">
                      <Copy className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Search */}
              <div>
                <Label className={textSecondary}>Search by name</Label>
                <div className="relative mt-2">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary}`} />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Type a name..."
                    className={`pl-10 ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} ${textPrimary}`}
                  />
                  {searching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-cyan-400" />
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
                            <img src={getFullUrl(result.avatar_url)} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                              {result.full_name?.[0] || '?'}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className={`font-medium ${textPrimary}`}>{result.full_name}</p>
                          <p className={`text-xs ${textSecondary}`}>
                            {result.username ? `@${result.username}` : (result.role || 'Surfer')}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleInvite(result)}
                        disabled={inviting === result.user_id}
                        className="bg-cyan-500 hover:bg-cyan-600 text-black"
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

              {/* Suggestions Sections */}
              {!searchQuery && (
                <>
                  {suggestions.mutual_friends.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-4 h-4 text-green-400" />
                        <Label className={`${textPrimary} font-medium`}>Friends</Label>
                      </div>
                      <div className={`rounded-lg border ${isLight ? 'border-gray-200' : 'border-zinc-700'} overflow-hidden`}>
                        {suggestions.mutual_friends.slice(0, 5).map((friend) => (
                          <div
                            key={friend.user_id}
                            className={`flex items-center justify-between p-3 ${isLight ? 'hover:bg-gray-50' : 'hover:bg-zinc-800'} border-b last:border-b-0`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full overflow-hidden">
                                {friend.avatar_url ? (
                                  <img src={getFullUrl(friend.avatar_url)} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-green-400 to-emerald-500 text-white font-bold">
                                    {friend.full_name?.[0] || '?'}
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className={`font-medium ${textPrimary}`}>{friend.full_name}</p>
                                <p className="text-xs text-green-400">Mutual friend</p>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => handleInvite(friend)}
                              disabled={inviting === friend.user_id}
                              className="bg-cyan-500 hover:bg-cyan-600 text-black"
                            >
                              {inviting === friend.user_id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Send className="w-3 h-3" />
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {suggestions.nearby_public.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-blue-400" />
                        <Label className={`${textPrimary} font-medium`}>Nearby Surfers</Label>
                      </div>
                      <div className={`rounded-lg border ${isLight ? 'border-gray-200' : 'border-zinc-700'} overflow-hidden`}>
                        {suggestions.nearby_public.slice(0, 5).map((surfer) => (
                          <div
                            key={surfer.user_id}
                            className={`flex items-center justify-between p-3 ${isLight ? 'hover:bg-gray-50' : 'hover:bg-zinc-800'} border-b last:border-b-0`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full overflow-hidden">
                                {surfer.avatar_url ? (
                                  <img src={getFullUrl(surfer.avatar_url)} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-400 to-indigo-500 text-white font-bold">
                                    {surfer.full_name?.[0] || '?'}
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className={`font-medium ${textPrimary}`}>{surfer.full_name}</p>
                                <p className="text-xs text-blue-400">Nearby</p>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => handleInvite(surfer)}
                              disabled={inviting === surfer.user_id}
                              className="bg-cyan-500 hover:bg-cyan-600 text-black"
                            >
                              {inviting === surfer.user_id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Send className="w-3 h-3" />
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Tip */}
              <div className={`p-3 rounded-lg ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'} border border-cyan-500/30`}>
                <p className={`text-sm ${isLight ? 'text-cyan-700' : 'text-cyan-400'}`}>
                  <MessageCircle className="w-4 h-4 inline mr-2" />
                  Friends can join using the invite code or via "Join Code" on the Bookings page.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Lineup Settings - Captain only */}
        {isCaptain && (
          <div className={`p-4 rounded-lg ${sectionBg} space-y-4`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-cyan-400" />
                <span className={`font-medium ${textPrimary}`}>Lineup Settings</span>
              </div>
            </div>
            
            {/* Open to Nearby Surfers Toggle */}
            <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center">
                  <Globe className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className={`font-medium ${textPrimary}`}>Open to Nearby Surfers</p>
                  <p className={`text-xs ${textSecondary}`}>
                    {lineup.split_mode === 'open_nearby' 
                      ? `Within ${lineup.proximity_radius || 5} miles` 
                      : 'Friends only'}
                  </p>
                </div>
              </div>
              <button
                onClick={async () => {
                  try {
                    const newMode = localSplitMode === 'open_nearby' ? 'friends_only' : 'open_nearby';
                    // Immediately update local state for instant UI feedback
                    setLocalSplitMode(newMode);
                    await apiClient.patch(`/bookings/${lineup.id}?user_id=${user.id}`, {
                      split_mode: newMode
                    });
                    // Update parent state
                    onLineupUpdate?.({ split_mode: newMode });
                    toast.success(newMode === 'open_nearby' 
                      ? 'Lineup is now visible to nearby surfers!' 
                      : 'Lineup is now friends-only');
                  } catch (error) {
                    // Revert local state on error
                    setLocalSplitMode(lineup?.split_mode);
                    toast.error('Failed to update settings');
                  }
                }}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  localSplitMode === 'open_nearby' ? 'bg-cyan-500' : 'bg-zinc-600'
                }`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  localSplitMode === 'open_nearby' ? 'translate-x-7' : 'translate-x-1'
                }`} />
              </button>
            </div>
            
            {/* Auto-Accept Friends Toggle */}
            <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                  <UserCheck className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className={`font-medium ${textPrimary}`}>Auto-Confirm When Ready</p>
                  <p className={`text-xs ${textSecondary}`}>
                    {localAutoConfirm ? 'Locks when crew is full' : 'Manual confirmation required'}
                  </p>
                </div>
              </div>
              <button
                onClick={async () => {
                  try {
                    const newValue = !localAutoConfirm;
                    // Immediately update local state for instant UI feedback
                    setLocalAutoConfirm(newValue);
                    await apiClient.patch(`/bookings/${lineup.id}?user_id=${user.id}`, {
                      lineup_auto_confirm: newValue
                    });
                    // Update parent state
                    onLineupUpdate?.({ lineup_auto_confirm: newValue });
                    toast.success(localAutoConfirm 
                      ? 'Auto-confirm disabled' 
                      : 'Lineup will auto-confirm when full!');
                  } catch (error) {
                    // Revert local state on error
                    setLocalAutoConfirm(lineup?.lineup_auto_confirm);
                    toast.error('Failed to update settings');
                  }
                }}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  localAutoConfirm ? 'bg-green-500' : 'bg-zinc-600'
                }`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  localAutoConfirm ? 'translate-x-7' : 'translate-x-1'
                }`} />
              </button>
            </div>
          </div>
        )}

        {/* Quick Actions Panel */}
        <div className="pt-3 border-t border-zinc-700" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}>
          <QuickActionsPanel
            lineup={lineup}
            isCaptain={isCaptain}
            isReady={isReady}
            loading={loading}
            onLock={handleLockLineup}
            onCloseToInvites={handleCloseToInvites}
            onCancelAll={handleCancelAll}
            onLeave={handleLeaveLineup}
            isLight={isLight}
          />
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LineupManagerDrawer;
