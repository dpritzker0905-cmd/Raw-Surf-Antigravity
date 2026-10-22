import { createHash } from 'crypto';
import { DRAW_FS } from './WebGLMarineParticleShaders';
import { LIGHT_CREST_STYLES, LIGHT_CREST_STYLE, lightCrestStyleGlsl, resolveLightCrestStyle } from './marineLightCrestStyle';

// Light crest STYLE, ON by default since the owner's pick (2026-10-22, D-043) wherever light draws its original colours. Pins: the
// default DRAW_FS; the kill draws dev's DRAW_FS from before the flip byte for byte; V2 on request (and the restore's kill) draws dev's
// V2 DRAW_FS as before, without the two-tone; the two-tone changes the five lines it hooks (zoom uniform, ribbon edge, tone,
// self-contrast, alpha) and nothing else, the four drawing lines gated on the light theme; the values are the measured ones.
const sha = (s) => createHash('sha256').update(s).digest('hex');
// The default: the original light crest with the two-tone (D-043), on dev 95363ea27 (#433's beach levers off).
const DRAW_FS_DEFAULT = { sha: 'ed381124193091152a1b5eb692783582cd224cb97421c3c10837d8adbf143968', length: 9233 };
// Under the kill: dev 95363ea27's DRAW_FS before the flip (the restored original #438, #419's dark storm casing; #428 and #431 change
// DRAW_VS only, #433's beach levers are off).
const DRAW_FS_BEFORE = { sha: 'e24385865160c841d04f9bfb8108f4bcda361fe8512648ae8f4a5e372d0289e5', length: 8872 };
// V2 on request on dev 95363ea27 (#431's v2s colours over the spectrum): unchanged by the flip.
const DRAW_FS_V2 = { sha: '40aa1ea7b0203aac35f114ff67e9b01d67b483c0e912c505c93f86d7396dddc5', length: 9110 };
const ON = { __RAW_LIGHT_CREST_STYLE__: 'twotone' };
const KILL = { __RAW_DISABLE_LIGHT_CREST_STYLE__: true };
const LIGHT = 'abs(u_theme - 1.0) < 0.5';
const withWindow = (levers, fn) => jest.isolateModules(() => {
  Object.assign(window, levers);
  try { fn(require('./WebGLMarineParticleShaders'), require('./marineLightCrestStyle')); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
});
const NL = String.fromCharCode(10);

describe('on by default over the original colours (D-043)', () => {
  it('the default style is the two-tone and DRAW_FS hashes to it', () => {
    expect(LIGHT_CREST_STYLE).toBe('twotone');
    expect(DRAW_FS.length).toBe(DRAW_FS_DEFAULT.length);
    expect(sha(DRAW_FS)).toBe(DRAW_FS_DEFAULT.sha);
  });

  it('the kill draws dev\'s DRAW_FS from before the flip, byte for byte, and wins over the lever', () => {
    for (const levers of [KILL, { ...ON, ...KILL }]) {
      withWindow(levers, (shaders, style) => {
        expect(style.LIGHT_CREST_STYLE).toBe('today');
        expect(lightCrestStyleGlsl('today')).toEqual({ decl: '', shapeHead: '', tone: '', contrastHead: '', alphaHead: '' });
        expect(shaders.DRAW_FS.length).toBe(DRAW_FS_BEFORE.length);
        expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_BEFORE.sha);
      });
    }
  });

  it('V2 on request and the restore\'s kill draw V2 as before, without the two-tone', () => {
    for (const levers of [{ __RAW_LIGHT_CREST_V2__: true }, { __RAW_DISABLE_LIGHT_CREST_RESTORE__: true }]) {
      withWindow(levers, (shaders, style) => {
        expect(style.LIGHT_CREST_STYLE).toBe('today');
        expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_V2.sha);
      });
    }
  });

  it('resolves by crest colours: the two-tone over the original, today over V2; the lever asks for it over any colours', () => {
    expect(resolveLightCrestStyle({}, 'v1')).toBe('twotone');
    expect(resolveLightCrestStyle({}, 'v2')).toBe('today');
    expect(resolveLightCrestStyle({}, 'v2s')).toBe('today');
    expect(resolveLightCrestStyle(ON, 'v2s')).toBe('twotone');
    expect(resolveLightCrestStyle(KILL, 'v1')).toBe('today');
    expect(resolveLightCrestStyle({ __RAW_LIGHT_CREST_STYLE__: 'neon' }, 'v1')).toBe('twotone');
    expect(resolveLightCrestStyle({ __RAW_LIGHT_CREST_STYLE__: 'toString' }, 'v2')).toBe('today');
  });
});

describe('the two-tone', () => {
  it('changes only the zoom uniform, ribbon edge, tone, self-contrast and alpha lines; the four drawing lines gated on the light theme', () => {
    let before; withWindow(KILL, (s) => { before = s.DRAW_FS.split(NL); });
    const after = DRAW_FS.split(NL);
    expect(after.length).toBe(before.length);
    const changed = after.map((_, i) => i).filter((i) => after[i] !== before[i]);
    expect(changed.map((i) => after[i].trim().split(' ').slice(0, 2).join(' '))).toEqual(['uniform float', 'float shape', 'vec3 finalColor', 'float crestContrastEff', 'float boostedAlpha']);
    // DRAW_VS's own u_zoom (highp there), now read in DRAW_FS too: same name and precision, so the program links one uniform.
    expect(after[changed[0]]).toBe('uniform float u_theme; uniform highp float u_zoom;');
    for (const i of changed.slice(1)) expect(after[i]).toContain(LIGHT);
    expect(after[changed[1]]).toBe(`  float shape = 1.0 - smoothstep(${LIGHT} ? 0.80 : 0.55, 1.0, ellipseDist);`);
    expect(after[changed[2]]).toBe(`  vec3 finalColor = mix(baseColor, foamHighlight, whiteBlend); if (${LIGHT}) finalColor = mix(mix(finalColor, finalColor * 0.15, `
      + 'smoothstep(0.55, 0.72, ellipseDist)), vec3(1.0), 0.85 * (1.0 - smoothstep(0.12, 0.32, ellipseDist)));');
    expect(after[changed[3]]).toBe(`  float crestContrastEff = ${LIGHT} ? 0.0 : max(u_crestContrast,`);
    expect(after[changed[4]]).toBe(`  float boostedAlpha = alpha * (${LIGHT} ? mix(3.00, 1.0, smoothstep(3.0, 9.0, u_zoom)) : 1.0) * mix(1.2, 1.8, energy);`);
  });

  it('is the measured candidate: rim x 0.15, centre 85% toward white, crest alpha x 3 far out (x 1 by z 9) before the 0.85 cap', () => {
    expect(LIGHT_CREST_STYLES).toEqual({ twotone: { rim: 0.15, centre: 0.85, alpha: 3.0 } });
  });

  it('keeps the crest colours: the rim scales the crest colour and the centre mixes toward white (no new hue in the shader)', () => {
    const g = lightCrestStyleGlsl('twotone');
    expect(g.tone).toContain('finalColor * 0.15');
    expect(g.tone).toContain('vec3(1.0), 0.85');
    expect(g.tone.match(/vec3\(/g)).toHaveLength(1);   // white is the only colour literal it brings
  });
});
