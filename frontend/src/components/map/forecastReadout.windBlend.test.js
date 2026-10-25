// Wind clip B (opt-in __RAW_WIND_TIME_BLEND__): the timeline's time label names the blend's instant, never the snapped frame,
// and its screen-reader text says it is interpolated. Off, the label is unchanged (F-07: the displayed, snapped instant).
const mockFrames = ['2026-10-25T00:00:00Z', '2026-10-25T03:00:00Z', '2026-10-25T06:00:00Z'].map((v, i) => ({ valid_time: v, path: `f${i}.bin` }));
jest.mock('./windStaticFrames', () => ({ windIndexSync: () => ({ frames: mockFrames }) }));

import { displayedForecastTime, forecastReadout } from './forecastReadout';
import { setCachedManifest } from './backendWeatherServiceClient';

const at = (iso) => Date.parse(iso);
beforeEach(() => {
  window.__MOCK_DATE_NOW__ = at('2026-10-25T00:20:00Z');          // anchor 00:00Z
  setCachedManifest({ products: mockFrames.map((f) => ({ model: 'GFS', domain: 'wind', layer: 'wind', valid_time_start: f.valid_time })) });
});
afterEach(() => { delete window.__MOCK_DATE_NOW__; delete window.__RAW_WIND_TIME_BLEND__; });

test('off: +1 h reads the snapped 00Z frame (F-07, unchanged)', () => {
  expect(displayedForecastTime(1, 'wind', 'GFS')).toMatchObject({ ms: at('2026-10-25T00:00:00Z'), snapped: true });
});

test('clip B on: +1 h reads the blend instant 01Z, and the screen-reader text says interpolated', () => {
  window.__RAW_WIND_TIME_BLEND__ = true;
  const d = displayedForecastTime(1, 'wind', 'GFS');
  expect(d).toMatchObject({ ms: at('2026-10-25T01:00:00Z'), snapped: false });
  expect(forecastReadout(1, 'wind', 'GFS', { timeZone: 'UTC' }).srText)
    .toBe('Showing an estimate for Sun 1 AM, interpolated between the forecasts for Sun 12 AM and Sun 3 AM.');
});

test('clip B on: a stored frame, another model and marine layers keep the snapped readout', () => {
  window.__RAW_WIND_TIME_BLEND__ = true;
  expect(displayedForecastTime(3, 'wind', 'GFS')).toMatchObject({ ms: at('2026-10-25T03:00:00Z') });
  expect(displayedForecastTime(1, 'wind', 'ICON').blend).toBeUndefined();
  expect(displayedForecastTime(1, 'waves', 'GFS').blend).toBeUndefined();
});
