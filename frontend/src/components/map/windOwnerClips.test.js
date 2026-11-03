// Wind hours between 3-hourly frames: what the wind status line says.
//   A frame that is not blended (before f120, or the blend killed with window.__RAW_DISABLE_WIND_TIME_BLEND__): #560's LABEL
//   INSTANT names the nearest stored frame (the line compares against the selection's own instant, series anchor + hour).
//   The f120+ tail blend (ON since the owner's pick, 2026-11-01): a blended field reads as an estimate naming both stored frames, on
//   the same comparison. marineDrawnFrame records the two instants; drawnFrameReadout words them (dated six or more days out).
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
  jest.spyOn(Date, 'now').mockImplementation(() => NOW);
  setCachedManifest({ products: [product(0), product(3), product(6), product(150), product(153)] });
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  delete window.__MOCK_DATE_NOW__;
  jest.restoreAllMocks();
});

test('a frame that is not blended: +2 h draws the 03Z frame and the line names it as the nearest stored forecast (#560)', () => {
  publishWindDrawn({ hourOffset: 2, model: 'GFS', served_valid_time: iso(3) });
  const r = windReadout({ model: 'GFS', hour: 2 }, getWindDrawn());
  expect(r.state).toBe('nearest');
  expect(r.text).toMatch(/^Showing .+: the nearest stored forecast$/);
});

test('a blended field (valid at the selected instant) reads as an estimate naming both stored frames', () => {
  publishWindDrawn({ hourOffset: 2, model: 'GFS', served_valid_time: iso(2), is_estimated: true,
    time_blend: { from: iso(0), to: iso(3), weight: 0.667 } });
  expect(getWindDrawn().timeBlend).toEqual({ fromMs: Date.parse(iso(0)), toMs: Date.parse(iso(3)) });
  const r = windReadout({ model: 'GFS', hour: 2 }, getWindDrawn());
  expect(r.state).toBe('estimated');
  expect(r.text).toMatch(/^Estimated forecast: interpolated between .+ and .+$/);
  expect(r.text).not.toMatch(/Oct/);                                   // two days out: weekday + hour, as every other line
});

test('six or more days out the two frames are dated, as every other line is there', () => {
  publishWindDrawn({ hourOffset: 151, model: 'GFS', served_valid_time: iso(151), is_estimated: true,
    time_blend: { from: iso(150), to: iso(153), weight: 0.333 } });
  const r = windReadout({ model: 'GFS', hour: 151 }, getWindDrawn());
  expect(r.text).toMatch(/^Estimated forecast: interpolated between .*Oct 31.* and .*Oct 31.*$/);
});

test('on a stored hour: no blend, no line', () => {
  publishWindDrawn({ hourOffset: 3, model: 'GFS', served_valid_time: iso(3) });
  expect(windReadout({ model: 'GFS', hour: 3 }, getWindDrawn())).toBeNull();
});
