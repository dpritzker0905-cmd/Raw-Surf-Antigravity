import { forecastSelectionMs, forecastDayLabel, formatForecastInstant } from './forecastReadout';
import { getSeriesAnchorMs } from './backendWeatherServiceClient';
jest.mock('./backendWeatherServiceClient', () => ({ getSeriesAnchorMs: jest.fn(), getSharedValidTime: jest.fn() }));
const H = 3600000;
test('UTC elapsed hours survive DST and year boundaries', () => {
  const anchor = Date.parse('2026-10-31T16:00:00Z');
  getSeriesAnchorMs.mockReturnValue(anchor);
  expect(forecastSelectionMs(24)).toBe(anchor + 24 * H);
  expect(formatForecastInstant(forecastSelectionMs(24), 'America/New_York')).toContain('11:00 AM EST');
  expect(forecastDayLabel(168)).not.toBe(forecastDayLabel(336));
  getSeriesAnchorMs.mockReturnValue(Date.parse('2026-12-31T23:00:00Z'));
  expect(formatForecastInstant(forecastSelectionMs(2), 'UTC')).toBe('Fri, Jan 1, 2027, 1:00 AM UTC');
});
test('full dates distinguish the same weekday in adjacent weeks', () => {
  expect(formatForecastInstant(Date.parse('2026-11-08T17:00:00Z'), 'UTC')).toContain('Nov 8');
  expect(formatForecastInstant(Date.parse('2026-11-15T17:00:00Z'), 'UTC')).toContain('Nov 15');
});

test('full timestamp formatter is reused while scrubbing', () => {
  const spy = jest.spyOn(Intl, 'DateTimeFormat');
  try {
    const start = Date.parse('2026-11-08T17:00:00Z');
    for (let h = 0; h <= 336; h += 1) formatForecastInstant(start + h * H, 'Pacific/Auckland');
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test.each([null, undefined, NaN, Infinity, -Infinity])('missing or non-finite forecast instant %s has no visible invalid-date label', value => {
  expect(formatForecastInstant(value, 'UTC')).toBe('');
});
