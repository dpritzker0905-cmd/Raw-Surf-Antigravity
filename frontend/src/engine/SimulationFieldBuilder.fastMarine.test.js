// The fast marine resample (2026-10-24, wind toggle first draw) must be the legacy loop bit for bit: every array, every
// float compared with Object.is, across ragged inputs (missing vectors, components and values, NaN, null), rating mode, an
// antimeridian-crossing source and destination cells outside the source box.
import { createEmptyField } from './SimulationField';
import { injectMarineData, injectMarineDataLegacy } from './SimulationFieldBuilder';

const ARRAYS = ['waveHeight', 'waveDir', 'wavePeriod', 'swellHeight', 'swellDir', 'swellPeriod', 'swell2Height', 'swell2Dir',
  'swell2Period', 'windWaveHeight', 'windWaveDir', 'windWavePeriod', 'landMask'];

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function marine(seed, cols, rows, bounds, { rating = false } = {}) {
  const r = rng(seed);
  const val = () => { const x = r(); return x < 0.05 ? NaN : x < 0.1 ? null : x < 0.15 ? undefined : (r() - 0.5) * 6; };
  const part = () => (r() < 0.1 ? undefined : { u: val(), v: val(), period: val(), speed: val() });
  const vectors = [];
  for (let i = 0; i < cols * rows; i++) {
    if (r() < 0.04) { vectors.push(null); continue; }
    vectors.push({ waves: part(), swell_1: part(), swell_2: r() < 0.3 ? undefined : part(), wind_waves: part(),
      isOcean: r() < 0.1 ? undefined : r() < 0.8 });
  }
  return { grid: { vectors, cols, rows, bounds, ratingMode: rating } };
}

function both(cols, rows, dstBounds, data) {
  const a = injectMarineDataLegacy(createEmptyField(cols, rows, dstBounds, 'GFS'), data);
  const b = injectMarineData(createEmptyField(cols, rows, dstBounds, 'GFS'), data);
  return { a, b };
}

function expectIdentical(a, b) {
  for (const k of ARRAYS) {
    const x = a.grid[k], y = b.grid[k];
    expect(y.length).toBe(x.length);
    let bad = -1;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) { bad = i; break; }
    expect({ k, bad }).toEqual({ k, bad: -1 });
  }
  expect(b.ratingMode).toBe(a.ratingMode);
  expect(b.sources).toEqual(a.sources);
}

describe('fast marine resample == legacy loop, bit for bit', () => {
  afterEach(() => { delete window.__RAW_DISABLE_SIMFIELD_FAST_MARINE__; delete window.__RAW_RATING_FIELD_PASSTHROUGH__; });

  test('a world wind-sized field over a coarser world marine grid (the wind toggle case)', () => {
    const world = { west: -180, south: -85, east: 180, north: 85 };
    const { a, b } = both(144, 69, world, marine(1, 61, 29, { west: -180, south: -80, east: 180, north: 80 }));
    expectIdentical(a, b);
  });

  test('a regional source inside a larger field (cells outside the source zeroed, land 1)', () => {
    const { a, b } = both(40, 30, { west: -100, south: 10, east: -50, north: 50 },
      marine(2, 23, 17, { west: -90, south: 20, east: -60, north: 45 }));
    expectIdentical(a, b);
    expect(Array.from(b.grid.landMask).some((m) => m === 1)).toBe(true);
  });

  test('an antimeridian-crossing source and destination', () => {
    const { a, b } = both(33, 21, { west: 150, south: -40, east: -150, north: 10 },
      marine(3, 19, 13, { west: 160, south: -35, east: -160, north: 5 }));
    expectIdentical(a, b);
  });

  test('rating mode carries the score; the passthrough kill drops it in both', () => {
    const data = marine(4, 12, 9, { west: 0, south: 0, east: 20, north: 15 }, { rating: true });
    let r = both(25, 18, { west: 0, south: 0, east: 20, north: 15 }, data);
    expect(r.b.ratingMode).toBe(true);
    expectIdentical(r.a, r.b);
    window.__RAW_RATING_FIELD_PASSTHROUGH__ = false;
    r = both(25, 18, { west: 0, south: 0, east: 20, north: 15 }, data);
    expect(r.b.ratingMode).toBe(false);
    expectIdentical(r.a, r.b);
  });

  test('degenerate shapes: a 1x1 field, a one-row source, no bounds, unrenderable', () => {
    expectIdentical(...Object.values(both(1, 1, { west: 0, south: 0, east: 1, north: 1 },
      marine(5, 4, 4, { west: -1, south: -1, east: 2, north: 2 }))));
    expectIdentical(...Object.values(both(9, 5, { west: 0, south: 0, east: 8, north: 4 },
      marine(6, 9, 1, { west: 0, south: 2, east: 8, north: 2 }))));
    const noBounds = marine(7, 4, 4, null);
    expectIdentical(...Object.values(both(6, 6, { west: 0, south: 0, east: 1, north: 1 }, noBounds)));
    const off = { ...marine(8, 4, 4, { west: 0, south: 0, east: 1, north: 1 }), __renderable: false };
    expectIdentical(...Object.values(both(6, 6, { west: 0, south: 0, east: 1, north: 1 }, off)));
  });

  test('the kill switch routes to the legacy loop', () => {
    window.__RAW_DISABLE_SIMFIELD_FAST_MARINE__ = true;
    const { a, b } = both(20, 10, { west: 0, south: 0, east: 10, north: 5 }, marine(9, 8, 6, { west: 0, south: 0, east: 10, north: 5 }));
    expectIdentical(a, b);
  });
});
