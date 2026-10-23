import { formatInstant, forecastReadout } from './forecastReadout';

/**
 * formatInstant keeps one Intl.DateTimeFormat pair per timeZone instead of building new formatters on every scrubber render
 * (the 2026-10-20 stall profile, PR #400). The strings must be exactly what toLocaleDateString / toLocaleTimeString gave,
 * which is still the path under window.__RAW_DISABLE_INTL_FORMAT_CACHE__ = true.
 */

const H = 3600000;
const ZONES = [undefined, 'UTC', 'America/Los_Angeles', 'America/New_York', 'Pacific/Honolulu', 'Australia/Sydney',
  'Asia/Kolkata', 'Pacific/Chatham', 'Europe/London', 'America/St_Johns'];

const legacy = (ms, timeZone) => {
  const d = new Date(ms);
  const opts = timeZone ? { timeZone } : {};
  return `${d.toLocaleDateString('en-US', { weekday: 'short', ...opts })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', ...opts })}`;
};

afterEach(() => { delete window.__RAW_DISABLE_INTL_FORMAT_CACHE__; });

describe('formatInstant — cached formatters, identical strings', () => {
  it('every hour across a year (both DST changes) in ten zones, half-hour and odd offsets included', () => {
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);
    let n = 0;
    for (const tz of ZONES) {
      for (let ms = start; ms < start + 366 * 24 * H; ms += 7 * H + 13 * 60000) {   // a stride that walks every hour/minute phase
        expect(formatInstant(ms, tz)).toBe(legacy(ms, tz));
        n++;
      }
    }
    expect(n).toBeGreaterThan(10000);
  });

  it('the kill switch takes the toLocale path and gives the same strings', () => {
    const ms = Date.UTC(2026, 8, 23, 6, 0, 0);
    const cached = formatInstant(ms, 'UTC');
    window.__RAW_DISABLE_INTL_FORMAT_CACHE__ = true;
    expect(formatInstant(ms, 'UTC')).toBe(cached);
    expect(cached).toBe('Wed 6 AM');
  });

  it('an invalid instant still reads "Invalid Date" (Intl format() would throw) and a bad zone still throws RangeError', () => {
    expect(formatInstant(NaN, 'UTC')).toBe(legacy(NaN, 'UTC'));
    expect(formatInstant(Infinity)).toBe('Invalid Date Invalid Date');
    expect(() => legacy(0, 'Not/AZone')).toThrow(RangeError);
    expect(() => formatInstant(0, 'Not/AZone')).toThrow(RangeError);
    expect(formatInstant(0, 'UTC')).toBe(legacy(0, 'UTC'));   // a failed zone does not poison the cache
  });

  it('builds the formatters once per zone, not once per call', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat');
    try {
      for (let i = 0; i < 50; i++) formatInstant(Date.UTC(2026, 3, 1, i % 24), 'Asia/Tokyo');
      expect(spy.mock.calls.length).toBe(2);   // one weekday + one hour formatter, built on the first call
    } finally { spy.mockRestore(); }
  });

  it('forecastReadout copy is unchanged ("Live" at hour 0, the shown instant otherwise)', () => {
    expect(forecastReadout(0, 'none', 'GFS', { timeZone: 'UTC' }).text).toBe('Live');
    const r = forecastReadout(5, 'none', 'GFS', { timeZone: 'UTC' });
    expect(r.text).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2} (AM|PM)$/);
  });
});
