/**
 * spotRatingsCdn.js — the CDN lane for precomputed spot ratings (2026-07-14, queue #2).
 *
 * USER-APPROVED SCOPED-RLS DESIGN: the private weather-products bucket carries one storage RLS
 * policy (migration anon_read_spot_ratings_latest_only) granting anonymous READ on exactly
 * spot_ratings/latest.json — the precompute cron's L2 object (~1MB raw / ~150KB gzip; curated
 * spot list + scores, no user data). No public bucket exists; every sibling object stays
 * service-role-only (live-verified 2026-07-14: anon 200 on this key, 400 on manifest.json,
 * siblings, and keyless).
 *
 * This module fetches that object off the Supabase CDN with the anon key and runs the SAME
 * frame-selection ladder the backend runs (select_precomputed_laddered ported 1:1), so the
 * precomputed path involves the 1-CPU serve box not at all — the box only sees requests when no
 * frame within the stale bound covers the ask (the live-fallback truth path, via the endpoint).
 *
 * One object download per CB_BUCKET_MS window serves EVERY pan/zoom/model-switch/scrub instantly.
 * Any failure here (policy dropped, CORS, malformed JSON) returns null and the caller falls back
 * to the endpoint exactly as before — purely additive, transition-safe.
 *
 * Kill switch: window.__RAW_DISABLE_RATINGS_CDN__ = true (or localStorage
 * '__RAW_DISABLE_RATINGS_CDN__' = 'true'), or build-time REACT_APP_RATINGS_CDN=0.
 */

export const SPOT_RATINGS_BUCKET = 'weather-products';
export const SPOT_RATINGS_KEY = 'spot_ratings/latest.json';
// Backend parity: SELECT_TOLERANCE_S / SPOT_RATINGS_STALE_TOLERANCE_S defaults in spot_ratings.py.
export const FRESH_TOLERANCE_S = 7200;
export const STALE_TOLERANCE_S = 21600;
// The object mutates in place (uploaded max-age 60); busting on a coarse time bucket bounds edge
// staleness to ~CB_BUCKET_MS regardless of upload-time headers (the 07-06 manifest-scar recipe).
export const CB_BUCKET_MS = 5 * 60 * 1000;

export function ratingsCdnEnabled() {
  try {
    if (typeof window !== 'undefined' && window.__RAW_DISABLE_RATINGS_CDN__) return false;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('__RAW_DISABLE_RATINGS_CDN__') === 'true') return false;
  } catch (e) { /* storage blocked → stay with the build-time default */ }
  return process.env.REACT_APP_RATINGS_CDN !== '0';
}

/** RLS-scoped authenticated-endpoint URL, cache-busted on a coarse time bucket (PURE given now). */
export function scopedRatingsUrl(supabaseUrl, nowMs = Date.now()) {
  if (!supabaseUrl) return null;
  const base = supabaseUrl.replace(/\/+$/, '');
  const cb = Math.floor(nowMs / CB_BUCKET_MS);
  return `${base}/storage/v1/object/authenticated/${SPOT_RATINGS_BUCKET}/${SPOT_RATINGS_KEY}?cb=${cb}`;
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

/**
 * PURE §1c discriminator (2026-07-14): TRUE only when the object PROVABLY carries frames for
 * this model and the requested validTime sits beyond STALE_TOLERANCE_S of EVERY one of them —
 * i.e. a scrub far outside the precomputed window, where the endpoint fallback would land on
 * the 1-CPU live path for every step (7–22 s compute or a load-shed 503). The ladder's null
 * alone can't tell this apart from "model missing from the object" (precompute failed that
 * cycle), and THAT case must keep falling through to the endpoint — the server ladder + live
 * path own it. Any uncertainty (no object, model absent, unparseable times) → false.
 */
export function isBeyondPrecomputeBound(obj, model, validTime) {
  if (!obj || !Array.isArray(obj.frames)) return false;
  const req = parseValidTimeMs(validTime);
  if (req == null) return false;
  let sawFrame = false;
  for (const f of obj.frames) {
    if (!f || f.model !== model) continue;
    const ft = parseValidTimeMs(f.valid_time);
    if (ft == null) continue;
    sawFrame = true;
    if (Math.abs(ft - req) <= STALE_TOLERANCE_S * 1000) return false;
  }
  return sawFrame;
}

// Module-level object cache: one download serves every viewport/model/scrub within the CB bucket.
// An in-flight promise dedups concurrent callers; failures cache null briefly so a dropped policy
// doesn't refetch on every pan (NEG_TTL_MS), then the endpoint fallback carries the feature.
const _cache = { obj: null, ts: 0, promise: null };
const NEG_TTL_MS = 60 * 1000;

export function __resetRatingsCdnCacheForTests() {
  _cache.obj = null; _cache.ts = 0; _cache.promise = null;
}

/**
 * Fetch (with TTL cache + in-flight dedup) the RLS-scoped precomputed ratings object using the
 * anon key. Resolves to the parsed object or null — NEVER rejects (null routes to the endpoint).
 */
export async function fetchPublicRatingsObject({ supabaseUrl, anonKey, nowMs = Date.now() } = {}) {
  if (!ratingsCdnEnabled()) return null;
  const url = scopedRatingsUrl(supabaseUrl || process.env.REACT_APP_SUPABASE_URL, nowMs);
  const key = anonKey || process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const ttl = _cache.obj !== null ? CB_BUCKET_MS : NEG_TTL_MS;
  if (_cache.ts && (nowMs - _cache.ts) < ttl) return _cache.obj;
  if (_cache.promise) return _cache.promise;
  _cache.promise = (async () => {
    try {
      const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
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
