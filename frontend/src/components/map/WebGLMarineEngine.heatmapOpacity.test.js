import { heatmapZoomOpacity } from './WebGLMarineEngine';

// Heatmap base opacity vs zoom (2026-07-17 per-zoom color-consistency audit). The FLATTENED +
// C0-continuous curve replaces the legacy 0.55→0.85 ramp that had a hard 0.05 step at z12 (the
// "z12.05 flutter") and a wide same-location color swing. Locks: continuity (no discrete jumps),
// monotonic non-decreasing, tightened range [0.65, 0.80], and exact legacy parity under the kill.

const NEW = {}; // no window flag → flattened curve
const LEGACY = { __RAW_DISABLE_FLAT_HEATMAP_OPACITY__: true };

describe('heatmapZoomOpacity — flattened, continuous curve', () => {
  it('is C0-continuous at every breakpoint (no discrete color jumps)', () => {
    for (const bp of [3, 8, 13]) {
      const lo = heatmapZoomOpacity(bp - 1e-4, NEW);
      const at = heatmapZoomOpacity(bp, NEW);
      const hi = heatmapZoomOpacity(bp + 1e-4, NEW);
      expect(Math.abs(at - lo)).toBeLessThan(1e-3);
      expect(Math.abs(hi - at)).toBeLessThan(1e-3);
    }
  });

  it('specifically has NO step at z12 (the legacy 0.80→0.85 discontinuity is gone)', () => {
    const below = heatmapZoomOpacity(12.0, NEW);
    const above = heatmapZoomOpacity(12.0001, NEW);
    expect(Math.abs(above - below)).toBeLessThan(1e-3);
    // legacy DID step here — prove the contrast
    const lBelow = heatmapZoomOpacity(12.0, LEGACY);
    const lAbove = heatmapZoomOpacity(12.0001, LEGACY);
    expect(lAbove - lBelow).toBeGreaterThan(0.04);
  });

  it('is monotonic non-decreasing across z1..z16', () => {
    let prev = -1;
    for (let z = 1; z <= 16; z += 0.25) {
      const o = heatmapZoomOpacity(z, NEW);
      expect(o).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = o;
    }
  });

  it('stays within the tightened range [0.65, 0.80] (swing 0.15 vs legacy 0.30)', () => {
    let min = 1, max = 0;
    for (let z = 0; z <= 20; z += 0.25) {
      const o = heatmapZoomOpacity(z, NEW);
      min = Math.min(min, o); max = Math.max(max, o);
    }
    expect(min).toBeGreaterThanOrEqual(0.65 - 1e-9);
    expect(max).toBeLessThanOrEqual(0.80 + 1e-9);
    expect(max - min).toBeCloseTo(0.15, 2);
  });

  it('raises the wide-zoom floor vs legacy (moves AWAY from the blank-map failure mode)', () => {
    // at global zoom the new curve is MORE opaque, not less — the opposite of the blank-heatmap class
    expect(heatmapZoomOpacity(2, NEW)).toBeGreaterThan(heatmapZoomOpacity(2, LEGACY));
    expect(heatmapZoomOpacity(2, NEW)).toBeCloseTo(0.65, 5);
  });

  it('kill switch restores the exact legacy curve (incl. its z12 step)', () => {
    expect(heatmapZoomOpacity(2, LEGACY)).toBeCloseTo(0.55, 5);
    expect(heatmapZoomOpacity(5, LEGACY)).toBeCloseTo(0.65, 5);
    expect(heatmapZoomOpacity(8, LEGACY)).toBeCloseTo(0.75, 5);
    expect(heatmapZoomOpacity(12, LEGACY)).toBeCloseTo(0.80, 5);
    expect(heatmapZoomOpacity(12.5, LEGACY)).toBeCloseTo(0.85, 5);
  });

  it('new curve key anchors', () => {
    expect(heatmapZoomOpacity(3, NEW)).toBeCloseTo(0.65, 5);
    expect(heatmapZoomOpacity(8, NEW)).toBeCloseTo(0.75, 5);
    expect(heatmapZoomOpacity(13, NEW)).toBeCloseTo(0.80, 5);
    expect(heatmapZoomOpacity(16, NEW)).toBeCloseTo(0.80, 5);
  });
});
