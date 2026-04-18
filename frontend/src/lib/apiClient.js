/**
 * apiClient — Shared Axios instance for all Raw Surf API calls.
 *
 * Usage:
 *   import apiClient from '../lib/apiClient';
 *   const res = await apiClient.get('/profiles/123');
 *   const res = await apiClient.post('/posts', { ... });
 *
 * Base URL is set from REACT_APP_BACKEND_URL env var.
 * All frontend components should use this instead of raw axios + manual URL construction.
 */

import axios from 'axios';
import { toast } from 'sonner';

const apiClient = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL}/api`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Request interceptor ──────────────────────────────────────────────────────
apiClient.interceptors.request.use(
  (config) => {
    // Dev logging — removed in production builds via env check
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[apiClient] ${config.method?.toUpperCase()} ${config.url}`);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor ─────────────────────────────────────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Network failure (no response at all)
    if (!error.response) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[apiClient] Network error:', error.message);
      }
      // Don't auto-toast — let each call site decide how to handle
      return Promise.reject(error);
    }

    const { status } = error.response;

    // 401 — session expired or invalid user_id. Reload to re-auth.
    if (status === 401) {
      // Give the UI a moment before redirecting
      setTimeout(() => {
        localStorage.removeItem('raw-surf-user');
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

/**
 * Convenience: raw backend URL (without /api) for WebSocket and media URLs.
 * Use this anywhere you need `process.env.REACT_APP_BACKEND_URL` directly.
 */
export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

/**
 * Convenience: full /api base URL string (for places that still need a string, e.g. fetch()).
 */
export const API_BASE = `${BACKEND_URL}/api`;
