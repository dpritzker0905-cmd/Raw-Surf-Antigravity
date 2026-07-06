import {
  iconExtendedContinuityDecay,
  iconExtendedContinuityOffset,
  applySubContinuity,
} from '../components/map/backendWeatherServiceClientHelpers';

// ICON >240h BOUNDARY CONTINUITY (2026-07-06, "the heatmap changes colors dramatically at the
// native→extended handoff"): the ≤240 anchored trend and the >240 raw 0.6/0.4 mix disagreed at
// hour 240 wherever the mix's climatology differs — a level jump in the colormap. The additive
// offset makes mix(240)+offset == trend(240) exactly, decaying to the pure locked mix by 288.

const cell = (speed, period = 8) => ({ speed, height: speed, period, u: 0, v: speed });

describe('iconExtendedContinuityDecay', () => {
  it('is 1.0 at the 240 boundary, 0.5 at 264, 0 at/after 288', () => {
    expect(iconExtendedContinuityDecay(240)).toBe(1);
    expect(iconExtendedContinuityDecay(243)).toBeCloseTo(1 - 3 / 48, 6);
    expect(iconExtendedContinuityDecay(264)).toBeCloseTo(0.5, 6);
    expect(iconExtendedContinuityDecay(288)).toBe(0);
    expect(iconExtendedContinuityDecay(336)).toBe(0);
  });
});

describe('iconExtendedContinuityOffset — exact continuity at the boundary', () => {
  it('mix(240) + offset equals the ≤240 anchored value at 240', () => {
    const icon168 = cell(2.0, 9), gfs168 = cell(1.5, 7), gfs240 = cell(3.0, 10), euro240 = cell(1.0, 12);
    const off = iconExtendedContinuityOffset(icon168, gfs168, gfs240, euro240, 0.6);
    const trend240 = 2.0 + 0.8 * (3.0 - 1.5);            // 3.2 — the ≤240 formula's endpoint
    const mix240 = 0.6 * 3.0 + 0.4 * 1.0;                // 2.2 — the raw mix at 240
    expect(mix240 + off.dH).toBeCloseTo(trend240, 6);    // continuity restored exactly
    const trendP = 9 + 0.8 * (10 - 7), mixP = 0.6 * 10 + 0.4 * 12;
    expect(mixP + off.dP).toBeCloseTo(trendP, 6);
  });

  it('GFS-only fallback (EURO missing, weight 1.0) stays consistent', () => {
    const off = iconExtendedContinuityOffset(cell(2.0), cell(1.5), cell(3.0), null, 1.0);
    // trend240 = 2 + 0.8·1.5 = 3.2; mix240 = gfs240 = 3.0 → offset 0.2
    expect(off.dH).toBeCloseTo(0.2, 6);
  });

  it('missing anchors → null (no correction, fail open to the raw mix)', () => {
    expect(iconExtendedContinuityOffset(null, cell(1), cell(1), cell(1), 0.6)).toBeNull();
    expect(iconExtendedContinuityOffset(cell(1), cell(1), null, cell(1), 0.6)).toBeNull();
  });
});

describe('applySubContinuity', () => {
  it('shifts height/period and rescales u,v with the height', () => {
    const sub = { speed: 2.0, height: 2.0, period: 8, u: 0, v: 2.0 };
    const out = applySubContinuity(sub, { dH: 1.0, dP: 2.0 }, 1.0);
    expect(out.speed).toBeCloseTo(3.0, 6);
    expect(out.height).toBeCloseTo(3.0, 6);
    expect(out.period).toBeCloseTo(10, 6);
    expect(out.v).toBeCloseTo(3.0, 6);   // direction preserved, magnitude follows height
  });

  it('decay 0 (hour ≥288) and negative results clamp safely', () => {
    const sub = cell(2.0);
    expect(applySubContinuity(sub, { dH: 5, dP: 5 }, 0)).toBe(sub);   // pure mix in the far tail
    const out = applySubContinuity(cell(0.5), { dH: -2.0, dP: -20 }, 1.0);
    expect(out.speed).toBe(0);           // clamped, never negative
    expect(out.period).toBe(0);
  });
});
