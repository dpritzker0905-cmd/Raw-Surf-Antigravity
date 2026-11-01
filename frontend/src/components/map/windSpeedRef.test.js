import { resolveWindSpeedRef, WIND_SPEED_REF_KN } from './windSpeedRef';

describe('wind advection speed reference (Jacobian lens: motion per knot is local-only)', () => {
  test('the reference does not depend on the frame (direction or strength of wind elsewhere)', () => {
    const frames = [[0.0, -1.5], [20, 15], [55, 60], [-3, 2]];
    const refs = frames.map((u) => resolveWindSpeedRef(u, {}));
    expect(new Set(refs).size).toBe(1);
    expect(refs[0]).toBe(WIND_SPEED_REF_KN);
  });
  test('d(gamma factor)/d(other cells) = 0: a 10 kn particle keeps its factor across frames', () => {
    const gamma = 1.15;
    const factor = (speed, uMax) => Math.pow(Math.min(1, Math.max(0.02, speed / Math.max(resolveWindSpeedRef(uMax, {}), 1))), gamma - 1);
    expect(factor(10, [0, -1.5])).toBeCloseTo(factor(10, [40, 30]), 12);
  });
  test('legacy kill switch reproduces the old frame-dependent value', () => {
    expect(resolveWindSpeedRef([0.0, -1.5], { __RAW_DISABLE_WIND_FIXED_SPEED_REF__: true })).toBe(1.5);
    expect(resolveWindSpeedRef([30, 40], { __RAW_DISABLE_WIND_FIXED_SPEED_REF__: true })).toBe(50);
  });
});
