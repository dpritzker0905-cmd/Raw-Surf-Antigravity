import {
  CREST_CLASS_COUNT, CREST_ANCHOR_FADE_S, crestClassPeriod, createCrestPhaseState, stepCrestPhase, crestAnchorFor, applyCrestPhaseUniforms,
  legacyCrestPhase, localCrestBand, CREST_LOCAL_PHASE_GLSL, CREST_PHASE_SPLICE,
} from './crestLocalPhase';
import { waveSetFreq, viewWorldWidth } from './waveSetScreenBound';

// Crest wave-train phase in local coordinates with a fixed period bank (L4, 2026-11-02). Pins, on a SYNTHETIC VARYING field
// (heading turning 6 rad per world unit, period rising 200 s per world unit): the old phase's gradient is many times the band
// frequency and off the swell, and grows with time; the local phase's gradient is the band frequency along the swell, and does
// not change with time or with longitude. Plus the period cue, the class cross-fade, the anchor and its fade, the GLSL.
const W = viewWorldWidth(1440, 6);                 // a z6 desktop view, 0.044 world
const freq = (T) => waveSetFreq(T, W);
const C = [0.5, 0.4];
const heading = (x) => 0.6 + 6 * (x - C[0]);
const dirAt = (x) => [Math.cos(heading(x)), Math.sin(heading(x))];
const periodAt = (y) => 12 + 200 * (y - C[1]);
const state = () => { const s = createCrestPhaseState(); s.cur = C; s.prev = C; s.mix = 1; for (let j = 0; j < CREST_CLASS_COUNT; j++) s.theta[j] = (0.37 * j) % 1; return s; };
const wrap = (d) => d - Math.round(d);
// the phase gradient at p by central differences, against the swell heading there; F = the frequency the band should have
function gradAt(phaseFn, p, F, h = 2e-6) {
  const gx = wrap(phaseFn([p[0] + h, p[1]]) - phaseFn([p[0] - h, p[1]])) / (2 * h);
  const gy = wrap(phaseFn([p[0], p[1] + h]) - phaseFn([p[0], p[1] - h])) / (2 * h);
  const g = Math.hypot(gx, gy), d = dirAt(p[0]);
  return { ratio: g / F, angle: (Math.acos(Math.min(1, Math.abs(gx * d[0] + gy * d[1]) / g)) * 180) / Math.PI, gx: gx / F, gy: gy / F };
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const grid = []; for (let i = -6; i <= 6; i++) for (let k = -6; k <= 6; k++) grid.push([C[0] + i * 0.0017, C[1] + k * 0.0017]);   // a +-0.01 world view

describe('phase gradient against the swell direction on a synthetic varying field', () => {
  const legacy = (t) => (p) => legacyCrestPhase(p, dirAt(p[0]), periodAt(p[1]), t, 1, freq);
  const s = state();
  const local = (p) => localCrestBand(p, dirAt(p[0]), periodAt(p[1]), s, freq).phase;
  const localF = (p) => { const b = localCrestBand(p, dirAt(p[0]), periodAt(p[1]), s, freq); return freq(crestClassPeriod(b.a < 0.5 ? b.j0 : b.j0 + 1)); };

  it('the old phase: |grad| many times F and off the swell; the local phase: |grad| = F along the swell', () => {
    const old = grid.map((p) => gradAt(legacy(0), p, freq(periodAt(p[1]))));
    expect(median(old.map((g) => g.ratio))).toBeGreaterThan(5);
    expect(median(old.map((g) => g.angle))).toBeGreaterThan(15);
    const nu = grid.map((p) => gradAt(local, p, localF(p)));
    expect(Math.abs(median(nu.map((g) => g.ratio)) - 1)).toBeLessThan(0.05);
    expect(Math.max(...nu.map((g) => g.angle))).toBeLessThan(5);
  });

  it('no time shear: after 10 minutes the old gradient has grown, the local one is the same (the class phase is uniform in space)', () => {
    const p = [C[0] + 0.004, C[1] - 0.003];
    const g0 = gradAt(legacy(0), p, freq(periodAt(p[1]))), g600 = gradAt(legacy(600), p, freq(periodAt(p[1])));
    expect(Math.hypot(g600.gx - g0.gx, g600.gy - g0.gy)).toBeGreaterThan(3);   // the shear term t m grad(1/T), in units of F
    const a = gradAt(local, p, localF(p));
    const later = state(); for (let j = 0; j < CREST_CLASS_COUNT; j++) later.theta[j] = (later.theta[j] + 600 / crestClassPeriod(j)) % 1;
    const b = gradAt((q) => localCrestBand(q, dirAt(q[0]), periodAt(q[1]), later, freq).phase, p, localF(p));
    expect(b.ratio).toBeCloseTo(a.ratio, 6); expect(b.angle).toBeCloseTo(a.angle, 4);
  });

  it('the same sea at another longitude: the old phase changes, the local one does not', () => {
    const p = [C[0] + 0.003, C[1] + 0.002], shift = 0.4;
    const oldHere = gradAt(legacy(0), p, freq(periodAt(p[1]))).ratio;
    const oldThere = gradAt((q) => legacyCrestPhase([q[0] + shift, q[1]], dirAt(q[0]), periodAt(q[1]), 0, 1, freq), p, freq(periodAt(p[1]))).ratio;
    expect(Math.abs(oldThere - oldHere)).toBeGreaterThan(1);
    const sh = state(); sh.cur = [C[0] + shift, C[1]]; sh.prev = sh.cur;
    const there = gradAt((q) => localCrestBand([q[0] + shift, q[1]], dirAt(q[0]), periodAt(q[1]), sh, freq).phase, p, localF(p));
    expect(there.ratio).toBeCloseTo(gradAt(local, p, localF(p)).ratio, 6);
  });

  it('the antimeridian: x wraps to the nearest copy, so neighbours across 1 -> 0 keep their phase (the old one jumps)', () => {
    const s2 = state(); s2.cur = [0.999, 0.4]; s2.prev = s2.cur; const d = [1, 0], T = 11;
    const a = localCrestBand([0.9999, 0.4], d, T, s2, freq), b = localCrestBand([0.0001, 0.4], d, T, s2, freq);
    const step = 0.0002 * freq(crestClassPeriod(a.a < 0.5 ? a.j0 : a.j0 + 1));   // what 0.0002 world of travel along d should add
    expect(wrap(b.phase - a.phase)).toBeCloseTo(step, 6);
    const old = wrap(legacyCrestPhase([0.0001, 0.4], d, T, 0, 1, freq) - legacyCrestPhase([0.9999, 0.4], d, T, 0, 1, freq));
    expect(Math.abs(old - 0.0002 * freq(T))).toBeGreaterThan(0.1);   // a jump of d.x F mod 1 at the seam
  });
});

describe('the period bank keeps the period cue', () => {
  it('classes 4 s * 2^(j/4), j = 0..10 (4 to 22.6 s)', () => {
    expect(CREST_CLASS_COUNT).toBe(11);
    expect(crestClassPeriod(0)).toBe(4); expect(crestClassPeriod(4)).toBe(8); expect(crestClassPeriod(10)).toBeCloseTo(22.63, 2);
  });
  it('band speed (m / T_j) / F_j is proportional to T_j from 6 s to 20 s in every view (#404, deep-water spacing ~ T^2)', () => {
    for (const z of [2, 4, 6, 9]) {
      const w = viewWorldWidth(1440, z), speed = (T) => (1 / Math.max(2, T)) / waveSetFreq(T, w);
      for (let j = 3; j <= 9; j++) expect(speed(crestClassPeriod(j)) / speed(crestClassPeriod(3))).toBeCloseTo(crestClassPeriod(j) / crestClassPeriod(3), 6);
    }
  });
  it('the envelope is continuous in T across a class boundary (the cross-fade weight reaches 1 exactly where the next class starts)', () => {
    const s = state();
    for (const j of [2, 5, 8]) {
      const T = crestClassPeriod(j), p = [C[0] + 0.002, C[1]];
      expect(localCrestBand(p, [1, 0], T * (1 - 1e-9), s, freq).band).toBeCloseTo(localCrestBand(p, [1, 0], T * (1 + 1e-9), s, freq).band, 5);
    }
  });
});

describe('the class phases and the anchor', () => {
  it('theta_j integrates m dt / max(2, T_j), stays in [0, 1), and a hidden tab (a long dt) moves it by at most 0.25 s', () => {
    const s = createCrestPhaseState();
    stepCrestPhase(s, 100, 0.8, [0.5, 0.5]);
    expect(Array.from(s.theta)).toEqual(new Array(CREST_CLASS_COUNT).fill(0));
    stepCrestPhase(s, 100.1, 0.8, [0.5, 0.5]);
    for (let j = 0; j < CREST_CLASS_COUNT; j++) expect(s.theta[j]).toBeCloseTo((0.1 * 0.8) / crestClassPeriod(j), 12);
    const before = Array.from(s.theta); stepCrestPhase(s, 5000, 0.8, [0.5, 0.5]);
    for (let j = 0; j < CREST_CLASS_COUNT; j++) expect(s.theta[j] - before[j]).toBeCloseTo((0.25 * 0.8) / crestClassPeriod(j), 12);
    for (let i = 0; i < 2000; i++) stepCrestPhase(s, 5000 + i * 0.2, 1, [0.5, 0.5]);
    for (const th of s.theta) { expect(th).toBeGreaterThanOrEqual(0); expect(th).toBeLessThan(1); }
  });
  it('a re-anchor cross-fades from the old anchor to the new one over CREST_ANCHOR_FADE_S', () => {
    const s = createCrestPhaseState();
    stepCrestPhase(s, 10, 1, [0.2, 0.3]); expect(s.mix).toBe(1);
    stepCrestPhase(s, 11, 1, [0.25, 0.3]);
    expect([s.prev, s.cur, s.mix]).toEqual([[0.2, 0.3], [0.25, 0.3], 0]);
    stepCrestPhase(s, 11 + CREST_ANCHOR_FADE_S / 2, 1, [0.25, 0.3]); expect(s.mix).toBeCloseTo(0.5, 9);
    stepCrestPhase(s, 11 + CREST_ANCHOR_FADE_S, 1, [0.25, 0.3]); expect(s.mix).toBe(1);
    // at mix 1 the envelope is the new anchor's alone
    const p = [0.251, 0.3], one = localCrestBand(p, [1, 0], 10, s, freq), solo = localCrestBand(p, [1, 0], 10, { ...s, prev: s.cur }, freq);
    expect(one.band).toBeCloseTo(solo.band, 12);
  });
  it('a second re-anchor early in a fade replaces the incoming anchor and keeps the outgoing one', () => {
    const s = createCrestPhaseState();
    stepCrestPhase(s, 0, 1, [0.1, 0.1]); stepCrestPhase(s, 1, 1, [0.2, 0.1]); stepCrestPhase(s, 1.2, 1, [0.3, 0.1]);
    expect([s.prev, s.cur, s.mix]).toEqual([[0.1, 0.1], [0.3, 0.1], 0]);
  });
  it('anchor: the particle tile centre when the tile is narrower than the world; else the camera, held until it drifts half a cell', () => {
    const s = createCrestPhaseState();
    expect(crestAnchorFor(s, { tileCenter: [0.3, 0.4], tileWidth: 0.125, cx: 0.31, cy: 0.41, zoom: 7 })).toEqual([0.3, 0.4]);
    expect(crestAnchorFor(s, { tileCenter: [0.3, 0.4], tileWidth: 1, cx: 0.31, cy: 0.41, zoom: 3.5 })).toEqual([0.31, 0.41]);
    s.cur = [0.31, 0.41];   // z3.5: cell 2^-(3-1) = 0.25 world, held within +-0.125
    expect(crestAnchorFor(s, { tileCenter: null, tileWidth: 1, cx: 0.40, cy: 0.41, zoom: 3.5 })).toBe(s.cur);
    expect(crestAnchorFor(s, { tileCenter: null, tileWidth: 1, cx: 0.45, cy: 0.41, zoom: 3.5 })).toEqual([0.45, 0.41]);
    s.cur = [0.99, 0.5];    // across the antimeridian the drift is the short way round
    expect(crestAnchorFor(s, { tileCenter: null, tileWidth: 1, cx: 0.02, cy: 0.5, zoom: 2.5 })).toBe(s.cur);
  });
  it('applyCrestPhaseUniforms: steps the engine\'s state and sets anchor, mix and the 11 class phases', () => {
    const set = {}, gl = { uniform1f: (l, v) => { set[l] = v; }, uniform4f: (l, ...v) => { set[l] = v; }, uniform1fv: (l, v) => { set[l] = Array.from(v); }, getUniformLocation: (p, n) => n };
    const eng = {};
    applyCrestPhaseUniforms(gl, {}, eng, { time: 3, motionScale: 1, cx: 0.4, cy: 0.5, zoom: 7, tileWidth: 0.125, tileCenter: [0.41, 0.52] });
    expect(set.u_crestLocal).toBe(1); expect(set.u_crestAnchor).toEqual([0.41, 0.52, 0.41, 0.52]); expect(set.u_crestAnchorMix).toBe(1);
    expect(set['u_crestClassPhase[0]']).toHaveLength(CREST_CLASS_COUNT);
    expect(eng._crestPhase.lastT).toBe(3);
  });
});

describe('the GLSL', () => {
  it('declares the uniforms, wraps x, picks two classes and cross-fades both anchors; v_phase and the band read it, the old lines stay under u_crestLocal = 0', () => {
    expect(CREST_LOCAL_PHASE_GLSL).toContain('uniform float u_crestClassPhase[11];');
    expect(CREST_LOCAL_PHASE_GLSL).toContain('d.x = d.x - floor(d.x + 0.5);');
    expect(CREST_LOCAL_PHASE_GLSL).toContain('waveSetFreq(4.0 * exp2(j0 / 4.0), w)');
    expect(CREST_LOCAL_PHASE_GLSL).toContain('mix(bp, bc, u_crestAnchorMix)');
    expect(CREST_PHASE_SPLICE.vPhase).toContain('v_phase = u_crestLocal > 0.5 ? localBand.y : trainPhase;');
    expect(CREST_PHASE_SPLICE.crestBand).toContain('u_crestLocal > 0.5 ? localBand.x : 1.0 - smoothstep(0.08, 0.30, abs(train - 0.5))');
    expect(CREST_PHASE_SPLICE.orbPhase).toContain('mix(fract(dot(global_pos, dir) * sf - ts), crestLocalBand(');
    expect(CREST_LOCAL_PHASE_GLSL).not.toContain('+=');
  });
});
