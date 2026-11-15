import { tideSourceFooter, TIDE_FOOTER, tideAt } from './tideReadoutFormat';
import { getGlyphTide, ensureGlyphTide } from './glyphTide';
import { clearPointTideCache } from './usePointTide';

// TIDE_HARMONIC (2026-11-15): every surface names the tide's source in TEXT, and the glyph card's fallback reads the
// same /point-tide payload and evaluator as the infobox (no browser-direct Open-Meteo, no second tide).
const NOW = Date.parse('2026-11-15T12:00:00Z');
const series = Array.from({ length: 48 }, (_, i) => ({ t: new Date(NOW + (i - 6) * 3600e3).toISOString().replace('.000Z', 'Z'), h: Math.sin(i / 2) / 2 }));
const NOAA = { available: true, series, events: [], coverage: [{ start: series[0].t, end: series[47].t }],
  tide_source: 'noaa_coops_harmonic', station: { id: '1612340', name: 'Honolulu', distance_km: 3.4 } };

afterEach(() => { clearPointTideCache(); delete global.fetch; });

test('the footer names a NOAA station, or the model', () => {
  expect(tideSourceFooter(NOAA)).toBe('NOAA tide prediction · Honolulu (3 km) · MSL');
  expect(tideSourceFooter(tideAt(NOAA, NOW))).toBe('NOAA tide prediction · Honolulu (3 km) · MSL');   // survives tideAt
  expect(tideSourceFooter({ ...NOAA, tide_source: 'model_local_msl' })).toBe(TIDE_FOOTER);
  expect(tideSourceFooter(null)).toBe(TIDE_FOOTER);
});

test('the glyph fallback reads /point-tide and evaluates with tideAt, the infobox path', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(NOAA) }));
  expect(getGlyphTide(21.31, -157.87, NOW)).toBeUndefined();
  await ensureGlyphTide(21.31, -157.87);
  expect(String(global.fetch.mock.calls[0][0])).toMatch(/\/api\/weather\/point-tide\?lat=21\.3&lng=-157\.9$/);
  expect(global.fetch.mock.calls.some(([u]) => String(u).includes('open-meteo'))).toBe(false);
  const got = getGlyphTide(21.31, -157.87, NOW);
  const want = tideAt(NOAA, NOW);
  expect(got.height_m).toBe(want.height_m);
  expect(got.trend).toBe(want.trend);
});
