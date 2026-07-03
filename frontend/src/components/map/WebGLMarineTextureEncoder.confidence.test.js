/**
 * §0B-a render-confidence consumption (2026-07-03): the encoder scales the encoded UNIT direction
 * by GridVector.dir_confidence so the seam-dim/confused-sea shader machinery fades crests where the
 * backend's direction estimator had no stable truth (the (20,-120) GFS-divergence class).
 * The clamp ≥0.05 keeps low-confidence cells OUT of the zero-direction regime (|u,v|≤0.001) that
 * dilateDirectionField would refill with a full-strength neighbor direction.
 */
import { scaleUnitDirByConfidence } from './WebGLMarineTextureEncoder';

describe('scaleUnitDirByConfidence (§0B-a)', () => {
  it('scales the unit vector by the confidence', () => {
    const [u, v] = scaleUnitDirByConfidence(1.0, 0.0, 0.5);
    expect(u).toBeCloseTo(0.5);
    expect(v).toBeCloseTo(0.0);
  });

  it('clamps low confidence to 0.05 so the vector never enters the dilation/zero regime', () => {
    const [u, v] = scaleUnitDirByConfidence(0.0, -1.0, 0.001);
    expect(Math.hypot(u, v)).toBeCloseTo(0.05);
    expect(Math.hypot(u, v)).toBeGreaterThan(0.001); // dilation threshold
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
    expect(Math.hypot(u, v)).toBeCloseTo(0.3);
  });
});
