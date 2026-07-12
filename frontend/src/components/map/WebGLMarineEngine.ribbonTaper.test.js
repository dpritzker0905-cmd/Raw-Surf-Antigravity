import { resolveRibbonTaper } from './WebGLMarineEngine';

// The coastal-ribbon taper resolver (2026-07-12 user spec, revised same day: the rating band
// extends ~10 MILES out and tapers into the honest heatmap). The shader does the per-pixel
// ring-sampling; this resolver supplies radius + floor and carries the safety rules: the
// mask-resolution floor (a sub-texel ribbon on the coarse world mask would erase the band)
// and the blank-map alpha floor when no wash draws underneath.

const MI_TO_DEG = 1 / 69;

describe('resolveRibbonTaper — 10-mile coastal ribbon', () => {
  it('defaults to 10 miles (~0.145°) with full transparency beyond the ribbon when the wash is under it', () => {
    const r = resolveRibbonTaper({}, null, true);
    expect(r.radiusDeg).toBeCloseTo(10 * MI_TO_DEG, 5);
    expect(r.floor).toBe(0.0);
  });

  it('floors at 0.3 beyond the ribbon when NO wash is engaged (blank-map lesson)', () => {
    const r = resolveRibbonTaper({}, null, false);
    expect(r.floor).toBe(0.3);
  });

  it('is DISABLED by the kill switch (radius 0 → shader skips all ring sampling)', () => {
    const r = resolveRibbonTaper({ __RAW_RATING_RIBBON_DISABLED__: true }, 0.001, true);
    expect(r.radiusDeg).toBe(0.0);
  });

  it('radius is a product knob: __RAW_RATING_RIBBON_MI__ rescales it (17 mi, 6 mi)', () => {
    expect(resolveRibbonTaper({ __RAW_RATING_RIBBON_MI__: 17 }, null, true).radiusDeg)
      .toBeCloseTo(17 * MI_TO_DEG, 5);
    expect(resolveRibbonTaper({ __RAW_RATING_RIBBON_MI__: 6 }, null, true).radiusDeg)
      .toBeCloseTo(6 * MI_TO_DEG, 5);
    expect(resolveRibbonTaper({ __RAW_RATING_RIBBON_MI__: 0 }, null, true).radiusDeg).toBe(0.0);
  });

  it('MASK-RESOLUTION FLOOR: a coarse world mask (texel ≈ 0.352° ≈ 24 mi) widens the ribbon to ~1.6 texels', () => {
    const worldTexelDeg = 360 / 1024;                       // the 1024×512 world mask
    const r = resolveRibbonTaper({}, worldTexelDeg, true);
    expect(r.radiusDeg).toBeCloseTo(1.6 * worldTexelDeg, 5); // ~0.5625° ≈ 39 mi — coarse but PRESENT
    expect(r.radiusDeg).toBeGreaterThan(10 * MI_TO_DEG);
  });

  it('a CRISP viewport mask leaves the true 10-mile radius untouched', () => {
    const fineTexelDeg = 4 / 4096;                          // ~0.001°/texel viewport mask
    const r = resolveRibbonTaper({}, fineTexelDeg, true);
    expect(r.radiusDeg).toBeCloseTo(10 * MI_TO_DEG, 5);
  });

  it('tolerates missing/hostile inputs (no window, bad texel) without throwing', () => {
    expect(() => resolveRibbonTaper(null, undefined, false)).not.toThrow();
    expect(resolveRibbonTaper(null, -1, true).radiusDeg).toBeCloseTo(10 * MI_TO_DEG, 5);
  });
});
