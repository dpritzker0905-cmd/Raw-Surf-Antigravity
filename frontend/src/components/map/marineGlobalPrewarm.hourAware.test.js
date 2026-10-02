/**
 * The zoom-out bridge's coarse base follows the SELECTED HOUR (2026-10-01, audit F-21; marineStaleHour.js).
 *
 * Four facts pinned here, each the defect when it fails:
 *  - `_coarseBaseMatches` / `_stageCoarseBridgeSeed` asked identity only (model, layer), so a right-hour seed was REFUSED for as long
 *    as the page-load world frame (the "now" hour) was held, and the bridge promoted the wrong hour at full strength for 4 to 5 s.
 *  - `gridFirst`: the exact world grid the zoom-out waits on went out behind the world series page (a 48-frame page held the
 *    background lane's single slot for 8-13 s); it now goes first, and the series half still starts when it settles or at once
 *    when there is nothing to fetch.
 *  - the landing seeds the bridge: a fetched world grid is cached and staged, and (with the hour-aware gate) replaces a base for another hour.
 */
jest.mock('./marineGridSeries', () => ({
  ensureMarineSeries: jest.fn(),
  getMarineSeriesFrame: jest.fn(() => null),
  runBackgroundWarm: jest.fn((fn) => fn()),
}));
jest.mock('./backendCopernicusServiceClient', () => ({ fetchBackendCopernicusGrid: jest.fn() }));
jest.mock('./backendWeatherServiceClient', () => ({ fetchBackendMarineGrid: jest.fn(), getSharedValidTime: jest.fn() }));

const { fetchBackendMarineGrid, getSharedValidTime } = require('./backendWeatherServiceClient');
const { ensureMarineSeries, runBackgroundWarm } = require('./marineGridSeries');
const prewarm = require('./marineGlobalPrewarm');

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const ZOOMED_IN = { west: -81.2, south: 27.5, east: -79.7, north: 28.2 };
const NOW0 = '2026-10-01T12:00:00.000Z';
const WED15 = '2026-10-07T15:00:00.000Z';
const worldGrid = (vt, over = {}) => ({ bounds: WORLD, cols: 181, rows: 82, vectors: [{ lat: 0, lng: 0, speed: 1 }], valid_time: vt, ...over });
const heldBase = (vt, over = {}) => ({ __sourceModel: 'GFS', __componentLayer: 'waves', waveGrid: worldGrid(vt), ...over });
const flush = () => new Promise((r) => setTimeout(r, 0));

let order;
let cached;

beforeEach(() => {
  jest.clearAllMocks();
  // resetMocks strips implementations before every test (CRA): re-install per test, never in the factory.
  getSharedValidTime.mockImplementation((offset) => (Number(offset) === 0 ? NOW0 : WED15));
  runBackgroundWarm.mockImplementation((fn) => fn());
  order = [];
  cached = [];
  ensureMarineSeries.mockImplementation(() => { order.push('series'); });
  fetchBackendMarineGrid.mockImplementation(async () => { order.push('grid'); return { grid: worldGrid(WED15) }; });
  prewarm._resetGlobalPrewarmDedupeForTest();
  prewarm.registerPrewarmDeps({
    getModelSafeMarine: () => null,
    cacheMarineResult: (m, hour, result, layer) => cached.push({ m, hour, layer }),
    isSiblingPrewarmEnabled: () => true,
  });
  window.__MARINE_ENGINE__ = {};
  delete window.isScrubbingTimeline;
});
afterEach(() => {
  delete window.__MARINE_ENGINE__;
  delete window.__RAW_DISABLE_BASE_HOUR_SYNC__;
  delete window.__RAW_DISABLE_WORLD_GRID_FIRST__;
  delete window.__MARINE_BRIDGE_SEED__;
});

describe('_coarseBaseMatches: the hour is part of "matching" when a seed is offered', () => {
  const o = heldBase(NOW0);
  it('without a seed it is the identity test it always was (model and layer)', () => {
    expect(prewarm._coarseBaseMatches(o, 'GFS', 'waves')).toBe(true);
    expect(prewarm._coarseBaseMatches(o, 'ICON', 'waves')).toBe(false);
    expect(prewarm._coarseBaseMatches(o, 'GFS', 'swell_1')).toBe(false);
    expect(prewarm._coarseBaseMatches(null, 'GFS', 'waves')).toBe(false);
  });
  it('with a seed: the same hour matches, another hour does not, an unknown hour fails open', () => {
    expect(prewarm._coarseBaseMatches(o, 'GFS', 'waves', worldGrid(NOW0))).toBe(true);
    expect(prewarm._coarseBaseMatches(o, 'GFS', 'waves', worldGrid(WED15))).toBe(false);
    expect(prewarm._coarseBaseMatches(o, 'GFS', 'waves', worldGrid(undefined))).toBe(true);
  });
  it('the kill switch restores identity-only matching', () => {
    window.__RAW_DISABLE_BASE_HOUR_SYNC__ = true;
    expect(prewarm._coarseBaseMatches(o, 'GFS', 'waves', worldGrid(WED15))).toBe(true);
  });
});

describe('_stageCoarseBridgeSeed: a right-hour seed replaces a base made for another hour', () => {
  it('the page-load base is held and the Wednesday seed arrives: it is STAGED (it was refused before)', () => {
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(NOW0) };
    const seed = worldGrid(WED15);
    prewarm._stageCoarseBridgeSeed(seed, 'GFS', 'waves', 'series_cache');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBe(seed);
    expect(window.__MARINE_BRIDGE_SEED__.lastFrom).toBe('series_cache');
  });
  it('the held base is already for that hour: nothing staged (no churn, no re-encode)', () => {
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(WED15) };
    prewarm._stageCoarseBridgeSeed(worldGrid(WED15), 'GFS', 'waves');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeUndefined();
  });
  it('a pending seed for ANOTHER hour does not block the newer one; a pending seed for the same hour does', () => {
    const older = worldGrid('2026-10-04T12:00:00.000Z');
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(NOW0), _pendingCoarseBaseGrid: older };
    const seed = worldGrid(WED15);
    prewarm._stageCoarseBridgeSeed(seed, 'GFS', 'waves');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBe(seed);
    const again = worldGrid(WED15);
    prewarm._stageCoarseBridgeSeed(again, 'GFS', 'waves');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBe(seed);                         // same hour pending: kept
  });
  it('a base with no known valid time keeps the old behaviour (nothing replaced on a guess)', () => {
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(undefined) };
    prewarm._stageCoarseBridgeSeed(worldGrid(WED15), 'GFS', 'waves');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeUndefined();
  });
  it('the model-switch rule is unchanged: a base for another model never blocks', () => {
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(WED15, { __sourceModel: 'ICON' }) };
    const seed = worldGrid(WED15);
    prewarm._stageCoarseBridgeSeed(seed, 'GFS', 'waves');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBe(seed);
  });
  it('the kill switch restores the old gate: the stale base blocks the seed', () => {
    window.__RAW_DISABLE_BASE_HOUR_SYNC__ = true;
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(NOW0) };
    prewarm._stageCoarseBridgeSeed(worldGrid(WED15), 'GFS', 'waves');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeUndefined();
  });
});

describe('prewarmGlobalMarineGrid: gridFirst', () => {
  it('the default order is unchanged for every other caller: the series half, then the grid', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves');
    await flush();
    expect(order).toEqual(['series', 'grid']);
  });
  it('gridFirst: the exact grid goes out first and the series half starts when it settles', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves', { gridFirst: true });
    expect(order).toEqual([]);                                                                  // nothing has run yet: no series half at call time
    await flush();
    expect(order).toEqual(['grid', 'series']);
    expect(ensureMarineSeries).toHaveBeenCalledTimes(1);
  });
  it('gridFirst: a FAILED grid fetch still releases the series half', async () => {
    fetchBackendMarineGrid.mockImplementation(async () => { order.push('grid'); throw new Error('503'); });
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves', { gridFirst: true });
    await flush();
    expect(order).toEqual(['grid', 'series']);
  });
  it('gridFirst with nothing to fetch (the world grid is cached): the series half starts at once, as it always did', async () => {
    prewarm.registerPrewarmDeps({
      getModelSafeMarine: () => ({ grid: worldGrid(WED15) }),
      cacheMarineResult: () => {}, isSiblingPrewarmEnabled: () => true,
    });
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves', { gridFirst: true });
    expect(order).toEqual(['series']);                                                           // synchronously, no grid request
    await flush();
    expect(fetchBackendMarineGrid).not.toHaveBeenCalled();
  });
  it('gridFirst does not run the series half when the prewarm\'s own gates decline (scrubbing, a wide viewport)', async () => {
    window.isScrubbingTimeline = true;
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves', { gridFirst: true });
    prewarm.prewarmGlobalMarineGrid('GFS', 147, { west: -170, south: -40, east: 40, north: 60 }, 'waves', { gridFirst: true });
    await flush();
    expect(order).toEqual([]);
  });
  it('an in-flight grid for that valid time is not fetched twice, and the series half is not held hostage by it', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves', { gridFirst: true });
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves', { gridFirst: true });
    await flush();
    expect(fetchBackendMarineGrid).toHaveBeenCalledTimes(1);
    expect(ensureMarineSeries).toHaveBeenCalledTimes(2);                                         // idempotent in the real series module (deduped, TTL'd)
  });
  it('the kill switch restores the legacy order for every call, even one that asks for grid first', async () => {
    window.__RAW_DISABLE_WORLD_GRID_FIRST__ = true;
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves', { gridFirst: true });
    await flush();
    expect(order).toEqual(['series', 'grid']);
  });
});

describe('window.__MARINE_GLOBAL_PREWARM__: the read-back that says what each call did', () => {
  const T = () => window.__MARINE_GLOBAL_PREWARM__;
  it('a fetch records when it was queued, when the lane let it start and when it settled', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves', { gridFirst: true });
    expect(T().reasons.fetch).toBe(1);
    expect(T().grid).toMatchObject({ hour: 147, vt: WED15, gridFirst: true });
    expect(typeof T().grid.queuedAt).toBe('number');
    await flush();
    expect(T().grid.startedAt).toBeGreaterThanOrEqual(T().grid.queuedAt);
    expect(T().grid.doneAt).toBeGreaterThanOrEqual(T().grid.startedAt);
    expect(T().grid.ok).toBe(true);
  });
  it('a failed fetch is recorded as not ok', async () => {
    fetchBackendMarineGrid.mockImplementation(async () => { throw new Error('503'); });
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves');
    await flush();
    expect(T().grid.ok).toBe(false);
    expect(typeof T().grid.doneAt).toBe('number');
  });
  it('says WHY a call fetched nothing: in flight, or declined (and why)', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves');
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves');
    expect(T().last).toMatchObject({ reason: 'in_flight', hour: 147, vt: WED15 });
    await flush();
    window.isScrubbingTimeline = true;
    prewarm.prewarmGlobalMarineGrid('GFS', 150, ZOOMED_IN, 'waves');
    expect(T().last).toMatchObject({ reason: 'declined', why: 'scrubbing', hour: 150 });
    delete window.isScrubbingTimeline;
    prewarm.prewarmGlobalMarineGrid('GFS', 150, { west: -170, south: -40, east: 40, north: 60 }, 'waves');
    expect(T().last).toMatchObject({ reason: 'declined', why: 'wide_view' });
    expect(T().calls).toBe(4);
  });
  it('says a world grid of the same valid time already in hand was enough (valid_time_dedupe), and so was a cached one (cache_warm)', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves');
    await flush();
    prewarm.prewarmGlobalMarineGrid('GFS', 150, ZOOMED_IN, 'waves');                             // 147 and 150 share one 3-hourly valid time
    expect(T().last).toMatchObject({ reason: 'valid_time_dedupe', hour: 150, vt: WED15 });
    prewarm._resetGlobalPrewarmDedupeForTest();
    prewarm.registerPrewarmDeps({ getModelSafeMarine: () => ({ grid: worldGrid(WED15) }), cacheMarineResult: () => {}, isSiblingPrewarmEnabled: () => true });
    prewarm.prewarmGlobalMarineGrid('GFS', 153, ZOOMED_IN, 'waves');
    expect(T().last).toMatchObject({ reason: 'cache_warm', hour: 153 });
  });
});

describe('prewarmGlobalMarineGrid: the landing seeds the bridge', () => {
  it('a fetched world grid is cached and staged as the seed, so it REPLACES a base made for another hour (the hour the zoom-out promotes)', async () => {
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(NOW0) };
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves', { gridFirst: true });
    await flush();
    expect(cached).toHaveLength(1);
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid.valid_time).toBe(WED15);
    expect(window.__MARINE_BRIDGE_SEED__.lastFrom).toBe('fetch');
  });
  it('a failed fetch stages nothing', async () => {
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(NOW0) };
    fetchBackendMarineGrid.mockImplementation(async () => { throw new Error('503'); });
    prewarm.prewarmGlobalMarineGrid('GFS', 147, ZOOMED_IN, 'waves', { gridFirst: true });
    await flush();
    expect(cached).toHaveLength(0);
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeUndefined();
  });
});
