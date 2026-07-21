/**
 * ratingsShallowEqual (2026-07-21) — pins the value-equality used to STABILIZE the spot-ratings output
 * identity so a marineData.grid commit with UNCHANGED rating levels does not re-render the React.memo'd
 * MapMarkerLayers (the clusterRatings re-render storm). Same ids + same score/level per id => equal.
 */
import { ratingsShallowEqual } from './useSpotRatings';

const R = (score, level) => ({ score, level, color: '#000', label: level });

describe('ratingsShallowEqual', () => {
  it('same reference is equal', () => {
    const a = { s1: R(80, 'good') };
    expect(ratingsShallowEqual(a, a)).toBe(true);
  });

  it('distinct objects with identical ids + score + level are equal (the stabilize case)', () => {
    expect(ratingsShallowEqual({ s1: R(80, 'good'), s2: R(40, 'fair') }, { s1: R(80, 'good'), s2: R(40, 'fair') })).toBe(true);
  });

  it('a changed level is NOT equal (glyph must recolor)', () => {
    expect(ratingsShallowEqual({ s1: R(80, 'good') }, { s1: R(80, 'epic') })).toBe(false);
  });

  it('a changed score is NOT equal (tooltip must update)', () => {
    expect(ratingsShallowEqual({ s1: R(80, 'good') }, { s1: R(72, 'good') })).toBe(false);
  });

  it('a removed spot is NOT equal', () => {
    expect(ratingsShallowEqual({ s1: R(80, 'good'), s2: R(40, 'fair') }, { s1: R(80, 'good') })).toBe(false);
  });

  it('an added spot is NOT equal (newly rated spot must appear)', () => {
    expect(ratingsShallowEqual({ s1: R(80, 'good') }, { s1: R(80, 'good'), s2: R(40, 'fair') })).toBe(false);
  });

  it('a swapped-out id (same count) is NOT equal', () => {
    expect(ratingsShallowEqual({ s1: R(80, 'good') }, { s2: R(80, 'good') })).toBe(false);
  });

  it('two empty maps are equal (stable EMPTY through scrub)', () => {
    expect(ratingsShallowEqual({}, {})).toBe(true);
  });

  it('a null operand vs a map is never equal (never falsely stabilize); two nulls short-circuit equal', () => {
    expect(ratingsShallowEqual(null, {})).toBe(false);
    expect(ratingsShallowEqual({}, null)).toBe(false);
    expect(ratingsShallowEqual(null, null)).toBe(true); // a===b (null===null) short-circuit; never occurs in-hook (mergedRaw is always an object)
  });
});
