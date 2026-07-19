/**
 * ARBITER PHASE B — rule-list contract (marineCommitArbiter.arbiterDecide).
 * One fixture per rule, first-match-wins order asserted, plus agreement spot-checks against the
 * shipped no-downgrade guard for the classes it was built from. The shadow's divergences in live
 * runs are tuning data; these tests pin the INTENDED semantics of each rule.
 */
import { arbiterDecide, _internal } from './marineCommitArbiter';
import {
  shouldRejectResolutionDowngrade, decideMarineCommit,
  __resetRatingGraceForTests, __resetArbiterGraceForTests,
} from './WebGLMarineEngine';

const mkGrid = (over = {}) => ({
  bounds: { west: -83, south: 26, east: -79, north: 30 },
  cols: 16, rows: 16,
  vectors: [{ lat: 27, lng: -80, u: 0.1, v: 0.1, speed: 1 }],
  __sourceModel: 'GFS', __componentLayer: 'waves', hourOffset: 0,
  ratingMode: false, __renderable: true,
  ...over,
});
// Fine 0.25°/cell FL tile vs the 37-col world coarse (~9.7°/cell).
const fine = (over = {}) => mkGrid(over);
const world = (over = {}) => mkGrid({
  bounds: { west: -180, south: -80, east: 180, north: 85 }, cols: 37, rows: 17, ...over,
});
// Viewport over the FL tile (array form [w,s,e,n], as the engine passes it).
const VP_FL = [-81, 26.5, -79.5, 28.5];
const VP_PACIFIC = [-150, 10, -130, 25];
const CTX_IN = { zoom: 9.3, viewportBounds: VP_FL, flavorWant: false };

describe('arbiterDecide rule list (first match wins)', () => {
  it('1 empty/unrenderable resident → commit', () => {
    expect(arbiterDecide(null, fine(), CTX_IN)).toEqual({ verdict: 'commit', rule: 'empty_resident' });
    expect(arbiterDecide(mkGrid({ vectors: [] }), fine(), CTX_IN).rule).toBe('empty_resident');
    expect(arbiterDecide(mkGrid({ __renderable: false }), fine(), CTX_IN).rule).toBe('empty_resident');
  });

  it('2 model switch → commit (resolution comparison across models is meaningless)', () => {
    expect(arbiterDecide(fine(), world({ __sourceModel: 'EURO' }), CTX_IN).rule).toBe('model_switch');
  });

  it('3 layer switch → commit', () => {
    expect(arbiterDecide(fine(), fine({ __componentLayer: 'swell_1' }), CTX_IN).rule).toBe('layer_switch');
  });

  it('4 hour change → commit (scrub always advances)', () => {
    expect(arbiterDecide(fine(), world({ hourOffset: 3 }), CTX_IN).rule).toBe('hour_change');
  });

  it('5a flavor upgrade (want on, rated incoming) → commit', () => {
    const r = arbiterDecide(fine(), fine({ ratingMode: true }), { ...CTX_IN, flavorWant: true });
    expect(r).toEqual({ verdict: 'commit', rule: 'flavor_upgrade' });
  });

  it('5b flavor downgrade (want on, unrated over covering rated) → reject', () => {
    const r = arbiterDecide(fine({ ratingMode: true }), world(), { ...CTX_IN, flavorWant: true });
    expect(r).toEqual({ verdict: 'reject', rule: 'flavor_downgrade' });
  });

  it('5c rated resident that no longer covers releases even with want on', () => {
    const r = arbiterDecide(fine({ ratingMode: true }), world(), { zoom: 9.3, viewportBounds: VP_PACIFIC, flavorWant: true });
    expect(r).toEqual({ verdict: 'commit', rule: 'rated_uncovering_release' });
  });

  it('5d want OFF: rated resident releases to any honest incoming', () => {
    const r = arbiterDecide(fine({ ratingMode: true }), world(), CTX_IN);
    expect(r).toEqual({ verdict: 'commit', rule: 'rated_release' });
  });

  it('6 resident no longer covers the viewport → commit', () => {
    const r = arbiterDecide(fine(), world(), { ...CTX_IN, viewportBounds: VP_PACIFIC });
    expect(r).toEqual({ verdict: 'commit', rule: 'resident_uncovering' });
  });

  it('7 tier downgrade zoomed-in over covering resident → reject', () => {
    const r = arbiterDecide(fine(), world(), CTX_IN);
    expect(r).toEqual({ verdict: 'reject', rule: 'tier_downgrade' });
  });

  it('7b unknown VIEWPORT fails OPEN (wrong accept self-heals; wrong reject strands)', () => {
    const r = arbiterDecide(fine(), world(), { zoom: 9.3, flavorWant: false });
    expect(r.verdict).toBe('commit');
  });

  it('7c SHADOW-TUNED: coarse over a still-covering mid rejects at zoom-out z5.5-6.1 too', () => {
    // The battery divergence class: 16° mid resident (1.78°/cell) covering the z6.1 viewport;
    // world coarse incoming. The guard held the mid (coarsening-never-clearing); the arbiter must too.
    const mid = mkGrid({ bounds: { west: -88, south: 22, east: -72, north: 34 }, cols: 9, rows: 7 });
    const r = arbiterDecide(mid, world(), { zoom: 6.127, viewportBounds: [-84, 25, -76, 31], flavorWant: false });
    expect(r).toEqual({ verdict: 'reject', rule: 'tier_downgrade' });
  });

  it('8 sub-covering regional over world grid at wide view → reject', () => {
    const r = arbiterDecide(world(), fine(), { zoom: 3.0, viewportBounds: [-120, -30, 0, 40], flavorWant: false });
    expect(r).toEqual({ verdict: 'reject', rule: 'subcover_at_wide' });
  });

  it('9 default: same target, adequate resident — fresher commits', () => {
    const r = arbiterDecide(fine(), fine({ vectors: [{ lat: 27, lng: -80, u: 0.2, v: 0.1, speed: 1.1 }] }), CTX_IN);
    expect(r).toEqual({ verdict: 'commit', rule: 'fresh_same_target' });
  });
});

describe('agreement spot-checks vs the shipped no-downgrade guard', () => {
  it('classic coarse-displaces-fine at close zoom: both REJECT', () => {
    const res = fine(), inc = world();
    expect(shouldRejectResolutionDowngrade(res, inc, 9.3, VP_FL, false)).toBe(true);
    expect(arbiterDecide(res, inc, CTX_IN).verdict).toBe('reject');
  });

  it('coarse→fine sharpen: both COMMIT', () => {
    const res = world(), inc = fine();
    expect(shouldRejectResolutionDowngrade(res, inc, 9.3, VP_FL, false)).toBe(false);
    expect(arbiterDecide(res, inc, CTX_IN).verdict).toBe('commit');
  });

  it('cross-model replacement: both COMMIT', () => {
    const res = fine(), inc = world({ __sourceModel: 'EURO' });
    expect(shouldRejectResolutionDowngrade(res, inc, 9.3, VP_FL, false)).toBe(false);
    expect(arbiterDecide(res, inc, CTX_IN).verdict).toBe('commit');
  });

  it('resident stops covering after a pan: both COMMIT the replacement', () => {
    const res = fine(), inc = world();
    expect(shouldRejectResolutionDowngrade(res, inc, 9.3, VP_PACIFIC, false)).toBe(false);
    expect(arbiterDecide(res, inc, { ...CTX_IN, viewportBounds: VP_PACIFIC }).verdict).toBe('commit');
  });
});

describe('_internal geometry helpers', () => {
  it('coverageFrac: full / partial / none', () => {
    const g = fine();
    expect(_internal.coverageFrac(g, VP_FL)).toBeCloseTo(1.0, 5);
    expect(_internal.coverageFrac(g, VP_PACIFIC)).toBe(0);
    expect(_internal.coverageFrac(g, null)).toBeNull();
  });
  it('cellDegOf handles antimeridian-wrapped bounds', () => {
    expect(_internal.cellDegOf({ bounds: { west: 170, east: -170, south: 0, north: 10 }, cols: 20 })).toBeCloseTo(1.0, 5);
  });
});

// === PHASE C — the rating-interlude GRACE, and the flip surface ===
// The Phase B soak hit 89/89 agreement WITHOUT exercising the grace class: every non-covering
// rated fixture in the battery was ≥15° wide, which trips the guard's wideView exemption (where
// both sides release immediately). At a zoomed-IN NARROW viewport the guard holds and the
// pre-fix arbiter released — proven divergence, and a straight regression of round-12 §4f.
describe('rating-interlude grace (the divergence the Phase B soak could not see)', () => {
  // Rated clip covering ~25% of a 2°x2° viewport at z7.5 → coverage release fires, NOT wideView.
  const ratedSliver = () => mkGrid({ ratingMode: true, bounds: { west: -81, south: 26.5, east: -80.5, north: 28.5 } });
  const VP_NARROW = [-81, 26.5, -79, 28.5];
  const gs = () => ({ key: null, startedAt: 0, expired: false });
  const ctx = (over = {}) => ({ zoom: 7.5, viewportBounds: VP_NARROW, flavorWant: true, zoomedOutMaxZoom: 6.5, ...over });

  beforeEach(() => { __resetRatingGraceForTests(); window.__SURF_MODE__ = true; });
  afterEach(() => { delete window.__SURF_MODE__; });

  it('holds the rated resident inside the grace window — matching the guard', () => {
    const state = gs();
    expect(shouldRejectResolutionDowngrade(ratedSliver(), world(), 7.5, VP_NARROW, false, 1000)).toBe(true);
    expect(arbiterDecide(ratedSliver(), world(), ctx({ graceState: state, nowMs: 1000 })))
      .toEqual({ verdict: 'reject', rule: 'rated_uncovering_grace' });
  });

  it('releases once the bound expires — truth wins, stranding stays impossible BY THE BOUND', () => {
    const state = gs();
    arbiterDecide(ratedSliver(), world(), ctx({ graceState: state, nowMs: 1000 }));
    expect(arbiterDecide(ratedSliver(), world(), ctx({ graceState: state, nowMs: 1000 + 4001 })))
      .toEqual({ verdict: 'commit', rule: 'rated_uncovering_release' });
    // …and the guard agrees at the same instant.
    shouldRejectResolutionDowngrade(ratedSliver(), world(), 7.5, VP_NARROW, false, 1000);
    expect(shouldRejectResolutionDowngrade(ratedSliver(), world(), 7.5, VP_NARROW, false, 1000 + 4001)).toBe(false);
  });

  it('WIDE view is exempt (2026-07-16 pt3: holding there wedged the zoom-out bridge)', () => {
    const state = gs();
    expect(arbiterDecide(ratedSliver(), world(),
      ctx({ graceState: state, nowMs: 1000, viewportBounds: [-100, 10, -60, 40] })).rule)
      .toBe('rated_uncovering_release');
    // zoomed OUT is wide too, regardless of span
    expect(arbiterDecide(ratedSliver(), world(), ctx({ graceState: state, nowMs: 1000, zoom: 5.0 })).rule)
      .toBe('rated_uncovering_release');
  });

  it('a RATED incoming is untouched by the grace (rated→rated swap: no blink)', () => {
    const state = gs();
    expect(arbiterDecide(ratedSliver(), world({ ratingMode: true }), ctx({ graceState: state, nowMs: 1000 })).verdict)
      .toBe('commit');
  });

  it('__RAW_DISABLE_RATING_GRACE__ parity: graceDisabled releases immediately', () => {
    const state = gs();
    expect(arbiterDecide(ratedSliver(), world(), ctx({ graceState: state, nowMs: 1000, graceDisabled: true })).rule)
      .toBe('rated_uncovering_release');
  });
});

describe('decideMarineCommit — the ONE decision point (Phase C flip surface)', () => {
  const winBase = (over = {}) => ({ localStorage: { getItem: () => null }, ...over });

  beforeEach(() => { __resetRatingGraceForTests(); __resetArbiterGraceForTests(); });

  it('DEFAULT is guard mode — unchanged behavior, and it says so', () => {
    const d = decideMarineCommit(fine(), world(), 9.3, VP_FL, winBase());
    expect(d).toEqual({ reject: true, why: 'downgrade', rule: 'guard_downgrade', source: 'guards' });
  });

  it('__RAW_MARINE_ARBITER__ flips the source to the rule list', () => {
    const d = decideMarineCommit(fine(), world(), 9.3, VP_FL, winBase({ __RAW_MARINE_ARBITER__: true }));
    expect(d).toEqual({ reject: true, why: 'downgrade', rule: 'tier_downgrade', source: 'arbiter' });
  });

  it('__RAW_DISABLE_MARINE_ARBITER__ OUTRANKS the enable (the kill switch must always win)', () => {
    const d = decideMarineCommit(fine(), world(), 9.3, VP_FL,
      winBase({ __RAW_MARINE_ARBITER__: true, __RAW_DISABLE_MARINE_ARBITER__: true }));
    expect(d.source).toBe('guards');
  });

  it('__RAW_DISABLE_NO_DOWNGRADE__ forces every commit through in BOTH modes', () => {
    for (const arb of [false, true]) {
      const d = decideMarineCommit(fine(), world(), 9.3, VP_FL,
        winBase({ __RAW_MARINE_ARBITER__: arb, __RAW_DISABLE_NO_DOWNGRADE__: true }));
      expect(d.reject).toBe(false);
    }
  });

  it('subcover keeps its legacy `why` vocabulary across the flip (telemetry/zoomlab parse it)', () => {
    const d = decideMarineCommit(world(), fine(), 3.0, [-120, -30, 0, 40],
      winBase({ __RAW_MARINE_ARBITER__: true }));
    expect(d).toEqual({ reject: true, why: 'subcover', rule: 'subcover_at_wide', source: 'arbiter' });
  });

  it('null resident never rejects (empty resident commits anything renderable)', () => {
    for (const arb of [false, true]) {
      expect(decideMarineCommit(null, fine(), 9.3, VP_FL, winBase({ __RAW_MARINE_ARBITER__: arb })).reject)
        .toBe(false);
    }
  });

  // THE STRUCTURAL INVARIANT. The choke and the render-loop self-heal both call this function; if
  // they could ever disagree, a rejected grid would be stashed and then insta-accepted next frame —
  // a permanent commit⇄stash bounce. Same inputs must give the same verdict in either mode.
  it('MIRROR INVARIANT: the same inputs decide identically for the choke and the self-heal', () => {
    const cases = [
      [fine(), world(), 9.3, VP_FL],
      [world(), fine(), 3.0, [-120, -30, 0, 40]],
      [fine(), world(), 9.3, VP_PACIFIC],
      [fine({ ratingMode: true }), world(), 7.5, [-81, 26.5, -79, 28.5]],
      [world(), fine(), 9.3, VP_FL],
      [fine(), world({ __sourceModel: 'EURO' }), 9.3, VP_FL],
      [fine(), world({ hourOffset: 3 }), 9.3, VP_FL],
      [fine(), world(), undefined, undefined],
    ];
    for (const arb of [false, true]) {
      const w = winBase({ __RAW_MARINE_ARBITER__: arb });
      for (const [res, inc, z, vb] of cases) {
        const atChoke = decideMarineCommit(res, inc, z, vb, w, 5000);
        const atSelfHeal = decideMarineCommit(res, inc, z, vb, w, 5000);
        expect(atSelfHeal.reject).toBe(atChoke.reject);
      }
    }
  });

  it('unknown zoom AND viewport fails OPEN in both modes (a wrong reject strands — 07-03)', () => {
    for (const arb of [false, true]) {
      expect(decideMarineCommit(fine(), world(), undefined, undefined,
        winBase({ __RAW_MARINE_ARBITER__: arb })).reject).toBe(false);
    }
  });
});
