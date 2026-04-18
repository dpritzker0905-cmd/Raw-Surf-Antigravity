/**
 * RequestProModal — Unified "Request a Pro Photographer" flow
 *
 * Pulls together all features from both the old extracted component
 * and the MapPage inline dialog into one comprehensive, well-laid-out modal.
 *
 * Features:
 *  ● Auto-match or specific photographer selection (Uber style)
 *  ● Location display (nearest surf spot or GPS coordinates)
 *  ● Session duration: 0.5 / 1 / 2 / 3 hours
 *  ● Invite Friends to Split (10 min accept window, Uber Split Fare style)
 *  ● Live cost breakdown (rate × duration, split share, 25% deposit)
 *  ● Boost Your Request (credits-based priority)
 *  ● Payment + post-payment boost API calls
 *  ● Proper sticky header / scrollable body / sticky footer layout
 */

import React, { useState, useEffect } from 'react';
import {
  Camera, MapPin, Clock, Loader2, Target, Check, Users,
  X, Zap, ChevronDown, ChevronUp
} from 'lucide-react';
import { Button } from '../ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '../ui/dialog';
import { toast } from 'sonner';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// ─── Duration pills ─────────────────────────────────────────────────────────
const DURATIONS = [
  { value: 0.5, label: '30m' },
  { value: 1,   label: '1h' },
  { value: 2,   label: '2h' },
  { value: 3,   label: '3h' },
];

// ─── Boost options ───────────────────────────────────────────────────────────
const BOOST_OPTIONS = [
  { hours: 1,  credits: 5,  label: '1h' },
  { hours: 2,  credits: 10, label: '2h' },
  { hours: 4,  credits: 20, label: '4h' },
];

// ─── Component ───────────────────────────────────────────────────────────────
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
  // Friends list (optional — pre-fetched by MapPage)
  friendsList = [],
  friendsLoading = false,
  // Callbacks
  onSuccess,          // (dispatchId) => void — called after successful pay
  onBoostApplied,     // optional
}) => {
  // ── Photographer selection ──────────────────────────────────────────────
  const [selectedPro, setSelectedPro]           = useState(null);
  const [proListExpanded, setProListExpanded]   = useState(false);

  // ── Session duration ────────────────────────────────────────────────────
  const [duration, setDuration]       = useState(1);

  // ── Invite friends ──────────────────────────────────────────────────────
  const [inviteFriends, setInviteFriends]       = useState(false);
  const [selectedFriends, setSelectedFriends]   = useState([]);
  const [friendSearch, setFriendSearch]         = useState('');
  const [friendPickerOpen, setFriendPickerOpen] = useState(false);

  // ── Boost ───────────────────────────────────────────────────────────────
  const [boostHours, setBoostHours]             = useState(0);

  // ── Submission ──────────────────────────────────────────────────────────
  const [loading, setLoading]                   = useState(false);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedPro(null);
      setProListExpanded(false);
      setDuration(1);
      setInviteFriends(false);
      setSelectedFriends([]);
      setFriendSearch('');
      setFriendPickerOpen(false);
      setBoostHours(0);
      setLoading(false);
    }
  }, [isOpen]);

  // ── Pricing helpers ─────────────────────────────────────────────────────
  const hourlyRate   = selectedPro?.on_demand_hourly_rate || 75;
  const totalCost    = hourlyRate * duration;
  const splitCount   = inviteFriends && selectedFriends.length > 0 ? selectedFriends.length + 1 : 1;
  const splitCost    = totalCost / splitCount;
  const depositAmount = (splitCost * 0.25).toFixed(0);

  // ── Friend search filter ────────────────────────────────────────────────
  const filteredFriends = friendsList.filter(f =>
    !selectedFriends.some(sf => sf.id === f.id) &&
    (friendSearch === '' ||
      f.full_name?.toLowerCase().includes(friendSearch.toLowerCase()) ||
      f.username?.toLowerCase().includes(friendSearch.toLowerCase()))
  ).slice(0, 10);

  // ── Submit handler ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!userLocation) {
      toast.error('Location required to request a Pro');
      return;
    }

    setLoading(true);
    try {
      const requesterIdParam = userId || user?.id;
      const response = await axios.post(
        `${API}/dispatch/request?requester_id=${requesterIdParam}`,
        {
          latitude:                   userLocation.lat,
          longitude:                  userLocation.lng,
          location_name:              nearestSpot?.name || 'Current Location',
          spot_id:                    nearestSpot?.id || null,
          estimated_duration_hours:   duration,
          is_immediate:               true,
          is_shared:                  inviteFriends && selectedFriends.length > 0,
          target_photographer_id:     selectedPro?.id || null,
          friend_ids:                 selectedFriends.length > 0
                                        ? selectedFriends.map(f => f.id)
                                        : null,
        }
      );

      const dispatchId = response.data.id;
      onClose();

      if (inviteFriends && selectedFriends.length > 0) {
        toast.success(
          `Request created! Invites sent to ${selectedFriends.length} friend${selectedFriends.length > 1 ? 's' : ''} (10 min to accept)`
        );
      } else {
        toast.success('Request created! Proceeding to payment…');
      }

      // Simulate payment → boost in a queue (Stripe checkout would go here)
      setTimeout(async () => {
        try {
          await axios.post(`${API}/dispatch/${dispatchId}/pay?payer_id=${requesterIdParam}`);
          toast.success('Payment confirmed! Searching for a Pro…');

          if (boostHours > 0) {
            try {
              await axios.post(
                `${API}/dispatch/request/${dispatchId}/boost?user_id=${requesterIdParam}`,
                { boost_hours: boostHours }
              );
              toast.success(`🚀 Request boosted! You'll appear first for ${boostHours} hour(s)`);
              onBoostApplied?.();
            } catch (boostErr) {
              toast.error(boostErr.response?.data?.detail || 'Failed to boost request');
            }
          }

          onSuccess?.(dispatchId);
        } catch {
          toast.error('Payment failed. Please try again.');
        }
      }, 1000);

    } catch (error) {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Failed to create request');
    } finally {
      setLoading(false);
    }
  };

  // ── Toggle friend invite ────────────────────────────────────────────────
  const handleToggleFriendInvite = () => {
    const next = !inviteFriends;
    setInviteFriends(next);
    if (next) {
      setFriendPickerOpen(true);
    } else {
      setFriendPickerOpen(false);
      setSelectedFriends([]);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      {/*
        DialogContent now handles sticky header/footer and scrollable body.
        We just need `bg-zinc-900 border-zinc-800 text-white sm:max-w-md`
        and NO overflow-y-auto here (that's on the body div).
      */}
      <DialogContent
        className="bg-zinc-900 border-zinc-800 text-white sm:max-w-md"
        hideCloseButton={false}
      >
        {/* ── STICKY HEADER ─────────────────────────────────────────────── */}
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

        {/* ── SCROLLABLE BODY ───────────────────────────────────────────── */}
        <div className="modal-body px-4 sm:px-5 py-4 space-y-4">

          {/* ── 1. Photographer selection (Uber-style) ─────────────────── */}
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
                  {selectedPro === null && (
                    <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  )}
                </button>

                {/* Individual photographers — show 3, expand for more */}
                {(proListExpanded
                  ? onDemandPhotographers
                  : onDemandPhotographers.slice(0, 3)
                ).map((pro) => (
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
                    {selectedPro?.id === pro.id && (
                      <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                    )}
                  </button>
                ))}

                {onDemandPhotographers.length > 3 && (
                  <button
                    onClick={() => setProListExpanded(v => !v)}
                    className="w-full py-1.5 text-xs text-cyan-400 hover:text-cyan-300 flex items-center justify-center gap-1 transition-colors"
                  >
                    {proListExpanded ? (
                      <><ChevronUp className="w-3.5 h-3.5" /> Show fewer</>
                    ) : (
                      <><ChevronDown className="w-3.5 h-3.5" /> {onDemandPhotographers.length - 3} more pros</>
                    )}
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

          {/* ── 2. Location ────────────────────────────────────────────── */}
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

          {/* ── 3. Session duration ────────────────────────────────────── */}
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

          {/* ── 4. Invite friends to split ─────────────────────────────── */}
          <div className="bg-zinc-800/50 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-3">
              <div>
                <p className="text-sm font-medium text-white">Invite Friends to Split</p>
                <p className="text-xs text-gray-400">10 min to accept · cost split equally</p>
              </div>
              {/* Toggle switch */}
              <button
                onClick={handleToggleFriendInvite}
                className={`w-11 h-6 rounded-full relative transition-colors duration-200 ${
                  inviteFriends ? 'bg-cyan-400' : 'bg-zinc-600'
                }`}
                aria-label="Toggle friend invite"
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                    inviteFriends ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Friend picker — expand/collapse */}
            {inviteFriends && (
              <div className="border-t border-zinc-700 px-3 pt-3 pb-3 space-y-2.5">
                {/* Selected friends chips */}
                {selectedFriends.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedFriends.map(f => (
                      <div
                        key={f.id}
                        className="flex items-center gap-1 bg-cyan-500/20 border border-cyan-400/40 rounded-full pl-1.5 pr-2 py-0.5"
                      >
                        {f.avatar_url ? (
                          <img src={f.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover" />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-[9px] text-white font-bold">
                            {f.full_name?.charAt(0)}
                          </div>
                        )}
                        <span className="text-xs text-cyan-300">{f.full_name?.split(' ')[0]}</span>
                        <button
                          onClick={() => setSelectedFriends(prev => prev.filter(sf => sf.id !== f.id))}
                          className="text-cyan-400/60 hover:text-white"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Search input */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search friends…"
                    value={friendSearch}
                    onChange={e => setFriendSearch(e.target.value)}
                    className="w-full bg-zinc-700/60 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400"
                  />
                  <Users className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                </div>

                {/* Friends list */}
                {friendsLoading ? (
                  <div className="flex justify-center py-3">
                    <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                  </div>
                ) : (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {filteredFriends.map(friend => (
                      <button
                        key={friend.id}
                        onClick={() => setSelectedFriends(prev => [...prev, friend])}
                        className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-zinc-700/50 transition-colors"
                      >
                        {friend.avatar_url ? (
                          <img src={friend.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-xs text-white font-bold">
                            {friend.full_name?.charAt(0)}
                          </div>
                        )}
                        <div className="flex-1 text-left min-w-0">
                          <p className="text-sm text-white truncate">{friend.full_name}</p>
                          {friend.username && (
                            <p className="text-xs text-gray-500">@{friend.username}</p>
                          )}
                        </div>
                        <span className="text-cyan-400 text-base leading-none">+</span>
                      </button>
                    ))}
                    {filteredFriends.length === 0 && !friendsLoading && (
                      <p className="text-center text-xs text-gray-500 py-2">
                        No friends found — follow surfers to add them!
                      </p>
                    )}
                  </div>
                )}

                {/* Split rules callout */}
                <div className="flex items-start gap-2 p-2.5 bg-amber-500/10 border border-amber-500/25 rounded-lg">
                  <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-200/80 leading-relaxed">
                    Friends have <strong>10 minutes</strong> to accept. Those who don't respond miss out. Cost split equally among confirmed.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── 5. Price breakdown ────────────────────────────────────── */}
          <div className="bg-gradient-to-r from-cyan-900/30 to-blue-900/30 rounded-xl border border-cyan-500/25 overflow-hidden">
            <div className="px-3 pt-3 pb-2 space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Rate</span>
                <span className="text-white">${hourlyRate}/hr × {duration}h</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Total Session Cost</span>
                <span className="text-white font-semibold">${totalCost.toFixed(0)}</span>
              </div>
              {inviteFriends && selectedFriends.length > 0 && (
                <div className="flex items-center justify-between text-sm pt-1 border-t border-zinc-700/50">
                  <span className="text-emerald-400">Your Share ({splitCount} split)</span>
                  <span className="text-emerald-400 font-semibold">~${splitCost.toFixed(0)}</span>
                </div>
              )}
            </div>
            <div className="px-3 py-2.5 border-t border-cyan-500/20 bg-cyan-500/5 flex items-center justify-between">
              <span className="text-cyan-400 font-medium text-sm">Your Deposit (25%)</span>
              <span className="text-cyan-400 font-bold text-base">${depositAmount}</span>
            </div>
          </div>

          {/* ── 6. Boost Your Request ─────────────────────────────────── */}
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
                  <p className="text-[10px] text-gray-400 group-hover:text-gray-300">credits/{label}</p>
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

        {/* ── STICKY FOOTER ─────────────────────────────────────────────── */}
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
