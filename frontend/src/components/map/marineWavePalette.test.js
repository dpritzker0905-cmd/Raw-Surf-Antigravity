import { createHash } from 'crypto';
import { getThemedWaveColorJS, applyThemeWaveScale, BASE_CUSTOM_COLOR_SCALES } from './colorScales';
import { hasMarineWavePalette, marineWaveLegendGradientCSS, marineWaveLegend, WAVE_PALETTES, MARINE_WAVE_PALETTE_ID, MARINE_WAVE_PALETTE_IDS, MARINE_WAVE_PALETTE_GLSL, MARINE_WAVE_PALETTE_CALL_GLSL, marineWavePaletteGlsl, sampleMarineWavePalette, ARROW_PCT } from './marineWavePalette';

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

// v2 = the owner's pick of the A/B (DECISIONS D-033, 2026-10-20: "Ship light A and beach B"). Kept in a describe.each so a
// future candidate can be pinned the same way.
describe.each(['v2'])('palette %s', id => {
  const P = WAVE_PALETTES[id];
  // Beach draws v1 by default (D-035): v2's beach table is read under that decision's kill, light's by default.
  const load = (fn, theme = 'light') => withWindow(theme === 'beach' ? { __RAW_DISABLE_WAVE_BEACH_V1__: true } : {}, fn);

  it('ships by default, with only v1 behind the kill and no candidate lever left', () => {
    expect(MARINE_WAVE_PALETTE_ID).toBe('v2');
    expect(Object.keys(WAVE_PALETTES).sort()).toEqual(['v1', 'v2']);
    withWindow({ __RAW_WAVE_PALETTE_V2__: 'B' }, palette => expect(palette.MARINE_WAVE_PALETTE_ID).toBe('v2'));   // the A/B lever is gone
  });

  it('is light candidate A and beach candidate B of the owner A/B, colour for colour', () => {
    expect(P.light).toEqual([[228, 230, 144], [165, 227, 185], [29, 222, 224], [78, 166, 206], [82, 113, 187], [74, 68, 158], [66, 25, 132]]);
    expect(P.beach).toEqual([[195, 254, 255], [119, 221, 244], [1, 188, 243], [78, 134, 230], [156, 98, 164], [164, 85, 110], [160, 60, 58]]);
    // Beach's flag: B's blue (46, 72, 223) drew LIGHTER than the brick cap over beach's water; re-solved darker as drawn (D-033 note).
    expect(P.over).toEqual({ light: [105, 9, 0], beach: [120, 26, 174] });
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
        g.forEach((v, c) => expect(Math.abs(v - js[c])).toBeLessThanOrEqual(0.5 + 1e-6));   // JS rounds to whole RGB; the GPU keeps the fraction
      }
      // The above-cap state starts half a texel under a cap at the encoder's 10 m ceiling: a 10 m+ cell reads exactly 10.0, a 9.96 m one 9.96.
      expect(gpu(10)).toEqual(P.over[theme].map(v => +(v / 255).toFixed(9)));
      expect(gpu(254 / 255 * 10).map(v => Math.round(v * 255))).toEqual(palette.sampleMarineWavePalette(254 / 255 * 10, theme));
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

  it('generates the GLSL it ships from the same tables (light v2, beach v1), and #411 exactly under the beach kill', () => {
    expect(MARINE_WAVE_PALETTE_GLSL).toBe(marineWavePaletteGlsl(P, WAVE_PALETTES.v1));
    load(palette => {
      expect(palette.MARINE_WAVE_PALETTE_GLSL).toBe(marineWavePaletteGlsl(P));
      expect(hash(palette.MARINE_WAVE_PALETTE_GLSL)).toBe(GLSL_411);   // the shader #411 merged (f550d250)
    }, 'beach');
  });
});

it('the legend falls back to the scale for non-height bars and dark', () => {
  expect(marineWaveLegendGradientCSS({ unit: 'kn', breakpoints: [0, 1] }, 'light')).toBeNull();
  expect(marineWaveLegend({ unit: 'kn', breakpoints: [0, 1] }, 'light', 'ft')).toBeNull();
  expect(marineWaveLegend({ unit: 'm', breakpoints: [0, 6.1] }, 'dark', 'ft')).toBeNull();
});

// D-035 (owner 2026-10-20: "I really like v1 color scheme heatmap for Beach mode. How do we stick with that?"): beach draws v1,
// exactly as before #411, while light draws v2. This block is the lock: a change to beach's wave colours fails here and needs a new
// owner decision, whatever another session's palette work proposes.
describe('D-035: beach draws v1 exactly; light draws v2', () => {
  const branch = (glsl, theme) => glsl.slice(glsl.indexOf(theme === 'beach' ? 'if (theme > 1.5) {' : 'else {'), glsl.indexOf(theme === 'beach' ? 'else {' : 'return vec3(1.0);'));
  it('picks v1 for beach and v2 for light by default', () => {
    expect(MARINE_WAVE_PALETTE_IDS).toEqual({ light: 'v2', beach: 'v1' });
  });
  it('beach samples, legend and shader branch hash to beach before #411', () => {
    const samples = []; for (let i = 0; i <= 1100; i++) samples.push(sampleMarineWavePalette(i / 100, 'beach'));
    expect(hash(samples)).toBe(BEACH_V1.samples);
    expect(hash([[0, .61, 1.22, 2.44, 3.66, 6.1], [0, .3, .61, 1.22, 1.83, 3.05]].map(bp => marineWaveLegendGradientCSS({ unit: 'm', breakpoints: bp }, 'beach')))).toBe(BEACH_V1.css);
    expect(hash(branch(MARINE_WAVE_PALETTE_GLSL, 'beach'))).toBe(BEACH_V1.glsl);
    const legend = marineWaveLegend({ unit: 'm', breakpoints: [0, .61, 1.22, 2.44, 3.66, 6.1] }, 'beach', 'ft');
    expect(legend.stops).toBeUndefined();     // v1's own value axis and ticks (buildStops), no arrow
    expect(legend.clipPath).toBeUndefined();
    expect(getThemedWaveColorJS(3, 'beach')).toEqual(sampleMarineWavePalette(3, 'beach', WAVE_PALETTES.v1));   // the JS mirror follows
  });
  it('light keeps v2: its shader branch, samples and arrowed legend', () => {
    expect(branch(MARINE_WAVE_PALETTE_GLSL, 'light')).toBe(branch(marineWavePaletteGlsl(WAVE_PALETTES.v2), 'light'));
    expect(sampleMarineWavePalette(3, 'light')).toEqual(sampleMarineWavePalette(3, 'light', WAVE_PALETTES.v2));
    expect(marineWaveLegend({ unit: 'm', breakpoints: [0, 6.1] }, 'light', 'ft').clipPath).toBeDefined();
  });
  it('the kills: the beach kill draws #411 exactly; the V2 kill draws v1 in both themes', () => {
    withWindow({ __RAW_DISABLE_WAVE_BEACH_V1__: true }, palette => {
      expect(palette.MARINE_WAVE_PALETTE_IDS).toEqual({ light: 'v2', beach: 'v2' });
      expect(hash(palette.MARINE_WAVE_PALETTE_GLSL)).toBe(GLSL_411);
    });
    withWindow({ __RAW_DISABLE_WAVE_PALETTE_V2__: true }, palette => {
      expect(palette.MARINE_WAVE_PALETTE_IDS).toEqual({ light: 'v1', beach: 'v1' });
      expect(hash(palette.MARINE_WAVE_PALETTE_GLSL)).toBe(V1.glsl);
    });
  });
});
