/**
 * ActiveSessionBanner.js
 *
 * Multi-platform persistent session awareness component.
 *
 * MOBILE (md:hidden):
 *   Collapsed: Thin pulsing gradient bar above BottomNav with pull-up
 *              handle offset to the RIGHT (avoids Create button center overlap).
 *   Expanded:  Full context card with status, photographer, ETA, CTA.
 *
 * DESKTOP (hidden md:flex):
 *   Collapsed: Vertical accent strip on the left edge of the sidebar.
 *   Expanded:  Horizontal card that slides out from the sidebar to the right.
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
  Radio, ChevronUp, ChevronDown, ChevronRight, ChevronLeft,
  MapPin, Camera, Loader2, Zap,
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

// ── Shared color config factory ──
const getColorConfig = (isCrew, isLight) => isCrew
  ? {
      barGradient: 'from-cyan-400 via-blue-500 to-cyan-400',
      barBg: 'bg-cyan-400',
      bgExpanded: isLight ? 'bg-gradient-to-r from-cyan-50 to-blue-50' : 'bg-gradient-to-r from-cyan-950/80 to-blue-950/80',
      border: isLight ? 'border-cyan-300' : 'border-cyan-500/40',
      textAccent: isLight ? 'text-cyan-600' : 'text-cyan-400',
      iconBg: isLight ? 'bg-cyan-100' : 'bg-cyan-500/20',
      glow: 'shadow-cyan-400/20',
    }
  : {
      barGradient: 'from-amber-400 via-orange-500 to-amber-400',
      barBg: 'bg-amber-400',
      bgExpanded: isLight ? 'bg-gradient-to-r from-amber-50 to-orange-50' : 'bg-gradient-to-r from-amber-950/80 to-orange-950/80',
      border: isLight ? 'border-amber-300' : 'border-amber-500/40',
      textAccent: isLight ? 'text-amber-600' : 'text-amber-400',
      iconBg: isLight ? 'bg-amber-100' : 'bg-amber-500/20',
      glow: 'shadow-amber-400/20',
    };

// ── Status icon component ──
const StatusIcon = ({ status, colorConfig }) => {
  if (['searching_for_pro', 'en_route'].includes(status)) {
    return <Radio className={`w-4 h-4 animate-pulse ${colorConfig.textAccent}`} />;
  }
  if (status === 'in_session') {
    return <Camera className={`w-4 h-4 ${colorConfig.textAccent}`} />;
  }
  return <Zap className={`w-4 h-4 ${colorConfig.textAccent}`} />;
};


// ═══════════════════════════════════════════════════════════════════════
// MOBILE BANNER — Sits above BottomNav
// ═══════════════════════════════════════════════════════════════════════

const MobileBanner = ({ activeSession, colorConfig, isLight, isExpanded, setIsExpanded, handleNavigate, statusLabel }) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';

  // ── Collapsed: thin pulsing bar ──
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
        {/* Pull-up handle — positioned RIGHT to avoid center Create button */}
        <div className="absolute right-16 -top-3 flex flex-col items-center">
          <div className={`w-8 h-3 rounded-t-lg ${isLight ? 'bg-white/90' : 'bg-zinc-900/90'} border border-b-0 ${colorConfig.border} flex items-center justify-center backdrop-blur-sm`}>
            <ChevronUp className={`w-3 h-3 ${colorConfig.textAccent}`} />
          </div>
        </div>
      </div>
    );
  }

  // ── Expanded: full context card ──
  return (
    <div
      className="fixed left-0 right-0 z-[99] md:hidden"
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
              <StatusIcon status={activeSession.status} colorConfig={colorConfig} />
            </div>

            {/* Status text */}
            <div className="flex-1 min-w-0 cursor-pointer" onClick={handleNavigate}>
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

            {/* View CTA */}
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

            {/* Collapse */}
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


// ═══════════════════════════════════════════════════════════════════════
// TOPNAV NOTIFICATION LINE — Thin accent line at the bottom of the header
// ═══════════════════════════════════════════════════════════════════════

const TopNavLine = ({ colorConfig }) => {
  return (
    <div
      className="fixed left-0 right-0 z-[101] md:hidden pointer-events-none"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 44px)' }}
      data-testid="session-topnav-line"
    >
      <div
        className={`h-[3px] w-full bg-gradient-to-r ${colorConfig.barGradient} animate-[pulse_3s_ease-in-out_infinite]`}
      />
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// DESKTOP SIDEBAR PILL — Vertical strip that expands horizontally
// ═══════════════════════════════════════════════════════════════════════

const DesktopSidebarPill = ({ activeSession, colorConfig, isLight, isExpanded, setIsExpanded, handleNavigate, statusLabel }) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';

  // ── Collapsed: vertical accent strip on the sidebar's right edge ──
  if (!isExpanded) {
    return (
      <div
        className="fixed hidden md:flex z-[101] cursor-pointer group"
        style={{ left: '197px', top: '50%', transform: 'translateY(-50%)' }}
        onClick={() => setIsExpanded(true)}
        data-testid="session-desktop-collapsed"
      >
        {/* Vertical pulsing strip */}
        <div
          className={`w-[4px] h-16 rounded-r-full bg-gradient-to-b ${colorConfig.barGradient} animate-[pulse_2.5s_ease-in-out_infinite] group-hover:w-[6px] transition-all`}
        />
        {/* Expand arrow */}
        <div className={`absolute -right-4 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full ${isLight ? 'bg-white' : 'bg-zinc-800'} border ${colorConfig.border} flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm`}>
          <ChevronRight className={`w-3 h-3 ${colorConfig.textAccent}`} />
        </div>
      </div>
    );
  }

  // ── Expanded: horizontal card that slides out from the sidebar ──
  return (
    <div
      className="fixed hidden md:block z-[101] animate-in slide-in-from-left duration-200"
      style={{ left: '204px', top: '50%', transform: 'translateY(-50%)' }}
      data-testid="session-desktop-expanded"
    >
      <div className={`w-[280px] rounded-xl border ${colorConfig.border} ${colorConfig.bgExpanded} shadow-xl ${colorConfig.glow} backdrop-blur-md overflow-hidden`}>
        {/* Left accent strip */}
        <div className="flex">
          <div className={`w-[3px] bg-gradient-to-b ${colorConfig.barGradient} flex-shrink-0`} />

          <div className="flex-1 px-3 py-3">
            {/* Header row */}
            <div className="flex items-center justify-between mb-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${colorConfig.textAccent}`}>
                Active Session
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setIsExpanded(false); }}
                className={`w-5 h-5 rounded-full flex items-center justify-center ${
                  isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-700'
                }`}
              >
                <ChevronLeft className={`w-3 h-3 ${textSecondary}`} />
              </button>
            </div>

            {/* Status row */}
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${colorConfig.iconBg}`}>
                <StatusIcon status={activeSession.status} colorConfig={colorConfig} />
              </div>
              <div className="flex-1 min-w-0">
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
                    <span className={`font-semibold ${colorConfig.textAccent}`}>~{activeSession.eta} min</span>
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
            </div>

            {/* CTA */}
            <button
              onClick={handleNavigate}
              className={`mt-2.5 w-full py-1.5 rounded-lg text-xs font-bold text-center transition-all active:scale-[0.98] ${
                isLight
                  ? `${colorConfig.textAccent} bg-white border ${colorConfig.border} hover:shadow-md`
                  : `text-black bg-gradient-to-r ${colorConfig.barGradient} hover:opacity-90`
              }`}
            >
              View Session →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// MAIN EXPORT — Orchestrates all three sub-components
// ═══════════════════════════════════════════════════════════════════════

export const ActiveSessionBanner = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
  const { activeSession } = useActiveSession();
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [desktopExpanded, setDesktopExpanded] = useState(false);

  const isLight = theme === 'light';

  // Don't show on the lobby page itself (avoid redundancy)
  const isOnLobby = location.pathname.includes('/dispatch/') && location.pathname.includes('/lobby');
  const isOnDemandTab = location.pathname === '/bookings' && location.search.includes('tab=on_demand');

  if (!activeSession || isOnLobby || isOnDemandTab) return null;

  const isCrew = activeSession.role === 'crew_member';
  const statusKey = activeSession.status;
  const labels = STATUS_LABELS[statusKey] || { captain: 'Session Active', crew: 'Session Active' };
  const statusLabel = isCrew ? labels.crew : labels.captain;
  const colorConfig = getColorConfig(isCrew, isLight);

  const handleNavigate = () => {
    if (['accepted', 'en_route', 'arrived', 'in_session'].includes(activeSession.status)) {
      navigate(`/dispatch/${activeSession.id}/lobby`);
    } else {
      navigate('/bookings?tab=on_demand');
    }
  };

  return (
    <>
      {/* Mobile: TopNav accent line (always visible when session active) */}
      <TopNavLine colorConfig={colorConfig} />

      {/* Mobile: Collapsible banner above BottomNav */}
      <MobileBanner
        activeSession={activeSession}
        colorConfig={colorConfig}
        isLight={isLight}
        isExpanded={mobileExpanded}
        setIsExpanded={setMobileExpanded}
        handleNavigate={handleNavigate}
        statusLabel={statusLabel}
      />

      {/* Desktop: Sidebar vertical pill that expands */}
      <DesktopSidebarPill
        activeSession={activeSession}
        colorConfig={colorConfig}
        isLight={isLight}
        isExpanded={desktopExpanded}
        setIsExpanded={setDesktopExpanded}
        handleNavigate={handleNavigate}
        statusLabel={statusLabel}
      />
    </>
  );
};

export default ActiveSessionBanner;
