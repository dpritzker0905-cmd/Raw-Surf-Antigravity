import { getModelSafeMarine } from '../components/map/marineController';
import { getPerModelHourCache } from '../components/map/marineControllerCache';

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
});
