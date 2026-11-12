// 2026-11-11 (layer animation lane): the status lines' date words come from cached Intl.DateTimeFormat instances. The words
// must be exactly what toLocaleString gave, for every option set, and the kill must go back to toLocaleString per call.
import { formatReadoutDate } from './readoutDateFormat';
import { formatInstant, formatForecastHour } from './drawnFrameReadout';

const OPTS = {
  hour: { weekday: 'short', hour: 'numeric' },
  dated: { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' },
  clock: { hour: 'numeric', minute: '2-digit' },
};
const T0 = Date.UTC(2026, 10, 11, 5, 10);
const SAMPLES = Array.from({ length: 400 }, (_, i) => T0 + i * 53 * 60000);   // 14+ days, every hour of the day, odd minutes

afterEach(() => { delete window.__RAW_DISABLE_READOUT_FORMAT_CACHE__; jest.restoreAllMocks(); });

test.each(Object.keys(OPTS))('%s: the cached formatter gives the words toLocaleString gives', (kind) => {
  for (const ms of SAMPLES) expect(formatReadoutDate(new Date(ms), kind)).toBe(new Date(ms).toLocaleString('en-US', OPTS[kind]));
});

test('one formatter per kind, however many calls', () => {
  const spy = jest.spyOn(Intl, 'DateTimeFormat');
  for (const ms of SAMPLES) { formatReadoutDate(new Date(ms), 'hour'); formatReadoutDate(new Date(ms), 'dated'); }
  expect(spy.mock.calls.length).toBeLessThanOrEqual(2);   // 0 when an earlier test built them, never one per call
});

test('the drawn-frame readout formatters are unchanged in words', () => {
  for (const ms of SAMPLES.slice(0, 60)) {
    expect(formatInstant(ms)).toBe(new Date(ms).toLocaleString('en-US', OPTS.hour));
    expect(formatInstant(ms, true)).toBe(new Date(ms).toLocaleString('en-US', OPTS.dated));
  }
  const d = new Date(T0 + 5 * 3600000); d.setMinutes(0, 0, 0);
  expect(formatForecastHour(5, T0)).toBe(d.toLocaleString('en-US', OPTS.hour));
  expect(formatInstant(NaN)).toBe('');
});

test('kill: toLocaleString per call, same words', () => {
  window.__RAW_DISABLE_READOUT_FORMAT_CACHE__ = true;
  const spy = jest.spyOn(Date.prototype, 'toLocaleString');
  const out = formatReadoutDate(new Date(T0), 'dated');
  expect(spy).toHaveBeenCalledWith('en-US', OPTS.dated);
  delete window.__RAW_DISABLE_READOUT_FORMAT_CACHE__;
  expect(formatReadoutDate(new Date(T0), 'dated')).toBe(out);
});

test('an unknown kind falls back to the hour words', () => {
  expect(formatReadoutDate(new Date(T0), 'nope')).toBe(new Date(T0).toLocaleString('en-US', OPTS.hour));
});
