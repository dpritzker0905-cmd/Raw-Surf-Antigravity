import { createHash } from 'crypto';
import { DRAW_FS } from './WebGLMarineParticleShaders';
import { BEACH_CRESTS, BEACH_CREST_ID, BEACH_CREST_GLSL, beachCrestGlsl, resolveBeachCrest } from './marineCrestPalette';

// Beach crest V2 (2026-10-20). Pins: by default (beach draws D-035's v1 sea) and under the kill, DRAW_FS is the pre-V2 shader byte
// for byte; V2 (the warm-polarity crest) draws only under the sunset sea's A/B lever (window.__RAW_BEACH_WASH__ = 'sunset', PR #416)
// and changes the three beach colour lines and nothing else (dark and light crests untouched).
const sha = (s) => createHash('sha256').update(s).digest('hex');
// DRAW_FS before V2 (dev 0fc67408a): 8811 characters.
const DRAW_FS_V1 = { sha: 'a9e8e1026083bc9b9ca950d1e209bb0139a89f1a52ca9ba02306ddbc51d3a0ad', length: 8811 };
const withWindow = (levers, fn) => jest.isolateModules(() => {
  Object.assign(window, levers);
  try { fn(require('./WebGLMarineParticleShaders'), require('./marineCrestPalette')); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
});
const SUNSET = { __RAW_BEACH_WASH__: 'sunset' };
const KILLS = { __RAW_DISABLE_LIGHT_CREST_V2__: true, __RAW_DISABLE_BEACH_CREST_V2__: true };   // light V2 (#421) is on by default
const drawFsUnder = (levers) => { let fs; withWindow(levers, (s) => { fs = s.DRAW_FS; }); return fs; };
// Beach's branch of DRAW_FS: from its theme test to light's.
const beachBranch = (fs) => fs.slice(fs.indexOf('if (u_theme > 1.5) {'), fs.indexOf('} else if (u_theme > 0.5) {'));

// OKLab C (Ottosson 2020) of an encoded sRGB 0-1 colour.
const oklabC = (rgb) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return Math.hypot(1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
};
// APCA screen luminance of an encoded sRGB 0-1 colour (the Y that APCA-W3 compares).
const apcaY = (rgb) => 0.2126729 * rgb[0] ** 2.4 + 0.7151522 * rgb[1] ** 2.4 + 0.0721750 * rgb[2] ** 2.4;

describe('the default (D-035: beach draws the v1 sea) and the kill (window.__RAW_DISABLE_BEACH_CREST_V2__) draw the pre-V2 crests exactly', () => {
  it('DRAW_FS hashes to the pre-V2 shader under both crest kills, the sunset lever set or not; by default beach\'s branch is that shader\'s', () => {
    expect(BEACH_CREST_ID).toBe('v1');
    for (const levers of [KILLS, { ...KILLS, ...SUNSET }]) {
      withWindow(levers, (shaders, crest) => {
        expect(crest.BEACH_CREST_ID).toBe('v1');
        expect(shaders.DRAW_FS.length).toBe(DRAW_FS_V1.length);
        expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_V1.sha);
      });
    }
    expect(beachBranch(DRAW_FS)).toBe(beachBranch(drawFsUnder(KILLS)));   // the default build: light V2, beach as before
    expect(DRAW_FS).toBe(drawFsUnder({ __RAW_DISABLE_BEACH_CREST_V2__: true }));
  });

  it('V2 stands down wherever beach does not draw the sunset sea, the lever set or not', () => {
    const v1Beach = beachBranch(drawFsUnder(KILLS));
    for (const lever of [{}, { __RAW_DISABLE_WAVE_PALETTE_V2__: true }, { __RAW_DISABLE_MARINE_WAVE_PALETTE__: true }, { __RAW_DISABLE_WAVE_BEACH_V1__: true }]) {
      for (const levers of [lever, { ...lever, ...SUNSET }]) {
        if (!Object.keys(lever).length && levers.__RAW_BEACH_WASH__) continue;   // the lever alone draws V2 (below)
        withWindow(levers, (shaders, crest) => {
          expect(crest.BEACH_CREST_ID).toBe('v1');
          expect(beachBranch(shaders.DRAW_FS)).toBe(v1Beach);
        });
      }
    }
    withWindow({ __RAW_BEACH_WASH__: 'B' }, (shaders) => expect(shaders.DRAW_FS).toBe(DRAW_FS));   // an unknown value does nothing
  });

  it('the v1 lines are the shader\'s pre-V2 lines, comment column included', () => {
    const v1 = beachCrestGlsl('v1');
    expect(`    calmColor = ${v1.calm}`).toBe('    calmColor = vec3(1.00, 0.45, 0.65);    // orchid-pink');
    expect(`    activeColor = ${v1.active}`).toBe('    activeColor = vec3(0.00, 0.92, 0.85);  // electric turquoise');
    expect(`    stormColor = ${v1.storm}`).toBe('    stormColor = vec3(0.80, 0.20, 0.90);   // sunset magenta');
    expect(`    foamHighlight = ${v1.foam}`).toBe('    foamHighlight = vec3(0.95, 0.95, 1.00);');
  });
});

describe('V2 draws only under the sunset lever and changes the four beach crest lines only', () => {
  it('draws V2 over the sunset sea, v1 over any other; the A/B\'s \'first\' lever draws the first sunset crest (v2a) there only', () => {
    expect(resolveBeachCrest({}, true, 'sunset')).toBe('v2');
    for (const sea of ['v1', 'v2']) expect(resolveBeachCrest({}, true, sea)).toBe('v1');
    expect(resolveBeachCrest({}, false, 'sunset')).toBe('v1');
    expect(resolveBeachCrest({ __RAW_DISABLE_BEACH_CREST_V2__: true }, true, 'sunset')).toBe('v1');
    const FIRST = { __RAW_BEACH_CREST_V2__: 'first' };
    expect(resolveBeachCrest(FIRST, true, 'sunset')).toBe('v2a');
    for (const sea of ['v1', 'v2']) expect(resolveBeachCrest(FIRST, true, sea)).toBe('v1');
    expect(resolveBeachCrest({ ...FIRST, __RAW_DISABLE_BEACH_CREST_V2__: true }, true, 'sunset')).toBe('v1');
    expect(resolveBeachCrest({ __RAW_BEACH_CREST_V2__: 'warm' }, true, 'sunset')).toBe('v2');   // any other value: V2
    expect(Object.keys(BEACH_CRESTS)).toEqual(['v1', 'v2', 'v2a']);
    withWindow(SUNSET, (shaders, crest) => expect(crest.BEACH_CREST_ID).toBe('v2'));
    withWindow({ ...SUNSET, ...FIRST }, (shaders, crest) => {
      expect(crest.BEACH_CREST_ID).toBe('v2a');
      expect(shaders.DRAW_FS).toContain('stormColor = vec3(1.00, 0.83, 0.52);   // peach');
      expect(beachBranch(shaders.DRAW_FS)).toContain('foamHighlight = vec3(0.95, 0.95, 1.00);');
    });
  });

  it('the only lines that differ from the default are calm, active, storm and foam inside the beach branch', () => {
    const before = DRAW_FS.split('\n'), after = drawFsUnder(SUNSET).split('\n');
    expect(after.length).toBe(before.length);
    const changed = after.map((_, i) => i).filter((i) => after[i] !== before[i]);
    expect(changed.map((i) => after[i].trim().split(' ')[0])).toEqual(['calmColor', 'activeColor', 'stormColor', 'foamHighlight']);
    const beachAt = after.findIndex((l) => l.includes('if (u_theme > 1.5) {')), lightAt = after.findIndex((l) => l.includes('} else if (u_theme > 0.5) {'));
    for (const i of changed) { expect(i).toBeGreaterThan(beachAt); expect(i).toBeLessThan(lightAt); }
  });

  it('dark keeps its literals and light draws what it draws without the lever (its own V2, #421)', () => {
    const fs = drawFsUnder(SUNSET), rest = (s) => s.slice(s.indexOf('} else if (u_theme > 0.5) {'));
    for (const lit of ['calmColor = vec3(0.10, 0.95, 0.60);    // mint-green', 'activeColor = vec3(1.00, 0.80, 0.10);  // yellow-gold',
      'stormColor = vec3(1.00, 0.40, 0.10);   // fiery orange']) expect(fs).toContain(lit);
    expect(rest(fs)).toBe(rest(DRAW_FS));
  });

  it('the shader is built from the table: the switch is a step on the crest\'s own height', () => {
    expect(DRAW_FS).toContain(`calmColor = ${BEACH_CREST_GLSL.calm}`);   // the default build: v1's line
    expect(BEACH_CREST_GLSL).toEqual(beachCrestGlsl('v1'));
    const fs = drawFsUnder(SUNSET);
    expect(fs).toContain(`calmColor = ${beachCrestGlsl('v2').calm}`);
    expect(fs).toContain('calmColor = mix(vec3(0.39, 0.02, 0.02), vec3(1.00, 1.00, 0.48), step(2.40, v_wave_height));  // oxblood, pale lemon from 2.4 m');
    expect(fs).toContain('activeColor = mix(vec3(0.33, 0.00, 0.00), vec3(0.97, 1.00, 0.09), step(2.40, v_wave_height));  // oxblood, lemon from 2.4 m');
    expect(fs).toContain('stormColor = vec3(1.00, 0.84, 0.88);   // blush');
    expect(fs).toContain('foamHighlight = mix(vec3(0.08, 0.00, 0.00), vec3(0.95, 0.95, 1.00), step(2.40, v_wave_height));  // oxblood-black foam, white from 2.4 m');
    expect(fs).toMatch(/varying highp float v_wave_height;/);   // the step reads the varying the shader already has
  });
});

describe('the V2 colours (solved by crest-solve.mjs, refined by the design critique; a hand edit must re-run wave-check.mjs)', () => {
  it('are the critique\'s values (V2) and the first sunset crest\'s (v2a)', () => {
    const { v2, v2a } = BEACH_CRESTS;
    expect(v2.switchHeight).toBe(2.4);   // on the sunset sea's 2.4 m anchor
    expect([v2.calm.rgb, v2.calm.above, v2.active.rgb, v2.active.above, v2.storm.rgb, v2.foam.rgb, v2.foam.above])
      .toEqual([[0.39, 0.02, 0.02], [1.00, 1.00, 0.48], [0.33, 0.00, 0.00], [0.97, 1.00, 0.09], [1.00, 0.84, 0.88], [0.08, 0.00, 0.00], [0.95, 0.95, 1.00]]);
    expect(v2a.switchHeight).toBe(2.1);
    expect([v2a.calm.rgb, v2a.calm.above, v2a.active.rgb, v2a.active.above, v2a.storm.rgb, v2a.foam.rgb])
      .toEqual([[0.39, 0.02, 0.02], [1.00, 1.00, 0.48], [0.33, 0.00, 0.00], [0.97, 1.00, 0.09], [1.00, 0.83, 0.52], [0.95, 0.95, 1.00]]);
  });

  it('polarity: a dark warm ink below the switch where the sunset sea is light, a light warm ink at and above it where it is dark', () => {
    jest.isolateModules(() => {
      const { sampleMarineWavePalette, WAVE_PALETTES } = require('./marineWavePalette');
      const water = [117, 207, 240].map((v) => v / 255);   // the beach basemap's water, measured (wave-lib.mjs BASEMAP)
      const wash = (h) => sampleMarineWavePalette(h, 'beach', WAVE_PALETTES.sunset).map((v, i) => (v / 255) * 0.65 + water[i] * 0.35);
      const { v2 } = BEACH_CRESTS;
      // The world-zoom sea passes APCA Y 0.352 at 1.7 m (1.5 m at coastal zoom, the denser alpha); the switch sits on the 2.4 m
      // anchor past it, and the dark ink still stands well off the sea up to there.
      expect(apcaY(wash(1.6))).toBeGreaterThan(0.352);
      expect(apcaY(wash(1.8))).toBeLessThan(0.352);
      expect(v2.switchHeight).toBe(WAVE_PALETTES.sunset.heights[3]);
      for (const ink of [v2.calm.rgb, v2.active.rgb, v2.foam.rgb]) expect(apcaY(ink)).toBeLessThan(0.05);
      for (const ink of [v2.calm.above, v2.active.above, v2.storm.rgb, v2.foam.above]) expect(apcaY(ink)).toBeGreaterThan(0.65);
      for (const h of [0.3, 1, 2, 2.35]) expect(apcaY(wash(h)) - apcaY(v2.calm.rgb)).toBeGreaterThan(0.25);
      expect(apcaY(v2.calm.above) - apcaY(wash(2.4))).toBeGreaterThan(0.45);
      expect(apcaY(v2.active.above) - apcaY(wash(3))).toBeGreaterThan(0.45);
      for (const h of [6, 10]) expect(apcaY(v2.storm.rgb) - apcaY(wash(h))).toBeGreaterThan(0.45);
    });
  });

  it('v1, the control: its orchid -> turquoise mix greys, one reason V2 exists', () => {
    // DRAW_FS: mix(calm, active, 2e) then mix(active, storm, 2e - 1), sampled every 0.05 of energy.
    const t = BEACH_CRESTS.v1;
    let minC = Infinity;
    for (let e = 0; e <= 1.0001; e += 0.05) {
      const [p, q, k] = e < 0.5 ? [t.calm.rgb, t.active.rgb, e * 2] : [t.active.rgb, t.storm.rgb, e * 2 - 1];
      minC = Math.min(minC, oklabC(p.map((v, i) => v + (q[i] - v) * k)));
    }
    expect(minC).toBeLessThan(0.05);   // greys to 0.036 (at 1.7 m)
  });
});
