/**
 * Lazy 10m (high-resolution) land-mask loader for the marine engine.
 *
 * The wave heatmap bleeds over land at z12+ because the engine masks land with the coarse 50m
 * GeoJSON. getSharedLandGeoJSONHiRes lazily loads the 10m polygons (local-first, CDN fallback),
 * caches them on window, and degrades gracefully so the 50m mask keeps working if the 10m is
 * unavailable. These tests pin that contract (the visual swap itself is verified live).
 */
import { getSharedLandGeoJSONHiRes } from '../components/map/mapUtils';

const HIRES = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] };

describe('getSharedLandGeoJSONHiRes — lazy 10m land mask', () => {
  beforeEach(() => {
    delete window.__LAND_GEOJSON_HIRES_CACHE__;
    delete window.__LAND_GEOJSON_HIRES_PROMISE__;
    jest.restoreAllMocks();
  });
  afterEach(() => {
    delete window.__LAND_GEOJSON_HIRES_CACHE__;
    delete window.__LAND_GEOJSON_HIRES_PROMISE__;
  });

  it('loads the local /ne_10m_land.json first and caches it on window', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => HIRES });
    const gj = await getSharedLandGeoJSONHiRes();
    expect(gj).toBe(HIRES);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('/ne_10m_land.json');
    expect(window.__LAND_GEOJSON_HIRES_CACHE__).toBe(HIRES);
  });

  it('falls back to the Natural Earth CDN when the local copy is missing', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })          // local miss
      .mockResolvedValueOnce({ ok: true, json: async () => HIRES });                       // CDN hit
    const gj = await getSharedLandGeoJSONHiRes();
    expect(gj).toBe(HIRES);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toMatch(/cdn\.jsdelivr\.net.*ne_10m_land\.json/);
  });

  it('returns the cached object on a second call without re-fetching', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => HIRES });
    await getSharedLandGeoJSONHiRes();
    const again = await getSharedLandGeoJSONHiRes();
    expect(again).toBe(HIRES);
    expect(global.fetch).toHaveBeenCalledTimes(1); // served from window cache
  });

  it('rejects AND clears the promise (so a later retry can fetch again) when both sources fail', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    await expect(getSharedLandGeoJSONHiRes()).rejects.toBeTruthy();
    expect(window.__LAND_GEOJSON_HIRES_PROMISE__).toBeFalsy(); // cleared → retryable
    expect(window.__LAND_GEOJSON_HIRES_CACHE__).toBeUndefined();

    // A subsequent call retries the fetch and can succeed.
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => HIRES });
    const gj = await getSharedLandGeoJSONHiRes();
    expect(gj).toBe(HIRES);
  });

  it('rejects an empty geojson (no land features) rather than caching a useless mask', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) });
    await expect(getSharedLandGeoJSONHiRes()).rejects.toBeTruthy();
    expect(window.__LAND_GEOJSON_HIRES_CACHE__).toBeUndefined();
  });
});
