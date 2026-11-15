import { toLocalDatum, tideStateFromSeries } from './tideClient';

// The glyph card's browser-direct tide fallback must sit on the same LOCAL mean sea level as the backend
// (tide.to_local_datum, TIDE_LOCAL_DATUM): minus the mean of the first 72 finite hours when >= 48 exist.
const OFFSET = 0.54;
const LEVELS = Array.from({ length: 72 }, (_, h) => OFFSET + 0.4 * Math.sin((2 * Math.PI * h) / 12.42));

beforeEach(() => { window.__RAW_ENABLE_TIDE_LOCAL_DATUM__ = true; });
afterEach(() => { delete window.__RAW_DISABLE_TIDE_LOCAL_DATUM__; delete window.__RAW_ENABLE_TIDE_LOCAL_DATUM__; });

test('held off by default like the backend flag (worse than raw vs observed water, US West Coast)', () => {
  delete window.__RAW_ENABLE_TIDE_LOCAL_DATUM__;
  expect(toLocalDatum(LEVELS)).toBe(LEVELS);
});

test('levels become relative to their own 72 h mean; gaps stay gaps', () => {
  const withGap = LEVELS.slice(); withGap[10] = null;
  const out = toLocalDatum(withGap);
  const finite = withGap.filter((v) => v != null);
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  expect(mean).toBeCloseTo(OFFSET, 1);
  expect(out[10]).toBeNull();
  expect(out[0]).toBeCloseTo(withGap[0] - mean, 6);
  expect(withGap[0]).toBeCloseTo(OFFSET, 6);   // input not mutated
});

test('fewer than 48 hours: the model level is kept', () => {
  const short = LEVELS.slice(0, 40);
  expect(toLocalDatum(short)).toEqual(short);
});

test('trend is unchanged, height shifts by the offset', () => {
  const times = LEVELS.map((_, h) => new Date(Date.UTC(2026, 10, 15, h)).toISOString().slice(0, 16));
  const at = Date.UTC(2026, 10, 15, 3);
  const a = tideStateFromSeries(times, LEVELS, at);
  const b = tideStateFromSeries(times, toLocalDatum(LEVELS), at);
  expect(b.trend).toBe(a.trend);
  expect(a.height_m - b.height_m).toBeCloseTo(OFFSET, 1);
});

test('kill switch __RAW_DISABLE_TIDE_LOCAL_DATUM__ serves the model level', () => {
  window.__RAW_DISABLE_TIDE_LOCAL_DATUM__ = true;
  expect(toLocalDatum(LEVELS)).toBe(LEVELS);
});
