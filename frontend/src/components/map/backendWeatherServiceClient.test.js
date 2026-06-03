/**
 * backendWeatherServiceClient.test.js
 * 
 * Unit test suite for backendWeatherServiceClient.js.
 * Verifies clamping, valid_time helpers, schema mapping, diagnostics parity, and HTTP fetching fallbacks.
 */

import {
  PILOT_COVERAGE,
  getBackendWeatherFlag,
  getBackendWindFlag,
  getSharedValidTime,
  setCachedManifest,
  clampViewportBbox,
  mapNormalizedGridToWebGL,
  mapNormalizedWindGridToWebGL,
  fetchBackendExactPoint,
  fetchBackendExactWindPoint,
  updateDiagnostics,
  updateWindDiagnostics,
  fetchBackendWindGrid,
  fetchProductsManifest,
  getBackendCopernicusFlag,
  mapNormalizedCopernicusGridToWebGL,
  updateCopernicusDiagnostics,
  fetchBackendCopernicusGrid,
  fetchBackendExactCopernicusPoint
} from './backendWeatherServiceClient';

describe('backendWeatherServiceClient', () => {
  let origFetch;

  beforeAll(() => {
    origFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = origFetch;
  });

  beforeEach(() => {
    // Reset global overrides and overrides in window/localStorage
    if (typeof window !== 'undefined') {
      delete window.__USE_BACKEND_WEATHER_SERVICE__;
      delete window.__BACKEND_WEATHER_SERVICE_DIAG__;
    }
    try {
      localStorage.clear();
    } catch (e) {}
    jest.clearAllMocks();
    setCachedManifest(null);
  });

  describe('getBackendWeatherFlag', () => {
    it('returns false by default', () => {
      expect(getBackendWeatherFlag()).toBe(false);
    });

    it('uses window.__USE_BACKEND_WEATHER_SERVICE__ override if set', () => {
      window.__USE_BACKEND_WEATHER_SERVICE__ = true;
      expect(getBackendWeatherFlag()).toBe(true);

      window.__USE_BACKEND_WEATHER_SERVICE__ = false;
      expect(getBackendWeatherFlag()).toBe(false);
    });

    it('uses localStorage override if set', () => {
      try {
        localStorage.setItem('__USE_BACKEND_WEATHER_SERVICE__', 'true');
        expect(getBackendWeatherFlag()).toBe(true);

        localStorage.setItem('__USE_BACKEND_WEATHER_SERVICE__', 'false');
        expect(getBackendWeatherFlag()).toBe(false);
      } catch (e) {}
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

      const resolvedTime = getSharedValidTime(1); // offset is 1h -> requested is 2026-06-02T01:00:00.000Z
      expect(resolvedTime).toBe('2026-06-02T01:00:00.000Z');

      Date.now = originalDateNow;
      setCachedManifest(null);
    });

    it('falls back to rounded requestedValidTime when closest manifest product is > 3h', () => {
      const mockManifest = {
        products: [
          {
            model: 'GFS',
            domain: 'marine',
            layer: 'waves',
            valid_time_start: '2026-06-02T10:00:00.000Z'
          }
        ]
      };
      setCachedManifest(mockManifest);

      const originalDateNow = Date.now;
      Date.now = () => new Date('2026-06-02T00:00:00Z').getTime();

      const resolvedTime = getSharedValidTime(0); // requested: 2026-06-02T00:00:00.000Z. manifest is 10h delta.
      expect(resolvedTime).toBe('2026-06-02T00:00:00.000Z');

      Date.now = originalDateNow;
      setCachedManifest(null);
    });

    it('forces manifest refresh when products list is empty', async () => {
      setCachedManifest({ products: [] });
      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ products: [{ model: 'GFS', domain: 'wind', layer: 'wind', valid_time_start: '2026-06-02T03:00:00.000Z' }] })
        })
      );
      
      const res = await fetchProductsManifest(true);
      expect(res.products.length).toBe(1);
      setCachedManifest(null);
    });
  });

  describe('clampViewportBbox', () => {
    it('returns isInside: false if bbox is missing', () => {
      const res = clampViewportBbox(null);
      expect(res.isInside).toBe(false);
      expect(res.fallbackReason).toBe('Missing requested bounding box coordinates');
    });

    it('returns isInside: false if bbox is completely outside coverage bounds', () => {
      // Entirely west of coverage bounds (-85.0)
      const bboxWest = { west: -90.0, south: 25.0, east: -86.0, north: 30.0 };
      const resWest = clampViewportBbox(bboxWest);
      expect(resWest.isInside).toBe(false);
      expect(resWest.fallbackReason).toContain('completely outside GFS Waves pilot coverage area');

      // Entirely north of coverage bounds (31.0)
      const bboxNorth = { west: -84.0, south: 32.0, east: -80.0, north: 35.0 };
      const resNorth = clampViewportBbox(bboxNorth);
      expect(resNorth.isInside).toBe(false);
    });

    it('performs intersection clamping if viewport overlaps with coverage bounds', () => {
      const bboxOverlap = { west: -88.0, south: 23.0, east: -80.0, north: 30.0 };
      const res = clampViewportBbox(bboxOverlap);
      expect(res.isInside).toBe(true);
      expect(res.clampedBbox.west).toBe(-85.0); // clamped to PILOT_COVERAGE.west
      expect(res.clampedBbox.south).toBe(24.0); // clamped to PILOT_COVERAGE.south
      expect(res.clampedBbox.east).toBe(-80.0); // unchanged
      expect(res.clampedBbox.north).toBe(30.0); // unchanged
    });

    it('returns the same coordinates if viewport is completely inside coverage bounds', () => {
      const bboxInside = { west: -84.0, south: 25.0, east: -81.0, north: 29.0 };
      const res = clampViewportBbox(bboxInside);
      expect(res.isInside).toBe(true);
      expect(res.clampedBbox.west).toBe(-84.0);
      expect(res.clampedBbox.south).toBe(25.0);
      expect(res.clampedBbox.east).toBe(-81.0);
      expect(res.clampedBbox.north).toBe(29.0);
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
      expect(result.grid.__sourceModel).toBe('GFS');
      expect(result.grid.__componentLayer).toBe('waves');
      expect(result.grid.__renderable).toBe(true);
      expect(result.hourOffset).toBe(4);
    });

    it('rejects all-zero speed grids as renderable: false', () => {
      const zeroResponse = {
        grid: {
          vectors: [
            { lat: 28.0, lng: -82.0, u: 0.0, v: 0.0, speed: 0.0, period: 0.0 }
          ],
          bounds: { west: -85.0, south: 24.0, east: -79.0, north: 31.0 },
          cols: 1,
          rows: 1
        },
        provider: 'backend-weather-service'
      };
      const result = mapNormalizedGridToWebGL(zeroResponse, zeroResponse.grid.bounds, 0);
      expect(result.grid.renderable).toBe(false);
      expect(result.grid.__gridSupportsLayer).toBe(false);
      expect(result.grid.emptyGridWarning).toContain("All vectors in grid are zero or null");
    });

    it('throws error for invalid schema shapes', () => {
      expect(() => mapNormalizedGridToWebGL(null)).toThrow('Invalid normalized grid response structure');
      expect(() => mapNormalizedGridToWebGL({ invalid: true })).toThrow();
    });

    it('maps backend response schema correctly when layer is swell_1', () => {
      const sampleResponse = {
        grid: {
          vectors: [
            { lat: 28.0, lng: -82.0, u: 0.5, v: -0.5, speed: 0.7, period: 9.0 }
          ],
          bounds: { west: -85.0, south: 24.0, east: -79.0, north: 31.0 },
          cols: 1,
          rows: 1
        },
        provider: 'backend-weather-service'
      };

      const result = mapNormalizedGridToWebGL(sampleResponse, sampleResponse.grid.bounds, 4, 'swell_1');
      expect(result.grid.cols).toBe(1);
      expect(result.grid.vectors[0].swell_1.speed).toBe(0.7);
      expect(result.grid.vectors[0].swell_1.period).toBe(9.0);
      expect(result.grid.vectors[0].waves.speed).toBe(0);
      expect(result.grid.__componentLayer).toBe('swell_1');
      expect(result.grid.renderable).toBe(true);
    });
  });

  describe('updateDiagnostics', () => {
    it('sets and recalculates telemetry state correctly', () => {
      window.__BACKEND_WEATHER_SERVICE_DIAG__ = {
        gridValidTime: null,
        pointValidTime: null,
        parity: false
      };

      updateDiagnostics('grid', {
        validTime: '2026-06-01T23:00:00.000Z',
        hourOffset: 3,
        requestedBbox: { west: -85, south: 24, east: -79, north: 31 },
        clampedBbox: { west: -85, south: 24, east: -79, north: 31 }
      });

      expect(window.__BACKEND_WEATHER_SERVICE_DIAG__.gridValidTime).toBe('2026-06-01T23:00:00.000Z');
      expect(window.__BACKEND_WEATHER_SERVICE_DIAG__.requestedHour).toBe(3);

      updateDiagnostics('point', {
        validTime: '2026-06-01T23:00:00.000Z',
        hourOffset: 3
      });

      expect(window.__BACKEND_WEATHER_SERVICE_DIAG__.pointValidTime).toBe('2026-06-01T23:00:00.000Z');
      expect(window.__BACKEND_WEATHER_SERVICE_DIAG__.parity).toBe(true);
    });

    it('handles coverage checks and sets outside coverage diagnostics flags correctly', () => {
      updateDiagnostics('grid', {
        validTime: '2026-06-01T23:00:00.000Z',
        hourOffset: 3,
        requestedBbox: { west: -95, south: 24, east: -90, north: 31 },
        clampedBbox: null,
        coverageInside: false,
        fallbackReason: 'Requested viewport completely outside GFS Waves pilot coverage area'
      });

      const diag = window.__BACKEND_WEATHER_SERVICE_DIAG__;
      expect(diag.coverageInside).toBe(false);
      expect(diag.fallbackToLegacy).toBe(true);
      expect(diag.reason).toBe('outside_pilot_coverage');
      expect(diag.fallbackReason).toBe('Requested viewport completely outside GFS Waves pilot coverage area');
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
      expect(res.provider).toBe('backend-weather-service');
      expect(res.snappedLat).toBe(28.4);
    });

    it('rejects on HTTP failures', async () => {
      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500
        })
      );

      await expect(fetchBackendExactPoint(28.4, -80.6, 1)).rejects.toThrow('Backend point returned HTTP 500');
    });

    it('resolves point data successfully for swell_1 layer with conformed hourly fields', async () => {
      const mockJson = {
        point: {
          speed: 0.85,
          direction: 110,
          period: 9.5,
          sampled_lat: 28.39,
          sampled_lng: -80.35
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

      const res = await fetchBackendExactPoint(28.39, -80.35, 1, null, 'swell_1');
      expect(res.hourly.swell_wave_height[0]).toBe(0.85);
      expect(res.hourly.swell_wave_direction[0]).toBe(110);
      expect(res.hourly.swell_wave_period[0]).toBe(9.5);
      expect(res.hourly.swell_wave_peak_period[0]).toBe(0);
      expect(res.hourly.wave_height[0]).toBe(0);
      expect(res.activeLayer).toBe('swell_1');
    });
  });

  describe('getBackendWindFlag', () => {
    it('returns false by default', () => {
      expect(getBackendWindFlag()).toBe(false);
    });

    it('uses window.__USE_BACKEND_WIND_SERVICE__ override if set', () => {
      window.__USE_BACKEND_WIND_SERVICE__ = true;
      expect(getBackendWindFlag()).toBe(true);

      window.__USE_BACKEND_WIND_SERVICE__ = false;
      expect(getBackendWindFlag()).toBe(false);
    });
  });

  describe('getSharedValidTime for wind', () => {
    it('snaps to wind product in manifest', () => {
      const mockManifest = {
        products: [
          {
            model: 'GFS',
            domain: 'wind',
            layer: 'wind',
            valid_time_start: '2026-06-02T03:00:00.000Z'
          }
        ]
      };
      setCachedManifest(mockManifest);

      const originalDateNow = Date.now;
      Date.now = () => new Date('2026-06-02T00:00:00Z').getTime();

      const resolvedTime = getSharedValidTime(3, 'wind');
      expect(resolvedTime).toBe('2026-06-02T03:00:00.000Z');

      Date.now = originalDateNow;
      setCachedManifest(null);
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

  describe('fetchBackendWindGrid out of bounds', () => {
    it('rejects and throws if requested bbox is outside Florida pilot bounds', async () => {
      const oobBbox = { west: -120.0, south: 40.0, east: -110.0, north: 45.0 };
      await expect(fetchBackendWindGrid(oobBbox, 0, null, oobBbox, 'controller')).rejects.toThrow('viewport completely outside');
      
      const diag = window.__BACKEND_WIND_SERVICE_DIAG__;
      expect(diag.coverageInside).toBe(false);
      expect(diag.fallbackToLegacy).toBe(true);
      expect(diag.boundsSource).toBe('controller');
      expect(diag.fallbackReason).toBe('Requested viewport completely outside GFS Wind pilot coverage area');
    });

    it('falls back to window.map if bounds are missing', async () => {
      window.map = {
        getBounds: () => ({
          getWest: () => -120.0,
          getSouth: () => 40.0,
          getEast: () => -110.0,
          getNorth: () => 45.0
        })
      };
      await expect(fetchBackendWindGrid(null, 0, null, null)).rejects.toThrow('viewport completely outside');
      const diag = window.__BACKEND_WIND_SERVICE_DIAG__;
      expect(diag.boundsSource).toBe('window_map');
      delete window.map;
    });
  });

  describe('fetchBackendExactWindPoint', () => {
    it('resolves wind speed and direction successfully and populates lastPointFetch and pointParity', async () => {
      const mockManifest = {
        products: [
          {
            model: 'GFS',
            domain: 'wind',
            layer: 'wind',
            valid_time_start: '2026-06-02T03:00:00.000Z'
          }
        ]
      };
      setCachedManifest(mockManifest);

      const originalDateNow = Date.now;
      Date.now = () => new Date('2026-06-02T00:00:00Z').getTime();

      const mockJson = {
        point: {
          speed: 15.4,
          direction: 90.0,
          sampled_lat: 28.4,
          sampled_lng: -80.6,
          interpolation_method: 'bilinear'
        },
        provider: 'backend-weather-service',
        value_kind: 'wind_speed',
        value_unit: 'kn',
        display_unit_hint: 'kn'
      };

      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockJson)
        })
      );

      // Verify initial parity is pending_point_fetch
      window.__BACKEND_WIND_SERVICE_DIAG__ = null;
      updateWindDiagnostics('grid', {
        validTime: '2026-06-02T03:00:00.000Z',
        hourOffset: 3,
        requestedBbox: PILOT_COVERAGE,
        clampedBbox: PILOT_COVERAGE,
        gridVectorCount: 725,
        nonzeroCount: 725,
        renderable: true
      });
      expect(window.__BACKEND_WIND_SERVICE_DIAG__.pointParity).toBe('pending_point_fetch');

      const res = await fetchBackendExactWindPoint(28.4, -80.6, 3);
      expect(res.hourly.wind_speed_10m[0]).toBe(15.4);
      expect(res.hourly.wind_direction_10m[0]).toBe(90.0);
      expect(res.provider).toBe('backend-weather-service');

      const diag = window.__BACKEND_WIND_SERVICE_DIAG__;
      expect(diag.lastPointFetch).not.toBeNull();
      expect(diag.lastPointFetch.speed).toBe(15.4);
      expect(diag.lastPointFetch.direction).toBe(90.0);
      expect(diag.lastPointFetch.interpolationMethod).toBe('bilinear');
      expect(diag.lastPointFetch.provider).toBe('backend-weather-service');
      expect(diag.pointParity).toBe(true); // both grid and point times are '2026-06-02T03:00:00.000Z'

      Date.now = originalDateNow;
      setCachedManifest(null);
    });
  });

  describe('getBackendCopernicusFlag', () => {
    it('returns false by default', () => {
      expect(getBackendCopernicusFlag()).toBe(false);
    });

    it('uses window.__USE_BACKEND_COPERNICUS_SERVICE__ override if set', () => {
      window.__USE_BACKEND_COPERNICUS_SERVICE__ = true;
      expect(getBackendCopernicusFlag()).toBe(true);

      window.__USE_BACKEND_COPERNICUS_SERVICE__ = false;
      expect(getBackendCopernicusFlag()).toBe(false);
    });
  });

  describe('mapNormalizedCopernicusGridToWebGL', () => {
    it('maps backend response schema to expected WebGL swell/waves properties', () => {
      const sampleResponse = {
        grid: {
          vectors: [
            { lat: 28.0, lng: -82.0, u: 0.5, v: -0.5, speed: 0.707, period: 9.0 }
          ],
          bounds: { west: -85.0, south: 24.0, east: -79.0, north: 31.0 },
          cols: 1,
          rows: 1
        },
        provider: 'backend-weather-service'
      };

      const result = mapNormalizedCopernicusGridToWebGL(sampleResponse, sampleResponse.grid.bounds, 2, 'swell_1');
      expect(result.grid.cols).toBe(1);
      expect(result.grid.vectors[0].swell_1.speed).toBe(0.707);
      expect(result.grid.vectors[0].swell_1.period).toBe(9.0);
      expect(result.grid.__sourceModel).toBe('EURO');
      expect(result.grid.__componentLayer).toBe('swell_1');
      expect(result.grid.__renderable).toBe(true);
      expect(result.hourOffset).toBe(2);
    });

    it('maps backend response schema to expected WebGL waves layer properties', () => {
      const sampleResponse = {
        grid: {
          vectors: [
            { lat: 28.0, lng: -82.0, u: 0.6, v: -0.8, speed: 1.0, period: 10.0 }
          ],
          bounds: { west: -85.0, south: 24.0, east: -79.0, north: 31.0 },
          cols: 1,
          rows: 1
        },
        provider: 'backend-weather-service'
      };

      const result = mapNormalizedCopernicusGridToWebGL(sampleResponse, sampleResponse.grid.bounds, 2, 'waves');
      expect(result.grid.vectors[0].waves.speed).toBe(1.0);
      expect(result.grid.vectors[0].waves.period).toBe(10.0);
      expect(result.grid.__componentLayer).toBe('waves');
    });
  });

  describe('fetchBackendCopernicusGrid out of bounds', () => {
    it('rejects and throws if requested bbox is outside Florida pilot bounds', async () => {
      const oobBbox = { west: -120.0, south: 40.0, east: -110.0, north: 45.0 };
      await expect(fetchBackendCopernicusGrid(oobBbox, 0, null, oobBbox, 'controller')).rejects.toThrow('viewport completely outside');
      
      const diag = window.__BACKEND_COPERNICUS_SERVICE_DIAG__;
      expect(diag.coverageInside).toBe(false);
      expect(diag.fallbackToLegacy).toBe(true);
      expect(diag.boundsSource).toBe('controller');
      expect(diag.fallbackReason).toBe('Requested viewport completely outside Copernicus Waves pilot coverage area');
    });
  });

  describe('fetchBackendExactCopernicusPoint', () => {
    it('resolves swell height and direction successfully and updates telemetry', async () => {
      const mockManifest = {
        products: [
          {
            model: 'EURO',
            domain: 'marine',
            layer: 'swell_1',
            valid_time_start: '2026-06-02T03:00:00.000Z'
          }
        ]
      };
      setCachedManifest(mockManifest);

      const originalDateNow = Date.now;
      Date.now = () => new Date('2026-06-02T00:00:00Z').getTime();

      const mockJson = {
        point: {
          speed: 1.8,
          direction: 120.0,
          period: 9.5,
          sampled_lat: 28.4,
          sampled_lng: -80.6,
          interpolation_method: 'bilinear'
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

      // Verify initial parity is pending_point_fetch
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
      expect(window.__BACKEND_COPERNICUS_SERVICE_DIAG__.pointParity).toBe('pending_point_fetch');

      const res = await fetchBackendExactCopernicusPoint(28.4, -80.6, 3);
      expect(res.hourly.swell_wave_height[0]).toBe(1.8);
      expect(res.hourly.swell_wave_direction[0]).toBe(120.0);
      expect(res.hourly.swell_wave_period[0]).toBe(9.5);
      expect(res.provider).toBe('backend-weather-service');

      const diag = window.__BACKEND_COPERNICUS_SERVICE_DIAG__;
      expect(diag.lastPointFetch).not.toBeNull();
      expect(diag.lastPointFetch.speed).toBe(1.8);
      expect(diag.lastPointFetch.direction).toBe(120.0);
      expect(diag.lastPointFetch.interpolationMethod).toBe('bilinear');
      expect(diag.pointParity).toBe(true);

      Date.now = originalDateNow;
      setCachedManifest(null);
    });

    it('resolves secondary swell height and direction successfully and updates telemetry for swell_2', async () => {
      const mockManifest = {
        products: [
          {
            model: 'EURO',
            domain: 'marine',
            layer: 'swell_2',
            valid_time_start: '2026-06-02T03:00:00.000Z'
          }
        ]
      };
      setCachedManifest(mockManifest);

      const originalDateNow = Date.now;
      Date.now = () => new Date('2026-06-02T00:00:00Z').getTime();

      const mockJson = {
        point: {
          speed: 1.2,
          direction: 140.0,
          period: 8.5,
          sampled_lat: 28.4,
          sampled_lng: -80.6,
          interpolation_method: 'bilinear'
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

      window.__BACKEND_COPERNICUS_SERVICE_DIAG__ = null;
      updateCopernicusDiagnostics('grid', {
        validTime: '2026-06-02T03:00:00.000Z',
        hourOffset: 3,
        requestedBbox: PILOT_COVERAGE,
        clampedBbox: PILOT_COVERAGE,
        gridVectorCount: 600,
        nonzeroCount: 600,
        renderable: true,
        layer: 'swell_2'
      });

      const res = await fetchBackendExactCopernicusPoint(28.4, -80.6, 3, null, 'swell_2');
      expect(res.hourly.secondary_swell_wave_height[0]).toBe(1.2);
      expect(res.hourly.secondary_swell_wave_direction[0]).toBe(140.0);
      expect(res.hourly.secondary_swell_wave_period[0]).toBe(8.5);
      expect(res.provider).toBe('backend-weather-service');

      const diag = window.__BACKEND_COPERNICUS_SERVICE_DIAG__;
      expect(diag.layer).toBe('swell_2');
      expect(diag.lastPointFetch.speed).toBe(1.2);
      expect(diag.lastPointFetch.direction).toBe(140.0);

      Date.now = originalDateNow;
      setCachedManifest(null);
    });

    it('resolves wind waves height and direction successfully and updates telemetry for wind_waves', async () => {
      const mockManifest = {
        products: [
          {
            model: 'EURO',
            domain: 'marine',
            layer: 'wind_waves',
            valid_time_start: '2026-06-02T03:00:00.000Z'
          }
        ]
      };
      setCachedManifest(mockManifest);

      const originalDateNow = Date.now;
      Date.now = () => new Date('2026-06-02T00:00:00Z').getTime();

      const mockJson = {
        point: {
          speed: 1.5,
          direction: 100.0,
          period: 5.5,
          sampled_lat: 28.4,
          sampled_lng: -80.6,
          interpolation_method: 'bilinear'
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

      window.__BACKEND_COPERNICUS_SERVICE_DIAG__ = null;
      updateCopernicusDiagnostics('grid', {
        validTime: '2026-06-02T03:00:00.000Z',
        hourOffset: 3,
        requestedBbox: PILOT_COVERAGE,
        clampedBbox: PILOT_COVERAGE,
        gridVectorCount: 600,
        nonzeroCount: 600,
        renderable: true,
        layer: 'wind_waves'
      });

      const res = await fetchBackendExactCopernicusPoint(28.4, -80.6, 3, null, 'wind_waves');
      expect(res.hourly.wind_wave_height[0]).toBe(1.5);
      expect(res.hourly.wind_wave_direction[0]).toBe(100.0);
      expect(res.hourly.wind_wave_period[0]).toBe(5.5);
      expect(res.provider).toBe('backend-weather-service');

      const diag = window.__BACKEND_COPERNICUS_SERVICE_DIAG__;
      expect(diag.layer).toBe('wind_waves');
      expect(diag.lastPointFetch.speed).toBe(1.5);
      expect(diag.lastPointFetch.direction).toBe(100.0);

      Date.now = originalDateNow;
      setCachedManifest(null);
    });

    it('resolves base waves height and direction successfully and updates telemetry for waves', async () => {
      const mockManifest = {
        products: [
          {
            model: 'EURO',
            domain: 'marine',
            layer: 'waves',
            valid_time_start: '2026-06-02T03:00:00.000Z'
          }
        ]
      };
      setCachedManifest(mockManifest);

      const originalDateNow = Date.now;
      Date.now = () => new Date('2026-06-02T00:00:00Z').getTime();

      const mockJson = {
        point: {
          speed: 2.2,
          direction: 180.0,
          period: 9.0,
          sampled_lat: 28.4,
          sampled_lng: -80.6,
          interpolation_method: 'bilinear'
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

      window.__BACKEND_COPERNICUS_SERVICE_DIAG__ = null;
      updateCopernicusDiagnostics('grid', {
        validTime: '2026-06-02T03:00:00.000Z',
        hourOffset: 3,
        requestedBbox: PILOT_COVERAGE,
        clampedBbox: PILOT_COVERAGE,
        gridVectorCount: 600,
        nonzeroCount: 600,
        renderable: true,
        layer: 'waves'
      });

      const res = await fetchBackendExactCopernicusPoint(28.4, -80.6, 3, null, 'waves');
      expect(res.hourly.wave_height[0]).toBe(2.2);
      expect(res.hourly.wave_direction[0]).toBe(180.0);
      expect(res.hourly.wave_period[0]).toBe(9.0);
      expect(res.hourly.wave_peak_period[0]).toBe(0);
      expect(res.provider).toBe('backend-weather-service');

      const diag = window.__BACKEND_COPERNICUS_SERVICE_DIAG__;
      expect(diag.layer).toBe('waves');
      expect(diag.lastPointFetch.speed).toBe(2.2);
      expect(diag.lastPointFetch.direction).toBe(180.0);

      Date.now = originalDateNow;
      setCachedManifest(null);
    });
  });
});
