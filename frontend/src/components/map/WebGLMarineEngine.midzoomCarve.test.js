/**
 * INV-coastline-truth-below-z9 — enforcement for LAYER_ORDER_PROOF_LOG.json#LOP-0002.
 *
 * ⛔ THE MEASURED FACT THIS PINS (2026-08-16, authenticated dev alias, build 5117d4fc):
 * the viewport-truth overlay engages at exactly MIDZOOM_OVERLAY_CARVE_MIN_Z, and BELOW it the marine
 * field's coastline comes from GENERALIZED land geometry rather than basemap water truth. Measured
 * on the SE Florida control coast, everything else held fixed:
 *
 *     z8.90  overlayMask.on = false  reason 'off'          -> grey band between land and field
 *     z9.30  overlayMask.on = true   reason 'min_combine'  -> field reaches the shore, band ABSENT
 *
 * The band's width is the generalization error (~1-2 km), which at z8.7 (~1199 px/deg) is 10-20
 * screen px. Mask resolution is NOT the cause and was eliminated by measurement: the mask is
 * 4096x2048 over 8 deg, so one texel is ~2.3 screen px there — LINEAR filtering cannot make a 20 px
 * band out of a 2.3 px texel.
 *
 * ★ WHY THIS THRESHOLD IS LOAD-BEARING IN BOTH DIRECTIONS. `ocean-mask-buffer` (LOP-0001) ramped
 *   line-opacity 1.0 until z8.5 and 0 by z9.5, and its 2026-07-05 comment says it was "built to
 *   blend the MARINE heatmap's coastline". The buffer covered z<9.5; this carve covers z>=9 — a
 *   DESIGNED HANDOFF. LOP-0001 correctly removed the buffer (its colour was near-black against
 *   medium-slate water), and doing so EXPOSED the band the buffer had been hiding. So moving this
 *   threshold, or reinstating the buffer, changes which half of that handoff is load-bearing.
 *   Neither may be done without the z8.5-z9.5 ladder on the owner coast AND a control coast.
 */
import { computeMidZoomOverlayEngage, MIDZOOM_OVERLAY_CARVE_MIN_Z } from './WebGLMarineEngine';

const engaged = { overlayCoversViewport: true, overlayPaintDegraded: false, midCarveOff: false };

describe('INV-coastline-truth-below-z9 (LOP-0002)', () => {
  it('the threshold is 9 — the measured flip point, pinned so a silent move is visible', () => {
    // Not a style preference: 8.90 and 9.30 were measured on a live authenticated build either side
    // of this number. If it moves, the ladder must be re-run and LOP-0002 updated.
    expect(MIDZOOM_OVERLAY_CARVE_MIN_Z).toBe(9);
  });

  it('does NOT engage below the threshold — where the coastline band lives', () => {
    for (const z of [2, 6, 8, 8.5, 8.72, 8.9, 8.999]) {
      expect({ z, engage: computeMidZoomOverlayEngage({ ...engaged, z }) }).toEqual({ z, engage: false });
    }
  });

  it('engages at and above the threshold — where the band is absent', () => {
    for (const z of [9, 9.3, 10, 12, 16]) {
      expect({ z, engage: computeMidZoomOverlayEngage({ ...engaged, z }) }).toEqual({ z, engage: true });
    }
  });

  it('the flip is exactly at the boundary, not near it', () => {
    expect(computeMidZoomOverlayEngage({ ...engaged, z: MIDZOOM_OVERLAY_CARVE_MIN_Z - 0.001 })).toBe(false);
    expect(computeMidZoomOverlayEngage({ ...engaged, z: MIDZOOM_OVERLAY_CARVE_MIN_Z })).toBe(true);
  });

  it('fails safe on an unknown zoom — NaN must not slip through typeof', () => {
    for (const z of [undefined, null, NaN, 'nine', {}]) {
      expect(computeMidZoomOverlayEngage({ ...engaged, z })).toBe(false);
    }
  });

  // NON-VACUITY — the other preconditions must still be able to veto, or "engages above 9" would be
  // true for the wrong reason and this suite would pass a broken gate.
  it('a non-covering or degraded overlay still vetoes above the threshold', () => {
    expect(computeMidZoomOverlayEngage({ ...engaged, z: 12, overlayCoversViewport: false })).toBe(false);
    expect(computeMidZoomOverlayEngage({ ...engaged, z: 12, overlayPaintDegraded: true })).toBe(false);
    expect(computeMidZoomOverlayEngage({ ...engaged, z: 12, midCarveOff: true })).toBe(false);
  });
});
