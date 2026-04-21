import React, { useState } from 'react';
import { Users, Camera, ChevronDown, ChevronUp, Package, CheckCircle2, ImageIcon, Video } from 'lucide-react';

/**
 * SessionRosterCard — Surfer Delivery Tracker
 * 
 * Shows all surfers in a session with real-time delivery progress.
 * Works for: Live Sessions, Regular Bookings, On-Demand Dispatch.
 * 
 * Props:
 *   roster: Array of participant objects from session_roster
 *   sessionType: 'live' | 'booking' | 'on_demand' | 'manual'
 *   itemCount: Total items in gallery
 *   compact: boolean — if true, show mini avatars inline (for folder cards)
 *   onSurferClick: (surferId) => void — optional callback
 */
export const SessionRosterCard = ({ 
  roster = [], 
  sessionType, 
  itemCount = 0, 
  compact = false,
  onSurferClick 
}) => {
  const [expanded, setExpanded] = useState(false);

  if (!roster || roster.length === 0) return null;

  const sessionLabel = {
    live: { text: 'Live Session', color: '#10b981', emoji: '🟢' },
    booking: { text: 'Booking', color: '#3b82f6', emoji: '📅' },
    on_demand: { text: 'On-Demand', color: '#f59e0b', emoji: '⚡' },
    manual: { text: 'Manual', color: '#6b7280', emoji: '📁' }
  }[sessionType] || { text: 'Session', color: '#6b7280', emoji: '📸' };

  // ── COMPACT MODE: Mini avatars inline on folder cards ──
  if (compact) {
    const totalDelivered = roster.reduce((sum, r) => sum + (r.items_delivered || 0), 0);
    const totalIncluded = roster.reduce((sum, r) => sum + (r.photos_included || 0), 0);
    const allDone = totalDelivered >= totalIncluded && totalIncluded > 0;
    
    return (
      <div 
        className="flex items-center gap-1.5 px-3 pb-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Stacked avatars */}
        <div className="flex -space-x-2">
          {roster.slice(0, 4).map((surfer, i) => (
            <div 
              key={surfer.surfer_id} 
              className="relative"
              style={{ zIndex: 4 - i }}
            >
              {surfer.avatar_url ? (
                <img
                  src={surfer.avatar_url}
                  alt={surfer.full_name}
                  className="w-6 h-6 rounded-full border-2 object-cover"
                  style={{ 
                    borderColor: surfer.credits_remaining > 0 ? '#f59e0b' : '#10b981'
                  }}
                />
              ) : (
                <div 
                  className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-[8px] font-bold text-white"
                  style={{ 
                    borderColor: surfer.credits_remaining > 0 ? '#f59e0b' : '#10b981',
                    background: 'linear-gradient(135deg, #06b6d4, #3b82f6)'
                  }}
                >
                  {(surfer.full_name || '?')[0]}
                </div>
              )}
              {/* Tiny progress indicator */}
              {surfer.items_delivered > 0 && surfer.credits_remaining === 0 && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 flex items-center justify-center">
                  <CheckCircle2 className="w-2 h-2 text-white" />
                </div>
              )}
            </div>
          ))}
          {roster.length > 4 && (
            <div className="w-6 h-6 rounded-full border-2 border-muted bg-muted flex items-center justify-center text-[8px] font-bold text-muted-foreground">
              +{roster.length - 4}
            </div>
          )}
        </div>
        
        {/* Delivery summary */}
        <span className="text-[10px] text-muted-foreground font-medium ml-1">
          {allDone ? (
            <span className="text-emerald-500">✓ All delivered</span>
          ) : (
            <span>{totalDelivered}/{totalIncluded} sent</span>
          )}
        </span>
      </div>
    );
  }

  // ── EXPANDED MODE: Full roster with progress bars ──
  return (
    <div 
      className="rounded-xl overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(6,182,212,0.06), rgba(59,130,246,0.04))',
        border: '1px solid rgba(6,182,212,0.15)'
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div 
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: `${sessionLabel.color}20` }}
          >
            <Users className="w-4 h-4" style={{ color: sessionLabel.color }} />
          </div>
          <div className="text-left">
            <h4 className="text-sm font-semibold text-foreground">
              Session Roster
            </h4>
            <p className="text-[11px] text-muted-foreground">
              {roster.length} surfer{roster.length !== 1 ? 's' : ''} • {sessionLabel.emoji} {sessionLabel.text}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Quick summary badges */}
          {(() => {
            const delivered = roster.reduce((s, r) => s + (r.items_delivered || 0), 0);
            const included = roster.reduce((s, r) => s + (r.photos_included || 0), 0);
            return (
              <span 
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background: delivered >= included && included > 0 
                    ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                  color: delivered >= included && included > 0 
                    ? '#10b981' : '#f59e0b'
                }}
              >
                {delivered}/{included} delivered
              </span>
            );
          })()}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded roster */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {roster.map((surfer) => (
            <SurferRow 
              key={surfer.surfer_id} 
              surfer={surfer}
              itemCount={itemCount}
              onClick={onSurferClick ? () => onSurferClick(surfer.surfer_id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * SurferRow — Individual surfer delivery progress row
 */
const SurferRow = ({ surfer, itemCount, onClick }) => {
  const {
    full_name, username, avatar_url, selfie_url,
    amount_paid, photos_included, items_delivered, 
    credits_remaining, progress_pct, payment_method
  } = surfer;

  const isComplete = credits_remaining === 0 && items_delivered > 0;
  const hasCredits = credits_remaining > 0;

  return (
    <div 
      className="flex items-center gap-3 p-2.5 rounded-xl transition-all hover:bg-white/8 cursor-pointer group"
      style={{
        background: isComplete 
          ? 'rgba(16,185,129,0.06)' 
          : 'rgba(255,255,255,0.03)',
        border: `1px solid ${isComplete ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)'}`
      }}
      onClick={onClick}
    >
      {/* Avatar / Selfie */}
      <div className="relative flex-shrink-0">
        {/* Show selfie as primary reference if available, avatar as fallback */}
        {selfie_url ? (
          <img
            src={selfie_url}
            alt={full_name}
            className="w-10 h-10 rounded-xl object-cover"
            style={{ 
              border: `2px solid ${isComplete ? '#10b981' : hasCredits ? '#f59e0b' : '#6b7280'}`
            }}
          />
        ) : avatar_url ? (
          <img
            src={avatar_url}
            alt={full_name}
            className="w-10 h-10 rounded-xl object-cover"
            style={{ 
              border: `2px solid ${isComplete ? '#10b981' : hasCredits ? '#f59e0b' : '#6b7280'}`
            }}
          />
        ) : (
          <div 
            className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white"
            style={{ 
              background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
              border: `2px solid ${isComplete ? '#10b981' : hasCredits ? '#f59e0b' : '#6b7280'}`
            }}
          >
            {(full_name || '?')[0]}
          </div>
        )}
        {/* Status dot */}
        {isComplete && (
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
            <CheckCircle2 className="w-2.5 h-2.5 text-white" />
          </div>
        )}
      </div>

      {/* Name + progress */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-foreground truncate">
            {full_name || 'Unknown'}
          </span>
          {username && (
            <span className="text-[10px] text-muted-foreground">@{username}</span>
          )}
        </div>
        
        {/* Progress bar */}
        <div className="mt-1.5 flex items-center gap-2">
          <div 
            className="flex-1 h-1.5 rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.1)' }}
          >
            <div 
              className="h-full rounded-full transition-all duration-500"
              style={{ 
                width: `${Math.min(100, progress_pct || 0)}%`,
                background: isComplete 
                  ? 'linear-gradient(90deg, #10b981, #34d399)' 
                  : 'linear-gradient(90deg, #06b6d4, #3b82f6)'
              }}
            />
          </div>
          <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
            {items_delivered || 0}/{photos_included || 0}
          </span>
        </div>
      </div>

      {/* Right side — credit status */}
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        {isComplete ? (
          <span 
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}
          >
            ✓ Done
          </span>
        ) : hasCredits ? (
          <span 
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
          >
            🎟️ {credits_remaining} left
          </span>
        ) : items_delivered === 0 ? (
          <span 
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(107,114,128,0.15)', color: '#9ca3af' }}
          >
            Waiting
          </span>
        ) : null}
        
        {/* Amount paid */}
        {amount_paid > 0 && (
          <span className="text-[9px] text-muted-foreground">
            ${amount_paid.toFixed(0)} {payment_method === 'credits' ? '🪙' : '💳'}
          </span>
        )}
      </div>
    </div>
  );
};

export default SessionRosterCard;
