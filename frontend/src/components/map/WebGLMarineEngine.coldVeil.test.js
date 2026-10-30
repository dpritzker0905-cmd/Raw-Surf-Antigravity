import { resolveColdVeil } from './WebGLMarineEngine';

// COLD-ACTIVATION COARSE VEIL (2026-07-18, user re-report of the first-activation swap: the
// coarse-global cold first paint at coastal zoom flashes a wrong-colored heatmap ~3 s before the
// regional sharpen). Locks: veil holds at 0 while a coarse-global resident sits at a coastal
// viewport, lifts on adequate resident / grace expiry / rating exemption, 350 ms smoothstep
// reveal, never-engaged fast path stays pixel-identical, kill switch ends the lifecycle,
// bounded grace default 4000 ms.

const WIN = {};
const KILLED = { __RAW_DISABLE_COLD_COARSE_VEIL__: true };

const COASTAL_COARSE = { residentCoarseGlobal: true, viewportSpanDeg: 1.8, isRating: false };
const veil = (t0 = 1000) => ({ t0 });

describe('resolveColdVeil', () => {
  it('no veil state passes through', () => {
    expect(resolveColdVeil(null, COASTAL_COARSE, 1234, WIN)).toEqual({ mult: 1.0, veil: null });
  });

  it('kill switch ends the lifecycle immediately', () => {
    expect(resolveColdVeil(veil(), COASTAL_COARSE, 1100, KILLED)).toEqual({ mult: 1.0, veil: null });
  });

  it('debug-isolate overlay mode ends the lifecycle (respects the debug override)', () => {
    const r = resolveColdVeil(veil(), { ...COASTAL_COARSE, debugIsolate: true }, 1100, WIN);
    expect(r).toEqual({ mult: 1.0, veil: null });
  });

  it('VEILS (mult 0) while a coarse-global resident sits at a coastal viewport', () => {
    const v = veil(1000);
    const r = resolveColdVeil(v, COASTAL_COARSE, 2000, WIN);
    expect(r.mult).toBe(0.0);
    expect(r.veil).toBe(v);
    expect(v.liftT0).toBeUndefined();
  });

  it('NEVER HID A FRAME (D11, 2026-10-28): the first render after a WebGL context restore, > 50 ms after its cold commit, is not ramped up from 0', () => {
    // The lead's fuzzer (min-gl, 3/3): GFS z4.6 world frame, context lost and restored 800 ms later; the re-mounted layer's first
    // frame drew at opacity 0 (__RAW_GPU__.coldVeil { mult: 0, lifted: true, reason: 'adequate' }) and then faded in over 350 ms.
    const wide = { residentCoarseGlobal: true, viewportSpanDeg: 40, isRating: false };
    expect(resolveColdVeil(veil(1000), wide, 1200, WIN)).toEqual({ mult: 1.0, veil: null });
    expect(resolveColdVeil(veil(1000), { residentCoarseGlobal: false, viewportSpanDeg: 2, isRating: false }, 1324, WIN)).toEqual({ mult: 1.0, veil: null });
    // A veil that DID hide frames still reveals with its ramp (the designed regional sharpen swap).
    const v = veil(1000);
    expect(resolveColdVeil(v, COASTAL_COARSE, 1100, WIN).mult).toBe(0.0);
    const lift = resolveColdVeil(v, { ...COASTAL_COARSE, residentCoarseGlobal: false }, 2000, WIN);
    expect(lift.mult).toBe(0); expect(lift.veil.reason).toBe('adequate');
    // Kill: __RAW_DISABLE_VEIL_NEVER_HID__ restores the 50 ms timing rule alone (the ramp from 0 again).
    const k = resolveColdVeil(veil(1000), wide, 1200, { __RAW_DISABLE_VEIL_NEVER_HID__: true });
    expect(k.mult).toBe(0); expect(k.veil.liftT0).toBe(1200);
  });

  it('NEVER-ENGAGED fast path: adequate within 50 ms of the stamp ends with no ramp (wide zoom stays identical)', () => {
    const r = resolveColdVeil(veil(1000), { residentCoarseGlobal: true, viewportSpanDeg: 40, isRating: false }, 1010, WIN);
    expect(r).toEqual({ mult: 1.0, veil: null });
  });

  it('rating grids are exempt — the band paints from coarse data by design', () => {
    const r = resolveColdVeil(veil(1000), { ...COASTAL_COARSE, isRating: true }, 1010, WIN);
    expect(r).toEqual({ mult: 1.0, veil: null });
  });

  it('LIFT on adequate resident (the regional sharpen): stamps liftT0 + reason, ramps from 0', () => {
    const v = veil(1000);
    resolveColdVeil(v, COASTAL_COARSE, 2000, WIN);                     // engaged
    const r = resolveColdVeil(v, { residentCoarseGlobal: false, viewportSpanDeg: 1.8, isRating: false }, 3000, WIN);
    expect(v.liftT0).toBe(3000);
    expect(v.reason).toBe('adequate');
    expect(r.mult).toBe(0);                                            // ramp starts at 0
  });

  it('reveal ramp is smoothstep: midpoint at 175/350 ms, done (state ends) at 350 ms', () => {
    const v = { t0: 1000, liftT0: 3000, reason: 'adequate' };
    const mid = resolveColdVeil(v, COASTAL_COARSE, 3175, WIN);
    expect(mid.mult).toBeCloseTo(0.5, 6);
    const done = resolveColdVeil(v, COASTAL_COARSE, 3350, WIN);
    expect(done).toEqual({ mult: 1.0, veil: null });
  });

  it('GRACE expiry (default 4000 ms) reveals the coarse anyway — never an unbounded blank', () => {
    const v = veil(1000);
    const r = resolveColdVeil(v, COASTAL_COARSE, 5001, WIN);
    expect(v.liftT0).toBe(5001);
    expect(v.reason).toBe('grace');
    expect(r.mult).toBe(0);                                            // ramp begins immediately
    expect(resolveColdVeil(v, COASTAL_COARSE, 5001 + 350, WIN)).toEqual({ mult: 1.0, veil: null });
  });

  it('grace is tunable via __RAW_COLD_VEIL_GRACE_MS__', () => {
    const w = { __RAW_COLD_VEIL_GRACE_MS__: 100 };
    const v = veil(1000);
    resolveColdVeil(v, COASTAL_COARSE, 1101, w);
    expect(v.reason).toBe('grace');
  });

  it('unknown viewport span never veils (insufficient data → visible)', () => {
    const r = resolveColdVeil(veil(1000), { residentCoarseGlobal: true, viewportSpanDeg: 0, isRating: false }, 1010, WIN);
    expect(r).toEqual({ mult: 1.0, veil: null });
  });
});
