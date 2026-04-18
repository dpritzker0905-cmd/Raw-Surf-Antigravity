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
  timeout: 30000,
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

// ── Response interceptor — handle auth errors ────────────────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[apiClient] Network error:', error.message);
      }
      return Promise.reject(error);
    }

    const { status } = error.response;

    // 401 — token expired or invalid. Clear session and redirect to login.
    if (status === 401) {
      setTimeout(() => {
        localStorage.removeItem('raw-surf-user');
        localStorage.removeItem('raw-surf-token');
        window.location.href = '/auth';
      }, 500);
      return Promise.reject(error);
    }

    // 503 — backend is down
    if (status === 503) {
      toast.error('Service temporarily unavailable. Please try again.');
      return Promise.reject(error);
    }

    return Promise.reject(error);
  }
);

export default apiClient;
