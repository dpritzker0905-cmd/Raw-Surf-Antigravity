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
 *
 * ONE SWITCH FOR BOTH HALVES (owner 2026-11-11, "Yes, hold both"). The token is sent ONLY while the server says its
 * tier clamp is on, so with the clamp off the browser sends no Authorization header and makes no CORS preflight.
 * The state comes from, in order: the latest /api/weather/ response's `X-Raw-Tier-Clamp-On` header (so a manifest flip
 * is followed mid-session), else the `tier_clamp` field the server puts on every /capabilities row (read from
 * window.__WEATHER_CAPABILITIES__, which the resolver loads at start), else OFF.
 * SELF-HEAL AT THE FLIP: if an answer comes back clamped (`X-Raw-Tier-Clamp`) to a signed-in user whose token was not
 * sent (the state was still OFF), it is re-requested ONCE with the token, so a paying user is never left with a guest page.
 *
 * ACCOUNTS ONLY (owner 2026-11-12, #782): with the switch on, a read without a verified account is REFUSED (401,
 * `X-Raw-Tier-Clamp: account`), not clamped. The same self-heal covers it: a signed-in user's refused request is
 * re-asked once with the token. A refusal of a request that DID carry the token means the session is no longer accepted
 * (expired), and is reported to the sign-in prompt (weatherSession.js) instead of leaving a blank map.
 */
import { BACKEND_URL } from './apiClient';
import { isSignInRefusal, reportWeatherSessionExpired } from './weatherSession';
import { heldResponse, heldUntil, isRateLimited, laneOf, noteRateLimited } from './weatherRateLimit';

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

/** Is the server's tier clamp on? The latest response header wins; else the /capabilities rows; else OFF. */
export function tierClampOn(win) {
  if (!win) return false;
  if (typeof win.__RAW_TIER_CLAMP_ON__ === 'boolean') return win.__RAW_TIER_CLAMP_ON__;
  const caps = win.__WEATHER_CAPABILITIES__;
  return Array.isArray(caps) && caps.some((row) => row && row.tier_clamp === true);
}

function headerOf(res, name) {
  try { return res && res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null; } catch (e) { return null; }
}

export function installWeatherAuthFetch(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win || typeof win.fetch !== 'function' || win.__RAW_WEATHER_AUTH_INSTALLED__) return false;
  const inner = win.fetch;
  win.fetch = function weatherAuthFetch(input, init) {
    const self = this;
    if (typeof input !== 'string' || !isBackendWeatherUrl(input)) return inner.call(self, input, init);
    const held = heldUntil(win, laneOf(input));
    if (held) return Promise.resolve(heldResponse(held));               // #815: no request inside the server's wait
    const limited = (res) => {
      if (isRateLimited(res)) noteRateLimited(win, input, res);         // hold this lane + the too-many-requests notice
      return res;
    };
    const disabled = !!win.__RAW_DISABLE_WEATHER_AUTH__;
    const token = disabled ? null : storedAccessToken(win.localStorage);
    const next = tierClampOn(win) ? withWeatherAuth(input, init, { token, disabled }) : init;
    const sentToken = next !== init;
    const refusedWithToken = (res) => {
      if (isSignInRefusal(res)) reportWeatherSessionExpired(win);       // our token was sent and not accepted
      return res;
    };
    return inner.call(self, input, next).then(limited).then((res) => {
      const on = headerOf(res, 'x-raw-tier-clamp-on');
      if (res && res.headers) win.__RAW_TIER_CLAMP_ON__ = on === '1';      // follow a manifest flip either way
      if (!sentToken && token && headerOf(res, 'x-raw-tier-clamp') && !isRateLimited(res)) {
        // The switch flipped ON before we knew: this answer was cut (or refused, accounts only) as if we were signed
        // out. Ask once more, as who we are.
        return inner.call(self, input, withWeatherAuth(input, init, { token })).then(limited).then(refusedWithToken);
      }
      return sentToken ? refusedWithToken(res) : res;
    });
  };
  win.__RAW_WEATHER_AUTH_INSTALLED__ = true;
  return true;
}
