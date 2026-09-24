import { act, renderHook, waitFor } from '@testing-library/react';
import { useOpenMeteoTileUrls } from '../components/map/useOpenMeteoTileUrls';
import { fetchModelMetadata, LIVE_FETCHED_MODELS } from '../components/map/mapUtils';
import { MODEL_METADATA_CACHE } from '../components/map/LayerRegistry';
import { fetchModelMetadata as fetchActualMetadata } from '../components/map/openMeteoMetadata';
import { normalizeUrl } from '@openmeteo/weather-map-layer';
import { Response } from 'node-fetch';

jest.mock('maplibre-gl', () => ({}));
jest.mock('../components/map/useModelTransition', () => ({ useModelTransition: () => {}, resolveVariable: () => null }));
jest.mock('../components/map/LayerAccessResolver', () => ({ validateModelAccess: () => {} }));
jest.mock('../components/map/WeatherTelemetry', () => ({ WeatherTelemetry: new Proxy({}, { get: () => () => {} }) }));
jest.mock('../components/map/mapUtils', () => ({
  LIVE_FETCHED_MODELS: jest.requireActual('../components/map/openMeteoMetadata').LIVE_FETCHED_MODELS,
  OM_MODEL_MAP: { GFS: 'ncep_gfs025' },
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
  fetchModelMetadata.mockReset().mockResolvedValue({ variables: [], validTimes: [], referenceTime: null });
  LIVE_FETCHED_MODELS.clear();
  MODEL_METADATA_CACHE.ncep_gfs025 = { variables: [], validTimes: ['2026-09-08T00:00:00Z'] };
  delete MODEL_METADATA_CACHE.ncep_gfswave025;
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
  MODEL_METADATA_CACHE.ncep_gfs025.sourceMetadata = {
    completed: true, reference_time: '2026-09-08T00:00:00Z',
    valid_times: MODEL_METADATA_CACHE.ncep_gfs025.validTimes, variables: ['pressure_msl'],
  };
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

test.each(['network failure', 'unfinished manifest'])(
  'cold %s publishes no guessed-axis URL and recovery selects the real forecast hour', async failure => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(new Date('2026-09-20T15:00:00Z'));
    const originalFetch = global.fetch;
    const frames = [];
    const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback);
      return frames.length;
    });
    const cancelRaf = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = {
      completed: true, reference_time: '2026-09-20T12:00:00Z', variables: ['wave_height'],
      valid_times: ['12', '15', '18', '21'].map(hour => `2026-09-20T${hour}:00:00Z`),
    };
    MODEL_METADATA_CACHE.ncep_gfswave025 = {
      variables: ['wave_height'], referenceTime: '2026-09-20T06:00:00Z',
      validTimes: ['06', '09', '12', '15'].map(hour => `2026-09-20T${hour}:00:00Z`),
    };
    const transport = jest.fn(async () => new Response(JSON.stringify(provider)));
    if (failure === 'network failure') transport.mockRejectedValueOnce(new Error('provider unavailable'));
    else transport.mockResolvedValueOnce(new Response(JSON.stringify({ ...provider, completed: false })));
    global.fetch = transport;
    fetchModelMetadata.mockImplementation(fetchActualMetadata);
    let unmount;
    const nextFrame = async () => act(async () => {
      frames.shift()(0);
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    try {
      const view = renderHook(props => useOpenMeteoTileUrls(props), {
        initialProps: { ...base, webglMarineFailed: true },
      });
      unmount = view.unmount;
      await nextFrame();
      const coldUrl = view.result.current.omTileUrls['waves-slot-0'];
      // On the unfixed hook, actually decode its published URL: index 3 means 21Z
      // in the provider axis, although the user requested 15Z on the bootstrap axis.
      const decodedAfterFailure = coldUrl && coldUrl !== 'om://transparent-tile'
        ? await normalizeUrl(coldUrl) : null;
      expect({ coldUrl, decodedAfterFailure }).toEqual({
        coldUrl: 'om://transparent-tile', decodedAfterFailure: null,
      });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(LIVE_FETCHED_MODELS.has('ncep_gfswave025')).toBe(false);

      // A normal rerender retries metadata; only its real axis can authorize a URL.
      view.rerender({ ...base, webglMarineFailed: true, theme: 'dark' });
      await nextFrame();
      // Metadata revision may schedule a second frame; drain that known work too.
      while (frames.length) await nextFrame();
      const recoveredUrl = Object.values(view.result.current.omTileUrls)
        .find(url => url.includes('webgl_fallback=true'));
      expect(recoveredUrl).toContain('time_step=valid_times_1');
      expect(await normalizeUrl(recoveredUrl)).toContain('/1200Z/2026-09-20T1500.om');
      expect(MODEL_METADATA_CACHE.ncep_gfswave025.sourceMetadata).toEqual(provider);
      expect(LIVE_FETCHED_MODELS.has('ncep_gfswave025')).toBe(true);
    } finally {
      unmount?.();
      global.fetch = originalFetch;
      raf.mockRestore();
      cancelRaf.mockRestore();
      warn.mockRestore();
      // Let the real decoder expire its private 60-second metadata cache between cases.
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    }
  },
);
