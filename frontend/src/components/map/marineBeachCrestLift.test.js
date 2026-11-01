import { createHash } from 'crypto';
import { DRAW_FS } from './WebGLMarineParticleShaders';
import { BEACH_CREST_LIFT, BEACH_CREST_LIFT_LEVEL, BEACH_LIFT_BANDS, bandWeight, beachCrestLiftGlsl, resolveBeachCrestLift } from './marineBeachCrestLift';

// Beach crest LIFT (draft for the owner, 2026-10-22: "It needs to be a subtle improvement"). Pins: ON by default ('subtle'); the kill
// draws today's DRAW_FS byte for byte; 'more' is the stronger level; the lift changes only the zoom uniform, the finalColor line and
// the alpha line, every drawing piece gated on the beach theme, and only inside the two bands (weight 0 elsewhere); beach's crest
// colours and every theme's colour lines are untouched; light's two-tone lever still composes (u_zoom declared once).
const sha = (s) => createHash('sha256').update(s).digest('hex');
// dev 6232b67ba's default DRAW_FS (light's x1 cross D-046, dark's 8 m+ cased storm ink D-039; marineCrestCross.test.js pins it as X1):
// what the lift's kill must draw. With light's cross kill too: dev 9b49111e8's (the original light crests, D-044).
const DRAW_FS_TODAY = { sha: 'd75b2bbf6de6ed2401c18f67c704115b945b67fe2ef32c173f0cc5d636673bac', length: 9063 };
const DRAW_FS_BEFORE_CROSS = { sha: 'e24385865160c841d04f9bfb8108f4bcda361fe8512648ae8f4a5e372d0289e5', length: 8872 };
const DRAW_FS_SUBTLE = { sha: '5a9f550c4f60aaeb9f776a373ff2458a7c5737f7b5367f94585c207d49abea52', length: 9514 };
const DRAW_FS_MORE = { sha: '912f4cdb15295234a05c2a4705e400f7cc54e8607e18cb18990ae1009eab3cc2', length: 9514 };
// The lift over light's original crests (the cross's kill): the same beach pieces, so the same text as before #451.
const DRAW_FS_SUBTLE_NO_CROSS = { sha: 'ce8b5a6e9a9d2c849a041c0d5ff8e9073de386cec8ce586c58ce3151d24e1caa', length: 9323 };
const CROSS_KILL = { __RAW_DISABLE_LIGHT_CREST_CROSS__: true };
const KILL = { __RAW_DISABLE_BEACH_CREST_LIFT__: true };
const BEACH = 'u_theme > 1.5';
const withWindow = (levers, fn) => jest.isolateModules(() => {
  Object.assign(window, levers);
  try { fn(require('./WebGLMarineParticleShaders'), require('./marineBeachCrestLift')); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
});
const drawFsUnder = (levers) => { let fs; withWindow(levers, (s) => { fs = s.DRAW_FS; }); return fs; };
const pin = (fs, p) => { expect(fs.length).toBe(p.length); expect(sha(fs)).toBe(p.sha); };

describe('on by default; the kill draws today exactly', () => {
  it('default: the subtle level', () => {
    expect(BEACH_CREST_LIFT_LEVEL).toBe('subtle');
    pin(DRAW_FS, DRAW_FS_SUBTLE);
  });

  it('the kill is dev\'s DRAW_FS byte for byte and wins over the lever; "more" is the stronger level; unknown values are subtle', () => {
    pin(drawFsUnder(KILL), DRAW_FS_TODAY);
    pin(drawFsUnder({ ...KILL, __RAW_BEACH_CREST_LIFT__: 'more' }), DRAW_FS_TODAY);
    pin(drawFsUnder({ ...KILL, ...CROSS_KILL }), DRAW_FS_BEFORE_CROSS);   // each theme's kill restores that theme exactly
    pin(drawFsUnder(CROSS_KILL), DRAW_FS_SUBTLE_NO_CROSS);
    pin(drawFsUnder({ __RAW_BEACH_CREST_LIFT__: 'more' }), DRAW_FS_MORE);
    expect(beachCrestLiftGlsl('today')).toEqual({ decl: '', tone: '', alphaHead: '' });
    for (const v of ['twotone', 'today', 'toString', 1, true, '']) expect(resolveBeachCrestLift({ __RAW_BEACH_CREST_LIFT__: v })).toBe('subtle');
    expect(resolveBeachCrestLift({ __RAW_DISABLE_BEACH_CREST_LIFT__: 'yes' })).toBe('subtle');   // the kill is `true` only
  });
});

describe('the lift against today', () => {
  const today = drawFsUnder(KILL).split('\n'), on = DRAW_FS.split('\n');

  it('changes only the zoom uniform, the finalColor line and the alpha line; the drawing pieces gated on the beach theme', () => {
    expect(on.length).toBe(today.length);
    const changed = on.map((_, i) => i).filter((i) => on[i] !== today[i]);
    expect(changed.map((i) => on[i].trim().split(' ').slice(0, 2).join(' '))).toEqual(['uniform float', 'vec3 finalColor', 'float boostedAlpha']);
    expect(on[changed[0]]).toBe('uniform float u_theme; uniform highp float u_zoom;');
    expect(on[changed[1]].match(/u_theme > 1\.5 \?/g)).toHaveLength(2);   // both band weights are 0.0 outside beach
    expect(on[changed[2]]).toContain('(beachSand + beachMauve)');
  });

  it('is the measured level: sand x 0.70 deeper, grey-mauve 0.35 toward white, alpha x 1.5 far out tapering to x 1 by z 7', () => {
    expect(BEACH_CREST_LIFT).toEqual({ subtle: { sand: 0.30, mauve: 0.35, alpha: 1.5 }, more: { sand: 0.45, mauve: 0.50, alpha: 1.5 } });
    const g = beachCrestLiftGlsl('subtle');
    expect(g.tone).toContain(`float beachSand = ${BEACH} ? smoothstep(0.70, 1.00, v_wave_height) * (1.0 - smoothstep(2.00, 2.30, v_wave_height)) : 0.0;`);
    expect(g.tone).toContain(`float beachMauve = ${BEACH} ? smoothstep(4.00, 4.40, v_wave_height) * (1.0 - smoothstep(6.80, 7.20, v_wave_height)) : 0.0;`);
    expect(g.tone).toContain('finalColor = mix(finalColor, vec3(1.0), 0.35 * beachMauve) * (1.0 - 0.30 * beachSand);');
    expect(g.alphaHead).toBe('(1.0 + 0.50 * (beachSand + beachMauve) * (1.0 - smoothstep(3.0, 7.0, u_zoom))) * ');
    expect(DRAW_FS).toContain('  boostedAlpha = min(boostedAlpha, 0.85);\n');   // the cap stays
  });

  it('acts only inside the two bands: weight 0 below 0.7 m, from 2.3 to 4.0 m and above 7.2 m; 1 in each band\'s core', () => {
    expect(BEACH_LIFT_BANDS).toEqual({ sand: { from: 1.0, to: 2.0, ramp: 0.3 }, mauve: { from: 4.4, to: 6.8, ramp: 0.4 } });
    for (const h of [0, 0.3, 0.7, 2.3, 3.0, 4.0, 7.2, 9, 14]) expect(bandWeight('sand', h) + bandWeight('mauve', h)).toBe(0);
    for (const h of [1.0, 1.5, 2.0]) expect(bandWeight('sand', h)).toBe(1);
    for (const h of [4.4, 5.6, 6.8]) expect(bandWeight('mauve', h)).toBe(1);
    for (let h = 0.7; h <= 2.3; h += 0.05) expect(bandWeight('mauve', h)).toBe(0);   // the bands never overlap
  });

  it('keeps beach\'s crest colours and every theme\'s colour lines; brings no colour but white', () => {
    for (const lit of ['calmColor = vec3(1.00, 0.45, 0.65);    // orchid-pink', 'activeColor = vec3(0.00, 0.92, 0.85);  // electric turquoise',
      'stormColor = vec3(0.80, 0.20, 0.90);   // sunset magenta', 'foamHighlight = vec3(0.95, 0.95, 1.00);']) expect(DRAW_FS).toContain(lit);
    const themes = (s) => s.slice(s.indexOf('if (u_theme > 1.5) {'), s.indexOf('vec3 baseColor = energy < 0.5'));
    expect(themes(DRAW_FS)).toBe(themes(today.join('\n')));
    expect(beachCrestLiftGlsl('subtle').tone.match(/vec3\(/g)).toHaveLength(1);
  });

  it('dark and light (u_theme 0 and 1) take today\'s branch: both weights are 0.0 there and the alpha factor is 1', () => {
    const tone = beachCrestLiftGlsl('subtle').tone;
    expect(tone.match(/u_theme > 1\.5 \? [^:]+ : 0\.0;/g)).toHaveLength(2);
    for (const u of [0, 1]) expect(u > 1.5).toBe(false);
  });
});

describe('composes with light\'s two-tone lever (#442, off by default since D-044)', () => {
  it('both on: u_zoom declared once, light\'s pieces then beach\'s on the shared lines', () => {
    const fs = drawFsUnder({ __RAW_LIGHT_CREST_STYLE__: 'twotone' });
    expect(fs.match(/uniform highp float u_zoom;/g)).toHaveLength(1);
    expect(fs).toContain('if (abs(u_theme - 1.0) < 0.5) finalColor = mix(mix(finalColor, finalColor * 0.15,');
    expect(fs).toContain('float beachSand = u_theme > 1.5 ?');
    expect(fs).toContain('mix(3.00, 1.0, smoothstep(3.0, 9.0, u_zoom)) : 1.0) * (1.0 + 0.50 * (beachSand + beachMauve)');
  });
});
