import { compileForecastCards } from '../components/map/forecastCardCompiler';

// ⚠ THE OFFSHORE CARD IS NAMED `Swell`, NOT `Height` (renamed 5ae2d267, 2026-07-31): the box used to
// lead with an unnamed OFFSHORE height while the BREAKING height sat beside it, so the label WAS the
// defect — `Surf` now leads and the offshore value is explicitly `Swell`. These assertions look up
// the card by label, so they broke on the rename; the VALUES are unchanged (verified by probing the
// compiler with these exact props before editing: "Loading..." / "4.9 ft" / provisional flags all
// identical). Do not "fix" a failure here by reverting to 'Height' — two heights share units on this
// card, and the label is the entire correctness surface.
//
// Locks the card contract that the MapForecastOverlay parity gate depends on:
// when there is no authoritative source for the requested {model,layer,hour} during a
// transient exact-point wait, the overlay nulls the marine height so the card shows
// "Loading…" — it must NEVER relabel a forecast/grid value as the selected target.

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
  degToCompass: () => 'N',
  getClampedValue: () => null,
  getBiasAdjustedLocal: (v) => v,
  isLoading: false,
};

test('null marine height during exact-loading renders Loading…, not a stale value', () => {
  const cards = compileForecastCards({
    ...baseProps,
    activeLayer: 'waves',
    waveHeight: null,        // overlay nulled it because parity failed (isMarineUpdatingNoParity)
    wavePeriod: null,
    waveDir: null,
  });
  const height = cards.find((c) => c.label === 'Swell');
  expect(height).toBeDefined();
  expect(height.value).toBe('Loading...');
  // crucially, it is NOT a relabeled forecast value like "4.2 ft"
  expect(height.value).not.toMatch(/ft/);
});

test('a non-null marine height renders the value (parity held / authoritative source present)', () => {
  const cards = compileForecastCards({
    ...baseProps,
    isExactPointLoading: false,
    exactPointStatus: 'exact_success',
    activeLayer: 'waves',
    waveHeight: 1.5,         // authoritative value present
    wavePeriod: 8,
    waveDir: 90,
  });
  const height = cards.find((c) => c.label === 'Swell');
  expect(height.value).toMatch(/ft/);
  expect(height.value).not.toBe('Loading...');
});
