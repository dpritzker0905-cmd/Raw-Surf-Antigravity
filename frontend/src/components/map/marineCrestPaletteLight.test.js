import './marineWaveSpectrumKill.testsupport';   // light's v2 is pinned here; the spectrum (D-037) in marineWaveSpectrum.test.js
import { createHash } from 'crypto';
import { DRAW_FS } from './WebGLMarineParticleShaders';
import { LIGHT_CRESTS, LIGHT_CREST_ID, LIGHT_CREST_GLSL, lightCrestGlsl, resolveLightCrest } from './marineCrestPalette';

// Light crest V2 (2026-10-20), RESTORED to the original by default (owner 2026-10-21, D-041). Pins: the default and the V2 kill draw
// light's lines from before V2 (with dark's #419 kill too, dev f6b80f724's DRAW_FS byte for byte); V2, on request
// (window.__RAW_LIGHT_CREST_V2__) or under the restore's kill (window.__RAW_DISABLE_LIGHT_CREST_RESTORE__), draws dev's DRAW_FS byte for
// byte and changes light's four colour lines (calm, active, storm, foam) and nothing else; the V2 colours are the solved ones.
const sha = (s) => createHash('sha256').update(s).digest('hex');
// DRAW_FS before light crest V2 (dev f6b80f724, after the 16 m encoding #415 and D-035 #417).
const DRAW_FS_BEFORE = { sha: 'a9e8e1026083bc9b9ca950d1e209bb0139a89f1a52ca9ba02306ddbc51d3a0ad', length: 8811 };
// DRAW_FS as dev drew it before the restore (f17508ba0: light crest V2 on, dark's 8 m+ storm casing #419 on): what V2 on request and
// the restore's kill must draw; and the same with #419's kill (dev 2a47fd5d8, before #419).
const DRAW_FS_V2 = { sha: '5057bc10bcd5ff6a36e5295d9d0b74e9c00324e50c5d316cfe3c0c49ac4edad0', length: 9110 };
const DRAW_FS_V2_BEFORE_419 = { sha: 'f425bf535ef4ae2a42560ef18ca70e1c085e6a74d24f5736c358e4d9e682f7ce', length: 9049 };
// The restored default: dev's DRAW_FS with light's four lines as before V2 (with #419's kill as well: DRAW_FS_BEFORE exactly).
const DRAW_FS_DEFAULT = { sha: 'e24385865160c841d04f9bfb8108f4bcda361fe8512648ae8f4a5e372d0289e5', length: 8872 };
const DARK_KILL = { __RAW_DISABLE_DARK_STORM_CREST__: true };
// The light two-tone (D-043) is on by default over the original colours; these pins are the crest colours under it, so it stands down
// here (marineLightCrestStyle.test.js pins the two-tone).
const STYLE_KILL = { __RAW_DISABLE_LIGHT_CREST_STYLE__: true };
const KILL = { __RAW_DISABLE_LIGHT_CREST_V2__: true };
const ASK_V2 = { __RAW_LIGHT_CREST_V2__: true };
const RESTORE_KILL = { __RAW_DISABLE_LIGHT_CREST_RESTORE__: true };
const withWindow = (levers, fn) => jest.isolateModules(() => {
  Object.assign(window, levers);
  try { fn(require('./WebGLMarineParticleShaders'), require('./marineCrestPalette')); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
});
const branch = (lines, i) => {   // which DRAW_FS theme branch line i sits in
  const beachAt = lines.findIndex((l) => l.includes('if (u_theme > 1.5) {')), lightAt = lines.findIndex((l) => l.includes('} else if (u_theme > 0.5) {'));
  const darkAt = lines.findIndex((l, k) => k > lightAt && l.trim() === '} else {');
  return i > beachAt && i < lightAt ? 'beach' : i > lightAt && i < darkAt ? 'light' : 'other';
};

describe('the kill (window.__RAW_DISABLE_LIGHT_CREST_V2__) draws the crests from before light V2 exactly', () => {
  it('DRAW_FS hashes to the shader before light V2', () => {
    withWindow({ ...KILL, ...STYLE_KILL, __RAW_DISABLE_DARK_STORM_CREST__: true }, (shaders, crest) => {   // + dark's 8 m+ storm ink kill (#419)
      expect(crest.LIGHT_CREST_ID).toBe('v1');
      expect(shaders.DRAW_FS.length).toBe(DRAW_FS_BEFORE.length);
      expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_BEFORE.sha);
    });
  });

  it('either wave-palette kill stands light V2 down too: it was solved for the V2 wash', () => {
    for (const lever of ['__RAW_DISABLE_WAVE_PALETTE_V2__', '__RAW_DISABLE_MARINE_WAVE_PALETTE__']) {
      withWindow({ [lever]: true, ...STYLE_KILL, __RAW_DISABLE_DARK_STORM_CREST__: true }, (shaders, crest) => {
        expect(crest.LIGHT_CREST_ID).toBe('v1');
        expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_BEFORE.sha);
      });
    }
  });

  it('the v1 lines are the shader\'s literals from before light V2, comment column included (the foam line has none)', () => {
    const v1 = lightCrestGlsl('v1');
    expect(`    calmColor = ${v1.calm}`).toBe('    calmColor = vec3(0.05, 0.15, 0.45);    // deep navy');
    expect(`    activeColor = ${v1.active}`).toBe('    activeColor = vec3(0.85, 0.50, 0.00);  // amber-gold');
    expect(`    stormColor = ${v1.storm}`).toBe('    stormColor = vec3(0.75, 0.10, 0.05);   // crimson red');
    expect(`    foamHighlight = ${v1.foam}`).toBe('    foamHighlight = vec3(1.00, 1.00, 1.00);');
  });
});

describe('RESTORED: the original light crest is the default again (owner 2026-10-21, D-041)', () => {
  it('the default draws light\'s lines from before V2 over the V2 wash; with #419\'s dark kill, f6b80f724\'s DRAW_FS byte for byte', () => {
    expect(LIGHT_CREST_ID).toBe('v1');
    expect(resolveLightCrest({}, true, 'v2')).toBe('v1');
    for (const k of ['calm', 'active', 'storm', 'foam']) expect(DRAW_FS).toContain(lightCrestGlsl('v1')[k]);   // under the two-tone too
    withWindow(STYLE_KILL, (shaders) => {
      expect(shaders.DRAW_FS.length).toBe(DRAW_FS_DEFAULT.length);
      expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_DEFAULT.sha);
    });
    withWindow({ ...DARK_KILL, ...STYLE_KILL }, (shaders) => expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_BEFORE.sha));
  });

  it('V2 on request and the restore kill both draw dev\'s DRAW_FS byte for byte; the V2 kill still wins', () => {
    for (const levers of [ASK_V2, RESTORE_KILL]) {
      withWindow(levers, (shaders, crest) => {
        expect(crest.LIGHT_CREST_ID).toBe('v2');
        expect(shaders.DRAW_FS.length).toBe(DRAW_FS_V2.length);
        expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_V2.sha);
      });
      withWindow({ ...levers, ...DARK_KILL }, (shaders) => expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_V2_BEFORE_419.sha));
      withWindow({ ...levers, ...KILL, ...STYLE_KILL }, (shaders, crest) => {
        expect(crest.LIGHT_CREST_ID).toBe('v1');
        expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_DEFAULT.sha);
      });
    }
  });
});

describe('V2, on request, draws over the v2 wash only and changes light\'s four colour lines only', () => {
  it('draws the polarity crest over the v2 wash and v1 over anything else', () => {
    expect(resolveLightCrest(ASK_V2, true, 'v2')).toBe('v2');
    expect(resolveLightCrest(RESTORE_KILL, true, 'v2')).toBe('v2');
    expect(resolveLightCrest(ASK_V2, true, 'v1')).toBe('v1');
    expect(resolveLightCrest(ASK_V2, false, 'v2')).toBe('v1');
    expect(resolveLightCrest({ ...ASK_V2, ...KILL }, true, 'v2')).toBe('v1');
  });

  it('the only lines that differ from the default are calm, active, storm and foam inside the light branch', () => {
    let before; withWindow(STYLE_KILL, (s) => { before = s.DRAW_FS.split('\n'); });
    let after; withWindow(ASK_V2, (s) => { after = s.DRAW_FS.split('\n'); });
    expect(after.length).toBe(before.length);
    const changed = after.map((_, i) => i).filter((i) => after[i] !== before[i]);
    expect(changed.map((i) => after[i].trim().split(' ')[0])).toEqual(['calmColor', 'activeColor', 'stormColor', 'foamHighlight']);
    for (const i of changed) expect(branch(after, i)).toBe('light');
  });

  it('dark and beach keep their literals (the dark storm line from 8 m: marineDarkStormCrest.test.js)', () => {
    for (const lit of ['calmColor = vec3(0.10, 0.95, 0.60);    // mint-green', 'activeColor = vec3(1.00, 0.80, 0.10);  // yellow-gold',
      'calmColor = vec3(1.00, 0.45, 0.65);    // orchid-pink',
      'activeColor = vec3(0.00, 0.92, 0.85);  // electric turquoise', 'stormColor = vec3(0.80, 0.20, 0.90);   // sunset magenta',
      'foamHighlight = vec3(0.95, 0.95, 1.00);']) expect(DRAW_FS).toContain(lit);
  });

  it('the shader is built from the table: the switch is a step on the crest\'s own height', () => {
    expect(DRAW_FS).toContain(`calmColor = ${LIGHT_CREST_GLSL.calm}`);
    expect(DRAW_FS).toContain(`foamHighlight = ${LIGHT_CREST_GLSL.foam}`);
    expect(DRAW_FS).toContain('calmColor = vec3(0.05, 0.15, 0.45);    // deep navy');
    withWindow(ASK_V2, (s) => {
      expect(s.DRAW_FS).toContain('calmColor = mix(vec3(0.27, 0.10, 0.00), vec3(1.00, 1.00, 0.82), step(3.05, v_wave_height));  // deep umber, cream from 3.05 m');
      expect(s.DRAW_FS).toContain('activeColor = mix(vec3(0.27, 0.10, 0.00), vec3(1.00, 1.00, 0.82), step(3.05, v_wave_height));  // deep umber, cream from 3.05 m');
      expect(s.DRAW_FS).toContain('stormColor = vec3(1.00, 0.96, 0.00);   // gold');
      expect(s.DRAW_FS).toContain('foamHighlight = mix(vec3(0.05, 0.02, 0.00), vec3(1.00, 1.00, 1.00), step(3.05, v_wave_height));  // umber-black foam, white from 3.05 m');
    });
  });
});

// APCA screen luminance of an encoded sRGB 0-1 colour (the Y that APCA-W3 compares).
const apcaY = (rgb) => 0.2126729 * rgb[0] ** 2.4 + 0.7151522 * rgb[1] ** 2.4 + 0.0721750 * rgb[2] ** 2.4;

describe('the V2 colours (solved by crest-solve.mjs --theme light; a hand edit must re-run wave-check.mjs)', () => {
  it('are the solved values', () => {
    const { v2 } = LIGHT_CRESTS;
    expect(v2.switchHeight).toBe(3.05);
    expect([v2.calm.rgb, v2.calm.above, v2.active.rgb, v2.active.above, v2.storm.rgb, v2.foam.rgb, v2.foam.above])
      .toEqual([[0.27, 0.10, 0.00], [1.00, 1.00, 0.82], [0.27, 0.10, 0.00], [1.00, 1.00, 0.82], [1.00, 0.96, 0.00], [0.05, 0.02, 0.00], [1.00, 1.00, 1.00]]);
  });

  it('polarity: a dark ink (and foam) below the switch where the wash is light, light ones at and above it where the wash is dark', () => {
    jest.isolateModules(() => {
      const { sampleMarineWavePalette, WAVE_PALETTES } = require('./marineWavePalette');
      const water = [144, 223, 254].map((v) => v / 255);   // the light basemap's water, measured (wave-lib.mjs BASEMAP)
      const wash = (h) => sampleMarineWavePalette(h, 'light', WAVE_PALETTES.v2).map((v, i) => (v / 255) * 0.65 + water[i] * 0.35);
      const { v2 } = LIGHT_CRESTS;
      // The switch sits where the world-zoom wash passes APCA Y 0.352 (2.6-3.3 m over every view and swell lighting).
      expect(apcaY(wash(v2.switchHeight - 0.3))).toBeGreaterThan(0.352);
      expect(apcaY(wash(v2.switchHeight + 0.4))).toBeLessThan(0.352);
      for (const ink of [v2.calm.rgb, v2.active.rgb, v2.foam.rgb]) expect(apcaY(ink)).toBeLessThan(0.05);
      for (const ink of [v2.calm.above, v2.active.above, v2.storm.rgb, v2.foam.above]) expect(apcaY(ink)).toBeGreaterThan(0.75);
      for (const h of [0.3, 1, 2, 2.9]) expect(apcaY(wash(h)) - apcaY(v2.calm.rgb)).toBeGreaterThan(0.3);
      for (const h of [3.1, 4, 6, 10]) expect(apcaY(v2.active.above) - apcaY(wash(h))).toBeGreaterThan(0.4);
    });
  });

  it('the dark ink is umber, not the red of the above-10 m flag; v1, the control, crosses the wash', () => {
    const hue = (rgb) => { const [r, g, b] = rgb; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === mn ? 0 : mx === r ? (60 * ((g - b) / (mx - mn)) + 360) % 360 : 0; };
    expect(hue(LIGHT_CRESTS.v2.calm.rgb)).toBeGreaterThan(15);   // HSV hue 22 (umber); the flag (105, 9, 0) sits at 5
    expect(hue([105, 9, 0].map((v) => v / 255))).toBeLessThan(10);
    const { v1 } = LIGHT_CRESTS;   // v1 lightens toward its 3 m amber (APCA Y 0.28) as the wash darkens: the two cross
    expect(apcaY(v1.calm.rgb)).toBeLessThan(0.05);
    expect(apcaY(v1.active.rgb)).toBeGreaterThan(0.25);
  });
});
