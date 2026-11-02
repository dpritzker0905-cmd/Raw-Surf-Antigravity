/**
 * Kill-switch coverage: useSpotRatings.js
 *
 * Switch tested:
 *   __RAW_DISABLE_RATINGS_STABLE_MEMO__  — when OFF, ratingsShallowEqual(a,b) returns the
 *                                          PRIOR ref when values match (stable identity);
 *                                          when ON, the hook always returns mergedRaw even
 *                                          when value-equal (reverts to the old per-commit
 *                                          churn that drove ~47/95 renders per drag, scrubPerfProbe 2026-07-08).
 *
 * The switch lives inside a React hook (useEffect), which is not unit-testable in isolation.
 * The exported comparison function `ratingsShallowEqual` is the mechanism the stable-memo
 * delegates to, so testing it is the correct coverage point:
 *   - If ratingsShallowEqual is broken, the stable memo cannot work whether the switch is on or off.
 *   - The switch disables the ref-stabilization by skipping the comparison entirely (returns mergedRaw
 *     unconditionally), so the only regression guard is that ratingsShallowEqual itself works.
 *
 * Additional switch tested:
 *   (ratingsShallowEqual delegates to sameForecastReading when forecastStateIdentityEnabled())
 *   — this delegation path is tested to prove the gate is exercised.
 *
 * NULL CONTROLS: tests that call ratingsShallowEqual with genuinely different values must
 * return false — this ensures the function is not a no-op that would make the positive
 * (equal) tests pass trivially.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
global.fetch = jest.fn(() => new Promise(() => {}));   // never settles; isolates network

jest.mock('./backendWeatherServiceClient', () => ({
  getSharedValidTime: jest.fn(() => null),
  getSurfModeFlag: jest.fn(() => false),
  getBackendWindFlag: jest.fn(() => false),
}));
jest.mock('./spotRatingsClient', () => ({
  fetchSpotRatings: jest.fn(),
  mapSpotRatingsResponse: jest.fn(),
}));
jest.mock('./spotRatingsCdn', () => ({
  fetchPublicRatingsObject: jest.fn(),
  selectPrecomputedLaddered: jest.fn(),
  isBeyondPrecomputeBound: jest.fn(() => false),
}));
jest.mock('./surfRating', () => ({
  scoreToLevel: jest.fn((s) => (s >= 60 ? 'good' : s >= 40 ? 'fair' : 'poor')),
  RATING_COLOR: {},
  RATING_LABEL: {},
}));
jest.mock('./forecastStateIdentity', () => ({
  forecastStateIdentityEnabled: jest.fn(() => false),
  sameForecastReading: jest.fn((a, b) => a === b),
}));
import { ratingsShallowEqual } from './useSpotRatings';
import { forecastStateIdentityEnabled, sameForecastReading } from './forecastStateIdentity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spot(score, level = 'fair') {
  return { score, level, color: '#aaa', label: level };
}

// ---------------------------------------------------------------------------
// ratingsShallowEqual — value equality semantics (the stable-memo mechanism)
// ---------------------------------------------------------------------------

describe('ratingsShallowEqual — value equality for spotId → rating maps', () => {
  beforeEach(() => {
    forecastStateIdentityEnabled.mockReturnValue(false);
    sameForecastReading.mockImplementation((a, b) => a === b);
  });

  it('same reference returns true', () => {
    const a = { s1: spot(50) };
    expect(ratingsShallowEqual(a, a)).toBe(true);
  });

  it('value-equal objects in different references return true', () => {
    const a = { s1: spot(50, 'fair'), s2: spot(72, 'good') };
    const b = { s1: spot(50, 'fair'), s2: spot(72, 'good') };
    expect(ratingsShallowEqual(a, b)).toBe(true);
  });

  it('NULL CONTROL — different score → false (function has real discriminating power)', () => {
    const a = { s1: spot(50, 'fair') };
    const b = { s1: spot(51, 'fair') };  // score differs by 1
    expect(ratingsShallowEqual(a, b)).toBe(false);
  });

  it('different level → false even when score is equal', () => {
    const a = { s1: spot(50, 'fair') };
    const b = { s1: spot(50, 'poor') };
    expect(ratingsShallowEqual(a, b)).toBe(false);
  });

  it('different key count → false', () => {
    const a = { s1: spot(50) };
    const b = { s1: spot(50), s2: spot(60) };
    expect(ratingsShallowEqual(a, b)).toBe(false);
    expect(ratingsShallowEqual(b, a)).toBe(false);
  });

  it('missing spot in b → false', () => {
    const a = { s1: spot(50), s2: spot(60) };
    const b = { s1: spot(50), s3: spot(60) };
    expect(ratingsShallowEqual(a, b)).toBe(false);
  });

  it('empty maps are equal', () => {
    expect(ratingsShallowEqual({}, {})).toBe(true);
  });

  it('null / undefined guards — a===b reference check fires before null guard', () => {
    // null === null and undefined === undefined both return true:
    // useSpotRatings.js line 173 `if (a === b) return true` fires BEFORE
    // the null guard at line 174. Same-reference null/undefined pairs are
    // considered "equal" by the memo (no render needed).
    expect(ratingsShallowEqual(null, null)).toBe(true);    // a === b fires first
    expect(ratingsShallowEqual(null, {})).toBe(false);
    expect(ratingsShallowEqual({}, null)).toBe(false);
    expect(ratingsShallowEqual(undefined, undefined)).toBe(true); // a === b fires first
  });

  it('extra fields beyond score/level are ignored', () => {
    // Only score and level are compared; color/label/confidence are derived
    const a = { s1: { score: 50, level: 'fair', color: '#aaa', label: 'Fair', confidence: 0.9 } };
    const b = { s1: { score: 50, level: 'fair', color: '#bbb', label: 'Fair', confidence: 0.5 } };
    expect(ratingsShallowEqual(a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// forecastStateIdentity delegation gate
// ---------------------------------------------------------------------------

describe('ratingsShallowEqual — forecastStateIdentity delegation', () => {
  beforeEach(() => {
    forecastStateIdentityEnabled.mockReturnValue(false);
    sameForecastReading.mockReset();
  });

  it('delegates to sameForecastReading when forecastStateIdentityEnabled() is true', () => {
    forecastStateIdentityEnabled.mockReturnValue(true);
    sameForecastReading.mockReturnValue(true);

    const a = { s1: spot(50, 'fair') };
    const b = { s1: spot(51, 'good') };  // value-different; shallow check would be false

    const result = ratingsShallowEqual(a, b);
    expect(sameForecastReading).toHaveBeenCalledWith(a, b);
    // sameForecastReading overrides the shallow check → result is true (per mock)
    expect(result).toBe(true);
  });

  it('NULL CONTROL — does NOT delegate when forecastStateIdentityEnabled() is false', () => {
    forecastStateIdentityEnabled.mockReturnValue(false);
    ratingsShallowEqual({ s1: spot(50) }, { s1: spot(50) });
    expect(sameForecastReading).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Stable-memo semantics: same values, different refs
// This confirms the property the __RAW_DISABLE_RATINGS_STABLE_MEMO__ switch reverts.
// When the switch is OFF the hook uses ratingsShallowEqual to decide whether to keep the
// previous ref; the switch ON path skips the check and always returns the fresh ref.
// We verify the comparison function supports the stable-ref case correctly.
// ---------------------------------------------------------------------------

describe('stable-memo semantics via ratingsShallowEqual', () => {
  beforeEach(() => {
    forecastStateIdentityEnabled.mockReturnValue(false);
  });

  it('value-equal snapshots are detected as equal (stable ref is safe to keep)', () => {
    // Simulates: mergedRaw is a fresh {} with the same data as stableMergedRef.current
    const prev = { spotA: spot(60, 'good'), spotB: spot(45, 'fair') };
    const next = { spotA: spot(60, 'good'), spotB: spot(45, 'fair') };  // same values, new ref
    expect(prev === next).toBe(false);          // confirming different references
    expect(ratingsShallowEqual(prev, next)).toBe(true);  // but value-equal
  });

  it('a changed rating in the next snapshot is detected (ref must be replaced)', () => {
    const prev = { spotA: spot(60, 'good'), spotB: spot(45, 'fair') };
    const next = { spotA: spot(60, 'good'), spotB: spot(30, 'poor') };  // spotB score changed
    expect(ratingsShallowEqual(prev, next)).toBe(false);
  });
});
