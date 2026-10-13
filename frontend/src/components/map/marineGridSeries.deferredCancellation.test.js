jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null }));

import { ensureMarineSeries, getMarineSeriesFrame, prewarmMarineSeries, _resetMarineSeriesForTest } from './marineGridSeries';

const BOUNDS = { west: -81, south: 27, east: -80, north: 28 };
const WORLD = { west: -180, south: -90, east: 180, north: 90 };
const frame = (bounds = BOUNDS) => ({
  hour_offset: 0, cols: 1, rows: 1, bounds,
  vectors: [{ lat: 27.5, lng: -80.5, speed: 1, direction: 0, period: 8 }],
});
const response = (payload) => ({ ok: true, json: async () => payload });
const deferredResponses = [
  ['HTTP failure', () => ({ ok: false, status: 503 })],
  ['warming', () => response({ frames: [], warming: true })],
  ['coarse revalidation', () => response({ frames: [frame(WORLD)] })],
];
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
async function advance(ms = 1200) { jest.advanceTimersByTime(ms); await flush(); }
const load = (signal, currentOnly = true) => ensureMarineSeries('GFS', 'waves', BOUNDS, 0, signal, currentOnly);

describe('actual series loader cancellation across deferred work', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    _resetMarineSeriesForTest();
    window.__MARINE_SERIES__ = true;
    window.__RAW_DISABLE_HOUR0_FIRST__ = true;
    delete window.__RAW_DISABLE_SERIES_ABORT_GUARD__;
    global.fetch = jest.fn().mockResolvedValue(response({ frames: [frame()] }));
  });
  afterEach(() => {
    _resetMarineSeriesForTest();
    jest.useRealTimers();
    delete global.fetch;
    delete window.__RAW_DISABLE_HOUR0_FIRST__;
    delete window.__RAW_DISABLE_SERIES_ABORT_GUARD__;
    delete window.requestIdleCallback;
    delete window.cancelIdleCallback;
  });

  it.each(deferredResponses)('%s cannot restart after the caller aborts', async (_, firstResponse) => {
    const caller = new AbortController();
    global.fetch.mockResolvedValueOnce(firstResponse());
    await load(caller.signal);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    caller.abort();
    await advance(60000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(deferredResponses)('%s still retries for an active caller', async (_, firstResponse) => {
    const caller = new AbortController();
    global.fetch.mockResolvedValueOnce(firstResponse());
    await load(caller.signal);
    await advance();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(getMarineSeriesFrame('GFS', 'waves', BOUNDS, 0)).not.toBeNull();
    caller.abort();
  });

  it('an already-aborted caller cannot start either a page or its first-hour mini', async () => {
    delete window.__RAW_DISABLE_HOUR0_FIRST__;
    const caller = new AbortController();
    caller.abort();
    await load(caller.signal, false);
    await advance(60000);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('cancellation after mini slot acquisition returns the slot without fetching', async () => {
    delete window.__RAW_DISABLE_HOUR0_FIRST__;
    const caller = new AbortController();
    const pending = load(caller.signal);
    caller.abort(); // acquired lanes have not resumed their await continuation yet
    await pending;
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
    await load(new AbortController().signal);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('eager prewarm refuses an already-aborted caller', async () => {
    const caller = new AbortController();
    caller.abort();
    prewarmMarineSeries('GFS', 'waves', BOUNDS, caller.signal);
    await advance(60000);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('abort clears a pending retry immediately instead of retaining it until its deadline', async () => {
    const caller = new AbortController();
    global.fetch.mockResolvedValueOnce(response({ frames: [], warming: true }));
    await load(caller.signal);
    expect(jest.getTimerCount()).toBe(1);
    caller.abort();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([false, true])('adjacent prefetch cannot restart after abort (native idle=%s)', async (nativeIdle) => {
    let idleCallback;
    if (nativeIdle) {
      window.requestIdleCallback = jest.fn(callback => { idleCallback = callback; return 47; });
      window.cancelIdleCallback = jest.fn();
    }
    const caller = new AbortController();
    await load(caller.signal, false);
    caller.abort();
    // Invoke even a canceled callback to exercise the entry guard against a queued callback race.
    if (nativeIdle) idleCallback();
    await advance(60000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    if (nativeIdle) expect(window.cancelIdleCallback).toHaveBeenCalledWith(47);
  });

  it.each([false, true])('late decoded response does not publish canceled data (mini=%s)', async (mini) => {
    if (mini) delete window.__RAW_DISABLE_HOUR0_FIRST__;
    const caller = new AbortController();
    let decode;
    global.fetch.mockImplementation(url => {
      if (mini && url.includes('hours=0,')) return Promise.resolve(response({ frames: [] }));
      return Promise.resolve({ ok: true, json: () => new Promise(resolve => { decode = resolve; }) });
    });
    const pending = load(caller.signal);
    await flush();
    expect(decode).toBeDefined();
    caller.abort();
    decode({ frames: [frame()] }); // transport/body test double deliberately ignores abort
    await pending;
    await flush();
    expect(getMarineSeriesFrame('GFS', 'waves', BOUNDS, 0)).toBeNull();
    await advance(60000);
    expect(global.fetch).toHaveBeenCalledTimes(mini ? 2 : 1);
  });

  it('canceling one retry does not suppress a fresh caller for the same page', async () => {
    const old = new AbortController();
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await load(old.signal);
    old.abort();
    await load(new AbortController().signal);
    await advance(60000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(getMarineSeriesFrame('GFS', 'waves', BOUNDS, 0)).not.toBeNull();
  });

  it('reset removes both deferred timer and its caller listener', async () => {
    const caller = new AbortController();
    const live = new Set();
    const add = caller.signal.addEventListener.bind(caller.signal);
    const remove = caller.signal.removeEventListener.bind(caller.signal);
    jest.spyOn(caller.signal, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'abort') live.add(listener);
      add(type, listener, options);
    });
    jest.spyOn(caller.signal, 'removeEventListener').mockImplementation((type, listener) => {
      if (type === 'abort') live.delete(listener);
      remove(type, listener);
    });
    global.fetch.mockResolvedValueOnce(response({ frames: [], warming: true }));
    await load(caller.signal);
    expect(live.size).toBe(1); // deferred work remains owned by the caller after fetch settles
    _resetMarineSeriesForTest();
    expect(live.size).toBe(0);
    await advance(60000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('kill switch restores the previous deferred-request behavior', async () => {
    window.__RAW_DISABLE_SERIES_ABORT_GUARD__ = true;
    const caller = new AbortController();
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await load(caller.signal);
    caller.abort();
    await advance();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
