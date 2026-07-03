/**
 * §0B-a render-confidence consumption (2026-07-03, v2 compressed mapping): the encoder scales the
 * encoded UNIT direction by GridVector.dir_confidence so the seam-dim/confused-sea shader
 * machinery fades crests where the backend's direction estimator had no stable truth.
 *
 * v2 (same evening, user report "fading of waves in patches z2.6–5.7"): confidence rides the
 * SAME channel as seam coherence (dim threshold 0.7), so the original LINEAR map dimmed every
 * mid-confidence cell (~60+ patches worldwide). The quadratic compression 1−(1−conf)²·strength
 * keeps mid-confidence above the dim threshold while genuine annihilation still dims.
 * The clamp ≥0.05 keeps low-confidence cells OUT of the zero-direction regime (|u,v|≤0.001)
 * that dilateDirectionField would refill with a full-strength neighbor direction.
 */
import { scaleUnitDirByConfidence } from './WebGLMarineTextureEncoder';

const mag = ([u, v]) => Math.hypot(u, v);

describe('scaleUnitDirByConfidence (§0B-a, v2 compressed)', () => {
  it('keeps MID-confidence above the 0.7 seam-dim threshold (the patchy-fade fix)', () => {
    // conf 0.65 → 1 − 0.35²·0.75 = 0.908; conf 0.5 → 0.8125 — both > 0.7 → NO crest dim.
    expect(mag(scaleUnitDirByConfidence(1, 0, 0.65))).toBeCloseTo(0.9081, 3);
    expect(mag(scaleUnitDirByConfidence(1, 0, 0.5))).toBeCloseTo(0.8125, 4);
    expect(mag(scaleUnitDirByConfidence(1, 0, 0.65))).toBeGreaterThan(0.7);
    expect(mag(scaleUnitDirByConfidence(1, 0, 0.5))).toBeGreaterThan(0.7);
  });

  it('still dims genuine annihilation zones (below the threshold, never dead)', () => {
    // conf 0.2 → 1 − 0.64·0.75 = 0.52 (partial dim); Baja-class 0.09 → 0.379 (strong dim).
    expect(mag(scaleUnitDirByConfidence(0, -1, 0.2))).toBeCloseTo(0.52, 3);
    expect(mag(scaleUnitDirByConfidence(0, -1, 0.09))).toBeCloseTo(0.3794, 3);
    expect(mag(scaleUnitDirByConfidence(0, -1, 0.09))).toBeLessThan(0.7);
  });

  it('clamps at 0.05 so the vector never enters the dilation/zero regime', () => {
    const out = scaleUnitDirByConfidence(0, -1, 0, 1.0); // worst case: conf 0, full strength
    expect(mag(out)).toBeCloseTo(0.05);
    expect(mag(out)).toBeGreaterThan(0.001); // dilation threshold
  });

  it('strength 0 disables the confidence fade entirely; strength scales the effect', () => {
    expect(scaleUnitDirByConfidence(0.6, 0.8, 0.1, 0)).toEqual([0.6, 0.8]);
    // strength 1.0 at conf 0.5 → 1 − 0.25 = 0.75
    expect(mag(scaleUnitDirByConfidence(1, 0, 0.5, 1.0))).toBeCloseTo(0.75, 4);
  });

  it('treats absent/invalid confidence as fully confident (backward compatible)', () => {
    expect(scaleUnitDirByConfidence(0.6, 0.8, null)).toEqual([0.6, 0.8]);
    expect(scaleUnitDirByConfidence(0.6, 0.8, undefined)).toEqual([0.6, 0.8]);
    expect(scaleUnitDirByConfidence(0.6, 0.8, 2.5)).toEqual([0.6, 0.8]);  // out of [0,1] -> ignore
    expect(scaleUnitDirByConfidence(0.6, 0.8, -1)).toEqual([0.6, 0.8]);
  });

  it('full confidence is an exact no-op', () => {
    expect(scaleUnitDirByConfidence(0.28, -0.96, 1.0)).toEqual([0.28, -0.96]);
  });

  it('preserves the direction (angle) exactly — only the magnitude carries confidence', () => {
    const [u, v] = scaleUnitDirByConfidence(Math.SQRT1_2, Math.SQRT1_2, 0.3);
    expect(Math.atan2(u, v)).toBeCloseTo(Math.atan2(Math.SQRT1_2, Math.SQRT1_2));
    expect(Math.hypot(u, v)).toBeCloseTo(1 - 0.49 * 0.75, 4);
  });
});
