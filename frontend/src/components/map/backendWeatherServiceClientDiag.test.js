/**
 * backendWeatherServiceClientDiag.test.js
 * 
 * Unit test suite for backendWeatherServiceClientDiag.js.
 */

import {
  updateDiagnostics,
  updateProjectionDiag
} from './backendWeatherServiceClientDiag';
import { PILOT_COVERAGE } from './backendWeatherServiceClientCoverage';

describe('backendWeatherServiceClientDiag', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      delete window.__BACKEND_WEATHER_SERVICE_DIAG__;
      delete window.__MARINE_PROJECTION_DIAG__;
    }
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
        fallbackReason: 'outside_coverage_clear'
      });

      const diag = window.__BACKEND_WEATHER_SERVICE_DIAG__;
      expect(diag.coverageInside).toBe(false);
      expect(diag.fallbackToLegacy).toBe(true);
      expect(diag.reason).toBe('outside_coverage');
      expect(diag.fallbackReason).toBe('outside_coverage_clear');
    });
  });

  describe('updateProjectionDiag', () => {
    it('sets the __MARINE_PROJECTION_DIAG__ registry with conformed fields', () => {
      updateProjectionDiag('marine', {
        activeModel: 'GFS',
        activeLayer: 'waves',
        requestedViewportBounds: PILOT_COVERAGE,
        backendRequestBbox: '-85,24,-79,31',
        responseGridBounds: PILOT_COVERAGE,
        coverageBounds: PILOT_COVERAGE,
        cols: 10,
        rows: 10,
        vectorCount: 100,
        productId: 'gfs_marine_waves',
        provider: 'open-meteo',
        renderable: true,
        selectedTileId: 'florida_east_coast',
        validTime: '2026-06-01T23:00:00.000Z'
      });

      const diag = window.__MARINE_PROJECTION_DIAG__;
      expect(diag).toBeDefined();
      expect(diag.coverageMode).toBe('regional_tile');
      expect(diag.selectedTileId).toBe('florida_east_coast');
      expect(diag.productId).toBe('gfs_marine_waves');
      expect(diag.validTime).toBe('2026-06-01T23:00:00.000Z');
    });
  });
});
