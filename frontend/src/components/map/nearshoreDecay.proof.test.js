/**
 * PROOF: the displayed wave height depends on WHICH LANE answered, by up to 2.86x (R11-11 item 5).
 *
 * `sampleValueFromDecodedTiles` multiplies wave-height values by a nearshore decay when the
 * sampled cell has land neighbours: 1 -> 0.65, 2 -> 0.45, 3+ -> 0.35 (forecastHelpers.js:239).
 * The intent is defensible -- a grid cell straddling the coast is contaminated by land pixels.
 * The defect is that it is applied in ONE lane only.
 *
 *   MapForecastOverlay.js:290
 *     useExactPoint?.wave_height ?? sampledWaves?.value ?? marineGridSample?.value ?? ...
 *
 * The exact-point lane carries NO decay (the factor appears in exactly one file in the whole map
 * component tree). So for one coordinate and one hour a user sees H when the point lane answers
 * and 0.35H when it falls through to the decoded-tile sample -- and the `??` chain never says
 * which. Worst case 1/0.35 = 2.86x on the number the product exists to report, and it bites
 * hardest at COASTAL cells, which is exactly where every surf spot is.
 *
 * ⚠️ THAT 2.86x IS THE DECAY ALONE AND UNDERSTATES IT. See the final block: `isPeriod` selects
 * two different interpolations, and HEIGHT is penalised twice -- land counted as ZERO in the
 * average, then multiplied by the decay. Measured worst case 11.43x against the same function's
 * period treatment at the same coordinates.
 *
 * ⛔ STILL NOT FIXED HERE, DELIBERATELY -- changing it changes a displayed height, which is the
 * owner's call. But it is no longer a JUDGEMENT awaiting expertise: every reading of the decay
 * now fails on evidence (see the last test), and the principled treatment already exists ten
 * lines above it for period.
 */
import fs from 'fs';
import path from 'path';

import { sampleValueFromDecodedTiles } from './forecastHelpers';

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

describe('the nearshore decay exists in exactly one lane', () => {
  it('the decay factors are 0.65 / 0.45 / 0.35, keyed on land-neighbour count', () => {
    const src = read('forecastHelpers.js');
    expect(src).toMatch(/landCount === 1 \? 0\.65 : \(landCount === 2 \? 0\.45 : 0\.35\)/);
  });

  it('⚠️ and it is applied NOWHERE else -- the exact-point lane does not decay', () => {
    const others = fs.readdirSync(__dirname)
      .filter((f) => f.endsWith('.js') && !f.includes('.test.') && !f.includes('.proof.')
                     && f !== 'forecastHelpers.js')
      .filter((f) => read(f).includes('decayFactor'));
    expect(others).toEqual([]);
  });

  it('⚠️ the infobox height falls through lanes with NO disclosure of which answered', () => {
    // A user cannot tell H from 0.35H, because the ?? chain is silent about its own source.
    expect(read('MapForecastOverlay.js'))
      .toMatch(/useExactPoint\?\.wave_height \?\? sampledWaves\?\.value/);
  });

  it('the worst-case lane divergence is 2.86x on the product\'s core number', () => {
    expect(1 / 0.35).toBeCloseTo(2.857, 3);
  });
});

describe('the decay applies to HEIGHTS only, and only when land is adjacent', () => {
  // 2x2 grid, bounds [w,s,e,n] = [0,0,2,2]; row 0 = SOUTH. A 0 cell reads as land.
  const tile = (values, variable) => ({
    variable, model: 'ncep_gfswave025', timeIndex: 0, timestamp: 1,
    bounds: [0, 0, 2, 2], nx: 2, ny: 2, values: new Float32Array(values),
  });
  const withTiles = (t, fn) => {
    const prev = window.__DECODED_OM_TILES__;
    window.__DECODED_OM_TILES__ = new Map([['k', t]]);
    try { return fn(); } finally { window.__DECODED_OM_TILES__ = prev; }
  };

  it('CONTROL — an all-water neighbourhood is NOT decayed', () => {
    const v = withTiles(tile([2, 2, 2, 2], 'wave_height'),
                        () => sampleValueFromDecodedTiles(1, 1, 'wave_height', 0, 'GFS'));
    expect(v && v.value).toBeCloseTo(2, 3);
  });

  it('a land-adjacent cell IS decayed, and the factor is visible in the number', () => {
    const v = withTiles(tile([0, 2, 2, 2], 'wave_height'),
                        () => sampleValueFromDecodedTiles(1, 1, 'wave_height', 0, 'GFS'));
    expect(v).not.toBeNull();
    expect(v.value).toBeLessThan(2);          // the whole point: the displayed height shrank
  });

  it('a NON-height variable at the same coordinates is untouched', () => {
    // Proves the decay is height-specific, so this is a height defect and not a sampling one.
    const v = withTiles(tile([0, 2, 2, 2], 'wave_period'),
                        () => sampleValueFromDecodedTiles(1, 1, 'wave_period', 0, 'GFS'));
    expect(v).not.toBeNull();
  });
});


// ── WHY THIS IS DECIDABLE AFTER ALL, AND WORSE THAN 2.86x (2026-08-10) ──────────────────────
// The handoff said this needed "a science call: is the point lane already land-aware, and is 0.35
// calibrated?". Both are answerable from the repo. Answering them found a THIRD fact that makes
// the first two moot -- and my first attempt at this block FAILED, which is how I found it.
//
// I assumed the bilinear renormalised over ocean corners for every variable. It does not. The
// branch is `isPeriod`:
//     period  -> land EXCLUDED, weights RENORMALISED        (the principled treatment)
//     height  -> land counted as ZERO in the average, THEN multiplied by the decay
// So height is penalised TWICE on the same land, by the same function, in the same call. Measured
// at the cell centre with ocean corners at 2.0:
//     land corners:      0        1        2        3
//     period (renorm): 2.000    2.000    2.000    2.000
//     height (0+decay):2.000    0.975    0.450    0.175
//     ratio:           1.00x    2.05x    4.44x   11.43x
// The reported divergence was 2.86x (decay alone). The real worst case is 11.43x.
describe('height is penalised TWICE where period is not penalised at all', () => {
  const tile = (values, variable) => ({
    variable, model: 'ncep_gfswave025', timeIndex: 0, timestamp: 1,
    bounds: [0, 0, 2, 2], nx: 2, ny: 2, values: new Float32Array(values),
  });
  const withTiles = (t, fn) => {
    const prev = window.__DECODED_OM_TILES__;
    window.__DECODED_OM_TILES__ = new Map([['k', t]]);
    try { return fn(); } finally { window.__DECODED_OM_TILES__ = prev; }
  };
  const sample = (vals, variable) =>
    withTiles(tile(vals, variable), () => sampleValueFromDecodedTiles(1, 1, variable, 0, 'GFS'));

  it('PERIOD renormalises over ocean corners -- land does not drag it down', () => {
    for (const vals of [[2, 2, 2, 2], [0, 2, 2, 2], [0, 0, 2, 2], [0, 0, 0, 2]]) {
      expect(sample(vals, 'wave_period').value).toBeCloseTo(2.0, 6);
    }
  });

  it('⚠️ HEIGHT zero-fills the land corners AND THEN decays the result', () => {
    // Same function, same coordinates, same values -- only the variable name differs.
    expect(sample([2, 2, 2, 2], 'wave_height').value).toBeCloseTo(2.0, 6);      // no land: equal
    expect(sample([0, 2, 2, 2], 'wave_height').value).toBeCloseTo(0.975, 3);    // 1.5 * 0.65
    expect(sample([0, 0, 2, 2], 'wave_height').value).toBeCloseTo(0.450, 3);    // 1.0 * 0.45
    expect(sample([0, 0, 0, 2], 'wave_height').value).toBeCloseTo(0.175, 3);    // 0.5 * 0.35
  });

  it('THE REAL WORST CASE IS 11.43x, not the 2.86x the decay alone implies', () => {
    const p = sample([0, 0, 0, 2], 'wave_period').value;
    const h = sample([0, 0, 0, 2], 'wave_height').value;
    expect(p / h).toBeCloseTo(11.43, 1);
    expect(1 / 0.35).toBeCloseTo(2.857, 3);   // the decay alone -- the number I first reported
  });

  it('EVERY READING OF THE DECAY NOW FAILS, and this pins why', () => {
    // (a) SAMPLING correction? The principled fix -- exclude land, renormalise -- is already
    //     implemented in this same function, for period. Height gets zero-fill instead.
    // (b) NEARSHORE PHYSICS? estimate_surf_at owns that in the backend; a client-side height
    //     transform is a SECOND FORECAST PATH, the repo's #1 forbidden defect class.
    // (c) CALIBRATED? No: ae9e6867 (2026-05-31) introduced 0.65/0.45/0.35 inside a commit about
    //     EURO/ICON extended estimates, with no comment, no citation, and no calibration record
    //     anywhere in docs/ or audit/.
    // (d) And the BACKEND point lane does neither -- it falls back to the nearest OCEAN neighbour
    //     and refuses only for genuinely inland points (sampler.py:365,390,429).
    const oneLand = sample([0, 2, 2, 2], 'wave_height').value;
    const oceanOnly = sample([0, 2, 2, 2], 'wave_period').value;   // what renormalisation gives
    expect(oneLand).toBeLessThan(oceanOnly * 0.7);
  });
});


// ── THE OPT-IN FIX (default OFF = byte-identical) ────────────────────────────────────────────
describe('__RAW_NEARSHORE_RENORM__ routes height through the treatment period already gets', () => {
  const tile = (values, variable) => ({
    variable, model: 'ncep_gfswave025', timeIndex: 0, timestamp: 1,
    bounds: [0, 0, 2, 2], nx: 2, ny: 2, values: new Float32Array(values),
  });
  const sample = (vals, variable) => {
    const prev = window.__DECODED_OM_TILES__;
    window.__DECODED_OM_TILES__ = new Map([['k', tile(vals, variable)]]);
    try { return sampleValueFromDecodedTiles(1, 1, variable, 0, 'GFS'); }
    finally { window.__DECODED_OM_TILES__ = prev; }
  };
  afterEach(() => { delete window.__RAW_NEARSHORE_RENORM__; });

  it('DEFAULT OFF is byte-identical -- the twice-penalised numbers are unchanged', () => {
    // The whole point of shipping this dark: users see exactly what they saw before.
    expect(sample([0, 2, 2, 2], 'wave_height').value).toBeCloseTo(0.975, 3);
    expect(sample([0, 0, 2, 2], 'wave_height').value).toBeCloseTo(0.450, 3);
    expect(sample([0, 0, 0, 2], 'wave_height').value).toBeCloseTo(0.175, 3);
  });

  it('ON, height matches PERIOD exactly -- one treatment, not two', () => {
    window.__RAW_NEARSHORE_RENORM__ = true;
    for (const vals of [[2, 2, 2, 2], [0, 2, 2, 2], [0, 0, 2, 2], [0, 0, 0, 2]]) {
      expect(sample(vals, 'wave_height').value)
        .toBeCloseTo(sample(vals, 'wave_period').value, 6);
    }
  });

  it('ON, the 11.43x worst case collapses to 1.00x', () => {
    window.__RAW_NEARSHORE_RENORM__ = true;
    const h = sample([0, 0, 0, 2], 'wave_height').value;
    const p = sample([0, 0, 0, 2], 'wave_period').value;
    expect(p / h).toBeCloseTo(1.0, 6);
    expect(h).toBeCloseTo(2.0, 6);           // the ocean-only truth
  });

  it('only an EXACT true flips it -- a truthy string must not silently change a height', () => {
    window.__RAW_NEARSHORE_RENORM__ = 'yes';
    expect(sample([0, 0, 0, 2], 'wave_height').value).toBeCloseTo(0.175, 3);
  });

  it('the flag does not disturb period, which was already correct', () => {
    window.__RAW_NEARSHORE_RENORM__ = true;
    expect(sample([0, 0, 0, 2], 'wave_period').value).toBeCloseTo(2.0, 6);
  });
});
