/**
 * Regression test for the surf-RATING band not painting through the SimulationField/dispatcher path.
 *
 * Root cause (confirmed live 2026-06-30): the rating grid is SCALAR — the backend puts the 0-10 score in
 * vec.waves.speed and zeroes u/v (rating has no direction). SimulationFieldBuilder derived waveHeight from
 * sqrt(u^2+v^2) = 0 → an all-zero field → MARINE_EMPTY_RENDER, and the ratingMode flag was dropped, so the
 * engine's Option-A gate never painted the band. The fix carries the SCORE into waveHeight and the flag onto
 * the field. This test pins both so the band can never silently regress to empty again.
 */
import { createEmptyField } from '../engine/SimulationField';
import { injectMarineData } from '../engine/SimulationFieldBuilder';

const BOUNDS = { west: -82, south: 26, east: -80, north: 28 };

// A vector as the conformer produces it for the active 'waves' layer: data mirrored into v.waves.
const ratingVec = (score) => ({
  lat: 27, lng: -81, u: 0, v: 0, speed: score, height: score, direction: 0, isOcean: true,
  waves: { u: 0, v: 0, speed: score, period: 0, height: score, direction: 0, isOcean: true },
  swell_1: {}, swell_2: {}, wind_waves: {},
});

const swellVec = (h, dirDeg) => {
  const r = dirDeg * Math.PI / 180;
  const u = -h * Math.sin(r), v = -h * Math.cos(r);
  return {
    lat: 27, lng: -81, u, v, speed: h, height: h, direction: dirDeg, isOcean: true,
    waves: { u, v, speed: h, period: 9, height: h, direction: dirDeg, isOcean: true },
    swell_1: {}, swell_2: {}, wind_waves: {},
  };
};

const marineData = (ratingMode, vec) => ({
  __renderable: true,
  grid: { ratingMode, vectors: [vec, vec, vec, vec], cols: 2, rows: 2, bounds: BOUNDS },
});

describe('SimulationField rating pass-through (band-not-painting fix)', () => {
  it('RATING grid: carries the score into waveHeight + sets field.ratingMode (was zeroed → empty render)', () => {
    const field = createEmptyField(2, 2, BOUNDS);
    injectMarineData(field, marineData(true, ratingVec(1.9)));

    expect(field.ratingMode).toBe(true);
    const maxH = Math.max(...field.grid.waveHeight);
    // THE bug: maxH === 0 (sqrt of zeroed u/v) → MARINE_EMPTY_RENDER. Fix: the 1.9 score survives.
    expect(maxH).toBeGreaterThan(0);
    expect(maxH).toBeCloseTo(1.9, 3);
  });

  it('SWELL grid: unchanged — height still derived from u/v, ratingMode false', () => {
    const field = createEmptyField(2, 2, BOUNDS);
    injectMarineData(field, marineData(false, swellVec(2.4, 90)));

    expect(field.ratingMode).toBe(false);
    const maxH = Math.max(...field.grid.waveHeight);
    expect(maxH).toBeCloseTo(2.4, 2);
  });

  it('kill switch __RAW_RATING_FIELD_PASSTHROUGH__=false reverts to old behaviour (rating treated as swell)', () => {
    window.__RAW_RATING_FIELD_PASSTHROUGH__ = false;
    try {
      const field = createEmptyField(2, 2, BOUNDS);
      injectMarineData(field, marineData(true, ratingVec(1.9)));
      expect(field.ratingMode).toBe(false);              // not treated as rating
      expect(Math.max(...field.grid.waveHeight)).toBe(0); // u/v zeroed → 0 (the old broken result)
    } finally {
      delete window.__RAW_RATING_FIELD_PASSTHROUGH__;
    }
  });
});
