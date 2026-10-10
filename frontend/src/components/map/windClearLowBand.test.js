/**
 * NO GREY VEIL, NO BARE CALM: the low-wind field of light and beach, and the path a ramp takes between two stops.
 *
 * Owner, 2026-10-10: "the light wind color also looks like fog visually, a lot, in light mode. And slightly in beach mode",
 * "I do see hard lines in between very light winds and other wind fields".
 *
 * Measured on the composite over the muted ground (frontend/scripts/wind-color, CIELAB L* / C*):
 *   - light, 13 kn: 69.6 / 1.0. The 10 kn violet and the 16 kn green sit 172 degrees apart, and the straight sRGB line
 *     between them runs through grey: a grey veil at the commonest wind speeds, with a 9 dE00-per-knot edge on each side.
 *   - light, calm: 92.4 / 0.6 against a bare ground of 93.4 / 0.5. Calm air drew the greyed map itself, then climbed to
 *     lavender within 3 kn: a difference too small to see followed by a steep one, which draws an edge round every calm patch.
 *   - beach has no such segment (every one keeps 0.92 of its colour or more; dark's weakest keeps 0.78); only its calm was bare
 *     (83.0 / 3.5).
 * This file pins the two fixes (WindColorRamp.js: HUE PATH, CLEAR CALM), their kill switches, and what neither may touch.
 * 3, 6 and 10 kn are NOT changed: their strength is dark's and their steps hold the colour-blind floor (windFieldLut.test.js,
 * windPaletteCvd.test.js). A lilac that light cannot carry more colour (C* 15 at L* 85 is the sRGB ceiling over this ground).
 */
import { resolveFieldRamp, resolveThemeRamp, huePathStops, generateRampData, windLegendGradientCSS, sampleRamp, toOklch, THEME_RAMPS } from './WindColorRamp';
import { muteColor, windBasemapMuteAmount, windBasemapWaterL } from './windBasemapMute';

// ── the composite the wind draws (HEATMAP_FS's multiply tint; check.mjs and windFieldLut.test.js carry the same model) ───
const MODEL = {
  light: { op: 0.65, baseA: 0.42, end: 7, k: 0.70 / 0.65, land: [236, 236, 232], water: [168, 214, 222] },
  beach: { op: 0.55, baseA: 0.45, end: 7, k: 0.60 / 0.55, land: [222, 208, 180], water: [150, 190, 200] },
};
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const strength = (m, v) => Math.min(1, m.op * (m.baseA + (1 - m.baseA) * ss(0, m.end, v)) * m.k);
const ground = (theme, surf) => {
  const c = MODEL[theme][surf], m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${c.join(', ')})`, windBasemapMuteAmount(theme, {}), surf === 'water' ? windBasemapWaterL(theme, {}) : 1));
  return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
};
const over = (theme, v, ramp, g) => { const c = sampleRamp(ramp, v), s = strength(MODEL[theme], v); return g.map((x, i) => x * (1 - s * (1 - c[i]))); };
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lab = (rgb) => {
  const [r, g, b] = rgb.map(lin), f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4123908 * r + 0.3575843 * g + 0.1804808 * b) / 0.95047), y = f(0.2126390 * r + 0.7151687 * g + 0.0721923 * b), z = f((0.0193308 * r + 0.1191948 * g + 0.9505322 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const chroma = (rgb) => { const l = lab(rgb); return Math.hypot(l[1], l[2]); };
const dE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const speeds = (from, to, step) => { const out = []; for (let v = from; v <= to + 1e-9; v += step) out.push(v); return out; };
/** The weakest colour the field draws from `from` to `to` knots: { c: C*, v: knots }. */
const weakest = (theme, surf, ramp, from, to) => speeds(from, to, 0.25).reduce((w, v) => { const c = chroma(over(theme, v, ramp, ground(theme, surf))); return c < w.c ? { c, v } : w; }, { c: Infinity, v: 0 });
/** The steepest change per knot of the composite between `from` and `to` knots (CIE76). */
const steepest = (theme, surf, ramp, from, to) => Math.max(...speeds(from, to - 0.25, 0.25).map((v) => dE(over(theme, v, ramp, ground(theme, surf)), over(theme, v + 0.25, ramp, ground(theme, surf))) * 4));

const KILL_PATH = '__RAW_DISABLE_WIND_HUE_PATH__', KILL_CLEAR = '__RAW_DISABLE_WIND_CALM_CLEAR__';
const field = (theme, levers) => huePathStops(resolveFieldRamp(theme, levers || {}), levers || {});
afterEach(() => { delete window[KILL_PATH]; delete window[KILL_CLEAR]; });

describe('hue path: a ramp never runs through grey between two stops', () => {
  const straightKeeps = (a, b) => toOklch([1, 2, 3].map((j) => (a[j] + b[j]) / 2))[1] / ((toOklch(a.slice(1, 4))[1] + toOklch(b.slice(1, 4))[1]) / 2);

  it('positive control: the straight line from light\'s 10 kn violet to its 16 kn green loses nearly all its colour', () => {
    for (const ramp of [resolveFieldRamp('light', {}), resolveThemeRamp('light')]) {
      expect(ramp[3][0]).toBe(10); expect(ramp[4][0]).toBe(16);
      expect(straightKeeps(ramp[3], ramp[4])).toBeLessThan(0.12);   // 0.07 and 0.09: a grey midpoint
    }
  });

  it('the path keeps its colour all the way: no waypoint below 3/4 of the weaker end', () => {
    for (const ramp of [resolveFieldRamp('light', {}), resolveThemeRamp('light')]) {
      const path = huePathStops(ramp, {}), floor = 0.75 * Math.min(toOklch(ramp[3].slice(1, 4))[1], toOklch(ramp[4].slice(1, 4))[1]);
      for (const v of speeds(10, 16, 0.25)) expect(toOklch(sampleRamp(path, v).slice(0, 3))[1]).toBeGreaterThanOrEqual(floor);
    }
  });

  it('it goes by the cool side (violet, blue, azure, teal, green), never through the gale colours', () => {
    const path = huePathStops(resolveFieldRamp('light', {}), {}).filter((s) => s[0] >= 10 && s[0] <= 16);
    expect(path.map((s) => s[0])).toEqual([10, 11, 12, 13, 14, 15, 16]);
    const hues = path.map((s) => toOklch(s.slice(1, 4))[2]);
    for (let i = 1; i < hues.length; i++) expect(hues[i]).toBeLessThan(hues[i - 1]);   // one direction, from violet down to green
    expect(hues[0]).toBeLessThan(335); expect(hues[hues.length - 1]).toBeGreaterThan(120);
    expect(hues[3]).toBeGreaterThan(190); expect(hues[3]).toBeLessThan(260);          // 13 kn: an azure, where grey was
  });

  it('every waypoint is a displayable colour and carries its neighbours\' alpha', () => {
    for (const s of huePathStops(resolveThemeRamp('light'), {})) {
      for (const c of s.slice(1, 4)) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
      expect(s[4]).toBeGreaterThanOrEqual(0.72); expect(s[4]).toBeLessThanOrEqual(0.95);
    }
  });

  it('every stop stays where it was, in order', () => {
    for (const theme of ['light', 'beach', 'dark']) {
      for (const ramp of [resolveThemeRamp(theme), resolveFieldRamp(theme, {})].filter(Boolean)) {
        const path = huePathStops(ramp, {});
        expect(path.filter((s) => ramp.includes(s))).toEqual(ramp);
      }
    }
  });

  it('dark and beach have no such segment: the very same ramp comes back, and their lookup tables do not move', () => {
    for (const theme of ['dark', 'beach']) {
      const p = resolveThemeRamp(theme), f = resolveFieldRamp(theme, {});
      expect(huePathStops(p, {})).toBe(p);
      if (f) expect(huePathStops(f, {})).toBe(f);
      const on = Array.from(generateRampData(75, null, theme));
      window[KILL_PATH] = true;
      expect(Array.from(generateRampData(75, null, theme))).toEqual(on);
      delete window[KILL_PATH];
    }
  });

  it('light: the lookup tables change between 10 and 16 kn and nowhere else; the kill restores them', () => {
    for (const ramp of [resolveFieldRamp('light', {}), resolveThemeRamp('light')]) {
      const on = generateRampData(75, ramp);
      window[KILL_PATH] = true;
      const off = generateRampData(75, ramp);
      delete window[KILL_PATH];
      let inside = 0;
      for (let i = 0; i < 256; i++) {
        const v = (i / 255) * 75, same = [0, 1, 2, 3].every((j) => on[i * 4 + j] === off[i * 4 + j]);
        if (v <= 10 || v >= 16) expect(same).toBe(true); else if (!same) inside++;
      }
      expect(inside).toBeGreaterThan(15);   // 20 texels sit between 10 and 16 kn
    }
  });

  it('the legend bar draws the path the map draws; the kill restores the 13-stop bar', () => {
    const stops = (css) => css.split('%').length - 1;
    expect(stops(windLegendGradientCSS('light'))).toBe(18);
    expect(stops(windLegendGradientCSS('beach'))).toBe(13);
    expect(stops(windLegendGradientCSS('dark'))).toBe(13);
    window[KILL_PATH] = true;
    expect(stops(windLegendGradientCSS('light'))).toBe(13);
  });

  it('the kill returns the ramp untouched', () => {
    const ramp = resolveFieldRamp('light', {});
    expect(huePathStops(ramp, { [KILL_PATH]: true })).toBe(ramp);
  });
});

describe('clear calm: calm air is a pale tint of the theme\'s own first colour, never the bare greyed map', () => {
  const WAS = { light: [0, 0.942, 0.964, 0.987, 0.72], beach: [0, 0.973, 0.953, 0.911, 0.75] };
  const NOW = { light: [0, 0.970, 0.741, 0.866, 0.72], beach: [0, 0.713, 0.981, 0.860, 0.75] };
  const killed = (theme) => field(theme, { [KILL_CLEAR]: true });

  it('the default calm stop, and the kill that restores the stop before it, byte for byte; no other row moves', () => {
    for (const theme of ['light', 'beach']) {
      const on = resolveFieldRamp(theme, {}), off = resolveFieldRamp(theme, { [KILL_CLEAR]: true });
      expect(on[0]).toEqual(NOW[theme]);
      expect(off[0]).toEqual(WAS[theme]);
      expect(off.slice(1)).toEqual(on.slice(1));
      expect(on).toHaveLength(13);
      expect(resolveFieldRamp(theme, { [KILL_CLEAR]: 1 })[0]).toEqual(NOW[theme]);   // only exactly true
    }
  });

  it('the legend (particle ramp) is not touched, and dark has no field ramp to touch', () => {
    expect(resolveThemeRamp('light')).toEqual(THEME_RAMPS.light);
    expect(resolveThemeRamp('beach')).toEqual(THEME_RAMPS.beach);
    expect(THEME_RAMPS.light[0].slice(1, 4)).toEqual([0.942, 0.964, 0.987]);
    expect(resolveFieldRamp('dark', {})).toBeNull();
  });

  it('every older field kill steps back past it: calm is the stop that kill drew with', () => {
    for (const k of ['__RAW_DISABLE_WIND_LIGHT_FASTBAND__', '__RAW_DISABLE_WIND_LIGHT_NEUTRAL_CVD__', '__RAW_DISABLE_WIND_LIGHT_CVD__', '__RAW_DISABLE_WIND_LIGHT_LOWBAND__', '__RAW_DISABLE_WIND_MIDBAND_REFINE__']) {
      expect(resolveFieldRamp('light', { [k]: true })[0].slice(0, 1)).toEqual([0]);
      if (k !== '__RAW_DISABLE_WIND_LIGHT_LOWBAND__') expect(resolveFieldRamp('light', { [k]: true })[0]).toEqual(WAS.light);
      expect(resolveFieldRamp('light', { [k]: true })[0]).not.toEqual(NOW.light);
    }
    for (const k of ['__RAW_DISABLE_WIND_BEACH_CVD__', '__RAW_DISABLE_WIND_MIDBAND_REFINE__']) expect(resolveFieldRamp('beach', { [k]: true })[0]).toEqual(WAS.beach);
  });

  it('calm is a tint the eye can name, over land and water, and weaker than light air\'s', () => {
    for (const [theme, minC] of [['light', 4], ['beach', 6]]) {
      for (const surf of ['land', 'water']) {
        const g = ground(theme, surf), calm = over(theme, 0, field(theme), g), three = over(theme, 3, field(theme), g);
        expect(dE(g, calm)).toBeGreaterThanOrEqual(5);                      // was 1.0-1.6: under the threshold of seeing
        expect(dE(g, calm)).toBeLessThan(dE(g, three));
        expect(lab(calm)[0]).toBeLessThan(lab(g)[0] - 1);                   // it darkens, as a filter does; a veil lightens
        expect(chroma(calm)).toBeGreaterThanOrEqual(minC);
        expect(dE(calm, three)).toBeGreaterThanOrEqual(6);                  // and light air is still its own band
        expect(dE(g, over(theme, 0, killed(theme), g))).toBeLessThan(2.3);  // positive control: the bare map
      }
    }
  });

  it('the calm edge is gentle: the steepest step from calm to 6 kn is under 3/4 of what it was', () => {
    for (const theme of ['light', 'beach']) {
      for (const surf of ['land', 'water']) expect(steepest(theme, surf, field(theme), 0, 6)).toBeLessThan(0.75 * steepest(theme, surf, killed(theme), 0, 6));
    }
  });

  it('light draws no grey veil from 3 to 21 kn, over land or water (was C* 1.0 at 13 kn); each fix has its own control', () => {
    for (const surf of ['land', 'water']) expect(weakest('light', surf, field('light'), 3, 21).c).toBeGreaterThanOrEqual(8);
    const noPath = weakest('light', 'land', field('light', { [KILL_PATH]: true }), 3, 21);
    expect(noPath.c).toBeLessThan(3); expect(noPath.v).toBeGreaterThan(12); expect(noPath.v).toBeLessThan(14);
    for (const surf of ['land', 'water']) expect(weakest('beach', surf, field('beach'), 3, 21).c).toBeGreaterThanOrEqual(8);
  });

  it('light is one lightness descent from calm to 16 kn over land: no band lighter than the one before it', () => {
    const g = ground('light', 'land'), Ls = speeds(0, 16, 0.5).map((v) => lab(over('light', v, field('light'), g))[0]);
    for (let i = 1; i < Ls.length; i++) expect(Ls[i]).toBeLessThanOrEqual(Ls[i - 1] + 0.3);
    expect(Ls[0] - Ls[Ls.length - 1]).toBeGreaterThan(15);
  });

  it('3, 6 and 10 kn draw exactly what they drew (their strength is dark\'s; their steps hold the colour-blind floor)', () => {
    for (const theme of ['light', 'beach']) {
      for (const v of [3, 6, 10]) expect(sampleRamp(field(theme), v)).toEqual(sampleRamp(killed(theme), v));
    }
  });
});

describe('hue path: what the independent review of the change found (2026-10-10)', () => {
  const kept = (a, b) => toOklch([1, 2, 3].map((j) => (a[j] + b[j]) / 2))[1] / ((toOklch(a.slice(1, 4))[1] + toOklch(b.slice(1, 4))[1]) / 2);
  const OLDER = ['__RAW_DISABLE_WIND_LIGHT_FASTBAND__', '__RAW_DISABLE_WIND_LIGHT_NEUTRAL_CVD__', '__RAW_DISABLE_WIND_LIGHT_CVD__', '__RAW_DISABLE_WIND_LIGHT_LOWBAND__',
    '__RAW_DISABLE_WIND_MIDBAND_REFINE__', '__RAW_DISABLE_WIND_BEACH_CVD__', '__RAW_DISABLE_WIND_DARK_CVD__', '__RAW_DISABLE_WIND_LOWBAND_RESPREAD__', '__RAW_DISABLE_WIND_FIELD_RAMP__'];
  afterEach(() => { for (const k of OLDER) delete window[k]; });

  it('every older ramp kill stands the path down too: that kill draws what it drew, the rows AND the line between them', () => {
    for (const k of OLDER) {
      const w = { [k]: true };
      for (const theme of ['light', 'beach']) { const f = resolveFieldRamp(theme, w); expect(huePathStops(f, w)).toBe(f); }
      window[k] = true;
      for (const theme of ['light', 'beach', 'dark']) {
        const p = resolveThemeRamp(theme);
        expect(huePathStops(p)).toBe(p);
        expect(windLegendGradientCSS(theme).split('%').length - 1).toBe(13);
      }
      delete window[k];
    }
  });

  it('the trigger has a wide margin: a shipped segment either loses most of its colour (under 1/4 kept) or keeps over 3/4', () => {
    const seen = [];
    for (const theme of ['light', 'beach', 'dark']) {
      for (const ramp of [resolveThemeRamp(theme), resolveFieldRamp(theme, {})].filter(Boolean)) {
        for (let i = 1; i < ramp.length; i++) seen.push(kept(ramp[i - 1], ramp[i]));
      }
    }
    expect(seen.filter((r) => r < 0.25)).toHaveLength(2);                        // light's 10-16 kn, in the field and in the particle ramp
    expect(seen.filter((r) => r >= 0.25 && r <= 0.75)).toEqual([]);              // nothing sits near the trigger (0.5)
    const nearest = Math.min(...seen.filter((r) => r > 0.75));
    expect(nearest).toBeGreaterThan(0.76); expect(nearest).toBeLessThan(0.80);   // dark's 6-10 kn, 0.78: the nearest that does NOT bend
  });

  it('a kill handed to the table builder is honoured, and a ramp too short to have a segment comes back untouched', () => {
    const ramp = resolveFieldRamp('light', {});
    const viaArg = Array.from(generateRampData(75, ramp, undefined, { [KILL_PATH]: true }));
    window[KILL_PATH] = true;
    const viaWindow = Array.from(generateRampData(75, ramp));
    delete window[KILL_PATH];
    expect(viaArg).toEqual(viaWindow);
    expect(Array.from(generateRampData(75, ramp))).not.toEqual(viaWindow);
    const empty = [], one = [[0, 1, 1, 1, 1]];
    expect(huePathStops(empty, {})).toBe(empty);
    expect(huePathStops(one, {})).toBe(one);
  });
});
