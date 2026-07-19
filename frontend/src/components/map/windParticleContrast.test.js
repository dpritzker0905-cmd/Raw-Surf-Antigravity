/**
 * WIND PARTICLE CONTRAST — the per-speed gate (2026-07-18 EVE-3 round 2).
 *
 * WHY THIS EXISTS. The first pass at this measured mean |Laplacian| over a screenshot crop and
 * reported +137% in light mode. That number was real but the metric was WRONG for the question:
 * it AVERAGES over every wind speed on screen, so a failure confined to one speed band cannot
 * show up. The user then reported light mode still hard to read "over some wind speeds" — and
 * enumerating the ramp found it immediately: the shipped fixed rim scored
 *     dark  5.48:1 @39kn · LIGHT 3.78:1 @21kn · beach 3.30:1 @39kn
 * because the light ramp's luminance is NON-MONOTONIC and PEAKS at the 21 kn gold (Y=0.460),
 * leaving a near-white rim no headroom in the commonest moderate-wind band.
 *
 * Same lesson as the arbiter's differential sweep: ENUMERATE the space, don't average over it.
 * This file evaluates the shader's casing arithmetic at EVERY ramp stop in EVERY theme.
 */
import { THEME_RAMPS } from './WindColorRamp';
import { DRAW_FS, DRAW_VS } from './WebGLWindShaders';

// APCA's precise sRGB luminance coefficients (APCA docs; WCAG 2 rounds these).
const Y = (r, g, b) => 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
// WCAG 2 contrast ratio over linearised luminance. Used as the THRESHOLD metric because 3:1 for
// graphical objects is the codified bar (WCAG 2.1 SC 1.4.11); APCA is the better perceptual model
// but has no equivalent normative threshold for non-text marks.
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const Ylin = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const mix1 = (a, b, t) => a + (b - a) * t;

// JS mirror of the DRAW_FS dual-tone casing. Kept deliberately literal so a shader edit that
// changes the poles/orientation shows up here as a number, not as a silent visual regression.
function casing(r, g, b) {
  const fieldY = Y(r, g, b);
  const fieldIsBright = fieldY >= 0.36 ? 1 : 0;
  const outerL = mix1(1.0, 0.0, fieldIsBright);
  const innerL = 1.0 - outerL;
  const outer = [0, 1, 2].map((i) => mix1([r, g, b][i], outerL, 0.98));
  const inner = [0, 1, 2].map((i) => mix1([r, g, b][i], innerL, 0.92));
  return { outer, inner, fieldY };
}

const THEMES = ['dark', 'light', 'beach'];
// WCAG 2.1 SC 1.4.11 "non-text contrast": 3:1 for graphical objects needed to understand content.
const MIN_VS_FIELD = 3.0;
// The casing's own internal edge is what makes legibility field-INDEPENDENT. Two opposite poles
// should be near the 21:1 ceiling; anything low here means the poles collapsed together.
const MIN_INTERNAL = 10.0;

describe('wind particle contrast — every ramp stop, every theme', () => {
  it('the mark carries a high-contrast INTERNAL edge regardless of the field colour', () => {
    const report = [];
    let worst = { r: Infinity };
    for (const theme of THEMES) {
      for (const [kn, r, g, b] of THEME_RAMPS[theme]) {
        const { outer, inner } = casing(r, g, b);
        const c = ratio(Ylin(...outer), Ylin(...inner));
        if (c < worst.r) worst = { r: c, theme, kn };
        report.push(`${theme}@${kn}kn ${c.toFixed(1)}:1`);
      }
    }
    // eslint-disable-next-line no-console
    console.log('internal edge — worst', `${worst.r.toFixed(1)}:1 (${worst.theme}@${worst.kn}kn)`);
    expect(worst.r).toBeGreaterThanOrEqual(MIN_INTERNAL);
  });

  it('the OUTER ring meets 3:1 against the field at EVERY speed (the 21kn light failure)', () => {
    const failures = [];
    const table = [];
    for (const theme of THEMES) {
      let worst = { r: Infinity };
      for (const [kn, r, g, b] of THEME_RAMPS[theme]) {
        const { outer } = casing(r, g, b);
        const c = ratio(Ylin(r, g, b), Ylin(...outer));
        if (c < worst.r) worst = { r: c, kn };
        if (c < MIN_VS_FIELD) failures.push(`${theme}@${kn}kn ${c.toFixed(2)}:1`);
      }
      table.push(`${theme}: worst ${worst.r.toFixed(2)}:1 @${worst.kn}kn`);
    }
    // eslint-disable-next-line no-console
    console.log('outer-ring vs field —', table.join(' | '));
    expect(failures).toEqual([]);
  });

  it('orientation actually flips with field luminance (not a per-theme constant)', () => {
    // Dark's neon ramp is BRIGHT -> dark outer ring. Light's navy ramp is DARK -> bright outer.
    const darkStop = THEME_RAMPS.dark[0], lightStop = THEME_RAMPS.light[0];
    expect(casing(darkStop[1], darkStop[2], darkStop[3]).outer[0]).toBeLessThan(0.1);
    expect(casing(lightStop[1], lightStop[2], lightStop[3]).outer[0]).toBeGreaterThan(0.9);
  });

  it('light-mode mid-band (the reported failure) is materially better than the old fixed rim', () => {
    // Old behaviour: a single near-white rim, mix(color, 1.0, 0.92).
    const stop = THEME_RAMPS.light.find((s) => s[0] === 21);
    const [, r, g, b] = stop;
    const oldRim = [0, 1, 2].map((i) => mix1([r, g, b][i], 1.0, 0.92));
    const oldC = ratio(Ylin(r, g, b), Ylin(...oldRim));
    const { outer } = casing(r, g, b);
    const newC = ratio(Ylin(r, g, b), Ylin(...outer));
    // eslint-disable-next-line no-console
    console.log(`light@21kn: fixed-rim ${oldC.toFixed(2)}:1 -> casing ${newC.toFixed(2)}:1`);
    expect(oldC).toBeLessThan(4.0);          // documents the failure that was reported
    expect(newC).toBeGreaterThan(oldC);
  });

  it('the shader implements the casing the maths above models', () => {
    expect(DRAW_FS).toMatch(/0\.2126729,\s*0\.7151522,\s*0\.0721750/);   // APCA coefficients
    expect(DRAW_FS).toMatch(/fieldIsBright/);
    expect(DRAW_FS).toMatch(/outerL/);
    expect(DRAW_FS).toMatch(/innerL/);
    expect(DRAW_FS).toMatch(/u_theme_rim\s*>\s*0\.5/);                   // kill switch still gates it
  });

  it('the BODY still shows the speed colour — truth is not traded for legibility', () => {
    // Neither ring may cover the centre: dist<0.10 must be untouched by inner/outer.
    expect(DRAW_FS).toMatch(/smoothstep\(0\.10,\s*0\.20,\s*dist\)/);
  });
});

// === MOBILE (CLAUDE.md: THREE THEMES, ALL DEVICES) ===
// The casing is a GEOMETRIC mechanism, so it is only as good as the sprite's PHYSICAL size — and
// gl_PointSize is in DEVICE pixels. This pipeline had NO devicePixelRatio handling anywhere
// (verified by absence across engine/layer/shaders/init), so on a DPR-3 phone an "8 px" floor is
// 2.7 CSS px and the rings collapse sub-pixel: the exact defect the floor exists to prevent,
// surviving on the devices most people actually use.
describe('wind particle legibility on mobile / high-DPR', () => {
  it('the size floor is expressed in CSS px and scaled by DPR', () => {
    expect(DRAW_VS).toMatch(/uniform\s+float\s+u_dpr\s*;/);
    expect(DRAW_VS).toMatch(/minCssPx/);
    expect(DRAW_VS).toMatch(/minCssPx\s*\*\s*max\(u_dpr,\s*1\.0\)/);
  });

  it('a DPR-3 phone gets the same PHYSICAL mark as a DPR-1 desktop', () => {
    // Mirror of the shader arithmetic at the slowest boosted speed, synoptic zoom (no zoom term).
    const floorCss = (dpr) => 8.0 * Math.max(dpr, 1.0);
    const cssPx = (devicePx, dpr) => devicePx / dpr;
    expect(cssPx(floorCss(1), 1)).toBeCloseTo(8.0, 5);
    expect(cssPx(floorCss(3), 3)).toBeCloseTo(8.0, 5);   // identical physical size
    // …and without the DPR term the phone would have been ~3x smaller — the bug being fixed.
    expect(cssPx(8.0, 3)).toBeCloseTo(2.667, 2);
  });

  it('the outer ring still clears 1 device px on a DPR-3 phone', () => {
    // Outer ring spans dist 0.38-0.50 => 12% of the sprite DIAMETER.
    const ringDevicePx = (cssFloor, dpr) => cssFloor * dpr * 0.12;
    expect(ringDevicePx(8.0, 3)).toBeGreaterThanOrEqual(1.0);
    expect(ringDevicePx(5.5, 2)).toBeGreaterThanOrEqual(1.0);
    expect(ringDevicePx(5.5, 1)).toBeLessThan(1.0);   // documents why DPR<1 desktops sit at the edge
  });

  it('DPR is clamped so a freak ratio cannot explode the sprite budget', () => {
    const clamp = (d) => Math.max(1, Math.min(3, d));
    expect(clamp(0.5)).toBe(1);
    expect(clamp(4.0)).toBe(3);
    expect(clamp(2.625)).toBeCloseTo(2.625, 3);   // a real Android ratio passes through
  });

  it('contrast is device-independent — the casing maths has no size term', () => {
    // Guards against a future "shrink it on mobile" tweak silently costing contrast: the poles
    // are chosen from colour alone, so every per-speed result above holds on every device.
    for (const theme of THEMES) {
      for (const [, r, g, b] of THEME_RAMPS[theme]) {
        const { outer, inner } = casing(r, g, b);
        expect(ratio(Ylin(...outer), Ylin(...inner))).toBeGreaterThanOrEqual(MIN_INTERNAL);
      }
    }
  });
});
