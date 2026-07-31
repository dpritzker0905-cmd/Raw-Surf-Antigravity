/**
 * #11 THE HALO — the mask shrank as the viewport grew.
 *
 * THE STRUCTURAL CLASS (P1): a resource is selected without a hard requirement that it CONTAIN what
 * it must cover, and when coverage fails the code DEGRADES SILENTLY instead of refusing. The GRID
 * lane has `shouldRejectResolutionDowngrade` for exactly this. The MASK lane had no equivalent.
 *
 * MEASURED LIVE 2026-07-31, one zoom step apart at the same coordinate:
 *
 *   z 8.18 clean   viewport lng -81.29..-79.21   mask -94,12,-64,44  (30x32 deg)  covers TRUE
 *   z 8.03 HALO    viewport lng -81.62..-78.79   mask -83,26,-79,31  ( 4x 5 deg)  covers FALSE
 *                  ^ viewport GREW                ^ mask SHRANK ~7x        reason 'coverage_gap'
 *
 * ⚠️ The engine ALREADY computed `_overlayCoversViewport === false` at z8.03. It knew. The only
 * thing missing was an ACTION on that failure: `_nonCoveringDrop` is gated `z < 4.4` and the halo
 * band is z 6.74-8.03. ★ The Jacobian variable is the action on failure, not a threshold.
 */
import { shouldRejectMaskShrink } from '../components/map/marineEngineDecisions';

// The two masks, exactly as measured.
const CLEAN_MASK = { west: -94, south: 12, east: -64, north: 44 };   // 30 deg span, covered
const HALO_MASK = { west: -83, south: 26, east: -79, north: 31 };    //  4 deg span, did NOT cover
const VIEW_803 = { west: -81.62, south: 27.5, east: -78.79, north: 30.5 };

const covers = (c, i) => ({ candidateCoversViewport: c, incumbentCoveredViewport: i });

describe('the measured halo instance', () => {
  test('the shrunken non-covering mask is REFUSED, so the incumbent stays on screen', () => {
    expect(shouldRejectMaskShrink(CLEAN_MASK, HALO_MASK, VIEW_803, covers(false, true))).toBe(true);
  });

  test('the reverse step — growing back to the covering mask — is always accepted', () => {
    expect(shouldRejectMaskShrink(HALO_MASK, CLEAN_MASK, VIEW_803, covers(true, false))).toBe(false);
  });

  test('the clean z8.18 frame is untouched: a covering candidate never trips the guard', () => {
    expect(shouldRejectMaskShrink(CLEAN_MASK, CLEAN_MASK, VIEW_803, covers(true, true))).toBe(false);
  });
});

describe('fail-open — a wrong REJECT is permanent, a wrong ACCEPT self-heals in one frame', () => {
  test.each([
    ['candidate coverage UNKNOWN', covers(undefined, true)],
    ['candidate COVERS', covers(true, true)],
    ['incumbent never covered either', covers(false, false)],
    ['incumbent coverage UNKNOWN', covers(false, undefined)],
  ])('%s -> accept', (_label, opts) => {
    expect(shouldRejectMaskShrink(CLEAN_MASK, HALO_MASK, VIEW_803, opts)).toBe(false);
  });

  test('no incumbent -> accept (nothing better to hold)', () => {
    expect(shouldRejectMaskShrink(null, HALO_MASK, VIEW_803, covers(false, true))).toBe(false);
  });

  test('no viewport -> accept (cannot judge coverage)', () => {
    expect(shouldRejectMaskShrink(CLEAN_MASK, HALO_MASK, null, covers(false, true))).toBe(false);
  });

  test('unknowable span -> accept', () => {
    const degenerate = { west: -80, south: 26, east: -80, north: 31 };
    expect(shouldRejectMaskShrink(degenerate, HALO_MASK, VIEW_803, covers(false, true))).toBe(false);
    expect(shouldRejectMaskShrink(CLEAN_MASK, degenerate, VIEW_803, covers(false, true))).toBe(false);
  });

  test('the kill switch disables the whole guard', () => {
    expect(shouldRejectMaskShrink(CLEAN_MASK, HALO_MASK, VIEW_803,
      { ...covers(false, true), disabled: true })).toBe(false);
  });
});

describe('only a genuine SHRINK is refused — nothing may strand', () => {
  test('an EQUAL-span non-covering candidate passes (a pan away from the box, not a shrink)', () => {
    const panned = { west: -124, south: 12, east: -94, north: 44 };   // same 30 deg span, moved
    expect(shouldRejectMaskShrink(CLEAN_MASK, panned, VIEW_803, covers(false, true))).toBe(false);
  });

  test('a LARGER non-covering candidate passes', () => {
    const bigger = { west: -140, south: 12, east: -60, north: 44 };
    expect(shouldRejectMaskShrink(CLEAN_MASK, bigger, VIEW_803, covers(false, true))).toBe(false);
  });

  test('shrinkRatio tightens the definition of a shrink without changing the direction', () => {
    const slightly = { west: -92, south: 12, east: -64, north: 44 };  // 28 vs 30 deg
    expect(shouldRejectMaskShrink(CLEAN_MASK, slightly, VIEW_803, covers(false, true))).toBe(true);
    expect(shouldRejectMaskShrink(CLEAN_MASK, slightly, VIEW_803,
      { ...covers(false, true), shrinkRatio: 0.5 })).toBe(false);   // must halve to count
  });
});

describe('the guard can actually fire — negative control', () => {
  test('flipping ONLY the coverage verdict flips the decision, nothing else', () => {
    const reject = shouldRejectMaskShrink(CLEAN_MASK, HALO_MASK, VIEW_803, covers(false, true));
    const accept = shouldRejectMaskShrink(CLEAN_MASK, HALO_MASK, VIEW_803, covers(true, true));
    expect(reject).toBe(true);
    expect(accept).toBe(false);
  });
});
