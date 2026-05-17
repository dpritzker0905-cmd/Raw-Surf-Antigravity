/*
====================================================
 Raw Surf OS — Tile Streaming System
 GEO-SPATIAL + FORECAST STREAMING CORE
====================================================

RULES:
- NO rendering
- NO engine init
- NO RAF
- PURE DATA LAYER ONLY
- var/function only (TDZ-immune)
====================================================
*/

// ─── TILE CACHE ─────────────────────────────────────────────────────────────

var _tileCache = new Map();
var _inflight = new Map();

/**
 * Generate cache key from tile coordinates.
 * @param {{ z: number, x: number, y: number }} coord
 * @returns {string}
 */
function tileKey(coord) {
  return coord.z + '/' + coord.x + '/' + coord.y;
}

/**
 * Fetch or retrieve a cached weather tile.
 * Supports wind, waves, rain, radar, pressure, fog data layers.
 *
 * Currently returns mock data — replace with real API when tile
 * endpoints are available (e.g. Open-Meteo, NOAA GFS tiles).
 *
 * @param {{ z: number, x: number, y: number }} coord
 * @returns {Promise<Object>} weather tile
 */
function getTile(coord) {
  var k = tileKey(coord);

  // Return cached
  if (_tileCache.has(k)) {
    return Promise.resolve(_tileCache.get(k));
  }

  // Deduplicate in-flight requests
  if (_inflight.has(k)) {
    return _inflight.get(k);
  }

  // Mock tile (replace with fetch when API is ready)
  var promise = new Promise(function(resolve) {
    // Simulate network latency for realistic testing
    setTimeout(function() {
      var tile = {
        coord: coord,
        timestamp: Date.now(),
        wind: null,
        waves: null,
        rain: null,
        radar: null,
        pressure: null,
        fog: null,
      };
      _tileCache.set(k, tile);
      _inflight.delete(k);
      resolve(tile);
    }, 10); // near-instant for cached, simulates async boundary
  });

  _inflight.set(k, promise);
  return promise;
}

/**
 * Predictive prefetch — request tiles before the user pans there.
 * Called by useTemporalPreloader or viewport prediction logic.
 *
 * @param {Array<{ z: number, x: number, y: number }>} coords
 */
function prefetchTiles(coords) {
  for (var i = 0; i < coords.length; i++) {
    getTile(coords[i]); // fire-and-forget, populates cache
  }
}

/**
 * Evict tiles older than maxAge from cache.
 * @param {number} maxAgeMs - max age in milliseconds (default 5 min)
 */
function evictStaleTiles(maxAgeMs) {
  if (maxAgeMs === undefined) maxAgeMs = 5 * 60 * 1000;
  var now = Date.now();
  var keysToDelete = [];
  _tileCache.forEach(function(tile, k) {
    if (now - tile.timestamp > maxAgeMs) {
      keysToDelete.push(k);
    }
  });
  for (var i = 0; i < keysToDelete.length; i++) {
    _tileCache.delete(keysToDelete[i]);
  }
}

/**
 * Get cache stats for diagnostics.
 * @returns {{ size: number, inflightCount: number }}
 */
function getTileCacheStats() {
  return {
    size: _tileCache.size,
    inflightCount: _inflight.size,
  };
}

/**
 * Clear all cached tiles.
 */
function clearTileCache() {
  _tileCache.clear();
  _inflight.clear();
}

export {
  getTile,
  prefetchTiles,
  evictStaleTiles,
  getTileCacheStats,
  clearTileCache,
  tileKey,
};
