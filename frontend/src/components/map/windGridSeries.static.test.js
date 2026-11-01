/**
 * The wind series lane skips a WORLD page that static frames can serve hour by hour (2026-10-22, the wind instant scrub): the page
 * is a thinned 46 x 21 world built by the 1-CPU box in ~10-25 s, the static frame is the full 2-degree field from the CDN.
 */
import { ensureWindSeries, staticOwnsWindPage, _resetWindSeriesForTest } from './windGridSeries';

jest.mock('./windStaticFrames', () => ({
  windStaticEnabled: jest.fn(() => true),
  windIndex: jest.fn(async () => ({ frames: [] })),
  readLanePointer: jest.fn(async () => ({ key: 'k' })),
  staticWindCovers: jest.fn(() => true),
}));
const ws = require('./windStaticFrames');

const WORLD_VIEW = { west: -120, south: -10, east: -30, north: 60 };     // > 15 deg: the 'global' series key
const REGIONAL_VIEW = { west: -82, south: 26, east: -77, north: 30 };

beforeEach(() => {
  _resetWindSeriesForTest();
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ frames: [] }) }));
  ws.windStaticEnabled.mockReturnValue(true);
  ws.staticWindCovers.mockReturnValue(true);
  delete window.__RAW_DISABLE_WIND_SERIES_STATIC_SKIP__;
  delete window.__RAW_DISABLE_WIND_HRRR_LANE__;
});

test('a world page static frames cover is not asked for; the mini and the page both skip', async () => {
  expect(await staticOwnsWindPage('GFS', WORLD_VIEW, 0)).toBe(true);
  await ensureWindSeries('GFS', WORLD_VIEW, 0);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(window.__WIND_SERIES_DIAG__.staticSkips).toBeGreaterThan(0);
});

test('the tail page asks only the hours the static frames cannot serve; the trim kill asks the whole page', async () => {
  const { getSeriesAnchorMs } = require('./backendWeatherServiceClient');
  const hourOf = (iso) => Math.round((Date.parse(iso) - getSeriesAnchorMs()) / 3600000);
  ws.staticWindCovers.mockImplementation((asks) => asks.every((a) => hourOf(a) < 330));   // the run's frames end ~+330 h
  // the PAGE asks (the 1-hour mini for the hour in view is its own, separate ask)
  const asked = () => global.fetch.mock.calls.map(([u]) => new URL(u, 'http://x').searchParams.get('hours')).filter((h) => h && h.includes(','));
  await ensureWindSeries('GFS', WORLD_VIEW, 300);                        // page 2: hours 288-384
  expect(asked()).toEqual(['330,333,336,339,342,345,348,351,354,357,360,363,366,369,372,375,378,381,384']);
  expect(window.__WIND_SERIES_DIAG__.staticTrims).toBeGreaterThan(0);
  _resetWindSeriesForTest(); global.fetch.mockClear();
  window.__RAW_DISABLE_WIND_SERIES_TRIM__ = true;
  try {
    await ensureWindSeries('GFS', WORLD_VIEW, 300);
    expect(asked()[0].split(',')).toHaveLength(33);                      // the whole page, as before
  } finally {
    delete window.__RAW_DISABLE_WIND_SERIES_TRIM__;
  }
});

test('a regional page, another model, an uncovered hour, the lane kill or the skip kill all keep the series request', async () => {
  expect(await staticOwnsWindPage('GFS', REGIONAL_VIEW, 0)).toBe(false);
  expect(await staticOwnsWindPage('ICON', WORLD_VIEW, 0)).toBe(false);
  ws.staticWindCovers.mockReturnValue(false);
  expect(await staticOwnsWindPage('GFS', WORLD_VIEW, 0)).toBe(false);
  ws.staticWindCovers.mockReturnValue(true);
  window.__RAW_DISABLE_WIND_HRRR_LANE__ = true;
  expect(await staticOwnsWindPage('GFS', WORLD_VIEW, 0)).toBe(false);
  delete window.__RAW_DISABLE_WIND_HRRR_LANE__;
  window.__RAW_DISABLE_WIND_SERIES_STATIC_SKIP__ = true;
  expect(await staticOwnsWindPage('GFS', WORLD_VIEW, 0)).toBe(false);
  delete window.__RAW_DISABLE_WIND_SERIES_STATIC_SKIP__;
  ws.staticWindCovers.mockReturnValue(false);
  await ensureWindSeries('GFS', WORLD_VIEW, 0);
  expect(global.fetch).toHaveBeenCalled();                                // not covered: the box serves the page as before
});
