import { createHash } from 'crypto';
import { DRAW_FS } from './WebGLMarineParticleShaders';
import { LIGHT_CREST_STYLES, LIGHT_CREST_STYLE, lightCrestStyleGlsl, resolveLightCrestStyle } from './marineLightCrestStyle';

// Light crest STYLE (owner A/B, 2026-10-21). Pins: off by default and under the kill, DRAW_FS is the restored original's byte for byte
// (#438); the two-tone changes the four lines it hooks (ribbon edge, tone, self-contrast, alpha) and nothing else, each gated on the
// light theme so dark and beach compute exactly as before; the values are the measured ones (light-crest-style.mjs).
const sha = (s) => createHash('sha256').update(s).digest('hex');
// DRAW_FS on dev d84a94f26 (unchanged since 23a91534f), the default this lever must leave byte for byte: the restored original
// light crest (#438, D-041) and #419's dark storm casing; #428 and #431 change DRAW_VS only.
const DRAW_FS_DEFAULT = { sha: 'e24385865160c841d04f9bfb8108f4bcda361fe8512648ae8f4a5e372d0289e5', length: 8872 };
const ON = { __RAW_LIGHT_CREST_STYLE__: 'twotone' };
const KILL = { __RAW_DISABLE_LIGHT_CREST_STYLE__: true };
const LIGHT = 'abs(u_theme - 1.0) < 0.5';
const withWindow = (levers, fn) => jest.isolateModules(() => {
  Object.assign(window, levers);
  try { fn(require('./WebGLMarineParticleShaders'), require('./marineLightCrestStyle')); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
});
const NL = String.fromCharCode(10);

describe('off by default: the restored original crest, byte for byte', () => {
  it('no style, every DRAW_FS piece empty, DRAW_FS hashes to the restored default', () => {
    expect(LIGHT_CREST_STYLE).toBe('today');
    expect(lightCrestStyleGlsl('today')).toEqual({ decl: '', shapeHead: '', tone: '', contrastHead: '', alphaHead: '' });
    expect(DRAW_FS.length).toBe(DRAW_FS_DEFAULT.length);
    expect(sha(DRAW_FS)).toBe(DRAW_FS_DEFAULT.sha);
  });

  it('the kill wins over the lever; an unknown style is today', () => {
    withWindow({ ...ON, ...KILL }, (shaders, style) => {
      expect(style.LIGHT_CREST_STYLE).toBe('today');
      expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_DEFAULT.sha);
    });
    expect(resolveLightCrestStyle({ __RAW_LIGHT_CREST_STYLE__: 'neon' })).toBe('today');
    expect(resolveLightCrestStyle({ __RAW_LIGHT_CREST_STYLE__: 'toString' })).toBe('today');
    expect(resolveLightCrestStyle(ON)).toBe('twotone');
  });
});

describe('the two-tone (window.__RAW_LIGHT_CREST_STYLE__ = "twotone")', () => {
  it('changes only the zoom uniform, ribbon edge, tone, self-contrast and alpha lines; the four drawing lines gated on the light theme', () => {
    const before = DRAW_FS.split(NL);
    let after; withWindow(ON, (s) => { after = s.DRAW_FS.split(NL); });
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
