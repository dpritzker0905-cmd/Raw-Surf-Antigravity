import {
  maskDensityPxPerDeg,
  incomingMaskDensityPxPerDeg,
  maskCanvasWidthForSpan,
} from '../components/map/WebGLMarineMaskRenderer';

// MASK NO-DOWNGRADE RETAIN (2026-07-06): a mid-tier grid commit (span 10-30° → 2048 tier) must
// not replace a crisp resident mask for the ~1s until the fine grid returns — the Florida
// z9-10.5 "waves over land + intracoastal" transient. The encoder retains when
// residentDensity > incomingDensity × 1.5 AND the layer stamped viewport containment.

const RETAIN_FACTOR = 1.5;

describe('mask density helpers', () => {
  it('resident fine mask (4096 over 6°) is far denser than a mid rebuild (2048 over 16°)', () => {
    const resident = maskDensityPxPerDeg({ w: 4096, h: 2048 }, { west: -85, south: 25, east: -79, north: 31 });
    const incomingMid = incomingMaskDensityPxPerDeg({ west: -90, south: 20, east: -74, north: 36 }); // span 16
    expect(resident).toBeCloseTo(4096 / 6, 3);      // ~683 px/°
    expect(incomingMid).toBeCloseTo(2048 / 16, 3);  // 128 px/°
    expect(resident).toBeGreaterThan(incomingMid * RETAIN_FACTOR); // → RETAIN fires
  });

  it('the returning fine grid rebuilds normally (incoming as dense as the resident)', () => {
    const resident = maskDensityPxPerDeg({ w: 4096, h: 2048 }, { west: -85, south: 25, east: -79, north: 31 });
    const incomingFine = incomingMaskDensityPxPerDeg({ west: -84, south: 26, east: -80, north: 30 }); // span 4 → 4096 tier
    expect(incomingFine).toBeCloseTo(4096 / 4, 3);  // 1024 px/° — finer than resident
    expect(resident).not.toBeGreaterThan(incomingFine * RETAIN_FACTOR); // → rebuild
  });

  it('world-span rebuilds are never blocked by density alone (containment stamp is the guard)', () => {
    // At world zoom the viewport is NOT inside the old 6° mask bounds, so _maskRetainPatchedOk
    // is false and the branch never engages — density math here just documents the magnitudes.
    const incomingWorld = incomingMaskDensityPxPerDeg({ west: -180, south: -80, east: 180, north: 85 });
    expect(incomingWorld).toBeCloseTo(maskCanvasWidthForSpan(360) / 360, 3); // ~11 px/°
  });

  it('degenerate inputs fail safe (0 density → never retains)', () => {
    expect(maskDensityPxPerDeg(null, { west: 0, south: 0, east: 1, north: 1 })).toBe(0);
    expect(maskDensityPxPerDeg({ w: 2048 }, null)).toBe(0);
    expect(incomingMaskDensityPxPerDeg(null)).toBe(0);
  });

  it('antimeridian-wrapping bounds compute a positive span', () => {
    const d = maskDensityPxPerDeg({ w: 2048 }, { west: 170, south: -10, east: -170, north: 10 }); // 20° wrapped
    expect(d).toBeCloseTo(2048 / 20, 3);
  });
});
