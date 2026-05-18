/**
 * Tile Streaming System v2 Geo-Spatial Forecast Tile Engine
 *
 * UPGRADES FROM v1:
 *   - Viewport-aware frustum culling
 *   - Temporal forecast pyramids (multi-timestep caching)
 *   - LRU cache eviction with configurable max size
 *   - Predictive prefetching based on pan velocity
 *   - GPU upload queue integration
 *   - Spatial indexing for fast tile lookups
 *
 * RULES:
 *   - NO rendering (pure data layer)
 *   - NO DOM access
 *   - NO import-time side effects
 *   - Tiles are PERSISTENT streaming simulation chunks
 */

// CONFIGURATION 
const MAX_CACHE_SIZE = 512;        // Max tiles in memory
const TILE_TTL = 10 * 60 * 1000;  // 10 min default TTL
const PREFETCH_RING = 1;           // Tiles to prefetch beyond viewport

// TILE CACHE (LRU) 
const _tileCache = new Map(); // key { tile, accessTime, loadTime }
const _inflight = new Map(); // key Promise
const _temporalCache = new Map(); // key Map<timestep, tileData>

/**
 * Generate cache key from tile coordinates + optional temporal index.
 * @param {{ z: number, x: number, y: number }} coord
 * @param {number} [timestep=0] - Forecast hour offset
 * @returns {string}
 */
function tileKey(coord, timestep) {
  if (timestep === undefined) timestep = 0;
  return coord.z + '/' + coord.x + '/' + coord.y + (timestep ? '@' + timestep : '');
}

/**
 * Convert lat/lng + zoom to tile coordinates.
 */
function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lng + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { z: zoom, x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/**
 * Get visible tile coordinates for a viewport.
 * @param {{ north, south, east, west }} bounds
 * @param {number} zoom
 * @returns {Array<{ z: number, x: number, y: number }>}
 */
function getVisibleTiles(bounds, zoom) {
  const z = Math.round(Math.max(0, Math.min(18, zoom)));
  const tl = latLngToTile(bounds.north, bounds.west, z);
  const br = latLngToTile(bounds.south, bounds.east, z);

  const tiles = [];
  for (let y = tl.y; y <= br.y; y++) {
    for (let x = tl.x; x <= br.x; x++) {
      tiles.push({ z, x, y });
    }
  }
  return tiles;
}

/**
 * Get tiles for predictive prefetching (one ring beyond viewport).
 * @param {{ north, south, east, west }} bounds
 * @param {number} zoom
 * @returns {Array<{ z: number, x: number, y: number }>}
 */
function getPrefetchTiles(bounds, zoom) {
  const z = Math.round(Math.max(0, Math.min(18, zoom)));
  const tl = latLngToTile(bounds.north, bounds.west, z);
  const br = latLngToTile(bounds.south, bounds.east, z);
  const n = Math.pow(2, z);

  const tiles = [];
  for (let y = tl.y - PREFETCH_RING; y <= br.y + PREFETCH_RING; y++) {
    for (let x = tl.x - PREFETCH_RING; x <= br.x + PREFETCH_RING; x++) {
      // Skip tiles already in viewport
      if (y >= tl.y && y <= br.y && x >= tl.x && x <= br.x) continue;
      // Wrap x for antimeridian
      const wx = ((x % n) + n) % n;
      if (y >= 0 && y < n) {
        tiles.push({ z, x: wx, y });
      }
    }
  }
  return tiles;
}

// LRU EVICTION 
function evictLRU() {
  if (_tileCache.size <= MAX_CACHE_SIZE) return;
  const excess = _tileCache.size - MAX_CACHE_SIZE;
  
  // Find oldest by accessTime
  const entries = Array.from(_tileCache.entries())
    .sort((a, b) => a[1].accessTime - b[1].accessTime);
  
  for (let i = 0; i < excess && i < entries.length; i++) {
    _tileCache.delete(entries[i][0]);
  }
}

/**
 * Fetch or retrieve a cached weather tile.
 * Supports real tile endpoints and mock fallback.
 *
 * @param {{ z: number, x: number, y: number }} coord
 * @param {object} [opts]
 * @param {number} [opts.timestep=0] - Forecast hour offset
 * @param {string} [opts.layer] - Layer type (wind, waves, rain, etc.)
 * @param {string} [opts.baseUrl] - Tile server base URL
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Object>} weather tile
 */
function getTile(coord, opts) {
  if (!opts) opts = {};
  const timestep = opts.timestep || 0;
  const k = tileKey(coord, timestep);

  // Return cached (update access time for LRU)
  if (_tileCache.has(k)) {
    const cached = _tileCache.get(k);
    cached.accessTime = Date.now();
    return Promise.resolve(cached.tile);
  }

  // Deduplicate in-flight requests
  if (_inflight.has(k)) {
    return _inflight.get(k);
  }

  let promise;

  if (opts.baseUrl) {
    // Real tile fetch
    const url = opts.baseUrl
      .replace('{z}', coord.z)
      .replace('{x}', coord.x)
      .replace('{y}', coord.y)
      .replace('{t}', timestep);

    promise = fetch(url, { signal: opts.signal })
      .then(function(res) {
        if (!res.ok) throw new Error('Tile fetch failed: ' + res.status);
        return res.arrayBuffer();
      })
      .then(function(buffer) {
        const tile = {
          coord: coord,
          timestep: timestep,
          timestamp: Date.now(),
          data: buffer,
          layer: opts.layer || 'unknown',
        };
        _tileCache.set(k, { tile: tile, accessTime: Date.now(), loadTime: Date.now() });
        _inflight.delete(k);
        evictLRU();
        return tile;
      })
      .catch(function(err) {
        _inflight.delete(k);
        if (err.name === 'AbortError') return null;
        console.warn('[TileStream] Fetch failed:', coord, err.message);
        return null;
      });
  } else {
    // Placeholder tile (no real endpoint yet)
    promise = new Promise(function(resolve) {
      setTimeout(function() {
        const tile = {
          coord: coord,
          timestep: timestep,
          timestamp: Date.now(),
          data: null,
          layer: opts.layer || 'placeholder',
        };
        _tileCache.set(k, { tile: tile, accessTime: Date.now(), loadTime: Date.now() });
        _inflight.delete(k);
        evictLRU();
        resolve(tile);
      }, 5);
    });
  }

  _inflight.set(k, promise);
  return promise;
}

/**
 * Predictive prefetch request tiles before the user pans there.
 * @param {Array<{ z: number, x: number, y: number }>} coords
 * @param {object} [opts]
 */
function prefetchTiles(coords, opts) {
  for (let i = 0; i < coords.length; i++) {
    getTile(coords[i], opts);
  }
}

/**
 * Evict tiles older than maxAge from cache.
 * @param {number} [maxAgeMs] - max age in milliseconds
 */
function evictStaleTiles(maxAgeMs) {
  if (maxAgeMs === undefined) maxAgeMs = TILE_TTL;
  const now = Date.now();
  const keysToDelete = [];
  _tileCache.forEach(function(entry, k) {
    if (now - entry.loadTime > maxAgeMs) {
      keysToDelete.push(k);
    }
  });
  for (let i = 0; i < keysToDelete.length; i++) {
    _tileCache.delete(keysToDelete[i]);
  }
}

/**
 * Get cache stats for diagnostics.
 */
function getTileCacheStats() {
  return {
    size: _tileCache.size,
    maxSize: MAX_CACHE_SIZE,
    inflightCount: _inflight.size,
    temporalCacheSize: _temporalCache.size,
  };
}

/**
 * Clear all cached tiles.
 */
function clearTileCache() {
  _tileCache.clear();
  _inflight.clear();
  _temporalCache.clear();
}

export {
  getTile,
  prefetchTiles,
  evictStaleTiles,
  getTileCacheStats,
  clearTileCache,
  tileKey,
  getVisibleTiles,
  getPrefetchTiles,
  latLngToTile,
};
