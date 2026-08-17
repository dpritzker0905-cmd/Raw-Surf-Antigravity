/**
 * MID-CARVE REPLACE — the residual island halo's repair, pinned.
 *
 * The halo was attributed by alpha matting, grouping ten isolated runs at Madeira by the compositing
 * MODE actually used rather than by the lever flipped:
 *     min_combine (4 runs)  alpha spread 0.606 / 0.615 / 0.594 / 0.219   <- halo
 *     REPLACE     (5 runs)  alpha spread 0.024 / 0.011 / 0.011 / 0.011 / 0.024   <- flat
 * Shoreline alpha is 0.10 under min-combine and ~0.68 flat under REPLACE. `min(base, overlay)` of
 * two coastlines that disagree unions their land and carves real water; around an island that strip
 * closes into a ring.
 *
 * ⭐ Grouping by LEVER gave contradictory answers on two separate sweeps (midzoom_carve_off read
 * "82% flatter" once and "44%" the next; halo_damp_off read 2% then 69%). Grouping by MODE is clean.
 * These tests therefore pin the MODE PREDICATE, not any lever's effect.
 *
 * ⛔ THE SAFETY ARGUMENT, which is the part that must not rot. REPLACE caused the historical
 * Istria/Susak flood when the overlay did NOT contain the viewport — its padded ring clamped to
 * edge-water and covered everything. The carve refuses to engage unless the overlay CONTAINS the
 * viewport and is non-degraded, so REPLACE here is scoped to exactly the case where that flood
 * cannot occur. The predicate restates those preconditions itself rather than inheriting them, and
 * the tests below fail if either is ever dropped.
 */
import { computeMidCarveReplace, computeMidZoomOverlayEngage, MIDZOOM_OVERLAY_CARVE_MIN_Z }
  from './WebGLMarineEngine';

const ok = (over = {}) => ({
  midCarveEngage: true, overlayCoversViewport: true, overlayPaintDegraded: false, killed: false, ...over,
});

describe('computeMidCarveReplace — REPLACE only where the padded-ring flood cannot happen', () => {
  it('replaces when the carve is engaged over a covering, non-degraded overlay — the control', () => {
    expect(computeMidCarveReplace(ok())).toBe(true);
  });

  // ── each precondition, individually load-bearing ──
  it('does NOT replace when the carve is not engaged (min-combine was never in play)', () => {
    expect(computeMidCarveReplace(ok({ midCarveEngage: false }))).toBe(false);
  });

  it('⛔ does NOT replace when the overlay does not CONTAIN the viewport — the Istria/Susak guard', () => {
    // This is the one that caused the historical flood. If it ever returns true, the padded ring
    // clamps to edge-water and REPLACE covers the whole view.
    expect(computeMidCarveReplace(ok({ overlayCoversViewport: false }))).toBe(false);
  });

  it('does NOT replace on a degraded overlay paint — a bad mask must not become the only truth', () => {
    expect(computeMidCarveReplace(ok({ overlayPaintDegraded: true }))).toBe(false);
  });

  it('__RAW_DISABLE_MIDCARVE_REPLACE__ restores min-combine', () => {
    expect(computeMidCarveReplace(ok({ killed: true }))).toBe(false);
  });

  it('never throws on absent/garbage opts — an unknown state must fail to the SAFE side', () => {
    expect(computeMidCarveReplace()).toBe(false);
    expect(computeMidCarveReplace(null)).toBe(false);
    expect(computeMidCarveReplace({})).toBe(false);
  });

  // ── the composition with the engage gate: REPLACE can never outrun the carve ──
  it('cannot replace at a zoom where the carve itself refuses to engage', () => {
    const z = MIDZOOM_OVERLAY_CARVE_MIN_Z - 0.5;
    const engage = computeMidZoomOverlayEngage({ z, overlayCoversViewport: true, overlayPaintDegraded: false });
    expect(engage).toBe(false);
    expect(computeMidCarveReplace(ok({ midCarveEngage: engage }))).toBe(false);
  });

  it('and does replace at the boundary zoom, where the carve does engage', () => {
    const engage = computeMidZoomOverlayEngage({
      z: MIDZOOM_OVERLAY_CARVE_MIN_Z, overlayCoversViewport: true, overlayPaintDegraded: false });
    expect(engage).toBe(true);
    expect(computeMidCarveReplace(ok({ midCarveEngage: engage }))).toBe(true);
  });

  it('an unknown zoom fails safe through BOTH gates (NaN is a number — the classic slip)', () => {
    const engage = computeMidZoomOverlayEngage({ z: NaN, overlayCoversViewport: true, overlayPaintDegraded: false });
    expect(engage).toBe(false);
    expect(computeMidCarveReplace(ok({ midCarveEngage: engage }))).toBe(false);
  });
});
