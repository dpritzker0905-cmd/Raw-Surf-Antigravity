/**
 * Phase 1.3 — structured cache lookup telemetry. The recorder classifies each
 * lookup by reason and keeps per-reason counts + a ring-buffer log, so the
 * dominant miss class can be measured BEFORE any cache capacity/prefetch change.
 */
import { recordMarineCacheLookup, getPerModelHourCache } from '../components/map/marineControllerCache';

describe('recordMarineCacheLookup — structured cache miss classification', () => {
  beforeEach(() => { delete window.__MARINE_CACHE_DIAG__; });

  it('accumulates per-reason counts and a bounded reverse-chronological log', () => {
    recordMarineCacheLookup('exact_key_absent', { model: 'GFS', layer: 'waves', hourOffset: 0 });
    recordMarineCacheLookup('exact_key_absent', { model: 'ICON', layer: 'swell_1', hourOffset: 90 });
    recordMarineCacheLookup('signature_mismatch', { model: 'GFS', layer: 'waves', hourOffset: 3 });
    recordMarineCacheLookup('hit', { model: 'GFS', layer: 'waves', hourOffset: 0 });

    const diag = window.__MARINE_CACHE_DIAG__;
    expect(diag.counts.exact_key_absent).toBe(2);
    expect(diag.counts.signature_mismatch).toBe(1);
    expect(diag.counts.hit).toBe(1);
    // Most recent first.
    expect(diag.log[0].reason).toBe('hit');
    expect(diag.log[0].model).toBe('GFS');
    expect(diag.log.length).toBe(4);
  });

  it('caps the log and exposes a reset hook', () => {
    for (let i = 0; i < 80; i++) recordMarineCacheLookup('expired', { hourOffset: i });
    expect(window.__MARINE_CACHE_DIAG__.log.length).toBeLessThanOrEqual(60);
    expect(window.__MARINE_CACHE_DIAG__.counts.expired).toBe(80);

    window.__MARINE_CACHE_DIAG_RESET__();
    expect(window.__MARINE_CACHE_DIAG__.counts).toEqual({});
    expect(window.__MARINE_CACHE_DIAG__.log).toEqual([]);
  });

  it('tombstones capacity-evicted keys so a later lookup can be classified `evicted`', () => {
    const cache = getPerModelHourCache();
    cache.clear();
    // Fill past the LRU limit so the oldest key is evicted by the cap.
    const LIMIT = 50;
    for (let i = 0; i <= LIMIT; i++) cache.set(`k${i}`, { v: i });

    expect(cache.has('k0')).toBe(false);        // oldest, evicted
    expect(cache.wasEvicted('k0')).toBe(true);  // recorded as evicted (not exact_key_absent)
    expect(cache.wasEvicted('never_cached')).toBe(false);

    // Re-caching a key clears its eviction tombstone.
    cache.set('k0', { v: 0 });
    expect(cache.wasEvicted('k0')).toBe(false);
  });
});
