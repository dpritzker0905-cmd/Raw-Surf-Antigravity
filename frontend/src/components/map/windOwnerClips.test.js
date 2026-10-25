// Owner A/B clips A and B (2026-10-24, both OPT-IN): what the wind status line says for an hour between two 3-hourly frames.
//   A: window.__RAW_WIND_NEAREST_WORDS__ — compare against the selected instant before the manifest snap, so the nearest frame is named.
//   B: window.__RAW_WIND_TIME_BLEND__ — a blended field reads as an estimate naming both stored frames.
jest.mock('./backendWindServiceClient', () => ({ fetchBackendWindGrid: jest.fn() }));

import { publishWindDrawn, _resetMarineDrawnForTest } from './marineDrawnFrame';
import { windReadout } from './WindTimeStatus';
import { setCachedManifest } from './backendWeatherServiceClient';
import { getWindDrawn } from './marineDrawnFrame';

const NOW = Date.parse('2026-10-25T00:20:00Z');            // the series anchor rounds to 00:00Z
const iso = (h) => new Date(Date.parse('2026-10-25T00:00:00Z') + h * 3600000).toISOString();
const product = (h) => ({ model: 'GFS', domain: 'wind', layer: 'wind', valid_time_start: iso(h) });

beforeEach(() => {
  _resetMarineDrawnForTest();
  window.__MOCK_DATE_NOW__ = NOW;
  setCachedManifest({ products: [product(0), product(3), product(6)] });
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  delete window.__MOCK_DATE_NOW__;
  delete window.__RAW_WIND_NEAREST_WORDS__;
  delete window.__RAW_WIND_TIME_BLEND__;
  jest.restoreAllMocks();
});

test('today (both off): +2 h draws the 03Z frame and the line says nothing (the snap makes them equal)', () => {
  publishWindDrawn({ hourOffset: 2, model: 'GFS', served_valid_time: iso(3) });
  expect(windReadout({ model: 'GFS', hour: 2 }, getWindDrawn())).toBeNull();
});

test('clip A: the same frame is named as the nearest stored forecast; an exact frame stays silent', () => {
  window.__RAW_WIND_NEAREST_WORDS__ = true;
  publishWindDrawn({ hourOffset: 2, model: 'GFS', served_valid_time: iso(3) });
  const r = windReadout({ model: 'GFS', hour: 2 }, getWindDrawn());
  expect(r.state).toBe('nearest');
  expect(r.text).toMatch(/^Showing .+: the nearest stored forecast$/);
  publishWindDrawn({ hourOffset: 3, model: 'GFS', served_valid_time: iso(3) });
  expect(windReadout({ model: 'GFS', hour: 3 }, getWindDrawn())).toBeNull();
});

test('clip A: a frame further than 1 h off still reads Loading (an owed fetch, never "nearest")', () => {
  window.__RAW_WIND_NEAREST_WORDS__ = true;
  publishWindDrawn({ hourOffset: 5, model: 'GFS', served_valid_time: iso(3) });
  expect(windReadout({ model: 'GFS', hour: 5 }, getWindDrawn()).state).toBe('pending');
});

test('clip B: a blended field reads as an estimate naming both stored frames', () => {
  window.__RAW_WIND_TIME_BLEND__ = true;
  publishWindDrawn({ hourOffset: 2, model: 'GFS', served_valid_time: iso(2), is_estimated: true,
    time_blend: { from: iso(0), to: iso(3), weight: 0.667 } });
  const r = windReadout({ model: 'GFS', hour: 2 }, getWindDrawn());
  expect(r.state).toBe('estimated');
  expect(r.text).toMatch(/^Estimated forecast: interpolated between .+ and .+$/);
});
