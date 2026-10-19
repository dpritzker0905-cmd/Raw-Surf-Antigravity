// W-5 (scrub audit 2026-10-18, T-08/T-09; the audit's R-ROLLOVER recipe): offset-keyed caches must not outlive the hh:30
// anchor flip, a wind result fetched across the flip must not be cached under its offset, and the coarse base key must
// (T-08 is already covered by coarseBaseOutdatedBy, see the end of this file.)
jest.mock('./backendWindServiceClient', () => ({ fetchBackendWindGrid: jest.fn() }));
import { rollOffsetCache, anchorMovedSince, _resetOffsetCacheAnchorForTest } from './offsetCacheAnchor';
import { _cacheMarineResult, getPerModelHourCache } from './marineControllerCache';
import { getSeriesAnchorMs } from './backendWeatherServiceClient';
import { fetchBackendWindGrid } from './backendWindServiceClient';
import { fetchWindData, getModelSafeWind, _resetWindCachesForTest } from './windController';

const at = (hhmm) => Date.parse(`2026-10-19T${hhmm}:00Z`);
const grid = (extra = {}) => ({ tile_id: 'global_coarse', grid: { vectors: [{ lat: 0, lng: 0, value: 1 }], renderable: true,
  bounds: { west: -180, south: -80, east: 180, north: 85 }, cols: 1, rows: 1, ...extra } });

beforeEach(() => {
  _resetOffsetCacheAnchorForTest();
  getPerModelHourCache().clear();
  delete window.__RAW_DISABLE_OFFSET_CACHE_ROLL__;
  delete window.__RAW_DISABLE_COARSE_BASE_TIME_KEY__;
  delete window.__OFFSET_CACHE_ROLL__;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { delete window.__MOCK_DATE_NOW__; jest.restoreAllMocks(); });

test('rollOffsetCache clears only when the anchor moves', () => {
  const clear = jest.fn();
  window.__MOCK_DATE_NOW__ = at('12:20');
  expect(rollOffsetCache('t', clear)).toBe(false);          // first look
  window.__MOCK_DATE_NOW__ = at('12:29');
  expect(rollOffsetCache('t', clear)).toBe(false);          // same anchor (12:00)
  window.__MOCK_DATE_NOW__ = at('12:40');
  expect(rollOffsetCache('t', clear)).toBe(true);           // anchor 13:00
  expect(clear).toHaveBeenCalledTimes(1);
  expect(window.__OFFSET_CACHE_ROLL__.t).toBe(1);
});

test('R-ROLLOVER marine: an entry cached at 12:20 for +6 h is gone at 12:40 (it would name 18Z under the 19Z label)', () => {
  window.__MOCK_DATE_NOW__ = at('12:20');
  _cacheMarineResult('GFS', 6, grid(), 'waves', true);
  expect(getPerModelHourCache().size).toBeGreaterThan(0);
  window.__MOCK_DATE_NOW__ = at('12:25');
  expect(getPerModelHourCache().size).toBeGreaterThan(0);  // no flip, no drop
  window.__MOCK_DATE_NOW__ = at('12:40');
  expect(getPerModelHourCache().size).toBe(0);
});

test('kill switch keeps the old behaviour', () => {
  window.__RAW_DISABLE_OFFSET_CACHE_ROLL__ = true;
  window.__MOCK_DATE_NOW__ = at('12:20');
  _cacheMarineResult('GFS', 6, grid(), 'waves', true);
  window.__MOCK_DATE_NOW__ = at('12:40');
  expect(getPerModelHourCache().size).toBeGreaterThan(0);
  expect(anchorMovedSince(getSeriesAnchorMs() - 3600000)).toBe(false);
});

describe('wind', () => {
  const bounds = { west: -10, east: 10, south: -5, north: 5 };
  const good = () => ({ renderable: true, vectors: [{ lat: 0, lng: 0, u: 1, v: 1, speed: 1, direction: 0 }], bounds, cols: 1, rows: 1 });
  beforeEach(() => { _resetWindCachesForTest(); fetchBackendWindGrid.mockReset(); });

  test('a cached wind hour does not survive the flip (hourly wind is always 1 h off after it)', async () => {
    window.__MOCK_DATE_NOW__ = at('12:20');
    fetchBackendWindGrid.mockResolvedValueOnce(good());
    await fetchWindData(bounds, null, 6, true, 3, 'GFS');
    expect(getModelSafeWind('GFS', 6, bounds)).not.toBeNull();
    window.__MOCK_DATE_NOW__ = at('12:40');
    expect(getModelSafeWind('GFS', 6, bounds)).toBeNull();
  });

  test('a result that lands after the flip is not cached under its offset', async () => {
    window.__MOCK_DATE_NOW__ = at('12:29');
    let resolve;
    fetchBackendWindGrid.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const p = fetchWindData(bounds, null, 6, true, 3, 'GFS');
    await Promise.resolve();
    window.__MOCK_DATE_NOW__ = at('12:31');
    resolve(good());
    await p;
    expect(getModelSafeWind('GFS', 6, bounds)).toBeNull();
  });
});

// T-08 (coarse base key without run/valid time) needs no change: _captureCoarseBase already replaces a base made
// for another run or instant through coarseBaseStaleForSeed / coarseBaseOutdatedBy (marineStaleHour.js), with an unknown
// run treated as compatible, and marineBaseHold.sequence.test.js sweeps that over 46k sequences.
