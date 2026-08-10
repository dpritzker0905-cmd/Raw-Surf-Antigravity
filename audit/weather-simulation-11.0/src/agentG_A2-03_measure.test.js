/**
 * AGENT G red-team measurement (READ-ONLY audit artifact, not shipped code).
 * Measures the ACTUAL tile-lane output vs the underlying water value, to separate
 * the nearshore-decay multiplier from the bilinear ZERO-FILL of land cells.
 */
import { sampleValueFromDecodedTiles } from '../../../frontend/src/components/map/forecastHelpers';

const tile = (values, variable) => ({
  variable, model: 'ncep_gfswave025', timeIndex: 0, timestamp: 1,
  bounds: [0, 0, 2, 2], nx: 2, ny: 2, values: new Float32Array(values),
});
const withTiles = (t, fn) => {
  const prev = window.__DECODED_OM_TILES__;
  window.__DECODED_OM_TILES__ = new Map([['k', t]]);
  try { return fn(); } finally { window.__DECODED_OM_TILES__ = prev; }
};
// row-major, row0 = NORTH-ish per the sampler's ty formula; we sample the tile CENTRE
const at = (values, lat, lng) => withTiles(tile(values, 'wave_height'),
  () => sampleValueFromDecodedTiles(lat, lng, 'wave_height', 0, 'GFS'));

describe('AGENT G: decompose the tile-lane reduction', () => {
  const W = 2.0; // the "true" water value in every water cell

  it('MEASURE: all-water vs each land count, sampled at the SAME coordinate (tile centre)', () => {
    const cases = {
      land0: [W, W, W, W],
      land1: [0, W, W, W],
      land2: [0, 0, W, W],
      land3: [0, 0, 0, W],
    };
    const out = {};
    for (const [k, v] of Object.entries(cases)) {
      const r = at(v, 1.0, 1.0);
      out[k] = r ? r.value : null;
    }
    // print ASCII only
    console.log('AGENTG_CENTRE ' + JSON.stringify(out));
    console.log('AGENTG_RATIO_land3 ' + (out.land0 / out.land3).toFixed(4));
    console.log('AGENTG_RATIO_land1 ' + (out.land0 / out.land1).toFixed(4));
    expect(out.land0).toBeCloseTo(W, 6);
  });

  it('MEASURE: sample biased ONTO a water corner so zero-fill weight is minimal', () => {
    // Sample near the (x1,y1) corner: dx,dy -> 1, so v11 dominates.
    const land3 = at([0, 0, 0, W], 0.02, 1.98);
    const water = at([W, W, W, W], 0.02, 1.98);
    console.log('AGENTG_CORNER water=' + (water && water.value) + ' land3=' + (land3 && land3.value));
    console.log('AGENTG_CORNER_RATIO ' + ((water.value) / (land3.value)).toFixed(4));
    expect(water.value).toBeCloseTo(W, 6);
  });
});
