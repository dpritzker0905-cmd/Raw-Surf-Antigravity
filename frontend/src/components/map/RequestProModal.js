/**
 * RequestProModal - Unified "Request a Pro Photographer" flow
 *
 * Features:
 *  ? Auto-match or specific photographer selection (Uber style)
 *  ? Location display (nearest surf spot or GPS coordinates)
 *  ? Scheduled arrival time: 30 / 60 / 90 minutes from now
 *  ? Session duration: 0.5 / 1 / 2 / 3 hours
 *  ? Crew / Split Fare - full surfboard lineup UI (pool-table style)
 *  ? Captain's Hub: per-member % slider + "I'll cover" toggle
 *  ? Live cost breakdown (rate - duration, split share, captain's share)
 *  ? Boost Your Request (credits-based priority)
 *  ? Proper sticky header / scrollable body / sticky footer layout
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera, MapPin, Clock, Loader2, Target, Check,
  X, Zap, ChevronDown, ChevronUp, Plus, Award,
  Wallet, CreditCard, ChevronLeft,
} from 'lucide-react';
import { Button } from '../ui/button';
import {

  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '../ui/dialog';
import apiClient from '../../lib/apiClient';
import { getFullUrl } from '../../utils/media';
import { ROLES } from '../../constants/roles';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../utils/logger';
import useRequestProActions from '../../hooks/useRequestProActions';
import RequestProConfirmStep from './RequestProConfirmStep';
import RequestProCrewPanel from './RequestProCrewPanel';



// --- Surfboard colour palette (matches OnDemandRequestDrawer) ----------------
var SURFBOARD_COLORS = [
  { fill: '#FCD34D', stroke: '#F59E0B' }, // Yellow - captain/you
  { fill: '#22D3EE', stroke: '#0891B2' }, // Cyan
  { fill: '#F472B6', stroke: '#DB2777' }, // Pink
  { fill: '#A78BFA', stroke: '#7C3AED' }, // Purple
  { fill: '#34D399', stroke: '#059669' }, // Green
  { fill: '#FB923C', stroke: '#EA580C' }, // Orange
  { fill: '#60A5FA', stroke: '#2563EB' }, // Blue
];

// --- Surfboard + avatar compound component -----------------------------------
var SurfboardAvatar = ({ member, index, isCaptain, onRemove }) => {
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
            <img loading="lazy" decoding="async" src={getFullUrl(member.avatar_url)} alt={member.name || 'crew'} className="w-full h-full object-cover" />
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

// --- Empty seat (dashed surfboard) ------------------------------------------
var EmptySeat = ({ onClick }) => (
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

// --- Duration pills ----------------------------------------------------------
var DURATIONS = [
  { value: 0.5, label: '30m' },
  { value: 1,   label: '1h'  },
  { value: 2,   label: '2h'  },
  { value: 3,   label: '3h'  },
];

// --- Boost options -----------------------------------------------------------
var BOOST_OPTIONS = [
  { hours: 1, credits: 5,  label: '1h' },
  { hours: 2, credits: 10, label: '2h' },
  { hours: 4, credits: 20, label: '4h' },
];

// --- Main component -----------------------------------------------------------
export var RequestProModal = ({
  isOpen,
  onClose,
  // Auth / user
  userId,
  user,
  // Location
  userLocation,
  nearestSpot,
  // On-demand photographers nearby (optional - pre-fetched by MapPage)
  onDemandPhotographers = [],
  onDemandLoading = false,
  // Callbacks
  onSuccess,
  onBoostApplied,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const navigate = useNavigate();
  const { user: authUser, updateUser } = useAuth();

  // -- Step flow: 'configure' ? 'confirm' ---------------------------------
  const [step, setStep] = useState('configure');

  // -- Photographer selection ----------------------------------------------
  const [selectedPro, setSelectedPro]         = useState(null);
  const [proListExpanded, setProListExpanded] = useState(false);

  // -- Scheduled start time ------------------------------------------------
  const [startTimeOption, setStartTimeOption] = useState(30);

  // -- Session duration ----------------------------------------------------
  const [duration, setDuration] = useState(1);

  // -- Crew / split state (mirrors OnDemandRequestDrawer) -----------------
  const [crewOpen, setCrewOpen]                   = useState(false);
  const [crewMembers, setCrewMembers]             = useState([]);
  const [showAddCrewInput, setShowAddCrewInput]   = useState(false);
  const [newCrewInput, setNewCrewInput]           = useState('');
  const [friendSearchResults, setFriendSearchResults] = useState([]);
  const [searchingFriends, setSearchingFriends]   = useState(false);
  const [showCaptainsHub, setShowCaptainsHub]     = useState(false);

  // -- Boost ---------------------------------------------------------------
  const [boostHours, setBoostHours] = useState(0);

  // -- Payment -------------------------------------------------------------
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [localCredits, setLocalCredits]   = useState(0);
  const [creditsFetched, setCreditsFetched] = useState(false);

  // -- Submission ----------------------------------------------------------
  const [loading, setLoading] = useState(false);

  // Fetch credit balance when modal opens
  useEffect(() => {
    const fetchCredits = async () => {
      const uid = userId || user?.id || authUser?.id;
      if (uid && isOpen && !creditsFetched) {
        try {
          const res = await apiClient.get(`/credits/balance/${uid}`);
          if (res.data?.balance !== undefined) {
            const balance = res.data.balance;
            setLocalCredits(balance);
            setCreditsFetched(true);
            if (balance > 0) setPaymentMethod('credits');
          }
        } catch (e) {
          logger.error('[RequestProModal] Failed to fetch credits:', e);
          setCreditsFetched(true);
        }
      }
    };
    fetchCredits();
  }, [isOpen, userId, user?.id, authUser?.id, creditsFetched]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setStep('configure');
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
      setPaymentMethod('card');
      setLocalCredits(0);
      setCreditsFetched(false);
      setLoading(false);
    }
  }, [isOpen]);

  // -- Pricing -------------------------------------------------------------
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
  const isShared         = crewMembers.length > 0;
  // Full payment upfront (escrow) - we hold funds until session completion.
  // For shared bookings: captain pays their share. Solo: captain pays full total.
  const depositAmount    = isShared ? captainPayAmount.toFixed(0) : totalCost.toFixed(0);
  const amountToCharge   = isShared ? captainPayAmount : totalCost;
  const hasEnoughCredits = isShared
    ? (captainPayAmount === 0 || localCredits >= captainPayAmount)
    : localCredits >= totalCost;


  // ============ HANDLERS FROM useRequestProActions ============
  const {
    addCrewMember,
    removeCrewMember,
    handlePercentageChange,
    toggleCoverMember,
    distributeEvenly,
    coverAll,
    handleSubmit,
  } = useRequestProActions({
    userId, user, authUser, updateUser, navigate,
    crewMembers, newCrewInput, totalCost, totalParticipants,
    perPersonSplit, captainPayAmount, amountToCharge,
    selectedPro, userLocation, nearestSpot, duration,
    startTimeOption, boostHours, paymentMethod,
    onClose, onSuccess, onBoostApplied,
    setCrewMembers, setNewCrewInput, setFriendSearchResults,
    setShowAddCrewInput, setLoading,
  });

  // -- Debounced user search for crew autocomplete -------------------------
  useEffect(() => {
    if (newCrewInput.length < 2) { setFriendSearchResults([]); return; }
    const tid = setTimeout(async () => {
      setSearchingFriends(true);
      try {
        const res = await apiClient.get(`/users/search?query=${encodeURIComponent(newCrewInput)}&limit=5`);
        const existing = new Set([userId || user?.id, ...crewMembers.map(m => m.user_id || m.id)]);
        setFriendSearchResults((res.data.users || []).filter(u => !existing.has(u.id)));
      } catch { setFriendSearchResults([]); }
      finally { setSearchingFriends(false); }
    }, 300);
    return () => clearTimeout(tid);
  }, [newCrewInput, userId, user?.id, crewMembers]);


  // ----------------------------------------------------------------------------
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent data-testid="request-pro-modal" 
        className={`${isDark ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-gray-200 text-gray-900'} sm:max-w-md`}
        hideCloseButton={false}
      >
        {/* -- STICKY HEADER ------------------------------------------------- */}
        <DialogHeader className={`border-b ${isDark ? 'border-zinc-800 bg-zinc-900' : 'border-gray-200 bg-white'}`}>
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            {step === 'confirm' && (
              <button aria-label="Previous"
                onClick={() => setStep('configure')}
                className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-zinc-800' : 'hover:bg-gray-100'} transition-colors`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500/30 to-blue-500/30 flex items-center justify-center">
              <Camera className="w-4 h-4 text-cyan-400" />
            </span>
            {step === 'configure' ? 'Request a Pro' : 'Confirm & Pay'}
          </DialogTitle>
          <p className={`${isDark ? 'text-gray-400' : 'text-gray-500'} text-xs mt-0.5`}>
            {step === 'configure'
              ? 'On-demand surf photographer - at your break within the hour'
              : 'Review your session and choose payment method'}
          </p>
        </DialogHeader>

        {/* -- SCROLLABLE BODY ----------------------------------------------- */}
        <div className="modal-body px-4 sm:px-5 py-4 space-y-4">

        {step === 'configure' && (<>

          {/* -- 1. Photographer selection ------------------------------------ */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-300">
                {onDemandLoading
                  ? 'Finding pros near you-'
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
                <button aria-label="div"
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
                      <img loading="lazy" decoding="async" src={getFullUrl(pro.avatar_url)} alt={pro.full_name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                        {pro.full_name?.charAt(0) || 'P'}
                      </div>
                    )}
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm font-medium flex items-center gap-1.5 truncate">
                        {pro.full_name}
                        {pro.role === ROLES.APPROVED_PRO && (
                          <span className="text-[9px] px-1 py-0.5 bg-yellow-500/20 text-yellow-400 rounded font-bold shrink-0">PRO</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 flex items-center gap-1.5">
                        {pro.distance != null && <span>{pro.distance} mi</span>}
                        <span>-</span>
                        <span>${pro.on_demand_hourly_rate}/hr</span>
                      </p>
                    </div>
                    {selectedPro?.id === pro.id && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
                  </button>
                ))}

                {onDemandPhotographers.length > 3 && (
                  <button aria-label="Collapse"
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

          {/* -- 2. Location -------------------------------------------------- */}
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

          {/* -- 3. Scheduled arrival time ------------------------------------- */}
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

          {/* -- 4. Session duration ------------------------------------------- */}
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

          {/* -- 5. Crew / Split - surfboard lineup --------------------------- */}
          <RequestProCrewPanel
            crewOpen={crewOpen}
            setCrewOpen={setCrewOpen}
            crewMembers={crewMembers}
            removeCrewMember={removeCrewMember}
            showAddCrewInput={showAddCrewInput}
            setShowAddCrewInput={setShowAddCrewInput}
            newCrewInput={newCrewInput}
            setNewCrewInput={setNewCrewInput}
            friendSearchResults={friendSearchResults}
            setFriendSearchResults={setFriendSearchResults}
            searchingFriends={searchingFriends}
            addCrewMember={addCrewMember}
            showCaptainsHub={showCaptainsHub}
            setShowCaptainsHub={setShowCaptainsHub}
            totalParticipants={totalParticipants}
            captainPayAmount={captainPayAmount}
            perPersonSplit={perPersonSplit}
            distributeEvenly={distributeEvenly}
            coverAll={coverAll}
            handlePercentageChange={handlePercentageChange}
            toggleCoverMember={toggleCoverMember}
            user={user}
            SurfboardAvatar={SurfboardAvatar}
            EmptySeat={EmptySeat}
          />

          {/* -- 6. Price breakdown ------------------------------------------- */}
          <div className={`${isDark ? 'bg-gradient-to-r from-cyan-900/30 to-blue-900/30 border-cyan-500/25' : 'bg-gradient-to-r from-cyan-50 to-blue-50 border-cyan-200'} rounded-xl border overflow-hidden`}>
            <div className="px-3 pt-3 pb-2 space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Rate</span>
                <span className={isDark ? 'text-white' : 'text-gray-900'}>${hourlyRate}/hr - {duration}h</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Session Total</span>
                <span className={`${isDark ? 'text-white' : 'text-gray-900'} font-semibold`}>${totalCost.toFixed(0)}</span>
              </div>
              {isShared && (
                <div className={`flex items-center justify-between text-sm pt-1 border-t ${isDark ? 'border-zinc-700/50' : 'border-gray-200'}`}>
                  <span className="text-emerald-400">Your Share ({totalParticipants} split)</span>
                  <span className="text-emerald-400 font-semibold">~${captainPayAmount.toFixed(0)}</span>
                </div>
              )}
            </div>
            <div className={`px-3 py-2.5 border-t ${isDark ? 'border-cyan-500/20 bg-cyan-500/5' : 'border-cyan-200 bg-cyan-50'} flex items-center justify-between`}>
              <span className="text-cyan-600 dark:text-cyan-400 font-medium text-sm">
                {isShared ? "Captain's Share" : 'Amount Due'}
              </span>
              <span className="text-cyan-600 dark:text-cyan-400 font-bold text-base">${depositAmount}</span>
            </div>
          </div>

          {/* -- 7. Boost Your Request ----------------------------------------- */}
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
                ?? Your request will appear first to all pros for {boostHours} hour{boostHours > 1 ? 's' : ''}
              </p>
            )}
          </div>

        </>)}

        {/* -- CONFIRM & PAY STEP -------------------------------------------- */}
        {step === 'confirm' && (
          <RequestProConfirmStep
            isDark={isDark}
            selectedPro={selectedPro}
            duration={duration}
            totalCost={totalCost}
            captainPayAmount={captainPayAmount}
            totalParticipants={totalParticipants}
            isShared={isShared}
            hourlyRate={hourlyRate}
            depositAmount={depositAmount}
            nearestSpot={nearestSpot}
            localCredits={localCredits}
            hasEnoughCredits={hasEnoughCredits}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
          />
        )}

        </div>

        {/* -- STICKY FOOTER ------------------------------------------------- */}
        <DialogFooter className={`${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-200'} gap-2`}>
          <Button
            variant="outline"
            onClick={step === 'confirm' ? () => setStep('configure') : onClose}
            className={`${isDark ? 'border-zinc-600 text-white hover:bg-zinc-800' : 'border-gray-300 text-gray-700 hover:bg-gray-100'} flex-1 sm:flex-none`}
          >
            {step === 'confirm' ? 'Back' : 'Cancel'}
          </Button>

          {step === 'configure' && (
            <Button aria-label="Previous"
              onClick={() => setStep('confirm')}
              disabled={!userLocation}
              className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold flex-1 sm:flex-none disabled:opacity-50"
              data-testid="request-pro-continue"
            >
              Review & Pay <ChevronLeft className="w-4 h-4 ml-1 rotate-180" />
            </Button>
          )}

          {step === 'confirm' && (
            <Button aria-label="Loader2"
              onClick={handleSubmit}
              disabled={loading || !userLocation || (paymentMethod === 'credits' && !hasEnoughCredits)}
              className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold flex-1 sm:flex-none disabled:opacity-50"
              data-testid="request-pro-submit"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : paymentMethod === 'credits' ? (
                <><Wallet className="w-4 h-4 mr-2" />Pay ${depositAmount} with Credits</>
              ) : (
                <><CreditCard className="w-4 h-4 mr-2" />Pay ${depositAmount} with Card</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RequestProModal;
