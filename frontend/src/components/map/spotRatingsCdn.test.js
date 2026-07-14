/**
 * spotRatingsCdn.test.js — the CDN lane's pure selectors must mirror the backend's
 * select_precomputed / select_precomputed_laddered exactly (parity rule: same frames, same
 * tolerance ladder, same bbox semantics), plus the scoped-RLS URL, the anon-key headers, and
 * the object cache.
 */
import {
  scopedRatingsUrl, parseValidTimeMs, selectPrecomputedFrame, selectPrecomputedLaddered,
  fetchPublicRatingsObject, ratingsCdnEnabled, __resetRatingsCdnCacheForTests,
  CB_BUCKET_MS, isBeyondPrecomputeBound,
} from './spotRatingsCdn';

const FL_BBOX = [-82, 24, -79, 28];

function obj(frames) {
  return { version: 1, generated_at: '2026-07-14T00:00:00Z', frames };
}

function frame(model, validTime, spots) {
  return { model, valid_time: validTime, spots };
}

const IN_SPOT = { spot_id: 'in', latitude: 26.0, longitude: -80.0, score: 50, level: 'fair' };
const OUT_SPOT = { spot_id: 'out', latitude: 40.0, longitude: -80.0, score: 70, level: 'good' };

describe('scopedRatingsUrl', () => {
  it('builds the RLS-scoped authenticated-endpoint URL cache-busted on the coarse time bucket', () => {
    const a = scopedRatingsUrl('https://x.supabase.co/', 10 * CB_BUCKET_MS);
    expect(a).toBe('https://x.supabase.co/storage/v1/object/authenticated/weather-products/spot_ratings/latest.json?cb=10');
  });

  it('is STABLE within a bucket and advances across buckets (bounded edge staleness)', () => {
    const t0 = 42 * CB_BUCKET_MS;
    expect(scopedRatingsUrl('https://x.co', t0)).toBe(scopedRatingsUrl('https://x.co', t0 + CB_BUCKET_MS - 1));
    expect(scopedRatingsUrl('https://x.co', t0)).not.toBe(scopedRatingsUrl('https://x.co', t0 + CB_BUCKET_MS));
  });

  it('returns null without a supabase base URL (→ endpoint fallback, not a crash)', () => {
    expect(scopedRatingsUrl('', Date.now())).toBeNull();
    expect(scopedRatingsUrl(null, Date.now())).toBeNull();
  });
});

describe('selectPrecomputedFrame — backend select_precomputed parity', () => {
  const o = obj([frame('GFS', '2026-06-28T21:00:00Z', [IN_SPOT, OUT_SPOT])]);

  it('exact valid_time match filters spots to the bbox', () => {
    const sel = selectPrecomputedFrame(o, FL_BBOX, 'GFS', '2026-06-28T21:00:00Z');
    expect(sel.map((s) => s.spot_id)).toEqual(['in']);
  });

  it('nearest same-model frame within tolerance matches (frontend needn\'t byte-match the key)', () => {
    const sel = selectPrecomputedFrame(o, FL_BBOX, 'GFS', '2026-06-28T21:40:00Z');
    expect(sel.map((s) => s.spot_id)).toEqual(['in']);
  });

  it('outside tolerance returns null (the live/endpoint signal)', () => {
    expect(selectPrecomputedFrame(o, FL_BBOX, 'GFS', '2026-06-29T05:00:00Z')).toBeNull();
  });

  it('a matching frame with nothing in view returns [] — NOT null (don\'t fall back)', () => {
    const sel = selectPrecomputedFrame(o, [10, 10, 12, 12], 'GFS', '2026-06-28T21:00:00Z');
    expect(sel).toEqual([]);
  });

  it('wrong model returns null even at the exact time', () => {
    expect(selectPrecomputedFrame(o, FL_BBOX, 'EURO', '2026-06-28T21:00:00Z')).toBeNull();
  });

  it('is antimeridian-aware (w > e wraps the dateline)', () => {
    const fiji = { spot_id: 'fj', latitude: -17.0, longitude: 179.5, score: 90, level: 'epic' };
    const o2 = obj([frame('GFS', '2026-06-28T21:00:00Z', [fiji, IN_SPOT])]);
    const sel = selectPrecomputedFrame(o2, [170, -25, -170, -10], 'GFS', '2026-06-28T21:00:00Z');
    expect(sel.map((s) => s.spot_id)).toEqual(['fj']);
  });

  it('tolerates malformed input', () => {
    expect(selectPrecomputedFrame(null, FL_BBOX, 'GFS', 't')).toBeNull();
    expect(selectPrecomputedFrame({}, FL_BBOX, 'GFS', 't')).toBeNull();
    expect(selectPrecomputedFrame(o, 'not-a-bbox', 'GFS', 't')).toBeNull();
    expect(selectPrecomputedFrame(obj([frame('GFS', 'garbage-time', [IN_SPOT])]), FL_BBOX, 'GFS', 'also-garbage')).toBeNull();
  });
});

describe('selectPrecomputedLaddered — fresh → stale → null', () => {
  const o = obj([frame('GFS', '2026-06-28T21:00:00Z', [IN_SPOT])]);

  it('fresh hit is labeled precomputed_cdn', () => {
    const hit = selectPrecomputedLaddered(o, FL_BBOX, 'GFS', '2026-06-28T21:40:00Z');
    expect(hit.source).toBe('precomputed_cdn');
    expect(hit.spots.map((s) => s.spot_id)).toEqual(['in']);
  });

  it('5h out: past fresh (2h), within stale (6h) → labeled stale, still served', () => {
    const hit = selectPrecomputedLaddered(o, FL_BBOX, 'GFS', '2026-06-29T02:00:00Z');
    expect(hit.source).toBe('precomputed_cdn_stale');
  });

  it('8h out: beyond the stale bound → null (the endpoint/live path owns it)', () => {
    expect(selectPrecomputedLaddered(o, FL_BBOX, 'GFS', '2026-06-29T05:00:00Z')).toBeNull();
  });
});

describe('parseValidTimeMs', () => {
  it('parses ISO-8601 with Z and returns null on garbage', () => {
    expect(parseValidTimeMs('2026-06-28T21:00:00Z')).toBe(Date.UTC(2026, 5, 28, 21));
    expect(parseValidTimeMs('nope')).toBeNull();
    expect(parseValidTimeMs(null)).toBeNull();
  });
});

describe('isBeyondPrecomputeBound — §1c skip-beyond-bound discriminator', () => {
  const o = obj([
    frame('GFS', '2026-06-28T21:00:00Z', [IN_SPOT]),
    frame('GFS', '2026-06-29T00:00:00Z', [IN_SPOT]),
    frame('EURO', '2026-06-28T21:00:00Z', [IN_SPOT]),
  ]);

  it('TRUE when frames exist for the model and the ask is beyond the stale bound of ALL of them', () => {
    // 2026-06-29T12:00 is 12h past the newest GFS frame (bound 6h).
    expect(isBeyondPrecomputeBound(o, 'GFS', '2026-06-29T12:00:00Z')).toBe(true);
  });

  it('FALSE within the stale bound of any frame (the ladder serves it — never skip)', () => {
    expect(isBeyondPrecomputeBound(o, 'GFS', '2026-06-29T05:00:00Z')).toBe(false); // 5h past newest
    expect(isBeyondPrecomputeBound(o, 'GFS', '2026-06-28T21:30:00Z')).toBe(false); // near exact
  });

  it('FALSE when the model has NO frames (precompute failed that cycle → endpoint must own it)', () => {
    expect(isBeyondPrecomputeBound(o, 'ICON', '2026-06-29T12:00:00Z')).toBe(false);
  });

  it('FALSE on any uncertainty — no object, malformed frames, unparseable times', () => {
    expect(isBeyondPrecomputeBound(null, 'GFS', '2026-06-29T12:00:00Z')).toBe(false);
    expect(isBeyondPrecomputeBound({}, 'GFS', '2026-06-29T12:00:00Z')).toBe(false);
    expect(isBeyondPrecomputeBound(o, 'GFS', 'garbage-time')).toBe(false);
    expect(isBeyondPrecomputeBound(obj([frame('GFS', 'garbage', [IN_SPOT])]), 'GFS', '2026-06-29T12:00:00Z')).toBe(false);
  });

  it('scrubbing BACKWARD far before the oldest frame also reads as beyond-bound', () => {
    expect(isBeyondPrecomputeBound(o, 'GFS', '2026-06-28T00:00:00Z')).toBe(true); // 21h before oldest
  });
});

describe('fetchPublicRatingsObject — cache + failure semantics', () => {
  const VALID = obj([frame('GFS', '2026-06-28T21:00:00Z', [IN_SPOT])]);
  const CFG = { supabaseUrl: 'https://x.co', anonKey: 'anon-jwt' };

  beforeEach(() => {
    __resetRatingsCdnCacheForTests();
    delete window.__RAW_DISABLE_RATINGS_CDN__;
    global.fetch = jest.fn();
  });

  it('is ENABLED by default (scoped-RLS design user-approved 2026-07-14)', () => {
    expect(ratingsCdnEnabled()).toBe(true);
  });

  it('fetches once per cache window with the anon key headers and dedups concurrent callers', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => VALID });
    const [a, b] = await Promise.all([
      fetchPublicRatingsObject(CFG),
      fetchPublicRatingsObject(CFG),
    ]);
    const c = await fetchPublicRatingsObject(CFG);
    expect(a).toEqual(VALID);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/storage/v1/object/authenticated/weather-products/spot_ratings/latest.json?cb=');
    expect(opts.headers).toEqual({ apikey: 'anon-jwt', Authorization: 'Bearer anon-jwt' });
  });

  it('resolves null (never rejects) on HTTP failure and negative-caches briefly', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 400 });
    expect(await fetchPublicRatingsObject(CFG)).toBeNull();
    expect(await fetchPublicRatingsObject(CFG)).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);          // negative-cached, no hammering
  });

  it('resolves null on a malformed object (no frames array)', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ hello: 'world' }) });
    expect(await fetchPublicRatingsObject(CFG)).toBeNull();
  });

  it('resolves null on network rejection', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await fetchPublicRatingsObject(CFG)).toBeNull();
  });

  it('kill switch disables the lane entirely', async () => {
    window.__RAW_DISABLE_RATINGS_CDN__ = true;
    expect(ratingsCdnEnabled()).toBe(false);
    expect(await fetchPublicRatingsObject(CFG)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('missing anon key → null without fetching (endpoint fallback carries)', async () => {
    const saved = process.env.REACT_APP_SUPABASE_ANON_KEY;
    delete process.env.REACT_APP_SUPABASE_ANON_KEY;
    try {
      expect(await fetchPublicRatingsObject({ supabaseUrl: 'https://x.co' })).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) process.env.REACT_APP_SUPABASE_ANON_KEY = saved;
    }
  });

  it('missing supabase URL → null without fetching (endpoint fallback carries)', async () => {
    const saved = process.env.REACT_APP_SUPABASE_URL;
    delete process.env.REACT_APP_SUPABASE_URL;
    try {
      expect(await fetchPublicRatingsObject({ anonKey: 'anon-jwt' })).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) process.env.REACT_APP_SUPABASE_URL = saved;
    }
  });
});
