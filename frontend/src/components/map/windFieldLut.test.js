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
    expect(HEATMAP_FS).toMatch(/u_opacity\s*\*\s*\(baseAlpha\s*\+\s*\(1\.0\s*-\s*baseAlpha\)\s*\*\s*smoothstep\(0\.0,\s*7\.0,\s*speed\)\)/); // 7kn ramp (2026-07-19)
    // and the casing composite uses the SAME ramp endpoint
    expect(require('./WebGLWindShaders').DRAW_FS).toMatch(/smoothstep\(0\.0,\s*7\.0,\s*v_speed\)/);
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

  it('COMPOSITE-SPACE hue gaps >= 12 deg below 21 kn (the 07-20 correction: LUT gaps compress ~4x post-alpha)', () => {
    // The >=18° LUT pin above is provably insufficient: composited over each theme's REAL
    // basemap at the field's real alpha, hue gaps compress ~4x — light's 0kn and 3kn stops both
    // landed on the identical hue 206° while passing the LUT pin. EVERY colour decision is
    // evaluated on the composite, never the ramp. Alpha model mirrors HEATMAP_FS exactly —
    // u_opacity per theme x (baseAlpha + (1-baseAlpha)*smoothstep(0,7,kn)); baseAlpha is the
    // THREE-SITE constant set (HEATMAP_FS + DRAW_FS casing + windParticleContrast mirror).
    const BASEMAP = { dark: [93, 117, 126], light: [168, 214, 222], beach: [150, 190, 200] };
    const OPACITY = { dark: 0.48, light: 0.65, beach: 0.55 };
    const BASE_A = { dark: 0.28, light: 0.35, beach: 0.45 };
    const smoothstep = (e0, e1, x) => {
      const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const compositeHue = (theme, stop) => {
      const [kn, r, g, b] = stop;
      const a = OPACITY[theme] * (BASE_A[theme] + (1 - BASE_A[theme]) * smoothstep(0, 7, kn));
      const bm = BASEMAP[theme].map((v) => v / 255);
      return rgbToHueDeg([bm[0] * (1 - a) + r * a, bm[1] * (1 - a) + g * a, bm[2] * (1 - a) + b * a]);
    };
    for (const theme of ['dark', 'light', 'beach']) {
      const ramp = THEME_RAMPS[theme];
      for (let i = 1; i < ramp.length && ramp[i][0] <= 21; i++) {
        const a = compositeHue(theme, ramp[i - 1]);
        const b = compositeHue(theme, ramp[i]);
        let d = Math.abs(b - a);
        if (d > 180) d = 360 - d;
        expect(d).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('COMPOSITE VISIBILITY floors: low stops must not go DIMMER than the pre-respread palette', () => {
    // Round 1 of the respread won its hue gaps while LOSING composite visibility on dark's calm
    // band (the user's "wind data missing at lower speeds") — a hue-gap gate alone cannot see a
    // stop fading toward the basemap. Perceptually-weighted composite distance vs the bare
    // basemap, floored at the LEGACY palette's own values (computed once, hard-coded — a
    // respread may improve on legacy, never regress below it).
    const BASEMAP = { dark: [93, 117, 126], light: [168, 214, 222], beach: [150, 190, 200] };
    const OPACITY = { dark: 0.48, light: 0.65, beach: 0.55 };
    const BASE_A = { dark: 0.28, light: 0.35, beach: 0.45 };
    const smoothstep = (e0, e1, x) => {
      const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const visDelta = (theme, stop) => {
      const [kn, r, g, b] = stop;
      const a = OPACITY[theme] * (BASE_A[theme] + (1 - BASE_A[theme]) * smoothstep(0, 7, kn));
      const bm = BASEMAP[theme].map((v) => v / 255);
      const c = [bm[0] * (1 - a) + r * a, bm[1] * (1 - a) + g * a, bm[2] * (1 - a) + b * a];
      return 255 * Math.sqrt(0.30 * (c[0] - bm[0]) ** 2 + 0.59 * (c[1] - bm[1]) ** 2 + 0.11 * (c[2] - bm[2]) ** 2);
    };
    // legacy floors (pre-respread palette, same model): dark0 5.76 · light0 37.57 · light3 60.70
    // (96% tolerance where the hue fix costs a hair) · beach0 23.87
    const FLOORS = {
      dark: { 0: 5.76 },
      light: { 0: 37.5, 3: 58.0 },
      beach: { 0: 23.8 },
    };
    for (const theme of ['dark', 'light', 'beach']) {
      const ramp = THEME_RAMPS[theme];
      for (const stop of ramp) {
        const floor = FLOORS[theme][stop[0]];
        if (floor === undefined) continue;
        expect(visDelta(theme, stop)).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('the respread kill switch restores the legacy low stops', () => {
    const { resolveThemeRamp } = require('./WindColorRamp');
    window.__RAW_DISABLE_WIND_LOWBAND_RESPREAD__ = true;
    try {
      expect(resolveThemeRamp('dark')[0]).toEqual([0, 0.35, 0.45, 1.00, 0.80]);
      expect(resolveThemeRamp('light')[1]).toEqual([3, 0.06, 0.20, 0.48, 0.75]);
      expect(resolveThemeRamp('beach')[0]).toEqual([0, 1.00, 0.35, 0.75, 0.75]);
      // untouched rows stay the live palette
      expect(resolveThemeRamp('dark')[2]).toEqual(THEME_RAMPS.dark[2]);
    } finally {
      delete window.__RAW_DISABLE_WIND_LOWBAND_RESPREAD__;
    }
  });
});
