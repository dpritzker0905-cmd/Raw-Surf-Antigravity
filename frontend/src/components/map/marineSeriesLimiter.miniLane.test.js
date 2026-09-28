jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null }));

/**
 * A15-11 residual (2026-09-28): a background warm's hour-0 mini waits for its own lane.
 *
 * After #123 the dev E2E (run 36361175283) still peaked at 5 weather requests in flight on both browsers
 * (budget 4). Every peak was one burst 10-16 s after activation: the world warm's mini, three sibling
 * warms' minis and the world 48-frame page, launched within 3 ms, because a mini skipped every queue
 * whoever fired it. These pin the lane: one background mini at a time, none while a visible load waits,
 * visible minis unchanged, dropped on abort, the kill switch.
 */
import { ensureMarineSeries, _resetMarineSeriesForTest, _seriesLimiterState } from './marineGridSeries';

const box = (w) => ({ west: w, south: 27, east: w + 1, north: 28 });
const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const response = () => ({ ok: true, json: async () => ({ frames: [] }) });
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
const isMini = (r) => /[?&]hours=\d+(&|$)/.test(r.url);          // one hour; a page lists many
const layerOf = (r) => /layer=([a-z_0-9]+)/.exec(r.url)[1];

describe('the hour-0 mini lane (A15-11 residual)', () => {
  let requests;
  let loads;
  const call = (layer, bounds, background, signal) => {
    loads.push(ensureMarineSeries('GFS', layer, bounds, 0, signal, true, false, background));
  };
  const minis = () => requests.filter(isMini);
  const pages = () => requests.filter((r) => !isMini(r));

  beforeEach(() => {
    jest.useFakeTimers();
    _resetMarineSeriesForTest();
    window.__MARINE_SERIES__ = true;
    requests = [];
    loads = [];
    global.fetch = jest.fn((url) => new Promise((resolve) => {
      requests.push({ url, done: false, finish() { this.done = true; resolve(response()); } });
    }));
  });
  afterEach(async () => {
    for (let i = 0; i < 16; i++) { requests.forEach((r) => { if (!r.done) r.finish(); }); await flush(); }
    await Promise.all(loads);
    _resetMarineSeriesForTest();
    jest.useRealTimers();
    delete global.fetch;
    delete window.__MARINE_SERIES__;
    delete window.__RAW_DISABLE_FETCH_PRIORITY__;
  });

  it('the measured activation burst now puts 2 requests on the wire, not 5', async () => {
    // What run 36361175283 recorded, in order: the world warm, then three sibling-layer warms.
    call('waves', WORLD, true);
    call('swell_1', box(-81), true);
    call('swell_2', box(-81), true);
    call('wind_waves', box(-81), true);
    await flush();
    expect(requests).toHaveLength(2);                 // one background page + one background mini
    expect(minis()).toHaveLength(1);
    expect(_seriesLimiterState()).toMatchObject({ backgroundMini: 1, queuedMini: 3, background: 1 });
  });

  it('background minis run one at a time, in order, each as the last finishes', async () => {
    call('swell_1', box(-81), true);
    call('swell_2', box(-81), true);
    call('wind_waves', box(-81), true);
    await flush();
    expect(minis().map(layerOf)).toEqual(['swell_1']);
    minis()[0].finish();
    await flush();
    expect(minis().map(layerOf)).toEqual(['swell_1', 'swell_2']);
    minis()[1].finish();
    await flush();
    expect(minis().map(layerOf)).toEqual(['swell_1', 'swell_2', 'wind_waves']);
  });

  it('a visible mini still skips every queue, beside a running background mini', async () => {
    call('swell_1', box(-81), true);                  // background mini running
    await flush();
    call('waves', box(-70), false);                   // the user's layer: its mini goes at once
    await flush();
    expect(minis().map(layerOf)).toEqual(['swell_1', 'waves']);
  });

  it('no background mini starts while a visible load is waiting', async () => {
    call('waves', box(-90), false);
    call('waves', box(-85), false);                   // both page slots busy (their minis ran at once)
    call('waves', box(-80), false);                   // a third visible page WAITS
    await flush();
    call('swell_1', box(-81), true);                  // a warm's mini: must wait behind it
    await flush();
    expect(_seriesLimiterState()).toMatchObject({ queuedVisible: 1, queuedMini: 1, backgroundMini: 0 });
    pages()[0].finish();                              // a slot frees; the waiting visible page takes it
    await flush();
    expect(_seriesLimiterState()).toMatchObject({ queuedVisible: 0, backgroundMini: 1, queuedMini: 0 });
  });

  it('a finishing background mini does not hand its lane to the next while a visible load waits', async () => {
    call('swell_1', box(-81), true);                  // background mini A running
    await flush();
    call('waves', box(-90), false);
    call('waves', box(-85), false);
    call('waves', box(-80), false);                   // warm A's own page holds a slot: -85 and -80 wait
    call('swell_2', box(-81), true);                  // background mini B queued
    await flush();
    minis().find((r) => layerOf(r) === 'swell_1').finish();
    await flush();
    expect(minis().map(layerOf)).not.toContain('swell_2');
    expect(_seriesLimiterState()).toMatchObject({ backgroundMini: 0, queuedMini: 1, queuedVisible: 2 });
  });

  it('when the visible load it waited behind is superseded, the mini starts', async () => {
    const ac = new AbortController();
    call('waves', box(-90), false);
    call('waves', box(-85), false);
    call('waves', box(-80), false, ac.signal);        // waits for a page slot
    await flush();
    call('swell_1', box(-81), true);
    await flush();
    expect(_seriesLimiterState().backgroundMini).toBe(0);
    ac.abort();                                       // the gesture moved on: nothing visible waits now
    await flush();
    expect(_seriesLimiterState()).toMatchObject({ queuedVisible: 0, backgroundMini: 1 });
  });

  it('a background mini dropped while queued never reaches the server', async () => {
    const ac = new AbortController();
    call('swell_1', box(-81), true);
    call('swell_2', box(-81), true, ac.signal);
    await flush();
    ac.abort();
    await flush();
    expect(_seriesLimiterState().queuedMini).toBe(0);  // dropped at once, not when the lane next frees
    minis()[0].finish();
    await flush();
    expect(minis().map(layerOf)).toEqual(['swell_1']);
  });

  it('the kill switch restores the old behaviour: every mini goes at once', async () => {
    window.__RAW_DISABLE_FETCH_PRIORITY__ = true;
    call('swell_1', box(-81), true);
    call('swell_2', box(-81), true);
    call('wind_waves', box(-81), true);
    await flush();
    expect(minis()).toHaveLength(3);
  });
});
