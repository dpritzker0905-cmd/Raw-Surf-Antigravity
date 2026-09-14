import { fetchMarineData, getModelSafeMarine } from './marineController';
import { _cacheMarineResult, getPerModelHourCache } from './marineControllerCache';
import { clampViewportBbox, setCachedManifest } from './backendWeatherServiceClientCoverage';
import { mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';

const VIEW = { west: -83.8, south: 26.2, east: -76.2, north: 29.8 };
const PARTIAL = { west: -83, south: 26, east: -79, north: 30 };
const COVER = { west: -84, south: 26, east: -76, north: 32 };
function field(b, step = 2, height = 2) {
  const width = b.east < b.west ? b.east + 360 - b.west : b.east - b.west;
  const cols = Math.round(width / step) + 1, rows = Math.round((b.north - b.south) / step) + 1;
  const wire = { region_id: `viewport_${Object.values(b).join('_')}`, model: 'GFS', domain: 'marine', layer: 'waves',
    model_run_time: '2026-09-12T06:00:00Z', model_run_time_status: 'known', served_valid_time: '2026-09-13T00:00:00Z',
    frame_offset_hours: 0, frame_substituted: false, upstream_provider: 'noaa', source_dataset: 'ncep_gfswave025',
    grid: { bounds: b, cols, rows, vectors: Array.from({ length: cols * rows }, (_, i) => ({
      lng: b.west + i % cols * step, lat: b.south + Math.floor(i / cols) * step, speed: height, height, period: 8, direction: 90, is_valid: true })) } };
  return mapNormalizedGridToWebGL(wire, b, 0, 'waves', 'GFS');
}
let savedFetch;
beforeEach(() => {
  localStorage.clear();
  getPerModelHourCache().clear();
  setCachedManifest({ products: [{ model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'test-world',
    coverage: { west: -180, south: -80, east: 180, north: 85 } }] });
  window.__MARINE_SIBLING_PREWARM__ = false;
  delete window.__SURF_MODE__;
  savedFetch = global.fetch;
  global.fetch = jest.fn(() => Promise.reject(Error('Unexpected HTTP in cache-only control')));
});
afterEach(() => {
  global.fetch = savedFetch;
  delete window.__MARINE_SIBLING_PREWARM__; delete window.__SURF_MODE__;
  delete window.__RAW_DISABLE_TIGHTEST_CONTAINED__;
});
const alias = (view = VIEW) => clampViewportBbox(view, 'waves', 'GFS', 'marine').selectedTileId;
const select = (lane, view = VIEW) => lane === 'safe-selector' ? getModelSafeMarine('GFS', 0, 'waves', view)
  : fetchMarineData(view, 6.666, undefined, 0, false, 'GFS', 'waves');
const cacheEntry = data => [...getPerModelHourCache().values()].find(entry => entry.data === data);

test.each(['safe-selector', 'foreground'])('%s uses a ready covering regional field over a partial exact alias', async lane => {
  const partial = field(PARTIAL, .25), cover = field(COVER);
  _cacheMarineResult('GFS', 0, partial, 'waves', true, alias());
  _cacheMarineResult('GFS', 0, cover, 'waves', true);
  const out = lane === 'safe-selector' ? getModelSafeMarine('GFS', 0, 'waves', VIEW)
    : await fetchMarineData(VIEW, 6.666, undefined, 0, false, 'GFS', 'waves');
  expect(out.grid.vectors).toBe(cover.grid.vectors);
  expect(out.grid.served_valid_time).toBe(cover.grid.served_valid_time);
  expect(global.fetch).not.toHaveBeenCalled();
});

// Perturb one eligibility input at a time while holding the exact alias fixed.
// Transport remains forbidden: a rejected candidate must retain the existing fallback.
describe.each(['safe-selector', 'foreground'])('%s eligibility sensitivities', lane => {
  test.each([
    ['stale result', d => { d.stale = true; }],
    ['stale grid', d => { d.grid.stale = true; }],
    ['non-renderable grid', d => { d.grid.renderable = false; }],
    ['non-renderable mapper flag', d => { d.grid.__renderable = false; }],
    ['expired', (d, e) => { e.timestamp -= 30 * 60 * 1000; }],
    ['missing signature', (d, e) => { e.signature = null; }],
    ...['model', 'layer', 'provider', 'hourOffset', 'boundsStr', 'cols', 'rows', 'vectorsLength'].map(k =>
      [`signature ${k}`, (d, e) => { e.signature[k] = 'changed'; }]),
    ['different hour key', (d, e) => { getPerModelHourCache().clear(); getPerModelHourCache().set('GFS_waves_cover_1', e); }],
    ['different model key', (d, e) => { getPerModelHourCache().clear(); getPerModelHourCache().set('ICON_waves_cover_0', e); }],
    ['different layer key', (d, e) => { getPerModelHourCache().clear(); getPerModelHourCache().set('GFS_swell_1_cover_0', e); }],
    ['different surf flavor', (d, e) => { getPerModelHourCache().clear(); getPerModelHourCache().set('GFS_waves~surf_cover_0', e); }],
  ])('does not promote %s', async (_, perturb) => {
    const cover = field(COVER), partial = field(PARTIAL, .25);
    _cacheMarineResult('GFS', 0, cover, 'waves', true);
    perturb(cover, cacheEntry(cover));
    _cacheMarineResult('GFS', 0, partial, 'waves', true, alias());
    const out = await select(lane);
    expect(out.grid.vectors).toBe(partial.grid.vectors);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('never replaces a partial regional alias with an unrelated world field', async () => {
    const partial = field(PARTIAL, .25), world = field({ west: -180, south: -80, east: 180, north: 84 }, 4);
    _cacheMarineResult('GFS', 0, partial, 'waves', true, alias());
    _cacheMarineResult('GFS', 0, world, 'waves', true);
    expect((await select(lane)).grid.vectors).toBe(partial.grid.vectors);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test.each([false, true])('tightest covering choice is insertion-independent (reverse=%s)', async reverse => {
    const partial = field(PARTIAL, .25), cover = field(COVER), wider = field({ west: -90, south: 20, east: -70, north: 40 });
    _cacheMarineResult('GFS', 0, partial, 'waves', true, alias());
    for (const d of reverse ? [cover, wider] : [wider, cover]) _cacheMarineResult('GFS', 0, d, 'waves', true);
    const keysBefore = [...getPerModelHourCache().keys()].sort();
    expect((await select(lane)).grid.vectors).toBe(cover.grid.vectors);
    expect([...getPerModelHourCache().keys()].sort()).toEqual(keysBefore);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('cover availability changes the next selection without alias eviction or a new request', async () => {
    const partial = field(PARTIAL, .25), cover = field(COVER);
    // A covering product may legitimately come from an earlier cycle. Keep its true identity.
    cover.grid.model_run_time = '2026-09-11T12:00:00Z';
    _cacheMarineResult('GFS', 0, partial, 'waves', true, alias());
    const exact = getPerModelHourCache().get(`GFS_waves_${alias()}_0`);
    expect((await select(lane)).grid.vectors).toBe(partial.grid.vectors);
    _cacheMarineResult('GFS', 0, cover, 'waves', true);
    const out = await select(lane);
    expect(out.grid.vectors).toBe(cover.grid.vectors);
    expect(out.grid.model_run_time).toBe('2026-09-11T12:00:00Z');
    expect(out.grid.served_valid_time).toBe(cover.grid.served_valid_time);
    expect(getPerModelHourCache().get(`GFS_waves_${alias()}_0`)).toBe(exact);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test.each([0, .001])('coverage boundary at east edge +%s degrees', async extension => {
    const view = { ...VIEW, east: COVER.east + extension }, partial = field(PARTIAL, .25), cover = field(COVER);
    _cacheMarineResult('GFS', 0, partial, 'waves', true, alias(view));
    _cacheMarineResult('GFS', 0, cover, 'waves', true);
    expect((await select(lane, view)).grid.vectors).toBe(extension === 0 ? cover.grid.vectors : partial.grid.vectors);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('cyclic containment recognizes an unwrapped crossing viewport', async () => {
    const view = { west: 176, south: 26.2, east: 184, north: 29.8 };
    const partial = field({ west: 177, south: 26, east: 179, north: 30 }), cover = field({ west: 174, south: 26, east: -174, north: 32 });
    _cacheMarineResult('GFS', 0, partial, 'waves', true, alias(view));
    _cacheMarineResult('GFS', 0, cover, 'waves', true);
    expect((await select(lane, view)).grid.vectors).toBe(cover.grid.vectors);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('an exact field already covering the viewport retains priority', async () => {
    const exact = field(COVER), wider = field({ west: -90, south: 20, east: -70, north: 40 });
    _cacheMarineResult('GFS', 0, exact, 'waves', true, alias());
    _cacheMarineResult('GFS', 0, wider, 'waves', true);
    expect((await select(lane)).grid.vectors).toBe(exact.grid.vectors);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

test('selector telemetry distinguishes a ready replacement from an exact-field hit', () => {
  window.__MARINE_CACHE_DIAG__ = { counts: {}, log: [] };
  _cacheMarineResult('GFS', 0, field(PARTIAL, .25), 'waves', true, alias());
  _cacheMarineResult('GFS', 0, field(COVER), 'waves', true);
  getModelSafeMarine('GFS', 0, 'waves', VIEW);
  expect(window.__MARINE_CACHE_DIAG__.counts.sel_hit_ready_regional).toBe(1);
  expect(window.__MARINE_CACHE_DIAG__.counts.sel_hit).toBeUndefined();
  expect(window.__MARINE_CACHE_DIAG__.counts.hit).toBeUndefined();
});

test.each(['safe-selector', 'foreground'])('%s preserves partial fallback when no covering replacement exists', async lane => {
  const partial = field(PARTIAL, .25);
  _cacheMarineResult('GFS', 0, partial, 'waves', true, alias());
  const out = lane === 'safe-selector' ? getModelSafeMarine('GFS', 0, 'waves', VIEW)
    : await fetchMarineData(VIEW, 6.666, undefined, 0, false, 'GFS', 'waves');
  expect(out.grid.vectors).toBe(partial.grid.vectors);
  expect(global.fetch).not.toHaveBeenCalled();
});
