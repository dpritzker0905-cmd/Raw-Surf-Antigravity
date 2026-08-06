/**
 * The zoom-out blank, pinned from measured production frames.
 *
 * ⚠️ EVERY CASE BELOW IS A REAL FRAME from the 2026-08-06 nightly bracket (7 runs, 2,452 frames),
 * not a case someone imagined. The model these encode was validated end to end:
 *
 *     blank <=> overlapRatio < 0.6 AND no coarse base
 *     14 true positives / 0 false positives / 0 misses / 2438 true negatives
 *
 * Before this file the decision was reachable only through a GL context, so the sole thing that
 * could observe it was a ~20-minute nightly whose verdict is BIMODAL — 08-01 scored 11 findings and
 * 08-02 scored 0 on identical code. That is why a defect this deterministic went unnoticed: nothing
 * could see it in under twenty minutes, and what could see it disagreed with itself.
 */
import { resolveRejectedOpacity, isBlankFrame, DEFAULT_COVER_FRAC } from './marineZoomOutGate';

// (arm, covF at the frame, bridge at the frame, did it blank) — straight from the traces.
const MEASURED = [
  ['AFTER-1 idx286', 0.462, false, true],
  ['AFTER-1 idx289', 0.360, false, true],
  ['AFTER-2 idx286', 0.525, false, true],
  ['DEVNOW  idx295', 0.557, false, true],
  ['BEFORE-3 min   ', 0.604, false, false],
  ['AFTER-3 min    ', 0.614, true, false],
  ['BEFORE-1 min   ', 0.634, true, false],
  ['BEFORE-2 min   ', 0.697, false, false],
];

describe('the measured blank model', () => {
  it.each(MEASURED)('%s covF=%s bridge=%s -> blank=%s', (_arm, covF, bridge, blanked) => {
    expect(isBlankFrame({ overlapRatio: covF, hasCoarseBridge: bridge })).toBe(blanked);
  });

  it('the gate sits at 0.6 — the value the layer documents', () => {
    expect(DEFAULT_COVER_FRAC).toBe(0.6);
    // The tightest clean margin ever observed was BEFORE-3 at 0.604 — four thousandths.
    expect(isBlankFrame({ overlapRatio: 0.604, hasCoarseBridge: false })).toBe(false);
    expect(isBlankFrame({ overlapRatio: 0.599, hasCoarseBridge: false })).toBe(true);
  });

  it('a coarse base makes the same coverage safe — that is the whole design', () => {
    expect(isBlankFrame({ overlapRatio: 0.36, hasCoarseBridge: false })).toBe(true);
    expect(isBlankFrame({ overlapRatio: 0.36, hasCoarseBridge: true })).toBe(false);
  });
});

describe('resolveRejectedOpacity — the three rejection paths', () => {
  const zoomedOutRegional = {
    isViewportZoomedOut: true, isGridRegional: true, isZoomingOrMoving: true, currentZoom: 4.625,
  };

  it('WITH a coarse base: hides the regional and flags the bridge, so the engine paints the base', () => {
    const r = resolveRejectedOpacity({ ...zoomedOutRegional, hasCoarseBridge: true, overlapRatio: 0.36 });
    expect(r).toMatchObject({ opacity: 0.0, coarseBridge: true, bail: false });
    expect(r.unhandledBlank).toBeUndefined();
  });

  it('settled and rejected: bails out of rendering entirely', () => {
    const r = resolveRejectedOpacity({ ...zoomedOutRegional, isZoomingOrMoving: false, hasCoarseBridge: false });
    expect(r.bail).toBe(true);
  });

  it('⚠️ WITHOUT a coarse base: paints NOTHING — the measured defect', () => {
    const r = resolveRejectedOpacity({ ...zoomedOutRegional, hasCoarseBridge: false, overlapRatio: 0.36 });
    expect(r.opacity).toBe(0.0);
    expect(r.coarseBridge).toBe(false);
    expect(r.unhandledBlank).toBe(true);
  });

  it('KILLED FIX #2: the fade branch is a NO-OP at every measured blank zoom', () => {
    // Routing the no-bridge case into the fade branch was the obvious fix. It changes nothing:
    // zoomFade = clamp((z - 5.5) / 1.0) is already 0 at 4.985 / 4.805 / 4.625.
    for (const z of [4.985, 4.805, 4.625]) {
      const faded = resolveRejectedOpacity({
        isViewportZoomedOut: false, isGridRegional: true, isZoomingOrMoving: true,
        hasCoarseBridge: false, currentZoom: z, overlapRatio: 0.5,
      });
      expect(faded.opacity).toBe(0);
    }
  });

  it('a covering regional at a normal zoom still renders', () => {
    const r = resolveRejectedOpacity({
      isViewportZoomedOut: false, isGridRegional: true, isZoomingOrMoving: true,
      hasCoarseBridge: false, currentZoom: 8, overlapRatio: 0.95,
    });
    expect(r.opacity).toBe(1);
    expect(r.bail).toBe(false);
  });
});
