/**
 * weatherAuthFetch.js: send the signed-in user's session token on this backend's /api/weather/ reads (O5 / TIER-1).
 *
 * WHY. The server now clamps forecast reads to the caller's tier (backend/services/weather_tier_clamp.py), resolved
 * from a VERIFIED JWT. The map's weather clients call bare `fetch(url)` (backendWeatherServiceClient, marineGridSeries,
 * windGridSeries, spotRatingsClient, pointRatingClient, ...), so without this every request is anonymous and, with the
 * server clamp ON, every paying user would be served the guest window. One wrapper, installed once in index.js, covers
 * every current and future weather fetch without touching each call site.
 *
 * SCOPE. Only URLs under `${BACKEND_URL}/api/weather/` (or the same-origin `/api/weather/`), only when no Authorization
 * is already set, and only the token the axios apiClient already sends (localStorage 'raw-surf-user'.access_token).
 * Static frame CDN GETs and third-party URLs are never touched (the token must not leave this backend).
 * Kill switch: window.__RAW_DISABLE_WEATHER_AUTH__ = true (then nothing is added; the server treats the caller as guest).
 */
import { BACKEND_URL } from './apiClient';

export function storedAccessToken(storage) {
  try {
    const raw = storage && storage.getItem('raw-surf-user');
    const user = raw ? JSON.parse(raw) : null;
    return (user && typeof user.access_token === 'string' && user.access_token) || null;
  } catch (e) {
    return null;
  }
}

export function isBackendWeatherUrl(url, backendUrl = BACKEND_URL) {
  if (typeof url !== 'string' || !url) return false;
  const base = String(backendUrl || '').replace(/\/+$/, '');
  if (base && url.startsWith(`${base}/api/weather/`)) return true;
  return url.startsWith('/api/weather/');
}

function hasAuthorization(headers) {
  if (!headers) return false;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.has('authorization');
  if (Array.isArray(headers)) return headers.some(([k]) => String(k).toLowerCase() === 'authorization');
  return Object.keys(headers).some((k) => k.toLowerCase() === 'authorization');
}

/** PURE: the init to fetch with. Returns `init` unchanged unless a token should be added. */
export function withWeatherAuth(input, init, { backendUrl = BACKEND_URL, token = null, disabled = false } = {}) {
  if (disabled || !token || typeof input !== 'string' || !isBackendWeatherUrl(input, backendUrl)) return init;
  const base = init || {};
  if (hasAuthorization(base.headers)) return init;
  let headers;
  if (typeof Headers !== 'undefined' && base.headers instanceof Headers) {
    headers = new Headers(base.headers);
    headers.set('Authorization', `Bearer ${token}`);
  } else if (Array.isArray(base.headers)) {
    headers = [...base.headers, ['Authorization', `Bearer ${token}`]];
  } else {
    headers = { ...(base.headers || {}), Authorization: `Bearer ${token}` };
  }
  return { ...base, headers };
}

export function installWeatherAuthFetch(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win || typeof win.fetch !== 'function' || win.__RAW_WEATHER_AUTH_INSTALLED__) return false;
  const inner = win.fetch;
  win.fetch = function weatherAuthFetch(input, init) {
    const next = withWeatherAuth(input, init, {
      token: storedAccessToken(win.localStorage),
      disabled: !!win.__RAW_DISABLE_WEATHER_AUTH__,
    });
    return inner.call(this, input, next);
  };
  win.__RAW_WEATHER_AUTH_INSTALLED__ = true;
  return true;
}
