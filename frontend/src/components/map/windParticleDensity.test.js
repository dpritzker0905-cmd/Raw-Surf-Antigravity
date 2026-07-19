/**
 * WIND PARTICLE INK BUDGET (2026-07-18 EVE-3 round 4).
 *
 * User: "some wind particle density is huge, while others is proper."
 *
 * WHAT THE EYE READS IS INK, NOT PARTICLE COUNT:
 *     ink(speed) ~ mark AREA(speed) x COUNT(speed),   COUNT ~ lifetime ~ 1/dropRate.
 *
 * FIRST DIAGNOSIS WAS WRONG, AND THE CORRECTION MATTERS. Measuring particle COUNT alone showed a
 * 73x spread and made the legacy rule (u_drop_rate + speed*u_drop_rate_bump) look like the bug. It
 * is not: against the webgl-wind lineage's TRAIL rendering (ink ~ speed/dropRate) that rule holds
 * ink flat to 1.06x above 4 kn — it is a well-tuned compensator for the fact that fast particles
 * draw longer streaks (documented by its author). Bounding it, as first attempted here, would have
 * broken good design.
 *
 * THE REAL CAUSE WAS THIS SESSION'S OWN LOW-WIND SIZE FLOOR. It multiplied calm-air mark AREA by
 * up to ~10x — and un-zeroed the sub-0.5 kn marks legacy had made invisible — without touching
 * their LIFETIME. Point-sprite ink ratio on a real GFS Gulf field: 4.4x before, 124x after.
 *
 * FIX: pay for enlarged marks in lifetime. dropRate = max(legacy, area/I0), so it can only ever
 * recycle SOONER — never hoard — which leaves the long-shipped >11 kn regime bit-identical.
 */
import { ADVECT_FS, DRAW_VS } from './WebGLWindShaders';

// Real GFS speed distribution for the reported viewport (z5.55, [-87.7,22.2,-71.6,34.3]), knots.
const REAL = [0.28, 2, 3.85, 6.52, 11.08, 16.87, 22.71, 38.79];
const DROP = 0.002, BUMP = 0.008;   // engine defaults
const I0 = 130.0;                   // must match inkFlatDrop's divisor in ADVECT_FS

const smoothstep = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
const legacyDrop = (s) => DROP + s * BUMP;
// Mirror of ADVECT_FS sCss / DRAW_VS minCssPx — deliberately duplicated so a drift between the
// two shader stages shows up as a failing number rather than a silent density regression.
// 2026-07-19 size-monotonicity: the DEFAULT floor is now FLAT at sizeBase(10 kn) = 3.073 css px
// (the slowness ramp 3.4->4.2 made SLOWER marks LARGER than 8-15 kn marks — the user-reported
// inversion; the ramp survives only behind __RAW_DISABLE_WIND_SIZE_MONOTONIC__).
const sizeCss = (s) => {
  const base = s < 0.5 ? 0 : 2.5 + 2.5 * smoothstep(1.0, 30.0, s);
  const floor = (s >= 1.0 && s < 10.0) ? 3.073 : ((s >= 0.3 && s < 1.0) ? 2.2 : 0);
  return Math.max(base, floor);
};
// Calm lifetime floor (2026-07-19): below 4.75 kn lifetime >= 25 frames — a bounded ink premium
// where calm patches otherwise flicker (the dead-zone report). never-hoard holds via the max.
const shippedDrop = (s) => {
  let d = Math.max(legacyDrop(s), (sizeCss(s) * sizeCss(s)) / I0);
  if (s < 4.75) d = Math.max(legacyDrop(s), Math.min(d, 0.04));
  return d;
};
const ink = (s, drop) => (sizeCss(s) * sizeCss(s)) / drop(s);

describe('wind particle ink budget', () => {
  it('documents the regression: an uncompensated size floor blows the ink budget', () => {
    const sizeLegacy = (s) => (s < 0.5 ? 0 : 2.5 + 2.5 * smoothstep(1.0, 30.0, s));
    const before = REAL.map((s) => (sizeLegacy(s) ** 2) / legacyDrop(s)).filter((x) => x > 0);
    const after = REAL.map((s) => (sizeCss(s) ** 2) / legacyDrop(s)).filter((x) => x > 0);
    const r = (a) => Math.max(...a) / Math.min(...a);
    // eslint-disable-next-line no-console
    console.log(`ink ratio — pre-floor ${r(before).toFixed(1)}x, floor-without-compensation ${r(after).toFixed(0)}x`);
    expect(r(before)).toBeLessThan(6);    // 4.4x — the level that shipped for months
    // The uncompensated figure has fallen as the floor itself grew more conservative across this
    // arc — 124x (round-2/4 disc floor, 5.5-8 px, from 0.15 kn) -> 52x (round-5 dash floor) -> 12x
    // (round-5b: zoom-scaled, no longer resurrecting sub-1 kn calm) -> 6.5x (2026-07-19 monotone
    // flat floor at sizeBase(10kn)). That shrinkage is the point. The invariant being pinned is
    // only that an UNCOMPENSATED floor still blows past the 4.4x baseline, so the compensation
    // cannot be quietly deleted.
    expect(r(after)).toBeGreaterThan(5);
  });

  it('the shipped rule holds the ink ratio near the pre-regression level', () => {
    // Speeds below ~1 kn draw NOTHING (sizeBase is 0 under 0.5 kn and the floor now starts at
    // 1.0 kn), so they contribute zero ink by design — that is the calm air legacy also hid.
    // They must be excluded rather than counted as an infinitely-light tile.
    const inks = REAL.map((s) => ink(s, shippedDrop)).filter((x) => x > 0);
    const ratio = Math.max(...inks) / Math.min(...inks);
    // eslint-disable-next-line no-console
    console.log(`shipped ink ratio ${ratio.toFixed(2)}x  [${inks.map((i) => i.toFixed(0)).join(', ')}]`);
    expect(ratio).toBeLessThan(3.0);
  });

  it('NEVER hoards: the drop rate is >= legacy at every speed', () => {
    for (const s of REAL) expect(shippedDrop(s)).toBeGreaterThanOrEqual(legacyDrop(s) - 1e-12);
  });

  it('leaves the long-shipped fast regime bit-identical (>= ~11 kn)', () => {
    for (const s of [11.08, 16.87, 22.71, 38.79]) {
      expect(shippedDrop(s)).toBeCloseTo(legacyDrop(s), 10);
    }
  });

  it('no lifetime is shorter than the regime legacy already runs at speed', () => {
    // Legacy already recycles 38.8 kn particles every ~3.2 frames, so that is a normal lifetime
    // here — the compensation must not go far beyond it or calm air will visibly flicker.
    const shortest = Math.min(...REAL.map((s) => 1 / shippedDrop(s)));
    // eslint-disable-next-line no-console
    console.log(`shortest lifetime ${shortest.toFixed(1)} frames (legacy at 38.8kn = ${(1 / legacyDrop(38.79)).toFixed(1)})`);
    expect(shortest).toBeGreaterThan(2.5);
  });

  it('the two shader stages agree on the size curve (drift here IS a density bug)', () => {
    // Monotone default: BOTH stages carry the flat 3.073 floor AND the legacy ramp behind the
    // same u_size_monotonic switch — the ramp literal must survive for the kill path.
    expect(ADVECT_FS).toMatch(/u_size_monotonic\s*>\s*0\.5\s*\?\s*3\.073/);
    expect(DRAW_VS).toMatch(/u_size_monotonic\s*>\s*0\.5\s*\?\s*3\.073/);
    expect(ADVECT_FS).toMatch(/mix\(3\.4,\s*4\.2,\s*smoothstep\(10\.0,\s*1\.0,\s*speed\)\)/);
    expect(DRAW_VS).toMatch(/mix\(3\.4,\s*4\.2,\s*slowness\)/);
    // both stages must gate on the SAME speed band
    expect(ADVECT_FS).toMatch(/speed\s*>=\s*1\.0\s*&&\s*speed\s*<\s*10\.0/);
    expect(DRAW_VS).toMatch(/v_speed\s*>=\s*1\.0\s*&&\s*v_speed\s*<\s*10\.0/);
    expect(ADVECT_FS).toMatch(/\/\s*130\.0/);   // I0 mirrored above
  });

  it('the shader implements it behind a kill switch', () => {
    expect(ADVECT_FS).toMatch(/uniform\s+float\s+u_density_uniform\s*;/);
    expect(ADVECT_FS).toMatch(/mix\(legacyDrop,\s*max\(legacyDrop,\s*inkFlatDrop\),\s*u_density_uniform\)/);
  });

  it('density is THEME-INVARIANT — ADVECT_FS must never take a theme input', () => {
    // Density is physical, not stylistic: the three themes must agree about how much air there is.
    // beach/light/dark differ in COLOUR only.
    expect(ADVECT_FS).not.toMatch(/u_theme/);
  });
});
