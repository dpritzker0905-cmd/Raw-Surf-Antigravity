/**
 * RateLimitNotice: "Too many requests - try again in N s" while the per-account limit holds this tab (#815; owner
 * 2026-11-12 11:45 EST: "add the too-many-requests notice to #815").
 *
 * lib/weatherRateLimit.js raises `raw:weather-rate-limited` with the time the hold ends; this counts down once a second
 * and removes itself when the wait is over. Non-modal: a status message (role="status", aria-live="polite"), never a
 * dialog, never focus-stealing. Mounted once in App.js (not AppLayout / routing/*, Codex-reserved), fixed above the
 * bottom edge on phones and top-centre from `sm` up. Light, dark and beach (ThemeContext).
 * Kill switch: window.__RAW_DISABLE_RATE_LIMIT_NOTICE__ (lib/weatherRateLimit.js: no hold, no event, no notice).
 */
import React, { useEffect, useState } from 'react';
import { useThemeName } from '../contexts/ThemeContext';
import { WEATHER_RATE_LIMITED } from '../lib/weatherRateLimit';

export function noticePalette(theme) {
  if (theme === 'light') return 'bg-white text-zinc-900 border-zinc-300';
  if (theme === 'beach') return 'bg-black text-white border-zinc-400';
  return 'bg-zinc-900 text-white border-zinc-600';
}

export function useRateLimitHold({ win = typeof window !== 'undefined' ? window : undefined, now = Date.now } = {}) {
  const [until, setUntil] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!win || typeof win.addEventListener !== 'function') return undefined;
    const on = (e) => {
      if (win.__RAW_DISABLE_RATE_LIMIT_NOTICE__) return;
      const u = Number(e && e.detail && e.detail.until) || 0;
      setUntil((prev) => Math.max(prev, u));
    };
    win.addEventListener(WEATHER_RATE_LIMITED, on);
    return () => win.removeEventListener(WEATHER_RATE_LIMITED, on);
  }, [win]);
  const left = until ? Math.ceil((until - now()) / 1000) : 0;
  useEffect(() => {
    if (left <= 0) {
      if (until) setUntil(0);
      return undefined;
    }
    const t = setTimeout(() => tick((n) => n + 1), 1000);
    return () => clearTimeout(t);
  }, [left, until]);
  return left > 0 ? left : 0;
}

// Closed, the mount reads nothing but the signal (App-level tests mock ThemeContext down to its provider).
export default function RateLimitNotice() {
  const left = useRateLimitHold();
  return left > 0 ? <RateLimitMessage seconds={left} /> : null;
}

function RateLimitMessage({ seconds }) {
  const theme = useThemeName();
  return (
    <div className="fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-auto sm:top-4 z-[999] flex justify-center px-4 pointer-events-none">
      <div role="status" aria-live="polite" data-testid="rate-limit-notice"
           className={`pointer-events-auto max-w-sm w-full sm:w-auto border rounded-xl shadow-lg px-4 py-3 text-sm font-medium ${noticePalette(theme)}`}>
        Too many requests — try again in {seconds} s
      </div>
    </div>
  );
}
