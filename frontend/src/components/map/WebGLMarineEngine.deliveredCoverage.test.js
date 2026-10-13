import { resolveDeliveredCoverage } from './WebGLMarineEngine';

// #11 — THE HALO. The base-mask hysteresis granted its skip on the box it INTENDED to paint while
// the box it actually DELIVERED fell short of the viewport. Measured live 2026-08-01 at z8.03 on
// the reported coast, both predicates evaluated against the SAME viewport:
//
//     view        -81.443 … -79.057   span 2.386
//     rp.box      -81.443 … -79.057   span 2.386  -> hysteresis: COVERED     (skip granted)
//     _cachedMask -81.550 … -79.187   span 2.363  -> renderer:   coverage_gap, east short 0.1304
//     _lastMaskRepatchReason: "hysteresis_covered"   overlayMask.baseCoversView: false
//
// The coverage class: a resource chosen with no requirement that it CONTAIN what it must cover,
// degrading silently. These tests pin the DECISION; the live A/B is still owed (the precondition is
// path-dependent and did not recur on demand — see the queue entry).

const VIEW = { west: -81.443, south: 27.318, east: -79.057, north: 29.471 };
// the real delivered box from the live capture — short on the EAST edge only
const SHORT = { west: -81.5501, south: 26.9252, east: -79.1873, north: 29.5986 };
const COVERS = { west: -82, south: 26, east: -78, north: 30 };
const KEY = 'g1';

describe('resolveDeliveredCoverage — judge the DELIVERY, not the request', () => {
  it('flags the measured live case as short (east edge misses by 0.13°)', () => {
    const r = resolveDeliveredCoverage(SHORT, VIEW, KEY, null, false);
    expect(r.deliveredShort).toBe(true);
    expect(r.forceRepaint).toBe(true);
  });

  it('a delivery that genuinely contains the view is NOT short — no extra repaint', () => {
    const r = resolveDeliveredCoverage(COVERS, VIEW, KEY, null, false);
    expect(r.deliveredShort).toBe(false);
    expect(r.forceRepaint).toBe(false);
  });

  it('catches a shortfall on EACH edge independently, not just the east one we happened to measure', () => {
    const edges = [
      { ...COVERS, east: VIEW.east - 0.01 },
      { ...COVERS, west: VIEW.west + 0.01 },
      { ...COVERS, north: VIEW.north - 0.01 },
      { ...COVERS, south: VIEW.south + 0.01 },
    ];
    edges.forEach((b) => expect(resolveDeliveredCoverage(b, VIEW, KEY, null, false).deliveredShort).toBe(true));
  });

  it('an EXACT-fit delivery covers (containment is inclusive — a tie is not a defect)', () => {
    expect(resolveDeliveredCoverage({ ...VIEW }, VIEW, KEY, null, false).deliveredShort).toBe(false);
  });

  // THE BOUND. Without it, a painter that cannot satisfy the viewport would repaint on every
  // throttle tick — a churn is a worse bug than the halo it replaces.
  it('forces AT MOST ONE repaint per (gridKey, view) — the second pass stands down', () => {
    const first = resolveDeliveredCoverage(SHORT, VIEW, KEY, null, false);
    expect(first.forceRepaint).toBe(true);
    const second = resolveDeliveredCoverage(SHORT, VIEW, KEY, first.forceKey, false);
    expect(second.deliveredShort).toBe(true);      // still honest about the shortfall
    expect(second.forceRepaint).toBe(false);       // but does not churn
  });

  it('a CHANGED view re-arms the force (the bound is per-view, not permanent)', () => {
    const first = resolveDeliveredCoverage(SHORT, VIEW, KEY, null, false);
    const moved = { ...VIEW, west: VIEW.west - 0.5, east: VIEW.east - 0.5 };
    expect(resolveDeliveredCoverage(SHORT, moved, KEY, first.forceKey, false).forceRepaint).toBe(true);
  });

  it('a CHANGED grid re-arms the force even at the same view', () => {
    const first = resolveDeliveredCoverage(SHORT, VIEW, KEY, null, false);
    expect(resolveDeliveredCoverage(SHORT, VIEW, 'g2', first.forceKey, false).forceRepaint).toBe(true);
  });

  // FAIL TOWARD THE OLD BEHAVIOUR. This change may only ADD repaints in the proven-bad case; it
  // must never remove a skip the old code granted on information we do not actually have.
  it('UNKNOWN delivery is not "short" — a null/absent mask never forces a repaint', () => {
    expect(resolveDeliveredCoverage(null, VIEW, KEY, null, false).deliveredShort).toBe(false);
    expect(resolveDeliveredCoverage(undefined, VIEW, KEY, null, false).deliveredShort).toBe(false);
    expect(resolveDeliveredCoverage(SHORT, null, KEY, null, false).deliveredShort).toBe(false);
  });

  it('the kill switch restores the old behaviour exactly (byte-identical verdict)', () => {
    const off = resolveDeliveredCoverage(SHORT, VIEW, KEY, null, true);
    expect(off.deliveredShort).toBe(false);
    expect(off.forceRepaint).toBe(false);
  });

  // NEGATIVE CONTROL — a guard that cannot fail is not a guard. Flipping ONLY the delivered bounds
  // must flip the decision, with every other input held fixed.
  it('flipping ONLY the delivered bounds flips the decision, nothing else', () => {
    const a = resolveDeliveredCoverage(SHORT, VIEW, KEY, null, false);
    const b = resolveDeliveredCoverage(COVERS, VIEW, KEY, null, false);
    expect(a.forceRepaint).toBe(true);
    expect(b.forceRepaint).toBe(false);
    expect(a.forceKey).toBe(b.forceKey);   // same view+grid ⇒ same key; only coverage differed
  });
});

// ⛔ C4-MR-09 (2026-08-16) — THE ANTIMERIDIAN. `curView` comes from `map.getBounds()`, whose
// getWest()/getEast() return west > east when the viewport crosses 180°. The plain <=/>= containment
// above then reports COVERED for a box it does not cover, and the skip is granted — REMOVING a
// repaint, which is the one direction this function's own header promises never to take ("may only
// ADD repaints ... never remove a skip"). The engine already carries the idiom for this elsewhere
// (`_vbEast < _vbWest // viewport crosses the antimeridian`), and it has been bitten here before:
// the 2026-07 wrap conditions were dead code and "half the field blanked".
// The fix REFUSES rather than reasons: a wrapped box on either side is never a skip.
describe('resolveDeliveredCoverage — antimeridian (wrapped boxes are never a skip)', () => {
  // ⚠️ THE SIZES ARE LOAD-BEARING. A wrap test only DISCRIMINATES when naive containment would have
  // said COVERED — otherwise it passes with or without the fix. My first draft had cache and view the
  // wrong way round and TWO of three tests were vacuous; the mutation run exposed it (only 1 of 3 went
  // red). So: the cache must be WIDER than the view, and each test asserts `naiveCovered` explicitly
  // so a future edit that breaks the discrimination fails loudly instead of silently.
  const WRAP_VIEW = { west: 175, south: -10, east: -175, north: 10 };   // narrower, straddles 180°
  const WRAP_CACHE = { west: 170, south: -20, east: -170, north: 20 };  // wider, also straddles
  const WORLD = { west: -180, south: -85, east: 180, north: 85 };
  const naive = (c, v) => c.west <= v.west && c.east >= v.east && c.south <= v.south && c.north >= v.north;

  it('a WRAPPED viewport is short even against a whole-world cache (naive maths said COVERED)', () => {
    expect(naive(WORLD, WRAP_VIEW)).toBe(true);      // -180<=175 ✓ 180>=-175 ✓ — the old skip
    const r = resolveDeliveredCoverage(WORLD, WRAP_VIEW, KEY, null, false);
    expect(r.deliveredShort).toBe(true);
    expect(r.forceRepaint).toBe(true);
  });

  it('a WRAPPED cached box is short too — the refusal is symmetric', () => {
    expect(naive(WRAP_CACHE, WRAP_VIEW)).toBe(true); // 170<=175 ✓ -170>=-175 ✓ — the old skip
    expect(resolveDeliveredCoverage(WRAP_CACHE, WRAP_VIEW, KEY, null, false).deliveredShort).toBe(true);
  });

  it('refuses in the SAFE direction: it may add a repaint, never remove one', () => {
    // Both sides wrapped and naively "covering" — still refused. Costing a repaint is the acceptable
    // error; granting a skip on a box we cannot reason about is not.
    const r = resolveDeliveredCoverage(WRAP_CACHE, WRAP_VIEW, KEY, null, false);
    expect(r.forceRepaint).toBe(true);
  });

  it('the kill switch still disables the whole check, wrap included', () => {
    expect(resolveDeliveredCoverage(WORLD, WRAP_VIEW, KEY, null, true).deliveredShort).toBe(false);
  });

  // NON-VACUITY — the wrap clause must not have turned the function into "always short".
  it('unwrapped boxes are unaffected: a covering delivery is still NOT short', () => {
    expect(resolveDeliveredCoverage(COVERS, VIEW, KEY, null, false).deliveredShort).toBe(false);
    expect(resolveDeliveredCoverage(WORLD, VIEW, KEY, null, false).deliveredShort).toBe(false);
  });
});
