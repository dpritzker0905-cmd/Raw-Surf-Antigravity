import { createHash } from 'crypto';
import { DRAW_FS, DRAW_VS } from './WebGLMarineParticleShaders';
import { LIGHT_CRESTS, LIGHT_CREST_ID, LIGHT_CREST_CROSS, LIGHT_CREST_CROSSES, SPECTRUM_CREST_LIFT, lightCrestGlsl, resolveLightCrest, resolveSpectrumCrestLift }
  from './marineCrestPalette';

// LIGHT CREST CROSSES (owner A/B, 2026-10-22: "Light mode I if we acn do a cross between no two-tone and v2 , would maybe be best?").
// Pins: x1 draws by default over light's spectrum and v2 washes; the kill (window.__RAW_DISABLE_LIGHT_CREST_CROSS__) draws dev 9b49111e8's
// DRAW_FS and DRAW_VS byte for byte; each cross changes light's four colour lines (smooth ramps, never a step) and adds #431's light-only
// far-zoom lift to DRAW_VS, nothing else; dark and beach draw exactly as before; V2 on request and its kill behave as before.
const sha = (s) => createHash('sha256').update(s).digest('hex');
// dev 9b49111e8 (#448): the original light crests (D-041), no two-tone (D-044), dark's 8 m+ storm casing (D-039).
const DEV = { DRAW_FS: { sha: 'e24385865160c841d04f9bfb8108f4bcda361fe8512648ae8f4a5e372d0289e5', length: 8872 },
  DRAW_VS: 'b1569be996bc67eb85cc51e77e995d011b28700711214f480a5e3748034cf9a3' };
// The default, x1, as built by this change (the A/B the owner looks at).
const X1 = { DRAW_FS: 'd75b2bbf6de6ed2401c18f67c704115b945b67fe2ef32c173f0cc5d636673bac', DRAW_VS: '5bd171fbd5cec5efa14f74d3139f362f69173ab15ee33652c60368e069430cb8' };
const KILL = { __RAW_DISABLE_LIGHT_CREST_CROSS__: true };
const NL = String.fromCharCode(10);
const withWindow = (levers, fn) => jest.isolateModules(() => {
  Object.assign(window, levers);
  try { fn(require('./WebGLMarineParticleShaders'), require('./marineCrestPalette')); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
});
const shadersUnder = (levers) => { let out; withWindow(levers, (s, c) => { out = { fs: s.DRAW_FS, vs: s.DRAW_VS, id: c.LIGHT_CREST_ID }; }); return out; };
const branch = (lines, i) => {   // which DRAW_FS theme branch line i sits in
  const beachAt = lines.findIndex((l) => l.includes('if (u_theme > 1.5) {')), lightAt = lines.findIndex((l) => l.includes('} else if (u_theme > 0.5) {'));
  const darkAt = lines.findIndex((l, k) => k > lightAt && l.trim() === '} else {');
  return i > beachAt && i < lightAt ? 'beach' : i > lightAt && i < darkAt ? 'light' : 'other';
};
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// DRAW_FS's light crest colour at height h, before shading: calm -> active -> storm by energy, each line ramped or stepped per the table.
const crestAt = (t, h) => {
  const at = (l) => (!l.above ? l.rgb : mix(l.rgb, l.above, t.ramp ? ss(t.ramp[0], t.ramp[1], h) : h >= t.switchHeight ? 1 : 0));
  const e = ss(0, 6, h);
  return e < 0.5 ? mix(at(t.calm), at(t.active), e * 2) : mix(at(t.active), at(t.storm), (e - 0.5) * 2);
};
const maxStep = (t) => {   // the largest channel change between heights 0.1 m apart, 0 to 14 m
  let m = 0;
  for (let k = 1; k <= 140; k += 1) m = Math.max(m, ...crestAt(t, k / 10).map((v, i) => Math.abs(v - crestAt(t, (k - 1) / 10)[i])));
  return m;
};

describe('the default: x1 over the spectrum (the owner looks at it before anything merges)', () => {
  it('is x1, with its four light lines and the far-zoom lift', () => {
    expect([LIGHT_CREST_CROSS, LIGHT_CREST_ID, LIGHT_CREST_CROSSES]).toEqual(['x1', 'x1', ['x1', 'x2', 'x3']]);
    for (const k of ['calm', 'active', 'storm', 'foam']) expect(DRAW_FS).toContain(lightCrestGlsl('x1')[k]);
    expect(DRAW_FS).toContain('activeColor = mix(vec3(0.85, 0.50, 0.00), vec3(1.00, 0.82, 0.45), smoothstep(2.00, 2.90, v_wave_height));  // amber-gold to light gold, 2-2.9 m');
    expect(DRAW_FS).toContain('foamHighlight = mix(vec3(0.10, 0.12, 0.25), vec3(1.00, 1.00, 1.00), smoothstep(2.00, 2.90, v_wave_height));  // navy foam to white, 2-2.9 m');
    expect(resolveSpectrumCrestLift({}, 'x1')).toEqual(SPECTRUM_CREST_LIFT);
    expect([sha(DRAW_FS), sha(DRAW_VS)]).toEqual([X1.DRAW_FS, X1.DRAW_VS]);
  });

  it('is the measured candidate (light-crest-cross.mjs): navy calm, amber to light gold and navy foam to white over 2-2.9 m, light coral storms', () => {
    expect(LIGHT_CRESTS.x1).toEqual({
      ramp: [2.0, 2.9], lift: true,
      calm: { rgb: [0.05, 0.15, 0.45], name: 'deep navy' },
      active: { rgb: [0.85, 0.50, 0.00], above: [1.00, 0.82, 0.45], name: 'amber-gold to light gold, 2-2.9 m' },
      storm: { rgb: [1.00, 0.76, 0.66], name: 'light coral' },
      foam: { rgb: [0.10, 0.12, 0.25], above: [1.00, 1.00, 1.00], name: 'navy foam to white, 2-2.9 m' },
    });
  });
});

describe('the kill (window.__RAW_DISABLE_LIGHT_CREST_CROSS__) is today exactly', () => {
  it('draws dev 9b49111e8\'s DRAW_FS and DRAW_VS byte for byte, over any lever', () => {
    for (const levers of [KILL, { ...KILL, __RAW_LIGHT_CREST_CROSS__: 'x2' }, { ...KILL, __RAW_LIGHT_CREST_CROSS__: 'x3' }]) {
      const s = shadersUnder(levers);
      expect(s.id).toBe('v1');
      expect([s.fs.length, sha(s.fs), sha(s.vs)]).toEqual([DEV.DRAW_FS.length, DEV.DRAW_FS.sha, DEV.DRAW_VS]);
    }
    expect(resolveSpectrumCrestLift({}, 'v1')).toBeNull();
  });

  it('the older light kills still draw the original too (the V2 kill; a wash other than the spectrum or v2)', () => {
    expect(resolveLightCrest({ __RAW_DISABLE_LIGHT_CREST_V2__: true }, true, 'spectrum')).toBe('v1');
    expect(resolveLightCrest({}, true, 'v1')).toBe('v1');
    expect(resolveLightCrest({}, false, 'spectrum')).toBe('v1');
  });
});

describe('the levers and V2', () => {
  it('x2 and x3 on request; an unknown value is the default; over v2\'s wash too', () => {
    for (const x of ['x2', 'x3']) expect(shadersUnder({ __RAW_LIGHT_CREST_CROSS__: x }).id).toBe(x);
    for (const bad of ['x9', 'toString', true, 2]) expect(resolveLightCrest({ __RAW_LIGHT_CREST_CROSS__: bad }, true, 'spectrum')).toBe('x1');
    expect(resolveLightCrest({ __RAW_LIGHT_CREST_CROSS__: 'x3' }, true, 'v2')).toBe('x3');
  });

  it('V2 on request wins over the cross (v2s over the spectrum, v2 over its own wash); the V2 kill wins over both', () => {
    const V2 = { __RAW_LIGHT_CREST_V2__: true };
    expect([resolveLightCrest(V2, true, 'spectrum'), resolveLightCrest(V2, true, 'v2'), resolveLightCrest({ ...V2, __RAW_LIGHT_CREST_CROSS__: 'x2' }, true, 'spectrum')])
      .toEqual(['v2s', 'v2', 'v2s']);
    expect(resolveLightCrest({ ...V2, __RAW_DISABLE_LIGHT_CREST_V2__: true }, true, 'spectrum')).toBe('v1');
  });
});

describe('each cross changes light only, and is one continuous family', () => {
  const today = shadersUnder(KILL);
  it('DRAW_FS: only calm, active, storm and foam, inside the light branch; DRAW_VS: only the light-only lift and its u_theme', () => {
    for (const x of LIGHT_CREST_CROSSES) {
      const s = shadersUnder({ __RAW_LIGHT_CREST_CROSS__: x }), before = today.fs.split(NL), after = s.fs.split(NL);
      expect(after.length).toBe(before.length);
      const changed = after.map((_, i) => i).filter((i) => after[i] !== before[i]);
      // every cross keeps the original's deep navy calm line; active, storm and foam change
      expect(changed.map((i) => after[i].trim().split(' ')[0])).toEqual(['activeColor', 'stormColor', 'foamHighlight']);
      for (const i of changed) expect(branch(after, i)).toBe('light');
      const vs = s.vs.split(NL).filter((l) => !l.startsWith('  if (u_theme > 0.5 && u_theme < 1.5) zoomAlphaScale *= mix(') && !l.startsWith('uniform mediump float u_theme;'));
      expect(sha(vs.join(NL))).toBe(DEV.DRAW_VS);
      expect(s.vs.length).toBeGreaterThan(today.vs.length);
    }
  });

  it('ramps, never steps: every two-colour line mixes by smoothstep over the cross\'s own ramp, low end first', () => {
    for (const x of LIGHT_CREST_CROSSES) {
      const t = LIGHT_CRESTS[x], g = lightCrestGlsl(x);
      expect(t.ramp[0]).toBeLessThan(t.ramp[1]);
      for (const k of ['calm', 'active', 'storm', 'foam']) {
        expect(g[k]).not.toMatch(/[^h]step\(/);
        if (t[k].above) expect(g[k]).toContain(`smoothstep(${t.ramp[0].toFixed(2)}, ${t.ramp[1].toFixed(2)}, v_wave_height)`);
      }
    }
  });

  // Measured: the original 0.040 (its energy blend alone), x1 0.067, x2 0.069, x3 0.048; V2 0.90 at its switch (2.35 m over the spectrum).
  it('no visible switch: the colour moves at most 0.08 per channel between heights 0.1 m apart (V2 jumps by 0.9)', () => {
    for (const x of LIGHT_CREST_CROSSES) expect(maxStep(LIGHT_CRESTS[x])).toBeLessThan(0.08);
    expect(maxStep(LIGHT_CRESTS.v1)).toBeLessThan(0.08);
    expect(maxStep(LIGHT_CRESTS.v2s)).toBeGreaterThan(0.85);
  });

  it('dark and beach keep their literals', () => {
    for (const x of LIGHT_CREST_CROSSES) {
      const { fs } = shadersUnder({ __RAW_LIGHT_CREST_CROSS__: x });
      for (const lit of ['calmColor = vec3(0.10, 0.95, 0.60);    // mint-green', 'calmColor = vec3(1.00, 0.45, 0.65);    // orchid-pink',
        'activeColor = vec3(0.00, 0.92, 0.85);  // electric turquoise', 'foamHighlight = vec3(0.95, 0.95, 1.00);']) expect(fs).toContain(lit);
    }
  });
});
