/**
 * ScheduledBookingHelpers.js
 * Extracted helper components for ScheduledBookingDrawer.
 * Includes: AccountCreditSection, SchedSurfboardAvatar, SchedEmptySeat,
 *           CrewSplitSection, CrossSellSuggestion, BookingConfirmation
 */
import React, { useState, useEffect } from 'react';
import {
  Camera, MapPin, Clock, DollarSign, Zap, ChevronRight,
  Check, AlertTriangle, Star, Wallet, Target, Sparkles, Bell, Gift,
  Navigation, X, Loader2, CheckCircle2, Radio, CreditCard, Users,
  UserPlus, Search, Crown, Percent, Anchor, Award, Plus
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Slider } from '../ui/slider';
import { Switch } from '../ui/switch';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import { SavedCrewSelector } from '../SavedCrewSelector';
import logger from '../../utils/logger';
import { getFullUrl } from '../../utils/media';

// Duration prices multiplier
const DURATION_PRICES = {
  60: 1,
  120: 1.8,
  180: 2.5,
  240: 3,
  480: 5
};

/**
 * Impact Zone Location Picker - Select meetup coordinates with range validation
 * Features:
 * - GPS-based nearest spots dropdown
 * - Validates if photographer is within range
 * - Shows travel surcharge if applicable
 */
// ImpactZonePicker extracted to ./booking/ImpactZonePicker.js

/**
 * Account Credit Application Component
 */
const _AccountCreditSection = ({
  userCredits,
  totalPrice,
  appliedCredits,
  onAppliedCreditsChange,
  isLight
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  const maxApplicable = Math.min(userCredits, totalPrice);
  const remainingToPay = Math.max(0, totalPrice - appliedCredits);
  
  if (userCredits <= 0) return null;
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-yellow-400" />
          <Label className={`font-medium ${textPrimary}`}>Account Credit</Label>
        </div>
        <Badge className="bg-yellow-500/20 text-yellow-400">
          ${userCredits.toFixed(2)} available
        </Badge>
      </div>
      
      {/* Slider for partial credit application */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className={textSecondary}>Apply credits:</span>
          <span className="font-bold text-yellow-400">${appliedCredits.toFixed(2)}</span>
        </div>
        
        <Slider
          value={[appliedCredits]}
          onValueChange={([value]) => onAppliedCreditsChange(value)}
          max={maxApplicable}
          min={0}
          step={0.5}
          className="w-full"
        />
        
        <div className="flex justify-between text-xs">
          <span className={textSecondary}>$0</span>
          <span className={textSecondary}>${maxApplicable.toFixed(2)}</span>
        </div>
      </div>
      
      {/* Quick buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAppliedCreditsChange(0)}
          className={`flex-1 ${appliedCredits === 0 ? 'border-yellow-500' : 'border-zinc-700'}`}
        >
          None
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAppliedCreditsChange(maxApplicable / 2)}
          className="flex-1 border-zinc-700"
        >
          Half
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAppliedCreditsChange(maxApplicable)}
          className={`flex-1 ${appliedCredits === maxApplicable ? 'border-yellow-500 bg-yellow-500/10' : 'border-zinc-700'}`}
        >
          Max
        </Button>
      </div>
      
      {/* Payment Summary */}
      <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
        <div className="flex justify-between mb-1">
          <span className={textSecondary}>Session Total</span>
          <span className={textPrimary}>${totalPrice.toFixed(2)}</span>
        </div>
        {appliedCredits > 0 && (
          <div className="flex justify-between mb-1 text-yellow-400">
            <span>Credit Applied</span>
            <span>-${appliedCredits.toFixed(2)}</span>
          </div>
        )}
        <div className={`flex justify-between pt-2 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
          <span className={`font-bold ${textPrimary}`}>Pay with Card</span>
          <span className="font-bold text-green-400">${remainingToPay.toFixed(2)}</span>
        </div>
      </div>
      
      {/* Refund & Protection Policy Notice */}
      <div className="space-y-2">
        <div className={`flex items-start gap-2 p-3 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'} border ${isLight ? 'border-green-200' : 'border-green-500/30'}`}>
          <Check className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
          <p className={`text-xs ${isLight ? 'text-green-700' : 'text-green-300'}`}>
            <strong>Payment Protected:</strong> Your payment is held securely until the session is completed and your content is delivered through our gallery system.
          </p>
        </div>
        
        <div className={`flex items-start gap-2 p-3 rounded-lg ${isLight ? 'bg-amber-50' : 'bg-amber-500/10'} border ${isLight ? 'border-amber-200' : 'border-amber-500/30'}`}>
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className={`text-xs ${isLight ? 'text-amber-700' : 'text-amber-300'}`}>
            <strong>Cancellation Policy:</strong>
            <ul className="mt-1 ml-2 space-y-0.5">
              <li>- More than 48hrs before: 90% refund</li>
              <li>- 24-48hrs before: 50% refund</li>
              <li>- Less than 24hrs: No refund</li>
            </ul>
            <p className="mt-1">Refunds go to your Account Credit balance.</p>
          </div>
        </div>
      </div>
    </div>
  );
};


// ====================================================================
// SHARED SURFBOARD VISUALIZATION (mirrored from OnDemandRequestDrawer)
// ====================================================================
const SCHED_BOARD_COLORS = [
  { fill: '#FCD34D', stroke: '#F59E0B' }, // Yellow - captain
  { fill: '#22D3EE', stroke: '#0891B2' }, // Cyan
  { fill: '#F472B6', stroke: '#DB2777' }, // Pink
  { fill: '#A78BFA', stroke: '#7C3AED' }, // Purple
  { fill: '#34D399', stroke: '#059669' }, // Green
  { fill: '#FB923C', stroke: '#EA580C' }, // Orange
  { fill: '#60A5FA', stroke: '#2563EB' }, // Blue
];

const SchedSurfboardAvatar = ({ member, index, isCaptain, onRemove, isLight }) => {
  const color = SCHED_BOARD_COLORS[index % SCHED_BOARD_COLORS.length];
  return (
    <div className="relative group flex flex-col items-center">
      <svg viewBox="0 0 60 100" className="absolute left-1/2 -translate-x-1/2 top-2 w-12 h-20 pointer-events-none"
        style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>
        <ellipse cx="30" cy="50" rx="12" ry="38" fill={color.fill} stroke={color.stroke} strokeWidth="2" />
        <line x1="30" y1="14" x2="30" y2="86" stroke={color.stroke} strokeWidth="1.5" opacity="0.6" />
        <ellipse cx="30" cy="16" rx="3" ry="2.5" fill={color.stroke} opacity="0.4" />
        <path d="M30 78 L27 86 L30 83 L33 86 Z" fill={color.stroke} opacity="0.7" />
      </svg>
      <div className="relative z-10">
        <div className={`w-11 h-11 rounded-full overflow-hidden ${
          isCaptain ? 'ring-2 ring-yellow-400' : 'ring-2 ring-cyan-400/50'
        } transition-all group-hover:scale-105`}>
          {member.avatar_url ? (
            <img loading="lazy" decoding="async" src={getFullUrl(member.avatar_url)} alt={member.name} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${
              isCaptain ? 'bg-gradient-to-br from-yellow-400 to-orange-500' : 'bg-gradient-to-br from-cyan-400 to-blue-500'
            }`}>
              <span className="text-white font-bold text-sm">
                {(member.name || '?')[0].toUpperCase()}
              </span>
            </div>
          )}
        </div>
        {isCaptain && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2">
            <Award className="w-4 h-4 text-yellow-400 drop-shadow-lg" />
          </div>
        )}
        {!isCaptain && onRemove && (
          <button
            onClick={() => onRemove(member.user_id)}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="text-center mt-8 max-w-[70px]">
        <p className={`text-[10px] font-medium ${isLight ? 'text-gray-900' : 'text-white'} truncate`}>
          {isCaptain ? 'You' : (member.name?.split(' ')[0] || 'Crew')}
        </p>
      </div>
    </div>
  );
};

const SchedEmptySeat = ({ onClick, isLight }) => (
  <div className="relative group cursor-pointer flex flex-col items-center" onClick={onClick}>
    <svg viewBox="0 0 60 100" className="absolute left-1/2 -translate-x-1/2 top-2 w-12 h-20 pointer-events-none opacity-40 group-hover:opacity-60 transition-opacity">
      <ellipse cx="30" cy="50" rx="12" ry="38" fill="none" stroke="#64748B" strokeWidth="2" strokeDasharray="6 4" />
      <line x1="30" y1="18" x2="30" y2="82" stroke="#64748B" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
    </svg>
    <div className={`relative z-10 w-11 h-11 rounded-full border-2 border-dashed ${
      isLight ? 'border-cyan-300 bg-cyan-50/50' : 'border-cyan-500/50 bg-cyan-500/10'
    } flex items-center justify-center transition-all group-hover:scale-105 group-hover:border-cyan-400`}>
      <Plus className={`w-5 h-5 ${isLight ? 'text-cyan-400' : 'text-cyan-500'} group-hover:text-cyan-400`} />
    </div>
    <div className="text-center mt-8">
      <p className={`text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>Add crew</p>
    </div>
  </div>
);

/**
 * Crew Split Section - Select crew members to split the cost
 */
const CrewSplitSection = ({
  user,
  enabled,
  onToggle,
  crewMembers,
  onCrewChange,
  totalPrice,
  isLight
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const cardBg = isLight ? 'bg-gray-100' : 'bg-zinc-800';

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [recentBuddies, setRecentBuddies] = useState([]);
  const [following, setFollowing] = useState([]);
  const [_loadingRecent, setLoadingRecent] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Load recent buddies and following when crew split is enabled
  useEffect(() => {
    if (enabled && user?.id) loadRecentAndFollowing();
  }, [enabled, user?.id]);

  const loadRecentAndFollowing = async () => {
    setLoadingRecent(true);
    try {
      const [buddiesRes, followingRes] = await Promise.all([
        apiClient.get(`/users/${user.id}/recent-buddies?limit=10`).catch(() => ({ data: { buddies: [] } })),
        apiClient.get(`/users/${user.id}/following?limit=20`).catch(() => ({ data: { following: [] } }))
      ]);
      setRecentBuddies(buddiesRes.data.buddies || []);
      setFollowing(followingRes.data.following || []);
    } catch (error) {
      logger.error('Failed to load recent/following:', error);
    } finally {
      setLoadingRecent(false);
    }
  };

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await apiClient.get(`/users/search?query=${encodeURIComponent(query)}&limit=10`);
      const selectedIds = crewMembers.map(m => m.user_id);
      setSearchResults((res.data.users || []).filter(u => u.id !== user.id && !selectedIds.includes(u.id)));
    } catch { /* silent */ } finally { setSearching(false); }
  };

  const addMember = (member) => {
    if (crewMembers.some(m => m.user_id === member.id)) return;
    onCrewChange([...crewMembers, {
      user_id: member.id,
      name: member.full_name || member.username,
      username: member.username,
      avatar_url: member.avatar_url,
      payment_status: 'Pending',
      share_amount: 0,
      captain_cover_percent: 0   // 0 = crew member pays their full share
    }]);
    setSearchQuery('');
    setSearchResults([]);
    setShowSearch(false);
    toast.success(`Added ${member.full_name || member.username} to crew!`);
  };

  const removeMember = (userId) => {
    onCrewChange(crewMembers.filter(m => m.user_id !== userId));
  };

  // Update captain coverage % for a specific member
  const updateCoverPercent = (userId, percent) => {
    onCrewChange(crewMembers.map(m =>
      m.user_id === userId ? { ...m, captain_cover_percent: percent } : m
    ));
  };

  // Pricing
  const totalCrew = crewMembers.length + 1; // +1 captain
  const pricePerPerson = totalPrice / totalCrew;

  // Captain's actual payment = their share + whatever they cover for crew members
  const captainCovers = crewMembers.reduce((sum, m) =>
    sum + (pricePerPerson * ((m.captain_cover_percent || 0) / 100)), 0
  );
  const captainActualPay = pricePerPerson + captainCovers;

  // Suggestions (recent buddies + following, deduped)
  const suggestions = [...recentBuddies, ...following].filter((item, idx, self) =>
    idx === self.findIndex(t => t.id === item.id) &&
    item.id !== user.id &&
    !crewMembers.some(m => m.user_id === item.id)
  ).slice(0, 8);

  return (
    <div className="space-y-4">
      {/* -- Split Toggle -- */}
      <div className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
        enabled
          ? isLight ? 'bg-cyan-50 border-cyan-200' : 'bg-cyan-500/10 border-cyan-500/30'
          : cardBg + ' border-transparent'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full ${enabled ? 'bg-cyan-500/20' : 'bg-zinc-700'} flex items-center justify-center`}>
            <Users className={`w-5 h-5 ${enabled ? 'text-cyan-400' : 'text-gray-400'}`} />
          </div>
          <div>
            <p className={`font-medium ${textPrimary}`}>Split with Crew?</p>
            <p className={`text-sm ${textSecondary}`}>
              {enabled ? `${totalCrew} surfers - you pay $${captainActualPay.toFixed(2)}` : 'Share the cost with friends'}
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} data-testid="crew-split-toggle" />
      </div>

      {enabled && (
        <div className="space-y-4">

          {/* -- Ocean / Surfboard Viz -- */}
          <div className={`relative p-4 rounded-2xl overflow-visible ${
            isLight
              ? 'bg-gradient-to-b from-cyan-100 via-blue-50 to-white'
              : 'bg-gradient-to-b from-cyan-900/30 via-blue-900/20 to-zinc-900'
          }`}>
            {/* Wave pattern */}
            <div className="absolute inset-0 opacity-20 overflow-hidden rounded-2xl">
              <svg viewBox="0 0 400 200" className="w-full h-full" preserveAspectRatio="none">
                <path d="M0,100 Q50,80 100,100 T200,100 T300,100 T400,100 V200 H0 Z" fill="currentColor" className="text-cyan-500" opacity="0.3" />
                <path d="M0,120 Q50,100 100,120 T200,120 T300,120 T400,120 V200 H0 Z" fill="currentColor" className="text-blue-500" opacity="0.2" />
              </svg>
            </div>

            {/* Label */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-cyan-400 font-medium flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              THE LINEUP
            </div>

            {/* Boards row */}
            <div className="relative pt-6 flex justify-center items-end gap-4 flex-wrap">
              {/* Captain */}
              <SchedSurfboardAvatar
                member={{ name: user?.full_name || 'You', avatar_url: user?.avatar_url }}
                index={0}
                isCaptain={true}
                isLight={isLight}
              />
              {/* Crew members */}
              {crewMembers.map((m, idx) => (
                <SchedSurfboardAvatar
                  key={m.user_id}
                  member={m}
                  index={idx + 1}
                  isCaptain={false}
                  onRemove={removeMember}
                  isLight={isLight}
                />
              ))}
              {/* Empty seat */}
              {crewMembers.length < 6 && (
                <SchedEmptySeat onClick={() => setShowSearch(true)} isLight={isLight} />
              )}
            </div>
          </div>

          {/* -- Per-Member Coverage Sliders -- */}
          {crewMembers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className={`text-sm font-medium ${textSecondary}`}>Coverage per crew member</h4>
                {/* Quick actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => onCrewChange(crewMembers.map(m => ({ ...m, captain_cover_percent: Math.round(100 / totalCrew) })))}
                    className={`text-xs px-2 py-1 rounded-full ${
                      isLight ? 'bg-gray-100 text-gray-600' : 'bg-zinc-700 text-gray-300'
                    } hover:text-cyan-400 transition-colors`}
                  >
                    Split Even
                  </button>
                  <button
                    onClick={() => onCrewChange(crewMembers.map(m => ({ ...m, captain_cover_percent: 100 })))}
                    className={`text-xs px-2 py-1 rounded-full ${
                      isLight ? 'bg-purple-50 text-purple-600' : 'bg-purple-500/20 text-purple-400'
                    } hover:opacity-80 transition-opacity`}
                  >
                    Cover All
                  </button>
                  <button
                    onClick={() => onCrewChange(crewMembers.map(m => ({ ...m, captain_cover_percent: 0 })))}
                    className={`text-xs px-2 py-1 rounded-full ${
                      isLight ? 'bg-gray-100 text-gray-600' : 'bg-zinc-700 text-gray-300'
                    } hover:text-amber-400 transition-colors`}
                  >
                    Reset
                  </button>
                </div>
              </div>

              {crewMembers.map((member, idx) => {
                const coverPct = member.captain_cover_percent || 0;
                const memberPays = pricePerPerson * (1 - coverPct / 100);
                const captainCoversAmt = pricePerPerson * (coverPct / 100);
                const boardColor = SCHED_BOARD_COLORS[(idx + 1) % SCHED_BOARD_COLORS.length];

                return (
                  <div key={member.user_id} className={`p-4 rounded-xl ${
                    isLight ? 'bg-gray-50 border border-gray-100' : 'bg-muted/50 border border-zinc-700/50'
                  }`}>
                    {/* Member header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                          style={{ backgroundColor: boardColor.fill, color: '#000' }}
                        >
                          {(member.name || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${textPrimary}`}>{member.name}</p>
                          {member.username && (
                            <p className={`text-xs ${textSecondary}`}>@{member.username}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-cyan-400 font-medium">They pay: ${memberPays.toFixed(2)}</p>
                        {captainCoversAmt > 0 && (
                          <p className="text-xs text-purple-400">You cover: ${captainCoversAmt.toFixed(2)}</p>
                        )}
                      </div>
                    </div>

                    {/* % Slider - how much captain covers of this member's share */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs ${textSecondary}`}>
                          You cover {coverPct}% of their share
                        </span>
                        <span className={`text-xs font-bold ${
                          coverPct === 100 ? 'text-purple-400' : coverPct > 0 ? 'text-cyan-400' : textSecondary
                        }`}>
                          {coverPct === 0 ? 'They pay full' : coverPct === 100 ? 'You cover all' : `$${captainCoversAmt.toFixed(2)} covered`}
                        </span>
                      </div>
                      <input aria-label="Range slider"
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={coverPct}
                        onChange={(e) => updateCoverPercent(member.user_id, parseInt(e.target.value))}
                        className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                        style={{
                          background: `linear-gradient(to right, ${boardColor.fill} 0%, ${boardColor.fill} ${coverPct}%, #3f3f46 ${coverPct}%, #3f3f46 100%)`
                        }}
                      />
                      <div className="flex justify-between mt-1">
                        <span className={`text-[10px] ${textSecondary}`}>0% (they pay)</span>
                        <span className={`text-[10px] ${textSecondary}`}>100% (you cover)</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* -- Search / Add Crew -- */}
          <div className="space-y-2">
            {!showSearch ? (
              <button aria-label="User Plus"
                onClick={() => setShowSearch(true)}
                className={`w-full flex items-center gap-2 p-3 rounded-xl border-2 border-dashed ${
                  isLight ? 'border-cyan-300 text-cyan-600' : 'border-cyan-500/40 text-cyan-400'
                } hover:border-cyan-400 transition-colors`}
              >
                <UserPlus className="w-4 h-4" />
                <span className="text-sm font-medium">Add crew member</span>
              </button>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary}`} />
                  <Input aria-label="Search by name or @username..."
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Search by name or @username..."
                    className={`pl-10 ${isLight ? 'bg-white' : 'bg-zinc-900'}`}
                    autoFocus
                    data-testid="crew-search-input"
                  />
                  {searching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-cyan-400" />
                  )}
                  <button
                    onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}
                    className={`absolute right-9 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full ${
                      isLight ? 'text-gray-400' : 'text-gray-500'
                    } hover:text-red-400`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Search results dropdown */}
                {searchResults.length > 0 && (
                  <div className={`rounded-xl border ${
                    isLight ? 'border-gray-200 bg-white' : 'border-zinc-700 bg-zinc-900'
                  } max-h-48 overflow-y-auto shadow-xl`}>
                    {searchResults.map((result) => (
                      <button aria-label="div"
                        key={result.id}
                        onClick={() => addMember(result)}
                        className={`w-full flex items-center gap-3 p-3 hover:${
                          isLight ? 'bg-gray-50' : 'bg-zinc-800'
                        } transition-colors`}
                      >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center overflow-hidden">
                          {result.avatar_url ? (
                            <img loading="lazy" decoding="async" src={getFullUrl(result.avatar_url)} alt={result.full_name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-white font-bold text-xs">{result.full_name?.[0]?.toUpperCase() || '?'}</span>
                          )}
                        </div>
                        <div className="text-left flex-1">
                          <p className={`text-sm font-medium ${textPrimary}`}>{result.full_name}</p>
                          <p className={`text-xs ${textSecondary}`}>@{result.username}</p>
                        </div>
                        <UserPlus className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* -- Quick Add Pills (Recent / Following) -- */}
          {suggestions.length > 0 && searchQuery.length < 2 && (
            <div className="space-y-2">
              <Label className={textSecondary}>Quick Add</Label>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((person) => (
                  <button aria-label="div"
                    key={person.id}
                    onClick={() => addMember(person)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-full ${cardBg} hover:ring-2 ring-cyan-500/50 transition-all`}
                  >
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center overflow-hidden">
                      {person.avatar_url ? (
                        <img loading="lazy" decoding="async" src={getFullUrl(person.avatar_url)} alt={person.full_name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-white font-bold text-xs">{person.full_name?.[0]?.toUpperCase() || '?'}</span>
                      )}
                    </div>
                    <span className={`text-sm ${textPrimary}`}>{person.full_name?.split(' ')[0]}</span>
                    <UserPlus className="w-3 h-3 text-cyan-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* -- Saved Crews -- */}
          <SavedCrewSelector
            onSelect={(members) => {
              onCrewChange(members.map(m => ({
                user_id: m.user_id,
                name: m.name || m.value,
                username: m.value,
                avatar_url: m.avatar_url,
                payment_status: 'Pending',
                share_amount: 0,
                captain_cover_percent: 0
              })));
            }}
            selectedCrew={null}
            currentMembers={crewMembers}
            compact={true}
          />

          {/* -- Split Summary -- */}
          <div className={`p-4 rounded-xl ${
            isLight
              ? 'bg-gradient-to-r from-cyan-50 to-blue-50'
              : 'bg-gradient-to-r from-cyan-500/10 to-blue-500/10'
          } border border-cyan-500/30`}>
            <div className="flex items-center gap-2 mb-3">
              <Percent className="w-5 h-5 text-cyan-400" />
              <span className={`font-medium ${textPrimary}`}>Split Summary</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className={textSecondary}>Total Session</span>
                <span className={textPrimary}>${totalPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className={textSecondary}>Equal share / person</span>
                <span className={textPrimary}>${pricePerPerson.toFixed(2)}</span>
              </div>
              {captainCovers > 0 && (
                <div className="flex justify-between text-purple-400">
                  <span>You cover for crew</span>
                  <span>+${captainCovers.toFixed(2)}</span>
                </div>
              )}
              <div className={`flex justify-between pt-2 border-t ${
                isLight ? 'border-cyan-200' : 'border-cyan-500/30'
              }`}>
                <span className={`font-bold ${textPrimary} flex items-center gap-1`}>
                  <Crown className="w-3 h-3 text-yellow-400" />
                  Your Total (Captain)
                </span>
                <span className="font-bold text-cyan-400">${captainActualPay.toFixed(2)}</span>
              </div>
              {crewMembers.length > 0 && (
                <div className="space-y-1 mt-1">
                  {crewMembers.map((m, idx) => {
                    const coverPct = m.captain_cover_percent || 0;
                    const memberPays = pricePerPerson * (1 - coverPct / 100);
                    return (
                      <div key={m.user_id} className="flex justify-between text-xs">
                        <span className={textSecondary}>
                          {m.name?.split(' ')[0] || 'Crew'}{coverPct > 0 ? ` (${coverPct}% covered)` : ''}
                        </span>
                        <span className={coverPct === 100 ? 'text-purple-400' : textPrimary}>
                          {coverPct === 100 ? 'You cover' : `$${memberPays.toFixed(2)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className={`mt-3 flex items-center gap-2 p-2 rounded-lg ${
              isLight ? 'bg-yellow-50' : 'bg-yellow-500/10'
            }`}>
              <Crown className="w-4 h-4 text-yellow-400" />
              <span className={`text-xs ${textSecondary}`}>
                As Captain, you pay first. Crew receives payment requests via Messages.
              </span>
            </div>
          </div>

        </div>
      )}
    </div>
  );
};

/**
 * Cross-Sell Suggestion Component
 */
const CrossSellSuggestion = ({ type, _photographerName, onAction, isLight }) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  if (type === 'live_now') {
    return (
      <div className={`p-4 rounded-xl ${isLight ? 'bg-gradient-to-r from-green-50 to-emerald-50' : 'bg-gradient-to-r from-green-500/10 to-emerald-500/10'} border border-green-500/30`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
            <Radio className="w-5 h-5 text-green-400 animate-pulse" />
          </div>
          <div className="flex-1">
            <p className={`font-medium ${textPrimary}`}>Can't Wait?</p>
            <p className={`text-sm ${textSecondary}`}>Check if photographers are live NOW</p>
          </div>
          <Button aria-label="Zap"
            size="sm"
            onClick={() => onAction('live_now')}
            className="bg-green-500 hover:bg-green-600 text-black"
          >
            <Zap className="w-4 h-4 mr-1" />
            Live Now
          </Button>
        </div>
      </div>
    );
  }
  
  return null;
};

/**
 * Success Confirmation Modal
 */
const BookingConfirmation = ({ 
  booking, 
  photographer, 
  onClose, 
  onViewBookings,
  onAddAnotherSpot,
  isLight 
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  return (
    <div className="text-center py-6 space-y-6">
      {/* JSON-LD Event schema for booked session */}
      {booking && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Event',
          name: `Surf Photography Session with ${photographer?.full_name || 'Photographer'}`,
          startDate: booking.session_date || undefined,
          duration: `PT${booking.duration || 60}M`,
          location: {
            '@type': 'Place',
            name: booking.location || 'Surf Spot',
          },
          organizer: {
            '@type': 'Person',
            name: photographer?.full_name || 'Raw Surf Photographer',
          },
          offers: booking.total_paid ? {
            '@type': 'Offer',
            price: booking.total_paid.toFixed(2),
            priceCurrency: 'USD',
          } : undefined,
          eventStatus: 'https://schema.org/EventScheduled',
          eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        }) }} />
      )}
      {/* Success Animation */}
      <div className="relative">
        <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-r from-green-500 to-emerald-500 flex items-center justify-center animate-pulse">
          <CheckCircle2 className="w-12 h-12 text-white" />
        </div>
        <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-yellow-400 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-black" />
        </div>
      </div>
      
      <div>
        <h3 className={`text-2xl font-bold ${textPrimary}`}>Session Booked!</h3>
        <p className={textSecondary}>
          Your session with {photographer?.full_name} is confirmed
        </p>
      </div>
      
      {/* Booking Details */}
      <div className={`p-4 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} text-left space-y-3`}>
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-yellow-400" />
          <div>
            <p className={`font-medium ${textPrimary}`}>
              {booking?.session_date ? new Date(booking.session_date).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              }) : 'Date TBD'}
            </p>
            <p className={`text-sm ${textSecondary}`}>{booking?.duration || 60} minutes</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-orange-400" />
          <div>
            <p className={`font-medium ${textPrimary}`}>Impact Zone</p>
            <p className={`text-sm ${textSecondary}`}>{booking?.location || 'Location set'}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <DollarSign className="w-5 h-5 text-green-400" />
          <div>
            <p className={`font-medium ${textPrimary}`}>${booking?.total_paid?.toFixed(2) || '0.00'}</p>
            <p className={`text-sm ${textSecondary}`}>Total Paid</p>
          </div>
        </div>
      </div>
      
      {/* Push Notification Notice */}
      <div className={`flex items-center gap-2 p-3 rounded-lg ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'} border ${isLight ? 'border-blue-200' : 'border-blue-500/30'}`}>
        <Bell className="w-5 h-5 text-blue-400" />
        <p className={`text-sm ${isLight ? 'text-blue-700' : 'text-blue-300'}`}>
          You'll receive a notification when it's time to head out!
        </p>
      </div>
      
      {/* Gamification - XP Earned */}
      <div className={`flex items-center justify-center gap-2 p-3 rounded-lg bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30`}>
        <Gift className="w-5 h-5 text-purple-400" />
        <span className={`font-medium ${textPrimary}`}>+50 XP earned!</span>
        <Badge className="bg-purple-500/20 text-purple-400 text-xs">Passport</Badge>
      </div>
      
      {/* Escrow Protection Notice */}
      <div className={`flex items-center gap-2 p-3 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'} border ${isLight ? 'border-green-200' : 'border-green-500/30'}`}>
        <Check className="w-5 h-5 text-green-400" />
        <p className={`text-sm ${isLight ? 'text-green-700' : 'text-green-300'}`}>
          Payment protected until session complete & content delivered
        </p>
      </div>
      
      {/* Actions */}
      <div className="flex flex-col gap-3">
        <Button aria-label="Location"
          onClick={onAddAnotherSpot}
          className="w-full bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-500 hover:to-blue-600 text-black font-bold"
          data-testid="add-another-spot-btn"
        >
          <MapPin className="w-4 h-4 mr-2" />
          Add Another Spot to This Trip
        </Button>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 border-zinc-700"
          >
            Close
          </Button>
          <Button
            onClick={onViewBookings}
            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black"
          >
            View My Bookings
          </Button>
        </div>
      </div>
    </div>
  );
};

export {
  DURATION_PRICES,
  SchedSurfboardAvatar,
  SchedEmptySeat,
  SCHED_BOARD_COLORS,
  CrewSplitSection,
  CrossSellSuggestion,
  BookingConfirmation
};
