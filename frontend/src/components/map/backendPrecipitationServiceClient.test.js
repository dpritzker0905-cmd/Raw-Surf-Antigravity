import { getBackendPrecipitationFlag, fetchBackendExactPrecipitationPoint, POINT_URL, precipitationPointCache } from './backendPrecipitationServiceClient';
import { setCachedManifest } from './backendWeatherServiceClient';

describe('backendPrecipitationServiceClient', () => {
  beforeEach(() => {
    // Clear globals and localStorage
    delete window.__USE_BACKEND_PRECIPITATION_SERVICE__;
    delete window.__MOCK_DATE_NOW__;
    delete window.__BACKEND_PRECIPITATION_SERVICE_DIAG__;
    localStorage.clear();
    setCachedManifest(null);
    jest.restoreAllMocks();
    precipitationPointCache.clear();
  });

  describe('getBackendPrecipitationFlag', () => {
    it('should return true by default (default-on)', () => {
      expect(getBackendPrecipitationFlag()).toBe(true);
    });

    it('should respect window override', () => {
      window.__USE_BACKEND_PRECIPITATION_SERVICE__ = true;
      expect(getBackendPrecipitationFlag()).toBe(true);

      window.__USE_BACKEND_PRECIPITATION_SERVICE__ = false;
      expect(getBackendPrecipitationFlag()).toBe(false);
    });

    it('should respect localStorage override', () => {
      localStorage.setItem('rawsurf_backend_precipitation_enabled', 'true');
      expect(getBackendPrecipitationFlag()).toBe(true);

      localStorage.setItem('rawsurf_backend_precipitation_enabled', 'false');
      expect(getBackendPrecipitationFlag()).toBe(false);
    });
  });

  describe('fetchBackendExactPrecipitationPoint', () => {
    it('should fetch, conform hourly response format, and update diagnostics on success for GFS', async () => {
      const mockResponse = {
        point: {
          sampled_lat: 28.36,
          sampled_lng: -80.60,
          value: 1.2,
          interpolation_method: 'bilinear_scalar'
        },
        provider: 'open-meteo',
        value_kind: 'precipitation',
        value_unit: 'mm',
        display_unit_hint: 'mm',
        source_dataset: 'gfs_seamless',
        source_variables: ['precipitation'],
        is_forecast_authoritative: true,
        is_estimated: false,
        is_test_fixture: false
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });
      global.fetch = mockFetch;

      const dateNow = new Date('2026-06-04T12:00:00Z').getTime();
      window.__MOCK_DATE_NOW__ = dateNow;

      // Mock manifest to return a GFS precipitation product
      setCachedManifest({
        products: [
          {
            model: 'GFS',
            domain: 'weather',
            layer: 'precipitation',
            valid_time_start: '2026-06-04T12:00:00Z',
            valid_time_end: '2026-06-04T12:00:00Z'
          }
        ]
      });

      const data = await fetchBackendExactPrecipitationPoint(28.3601, -80.6076, 0);

      expect(mockFetch.mock.calls[0][0]).toContain(`${POINT_URL}?model=GFS&domain=weather&layer=precipitation&lat=28.3601&lng=-80.6076&valid_time=2026-06-04T12:00:00.000Z`);

      expect(data).toEqual({
        hourly: {
          time: ['2026-06-04T12:00:00Z'],
          precipitation: [1.2]
        },
        snappedLat: 28.36,
        snappedLng: -80.60,
        requestedLat: 28.3601,
        requestedLng: -80.6076,
        requestedModel: 'GFS',
        activeLayer: 'precipitation',
        forecastDays: 1,
        apiModel: 'gfs_seamless',
        provider: 'open-meteo',
        source: 'network',
        diagnosticDetails: expect.any(Object)
      });

      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__).toBeDefined();
      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__.value).toBe(1.2);
      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__.interpolationMethod).toBe('bilinear_scalar');

      // Verify the new required diagnostics fields
      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__.activeModel).toBe('GFS');
      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__.selectedTimelineOffset).toBe(0);
      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__.requestedValidTime).toBe('2026-06-04T12:00:00.000Z');
      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__.backendPointValidTime).toBe('2026-06-04T12:00:00.000Z');
      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__.pointValueMm).toBe(1.2);
      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__.provider).toBe('open-meteo');
      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__.source).toBe('network');
    });

    it('should fetch dynamically and snapped for ICON', async () => {
      const mockResponse = {
        point: {
          sampled_lat: 28.36,
          sampled_lng: -80.60,
          value: 0.5,
          interpolation_method: 'exact_match'
        },
        provider: 'open-meteo',
        value_kind: 'precipitation',
        value_unit: 'mm',
        display_unit_hint: 'mm',
        source_dataset: 'dwd_icon',
        source_variables: ['precipitation'],
        is_forecast_authoritative: true,
        is_estimated: false,
        is_test_fixture: false
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });
      global.fetch = mockFetch;

      const dateNow = new Date('2026-06-04T12:00:00Z').getTime();
      window.__MOCK_DATE_NOW__ = dateNow;

      // Mock manifest to return an ICON precipitation product
      setCachedManifest({
        products: [
          {
            model: 'ICON',
            domain: 'weather',
            layer: 'precipitation',
            valid_time_start: '2026-06-04T12:00:00Z',
            valid_time_end: '2026-06-04T12:00:00Z'
          }
        ]
      });

      const data = await fetchBackendExactPrecipitationPoint(28.3601, -80.6076, 0, null, 'ICON');

      expect(mockFetch.mock.calls[0][0]).toContain(`${POINT_URL}?model=ICON&domain=weather&layer=precipitation&lat=28.3601&lng=-80.6076&valid_time=2026-06-04T12:00:00.000Z`);

      expect(data.requestedModel).toBe('ICON');
      expect(data.apiModel).toBe('dwd_icon');
      expect(data.hourly.precipitation[0]).toBe(0.5);
    });

    it('should handle fetch failures cleanly', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Internal Server Error' })
      });
      global.fetch = mockFetch;

      const dateNow = new Date('2026-06-04T12:00:00Z').getTime();
      window.__MOCK_DATE_NOW__ = dateNow;

      await expect(fetchBackendExactPrecipitationPoint(28.3601, -80.6076, 0)).rejects.toThrow('Internal Server Error');

      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__).toBeDefined();
      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__.activeModel).toBe('GFS');
      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__.source).toBe('error');
      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__.fallbackReason).toBe('Internal Server Error');
      expect(window.__BACKEND_PRECIPITATION_SERVICE_DIAG__.pointValueMm).toBeNull();
    });
  });
});
