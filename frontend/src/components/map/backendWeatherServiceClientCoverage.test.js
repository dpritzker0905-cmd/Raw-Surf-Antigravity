/**
 * backendWeatherServiceClientCoverage.test.js
 * 
 * Unit test suite for backendWeatherServiceClientCoverage.js.
 */

import {
  PILOT_COVERAGE,
  REGIONAL_TILES,
  clampViewportBbox,
  getAvailableTilesFromManifest,
  getProductCoverage
} from './backendWeatherServiceClientCoverage';
import { setCachedManifest } from './backendWeatherServiceClient';

describe('backendWeatherServiceClientCoverage', () => {
  beforeEach(() => {
    setCachedManifest(null);
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
      expect(resWest.fallbackReason).toBe('outside_coverage_clear');

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

  describe('getAvailableTilesFromManifest', () => {
    it('returns default REGIONAL_TILES if manifest is empty', () => {
      expect(getAvailableTilesFromManifest()).toEqual(REGIONAL_TILES);
    });

    it('extracts unique region_ids from manifest products', () => {
      const mockManifest = {
        products: [
          {
            model: 'GFS',
            domain: 'marine',
            layer: 'waves',
            region_id: 'us_west_coast_socal',
            coverage: { west: -125, south: 30, east: -115, north: 38 }
          }
        ]
      };
      setCachedManifest(mockManifest);
      const tiles = getAvailableTilesFromManifest();
      expect(tiles.length).toBe(1);
      expect(tiles[0].id).toBe('us_west_coast_socal');
    });
  });

  describe('getProductCoverage', () => {
    it('falls back to PILOT_COVERAGE if manifest is empty', () => {
      const res = getProductCoverage('GFS', 'marine', 'waves');
      expect(res.isFallback).toBe(true);
      expect(res.coverage).toEqual(PILOT_COVERAGE);
    });
  });
});
