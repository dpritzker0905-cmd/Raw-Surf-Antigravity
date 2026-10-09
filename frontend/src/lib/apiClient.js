/**
 * apiClient -- Shared Axios instance for all Raw Surf API calls.
 *
 * Usage:
 *   import apiClient from '../lib/apiClient';
 *   const res = await apiClient.get('/profiles/123');
 *   const res = await apiClient.post('/posts', { ... });
 *
 * Auth:
 *   Bearer token is automatically injected from localStorage on every request.
 *   Token is issued by the backend /auth/login and /auth/signup routes.
 *   The backend verifies the token signature using SECRET_KEY (see backend/core/security.py).
 *
 * Base URL is set from REACT_APP_BACKEND_URL env var.
 */

import axios from 'axios';
import { toast } from 'sonner';
import { markSessionRejected, sessionRejectedRecently } from './sessionRejection';

const DEFAULT_BACKEND_URL = 'https://raw-surf-antigravity.onrender.com';

/** Raw backend origin (no /api suffix) G for WebSocket and media URLs */
export const BACKEND_URL = (typeof window !== 'undefined' && (window.__BACKEND_URL__ || window.localStorage.getItem('__BACKEND_URL__'))) || process.env.REACT_APP_BACKEND_URL || DEFAULT_BACKEND_URL;

/** Full /api base URL string -- for edge cases that still need a bare string */
export const API_BASE = `${BACKEND_URL}/api`;

/**
 * Default request timeout.
 *
 * Was 60s, justified as "handles Render free-tier cold starts (30-60s warm-up)". That premise is
 * FALSE: the backend is on a PAID Render plan and does not idle-spin-down, so no request is
 * waiting on a 30-60s wake. What the 60s actually bought was a 60-second delay before a genuine
 * failure -- a saturated box, a stalled upstream, a dead worker -- became visible to the user.
 *
 * 15s covers a deploy-restart blip (the one real stall left) with margin, and surfaces real
 * breakage ~4x sooner. Compare the feed's own 8s timeout, which has been shorter than the
 * "30s cold start" its comment claimed all along and has not caused trouble.
 *
 * Genuinely slow endpoints are NOT covered by this and must not be: see SLOW_ENDPOINTS below.
 */
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Endpoints that are legitimately slow -- model inference, image compositing, bulk fan-out --
 * and were silently relying on the old 60s default. Dropping the default without these would
 * convert working features into timeouts, so each is pinned explicitly with its reason.
 *
 * A caller passing its own `timeout` always wins over this list.
 */
const SLOW_ENDPOINTS = [
  { pattern: /^\/ai\/(suggest-tags|face-match|analyze-photo|scan-surfboard)/, ms: 90000 }, // vision model inference
  { pattern: /^\/gallery\/trigger-ai-match/, ms: 90000 },                                  // batch face-match fan-out
  { pattern: /^\/gallery\/generate-watermark-preview/, ms: 60000 },                         // server-side image compositing
  { pattern: /^\/compliance\/data-export\//, ms: 120000 },                                  // full-account GDPR export
  { pattern: /^\/admin\/bulk-campaigns\/[^/]+\/send/, ms: 120000 },                         // fan-out to every recipient
];

const apiClient = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

// --- Cold-start warmup: REMOVED ---
// A fire-and-forget GET /api/health used to run here at module-import time, to start waking a
// spun-down Render box before React rendered. Its own closing note read: "The real fix is keeping
// the backend warm (a cron ping every ~10 min, or a PAID TIER)." That fix has since been applied --
// the backend is on a paid plan and does not idle-spin-down -- so the ping woke nothing and was
// simply one extra request on every single app load. Deleted rather than re-commented: there is no
// remaining behaviour to explain. (Connection pre-warm is not a reason to keep it; the first real
// request follows milliseconds later and opens the connection itself.)

// --- Request interceptor -- inject auth token ---
apiClient.interceptors.request.use(
  (config) => {
    // Inject Bearer token from stored user session
    try {
      const stored = localStorage.getItem('raw-surf-user');
      if (stored) {
        const user = JSON.parse(stored);
        if (user?.access_token) {
          config.headers['Authorization'] = `Bearer ${user.access_token}`;
        }
      }
    } catch {
 // Malformed localStorage -- silently skip; 401 interceptor below will handle
    }

    // Raise the timeout for known-slow endpoints. Only when the caller did NOT set its own:
    // axios has already merged defaults by this point, so `timeout === DEFAULT_TIMEOUT_MS` is
    // how we detect "caller expressed no opinion".
    if (config.timeout === DEFAULT_TIMEOUT_MS && typeof config.url === 'string') {
      const slow = SLOW_ENDPOINTS.find((e) => e.pattern.test(config.url));
      if (slow) {
        config.timeout = slow.ms;
      }
    }

    // Per-request debug is OPT-IN (window.__RAW_API_DEBUG__ = true): the dispatch/unread-count
    // pollers fire every few seconds, so the old always-on dev line flooded the console within a
    // minute and drowned the marine forensic logs. Errors/warnings below stay always-on in dev.
    if (process.env.NODE_ENV === 'development'
        && typeof window !== 'undefined' && window.__RAW_API_DEBUG__ === true) {
      console.debug(`[apiClient] ${config.method?.toUpperCase()} ${config.url}`);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// --- 401 -> the sign-in form: once per refused session, never a loop ---
// The redirect is a HARD load, so module state only dedupes the 401s of one page (`_redirectPending`
// is deliberately NOT reset by a later 2xx: that reset scheduled one redirect per 401 that followed
// a success, i.e. several GET /auth per page). What survives the hard load is the sessionRejection
// mark. 2026-10-08: without it, a session that re-appeared after the clear (the development mock
// seed in AuthContext, another tab) cycled 401 -> /auth -> /feed -> 401 until the tab was closed.
let _redirectPending = false;
let _signInPromptShown = false;

const SIGN_IN_PATH = '/auth?tab=login';
const SESSION_TOAST_ID = 'session-expired';
const SESSION_KEYS = ['raw-surf-user', 'raw-surf-user-original', 'impersonation_session',
  'isGodMode', 'isPersonaBarActive', 'activePersona',
  'godModeMinimized', 'godModeDesktopMinimized'];

const clearStoredSession = () => SESSION_KEYS.forEach((k) => localStorage.removeItem(k));

function handleRefusedSession() {
  const currentPath = window.location.pathname;
  // Not from the auth page itself, nor from the admin console (it handles its own auth errors).
  if (currentPath.startsWith('/auth') || currentPath.startsWith('/admin')) return;
  if (_redirectPending) return;

  if (sessionRejectedRecently()) {
    // A 401 redirect landed in this tab moments ago and the session is refused AGAIN: something
    // re-armed it. Navigating now would be the loop. Drop what was refused and offer the form;
    // the next navigation is the user's click.
    clearStoredSession();
    if (!_signInPromptShown) {
      _signInPromptShown = true;
      toast.error('Your session was not accepted -- please sign in.', {
        id: SESSION_TOAST_ID,
        duration: Infinity,
        action: { label: 'Sign in', onClick: () => { window.location.href = SIGN_IN_PATH; } },
      });
    }
    return;
  }

  _redirectPending = true;
  markSessionRejected();
  toast.error('Session expired -- please sign in again.', { id: SESSION_TOAST_ID, duration: 4000 });
  setTimeout(() => {
    clearStoredSession();
    window.location.href = SIGN_IN_PATH;
  }, 2000);
}

// --- Response interceptor -- handle auth errors ---
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      // Network / CORS errors
      if (process.env.NODE_ENV === 'development') {
        console.error('[apiClient] Network error:', error.message);
      }
      // Don't show toast for cancelled requests
      if (axios.isCancel(error)) return Promise.reject(error);
      return Promise.reject(error);
    }

    const { status } = error.response;
    const url = error.config?.url || '';

 // 401 -- token expired or invalid.
    // Do NOT redirect if already on /auth (avoids redirect loops).
 // Do NOT redirect for admin-only endpoints -- let the admin console handle
    // those errors gracefully via its own .catch() handlers. The admin console
    // fires 7+ parallel API calls on load; a single transient 401 should NOT nuke
    // the entire session.
    // WARNING: the original justification named "Render cold-start timing" as the source of that
    // transient 401. That is not a real mechanism -- a cold start yields a timeout or a 502, never
    // a 401 -- and the backend is on a paid plan with no idle spin-down anyway. The SUPPRESSION is
    // left in place because it stands on its own (the admin console handles its own auth errors,
    // and the /admin path check in handleRefusedSession already blocks the redirect), but it rests
    // on a thinner rationale than it appears to: a 401 reaching here is probably GENUINE. Worth
    // revisiting on its own merits rather than as cold-start debris.
    if (status === 401) {
 // Skip if this is an auth call itself (login/signup) G let the caller handle it
      const isAuthCall = url.includes('/auth/login') || url.includes('/auth/signup');
 // Skip admin-only endpoints -- the admin console handles these errors itself
      const isAdminCall = url.includes('/admin/');
      if (!isAuthCall && !isAdminCall) {
        handleRefusedSession();
      }
      return Promise.reject(error);
    }

 // 403 -- access forbidden (e.g., non-admin trying admin route)
    if (status === 403) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[apiClient] 403 Forbidden:', url);
      }
      return Promise.reject(error);
    }

 // 429 -- rate limited (backend slowdown)
    if (status === 429) {
 toast.error('Too many requests -- please wait a moment.', { duration: 3000 });
      return Promise.reject(error);
    }

 // 503 -- backend is down, restarting after a deploy, or shedding load. (Was attributed to
    // "starting up on Render free tier"; there is no free-tier idle wake -- the plan is paid.)
    if (status === 503) {
      toast.error('Service temporarily unavailable. Please try again shortly.', { duration: 5000 });
      return Promise.reject(error);
    }

    return Promise.reject(error);
  }
);

export default apiClient;
