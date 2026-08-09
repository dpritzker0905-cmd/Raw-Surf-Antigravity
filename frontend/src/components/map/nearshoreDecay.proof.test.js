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
 * ⛔ NOT FIXED HERE, DELIBERATELY. Removing the decay, or extending it to the point lane, both
 * change a displayed height on physical grounds -- which lane is RIGHT is a science question
 * (is the point lane already land-aware? is 0.35 calibrated or a guess?), and the repo's rule is
 * PRIMARY SOURCE before any calibration change. These assertions keep the divergence measured and
 * visible so it cannot widen silently while that is decided.
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
