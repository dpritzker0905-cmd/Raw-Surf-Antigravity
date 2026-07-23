import { shouldRejectSubcoveringRegional, coarseBaseKey } from './WebGLMarineEngine';

// Guards for the 2026-07-16 zoom-out forensics pair:
//  1. shouldRejectSubcoveringRegional — mid-gesture the pan-following refetch committed a regional
//     covering ~60% of a wide viewport OVER the covering coarse-global; the gate hid it (mult 0)
//     and the bridge bounced the world grid back = pale interlude + promotion flash for zero net
//     change. The reject skips the bounce; a wrong reject self-heals via the pendingDowngrade stash.
//  2. coarseBaseKey rating flavor — without it a rated coarse-global commit with unchanged
//     geometry never re-captured the base, so bridge promotions committed a stale-flavor coarse
//     under the current view (the vivid↔rating color pop).

const WORLD = {
  bounds: { west: -180, south: -80, east: 180, north: 85 },
  cols: 37, rows: 17, hourOffset: 0,
  __sourceModel: 'GFS', __componentLayer: 'waves',
  vectors: new Array(629).fill({ speed: 1 }),
};
// 14°-wide regional inside a 22°-wide viewport → ~57% coverage
const REGIONAL = {
  bounds: { west: -86, south: 22, east: -72, north: 34 },
  cols: 8, rows: 7, hourOffset: 0,
  __sourceModel: 'GFS', __componentLayer: 'waves',
  vectors: new Array(56).fill({ speed: 1 }),
};
const WIDE_VP = [-88, 20, -66, 33];   // 22° x 13° — now INSIDE the 40° mid-band (mid serves)
const WORLD_VP = [-175, -5, -25, 45];  // 150° x 50° — PAST the 120° mid-band ceiling (genuine world zoom)
const TIGHT_VP = [-81, 26, -79, 28];  // 2° x 2°

afterEach(() => {
  delete window.__RAW_DISABLE_SUBCOVER_REJECT__;
  delete window.__RAW_DOWNGRADE_COVER_FRAC__;
});

describe('shouldRejectSubcoveringRegional', () => {
  it('REJECTS a sub-covering same-target regional over a covering coarse-global PAST the mid-band ceiling', () => {
    expect(shouldRejectSubcoveringRegional(WORLD, REGIONAL, 5.5, WORLD_VP, false)).toBe(true);
  });

  it('does NOT reject in the 15-40° MID-BAND — the 2° mid serves there (2026-07-22, the Bertha zoom-out)', () => {
    // A 22° viewport is now inside the mid ceiling: a subcovering mid there is the storm we WANT to
    // hold, not a churn to reject. The old 15° rule rejected it (→ the coarse-bridge flash).
    expect(shouldRejectSubcoveringRegional(WORLD, REGIONAL, 5.5, WIDE_VP, false)).toBe(false);
    // kill switch restores the old 15° reject
    expect(shouldRejectSubcoveringRegional(WORLD, REGIONAL, 5.5, WIDE_VP, false, { __RAW_DISABLE_MIDBAND_BRIDGE_CEIL__: true })).toBe(true);
  });

  it('accepts once coverage reaches the shared cover-frac lever (default 0.6)', () => {
    // widen the regional to cover most of the >120° world viewport (~0.86)
    const covering = { ...REGIONAL, bounds: { west: -170, south: -3, east: -30, north: 43 } };
    expect(shouldRejectSubcoveringRegional(WORLD, covering, 5.5, WORLD_VP, false)).toBe(false);
    // or shrink the required fraction below the actual coverage: a ~0.57-covering regional
    const halfReg = { ...REGIONAL, bounds: { west: -175, south: -5, east: -90, north: 45 } };
    window.__RAW_DOWNGRADE_COVER_FRAC__ = 0.4;
    expect(shouldRejectSubcoveringRegional(WORLD, halfReg, 5.5, WORLD_VP, false)).toBe(false);
  });

  it('accepts at zoomed-in views (the gate/bridge never fight there)', () => {
    expect(shouldRejectSubcoveringRegional(WORLD, REGIONAL, 9.0, TIGHT_VP, false)).toBe(false);
  });

  it('never holds a deliberate switch: model, layer, hour, or rating flavor change always commits', () => {
    expect(shouldRejectSubcoveringRegional(WORLD, { ...REGIONAL, __sourceModel: 'EURO' }, 5.5, WIDE_VP, false)).toBe(false);
    expect(shouldRejectSubcoveringRegional(WORLD, { ...REGIONAL, __componentLayer: 'swell_1' }, 5.5, WIDE_VP, false)).toBe(false);
    expect(shouldRejectSubcoveringRegional(WORLD, { ...REGIONAL, hourOffset: 3 }, 5.5, WIDE_VP, false)).toBe(false);
    expect(shouldRejectSubcoveringRegional(WORLD, { ...REGIONAL, ratingMode: true }, 5.5, WIDE_VP, false)).toBe(false);
    expect(shouldRejectSubcoveringRegional({ ...WORLD, ratingMode: true }, REGIONAL, 5.5, WIDE_VP, false)).toBe(false);
  });

  it('only protects a coarse-global resident and only against regional incomings', () => {
    expect(shouldRejectSubcoveringRegional(REGIONAL, REGIONAL, 5.5, WIDE_VP, false)).toBe(false);
    expect(shouldRejectSubcoveringRegional(WORLD, WORLD, 5.5, WIDE_VP, false)).toBe(false);
  });

  it('FAILS OPEN on unknown zoom or viewport (wrong accept self-heals; wrong reject strands)', () => {
    expect(shouldRejectSubcoveringRegional(WORLD, REGIONAL, undefined, WIDE_VP, false)).toBe(false);
    expect(shouldRejectSubcoveringRegional(WORLD, REGIONAL, 5.5, null, false)).toBe(false);
  });

  it('honors both kill switches', () => {
    expect(shouldRejectSubcoveringRegional(WORLD, REGIONAL, 5.5, WIDE_VP, true)).toBe(false); // shared no-downgrade kill
    window.__RAW_DISABLE_SUBCOVER_REJECT__ = true;
    expect(shouldRejectSubcoveringRegional(WORLD, REGIONAL, 5.5, WIDE_VP, false)).toBe(false);
  });
});

describe('coarseBaseKey — rating flavor is part of the base identity', () => {
  it('same geometry, different flavor → different key (rated coarse commits re-capture the base)', () => {
    const unrated = coarseBaseKey(WORLD);
    const rated = coarseBaseKey({ ...WORLD, ratingMode: true });
    expect(unrated).not.toEqual(rated);
    expect(unrated.endsWith('r0')).toBe(true);
    expect(rated.endsWith('r1')).toBe(true);
  });

  it('identical grids keep identical keys (re-encode still skipped when nothing changed)', () => {
    expect(coarseBaseKey(WORLD)).toEqual(coarseBaseKey({ ...WORLD }));
  });
});
