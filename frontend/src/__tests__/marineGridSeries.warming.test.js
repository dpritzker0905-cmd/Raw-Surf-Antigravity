/**
 * Cold-start warming retry (2026-07-06, chip task_e618f9ff): an empty grid_series marked
 * `warming: true` means the backend is mid L2-restore (every deploy opens this window). The
 * client must retry with the existing backoff instead of abandoning the viewport until the
 * next gesture — bounded, and never stomping an entry that already has frames.
 */
import {
  ensureMarineSeries,
  getMarineSeriesFrame,
  coarseRevalDelayMs,
  _resetMarineSeriesForTest,
} from '../components/map/marineGridSeries';

const bounds = { west: -81.7, south: 27.8, east: -79.6, north: 28.8 };

// Jest 27 (CRA) has no advanceTimersByTimeAsync — advance, then flush the retry's microtask
// chain (slot acquire → mocked fetch → json) by hand.
const advance = async (ms) => {
  jest.advanceTimersByTime(ms);
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const warmingResponse = () => ({ ok: true, json: async () => ({ frames: [], frame_count: 0, warming: true }) });
const goodResponse = () => ({
  ok: true,
  json: async () => ({
    frames: [{
      hour_offset: 0, valid_time: '2026-07-06T03:00:00Z', cols: 2, rows: 2,
      bounds: { west: -82, south: 27, east: -79, north: 29 },
      vectors: [{ lat: 27, lng: -82, speed: 1, direction: 200, u: 0.3, v: 0.9, is_valid: true }],
      provider: 'open-meteo', is_estimated: false, rating_mode: false,
    }],
    frame_count: 1,
  }),
});

describe('marineGridSeries — cold-start warming retry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    _resetMarineSeriesForTest();
    window.__MARINE_SERIES__ = true;
    global.fetch = jest.fn();
  });
  afterEach(() => {
    jest.useRealTimers();
    delete window.__MARINE_SERIES__;
  });

  it('retries a warming-empty series with backoff and commits the frames when they arrive', async () => {
    global.fetch
      .mockResolvedValueOnce(warmingResponse())
      .mockResolvedValueOnce(goodResponse());

    await ensureMarineSeries('GFS', 'waves', bounds, 0, undefined, true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(getMarineSeriesFrame('GFS', 'waves', bounds, 0)).toBeNull(); // nothing yet

    await advance(coarseRevalDelayMs(1) + 10);
    expect(global.fetch).toHaveBeenCalledTimes(2);                      // bounded retry fired
    expect(getMarineSeriesFrame('GFS', 'waves', bounds, 0)).not.toBeNull(); // frames committed
  });

  it('does NOT retry a plain empty series (no warming marker — genuine no-coverage)', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ frames: [], frame_count: 0 }) });
    await ensureMarineSeries('GFS', 'waves', bounds, 0, undefined, true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await advance(60000);
    expect(global.fetch).toHaveBeenCalledTimes(1);                      // silence, as before
  });

  it('keeps retrying with increasing delays while the backend stays warming', async () => {
    global.fetch.mockResolvedValue(warmingResponse());
    await ensureMarineSeries('GFS', 'waves', bounds, 0, undefined, true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await advance(coarseRevalDelayMs(1) + 10);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await advance(coarseRevalDelayMs(2) + 10);
    expect(global.fetch).toHaveBeenCalledTimes(3);                      // backoff chain continues
  });
});

