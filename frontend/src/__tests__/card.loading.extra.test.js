import { compileForecastCards } from '../components/map/forecastCardCompiler';

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

describe('Info box card loading tests', () => {
  test('null marine height on swell_1 shows Loading... and never a stale value/unit', () => {
    // 1. calls compileForecastCards({ ...baseProps, activeLayer:'swell_1', swell1Height:null, swell1Period:null, swell1Dir:null })
    const cards = compileForecastCards({
      ...baseProps,
      activeLayer: 'swell_1',
      swell1Height: null,
      swell1Period: null,
      swell1Dir: null,
    });

    // 2. finds the card whose `.label === 'Status'` OR `.label === 'Height'`
    const heightOrStatusCard = cards.find((c) => c.label === 'Status' || c.label === 'Height');
    expect(heightOrStatusCard).toBeDefined();

    // 3. asserts that card's `.value` is a loading/placeholder string (e.g. contains `'Loading'`) and does NOT contain `'ft'`.
    expect(heightOrStatusCard.value).toContain('Loading');
    expect(heightOrStatusCard.value).not.toContain('ft');
  });
});
