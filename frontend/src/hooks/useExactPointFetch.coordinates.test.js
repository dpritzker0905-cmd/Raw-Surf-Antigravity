// Mounted hook -> real sampler/cache/HTTP adapter; only transport is offline.
import { act, renderHook, waitFor } from '@testing-library/react';
import { useExactPointFetch } from './useExactPointFetch';
import * as client from '../components/map/backendWeatherServiceClient';
import { _exactPointCache } from '../components/map/forecastExactPoint';
jest.mock('../lib/apiClient', () => ({ BACKEND_URL: 'https://offline.invalid' }));
jest.mock('../components/map/backendWeatherServiceClientTrace', () => ({}));

let requests;
const originalFetch = global.fetch;
beforeEach(() => {
  jest.useFakeTimers('modern');
  jest.setSystemTime(Date.parse('2026-10-05T00:00:00Z'));
  window.localStorage.clear();
  window.__MAP_BOOTSTRAPPED__ = true;
  window.__USE_BACKEND_WEATHER_SERVICE__ = true;
  window.__USE_BACKEND_MARINE_SYSTEM__ = true;
  delete window.__MARINE_PROJECTION_DIAG__;
  client.setCachedManifest({ products: [] });
  client.pointCache.clear();
  _exactPointCache.clear();
  requests = [];
  global.fetch = jest.fn(async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/products')) return { ok: true, json: async () => ({ products: [] }) };
    const query = Object.fromEntries(parsed.searchParams);
    requests.push(query);
    return { ok: true, status: 200, json: async () => ({
      model: query.model, domain: query.domain, layer: query.layer, valid_time: query.valid_time,
      product_id: 'offline.json', provider: 'fixture', coverage_status: 'inside_regional_tile',
      point: { speed: 5.79, direction: 107, period: 9.1,
        sampled_lat: Number(query.lat), sampled_lng: Number(query.lng) }
    }) };
  });
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
  ['__MAP_BOOTSTRAPPED__', '__USE_BACKEND_WEATHER_SERVICE__', '__USE_BACKEND_MARINE_SYSTEM__',
    '__RAW_DISABLE_POINT_REQUEST_IDENTITY__', '__MARINE_POINT_DIAG__'].forEach(key => delete window[key]);
});
function props(lat, lng) {
  return { pointLat: lat, pointLng: lng, activeModel: 'GFS', activeLayer: 'waves',
    isExactPointRequired: true, settledOffset: 98, timeOffsetHours: 98,
    isPlaying: false, isScrubbing: false, longPressLocation: { lat, lng } };
}
async function settle(hook) {
  await act(async () => { jest.advanceTimersByTime(2000); await Promise.resolve(); });
  await waitFor(() => expect(hook.result.current.exactPointStatus).not.toBe('exact_loading'));
}

describe.each([false, true])('point identity disabled=%s', disabled => {
  beforeEach(() => { window.__RAW_DISABLE_POINT_REQUEST_IDENTITY__ = disabled; });
  test.each([[30.04, -447.41], [30.04, -87.41], [30.04, 272.59], [0, -87], [30, 0], [0, 0]])(
    'valid coordinate %s/%s loads the actual point', async (lat, lng) => {
      const hook = renderHook(p => useExactPointFetch(p), { initialProps: props(lat, lng) });
      await settle(hook);
      expect(requests).toHaveLength(1);
      expect(Number(requests[0].lat)).toBe(lat);
      expect(Number(requests[0].lng)).toBe(lat === 30.04 ? -87.41 : lng);
      expect(hook.result.current.exactPointStatus).toBe('exact_success');
      expect(hook.result.current.exactPoint.wave_height).toBe(5.79);
      hook.unmount();
    });
  test.each([[null, -87], [undefined, -87], [NaN, -87], [Infinity, -87], [91, -87],
    [-91, -87], ['30', -87], [30, null], [30, Infinity], [30, '0']])(
    'invalid coordinate %s/%s stays idle without transport', async (lat, lng) => {
      const hook = renderHook(p => useExactPointFetch(p), { initialProps: props(lat, lng) });
      await settle(hook);
      expect(requests).toHaveLength(0);
      expect(hook.result.current.exactPointStatus).toBe('idle');
      expect(hook.result.current.exactPoint).toBeNull();
      hook.unmount();
    });
  test.each([[0, -87], [30, 0], [0, 0]])('reselection at %s/%s replaces prior point', async (lat, lng) => {
    const hook = renderHook(p => useExactPointFetch(p), { initialProps: props(30.04, -87.41) });
    await settle(hook);
    hook.rerender(props(lat, lng));
    await settle(hook);
    expect(requests).toHaveLength(2);
    expect(Number(requests[1].lat)).toBe(lat);
    expect(Number(requests[1].lng)).toBe(lng);
    expect(hook.result.current.exactPointStatus).toBe('exact_success');
    hook.unmount();
  });
  test.each(['isPlaying', 'isScrubbing'])('%s still suppresses a zero-coordinate fetch', async mode => {
    const hook = renderHook(p => useExactPointFetch(p), { initialProps: { ...props(0, 0), [mode]: true } });
    await settle(hook);
    expect(requests).toHaveLength(0);
    expect(hook.result.current.exactPointStatus).toBe('idle');
    hook.unmount();
  });
});
