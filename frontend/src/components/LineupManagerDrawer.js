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

import apiClient from '../lib/apiClient';

import { 
  Users, Crown, Lock, Unlock, UserPlus, X, Copy, Send,
  DollarSign, Clock, MapPin, Loader2, MessageCircle,
  Globe, UserCheck, Timer, Ban, Search,
  Sparkles, Zap, Waves, Anchor, Navigation,
  UserMinus, Settings, ChevronDown, ChevronUp, CheckCircle
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
import useLineupManagerActions from '../hooks/useLineupManagerActions';
import { getFullUrl } from '../utils/media';



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
import SurferPosition from './lineup/SurferPosition';
import EmptySeat from './lineup/EmptySeat';
import QuickActionsPanel from './lineup/QuickActionsPanel';
import LineupCountdown from './lineup/LineupCountdown';
import AutoFillPanel from './lineup/AutoFillPanel';

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
  const [activeTab, setActiveTab] = useState('lineup');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(null);
  const [suggestions, setSuggestions] = useState({ mutual_friends: [], nearby_public: [] });
  const [_loadingSuggestions, setLoadingSuggestions] = useState(false);
  // In-UI confirmation dialogs (replaces window.confirm)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  
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
          `/bookings/${lineup.id}/invite-suggestions`
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
          `/bookings/${lineup.id}/search-users?query=${encodeURIComponent(searchQuery)}`
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

  // ============ HANDLERS EXTRACTED TO hooks/useLineupManagerActions.js ============
  const {
    handleInvite,
    handleInviteAll,
    handleLockLineup,
    handleCloseToInvites,
    handleCancelAll,
    handleRemoveCrewMember,
    handleLeaveLineup,
    copyInviteCode,
  } = useLineupManagerActions({
    lineup,
    user,
    onRefresh,
    onClose,
    showLockConfirm,
    showCancelConfirm,
    setLoading,
    setInviting,
    setSearchQuery,
    setSearchResults,
    setShowLockConfirm,
    setShowCancelConfirm,
  });

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
            <button aria-label="Close" 
              onClick={onClose}
              className={`p-2 rounded-full ${isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800'} transition-colors`}
              data-testid="close-lineup-drawer"
            ><X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
          <DialogDescription className={`${textSecondary} flex items-center gap-2 mt-1`}>
            <MapPin className="w-4 h-4" />
            {lineup.location} - {new Date(lineup.session_date).toLocaleDateString()}
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
          <button aria-label="Anchor"
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
          <button aria-label="User Plus"
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
                <span>{String.fromCodePoint(0x1F3C4)}</span>
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
                    <Button variant="ghost" size="sm" onClick={copyInviteCode} className="text-cyan-400" aria-label="Copy">
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
                            <img loading="lazy" decoding="async" src={getFullUrl(result.avatar_url)} alt="" className="w-full h-full object-cover" />
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
                      <Button aria-label="Loader2"
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
                                  <img loading="lazy" decoding="async" src={getFullUrl(friend.avatar_url)} alt="" className="w-full h-full object-cover" />
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
                            <Button aria-label="Loader2"
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
                                  <img loading="lazy" decoding="async" src={getFullUrl(surfer.avatar_url)} alt="" className="w-full h-full object-cover" />
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
                            <Button aria-label="Loader2"
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
                    await apiClient.patch(`/bookings/${lineup.id}`, {
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
                    await apiClient.patch(`/bookings/${lineup.id}`, {
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

        {/* Cancel Confirmation Banner */}
        {showCancelConfirm && (
          <div className={`mx-4 mb-3 p-4 rounded-xl border-2 border-red-500/50 ${
            isLight ? 'bg-red-50' : 'bg-red-500/10'
          }`}>
            <div className="flex items-start gap-3 mb-3">
              <Ban className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className={`font-semibold ${isLight ? 'text-red-700' : 'text-red-300'}`}>
                  Cancel this lineup?
                </p>
                <p className={`text-sm mt-1 ${isLight ? 'text-red-600' : 'text-red-400'}`}>
                  All crew members will be notified and any payments refunded. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button aria-label="Loader2"
                onClick={handleCancelAll}
                disabled={loading}
                size="sm"
                className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                data-testid="confirm-cancel-btn"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Yes, Cancel & Refund'}
              </Button>
              <Button
                onClick={() => setShowCancelConfirm(false)}
                size="sm"
                variant="outline"
                className={`flex-1 ${isLight ? 'border-gray-300' : 'border-zinc-600'}`}
              >
                Keep Lineup
              </Button>
            </div>
          </div>
        )}

        {/* Lock Confirmation Banner */}
        {showLockConfirm && (
          <div className={`mx-4 mb-3 p-4 rounded-xl border-2 border-green-500/50 ${
            isLight ? 'bg-green-50' : 'bg-green-500/10'
          }`}>
            <div className="flex items-start gap-3 mb-3">
              <Lock className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className={`font-semibold ${isLight ? 'text-green-700' : 'text-green-300'}`}>
                  Lock this lineup?
                </p>
                <p className={`text-sm mt-1 ${isLight ? 'text-green-600' : 'text-green-400'}`}>
                  No more surfers can join. Payment requests will be sent to all crew members.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button aria-label="Loader2"
                onClick={handleLockLineup}
                disabled={loading}
                size="sm"
                className="flex-1 bg-green-500 hover:bg-green-600 text-white"
                data-testid="confirm-lock-btn"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Lock & Confirm'}
              </Button>
              <Button
                onClick={() => setShowLockConfirm(false)}
                size="sm"
                variant="outline"
                className={`flex-1 ${isLight ? 'border-gray-300' : 'border-zinc-600'}`}
              >
                Not Yet
              </Button>
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
            onClose={onClose}
            isLight={isLight}
          />
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LineupManagerDrawer;
