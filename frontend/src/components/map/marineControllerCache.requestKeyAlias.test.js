/**
 * marineControllerCache.requestKeyAlias.test.js
 *
 * T-2′ step 3 — the cache must be keyed by what READERS look up (audit 11.2).
 *
 * MEASURED live on the activation hot path before this fix
 * (audit/weather-simulation-11.2/T2PRIME_STEP3_MISS_RATE_MEASUREMENT.md):
 *   19 exact-key checks, 0 hits -> a 100% miss rate.
 *   All 10 cache-resolved lookups were served by the O(N) containment scan.
 *   The pre-existing world alias (_aw >= 340) rescued 0 of those 19.
 *
 * MECHANISM: `_cacheMarineResult` keys off `data.tile_id` (the SERVED tile). Every reader keys off
 * `clampViewportBbox(viewport).selectedTileId` (the REQUESTED tile). For a viewport product the
 * backend snaps its own bbox, so the two strings are structurally different and can never match:
 *     read : GFS_waves_viewport_-82.25_26.75_-79.00_30.00_0
 *     write: GFS_waves_viewport_-80.00_24.00_-76.00_28.00_0
 *
 * These are the REAL strings observed in __MARINE_CACHE_DIAG__.log.
 *
 * ⚠️ This is a PERFORMANCE fix, not a correctness one: the containment scan is already
 *    deterministic (tightest-containing, 516a7200), so a scan-resolved lookup returns the right
 *    grid. This restores the O(1) path the index was built for.
 */

import { _cacheMarineResult, getPerModelHourCache } from './marineControllerCache';

const MODEL = 'GFS';
const LAYER = 'waves';
const HOUR = 0;

// The two real tile ids from the live log.
const SERVED_TILE  = 'viewport_-80.00_24.00_-76.00_28.00';
const REQUEST_TILE = 'viewport_-82.25_26.75_-79.00_30.00';

const servedKey  = `${MODEL}_${LAYER}_${SERVED_TILE}_${HOUR}`;
const requestKey = `${MODEL}_${LAYER}_${REQUEST_TILE}_${HOUR}`;

function makeResult() {
  return {
    tile_id: SERVED_TILE,
    grid: {
      bounds: { west: -80, south: 24, east: -76, north: 28 },
      cols: 9, rows: 9,
      vectors: Array.from({ length: 81 }, (_, i) => ({ lat: 26, lng: -78, height: 1, speed: 1, period: 8, direction: 90, _i: i })),
      __gridProvider: 'open-meteo',
    },
  };
}

beforeEach(() => {
  getPerModelHourCache().clear?.();
  delete window.__RAW_DISABLE_REQUEST_TILE_ALIAS__;
  delete window.__SURF_MODE__;
});

describe('the cache is reachable by the key readers actually construct', () => {
  test('REGRESSION: without a requestTileId the request key is ABSENT (the measured 100% miss)', () => {
    _cacheMarineResult(MODEL, HOUR, makeResult(), LAYER);       // today's call shape

    const cache = getPerModelHourCache();
    expect(cache.has(servedKey)).toBe(true);      // the response key was always written
    expect(cache.has(requestKey)).toBe(false);    // ...and nobody looks that one up
  });

  test('passing the requestTileId makes the request key HIT', () => {
    _cacheMarineResult(MODEL, HOUR, makeResult(), LAYER, false, REQUEST_TILE);

    const cache = getPerModelHourCache();
    expect(cache.has(requestKey)).toBe(true);
    // ADDITIVE: the response key must still be written, so existing readers are untouched.
    expect(cache.has(servedKey)).toBe(true);
    // Same entry object under both keys — one map slot, no duplicated payload.
    expect(cache.get(requestKey)).toBe(cache.get(servedKey));
  });

  test('the kill-switch restores the pre-fix behaviour exactly', () => {
    window.__RAW_DISABLE_REQUEST_TILE_ALIAS__ = true;
    _cacheMarineResult(MODEL, HOUR, makeResult(), LAYER, false, REQUEST_TILE);

    const cache = getPerModelHourCache();
    expect(cache.has(servedKey)).toBe(true);
    expect(cache.has(requestKey)).toBe(false);
  });

  test('a requestTileId equal to the served tile writes no redundant alias', () => {
    _cacheMarineResult(MODEL, HOUR, makeResult(), LAYER, false, SERVED_TILE);
    expect(getPerModelHourCache().size).toBe(1);
  });

  test('omitting the parameter is byte-identical to the legacy call (no accidental alias)', () => {
    _cacheMarineResult(MODEL, HOUR, makeResult(), LAYER, false, null);
    const cache = getPerModelHourCache();
    expect(cache.size).toBe(1);
    expect(cache.has(servedKey)).toBe(true);
  });
});
