/**
 * ONE FRAME, ONE TIME (D1, 2026-10-28; the lead's offline erratic fuzzer at 4bd90d0d9). The BLEND BOTH wash was drawn from another
 * forecast hour or run than the frame on top of it in 75 of 84 sequences (p50 42 h apart, p50 6.3 s, up to 81 s). Repro 3/3: desktop,
 * GFS Waves at Florida z8, PageUp x2 -> the h48 regional tile over the h0 world wash for the rest of the session, worded "the nearest
 * stored forecast"; ICON z5.2 jump to h191 -> the h0 wash under it.
 *
 * Two halves, both pinned here:
 *  - marineStaleHour.washMatchesResident: the engine engages the wash only when the base's DATA instant is within a snapped step of the
 *    resident's and the verified cycles agree (kill __RAW_DISABLE_WASH_TIME_MATCH__); the engine's call site is pinned in source (the
 *    engine cannot be mounted without GL: WebGLMarineEngine.baseHourSync.test.js's method).
 *  - marineGlobalPrewarm.washWorldOnCdn: the right-hour world grid goes at once when the pinned static world set holds a built frame
 *    for it (a CDN read, no backend work), instead of waiting for the idle-only background lane (kill __RAW_DISABLE_WASH_CDN_FIRST__).
 *    Offline, unfixed: the h48 warm was queued and had not started 33 s later.
 */
import fs from 'fs';
import path from 'path';

jest.mock('./marineGridSeries', () => ({
  ensureMarineSeries: jest.fn(),
  getMarineSeriesFrame: jest.fn(() => null),
  runBackgroundWarm: jest.fn(),
}));
jest.mock('./backendCopernicusServiceClient', () => ({ fetchBackendCopernicusGrid: jest.fn() }));
jest.mock('./backendWeatherServiceClient', () => ({ fetchBackendMarineGrid: jest.fn(), getSharedValidTime: jest.fn() }));
jest.mock('./staticFrames', () => ({ staticEligible: jest.fn(), getPinnedIndexSync: jest.fn(), storeSetKeyFor: jest.fn() }));

const { washMatchesResident, washDataMs, SAME_STEP_TOL_MS, HOUR_MS } = require('./marineStaleHour');
const { fetchBackendMarineGrid, getSharedValidTime } = require('./backendWeatherServiceClient');
const { runBackgroundWarm } = require('./marineGridSeries');
const { staticEligible, getPinnedIndexSync, storeSetKeyFor } = require('./staticFrames');
const prewarm = require('./marineGlobalPrewarm');

const H = HOUR_MS;
const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const TILE = { west: -83, south: 25, east: -78, north: 30 };
const H0 = '2026-10-28T15:00:00Z';
const H48 = '2026-10-30T15:00:00Z';
// The shapes the engine holds: the base is its wrapper ({ __sourceModel, __componentLayer, waveGrid }), the resident a conformed grid
// whose valid_time echoes the ASK and whose data instant is the readout-only served time (the fuzzer's z8 repro, as committed).
const base = (pid, over = {}) => ({ __sourceModel: 'GFS', __componentLayer: 'waves',
  waveGrid: { bounds: WORLD, cols: 181, rows: 83, __servedProductId: pid, valid_time: '2026-10-28T16:00:00Z', ...over } });
const resident = (served, over = {}) => ({ bounds: TILE, cols: 17, rows: 21, __sourceModel: 'GFS', __componentLayer: 'waves',
  valid_time: '2026-10-30T16:00:00Z', __readoutServedTime: served, ...over });

afterEach(() => {
  delete window.__RAW_DISABLE_WASH_TIME_MATCH__;
  delete window.__RAW_DISABLE_WASH_CDN_FIRST__;
  delete window.__MARINE_WASH_TIME__;
  delete window.__SURF_MODE__;
});

describe('washMatchesResident: the wash is another time, so it is not drawn', () => {
  it('the z8 repro: the h0 world wash under the h48 regional tile is refused, 48 h apart', () => {
    const v = washMatchesResident(base('gfs_marine_waves_global_mid_20261028T150000Z.json'), resident(H48));
    expect(v).toEqual({ ok: false, why: 'other_time', offH: -48 });
    expect(window.__MARINE_WASH_TIME__).toMatchObject({ refused: 1, last: { why: 'other_time' } });
  });
  it('the right-hour base engages: the same instant, and a snap inside the step (3-hourly lattice, 1 h off)', () => {
    expect(washMatchesResident(base('gfs_marine_waves_global_mid_20261030T150000Z.json'), resident(H48)).ok).toBe(true);
    expect(washMatchesResident(base('gfs_marine_waves_global_mid_20261030T150000Z.json'), resident('2026-10-30T16:00:00Z')).ok).toBe(true);
  });
  it('the step edge: SAME_STEP_TOL_MS engages, a 3 h gap (EURO 6-hourly) does not', () => {
    const b = base(null, { __servedProductId: null, served_valid_time: H48 });
    expect(washMatchesResident(b, resident(new Date(Date.parse(H48) + SAME_STEP_TOL_MS).toISOString())).ok).toBe(true);
    expect(washMatchesResident(b, resident(new Date(Date.parse(H48) + 3 * H).toISOString())).why).toBe('other_time');
  });
  it('one time, two runs (the run rollover: a 00Z wash under a 06Z tile) is refused when both name their verified cycle', () => {
    const b = base('gfs_marine_waves_global_mid_20261030T150000Z.json', { model_run_time: '2026-10-28T00:00:00Z', model_run_time_status: 'known' });
    expect(washMatchesResident(b, resident(H48, { __readoutModelRun: '2026-10-28T06:00:00Z' }))).toEqual({ ok: false, why: 'other_run', offH: -6 });
    expect(washMatchesResident(b, resident(H48, { __readoutModelRun: '2026-10-28T00:00:00Z' })).ok).toBe(true);
    expect(washMatchesResident(b, resident(H48)).ok).toBe(true);                       // one side unnamed: the time alone decides
    const ingestOnly = base('gfs_marine_waves_global_mid_20261030T150000Z.json', { run_time: '2026-10-28T03:31:00Z' });
    expect(washMatchesResident(ingestOnly, resident(H48, { run_time: '2026-10-28T09:12:00Z' })).ok).toBe(true);   // never the ingest clock
  });
  it('an unknown instant on either side fails OPEN (the old behaviour), counted', () => {
    expect(washMatchesResident(base(null, { __servedProductId: null, valid_time: null }), resident(H48))).toEqual({ ok: true, why: 'unknown_time' });
    expect(window.__MARINE_WASH_TIME__.unknown).toBe(1);
    expect(washMatchesResident(null, resident(H48)).why).toBe('none');
  });
  it('the data instant: served time first (the readout-only copy too), then the product stamp, then the grid\'s own time', () => {
    expect(washDataMs({ served_valid_time: H48, __servedProductId: 'x_20261028T150000Z.json' })).toBe(Date.parse(H48));
    expect(washDataMs({ waveGrid: { __readoutServedTime: H0 } })).toBe(Date.parse(H0));
    expect(washDataMs({ productId: 'icon_marine_waves_global_mid_20261105T180000Z_estimated.json' })).toBe(Date.parse('2026-11-05T18:00:00Z'));
    expect(washDataMs({ __fromSeries: true, valid_time: H0 })).toBe(Date.parse(H0));
  });
  it('kill: __RAW_DISABLE_WASH_TIME_MATCH__ engages the wrong-hour wash again', () => {
    window.__RAW_DISABLE_WASH_TIME_MATCH__ = true;
    expect(washMatchesResident(base('gfs_marine_waves_global_mid_20261028T150000Z.json'), resident(H48))).toEqual({ ok: true, why: 'killed' });
  });
});

describe('the engine engages BLEND BOTH only through the time rule (call site, in source)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineEngine.js'), 'utf8');
  it('imports the rule and asks it in the engage condition, after the model and layer parity, with the held base and the resident', () => {
    expect(src).toMatch(/import \{ washMatchesResident \} from '\.\/marineStaleHour';/);
    const at = src.indexOf('cg.__sourceModel === curModel && cg.__componentLayer === curLayer &&');
    expect(at).toBeGreaterThan(0);
    const cond = src.slice(at, src.indexOf('blendEngaged = true;', at));
    expect(cond).toMatch(/washMatchesResident\(cg, _gridForBlend\)\.ok\) \{/);
  });
});

describe('washWorldOnCdn + the prewarm: a CDN-built world frame skips the background lane', () => {
  const VT = '2026-10-30T15:00:00.000Z';
  const index = { frames: [{ valid_time: VT, path: 'v1/gfs/marine/waves/global_mid/x/20261030T150000Z.bin' }] };
  beforeEach(() => {
    jest.clearAllMocks();
    staticEligible.mockReturnValue(true);
    storeSetKeyFor.mockReturnValue('GFS/marine/waves/global_mid');
    getPinnedIndexSync.mockReturnValue(index);
    getSharedValidTime.mockReturnValue(VT);
    runBackgroundWarm.mockImplementation(() => new Promise(() => {}));   // the lane never frees: the offline repro's 33 s
    fetchBackendMarineGrid.mockResolvedValue({ grid: { bounds: WORLD, cols: 181, rows: 83, vectors: [{ lat: 0, lng: 0, speed: 1 }], valid_time: VT } });
    prewarm._resetGlobalPrewarmDedupeForTest();
    prewarm.registerPrewarmDeps({ getModelSafeMarine: () => null, cacheMarineResult: jest.fn(), isSiblingPrewarmEnabled: () => true });
    window.__MARINE_ENGINE__ = {};
  });
  afterEach(() => { delete window.__MARINE_ENGINE__; delete window.__MARINE_GLOBAL_PREWARM__; delete window.__MARINE_BRIDGE_SEED__; });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('ready only for a built frame of the pinned world set at the asked time, outside the band', () => {
    expect(prewarm.washWorldOnCdn('GFS', 'waves', VT)).toBe(true);
    expect(staticEligible).toHaveBeenCalledWith({ model: 'GFS', layer: 'waves', bbox: WORLD, surf: false });
    getPinnedIndexSync.mockReturnValueOnce({ frames: [{ valid_time: VT }] });           // listed, not built: /grid would serve it
    expect(prewarm.washWorldOnCdn('GFS', 'waves', VT)).toBe(false);
    getPinnedIndexSync.mockReturnValueOnce(null);                                          // not pinned (a swell layer, an unguarded EURO set)
    expect(prewarm.washWorldOnCdn('GFS', 'waves', VT)).toBe(false);
    window.__SURF_MODE__ = true; staticEligible.mockReturnValueOnce(false);                // the band: a rating grid is a server transform
    expect(prewarm.washWorldOnCdn('GFS', 'waves', VT)).toBe(false);
    expect(staticEligible).toHaveBeenLastCalledWith(expect.objectContaining({ surf: true }));
    expect(prewarm.washWorldOnCdn('GFS', 'waves', null)).toBe(false);
  });

  it('the z8 repro: the h48 world grid is fetched at once and staged as the wash seed, while the lane stays blocked', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 48, { west: -81.2, south: 27.5, east: -79.7, north: 28.2 }, 'waves', { gridFirst: true });
    await flush(); await flush();
    expect(runBackgroundWarm).not.toHaveBeenCalled();
    expect(fetchBackendMarineGrid).toHaveBeenCalledTimes(1);
    expect(window.__MARINE_GLOBAL_PREWARM__.grid).toMatchObject({ hour: 48, cdnFirst: true, ok: true });
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeTruthy();
  });

  it('a backend world grid keeps the lane (no CDN frame), and so does the kill', async () => {
    getPinnedIndexSync.mockReturnValue(null);
    prewarm.prewarmGlobalMarineGrid('GFS', 48, { west: -81.2, south: 27.5, east: -79.7, north: 28.2 }, 'waves');
    await flush();
    expect(runBackgroundWarm).toHaveBeenCalledTimes(1);
    expect(fetchBackendMarineGrid).not.toHaveBeenCalled();
    prewarm._resetGlobalPrewarmDedupeForTest(); runBackgroundWarm.mockClear();
    getPinnedIndexSync.mockReturnValue(index);
    window.__RAW_DISABLE_WASH_CDN_FIRST__ = true;
    prewarm.prewarmGlobalMarineGrid('GFS', 48, { west: -81.2, south: 27.5, east: -79.7, north: 28.2 }, 'waves');
    await flush();
    expect(runBackgroundWarm).toHaveBeenCalledTimes(1);
    expect(fetchBackendMarineGrid).not.toHaveBeenCalled();
  });
});
