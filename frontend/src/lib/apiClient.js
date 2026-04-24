/**
 * apiClient — Shared Axios instance for all Raw Surf API calls.
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

/** Raw backend origin (no /api suffix) — for WebSocket and media URLs */
export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

/** Full /api base URL string — for edge cases that still need a bare string */
export const API_BASE = `${BACKEND_URL}/api`;

const apiClient = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  timeout: 60000, // 60s — handles Render free-tier cold starts (30-60s warm-up)
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Request interceptor — inject auth token ───────────────────────────────────
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
      // Malformed localStorage — silently skip; 401 interceptor below will handle
    }

    if (process.env.NODE_ENV === 'development') {
      console.debug(`[apiClient] ${config.method?.toUpperCase()} ${config.url}`);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Track whether we've already shown the session-expired message ────────────
let _sessionExpiredShown = false;

// ── Response interceptor — handle auth errors ────────────────────────────────
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

    // 401 — token expired or invalid.
    // Do NOT redirect if already on /auth (avoids redirect loops).
    // Do NOT redirect for admin-only endpoints — let the admin console handle
    // those errors gracefully via its own .catch() handlers. The admin console
    // fires 7+ parallel API calls on load; a single transient 401 (e.g. Render
    // cold-start timing) should NOT nuke the entire session.
    if (status === 401 && !_sessionExpiredShown) {
      // Skip if this is an auth call itself (login/signup) — let the caller handle it
      const isAuthCall = url.includes('/auth/login') || url.includes('/auth/signup');
      // Skip admin-only endpoints — the admin console handles these errors itself
      const isAdminCall = url.includes('/admin/');
      if (!isAuthCall && !isAdminCall) {
        _sessionExpiredShown = true;
        const currentPath = window.location.pathname;
        const isAlreadyOnAuth = currentPath.startsWith('/auth');
        const isOnAdmin = currentPath.startsWith('/admin');
        if (!isAlreadyOnAuth && !isOnAdmin) {
          toast.error('Session expired — please sign in again.', { duration: 4000 });
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

    // 403 — access forbidden (e.g., non-admin trying admin route)
    if (status === 403) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[apiClient] 403 Forbidden:', url);
      }
      return Promise.reject(error);
    }

    // 429 — rate limited (backend slowdown)
    if (status === 429) {
      toast.error('Too many requests — please wait a moment.', { duration: 3000 });
      return Promise.reject(error);
    }

    // 503 — backend is down / starting up on Render free tier
    if (status === 503) {
      toast.error('Service temporarily unavailable. Please try again shortly.', { duration: 5000 });
      return Promise.reject(error);
    }

    return Promise.reject(error);
  }
);

export default apiClient;
