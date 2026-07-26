/**
 * MAR-01 — the world-grid cache key desync (2026-07-26).
 *
 * `_cacheMarineResult` derives its key from the RESPONSE (`tile_id`/`region_id`), while
 * `getModelSafeMarine` derives its lookup key from the REQUEST (`clampViewportBbox().selectedTileId`,
 * hardcoded 'global_coarse'). Nothing kept the two in sync.
 *
 * `backendWeatherServiceClientCoverage.js:390` documents this EXACT bug class being fixed once
 * already ("'global_marine_coarse' never matched the stored 'global_coarse' -> every global cache
 * lookup was exact_key_absent"). Then 41addb91 (2026-07-22) moved the served world tier from
 * global_coarse to global_mid and silently broke the alignment again.
 *
 * Verified live 2026-07-26: GET /api/weather/grid?bbox=-180,-80,180,85 returns
 * region_id = tile_id = 'global_mid' (181x83, 15023 vectors) for GFS and ICON.
 *
 * Consequence: every world-grid exact-key lookup misses, forcing the O(N) containment scan on the
 * hot activation path — the same path measured at 9511 ms to first paint with the world grid
 * fetched twice.
 */
import { clampViewportBbox } from '../components/map/backendWeatherServiceClientCoverage';
import { _cacheMarineResult, getPerModelHourCache } from '../components/map/marineControllerCache';

const WORLD = { west: -180, south: -80, east: 180, north: 85 };

function worldResponse(regionId) {
  return {
    tile_id: regionId,
    region_id: regionId,
    grid: {
      region_id: regionId,
      bounds: { ...WORLD },
      cols: 181,
      rows: 83,
      vectors: [{ lat: 0, lng: 0, speed: 1, direction: 90 }],
      __gridProvider: 'open-meteo',
    },
  };
}

describe('MAR-01 world-grid cache key parity', () => {
  beforeEach(() => getPerModelHourCache().clear());

  test('the request-side lookup id and the response-side store id must agree for world bounds', () => {
    // What the READ path will look under:
    const lookupTileId = clampViewportBbox(WORLD, 'waves', 'GFS', 'marine').selectedTileId;
    // What the backend actually returns today (verified live).
    const servedRegionId = 'global_mid';

    _cacheMarineResult('GFS', 0, worldResponse(servedRegionId), 'waves', true);
    const keys = [...getPerModelHourCache().keys()];

    // The store must be reachable under the id the lookup will use, however the backend names the tier.
    const expected = `GFS_waves_${lookupTileId}_0`;
    expect(keys).toContain(expected);
  });

  test('a world grid stored under ANY tier name is reachable under the lookup id', () => {
    const lookupTileId = clampViewportBbox(WORLD, 'waves', 'GFS', 'marine').selectedTileId;
    for (const tier of ['global_mid', 'global_coarse', 'global_marine_coarse']) {
      getPerModelHourCache().clear();
      _cacheMarineResult('GFS', 0, worldResponse(tier), 'waves', true);
      expect([...getPerModelHourCache().keys()]).toContain(`GFS_waves_${lookupTileId}_0`);
    }
  });

  test('non-world grids are NOT aliased (the alias is world-only)', () => {
    const regional = worldResponse('viewport_-100_20');
    regional.grid.bounds = { west: -100, south: 20, east: -75, north: 35 }; // 25 deg wide
    _cacheMarineResult('GFS', 0, regional, 'waves', true);
    const keys = [...getPerModelHourCache().keys()];
    expect(keys).toEqual(['GFS_waves_viewport_-100_20_0']);
  });
});
