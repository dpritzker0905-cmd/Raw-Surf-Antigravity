/**
 * servedExtent.invariant.test.js
 *
 * T-2′ step 1 — lock the EXTENT invariant handle (audit 11.2).
 *
 * Measured on the live layer OFF→ON battery at `e015d90b`: a byte-identical productId
 * (`gfs_marine_waves_global_mid_20260811T060000Z.json`) was served at **289** vectors and then at
 * **15,023**, while the band's sampled value moved 0.5152 → 0.5954 m (+15.6%).
 *
 * The prior T-2′ exit criterion was "layer OFF→ON returns an identical productId". These tests
 * exist because that criterion **would have passed this run** while the field changed 52x.
 * ⭐ Assert on what was SERVED, never on what it was CALLED.
 *
 * Mechanism (not fixed here — step 1 is disclosure only): marineControllerCache.js:193-211, the
 * response-derived cache key vs the request-derived lookup key.
 */

import { computeServedExtent } from './backendWeatherServiceClientDiag';

// The two real observations, same productId.
const PATCH = { responseGridBounds: { west: -83, east: -79, south: 26, north: 30 }, cols: 17, rows: 17, vectorCount: 289 };
const WORLD = { responseGridBounds: { west: -180, east: 180, south: -80, north: 84 }, cols: 181, rows: 83, vectorCount: 15023 };

describe('the extent invariant is asserted on the field, not on its name', () => {
  test('REGRESSION: identical productId, different extent => DIFFERENT signature', () => {
    const a = computeServedExtent(PATCH);
    const b = computeServedExtent(WORLD);

    // The defect the old criterion missed: the name is equal, the field is not.
    expect(a.servedExtentSignature).not.toBe(b.servedExtentSignature);
    expect(a.servedVectorCount).toBe(289);
    expect(b.servedVectorCount).toBe(15023);
    expect(a.servedWidthDeg).toBe(4);
    expect(b.servedWidthDeg).toBe(360);
  });

  test('the same served field yields a STABLE signature (the invariant that must hold)', () => {
    expect(computeServedExtent(PATCH).servedExtentSignature)
      .toBe(computeServedExtent({ ...PATCH }).servedExtentSignature);
  });

  test('a cols/rows vs vectorCount disagreement is SURFACED, not reconciled away', () => {
    // Observed live: cols 17 x rows 17 = 289 while vectorCount reported 15023.
    const conflicted = computeServedExtent({ ...WORLD, cols: 17, rows: 17 });
    expect(conflicted.servedDimProduct).toBe(289);
    expect(conflicted.servedVectorCount).toBe(15023);
    expect(conflicted.servedCountsAgree).toBe(false);
  });

  test('agreement is reported when the two counts genuinely agree', () => {
    expect(computeServedExtent(PATCH).servedCountsAgree).toBe(true);
  });

  test('UNKNOWN is not DISAGREEMENT (the Phase 0 rule, applied here too)', () => {
    const noDims = computeServedExtent({ responseGridBounds: PATCH.responseGridBounds, vectorCount: 289 });
    expect(noDims.servedCountsAgree).toBeNull();     // not false
    const nothing = computeServedExtent({});
    expect(nothing.servedCountsAgree).toBeNull();
    expect(nothing.servedWidthDeg).toBeNull();
  });

  test('antimeridian-crossing bounds compute a sane width', () => {
    const wrapped = computeServedExtent({ responseGridBounds: { west: 170, east: -170, south: 0, north: 10 }, cols: 5, rows: 3, vectorCount: 15 });
    expect(wrapped.servedWidthDeg).toBe(20);
  });
});
