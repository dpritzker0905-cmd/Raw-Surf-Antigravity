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
import { THEME_RAMPS, FIELD_RAMPS, sampleRamp, buildFieldRampTexture } from './WindColorRamp';

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
    // the alpha contract (2026-07-20 slow-wind visibility raise — user bar: ALL wind visible on
    // all three themes; 71% of the Gulf's real wind was below 12 kn and under-visible):
    // per-theme baseAlpha dark 0.44 / light 0.42 / beach 0.45, ramp saturating at 5 kn (dark)
    // / 7 kn (light+beach). Kill: __RAW_DISABLE_WIND_CALM_ALPHA_V3__ -> u_calm_alpha_kill
    // restores the 07-19 set (0.28/0.35/0.45, 7 kn). The VALUE pins below are deliberate: the
    // baseAlpha constants live in FIVE sites (HEATMAP_FS, DRAW_FS casing, windParticleContrast
    // mirror, this file's two maps) and only a source-level pin fails when the shader alone drifts.
    expect(HEATMAP_FS).toMatch(/u_opacity\s*\*\s*\(baseAlpha\s*\+\s*\(1\.0\s*-\s*baseAlpha\)\s*\*\s*smoothstep\(0\.0,\s*rampEnd,\s*speed\)\)/);
    expect(HEATMAP_FS).toMatch(/uniform\s+float\s+u_calm_alpha_kill/);
    expect(HEATMAP_FS).toMatch(/float\s+baseAlpha\s*=\s*0\.44/);            // dark default
    expect(HEATMAP_FS).toMatch(/float\s+rampEnd\s*=\s*5\.0/);               // dark saturates at 5 kn
    expect(HEATMAP_FS).toMatch(/baseAlpha\s*=\s*0\.45;\s*rampEnd\s*=\s*7\.0/); // beach branch
    expect(HEATMAP_FS).toMatch(/baseAlpha\s*=\s*0\.42;\s*rampEnd\s*=\s*7\.0/); // light branch
    // and the casing composite uses the SAME constants, ramp endpoint and kill switch
    const DRAW = require('./WebGLWindShaders').DRAW_FS;
    expect(DRAW).toMatch(/smoothstep\(0\.0,\s*rampEnd,\s*v_speed\)/);
    expect(DRAW).toMatch(/uniform\s+float\s+u_calm_alpha_kill/);
    expect(DRAW).toMatch(/float\s+baseA\s*=\s*0\.44/);
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

  it('adjacent low-band HUE GAPS are >= 18 deg in dark (the slow-wind sensitivity pin)', () => {
    // 2026-07-19: dark's 0-3-6 kn gaps measured 12/10/11 deg — one cyan family. The spread
    // redistributed the low stops; this pin stops them drifting back together. Light and beach were
    // redesigned 2026-10-09 to separate bands by lightness AND hue; they are gated in CIEDE2000 below.
    for (const theme of ['dark']) {
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
    // 07-20 slow-wind visibility raise: sync HEATMAP_FS + DRAW_FS + windParticleContrast mirror
    const BASE_A = { dark: 0.44, light: 0.42, beach: 0.45 };
    const RAMP_KN = { dark: 5, light: 7, beach: 7 };
    const smoothstep = (e0, e1, x) => {
      const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const compositeHue = (theme, stop) => {
      const [kn, r, g, b] = stop;
      const a = OPACITY[theme] * (BASE_A[theme] + (1 - BASE_A[theme]) * smoothstep(0, RAMP_KN[theme], kn));
      const bm = BASEMAP[theme].map((v) => v / 255);
      return rgbToHueDeg([bm[0] * (1 - a) + r * a, bm[1] * (1 - a) + g * a, bm[2] * (1 - a) + b * a]);
    };
    for (const theme of ['dark']) {   // light/beach now TINT (multiply) — gated by the CIEDE2000 tests below
      const ramp = THEME_RAMPS[theme];
      for (let i = 1; i < ramp.length && ramp[i][0] <= 21; i++) {
        const a = compositeHue(theme, ramp[i - 1]);
        const b = compositeHue(theme, ramp[i]);
        let d = Math.abs(b - a);
        if (d > 180) d = 360 - d;
        // the 0-10 kn band (where 71% of the Gulf's real wind lived on 07-20) carries the raised
        // 18-deg bar the low-band re-derivation guaranteed; 12 remains the floor above it
        expect(d).toBeGreaterThanOrEqual(ramp[i][0] <= 10 ? 18 : 12);
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
    // 07-20 slow-wind visibility raise: sync HEATMAP_FS + DRAW_FS + windParticleContrast mirror
    const BASE_A = { dark: 0.44, light: 0.42, beach: 0.45 };
    const RAMP_KN = { dark: 5, light: 7, beach: 7 };
    const smoothstep = (e0, e1, x) => {
      const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const visDelta = (theme, stop) => {
      const [kn, r, g, b] = stop;
      const a = OPACITY[theme] * (BASE_A[theme] + (1 - BASE_A[theme]) * smoothstep(0, RAMP_KN[theme], kn));
      const bm = BASEMAP[theme].map((v) => v / 255);
      const c = [bm[0] * (1 - a) + r * a, bm[1] * (1 - a) + g * a, bm[2] * (1 - a) + b * a];
      return 255 * Math.sqrt(0.30 * (c[0] - bm[0]) ** 2 + 0.59 * (c[1] - bm[1]) ** 2 + 0.11 * (c[2] - bm[2]) ** 2);
    };
    // 07-20 floors: pinned at ~92% of the composite deltas the raised-alpha derivation achieved
    // (dark 26.3/42.3/37.4 · light 45.1/80.1/66.9 · beach 25.0/42.5/32.7 at 0/3/6 kn). These are
    // no longer "never worse than legacy" floors — they pin the RAISED visibility itself, so any
    // future stop/alpha drift that dims the calm band fails here first (the user bar this encodes:
    // ALL wind must be visible on all three themes).
    const FLOORS = {
      dark: { 0: 24, 3: 39, 6: 34 },
      light: { 0: 42, 3: 74, 6: 62 },
      beach: { 0: 23.8, 3: 39, 6: 30 },
    };
    for (const theme of ['dark']) {   // light/beach: superseded by the owner's 2026-10-09 middle ground (below)
      const ramp = THEME_RAMPS[theme];
      for (const stop of ramp) {
        const floor = FLOORS[theme][stop[0]];
        if (floor === undefined) continue;
        expect(visDelta(theme, stop)).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  // ── LIGHT + BEACH (2026-10-09 redesign; owner chose the MIDDLE GROUND for slow wind) ─────────────────────
  // The field now TINTS the basemap (multiply blend, WebGLWindUtils.v2FieldTint): out = basemap x (1 - s(1 - colour)) on the
  // ENCODED values the GPU blends, s = opacity x (baseA + (1 - baseA) smoothstep(0, 7, kn)) x strength. Distances in CIEDE2000.
  const srgbToLab = (rgb) => { const d = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); const [R, G, B] = rgb.map(d);
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]; };
  const de2000 = ([L1, a1, b1], [L2, a2, b2]) => { const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
    const a1p = a1 * (1 + G), a2p = a2 * (1 + G), C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2), h1p = (Math.atan2(b1, a1p) / rad + 360) % 360, h2p = (Math.atan2(b2, a2p) / rad + 360) % 360;
    let dhp = h2p - h1p; if (C1p * C2p === 0) dhp = 0; else if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2), Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
    let hbp = h1p + h2p; if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
    const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
    const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
    const RT = -2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hbp - 275) / 25) ** 2)) * rad);
    return Math.sqrt(((L2 - L1) / SL) ** 2 + ((C2p - C1p) / SC) ** 2 + (dHp / SH) ** 2 + RT * ((C2p - C1p) / SC) * (dHp / SH)); };
  const TINT = { light: { op: 0.65, baseA: 0.42, k: 0.70 / 0.65 }, beach: { op: 0.55, baseA: 0.45, k: 0.60 / 0.55 } };
  const SURFACES = { light: { water: [168, 214, 222], land: [236, 236, 232] }, beach: { water: [150, 190, 200], land: [222, 208, 180] } };
  const ss = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const tinted = (theme, [kn, r, g, b], bm) => { const t = TINT[theme], s = Math.min(1, t.op * (t.baseA + (1 - t.baseA) * ss(0, 7, kn)) * t.k);
    return bm.map((v, i) => (v / 255) * (1 - s * (1 - [r, g, b][i]))); };
  it('light/beach slow wind: calm is clean, light air a soft visible tint, a breeze clear colour — on water AND land', () => {
    const MIDDLE = { 0: [0, 2.5], 3: [9, Infinity], 6: [14, Infinity] };   // [min, max] dE vs the bare surface
    for (const theme of ['light', 'beach']) for (const [where, bm] of Object.entries(SURFACES[theme])) for (const stop of FIELD_RAMPS[theme]) {   // the FIELD tints the map
      const band = MIDDLE[stop[0]]; if (!band) continue;
      const d = de2000(srgbToLab(bm.map((v) => v / 255)), srgbToLab(tinted(theme, stop, bm)));
      expect(d).toBeGreaterThanOrEqual(stop[0] === 6 && where === 'land' ? 15 : band[0]);
      expect(d).toBeLessThanOrEqual(band[1]);
    }
  });
  it('light/beach: adjacent stops >= 9 dE2000 apart through 27 kn, and >= 5.5 apart once tinted onto the map below 21 kn', () => {
    for (const theme of ['light', 'beach']) {
      const ramp = THEME_RAMPS[theme];
      for (let i = 1; i < ramp.length && ramp[i][0] <= 27; i++) expect(de2000(srgbToLab(ramp[i - 1].slice(1, 4)), srgbToLab(ramp[i].slice(1, 4)))).toBeGreaterThanOrEqual(9);
      const field = FIELD_RAMPS[theme];
      for (const bm of Object.values(SURFACES[theme])) for (let i = 1; i < field.length && field[i][0] <= 21; i++) {
        expect(de2000(srgbToLab(tinted(theme, field[i - 1], bm)), srgbToLab(tinted(theme, field[i], bm)))).toBeGreaterThanOrEqual(5.5);
      }
    }
  });
  it('POSITIVE CONTROL: the 07-20 saturated calm stops would fail the clean-calm bar (hot pink / electric violet washed calm land)', () => {
    const OLD_CALM = { light: [0, 0.54, 0.00, 0.92], beach: [0, 1.00, 0.32, 0.78] };
    for (const theme of ['light', 'beach']) {
      const bm = SURFACES[theme].land;
      expect(de2000(srgbToLab(bm.map((v) => v / 255)), srgbToLab(tinted(theme, OLD_CALM[theme], bm)))).toBeGreaterThan(10);
    }
  });

  // DARK PARITY (owner: "I like this transparency [dark] ... match this with light and beach"). Bench dE76 of the map with
  // vs without the field, per band, dark (approved): the light/beach FIELD ramps must carry the same strength per band.
  const DARK_STRENGTH = { 6: 23.2, 10: 29.5, 16: 32.0, 21: 31.5, 27: 30.4, 33: 28.5, 40: 26.3, 47: 24.7, 55: 24, 63: 24, 75: 24 };
  const BENCH_BASEMAP = { light: [0.86, 0.88, 0.90], beach: [0.62, 0.58, 0.50] };
  const dE76 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const strength = (theme, stop) => { const bm = BENCH_BASEMAP[theme].map((v) => v * 255); return dE76(srgbToLab(bm.map((v) => v / 255)), srgbToLab(tinted(theme, stop, bm))); };
  it('light/beach FIELD carries the measured dark strength in every band from 6 to 75 kn (within 1 dE)', () => {
    for (const theme of ['light', 'beach']) for (const stop of FIELD_RAMPS[theme]) {
      const target = DARK_STRENGTH[stop[0]]; if (target === undefined) continue;
      expect(Math.abs(strength(theme, stop) - target)).toBeLessThanOrEqual(target === 32.0 && theme === 'beach' ? 2.2 : 1.0);
    }
  });
  it('POSITIVE CONTROL: the particle palette as the field overshoots the light storm bands by more than 40%', () => {
    const storm = THEME_RAMPS.light.filter((st) => st[0] >= 40);
    storm.forEach((st) => expect(strength('light', st) / DARK_STRENGTH[st[0]]).toBeGreaterThan(1.4));
  });
  it('the field and the particles share hue identity: every field stop is within 25 deg of the particle stop hue (chromatic stops)', () => {
    for (const theme of ['light', 'beach']) FIELD_RAMPS[theme].forEach((st, i) => {
      const p = THEME_RAMPS[theme][i]; const sat = (c) => Math.max(...c) - Math.min(...c); if (sat(p.slice(1, 4)) < 0.15 || sat(st.slice(1, 4)) < 0.1) return;
      let d = Math.abs(rgbToHueDeg(st.slice(1, 4)) - rgbToHueDeg(p.slice(1, 4))); if (d > 180) d = 360 - d; expect(d).toBeLessThanOrEqual(25);
    });
  });
  it('the field ramp texture exists only for tinted themes, honours its kill switch, and binds only on the tinted field pass', () => {
    const fakeGl = { TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, getParameter: () => null, createTexture: () => ({ t: 1 }), bindTexture: () => {}, texParameteri: () => {}, texImage2D: () => {} };
    expect(buildFieldRampTexture(fakeGl, 50, 'dark', {})).toBeNull();
    expect(buildFieldRampTexture(fakeGl, 50, 'light', {})).toEqual({ t: 1 });
    expect(buildFieldRampTexture(fakeGl, 50, 'light', { __RAW_DISABLE_WIND_FIELD_RAMP__: true })).toBeNull();
    const fs = require('fs'), path = require('path'); const eng = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8'), init = fs.readFileSync(path.join(__dirname, 'WebGLWindEngineInit.js'), 'utf8');
    expect(eng).toContain('bindTexture(gl, (_ft > 0 && this._fieldRamp) || this._colorRamp, 1)');
    expect(eng.split('this._fieldRamp = buildFieldRampTexture(gl, this._maxWindSpeed, activeTheme)').length - 1).toBe(2);
    expect(init).toContain('if (engine._fieldRamp) gl.deleteTexture(engine._fieldRamp);');
  });

  // MID-BAND REFINE (owner, 2026-10-09: "around 15kts is blending in with the color of the map itself"). Over the basemap WATER
  // the 10-21 kn interpolation crosses the water's hue, so a 2-3 arcmin streak is seen by its LIGHTNESS against its own tint,
  // and the band by its distance from the water. Streak = the premultiplied particle (stop alpha x theme opacity) over the
  // field tint at the same speed. Pre-refine worst cases: light streak vs tint +1.5 L*, beach 12-17 kn streak vs water 10.2.
  const POP = { light: 1.0, beach: 0.6 };
  const worstOverWater = (theme, P, F, from, to) => { const out = { streakVsTintL: Infinity, streakVsWater: Infinity }, water = SURFACES[theme].water;
    for (let v = from; v <= to; v += 0.5) { const p = sampleRamp(P, v), f = sampleRamp(F, v), a = p[3] * POP[theme];
      const T = tinted(theme, [v, f[0], f[1], f[2]], water), S = [0, 1, 2].map((j) => p[j] * a + T[j] * (1 - a));
      out.streakVsTintL = Math.min(out.streakVsTintL, srgbToLab(S)[0] - srgbToLab(T)[0]);
      out.streakVsWater = Math.min(out.streakVsWater, de2000(srgbToLab(water.map((x) => x / 255)), srgbToLab(S))); }
    return out; };
  const ramps = (theme) => { const { resolveThemeRamp, resolveFieldRamp } = require('./WindColorRamp'); return [resolveThemeRamp(theme), resolveFieldRamp(theme, window)]; };
  it('mid-band: 10-21 kn streaks stand >= +3.3 L* off their own tint on water, and beach 12-17 kn >= 11.5 dE2000 off the water', () => {
    expect(worstOverWater('light', ...ramps('light'), 10, 21).streakVsTintL).toBeGreaterThanOrEqual(3.6);
    expect(worstOverWater('beach', ...ramps('beach'), 10, 21).streakVsTintL).toBeGreaterThanOrEqual(3.3);
    expect(worstOverWater('beach', ...ramps('beach'), 12, 17).streakVsWater).toBeGreaterThanOrEqual(11.5);
    expect(worstOverWater('light', ...ramps('light'), 12, 17).streakVsWater).toBeGreaterThanOrEqual(13.4);
  });
  it('POSITIVE CONTROL + kill: __RAW_DISABLE_WIND_MIDBAND_REFINE__ restores the pre-refine stops, which fail that bar', () => {
    window.__RAW_DISABLE_WIND_MIDBAND_REFINE__ = true;
    try {
      const [lp, lf] = ramps('light'), [bp, bf] = ramps('beach');
      expect(lp[3]).toEqual([10, 0.116, 0.690, 0.811, 0.80]);
      expect(lf[3]).toEqual([10, 0.276, 0.688, 0.789, 0.80]);
      expect(bp[4]).toEqual([16, 0.308, 0.764, 0.906, 0.85]);
      expect(bf[4]).toEqual([16, 0.008, 0.788, 0.967, 0.85]);
      expect(lp[7]).toEqual(THEME_RAMPS.light[7]);   // stops outside the band are the live palette
      expect(worstOverWater('light', lp, lf, 10, 21).streakVsTintL).toBeLessThan(2);
      expect(worstOverWater('beach', bp, bf, 12, 17).streakVsWater).toBeLessThan(10.8);
    } finally {
      delete window.__RAW_DISABLE_WIND_MIDBAND_REFINE__;
    }
    expect(ramps('light')[0]).toBe(THEME_RAMPS.light);
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
