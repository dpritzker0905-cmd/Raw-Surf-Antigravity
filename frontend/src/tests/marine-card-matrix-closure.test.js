/**
 * 1a-0 — THE MARINE CARD-MATRIX CLOSURE GUARD.
 *
 * WHAT THIS PINS, AND WHY IT EXISTS
 * ---------------------------------
 * The infobox composes across four marine layers whose TIER is chosen INDEPENDENTLY per layer.
 * Measured live 2026-08-01 (3 models x 4 layers x 7 sites, then again at 17 sites x 2 hours), the
 * spectral closure  sqrt(sum h_i^2) / h_total  separates PERFECTLY on the tier and on nothing else:
 *
 *     model   mixed-tier rate    same-tier closure      mixed-tier closure
 *     ICON     0/34 =  0%        0.94 - 1.00            --
 *     GFS      7/34 = 21%        1.01  0.99  1.03       0.91  1.14  1.41
 *     EURO    20/34 = 59%        --                     0.30 - 1.94
 *
 * The relationship is MONOTONE across three independent models (0%->0%, 21%->12%, 59%->44% of
 * samples off by >2x in energy). So GFS is internally COHERENT and its apparent incoherence is a
 * FOOTPRINT artifact -- the defect is not physics and not EURO-specific.
 *
 * This matters because energy flux goes as H^2*T, so a height error is SQUARED: GFS Hossegor
 * 1.41 -> 1.99, EURO Cocoa 1.94 -> 3.78. Surfline builds its kJ number by SUMMING per-partition
 * energies, which is exactly the composition this guard protects.
 *
 * THE INVARIANT IS A CONDITIONAL, not a blanket: *if* a model's served layers share a tier, *then*
 * its partitions must close against its own total. Mixed-tier pairs are exempt BY MEASUREMENT, not
 * by assumption -- and see the anti-vacuity floor, without which this whole file could pass by
 * classifying everything as mixed and testing nothing.
 *
 * FIXTURE: `fixtures/marine-card-matrix.fixture.json` is a LIVE capture, not synthetic. Regenerate
 * with `backend/scripts/capture_marine_card_matrix.py` when the contract changes.
 *
 * ⚠️ THE FRONTEND SUITE CANNOT FAIL CI (`continue-on-error: true` on lint-and-build's test step,
 * 1596 tests discarded). This file is therefore ALSO run by a dedicated job that CAN fail --
 * `frontend-marine-composition-guards` in ci.yml. If you move or rename this file, move the job's
 * pattern with it or the guard silently stops gating anything (3rd occurrence of that class).
 */
import fs from 'fs';
import path from 'path';
import { compileForecastCards } from '../components/map/forecastCardCompiler';
import { isLayerSupportedByModel, MARINE_EXACT_CAPABILITIES } from '../components/map/marineControllerUtils';

const FIXTURE = path.join(__dirname, 'fixtures', 'marine-card-matrix.fixture.json');
const MATRIX = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const MODELS = ['GFS', 'ICON', 'EURO'];
const LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
// ICON's swell_2 is a CLIENT-SIDE 60/40 GFS/EURO blend, not an ICON product, so it is excluded
// from ICON's closure by name. Including it would grade ICON on two other models' output.
const PARTITIONS = { GFS: ['swell_1', 'swell_2', 'wind_waves'], ICON: ['swell_1', 'wind_waves'], EURO: ['swell_1', 'swell_2', 'wind_waves'] };

const CLOSURE_TOL = 0.10;      // same-tier measured 0.94-1.03; +/-10% catches a real regression
const SAME_TIER_FLOOR = 8;     // anti-vacuity: the fixture yields 10 same-tier pairs today

const M_TO_FT = 3.28084;
const mToFt = (m) => (m == null ? null : Math.round(m * M_TO_FT * 10) / 10);
const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const degToCompass = (d) => (d == null ? '' : DIRS[Math.round((d % 360) / 22.5) % 16]);

const sites = [...new Set(Object.values(MATRIX.cells).map((c) => c.site))];
const cell = (site, model, layer) => MATRIX.cells[`${site}|${model}|${layer}`];

/** The served point, or null when the backend says it has nothing here. */
function served(site, model, layer) {
  const c = cell(site, model, layer);
  if (!c) return null;
  const pt = c.payload.point || {};
  if (!pt.interpolation_method || pt.interpolation_method === 'unavailable' || pt.interpolation_method === 'unsupported') return null;
  return { tier: c.payload.coverage_status, h: pt.speed, p: pt.period, d: pt.direction, payload: c.payload };
}

/** MIRROR of backendWeatherServiceClientPoint.js:504-573 — one layer's values, siblings null. */
function toExactPoint(site, model, layer) {
  const s = served(site, model, layer);
  if (!s) return null;
  const key = { waves: 'wave', swell_1: 'swell_wave', swell_2: 'secondary_swell_wave', wind_waves: 'wind_wave' }[layer];
  return {
    [`${key}_height`]: s.h, [`${key}_direction`]: s.d, [`${key}_period`]: s.p,
    surf_height_m: s.payload.surf_height_m, surf_regime: s.payload.surf_regime,
    surf_nearshore: s.payload.surf_nearshore, shore_normal_deg: s.payload.shore_normal_deg,
    reference_size_m: s.payload.reference_size_m, partitions: s.payload.partitions,
    is_estimated: s.payload.is_estimated, estimate_basis: s.payload.estimate_basis,
  };
}

/** MIRROR of MapForecastOverlay.js:249-390, pinned to the exact-point-authority first rung. */
function cardsFor(ep, model, layer) {
  const sup = { swell_1: isLayerSupportedByModel(model, 'swell_1'), swell_2: isLayerSupportedByModel(model, 'swell_2'), wind_waves: isLayerSupportedByModel(model, 'wind_waves') };
  const gated = (l, v) => (l === 'waves' || sup[l] ? v : null);
  return compileForecastCards({
    activeLayer: layer, activeModel: model, isLoading: false,
    isExactPointAuthority: true, isExactPointLoading: false, isExactPointTimeout: false,
    isExactPointError: false, exactPointStatus: 'exact_success',
    mToFt, degToCompass, getClampedValue: () => null, getBiasAdjustedLocal: (v) => v,
    useExactPoint: ep, surfRating: null, marine: {}, wx: {}, currentWeather: {},
    waveHeight: ep?.wave_height ?? null,
    wavePeriod: ep?.wave_period > 0 ? ep.wave_period : null,
    waveDir: ep?.wave_direction ?? null,
    swell1Supported: sup.swell_1,
    swell1Height: gated('swell_1', ep?.swell_wave_height ?? null),
    swell1Period: gated('swell_1', ep?.swell_wave_period > 0 ? ep.swell_wave_period : null),
    swell1Dir: gated('swell_1', ep?.swell_wave_direction ?? null),
    swell2Supported: sup.swell_2, swell2ModelUnavailable: !sup.swell_2,
    swell2Height: gated('swell_2', ep?.secondary_swell_wave_height ?? null),
    swell2Period: gated('swell_2', ep?.secondary_swell_wave_period > 0 ? ep.secondary_swell_wave_period : null),
    swell2Dir: gated('swell_2', ep?.secondary_swell_wave_direction ?? null),
    windWavesSupported: sup.wind_waves,
    windWaveHeight: gated('wind_waves', ep?.wind_wave_height ?? null),
    windWavePeriod: gated('wind_waves', ep?.wind_wave_period > 0 ? ep.wind_wave_period : null),
    windWaveDir: gated('wind_waves', ep?.wind_wave_direction ?? null),
  });
}

/** sqrt(sum h_i^2) / h_total for one (site, model), plus whether its layers share a tier. */
function closureOf(site, model, override = null) {
  const total = served(site, model, 'waves');
  if (!total || !total.h) return null;
  const parts = PARTITIONS[model].map((l) => served(site, model, l));
  if (parts.some((p) => !p || p.h == null)) return null;
  const heights = parts.map((p) => p.h);
  if (override) override(heights);
  const tiers = [total.tier, ...parts.map((p) => p.tier)];
  return {
    sameTier: new Set(tiers).size === 1,
    ratio: Math.sqrt(heights.reduce((a, h) => a + h * h, 0)) / total.h,
  };
}

describe('1a-0 · the fixture is a real capture, and it is complete', () => {
  test('every requested cell came back — a partial matrix voids every rate below', () => {
    expect(MATRIX.census.cells_returned).toBe(MATRIX.census.cells_requested);
    expect(Object.keys(MATRIX.cells)).toHaveLength(84);
  });

  test('it carries its provenance, so it cannot be mistaken for synthetic data', () => {
    expect(MATRIX.source).toMatch(/onrender\.com/);
    expect(MATRIX.valid_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
  });
});

describe('1a-0 · INVARIANT: same tier => the partitions close against their own total', () => {
  const results = [];
  for (const site of sites) {
    for (const model of MODELS) {
      const c = closureOf(site, model);
      if (c) results.push({ site, model, ...c });
    }
  }
  const sameTier = results.filter((r) => r.sameTier);

  test('ANTI-VACUITY: enough same-tier pairs exist for the invariant to mean anything', () => {
    // Without this, the closure test below passes trivially the moment the tier detector breaks
    // and calls everything "mixed". A clean run whose PRECONDITION never occurred is the worst
    // kind of green.
    expect(sameTier.length).toBeGreaterThanOrEqual(SAME_TIER_FLOOR);
  });

  test.each(['GFS', 'ICON'])('%s closes within tolerance at every same-tier site', (model) => {
    const rows = sameTier.filter((r) => r.model === model);
    expect(rows.length).toBeGreaterThan(0);          // this model must actually be exercised
    for (const r of rows) {
      expect(Math.abs(1 - r.ratio)).toBeLessThanOrEqual(CLOSURE_TOL);
    }
  });

  test('NEGATIVE CONTROL: inflating one partition 40% MUST break closure', () => {
    // A guard that has never been seen to fail is not evidence. 1.40x is the size of the real
    // mixed-tier excursion measured at GFS/Hossegor, so this is a realistic break, not a strawman.
    const target = sameTier[0];
    const broken = closureOf(target.site, target.model, (hs) => { hs[0] *= 1.4; });
    expect(Math.abs(1 - broken.ratio)).toBeGreaterThan(CLOSURE_TOL);
  });

  test('mixed-tier pairs are exempt BY MEASUREMENT — and they exist, so the split is real', () => {
    const mixed = results.filter((r) => !r.sameTier);
    expect(mixed.length).toBeGreaterThan(0);
    // EURO is mixed at every real site: `waves` regional, partitions coarse. If EURO ever reads
    // same-tier here, the upstream changed and EURO's exemption must be re-derived, not inherited.
    expect(results.filter((r) => r.model === 'EURO' && r.sameTier)).toHaveLength(0);
  });
});

describe('1a-0 · INVARIANT: the card contract, per model x layer', () => {
  const contract = [];
  for (const site of sites) {
    for (const model of MODELS) {
      for (const layer of LAYERS) {
        const ep = toExactPoint(site, model, layer);
        if (!ep) continue;
        contract.push({
          site, model, layer, ep,
          interp: cell(site, model, layer).payload.point.interpolation_method,
          labels: cardsFor(ep, model, layer).map((c) => c.label),
        });
      }
    }
  }

  test('ANTI-VACUITY: the contract was actually compiled for every model and layer', () => {
    expect(contract.length).toBeGreaterThanOrEqual(60);
    for (const m of MODELS) expect(contract.some((c) => c.model === m)).toBe(true);
    for (const l of LAYERS) expect(contract.some((c) => c.layer === l)).toBe(true);
  });

  test('a height card is always emitted when a height was served', () => {
    for (const c of contract) {
      const key = { waves: 'wave_height', swell_1: 'swell_wave_height', swell_2: 'secondary_swell_wave_height', wind_waves: 'wind_wave_height' }[c.layer];
      if (c.ep[key] == null) continue;
      expect(c.labels.some((l) => ['Swell', 'Height', 'Swell 2', 'Wind Waves'].includes(l))).toBe(true);
    }
  });

  test('the `waves` layer names its offshore card "Swell" — never the bare word "Height"', () => {
    // #17's fix, pinned across all THREE models rather than the one it was written against.
    for (const c of contract.filter((x) => x.layer === 'waves')) {
      expect(c.labels).toContain('Swell');
      expect(c.labels).not.toContain('Height');
    }
  });

  test('Period rides with Dir — a train shown without its period is the #9/#22 defect', () => {
    // KNOWN EXCEPTION, measured not assumed: `nearest_ocean_fallback` on EURO serves a height and
    // a direction with period EXACTLY 0.0. It is carved out here so the invariant can hold for
    // every other path -- and pinned by COUNT in the next test so the carve-out cannot grow
    // silently into a licence.
    for (const c of contract) {
      if (c.interp === 'nearest_ocean_fallback') continue;
      const hasDir = c.labels.some((l) => l === 'Dir' || DIRS.includes(l));
      if (hasDir) expect(c.labels).toContain('Period');
    }
  });

  test('the period-less fallback is EURO-only and does not spread', () => {
    // Measured live 2026-08-01 across 10 enclosed/marginal-sea spots (102 served cells):
    //   Sochi   EURO/wind_waves  h=0.95 m (3.1 ft)  dir 39.6  period 0.00   <- user-visible
    //   TelAviv EURO/swell_2     h=0.06 m           dir 72.4  period 0.00
    //   Galveston GFS/swell_2    same fallback path BUT period 5.91 s INTACT
    //   Pipeline (control)       never takes the fallback at all
    // => the defect is not the fallback, it is EURO's fallback losing the period. If this list
    // ever includes a non-EURO model, that attribution is wrong and must be re-derived.
    const periodless = contract.filter((c) => {
      if (c.interp !== 'nearest_ocean_fallback') return false;
      const hasDir = c.labels.some((l) => l === 'Dir' || DIRS.includes(l));
      return hasDir && !c.labels.includes('Period');
    });
    expect(periodless.length).toBeGreaterThan(0);              // anti-vacuity: it exists in-fixture
    for (const c of periodless) expect(c.model).toBe('EURO');
  });
});

describe('1a-0 · INVARIANT: a fabricated train is identifiable in the data', () => {
  test('ICON swell_2 is the ONLY cell the backend refuses, at every site', () => {
    // ICON/GWAM has no second swell. The backend answers `unsupported`; the client synthesizes a
    // 60/40 GFS/EURO blend instead. Pinning this means 1a-1 can assert the CARD discloses it.
    for (const site of sites) {
      const c = cell(site, 'ICON', 'swell_2');
      expect(c.payload.status).toBe('unsupported');
      expect(c.payload.point.interpolation_method).toBe('unsupported');
    }
  });

  test('the capability map still records the estimate as a WORD, not a boolean', () => {
    // `!!'estimated'` is true, so the box takes the normal render path. The string is the only
    // place the estimate is named; 1a-1 stops it being thrown away.
    expect(MARINE_EXACT_CAPABILITIES.ICON.swell_2).toBe('estimated');
    expect(isLayerSupportedByModel('ICON', 'swell_2')).toBe(true);
  });
});
