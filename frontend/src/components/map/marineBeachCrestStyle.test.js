import { createHash } from 'crypto';
import { DRAW_FS } from './WebGLMarineParticleShaders';
import { BEACH_CREST_STYLES, BEACH_CREST_STYLE, BEACH_CREST_STYLE_GLSL, beachCrestStyleGlsl, resolveBeachCrestStyle } from './marineBeachCrestStyle';

// Beach crest style (owner A/B, 2026-10-21). Pins: with no lever, or the kill, DRAW_FS is today's shader byte for byte; each lever
// changes only the wired lines, each gated on the beach theme, and beach's crest COLOURS are untouched (luminance structure only).
const sha = (s) => createHash('sha256').update(s).digest('hex');
// dev's default DRAW_FS at 23a91534f and d84a94f26 (light's original crests D-041, dark's 8 m+ cased storm ink D-039; marineCrestPaletteLight.test.js
// pins the same value): beach's default must draw it byte for byte.
const DRAW_FS_DEV = { sha: 'e24385865160c841d04f9bfb8108f4bcda361fe8512648ae8f4a5e372d0289e5', length: 8872 };
// DRAW_FS before any crest change (dev f6b80f724): what the light V2 kill + dark's #419 kill draw, with or without this module.
const DRAW_FS_BEFORE = { sha: 'a9e8e1026083bc9b9ca950d1e209bb0139a89f1a52ca9ba02306ddbc51d3a0ad', length: 8811 };
const OTHER_CREST_KILLS = { __RAW_DISABLE_LIGHT_CREST_V2__: true, __RAW_DISABLE_DARK_STORM_CREST__: true, __RAW_DISABLE_LIGHT_CREST_STYLE__: true };
const LIGHT_STYLE_KILL = { __RAW_DISABLE_LIGHT_CREST_STYLE__: true };   // the light two-tone (D-043) is on by default and shares these lines
const withWindow = (levers, fn) => jest.isolateModules(() => {
  Object.assign(window, levers);
  try { fn(require('./WebGLMarineParticleShaders'), require('./marineBeachCrestStyle')); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
});
const drawFsUnder = (levers) => { let fs; withWindow(levers, (s) => { fs = s.DRAW_FS; }); return fs; };
const LINES = ['float shape = 1.0 - smoothstep(', 'vec3 finalColor = mix(baseColor, foamHighlight, whiteBlend);', 'float crestContrastEff = ', 'float boostedAlpha = alpha * '];

describe('today, the kill and unknown values draw today\'s crest exactly', () => {
  it('no lever: style today, DRAW_FS is dev\'s byte for byte, and under the other crest kills it is the pre-V2 shader', () => {
    expect(BEACH_CREST_STYLE).toBe('today');
    expect(BEACH_CREST_STYLE_GLSL).toEqual({ shapeEdge: '0.55', tone: '', contrastHead: '', alphaHead: '' });
    const DEV_FS = drawFsUnder(LIGHT_STYLE_KILL);   // dev's DRAW_FS before the light flip (D-043)
    expect(DEV_FS.length).toBe(DRAW_FS_DEV.length);
    expect(sha(DEV_FS)).toBe(DRAW_FS_DEV.sha);
    expect(DEV_FS).toContain('  float boostedAlpha = alpha * mix(1.2, 1.8, energy);\n');
    withWindow(OTHER_CREST_KILLS, (shaders) => {
      expect(shaders.DRAW_FS.length).toBe(DRAW_FS_BEFORE.length);
      expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_BEFORE.sha);
    });
    expect(DEV_FS).toContain('  float shape = 1.0 - smoothstep(0.55, 1.0, ellipseDist);\n');
    expect(DEV_FS).toContain('  vec3 finalColor = mix(baseColor, foamHighlight, whiteBlend);\n');
    expect(DEV_FS).toContain('  float crestContrastEff = max(u_crestContrast,\n');
  });

  it('the kill wins over every lever; unknown values do nothing', () => {
    for (const style of Object.keys(BEACH_CREST_STYLES)) {
      expect(resolveBeachCrestStyle({ __RAW_BEACH_CREST_STYLE__: style })).toBe(style);
      expect(resolveBeachCrestStyle({ __RAW_BEACH_CREST_STYLE__: style, __RAW_DISABLE_BEACH_CREST_STYLE__: true })).toBe('today');
      withWindow({ __RAW_BEACH_CREST_STYLE__: style, __RAW_DISABLE_BEACH_CREST_STYLE__: true }, (shaders) => expect(shaders.DRAW_FS).toBe(DRAW_FS));
    }
    for (const v of ['halo', 'v2', 1, true, '']) expect(resolveBeachCrestStyle({ __RAW_BEACH_CREST_STYLE__: v })).toBe('today');
    withWindow({ __RAW_BEACH_CREST_STYLE__: 'halo' }, (shaders) => expect(shaders.DRAW_FS).toBe(DRAW_FS));
  });
});

describe.each(Object.keys(BEACH_CREST_STYLES))('the %s lever', (style) => {
  const fs = drawFsUnder({ __RAW_BEACH_CREST_STYLE__: style });

  it('changes only the wired lines, each gated on the beach theme', () => {
    const before = DRAW_FS.split('\n'), after = fs.split('\n');
    expect(after.length).toBe(before.length);
    const changed = after.map((_, i) => i).filter((i) => after[i] !== before[i]);
    expect(changed.length).toBeGreaterThan(0);
    for (const i of changed) {
      expect(LINES.some((l) => before[i].includes(l))).toBe(true);
      expect(after[i]).toContain('u_theme > 1.5');
    }
  });

  it('keeps beach\'s crest colours and every other theme\'s lines', () => {
    for (const lit of ['calmColor = vec3(1.00, 0.45, 0.65);    // orchid-pink', 'activeColor = vec3(0.00, 0.92, 0.85);  // electric turquoise',
      'stormColor = vec3(0.80, 0.20, 0.90);   // sunset magenta', 'foamHighlight = vec3(0.95, 0.95, 1.00);']) expect(fs).toContain(lit);
    const themes = (s) => s.slice(s.indexOf('if (u_theme > 1.5) {'), s.indexOf('vec3 baseColor = energy < 0.5'));
    expect(themes(fs)).toBe(themes(DRAW_FS));
  });
});

describe('the style pieces', () => {
  it('twotone: dark rim x0.30 on the outer band, centre 75% toward white, ribbon opaque to 0.80; self-contrast off in beach', () => {
    expect(beachCrestStyleGlsl('twotone')).toEqual({
      alphaHead: '',
      shapeEdge: 'u_theme > 1.5 ? 0.80 : 0.55',
      tone: ' if (u_theme > 1.5) finalColor = mix(mix(finalColor, finalColor * 0.30, smoothstep(0.55, 0.72, ellipseDist)), vec3(1.0), 0.75 * (1.0 - smoothstep(0.12, 0.32, ellipseDist)));',
      contrastHead: 'u_theme > 1.5 ? 0.0 : ',
    });
    expect(beachCrestStyleGlsl('soft').tone).toContain('vec3(1.0), 0.55 * (1.0 - smoothstep(0.12, 0.32, ellipseDist))');
  });

  it('cased: the engine\'s own self-contrast at full strength in beach, nothing else', () => {
    expect(beachCrestStyleGlsl('cased')).toEqual({ shapeEdge: '0.55', tone: '', contrastHead: 'u_theme > 1.5 ? 1.0 : ', alphaHead: '' });
    expect(drawFsUnder({ __RAW_BEACH_CREST_STYLE__: 'cased', ...LIGHT_STYLE_KILL })).toContain('  float crestContrastEff = u_theme > 1.5 ? 1.0 : max(u_crestContrast,\n');
  });

  it('twotonebold: twotone with beach\'s crest alpha x3 before the 0.85 cap, in beach only (the recommendation, listed first)', () => {
    expect(Object.keys(BEACH_CREST_STYLES)[0]).toBe('twotonebold');
    expect(beachCrestStyleGlsl('twotonebold')).toEqual({ ...beachCrestStyleGlsl('twotone'), alphaHead: '(u_theme > 1.5 ? 3.00 : 1.0) * ' });
    const fs = drawFsUnder({ __RAW_BEACH_CREST_STYLE__: 'twotonebold', ...LIGHT_STYLE_KILL });
    expect(fs).toContain('  float boostedAlpha = alpha * (u_theme > 1.5 ? 3.00 : 1.0) * mix(1.2, 1.8, energy);\n');
    expect(fs).toContain('boostedAlpha = min(boostedAlpha, 0.85);');   // the cap stays: x3 lifts faint crests to it, never past it
  });

  it('the rim is darker and the centre lighter than the body, for every crest colour (luminance structure only)', () => {
    const Y = (c) => 0.2126 * c[0] ** 2.2 + 0.7152 * c[1] ** 2.2 + 0.0722 * c[2] ** 2.2;
    for (const c of [[1.00, 0.45, 0.65], [0.00, 0.92, 0.85], [0.80, 0.20, 0.90]]) {
      for (const { rim, centre } of [BEACH_CREST_STYLES.twotonebold, BEACH_CREST_STYLES.twotone, BEACH_CREST_STYLES.soft]) {
        expect(Y(c.map((v) => v * rim))).toBeLessThan(Y(c) * 0.15);
        expect(Y(c.map((v) => v + (1 - v) * centre))).toBeGreaterThan(Y(c));
      }
    }
  });
});

describe('beach and light styles compose (#442, marineLightCrestStyle.js)', () => {
  it('both levers: light\'s piece first, then beach\'s, on each shared line, each gated on its own theme', () => {
    const fs = drawFsUnder({ __RAW_BEACH_CREST_STYLE__: 'twotonebold', __RAW_LIGHT_CREST_STYLE__: 'twotone' });
    expect(fs.split('\n').length).toBe(DRAW_FS.split('\n').length);
    expect(fs).toContain('  float shape = 1.0 - smoothstep(abs(u_theme - 1.0) < 0.5 ? 0.80 : u_theme > 1.5 ? 0.80 : 0.55, 1.0, ellipseDist);\n');
    expect(fs).toContain('if (abs(u_theme - 1.0) < 0.5) finalColor = mix(mix(finalColor, finalColor * 0.15,');
    expect(fs).toContain('if (u_theme > 1.5) finalColor = mix(mix(finalColor, finalColor * 0.30,');
    expect(fs).toContain('  float crestContrastEff = abs(u_theme - 1.0) < 0.5 ? 0.0 : u_theme > 1.5 ? 0.0 : max(u_crestContrast,\n');
    expect(fs).toContain(' * (u_theme > 1.5 ? 3.00 : 1.0) * mix(1.2, 1.8, energy);\n');
    expect(fs).toContain('  boostedAlpha = min(boostedAlpha, 0.85);\n');
  });
});
