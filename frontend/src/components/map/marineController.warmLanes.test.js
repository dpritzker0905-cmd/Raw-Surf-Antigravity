/**
 * THE WARMS ARE WIRED INTO THE BACKGROUND LANE (A15-11, 2026-09-27).
 *
 * The limiter's lanes (marineGridSeries.priority.test.js) only help if the warms actually use them.
 * A priority system every caller bypasses is the repo's "fix that is correct and never called" class,
 * so this pins the callers: the sibling-layer series warm and the zoom-out anticipation grid.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./staticFrames', () => ({ ...jest.requireActual('./staticFrames'), staticSeriesEligible: jest.fn(() => false) }));
jest.mock('./marineGridSeries', () => ({
  ensureMarineSeries: jest.fn(() => Promise.resolve()),
  getMarineSeriesFrame: jest.fn(() => null),
  runBackgroundWarm: jest.fn(),
}));
// Real backend clients with a never-settling fetch, as marineController.globalSeriesPrewarm.test.js does
// (a hand-listed client mock breaks module-level imports).

import { ensureMarineSeries, runBackgroundWarm } from './marineGridSeries';
import { prewarmSiblingMarineSeries, prewarmZoomOutMarineGrid } from './marineController';
import { staticSeriesEligible } from './staticFrames';

const ZOOMED_IN = { west: -81.2, south: 27.9, east: -79.95, north: 28.95 };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('the background warms go through the A15-11 lane', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensureMarineSeries.mockImplementation(() => Promise.resolve());
    runBackgroundWarm.mockImplementation(() => Promise.resolve(undefined));  // record; never fetch
    global.fetch = jest.fn(() => new Promise(() => {}));
    window.__MARINE_SIBLING_PREWARM__ = true;
    delete window.isScrubbingTimeline;
  });
  afterEach(() => { delete global.fetch; });

  afterEach(() => { delete window.__RAW_DISABLE_SIBLING_STATIC_GATE__; });

  it('every sibling-layer series warm is a background load (the static-source gate killed: the old warm)', async () => {
    window.__RAW_DISABLE_SIBLING_STATIC_GATE__ = true;
    prewarmSiblingMarineSeries('GFS', 0, ZOOMED_IN, 'waves', undefined);
    await flush();
    expect(ensureMarineSeries).toHaveBeenCalledTimes(3);            // swell_1, swell_2, wind_waves
    for (const call of ensureMarineSeries.mock.calls) {
      expect(call[5]).toBe(true);                                   // current page only
      expect(call[7]).toBe(true);                                   // background
    }
  });

  // STATIC-SOURCE GATE (2026-10-23): live, after Waves at the z9 opening view, /grid_series pages for swell_1, swell_2 and
  // wind_waves took 6.3, 6.6 and 11.1 s of the 1-CPU box for layers nobody was viewing.
  it('a hidden layer is warmed only from a static source: a regional view with none asks the backend for nothing', async () => {
    prewarmSiblingMarineSeries('GFS', 0, ZOOMED_IN, 'waves', undefined);
    await flush();
    expect(ensureMarineSeries).not.toHaveBeenCalled();
    expect(staticSeriesEligible.mock.calls.map((c) => c[0].layer).sort()).toEqual(['swell_1', 'swell_2', 'wind_waves']);
    expect(staticSeriesEligible.mock.calls[0][0]).toMatchObject({ model: 'GFS', bbox: ZOOMED_IN });
  });

  it('where a static source serves a hidden layer, that layer (and only it) is warmed', async () => {
    staticSeriesEligible.mockImplementation(({ layer }) => layer === 'swell_1');
    prewarmSiblingMarineSeries('GFS', 0, ZOOMED_IN, 'waves', undefined);
    await flush();
    expect(ensureMarineSeries.mock.calls.map((c) => c[1])).toEqual(['swell_1']);
    staticSeriesEligible.mockImplementation(() => false);
  });

  it('the zoom-out anticipation grid waits in the background lane', async () => {
    prewarmZoomOutMarineGrid('GFS', 0, ZOOMED_IN, 'waves');
    await flush();
    expect(runBackgroundWarm).toHaveBeenCalledTimes(1);
    expect(typeof runBackgroundWarm.mock.calls[0][0]).toBe('function');
  });
});
