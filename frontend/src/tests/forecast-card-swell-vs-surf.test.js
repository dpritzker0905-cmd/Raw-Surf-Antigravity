/**
 * #17/#10 — the infobox showed one quantity and graded another.
 *
 * THE DEFECT. The box led with an unlabelled `Height` card carrying the OFFSHORE significant wave
 * height, while the Rating badge beside it graded the NEARSHORE BREAKING height. Two different
 * quantities, same units, nothing marking the difference — so a reader compares our number against
 * Windy, sees it match, and concludes the rating is broken. Windy shows offshore too.
 *
 * MEASURED LIVE 2026-07-31, offshore -> breaking at the same coordinate and hour:
 *
 *   shoaling   Sebastian 2.25x   Satellite 1.67   Cocoa 1.64   Trestles 1.57   Uluwatu 1.49
 *              Hossegor 1.48     NewSmyrna 1.42   Mavericks 1.38   Ocean Beach 1.33
 *   shelf      Bells 0.86        Jeffreys Bay 0.84   Pipeline 0.83
 *
 * SIGNED BOTH WAYS, and the REGIME predicts the sign — so no constant reconciles them and only
 * showing both, each NAMED, can. Every ratio below is one of those measurements.
 */
import { compileForecastCards } from '../components/map/forecastCardCompiler';

const M_TO_FT = 3.28084;
const mToFt = (m) => (m == null ? null : Math.round(m * M_TO_FT * 10) / 10);
const degToCompass = () => 'E';

function build(overrides = {}) {
  const { exact = {}, ...rest } = overrides;
  return compileForecastCards({
    activeLayer: 'waves',
    activeModel: 'GFS',
    isLoading: false,
    isExactPointAuthority: true,
    mToFt,
    degToCompass,
    waveHeight: 0.317,          // Cocoa offshore, metres (1.04 ft)
    wavePeriod: 8.7,
    waveDir: 96,
    useExactPoint: {
      wave_height: 0.317,
      surf_height_m: 0.521,     // Cocoa breaking (1.71 ft) -> ratio 1.64
      surf_regime: 'shoaling',
      surf_nearshore: true,
      ...exact,
    },
    ...rest,
  });
}

const labels = (cards) => cards.map((c) => c.label);
const byLabel = (cards, label) => cards.find((c) => c.label === label);

describe('the infobox names its quantities', () => {
  test('the offshore card is NAMED "Swell" and never the bare word "Height"', () => {
    const cards = build();
    expect(labels(cards)).toContain('Swell');
    // 'Height' alone reads as THE answer. That ambiguity is the entire defect.
    expect(labels(cards)).not.toContain('Height');
  });

  test('both quantities are present, and they are different numbers', () => {
    const cards = build();
    const swell = byLabel(cards, 'Swell');
    const surf = byLabel(cards, 'Surf');
    expect(swell).toBeTruthy();
    expect(surf).toBeTruthy();
    expect(swell.value).not.toBe(surf.value);
    expect(swell.value).toContain('1');      // 1.0 ft offshore
    expect(surf.value).toContain('1.7');     // 1.7 ft breaking
  });

  test('SURF leads, because it is what the Rating badge grades and what a surfer rides', () => {
    const cards = build();
    const l = labels(cards);
    expect(l.indexOf('Surf')).toBeLessThan(l.indexOf('Swell'));
  });

  test('the surf value keeps its (est.) marker, distinct from the model value', () => {
    expect(byLabel(build(), 'Surf').value).toMatch(/\(est\.\)/);
  });
});

describe('the measured spots, both directions of the error', () => {
  // shoaling -> breaking LARGER than offshore
  test.each([
    ['Sebastian', 0.244, 0.549, 'shoaling'],
    ['Cocoa', 0.317, 0.521, 'shoaling'],
    ['Mavericks', 1.530, 2.115, 'shoaling'],
    ['Trestles', 0.920, 1.445, 'shoaling'],
  ])('%s: breaking is LARGER, so the two cards must not be confusable', (_n, off, surf, reg) => {
    const cards = build({ waveHeight: off, exact: { surf_height_m: surf, surf_regime: reg } });
    const s = byLabel(cards, 'Swell');
    const f = byLabel(cards, 'Surf');
    expect(parseFloat(f.value)).toBeGreaterThan(parseFloat(s.value));
  });

  // shelf -> breaking SMALLER than offshore. A single label cannot describe both directions.
  test.each([
    ['Pipeline', 1.661, 1.375, 'shelf'],
    ['Bells', 1.183, 1.021, 'shelf'],
    ['Jeffreys Bay', 2.079, 1.747, 'shelf'],
  ])('%s: breaking is SMALLER — the sign flips, so no constant could reconcile them', (_n, off, surf, reg) => {
    const cards = build({ waveHeight: off, exact: { surf_height_m: surf, surf_regime: reg } });
    const s = byLabel(cards, 'Swell');
    const f = byLabel(cards, 'Surf');
    expect(parseFloat(f.value)).toBeLessThan(parseFloat(s.value));
  });
});

describe('when the Surf row is suppressed, the label is the only thing keeping it honest', () => {
  test.each(['open_ocean', 'calm', 'unknown'])('regime %s hides Surf but Swell stays NAMED', (reg) => {
    const cards = build({ exact: { surf_regime: reg } });
    expect(labels(cards)).not.toContain('Surf');
    expect(labels(cards)).toContain('Swell');
  });

  test('surf_nearshore false hides Surf, Swell still named', () => {
    const cards = build({ exact: { surf_nearshore: false } });
    expect(labels(cards)).not.toContain('Surf');
    expect(labels(cards)).toContain('Swell');
  });

  test('null surf_nearshore keeps the legacy regime-only behaviour (stale caches)', () => {
    const cards = build({ exact: { surf_nearshore: null } });
    expect(labels(cards)).toContain('Surf');
  });

  test('a missing surf_height_m hides Surf without breaking the box', () => {
    const cards = build({ exact: { surf_height_m: null } });
    expect(labels(cards)).not.toContain('Surf');
    expect(labels(cards)).toContain('Swell');
  });
});

describe('accessibility: the two quantities must survive being read aloud', () => {
  test('both cards carry an aria-label naming the quantity in full', () => {
    const cards = build();
    expect(byLabel(cards, 'Swell').ariaLabel).toMatch(/offshore swell height/i);
    expect(byLabel(cards, 'Surf').ariaLabel).toMatch(/breaking surf height/i);
  });

  test('the aria-labels are distinguishable — same units, different quantities', () => {
    const cards = build();
    expect(byLabel(cards, 'Swell').ariaLabel).not.toBe(byLabel(cards, 'Surf').ariaLabel);
  });
});
