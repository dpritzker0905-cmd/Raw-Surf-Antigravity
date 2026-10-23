/**
 * marineSiblingWarm.js: the instant layer toggle keeps its frame, and the hidden layers' 48-frame pages stop competing with the
 * visible layer on the 1-CPU box (2026-10-23; live z9 Florida: ~24 s of the box's ~34 s of series work for one map load).
 * The decisions, on mocked loads and a controllable limiter; the real chain is marineSiblingWarm.chain.test.js.
 */
jest.mock('./marineGridSeries', () => ({
  ensureMarineSeries: jest.fn(() => Promise.resolve()),
  ensureMarineSeriesHour0: jest.fn(() => Promise.resolve()),
  isMarineSeriesPageWarm: jest.fn(() => false),
}));
jest.mock('./marineSeriesLimiter', () => ({ _seriesLimiterState: jest.fn() }));
jest.mock('./marineSeriesStatic', () => ({ staticOwnsWorldPage: jest.fn(() => false) }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));

import { ensureMarineSeries, ensureMarineSeriesHour0, isMarineSeriesPageWarm } from './marineGridSeries';
import { _seriesLimiterState } from './marineSeriesLimiter';
import { staticOwnsWorldPage } from './marineSeriesStatic';
import {
  SIBLING_PAGE_MAX_WAIT_MS, SIBLING_PAGE_POLL_MS, SIBLING_QUIET_MS, _resetSiblingWarmForTest, _siblingWarmState, seriesLanesQuiet, siblingPageMayStart,
  warmSiblingLayer,
} from './marineSiblingWarm';

const BOUNDS = { west: -81.65, south: 27.6, east: -79.58, north: 28.5 };
const QUIET = { active: 0, background: 0, backgroundMini: 0, visibleMini: 0, queuedVisible: 0, queuedBackground: 0, queuedMini: 0, queuedVisibleMini: 0 };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const pagesOf = () => ensureMarineSeries.mock.calls.map((c) => c[1]);
let visibleLanded;

function warm(layer, extra = {}) {
  const cache = extra.cache || jest.fn(() => true);
  warmSiblingLayer({ model: 'GFS', layer, bounds: BOUNDS, hourOffset: 0, signal: extra.signal, visibleLayer: 'waves', frameReady: !!extra.frameReady, cache });
  return cache;
}
async function step(ms = SIBLING_PAGE_POLL_MS) { jest.advanceTimersByTime(ms); await flush(); }
// One idle tick past the quiet window: the lanes must have stayed quiet SIBLING_QUIET_MS (ticked every SIBLING_PAGE_POLL_MS).
async function settle() { for (let t = 0; t <= SIBLING_QUIET_MS + SIBLING_PAGE_POLL_MS; t += SIBLING_PAGE_POLL_MS) await step(); }

describe('marineSiblingWarm: static first, else the mini now and the page in idle time, one layer at a time', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    _resetSiblingWarmForTest();
    visibleLanded = true;
    _seriesLimiterState.mockImplementation(() => ({ ...QUIET }));
    isMarineSeriesPageWarm.mockImplementation((m, layer) => layer === 'waves' && visibleLanded);
    staticOwnsWorldPage.mockImplementation(() => false);
    ensureMarineSeries.mockImplementation(() => Promise.resolve());
    ensureMarineSeriesHour0.mockImplementation(() => Promise.resolve());
    delete window.isScrubbingTimeline;
    delete window.__RAW_DISABLE_SIBLING_IDLE_PAGES__;
  });
  afterEach(() => { _resetSiblingWarmForTest(); jest.useRealTimers(); delete window.isScrubbingTimeline; delete window.__RAW_DISABLE_SIBLING_IDLE_PAGES__; });

  it('the mini goes now and caches the toggle frame; the 48-frame page waits for an idle tick', async () => {
    const cache = warm('swell_1');
    await flush();
    expect(ensureMarineSeriesHour0).toHaveBeenCalledTimes(1);
    expect(ensureMarineSeriesHour0.mock.calls[0][5]).toBe(true);           // the background lane
    expect(cache).toHaveBeenCalledTimes(1);                                  // the frame, from the 1-hour request
    expect(ensureMarineSeries).not.toHaveBeenCalled();                       // no page yet
    await settle();
    expect(ensureMarineSeries).toHaveBeenCalledTimes(1);
    expect(ensureMarineSeries.mock.calls[0][5]).toBe(true);                  // the current page only
    expect(ensureMarineSeries.mock.calls[0][7]).toBe(true);                  // background
    expect(cache).toHaveBeenCalledTimes(2);                                  // the page's frame replaces the mini's
    expect(window.__RAW_SIBLING_WARM__).toMatchObject({ minis: 1, miniFrames: 1, pages: 1 });
  });

  it('pages run ONE layer at a time: the next starts only after the previous one settled', async () => {
    let finish;
    ensureMarineSeries.mockImplementation(() => new Promise((r) => { finish = r; }));
    warm('swell_1'); warm('swell_2'); warm('wind_waves');
    await flush();
    await settle();
    expect(pagesOf()).toEqual(['swell_1']);
    await step(); await step();
    expect(pagesOf()).toEqual(['swell_1']);                                  // still one in flight
    finish(); await flush(); await settle();
    expect(pagesOf()).toEqual(['swell_1', 'swell_2']);
    finish(); await flush(); await settle();
    finish(); await flush(); await settle();
    expect(pagesOf()).toEqual(['swell_1', 'swell_2', 'wind_waves']);
  });

  it('no sibling page while any series load is in flight or queued (visible first, the background lane next)', async () => {
    warm('swell_1');
    await flush();
    for (const busy of [{ active: 1 }, { visibleMini: 1 }, { queuedVisible: 1 }, { queuedVisibleMini: 1 }, { backgroundMini: 1 }, { queuedMini: 1 }, { queuedBackground: 2 }]) {
      _seriesLimiterState.mockImplementation(() => ({ ...QUIET, ...busy }));
      expect(seriesLanesQuiet()).toBe(false);
      await step();
      expect(ensureMarineSeries).not.toHaveBeenCalled();
    }
    _seriesLimiterState.mockImplementation(() => ({ ...QUIET }));
    await settle();
    expect(pagesOf()).toEqual(['swell_1']);
  });

  it('the lanes must stay quiet SIBLING_QUIET_MS (the visible layer\'s adjacent pages queue ~1.5 s after its page): a blip restarts the wait', async () => {
    warm('swell_1');
    await flush();
    await step(SIBLING_QUIET_MS - SIBLING_PAGE_POLL_MS);                    // quiet, but not long enough
    expect(ensureMarineSeries).not.toHaveBeenCalled();
    _seriesLimiterState.mockImplementation(() => ({ ...QUIET, queuedBackground: 1 }));   // the visible layer's next page queued
    await step();
    _seriesLimiterState.mockImplementation(() => ({ ...QUIET }));
    await step(SIBLING_QUIET_MS - SIBLING_PAGE_POLL_MS);
    expect(ensureMarineSeries).not.toHaveBeenCalled();                       // the window restarted at the blip
    await step(); await step();
    expect(pagesOf()).toEqual(['swell_1']);
  });

  it('waits for the visible layer\'s own page; past SIBLING_PAGE_MAX_WAIT_MS a quiet lane is enough', async () => {
    visibleLanded = false;
    warm('swell_1');
    await flush();
    await step(SIBLING_PAGE_MAX_WAIT_MS - 2 * SIBLING_PAGE_POLL_MS);
    expect(ensureMarineSeries).not.toHaveBeenCalled();
    await step(); await step(); await step();
    expect(pagesOf()).toEqual(['swell_1']);
  });

  it('holds while scrubbing and in a hidden tab', async () => {
    warm('swell_1');
    await flush();
    window.isScrubbingTimeline = true;
    await step(); await step();
    expect(ensureMarineSeries).not.toHaveBeenCalled();
    delete window.isScrubbingTimeline;
    const hidden = jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await step(); await step();
    expect(ensureMarineSeries).not.toHaveBeenCalled();
    hidden.mockRestore();
    await settle();
    expect(pagesOf()).toEqual(['swell_1']);
    expect(siblingPageMayStart({ model: 'GFS', visibleLayer: 'waves', bounds: BOUNDS, hourOffset: 0, queuedAt: Date.now() })).toBe(true);
  });

  it('a static source owns the page: the whole warm now (seam B answers it), no mini, no queue', async () => {
    staticOwnsWorldPage.mockImplementation(() => true);
    const cache = warm('swell_2');
    await flush();
    expect(ensureMarineSeriesHour0).not.toHaveBeenCalled();
    expect(pagesOf()).toEqual(['swell_2']);
    expect(cache).toHaveBeenCalledTimes(1);
    expect(_siblingWarmState().queued).toEqual([]);
    expect(window.__RAW_SIBLING_WARM__.static).toBe(1);
  });

  it('a ready frame earns no page (as before), unless that frame came from this warm\'s mini and its page still owes', async () => {
    warm('swell_1', { frameReady: true });
    await flush(); await step();
    expect(ensureMarineSeriesHour0).not.toHaveBeenCalled();
    expect(ensureMarineSeries).not.toHaveBeenCalled();
    // a mini frame whose queued page was dropped (the fetch's signal aborted) is queued again by the next prewarm
    const ac = new AbortController();
    warm('swell_2', { signal: ac.signal });
    await flush();
    ac.abort();
    await step();
    expect(ensureMarineSeries).not.toHaveBeenCalled();
    expect(window.__RAW_SIBLING_WARM__.dropped).toBe(1);
    warm('swell_2', { frameReady: true });
    await flush(); await settle();
    expect(ensureMarineSeriesHour0).toHaveBeenCalledTimes(1);               // no second mini
    expect(pagesOf()).toEqual(['swell_2']);
  });

  it('one queued page per layer: the newest view and hour replace the older entry', async () => {
    _seriesLimiterState.mockImplementation(() => ({ ...QUIET, active: 1 }));
    warm('swell_1');
    warmSiblingLayer({ model: 'GFS', layer: 'swell_1', bounds: { ...BOUNDS, west: -82 }, hourOffset: 3, visibleLayer: 'waves', frameReady: false, cache: () => true });
    await flush();
    expect(_siblingWarmState().queued).toEqual(['GFS_swell_1']);
    _seriesLimiterState.mockImplementation(() => ({ ...QUIET }));
    await settle();
    expect(ensureMarineSeries).toHaveBeenCalledTimes(1);
    expect(ensureMarineSeries.mock.calls[0][2].west).toBe(-82);
    expect(ensureMarineSeries.mock.calls[0][3]).toBe(3);
  });

  it('a page warmed meanwhile (the user showed that layer) is dropped from the queue with no request', async () => {
    const cache = warm('swell_1');
    await flush();
    isMarineSeriesPageWarm.mockImplementation(() => true);
    await step();
    expect(ensureMarineSeries).not.toHaveBeenCalled();
    expect(cache).toHaveBeenCalledTimes(2);
    expect(_siblingWarmState().queued).toEqual([]);
  });

  it('kill switch: the warm as before (the whole page at once, the frame after it, no mini of its own)', async () => {
    window.__RAW_DISABLE_SIBLING_IDLE_PAGES__ = true;
    const cache = warm('swell_1');
    warm('swell_2', { frameReady: true });
    await flush();
    expect(ensureMarineSeriesHour0).not.toHaveBeenCalled();
    expect(pagesOf()).toEqual(['swell_1']);
    expect(cache).toHaveBeenCalledTimes(1);
  });
});
