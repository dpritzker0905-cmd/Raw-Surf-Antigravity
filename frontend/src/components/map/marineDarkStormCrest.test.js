import { createHash } from 'crypto';
import { DRAW_FS } from './WebGLMarineParticleShaders';
import { DARK_STORM_CRESTS, DARK_STORM_CREST_ID, DARK_STORM_CREST_GLSL, darkStormCrestGlsl, resolveDarkStormCrest } from './marineCrestPalette';

// Dark storm crest, cased orange from 8 m (2026-10-21, DECISIONS D-039). Pins: the kill draws today's dark lines byte for byte (with
// the other crest kills, dev's DRAW_FS from before any crest change, hash-pinned); the change is ONE line, the crest self-contrast
// term, dark-only and from 8 m; the storm colour stays today's orange; the cased rim stands off dark's storm wash where the plain
// orange does not.
const sha = (s) => createHash('sha256').update(s).digest('hex');
// DRAW_FS on dev before any crest change (0fc67408a .. f6b80f724, through the 16 m encoding #415 and D-035 #417): 8811 characters.
const DRAW_FS_DEV = { sha: 'a9e8e1026083bc9b9ca950d1e209bb0139a89f1a52ca9ba02306ddbc51d3a0ad', length: 8811 };
// Light crest V2's kill (#421) and beach's (#416, a lever only where that PR lands) are set beside dark's, so the pin holds whichever
// crest change lands.
const ALL_CREST_KILLS = { __RAW_DISABLE_DARK_STORM_CREST__: true, __RAW_DISABLE_LIGHT_CREST_V2__: true, __RAW_DISABLE_BEACH_CREST_V2__: true, __RAW_DISABLE_LIGHT_CREST_STYLE__: true };
const LIGHT_STYLE_KILL = { __RAW_DISABLE_LIGHT_CREST_STYLE__: true };   // the light two-tone (D-043) prefixes the self-contrast line in light
const TODAY = '    stormColor = vec3(1.00, 0.40, 0.10);   // fiery orange';
const TODAY_CASING = '    u_lowHCrestContrast * (1.0 - smoothstep(0.75, 1.05, v_wave_height)));';
const CASED = '    max(u_lowHCrestContrast * (1.0 - smoothstep(0.75, 1.05, v_wave_height)), (1.0 - step(0.5, u_theme)) * step(8.00, v_wave_height)));';
const KILL = { __RAW_DISABLE_DARK_STORM_CREST__: true };
const withWindow = (levers, fn) => jest.isolateModules(() => {
  Object.assign(window, levers);
  try { fn(require('./WebGLMarineParticleShaders'), require('./marineCrestPalette')); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
});
const drawFsWith = (levers) => { let fs; withWindow(levers, (s) => { fs = s.DRAW_FS; }); return fs; };

describe('the kill (window.__RAW_DISABLE_DARK_STORM_CREST__) draws today\'s dark crests exactly', () => {
  it('with the other crest kills, DRAW_FS hashes to dev\'s shader', () => {
    withWindow(ALL_CREST_KILLS, (shaders, crest) => {
      expect(crest.DARK_STORM_CREST_ID).toBe('v1');
      expect(shaders.DRAW_FS.length).toBe(DRAW_FS_DEV.length);
      expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_DEV.sha);
    });
  });

  it('alone, it puts back today\'s lines, comment column included', () => {
    expect(`    stormColor = ${darkStormCrestGlsl('v1').storm}`).toBe(TODAY);
    expect(`    ${darkStormCrestGlsl('v1').casing}`).toBe(TODAY_CASING);
    expect(drawFsWith(KILL).split('\n')).toEqual(expect.arrayContaining([TODAY, TODAY_CASING]));
    expect(resolveDarkStormCrest(KILL)).toBe('v1');
  });
});

describe('the default (D-039): cased orange from 8 m, one line, no colour switch', () => {
  it('is the default; the table holds only today and it (electric blue and the A/B lever are gone)', () => {
    expect(DARK_STORM_CREST_ID).toBe('v2');
    expect(resolveDarkStormCrest({})).toBe('v2');
    expect(resolveDarkStormCrest({ __RAW_DARK_STORM_CREST__: 'cased' })).toBe('v2');
    expect(Object.keys(DARK_STORM_CRESTS)).toEqual(['v1', 'v2']);
  });

  it('changes one line only, the self-contrast term, and keeps today\'s orange storm line', () => {
    const before = drawFsWith({ ...KILL, ...LIGHT_STYLE_KILL }).split('\n'), after = drawFsWith(LIGHT_STYLE_KILL).split('\n');
    expect(after.length).toBe(before.length);
    const changed = after.map((_, i) => i).filter((i) => after[i] !== before[i]);
    expect(changed).toHaveLength(1);
    expect(before[changed[0]]).toBe(TODAY_CASING);
    expect(after[changed[0]]).toBe(CASED);
    expect(after[changed[0] - 1]).toBe('  float crestContrastEff = max(u_crestContrast,');
    expect(after).toContain(TODAY);
  });

  it('is built from the table, on the crest\'s own height', () => {
    expect(DRAW_FS).toContain(`stormColor = ${DARK_STORM_CREST_GLSL.storm}`);
    expect(`    ${DARK_STORM_CREST_GLSL.casing}`).toBe(CASED);
    expect(DRAW_FS).toMatch(/varying highp float v_wave_height;/);
    expect(DRAW_FS).toMatch(/uniform float u_theme;/);
    expect(DARK_STORM_CRESTS.v2.switchHeight).toBe(8.0);
    expect(DARK_STORM_CRESTS.v2.storm).toEqual(DARK_STORM_CRESTS.v1.storm);
  });

  it('is dark-only and 8 m+ only: the term is 1 for u_theme 0 at and above 8 m, 0 for light (1), beach (2) or below 8 m', () => {
    const term = (theme, h) => (1 - (theme >= 0.5 ? 1 : 0)) * (h >= 8 ? 1 : 0);   // GLSL step(edge, x) is x >= edge
    expect([term(0, 8), term(0, 12), term(0, 7.99), term(1, 9), term(2, 9)]).toEqual([1, 1, 0, 0, 0]);
  });
});

// Dark's storm wash as HEATMAP_FS draws it above 5 m (WebGLMarineShaders.js getThemedWaveColor, non-surf: getNonlinearT puts 5-10 m
// on the c4 -> c5 segment, neon magenta to white), lit by the swell (+ vec3(0.03, 0.05, 0.08) * dir), laid premultiplied at the
// zoom's alpha (0.90: above BLEND BOTH's composite, at most 0.885) over dark's basemap water (93, 117, 126,
// read by scn_wave_palette_ab.js with Waves off). A crest core: the colour at 0.85 over that (energy 1 from 6 m, whitecap off). The
// cased rim (DRAW_FS self-contrast at ellipse distance 0.7: core weight 1 - smoothstep(0.15, 0.85, 0.7), lum 0.55 + 0.75 x that,
// plus that x 0.18 white), laid at alpha 0.70. APCA-W3 0.0.98G-4g, the formula wave-lib.mjs and Leonardo use.
const water = [93, 117, 126].map((v) => v / 255);
const washAt = (h, a, dir) => { const s = Math.min(1, (h - 5) / 5); return [1, 0.1 + 0.9 * s, 0.75 + 0.25 * s].map((v, i) => Math.min(1, (v + [0.03, 0.05, 0.08][i] * dir) * a + water[i] * (1 - a))); };
const over = (c, under, a) => c.map((v, i) => v * a + under[i] * (1 - a));
const apcaLc = (txt, bg) => {
  const Y = (c) => { const y = 0.2126729 * c[0] ** 2.4 + 0.7151522 * c[1] ** 2.4 + 0.0721750 * c[2] ** 2.4; return y > 0.022 ? y : y + (0.022 - y) ** 1.414; };
  const yt = Y(txt), yb = Y(bg);
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) { const s = (yb ** 0.56 - yt ** 0.57) * 1.14; return s < 0.1 ? 0 : (s - 0.027) * 100; }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14; return s > -0.1 ? 0 : (s + 0.027) * 100;
};
const worstLc = (colour, alpha) => {
  let w = Infinity;
  for (let h = 8; h <= 10.001; h += 0.25) for (const a of [0.65, 0.70, 0.77, 0.80, 0.90]) for (const dir of [0, 0.5, 1]) {
    const under = washAt(h, a, dir); w = Math.min(w, Math.abs(apcaLc(over(colour, under, alpha), under)));
  }
  return w;
};
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

describe('why: at 8 m and up dark\'s wash passes the orange crest\'s luminance; the cased rim stands off it', () => {
  it('today\'s orange core sits at the wash\'s luminance somewhere in 8-10 m (APCA |Lc| 0)', () => {
    expect(worstLc(DARK_STORM_CRESTS.v1.storm.rgb, 0.85)).toBe(0);
  });

  it('the cased rim keeps APCA |Lc| >= 20 over every zoom alpha and swell lighting, 8-10 m (the cap: dark stays /10)', () => {
    const k = 1 - smooth(0.15, 0.85, 0.7), rim = DARK_STORM_CRESTS.v2.storm.rgb.map((v) => Math.min(1, v * (0.55 + 0.75 * k) + k * 0.18));
    expect(worstLc(rim, 0.70)).toBeGreaterThan(20);   // 20.4 (the real engine's eye p90: 20-35)
  });
});
