import * as tideClientModule from './tideClient';
import { tideCellKey, formatTideLine, trendArrow } from './tideClient';

describe('tideCellKey', () => {
  it('rounds to ~0.1° so nearby spots share a fetch (backend cache parity)', () => {
    expect(tideCellKey(28.41, -80.59)).toBe(tideCellKey(28.4, -80.6));
    expect(tideCellKey(28.4, -80.6)).not.toBe(tideCellKey(21.66, -158.05));
    // Independent Python round(value, 1) oracle, including binary-float and exact ties.
    for (const [coordinate,expected] of [[34.05,'34'],[0.25,'0.2'],[1.45,'1.4'],[-0.05,'-0.1'],[-0.75,'-0.8']]) {
      expect(tideCellKey(coordinate,0)).toBe(`${expected},0`);
    }
  });
});

describe('no browser-side tide source (D-082, 2026-11-22)', () => {
  it('the Open-Meteo fallback is gone: no fetcher, no cache, no Open-Meteo URL in the module', () => {
    expect(tideClientModule.ensureTideState).toBeUndefined();
    expect(tideClientModule.getCachedTideState).toBeUndefined();
    const fs = require('fs');
    const path = require('path');
    const text = fs.readFileSync(path.join(__dirname, 'tideClient.js'), 'utf8');
    expect(text).not.toMatch(/marine-api\.open-meteo\.com|sea_level_height_msl/);
  });
});

describe('formatTideLine', () => {
  it('formats in ft/m with the trend as a word (screen-reader safe)', () => {
    // The datum is always named (tideDatum, 2026-11-22): an MSL level says so ...
    expect(formatTideLine({ height_m: -0.06, trend: 'falling' }, 'ft')).toBe('-0.2 ft above local MSL falling');
    expect(formatTideLine({ height_m: 0.62, trend: 'rising' }, 'm')).toBe('0.6 m above local MSL rising');
    // ... and a US rating tide shows its display height above MLLW, with "minus tide" below zero.
    expect(formatTideLine({ height_m: 0.1, display_height_m: 0.9, datum: 'MLLW', datum_src: 'model', trend: 'rising' }, 'm'))
      .toBe('0.9 m above MLLW rising');
    expect(formatTideLine({ height_m: -0.6, display_height_m: -0.1, datum: 'MLLW', datum_src: 'gauge', trend: 'falling' }, 'ft'))
      .toBe('-0.3 ft above MLLW (minus tide) falling');
  });

  it('omits an unknown trend but keeps the height', () => {
    expect(formatTideLine({ height_m: 0.5, trend: 'weird' }, 'ft')).toBe('1.6 ft above local MSL');
    expect(formatTideLine({ height_m: 0.5 }, 'ft')).toBe('1.6 ft above local MSL');
  });

  it('returns null for unusable payloads', () => {
    expect(formatTideLine(null, 'ft')).toBeNull();
    expect(formatTideLine({}, 'ft')).toBeNull();
    expect(formatTideLine({ height_m: null, trend: 'rising' }, 'ft')).toBeNull();
    expect(formatTideLine({ height_m: 'x' }, 'ft')).toBeNull();
  });
});

describe('trendArrow', () => {
  it('maps trends to decorative arrows, empty for unknown', () => {
    expect(trendArrow('rising')).toBe('↑');
    expect(trendArrow('falling')).toBe('↓');
    expect(trendArrow('slack')).toBe('→');
    expect(trendArrow('nope')).toBe('');
    expect(trendArrow(undefined)).toBe('');
  });
});
