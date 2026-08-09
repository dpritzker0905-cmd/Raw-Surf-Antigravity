/**
 * The wind legend is DERIVED from the shipped ramp, not copied (2026-08-09, R11-11 item 2).
 *
 * MapWeatherControls carried a hand-maintained CSS gradient per theme. Measured at HEAD, its dark
 * gradient was a BYTE-EXACT copy of the legacy 8-stop 0-50 kn `DEFAULT_WIND_RAMP`:
 *
 *     [0,  .60,.85,1.00, .85]  ->  rgba(153,217,255,0.85)
 *     [12, .10,.98,.80, .92]  ->  rgba(26,250,204,0.92)
 *     [50, 1.00,.80,.90, .95] ->  rgba(255,204,230,0.95)      ... all 8 matched
 *
 * — while `DEFAULT_WIND_RAMP = DARK_WIND_RAMP` (13 Beaufort stops to 75 kn) had replaced it. Its
 * comment claimed "Gradient matches WindColorRamp.js stops" and had not for weeks.
 *
 * ★★★ The consequence was an INVERTED READING, not a cosmetic drift: the shipped dark ramp paints
 * CALM as vivid magenta (0.90, 0.00, 1.00), and magenta on the stale legend sat at the far-right
 * HURRICANE end. These tests make the legend structurally incapable of disagreeing with the ramp.
 */
import { THEME_RAMPS, resolveThemeRamp, windLegendGradientCSS, windLegendStops } from '../components/map/WindColorRamp';

const THEMES = ['dark', 'light', 'beach'];

describe('wind legend is derived from the shipped ramp', () => {
  it.each(THEMES)('%s: every ramp stop appears in the gradient, at its value-proportional position', (theme) => {
    const ramp = resolveThemeRamp(theme);
    const css = windLegendGradientCSS(theme);
    const max = ramp[ramp.length - 1][0];
    for (const s of ramp) {
      const rgba = `rgba(${Math.round(s[1] * 255)},${Math.round(s[2] * 255)},${Math.round(s[3] * 255)},${s[4]})`;
      const pct = `${((s[0] / max) * 100).toFixed(1)}%`;
      expect(css).toContain(`${rgba} ${pct}`);
    }
    // one CSS stop per ramp stop — no invented colours, none dropped
    expect(css.split('rgba(').length - 1).toBe(ramp.length);
  });

  it.each(THEMES)('%s: the legend covers the ramp\'s full range, not the legacy 50 kn cap', (theme) => {
    const ramp = resolveThemeRamp(theme);
    expect(ramp[ramp.length - 1][0]).toBeGreaterThanOrEqual(75);
    const stops = windLegendStops(theme);
    expect(stops[stops.length - 1]).toBe(`${ramp[ramp.length - 1][0]}+`);
    expect(stops[0]).toBe('0');
  });

  it('tick labels sit at EQUAL VALUE intervals (the row is justify-between)', () => {
    // ⛔ The old list was ['0','5','15','30','50+'] — unequal values under equal on-screen spacing,
    // so every interior label sat over the wrong colour (R11-11 item 3).
    const stops = windLegendStops('dark').map((s) => parseInt(s, 10));
    const gaps = stops.slice(1).map((v, i) => v - stops[i]);
    expect(new Set(gaps).size).toBe(1);
  });

  it('⛔ the legend no longer describes the LEGACY 8-stop 0-50 ramp', () => {
    // The exact first and last colours of the pre-Beaufort table. If either reappears at the
    // legend's ends, someone has re-pasted the old palette.
    const css = windLegendGradientCSS('dark');
    expect(css).not.toContain('rgba(153,217,255,0.85) 0.0%');   // legacy calm: ice-blue
    expect(css).not.toContain('rgba(255,204,230,0.95) 100.0%'); // legacy 50 kn terminal
  });

  it('CHARACTERISATION: how far calm sits from hurricane in each shipped ramp', () => {
    // The defect that motivated this file was calm's colour appearing where the legend claimed
    // hurricane, so "are the ends distinguishable?" is worth knowing. It is NOT a pass/fail
    // threshold: these ramps advance hue monotonically AROUND A WHEEL, and a wheel wraps — ends
    // meeting is the design, not a bug. Measured 2026-08-09 (L1 distance in unit RGB):
    //     dark  0.90  (vivid magenta -> white-magenta)
    //     light 0.63  (electric violet -> deep violet)
    //     beach 0.34  (hot pink -> magenta)   <- the tightest by 2x
    // ⚠️ BEACH IS THE ONE TO WATCH: at 0.34 its calm and hurricane bands are near-neighbours, so
    // the legend is the only thing telling a beach-theme user which end they are looking at. That
    // makes the derivation above load-bearing for beach in a way it is not for dark. Pinned so a
    // palette edit that tightens it further has to change this number deliberately.
    const dist = {};
    for (const theme of THEMES) {
      const ramp = resolveThemeRamp(theme);
      const [, r0, g0, b0] = ramp[0];
      const [, r1, g1, b1] = ramp[ramp.length - 1];
      dist[theme] = +(Math.abs(r0 - r1) + Math.abs(g0 - g1) + Math.abs(b0 - b1)).toFixed(2);
    }
    expect(dist).toEqual({ dark: 0.9, light: 0.63, beach: 0.34 });
  });

  it('every theme has a ramp (no silent fallback to the default table)', () => {
    for (const theme of THEMES) expect(THEME_RAMPS[theme]).toBeDefined();
  });
});
