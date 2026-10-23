/**
 * THE WARMS ARE WIRED INTO THE BACKGROUND LANE (A15-11, 2026-09-27).
 *
 * The limiter's lanes (marineGridSeries.priority.test.js) only help if the warms actually use them.
 * A priority system every caller bypasses is the repo's "fix that is correct and never called" class,
 * so this pins the callers: the sibling-layer series warm and the zoom-out anticipation grid.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./marineGridSeries', () => ({
  ensureMarineSeries: jest.fn(() => Promise.resolve()),
  ensureMarineSeriesHour0: jest.fn(() => Promise.resolve()),
  isMarineSeriesPageWarm: jest.fn((model, layer) => layer === 'waves'),   // the visible layer's page has landed
  getMarineSeriesFrame: jest.fn(() => null),
  runBackgroundWarm: jest.fn(),
}));
// Real backend clients with a never-settling fetch, as marineController.globalSeriesPrewarm.test.js does
// (a hand-listed client mock breaks module-level imports).

import { ensureMarineSeries, ensureMarineSeriesHour0, isMarineSeriesPageWarm, runBackgroundWarm } from './marineGridSeries';
import { prewarmSiblingMarineSeries, prewarmZoomOutMarineGrid } from './marineController';
import { SIBLING_PAGE_POLL_MS, _resetSiblingWarmForTest } from './marineSiblingWarm';

const ZOOMED_IN = { west: -81.2, south: 27.9, east: -79.95, north: 28.95 };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('the background warms go through the A15-11 lane', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetSiblingWarmForTest();
    ensureMarineSeries.mockImplementation(() => Promise.resolve());
    ensureMarineSeriesHour0.mockImplementation(() => Promise.resolve());
    isMarineSeriesPageWarm.mockImplementation((model, layer) => layer === 'waves');   // CRA resets mocks before each test
    runBackgroundWarm.mockImplementation(() => Promise.resolve(undefined));  // record; never fetch
    global.fetch = jest.fn(() => new Promise(() => {}));
    window.__MARINE_SIBLING_PREWARM__ = true;
    delete window.isScrubbingTimeline;
  });
  afterEach(() => { delete global.fetch; _resetSiblingWarmForTest(); jest.useRealTimers(); });

  it('every sibling-layer series warm is a background load: the minis at once, the pages from the idle queue', async () => {
    jest.useFakeTimers();
    prewarmSiblingMarineSeries('GFS', 0, ZOOMED_IN, 'waves', undefined);
    await flush();
    expect(ensureMarineSeriesHour0).toHaveBeenCalledTimes(3);       // swell_1, swell_2, wind_waves: the toggle frames
    for (const call of ensureMarineSeriesHour0.mock.calls) expect(call[5]).toBe(true);   // background
    expect(ensureMarineSeries).not.toHaveBeenCalled();              // the 48-frame pages wait (marineSiblingWarm.js)
    for (let i = 0; i < 3; i++) { jest.advanceTimersByTime(SIBLING_PAGE_POLL_MS); await flush(); }
    expect(ensureMarineSeries).toHaveBeenCalledTimes(3);
    for (const call of ensureMarineSeries.mock.calls) {
      expect(call[5]).toBe(true);                                   // current page only
      expect(call[7]).toBe(true);                                   // background
    }
  });

  it('the zoom-out anticipation grid waits in the background lane', async () => {
    prewarmZoomOutMarineGrid('GFS', 0, ZOOMED_IN, 'waves');
    await flush();
    expect(runBackgroundWarm).toHaveBeenCalledTimes(1);
    expect(typeof runBackgroundWarm.mock.calls[0][0]).toBe('function');
  });
});
