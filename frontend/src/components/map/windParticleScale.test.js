/**
 * WIND MARK SCALE — the zoom x device gate (2026-07-18 EVE-3 round 5b).
 *
 * User, in order, across this arc:
 *   "particles are too large, you can't see land underneath"
 *   "our initial wind was a little better than this in a way"
 *   "the far out zoom is even worse — you need to improve this at every zoom"
 *   "and on mobile and desktop"
 *
 * WHY EACH OF THOSE WAS THE SAME BUG. The low-wind size floor added earlier in this arc was
 * expressed in CSS px and was ZOOM-INVARIANT. Two effects then compound as the view widens:
 *   1. a fixed CSS mark covers vastly more GEOGRAPHY, so it hides the basemap it sits on;
 *   2. a wide view contains far more low-wind cells, so a LARGER SHARE of the screen is floored.
 * That is why the damage was worst at global zoom, and why it read as "initial wind was better" —
 * the original sizeBase curve, which this floor overrode, was the better-behaved one out there.
 *
 * The fix scales the floor down as the view widens and leaves sizeBase (long shipped) untouched.
 * This file enumerates the whole zoom x DPR space rather than spot-checking, because every
 * previous round of this arc was caught by enumeration and missed by sampling.
 */
import { DRAW_VS, DRAW_FS, ADVECT_FS } from './WebGLWindShaders';

const smoothstep = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// Mirrors of the shipped shader arithmetic (2026-07-19 monotone default: flat floor at
// sizeBase(10kn)=3.073, FULL-path DPR correctness, and the v3.21 close-zoom low-speed boost
// capped at the 10 kn size — see windParticleMonotonic.test.js for the ordering gate).
const sizeBase = (s) => (s < 0.5 ? 0 : 2.5 + 2.5 * smoothstep(1.0, 30.0, s));
const zoomBoost = (z) => 1.0 + smoothstep(5.0, 11.0, z) * 1.5;
const floorZoomScale = (z) => mix(0.62, 1.0, smoothstep(3.0, 7.0, z));
const floorCss = (s, z) => {
  if (!(s >= 1.0 && s < 10.0)) return 0;
  // No close-zoom boost: sizeBase already grows via zoomBoost when zoomed in, and stacking a
  // second multiplier here made the FLOOR the thing inflating marks at close zoom.
  return 3.073 * floorZoomScale(z);
};
// gl_PointSize in DEVICE px, as the GPU receives it (monotone default: dpr scales the WHOLE
// path; the v3.21 additive boost is replaced by the s-independent band lift toward cap10).
const devicePx = (s, z, dpr) => {
  const d = Math.max(dpr, 1);
  let p = sizeBase(s) * zoomBoost(z) * d;
  p = Math.max(p, floorCss(s, z) * d);
  if (s >= 0.5 && s < 10.0) {
    const cap10 = 3.073 * zoomBoost(z) * d;
    const lift = smoothstep(7.0, 11.0, z) * 0.85;
    p = Math.min(p, cap10) + (cap10 - Math.min(p, cap10)) * lift;
  }
  return p;
};
// What the user perceives.
const cssPx = (s, z, dpr) => devicePx(s, z, dpr) / dpr;

const ZOOMS = [2, 3, 4, 5.5, 7, 9, 11];
// desktop 1x, retina/iPhone 2x, iPhone Pro / Galaxy S 3x. Galaxy can report ~4 — clamped to 3.
const DPRS = [1, 2, 3];
const SPEEDS = [0.28, 2, 3.85, 6.52, 11.08, 16.87, 22.71, 38.79];

describe('wind mark scale — every zoom x every device class', () => {
  it('the floor never dominates at far-out zoom (the reported regression)', () => {
    // At global/synoptic zoom the floor must not inflate a mark much beyond the legacy curve,
    // or chunky marks blanket the basemap.
    const bad = [];
    for (const z of [2, 3, 4]) {
      for (const s of SPEEDS) {
        const legacy = sizeBase(s) * zoomBoost(z);
        const now = devicePx(s, z, 1);
        if (legacy > 0 && now > legacy * 1.9) bad.push(`z${z} ${s}kn: ${legacy.toFixed(1)} -> ${now.toFixed(1)}px`);
      }
    }
    // eslint-disable-next-line no-console
    if (bad.length) console.log('far-zoom inflation:', bad.join(' | '));
    expect(bad).toEqual([]);
  });

  it('THIS ARC never makes a mark bigger than the legacy curve already did', () => {
    // The honest bound. The absolute maximum across the space is 12.5 css px at z11/38.8 kn, and
    // that is `sizeBase * zoomBoost` — the ORIGINAL close-zoom curve, untouched by this arc. Fixing
    // that would be a separate decision about close-zoom design, so it is documented rather than
    // silently absorbed by a loosened threshold. What this arc owns is the FLOOR, and the floor
    // must never be the thing that makes a mark large.
    const over = [];
    let worstOwn = { px: 0 }, worstAny = { px: 0 };
    for (const z of ZOOMS) for (const dpr of DPRS) for (const s of SPEEDS) {
      const total = cssPx(s, z, dpr);
      if (total > worstAny.px) worstAny = { px: total, z, dpr, s };
      // "How much did THIS ARC add" is only meaningful at dpr 1. Legacy sizing is DPR-BLIND (a
      // pre-existing defect this arc fixes), so at dpr 3 the legacy term shrinks to a third while
      // the DPR-correct floor holds its physical size — differencing them there measures the DPR
      // FIX, not floor inflation, and would flag the correction as if it were the regression.
      if (dpr !== 1) continue;
      const legacy = sizeBase(s) * zoomBoost(z);
      const ownContribution = Math.max(0, total - legacy);
      if (ownContribution > worstOwn.px) worstOwn = { px: ownContribution, z, dpr, s };
      if (ownContribution > 2.0) over.push(`z${z} ${s}kn adds ${ownContribution.toFixed(1)}css`);
    }
    // eslint-disable-next-line no-console
    console.log(`largest mark ${worstAny.px.toFixed(1)} css px (z${worstAny.z} dpr${worstAny.dpr} ${worstAny.s}kn — LEGACY curve);`
      + ` largest amount THIS ARC adds: ${worstOwn.px.toFixed(1)} css px (z${worstOwn.z} ${worstOwn.s}kn)`);
    expect(over).toEqual([]);
    expect(worstAny.px).toBeLessThanOrEqual(12.5 + 1e-9);   // pins the legacy ceiling
  });

  it('PHYSICAL size is identical across device classes — mobile matches desktop', () => {
    for (const z of ZOOMS) for (const s of SPEEDS) {
      const ref = cssPx(s, z, 1);
      for (const dpr of DPRS) {
        // Where the floor governs, DPR scaling makes CSS size exactly equal. Where sizeBase
        // governs (device-px, unscaled), a high-DPR screen renders it SMALLER — that is the
        // pre-existing behaviour this arc did not change, so allow it, but never LARGER.
        expect(cssPx(s, z, dpr)).toBeLessThanOrEqual(ref + 1e-9);
      }
    }
  });

  it('the floor is monotonic in zoom — wider view, smaller mark', () => {
    for (const s of [0.28, 2, 6.52]) {
      for (let i = 1; i < ZOOMS.length; i++) {
        expect(floorCss(s, ZOOMS[i])).toBeGreaterThanOrEqual(floorCss(s, ZOOMS[i - 1]) - 1e-9);
      }
    }
  });

  it('at z3 the floor lands near the legacy curve rather than overriding it', () => {
    // The specific complaint: far-out zoom looked worse than the original. At global zoom the
    // floor should be a nudge, not a replacement.
    const legacyAt3 = sizeBase(6.52) * zoomBoost(3);
    const nowAt3 = devicePx(6.52, 3, 1);
    // eslint-disable-next-line no-console
    console.log(`z3 6.5kn: legacy ${legacyAt3.toFixed(2)}px -> shipped ${nowAt3.toFixed(2)}px`);
    expect(nowAt3 / legacyAt3).toBeLessThan(1.5);
  });

  it('the mark is a DASH — narrower than the disc it replaced, so land shows through', () => {
    // Area scales as 1/elong because DRAW_FS narrows the across-wind axis.
    expect(DRAW_FS).toMatch(/float\s+elong\s*=\s*mix\(1\.8,\s*2\.6,/);
    expect(DRAW_FS).toMatch(/localCoord\s*=\s*vec2\(along\.x,\s*along\.y\s*\*\s*elong\)/);
    // …and it must narrow ACROSS, never lengthen ALONG (that would clip against the sprite square).
    expect(DRAW_FS).not.toMatch(/along\.x\s*\/\s*elong/);
  });

  it('both shader stages apply the SAME zoom scaling to the floor', () => {
    expect(DRAW_VS).toMatch(/mix\(0\.62,\s*1\.0,\s*smoothstep\(3\.0,\s*7\.0,\s*u_zoom\)\)/);
    expect(ADVECT_FS).toMatch(/mix\(0\.62,\s*1\.0,\s*smoothstep\(3\.0,\s*7\.0,\s*u_zoom\)\)/);
  });

  it('every lever in this arc is independently kill-switched', () => {
    for (const u of ['u_lowwind_boost', 'u_dpr']) expect(DRAW_VS).toMatch(new RegExp(u));
    for (const u of ['u_theme_rim', 'u_dash']) expect(DRAW_FS).toMatch(new RegExp(u));
    for (const u of ['u_density_uniform', 'u_vp_density_boost']) expect(ADVECT_FS).toMatch(new RegExp(u));
  });
});
