/**
 * RequestProModal — Unified "Request a Pro Photographer" flow
 *
 * Features:
 *  ● Auto-match or specific photographer selection (Uber style)
 *  ● Location display (nearest surf spot or GPS coordinates)
 *  ● Scheduled arrival time: 30 / 60 / 90 minutes from now
 *  ● Session duration: 0.5 / 1 / 2 / 3 hours
 *  ● Crew / Split Fare — full surfboard lineup UI (pool-table style)
 *  ● Captain's Hub: per-member % slider + "I'll cover" toggle
 *  ● Live cost breakdown (rate × duration, split share, 25% deposit)
 *  ● Boost Your Request (credits-based priority)
 *  ● Proper sticky header / scrollable body / sticky footer layout
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Camera, MapPin, Clock, Loader2, Target, Check,
  X, Zap, ChevronDown, ChevronUp, Plus, Award, Calculator,
  Wallet, Users,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '../ui/dialog';
import { toast } from 'sonner';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// ─── Surfboard colour palette (matches OnDemandRequestDrawer) ────────────────
const SURFBOARD_COLORS = [
  { fill: '#FCD34D', stroke: '#F59E0B' }, // Yellow — captain/you
  { fill: '#22D3EE', stroke: '#0891B2' }, // Cyan
  { fill: '#F472B6', stroke: '#DB2777' }, // Pink
  { fill: '#A78BFA', stroke: '#7C3AED' }, // Purple
  { fill: '#34D399', stroke: '#059669' }, // Green
  { fill: '#FB923C', stroke: '#EA580C' }, // Orange
  { fill: '#60A5FA', stroke: '#2563EB' }, // Blue
];

// ─── Surfboard + avatar compound component ───────────────────────────────────
const SurfboardAvatar = ({ member, index, isCaptain, onRemove }) => {
  const board = SURFBOARD_COLORS[index % SURFBOARD_COLORS.length];
  return (
    <div className="relative group flex flex-col items-center">
      {/* Surfboard SVG */}
      <svg
        viewBox="0 0 60 100"
        className="absolute left-1/2 -translate-x-1/2 top-2 w-12 h-20 pointer-events-none"
        style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}
      >
        <ellipse cx="30" cy="50" rx="12" ry="38" fill={board.fill} stroke={board.stroke} strokeWidth="2" />
        <line x1="30" y1="14" x2="30" y2="86" stroke={board.stroke} strokeWidth="1.5" opacity="0.6" />
        <ellipse cx="30" cy="16" rx="3" ry="2.5" fill={board.stroke} opacity="0.4" />
        <path d="M30 78 L27 86 L30 83 L33 86 Z" fill={board.stroke} opacity="0.7" />
      </svg>

      {/* Avatar circle */}
      <div className="relative z-10">
        <div className={`w-11 h-11 rounded-full overflow-hidden ${isCaptain ? 'ring-2 ring-yellow-400' : 'ring-2 ring-cyan-400/50'} transition-all group-hover:scale-105`}>
          {member.avatar_url ? (
            <img src={member.avatar_url} alt={member.name || 'crew'} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center font-bold text-sm ${isCaptain ? 'bg-gradient-to-br from-yellow-400 to-orange-500' : 'bg-gradient-to-br from-cyan-400 to-blue-500'} text-black`}>
              {(member.name || member.value)?.[0]?.toUpperCase() || '?'}
            </div>
          )}
        </div>
        {/* Captain crown */}
        {isCaptain && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2">
            <Award className="w-4 h-4 text-yellow-400 drop-shadow-lg" />
          </div>
        )}
        {/* Remove button */}
        {!isCaptain && onRemove && (
          <button
            onClick={() => onRemove(member.id)}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Name label */}
      <div className="text-center mt-8 max-w-[70px]">
        <p className="text-[10px] font-medium text-white truncate">
          {isCaptain ? 'You' : (member.name || member.value?.split('@')[0] || 'Crew')}
        </p>
      </div>
    </div>
  );
};

// ─── Empty seat (dashed surfboard) ──────────────────────────────────────────
const EmptySeat = ({ onClick }) => (
  <div className="relative group cursor-pointer flex flex-col items-center" onClick={onClick}>
    <svg viewBox="0 0 60 100" className="absolute left-1/2 -translate-x-1/2 top-2 w-12 h-20 pointer-events-none opacity-40 group-hover:opacity-60 transition-opacity">
      <ellipse cx="30" cy="50" rx="12" ry="38" fill="none" stroke="#64748B" strokeWidth="2" strokeDasharray="6 4" />
      <line x1="30" y1="18" x2="30" y2="82" stroke="#64748B" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
    </svg>
    <div className="relative z-10 w-11 h-11 rounded-full border-2 border-dashed border-cyan-500/50 bg-cyan-500/10 flex items-center justify-center transition-all group-hover:scale-105 group-hover:border-cyan-400">
      <Plus className="w-5 h-5 text-cyan-500 group-hover:text-cyan-400" />
    </div>
    <div className="text-center mt-8">
      <p className="text-[10px] text-gray-500">Add crew</p>
    </div>
  </div>
);

// ─── Duration pills ──────────────────────────────────────────────────────────
const DURATIONS = [
  { value: 0.5, label: '30m' },
  { value: 1,   label: '1h'  },
  { value: 2,   label: '2h'  },
  { value: 3,   label: '3h'  },
];

// ─── Boost options ───────────────────────────────────────────────────────────
const BOOST_OPTIONS = [
  { hours: 1, credits: 5,  label: '1h' },
  { hours: 2, credits: 10, label: '2h' },
  { hours: 4, credits: 20, label: '4h' },
];

// ─── Main component ───────────────────────────────────────────────────────────
export const RequestProModal = ({
  isOpen,
  onClose,
  // Auth / user
  userId,
  user,
  // Location
  userLocation,
  nearestSpot,
  // On-demand photographers nearby (optional — pre-fetched by MapPage)
  onDemandPhotographers = [],
  onDemandLoading = false,
  // Callbacks
  onSuccess,
  onBoostApplied,
}) => {
  // ── Photographer selection ──────────────────────────────────────────────
  const [selectedPro, setSelectedPro]         = useState(null);
  const [proListExpanded, setProListExpanded] = useState(false);

  // ── Scheduled start time ────────────────────────────────────────────────
  const [startTimeOption, setStartTimeOption] = useState(30);

  // ── Session duration ────────────────────────────────────────────────────
  const [duration, setDuration] = useState(1);

  // ── Crew / split state (mirrors OnDemandRequestDrawer) ─────────────────
  const [crewOpen, setCrewOpen]                   = useState(false);
  const [crewMembers, setCrewMembers]             = useState([]);
  const [showAddCrewInput, setShowAddCrewInput]   = useState(false);
  const [newCrewInput, setNewCrewInput]           = useState('');
  const [friendSearchResults, setFriendSearchResults] = useState([]);
  const [searchingFriends, setSearchingFriends]   = useState(false);
  const [showCaptainsHub, setShowCaptainsHub]     = useState(false);

  // ── Boost ───────────────────────────────────────────────────────────────
  const [boostHours, setBoostHours] = useState(0);

  // ── Submission ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setSelectedPro(null);
      setProListExpanded(false);
      setStartTimeOption(30);
      setDuration(1);
      setCrewOpen(false);
      setCrewMembers([]);
      setShowAddCrewInput(false);
      setNewCrewInput('');
      setFriendSearchResults([]);
      setShowCaptainsHub(false);
      setBoostHours(0);
      setLoading(false);
    }
  }, [isOpen]);

  // ── Pricing ─────────────────────────────────────────────────────────────
  const hourlyRate       = selectedPro?.on_demand_hourly_rate || 75;
  const totalCost        = hourlyRate * duration;
  const totalParticipants = crewMembers.length + 1;
  const perPersonSplit   = (totalCost / totalParticipants).toFixed(2);

  // Captain's actual pay = total minus what crew covers themselves
  const crewCoversAmount = crewMembers.reduce(
    (sum, m) => sum + (m.covered_by_captain ? 0 : (m.share_amount || parseFloat(perPersonSplit))),
    0
  );
  const captainPayAmount = totalCost - crewCoversAmount;
  const depositAmount    = (captainPayAmount * 0.25).toFixed(0);

  // ── Debounced user search for crew autocomplete ─────────────────────────
  useEffect(() => {
    if (newCrewInput.length < 2) { setFriendSearchResults([]); return; }
    const tid = setTimeout(async () => {
      setSearchingFriends(true);
      try {
        const res = await axios.get(`${API}/users/search?query=${encodeURIComponent(newCrewInput)}&limit=5`);
        const existing = new Set([userId || user?.id, ...crewMembers.map(m => m.user_id || m.id)]);
        setFriendSearchResults((res.data.users || []).filter(u => !existing.has(u.id)));
      } catch { setFriendSearchResults([]); }
      finally { setSearchingFriends(false); }
    }, 300);
    return () => clearTimeout(tid);
  }, [newCrewInput, userId, user?.id, crewMembers]);

  // ── Crew helpers ─────────────────────────────────────────────────────────
  const addCrewMember = useCallback((friend) => {
    const newTotal = crewMembers.length + 2;
    const share = totalCost / newTotal;
    const updated = crewMembers.map(m => ({ ...m, share_amount: m.covered_by_captain ? 0 : share, share_percentage: 100 / newTotal }));
    setCrewMembers([...updated, {
      id: friend?.id || Date.now(),
      user_id: friend?.id || null,
      value: friend ? (friend.username ? `@${friend.username}` : friend.full_name) : newCrewInput.trim(),
      name: friend?.full_name || newCrewInput.trim(),
      username: friend?.username || null,
      avatar_url: friend?.avatar_url || null,
      type: friend ? 'user' : (newCrewInput.includes('@') && !newCrewInput.startsWith('@') ? 'email' : 'username'),
      status: 'pending',
      share_amount: share,
      share_percentage: 100 / newTotal,
      covered_by_captain: false,
    }]);
    setNewCrewInput('');
    setFriendSearchResults([]);
    setShowAddCrewInput(false);
    toast.success(`Added ${friend?.full_name || newCrewInput.trim()} to crew`);
  }, [crewMembers, totalCost, newCrewInput]);

  const removeCrewMember = (memberId) => {
    const filtered = crewMembers.filter(m => m.id !== memberId);
    if (filtered.length > 0) {
      const newTotal = filtered.length + 1;
      const share = totalCost / newTotal;
      setCrewMembers(filtered.map(m => ({ ...m, share_amount: m.covered_by_captain ? 0 : share, share_percentage: 100 / newTotal })));
    } else {
      setCrewMembers([]);
    }
  };

  const handlePercentageChange = (memberId, pct) => {
    const amount = (pct / 100) * totalCost;
    setCrewMembers(prev => prev.map(m => m.id === memberId ? { ...m, share_percentage: pct, share_amount: amount } : m));
  };

  const toggleCoverMember = (memberId) => {
    setCrewMembers(prev => prev.map(m => m.id === memberId
      ? { ...m, covered_by_captain: !m.covered_by_captain, share_amount: !m.covered_by_captain ? 0 : parseFloat(perPersonSplit) }
      : m
    ));
  };

  const distributeEvenly = () => {
    const share = totalCost / totalParticipants;
    const pct   = 100 / totalParticipants;
    setCrewMembers(prev => prev.map(m => ({ ...m, share_amount: share, share_percentage: pct, covered_by_captain: false })));
    toast.success('Split evenly among all surfers');
  };

  const coverAll = () => {
    setCrewMembers(prev => prev.map(m => ({ ...m, share_amount: 0, covered_by_captain: true })));
    toast.success("You're covering the whole crew! 🤙");
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!userLocation) { toast.error('Location required to request a Pro'); return; }
    setLoading(true);
    try {
      const uid = userId || user?.id;
      const requestedStartTime = new Date(Date.now() + startTimeOption * 60000).toISOString();

      const crewSharesPayload = crewMembers.length > 0
        ? crewMembers.map(m => ({
            user_id: m.user_id || m.id || m.value,
            share_amount: m.covered_by_captain ? 0 : (m.share_amount || parseFloat(perPersonSplit)),
            covered_by_captain: m.covered_by_captain || false,
          }))
        : null;

      const response = await axios.post(
        `${API}/dispatch/request?requester_id=${uid}`,
        {
          latitude:                 userLocation.lat,
          longitude:                userLocation.lng,
          location_name:            nearestSpot?.name || 'Current Location',
          spot_id:                  nearestSpot?.id || null,
          estimated_duration_hours: duration,
          is_immediate:             true,
          requested_start_time:     requestedStartTime,
          arrival_window_minutes:   startTimeOption,
          is_shared:                crewMembers.length > 0,
          target_photographer_id:   selectedPro?.id || null,
          friend_ids:               crewMembers.length > 0 ? crewMembers.map(m => m.user_id || m.id || m.value) : null,
          captain_share_amount:     crewMembers.length > 0 ? captainPayAmount : null,
          crew_shares:              crewSharesPayload,
        }
      );

      const dispatchId = response.data.id;
      onClose();

      if (crewMembers.length > 0) {
        toast.success(`Request sent! Invites sent to ${crewMembers.length} crew member${crewMembers.length > 1 ? 's' : ''} (10 min to accept)`);
      } else {
        toast.success('Request created! Proceeding to payment…');
      }

      setTimeout(async () => {
        try {
          await axios.post(`${API}/dispatch/${dispatchId}/pay?payer_id=${uid}`);
          toast.success('Payment confirmed! Searching for a Pro…');
          if (boostHours > 0) {
            try {
              await axios.post(`${API}/dispatch/request/${dispatchId}/boost?user_id=${uid}`, { boost_hours: boostHours });
              toast.success(`🚀 Boosted! You'll appear first for ${boostHours}h`);
              onBoostApplied?.();
            } catch (e) {
              toast.error(e.response?.data?.detail || 'Failed to boost');
            }
          }
          onSuccess?.(dispatchId);
        } catch { toast.error('Payment failed. Please try again.'); }
      }, 1000);

    } catch (error) {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Failed to create request');
    } finally {
      setLoading(false);
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="bg-zinc-900 border-zinc-800 text-white sm:max-w-md"
        hideCloseButton={false}
      >
        {/* ── STICKY HEADER ───────────────────────────────────────────────── */}
        <DialogHeader className="border-b border-zinc-800 bg-zinc-900">
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500/30 to-blue-500/30 flex items-center justify-center">
              <Camera className="w-4 h-4 text-cyan-400" />
            </span>
            Request a Pro
          </DialogTitle>
          <p className="text-gray-400 text-xs mt-0.5">
            On-demand surf photographer — at your break within the hour
          </p>
        </DialogHeader>

        {/* ── SCROLLABLE BODY ─────────────────────────────────────────────── */}
        <div className="modal-body px-4 sm:px-5 py-4 space-y-4">

          {/* ── 1. Photographer selection ──────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-300">
                {onDemandLoading
                  ? 'Finding pros near you…'
                  : onDemandPhotographers.length > 0
                    ? `${onDemandPhotographers.length} Pro${onDemandPhotographers.length > 1 ? 's' : ''} Nearby`
                    : 'No pros available right now'}
              </span>
              {onDemandPhotographers.length > 0 && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                  Live
                </span>
              )}
            </div>

            {onDemandLoading ? (
              <div className="flex items-center justify-center py-5">
                <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
              </div>
            ) : onDemandPhotographers.length > 0 ? (
              <div className="space-y-1.5">
                {/* Auto-match pill */}
                <button
                  onClick={() => setSelectedPro(null)}
                  className={`w-full px-3 py-2.5 rounded-xl flex items-center gap-3 transition-all ${
                    selectedPro === null
                      ? 'bg-cyan-500/20 border border-cyan-400'
                      : 'bg-zinc-800/60 hover:bg-zinc-700/60 border border-transparent'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shrink-0">
                    <Target className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold">Auto-Match (Fastest)</p>
                    <p className="text-xs text-gray-400">Nearest available pro dispatched instantly</p>
                  </div>
                  {selectedPro === null && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
                </button>

                {/* Individual photographers */}
                {(proListExpanded ? onDemandPhotographers : onDemandPhotographers.slice(0, 3)).map((pro) => (
                  <button
                    key={pro.id}
                    onClick={() => setSelectedPro(pro)}
                    className={`w-full px-3 py-2.5 rounded-xl flex items-center gap-3 transition-all ${
                      selectedPro?.id === pro.id
                        ? 'bg-cyan-500/20 border border-cyan-400'
                        : 'bg-zinc-800/60 hover:bg-zinc-700/60 border border-transparent'
                    }`}
                  >
                    {pro.avatar_url ? (
                      <img src={pro.avatar_url} alt={pro.full_name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                        {pro.full_name?.charAt(0) || 'P'}
                      </div>
                    )}
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm font-medium flex items-center gap-1.5 truncate">
                        {pro.full_name}
                        {pro.role === 'Approved Pro' && (
                          <span className="text-[9px] px-1 py-0.5 bg-yellow-500/20 text-yellow-400 rounded font-bold shrink-0">PRO</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 flex items-center gap-1.5">
                        {pro.distance != null && <span>{pro.distance} mi</span>}
                        <span>·</span>
                        <span>${pro.on_demand_hourly_rate}/hr</span>
                      </p>
                    </div>
                    {selectedPro?.id === pro.id && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
                  </button>
                ))}

                {onDemandPhotographers.length > 3 && (
                  <button
                    onClick={() => setProListExpanded(v => !v)}
                    className="w-full py-1.5 text-xs text-cyan-400 hover:text-cyan-300 flex items-center justify-center gap-1 transition-colors"
                  >
                    {proListExpanded ? <><ChevronUp className="w-3.5 h-3.5" /> Show fewer</> : <><ChevronDown className="w-3.5 h-3.5" /> {onDemandPhotographers.length - 3} more pros</>}
                  </button>
                )}
              </div>
            ) : (
              <div className="px-3 py-4 bg-zinc-800/40 rounded-xl text-center">
                <p className="text-gray-400 text-sm">No pros available in your area right now.</p>
                <p className="text-xs text-gray-500 mt-1">Your request will be broadcast to all nearby photographers.</p>
              </div>
            )}
          </section>

          {/* ── 2. Location ────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-800/50 rounded-xl">
            <MapPin className="w-4 h-4 text-yellow-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {nearestSpot ? `Near ${nearestSpot.name}` : 'Your Location'}
              </p>
              {userLocation && (
                <p className="text-xs text-gray-500">
                  {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
                </p>
              )}
            </div>
          </div>

          {/* ── 3. Scheduled arrival time ───────────────────────────────────── */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-300">
              <Clock className="w-4 h-4" />
              When do you want the Pro to arrive?
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 30, label: '30 min' },
                { value: 60, label: '1 hour' },
                { value: 90, label: '90 min' },
              ].map(({ value, label }) => {
                const t = new Date(Date.now() + value * 60000);
                const ts = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                return (
                  <button
                    key={value}
                    onClick={() => setStartTimeOption(value)}
                    className={`py-2.5 px-2 rounded-xl flex flex-col items-center transition-all ${
                      startTimeOption === value
                        ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20'
                        : 'bg-zinc-800 text-gray-300 hover:bg-zinc-700'
                    }`}
                  >
                    <span className="text-sm font-bold">{label}</span>
                    <span className={`text-[10px] mt-0.5 ${startTimeOption === value ? 'text-black/70' : 'text-gray-500'}`}>{ts}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── 4. Session duration ─────────────────────────────────────────── */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-300">
              <Clock className="w-4 h-4" />
              Session Duration
            </label>
            <div className="grid grid-cols-4 gap-2">
              {DURATIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setDuration(value)}
                  className={`py-2 rounded-xl text-sm font-semibold transition-all ${
                    duration === value
                      ? 'bg-cyan-400 text-black shadow-lg shadow-cyan-500/20'
                      : 'bg-zinc-800 text-gray-300 hover:bg-zinc-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* ── 5. Crew / Split — surfboard lineup ─────────────────────────── */}
          <div className="bg-zinc-800/50 rounded-xl overflow-hidden">
            {/* Toggle header */}
            <div className="flex items-center justify-between px-3 py-3">
              <div>
                <p className="text-sm font-medium text-white flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-cyan-400" />
                  Invite Crew to Split
                </p>
                <p className="text-xs text-gray-400">10 min to accept · cost split equally</p>
              </div>
              <button
                onClick={() => setCrewOpen(v => !v)}
                className={`w-11 h-6 rounded-full relative transition-colors duration-200 ${crewOpen ? 'bg-cyan-400' : 'bg-zinc-600'}`}
                aria-label="Toggle crew invite"
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${crewOpen ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            {crewOpen && (
              <div className="border-t border-zinc-700">

                {/* ── OCEAN / LINEUP VISUALIZATION ── */}
                <div className="relative p-4 bg-gradient-to-b from-cyan-900/30 via-blue-900/20 to-zinc-900">
                  {/* Wave SVG background */}
                  <div className="absolute inset-0 opacity-20 overflow-hidden rounded-b-none">
                    <svg viewBox="0 0 400 200" className="w-full h-full" preserveAspectRatio="none">
                      <path d="M0,100 Q50,80 100,100 T200,100 T300,100 T400,100 V200 H0 Z" fill="currentColor" className="text-cyan-500" opacity="0.3" />
                      <path d="M0,120 Q50,100 100,120 T200,120 T300,120 T400,120 V200 H0 Z" fill="currentColor" className="text-blue-500" opacity="0.2" />
                    </svg>
                  </div>

                  {/* "THE LINEUP" label */}
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-cyan-400 font-medium flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    THE LINEUP
                  </div>

                  {/* Surfboard arc */}
                  <div className="relative pt-6">
                    {/* Captain (you) — top center */}
                    <div className="flex justify-center mb-2">
                      <SurfboardAvatar
                        member={{ name: user?.full_name || 'You', avatar_url: user?.avatar_url }}
                        index={0}
                        isCaptain={true}
                      />
                    </div>

                    {/* Crew row */}
                    <div className="flex justify-center items-end gap-4 flex-wrap">
                      {crewMembers.map((m, idx) => (
                        <SurfboardAvatar
                          key={m.id}
                          member={m}
                          index={idx + 1}
                          isCaptain={false}
                          onRemove={removeCrewMember}
                        />
                      ))}
                      {crewMembers.length < 6 && (
                        <EmptySeat onClick={() => setShowAddCrewInput(true)} />
                      )}
                    </div>
                  </div>

                  {/* Add crew input + autocomplete */}
                  {showAddCrewInput && (
                    <div className="mt-4 relative z-20">
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <input
                            type="text"
                            value={newCrewInput}
                            onChange={e => setNewCrewInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && friendSearchResults.length === 0 && newCrewInput.trim()) addCrewMember(null); }}
                            placeholder="Search by name or @username"
                            autoFocus
                            className="w-full bg-zinc-700/80 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400"
                          />
                          {/* Autocomplete dropdown */}
                          {(friendSearchResults.length > 0 || searchingFriends) && (
                            <div className="absolute top-full left-0 right-0 mt-1 rounded-xl shadow-2xl border border-zinc-600 bg-zinc-800" style={{ zIndex: 9999 }}>
                              {searchingFriends && (
                                <div className="p-3 flex items-center gap-2 text-sm text-gray-400">
                                  <Loader2 className="w-4 h-4 animate-spin" /> Searching…
                                </div>
                              )}
                              {friendSearchResults.map(friend => (
                                <button
                                  key={friend.id}
                                  onClick={() => addCrewMember(friend)}
                                  className="w-full p-3 flex items-center gap-3 text-left hover:bg-zinc-700 transition-colors"
                                >
                                  <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-600 flex-shrink-0">
                                    {friend.avatar_url
                                      ? <img src={friend.avatar_url} alt="" className="w-full h-full object-cover" />
                                      : <div className="w-full h-full flex items-center justify-center text-xs font-bold text-gray-300">{friend.full_name?.[0]?.toUpperCase() || '?'}</div>
                                    }
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-white truncate">{friend.full_name}</p>
                                    {friend.username && <p className="text-xs text-gray-400 truncate">@{friend.username}</p>}
                                  </div>
                                  <Plus className="w-4 h-4 text-cyan-400 shrink-0" />
                                </button>
                              ))}
                              {!searchingFriends && friendSearchResults.length === 0 && newCrewInput.length >= 2 && (
                                <div className="p-3 text-sm text-gray-400">No users found. Press Enter to add manually.</div>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => newCrewInput.trim() && addCrewMember(null)}
                          disabled={!newCrewInput.trim()}
                          className="px-3 py-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 text-black rounded-lg transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { setShowAddCrewInput(false); setNewCrewInput(''); setFriendSearchResults([]); }}
                          className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-gray-300 rounded-lg transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── CAPTAIN'S HUB (only when crew present) ── */}
                {crewMembers.length > 0 && (
                  <div className="p-3 space-y-3 bg-zinc-800/80">
                    {/* Captain's Hub toggle header */}
                    <button
                      onClick={() => setShowCaptainsHub(v => !v)}
                      className="w-full flex items-center justify-between text-sm font-medium text-white"
                    >
                      <span className="flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-yellow-400" />
                        Captain's Hub
                        <Badge className="bg-purple-500/20 text-purple-300 text-[10px] ml-1">{totalParticipants} surfers</Badge>
                      </span>
                      {showCaptainsHub ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </button>

                    {/* Summary (always visible) */}
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Your share</span>
                      <span className="text-yellow-400 font-bold">${captainPayAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Even split</span>
                      <span className="text-emerald-400 font-medium">${perPersonSplit}/person</span>
                    </div>

                    {/* Expandable controls */}
                    {showCaptainsHub && (
                      <div className="space-y-3 pt-1 border-t border-zinc-700">
                        {/* Quick actions */}
                        <div className="flex gap-2">
                          <button
                            onClick={distributeEvenly}
                            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-gray-200 transition-colors"
                          >
                            <Calculator className="w-3.5 h-3.5" /> Even Split
                          </button>
                          <button
                            onClick={coverAll}
                            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-xs text-purple-300 border border-purple-500/30 transition-colors"
                          >
                            <Wallet className="w-3.5 h-3.5" /> I'll Cover All
                          </button>
                        </div>

                        {/* Per-member controls */}
                        {crewMembers.map((m, idx) => {
                          const share = m.share_amount || parseFloat(perPersonSplit);
                          const pct   = m.share_percentage || (100 / totalParticipants);
                          const board = SURFBOARD_COLORS[(idx + 1) % SURFBOARD_COLORS.length];
                          const isCovered = m.covered_by_captain;
                          return (
                            <div key={m.id} className="p-3 rounded-xl bg-zinc-700/50 space-y-2">
                              {/* Member header */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black"
                                    style={{ backgroundColor: board.fill }}
                                  >
                                    {(m.name || m.value)?.[0]?.toUpperCase() || 'C'}
                                  </div>
                                  <p className="text-sm font-medium text-white">{m.name || m.value?.split('@')[0] || `Crew ${idx + 1}`}</p>
                                </div>
                                {isCovered ? (
                                  <Badge className="bg-purple-500/20 text-purple-300 text-[10px]">
                                    <Wallet className="w-3 h-3 mr-1" />You Cover
                                  </Badge>
                                ) : (
                                  <Badge className="bg-amber-500/20 text-amber-400 text-[10px]">${share.toFixed(2)}</Badge>
                                )}
                              </div>

                              {/* % slider */}
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[10px] text-gray-400">Share: {pct.toFixed(0)}%</span>
                                  <span className={`text-xs font-bold ${isCovered ? 'line-through text-gray-500' : 'text-white'}`}>${share.toFixed(2)}</span>
                                </div>
                                <input
                                  type="range" min={0} max={100} value={pct}
                                  onChange={e => handlePercentageChange(m.id, parseFloat(e.target.value))}
                                  disabled={isCovered}
                                  className="w-full h-2 rounded-lg appearance-none cursor-pointer disabled:opacity-40"
                                  style={{ background: isCovered ? '#3f3f46' : `linear-gradient(to right, ${board.fill} 0%, ${board.fill} ${pct}%, #3f3f46 ${pct}%, #3f3f46 100%)` }}
                                />
                              </div>

                              {/* "I'll cover" toggle */}
                              <div className={`flex items-center justify-between p-2 rounded-lg transition-colors ${isCovered ? 'bg-purple-500/20' : 'bg-zinc-600/40'}`}>
                                <span className={`text-xs ${isCovered ? 'text-purple-300' : 'text-gray-400'}`}>I'll cover this surfer</span>
                                <button
                                  onClick={() => toggleCoverMember(m.id)}
                                  className={`w-10 h-5 rounded-full relative transition-colors ${isCovered ? 'bg-purple-500' : 'bg-zinc-600'}`}
                                >
                                  <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${isCovered ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 10-min window note */}
                    <div className="flex items-start gap-2 p-2.5 bg-amber-500/10 border border-amber-500/25 rounded-lg">
                      <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-200/80 leading-relaxed">
                        Crew has <strong>10 minutes</strong> to accept. Those who don't respond miss out. Cost splits among confirmed members.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 6. Price breakdown ─────────────────────────────────────────── */}
          <div className="bg-gradient-to-r from-cyan-900/30 to-blue-900/30 rounded-xl border border-cyan-500/25 overflow-hidden">
            <div className="px-3 pt-3 pb-2 space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Rate</span>
                <span className="text-white">${hourlyRate}/hr × {duration}h</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Session Total</span>
                <span className="text-white font-semibold">${totalCost.toFixed(0)}</span>
              </div>
              {crewMembers.length > 0 && (
                <div className="flex items-center justify-between text-sm pt-1 border-t border-zinc-700/50">
                  <span className="text-emerald-400">Your Share ({totalParticipants} split)</span>
                  <span className="text-emerald-400 font-semibold">~${captainPayAmount.toFixed(0)}</span>
                </div>
              )}
            </div>
            <div className="px-3 py-2.5 border-t border-cyan-500/20 bg-cyan-500/5 flex items-center justify-between">
              <span className="text-cyan-400 font-medium text-sm">Your Deposit (25%)</span>
              <span className="text-cyan-400 font-bold text-base">${depositAmount}</span>
            </div>
          </div>

          {/* ── 7. Boost Your Request ───────────────────────────────────────── */}
          <div className="bg-gradient-to-r from-orange-900/30 to-red-900/25 rounded-xl border border-orange-500/25 p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-orange-400" />
              <span className="text-orange-400 font-bold text-sm">Boost Your Request</span>
              <span className="ml-auto text-xs text-gray-500">Optional</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {BOOST_OPTIONS.map(({ hours, credits, label }) => (
                <button
                  key={hours}
                  onClick={() => setBoostHours(boostHours === hours ? 0 : hours)}
                  className={`py-2 rounded-xl text-center transition-all ${
                    boostHours === hours
                      ? 'bg-orange-500 text-white ring-2 ring-orange-400 shadow-lg shadow-orange-500/20'
                      : 'bg-zinc-800/80 text-gray-300 hover:bg-zinc-700'
                  }`}
                >
                  <p className="text-sm font-bold">{credits}</p>
                  <p className="text-[10px] text-gray-400">credits/{label}</p>
                </button>
              ))}
            </div>
            {boostHours > 0 && (
              <p className="text-xs text-orange-300/80">
                🚀 Your request will appear first to all pros for {boostHours} hour{boostHours > 1 ? 's' : ''}
              </p>
            )}
          </div>

          {/* Disclaimer */}
          <p className="text-[10px] text-gray-500 text-center">
            Deposit is non-refundable once a Pro accepts and starts traveling to you.
          </p>
        </div>

        {/* ── STICKY FOOTER ───────────────────────────────────────────────── */}
        <DialogFooter className="bg-zinc-900 border-zinc-800 gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-zinc-600 text-white hover:bg-zinc-800 flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !userLocation}
            className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold flex-1 sm:flex-none disabled:opacity-50"
            data-testid="request-pro-submit"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              `Pay $${depositAmount} Deposit`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RequestProModal;
