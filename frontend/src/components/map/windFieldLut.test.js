/**
 * WIND FIELD == PARTICLE LUT (2026-07-19 — the palette split).
 *
 * User: "The wind speed color map needs to have a longer range of spectrum to give more
 * sensitive details on wind speeds."
 *
 * THE ROOT: round 3 (974a8b46) Beaufort-anchored the PARTICLE LUT (13 stops in knots), but
 * HEATMAP_FS kept its own inline 7-stop ramp keyed to FRACTIONS of the data max. Consequences:
 *   - the field's hues stretched with whatever max the grid happened to carry — a calm Gulf
 *     (max ~39 kn) collapsed the 0-21 kn band into ~1.5 hue bands: the "flat wash";
 *   - field colour != LUT colour, so DRAW_FS's composited-background casing math (round 6) was
 *     modelling a background that was not on screen — and windParticleContrast.test.js has been
 *     computing the field FROM the LUT all along. The gate was right; the shader was wrong.
 *
 * THE FIX: the heatmap samples the SAME LUT texture. One palette everywhere; the 0-21 kn band
 * (where nearly all weather lives) regains ~6 named Beaufort hue bands in every theme.
 * Kill: __RAW_DISABLE_WIND_FIELD_LUT__ -> the legacy inline ramp (kept in the shader).
 */
import { HEATMAP_FS } from './WebGLWindShaders';
import { THEME_RAMPS, sampleRamp } from './WindColorRamp';

const rgbToHueDeg = ([r, g, b]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  let h;
  if (mx === r) h = ((g - b) / (mx - mn)) % 6;
  else if (mx === g) h = (b - r) / (mx - mn) + 2;
  else h = (r - g) / (mx - mn) + 4;
  return ((h * 60) + 360) % 360;
};

describe('wind field samples the Beaufort LUT (one palette everywhere)', () => {
  it('HEATMAP_FS samples u_color_ramp behind the kill switch, legacy ramp retained', () => {
    expect(HEATMAP_FS).toMatch(/uniform\s+sampler2D\s+u_color_ramp\s*;/);
    expect(HEATMAP_FS).toMatch(/uniform\s+float\s+u_field_lut\s*;/);
    expect(HEATMAP_FS).toMatch(/u_field_lut\s*>\s*0\.5[\s\S]*texture2D\(u_color_ramp,\s*vec2\(t,\s*0\.5\)\)/);
    // the legacy inline ramp must survive for the kill path
    expect(HEATMAP_FS).toMatch(/vec3\s+ramp\(float\s+t,\s*float\s+theme\)/);
    expect(HEATMAP_FS).toMatch(/:\s*ramp\(t,\s*u_theme\)/);
    // the alpha contract is UNCHANGED — field transparency is a separately tuned surface that
    // the contrast gate's composite model depends on
    expect(HEATMAP_FS).toMatch(/u_opacity\s*\*\s*\(baseAlpha\s*\+\s*\(1\.0\s*-\s*baseAlpha\)\s*\*\s*smoothstep\(0\.0,\s*10\.0,\s*speed\)\)/);
  });

  it('SPECTRAL SENSITIVITY: every theme traverses substantial hue distance across 0-21 kn', () => {
    // The quantified version of the user's ask. Cumulative hue-path over the Beaufort stops at
    // 0/3/6/10/16/21 kn — the common range must span real spectrum, not one wash.
    for (const theme of ['dark', 'light', 'beach']) {
      const ramp = THEME_RAMPS[theme];
      const speeds = [0, 3, 6, 10, 16, 21];
      let path = 0;
      for (let i = 1; i < speeds.length; i++) {
        const a = rgbToHueDeg(sampleRamp(ramp, speeds[i - 1]));
        const b = rgbToHueDeg(sampleRamp(ramp, speeds[i]));
        let d = Math.abs(b - a);
        if (d > 180) d = 360 - d;
        path += d;
      }
      // eslint-disable-next-line no-console
      console.log(`${theme}: 0-21kn cumulative hue path ${path.toFixed(0)} deg`);
      expect(path).toBeGreaterThan(60);
    }
  });

  it('adjacent low-band HUE GAPS are >= 18 deg in every theme (the slow-wind sensitivity pin)', () => {
    // 2026-07-19: dark's 0-3-6 kn gaps measured 12/10/11 deg — one cyan family. The spread
    // redistributed the low stops; this pin stops them drifting back together.
    for (const theme of ['dark', 'light', 'beach']) {
      const ramp = THEME_RAMPS[theme];
      for (let i = 1; i < ramp.length && ramp[i][0] <= 21; i++) {
        const a = rgbToHueDeg([ramp[i - 1][1], ramp[i - 1][2], ramp[i - 1][3]]);
        const b = rgbToHueDeg([ramp[i][1], ramp[i][2], ramp[i][3]]);
        let d = Math.abs(b - a);
        if (d > 180) d = 360 - d;
        expect(d).toBeGreaterThanOrEqual(18);
      }
    }
  });

  it('adjacent low-band stops stay DISTINGUISHABLE in every theme (no two stops collapse)', () => {
    for (const theme of ['dark', 'light', 'beach']) {
      const ramp = THEME_RAMPS[theme];
      for (let i = 1; i < ramp.length && ramp[i][0] <= 27; i++) {
        const [/* kn */, r1, g1, b1] = ramp[i - 1];
        const [/* kn */, r2, g2, b2] = ramp[i];
        const dist = Math.hypot(r2 - r1, g2 - g1, b2 - b1);
        expect(dist).toBeGreaterThan(0.08);
      }
    }
  });

  it('the LUT stays Beaufort-anchored (stops are named force boundaries in knots)', () => {
    const BEAUFORT = [0, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63, 75];
    for (const theme of ['dark', 'light', 'beach']) {
      expect(THEME_RAMPS[theme].map((s) => s[0])).toEqual(BEAUFORT);
    }
  });
});
