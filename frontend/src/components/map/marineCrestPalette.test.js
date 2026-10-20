import { createHash } from 'crypto';
import { DRAW_FS } from './WebGLMarineParticleShaders';
import { BEACH_CRESTS, BEACH_CREST_ID, BEACH_CREST_GLSL, beachCrestGlsl, resolveBeachCrest } from './marineCrestPalette';

// Beach crest V2 (2026-10-20). Pins: the kill draws the pre-V2 DRAW_FS byte for byte; V2 (the warm-polarity crest) changes the
// three beach colour lines and nothing else (dark and light crests untouched), and only over the beach wash it was solved for.
const sha = (s) => createHash('sha256').update(s).digest('hex');
// DRAW_FS before V2 (dev 0fc67408a): 8811 characters.
const DRAW_FS_V1 = { sha: 'a9e8e1026083bc9b9ca950d1e209bb0139a89f1a52ca9ba02306ddbc51d3a0ad', length: 8811 };
const withWindow = (levers, fn) => jest.isolateModules(() => {
  Object.assign(window, levers);
  try { fn(require('./WebGLMarineParticleShaders'), require('./marineCrestPalette')); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
});
const killedDrawFs = () => { let fs; withWindow({ __RAW_DISABLE_BEACH_CREST_V2__: true }, (s) => { fs = s.DRAW_FS; }); return fs; };

// OKLab C (Ottosson 2020) of an encoded sRGB 0-1 colour.
const oklabC = (rgb) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return Math.hypot(1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
};
// APCA screen luminance of an encoded sRGB 0-1 colour (the Y that APCA-W3 compares).
const apcaY = (rgb) => 0.2126729 * rgb[0] ** 2.4 + 0.7151522 * rgb[1] ** 2.4 + 0.0721750 * rgb[2] ** 2.4;

describe('the kill (window.__RAW_DISABLE_BEACH_CREST_V2__) draws the pre-V2 crests exactly', () => {
  it('DRAW_FS hashes to the pre-V2 shader', () => {
    withWindow({ __RAW_DISABLE_BEACH_CREST_V2__: true }, (shaders, crest) => {
      expect(crest.BEACH_CREST_ID).toBe('v1');
      expect(shaders.DRAW_FS.length).toBe(DRAW_FS_V1.length);
      expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_V1.sha);
    });
  });

  it('V2 stands down wherever the beach wash is not the one it was solved for', () => {
    for (const lever of [{ __RAW_DISABLE_WAVE_PALETTE_V2__: true }, { __RAW_DISABLE_MARINE_WAVE_PALETTE__: true }, { __RAW_BEACH_WASH__: 'B' }]) {
      withWindow(lever, (shaders, crest) => {
        expect(crest.BEACH_CREST_ID).toBe('v1');
        expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_V1.sha);
      });
    }
  });

  it('the v1 lines are the shader\'s pre-V2 lines, comment column included', () => {
    const v1 = beachCrestGlsl('v1');
    expect(`    calmColor = ${v1.calm}`).toBe('    calmColor = vec3(1.00, 0.45, 0.65);    // orchid-pink');
    expect(`    activeColor = ${v1.active}`).toBe('    activeColor = vec3(0.00, 0.92, 0.85);  // electric turquoise');
    expect(`    stormColor = ${v1.storm}`).toBe('    stormColor = vec3(0.80, 0.20, 0.90);   // sunset magenta');
  });
});

describe('V2 is the default over the mid beach wash and changes the three beach colour lines only', () => {
  it('draws V2 over v2 with the mid beach, v1 over anything else; the earlier A/B lever does nothing', () => {
    expect(BEACH_CREST_ID).toBe('v2');
    expect(resolveBeachCrest({}, true, 'v2', 'mid')).toBe('v2');
    expect(resolveBeachCrest({}, true, 'v2', 'B')).toBe('v1');
    expect(resolveBeachCrest({}, true, 'v1', 'mid')).toBe('v1');
    expect(resolveBeachCrest({}, false, 'v2', 'mid')).toBe('v1');
    expect(resolveBeachCrest({ __RAW_DISABLE_BEACH_CREST_V2__: true }, true, 'v2', 'mid')).toBe('v1');
    expect(resolveBeachCrest({ __RAW_BEACH_CREST_V2__: 'warm' }, true, 'v2', 'mid')).toBe('v2');
    expect(Object.keys(BEACH_CRESTS)).toEqual(['v1', 'v2']);
  });

  it('the only lines that differ from the kill are calm, active and storm inside the beach branch', () => {
    const before = killedDrawFs().split('\n'), after = DRAW_FS.split('\n');
    expect(after.length).toBe(before.length);
    const changed = after.map((_, i) => i).filter((i) => after[i] !== before[i]);
    expect(changed.map((i) => after[i].trim().split(' ')[0])).toEqual(['calmColor', 'activeColor', 'stormColor']);
    const beachAt = after.findIndex((l) => l.includes('if (u_theme > 1.5) {')), lightAt = after.findIndex((l) => l.includes('} else if (u_theme > 0.5) {'));
    for (const i of changed) { expect(i).toBeGreaterThan(beachAt); expect(i).toBeLessThan(lightAt); }
  });

  it('dark and light keep their literals', () => {
    for (const lit of ['calmColor = vec3(0.05, 0.15, 0.45);    // deep navy', 'activeColor = vec3(0.85, 0.50, 0.00);  // amber-gold',
      'stormColor = vec3(0.75, 0.10, 0.05);   // crimson red', 'calmColor = vec3(0.10, 0.95, 0.60);    // mint-green',
      'activeColor = vec3(1.00, 0.80, 0.10);  // yellow-gold', 'stormColor = vec3(1.00, 0.40, 0.10);   // fiery orange']) expect(DRAW_FS).toContain(lit);
  });

  it('the shader is built from the table: the switch is a step on the crest\'s own height', () => {
    expect(DRAW_FS).toContain(`calmColor = ${BEACH_CREST_GLSL.calm}`);
    expect(DRAW_FS).toContain('calmColor = mix(vec3(0.40, 0.02, 0.01), vec3(0.98, 1.00, 0.30), step(2.50, v_wave_height));  // oxblood, pale lemon from 2.5 m');
    expect(DRAW_FS).toContain('activeColor = mix(vec3(0.35, 0.01, 0.01), vec3(0.97, 1.00, 0.09), step(2.50, v_wave_height));  // oxblood, lemon from 2.5 m');
    expect(DRAW_FS).toContain('stormColor = vec3(1.00, 0.83, 0.52);   // peach');
    expect(DRAW_FS).toMatch(/varying highp float v_wave_height;/);   // the step reads the varying the shader already has
  });
});

describe('the V2 colours (solved by crest-solve.mjs; a hand edit must re-run wave-check.mjs)', () => {
  it('are the solved values', () => {
    const { v2 } = BEACH_CRESTS;
    expect(v2.switchHeight).toBe(2.5);
    expect([v2.calm.rgb, v2.calm.above, v2.active.rgb, v2.active.above, v2.storm.rgb])
      .toEqual([[0.40, 0.02, 0.01], [0.98, 1.00, 0.30], [0.35, 0.01, 0.01], [0.97, 1.00, 0.09], [1.00, 0.83, 0.52]]);
  });

  it('polarity: a dark warm ink below the switch where the mid wash is light, a light warm ink at and above it where it is dark', () => {
    jest.isolateModules(() => {
      const { sampleMarineWavePalette, WAVE_PALETTES } = require('./marineWavePalette');
      const water = [117, 207, 240].map((v) => v / 255);   // the beach basemap's water, measured (wave-lib.mjs BASEMAP)
      const wash = (h) => sampleMarineWavePalette(h, 'beach', WAVE_PALETTES.v2).map((v, i) => (v / 255) * 0.65 + water[i] * 0.35);
      const { v2 } = BEACH_CRESTS;
      // The switch sits near where the world-zoom wash passes APCA Y 0.352 (2.65 m without swell lighting, earlier with it).
      expect(apcaY(wash(v2.switchHeight - 0.5))).toBeGreaterThan(0.352);
      expect(apcaY(wash(v2.switchHeight + 0.5))).toBeLessThan(0.352);
      for (const ink of [v2.calm.rgb, v2.active.rgb]) expect(apcaY(ink)).toBeLessThan(0.05);
      for (const ink of [v2.calm.above, v2.active.above, v2.storm.rgb]) expect(apcaY(ink)).toBeGreaterThan(0.65);
      for (const h of [0.3, 1, 2, 2.4]) expect(apcaY(wash(h)) - apcaY(v2.calm.rgb)).toBeGreaterThan(0.3);
      expect(apcaY(v2.calm.above) - apcaY(wash(2.5))).toBeGreaterThan(0.45);
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
