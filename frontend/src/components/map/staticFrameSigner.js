/**
 * staticFrameSigner.js: the client half of static-frame entitlement (O6, 2026-11-11; ACCOUNTS ONLY 2026-11-12).
 *
 * Owner, 2026-11-12: "we do not want non-account holders to access the data. Free account holders should still have to
 * go through signed URLs." With FRAME_ENTITLEMENT on, the publisher keeps EVERY frame in a PRIVATE bucket, and the
 * PUBLIC index lists each hour with no `path` (bundle sets: `offset: null`) and `entitlement: '<free|basic|premium>'`.
 * Without this module every such hour is "unbuilt" and the map asks /grid for it (which #782 answers at the caller's
 * tier, or refuses signed out).
 *
 * WHAT IT DOES. When an index is loaded (staticFrames.loadIndex) and has unsigned entries, and a user is SIGNED IN (any
 * account, free included), it asks GET /api/weather/frame-urls?index=<path> ONCE for that index and gives each entitled
 * entry back a fetchable frame:
 *   per-frame set:  frame.path = the private object path (the cache key), frame.url = its signed URL;
 *   bundle set:     frame.bundle = { path: the class bundle, url, bytes, offset, length, sha12 }, frame.path = '<bundle>#<offset>'.
 * Signing happens BEFORE the index resolves, so every consumer sees one consistent index (nothing flips mid-pin).
 *
 * COST. Signed out (no token): zero calls, and nothing is served. Any account: one call per pinned index; the URLs are
 * shared by every user of the same class (the server signs once per index x class per 6 h), so the CDN stays warm.
 *
 * FAILURE IS SAFE. Any error, timeout or 404 (the server flag off) leaves the entries unbuilt: those hours go to /grid
 * exactly as without this module. A 404 also backs off SIGNER_OFF_BACKOFF_MS. A 401 marked `X-Raw-Tier-Clamp: account`
 * on a request that carried our token is an expired session: it raises the sign-in-again prompt (lib/weatherSession.js).
 *
 * KILL: window.__RAW_DISABLE_FRAME_SIGNER__ = true (hours fall back to /grid). Telemetry: window.__RAW_FRAME_SIGNER__.
 */
import { BACKEND_URL } from '../../lib/apiClient';
import { storedAccessToken } from '../../lib/weatherAuthFetch';
import { isSignInRefusal, reportWeatherSessionExpired } from '../../lib/weatherSession';

export const FRAME_URLS_PATH = '/api/weather/frame-urls';
export const SIGNER_TIMEOUT_MS = 4000;
export const SIGNER_OFF_BACKOFF_MS = 10 * 60 * 1000;
const NO_CLASS_TIERS = new Set(['guest']);       // accounts only: every account (free included) has a class

const W = () => (typeof window !== 'undefined' ? window : {});
const _state = { offUntil: 0, noClassToken: null };

export function frameSignerTelemetry() {
  const w = W();
  if (!w.__RAW_FRAME_SIGNER__) w.__RAW_FRAME_SIGNER__ = { calls: 0, applied: 0, skipped: {}, errors: 0, last: null };
  return w.__RAW_FRAME_SIGNER__;
}

const skip = (reason) => { const t = frameSignerTelemetry(); t.skipped[reason] = (t.skipped[reason] || 0) + 1; };

export function frameSignerEnabled() {
  return W().__RAW_DISABLE_FRAME_SIGNER__ !== true;
}

/** Entries the public index names a class for and leaves without a path (they need a signed object). */
export function unsignedEntries(idx) {
  return (idx && Array.isArray(idx.frames) ? idx.frames : []).filter((f) => f && f.entitlement && !f.path);
}

/**
 * PURE. Give the unsigned entries of `idx` the signed objects in `body.frames` (matched by valid_time). Returns the count
 * applied. An item is used only when it is well formed: a url and an object, and for a bundle slice finite offset/length and
 * a sha12 (staticRegional checks every slice against it, so a wrong signed object can never be decoded).
 */
export function applySignedFrames(idx, body) {
  const items = new Map();
  for (const it of (body && Array.isArray(body.frames) ? body.frames : [])) {
    if (it && typeof it.url === 'string' && typeof it.object === 'string' && it.valid_time) items.set(it.valid_time, it);
  }
  let n = 0;
  for (const f of unsignedEntries(idx)) {
    const it = items.get(f.valid_time);
    if (!it) continue;
    if (it.offset !== undefined && it.offset !== null) {
      if (!Number.isFinite(it.offset) || !Number.isFinite(it.length) || typeof it.sha12 !== 'string') continue;
      f.bundle = { path: it.object, url: it.url, bytes: it.bundle_bytes, offset: it.offset, length: it.length, sha12: it.sha12 };
      f.path = `${it.object}#${it.offset}`;
    } else {
      f.path = it.object;
      f.url = it.url;
    }
    n += 1;
  }
  return n;
}

/**
 * The index, with its entries signed when this account may read them. Never throws, never rejects; resolves to `idx`.
 * Options are test seams: fetchImpl, token, backendUrl, now, win.
 */
export async function signEntitledFrames(idx, opts = {}) {
  if (!idx || !idx.path || unsignedEntries(idx).length === 0) return idx;
  if (!frameSignerEnabled()) { skip('killed'); return idx; }
  const token = opts.token !== undefined ? opts.token : storedAccessToken(typeof window !== 'undefined' ? window.localStorage : null);
  if (!token) { skip('no_token'); return idx; }
  if (_state.noClassToken === token) { skip('tier_has_none'); return idx; }
  const now = (opts.now || Date.now)();
  if (now < _state.offUntil) { skip('server_off'); return idx; }
  const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) { skip('no_fetch'); return idx; }
  const base = String(opts.backendUrl !== undefined ? opts.backendUrl : BACKEND_URL).replace(/\/+$/, '');
  const t = frameSignerTelemetry();
  t.calls += 1;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), SIGNER_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(`${base}${FRAME_URLS_PATH}?index=${encodeURIComponent(idx.path)}`, {
      headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', signal: controller ? controller.signal : undefined,
    });
    if (!res.ok) {
      if (res.status === 404) _state.offUntil = now + SIGNER_OFF_BACKOFF_MS;
      if (isSignInRefusal(res)) reportWeatherSessionExpired(opts.win);   // our token was sent and not accepted
      t.errors += 1; t.last = { index: idx.path, status: res.status };
      return idx;
    }
    const body = await res.json();
    if (body && NO_CLASS_TIERS.has(body.tier)) _state.noClassToken = token;
    const applied = applySignedFrames(idx, body);
    t.applied += applied; t.last = { index: idx.path, status: res.status, tier: body && body.tier, applied };
    return idx;
  } catch (e) {
    t.errors += 1; t.last = { index: idx.path, status: (e && e.name === 'AbortError') ? 'timeout' : 'error' };
    return idx;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function _resetFrameSignerForTest() {
  _state.offUntil = 0; _state.noClassToken = null;
  if (typeof window !== 'undefined') delete window.__RAW_FRAME_SIGNER__;
}
