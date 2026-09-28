jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null }));

/**
 * A15-11 (2026-09-28): ONE background request, and only while nothing visible is loading or waiting.
 *
 * After #123 the dev E2E (run 36361175283) peaked at 5 weather requests in flight (budget 4), every peak
 * one burst of background hour-0 minis that skipped every queue. #131 gave background minis a lane of their
 * own, which removed that burst (activation peak 3/4, p90 Chrome 12.5 -> 7.6 s) — but the next run (36364803932)
 * still peaked at 5 on toggles and model switches: a background page AND a background mini beside the visible
 * page, mini and /grid. These pin the rule: background pages, minis and runBackgroundWarm share one request;
 * minis go first; none starts while a visible page or mini is loading or waiting; visible minis unchanged;
 * dropped on abort; the kill switch.
 */
import { ensureMarineSeries, runBackgroundWarm, _resetMarineSeriesForTest, _seriesLimiterState } from './marineGridSeries';

const box = (w) => ({ west: w, south: 27, east: w + 1, north: 28 });
const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const response = () => ({ ok: true, json: async () => ({ frames: [] }) });
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
const isMini = (r) => /[?&]hours=\d+(&|$)/.test(r.url);          // one hour; a page lists many
const layerOf = (r) => /layer=([a-z_0-9]+)/.exec(r.url)[1];

describe('one background request, only when idle (A15-11)', () => {
  let requests;
  let loads;
  const call = (layer, bounds, background, signal) => {
    loads.push(ensureMarineSeries('GFS', layer, bounds, 0, signal, true, false, background));
  };
  const minis = () => requests.filter(isMini);
  const pages = () => requests.filter((r) => !isMini(r));
  const open = () => requests.filter((r) => !r.done);
  const finishWhere = async (pred) => { requests.filter((r) => !r.done && pred(r)).forEach((r) => r.finish()); await flush(); };

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
    for (let i = 0; i < 24; i++) { requests.forEach((r) => { if (!r.done) r.finish(); }); await flush(); }
    await Promise.all(loads);
    _resetMarineSeriesForTest();
    jest.useRealTimers();
    delete global.fetch;
    delete window.__MARINE_SERIES__;
    delete window.__RAW_DISABLE_FETCH_PRIORITY__;
  });

  it('the measured warm burst puts ONE request on the wire, not 5', async () => {
    // What run 36361175283 recorded, in order: the world warm, then three sibling-layer warms.
    call('waves', WORLD, true);
    call('swell_1', box(-81), true);
    call('swell_2', box(-81), true);
    call('wind_waves', box(-81), true);
    await flush();
    expect(requests).toHaveLength(1);
    expect(minis()).toHaveLength(1);                  // a mini first: cheap, and what makes a toggle instant
    expect(_seriesLimiterState()).toMatchObject({ backgroundMini: 1, background: 0, queuedMini: 3, queuedBackground: 4 });
  });

  it('background work drains one request at a time, minis before pages', async () => {
    call('swell_1', box(-81), true);
    call('swell_2', box(-81), true);
    await flush();
    const order = [];
    for (let i = 0; i < 4; i++) {
      expect(open()).toHaveLength(1);                 // never two background requests at once
      const r = open()[0];
      order.push(`${layerOf(r)}:${isMini(r) ? 'mini' : 'page'}`);
      r.finish();
      await flush();
    }
    expect(order).toEqual(['swell_1:mini', 'swell_2:mini', 'swell_1:page', 'swell_2:page']);
  });

  it('a visible mini still skips every queue, beside a running background request', async () => {
    call('swell_1', box(-81), true);                  // background mini running
    await flush();
    call('waves', box(-70), false);                   // the user's layer: page and mini go at once
    await flush();
    expect(minis().map(layerOf)).toEqual(['swell_1', 'waves']);
    expect(pages().map(layerOf)).toEqual(['waves']);
  });

  it('background waits for the visible page AND its mini to finish', async () => {
    call('waves', box(-70), false);                   // visible page + visible mini
    await flush();
    call('swell_1', box(-81), true);
    await flush();
    expect(minis().map(layerOf)).toEqual(['waves']);
    await finishWhere((r) => layerOf(r) === 'waves' && !isMini(r));   // the page lands; its mini is still out
    expect(minis().map(layerOf)).toEqual(['waves']);
    expect(_seriesLimiterState()).toMatchObject({ visibleMini: 1, queuedMini: 1 });
    await finishWhere((r) => layerOf(r) === 'waves');                 // now nothing visible is loading
    expect(minis().map(layerOf)).toEqual(['waves', 'swell_1']);
  });

  it('no background request starts while a visible page is waiting, nor while one still loads', async () => {
    call('waves', box(-90), false);
    call('waves', box(-85), false);                   // both page slots busy
    call('waves', box(-80), false);                   // a third visible page WAITS
    await flush();
    call('swell_1', box(-81), true);
    await flush();
    expect(_seriesLimiterState()).toMatchObject({ queuedVisible: 1, queuedMini: 1, backgroundMini: 0 });
    pages()[0].finish();                              // a slot frees: the waiting visible page takes it
    await flush();
    expect(_seriesLimiterState()).toMatchObject({ queuedVisible: 0, backgroundMini: 0, queuedMini: 1 });
    await finishWhere((r) => layerOf(r) === 'waves');
    await finishWhere((r) => layerOf(r) === 'waves');
    expect(_seriesLimiterState()).toMatchObject({ backgroundMini: 1, queuedMini: 0 });
  });

  it('the world /grid warm (runBackgroundWarm) shares the one background request', async () => {
    call('swell_1', box(-81), true);                  // background mini running
    await flush();
    const grid = jest.fn(() => Promise.resolve('world'));
    const p = runBackgroundWarm(grid);
    await flush();
    expect(grid).not.toHaveBeenCalled();
    await finishWhere((r) => isMini(r));              // mini done; the swell_1 page queued before the grid runs first
    expect(grid).not.toHaveBeenCalled();
    await finishWhere(() => true);
    expect(grid).toHaveBeenCalledTimes(1);
    await expect(p).resolves.toBe('world');
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
