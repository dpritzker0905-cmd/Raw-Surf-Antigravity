/**
 * LIGHT'S LOOK, AN A/B (window.__RAW_WIND_LIGHT_LOOK__; WindColorRamp.js windLightLook, windInk.js WIND_LIGHT_LOOK). DEFAULT OFF.
 *
 * The owner, 2026-10-10: "We really just need to replicate dark mode, but with proper setup for the colors for each modes schema". Dark's
 * streaks are a brighter shade of the colour under them, on a DARK ground; dark's streak method on light's near-white ground washed out
 * (D-019, amended; LESSONS L-V28). This file pins:
 *   - OFF: with the lever unset, killed or set to anything that is not a look, light draws today's field, marks and legend byte for byte,
 *     and beach and dark never move;
 *   - A ('moderate', 'deep'): a deeper field that keeps light's own bars (colour-blind floor 5 on the muted water AND land, colour on the
 *     whole path, a nameable calm weaker than 3 kn, light's hue order) and says plainly the one it re-scopes (dark's strength at 6-21 kn);
 *     marks that are the field's own hue at full brightness, lighter than the field;
 *   - B ('ink'): today's field; ink's own 27-47 kn colours (never a darkened yellow), and the cover cap's ease and wiring.
 * Measurements, the bench and the A/B page: docs/weather-program/log/2026-10-10-light-look-ab.md.
 */
import fs from 'fs';
import path from 'path';
import { windLightLook, resolveFieldRamp, resolveMarkRamp, resolveThemeRamp, generateRampData, huePathStops, sampleRamp, windLegendGradientCSS, toOklch, buildFieldRampTexture, THEME_RAMPS } from './WindColorRamp';
import { windInk, WIND_LIGHT_LOOK, inkCapAt, GLSL_INK_COVER } from './windInk';
import { SCREEN_FS } from './WebGLWindShaders';
import { resolveWindParticlesV2 } from './WebGLWindUtils';
import { muteColor, windBasemapMuteAmount, windBasemapWaterL } from './windBasemapMute';

const V2 = resolveWindParticlesV2({});
const ENGINE = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
const LOOKS = ['moderate', 'deep', 'ink'];
const lever = (look) => ({ __RAW_WIND_LIGHT_LOOK__: look });

// ── colour model: CIELAB D65 and coloraide 8.13's dichromacy (Vienot protan/deutan, Brettel tritan), as windPaletteCvd.test.js ─────────
const dec = (c) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * Math.pow((Math.abs(c) + 0.055) / 1.055, 2.4));
const mm = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const RGB2XYZ = [[0.4123907992659595, 0.357584339383878, 0.1804807884018343], [0.21263900587151036, 0.7151686787677559, 0.07219231536073371],
  [0.01933081871559185, 0.11919477979462598, 0.9505321522496606]];
const WHITE = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];
const labLin = (lin) => { const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = mm(RGB2XYZ, lin).map((v, i) => f(v / WHITE[i])); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
const de2000 = ([L1, a1, b1], [L2, a2, b2]) => { const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G), C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2), h1p = (Math.atan2(b1, a1p) / rad + 360) % 360, h2p = (Math.atan2(b2, a2p) / rad + 360) % 360;
  let dhp = h2p - h1p; if (C1p * C2p === 0) dhp = 0; else if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2), Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p; if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hbp - 275) / 25) ** 2)) * rad);
  return Math.sqrt(((L2 - L1) / SL) ** 2 + ((C2p - C1p) / SC) ** 2 + (dHp / SH) ** 2 + RT * ((C2p - C1p) / SC) * (dHp / SH)); };
const VIENOT = {
  protan: [[0.11238276122216405, 0.8876172387778362, 0], [0.11238276122216398, 0.8876172387778362, 0], [0.0040057682730469425, -0.004005768273046939, 1]],
  deutan: [[0.2927501142784356, 0.7072498857215644, 0], [0.2927501142784356, 0.7072498857215644, 0], [-0.022336587034129083, 0.022336587034129093, 1]],
};
const LMS = [[0.178824041258, 0.4351609057000001, 0.04119349692], [0.034556423182, 0.27155382458, 0.03867130836], [0.000299565576, 0.0018430896, 0.01467086136]];
const TRITAN = { w1: [[7.392856536180033, -11.148044821248138, 0], [-0.34194012421930653, 3.5501661175064, 0], [-4.2050692716448586, 10.89115898202731, 0]],
  w2: [[8.0643934576311, -12.42414705871019, 0], [-0.9956078228581946, 4.7923119863996835, 0], [-0.2150297288038942, 3.3090019545637928, 0]], sep: [0.344781556122, -0.655178443878, 0] };
const simulate = (rgb, kind) => { const lin = rgb.map(dec); if (kind !== 'tritan') return labLin(mm(VIENOT[kind], lin));
  const lms = mm(LMS, lin), side = lms[0] * TRITAN.sep[0] + lms[1] * TRITAN.sep[1]; return labLin(mm(side > 0 ? TRITAN.w2 : TRITAN.w1, lms)); };
const worstCvd = (a, b) => Math.min(...['protan', 'deutan', 'tritan'].map((k) => de2000(simulate(a, k), simulate(b, k))));
const lab = (rgb) => labLin(rgb.map(dec));
const lch = (rgb) => { const q = lab(rgb); return [q[0], Math.hypot(q[1], q[2]), (Math.atan2(q[2], q[1]) * 180 / Math.PI + 360) % 360]; };
const de = (a, b) => de2000(lab(a), lab(b));
const hd = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
// share of its ends' OKLCH chroma a segment keeps at its straight sRGB midpoint (huePathStops walks the wheel under 1/2)
const kept = (a, b) => toOklch([1, 2, 3].map((j) => (a[j] + b[j]) / 2))[1] / ((toOklch(a.slice(1, 4))[1] + toOklch(b.slice(1, 4))[1]) / 2);
const fakeGl = () => { const gl = { TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, RGBA: 3, UNSIGNED_BYTE: 4, CLAMP_TO_EDGE: 5, LINEAR: 6, TEXTURE_WRAP_S: 7, TEXTURE_WRAP_T: 8, TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10,
  getParameter: () => null, createTexture: () => ({}), bindTexture: () => {}, texParameteri: () => {} }; gl.texImage2D = (...a) => { gl.uploaded = a[8]; }; return gl; };

// ── the composite light draws (check.mjs MODEL / windFieldLut.test.js): the field multiplied into the muted ground ───────────────────
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const LIGHT = { op: 0.65, baseA: 0.42, end: 7, k: 0.70 / 0.65 };
const SURFACES = { water: [168, 214, 222], land: [236, 236, 232] };
const ground = (surface) => { const m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${SURFACES[surface].join(', ')})`, windBasemapMuteAmount('light', {}), surface === 'water' ? windBasemapWaterL('light', {}) : 1)); return [+m[1], +m[2], +m[3]].map((v) => v / 255); };
const strength = (kn) => Math.min(1, LIGHT.op * (LIGHT.baseA + (1 - LIGHT.baseA) * ss(0, LIGHT.end, kn)) * LIGHT.k);
const tintAt = (kn, c, g) => g.map((v, i) => v * (1 - strength(kn) * (1 - c[i])));
const tints = (field, g) => field.map((s) => tintAt(s[0], s.slice(1, 4), g));
const GROUNDS = { land: ground('land'), water: ground('water') };

const bytes = (data) => Array.from(data).join(',');
const DEFAULT_FIELD = resolveFieldRamp('light', {}), DEFAULT_LEGEND = resolveThemeRamp('light');

describe('off: the lever unset, killed, or not a look', () => {
  it('reads null, and light draws today\'s field, marks and legend', () => {
    for (const w of [{}, null, { __RAW_WIND_LIGHT_LOOK__: 'Deep' }, { __RAW_WIND_LIGHT_LOOK__: true }, { __RAW_WIND_LIGHT_LOOK__: 1 }, { __RAW_WIND_LIGHT_LOOK__: 'dark' }]) {
      expect(windLightLook(w || {})).toBeNull();
      expect(resolveFieldRamp('light', w || {})).toEqual(DEFAULT_FIELD);
      expect(resolveMarkRamp('light', w || {})).toBeNull();
    }
    expect(windInk('light', V2, {})).toEqual(windInk('light', V2, { __RAW_WIND_LIGHT_LOOK__: 'nope' }));
  });
  // The tables each theme drew BEFORE this change, captured from the code at ca42f552 (PR #310's head), not from this code's own default:
  // FNV-1a of the 256-entry RGBA tables at 50 kn (L-V25: the "before" comes from the running code before the edit).
  const BEFORE = { light: { particle: 'c1eeccde', field: '9100656a' }, beach: { particle: '570a703a', field: '724eed40' }, dark: { particle: 'c2ebc33e', field: null } };
  const fnv = (a) => { let h = 2166136261; for (const b of a) h = Math.imul(h ^ b, 16777619); return (h >>> 0).toString(16); };
  it.each([{}, { __RAW_WIND_LIGHT_LOOK__: 'off' }, { __RAW_DISABLE_WIND_LIGHT_LOOK__: true, __RAW_WIND_LIGHT_LOOK__: 'deep' }, { location: { search: '?windLook=nope' } }])(
    'every theme draws the tables it drew before the change (%o)', (w) => {
      for (const theme of ['light', 'beach', 'dark']) {
        expect(fnv(generateRampData(50, resolveMarkRamp(theme, w), theme, w))).toBe(BEFORE[theme].particle);
        const F = resolveFieldRamp(theme, w);
        expect(F ? fnv(generateRampData(50, F, null, w)) : null).toBe(BEFORE[theme].field);
      }
    });
  it('a phone can pick a look from the address (?windLook=), read once per page; the console lever wins, the kill wins over both', () => {
    const page = (search, extra) => ({ location: { search }, ...extra });
    expect(windLightLook(page('?windLook=deep'))).toBe('deep');
    expect(windLightLook(page('?a=1&windLook=ink&b=2'))).toBe('ink');
    expect(windLightLook(page('?windLook=Deep'))).toBeNull();
    expect(windLightLook(page('?windLook=ink-test'))).toBeNull();                  // the whole value, not a prefix
    expect(windLightLook(page('?next=/map?windLook=moderate'))).toBeNull();        // inside another parameter's value: not ours
    expect(windLightLook(page('?windlook=deep'))).toBeNull();
    expect(windLightLook(page(''))).toBeNull();
    expect(windLightLook(page('?windLook=deep', { __RAW_WIND_LIGHT_LOOK__: 'moderate' }))).toBe('moderate');
    expect(windLightLook(page('?windLook=deep', { __RAW_WIND_LIGHT_LOOK__: 'off' }))).toBeNull();
    expect(windLightLook(page('?windLook=deep', { __RAW_DISABLE_WIND_LIGHT_LOOK__: true }))).toBeNull();
    const w = page('?windLook=moderate'); expect(windLightLook(w)).toBe('moderate');
    w.location.search = ''; expect(windLightLook(w)).toBe('moderate');   // a route change that drops the query keeps the page's look
    expect(windLightLook(window)).toBeNull();                             // the test page's own address has none
  });
  it.each(LOOKS)('the kill restores today with the lever set to %s, byte for byte (field table, marks table, the marks\' model)', (look) => {
    const killed = { ...lever(look), __RAW_DISABLE_WIND_LIGHT_LOOK__: true };
    expect(windLightLook(killed)).toBeNull();
    expect(bytes(generateRampData(50, resolveFieldRamp('light', killed), null, killed))).toBe(bytes(generateRampData(50, DEFAULT_FIELD, null, {})));
    expect(resolveMarkRamp('light', killed)).toBeNull();
    expect(windInk('light', V2, killed)).toEqual(windInk('light', V2, {}));
  });
  it('the engine builds the marks table from resolveMarkRamp, which is null when off: the same bytes as the legend\'s own table', () => {
    expect(bytes(generateRampData(50, resolveMarkRamp('light', {}), 'light'))).toBe(bytes(generateRampData(50, null, 'light')));
    expect(ENGINE).toMatch(/generateRampData\(this\._maxWindSpeed, resolveMarkRamp\(activeTheme\), activeTheme\)/);
    expect(ENGINE.match(/resolveMarkRamp\(activeTheme\)/g)).toHaveLength(2);   // render and setTheme
    // a change of look rebuilds the tables at once; with the lever unset the key stays null and nothing rebuilds
    expect(ENGINE.match(/lightLook !== \(this\._lightLook \|\| null\)/g)).toHaveLength(2);
  });
  it.each(LOOKS)('%s: beach and dark never move, and the legend bar never moves', (look) => {
    for (const theme of ['beach', 'dark']) {
      expect(resolveFieldRamp(theme, lever(look))).toEqual(resolveFieldRamp(theme, {}));
      expect(resolveMarkRamp(theme, lever(look))).toBeNull();
      expect(windInk(theme, V2, lever(look))).toEqual(windInk(theme, V2, {}));
    }
    const themes = ['light', 'beach', 'dark'], legends = themes.map((t) => resolveThemeRamp(t)), bars = themes.map((t) => windLegendGradientCSS(t));
    window.__RAW_WIND_LIGHT_LOOK__ = look;
    try {
      themes.forEach((t, i) => { expect(resolveThemeRamp(t)).toEqual(legends[i]); expect(windLegendGradientCSS(t)).toBe(bars[i]); });
      expect(legends[0]).toEqual(THEME_RAMPS.light);
    } finally { delete window.__RAW_WIND_LIGHT_LOOK__; }
  });
});

describe.each(['moderate', 'deep'])('A, %s: a deeper field that keeps light\'s bars', (look) => {
  const F = () => resolveFieldRamp('light', lever(look));
  it('13 Beaufort stops in gamut, the same speeds and alphas as today\'s field', () => {
    expect(F().map((s) => s[0])).toEqual(DEFAULT_FIELD.map((s) => s[0]));
    expect(F().map((s) => s[4])).toEqual(DEFAULT_FIELD.map((s) => s[4]));
    for (const s of F()) for (const c of s.slice(1, 4)) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
  });
  it('the ground under 6-27 kn sits near beach\'s depth or deeper over the muted land, darker than today\'s at every band', () => {
    const now = tints(DEFAULT_FIELD, GROUNDS.land), deeper = tints(F(), GROUNDS.land);
    const band = look === 'moderate' ? [62, 71] : [55, 66];
    F().forEach((s, i) => {
      if (s[0] >= 6 && s[0] <= 27) { expect(lab(deeper[i])[0]).toBeGreaterThanOrEqual(band[0]); expect(lab(deeper[i])[0]).toBeLessThanOrEqual(band[1]); }
      expect(lab(deeper[i])[0]).toBeLessThan(lab(now[i])[0]);
    });
  });
  it('real colour at every band from 6 kn (C* >= 25 over the muted land)', () => {
    tints(F(), GROUNDS.land).forEach((t, i) => { if (F()[i][0] >= 6) expect(lch(t)[1]).toBeGreaterThanOrEqual(25); });
  });
  it('light\'s own hue order: within 20 deg of today\'s field hue over the land at every stop, and within 30 deg of the legend\'s', () => {
    const now = tints(DEFAULT_FIELD, GROUNDS.land), deeper = tints(F(), GROUNDS.land);
    F().forEach((s, i) => {
      expect(hd(lch(deeper[i])[2], lch(now[i])[2])).toBeLessThanOrEqual(20);
      if (i) expect(hd(lch(deeper[i])[2], lch(DEFAULT_LEGEND[i].slice(1, 4))[2])).toBeLessThanOrEqual(30);
    });
  });
  it('the colour-blind floor holds on the muted water AND land: neighbouring tints from 3 kn >= 5 dE2000 for protan, deutan, tritan', () => {
    for (const g of Object.values(GROUNDS)) {
      const t = tints(F().filter((s) => s[0] >= 3), g);
      t.slice(1).forEach((b, i) => expect(worstCvd(t[i], b)).toBeGreaterThanOrEqual(5));
    }
  });
  it('no segment runs through grey: the field\'s weakest colour on the drawn path from 3 to 40 kn is >= 8 C* on both grounds', () => {
    const path = huePathStops(F(), {});
    expect(path.length).toBeGreaterThan(F().length);   // 10-16 kn walks round the wheel (violet, blue, teal, green)
    for (const g of Object.values(GROUNDS)) for (let v = 3; v <= 40; v += 0.25) expect(lch(tintAt(v, sampleRamp(path, v).slice(0, 3), g))[1]).toBeGreaterThanOrEqual(8);
  });
  it('calm is a nameable tint (>= 5 dE00 off the bare ground) and weaker than 3 kn, on both grounds', () => {
    for (const g of Object.values(GROUNDS)) {
      const [calm, three] = tints(F().slice(0, 2), g);
      expect(de(g, calm)).toBeGreaterThanOrEqual(5);
      expect(de(g, calm)).toBeLessThan(de(g, three));
    }
  });
  it('no lightness or chroma stripe from 21 kn up (a stop above or below both neighbours by more than 1 L* / 1 C*), on both grounds', () => {
    for (const g of Object.values(GROUNDS)) {
      const t = tints(F(), g), L = t.map((c) => lch(c)[0]), C = t.map((c) => lch(c)[1]);
      for (let i = 6; i < 12; i++) for (const V of [L, C]) {
        const a = V[i] - V[i - 1], b = V[i] - V[i + 1];
        if (a * b > 0) expect(Math.min(Math.abs(a), Math.abs(b))).toBeLessThanOrEqual(1);
      }
    }
  });
  it('RE-SCOPES dark parity (D-018): from 6 to 21 kn the field is deeper than today\'s, which is dark\'s within 1 dE76', () => {
    const dE76 = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
    const BENCH = [0.86, 0.88, 0.90];   // windFieldLut.test.js's bench ground
    F().forEach((s, i) => {
      if (s[0] < 6 || s[0] > 21) return;
      expect(dE76(BENCH, tintAt(s[0], s.slice(1, 4), BENCH)) - dE76(BENCH, tintAt(s[0], DEFAULT_FIELD[i].slice(1, 4), BENCH))).toBeGreaterThan(1);
    });
  });
  // The streak keeps (or raises) its field's chroma at 10 kn and from 13 kn up. The lilac, periwinkle and blue (3, 6, 11 and 12 kn) cannot
  // be both 14 L* lighter than their field and as colourful (sRGB: blue-violet is vivid only when dark): there it is a paler shade (C* >= 10).
  it('the marks are a brighter shade of the field (dark\'s streak): full brightness, >= 14 L* above it over the land, its hue within 15 deg, as colourful where the hue allows', () => {
    const K = resolveMarkRamp('light', lever(look)), path = huePathStops(F(), {});
    expect(K.map((s) => s[0])).toEqual([0, 3, 6, 10, 11, 12, 13, 14, 15, 16, 21, 27, 33, 40, 47, 55, 63, 75]);   // the Beaufort stops + 11-15 kn on the field's path
    K.forEach((s) => {
      const m = lch(s.slice(1, 4)), f = lch(tintAt(s[0], sampleRamp(path, s[0]).slice(0, 3), GROUNDS.land));
      expect(Math.max(...s.slice(1, 4))).toBeCloseTo(1, 3);
      expect(m[0] - f[0]).toBeGreaterThanOrEqual(13.9);   // 14 as solved; the stops are stored to three decimals
      if (s[0] >= 3) expect(hd(m[2], f[2])).toBeLessThanOrEqual(15.5);   // 15 as solved, stored to three decimals
      if (s[0] === 10 || s[0] >= 13) expect(m[1]).toBeGreaterThanOrEqual(f[1]); else if (s[0] >= 3) expect(m[1]).toBeGreaterThanOrEqual(10);
    });
  });
  it('neighbouring marks keep the colour-blind floor, as dark\'s streaks (its legend) do', () => {
    const K = resolveMarkRamp('light', lever(look)).filter((s) => F().some((f) => f[0] === s[0]));   // the 13 Beaufort bands
    expect(K).toHaveLength(13);
    K.slice(1).forEach((b, i) => expect(worstCvd(K[i].slice(1, 4), b.slice(1, 4))).toBeGreaterThanOrEqual(5));
  });
  it('the streaks never take a straight line through grey: 10-16 kn walk the field\'s own path (blue, azure, teal), every segment keeps > 3/4', () => {
    const K = resolveMarkRamp('light', lever(look)), path = huePathStops(F(), {});
    for (let i = 1; i < K.length; i++) expect(kept(K[i - 1], K[i])).toBeGreaterThan(0.75);
    expect(huePathStops(K, {})).toBe(K);   // nothing for the path to add, so no kill can change it
    for (let v = 10; v <= 16; v += 0.25) {   // the drawn streak (its full-brightness colour) keeps the drawn field's hue within 15 deg
      const m = lch(sampleRamp(K, v).slice(0, 3)), f = lch(tintAt(v, sampleRamp(path, v).slice(0, 3), GROUNDS.land));
      expect(m[1]).toBeGreaterThan(20); expect(hd(m[2], f[2])).toBeLessThanOrEqual(30);
    }
  });
  it('the field\'s path is drawn whatever older kill is set (an older kill stands aside while a look is on)', () => {
    const want = bytes(generateRampData(50, F(), null, {}));
    for (const k of ['__RAW_DISABLE_WIND_HUE_PATH__', '__RAW_DISABLE_WIND_LIGHT_FASTBAND__', '__RAW_DISABLE_WIND_FIELD_RAMP__', '__RAW_DISABLE_WIND_MIDBAND_REFINE__']) {
      const w = { ...lever(look), [k]: true }, gl = fakeGl();
      buildFieldRampTexture(gl, 50, 'light', w);
      expect(bytes(gl.uploaded)).toBe(want);
    }
  });
  it('draws dark\'s streak method in light at the bench-tuned strength and ring, with no white mixed in (the marks table is already lifted)', () => {
    expect(WIND_LIGHT_LOOK).toEqual({ moderate: { mode: 2, opacity: 0.8, ring: 0.25, white: 0 }, deep: { mode: 2, opacity: 1.0, ring: 0.25, white: 0 },
      ink: { mode: 1, opacity: 0.9, spine: 0, cap: 0.5 } });
    const k = windInk('light', V2, lever(look));
    expect(k).toMatchObject({ mode: 2, glow: true, on: false, white: 0, opacity: WIND_LIGHT_LOOK[look].opacity, spine: WIND_LIGHT_LOOK[look].ring });
    expect(windInk('light', V2, { ...lever(look), __RAW_WIND_GLOW_OPACITY__: 0.6 }).opacity).toBe(0.6);   // the bench tunes through the glow sub-levers
  });
});

describe('B, ink: today\'s field, ink\'s own warm colours, a cover cap', () => {
  const K = () => resolveMarkRamp('light', lever('ink'));
  it('draws today\'s field, and the legend\'s marks except 27-47 kn', () => {
    expect(resolveFieldRamp('light', lever('ink'))).toEqual(DEFAULT_FIELD);
    K().forEach((s, i) => { if (s[0] < 27 || s[0] > 47) expect(s).toEqual(DEFAULT_LEGEND[i]); else expect(s).not.toEqual(DEFAULT_LEGEND[i]); });
  });
  it('27-47 kn are never a darkened yellow: over the tinted muted water and land each mark keeps out of olive, darkens 7-13 L*, and stands >= 10 dE00 from its neighbours', () => {
    for (const g of Object.values(GROUNDS)) {
      const under = tints(DEFAULT_FIELD, g), marks = K().map((s, i) => under[i].map((v, j) => v * (1 - 0.9 * (1 - s[j + 1]))));
      K().forEach((s, i) => {
        if (s[0] < 27 || s[0] > 47) return;
        const q = lch(marks[i]), dL = q[0] - lab(under[i])[0];
        if (s[0] >= 33) expect(q[2]).toBeLessThanOrEqual(86);   // olive starts where a dark warm colour turns yellow
        else expect(q[2]).toBeGreaterThanOrEqual(108);           // 27 kn: a green, not an olive
        expect(dL).toBeLessThanOrEqual(-7); expect(dL).toBeGreaterThanOrEqual(-13);
        expect(de(marks[i - 1], marks[i])).toBeGreaterThanOrEqual(10);
        expect(de(marks[i], marks[i + 1])).toBeGreaterThanOrEqual(10);
      });
    }
  });
  it('draws ink in light at its own strength with a cover cap; the old ink lever draws no cap', () => {
    expect(windInk('light', V2, lever('ink'))).toMatchObject({ mode: 1, on: true, glow: false, opacity: WIND_LIGHT_LOOK.ink.opacity, cap: WIND_LIGHT_LOOK.ink.cap });
    expect(windInk('light', V2, { __RAW_WIND_INK__: true }).cap).toBeUndefined();
    expect(windInk('light', V2, { ...lever('ink'), __RAW_WIND_INK_CAP__: 0.7 }).cap).toBe(0.7);
    for (const bad of [0, 1.5, '0.5']) expect(windInk('light', V2, { ...lever('ink'), __RAW_WIND_INK_CAP__: bad }).cap).toBe(WIND_LIGHT_LOOK.ink.cap);
  });
  it('the cap eases from full strength under 40% cover to `cap` from 85%, and is 1 at a cap of 1', () => {
    expect(inkCapAt(0, 0.5)).toBe(1); expect(inkCapAt(0.4, 0.5)).toBe(1);
    expect(inkCapAt(0.85, 0.5)).toBeCloseTo(0.5, 10); expect(inkCapAt(1, 0.5)).toBeCloseTo(0.5, 10);
    expect(inkCapAt(0.625, 0.5)).toBeCloseTo(0.75, 10);
    for (const c of [0, 0.5, 1]) expect(inkCapAt(c, 1)).toBe(1);
  });
  it('is wired: SCREEN_FS scales only the ink branch by the cap; the copy pass and every other model send a cap of 1', () => {
    expect(SCREEN_FS).toContain(GLSL_INK_COVER);
    expect(SCREEN_FS).toContain('vec4(mix(vec3(1.0), color.rgb, u_opacity * inkCapOf(u_screen)), 1.0)');
    expect(GLSL_INK_COVER).toContain('if (u_ink_cap > 0.999) return 1.0;');
    expect(ENGINE).toMatch(/'u_glow'\), 0\); gl\.uniform1f\(gl\.getUniformLocation\(this\.screenProgram, 'u_ink_cap'\), 1\);/);
    expect(ENGINE).toMatch(/'u_ink_cap'\), _ink\.on && _ink\.cap > 0 && _ink\.cap < 1 \? _ink\.cap : 1\)/);
  });
});
