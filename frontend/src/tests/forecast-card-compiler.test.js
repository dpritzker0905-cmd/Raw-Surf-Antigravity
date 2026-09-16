import { compileForecastCards } from '../components/map/forecastCardCompiler';
import { Cloud, Eye } from 'lucide-react';

describe.each(['rain', 'radar', 'precipitation'])('%s precipitation presence', (activeLayer) => {
  const card = (values) => compileForecastCards({
    activeLayer, wx: {}, getClampedValue: () => null, ...values,
  })[0];

  test.each([null, undefined])('missing total %s and missing snow stay unknown', (precip) => {
    expect(card({ precip, snowfall: null }).value).toBe('--');
  });

  test('zero snow alone cannot prove zero total precipitation', () => {
    expect(card({ precip: null, snowfall: 0 }).value).toBe('--');
  });

  test('missing precipitation while loading does not claim dry weather', () => {
    expect(card({ precip: null, snowfall: null, isLoading: true }).value).toBe('Loading');
  });

  test('measured zero total remains a numeric zero', () => {
    expect(card({ precip: 0, snowfall: null }).value).toBe('0.0 mm/h');
  });

  test('known rain and snow retain their values', () => {
    expect(card({ precip: 2, snowfall: 0 }).value).toBe('2.0 mm/h');
    expect(card({ precip: null, snowfall: 1 }).value).toBe('1.0 cm/h');
  });
});

describe('forecastCardCompiler.js - compileForecastCards', () => {
  test('compiles satellite card correctly with valid cloud cover data', () => {
    const cards = compileForecastCards({
      activeLayer: 'satellite',
      activeModel: 'GFS',
      sampledCloudCover: { value: 75.2 },
      isLoading: false
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].label).toBe('Cloud Cover');
    expect(cards[0].value).toBe('75%');
    expect(cards[0].icon).toBe(Cloud);
  });

  test('compiles satellite card with loading state when loading', () => {
    const cards = compileForecastCards({
      activeLayer: 'satellite',
      activeModel: 'GFS',
      sampledCloudCover: null,
      isLoading: true
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].value).toBe('Loading');
  });

  test('compiles satellite card with placeholder when data is missing', () => {
    const cards = compileForecastCards({
      activeLayer: 'satellite',
      activeModel: 'GFS',
      sampledCloudCover: null,
      isLoading: false
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].value).toBe('--');
  });

  test('compiles fog card correctly for different visibility values', () => {
    // Dense fog (<1km)
    let cards = compileForecastCards({
      activeLayer: 'fog',
      activeModel: 'GFS',
      sampledVisibility: { value: 500 },
      isLoading: false
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].label).toBe('Visibility');
    expect(cards[0].value).toBe('Dense Fog (<1km)');
    expect(cards[0].icon).toBe(Eye);

    // Moderate fog (e.g. 3000m)
    cards = compileForecastCards({
      activeLayer: 'fog',
      activeModel: 'GFS',
      sampledVisibility: { value: 3000 },
      isLoading: false
    });
    expect(cards[0].value).toBe('Moderate Fog');

    // Light fog (e.g. 7000m)
    cards = compileForecastCards({
      activeLayer: 'fog',
      activeModel: 'GFS',
      sampledVisibility: { value: 7000 },
      isLoading: false
    });
    expect(cards[0].value).toBe('Light Fog');

    // Clear (>20km)
    cards = compileForecastCards({
      activeLayer: 'fog',
      activeModel: 'GFS',
      sampledVisibility: { value: 25000 },
      isLoading: false
    });
    expect(cards[0].value).toBe('Clear');

    // Clear (e.g. 15km)
    cards = compileForecastCards({
      activeLayer: 'fog',
      activeModel: 'GFS',
      sampledVisibility: { value: 15000 },
      isLoading: false
    });
    expect(cards[0].value).toBe('Clear (15 km)');
  });
});
