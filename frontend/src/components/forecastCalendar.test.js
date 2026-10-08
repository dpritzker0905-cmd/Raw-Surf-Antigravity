import { forecastCalendar } from './forecastCalendar';

test.each([
  ['2026-10-05', '2026-10-04T23:55:00Z', 'Mon', 'Oct 5', 'Tomorrow'],
  ['2027-01-01', '2026-12-31T23:55:00Z', 'Fri', 'Jan 1', 'Tomorrow'],
  ['2028-02-29', '2028-02-28T12:00:00Z', 'Tue', 'Feb 29', 'Tomorrow'],
  ['2026-03-08', '2026-03-07T12:00:00Z', 'Sun', 'Mar 8', 'Tomorrow'],
  ['2026-11-01', '2026-10-31T12:00:00Z', 'Sun', 'Nov 1', 'Tomorrow'],
  ['2026-10-04', '2026-10-04T23:55:00Z', 'Sun', 'Oct 4', 'Today'],
  ['2026-10-03', '2026-10-04T12:00:00Z', 'Sat', 'Oct 3', 'Sat'],
])('%s keeps its UTC calendar across month/year/leap/DST boundaries', (id, now, weekday, monthDay, relative) => {
  expect(forecastCalendar(id, Date.parse(now), 'UTC')).toMatchObject({ weekday, monthDay, relative });
});
test.each([null, undefined, '', '2026-02-30', '2026-13-01', '2026-1-05', '2026-10-05T00:00:00Z'])('%s never invents a valid daily date', id => {
  expect(forecastCalendar(id).relative).toBe('Unavailable');
});
test('a bad current clock cannot erase a valid daily identifier', () => {
  expect(forecastCalendar('2026-10-05', NaN)).toMatchObject({ weekday: 'Mon', relative: 'Mon' });
});

test.each(['America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu'])('%s evening uses the viewer day for Today', zone => {
  const now = Date.parse('2026-10-06T01:00:00Z');
  expect(forecastCalendar('2026-10-05', now, zone)).toMatchObject({ weekday: 'Mon', monthDay: 'Oct 5', relative: 'Today' });
  expect(forecastCalendar('2026-10-06', now, zone)).toMatchObject({ weekday: 'Tue', monthDay: 'Oct 6', relative: 'Tomorrow' });
});
test.each([
  ['America/New_York', '2027-01-01T01:00:00Z', '2026-12-31', '2027-01-01'],
  ['America/Los_Angeles', '2026-03-09T02:00:00Z', '2026-03-08', '2026-03-09'],
  ['Pacific/Auckland', '2026-10-05T12:00:00Z', '2026-10-06', '2026-10-07'],
])('%s month/DST/date-line changes preserve date identifiers and viewer-relative days', (zone, instant, today, tomorrow) => {
  expect(forecastCalendar(today, Date.parse(instant), zone).relative).toBe('Today');
  expect(forecastCalendar(tomorrow, Date.parse(instant), zone).relative).toBe('Tomorrow');
});
test('a missing viewer zone preserves the calendar and the diagnostic kill restores UTC Today', () => {
  const now = Date.parse('2026-10-06T01:00:00Z');
  expect(forecastCalendar('2026-10-06', now, 'invalid/zone')).toMatchObject({ weekday: 'Tue', relative: 'Tue' });
  window.__RAW_DISABLE_FORECAST_CALENDAR_LOCAL_TODAY__ = true;
  try {
    expect(forecastCalendar('2026-10-06', now, 'America/New_York').relative).toBe('Today');
  } finally { delete window.__RAW_DISABLE_FORECAST_CALENDAR_LOCAL_TODAY__; }
});
