/**
 * marineControllerCache.selectorTelemetry.test.js
 *
 * T-2′ step 3 — the selector's telemetry must not merge into the predicate's (audit 11.2).
 *
 * WHY THIS EXISTS. Two functions ask the per-model-hour cache two different questions:
 *   - `isContainedInMarineCache`  PREDICATE: "do we have this, can we skip fetching?"  (instrumented)
 *   - `getModelSafeMarine`        SELECTOR:  "which entry do we actually serve?"        (NOT instrumented)
 *
 * The measured 100% exact-key miss rate (T2PRIME_STEP3_MISS_RATE_MEASUREMENT.md: 19 checks,
 * 0 hits) is a PREDICATE measurement. Applying it to the selector is inference.
 *
 * THE TRAP these tests pin: `recordMarineCacheLookup` tallies by REASON ALONE
 * (`diag.counts[reason]++`). Had the selector been wired to emit 'hit' / 'exact_key_absent', its
 * counts would have merged into the predicate's buckets and NEITHER population could be attributed
 * afterwards — the instrumentation would have destroyed the measurement it was added to make.
 *
 * ⭐ A counter that cannot tell two populations apart is the same defect class as a gate that
 *   cannot tell "not sampled" from "agrees". Both report a number about a thing they never
 *   separated.
 */

import { recordMarineCacheLookup, recordSelectorLookup, SELECTOR_LOOKUP_PREFIX } from './marineControllerCache';

const counts = () => (window.__MARINE_CACHE_DIAG__ || {}).counts || {};

beforeEach(() => {
  window.__MARINE_CACHE_DIAG__ = { counts: {}, log: [] };
});

describe('selector telemetry is namespaced away from the predicate', () => {
  test('REGRESSION: the same reason word from both sources stays in SEPARATE buckets', () => {
    recordMarineCacheLookup('hit', { lookupKey: 'k1' });   // predicate
    recordSelectorLookup('hit', { lookupKey: 'k1' });      // selector — same word

    expect(counts().hit).toBe(1);        // predicate's 19-checks/0-hits baseline stays comparable
    expect(counts().sel_hit).toBe(1);    // selector counted independently
  });

  test('every documented reason word round-trips into its own namespace', () => {
    for (const r of ['hit', 'exact_key_absent', 'hit_fallback', 'bounds_not_contained', 'stale']) {
      recordSelectorLookup(r, {});
    }
    for (const r of ['hit', 'exact_key_absent', 'hit_fallback', 'bounds_not_contained', 'stale']) {
      expect(counts()[SELECTOR_LOOKUP_PREFIX + r]).toBe(1);
      expect(counts()[r]).toBeUndefined();   // nothing leaked into the predicate's buckets
    }
  });

  test('the prefix cannot be double-applied by a call site that already spelled it', () => {
    recordSelectorLookup('sel_hit', {});
    expect(counts().sel_hit).toBe(1);
    expect(counts().sel_sel_hit).toBeUndefined();
  });

  test('the entry carries its source, so the log is attributable even if counts are merged later', () => {
    recordSelectorLookup('exact_key_absent', { lookupKey: 'GFS_waves_viewport_x_0' });
    const entry = window.__MARINE_CACHE_DIAG__.log[0];
    expect(entry.source).toBe('getModelSafeMarine');
    expect(entry.reason).toBe('sel_exact_key_absent');
    expect(entry.lookupKey).toBe('GFS_waves_viewport_x_0');
  });

  test('a null/undefined reason degrades to a named bucket, never to the predicate namespace', () => {
    recordSelectorLookup(undefined, {});
    expect(counts().sel_unknown).toBe(1);
    expect(counts().undefined).toBeUndefined();
  });
});
