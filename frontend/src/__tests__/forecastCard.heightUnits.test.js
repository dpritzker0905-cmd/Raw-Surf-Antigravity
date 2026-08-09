import { compileForecastCards } from '../components/map/forecastCardCompiler';
import { spotGlyphAriaLabel } from '../components/map/MapMarkerLayers';
import { mToFt } from '../components/map/forecastHelpers';
import { M_TO_FT, formatHeightFromMeters } from '../components/map/heightUnits';

// R11-11 item 6 (2026-08-09): "the ft/m toggle reaches legends and marker tooltips but NOT the
// infobox cards (which also carry a second, drifted conversion constant)".
//
// ⚠️ WHY THIS FILE EXISTS AT ALL, AND WHY IT DOES NOT INJECT A CONVERTER.
// The drift survived because every other card test passes its OWN `mToFt` at 3.28084, so the suite
// graded a converter it wrote rather than the one that shipped (production's 3.281 was exercised
// only at m=1 and m=3, where both constants print the same string). A formatter that arrives as a
// prop is a formatter the suite can replace. These tests therefore assert on the REAL formatter and
// the REAL constant, and pass only `heightUnit` — which is state, not behaviour.

const baseProps = {
  activeModel: 'GFS',
  activeLayer: 'waves',
  timeOffsetHours: 0,
  isLive: false,
  currentHourIndex: 0,
  marineHourIndex: 0,
  wx: {},
  marine: {},
  currentWeather: {},
  isExactPointAuthority: true,
  isExactPointLoading: false,
  isExactPointTimeout: false,
  isExactPointError: false,
  exactPointStatus: 'exact_ok',
  useExactPoint: null,
  swell1Supported: true,
  swell2Supported: true,
  windWavesSupported: true,
  swell2ModelUnavailable: false,
  // Deliberately WRONG, and deliberately still passed: it is the prop the old code used for every
  // height. If a future edit re-introduces the injected converter, these assertions go red.
  mToFt: () => '999.9',
  degToCompass: () => 'N',
  getClampedValue: () => null,
  getBiasAdjustedLocal: (v) => v,
  isLoading: false,
};

const swell = (cards) => cards.find((c) => c.label === 'Swell');

describe('the infobox cards follow the ft/m toggle', () => {
  test('feet by default — the pre-2026-08-09 behaviour is preserved when nothing is threaded', () => {
    const cards = compileForecastCards({ ...baseProps, waveHeight: 1.2, wavePeriod: 11 });
    expect(swell(cards).value).toBe('3.9 ft');
  });

  test('metres when the user has chosen metres — the defect this closes', () => {
    const cards = compileForecastCards({
      ...baseProps, heightUnit: 'm', waveHeight: 1.2, wavePeriod: 11,
    });
    expect(swell(cards).value).toBe('1.2 m');
  });

  test('every marine layer follows it, not just the one someone remembered', () => {
    // The four heights were four separate call sites; a fix that threads one is the R11-11 class
    // of defect all over again (a disclosure reaching some surfaces and not the sibling).
    for (const [layer, prop] of [['waves', 'waveHeight'], ['swell_1', 'swell1Height'],
                                 ['swell_2', 'swell2Height'], ['wind_waves', 'windWaveHeight']]) {
      const cards = compileForecastCards({
        ...baseProps, activeLayer: layer, heightUnit: 'm',
        [prop]: 1.5, wavePeriod: 11, swell1Period: 11, swell2Period: 11, windWavePeriod: 11,
      });
      const found = cards.find((c) => /ft|m$|m /.test(String(c.value)) && /1\.5 m|4\.9 ft/.test(String(c.value)));
      expect(String(found && found.value)).toContain('1.5 m');
    }
  });

  test('the injected converter can no longer reach a height (the structural half of the fix)', () => {
    // baseProps.mToFt returns '999.9'. If any height still routes through the prop, it shows up.
    const cards = compileForecastCards({ ...baseProps, waveHeight: 1.2, wavePeriod: 11 });
    for (const c of cards) expect(String(c.value)).not.toContain('999.9');
  });

  test('no-data still prints the -- sentinel, not the formatter em-dash', () => {
    // formatHeightFromMeters returns '—' for null; the cards' own no-data branch prints '--'.
    // Swapping one for the other silently changes the visible no-data glyph.
    const cards = compileForecastCards({
      ...baseProps, isExactPointError: true, exactPointStatus: 'exact_empty',
      waveHeight: null, wavePeriod: null,
    });
    expect(String(swell(cards).value)).not.toContain('—');
  });
});

describe('the accessible name follows it too', () => {
  test('the Surf card aria-label cannot say "feet" beside a card reading metres', () => {
    const cards = compileForecastCards({
      ...baseProps, heightUnit: 'm',
      useExactPoint: { surf_height_m: 1.4, surf_regime: 'beach_break', surf_nearshore: true },
      waveHeight: 2.0, wavePeriod: 12,
    });
    const surf = cards.find((c) => c.label === 'Surf');
    if (surf) {                       // the row is geography-gated; assert only when it rendered
      expect(surf.value).toContain('m');
      expect(surf.ariaLabel).toContain('meters');
      expect(surf.ariaLabel).not.toContain('feet');
    }
  });

  test('the spot-glyph accessible name follows the toggle (it carried a THIRD constant copy)', () => {
    const cluster = { name: 'Sebastian Inlet' };
    const rating = { label: 'Fair', surfHeightM: 1.0, periodS: 12 };
    expect(spotGlyphAriaLabel(cluster, rating, null, 'ft')).toContain('3.3 ft');
    expect(spotGlyphAriaLabel(cluster, rating, null, 'm')).toContain('1 m');
    // Unthreaded callers keep feet — no silent unit switch for a surface not yet updated.
    expect(spotGlyphAriaLabel(cluster, rating, null)).toContain('3.3 ft');
  });
});

describe('the drifted constant is retired', () => {
  test('the diagnostics converter now uses the canonical M_TO_FT, not a local copy', () => {
    // 3.281 vs 3.28084 differ by ~1 part in 20,500 — invisible at m=1 and m=3 (the only values the
    // old suite probed), so this asserts at a magnitude where the two constants disagree.
    expect(Number(mToFt(1000))).toBeCloseTo(1000 * M_TO_FT, 1);
    expect(Number(mToFt(1000))).not.toBeCloseTo(1000 * 3.281, 1);
  });

  test('one constant, one formatter: the display lane and the diagnostics lane agree', () => {
    for (const m of [0.35, 1.2, 3.7, 9.99, 12.4]) {
      expect(Number(mToFt(m))).toBeCloseTo(Number(formatHeightFromMeters(m, 'ft')), 0);
    }
  });
});
