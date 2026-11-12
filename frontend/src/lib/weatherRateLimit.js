/**
 * weatherRateLimit.js: the client half of the per-account limit (#815; owner 2026-11-12 11:45 EST: "add the
 * too-many-requests notice to #815").
 *
 * WHY. The server's limiter (backend/services/weather_account_rate_limit.py) answers 429 with
 * `X-Raw-Tier-Clamp: rate_limited` and `Retry-After` (both CORS-exposed; the wait is also in the body). Without this, the
 * refused hours just stay blank, and the frame signer's fallback to /grid hits the same limit again.
 *
 * WHAT. Only the MARKED 429 counts (any other 429 or a 5xx is left alone). On one:
 *   - HOLD: this tab issues no further request on that lane (reads, or /frame-urls) until Retry-After has passed; a held
 *     request resolves at once to a synthetic marked 429, so no retry storm reaches the box;
 *   - NOTICE: a `raw:weather-rate-limited` event carries the time the hold ends; components/RateLimitNotice.js shows
 *     "Too many requests - try again in N s" and clears itself when the wait is over.
 * Kill switch: window.__RAW_DISABLE_RATE_LIMIT_NOTICE__ = true (no hold, no notice: the previous behaviour).
 */
export const RATE_LIMITED = 'rate_limited';
export const WEATHER_RATE_LIMITED = 'raw:weather-rate-limited';
const MAX_HOLD_S = 600;           // a malformed Retry-After never freezes the map for longer than 10 minutes

export function laneOf(url) {
  return typeof url === 'string' && url.includes('/api/weather/frame-urls') ? 'frame-urls' : 'reads';
}

function header(res, name) {
  try { return res && res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null; } catch (e) { return null; }
}

/** PURE: is this the limiter's 429 (as opposed to any other 429 or error)? */
export function isRateLimited(res) {
  if (!res || res.status !== 429) return false;
  return String(header(res, 'x-raw-tier-clamp') || '').split(',').map((s) => s.trim()).includes(RATE_LIMITED);
}

/** PURE: the wait in whole seconds from Retry-After (1..MAX_HOLD_S); `fallback` when it is missing or junk. */
export function retryAfterSeconds(res, fallback = 5) {
  const n = Number.parseInt(header(res, 'retry-after'), 10);
  return Math.min(MAX_HOLD_S, Math.max(1, Number.isFinite(n) ? n : fallback));
}

export function rateLimitDisabled(win) {
  return !!(win && win.__RAW_DISABLE_RATE_LIMIT_NOTICE__);
}

function holds(win) {
  if (!win.__RAW_WEATHER_HOLD__) win.__RAW_WEATHER_HOLD__ = {};
  return win.__RAW_WEATHER_HOLD__;
}

/** The ms timestamp this lane is held until (0 when not held). */
export function heldUntil(win, lane, now = Date.now()) {
  if (!win || rateLimitDisabled(win)) return 0;
  const until = holds(win)[lane] || 0;
  return until > now ? until : 0;
}

/** Record a marked 429: hold the lane and raise the notice. Returns the hold end (ms), or 0 when killed. */
export function noteRateLimited(win, url, res, now = Date.now()) {
  if (!win || rateLimitDisabled(win)) return 0;
  const until = now + retryAfterSeconds(res) * 1000;
  const lane = laneOf(url);
  holds(win)[lane] = Math.max(holds(win)[lane] || 0, until);
  try {
    if (typeof win.dispatchEvent === 'function' && typeof win.CustomEvent === 'function') {
      win.dispatchEvent(new win.CustomEvent(WEATHER_RATE_LIMITED, { detail: { until: holds(win)[lane], lane } }));
    }
  } catch (e) { /* the hold still stands */ }
  return holds(win)[lane];
}

/** The answer a held request gets instead of a network call: the same marked 429, with the remaining wait. */
export function heldResponse(until, now = Date.now()) {
  const wait = String(Math.max(1, Math.ceil((until - now) / 1000)));
  const headers = { 'X-Raw-Tier-Clamp': RATE_LIMITED, 'Retry-After': wait, 'X-Raw-Held': '1' };
  const body = JSON.stringify({ detail: RATE_LIMITED, retry_after_s: Number(wait), held: true });
  if (typeof Response !== 'undefined') return new Response(body, { status: 429, headers });
  return { ok: false, status: 429, headers: new Headers(headers), json: async () => JSON.parse(body), text: async () => body };
}
