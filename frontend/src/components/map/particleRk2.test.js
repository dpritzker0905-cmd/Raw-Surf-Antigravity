import { advectStep, WIND_RK2_GLSL, WIND_RK2_STEP, MARINE_RK2_PROTO, MARINE_RK2_GLSL, MARINE_RK2_STEP, RK2_AT_LOAD } from './particleRk2';

// RK2 midpoint advection (L4, 2026-11-02): Euler spirals outward in a vortex. Pins: in a Rankine vortex the midpoint rule keeps
// the radius (drift ~0) where Euler grows it by the measured 11-33%; in a uniform field both rules are the same step; the shader
// splices step at global_pos + offset / 2 and keep everything else of the pass at p.
const rankine = (vmax, core = 15) => (x, y) => {
  const r = Math.hypot(x, y); if (r === 0) return [0, 0];
  const v = r < core ? (vmax * r) / core : (vmax * core) / r;
  return [(-y / r) * v, (x / r) * v];
};
const drift = (field, r0, frames, rk2) => { let p = [r0, 0]; for (let i = 0; i < frames; i++) p = advectStep(p, field, rk2); return Math.hypot(...p) / r0 - 1; };
const PX_PER_FRAME_PER_KN = 0.0704;   // WebGLWindEngine: screen speed per knot (zoom-invariant by design)

describe('radius drift in a Rankine vortex (core 15 px, 30-frame life)', () => {
  it('Euler spirals out (20 kn: +11% at the core edge, 40 kn: +33%); the midpoint rule holds the circle', () => {
    for (const [kn, eulerAtCore] of [[20, 0.11], [40, 0.33]]) {
      const f = rankine(kn * PX_PER_FRAME_PER_KN);
      expect(drift(f, 15, 30, false)).toBeGreaterThan(eulerAtCore * 0.95);
      for (const r of [5, 10, 15, 20, 30, 45]) expect(Math.abs(drift(f, r, 30, true))).toBeLessThan(0.01);   // inside the core 30 (omega h)^4 / 8: 0.47% at 40 kn
    }
  });
  it('a 30 Hz screen (twice the step): Euler +76% at 40 kn, RK2 still under 1%', () => {
    const f = rankine(2 * 40 * PX_PER_FRAME_PER_KN);
    expect(drift(f, 15, 30, false)).toBeGreaterThan(0.7);
    expect(Math.abs(drift(f, 15, 30, true))).toBeLessThan(0.01);
  });
  it('per-step radial growth: Euler ~(omega h)^2 / 2, midpoint ~(omega h)^4 / 8', () => {
    const wh = 0.05, f = (x, y) => [-y * wh, x * wh];   // solid rotation, omega h = 0.05 per step
    const e = Math.hypot(...advectStep([1, 0], f, false)) - 1, m = Math.hypot(...advectStep([1, 0], f, true)) - 1;
    expect(e).toBeCloseTo(wh ** 2 / 2, 5);
    expect(m).toBeCloseTo(wh ** 4 / 8, 8);
  });
});

describe('analytic uniform and linear fields', () => {
  it('uniform field: both rules take the same, exact step', () => {
    const f = () => [0.3, -0.1];
    expect(advectStep([1, 2], f, true)).toEqual(advectStep([1, 2], f, false));
    expect(advectStep([1, 2], f, true)).toEqual([1.3, 1.9]);
  });
  it('a sheared field v = (y, 0): the midpoint step equals the exact solution of the ODE over one step', () => {
    const f = (x, y) => [0.1 * y, 0.05];
    const [x, y] = advectStep([0, 1], f, true);
    expect(x).toBeCloseTo(0.1 * 1 + 0.1 * 0.05 / 2, 12);   // integral of 0.1 (1 + 0.05 t) dt over t in [0, 1]
    expect(y).toBeCloseTo(1.05, 12);
  });
});

describe('the GLSL splices', () => {
  it('on by default; the wind step samples the field at global_pos + offset / 2 and keeps the vortex gate from p', () => {
    expect(RK2_AT_LOAD).toBe(true);
    expect(WIND_RK2_STEP).toContain('offset = windMidOffset(global_pos + 0.5 * offset, vortexGate)');
    expect(WIND_RK2_GLSL).toContain('uniform float u_rk2;');
    expect(WIND_RK2_GLSL).toContain('pow(speedNorm, mix(u_speed_gamma, 1.0, vortexGate) - 1.0)');
    expect(WIND_RK2_GLSL).toContain('mix(wind, mix(u_fine_min, u_fine_max');
  });
  it('the marine midpoint: same field, nearest heading, height cap, energy boost and coherence damping; off the field it keeps the Euler step', () => {
    expect(MARINE_RK2_STEP).toContain('offset = marineMidOffset(global_pos + 0.5 * offset, offset)');
    expect(MARINE_RK2_PROTO).toContain('vec2 marineMidOffset(vec2 gp, vec2 k1);');
    for (const s of ['u_coarseNearestDir > 0.5 && !uc', 'min(h, u_speedHeightCap) * 0.1', 'smoothstep(1.0, 5.0, h) * 0.3', 'smoothstep(0.0, u_dirCoherenceMin, coh)', 'if (!inRes && !uc) return k1;'])
      expect(MARINE_RK2_GLSL).toContain(s);
    expect(MARINE_RK2_GLSL).not.toContain('float waveHeight = waveData.b * 10.0;');   // withHeightScale's one decode stays the pass's own
    for (const s of [WIND_RK2_GLSL, MARINE_RK2_GLSL]) expect(s).not.toContain('+=');
  });
  it('killed before load: every splice is empty (the shader text is the old one, pinned in motionFixes.killSwitch.test.js)', () => {
    jest.isolateModules(() => {
      window.__RAW_DISABLE_RK2_ADVECTION__ = true;
      try {
        const k = require('./particleRk2');
        expect([k.WIND_RK2_GLSL, k.WIND_RK2_STEP, k.MARINE_RK2_PROTO, k.MARINE_RK2_GLSL, k.MARINE_RK2_STEP]).toEqual(['', '', '', '', '']);
      } finally { delete window.__RAW_DISABLE_RK2_ADVECTION__; }
    });
  });
});
