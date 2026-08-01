import { compileForecastCards } from '../components/map/forecastCardCompiler';

// ⚠ The offshore card is named `Swell`, NOT `Height` (renamed 5ae2d267, 2026-07-31 — `Surf` now leads
// and the offshore value is explicitly named). These lookups are by label, so they broke on the
// rename; every asserted VALUE and provisional flag is unchanged (probed before editing). See the
// note in forecastCard.parity.test.js.
//
// Locks the TWO-PHASE PROVISIONAL MARKER contract (2026-07-05 item ③, predicate fixed 2026-07-17):
// while the authoritative exact-point fetch is in flight for a user-selected marine point
// (isExactPointAuthority && isExactPointLoading), useExactPoint is null (validity status gate), so
// every painted value is grid/forecast-sourced. Those values MUST carry the trailing '…' marker and
// provisional:true so the later change to the exact-point set reads as expected refinement — the
// original predicate (`!isExactPointAuthority && …`) inverted the authority flag and never rendered
// the marker on this path (the user-reported "shows quick data, then changes" confusion).

const baseProps = {
  activeModel: 'GFS',
  timeOffsetHours: 0,
  isLive: false,
  currentHourIndex: 0,
  marineHourIndex: 0,
  wx: {},
  marine: {},
  currentWeather: {},
  isExactPointAuthority: true,
  isExactPointLoading: true,
  isExactPointTimeout: false,
  isExactPointError: false,
  exactPointStatus: 'exact_loading',
  useExactPoint: null,
  swell1Supported: true,
  swell2Supported: true,
  windWavesSupported: true,
  swell2ModelUnavailable: false,
  mToFt: (m) => (m == null ? null : Math.round(m * 3.28084 * 10) / 10),
  degToCompass: () => 'SW',
  getClampedValue: () => null,
  getBiasAdjustedLocal: (v) => v,
  isLoading: false,
};

const provisionalWaves = {
  ...baseProps,
  activeLayer: 'waves',
  waveHeight: 1.2, // grid-sampled first paint (useExactPoint is null while loading)
  wavePeriod: 9.0,
  waveDir: 200,
};

afterEach(() => {
  delete window.__RAW_INFOBOX_PROVISIONAL_MARK_DISABLED__;
});

test('provisional first paint (authority + loading + grid value) carries the … marker and provisional flag', () => {
  const cards = compileForecastCards(provisionalWaves);
  const height = cards.find((c) => c.label === 'Swell');
  const period = cards.find((c) => c.label === 'Period');
  expect(height.value).toBe('3.9 ft…');
  expect(height.provisional).toBe(true);
  expect(period.value).toBe('9.0s…');
  expect(period.provisional).toBe(true);
  const dir = cards.find((c) => c.label === 'SW');
  expect(dir.value).toBe('200…');
  expect(dir.provisional).toBe(true);
});

test('provisional phase shows the plain-language Source card', () => {
  const cards = compileForecastCards(provisionalWaves);
  const source = cards.find((c) => c.label === 'Source');
  expect(source).toBeDefined();
  expect(source.value).toBe('Map estimate — refining…');
});

test('authoritative phase (exact landed) renders unmarked values and no refining Source card', () => {
  const cards = compileForecastCards({
    ...provisionalWaves,
    isExactPointLoading: false,
    exactPointStatus: 'exact_success',
    useExactPoint: { wave_height: 0.8, wave_period: 12.3, wave_direction: 220 },
    waveHeight: 0.8,
    wavePeriod: 12.3,
    waveDir: 220,
  });
  const height = cards.find((c) => c.label === 'Swell');
  expect(height.value).toBe('2.6 ft');
  expect(height.provisional).toBeFalsy();
  expect(cards.find((c) => c.label === 'Source')).toBeUndefined();
});

test('grid-only view (no exact authority, no fetch) stays unmarked', () => {
  const cards = compileForecastCards({
    ...provisionalWaves,
    isExactPointAuthority: false,
    isExactPointLoading: false,
    exactPointStatus: 'none',
  });
  const height = cards.find((c) => c.label === 'Swell');
  expect(height.value).toBe('3.9 ft');
  expect(height.provisional).toBeFalsy();
});

test('the OLD inverted predicate state (no authority, fetch loading) stays unmarked — polarity lock', () => {
  const cards = compileForecastCards({
    ...provisionalWaves,
    isExactPointAuthority: false,
  });
  const height = cards.find((c) => c.label === 'Swell');
  expect(height.value).toBe('3.9 ft');
  expect(height.provisional).toBeFalsy();
});

test('kill switch __RAW_INFOBOX_PROVISIONAL_MARK_DISABLED__ restores unmarked provisional values', () => {
  window.__RAW_INFOBOX_PROVISIONAL_MARK_DISABLED__ = true;
  const cards = compileForecastCards(provisionalWaves);
  const height = cards.find((c) => c.label === 'Swell');
  expect(height.value).toBe('3.9 ft');
  expect(height.provisional).toBeFalsy();
});

test('swell_1 provisional first paint is marked like waves', () => {
  const cards = compileForecastCards({
    ...baseProps,
    activeLayer: 'swell_1',
    swell1Height: 0.9,
    swell1Period: 11.0,
    swell1Dir: 190,
  });
  // NB: still 'Height' — 5ae2d267 renamed the offshore card to 'Swell' on the `waves` layer ONLY.
  // The swell_1 / wind_waves layers keep the generic 'Height' label (see the separate branch in
  // forecastCardCompiler). Not a typo; do not "align" these without changing the compiler.
  const height = cards.find((c) => c.label === 'Height');
  expect(height.value).toBe('3 ft…');
  expect(height.provisional).toBe(true);
  const period = cards.find((c) => c.label === 'Period');
  expect(period.value).toBe('11.0s…');
});

test('wind_waves provisional first paint is marked like waves', () => {
  const cards = compileForecastCards({
    ...baseProps,
    activeLayer: 'wind_waves',
    windWaveHeight: 0.6,
    windWavePeriod: 5.5,
    windWaveDir: 100,
  });
  const height = cards.find((c) => c.label === 'Height');   // 'Height' on wind_waves — see note above
  expect(height.value).toBe('2 ft…');
  expect(height.provisional).toBe(true);
});

test('wind layer provisional speed/direction are marked', () => {
  const cards = compileForecastCards({
    ...baseProps,
    activeLayer: 'wind',
    windSpeed: 10.4,
    windDir: 225,
  });
  const wind = cards.find((c) => c.label === 'Wind');
  expect(wind.value).toBe('10 kts…');
  expect(wind.provisional).toBe(true);
});
