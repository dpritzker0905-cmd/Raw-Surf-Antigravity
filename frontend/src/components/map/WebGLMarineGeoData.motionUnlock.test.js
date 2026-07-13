/**
 * §4.2 MOTION-UNLOCK goldens (2026-07-13): rating grids carry a MOTION-water array into
 * dataMask.g (color-water stays in .r) so the particle shaders can lift their land checks to
 * max(mask.r, mask.g * u_motionUnlock). Ship OFF — with the uniform at 0 (or no motion array)
 * everything must stay byte-identical to legacy.
 */
import { getMarineGeoData } from './WebGLMarineGeoData';
import { ADVECT_FS, DRAW_VS } from './WebGLMarineParticleShaders';

// 3x3 grid: row0 = land (0), row1 = color-water band (1), row2 = masked open-ocean
// (color 0, motion 1 — the band's is_valid:false cells that still carry real u/v).
const COLS = 3, ROWS = 3, N = COLS * ROWS;
const oceanArr = Uint8Array.from([0, 0, 0, 1, 1, 1, 0, 0, 0]);
const motionArr = Uint8Array.from([0, 0, 0, 1, 1, 1, 1, 1, 1]);

const bounds = (w) => ({ west: w, south: 27.0, east: w + 1.0, north: 28.0 });

describe('getMarineGeoData — §4.2 motion-water G channel', () => {
  it('without a motion array, G duplicates R exactly (legacy byte-identical)', () => {
    const { dataMask } = getMarineGeoData(COLS, ROWS, bounds(-80), oceanArr, N, false);
    for (let i = 0; i < N; i++) {
      expect(dataMask[i * 4 + 1]).toBe(dataMask[i * 4 + 0]);
      expect(dataMask[i * 4 + 0]).toBe(oceanArr[i] === 1 ? 255 : 0);
    }
  });

  it('with a motion array, G carries motion-water while R stays color-water', () => {
    const { dataMask } = getMarineGeoData(COLS, ROWS, bounds(-81), oceanArr, N, false, motionArr);
    for (let i = 0; i < N; i++) {
      expect(dataMask[i * 4 + 0]).toBe(oceanArr[i] === 1 ? 255 : 0);
      expect(dataMask[i * 4 + 1]).toBe(motionArr[i] === 1 ? 255 : 0);
    }
    // true land (row 0) must be 0 on BOTH channels — max(r, g*unlock) can never leak land
    expect(dataMask[0 * 4 + 0]).toBe(0);
    expect(dataMask[0 * 4 + 1]).toBe(0);
    // masked open-ocean (row 2): color 0, motion 255 — the unlockable cells
    expect(dataMask[6 * 4 + 0]).toBe(0);
    expect(dataMask[6 * 4 + 1]).toBe(255);
  });

  it('rating and plain grids of identical shape+bounds never share a cache entry', () => {
    const b = bounds(-82);
    const plain = getMarineGeoData(COLS, ROWS, b, oceanArr, N, false);
    const rated = getMarineGeoData(COLS, ROWS, b, oceanArr, N, false, motionArr);
    expect(rated).not.toBe(plain);
    expect(plain.dataMask[6 * 4 + 1]).toBe(0);    // plain: g == r == 0
    expect(rated.dataMask[6 * 4 + 1]).toBe(255);  // rated: g = motion
    // and the plain entry is still served intact afterwards (no stomp)
    const plainAgain = getMarineGeoData(COLS, ROWS, b, oceanArr, N, false);
    expect(plainAgain.dataMask[6 * 4 + 1]).toBe(0);
  });

  it('global antimeridian wrap averages G independently of R', () => {
    // 3x1-rows global-ish grid: make edge columns differ between color and motion
    const cols = 4, rows = 2, n = cols * rows;
    const o = Uint8Array.from([0, 1, 1, 0, 0, 1, 1, 0]);
    const m = Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1]);
    const gBounds = { west: -180, south: -60, east: 180, north: 60 };
    const { dataMask } = getMarineGeoData(cols, rows, gBounds, o, n, true, m);
    // wrap-averaged: R edges = (0+0)/2 = 0; G edges = (255+255)/2 = 255 (not stomped by R)
    expect(dataMask[0 * 4 + 0]).toBe(0);
    expect(dataMask[0 * 4 + 1]).toBe(255);
    expect(dataMask[(cols - 1) * 4 + 1]).toBe(255);
  });
});

describe('particle shaders — §4.2 lifted land checks', () => {
  it.each([['ADVECT_FS', ADVECT_FS], ['DRAW_VS', DRAW_VS]])(
    '%s declares u_motionUnlock and lifts the base mask sample via max(r, g*unlock)',
    (_name, src) => {
      expect(src).toContain('uniform float u_motionUnlock;');
      expect(src).toMatch(/max\(\s*baseMaskSample\.r,\s*baseMaskSample\.g\s*\*\s*u_motionUnlock\s*\)/);
    }
  );

  it('ADVECT_FS lifts BOTH the current and next-position checks', () => {
    expect(ADVECT_FS).toMatch(/max\(\s*nextMaskSample\.r,\s*nextMaskSample\.g\s*\*\s*u_motionUnlock\s*\)/);
  });

  it('DRAW_VS lifts the crest endpoint-fade check too', () => {
    expect(DRAW_VS).toMatch(/max\(\s*endMaskSample\.r,\s*endMaskSample\.g\s*\*\s*u_motionUnlock\s*\)/);
  });

  it('overlay combine still consumes geography .r (unchanged semantics)', () => {
    expect(ADVECT_FS).toContain('texture2D(u_overlayMaskTexture, vec2(o_u, o_v)).r');
    expect(DRAW_VS).toContain('texture2D(u_overlayMaskTexture, vec2(o_u, o_v)).r');
  });
});
