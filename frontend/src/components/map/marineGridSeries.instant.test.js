jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({
  getSurfModeFlag: () => false,
  getSeriesAnchorIso: () => new Date(Math.round(global.window.__MOCK_DATE_NOW__ / 3600000) * 3600000).toISOString(),
}));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null, recordTruthStage: () => {} }));

import { ensureMarineSeries, getMarineSeriesFrame, _resetMarineSeriesForTest } from './marineGridSeries';

const H = 3600000;
const BASE = Date.UTC(2026, 9, 8, 12);
const WIDE = { west: -84, south: 24, east: -76, north: 32 };
const INNER = { west: -81, south: 27, east: -80, north: 29 };
let originalFlag;

beforeEach(() => {
  originalFlag = process.env.REACT_APP_MARINE_SERIES_INSTANT_MATCH;
  process.env.REACT_APP_MARINE_SERIES_INSTANT_MATCH = 'true';
  window.__MOCK_DATE_NOW__ = BASE;
  window.__RAW_DISABLE_HOUR0_FIRST__ = true;
  window.__MARINE_SERIES__ = true;
  _resetMarineSeriesForTest();
  global.fetch = jest.fn(async url => {
    const parsed = new URL(url, 'https://offline.invalid');
    const anchor = Date.parse(parsed.searchParams.get('base_time'));
    const hours = parsed.searchParams.get('hours').split(',').map(Number);
    return { ok: true, status: 200, json: async () => ({ frames: hours.map(hour => ({
      hour_offset: hour, valid_time: new Date(anchor + hour * H).toISOString(),
      cols: 1, rows: 1, bounds: WIDE,
      vectors: [{ lat: 28, lng: -80, u: 0, v: -1, speed: 1 + hour / 100, direction: 0, period: 8 }],
    })) }) };
  });
});
afterEach(() => {
  if (originalFlag === undefined) delete process.env.REACT_APP_MARINE_SERIES_INSTANT_MATCH;
  else process.env.REACT_APP_MARINE_SERIES_INSTANT_MATCH = originalFlag;
  delete window.__MOCK_DATE_NOW__;
  delete window.__RAW_DISABLE_HOUR0_FIRST__;
  delete window.__RAW_DISABLE_MARINE_SERIES_INSTANT_MATCH__;
  delete window.__MARINE_SERIES__;
  delete global.fetch;
  _resetMarineSeriesForTest();
});

async function warm() {
  await ensureMarineSeries('GFS', 'waves', WIDE, 0, undefined, true);
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

test.each([1, 2, 3])('containment chooses the valid instant after a %i-hour anchor rollover', async shift => {
  await warm();
  window.__MOCK_DATE_NOW__ = BASE + shift * H;
  for (const hour of [0, 1, 2, 3, 46, 47, 48, 137, 138]) {
    const expected = BASE + Math.round((shift + hour) / 3) * 3 * H;
    const frame = getMarineSeriesFrame('GFS', 'waves', INNER, hour);
    expect(frame).not.toBeNull();
    expect(Date.parse(frame.valid_time)).toBe(expected);
    expect(frame.hourOffset).toBe((expected - BASE) / H - shift);
    expect(frame.grid.hourOffset).toBe(frame.hourOffset);
  }
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('same-anchor frames retain identity and the dark default restores the positive control', async () => {
  await warm();
  const original = getMarineSeriesFrame('GFS', 'waves', INNER, 3);
  expect(original.hourOffset).toBe(3);
  window.__MOCK_DATE_NOW__ = BASE + 2 * H;
  const repaired = getMarineSeriesFrame('GFS', 'waves', INNER, 1);
  expect(repaired.valid_time).toBe(new Date(BASE + 3 * H).toISOString());
  expect(repaired.hourOffset).toBe(1);
  expect(original.hourOffset).toBe(3); // rebasing did not mutate the cached frame
  process.env.REACT_APP_MARINE_SERIES_INSTANT_MATCH = 'false';
  const legacy = getMarineSeriesFrame('GFS', 'waves', INNER, 1);
  expect(legacy.valid_time).toBe(new Date(BASE).toISOString());
  expect(legacy.hourOffset).toBe(0);
});

test('the diagnostic kill switch reproduces relative-hour matching', async () => {
  await warm();
  window.__MOCK_DATE_NOW__ = BASE + 2 * H;
  window.__RAW_DISABLE_MARINE_SERIES_INSTANT_MATCH__ = true;
  expect(getMarineSeriesFrame('GFS', 'waves', INNER, 1).valid_time).toBe(new Date(BASE).toISOString());
});

test('a missing or invalid valid instant cannot become an instant-match cache hit', async () => {
  const fetchFrames = global.fetch;
  global.fetch = jest.fn(async url => {
    const response = await fetchFrames(url);
    const body = await response.json();
    body.frames.forEach((frame, index) => { frame.valid_time = index % 2 ? 'invalid' : null; });
    return { ...response, json: async () => body };
  });
  await warm();
  expect(getMarineSeriesFrame('GFS', 'waves', INNER, 3)).toBeNull();
});

test('paired rollover sweep separates the temporal defect from same-anchor identity', async () => {
  await warm();
  let beforeWrong = 0;
  let afterWrong = 0;
  let sameAnchorChanges = 0;
  for (const shift of [0, 1, 2, 3]) {
    window.__MOCK_DATE_NOW__ = BASE + shift * H;
    for (let hour = 0; hour <= 138; hour++) {
      const expected = BASE + Math.round((shift + hour) / 3) * 3 * H;
      process.env.REACT_APP_MARINE_SERIES_INSTANT_MATCH = 'false';
      const before = getMarineSeriesFrame('GFS', 'waves', INNER, hour);
      process.env.REACT_APP_MARINE_SERIES_INSTANT_MATCH = 'true';
      const after = getMarineSeriesFrame('GFS', 'waves', INNER, hour);
      if (shift === 0) {
        if (before !== after) sameAnchorChanges++;
      } else {
        if (Date.parse(before?.valid_time) !== expected) beforeWrong++;
        if (Date.parse(after?.valid_time) !== expected) afterWrong++;
      }
    }
  }
  expect(beforeWrong).toBeGreaterThan(0);
  expect(afterWrong).toBe(0);
  expect(sameAnchorChanges).toBe(0);
  console.log('WF03_CACHE_PAIR ' + JSON.stringify({ rolloverRequests: 417, beforeWrong, afterWrong,
    sameAnchorRequests: 139, sameAnchorChanges, networkRequests: global.fetch.mock.calls.length }));
});

test('unreachable instants and an unresolved anchor miss instead of borrowing an unrelated frame', async () => {
  await warm();
  window.__MOCK_DATE_NOW__ = BASE + 2 * H;
  expect(getMarineSeriesFrame('GFS', 'waves', INNER, 144)).toBeNull();
  window.__MOCK_DATE_NOW__ = NaN;
  expect(getMarineSeriesFrame('GFS', 'waves', INNER, 3)).toBeNull();
});
