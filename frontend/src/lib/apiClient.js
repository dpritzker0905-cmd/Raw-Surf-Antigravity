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

// --- Cold-start warmup ---
// The backend runs on Render's free tier, which spins the server down after ~15 min idle
// and takes 20-60s to wake on the next request. Fire a lightweight fire-and-forget ping at
// module-import time (before React even renders) so the server starts waking as early as
// possible, overlapping the cold start with app bootstrap instead of the user's first
// weather fetch. Any request wakes Render, so a 404 is fine; errors are intentionally ignored.
// NOTE: this only shaves time by starting the wake earlier — it does NOT eliminate the cold
// start. The real fix is keeping the backend warm (a cron ping every ~10 min, or a paid tier).
if (typeof window !== 'undefined' && typeof fetch === 'function') {
  try {
    fetch(`${BACKEND_URL}/api/health`, { method: 'GET', mode: 'cors', cache: 'no-store', keepalive: true })
      .catch(() => { /* warmup is best-effort; ignore failures */ });
  } catch { /* ignore */ }
}

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

// --- Track whether we've already shown the session-expired message ---
let _sessionExpiredShown = false;

// --- Response interceptor -- handle auth errors ---
apiClient.interceptors.response.use(
  (response) => {
    // Reset session-expired flag on any successful response
    _sessionExpiredShown = false;
    return response;
  },
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
    // fires 7+ parallel API calls on load; a single transient 401 (e.g. Render
    // cold-start timing) should NOT nuke the entire session.
    if (status === 401 && !_sessionExpiredShown) {
 // Skip if this is an auth call itself (login/signup) G let the caller handle it
      const isAuthCall = url.includes('/auth/login') || url.includes('/auth/signup');
 // Skip admin-only endpoints -- the admin console handles these errors itself
      const isAdminCall = url.includes('/admin/');
      if (!isAuthCall && !isAdminCall) {
        _sessionExpiredShown = true;
        const currentPath = window.location.pathname;
        const isAlreadyOnAuth = currentPath.startsWith('/auth');
        const isOnAdmin = currentPath.startsWith('/admin');
        if (!isAlreadyOnAuth && !isOnAdmin) {
 toast.error('Session expired -- please sign in again.', { duration: 4000 });
          setTimeout(() => {
            // Clear ALL session data before redirecting
            ['raw-surf-user', 'raw-surf-user-original', 'impersonation_session',
             'isGodMode', 'isPersonaBarActive', 'activePersona',
             'godModeMinimized', 'godModeDesktopMinimized'].forEach(k => localStorage.removeItem(k));
            window.location.href = '/auth';
          }, 2000);
        }
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

 // 503 -- backend is down / starting up on Render free tier
    if (status === 503) {
      toast.error('Service temporarily unavailable. Please try again shortly.', { duration: 5000 });
      return Promise.reject(error);
    }

    return Promise.reject(error);
  }
);

export default apiClient;
