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
      const res = clampViewportBbox(null, 'waves', 'COPERNICUS');
      expect(res.isInside).toBe(false);
      expect(res.fallbackReason).toBe('Missing requested bounding box coordinates');
    });

    it('returns isInside: false if bbox is completely outside coverage bounds', () => {
      // Entirely west of coverage bounds (-85.0)
      const bboxWest = { west: -90.0, south: 25.0, east: -86.0, north: 30.0 };
      const resWest = clampViewportBbox(bboxWest, 'waves', 'COPERNICUS');
      expect(resWest.isInside).toBe(false);
      // Without manifest, fallback uses REGIONAL_TILES but bbox doesn't intersect
      expect(resWest.fallbackReason).toBeTruthy();

      // Entirely north of coverage bounds (31.0)
      const bboxNorth = { west: -84.0, south: 32.0, east: -80.0, north: 35.0 };
      const resNorth = clampViewportBbox(bboxNorth, 'waves', 'COPERNICUS');
      expect(resNorth.isInside).toBe(false);
    });

    it('returns isInside: false for EURO if viewport is completely outside coverage bounds', () => {
      const bboxPacific = { west: -150.0, south: 10.0, east: -130.0, north: 30.0 };
      const res = clampViewportBbox(bboxPacific, 'waves', 'EURO');
      expect(res.isInside).toBe(false);
      expect(res.fallbackReason).toBe('outside_coverage_clear');
    });

    it('performs intersection clamping if viewport overlaps with coverage bounds', () => {
      const bboxOverlap = { west: -88.0, south: 23.0, east: -80.0, north: 30.0 };
      const res = clampViewportBbox(bboxOverlap, 'waves', 'COPERNICUS');
      expect(res.isInside).toBe(true);
      expect(res.clampedBbox.west).toBe(-85.0); // clamped to PILOT_COVERAGE.west
      expect(res.clampedBbox.south).toBe(24.0); // clamped to PILOT_COVERAGE.south
      expect(res.clampedBbox.east).toBe(-80.0); // unchanged
      expect(res.clampedBbox.north).toBe(30.0); // unchanged
    });

    it('returns the same coordinates if viewport is completely inside coverage bounds', () => {
      const bboxInside = { west: -84.0, south: 25.0, east: -81.0, north: 29.0 };
      const res = clampViewportBbox(bboxInside, 'waves', 'COPERNICUS');
      expect(res.isInside).toBe(true);
      expect(res.clampedBbox.west).toBe(-84.0);
      expect(res.clampedBbox.south).toBe(25.0);
      expect(res.clampedBbox.east).toBe(-81.0);
      expect(res.clampedBbox.north).toBe(29.0);
    });

    it('returns global bounds for GFS, EURO, and ICON when viewport span is wide', () => {
      const bboxWide = { west: -120.0, south: 10.0, east: -60.0, north: 50.0 }; // span is 60°
      
      const resGFS = clampViewportBbox(bboxWide, 'waves', 'GFS');
      expect(resGFS.isInside).toBe(true);
      expect(resGFS.clampedBbox).toEqual({ west: -180, south: -80, east: 180, north: 85 });
      expect(resGFS.selectedTileId).toBe('global_coarse');

      // 2026-07-06 (chip task_57426922): EURO now takes the SAME global branch for wide spans —
      // the old center-clamped viewport box, fed a WORLD viewport, centered on (0,0)±10 = the
      // log-proven null-island bbox (-10,-10,10,10) that far-hour scrubs 404-looped on.
      const resEURO = clampViewportBbox(bboxWide, 'waves', 'EURO');
      expect(resEURO.isInside).toBe(true);
      expect(resEURO.clampedBbox).toEqual({ west: -180, south: -80, east: 180, north: 85 });
      expect(resEURO.selectedTileId).toBe('global_coarse');

      const resICON = clampViewportBbox(bboxWide, 'waves', 'ICON');
      expect(resICON.isInside).toBe(true);
      expect(resICON.clampedBbox).toEqual({ west: -180, south: -80, east: 180, north: 85 });
      expect(resICON.selectedTileId).toBe('global_coarse');
    });

    it('EURO world viewport NEVER produces the null-island box (2026-07-06 regression pin)', () => {
      const world = { west: -180, south: -85, east: 180, north: 85 };
      const res = clampViewportBbox(world, 'waves', 'EURO');
      expect(res.isInside).toBe(true);
      expect(res.clampedBbox).toEqual({ west: -180, south: -80, east: 180, north: 85 });
      expect(res.clampedBbox).not.toEqual({ west: -10, south: -10, east: 10, north: 10 });
      expect(res.selectedTileId).toBe('global_coarse');
    });

    it('EURO regional spans (≤15°) keep the dynamic-subset path with the 20° cost cap intact', () => {
      const regional = { west: -122, south: 30, east: -114, north: 38 }; // 8° span
      const res = clampViewportBbox(regional, 'waves', 'EURO');
      expect(res.isInside).toBe(true);
      // not globalized — stays a viewport-scoped request
      expect(res.clampedBbox.east - res.clampedBbox.west).toBeLessThanOrEqual(20.0);
      expect(res.selectedTileId).not.toBe('global_coarse');
    });

    // FINE VIEWPORT TILE (2026-07-04, the "cleared/coarse at z9.22" root): the backend serves a fine
    // 0.25° grid ONLY when the request fits within a SINGLE 2°-aligned tile. A close-zoom GFS viewport
    // (span ≤ 2° both dims) must snap to the ONE 2° tile containing its center — not the old 1° snap,
    // which could straddle a 2° boundary and fall back to global_coarse.
    it('GFS keeps the single-2°-tile fast path when the viewport is FULLY INSIDE the tile', () => {
      const res = clampViewportBbox({ west: 14.2, south: 44.3, east: 15.8, north: 45.7 }, 'waves', 'GFS');
      expect(res.isInside).toBe(true);
      expect(res.clampedBbox).toEqual({ west: 14, south: 44, east: 16, north: 46 }); // one 2° tile
      expect(res.selectedTileId).toBe('viewport_14.00_44.00_16.00_46.00');
    });

    it('GFS STRADDLING ≤2° viewport falls to the covering 1° snap (2026-07-05 straddle guard)', () => {
      // Kvarner viewport straddling the 14° boundary: the center-tile shortcut left a dead coarse-wash
      // ring over the sliver outside the tile (the Irvine "clamping below / cleared above" report).
      // A straddler now requests the covering snap → the backend mid tier serves a COVERING clipped
      // grid instantly and the SWR revalidation sharpens it to the fine 0.25° viewport grid.
      const res = clampViewportBbox({ west: 13.9, south: 44.6, east: 15.1, north: 45.4 }, 'waves', 'GFS');
      expect(res.isInside).toBe(true);
      expect(res.clampedBbox).toEqual({ west: 13, south: 44, east: 16, north: 46 }); // covering snap
      expect(res.selectedTileId).not.toBe('viewport_14.00_44.00_16.00_46.00');
    });

    it('GFS keeps global for a wide viewport and does NOT hit the fine-tile branch above 2°', () => {
      // span 3° (> 2°): the backend has no fine product there → the 1° snap path (not the fine tile).
      const res = clampViewportBbox({ west: 14.0, south: 44.0, east: 17.0, north: 46.0 }, 'waves', 'GFS');
      expect(res.selectedTileId).not.toBe('viewport_14.00_44.00_16.00_46.00');
    });
  });

  describe('getAvailableTilesFromManifest', () => {
    it('returns {tiles: REGIONAL_TILES, fallbackReason: manifest_not_loaded} if manifest is empty', () => {
      const result = getAvailableTilesFromManifest();
      expect(result.tiles).toEqual(REGIONAL_TILES);
      expect(result.fallbackReason).toBe('manifest_not_loaded');
      expect(result.hasTimeMatch).toBe(false);
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
      const result = getAvailableTilesFromManifest();
      expect(result.tiles.length).toBe(1);
      expect(result.tiles[0].id).toBe('us_west_coast_socal');
      expect(result.fallbackReason).toBeNull();
    });

    it('filters by domain and layer', () => {
      const mockManifest = {
        products: [
          { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'florida_east_coast', coverage: { west: -85, south: 24, east: -79, north: 31 } },
          { model: 'GFS', domain: 'wind', layer: 'wind', region_id: 'florida_wind', coverage: { west: -85, south: 24, east: -79, north: 31 } }
        ]
      };
      setCachedManifest(mockManifest);

      // Filter marine domain only
      const marineResult = getAvailableTilesFromManifest('GFS', 'marine', 'waves');
      expect(marineResult.tiles.length).toBe(1);
      expect(marineResult.tiles[0].id).toBe('florida_east_coast');

      // Filter wind domain only
      const windResult = getAvailableTilesFromManifest('GFS', 'wind', 'wind');
      expect(windResult.tiles.length).toBe(1);
      expect(windResult.tiles[0].id).toBe('florida_wind');

      // Filter domain that has no products
      const emptyResult = getAvailableTilesFromManifest('GFS', 'marine', 'wind');
      expect(emptyResult.tiles.length).toBe(0);
      expect(emptyResult.fallbackReason).toBe('no_matching_products');
    });

    it('returns no_matching_products when manifest has products but none match', () => {
      const mockManifest = {
        products: [
          { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'florida_east_coast', coverage: { west: -85, south: 24, east: -79, north: 31 } }
        ]
      };
      setCachedManifest(mockManifest);

      const result = getAvailableTilesFromManifest('ICON', 'marine', 'waves');
      expect(result.tiles.length).toBe(0);
      expect(result.fallbackReason).toBe('no_matching_products');
    });

    it('does not use REGIONAL_TILES fallback for unsupported layers', () => {
      const mockManifest = {
        products: [
          { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'florida_east_coast', coverage: { west: -85, south: 24, east: -79, north: 31 } }
        ]
      };
      setCachedManifest(mockManifest);

      // swell_2 not in manifest — must return empty tiles, not REGIONAL_TILES
      const result = getAvailableTilesFromManifest('GFS', 'marine', 'swell_2');
      expect(result.tiles.length).toBe(0);
      expect(result.fallbackReason).toBe('no_matching_products');
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
