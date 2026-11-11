/**
 * staticFrameSigner.js: the client half of static-frame entitlement (O6, 2026-11-11).
 *
 * With FRAME_ENTITLEMENT on, the publisher keeps paid frames (EURO / ICON, and GFS beyond the guest window) in a PRIVATE
 * bucket, and the PUBLIC index lists those hours with no `path` (bundle sets: `offset: null`) and `paid: '<class>'`.
 * Without this module such an hour is "unbuilt" and the map asks /grid for it: correct (the server clamps it to the
 * caller's tier), but that is box load the static frames exist to avoid.
 *
 * WHAT IT DOES. When an index is loaded (staticFrames.loadIndex) and it has paid entries, and a user is signed in, it
 * asks GET /api/weather/frame-urls?index=<path> ONCE for that index and gives each entitled entry back a fetchable frame:
 *   per-frame set:  frame.path = the private object path (the cache key), frame.url = its signed URL;
 *   bundle set:     frame.bundle = { path: the class bundle, url, bytes, offset, length, sha12 }, frame.path = '<bundle>#<offset>'.
 * Signing happens BEFORE the index resolves, so every consumer sees one consistent index (nothing flips mid-pin).
 *
 * COST. Guests (no token): zero calls. A guest/free token: one call per session, then none (the answer names the tier).
 * Basic / premium: one call per pinned index; the URLs are shared by every entitled user (the server signs once per
 * index x class per 6 h), so the CDN stays warm. A token outlives the object (>= 30 h left vs ~12 h retention).
 *
 * FAILURE IS SAFE. Any error, timeout, 401 or 404 (the server flag off) leaves the paid entries unbuilt: those hours go to
 * /grid exactly as without this module. A 404 also backs off SIGNER_OFF_BACKOFF_MS so a held-off server is not asked per index.
 *
 * KILL: window.__RAW_DISABLE_FRAME_SIGNER__ = true (paid hours fall back to /grid). Telemetry: window.__RAW_FRAME_SIGNER__.
 */
import { BACKEND_URL } from '../../lib/apiClient';
import { storedAccessToken } from '../../lib/weatherAuthFetch';

export const FRAME_URLS_PATH = '/api/weather/frame-urls';
export const SIGNER_TIMEOUT_MS = 4000;
export const SIGNER_OFF_BACKOFF_MS = 10 * 60 * 1000;
const NO_PAID_TIERS = new Set(['guest', 'free']);

const W = () => (typeof window !== 'undefined' ? window : {});
const _state = { offUntil: 0, noPaidToken: null };

export function frameSignerTelemetry() {
  const w = W();
  if (!w.__RAW_FRAME_SIGNER__) w.__RAW_FRAME_SIGNER__ = { calls: 0, applied: 0, skipped: {}, errors: 0, last: null };
  return w.__RAW_FRAME_SIGNER__;
}

const skip = (reason) => { const t = frameSignerTelemetry(); t.skipped[reason] = (t.skipped[reason] || 0) + 1; };

export function frameSignerEnabled() {
  return W().__RAW_DISABLE_FRAME_SIGNER__ !== true;
}

/** Entries the public index marks paid and leaves unbuilt. */
export function paidUnbuilt(idx) {
  return (idx && Array.isArray(idx.frames) ? idx.frames : []).filter((f) => f && f.paid && !f.path);
}

/**
 * PURE. Give the paid entries of `idx` the signed objects in `body.frames` (matched by valid_time). Returns the count applied.
 * An item is used only when it is well formed: a url and an object, and for a bundle slice finite offset/length and a sha12
 * (staticRegional checks every slice against it, so a wrong signed object can never be decoded).
 */
export function applySignedFrames(idx, body) {
  const items = new Map();
  for (const it of (body && Array.isArray(body.frames) ? body.frames : [])) {
    if (it && typeof it.url === 'string' && typeof it.object === 'string' && it.valid_time) items.set(it.valid_time, it);
  }
  let n = 0;
  for (const f of paidUnbuilt(idx)) {
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
 * The index, with its paid entries signed when this user may read them. Never throws, never rejects; resolves to `idx`.
 * Options are test seams: fetchImpl, token, backendUrl, now.
 */
export async function signPaidFrames(idx, opts = {}) {
  if (!idx || !idx.path || paidUnbuilt(idx).length === 0) return idx;
  if (!frameSignerEnabled()) { skip('killed'); return idx; }
  const token = opts.token !== undefined ? opts.token : storedAccessToken(typeof window !== 'undefined' ? window.localStorage : null);
  if (!token) { skip('no_token'); return idx; }
  if (_state.noPaidToken === token) { skip('tier_has_none'); return idx; }
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
      t.errors += 1; t.last = { index: idx.path, status: res.status };
      return idx;
    }
    const body = await res.json();
    if (body && NO_PAID_TIERS.has(body.tier)) _state.noPaidToken = token;
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
  _state.offUntil = 0; _state.noPaidToken = null;
  if (typeof window !== 'undefined') delete window.__RAW_FRAME_SIGNER__;
}
