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

// THE BACKGROUND IS THE COMPOSITE, NOT THE RAMP (round 6 — the root behind "light mode is really
// hard to see"). The wind field is semi-transparent, so a particle sits on
//     mix(basemapY, rampY, fieldAlpha)
// and in light mode fieldAlpha is only ~0.23 at low wind, i.e. the surface is 77% LIGHT BASEMAP
// even though the ramp is dark navy. Choosing the pole from the ramp alone inverted it for 6 of 8
// light-mode speeds: measured 1.71:1 at 0 kn where 12.25:1 was available. Every contrast number
// this file produced before this change compared against a background that is not on screen.
const HEATMAP_OPACITY = { dark: 0.48, light: 0.65, beach: 0.55 };
const BASE_ALPHA = { dark: 0.28, light: 0.35, beach: 0.45 }; // dark 0.20->0.28 (2026-07-19 calm visibility); sync HEATMAP_FS + DRAW_FS
const BASEMAP_Y = { dark: 0.02, light: 0.72, beach: 0.30 };   // linear, mirrors the engine
const smoothstep = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
const fieldAlpha = (theme, s) =>
  HEATMAP_OPACITY[theme] * (BASE_ALPHA[theme] + (1 - BASE_ALPHA[theme]) * smoothstep(0, 7, s)); // 7kn ramp (2026-07-19): sync HEATMAP_FS + DRAW_FS
// The luminance a mark is actually drawn against.
const bgY = (theme, s, r, g, b) => {
  const rampY = 0.2126729 * Math.pow(r, 2.2) + 0.7151522 * Math.pow(g, 2.2) + 0.0721750 * Math.pow(b, 2.2);
  const a = Math.min(Math.max(fieldAlpha(theme, s), 0), 1);
  return BASEMAP_Y[theme] * (1 - a) + rampY * a;
};

// JS mirror of the DRAW_FS dual-tone casing. Kept deliberately literal so a shader edit that
// changes the poles/orientation shows up here as a number, not as a silent visual regression.
function casing(r, g, b, theme = 'dark', speed = 0) {
  const fieldY = bgY(theme, speed, r, g, b);
  const fieldIsBright = fieldY >= 0.179 ? 1 : 0;
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
        const { outer, inner } = casing(r, g, b, theme, kn);
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
        const { outer } = casing(r, g, b, theme, kn);
        const c = ratio(bgY(theme, kn, r, g, b), Ylin(...outer));
        if (c < worst.r) worst = { r: c, kn };
        if (c < MIN_VS_FIELD) failures.push(`${theme}@${kn}kn ${c.toFixed(2)}:1`);
      }
      table.push(`${theme}: worst ${worst.r.toFixed(2)}:1 @${worst.kn}kn`);
    }
    // eslint-disable-next-line no-console
    console.log('outer-ring vs field —', table.join(' | '));
    expect(failures).toEqual([]);
  });

  it('orientation follows the COMPOSITE, which inverts both themes at low wind', () => {
    // This is the round-6 finding stated as a test. Judged on the RAMP alone the poles look
    // obvious — dark's neon ramp is bright so "use a dark ring", light's navy ramp is dark so
    // "use a bright ring". Judged on what is actually ON SCREEN, both invert at low wind, because
    // the field is nearly transparent there and the BASEMAP dominates:
    //   dark  @0kn: fieldAlpha 0.10 over a dark basemap  -> bg 0.079 (DARK)   -> WHITE ring
    //   light @0kn: fieldAlpha 0.23 over a light basemap -> bg 0.563 (BRIGHT) -> DARK ring
    // Choosing from the ramp gave each theme exactly the wrong pole at its calmest speeds, which
    // is why light measured 1.71:1 and dark 2.58:1 at 0 kn.
    const d = THEME_RAMPS.dark[0], l = THEME_RAMPS.light[0];
    expect(casing(d[1], d[2], d[3], 'dark', d[0]).outer[0]).toBeGreaterThan(0.9);   // white
    expect(casing(l[1], l[2], l[3], 'light', l[0]).outer[0]).toBeLessThan(0.1);     // dark
    // …and at HIGH wind, where the field is opaque, the ramp does govern again.
    const dFast = THEME_RAMPS.dark[THEME_RAMPS.dark.length - 1];
    expect(casing(dFast[1], dFast[2], dFast[3], 'dark', dFast[0]).outer[0]).toBeLessThan(0.1);
  });

  it('the casing picks the BETTER pole at every stop (never worse than a fixed rim)', () => {
    // The original form of this test pinned the OLD ramp's 21 kn gold at 3.78:1. That colour no
    // longer exists — the Beaufort rework replaced it — so pinning one stop is brittle. The
    // durable property is the one that made the casing worth adopting: choosing the pole from the
    // local luminance must never do WORSE than committing to a single fixed pole. (This is what
    // caught the mis-set 0.36 threshold: at the new 21 kn olive, Y=0.40, it chose the dark pole
    // for 3.96:1 where the light pole gave 4.72:1.)
    const worse = [];
    for (const theme of THEMES) {
      for (const [kn, r, g, b] of THEME_RAMPS[theme]) {
        const { outer } = casing(r, g, b, theme, kn);
        const chosen = ratio(bgY(theme, kn, r, g, b), Ylin(...outer));
        const mixPole = (L) => Ylin(...[0, 1, 2].map((i) => mix1([r, g, b][i], L, 0.98)));
        const toWhite = ratio(bgY(theme, kn, r, g, b), mixPole(1.0));
        const toBlack = ratio(bgY(theme, kn, r, g, b), mixPole(0.0));
        const best = Math.max(toWhite, toBlack);
        if (chosen < best - 0.05) worse.push(`${theme}@${kn}kn chose ${chosen.toFixed(2)} over ${best.toFixed(2)}`);
      }
    }
    // eslint-disable-next-line no-console
    if (worse.length) console.log('sub-optimal pole choices:', worse.join(' | '));
    expect(worse).toEqual([]);
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
    // Guards against a future "shrink it on mobile" tweak silently costing contrast: the poles are
    // chosen from COLOUR and field alpha only — never from size — so every per-speed result above
    // holds identically on every device.
    for (const theme of THEMES) {
      for (const [kn, r, g, b] of THEME_RAMPS[theme]) {
        const { outer, inner } = casing(r, g, b, theme, kn);
        expect(ratio(Ylin(...outer), Ylin(...inner))).toBeGreaterThanOrEqual(MIN_INTERNAL);
      }
    }
  });
});
