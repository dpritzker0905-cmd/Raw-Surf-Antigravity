/**
 * The world warm keeps the exact 2-degree frame for the selected hour at EVERY zoom the bridge's band covers (2026-10-02; owner: "keep the 2
 * degree frame for the selected hour at every zoom in that range"; the follow-up to F-22; marineGlobalPrewarm.js, marineStaleHour.js).
 *
 * Two facts pinned here, each the defect when it fails:
 *  - SEED GATE (rule 6): `_coarseBaseMatches` / `_stageCoarseBridgeSeed` asked "same model, layer and hour: a base is held, nothing to stage",
 *    so once a THIN frame (46 x 20) was the held base the exact world frame the warm fetched, or the one already cached, was never staged:
 *    offline phone replay, trial 3 held the thin base for 28 s with the exact frame in the controller cache. A finer lattice of the same
 *    data now stages; an exact base still refuses a thin seed.
 *  - THE BAND: the F-21 world warm (`opts.band`, passed by marineWorldWarmOnSettle) was declined by the prewarm's own `wide_view` gate whenever the
 *    view was over 15 degrees, and the per-fetch prewarm calls are declined there too, so in the band the bridge's ceiling leaves (15 to 40
 *    degrees) NOTHING asked for the exact world frame of the selected hour. It now does, once per settled valid time, GRID ONLY: the world
 *    series half (three 48-frame pages, 10-13 s of box CPU each) stays a regional-zoom activity.
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
const REGIONAL = { west: -81.2, south: 27.5, east: -79.7, north: 28.2 };          // 1.5 x 0.7 deg: a regional zoom
const TWELVE = { west: -86, south: 22, east: -74, north: 34 };                      // 12 x 12 deg: still regional by the 15 deg gate
const BAND_30 = { west: -95, south: 15, east: -65, north: 35 };                      // 30 x 20 deg: past the 15 deg regional gate, inside the 40 deg ceiling
const BAND_40 = { west: -100, south: 10, east: -60, north: 40 };                     // exactly 40 wide: the ceiling itself is still the band
const PAST_CEILING = { west: -125, south: -10, east: -75, north: 40 };               // 50 x 50 deg: a world view, the fetch path's own
const TALL_ONLY = { west: -90, south: -20, east: -70, north: 25 };                   // 20 wide x 45 tall: one axis past the ceiling
const WIDE_ONLY = { west: -110, south: 10, east: -65, north: 30 };                   // 45 wide x 20 tall: the other axis
const WED15 = '2026-10-07T15:00:00.000Z';
const worldGrid = (vt, over = {}) => ({ bounds: WORLD, cols: 181, rows: 82, vectors: [{ lat: 0, lng: 0, speed: 1 }], valid_time: vt, ...over });
const thinGrid = (vt, over = {}) => worldGrid(vt, { cols: 46, rows: 20, __decimatedStride: 4, ...over });
const heldBase = (grid) => ({ __sourceModel: 'GFS', __componentLayer: 'waves', waveGrid: grid });
const flush = () => new Promise((r) => setTimeout(r, 0));

let order;
let cached;

beforeEach(() => {
  jest.clearAllMocks();
  getSharedValidTime.mockImplementation(() => WED15);
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
  delete window.__RAW_DISABLE_BASE_HOLD__;
  delete window.__RAW_DISABLE_WORLD_WARM_BAND__;
  delete window.__RAW_MARINE_GLOBAL_SPAN__;
  delete window.__MARINE_BRIDGE_SEED__;
});

describe('the seed gate: a finer lattice of the same hour is staged over a thinner base', () => {
  it('a THIN base is held and the exact frame of the same hour arrives (the warm\'s landing, or the cached world grid): it is STAGED (it was refused)', () => {
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(thinGrid(WED15)) };
    const seed = worldGrid(WED15);
    prewarm._stageCoarseBridgeSeed(seed, 'GFS', 'waves', 'cache_warm');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBe(seed);
    expect(window.__MARINE_BRIDGE_SEED__.lastFrom).toBe('cache_warm');
  });

  it('an EXACT base is held and a thin placeholder of the same hour is offered: nothing is staged (the exact base keeps its place)', () => {
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(worldGrid(WED15)) };
    prewarm._stageCoarseBridgeSeed(thinGrid(WED15), 'GFS', 'waves', 'series_cache_thinned');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeUndefined();
  });

  it('a pending THIN seed does not block the exact one of the same hour, and a pending exact seed is not displaced by a thin one', () => {
    const thinSeed = thinGrid(WED15);
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(thinGrid('2026-10-01T12:00:00.000Z')), _pendingCoarseBaseGrid: thinSeed };
    const exactSeed = worldGrid(WED15);
    prewarm._stageCoarseBridgeSeed(exactSeed, 'GFS', 'waves');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBe(exactSeed);
    prewarm._stageCoarseBridgeSeed(thinGrid(WED15), 'GFS', 'waves');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBe(exactSeed);
  });

  it('_coarseBaseMatches says a thin base does not match the exact seed of its hour, and an exact base matches a thin one', () => {
    expect(prewarm._coarseBaseMatches(heldBase(thinGrid(WED15)), 'GFS', 'waves', worldGrid(WED15))).toBe(false);
    expect(prewarm._coarseBaseMatches(heldBase(worldGrid(WED15)), 'GFS', 'waves', thinGrid(WED15))).toBe(true);
    expect(prewarm._coarseBaseMatches(heldBase(thinGrid(WED15)), 'GFS', 'waves')).toBe(true);        // no seed: identity only, as ever
  });

  it('the kill switch restores the old gate: a thin base blocks the exact seed of its own hour', () => {
    window.__RAW_DISABLE_BASE_HOLD__ = true;
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(thinGrid(WED15)) };
    prewarm._stageCoarseBridgeSeed(worldGrid(WED15), 'GFS', 'waves');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeUndefined();
  });

  it('the world warm\'s landing replaces a thin base end to end: the fetched exact grid is cached and staged over the thin frame', async () => {
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(thinGrid(WED15)) };
    prewarm.prewarmGlobalMarineGrid('GFS', 147, REGIONAL, 'waves', { gridFirst: true, band: true });
    await flush();
    expect(cached).toHaveLength(1);
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeDefined();
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid.cols).toBe(181);
  });

  it('a cached exact world grid also re-enters the base over a thin one (cache_warm: zero network)', () => {
    prewarm.registerPrewarmDeps({
      getModelSafeMarine: () => ({ grid: worldGrid(WED15) }), cacheMarineResult: () => {}, isSiblingPrewarmEnabled: () => true,
    });
    window.__MARINE_ENGINE__ = { _coarseBaseData: heldBase(thinGrid(WED15)) };
    prewarm.prewarmGlobalMarineGrid('GFS', 147, REGIONAL, 'waves', { gridFirst: true, band: true });
    expect(fetchBackendMarineGrid).not.toHaveBeenCalled();
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeDefined();
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid.cols).toBe(181);
  });
});

describe('the band: the world warm asks for the exact frame where the bridge\'s ceiling leaves it (15 to 40 degrees)', () => {
  it('a band view with opts.band: the exact grid is fetched, once, for that hour', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_30, 'waves', { gridFirst: true, band: true });
    await flush();
    expect(fetchBackendMarineGrid).toHaveBeenCalledTimes(1);
    expect(fetchBackendMarineGrid.mock.calls[0][1]).toBe(147);
    expect(cached).toHaveLength(1);
  });

  it('opts.band alone (without gridFirst) is grid only too, and a view across the antimeridian is measured with its wrap (160 to -170 is 30 degrees wide)', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_30, 'waves', { band: true });
    await flush();
    expect(order).toEqual(['grid']);
    prewarm._resetGlobalPrewarmDedupeForTest();
    fetchBackendMarineGrid.mockClear();
    order.length = 0;
    prewarm.prewarmGlobalMarineGrid('GFS', 147, { west: 160, south: 10, east: -170, north: 30 }, 'waves', { gridFirst: true, band: true });
    await flush();
    expect(order).toEqual(['grid']);
    prewarm._resetGlobalPrewarmDedupeForTest();
    fetchBackendMarineGrid.mockClear();
    prewarm.prewarmGlobalMarineGrid('GFS', 147, { west: 120, south: 10, east: -100, north: 30 }, 'waves', { gridFirst: true, band: true });   // 140 degrees across the antimeridian: a world view
    await flush();
    expect(fetchBackendMarineGrid).not.toHaveBeenCalled();
  });

  it('once the band fetch has landed, the next call for the same valid time makes no request (one world /grid per settled valid time)', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_30, 'waves', { gridFirst: true, band: true });
    await flush();
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_30, 'waves', { gridFirst: true, band: true });
    prewarm.prewarmGlobalMarineGrid('GFS', 150, BAND_40, 'waves', { gridFirst: true, band: true });       // 150 shares the 3-hourly valid time of 147
    await flush();
    expect(fetchBackendMarineGrid).toHaveBeenCalledTimes(1);
    expect(window.__MARINE_GLOBAL_PREWARM__.last).toMatchObject({ reason: 'valid_time_dedupe', hour: 150 });
  });

  it('GRID ONLY in the band: the world series half (three 48-frame pages) is never started from a band view, landed or not', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_30, 'waves', { gridFirst: true, band: true });
    await flush();
    expect(order).toEqual(['grid']);
    expect(ensureMarineSeries).not.toHaveBeenCalled();
  });

  it('GRID ONLY also when there is nothing to fetch (the world grid is cached): it still seeds the base, and the series half does not start from a band view either', () => {
    prewarm.registerPrewarmDeps({
      getModelSafeMarine: () => ({ grid: worldGrid(WED15) }), cacheMarineResult: () => {}, isSiblingPrewarmEnabled: () => true,
    });
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_30, 'waves', { gridFirst: true, band: true });
    expect(window.__MARINE_GLOBAL_PREWARM__.last).toMatchObject({ reason: 'cache_warm', hour: 147 });   // it ran (the gate did not decline it)...
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid.cols).toBe(181);                                // ...and the cached frame is the staged seed
    expect(order).toEqual([]);                                                                             // ...with no series half
  });

  it('a failed band fetch starts no series half either', async () => {
    fetchBackendMarineGrid.mockImplementation(async () => { order.push('grid'); throw new Error('503'); });
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_30, 'waves', { gridFirst: true, band: true });
    await flush();
    expect(order).toEqual(['grid']);
  });

  it('the ceiling itself (40 degrees) is still the band, and a view past it is declined: a world view has its own fetch path', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_40, 'waves', { gridFirst: true, band: true });
    await flush();
    expect(fetchBackendMarineGrid).toHaveBeenCalledTimes(1);
    prewarm._resetGlobalPrewarmDedupeForTest();
    fetchBackendMarineGrid.mockClear();
    prewarm.prewarmGlobalMarineGrid('GFS', 150, PAST_CEILING, 'waves', { gridFirst: true, band: true });
    await flush();
    expect(fetchBackendMarineGrid).not.toHaveBeenCalled();
    expect(window.__MARINE_GLOBAL_PREWARM__.last).toMatchObject({ reason: 'declined', why: 'wide_view' });
  });

  it('EITHER axis past the ceiling declines the band: a view only 45 tall (20 wide) or only 45 wide (20 tall) is a world view', async () => {
    for (const view of [TALL_ONLY, WIDE_ONLY]) {
      prewarm._resetGlobalPrewarmDedupeForTest();
      fetchBackendMarineGrid.mockClear();
      prewarm.prewarmGlobalMarineGrid('GFS', 147, view, 'waves', { gridFirst: true, band: true });
      await flush();
      expect(fetchBackendMarineGrid).not.toHaveBeenCalled();
      expect(window.__MARINE_GLOBAL_PREWARM__.last).toMatchObject({ reason: 'declined', why: 'wide_view' });
    }
  });

  it('follows the bridge\'s own tuned ceiling (__RAW_MARINE_GLOBAL_SPAN__), and a ceiling tuned below the regional gate leaves a regional view alone (and empties the band)', async () => {
    window.__RAW_MARINE_GLOBAL_SPAN__ = 60;
    prewarm.prewarmGlobalMarineGrid('GFS', 147, PAST_CEILING, 'waves', { gridFirst: true, band: true });
    await flush();
    expect(fetchBackendMarineGrid).toHaveBeenCalledTimes(1);
    prewarm._resetGlobalPrewarmDedupeForTest();
    fetchBackendMarineGrid.mockClear();
    order.length = 0;
    window.__RAW_MARINE_GLOBAL_SPAN__ = 5;                                                  // an operator tuned the ceiling below the regional gate
    prewarm.prewarmGlobalMarineGrid('GFS', 147, TWELVE, 'waves', { gridFirst: true, band: true });   // 12 degrees: regional by the gate, wide by the tuned ceiling
    await flush();
    expect(order).toEqual(['grid', 'series']);                                              // a regional view keeps its whole old behaviour
    prewarm._resetGlobalPrewarmDedupeForTest();
    fetchBackendMarineGrid.mockClear();
    prewarm.prewarmGlobalMarineGrid('GFS', 150, BAND_30, 'waves', { gridFirst: true, band: true });  // the tuned ceiling empties the band
    await flush();
    expect(fetchBackendMarineGrid).not.toHaveBeenCalled();
  });

  it('every other caller is unchanged: a band view WITHOUT opts.band is declined as wide_view (the per-fetch calls never warm the series from the band)', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_30, 'waves');
    prewarm.prewarmGlobalMarineGrid('GFS', 150, BAND_30, 'waves', { gridFirst: true });
    await flush();
    expect(fetchBackendMarineGrid).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    expect(window.__MARINE_GLOBAL_PREWARM__.last).toMatchObject({ reason: 'declined', why: 'wide_view' });
  });

  it('a REGIONAL view with opts.band behaves exactly as before: grid first, then the series half', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, REGIONAL, 'waves', { gridFirst: true, band: true });
    await flush();
    expect(order).toEqual(['grid', 'series']);
  });

  it('keeps every gate it had: scrubbing declines a band warm too, and the same valid time is not fetched twice', async () => {
    window.isScrubbingTimeline = true;
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_30, 'waves', { gridFirst: true, band: true });
    expect(window.__MARINE_GLOBAL_PREWARM__.last).toMatchObject({ reason: 'declined', why: 'scrubbing' });
    delete window.isScrubbingTimeline;
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_30, 'waves', { gridFirst: true, band: true });
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_30, 'waves', { gridFirst: true, band: true });
    await flush();
    expect(fetchBackendMarineGrid).toHaveBeenCalledTimes(1);
  });

  it('records that the fetch came from the band, so a read-back can tell the two apart', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_30, 'waves', { gridFirst: true, band: true });
    expect(window.__MARINE_GLOBAL_PREWARM__.last).toMatchObject({ reason: 'fetch', band: true });
    await flush();
    prewarm._resetGlobalPrewarmDedupeForTest();
    prewarm.prewarmGlobalMarineGrid('GFS', 147, REGIONAL, 'waves', { gridFirst: true, band: true });
    expect(window.__MARINE_GLOBAL_PREWARM__.last.band).toBeFalsy();
  });

  it('honours the kill switch: a band view is declined again, as before', async () => {
    window.__RAW_DISABLE_WORLD_WARM_BAND__ = true;
    prewarm.prewarmGlobalMarineGrid('GFS', 147, BAND_30, 'waves', { gridFirst: true, band: true });
    await flush();
    expect(fetchBackendMarineGrid).not.toHaveBeenCalled();
    expect(window.__MARINE_GLOBAL_PREWARM__.last).toMatchObject({ reason: 'declined', why: 'wide_view' });
  });
});
