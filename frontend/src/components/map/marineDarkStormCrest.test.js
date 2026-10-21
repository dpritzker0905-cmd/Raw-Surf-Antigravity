import { createHash } from 'crypto';
import { DRAW_FS } from './WebGLMarineParticleShaders';
import { DARK_STORM_CRESTS, DARK_STORM_CREST_ID, DARK_STORM_CREST_GLSL, darkStormCrestGlsl, resolveDarkStormCrest } from './marineCrestPalette';

// Dark storm crest (2026-10-20). Pins: the kill draws today's dark line byte for byte (with the other crest kills, dev's DRAW_FS from
// before any crest change, hash-pinned); the change is ONE line, dark's stormColor, and only from 8 m; the ink is darker than dark's
// storm wash where the orange it replaces is not.
const sha = (s) => createHash('sha256').update(s).digest('hex');
// DRAW_FS on dev before any crest change (0fc67408a .. f6b80f724, through the 16 m encoding #415 and D-035 #417): 8811 characters.
const DRAW_FS_DEV = { sha: 'a9e8e1026083bc9b9ca950d1e209bb0139a89f1a52ca9ba02306ddbc51d3a0ad', length: 8811 };
// Light crest V2's kill (#421) and beach's (#416, a lever only where that PR lands) are set beside dark's, so the pin holds whichever
// crest change lands.
const ALL_CREST_KILLS = { __RAW_DISABLE_DARK_STORM_CREST__: true, __RAW_DISABLE_LIGHT_CREST_V2__: true, __RAW_DISABLE_BEACH_CREST_V2__: true };
const TODAY = '    stormColor = vec3(1.00, 0.40, 0.10);   // fiery orange';
const TODAY_CASING = '    u_lowHCrestContrast * (1.0 - smoothstep(0.75, 1.05, v_wave_height)));';
const KILL = { __RAW_DISABLE_DARK_STORM_CREST__: true };
const withWindow = (levers, fn) => jest.isolateModules(() => {
  Object.assign(window, levers);
  try { fn(require('./WebGLMarineParticleShaders'), require('./marineCrestPalette')); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
});
const drawFsWith = (levers) => { let fs; withWindow(levers, (s) => { fs = s.DRAW_FS; }); return fs; };
const darkBranch = (lines) => [lines.findIndex((l) => l.includes('// Dark Mode')), lines.findIndex((l, i) => i > lines.findIndex((m) => m.includes('// Dark Mode')) && l.trim() === '}')];

describe('the kill (window.__RAW_DISABLE_DARK_STORM_CREST__) draws today\'s dark crests exactly', () => {
  it('with the other crest kills, DRAW_FS hashes to dev\'s shader', () => {
    withWindow(ALL_CREST_KILLS, (shaders, crest) => {
      expect(crest.DARK_STORM_CREST_ID).toBe('v1');
      expect(shaders.DRAW_FS.length).toBe(DRAW_FS_DEV.length);
      expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_DEV.sha);
    });
  });

  it('alone, it puts back today\'s line, comment column included', () => {
    expect(`    stormColor = ${darkStormCrestGlsl('v1').storm}`).toBe(TODAY);
    expect(`    ${darkStormCrestGlsl('v1').casing}`).toBe(TODAY_CASING);
    expect(drawFsWith(KILL).split('\n')).toEqual(expect.arrayContaining([TODAY, TODAY_CASING]));
    expect(resolveDarkStormCrest(KILL)).toBe('v1');
    expect(resolveDarkStormCrest({ ...KILL, __RAW_DARK_STORM_CREST__: 'cased' })).toBe('v1');   // the kill wins over the A/B lever
  });
});

describe('the default changes one line: dark\'s stormColor, from 8 m', () => {
  it('electric blue from 8 m is the default; the cased orange is the A/B lever', () => {
    expect(DARK_STORM_CREST_ID).toBe('v2');
    expect(resolveDarkStormCrest({})).toBe('v2');
    expect(resolveDarkStormCrest({ __RAW_DARK_STORM_CREST__: 'cased' })).toBe('cased');
    expect(resolveDarkStormCrest({ __RAW_DARK_STORM_CREST__: 'anything else' })).toBe('v2');
    expect(Object.keys(DARK_STORM_CRESTS)).toEqual(['v1', 'v2', 'cased']);
  });

  it('the only line that differs from the kill is stormColor inside the dark branch', () => {
    const before = drawFsWith(KILL).split('\n');
    for (const fs of [DRAW_FS]) {
      const after = fs.split('\n');
      expect(after.length).toBe(before.length);
      const changed = after.map((_, i) => i).filter((i) => after[i] !== before[i]);
      expect(changed).toHaveLength(1);
      expect(after[changed[0]].trim().startsWith('stormColor = mix(vec3(1.00, 0.40, 0.10), ')).toBe(true);
      const [from, to] = darkBranch(after);
      expect(changed[0]).toBeGreaterThan(from);
      expect(changed[0]).toBeLessThan(to);
    }
  });

  it('is built from the table: today\'s orange below 8 m, the ink at and above it, on the crest\'s own height', () => {
    expect(DRAW_FS).toContain(`stormColor = ${DARK_STORM_CREST_GLSL.storm}`);
    expect(DRAW_FS.split('\n')).toContain(TODAY_CASING);   // the default leaves the self-contrast line alone
    expect(DRAW_FS).toContain('    stormColor = mix(vec3(1.00, 0.40, 0.10), vec3(0.00, 0.00, 1.00), step(8.00, v_wave_height));  // fiery orange, electric blue from 8 m');
    expect(DRAW_FS).toMatch(/varying highp float v_wave_height;/);
    expect(DARK_STORM_CRESTS.v2.switchHeight).toBe(8.0);
    expect(DARK_STORM_CRESTS.v2.storm.rgb).toEqual(DARK_STORM_CRESTS.v1.storm.rgb);
  });
});

describe('the cased alternative (window.__RAW_DARK_STORM_CREST__ = "cased"): today\'s orange, cased from 8 m, no colour switch', () => {
  it('changes one line only, the self-contrast term, and keeps the orange storm line', () => {
    const before = drawFsWith(KILL).split('\n'), after = drawFsWith({ __RAW_DARK_STORM_CREST__: 'cased' }).split('\n');
    expect(after.length).toBe(before.length);
    const changed = after.map((_, i) => i).filter((i) => after[i] !== before[i]);
    expect(changed).toHaveLength(1);
    expect(before[changed[0]]).toBe(TODAY_CASING);
    expect(after[changed[0]]).toBe('    max(u_lowHCrestContrast * (1.0 - smoothstep(0.75, 1.05, v_wave_height)), (1.0 - step(0.5, u_theme)) * step(8.00, v_wave_height)));');
    expect(after[changed[0] - 1]).toBe('  float crestContrastEff = max(u_crestContrast,');
    expect(after).toContain(TODAY);
  });

  it('is dark-only and 8 m+ only: the term is 1 for u_theme 0 at and above 8 m, 0 for light (1), beach (2) or below 8 m', () => {
    const term = (theme, h) => (1 - (theme >= 0.5 ? 1 : 0)) * (h >= 8 ? 1 : 0);   // GLSL step(edge, x) is x >= edge
    expect([term(0, 8), term(0, 12), term(0, 7.99), term(1, 9), term(2, 9)]).toEqual([1, 1, 0, 0, 0]);
    expect(DARK_STORM_CRESTS.cased.storm).toEqual(DARK_STORM_CRESTS.v1.storm);
  });
});

// Dark's storm wash as HEATMAP_FS draws it above 5 m (WebGLMarineShaders.js getThemedWaveColor, non-surf: getNonlinearT puts 5-10 m
// on the c4 -> c5 segment, neon magenta to white), lit by the swell (+ vec3(0.03, 0.05, 0.08) * dir), laid premultiplied at the
// zoom's alpha (0.90: above BLEND BOTH's composite, at most 0.885) over dark's basemap water (93, 117, 126,
// read by scn_wave_palette_ab.js with Waves off). A crest core: the colour at 0.85 over that (energy 1 from 6 m, whitecap off).
// APCA-W3 0.0.98G-4g, the formula wave-lib.mjs and Leonardo use.
const water = [93, 117, 126].map((v) => v / 255);
const washAt = (h, a, dir) => { const s = Math.min(1, (h - 5) / 5); return [1, 0.1 + 0.9 * s, 0.75 + 0.25 * s].map((v, i) => Math.min(1, (v + [0.03, 0.05, 0.08][i] * dir) * a + water[i] * (1 - a))); };
const core = (c, under) => c.map((v, i) => v * 0.85 + under[i] * 0.15);
const apcaLc = (txt, bg) => {
  const Y = (c) => { const y = 0.2126729 * c[0] ** 2.4 + 0.7151522 * c[1] ** 2.4 + 0.0721750 * c[2] ** 2.4; return y > 0.022 ? y : y + (0.022 - y) ** 1.414; };
  const yt = Y(txt), yb = Y(bg);
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) { const s = (yb ** 0.56 - yt ** 0.57) * 1.14; return s < 0.1 ? 0 : (s - 0.027) * 100; }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14; return s > -0.1 ? 0 : (s + 0.027) * 100;
};
const worstLc = (ink) => {
  let w = Infinity;
  for (let h = 8; h <= 10.001; h += 0.25) for (const a of [0.65, 0.70, 0.77, 0.80, 0.90]) for (const dir of [0, 0.5, 1]) {
    const under = washAt(h, a, dir); w = Math.min(w, Math.abs(apcaLc(core(ink, under), under)));
  }
  return w;
};

describe('why: at 8 m and up dark\'s wash passes the orange crest\'s luminance; the ink stays darker', () => {
  it('today\'s orange core sits at the wash\'s luminance somewhere in 8-10 m (APCA |Lc| 0)', () => {
    expect(worstLc(DARK_STORM_CRESTS.v1.storm.rgb)).toBe(0);
  });

  it('electric blue keeps APCA |Lc| >= 34 over every zoom alpha and swell lighting, 8-10 m (the cap: dark stays /10)', () => {
    expect(worstLc(DARK_STORM_CRESTS.v2.storm.above)).toBeGreaterThan(34);   // 35.1
  });

  it('and reads as light, not soot: vivid and mid-lightness in OKLab though its luminance is low (the owner rejected dark inks)', () => {
    const ok = (rgb) => {   // OKLab (Ottosson 2020) lightness and chroma of an encoded sRGB 0-1 colour
      const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return { L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, C: Math.hypot(1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s) };
    };
    const ink = DARK_STORM_CRESTS.v2.storm.above, q = ok(ink);
    expect(q.C).toBeGreaterThan(0.30);   // 0.313, as vivid as sRGB allows (ember-black was 0.079)
    expect(q.L).toBeGreaterThan(0.40);   // 0.452 (ember-black 0.196)
    expect(0.2126729 * ink[0] ** 2.4 + 0.7151522 * ink[1] ** 2.4 + 0.0721750 * ink[2] ** 2.4).toBeLessThan(0.08);   // APCA Y 0.072
  });
});
