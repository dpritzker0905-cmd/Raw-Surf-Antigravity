jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null, recordTruthStage: () => {} }));

import { ensureMarineSeries, getMarineSeriesFrame, _resetMarineSeriesForTest, _marineSeriesCacheState } from './marineGridSeries';

const box = n => ({ west: -170 + n * 2, east: -169 + n * 2, south: 20, north: 21 });
const payload = (bounds, height = 2) => ({ frames: [{ hour_offset: 0, bounds, cols: 2, rows: 2,
  vectors: [{ lat: 20, lon: bounds.west, height, period: 10 }], source_dataset: 'fixture',
  valid_time: '2026-10-04T00:00:00Z' }] });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('actual series writers share bounded retention', () => {
  let oldFlag;
  beforeEach(() => {
    oldFlag = process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS;
    process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS = 'true';
    jest.useFakeTimers();
    _resetMarineSeriesForTest();
    window.__MARINE_SERIES__ = true;
  });
  afterEach(() => {
    _resetMarineSeriesForTest(); jest.useRealTimers(); delete global.fetch;
    delete window.__MARINE_SERIES__; delete window.__RAW_DISABLE_HOUR0_FIRST__;
    delete window.__RAW_DISABLE_MARINE_SERIES_CACHE_BOUNDS__;
    if (oldFlag === undefined) delete process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS;
    else process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS = oldFlag;
  });
  async function load(n, kind, height = n + 1) {
    const bounds = box(n);
    global.fetch = jest.fn(async url => ({ ok: true, json: async () => {
      const mini = !new URL(url, 'https://fixture.invalid').searchParams.get('hours').includes(',');
      if (kind === 'mini') return mini ? payload(bounds, height) : { frames: [] };
      return kind === 'warming' ? { frames: [], warming: true } : payload(bounds, height);
    } }));
    if (kind !== 'mini') window.__RAW_DISABLE_HOUR0_FIRST__ = true;
    await ensureMarineSeries('GFS', 'waves', bounds, 0, undefined, true);
    await flush();
  }
  it.each(['mini', 'warming', 'page'])('64 %s writes never exceed48 and the newest frame stays correct', async kind => {
    for (let n = 0; n < 64; n++) {
      await load(n, kind);
      expect(_marineSeriesCacheState().entries).toBeLessThanOrEqual(48);
    }
    if (kind !== 'warming') {
      const frame = getMarineSeriesFrame('GFS', 'waves', box(63), 0);
      expect(frame.grid.vectors[0].height).toBe(64);
      expect(frame.grid.__sourceDataset).toBe('fixture');
    }
  });
  it('an expired mini is reclaimed on lookup without serving stale height', async () => {
    await load(0, 'mini');
    expect(_marineSeriesCacheState().entries).toBe(1);
    jest.advanceTimersByTime(300001);
    expect(getMarineSeriesFrame('GFS', 'waves', box(0), 0)).toBeNull();
    expect(_marineSeriesCacheState().entries).toBe(0);
  });
  it.each(['unset', 'false', 'garbage', 'kill'])('preserves legacy mini retention for %s rollback', async flag => {
    if (flag === 'unset') delete process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS;
    else if (flag === 'kill') window.__RAW_DISABLE_MARINE_SERIES_CACHE_BOUNDS__ = true;
    else process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS = flag;
    for (let n = 0; n < 64; n++) await load(n, 'mini');
    expect(_marineSeriesCacheState().entries).toBe(64);
  });
  it.each([false, true])('central differences: retained-count and latest-height sensitivities, enabled=%s', async enabled => {
    process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS = String(enabled);
    const observations = [];
    for (const delta of [-1, 1]) {
      _resetMarineSeriesForTest();
      for (let n = 0; n < 64 + delta; n++) await load(n, 'mini', 2 + delta * 0.05);
      const latest = getMarineSeriesFrame('GFS', 'waves', box(63 + delta), 0);
      observations.push([_marineSeriesCacheState().entries, latest.grid.vectors[0].height]);
    }
    expect((observations[1][0] - observations[0][0]) / 2).toBe(enabled ? 0 : 1);
    expect((observations[1][1] - observations[0][1]) / 0.1).toBeCloseTo(1, 8);
  });
});
