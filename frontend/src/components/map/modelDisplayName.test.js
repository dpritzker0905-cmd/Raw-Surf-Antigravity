import { modelDisplayName } from './modelDisplayName';
import { compileForecastCards } from './forecastCardCompiler';
import { ACTIVE_MODEL_LABEL, describeSubstitution } from './modelProvenance';

// The panel says the picker's word. 'ECMWF' was false on EURO's swell layers (Copernicus MFWAM).
describe('modelDisplayName', () => {
  afterEach(() => { delete window.__RAW_DISABLE_EURO_DISPLAY_NAME__; });

  test.each(['GFS', 'ICON', 'EURO'])('%s shows the picker label', (m) => {
    expect(modelDisplayName(m)).toBe(m);
  });

  test('kill switch restores ECMWF', () => {
    window.__RAW_DISABLE_EURO_DISPLAY_NAME__ = true;
    expect(modelDisplayName('EURO')).toBe('ECMWF');
    expect(modelDisplayName('GFS')).toBe('GFS');
  });

  test('the substitution family map is untouched (no false banner on EURO tiles)', () => {
    expect(ACTIVE_MODEL_LABEL.EURO).toBe('ECMWF');
    expect(describeSubstitution('EURO', 'ecmwf_wam025')).toBeNull();
  });
});

describe('the panel header reads the same helper', () => {
  // Source-read, the house pattern for MapForecastOverlay (staleHour.proof.test.js): the header is
  // `{modelLabel} Forecast`, and modelLabel must come from modelDisplayName, not an inline EURO->ECMWF map.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'MapForecastOverlay.js'), 'utf8');

  test('modelLabel = modelDisplayName(activeModel)', () => {
    expect(src).toMatch(/const modelLabel = modelDisplayName\(activeModel\);/);
    expect(src).not.toMatch(/EURO:\s*'ECMWF'/);
  });
});

describe('EURO no-data swell cards say EURO, not ECMWF', () => {
  const base = { activeModel: 'EURO', isLoading: false, getClampedValue: () => null, marine: {}, wx: {} };

  test.each([
    ['swell_1', { swell1Supported: false }],
    ['swell_2', { swell2ModelUnavailable: true }],
    ['wind_waves', { windWavesSupported: false }],
  ])('%s', (activeLayer, flags) => {
    const labels = compileForecastCards({ ...base, activeLayer, ...flags }).map((c) => c.label);
    expect(labels).toContain('EURO');
    expect(labels).not.toContain('ECMWF');
  });
});
