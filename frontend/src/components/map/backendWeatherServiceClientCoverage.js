/**
 * backendWeatherServiceClientCoverage.js
 * 
 * Extracted coverage and bounding box calculations for backend weather service.
 * Owns the manifest cache state to avoid circular dependencies with the main client.
 */

// Manifest cache state - owned here to prevent circular imports
let cachedManifest = null;

export function getCachedManifest() {
  return cachedManifest;
}

export function setCachedManifest(manifest) {
  cachedManifest = manifest;
}

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
export function getAvailableTilesFromManifest(modelName = null, domainName = null, layerName = null, targetValidTime = null) {
  const cachedManifest = getCachedManifest();
  if (!cachedManifest || !Array.isArray(cachedManifest.products) || cachedManifest.products.length === 0) {
    return { tiles: REGIONAL_TILES, fallbackReason: 'manifest_not_loaded', hasTimeMatch: false };
  }
  
  const seen = new Set();
  const tiles = [];
  const filterModel = modelName ? modelName.toUpperCase() : null;
  const filterDomain = domainName ? domainName.toLowerCase() : null;
  const filterLayer = layerName ? layerName.toLowerCase() : null;
  let hasTimeMatch = false;
  
  for (const p of cachedManifest.products) {
    if (filterModel && p.model.toUpperCase() !== filterModel) continue;
    if (filterDomain && p.domain.toLowerCase() !== filterDomain) continue;
    if (filterLayer && p.layer.toLowerCase() !== filterLayer) continue;

    // Check valid_time availability if requested
    if (targetValidTime) {
      try {
        const targetMs = new Date(targetValidTime).getTime();
        const startMs = new Date(p.valid_time_start).getTime();
        const endMs = new Date(p.valid_time_end).getTime();
        if (targetMs >= startMs - 3 * 3600000 && targetMs <= endMs + 3 * 3600000) {
          hasTimeMatch = true;
        }
      } catch (e) { /* invalid date — skip time check */ }
    }

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
    return { tiles: [], fallbackReason: 'no_matching_products', hasTimeMatch: false };
  }
  
  return { tiles, fallbackReason: null, hasTimeMatch: targetValidTime ? hasTimeMatch : true };
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
export function clampViewportBbox(requestedBbox, layerName = "waves", modelName = "GFS", domainName = null) {
  const inferredDomain = domainName || (layerName === 'wind' ? 'wind' : 'marine');

  if (!requestedBbox) {
    return {
      isInside: false,
      clampedBbox: null,
      fallbackReason: "Missing requested bounding box coordinates",
      coverageBounds: PILOT_COVERAGE,
      selectedTileId: null,
      availableTileIds: REGIONAL_TILES.map(t => t.id),
      rejectedTileIds: [],
      tileFallbackReason: null
    };
  }

  let west = requestedBbox.west;
  let south = requestedBbox.south;
  let east = requestedBbox.east;
  let north = requestedBbox.north;

  const isViewportEnabled = ['GFS', 'ICON', 'EURO'].includes((modelName || '').toUpperCase()) && (
    (inferredDomain === 'marine' && ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes((layerName || '').toLowerCase())) ||
    (inferredDomain === 'wind' && (layerName || '').toLowerCase() === 'wind')
  );

  if (isViewportEnabled) {
    if ((modelName || '').toUpperCase() === 'EURO') {
      // Cap the maximum query span to 20.0 degrees to prevent timeouts/expensive downloads on zoomed-out views.
      const maxSpan = 20.0;
      
      // Calculate longitude center & span
      let spanLng = east < west ? (180 - west) + (east + 180) : east - west;
      if (spanLng > maxSpan) {
        let centerLng;
        if (east < west) {
          centerLng = ((west + east + 360) / 2) % 360;
        } else {
          centerLng = (west + east) / 2;
        }
        west = centerLng - maxSpan / 2;
        east = centerLng + maxSpan / 2;
        // Normalize to [-180, 180]
        if (west < -180) west += 360;
        if (east > 180) east -= 360;
      }

      // Calculate latitude center & span
      let spanLat = Math.abs(north - south);
      if (spanLat > maxSpan) {
        const centerLat = (south + north) / 2;
        south = Math.max(-80, centerLat - maxSpan / 2);
        north = Math.min(85, centerLat + maxSpan / 2);
      }
    }

    // v3.15: For WIND domain, always request global coverage.
    // Wind particles must render across the entire map, so we need global data.
    // The backend's viewport_service expands to global when span > 180° and uses
    // coarse resolution (5°) for efficiency. Viewport-clipped wind grids cause
    // visible rectangular edges when panning.
    if (inferredDomain === 'wind') {
      return {
        isInside: true,
        clampedBbox: { west: -180, south: -80, east: 180, north: 85 },
        fallbackReason: null,
        coverageBounds: { west: -180, south: -80, east: 180, north: 85 },
        selectedTileId: 'global_wind',
        availableTileIds: REGIONAL_TILES.map(t => t.id),
        rejectedTileIds: [],
        tileFallbackReason: null
      };
    }

    // For marine heatmaps, if the viewport span is wide, request global coverage
    // to prevent visible rectangular edges and clamping at zoomed-out views.
    const spanLng = east < west ? (180 - west) + (east + 180) : east - west;
    const spanLat = Math.abs(north - south);
    if ((modelName || '').toUpperCase() !== 'EURO' && (spanLng > 5.0 || spanLat > 5.0)) {
      return {
        isInside: true,
        clampedBbox: { west: -180, south: -80, east: 180, north: 85 },
        fallbackReason: null,
        coverageBounds: { west: -180, south: -80, east: 180, north: 85 },
        selectedTileId: 'global_marine_coarse',
        availableTileIds: REGIONAL_TILES.map(t => t.id),
        rejectedTileIds: [],
        tileFallbackReason: null
      };
    }

    const tileSize = (modelName || '').toUpperCase() === 'GFS' ? 1.0 : 2.0;
    const snapW = Math.floor(west / tileSize) * tileSize;
    const snapS = Math.floor(south / tileSize) * tileSize;
    const snapE = Math.ceil(east / tileSize) * tileSize;
    const snapN = Math.ceil(north / tileSize) * tileSize;

    const r = v => Number(v).toFixed(2);
    const selectedTileId = `viewport_${r(snapW)}_${r(snapS)}_${r(snapE)}_${r(snapN)}`;
    return {
      isInside: true,
      clampedBbox: { west: snapW, south: snapS, east: snapE, north: snapN },
      fallbackReason: null,
      coverageBounds: { west: -180, south: -80, east: 180, north: 85 },
      selectedTileId,
      availableTileIds: REGIONAL_TILES.map(t => t.id),
      rejectedTileIds: [],
      tileFallbackReason: null
    };
  }

  const tileResult = getAvailableTilesFromManifest(modelName, inferredDomain, layerName);
  const tiles = tileResult.tiles || [];
  const availableTileIds = tiles.map(t => t.id);
  const tileFallbackReason = tileResult.fallbackReason;
  
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
      fallbackReason: tileFallbackReason || "outside_coverage_clear",
      coverageBounds: PILOT_COVERAGE,
      selectedTileId: null,
      availableTileIds,
      rejectedTileIds: [],
      tileFallbackReason
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
    rejectedTileIds,
    tileFallbackReason
  };
}
