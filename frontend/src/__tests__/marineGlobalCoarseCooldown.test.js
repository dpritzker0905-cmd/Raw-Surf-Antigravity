import { getModelSafeMarine } from '../components/map/marineController';
import { getPerModelHourCache, _cacheMarineResult } from '../components/map/marineControllerCache';

const VIEWPORT = { west: -84, south: 25, east: -80, north: 29 };
const GLOBAL_DATA = {
  __sourceModel: 'GFS',
  hourOffset: 0,
  grid: {
    __sourceModel: 'GFS',
    __componentLayer: 'waves',
    bounds: { west: -180, south: -80, east: 180, north: 85 },
    vectors: [{ lat: 27, lng: -82, u: 1, v: 1 }]
  }
};

function seedWorldGrid() {
  getPerModelHourCache().set('GFS_all_global_coarse_0', {
    timestamp: Date.now(),
    data: GLOBAL_DATA
  });
}

describe('DEBT-CACHE-03 caller-aware global fallback', () => {
  beforeEach(() => {
    getPerModelHourCache().clear();
    delete window.__RAW_DISABLE_SAFECACHE_GLOBAL_SKIP__;
    window.__USE_BACKEND_MARINE_SYSTEM__ = false;
    window.__SURF_MODE__ = false;
    delete window.__USE_BACKEND_WEATHER_SERVICE__;
    delete window.__USE_BACKEND_ICON_MARINE_SERVICE__;
    delete window.__USE_BACKEND_COPERNICUS_MARINE_SERVICE__;
    seedWorldGrid();
  });

  afterEach(() => {
    getPerModelHourCache().clear();
    delete window.__USE_BACKEND_MARINE_SYSTEM__;
    delete window.__SURF_MODE__;
  });

  it('keeps a global-coarse grid out of ordinary regional cache reuse', () => {
    expect(getModelSafeMarine('GFS', 0, 'waves', VIEWPORT)).toBeNull();
  });

  it('allows a global-coarse grid only when the cooldown caller explicitly asks for it', () => {
    const result = getModelSafeMarine('GFS', 0, 'waves', VIEWPORT, {
      allowGlobalCoarseFallback: true
    });

    expect(result).toBe(GLOBAL_DATA);
  });

  // The tests above seed the cache DIRECTLY, so they never exercise the real write path. The
  // MAR-01 world-grid alias (dbc49ea0) made _cacheMarineResult mirror world grids under a SECOND key
  // containing 'global_coarse' — this pins that it did not open a hole in this guard, which is the
  // fix that keeps a 15,023-vector world grid (and its 4096x2048 mask) off a zoomed-in viewport.
  describe('with the world grid written through the REAL cache path (MAR-01 alias)', () => {
    const worldResponse = {
      tile_id: 'global_mid',            // what the backend actually serves since 41addb91
      region_id: 'global_mid',
      grid: {
        __sourceModel: 'GFS',
        __componentLayer: 'waves',
        region_id: 'global_mid',
        bounds: { west: -180, south: -80, east: 180, north: 85 },
        cols: 181,
        rows: 83,
        vectors: [{ lat: 27, lng: -82, u: 1, v: 1 }]
      }
    };

    beforeEach(() => {
      getPerModelHourCache().clear();
      _cacheMarineResult('GFS', 0, worldResponse, 'waves', true);
    });

    it('writes BOTH the response-keyed entry and the lookup-keyed alias', () => {
      const keys = [...getPerModelHourCache().keys()];
      expect(keys.some((k) => k.includes('global_mid'))).toBe(true);
      expect(keys.some((k) => k.includes('global_coarse'))).toBe(true);
    });

    it('STILL keeps the world grid out of ordinary regional reuse — the alias is not a hole', () => {
      expect(getModelSafeMarine('GFS', 0, 'waves', VIEWPORT)).toBeNull();
    });

    it('still hands it to the cooldown caller that explicitly asks', () => {
      const result = getModelSafeMarine('GFS', 0, 'waves', VIEWPORT, {
        allowGlobalCoarseFallback: true
      });
      expect(result?.grid?.bounds?.west).toBe(-180);
    });
  });
});
