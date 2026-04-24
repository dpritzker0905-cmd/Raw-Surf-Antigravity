/**
 * DispatchLobby.js
 * 
 * Full-page "poker room" lobby for on-demand sessions.
 * 
 * Flow:
 *   booking_created -> selfie_pending -> crew_paying -> photographer_pending -> accepted -> in_session
 * 
 * Uses the surfboard lineup visualization from the booking flow all the way through.
 * Polls /dispatch/{id} every 3s for live state updates.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import apiClient from '../lib/apiClient';
import { getFullUrl } from '../utils/media';
import {
  Check, Clock, MapPin, Radio, Award, Camera, Loader2,
  Zap, X, ChevronRight, Users, Bell, ArrowLeft, RefreshCw
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { RequestProSelfieModal } from './RequestProSelfieModal';

// --- Constants ---
const SURFBOARD_COLORS = [
  { fill: '#FCD34D', stroke: '#F59E0B' }, // Yellow (captain)
  { fill: '#22D3EE', stroke: '#0891B2' }, // Cyan
  { fill: '#F472B6', stroke: '#DB2777' }, // Pink
  { fill: '#A78BFA', stroke: '#7C3AED' }, // Purple
  { fill: '#34D399', stroke: '#059669' }, // Green
  { fill: '#FB923C', stroke: '#EA580C' }, // Orange
  { fill: '#60A5FA', stroke: '#2563EB' }, // Blue
];

// --- Surfboard Avatar (reused from booking flow) ---
const SurfboardAvatar = ({ member, index, isCaptain, isPaid, isPending, isLight }) => {
  const boardColor = SURFBOARD_COLORS[index % SURFBOARD_COLORS.length];
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';

  return (
    <div className="relative group flex flex-col items-center">
      {/* Surfboard */}
      <svg
        viewBox="0 0 60 100"
        className="absolute left-1/2 -translate-x-1/2 top-2 w-12 h-20 pointer-events-none"
        style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))' }}
      >
        <ellipse cx="30" cy="50" rx="12" ry="38"
          fill={boardColor.fill} stroke={boardColor.stroke} strokeWidth="2"
          opacity={isPending ? 0.4 : 1}
        />
        <line x1="30" y1="14" x2="30" y2="86"
          stroke={boardColor.stroke} strokeWidth="1.5" opacity="0.6" />
        <ellipse cx="30" cy="16" rx="3" ry="2.5"
          fill={boardColor.stroke} opacity="0.4" />
        <path d="M30 78 L27 86 L30 83 L33 86 Z"
          fill={boardColor.stroke} opacity="0.7" />
      </svg>

      {/* Avatar */}
      <div className="relative z-10">
        <div
          className={`w-11 h-11 rounded-full overflow-hidden transition-all duration-500 ${
            isCaptain
              ? 'ring-2 ring-yellow-400'
              : isPaid
              ? 'ring-2 ring-green-400'
              : 'ring-2 ring-amber-400/50'
          } ${isPending ? 'opacity-50' : ''}`}
        >
          {member.avatar_url || member.selfie_url ? (
            <img
              src={getFullUrl(member.selfie_url || member.avatar_url)}
              alt={member.name || 'Surfer'}
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className={`w-full h-full flex items-center justify-center font-bold text-sm ${
                isCaptain
                  ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-black'
                  : isPaid
                  ? 'bg-gradient-to-br from-green-400 to-emerald-500 text-white'
                  : 'bg-gradient-to-br from-zinc-600 to-zinc-700 text-gray-300'
              }`}
            >
              {(member.name || member.value || '?')[0]?.toUpperCase()}
            </div>
          )}
        </div>

        {/* Status badge */}
        {isCaptain && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2">
            <Award className="w-4 h-4 text-yellow-400 drop-shadow-lg" />
          </div>
        )}
        {!isCaptain && isPaid && (
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center border border-zinc-900">
            <Check className="w-2.5 h-2.5 text-white" />
          </div>
        )}
        {!isCaptain && !isPaid && (
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-amber-500/80 flex items-center justify-center border border-zinc-900 animate-pulse">
            <Clock className="w-2.5 h-2.5 text-white" />
          </div>
        )}
      </div>

      {/* Name */}
      <div className="text-center mt-9 max-w-[72px]">
        <p className={`text-[10px] font-medium ${textPrimary} truncate`}>
          {isCaptain ? 'You' : (member.name || member.value?.split('@')[0] || 'Crew')}
        </p>
        <p className={`text-[9px] ${isPaid ? 'text-green-400' : 'text-amber-400'} truncate`}>
          {isCaptain ? 'Captain' : isPaid ? 'Paid' : 'Pending...'}
        </p>
      </div>
    </div>
  );
};

// --- Photographer Card ---
const PhotographerCard = ({ photographer, eta, status, isLight }) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  const accepted = ['accepted', 'en_route', 'arrived'].includes(status);
  const declined = status === 'declined' || status === 'searching_for_pro';

  const borderClass = accepted
    ? 'border-green-400/50 bg-green-500/10'
    : declined
    ? 'border-red-400/40 bg-red-500/10'
    : 'border-amber-400/30 bg-amber-500/5';

  const ringClass = accepted
    ? 'ring-2 ring-green-400'
    : declined
    ? 'ring-2 ring-red-400/50'
    : 'ring-2 ring-amber-400/40';

  const statusText = accepted
    ? 'En route to you'
    : declined
    ? 'Searching for another photographer...'
    : 'Reviewing your request...';

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-2xl border transition-all duration-500 ${borderClass}`}
    >
      <div
        className={`w-12 h-12 rounded-full overflow-hidden flex-shrink-0 ${ringClass}`}
      >
        {photographer?.avatar_url || photographer?.avatar ? (
          <img
            src={getFullUrl(photographer.avatar_url || photographer.avatar)}
            alt={photographer.full_name || photographer.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className={`w-full h-full flex items-center justify-center ${
            declined
              ? 'bg-gradient-to-br from-red-400 to-red-600'
              : 'bg-gradient-to-br from-amber-400 to-orange-500'
          }`}>
            <Camera className="w-6 h-6 text-black" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-sm ${textPrimary} truncate`}>
          {photographer?.full_name || photographer?.name || 'Photographer'}
        </p>
        <p className={`text-xs ${declined ? 'text-red-400' : textSecondary}`}>
          {statusText}
        </p>
      </div>

      {accepted && eta && (
        <div className="text-right flex-shrink-0">
          <p className="text-green-400 font-bold text-lg">~{eta}</p>
          <p className="text-xs text-green-400/70">min ETA</p>
        </div>
      )}
      {declined && (
        <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
          <RefreshCw className="w-4 h-4 text-red-400 animate-spin" style={{ animationDuration: '3s' }} />
        </div>
      )}
      {!accepted && !declined && (
        <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center animate-pulse flex-shrink-0">
          <Radio className="w-4 h-4 text-amber-400" />
        </div>
      )}
    </div>
  );
};

// --- Timeline Step ---
const TimelineStep = ({ icon: Icon, label, sub, done, active, isLight }) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  return (
    <div className={`flex items-center gap-3 transition-opacity ${!done && !active ? 'opacity-40' : ''}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ${
          done
            ? 'bg-green-500/20'
            : active
            ? 'bg-amber-500/20 animate-pulse'
            : 'bg-zinc-700/50'
        }`}
      >
        <Icon
          className={`w-4 h-4 ${done ? 'text-green-400' : active ? 'text-amber-400' : 'text-zinc-500'}`}
        />
      </div>
      <div>
        <p className={`text-sm font-medium ${textPrimary}`}>{label}</p>
        {sub && <p className={`text-xs ${textSecondary}`}>{sub}</p>}
      </div>
    </div>
  );
};

// --- Main Component ---
export const DispatchLobby = () => {
  const { dispatchId } = useParams();
  const { state: navState } = useLocation();
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();

  const isLight = theme === 'light';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  const bgPage = isLight ? 'bg-gray-50' : 'bg-zinc-950';

  // -- State --
  const [dispatch, setDispatch] = useState(null);
  const [crewStatus, setCrewStatus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showSelfieModal, setShowSelfieModal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [declinedBanner, setDeclinedBanner] = useState(false);
  const selfieShownRef = useRef(false);
  const pollRef = useRef(null);

  // Status transition tracking refs (prevents duplicate toasts)
  const prevStatusRef = useRef(null);
  const prevPaidCountRef = useRef(null);
  const acceptSoundPlayedRef = useRef(false);

  // State from navigation (captain's local crew list before backend synced)
  const localCrewMembers = navState?.crewMembers || [];
  const photographerFromNav = navState?.photographer || null;
  const captainPayAmount = navState?.captainPayAmount || 0;

  // -- Derived state --
  const photographerAccepted = ['accepted', 'en_route', 'arrived', 'completed'].includes(
    dispatch?.status
  );
  const allCrewPaid = crewStatus.length === 0 || crewStatus.every(m => m.paid);
  const paidCount = crewStatus.filter(m => m.paid).length;
  const photographer = dispatch?.photographer || photographerFromNav;
  const eta = dispatch?.gps?.eta_minutes || null;

  // -- Poll dispatch state --
  const pollDispatch = useCallback(async () => {
    if (!dispatchId) return;
    try {
      const [dispatchRes, crewRes] = await Promise.all([
        apiClient.get(`/dispatch/${dispatchId}`),
        apiClient.get(`/dispatch/${dispatchId}/crew-status`),
      ]);
      const newStatus = dispatchRes.data?.status;
      const newCrew = crewRes.data?.crew || [];
      const newPaidCount = newCrew.filter(m => m.paid).length;

      // --- STATUS TRANSITION NOTIFICATIONS ---
      const prevStatus = prevStatusRef.current;

      if (prevStatus && prevStatus !== newStatus) {
        // Photographer ACCEPTED
        if (['accepted', 'en_route'].includes(newStatus) && !acceptSoundPlayedRef.current) {
          acceptSoundPlayedRef.current = true;
          toast.success('🎉 Photographer accepted! They\'re on their way.', {
            id: 'photographer-accepted',
            duration: 6000,
          });
          try {
            const audio = new Audio('/sounds/notification.mp3');
            audio.volume = 0.4;
            audio.play().catch(() => {});
          } catch (_) {}
        }

        // Photographer DECLINED (status goes back to searching)
        if (newStatus === 'searching_for_pro' && prevStatus !== 'searching_for_pro') {
          setDeclinedBanner(true);
          toast.info('Photographer couldn\'t make it. We\'re finding another one.', {
            id: 'photographer-declined',
            duration: 6000,
          });
        }

        // Session CANCELLED
        if (newStatus === 'cancelled') {
          toast.error('Session was cancelled.', { id: 'session-cancelled' });
          clearInterval(pollRef.current);
          navigate(`/bookings?tab=on_demand&highlight=${dispatchId}`);
          return;
        }
      }

      // --- CREW PAYMENT NOTIFICATIONS ---
      if (prevPaidCountRef.current !== null && newPaidCount > prevPaidCountRef.current) {
        const diff = newPaidCount - prevPaidCountRef.current;
        const newlyPaid = newCrew.filter(m => m.paid).slice(-diff);
        const names = newlyPaid.map(m => m.name || 'A crew member').join(', ');
        toast.success(`${names} joined the session! 🏄`, {
          id: `crew-paid-${newPaidCount}`,
          duration: 4000,
        });
      }

      // Update refs
      prevStatusRef.current = newStatus;
      prevPaidCountRef.current = newPaidCount;

      setDispatch(dispatchRes.data);
      setCrewStatus(newCrew);
      setError(null);
    } catch (err) {
      setError('Lost connection - retrying...');
    } finally {
      setLoading(false);
    }
  }, [dispatchId, navigate]);

  useEffect(() => {
    pollDispatch(); // Immediate
    pollRef.current = setInterval(pollDispatch, 3000);
    return () => clearInterval(pollRef.current);
  }, [pollDispatch]);

  // -- Show selfie prompt once if needed --
  useEffect(() => {
    if (
      dispatch &&
      !dispatch.selfie_url &&
      navState?.needsSelfie !== false &&
      !selfieShownRef.current
    ) {
      selfieShownRef.current = true;
      // Delay slightly so the lobby renders first
      const t = setTimeout(() => setShowSelfieModal(true), 800);
      return () => clearTimeout(t);
    }
  }, [dispatch, navState?.needsSelfie]);

  // -- Handle cancel with confirmation --
  const handleCancelSession = async () => {
    try {
      await apiClient.post(
        `/dispatch/${dispatchId}/cancel?user_id=${user.id}`,
        { reason: 'User cancelled from lobby' }
      );
      toast.info('Session cancelled. Your deposit will be refunded.');
      navigate(`/bookings?tab=on_demand&highlight=${dispatchId}`);
    } catch {
      toast.error('Failed to cancel. Please try again or contact support.');
    }
  };

  // --- Build lineup: captain + backend crew (fall back to local) ---
  const captainMember = {
    id: user?.id,
    name: user?.full_name || 'You',
    avatar_url: user?.avatar_url,
    selfie_url: dispatch?.selfie_url,
    paid: true,
    isCaptain: true,
  };

  // Merge backend crew status with local crew list for names/avatars
  const crewLineup = crewStatus.length > 0 ? crewStatus : localCrewMembers.map(m => ({
    id: m.user_id || m.id,
    name: m.name || m.value,
    avatar_url: m.avatar_url,
    paid: m.covered_by_captain || false,
  }));

  // --- Derive timeline phase ---
  const captainSelfieUploaded = !!dispatch?.selfie_url;
  const crewAllPaid = crewLineup.length === 0 || crewLineup.every(m => m.paid);
  const photographerPending = !photographerAccepted;

  if (loading) {
    return (
      <div className={`min-h-screen ${bgPage} flex items-center justify-center`}>
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-amber-400 animate-spin mx-auto mb-4" />
          <p className={textSecondary}>Loading your session...</p>
        </div>
      </div>
    );
  }

  if (error && !dispatch) {
    return (
      <div className={`min-h-screen ${bgPage} flex items-center justify-center p-6`}>
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <Button onClick={pollDispatch}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${bgPage} pb-safe`}>
      {/* --- Header --- */}
      <div
        className={`sticky top-0 z-10 px-4 pt-4 pb-3 border-b ${
          isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-800'
        }`}
      >
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            {/* Back to Bookings button */}
            <button
              onClick={() => navigate(`/bookings?tab=on_demand&highlight=${dispatchId}`)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                isLight ? 'bg-gray-100 hover:bg-gray-200' : 'bg-zinc-800 hover:bg-zinc-700'
              }`}
            >
              <ArrowLeft className={`w-5 h-5 ${textPrimary}`} />
            </button>
            <div>
              <h1 className={`font-bold text-sm ${textPrimary}`}>
                {photographerAccepted ? 'Photographer Confirmed!' : 'Session Pending'}
              </h1>
              <p className={`text-xs ${textSecondary}`}>
                {photographerAccepted
                  ? `${photographer?.full_name || 'Photographer'} is on the way`
                  : 'Waiting for confirmation...'}
              </p>
            </div>
          </div>
          <Badge
            className={`text-xs ${
              photographerAccepted
                ? 'bg-green-500/20 text-green-400 border-green-400/30'
                : 'bg-amber-500/20 text-amber-400 border-amber-400/30'
            }`}
          >
            {photographerAccepted ? 'Confirmed' : 'Pending'}
          </Badge>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">

        {/* --- Declined Banner --- */}
        {declinedBanner && !photographerAccepted && (
          <div
            className={`flex items-center gap-3 p-3 rounded-xl border animate-in slide-in-from-top ${
              isLight ? 'bg-amber-50 border-amber-300' : 'bg-amber-500/10 border-amber-500/30'
            }`}
          >
            <RefreshCw className="w-5 h-5 text-amber-400 animate-spin flex-shrink-0" style={{ animationDuration: '3s' }} />
            <div className="flex-1">
              <p className={`text-sm font-medium ${textPrimary}`}>Finding a new photographer</p>
              <p className={`text-xs ${textSecondary}`}>
                The previous photographer couldn't make it. We're matching you with someone new.
              </p>
            </div>
            <button
              onClick={() => setDeclinedBanner(false)}
              className="text-gray-500 hover:text-gray-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* --- Photographer Card --- */}
        <PhotographerCard
          photographer={photographer}
          eta={eta}
          status={dispatch?.status}
          isLight={isLight}
        />

        {/* --- THE LINEUP (Surfboard Visualization) --- */}
        <div
          className={`relative rounded-3xl overflow-hidden ${
            isLight
              ? 'bg-gradient-to-b from-cyan-100 via-blue-50 to-white'
              : 'bg-gradient-to-b from-cyan-900/40 via-blue-900/20 to-zinc-950'
          }`}
        >
          {/* Wave SVG */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-30">
            <svg viewBox="0 0 400 200" className="w-full h-full" preserveAspectRatio="none">
              <path
                d="M0,80 Q50,60 100,80 T200,80 T300,80 T400,80 V200 H0 Z"
                fill="currentColor" className="text-cyan-500"
              />
              <path
                d="M0,110 Q50,90 100,110 T200,110 T300,110 T400,110 V200 H0 Z"
                fill="currentColor" className="text-blue-500" opacity="0.5"
              />
            </svg>
          </div>

          {/* Lineup label */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 text-xs text-cyan-400 font-semibold tracking-wide flex items-center gap-1 z-10">
            <MapPin className="w-3 h-3" /> THE LINEUP
          </div>

          {/* Surfers */}
          <div className="relative pt-10 pb-6 px-4 flex justify-center items-end gap-4 flex-wrap min-h-[140px]">
            {/* Captain */}
            <SurfboardAvatar
              member={captainMember}
              index={0}
              isCaptain
              isPaid
              isLight={isLight}
            />

            {/* Crew */}
            {crewLineup.map((member, idx) => (
              <SurfboardAvatar
                key={member.id || idx}
                member={member}
                index={idx + 1}
                isCaptain={false}
                isPaid={member.paid}
                isPending={!member.paid}
                isLight={isLight}
              />
            ))}
          </div>

          {/* Crew payment summary bar */}
          {crewLineup.length > 0 && (
            <div
              className={`px-4 pb-4 pt-2 border-t ${
                isLight ? 'border-cyan-200' : 'border-cyan-900/40'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-xs font-medium ${textPrimary}`}>
                  Crew Payment
                </span>
                <span
                  className={`text-xs font-bold ${
                    crewAllPaid ? 'text-green-400' : 'text-amber-400'
                  }`}
                >
                  {paidCount}/{crewLineup.length} paid
                </span>
              </div>
              {/* Progress bar */}
              <div className={`h-2 rounded-full ${isLight ? 'bg-gray-200' : 'bg-zinc-800'}`}>
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-green-400 transition-all duration-700"
                  style={{
                    width: crewLineup.length > 0
                      ? `${(paidCount / crewLineup.length) * 100}%`
                      : '0%',
                  }}
                />
              </div>
              {!crewAllPaid && (
                <p className={`text-xs ${textSecondary} mt-1.5`}>
                  Your crew has been notified to pay their share
                </p>
              )}
            </div>
          )}
        </div>

        {/* --- Selfie prompt (if missing) --- */}
        {!captainSelfieUploaded && (
          <button
            onClick={() => setShowSelfieModal(true)}
            className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 border-dashed transition-all ${
              isLight
                ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
                : 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Camera className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1 text-left">
              <p className={`font-semibold text-sm ${textPrimary}`}>
                Add Your Selfie
              </p>
              <p className={`text-xs ${textSecondary}`}>
                So the photographer can find you at the beach
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-amber-400" />
          </button>
        )}

        {captainSelfieUploaded && (
          <div
            className={`flex items-center gap-3 p-3 rounded-xl ${
              isLight ? 'bg-green-50' : 'bg-green-500/10'
            } border border-green-400/30`}
          >
            <img
              src={getFullUrl(dispatch.selfie_url)}
              alt="Your selfie"
              className="w-10 h-10 rounded-full object-cover ring-2 ring-green-400 flex-shrink-0"
            />
            <div className="flex-1">
              <p className={`text-sm font-medium ${textPrimary}`}>
                Selfie uploaded
              </p>
              <p className={`text-xs ${textSecondary}`}>
                Photographer can identify you
              </p>
            </div>
            <Check className="w-5 h-5 text-green-400" />
          </div>
        )}

        {/* --- Session Timeline --- */}
        <div
          className={`p-4 rounded-2xl space-y-3 ${
            isLight ? 'bg-white border border-gray-200' : 'bg-zinc-900 border border-zinc-800'
          }`}
        >
          <h3 className={`text-sm font-bold ${textPrimary} flex items-center gap-2`}>
            <Zap className="w-4 h-4 text-amber-400" /> Session Progress
          </h3>
          <div className="space-y-2.5">
            <TimelineStep
              icon={Check}
              label="Session Booked"
              sub="Request created & payment secured"
              done
              isLight={isLight}
            />
            <TimelineStep
              icon={Camera}
              label="Add Your Selfie"
              sub="So the photographer can find you"
              done={captainSelfieUploaded}
              active={!captainSelfieUploaded}
              isLight={isLight}
            />
            <TimelineStep
              icon={Users}
              label="Crew Paying"
              sub={
                crewLineup.length > 0
                  ? `${paidCount}/${crewLineup.length} crew members confirmed`
                  : 'Solo session - no crew to wait for'
              }
              done={crewAllPaid}
              active={!crewAllPaid && captainSelfieUploaded}
              isLight={isLight}
            />
            <TimelineStep
              icon={Radio}
              label="Photographer Confirming"
              sub="Waiting for them to accept your request"
              done={photographerAccepted}
              active={crewAllPaid && !photographerAccepted}
              isLight={isLight}
            />
            <TimelineStep
              icon={MapPin}
              label="Photographer En Route"
              sub={
                photographerAccepted && eta
                  ? `~${eta} min away`
                  : 'Pending confirmation'
              }
              done={['en_route', 'arrived', 'completed'].includes(dispatch?.status)}
              active={dispatch?.status === 'accepted'}
              isLight={isLight}
            />
          </div>
        </div>

        {/* --- Session Details --- */}
        <div
          className={`p-4 rounded-2xl grid grid-cols-2 gap-3 ${
            isLight ? 'bg-white border border-gray-200' : 'bg-zinc-900 border border-zinc-800'
          }`}
        >
          {[
            {
              icon: MapPin,
              label: 'Location',
              val: dispatch?.location_name || 'On-Demand',
              color: 'text-cyan-400',
            },
            {
              icon: Clock,
              label: 'Duration',
              val: dispatch?.estimated_duration_hours
                ? `${dispatch.estimated_duration_hours}h`
                : 'TBD',
              color: 'text-purple-400',
            },
            {
              icon: Zap,
              label: 'Arrival Window',
              val: dispatch?.arrival_window_minutes
                ? `${dispatch.arrival_window_minutes} min`
                : 'ASAP',
              color: 'text-amber-400',
            },
            {
              icon: Users,
              label: 'Surfers',
              val: `${crewLineup.length + 1} total`,
              color: 'text-green-400',
            },
          ].map(({ icon: Icon, label, val, color }) => (
            <div
              key={label}
              className={`p-3 rounded-xl ${
                isLight ? 'bg-gray-50' : 'bg-zinc-800/50'
              }`}
            >
              <div className={`flex items-center gap-1 ${color} mb-1`}>
                <Icon className="w-3 h-3" />
                <span className="text-[10px] font-medium">{label}</span>
              </div>
              <p className={`text-sm font-bold ${textPrimary} truncate`}>{val}</p>
            </div>
          ))}
        </div>

        {/* --- Error state --- */}
        {error && (
          <div className="flex items-center gap-2 text-amber-400 text-xs">
            <Bell className="w-4 h-4 animate-pulse" />
            <span>{error}</span>
          </div>
        )}

        {/* --- Go to Bookings + Cancel --- */}
        <div className="space-y-3 pt-2">
          {/* Primary: Go back to Bookings */}
          <Button
            onClick={() => navigate(`/bookings?tab=on_demand&highlight=${dispatchId}`)}
            className={`w-full py-4 rounded-xl font-bold ${
              isLight
                ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                : 'bg-zinc-800 hover:bg-zinc-700 text-white'
            }`}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go to Bookings
          </Button>
          <p className={`text-xs ${textSecondary} text-center`}>
            Your session is saved. You can check back anytime from the Bookings tab.
          </p>

          {/* Cancel with confirmation */}
          {!photographerAccepted && !showCancelConfirm && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              className={`w-full text-center text-sm py-3 rounded-xl border transition-colors ${
                isLight
                  ? 'border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300'
                  : 'border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-500/40'
              }`}
            >
              <X className="w-4 h-4 inline mr-1" /> Cancel Session
            </button>
          )}

          {/* Cancel confirmation dialog */}
          {showCancelConfirm && (
            <div className={`p-4 rounded-xl border-2 space-y-3 ${
              isLight ? 'bg-red-50 border-red-200' : 'bg-red-500/10 border-red-500/30'
            }`}>
              <p className={`text-sm font-medium ${textPrimary} text-center`}>
                Are you sure you want to cancel this session?
              </p>
              <p className={`text-xs ${textSecondary} text-center`}>
                Your deposit will be refunded to your account credits.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowCancelConfirm(false)}
                  className={`flex-1 ${isLight ? 'border-gray-300' : 'border-zinc-600'}`}
                >
                  Keep Session
                </Button>
                <Button
                  onClick={handleCancelSession}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold"
                >
                  Yes, Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* --- Selfie Modal --- */}
      <RequestProSelfieModal
        dispatchId={dispatchId}
        isOpen={showSelfieModal}
        onClose={() => {
          setShowSelfieModal(false);
          pollDispatch(); // Refresh to show updated selfie status
        }}
        onSuccess={() => {
          setShowSelfieModal(false);
          pollDispatch();
          toast.success('Selfie added! The photographer can now find you.');
        }}
      />
    </div>
  );
};

export default DispatchLobby;
