jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null }));

/**
 * A15-11 (2026-09-27): what the user is looking at is served before what is being warmed.
 *
 * The series limiter was one FIFO capped at 2, shared by the loads the user waits on and the background
 * warms (sibling layers, the world series behind the zoom-out bridge, adjacent-page prefetch), and the
 * world /grid warm bypassed it. Audit 15.0 measured ~11 weather requests within ~9 s of one activation,
 * with in-app series at 7.8-8.2 s against 0.7-1.8 s alone. These pin the lanes: visible first, at most
 * one background slot, no background start while a visible load waits, promotion, the kill switch.
 */
import {
  ensureMarineSeries, prewarmMarineSeries, runBackgroundWarm, _resetMarineSeriesForTest, _seriesLimiterState,
} from './marineGridSeries';

const box = (w) => ({ west: w, south: 27, east: w + 1, north: 28 });
const response = () => ({ ok: true, json: async () => ({ frames: [] }) });
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

describe('marine series limiter priority lanes (A15-11)', () => {
  let requests;
  let loads;
  const visible = (w) => { loads.push(ensureMarineSeries('GFS', 'waves', box(w), 0, undefined, true)); };
  const warm = (w) => { loads.push(ensureMarineSeries('GFS', 'waves', box(w), 0, undefined, true, false, true)); };
  const started = () => requests.map((r) => Number(/bbox=(-?[\d.]+)/.exec(r.url)[1]) + 0.5);  // unpadded west
  const finish = (w) => { requests.find((r) => Math.round(Number(/bbox=(-?[\d.]+)/.exec(r.url)[1]) + 0.5) === w).finish(); };

  beforeEach(() => {
    jest.useFakeTimers();
    _resetMarineSeriesForTest();
    window.__RAW_DISABLE_HOUR0_FIRST__ = true;
    window.__MARINE_SERIES__ = true;
    requests = [];
    loads = [];
    global.fetch = jest.fn((url) => new Promise((resolve) => {
      requests.push({ url, finish: () => resolve(response()) });
    }));
  });
  afterEach(async () => {
    // Warms drain ONE at a time by design, so finish in rounds until nothing new has started.
    for (let i = 0; i < 12; i++) { requests.forEach((r) => r.finish()); await flush(); }
    await Promise.all(loads);
    _resetMarineSeriesForTest();
    jest.useRealTimers();
    delete global.fetch;
    delete window.__RAW_DISABLE_HOUR0_FIRST__;
    delete window.__MARINE_SERIES__;
    delete window.__RAW_DISABLE_FETCH_PRIORITY__;
  });

  it('background warms hold at most ONE of the two slots', async () => {
    warm(-90); warm(-85); warm(-80);
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(_seriesLimiterState()).toMatchObject({ active: 1, background: 1, queuedBackground: 2 });
  });

  it('a visible load takes the free slot beside a running warm', async () => {
    warm(-90);
    await flush();
    visible(-70);
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('a queued visible load goes before a queued warm, whatever the arrival order', async () => {
    visible(-90); visible(-85);           // both slots busy
    await flush();
    warm(-80);                            // queued first...
    visible(-75);                         // ...but this is on screen
    await flush();
    finish(-90);
    await flush();
    expect(started().map(Math.round)).toEqual([-90, -85, -75]);
    finish(-85);
    await flush();
    expect(started().map(Math.round)).toEqual([-90, -85, -75]);   // -75 still loading: the warm waits for idle
    finish(-75);
    await flush();
    expect(started().map(Math.round)).toEqual([-90, -85, -75, -80]);
  });

  it('no warm starts while a visible load is waiting', async () => {
    warm(-90);                            // bg slot
    visible(-85);                         // second slot
    await flush();
    visible(-80);                         // waits
    warm(-75);                            // waits behind it
    finish(-90);                          // a slot frees: the visible one gets it
    await flush();
    expect(started().map(Math.round)).toEqual([-90, -85, -80]);
  });

  it('a visible request for a page still queued as a warm PROMOTES it', async () => {
    visible(-90); visible(-85);
    await flush();
    warm(-80); warm(-75);                 // both queued as warms
    visible(-75);                         // the user now needs -75: same page, still queued
    await flush();
    expect(_seriesLimiterState()).toMatchObject({ queuedVisible: 1, queuedBackground: 1 });
    finish(-90);
    await flush();
    expect(started().map(Math.round)).toEqual([-90, -85, -75]);   // not -80, which queued first
  });

  it('runBackgroundWarm (the world /grid) waits in the same lane', async () => {
    warm(-90);                            // holds the only background slot
    await flush();
    const grid = jest.fn(() => Promise.resolve('world'));
    const p = runBackgroundWarm(grid);
    await flush();
    expect(grid).not.toHaveBeenCalled();
    finish(-90);
    await flush();
    expect(grid).toHaveBeenCalledTimes(1);
    await expect(p).resolves.toBe('world');
  });

  it('the scrub prewarm warms its pages in the background: after what is on screen, one at a time', async () => {
    visible(-90);                                        // the page on screen
    await flush();
    prewarmMarineSeries('GFS', 'waves', box(-70));      // every page of another view, for scrubbing
    await flush();
    expect(requests).toHaveLength(1);                   // nothing warms while the visible page loads
    finish(-90);
    await flush();
    expect(requests).toHaveLength(2);                   // then ONE page at a time
    requests[1].finish();
    await flush();
    expect(requests).toHaveLength(3);
    expect(_seriesLimiterState()).toMatchObject({ background: 1, queuedBackground: 1 });
  });

  it('a visible request for a page the prewarm still has queued goes first', async () => {
    visible(-90); visible(-85);                          // both slots busy
    await flush();
    prewarmMarineSeries('GFS', 'waves', box(-70));      // three pages queued in the background
    visible(-70);                                        // the user now looks at -70: its page 0 is promoted
    await flush();
    expect(_seriesLimiterState()).toMatchObject({ queuedVisible: 1, queuedBackground: 2 });
    finish(-90);
    await flush();
    expect(requests[2].url).toContain('hours=0,');      // -70's current page, not a scrub page
  });

  it('the kill switch restores the single FIFO: warms count as visible', async () => {
    window.__RAW_DISABLE_FETCH_PRIORITY__ = true;
    warm(-90); warm(-85); warm(-80);
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(_seriesLimiterState().background).toBe(0);
  });
});
