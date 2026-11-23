/**
 * cacheBudget.js (2026-11-23): one byte budget across the map client's caches. The inspection's pass 5 measured the JS heap at
 * 1.8-2.1 GB after one 21-layer scrub cycle; the offline replay attributed 985 MB retained to caches bounded by count alone.
 */
import {
  RecencyMap, _resetCacheBudgetForTest, activeView, cacheBudgetBytes, cacheBudgetReport, enforceCacheBudget, noteActiveView, noteCacheGrowth,
  normLayer, normModel, onScreen, registerCache, viewLayers, DESKTOP_BUDGET_MB, HANDHELD_BUDGET_MB, LOW_WATER,
} from './cacheBudget';
import { isHandheldDevice } from './deviceTier';
import { windCacheEntries } from './cacheBudgetAdapters';

jest.mock('./deviceTier', () => ({ isHandheldDevice: jest.fn(() => false) }));

const MB = 1048576;
/** A plain test cache: key -> { bytes, model, layer, lastUse, pinned, id }. */
function fakeCache(name, rows, cost) {
  const map = new Map(rows.map((r) => [r.key, r]));
  const dropped = [];
  registerCache(name, { entries: () => [...map.values()], drop: (k) => { if (!map.has(k)) return null; dropped.push(k); map.delete(k); return 1; }, cost });
  return { map, dropped };
}
const row = (key, mb, model, layer, lastUse, extra = {}) => ({ key, bytes: mb * MB, model, layer, lastUse, ...extra });

beforeEach(() => { _resetCacheBudgetForTest(); window.__RAW_CACHE_BUDGET_MB__ = 100; delete window.__RAW_DISABLE_CACHE_BUDGET__; isHandheldDevice.mockReturnValue(false); });
afterEach(() => { delete window.__RAW_CACHE_BUDGET_MB__; delete window.__RAW_DISABLE_CACHE_BUDGET__; jest.useRealTimers(); });

describe('one vocabulary for model and layer', () => {
  it('maps every cache\'s model ids to GFS / EURO / ICON, and CMEMS or unknown to model-agnostic', () => {
    expect(['GFS', 'ncep_gfs013', 'ncep_gfswave025', 'HRRR'].map(normModel)).toEqual(['GFS', 'GFS', 'GFS', 'GFS']);
    expect(['EURO', 'ecmwf_ifs025', 'ecmwf_wam025'].map(normModel)).toEqual(['EURO', 'EURO', 'EURO']);
    expect(['ICON', 'dwd_icon', 'dwd_gwam', 'gwam'].map(normModel)).toEqual(['ICON', 'ICON', 'ICON', 'ICON']);
    expect([normModel('cmems'), normModel(''), normModel(null)]).toEqual([null, null, null]);
  });
  it('maps set names and .om variables to the chip ids', () => {
    expect(['gust', 'temperature_2m', 'cloud_cover', 'currents', 'surface_temperature', 'swell_1', 'waves~surf', 'wave_height'].map(normLayer))
      .toEqual(['gusts', 'temperature', 'satellite', 'currents', 'water_temp', 'swell_1', 'waves', 'waves']);
    expect(normLayer('nonsense')).toBeNull();
  });
  it('a model-agnostic entry is on screen by its layer alone; no layer on screen means nothing is', () => {
    expect(onScreen({ model: null, layer: 'currents' }, { model: 'ICON', layer: 'currents' })).toBe(true);
    expect(onScreen({ model: 'GFS', layer: 'waves' }, { model: 'ICON', layer: 'waves' })).toBe(false);
    expect(onScreen({ model: 'GFS', layer: 'waves' }, { model: 'GFS', layer: null })).toBe(false);
  });
});

describe('the budget', () => {
  it('desktop 192 MB, handheld 64 MB, the lever first', () => {
    delete window.__RAW_CACHE_BUDGET_MB__;
    expect(cacheBudgetBytes()).toBe(DESKTOP_BUDGET_MB * MB);
    isHandheldDevice.mockReturnValue(true);
    expect(cacheBudgetBytes()).toBe(HANDHELD_BUDGET_MB * MB);
    window.__RAW_CACHE_BUDGET_MB__ = 32;
    expect(cacheBudgetBytes()).toBe(32 * MB);
  });
  it('under budget: nothing is dropped', () => {
    const c = fakeCache('a', [row('x', 40, 'GFS', 'waves', 1), row('y', 40, 'EURO', 'waves', 2)]);
    noteActiveView({ model: 'GFS', layer: 'waves', hour: 0 });
    expect(enforceCacheBudget().dropped).toBe(0);
    expect(c.dropped).toEqual([]);
  });
  it('over budget: off-screen first (oldest first), down to the low-water mark, the on-screen view untouched', () => {
    const c = fakeCache('a', [row('onA', 30, 'GFS', 'waves', 5), row('offOld', 30, 'EURO', 'waves', 1), row('offNew', 30, 'ICON', 'wind', 9),
      row('offMid', 30, 'GFS', 'swell_1', 4)]);
    noteActiveView({ model: 'GFS', layer: 'waves', hour: 0 });
    const r = enforceCacheBudget();
    expect(c.dropped).toEqual(['offOld', 'offMid']);   // 120 -> 60 MB: under 80 (LOW_WATER x 100)
    expect(r.afterMB).toBeLessThanOrEqual(100 * LOW_WATER);
  });
  it('then the active view\'s own entries, least recently used first; a PINNED entry is never dropped', () => {
    const c = fakeCache('a', [row('pin', 60, 'GFS', 'waves', 1, { pinned: true }), row('old', 30, 'GFS', 'waves', 2), row('new', 30, 'GFS', 'waves', 3)]);
    noteActiveView({ model: 'GFS', layer: 'waves', hour: 0 });
    enforceCacheBudget();
    expect(c.dropped).toEqual(['old', 'new']);   // 120 -> 90 -> 60
    expect(c.map.has('pin')).toBe(true);
  });
  it('what is left pinned over the budget is counted, never dropped', () => {
    fakeCache('a', [row('p1', 70, 'GFS', 'waves', 1, { pinned: true }), row('p2', 70, 'GFS', 'waves', 2, { pinned: true })]);
    noteActiveView({ model: 'GFS', layer: 'waves', hour: 0 });
    enforceCacheBudget();
    expect(cacheBudgetReport().stats.overPinned).toBe(1);
  });
  it('within a class the cheaper cache goes first (cost), then the older', () => {
    const dear = fakeCache('dear', [row('d', 40, 'EURO', 'waves', 1)], 2);
    const cheap = fakeCache('cheap', [row('c', 40, 'EURO', 'temperature', 9)], 0);
    fakeCache('keep', [row('k', 40, 'GFS', 'waves', 5)], 1);
    noteActiveView({ model: 'GFS', layer: 'waves', hour: 0 });
    enforceCacheBudget();
    expect(cheap.dropped).toEqual(['c']);   // the newer but cheaper entry goes first: 120 -> 80, at the low-water mark
    expect(dear.dropped).toEqual([]);       // the older, dearer one stays
  });
  it('an alias (one id under two keys or two caches) counts once and frees only when its last key goes', () => {
    const vec = {};
    const a = fakeCache('a', [row('k1', 60, 'EURO', 'waves', 1, { id: vec }), row('k2', 60, 'EURO', 'waves', 2, { id: vec })]);
    fakeCache('b', [row('k3', 50, 'GFS', 'waves', 5)]);
    noteActiveView({ model: 'GFS', layer: 'waves', hour: 0 });
    expect(cacheBudgetReport().totalMB).toBe(110);   // 60 once + 50
    enforceCacheBudget();
    expect(a.dropped).toEqual(['k1', 'k2']);         // after k1 the total is still 110: k2 must go too
  });
  it('KILL: window.__RAW_DISABLE_CACHE_BUDGET__ (read on every enforce) drops nothing', () => {
    const c = fakeCache('a', [row('x', 90, 'EURO', 'waves', 1), row('y', 90, 'ICON', 'waves', 2)]);
    noteActiveView({ model: 'GFS', layer: 'waves', hour: 0 });
    window.__RAW_DISABLE_CACHE_BUDGET__ = true;
    expect(enforceCacheBudget()).toBeNull();
    expect(c.dropped).toEqual([]);
    delete window.__RAW_DISABLE_CACHE_BUDGET__;
    enforceCacheBudget();
    expect(c.dropped.length).toBeGreaterThan(0);   // positive control
  });
  it('a drop that grows or re-enters the budget does not recurse', () => {
    let reentered = null;
    registerCache('a', { entries: () => [row('x', 150, 'EURO', 'waves', 1)], drop: () => { reentered = enforceCacheBudget('inner'); noteCacheGrowth(); return 1; } });
    noteActiveView({ model: 'GFS', layer: 'waves', hour: 0 });
    enforceCacheBudget();
    expect(reentered).toBeNull();
  });
  it('growth notes coalesce into one scheduled enforce, off the insert path', () => {
    jest.useFakeTimers();
    const c = fakeCache('a', [row('x', 90, 'EURO', 'waves', 1), row('y', 90, 'ICON', 'waves', 2)]);
    noteActiveView({ model: 'GFS', layer: 'waves', hour: 0 });
    jest.runOnlyPendingTimers();   // the registration's and the view's pass
    const before = cacheBudgetReport().stats.enforces;
    noteCacheGrowth(); noteCacheGrowth(); noteCacheGrowth();
    expect(c.dropped.length).toBeGreaterThanOrEqual(0);
    jest.runOnlyPendingTimers();
    expect(cacheBudgetReport().stats.enforces - before).toBe(1);
  });
  it('a broken adapter is skipped, the others still counted', () => {
    registerCache('broken', { entries: () => { throw Error('boom'); }, drop: () => null });
    fakeCache('ok', [row('x', 10, 'GFS', 'waves', 1)]);
    expect(cacheBudgetReport().totalMB).toBe(10);
  });
  it('the report names bytes per cache, pinned and on screen apart', () => {
    fakeCache('a', [row('x', 10, 'GFS', 'waves', 1, { pinned: true }), row('y', 5, 'EURO', 'waves', 1)]);
    noteActiveView({ model: 'GFS', layer: 'waves', hour: 0 });
    const r = cacheBudgetReport();
    expect(r.caches.a).toEqual({ entries: 2, mb: 15, pinnedMB: 10, onScreenMB: 10 });
    expect(r.budgetMB).toBe(100);
    expect(r.active).toEqual({ model: 'GFS', layers: ['waves'], hour: 0 });
    expect(typeof window.__RAW_CACHE_BUDGET__.report).toBe('function');
  });
});

describe('the dear reserve on a small device (round-2 review)', () => {
  const setup = () => {
    const wind = fakeCache('wind', [row('w1', 10, 'ICON', 'wind', 9), row('w2', 30, 'EURO', 'wind', 1)], 4);
    const raster = fakeCache('raster', [row('r1', 30, 'GFS', 'temperature', 5), row('r2', 30, 'GFS', 'temperature', 6),
      row('pin', 20, 'GFS', 'temperature', 7, { pinned: true })], 1);
    noteActiveView({ model: 'GFS', layer: 'temperature', hour: 0 });
    return { wind, raster };
  };
  it('a phone keeps the most recent dear off-screen grids (up to the reserve) behind the active layer\'s non-pinned entries', () => {
    isHandheldDevice.mockReturnValue(true);
    const { wind, raster } = setup();   // 120 MB over a 100 MB budget: down to 80
    enforceCacheBudget();
    expect(wind.dropped).toEqual(['w2']);   // w2 (30 MB) does not fit the 32 MB reserve beside w1: strict order, dropped first
    expect(raster.dropped).toEqual(['r1']); // then the active layer's oldest non-pinned field; w1 (in the reserve) stays
    expect(wind.map.has('w1')).toBe(true);
  });
  it('a desktop keeps the strict order: every off-screen entry goes before the active view\'s', () => {
    const { wind, raster } = setup();
    enforceCacheBudget();
    expect(wind.dropped).toEqual(['w2', 'w1']);   // 120 -> 90 -> 80: both off-screen grids go, the active layer keeps r1 and r2
    expect(raster.dropped).toEqual([]);
  });
  it('lever: __RAW_CACHE_RESERVE_MB__ = 0 on a phone restores the strict order', () => {
    isHandheldDevice.mockReturnValue(true);
    window.__RAW_CACHE_RESERVE_MB__ = 0;
    const { wind, raster } = setup();
    enforceCacheBudget();
    expect(wind.dropped).toEqual(['w2', 'w1']);
    expect(raster.dropped).toEqual([]);
    delete window.__RAW_CACHE_RESERVE_MB__;
  });
});

describe('the view is a SET of layers (the advisor\'s hold on #1247)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_GUST_PARTICLES__; });
  it('every active layer is on screen, and wind whenever the wind particles run (Gusts moves them along the wind grids)', () => {
    expect([...viewLayers(['waves', 'wind'])].sort()).toEqual(['waves', 'wind']);
    expect([...viewLayers(['gusts'])].sort()).toEqual(['gusts', 'wind']);
    expect([...viewLayers(['waves'])]).toEqual(['waves']);
    expect([...viewLayers([])]).toEqual([]);
    window.__RAW_DISABLE_GUST_PARTICLES__ = true;   // Gusts without particles draws no wind
    expect([...viewLayers(['gusts'])]).toEqual(['gusts']);
  });
  it('onScreen tests membership', () => {
    const view = { model: 'GFS', layers: new Set(['waves', 'wind']) };
    expect(onScreen({ model: 'GFS', layer: 'wind' }, view)).toBe(true);
    expect(onScreen({ model: 'GFS', layer: 'waves' }, view)).toBe(true);
    expect(onScreen({ model: 'GFS', layer: 'swell_1' }, view)).toBe(false);
    expect(onScreen({ model: 'ICON', layer: 'wind' }, view)).toBe(false);
  });
  it('with [waves, wind] on, the wind grids at hour +-3 stay PINNED and only the other model\'s wind is dropped', () => {
    const vec = (n) => ({ data: { vectors: new Array(n) }, timestamp: 1 });
    const map = new Map([['GFS_wind_grid_global_mid_24', vec(400000)], ['GFS_wind_grid_global_mid_27', vec(400000)],
      ['ICON_wind_grid_global_mid_24', vec(400000)], ['GFS_wind_grid_global_mid_96', vec(400000)]]);
    const dropped = [];
    registerCache('wind', { entries: () => windCacheEntries(map, activeView()), drop: (k) => { dropped.push(k); map.delete(k); return 1; }, cost: 4 });
    noteActiveView({ model: 'GFS', layers: ['waves', 'wind'], hour: 25 });
    const pinned = windCacheEntries(map, activeView()).filter((e) => e.pinned).map((e) => e.key).sort();
    expect(pinned).toEqual(['GFS_wind_grid_global_mid_24', 'GFS_wind_grid_global_mid_27']);
    window.__RAW_CACHE_BUDGET_MB__ = 100;   // 4 x ~38 MB = ~153 MB over 100: down to 80
    enforceCacheBudget();
    expect(dropped[0]).toBe('ICON_wind_grid_global_mid_24');            // off-screen (another model) first
    expect(dropped).not.toContain('GFS_wind_grid_global_mid_24');        // the scrubbed hour's wind stays
    expect(dropped).not.toContain('GFS_wind_grid_global_mid_27');
  });
  it('positive control: with the view taken as activeLayers[0] alone (waves), the same wind grids are off-screen and go first', () => {
    const map = new Map([['GFS_wind_grid_global_mid_24', { data: { vectors: new Array(400000) }, timestamp: 1 }]]);
    noteActiveView({ model: 'GFS', layers: ['waves'], hour: 25 });
    expect(windCacheEntries(map, activeView())[0].pinned).toBe(false);
  });
  it('a change of the layer SET (not just the first layer) schedules a pass', () => {
    jest.useFakeTimers();
    noteActiveView({ model: 'GFS', layers: ['waves'], hour: 0 });
    jest.runOnlyPendingTimers();
    const before = cacheBudgetReport().stats.enforces;
    noteActiveView({ model: 'GFS', layers: ['waves', 'wind'], hour: 0 });
    jest.runOnlyPendingTimers();
    expect(cacheBudgetReport().stats.enforces - before).toBe(1);
  });
});

describe('RecencyMap', () => {
  it('stamps an entry when it is read', () => {
    const m = new RecencyMap([['k', { v: 1 }]]);
    expect(m.get('k').__used).toBeGreaterThan(0);
    expect(m.get('missing')).toBeUndefined();
  });
});
