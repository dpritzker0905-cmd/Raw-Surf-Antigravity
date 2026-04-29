/**
 * ActiveSessionBanner.js
 *
 * Collapsible persistent banner that sits above the mobile BottomNav.
 * Shows active on-demand dispatch, live session, or pending crew invite.
 *
 * States:
 *   COLLAPSED: Thin pulsing color bar (4px) — minimal footprint
 *   EXPANDED:  Full context card with status, photographer, ETA, CTA
 *
 * Interaction: Tap collapsed bar to expand, tap chevron to collapse.
 * Navigation: Tap the expanded card to navigate to the session lobby.
 *
 * Color scheme:
 *   On-Demand (captain): Amber/Orange gradient
 *   On-Demand (crew):    Cyan/Blue gradient
 *   Live Session:        Green/Emerald gradient
 */

import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import {
  Radio, ChevronUp, ChevronDown, MapPin, Camera, Loader2, Zap,
} from 'lucide-react';
import useActiveSession from '../hooks/useActiveSession';

// ── Status label map ──
const STATUS_LABELS = {
  searching_for_pro: { captain: 'Finding Photographer...', crew: 'Waiting for Photographer...' },
  pending_payment:   { captain: 'Payment Pending', crew: 'Waiting for Captain to Pay' },
  accepted:          { captain: 'Photographer Confirmed!', crew: 'Photographer Confirmed!' },
  en_route:          { captain: 'On The Way', crew: 'On The Way!' },
  arrived:           { captain: 'Photographer Arrived!', crew: 'Arrived!' },
  in_session:        { captain: 'Session Active 📸', crew: 'Session Active 📸' },
};

export const ActiveSessionBanner = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
  const { activeSession } = useActiveSession();
  const [isExpanded, setIsExpanded] = useState(false);

  const isLight = theme === 'light';

  // Don't show on the lobby page itself (avoid redundancy)
  const isOnLobby = location.pathname.includes('/dispatch/') && location.pathname.includes('/lobby');
  // Don't show on the on-demand tab (card is already there)
  const isOnDemandTab = location.pathname === '/bookings' && location.search.includes('tab=on_demand');

  if (!activeSession || isOnLobby || isOnDemandTab) return null;

  const isCrew = activeSession.role === 'crew_member';
  const statusKey = activeSession.status;
  const labels = STATUS_LABELS[statusKey] || { captain: 'Session Active', crew: 'Session Active' };
  const statusLabel = isCrew ? labels.crew : labels.captain;

  // ── Color config ──
  const colorConfig = isCrew
    ? {
        barGradient: 'from-cyan-400 via-blue-500 to-cyan-400',
        bgExpanded: isLight ? 'bg-gradient-to-r from-cyan-50 to-blue-50' : 'bg-gradient-to-r from-cyan-950/80 to-blue-950/80',
        border: isLight ? 'border-cyan-300' : 'border-cyan-500/40',
        textAccent: isLight ? 'text-cyan-600' : 'text-cyan-400',
        iconBg: isLight ? 'bg-cyan-100' : 'bg-cyan-500/20',
        glow: 'shadow-cyan-400/20',
      }
    : {
        barGradient: 'from-amber-400 via-orange-500 to-amber-400',
        bgExpanded: isLight ? 'bg-gradient-to-r from-amber-50 to-orange-50' : 'bg-gradient-to-r from-amber-950/80 to-orange-950/80',
        border: isLight ? 'border-amber-300' : 'border-amber-500/40',
        textAccent: isLight ? 'text-amber-600' : 'text-amber-400',
        iconBg: isLight ? 'bg-amber-100' : 'bg-amber-500/20',
        glow: 'shadow-amber-400/20',
      };

  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';

  // Navigate to the session
  const handleNavigate = () => {
    if (['accepted', 'en_route', 'arrived', 'in_session'].includes(activeSession.status)) {
      navigate(`/dispatch/${activeSession.id}/lobby`);
    } else {
      navigate('/bookings?tab=on_demand');
    }
  };

  // ── Collapsed state: thin pulsing gradient bar ──
  if (!isExpanded) {
    return (
      <div
        className="fixed left-0 right-0 z-[99] md:hidden cursor-pointer"
        style={{ bottom: 'var(--bottomnav-h, 64px)' }}
        onClick={() => setIsExpanded(true)}
        data-testid="session-banner-collapsed"
      >
        {/* Pulsing gradient bar */}
        <div
          className={`h-[5px] w-full bg-gradient-to-r ${colorConfig.barGradient} animate-[pulse_2.5s_ease-in-out_infinite]`}
        />
        {/* Tiny pull-up indicator */}
        <div className="absolute left-1/2 -translate-x-1/2 -top-3 flex flex-col items-center">
          <div className={`w-8 h-3 rounded-t-lg ${isLight ? 'bg-white/90' : 'bg-zinc-900/90'} border border-b-0 ${colorConfig.border} flex items-center justify-center backdrop-blur-sm`}>
            <ChevronUp className={`w-3 h-3 ${colorConfig.textAccent}`} />
          </div>
        </div>
      </div>
    );
  }

  // ── Expanded state: full context card ──
  return (
    <div
      className={`fixed left-0 right-0 z-[99] md:hidden`}
      style={{ bottom: 'var(--bottomnav-h, 64px)' }}
      data-testid="session-banner-expanded"
    >
      <div className={`mx-2 mb-1 rounded-2xl border ${colorConfig.border} ${colorConfig.bgExpanded} shadow-lg ${colorConfig.glow} backdrop-blur-md overflow-hidden`}>
        {/* Top gradient accent line */}
        <div className={`h-[3px] bg-gradient-to-r ${colorConfig.barGradient}`} />

        <div className="px-3 py-2.5">
          <div className="flex items-center gap-3">
            {/* Status icon */}
            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${colorConfig.iconBg}`}>
              {['searching_for_pro', 'en_route'].includes(activeSession.status) ? (
                <Radio className={`w-4 h-4 animate-pulse ${colorConfig.textAccent}`} />
              ) : activeSession.status === 'in_session' ? (
                <Camera className={`w-4 h-4 ${colorConfig.textAccent}`} />
              ) : (
                <Zap className={`w-4 h-4 ${colorConfig.textAccent}`} />
              )}
            </div>

            {/* Status text */}
            <div
              className="flex-1 min-w-0 cursor-pointer"
              onClick={handleNavigate}
            >
              <div className="flex items-center gap-1.5">
                <p className={`text-xs font-bold ${textPrimary} truncate`}>
                  {statusLabel}
                </p>
                {['searching_for_pro', 'en_route'].includes(activeSession.status) && (
                  <Loader2 className={`w-3 h-3 animate-spin flex-shrink-0 ${colorConfig.textAccent}`} />
                )}
              </div>
              <p className={`text-[11px] ${textSecondary} truncate flex items-center gap-1`}>
                {activeSession.eta && (
                  <span className={`font-semibold ${colorConfig.textAccent}`}>
                    ~{activeSession.eta} min
                  </span>
                )}
                {activeSession.eta && activeSession.locationName && <span>·</span>}
                {activeSession.locationName && (
                  <>
                    <MapPin className="w-2.5 h-2.5 inline flex-shrink-0" />
                    <span className="truncate">{activeSession.locationName}</span>
                  </>
                )}
                {!activeSession.eta && !activeSession.locationName && (
                  <span>{activeSession.photographerName}</span>
                )}
              </p>
            </div>

            {/* Tap to view CTA */}
            <button
              onClick={handleNavigate}
              className={`flex-shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all active:scale-95 ${
                isLight
                  ? `${colorConfig.textAccent} bg-white border ${colorConfig.border}`
                  : `text-black bg-gradient-to-r ${colorConfig.barGradient}`
              }`}
            >
              View
            </button>

            {/* Collapse button */}
            <button
              onClick={(e) => { e.stopPropagation(); setIsExpanded(false); }}
              className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800'
              }`}
            >
              <ChevronDown className={`w-3.5 h-3.5 ${textSecondary}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActiveSessionBanner;
