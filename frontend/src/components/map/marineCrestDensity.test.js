import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { DRAW_VS, DRAW_FS } from './WebGLMarineParticleShaders';
import { CREST_DENSITY_CUT, CREST_DENSITY_HEIGHTS, CREST_DENSITY_GLSL, CREST_CUT_HASH_GLSL, crestCutHash, crestDensityCut, crestDensityGlsl } from './marineCrestDensity';

// Crest density at mid-to-close zoom where the surf is big (2026-10-20). Pins: the kill draws DRAW_VS byte for byte as before; the
// change touches DRAW_VS's u_densityBase line and its threshold line only (DRAW_FS untouched); the cut removes crests by a hash of its
// own, so the share removed is the share asked; each theme's cut and zoom are the owner's ranges at the measured label zooms; the
// engine feeds the uniform from crestDensityCut.
const sha = (s) => createHash('sha256').update(s).digest('hex');
// DRAW_VS and DRAW_FS before this change (dev 448deb35c).
const DRAW_VS_BEFORE = { sha: 'a1683763aa85437a8681935b869359904e878d3d4a34b4fbba9da612ac7aec44', length: 29051 };
const DRAW_FS_BEFORE = { sha: 'f425bf535ef4ae2a42560ef18ca70e1c085e6a74d24f5736c358e4d9e682f7ce', length: 9049 };
const KILL = { __RAW_DISABLE_CREST_DENSITY_ZOOM__: true };
const withWindow = (levers, fn) => jest.isolateModules(() => {
  Object.assign(window, levers);
  try { fn(require('./WebGLMarineParticleShaders'), require('./marineCrestDensity')); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
});

describe('the kill (window.__RAW_DISABLE_CREST_DENSITY_ZOOM__) draws the crests as before', () => {
  it('DRAW_VS hashes to the shader before this change, and the cut is 0 at every zoom', () => {
    withWindow(KILL, (shaders, d) => {
      expect(shaders.DRAW_VS.length).toBe(DRAW_VS_BEFORE.length);
      expect(sha(shaders.DRAW_VS)).toBe(DRAW_VS_BEFORE.sha);
      for (const t of [0, 1, 2]) for (const z of [3, 5, 6, 8, 12, 16]) expect(d.crestDensityCut(t, z)).toBe(0);
    });
  });

  it('DRAW_FS is untouched either way', () => {
    expect(sha(DRAW_FS)).toBe(DRAW_FS_BEFORE.sha);
    withWindow(KILL, (shaders) => expect(sha(shaders.DRAW_FS)).toBe(DRAW_FS_BEFORE.sha));
  });
});

describe('on (the default): two DRAW_VS lines change', () => {
  it('only the u_densityBase line and the density threshold line differ from the kill', () => {
    let before; withWindow(KILL, (s) => { before = s.DRAW_VS.split('\n'); });
    const after = DRAW_VS.split('\n');
    expect(after.length).toBe(before.length);
    const changed = after.map((_, i) => i).filter((i) => after[i] !== before[i]);
    expect(changed.map((i) => after[i].trim().split(' ').slice(0, 3).join(' '))).toEqual(['uniform float u_densityBase;', 'float densityThreshold =']);
    expect(after[changed[0]]).toContain(`uniform float u_densityBase; uniform float u_densityCut; ${CREST_CUT_HASH_GLSL}   //`);
    expect(after[changed[1]]).toBe('  float densityThreshold = clamp(effBase + heightBoost, 0.02, 0.97)'
      + ' - 2.0 * (1.0 - step(u_densityCut * smoothstep(2.00, 4.00, waveHeight), crestCutHash(vec2(col, row))));');
    expect(crestDensityGlsl(false)).toEqual({ decl: '', drop: '' });
    expect(CREST_DENSITY_GLSL).toEqual(crestDensityGlsl(true));   // the shader's default is the on path
    expect(CREST_CUT_HASH_GLSL).toBe('float crestCutHash(vec2 p) { vec3 p3 = fract(p.xyx * 0.1031); p3 = p3 + dot(p3, p3.yzx + 33.33); '
      + 'return fract((p3.x + p3.y) * p3.z); }');
  });
});

describe('the cut: the shares the owner asked for, as the eye sees them, from the label zooms read off each basemap', () => {
  it('targets: light 17.5% less coverage from z5 (state names in full), beach 12.5% from z6 (coastal towns), dark 12.5% from z8', () => {
    expect(CREST_DENSITY_CUT).toEqual({ dark: { from: 8, cut: 0.125 }, light: { from: 5, cut: 0.175 }, beach: { from: 6, cut: 0.125 } });
  });

  it('the seed cut per theme and zoom is the measured row (scn_density_sweep.js), linear between points, held at the ends', () => {
    const { CREST_DENSITY_SEED_CUT, seedCutAt } = require('./marineCrestDensity');
    expect(CREST_DENSITY_SEED_CUT).toEqual({
      light: [[5, 0.28], [7.4, 0.29], [9, 0.45], [10.5, 0.37]],
      beach: [[6, 0.22], [7.4, 0.23], [9, 0.32], [10.5, 0.26]],
      dark: [[8, 0.26], [8.25, 0.27], [9, 0.33], [10.5, 0.28]],
    });
    expect(seedCutAt('light', 9)).toBeCloseTo(0.45, 9);
    expect(seedCutAt('light', 8.2)).toBeCloseTo(0.29 + (0.16 * 0.8) / 1.6, 9);
    expect(seedCutAt('beach', 14)).toBeCloseTo(0.26, 9);
    expect(seedCutAt('dark', 4)).toBeCloseTo(0.26, 9);
    // Zooms ascend in every row, every cut stays a modest share, and closer zooms (crests stacked deeper) cut more than the start.
    for (const row of Object.values(CREST_DENSITY_SEED_CUT)) {
      for (let i = 1; i < row.length; i++) expect(row[i][0]).toBeGreaterThan(row[i - 1][0]);
      for (const [, cut] of row) { expect(cut).toBeGreaterThan(0); expect(cut).toBeLessThan(0.5); }
      expect(row[row.length - 1][1]).toBeGreaterThan(row[0][1]);
    }
  });

  it('ramps in over the half zoom before each theme starts; dark starts two zooms closer than beach', () => {
    const [DARK, LIGHT, BEACH] = [0, 1, 2];
    expect(crestDensityCut(LIGHT, 4.5)).toBe(0); expect(crestDensityCut(LIGHT, 5)).toBeCloseTo(0.28, 6); expect(crestDensityCut(LIGHT, 9)).toBeCloseTo(0.45, 6);
    expect(crestDensityCut(BEACH, 5.5)).toBe(0); expect(crestDensityCut(BEACH, 6)).toBeCloseTo(0.22, 6); expect(crestDensityCut(BEACH, 9)).toBeCloseTo(0.32, 6);
    expect(crestDensityCut(DARK, 7.5)).toBe(0); expect(crestDensityCut(DARK, 8)).toBeCloseTo(0.26, 6); expect(crestDensityCut(DARK, 9)).toBeCloseTo(0.33, 6);
    expect(crestDensityCut(DARK, 6)).toBe(0);
    const mid = crestDensityCut(LIGHT, 4.75);
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(0.28);
    expect(crestDensityCut(LIGHT, NaN)).toBe(0); expect(crestDensityCut(7, 9)).toBe(0);
  });

  it('the live measurement knob (window.__RAW_CREST_DENSITY_SEED_CUT__) overrides the row, inside each theme ramp only', () => {
    window.__RAW_CREST_DENSITY_SEED_CUT__ = 0.3;
    try {
      expect(crestDensityCut(1, 9)).toBeCloseTo(0.3, 9);
      expect(crestDensityCut(1, 4)).toBe(0);
      window.__RAW_CREST_DENSITY_SEED_CUT__ = 2;
      expect(crestDensityCut(2, 9)).toBe(0.9);   // clamped
    } finally { delete window.__RAW_CREST_DENSITY_SEED_CUT__; }
  });

  it('acts only on big surf: none under 2 m, full from 4 m (crest size saturates at 4 m)', () => {
    expect(CREST_DENSITY_HEIGHTS).toEqual([2.0, 4.0]);
    // A crest goes when its cut hash is under cut x smoothstep(2, 4, h); under 2 m that is 0 and step(0, hash) keeps every crest.
    const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    const goes = (cut, h, hash) => hash < cut * ss(2, 4, h);
    expect(goes(0.35, 1.5, 0)).toBe(false);
    expect(goes(0.35, 5, 0.34)).toBe(true); expect(goes(0.35, 5, 0.36)).toBe(false);
    expect(goes(0.25, 3, 0.12)).toBe(true); expect(goes(0.25, 3, 0.13)).toBe(false);
  });

  it('the cut hash removes the asked share of the 296 x 296 crests (float32, as the GPU does), unlike lowering the threshold', () => {
    const N = 296, hs = [];
    for (let row = 0; row < N; row++) for (let col = 0; col < N; col++) hs.push(crestCutHash(col, row));
    expect(Math.min(...hs)).toBeGreaterThanOrEqual(0); expect(Math.max(...hs)).toBeLessThan(1);
    expect(new Set(hs).size).toBeGreaterThan(10000);   // the sine hash keeps a few hundred values at these indices
    for (const cut of [0.125, 0.175, 0.3]) expect(Math.abs(hs.filter((h) => h < cut).length / hs.length - cut)).toBeLessThan(0.01);
    // any contiguous block of texels (a tile's worth of particles) too
    const block = hs.slice(N * 100, N * 160);
    for (const cut of [0.125, 0.175]) expect(Math.abs(block.filter((h) => h < cut).length / block.length - cut)).toBeLessThan(0.015);
  });

  it('the engine sets u_densityCut from crestDensityCut(themeVal, z) next to u_densityBase', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineEngine.js'), 'utf8');
    expect(src).toContain("gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_densityCut'), crestDensityCut(themeVal, z));");
    expect(src).toContain("import { crestDensityCut } from './marineCrestDensity';");
  });
});
