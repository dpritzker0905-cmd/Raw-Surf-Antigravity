import { compileForecastCards } from '../components/map/forecastCardCompiler';
import { Cloud, Eye } from 'lucide-react';

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
