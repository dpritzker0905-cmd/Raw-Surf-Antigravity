/**
 * weatherSession.js: the expired-session signal for forecast reads (#782 / #783, owner 2026-11-12).
 *
 * WHY. With the server's accounts-only switch on (WEATHER_TIER_CLAMP, backend/services/weather_tier_clamp.py), a
 * forecast read without a verified account is refused: 401, `X-Raw-Tier-Clamp: account`. A signed-in user whose token
 * has expired gets exactly that, and without this the map would just go blank. The weather fetch wrapper
 * (weatherAuthFetch.js) and the frame signer (staticFrameSigner.js) report such a refusal here; the prompt
 * (components/SessionExpiredPrompt.js, mounted once in App.js) listens and sends the user back through sign-in with a
 * return path, the ProtectedRoute pattern: /auth?tab=login&redirect=<where they were>.
 *
 * ONLY FOR SOMEONE WHO WAS SIGNED IN: a signed-out caller never sent a token, so its 401 is not an expired session
 * (the map route is behind ProtectedRoute anyway). Kill switch: window.__RAW_DISABLE_SESSION_PROMPT__ = true.
 */
import { markSessionRejected } from './sessionRejection';

export const WEATHER_SESSION_EXPIRED = 'raw:weather-session-expired';
export const SIGN_IN_REQUIRED = 'account';      // the server's X-Raw-Tier-Clamp value on its accounts-only 401

/** PURE: is this response the accounts-only refusal (as opposed to any other 401)? */
export function isSignInRefusal(res) {
  if (!res || res.status !== 401) return false;
  try {
    const mark = res.headers && typeof res.headers.get === 'function' ? res.headers.get('x-raw-tier-clamp') : null;
    return String(mark || '').split(',').map((s) => s.trim()).includes(SIGN_IN_REQUIRED);
  } catch (e) {
    return false;
  }
}

/** Tell the prompt that a request sent WITH this user's token was refused. Safe to call many times. */
export function reportWeatherSessionExpired(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win || win.__RAW_DISABLE_SESSION_PROMPT__ || typeof win.dispatchEvent !== 'function') return false;
  const path = (win.location && win.location.pathname) || '';
  if (path.startsWith('/auth')) return false;                     // already on the way to sign in
  try {
    win.dispatchEvent(new win.CustomEvent(WEATHER_SESSION_EXPIRED));
    return true;
  } catch (e) {
    return false;
  }
}

/** PURE: the sign-in URL that returns the user to `pathname + search` (ProtectedRoute's shape, login tab). */
export function signInAgainPath(location) {
  const here = `${(location && location.pathname) || '/'}${(location && location.search) || ''}`;
  if (!here.startsWith('/') || here.startsWith('//') || here.startsWith('/auth')) return '/auth?tab=login';
  return `/auth?tab=login&redirect=${encodeURIComponent(here)}`;
}

/**
 * Leave for the sign-in form: the refused session is dropped first (the Auth page forwards a still-"signed-in" user
 * away from the form), and the tab remembers the refusal (sessionRejection.js), so the form never auto-forwards.
 * `clearSession` is apiClient's clearStoredSession, passed in so this module stays free of the axios client.
 */
export function signInAgain({ win = window, clearSession } = {}) {
  const target = signInAgainPath(win.location);
  markSessionRejected();
  if (typeof clearSession === 'function') clearSession();
  win.location.assign(target);
  return target;
}
