// Wind hours between 3-hourly frames: what the wind status line says.
//   Option A (name the nearest frame) shipped as #560's LABEL INSTANT (default on): the line compares against the selection's own
//   instant (series anchor + hour), so the nearest stored frame is named.
//   Option B (window.__RAW_WIND_TIME_BLEND__, opt-in): a blended field reads as an estimate naming both stored frames, on the same
//   comparison.
jest.mock('./backendWindServiceClient', () => ({ fetchBackendWindGrid: jest.fn() }));

import { publishWindDrawn, getWindDrawn, _resetMarineDrawnForTest } from './marineDrawnFrame';
import { windReadout } from './WindTimeStatus';
import { setCachedManifest } from './backendWeatherServiceClient';

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
  delete window.__RAW_WIND_TIME_BLEND__;
  jest.restoreAllMocks();
});

test('default (#560): +2 h draws the 03Z frame and the line names it as the nearest stored forecast', () => {
  publishWindDrawn({ hourOffset: 2, model: 'GFS', served_valid_time: iso(3) });
  const r = windReadout({ model: 'GFS', hour: 2 }, getWindDrawn());
  expect(r.state).toBe('nearest');
  expect(r.text).toMatch(/^Showing .+: the nearest stored forecast$/);
});

test('option B: a blended field (valid at the selected instant) reads as an estimate naming both stored frames', () => {
  window.__RAW_WIND_TIME_BLEND__ = true;
  publishWindDrawn({ hourOffset: 2, model: 'GFS', served_valid_time: iso(2), is_estimated: true,
    time_blend: { from: iso(0), to: iso(3), weight: 0.667 } });
  const r = windReadout({ model: 'GFS', hour: 2 }, getWindDrawn());
  expect(r.state).toBe('estimated');
  expect(r.text).toMatch(/^Estimated forecast: interpolated between .+ and .+$/);
});

test('option B on a stored hour: no blend, no line', () => {
  window.__RAW_WIND_TIME_BLEND__ = true;
  publishWindDrawn({ hourOffset: 3, model: 'GFS', served_valid_time: iso(3) });
  expect(windReadout({ model: 'GFS', hour: 3 }, getWindDrawn())).toBeNull();
});
