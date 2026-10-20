import { createHash } from 'crypto';
import { getThemedWaveColorJS, applyThemeWaveScale, BASE_CUSTOM_COLOR_SCALES } from './colorScales';
import { hasMarineWavePalette, marineWaveLegendGradientCSS, marineWaveLegend, WAVE_PALETTES, widenWavePalette, MARINE_WAVE_PALETTE_ID, MARINE_WAVE_PALETTE_IDS, MARINE_WAVE_PALETTE_GLSL, MARINE_WAVE_PALETTE_CALL_GLSL, marineWavePaletteGlsl, sampleMarineWavePalette, ARROW_PCT, marineWaveHeightScale } from './marineWavePalette';

const hash = values => createHash('sha256').update(typeof values === 'string' ? values : JSON.stringify(values)).digest('hex');
const heights = [0, .15, .3, .6, .9, 1.2, 1.8, 2.4, 3, 3.6, 4.2, 5, 6.1, 8, 10];
// Independent pre-edit baseline receipt: evidence/before/gpu-ramp.json (JS legend readback).
const surfHashes = {
  beach: '602bf3fac632d4b734e0d3000c0adadd70883f9b359f207cd3b79212ef3b7413',
  light: '741ea3b1dfa38097c6df69cfa9f85f2e764f3c7615635ae2ea9bd14dcb09c4cb',
  dark: 'e2cf4827150e358ec1cb4467a09df9f08823045924b1b4b58e70dc59c14cd24c',
};
// v1 as the module drew it before the V2 palettes (dev 6021c2cc1), hashed before this file changed: the V2 kill must give these back.
const V1 = {
  glsl: 'a4a9235e5b30c46576c86d4b909ab3df757676006e647bcbedeb359ba92d84ca',
  call: '2d09ac61950be8964fcd3a0cb918ceb7bfaaa091b39fff6a07b96d6fc4012a94',
  samples: 'feb34e389c79a6aa10e781edbb36c1842280b96dc84c20008cf63cb041d05eca',   // light then beach, 0 to 11 m every 0.01 m
  css: '7fda44fbf352fdafdb9c4473bda35880d7fdb2fcba6ba9f0a217efa0ae758dfd',      // both themes x the 6.1 m and 3.05 m axes
};
// Beach as it drew before #411 (dev 6021c2cc1), hashed from that module: D-035 keeps beach on it, byte for byte.
const BEACH_V1 = {
  samples: 'b89f9ce3c19330e1515f55e2422d4012bf3c23727afc262f14019f6dda60d53b',   // beach, 0 to 11 m every 0.01 m
  css: '76ac878990685de49ccd7320262658db633fd400ff3ccbb2f7a57c32f6a4e167',       // beach legend on the 6.1 m and 3.05 m axes
  glsl: 'cd6e171d71887c61f84055f1cc40305416c6b5d82136cf2883d428981f1a9990',      // the shader's beach branch
};
const GLSL_411 = '64648a9a1e98c227a003877e8eee7c417e22b437bb30c216cc73d8fd27ca6c5c';   // #411's shader (beach v2): D-035's kill restores it
// v2 at #411's head (c40cbe67f = dev f550d2502's tree), hashed before the 16 m encoding: its kill (window.__RAW_DISABLE_WAVE_HEIGHT_16M__) must give these
// back. samples: light then beach, 0 to 17 m every 0.01 m; legend: light ft, light m, beach ft, beach m on the 3.05 m axis.
const V2_AT_10M = {
  glsl: '64648a9a1e98c227a003877e8eee7c417e22b437bb30c216cc73d8fd27ca6c5c',
  samples: '0e4ba98527873c005f8737095b110a65c86a62a8cae68006759fc0b5ae3003c9',
  legend: '4d786a679fa88e60279c0ea3aa7bb5ef84e674ed8d1e499a61ae392b06fa72c0',
};
const KILL_16M = { __RAW_DISABLE_WAVE_HEIGHT_16M__: true };
// Beach draws v1 by default (D-035); v2's beach is read under that decision's kill.
const KILL_BEACH_V1 = { __RAW_DISABLE_WAVE_BEACH_V1__: true };
// The 16 m extension (wave-polish.mjs --extend 16), pinned colour for colour.
const V2_H16 = { cap: 16, light: [72, 21, 66], beach: [134, 59, 86], over: { light: [88, 0, 2], beach: [146, 1, 115] } };
const lightness = rgb => {
  const linear = rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  const y = .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : y * 24389 / 27;
};
// OKLab L and C (Ottosson 2020) of a 0-255 colour, unrounded.
const oklab = rgb => {
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return { L: .2104542553 * l + .7936177850 * m - .0040720468 * s, C: Math.hypot(1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .8086757660 * s) };
};
const withWindow = (levers, fn) => jest.isolateModules(() => {
  Object.assign(window, levers);
  try { fn(require('./marineWavePalette')); } finally { Object.keys(levers).forEach(k => delete window[k]); }
});
const v1Samples = palette => { const out = []; for (const t of ['light', 'beach']) for (let i = 0; i <= 1100; i++) out.push(palette.sampleMarineWavePalette(i / 100, t)); return out; };
const v1Css = palette => { const css = []; for (const t of ['light', 'beach']) for (const bp of [[0, .61, 1.22, 2.44, 3.66, 6.1], [0, .3, .61, 1.22, 1.83, 3.05]]) css.push(palette.marineWaveLegendGradientCSS({ unit: 'm', breakpoints: bp }, t)); return css; };

// The GPU's table, read back from the GLSL string itself: each theme's branch, its above-cap test and its mix() segments.
function glslEval(glsl, theme) {
  const beachAt = glsl.indexOf('if (theme > 1.5) {'), lightAt = glsl.indexOf('else {'), endAt = glsl.indexOf('return vec3(1.0);');
  const branch = theme === 'beach' ? glsl.slice(beachAt, lightAt) : glsl.slice(lightAt, endAt);
  const vec = s => s.split(',').map(Number);
  const over = /if \(height > ([\d.]+)\) return vec3\(([^)]*)\);/.exec(branch);
  const segs = [...branch.matchAll(/if \(h <= ([\d.]+)\) return mix\(vec3\(([^)]*)\), vec3\(([^)]*)\), \(h - ([\d.]+)\) \/ ([\d.]+)\);/g)]
    .map(m => ({ hi: +m[1], a: vec(m[2]), b: vec(m[3]), lo: +m[4], span: +m[5] }));
  const cap = +/clamp\(height, 0\.0, ([\d.]+)\)/.exec(glsl)[1];
  return height => {
    if (over && height > +over[1]) return vec(over[2]);
    const h = Math.min(cap, Math.max(0, height));
    const s = segs.find(q => h <= q.hi);
    const t = (h - s.lo) / s.span;
    return s.a.map((v, i) => v + (s.b[i] - v) * t);
  };
}

it('keeps the complete dark height ramp identical to the pre-edit baseline', () => {
  expect(hasMarineWavePalette('dark')).toBe(false);
  expect(hash(Array.from({ length: 1001 }, (_, i) => getThemedWaveColorJS(i / 100, 'dark'))))
    .toBe('afb4054d64c1400579706578a192899c1ec818fde76b622019cab78f167c2b8e');
});

it.each(['beach', 'light', 'dark'])('preserves %s surf-mode colours', theme => {
  expect(hash(heights.map(h => getThemedWaveColorJS(h, theme, true)))).toBe(surfHashes[theme]);
});

it('only the height wash calls the table: surf mode and dark keep their own paths', () => {
  expect(MARINE_WAVE_PALETTE_CALL_GLSL).toBe('if (surfMode < 0.5 && theme > 0.5) return marineWaveHeightColor(h, theme);');
  expect(hash(MARINE_WAVE_PALETTE_CALL_GLSL)).toBe(V1.call);
});

it('preserves breakpoints, units and raster transparency through theme switches', () => {
  const names = ['wave_height', 'wave', 'swell_wave_height', 'secondary_swell_wave_height', 'wind_wave_height'];
  const before = names.map(k => ({ unit: BASE_CUSTOM_COLOR_SCALES[k].unit, bp: BASE_CUSTOM_COLOR_SCALES[k].breakpoints.slice(), alpha: BASE_CUSTOM_COLOR_SCALES[k].colors.map(c => c[3]) }));
  for (const theme of ['beach', 'light', 'dark', 'beach']) {
    applyThemeWaveScale(theme);
    names.forEach((k, i) => {
      expect(BASE_CUSTOM_COLOR_SCALES[k].unit).toBe(before[i].unit);
      expect(BASE_CUSTOM_COLOR_SCALES[k].breakpoints).toEqual(before[i].bp);
      expect(BASE_CUSTOM_COLOR_SCALES[k].colors.map(c => c[3])).toEqual(before[i].alpha);
    });
  }
});

it('the reload kill restores both GLSL and legend to the existing paths', () => {
  withWindow({ __RAW_DISABLE_MARINE_WAVE_PALETTE__: true }, palette => {
    expect(palette.hasMarineWavePalette('beach')).toBe(false);
    expect(palette.MARINE_WAVE_PALETTE_GLSL).toBe('');
    expect(palette.MARINE_WAVE_PALETTE_CALL_GLSL).toBe('');
    expect(palette.marineWaveLegendGradientCSS({ unit: 'm', breakpoints: [0, 6.1] }, 'light')).toBeNull();
    expect(palette.marineWaveLegend({ unit: 'm', breakpoints: [0, 6.1] }, 'light', 'ft')).toBeNull();
  });
});

describe('the V2 kill (window.__RAW_DISABLE_WAVE_PALETTE_V2__) restores v1 exactly', () => {
  it('GLSL, samples and legend CSS hash to the pre-edit module', () => {
    withWindow({ __RAW_DISABLE_WAVE_PALETTE_V2__: true }, palette => {
      expect(palette.MARINE_WAVE_PALETTE_ID).toBe('v1');
      expect(hash(palette.MARINE_WAVE_PALETTE_GLSL)).toBe(V1.glsl);
      expect(hash(palette.MARINE_WAVE_PALETTE_CALL_GLSL)).toBe(V1.call);
      expect(hash(v1Samples(palette))).toBe(V1.samples);
      expect(hash(v1Css(palette))).toBe(V1.css);
      const legend = palette.marineWaveLegend({ unit: 'm', breakpoints: [0, .61, 1.22, 2.44, 3.66, 6.1] }, 'beach', 'ft');
      expect(legend.stops).toBeUndefined();      // v1 keeps the scale's own ticks (buildStops) and no arrow
      expect(legend.clipPath).toBeUndefined();
    });
  });

  it('v1 keeps its own bands (the properties its tests pinned before V2)', () => {
    withWindow({ __RAW_DISABLE_WAVE_PALETTE_V2__: true }, palette => {
      const L = (h, t) => lightness(palette.sampleMarineWavePalette(h, t));
      const bands = [1.2, 1.8, 2.4, 3, 3.6, 4.2, 5].map(h => L(h, 'beach'));
      for (let i = 1; i < bands.length; i++) expect(bands[i - 1] - bands[i]).toBeGreaterThan(5);
      expect(L(1.2, 'light') - L(2.4, 'light')).toBeGreaterThan(20);
      expect(L(5, 'light') - L(2.4, 'light')).toBeGreaterThan(25);
      const scale = { unit: 'm', breakpoints: [0, .61, 1.22, 2.44, 3.66, 6.1] };
      for (const t of ['beach', 'light']) {
        const css = palette.marineWaveLegendGradientCSS(scale, t);
        for (const h of [0, .6, 1.2, 2.4, 5, 6.1]) expect(css).toContain(`rgb(${palette.sampleMarineWavePalette(h, t).join(',')}) ${(h / 6.1 * 100).toFixed(3)}%`);
      }
    });
  });
});

describe("the 16 m kill (window.__RAW_DISABLE_WAVE_HEIGHT_16M__) with D-035's beach kill restores #411's 10 m v2 exactly", () => {
  it('GLSL, samples to 17 m and legend hash to #411 head', () => {
    withWindow({ ...KILL_16M, ...KILL_BEACH_V1 }, palette => {
      const samples = []; for (const t of ['light', 'beach']) for (let i = 0; i <= 1700; i++) samples.push(palette.sampleMarineWavePalette(i / 100, t));
      const legend = []; for (const t of ['light', 'beach']) for (const u of ['ft', 'm']) legend.push(palette.marineWaveLegend({ unit: 'm', breakpoints: [0, .3, .61, 1.22, 1.83, 3.05] }, t, u));
      expect(palette.MARINE_WAVE_PALETTE_ID).toBe('v2');
      expect(hash(palette.MARINE_WAVE_PALETTE_GLSL)).toBe(V2_AT_10M.glsl);
      expect(hash(palette.MARINE_WAVE_PALETTE_CALL_GLSL)).toBe(V1.call);
      expect(hash(samples)).toBe(V2_AT_10M.samples);
      expect(hash(legend)).toBe(V2_AT_10M.legend);
    });
  });
  it('v2 at 16 m keeps every anchor under 10 m as it was: one stop more, darker, and the above-cap state moved up', () => {
    const p = WAVE_PALETTES.v2, w = widenWavePalette(p);
    expect(w.heights).toEqual([...p.heights, 16]);
    expect(w.cap).toBe(16);
    for (const t of ['light', 'beach']) {
      expect(w[t].slice(0, -1)).toEqual(p[t]);
      expect(oklab(w[t][w[t].length - 1]).L).toBeLessThan(oklab(p[t][p[t].length - 1]).L);
    }
    expect(widenWavePalette(WAVE_PALETTES.v1)).toBe(WAVE_PALETTES.v1);   // v1 has no extension: it stays at 10 m
  });
});

// v2 = the owner's pick of the A/B (DECISIONS D-033, 2026-10-20: "Ship light A and beach B"), as the default build draws it (the
// 16 m encoding, its extension) and as the 16 m kill does (#411's 10 m table).
describe.each([['v2', 16], ['v2', 10]])('palette %s capped at %i m', (id, top) => {
  const P = top === 16 ? widenWavePalette(WAVE_PALETTES[id]) : WAVE_PALETTES[id];
  // Beach draws v1 by default (D-035): v2's beach table is read under that decision's kill, light's by default.
  const load = (fn, theme = 'light') => withWindow({ ...(top === 10 ? KILL_16M : {}), ...(theme === 'beach' ? KILL_BEACH_V1 : {}) }, fn);

  it('ships by default, with only v1 behind the kill and no candidate lever left', () => {
    expect(MARINE_WAVE_PALETTE_ID).toBe('v2');
    expect(Object.keys(WAVE_PALETTES).sort()).toEqual(['v1', 'v2']);
    withWindow({ __RAW_WAVE_PALETTE_V2__: 'B' }, palette => expect(palette.MARINE_WAVE_PALETTE_ID).toBe('v2'));   // the A/B lever is gone
    load(palette => expect(palette.marineWaveHeightScale('light')).toBe(top));   // the encoder's ceiling is this table's cap
  });

  it('is light candidate A and beach candidate B of the owner A/B, colour for colour', () => {
    const B = WAVE_PALETTES[id];   // the 10 m table the owner picked; the 16 m extension is pinned below it
    expect(B.light).toEqual([[228, 230, 144], [165, 227, 185], [29, 222, 224], [78, 166, 206], [82, 113, 187], [74, 68, 158], [66, 25, 132]]);
    expect(B.beach).toEqual([[195, 254, 255], [119, 221, 244], [1, 188, 243], [78, 134, 230], [156, 98, 164], [164, 85, 110], [160, 60, 58]]);
    // Beach's flag: B's blue (46, 72, 223) drew LIGHTER than the brick cap over beach's water; re-solved darker as drawn (D-033 note).
    expect(B.over).toEqual({ light: [105, 9, 0], beach: [120, 26, 174] });
    expect(B.h16).toEqual(V2_H16);
  });

  it.each(['light', 'beach'])('%s: lightness falls at every 0.01 m from 0 m to the cap, then the above-cap state is no lighter', theme => {
    // The GPU draws the table unrounded (mix() of the anchors), so read it that way.
    const at = h => { const H = P.heights, C = P[theme]; const i = Math.max(0, H.findIndex((x, k) => k && h <= x) - 1); const t = (h - H[i]) / (H[i + 1] - H[i]); return C[i].map((v, c) => v + (C[i + 1][c] - v) * t); };
    let last = Infinity;
    for (let i = 0; i <= P.cap * 100; i++) {
      const L = oklab(at(i / 100)).L;
      expect(L).toBeLessThan(last);
      last = L;
    }
    expect(oklab(P.over[theme]).L).toBeLessThanOrEqual(oklab(P[theme][P[theme].length - 1]).L);
    for (let i = 1; i < P[theme].length; i++) expect(oklab(P[theme][i]).L).toBeLessThan(oklab(P[theme][i - 1]).L);
  });

  it.each(['light', 'beach'])('%s: never runs through grey (D-019): OKLCH C >= 0.04 on the path the GPU draws', theme => {
    for (let i = 0; i <= P.cap * 100; i++) expect(oklab(sampleMarineWavePalette(i / 100, theme, P)).C).toBeGreaterThan(0.04);
  });

  it.each(['light', 'beach'])('%s: the GLSL table, the JS sampler and the legend agree exactly', theme => {
    load(palette => {
      const gpu = glslEval(palette.MARINE_WAVE_PALETTE_GLSL, theme);
      for (let i = 0; i <= (P.cap + 3) * 50; i++) {
        const h = i / 50, js = palette.sampleMarineWavePalette(h, theme), g = gpu(h).map(v => v * 255);
        // The half texel under the cap is the GPU's filtering edge (texel 254 blending into 255), never a true height: skip it. At a
        // 10 m cap no 0.02 m sample lands in it (9.98-10); at 16 m one does (15.98).
        if (h > P.cap - P.cap / 510 && h < P.cap) continue;
        g.forEach((v, c) => expect(Math.abs(v - js[c])).toBeLessThanOrEqual(0.5 + 1e-6));   // JS rounds to whole RGB; the GPU keeps the fraction
      }
      // The above-cap state starts half a texel under a cap at the encoder's ceiling (10 m, or 16 m on the wider encoding): a cell at
      // or above it reads exactly the cap, one texel under it (9.96 m / 15.94 m) reads as itself.
      expect(gpu(P.cap)).toEqual(P.over[theme].map(v => +(v / 255).toFixed(9)));
      expect(gpu(254 / 255 * P.cap).map(v => Math.round(v * 255))).toEqual(palette.sampleMarineWavePalette(254 / 255 * P.cap, theme));
      // The legend: each anchor's colour at its own share of the bar, the arrow in the above-cap colour, labels on their colours.
      const legend = palette.marineWaveLegend({ unit: 'm', breakpoints: [0, .3, .61, 1.22, 1.83, 3.05] }, theme, 'ft');
      const end = 100 - ARROW_PCT;
      P.heights.forEach((h, i) => {
        const pct = i / (P.heights.length - 1) * end;
        expect(legend.gradientCSS).toContain(`rgb(${P[theme][i].join(',')}) ${pct.toFixed(3)}%`);
        expect(legend.stops[i].pct).toBeCloseTo(pct, 9);
        // Between two stops CSS and mix() are both linear in encoded sRGB: a quarter of the way along is the same colour.
        if (i) { const hq = P.heights[i - 1] + (h - P.heights[i - 1]) * 0.25; const css = P[theme][i - 1].map((v, c) => v + (P[theme][i][c] - v) * 0.25); gpu(hq).forEach((v, c) => expect(v * 255).toBeCloseTo(css[c], 6)); }
      });
      expect(legend.gradientCSS).toContain(`rgb(${P.over[theme].join(',')}) ${end}%, rgb(${P.over[theme].join(',')}) 100%)`);
      expect(legend.clipPath).toBe(`polygon(0 0, ${end}% 0, 100% 50%, ${end}% 100%, 0 100%)`);
    }, theme);
  });

  it('labels the ticks in the user\'s unit, the last one open-ended, none dropped for crowding', () => {
    load(palette => {
      const ft = palette.marineWaveLegend({ unit: 'm', breakpoints: [0, 6.1] }, 'light', 'ft').stops.map(t => t.label);
      const m = palette.marineWaveLegend({ unit: 'm', breakpoints: [0, 6.1] }, 'light', 'm').stops.map(t => t.label);
      expect(ft).toEqual(P.heights.map((h, i) => { const v = h * 3.28084; const s = v < 1 ? v.toFixed(1) : `${Math.round(v)}`; return i === P.heights.length - 1 ? `${s}+` : s; }));
      expect(m[m.length - 1]).toBe(`${Math.round(P.cap)}+`);
      const gaps = palette.marineWaveLegend({ unit: 'm', breakpoints: [0, 6.1] }, 'light', 'ft').stops.slice(1).map((t, i, a) => t.pct - (i ? a[i - 1].pct : 0));
      gaps.forEach(g => expect(g).toBeGreaterThanOrEqual(12));   // legendTicks.dropCollisions' minimum gap: every label survives
      expect(palette.marineWaveLegend({ unit: 'm', breakpoints: [0, 6.1] }, 'dark', 'ft')).toBeNull();
    });
  });

  it('generates the GLSL it ships from the same tables (light v2, beach v1 by D-035; beach v2 under its kill)', () => {
    load(palette => expect(palette.MARINE_WAVE_PALETTE_GLSL).toBe(marineWavePaletteGlsl(P)), 'beach');
    if (top === 16) expect(MARINE_WAVE_PALETTE_GLSL).toBe(marineWavePaletteGlsl(P, WAVE_PALETTES.v1));   // the default build
    if (top === 10) load(palette => expect(hash(palette.MARINE_WAVE_PALETTE_GLSL)).toBe(GLSL_411), 'beach');   // #411's shader
  });
});

it('the legend falls back to the scale for non-height bars and dark', () => {
  expect(marineWaveLegendGradientCSS({ unit: 'kn', breakpoints: [0, 1] }, 'light')).toBeNull();
  expect(marineWaveLegend({ unit: 'kn', breakpoints: [0, 1] }, 'light', 'ft')).toBeNull();
  expect(marineWaveLegend({ unit: 'm', breakpoints: [0, 6.1] }, 'dark', 'ft')).toBeNull();
});

// D-035 (owner 2026-10-20: "I really like v1 color scheme heatmap for Beach mode. How do we stick with that?"): beach draws v1,
// exactly as before #411, while light draws v2 (at 16 m, D-034). This block is the lock: a change to beach's wave colours fails here
// and needs a new owner decision, whatever another session's palette work proposes.
describe('D-035: beach draws v1 exactly; light draws v2', () => {
  const CLAMP10 = 'h = min(h, 10.0); ';   // beach's own 10 m cap inside the shader when light's reaches 16 m (no change below 10 m)
  const branch = (glsl, theme) => glsl.slice(glsl.indexOf(theme === 'beach' ? 'if (theme > 1.5) {' : 'else {'), glsl.indexOf(theme === 'beach' ? 'else {' : 'return vec3(1.0);'));
  it('picks v1 for beach and v2 for light by default', () => {
    expect(MARINE_WAVE_PALETTE_IDS).toEqual({ light: 'v2', beach: 'v1' });
  });
  it('beach samples, legend and shader branch hash to beach before #411', () => {
    const samples = []; for (let i = 0; i <= 1100; i++) samples.push(sampleMarineWavePalette(i / 100, 'beach'));
    expect(hash(samples)).toBe(BEACH_V1.samples);
    expect(hash([[0, .61, 1.22, 2.44, 3.66, 6.1], [0, .3, .61, 1.22, 1.83, 3.05]].map(bp => marineWaveLegendGradientCSS({ unit: 'm', breakpoints: bp }, 'beach')))).toBe(BEACH_V1.css);
    // The beach branch is v1's text with its own 10 m clamp in front (light's cap is 16 m); with light at 10 m it is v1's text alone.
    const b = branch(MARINE_WAVE_PALETTE_GLSL, 'beach');
    expect(b.startsWith(`if (theme > 1.5) { ${CLAMP10}`)).toBe(true);
    expect(hash(b.replace(CLAMP10, ''))).toBe(BEACH_V1.glsl);
    withWindow(KILL_16M, palette => expect(hash(branch(palette.MARINE_WAVE_PALETTE_GLSL, 'beach'))).toBe(BEACH_V1.glsl));
    expect(marineWaveHeightScale('beach')).toBe(10);   // beach's uploads keep the 10 m byte
    const legend = marineWaveLegend({ unit: 'm', breakpoints: [0, .61, 1.22, 2.44, 3.66, 6.1] }, 'beach', 'ft');
    expect(legend.stops).toBeUndefined();     // v1's own value axis and ticks (buildStops), no arrow
    expect(legend.clipPath).toBeUndefined();
    expect(getThemedWaveColorJS(3, 'beach')).toEqual(sampleMarineWavePalette(3, 'beach', WAVE_PALETTES.v1));   // the JS mirror follows
  });
  it('light keeps v2: its shader branch, samples and arrowed legend', () => {
    expect(branch(MARINE_WAVE_PALETTE_GLSL, 'light')).toBe(branch(marineWavePaletteGlsl(widenWavePalette(WAVE_PALETTES.v2)), 'light'));   // v2 at 16 m (D-034)
    expect(sampleMarineWavePalette(3, 'light')).toEqual(sampleMarineWavePalette(3, 'light', WAVE_PALETTES.v2));
    expect(marineWaveLegend({ unit: 'm', breakpoints: [0, 6.1] }, 'light', 'ft').clipPath).toBeDefined();
  });
  it('the kills: the beach kill draws v2 in beach (at 16 m, or #411 exactly with the 16 m kill); the V2 kill draws v1 in both', () => {
    withWindow(KILL_BEACH_V1, palette => {
      expect(palette.MARINE_WAVE_PALETTE_IDS).toEqual({ light: 'v2', beach: 'v2' });
      expect(palette.MARINE_WAVE_PALETTE_GLSL).toBe(marineWavePaletteGlsl(widenWavePalette(WAVE_PALETTES.v2)));   // what #415 merged
    });
    withWindow({ ...KILL_BEACH_V1, ...KILL_16M }, palette => expect(hash(palette.MARINE_WAVE_PALETTE_GLSL)).toBe(GLSL_411));
    withWindow({ __RAW_DISABLE_WAVE_PALETTE_V2__: true }, palette => {
      expect(palette.MARINE_WAVE_PALETTE_IDS).toEqual({ light: 'v1', beach: 'v1' });
      expect(hash(palette.MARINE_WAVE_PALETTE_GLSL)).toBe(V1.glsl);
    });
  });
});
