import { isUnresolvedDirection } from './marineUnresolvedDirection';
import { packStaticFrame } from './marineFramePack';

afterEach(() => { delete window.__RAW_DISABLE_UNRESOLVED_DIRECTION__; });

describe('isUnresolvedDirection', () => {
  test('GWAM floor: direction exactly 180 with period <= 1.0 and height > 0', () => {
    expect(isUnresolvedDirection(0.11, 1, 180)).toBe(true);
    expect(isUnresolvedDirection(0.11, 0.9, 180)).toBe(true);
  });
  test('real cells keep their direction', () => {
    expect(isUnresolvedDirection(0.11, 1.45, 54)).toBe(false);
    expect(isUnresolvedDirection(0.11, 1, 129)).toBe(false);   // a real sub-second sea elsewhere
    expect(isUnresolvedDirection(0.11, 1.05, 180)).toBe(false);
    expect(isUnresolvedDirection(2, 10, 180)).toBe(false);
    expect(isUnresolvedDirection(0.5, 0, 180)).toBe(false);    // missing period is not the floor
  });
  test('zero height is left to the shaders (calm is culled there)', () => {
    expect(isUnresolvedDirection(0, 0, 0)).toBe(false);
  });
  test('kill switch restores the legacy behaviour', () => {
    window.__RAW_DISABLE_UNRESOLVED_DIRECTION__ = true;
    expect(isUnresolvedDirection(0.11, 1, 180)).toBe(false);
    expect(isUnresolvedDirection(0, 0, 0)).toBe(false);
  });
});

// 5x5 frame: every cell H 1 m, from 54 deg, 6 s, except the centre: the GWAM placeholder (0.11 m, 1.0 s, 180 deg).
function frame() {
  const n = 25;
  const H = new Float64Array(n).fill(1); const D = new Float64Array(n).fill(54); const P = new Float64Array(n).fill(6);
  H[12] = 0.11; D[12] = 180; P[12] = 1;
  return { cols: 5, rows: 5, bounds: { west: -82, east: -78, south: 26, north: 30 }, uvConvention: 0,
    fields: { 0: H, 1: D, 2: P, 3: new Float64Array(n).fill(NaN) } };
}
const dirOf = (bytes, i) => [(bytes[i * 4] / 255) * 2 - 1, (bytes[i * 4 + 1] / 255) * 2 - 1];

describe('placeholder direction in the packed wave texture', () => {
  test('the placeholder cell takes its real neighbours direction; height and period bytes are untouched', () => {
    const out = packStaticFrame(frame());
    const [cu, cv] = dirOf(out.bytes, 12); const [nu, nv] = dirOf(out.bytes, 11);
    expect(cu).toBeCloseTo(nu, 1); expect(cv).toBeCloseTo(nv, 1);
    expect(out.bytes[12 * 4 + 2]).toBeGreaterThan(0);                       // the 0.11 m height still drawn
    expect(out.bytes[12 * 4 + 3]).toBe(Math.floor((1 / 20) * 255));          // period byte still 1 s
  });
  test('kill switch: the invented due-north (from 180) direction returns', () => {
    window.__RAW_DISABLE_UNRESOLVED_DIRECTION__ = true;
    const out = packStaticFrame(frame());
    const [cu, cv] = dirOf(out.bytes, 12);
    expect(Math.abs(cu)).toBeLessThan(0.05); expect(cv).toBeGreaterThan(0.9);
  });
});
