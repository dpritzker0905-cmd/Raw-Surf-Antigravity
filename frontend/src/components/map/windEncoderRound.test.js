import { windByteRange, windByte, decodeWindByte, windEncoderRoundOn } from './windEncoderRound';
import { encodeWindTexture } from './WebGLWindUtils';

// The wind encoder rounds on a zero-aligned lattice (L4, 2026-11-02: floor() biased every u/v by up to a step, and calm air
// decoded as ~0.3 kn toward the south-west). Pins: the round trip, calm exactly 0, the range widened by under one step, the kill.
const ranges = [[-12.3, 17.1], [-40, 40], [-0.4, 25.2], [-63.7, 2.2], [3, 18], [-22, -1]];

describe('the round trip', () => {
  it('every value decodes within half a step (floor: up to a whole step, biased low)', () => {
    for (const [mn, mx] of ranges) {
      const { min, max } = windByteRange(mn, mx, true), step = (max - min) / 255;
      let worst = 0, worstFloor = 0, biasFloor = 0, n = 0;
      for (let x = mn; x <= mx; x += (mx - mn) / 997) {
        const e = decodeWindByte(windByte(x, min, max, true), min, max) - x;
        const ef = decodeWindByte(windByte(x, mn, mx, false), mn, mx) - x;
        worst = Math.max(worst, Math.abs(e)); worstFloor = Math.max(worstFloor, Math.abs(ef)); biasFloor += ef; n += 1;
      }
      expect(worst).toBeLessThanOrEqual(step / 2 + 1e-9);
      expect(worstFloor).toBeGreaterThan(0.9 * ((mx - mn) / 255));
      expect(biasFloor / n).toBeLessThan(-0.4 * ((mx - mn) / 255));
    }
  });
  it('calm decodes as exactly 0 when the range straddles zero (floor: about -range/510, a breeze toward the south-west)', () => {
    for (const [mn, mx] of ranges.filter(([a, b]) => a < 0 && b > 0)) {
      const { min, max } = windByteRange(mn, mx, true);
      expect(Math.abs(decodeWindByte(windByte(0, min, max, true), min, max))).toBeLessThan(1e-12);
      const floorCalm = decodeWindByte(windByte(0, mn, mx, false), mn, mx);
      expect(floorCalm).toBeLessThan(0);
      expect(Math.abs(floorCalm)).toBeLessThanOrEqual((mx - mn) / 255 + 1e-12);
    }
    const r = windByteRange(-40, 40, true);   // the symmetric case: floor and plain rounding both miss zero by range/510
    expect(decodeWindByte(windByte(0, -40, 40, false), -40, 40)).toBeCloseTo(-80 / 510, 9);
    expect(decodeWindByte(Math.round(0.5 * 255), -40, 40)).toBeCloseTo(80 / 510, 9);
    expect(decodeWindByte(windByte(0, r.min, r.max, true), r.min, r.max)).toBeCloseTo(0, 12);
  });
  it('the lattice covers the data and widens it by under one step; a one-sided range is left alone', () => {
    for (const [mn, mx] of ranges) {
      const { min, max } = windByteRange(mn, mx, true);
      if (mn < 0 && mx > 0) {
        expect(min).toBeLessThanOrEqual(mn + 1e-12); expect(max).toBeGreaterThanOrEqual(mx - 1e-12);
        expect((max - min) - (mx - mn)).toBeLessThan((max - min) / 255);
      } else expect({ min, max }).toEqual({ min: mn, max: mx });
    }
  });
  it('bytes stay in 0..255 at both ends', () => {
    const { min, max } = windByteRange(-12.3, 17.1, true);
    expect(windByte(min, min, max, true)).toBe(0); expect(windByte(max, min, max, true)).toBe(255);
  });
});

describe('encodeWindTexture', () => {
  const grid = { cols: 3, rows: 1, bounds: { west: 0, east: 10, south: 0, north: 5 },
    vectors: [{ u: -12.3, v: 4, speed: 12.9 }, { u: 0, v: 0, speed: 0 }, { u: 17.1, v: -6, speed: 18.1 }] };
  const mockGl = () => {
    const up = [];
    return { up, gl: { TEXTURE_2D: 1, TEXTURE_WRAP_S: 2, TEXTURE_WRAP_T: 3, TEXTURE_MIN_FILTER: 4, TEXTURE_MAG_FILTER: 5, CLAMP_TO_EDGE: 6, LINEAR: 7, RGBA: 8, UNSIGNED_BYTE: 9, REPEAT: 10, TEXTURE_BINDING_2D: 11,
      getParameter: () => null, createTexture: () => ({}), bindTexture: () => {}, texParameteri: () => {}, pixelStorei: () => {}, texImage2D: (...a) => up.push(a[8]) } };
  };
  afterEach(() => { delete window.__RAW_DISABLE_WIND_ENCODER_ROUND__; });
  it('on: the returned range is the lattice the bytes use, and the calm cell decodes to (0, 0)', () => {
    const { gl, up } = mockGl(), enc = encodeWindTexture(gl, grid), bytes = up[0];
    expect(enc.uMin[0]).toBeLessThanOrEqual(-12.3); expect(enc.uMax[0]).toBeGreaterThanOrEqual(17.1);
    expect(decodeWindByte(bytes[4], enc.uMin[0], enc.uMax[0])).toBeCloseTo(0, 12);
    expect(decodeWindByte(bytes[5], enc.uMin[1], enc.uMax[1])).toBeCloseTo(0, 12);
  });
  it('killed: the old floor bytes and the raw range, byte for byte', () => {
    window.__RAW_DISABLE_WIND_ENCODER_ROUND__ = true;
    expect(windEncoderRoundOn()).toBe(false);
    const { gl, up } = mockGl(), enc = encodeWindTexture(gl, grid), bytes = up[0];
    expect([enc.uMin, enc.uMax]).toEqual([[-12.3, -6], [17.1, 4]]);
    const want = (x, a, b) => Math.floor(((x - a) / (b - a)) * 255);
    expect(Array.from(bytes)).toEqual([want(-12.3, -12.3, 17.1), want(4, -6, 4), Math.floor((12.9 / 18.1) * 255), 255,
      want(0, -12.3, 17.1), want(0, -6, 4), 0, 255, want(17.1, -12.3, 17.1), want(-6, -6, 4), 255, 255]);
  });
});
