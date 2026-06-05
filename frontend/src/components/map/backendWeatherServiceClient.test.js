/**
 * backendWeatherServiceClient.test.js
 * 
 * Unit test suite for backendWeatherServiceClient.js.
 * Verifies valid_time helpers, schema mapping, and HTTP fetching fallbacks.
 */

import {
  getBackendMarineSystemFlag,
  getBackendWeatherFlag,
  getBackendWindFlag,
  getSharedValidTime,
  setCachedManifest,
  mapNormalizedGridToWebGL,
  fetchBackendExactPoint,
  getBackendIconMarineFlag,
  fetchBackendMarineGrid,
  pointCache
} from './backendWeatherServiceClient';
import {
  mapNormalizedWindGridToWebGL,
  fetchBackendExactWindPoint,
  fetchBackendWindGrid,
  windPointCache
} from './backendWindServiceClient';
import {
  mapNormalizedCopernicusGridToWebGL,
  fetchBackendExactCopernicusPoint,
  fetchBackendCopernicusGrid,
  copernicusPointCache,
  updateCopernicusDiagnostics
} from './backendCopernicusServiceClient';
import { pressurePointCache } from './backendPressureServiceClient';
import { selectExactPointHour } from './forecastSamplers';
import { PILOT_COVERAGE } from './backendWeatherServiceClientCoverage';

describe('backendWeatherServiceClient', () => {
  let origFetch;

  beforeAll(() => {
    origFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = origFetch;
  });

  beforeEach(() => {
    if (typeof window !== 'undefined') {
      delete window.__USE_BACKEND_MARINE_SYSTEM__;
      delete window.__USE_BACKEND_WEATHER_SERVICE__;
      delete window.__USE_BACKEND_COPERNICUS_SERVICE__;
      delete window.__USE_BACKEND_ICON_MARINE_SERVICE__;
      delete window.__BACKEND_WEATHER_SERVICE_DIAG__;
    }
    try {
      localStorage.clear();
    } catch (e) {}
    jest.clearAllMocks();
    setCachedManifest(null);
    pointCache.clear();
    copernicusPointCache.clear();
    windPointCache.clear();
    pressurePointCache.clear();
  });

  describe('getBackendMarineSystemFlag', () => {
    it('returns true by default', () => {
      expect(getBackendMarineSystemFlag()).toBe(true);
    });

    it('uses window.__USE_BACKEND_MARINE_SYSTEM__ override if set', () => {
      window.__USE_BACKEND_MARINE_SYSTEM__ = false;
      expect(getBackendMarineSystemFlag()).toBe(false);

      window.__USE_BACKEND_MARINE_SYSTEM__ = true;
      expect(getBackendMarineSystemFlag()).toBe(true);
    });
  });

  describe('getBackendWeatherFlag', () => {
    it('returns true by default when master is active', () => {
      expect(getBackendWeatherFlag()).toBe(true);
    });

    it('returns false if master flag is disabled', () => {
      window.__USE_BACKEND_MARINE_SYSTEM__ = false;
      expect(getBackendWeatherFlag()).toBe(false);
    });
  });

  describe('getSharedValidTime', () => {
    it('generates snapped UTC ISO strings matching time offset by default', () => {
      const roundedNow = Math.round(Date.now() / 3600000) * 3600000;
      const expected0 = new Date(roundedNow).toISOString();
      const expected5 = new Date(roundedNow + 5 * 3600000).toISOString();

      expect(getSharedValidTime(0)).toBe(expected0);
      expect(getSharedValidTime(5)).toBe(expected5);
    });

    it('snaps to the closest manifest valid_time when within 3h limit', () => {
      const mockManifest = {
        products: [
          {
            model: 'GFS',
            domain: 'marine',
            layer: 'waves',
            valid_time_start: '2026-06-02T01:00:00.000Z'
          }
        ]
      };
      setCachedManifest(mockManifest);

      const originalDateNow = Date.now;
      Date.now = () => new Date('2026-06-02T00:00:00Z').getTime();

      const resolvedTime = getSharedValidTime(1);
      expect(resolvedTime).toBe('2026-06-02T01:00:00.000Z');

      Date.now = originalDateNow;
      setCachedManifest(null);
    });
  });

  describe('mapNormalizedGridToWebGL', () => {
    it('maps backend response schema to expected WebGL feature properties', () => {
      const sampleResponse = {
        grid: {
          vectors: [
            { lat: 28.0, lng: -82.0, u: 1.0, v: 0.5, speed: 1.11, period: 8.0 }
          ],
          bounds: { west: -85.0, south: 24.0, east: -79.0, north: 31.0 },
          cols: 1,
          rows: 1
        },
        provider: 'backend-weather-service'
      };

      const result = mapNormalizedGridToWebGL(sampleResponse, sampleResponse.grid.bounds, 4);
      expect(result.grid.cols).toBe(1);
      expect(result.grid.vectors[0].waves.speed).toBe(1.11);
      expect(result.grid.vectors[0].waves.period).toBe(8.0);
    });
  });

  describe('fetchBackendExactPoint', () => {
    it('resolves point data successfully on valid server responses', async () => {
      const mockJson = {
        point: {
          speed: 1.43,
          direction: 85,
          period: 7.2,
          sampled_lat: 28.4,
          sampled_lng: -80.6
        },
        provider: 'backend-weather-service'
      };

      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockJson)
        })
      );

      const res = await fetchBackendExactPoint(28.4, -80.6, 1);
      expect(res.hourly.wave_height[0]).toBe(1.43);
      expect(res.hourly.wave_direction[0]).toBe(85);
      expect(res.hourly.wave_period[0]).toBe(7.2);
    });
  });

  describe('getBackendWindFlag', () => {
    it('returns true by default', () => {
      expect(getBackendWindFlag()).toBe(true);
    });
  });

  describe('mapNormalizedWindGridToWebGL', () => {
    it('returns renderable: false for all-zero wind speed grids', () => {
      const zeroResponse = {
        grid: {
          vectors: [
            { lat: 28.0, lng: -80.0, speed: 0.0, direction: 0.0, u: 0.0, v: 0.0 }
          ],
          bounds: { west: -85.0, south: 24.0, east: -79.0, north: 31.0 },
          cols: 1,
          rows: 1
        },
        model: 'GFS',
        provider: 'backend-weather-service'
      };

      const result = mapNormalizedWindGridToWebGL(zeroResponse, zeroResponse.grid.bounds, 0);
      expect(result.renderable).toBe(false);
    });
  });

  describe('fetchBackendExactWindPoint', () => {
    it('resolves wind speed successfully', async () => {
      const mockJson = {
        point: {
          speed: 15.4,
          direction: 90.0,
          sampled_lat: 28.4,
          sampled_lng: -80.6
        },
        provider: 'backend-weather-service'
      };

      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockJson)
        })
      );

      const res = await fetchBackendExactWindPoint(28.4, -80.6, 3);
      expect(res.hourly.wind_speed_10m[0]).toBe(15.4);
    });
  });

  describe('fetchBackendExactCopernicusPoint', () => {
    it('resolves swell height successfully', async () => {
      const mockJson = {
        point: {
          speed: 1.8,
          direction: 120.0,
          period: 9.5,
          sampled_lat: 28.4,
          sampled_lng: -80.6
        },
        provider: 'backend-weather-service'
      };

      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockJson)
        })
      );

      // stub diagnostic check
      window.__BACKEND_COPERNICUS_SERVICE_DIAG__ = null;
      updateCopernicusDiagnostics('grid', {
        validTime: '2026-06-02T03:00:00.000Z',
        hourOffset: 3,
        requestedBbox: PILOT_COVERAGE,
        clampedBbox: PILOT_COVERAGE,
        gridVectorCount: 600,
        nonzeroCount: 600,
        renderable: true
      });

      const res = await fetchBackendExactCopernicusPoint(28.4, -80.6, 3);
      expect(res.hourly.swell_wave_height[0]).toBe(1.8);
    });
  });

  describe('selectExactPointHour with grid diagnostics', () => {
    it('returns status no_backend_coverage when GFS grid fallbackReason is set', () => {
      window.__BACKEND_WEATHER_SERVICE_DIAG__ = {
        fallbackReason: 'no_backend_coverage',
        requestedHour: 72,
        lastGridFetch: { hourOffset: 72 }
      };

      const cachedResponse = {
        requestedLat: 28.4,
        requestedLng: -80.0,
        requestedModel: 'GFS',
        activeLayer: 'waves',
        hourly: {
          time: ['2026-06-03T00:00:00Z'],
          wave_height: [1.5],
          wave_direction: [120],
          wave_period: [9.0]
        }
      };

      const res = selectExactPointHour(cachedResponse, 72);
      expect(res.status).toBe('no_backend_coverage');
      expect(res.wave_height).toBeNull();
    });
  });
});
