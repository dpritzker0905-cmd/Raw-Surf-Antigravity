import { getBackendPressureFlag, fetchBackendExactPressurePoint, POINT_URL, pressurePointCache } from './backendPressureServiceClient';
import { setCachedManifest } from './backendWeatherServiceClient';

describe('backendPressureServiceClient', () => {
  beforeEach(() => {
    // Clear globals and localStorage
    delete window.__USE_BACKEND_PRESSURE_SERVICE__;
    delete window.__MOCK_DATE_NOW__;
    delete window.__BACKEND_PRESSURE_SERVICE_DIAG__;
    localStorage.clear();
    setCachedManifest(null);
    jest.restoreAllMocks();
    pressurePointCache.clear();
  });

  describe('getBackendPressureFlag', () => {
    it('should return true by default (default-on)', () => {
      expect(getBackendPressureFlag()).toBe(true);
    });

    it('should respect window override', () => {
      window.__USE_BACKEND_PRESSURE_SERVICE__ = true;
      expect(getBackendPressureFlag()).toBe(true);

      window.__USE_BACKEND_PRESSURE_SERVICE__ = false;
      expect(getBackendPressureFlag()).toBe(false);
    });

    it('should respect localStorage override', () => {
      localStorage.setItem('rawsurf_backend_pressure_enabled', 'true');
      expect(getBackendPressureFlag()).toBe(true);

      localStorage.setItem('rawsurf_backend_pressure_enabled', 'false');
      expect(getBackendPressureFlag()).toBe(false);
    });
  });

  describe('fetchBackendExactPressurePoint', () => {
    it('should fetch, conform hourly response format, and update diagnostics on success for GFS', async () => {
      const mockResponse = {
        point: {
          sampled_lat: 28.36,
          sampled_lng: -80.60,
          value: 1018.5,
          interpolation_method: 'bilinear_scalar'
        },
        provider: 'open-meteo',
        value_kind: 'pressure',
        value_unit: 'hPa',
        display_unit_hint: 'hPa',
        source_dataset: 'gfs_seamless',
        source_variables: ['pressure_msl'],
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

      // Mock manifest to return a GFS pressure product
      setCachedManifest({
        products: [
          {
            model: 'GFS',
            domain: 'weather',
            layer: 'pressure',
            valid_time_start: '2026-06-04T12:00:00Z',
            valid_time_end: '2026-06-04T12:00:00Z'
          }
        ]
      });

      const data = await fetchBackendExactPressurePoint(28.3601, -80.6076, 0);

      expect(mockFetch.mock.calls[0][0]).toContain(`${POINT_URL}?model=GFS&domain=weather&layer=pressure&lat=28.3601&lng=-80.6076&valid_time=2026-06-04T12:00:00.000Z`);

      expect(data).toEqual({
        hourly: {
          time: ['2026-06-04T12:00:00Z'],
          pressure_msl: [1018.5]
        },
        snappedLat: 28.36,
        snappedLng: -80.60,
        requestedLat: 28.3601,
        requestedLng: -80.6076,
        requestedModel: 'GFS',
        activeLayer: 'pressure',
        forecastDays: 1,
        apiModel: 'gfs_seamless',
        provider: 'open-meteo',
        source: 'network',
        diagnosticDetails: expect.any(Object)
      });

      expect(window.__BACKEND_PRESSURE_SERVICE_DIAG__).toBeDefined();
      expect(window.__BACKEND_PRESSURE_SERVICE_DIAG__.value).toBe(1018.5);
      expect(window.__BACKEND_PRESSURE_SERVICE_DIAG__.interpolationMethod).toBe('bilinear_scalar');
    });

    it('should fetch dynamically and snapped for ICON', async () => {
      const mockResponse = {
        point: {
          sampled_lat: 28.36,
          sampled_lng: -80.60,
          value: 1012.3,
          interpolation_method: 'exact_match'
        },
        provider: 'open-meteo',
        value_kind: 'pressure',
        value_unit: 'hPa',
        display_unit_hint: 'hPa',
        source_dataset: 'dwd_icon',
        source_variables: ['pressure_msl'],
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

      // Mock manifest to return an ICON pressure product
      setCachedManifest({
        products: [
          {
            model: 'ICON',
            domain: 'weather',
            layer: 'pressure',
            valid_time_start: '2026-06-04T12:00:00Z',
            valid_time_end: '2026-06-04T12:00:00Z'
          }
        ]
      });

      const data = await fetchBackendExactPressurePoint(28.3601, -80.6076, 0, null, 'ICON');

      expect(mockFetch.mock.calls[0][0]).toContain(`${POINT_URL}?model=ICON&domain=weather&layer=pressure&lat=28.3601&lng=-80.6076&valid_time=2026-06-04T12:00:00.000Z`);

      expect(data.requestedModel).toBe('ICON');
      expect(data.apiModel).toBe('dwd_icon');
      expect(data.hourly.pressure_msl[0]).toBe(1012.3);
    });

    it('should fetch dynamically and snapped for EURO', async () => {
      const mockResponse = {
        point: {
          sampled_lat: 28.36,
          sampled_lng: -80.60,
          value: 1015.7,
          interpolation_method: 'bilinear_scalar'
        },
        provider: 'open-meteo',
        value_kind: 'pressure',
        value_unit: 'hPa',
        display_unit_hint: 'hPa',
        source_dataset: 'ecmwf_ifs',
        source_variables: ['pressure_msl'],
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

      // Mock manifest to return a EURO pressure product
      setCachedManifest({
        products: [
          {
            model: 'EURO',
            domain: 'weather',
            layer: 'pressure',
            valid_time_start: '2026-06-04T12:00:00Z',
            valid_time_end: '2026-06-04T12:00:00Z'
          }
        ]
      });

      const data = await fetchBackendExactPressurePoint(28.3601, -80.6076, 0, null, 'EURO');

      expect(mockFetch.mock.calls[0][0]).toContain(`${POINT_URL}?model=EURO&domain=weather&layer=pressure&lat=28.3601&lng=-80.6076&valid_time=2026-06-04T12:00:00.000Z`);

      expect(data.requestedModel).toBe('EURO');
      expect(data.apiModel).toBe('ecmwf_ifs');
      expect(data.hourly.pressure_msl[0]).toBe(1015.7);
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

      await expect(fetchBackendExactPressurePoint(28.3601, -80.6076, 0)).rejects.toThrow('Internal Server Error');

      expect(window.__BACKEND_PRESSURE_SERVICE_DIAG__).toBeDefined();
      expect(window.__BACKEND_PRESSURE_SERVICE_DIAG__.status).toBe(500);
      expect(window.__BACKEND_PRESSURE_SERVICE_DIAG__.error).toBe('Internal Server Error');
      expect(window.__BACKEND_PRESSURE_SERVICE_DIAG__.value).toBeNull();
    });
  });
});
