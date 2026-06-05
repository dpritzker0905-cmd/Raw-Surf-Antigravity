/**
 * backendWeatherServiceClientCoverage.js
 * 
 * Extracted coverage and bounding box calculations for backend weather service.
 */

import { getCachedManifest } from './backendWeatherServiceClient';

export const PILOT_COVERAGE = {
  west: -85.0,
  south: 24.0,
  east: -79.0,
  north: 31.0
};

export const REGIONAL_TILES = [
  {
    id: "florida_east_coast",
    bounds: { west: -85.0, south: 24.0, east: -79.0, north: 31.0 }
  },
  {
    id: "us_west_coast_socal",
    bounds: { west: -125.0, south: 30.0, east: -115.0, north: 38.0 }
  }
];

/**
 * Extracts active tile definitions dynamically from the backend products manifest.
 * Falls back to hardcoded REGIONAL_TILES if manifest is empty or not yet loaded.
 */
export function getAvailableTilesFromManifest() {
  const cachedManifest = getCachedManifest();
  if (!cachedManifest || !Array.isArray(cachedManifest.products) || cachedManifest.products.length === 0) {
    return REGIONAL_TILES;
  }
  
  const seen = new Set();
  const tiles = [];
  
  for (const p of cachedManifest.products) {
    let regionId = p.region_id;
    if (!regionId && p.coverage) {
      const isFlorida = Math.abs(p.coverage.west - (-85.0)) < 0.1 &&
                        Math.abs(p.coverage.south - 24.0) < 0.1 &&
                        Math.abs(p.coverage.east - (-79.0)) < 0.1 &&
                        Math.abs(p.coverage.north - 31.0) < 0.1;
      if (isFlorida) {
        regionId = "florida_east_coast";
      }
    }
    
    if (regionId) {
      const key = `${regionId}`;
      if (!seen.has(key)) {
        seen.add(key);
        tiles.push({
          id: regionId,
          bounds: p.coverage
        });
      }
    }
  }
  
  if (tiles.length === 0) {
    return REGIONAL_TILES;
  }
  
  return tiles;
}

/**
 * Resolves the dynamic product coverage bounds from cachedManifest.
 * Falls back to PILOT_COVERAGE if manifest is not loaded or has no matching product.
 * Returns metadata indicating whether dynamic coverage or fallback was used.
 */
export function getProductCoverage(model = 'GFS', domain = 'marine', layer = 'waves') {
  let isDynamic = false;
  let coverage = PILOT_COVERAGE;
  
  const filterModel = (model || 'GFS').toUpperCase();
  const filterDomain = (domain || 'marine').toLowerCase();
  const filterLayer = (layer || 'waves').toLowerCase();

  const cachedManifest = getCachedManifest();
  const hasEmptyProducts = cachedManifest && Array.isArray(cachedManifest.products) && cachedManifest.products.length === 0;

  if (cachedManifest && Array.isArray(cachedManifest.products) && !hasEmptyProducts) {
    const p = cachedManifest.products.find(prod =>
      prod.model.toUpperCase() === filterModel &&
      prod.domain.toLowerCase() === filterDomain &&
      prod.layer.toLowerCase() === filterLayer
    );
    if (p && p.coverage) {
      coverage = p.coverage;
      isDynamic = true;
    }
  }

  return {
    coverage,
    isDynamic,
    isFallback: !isDynamic
  };
}

/**
 * Clamps or intersects the requested viewport bbox coordinates with the dynamic coverage limits.
 */
export function clampViewportBbox(requestedBbox, layerName = "waves", modelName = "GFS") {
  if (!requestedBbox) {
    return {
      isInside: false,
      clampedBbox: null,
      fallbackReason: "Missing requested bounding box coordinates",
      coverageBounds: PILOT_COVERAGE,
      selectedTileId: null,
      availableTileIds: REGIONAL_TILES.map(t => t.id),
      rejectedTileIds: []
    };
  }

  const { west, south, east, north } = requestedBbox;
  const tiles = getAvailableTilesFromManifest();
  const availableTileIds = tiles.map(t => t.id);
  
  // Find all intersecting tiles and calculate their intersection area with the requested viewport
  const intersectingTiles = [];
  
  for (const t of tiles) {
    const cov = t.bounds;
    const intWest = Math.max(west, cov.west);
    const intSouth = Math.max(south, cov.south);
    const intEast = Math.min(east, cov.east);
    const intNorth = Math.min(north, cov.north);
    
    if (intWest < intEast && intSouth < intNorth) {
      const area = (intEast - intWest) * (intNorth - intSouth);
      intersectingTiles.push({
        tile: t,
        area,
        clampedBbox: { west: intWest, south: intSouth, east: intEast, north: intNorth }
      });
    }
  }

  // If no intersection found, clear the visual layer cleanly
  if (intersectingTiles.length === 0) {
    return {
      isInside: false,
      clampedBbox: null,
      fallbackReason: "outside_coverage_clear",
      coverageBounds: PILOT_COVERAGE,
      selectedTileId: null,
      availableTileIds,
      rejectedTileIds: []
    };
  }

  // Sort intersecting tiles by area descending
  intersectingTiles.sort((a, b) => b.area - a.area);
  
  const bestMatch = intersectingTiles[0];
  const selectedTileId = bestMatch.tile.id;
  const rejectedTileIds = intersectingTiles.slice(1).map(item => item.tile.id);

  return {
    isInside: true,
    clampedBbox: bestMatch.clampedBbox,
    fallbackReason: null,
    coverageBounds: bestMatch.tile.bounds,
    selectedTileId,
    availableTileIds,
    rejectedTileIds
  };
}
