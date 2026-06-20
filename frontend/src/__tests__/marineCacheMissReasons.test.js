/**
 * Phase 1.3 — structured cache lookup telemetry. The recorder classifies each
 * lookup by reason and keeps per-reason counts + a ring-buffer log, so the
 * dominant miss class can be measured BEFORE any cache capacity/prefetch change.
 */
import { recordMarineCacheLookup } from '../components/map/marineControllerCache';

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
});
