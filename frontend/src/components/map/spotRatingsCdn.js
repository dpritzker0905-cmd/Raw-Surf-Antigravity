/**
 * spotRatingsCdn.js — the CDN lane for precomputed spot ratings (2026-07-14, queue #2).
 *
 * The precompute cron mirrors its L2 object (spot_ratings/latest.json, ~1MB raw / ~150KB gzip) to a
 * PUBLIC Supabase bucket. This module fetches that object straight off the Supabase CDN and runs the
 * SAME frame-selection ladder the backend runs (select_precomputed_laddered ported 1:1), so the
 * precomputed path involves the 1-CPU serve box not at all — the box only sees requests when no
 * frame within the stale bound covers the ask (the live-fallback truth path, via the endpoint).
 *
 * One object download per CB_BUCKET_MS window serves EVERY pan/zoom/model-switch/scrub instantly and
 * offline-cache friendly. Any failure here (bucket missing, CORS, malformed JSON) returns null and
 * the caller falls back to the endpoint exactly as before — purely additive, transition-safe.
 *
 * DEFAULT OFF (2026-07-14, PENDING USER DECISION): the lane needs a publicly-readable bucket —
 * an exposure decision that was raised and left unanswered. Until it's made, the lane is opt-in:
 * REACT_APP_RATINGS_CDN=1 at build time, or window.__RAW_ENABLE_RATINGS_CDN__ = true /
 * localStorage '__RAW_ENABLE_RATINGS_CDN__' = 'true' at runtime (live-test lever). While off,
 * ZERO extra requests are made — prod behavior is byte-identical to the endpoint-only path.
 */

export const SPOT_RATINGS_PUBLIC_BUCKET = 'weather-public';
export const SPOT_RATINGS_PUBLIC_KEY = 'spot_ratings/latest.json';
// Backend parity: SELECT_TOLERANCE_S / SPOT_RATINGS_STALE_TOLERANCE_S defaults in spot_ratings.py.
export const FRESH_TOLERANCE_S = 7200;
export const STALE_TOLERANCE_S = 21600;
// The object mutates in place (uploaded max-age 60); busting on a coarse time bucket bounds edge
// staleness to ~CB_BUCKET_MS regardless of upload-time headers (the 07-06 manifest-scar recipe).
export const CB_BUCKET_MS = 5 * 60 * 1000;

export function ratingsCdnEnabled() {
  try {
    if (typeof window !== 'undefined' && window.__RAW_ENABLE_RATINGS_CDN__) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('__RAW_ENABLE_RATINGS_CDN__') === 'true') return true;
  } catch (e) { /* storage blocked → stay with the build-time default */ }
  return process.env.REACT_APP_RATINGS_CDN === '1';
}

/** Public CDN URL for the ratings object, cache-busted on a coarse time bucket (PURE given now). */
export function publicRatingsUrl(supabaseUrl, nowMs = Date.now()) {
  if (!supabaseUrl) return null;
  const base = supabaseUrl.replace(/\/+$/, '');
  const cb = Math.floor(nowMs / CB_BUCKET_MS);
  return `${base}/storage/v1/object/public/${SPOT_RATINGS_PUBLIC_BUCKET}/${SPOT_RATINGS_PUBLIC_KEY}?cb=${cb}`;
}

/** Parse ISO-8601 (tolerating trailing 'Z') to epoch ms, or null — mirrors backend _parse_dt. */
export function parseValidTimeMs(s) {
  if (!s || typeof s !== 'string') return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function lngIn(lng, w, e) {
  // Antimeridian-aware longitude-in-bbox (w > e means the bbox wraps the dateline) — backend _lng_in.
  return w <= e ? (w <= lng && lng <= e) : (lng >= w || lng <= e);
}

/**
 * PURE port of backend select_precomputed: pick the frame for (model, validTime) from the object and
 * filter its spots to the bbox [w,s,e,n]. Exact valid_time match first, else the nearest same-model
 * frame within toleranceS. Returns the spot list (possibly empty — a matching frame with nothing in
 * view must NOT fall back), or null when no frame matches (→ the endpoint/live signal).
 */
export function selectPrecomputedFrame(obj, bbox, model, validTime, toleranceS = FRESH_TOLERANCE_S) {
  if (!obj || !Array.isArray(obj.frames)) return null;
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const [w, s, e, n] = bbox;
  const modelFrames = obj.frames.filter((f) => f && f.model === model);
  if (!modelFrames.length) return null;
  let frame = modelFrames.find((f) => f.valid_time === validTime) || null;
  if (!frame) {
    const req = parseValidTimeMs(validTime);
    if (req != null) {
      let best = null;
      let bestD = null;
      for (const f of modelFrames) {
        const ft = parseValidTimeMs(f.valid_time);
        if (ft == null) continue;
        const d = Math.abs(ft - req);
        if (bestD == null || d < bestD) { best = f; bestD = d; }
      }
      if (best && bestD <= toleranceS * 1000) frame = best;
    }
  }
  if (!frame) return null;
  const out = [];
  for (const sp of (frame.spots || [])) {
    if (!sp || sp.latitude == null || sp.longitude == null) continue;
    if (s <= sp.latitude && sp.latitude <= n && lngIn(sp.longitude, w, e)) out.push(sp);
  }
  return out;
}

/**
 * PURE port of backend select_precomputed_laddered: fresh (±FRESH_TOLERANCE_S) → bounded-stale
 * (±STALE_TOLERANCE_S, labeled) → null (→ endpoint/live). Returns { spots, source } or null.
 */
export function selectPrecomputedLaddered(obj, bbox, model, validTime) {
  let sel = selectPrecomputedFrame(obj, bbox, model, validTime, FRESH_TOLERANCE_S);
  if (sel !== null) return { spots: sel, source: 'precomputed_cdn' };
  sel = selectPrecomputedFrame(obj, bbox, model, validTime, STALE_TOLERANCE_S);
  if (sel !== null) return { spots: sel, source: 'precomputed_cdn_stale' };
  return null;
}

// Module-level object cache: one download serves every viewport/model/scrub within the CB bucket.
// An in-flight promise dedups concurrent callers; failures cache null briefly so a missing bucket
// doesn't refetch on every pan (NEG_TTL_MS), then the endpoint fallback carries the feature.
const _cache = { obj: null, ts: 0, promise: null };
const NEG_TTL_MS = 60 * 1000;

export function __resetRatingsCdnCacheForTests() {
  _cache.obj = null; _cache.ts = 0; _cache.promise = null;
}

/**
 * Fetch (with TTL cache + in-flight dedup) the public precomputed ratings object.
 * Resolves to the parsed object or null — NEVER rejects (null routes the caller to the endpoint).
 */
export async function fetchPublicRatingsObject({ supabaseUrl, nowMs = Date.now() } = {}) {
  if (!ratingsCdnEnabled()) return null;
  const url = publicRatingsUrl(supabaseUrl || process.env.REACT_APP_SUPABASE_URL, nowMs);
  if (!url) return null;
  const ttl = _cache.obj !== null ? CB_BUCKET_MS : NEG_TTL_MS;
  if (_cache.ts && (nowMs - _cache.ts) < ttl) return _cache.obj;
  if (_cache.promise) return _cache.promise;
  _cache.promise = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`ratings-cdn ${res.status}`);
      const obj = await res.json();
      if (!obj || !Array.isArray(obj.frames)) throw new Error('ratings-cdn malformed object');
      _cache.obj = obj;
      return obj;
    } catch (e) {
      _cache.obj = null;                    // negative-cache: retry at most once per NEG_TTL_MS
      return null;
    } finally {
      _cache.ts = Date.now();
      _cache.promise = null;
    }
  })();
  return _cache.promise;
}
