/**
 * The fine-grid seam floor — the Canaveral "low pressure type wave center", third occurrence.
 *
 * HISTORY. The swirl is bilinear filtering rotating the heading between two DISAGREEING cells
 * (2026-07-01). It was fixed for coarse-global grids, then again on 2026-07-13 for the 2 degree
 * MID tier via a magnification gate. It came back on 2026-07-31 at z8.2 on the 0.25 degree
 * REGIONAL tile, because `isMagnifiedCoarseField` bails on `cellDeg < 1.0` BEFORE it looks at
 * zoom — the guard is structurally blind to fine tiles, so the vortex simply moved to a tier the
 * fix could not see.
 *
 * MEASURED on the live regional tile off the cape (GFS waves, 2026-07-31T03Z) — a windsea/swell
 * regime boundary crossing the coastline:
 *
 *     (28.25,-80.25)  16.4 deg -> (28.5,-80.25) 229.7 deg   delta 146.8   |bilinear mid| 0.286
 *     (28.50,-80.50)  84.7 deg -> (28.5,-80.25) 229.7 deg   delta 145.0   |bilinear mid| 0.301
 *     (27.75,-80.25)  79.4 deg -> (27.75,-80.0) 300.1 deg   delta 139.4   |bilinear mid| 0.347
 *
 * 6 of 175 adjacent pairs (3.4%) exceed 90 deg, and every one sits below the 0.7 floor already
 * shipped for coarse grids. The instrument existed; it was never allowed to look at this tier.
 *
 * The floor is deliberately LOWER than the coarse one so it bites regime seams only and leaves
 * ordinary coastal refraction alone — that is the property the last two tests pin.
 */
import {
  resolveFineSeamFloor, isMagnifiedCoarseField,
  FINE_SEAM_FLOOR_DEFAULT, FINE_SEAM_MAX_CELL_DEG,
} from './marineEngineDecisions';

/** |bilinear midpoint| of two unit heading vectors — exactly what the shader thresholds. */
function midMagnitude(dirA, dirB) {
  const u = (d) => [-Math.sin((d * Math.PI) / 180), -Math.cos((d * Math.PI) / 180)];
  const [ax, ay] = u(dirA);
  const [bx, by] = u(dirB);
  return Math.hypot((ax + bx) / 2, (ay + by) / 2);
}

describe('resolveFineSeamFloor — the tier the coarse vortex gate cannot reach', () => {
  it('THE REGRESSION: the coarse gate is structurally blind to a 0.25 deg tile at z8.2', () => {
    // Not a threshold that happens to miss — an early return before zoom is even considered.
    expect(isMagnifiedCoarseField(0.25, 8.2, {})).toBe(false);
    expect(isMagnifiedCoarseField(0.25, 14, {})).toBe(false);
    // ...while the 2 deg MID tier the 2026-07-13 fix targeted does engage.
    expect(isMagnifiedCoarseField(2.0, 8.2, {})).toBe(true);
  });

  it('applies a floor on a fine tile, and none on a coarse one', () => {
    expect(resolveFineSeamFloor(0.25, 0, {})).toBe(FINE_SEAM_FLOOR_DEFAULT);
    expect(resolveFineSeamFloor(0.5, 0, {})).toBe(FINE_SEAM_FLOOR_DEFAULT);
    expect(resolveFineSeamFloor(2.0, 0, {})).toBe(0);     // coarse keeps its own path, untouched
    expect(resolveFineSeamFloor(FINE_SEAM_MAX_CELL_DEG, 0, {})).toBe(0);   // boundary is exclusive
  });

  it('culls every measured cape seam pair', () => {
    const floor = resolveFineSeamFloor(0.25, 0, {});
    const seams = [[16.4, 229.7], [84.7, 229.7], [79.4, 300.1], [77.4, 305.8], [71.9, 305.8]];
    for (const [a, b] of seams) {
      expect(midMagnitude(a, b)).toBeLessThan(floor);
    }
  });

  it('LEAVES ORDINARY COASTAL REFRACTION ALONE — the property that keeps this proportionate', () => {
    const floor = resolveFineSeamFloor(0.25, 0, {});
    // Neighbouring cells legitimately fan by 30-60 deg along a refracting coast; those must survive
    // or the fix would strip real animation from every coastline on earth.
    for (const delta of [15, 30, 45, 60]) {
      expect(midMagnitude(90, 90 + delta)).toBeGreaterThan(floor);
    }
    // ~120 deg is where it starts biting — a regime boundary, not refraction.
    expect(midMagnitude(90, 90 + 120)).toBeLessThan(floor);
  });

  it('never LOWERS an already-applied floor (the suppress path sets 2.0 and must win)', () => {
    expect(resolveFineSeamFloor(0.25, 2.0, {})).toBe(0);
    expect(resolveFineSeamFloor(0.25, 1.0, {})).toBe(0);
  });

  it('is kill-switched and tunable', () => {
    expect(resolveFineSeamFloor(0.25, 0, { __RAW_DISABLE_FINE_SEAM_FLOOR__: true })).toBe(0);
    expect(resolveFineSeamFloor(0.25, 0, { __RAW_FINE_SEAM_FLOOR__: 0.8 })).toBe(0.8);
    expect(resolveFineSeamFloor(0.25, 0, { __RAW_FINE_SEAM_FLOOR__: 0 })).toBe(0);
    expect(resolveFineSeamFloor(0.25, 0, { __RAW_FINE_SEAM_FLOOR__: 5 })).toBe(1.0);  // clamped
  });

  it('degrades safely on missing geometry', () => {
    expect(resolveFineSeamFloor(null, 0, {})).toBe(0);
    expect(resolveFineSeamFloor(undefined, 0, {})).toBe(0);
  });
});
