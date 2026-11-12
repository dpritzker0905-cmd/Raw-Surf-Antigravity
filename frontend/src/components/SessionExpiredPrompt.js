/**
 * SessionExpiredPrompt: "your session expired, sign in again" for the forecast (#782 / #783, owner 2026-11-12:
 * "include the expired-session prompt").
 *
 * With the accounts-only switch on, a forecast read whose token is no longer accepted is refused; this sends the user
 * back through sign-in WITH a return path (/auth?tab=login&redirect=<here>, the ProtectedRoute pattern) instead of
 * leaving a blank map. Mounted once in App.js. Light, dark and beach (ThemeContext); a bottom sheet on phones, a centred
 * card from `sm` up; role="alertdialog" with a focus trap, Escape = "Not now", focus restored on close.
 */
import React from 'react';
import { useThemeName } from '../contexts/ThemeContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useSessionExpiredPrompt } from '../hooks/useSessionExpiredPrompt';
import { signInAgain } from '../lib/weatherSession';
import { clearStoredSession } from '../lib/apiClient';

export function promptPalette(theme) {
  if (theme === 'light') {
    return { card: 'bg-white text-zinc-900 border-zinc-200', muted: 'text-zinc-600',
      secondary: 'border-zinc-300 text-zinc-800 hover:bg-zinc-100', scrim: 'bg-black/40' };
  }
  if (theme === 'beach') {      // beach: deepest black, brightest text (index.css .beach-mode)
    return { card: 'bg-black text-white border-zinc-500', muted: 'text-zinc-100',
      secondary: 'border-zinc-400 text-white hover:bg-zinc-900', scrim: 'bg-black/70' };
  }
  return { card: 'bg-zinc-900 text-white border-zinc-700', muted: 'text-zinc-300',
    secondary: 'border-zinc-600 text-zinc-100 hover:bg-zinc-800', scrim: 'bg-black/60' };
}

export default function SessionExpiredPrompt({ onSignIn } = {}) {
  const theme = useThemeName();
  const { open, dismiss } = useSessionExpiredPrompt();
  const trapRef = useFocusTrap(open, { onEscape: dismiss });
  if (!open) return null;
  const p = promptPalette(theme);
  const signIn = onSignIn || (() => signInAgain({ clearSession: clearStoredSession }));
  return (
    <div className={`fixed inset-0 z-[1000] flex items-end sm:items-center justify-center ${p.scrim}`}
         data-testid="session-expired-prompt">
      <div
        ref={trapRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-expired-title"
        aria-describedby="session-expired-desc"
        className={`w-full sm:max-w-sm border rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5 ${p.card}`}
      >
        <h2 id="session-expired-title" className="text-lg font-semibold">Your session has expired</h2>
        <p id="session-expired-desc" className={`mt-2 text-sm ${p.muted}`}>
          Sign in again to keep seeing the forecast. You will come straight back here.
        </p>
        {/* DOM order = focus order: the primary action first (the trap focuses it); row-reverse puts it right on desktop. */}
        <div className="mt-5 flex flex-col sm:flex-row-reverse sm:justify-start gap-2">
          <button type="button" onClick={signIn}
                  className="min-h-[44px] px-4 rounded-lg bg-yellow-400 text-black text-sm font-semibold hover:bg-yellow-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-yellow-400">
            Sign in again
          </button>
          <button type="button" onClick={dismiss}
                  className={`min-h-[44px] px-4 rounded-lg border text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 ${p.secondary}`}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
