jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null }));

import { ensureMarineSeries, _resetMarineSeriesForTest } from './marineGridSeries';

const BOUNDS = { west: -81, south: 27, east: -80, north: 28 };
const response = () => ({ ok: true, json: async () => ({ frames: [] }) });
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

describe('marine series slot ownership at cancellation boundaries', () => {
  let requests;
  let loads;
  let controllers;
  function load(model, hour = 0) {
    const controller = new AbortController();
    controllers.push(controller);
    const promise = ensureMarineSeries(model, 'waves', BOUNDS, hour, controller.signal, true);
    loads.push(promise);
    return controller;
  }
  beforeEach(() => {
    jest.useFakeTimers();
    _resetMarineSeriesForTest();
    window.__RAW_DISABLE_HOUR0_FIRST__ = true;
    window.__MARINE_SERIES__ = true;
    requests = [];
    loads = [];
    controllers = [];
    global.fetch = jest.fn((url, { signal }) => new Promise((resolve, reject) => {
      const onAbort = () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
      signal.addEventListener('abort', onAbort, { once: true });
      requests.push({ url, finish: () => { signal.removeEventListener('abort', onAbort); resolve(response()); } });
    }));
  });
  afterEach(async () => {
    controllers.forEach(controller => controller.abort());
    requests.forEach(request => request.finish());
    await Promise.all(loads);
    _resetMarineSeriesForTest();
    jest.useRealTimers();
    delete global.fetch;
    delete window.__RAW_DISABLE_HOUR0_FIRST__;
    delete window.__MARINE_SERIES__;
  });

  it('returns immediately acquired slots when cancelled before the fetch continuation', async () => {
    for (let cycle = 0; cycle < 4; cycle++) {
      const first = load('GFS');
      const second = load('ICON');
      first.abort();
      second.abort();
      await flush();
    }
    expect(global.fetch).not.toHaveBeenCalled();
    load('EURO');
    load('GFS', 144);
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not release another request\'s slot when cancelled while still queued', async () => {
    load('GFS');
    load('ICON');
    await flush();
    const cancelled = load('EURO');
    load('GFS', 144);
    cancelled.abort();
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    requests[0].finish();
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(requests[2].url).toContain('hours=144,');
  });

  it('returns a transferred slot when cancelled after handoff but before resuming', async () => {
    load('GFS');
    load('ICON');
    await flush();
    const transferred = load('EURO');
    load('GFS', 144);
    // The JSON body resolves this microtask, which queues the old owner's finally.
    // That finally grants EURO the slot; this test resumes before EURO does.
    requests[0].finish();
    await Promise.resolve();
    await Promise.resolve();
    transferred.abort();
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(requests[2].url).toContain('model=GFS');
    expect(requests[2].url).toContain('hours=144,');
  });
});
