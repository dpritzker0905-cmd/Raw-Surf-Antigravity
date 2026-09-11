import { act, renderHook, waitFor } from '@testing-library/react';
import { useOpenMeteoTileUrls } from '../components/map/useOpenMeteoTileUrls';
import { fetchModelMetadata, LIVE_FETCHED_MODELS } from '../components/map/mapUtils';
import { MODEL_METADATA_CACHE } from '../components/map/LayerRegistry';

jest.mock('maplibre-gl', () => ({}));
jest.mock('../components/map/useModelTransition', () => ({ useModelTransition: () => {}, resolveVariable: () => null }));
jest.mock('../components/map/LayerAccessResolver', () => ({ validateModelAccess: () => {} }));
jest.mock('../components/map/WeatherTelemetry', () => ({ WeatherTelemetry: new Proxy({}, { get: () => () => {} }) }));
jest.mock('../components/map/mapUtils', () => ({
  LIVE_FETCHED_MODELS: new Set(), OM_MODEL_MAP: { GFS: 'ncep_gfs025' },
  fetchModelMetadata: jest.fn(async () => ({ variables: [], validTimes: [], referenceTime: null })),
  registerOpenMeteoProtocol: () => {}, applyThemePressureScale: () => {},
  applyThemeWaveScale: () => {}, applyPrecipColorScale: () => {}, trace: (_, __, ___, url) => url,
}));
jest.mock('../components/map/LayerRegistry', () => ({
  LAYER_REGISTRY: {
    waves: { type: 'marine', omModelGroup: 'marine', omVariable: 'wave_height' },
    pressure: { type: 'raster', omVariable: 'pressure_msl' },
  },
  PRECIP_MODEL_MAP: {}, WIND_MODEL_MAP: {}, MARINE_MODEL_MAP: { GFS: 'ncep_gfswave025' },
  // Populated bootstrap axes must not suppress the first actual fetch on layer activation.
  MODEL_METADATA_CACHE: { ncep_gfs025: { variables: [], validTimes: ['2026-09-08T00:00:00Z'] } },
}));

const base = { mapInstance: null, activeModel: 'GFS', activeLayers: ['waves'], theme: 'light',
  timeOffsetHours: 0, userTier: 'pro', activeMarineLayer: 'waves', webglMarineFailed: false };

beforeEach(() => {
  fetchModelMetadata.mockClear();
  LIVE_FETCHED_MODELS.clear();
  MODEL_METADATA_CACHE.ncep_gfs025.variables = [];
});

test('native marine does not request unrelated external raster metadata', async () => {
  const { result } = renderHook(() => useOpenMeteoTileUrls(base));
  await waitFor(() => expect(result.current.omTileUrls['pressure-slot-0']).toBe('om://transparent-tile'));
  expect(fetchModelMetadata).not.toHaveBeenCalled();
});

test('activating a raster requests its actual model despite bootstrap cached axes', async () => {
  renderHook(() => useOpenMeteoTileUrls({ ...base, activeLayers: ['pressure'] }));
  await waitFor(() => expect(fetchModelMetadata).toHaveBeenCalled());
  expect([...new Set(fetchModelMetadata.mock.calls.map(call => call[0]))]).toEqual(['ncep_gfs025']);
});

test('marine fallback still requests its required metadata', async () => {
  renderHook(() => useOpenMeteoTileUrls({ ...base, webglMarineFailed: true }));
  await waitFor(() => expect(fetchModelMetadata).toHaveBeenCalled());
  expect([...new Set(fetchModelMetadata.mock.calls.map(call => call[0]))]).toEqual(['ncep_gfswave025']);
});

test('historical warm-cache fix: live raster URLs resolve in the same animation callback', () => {
  const frames = [];
  const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.push(callback);
    return frames.length;
  });
  LIVE_FETCHED_MODELS.add('ncep_gfs025');
  MODEL_METADATA_CACHE.ncep_gfs025.variables = ['pressure_msl'];
  try {
    const { result } = renderHook(() => useOpenMeteoTileUrls({ ...base, activeLayers: ['pressure'] }));
    // Deliberately synchronous: awaiting here would hide the historical latency regression.
    act(() => frames.shift()(0));
    expect(result.current.omTileUrls['pressure-slot-0']).toContain('/ncep_gfs025/latest.json');
    expect(fetchModelMetadata).not.toHaveBeenCalled();
  } finally {
    raf.mockRestore();
  }
});
