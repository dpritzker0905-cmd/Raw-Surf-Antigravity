/**
 * Paused heat map churn — the SERIES-ENTRY CHOICE (2026-10-08, the mechanism draft PR #267 left out by name).
 *
 * THE SCENE (owner's console, GFS Waves, z7.26 off Florida, paused at offset 16): two cached series entries cover the viewport.
 *   - the EXACT viewport-key entry is COARSE: 6 x 5 over 10 degrees (1.67 deg cells). A clamp-driven force load
 *     (`ensureMarineSeries(..., currentPageOnly=true, force=true)` in runScrubSettleCheck) stored it under the exact key;
 *   - an entry stored under a neighbouring key (an earlier viewport) is FINE: the 0.25-degree tile, 23 x 13 over 5.54 degrees.
 * getMarineSeriesFrame took the exact key first and only ran the "smallest containing" fallback on a miss, so the coarse entry won.
 * The clamp sharpen then committed it: frameFinerEnough compares with the RESIDENT only (1.67 < 0.9 x 1.92, the 2-degree clip), and
 * the 6 x 5 still reads `regional_too_coarse`. The 2-degree /grid clip is not a >= 2x downgrade of the 6 x 5, so the two alternated
 * until the clamp_resharpen cap ran out; it settled on a grid the cached fine tile beats.
 *
 * Unlike marinePausedChurn.test.js this file mocks NOTHING in the series module: the cache is filled through its real load path (a
 * mocked fetch answering /grid_series), and the real runScrubSettleCheck reads it.
 */
import { ensureMarineSeries, getMarineSeriesFrame, _resetMarineSeriesForTest } from './marineGridSeries';
import { runScrubSettleCheck } from './useMarineScrubSettle';
import { setCachedManifest } from './backendWeatherServiceClient';
import { decideMarineCommit, __resetArbiterGraceForTests } from './marineCommitGate';

const NOW = Date.parse('2026-10-08T20:58:22Z');   // the recording's clock: the anchor rounds to 21:00Z, so frames sit on 15, 18, ...
const ANCHOR = Date.parse('2026-10-08T21:00:00Z');
const validAt = h => new Date(ANCHOR + h * 3600e3).toISOString().replace('.000Z', 'Z');   // offset 15 -> 2026-10-09T12:00:00Z
const T12 = '2026-10-09T12:00:00Z';
const MANIFEST = { products: ['06', '09', '12', '15', '18'].map(h => (
  { model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: `2026-10-09T${h}:00:00Z` })) };
const VIEW = { west: -82.47, south: 27.03, east: -77.93, north: 29.06 };   // the logged viewport (key -82.5_27.0_-78.0_29.0)
const EARLIER_VIEW = { west: -82.2, south: 27.3, east: -77.7, north: 29.3 }; // another key (-82.0_27.5_-77.5_29.5) whose tile covers VIEW
const WIDE_VIEW = { west: -100, south: 10, east: -60, north: 45 };           // > 15 degrees: the 'global' key
const ZOOM = 7.26;
const vec = [{ lat: 28, lng: -80, speed: 1.2, u: 0.1, v: 0.1, direction: 0, period: 9 }];

const FINE = { cols: 23, rows: 13, bounds: { west: -82.75, south: 26.6, east: -77.21, north: 29.6 } };     // 0.24 deg cells
const COARSE = { cols: 6, rows: 5, bounds: { west: -85.2, south: 24.0, east: -75.2, north: 32.0 } };      // 1.67 deg cells
const CLIP = { cols: 25, rows: 19, bounds: { west: -106, south: 10, east: -58, north: 46 } };             // the /grid 2-degree clip
const WORLD = { cols: 181, rows: 83, bounds: { west: -180, south: -80, east: 180, north: 85 } };

const pageOf = (grid, hours) => ({ ok: true, status: 200,
  json: async () => ({ frames: hours.map(h => ({ hour_offset: h, valid_time: validAt(h), cols: grid.cols, rows: grid.rows, bounds: grid.bounds,
    vectors: vec })) }) });

// One series page through the real loader: ensureMarineSeries -> loadSeriesPage -> the cache entry for `requestBounds`' key.
async function seed(requestBounds, grid, { hours = [15, 18], surf = false, model = 'GFS', layer = 'waves' } = {}) {
  window.__SURF_MODE__ = surf;
  global.fetch = jest.fn(async () => pageOf(grid, hours));
  await ensureMarineSeries(model, layer, requestBounds, 16, undefined, true);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(global.fetch).toHaveBeenCalledTimes(1);       // the seed really loaded (not deduped against an earlier one)
}
const dims = f => (f ? `${f.grid.cols}x${f.grid.rows}` : null);

const mkMap = () => ({
  getZoom: () => ZOOM,
  getBounds: () => ({ getWest: () => VIEW.west, getEast: () => VIEW.east, getSouth: () => VIEW.south, getNorth: () => VIEW.north }),
});
const residentOf = grid => ({ ...grid, vectors: vec, hourOffset: 16, __renderable: true, __sourceModel: 'GFS', __componentLayer: 'waves' });
const mkCtx = (resident) => ({
  marineData: { grid: resident, hourOffset: resident.hourOffset, __sourceModel: 'GFS' }, mapInstance: mkMap(), setMarineData: jest.fn(),
  timeOffsetRef: { current: 16 }, activeModelRef: { current: 'GFS' }, activeMarineLayerRef: { current: 'waves' },
  safetyNetRetryRef: { current: { key: '', count: 0 } }, clampRefetchRef: { current: { key: '', count: 0 } },
  marineFetchLocksRef: { current: { isFetching: false, lastHash: 'abc' } }, updateMarineGridRef: { current: jest.fn() },
  marineRevision: { current: 0 }, lastCommittedSigRef: { current: null },
});
const settleWith = (residentGrid) => {
  window.__MARINE_ENGINE__ = { _waveData: { waveGrid: residentOf(residentGrid) } };
  const ctx = mkCtx(residentOf(residentGrid));
  runScrubSettleCheck(ctx);
  return ctx;
};

beforeEach(() => {
  _resetMarineSeriesForTest();
  window.__MOCK_DATE_NOW__ = NOW;
  window.__MARINE_SERIES__ = true;
  window.__RAW_DISABLE_HOUR0_FIRST__ = true;             // no mini lane: one fetch per seed, so each entry is exactly what we stored
  window.__MARINE_SERIES_DIAG__ = { loads: 0, hits: 0, misses: 0 };
  window.isScrubbingTimeline = false;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  _resetMarineSeriesForTest();
  delete global.fetch;
  delete window.__MOCK_DATE_NOW__;
  delete window.__SURF_MODE__;
  delete window.__MARINE_ENGINE__;
  delete window.__RAW_DISABLE_HOUR0_FIRST__;
  delete window.__RAW_DISABLE_SERIES_FINER_ENTRY__;
  setCachedManifest(null);
});

// THE TRAJECTORY, with the real cache, the real settle check and the real no-downgrade guard: each round runs the settle check against
// the drawn grid, and offers whatever it commits, then the /grid clip its clamp_resharpen fetch brings back (the logged 25 x 19 over 48
// degrees, labelled 16, valid 12:00Z), through decideMarineCommit, as WebGLMarineEngine.setWaveData does. No timers: one round is one
// backstop re-drive, and the per-viewport resharpen cap is carried across rounds as the hook's ref carries it.
function trajectory(rounds = 8) {
  setCachedManifest(MANIFEST);
  __resetArbiterGraceForTests();
  const clipGrid = { ...residentOf(CLIP), hourOffset: 16, valid_time: T12 };
  let md = { grid: clipGrid, hourOffset: 16, valid_time: T12, __sourceModel: 'GFS' };
  const clampRefetchRef = { current: { key: '', count: 0 } };
  const switches = [];
  const offer = (next, lane) => {
    if (decideMarineCommit(md.grid, next.grid, ZOOM, [VIEW.west, VIEW.south, VIEW.east, VIEW.north], window, NOW).reject) return;
    if (dims(next) !== dims(md)) switches.push(`${lane}:${dims(next)}`);
    md = next;
  };
  for (let i = 0; i < rounds; i++) {
    window.__MARINE_ENGINE__ = { _waveData: { waveGrid: md.grid } };
    const ctx = { ...mkCtx(md.grid), marineData: md, clampRefetchRef };
    runScrubSettleCheck(ctx);
    ctx.setMarineData.mock.calls.forEach(([committed]) => offer(committed, 'series_sharpen'));
    if (ctx.updateMarineGridRef.current.mock.calls.length) offer({ grid: clipGrid, hourOffset: 16, valid_time: T12 }, 'grid');
  }
  return { switches, drawn: dims(md) };
}

describe('the trajectory: paused at offset 16 over the 2-degree clip, both series entries cached (8 re-drives)', () => {
  beforeEach(async () => {
    await seed(EARLIER_VIEW, FINE);
    await seed(VIEW, COARSE);
  });

  it('CONTROL: the kill switch replays the recorded alternation, so the quiet run below means something', () => {
    window.__RAW_DISABLE_SERIES_FINER_ENTRY__ = true;
    const r = trajectory();
    expect(r.switches).toEqual(['series_sharpen:6x5', 'grid:25x19', 'series_sharpen:6x5', 'grid:25x19', 'series_sharpen:6x5']);
    expect(r.drawn).toBe('6x5');                          // settles only when the resharpen cap runs out, on the coarse grid
  });

  it('one sharpen to the fine tile, the clip refused as a downgrade, then still', () => {
    const r = trajectory();
    expect(r.switches).toEqual(['series_sharpen:23x13']);
    expect(r.drawn).toBe('23x13');
  });
});

describe('the FIXED SCENE: a coarse exact-key entry and a fine containing entry both cover the view', () => {
  beforeEach(async () => {
    await seed(EARLIER_VIEW, FINE);
    await seed(VIEW, COARSE);
  });

  it('getMarineSeriesFrame serves the fine tile (before the fix: the 6x5 under the exact key)', () => {
    expect(dims(getMarineSeriesFrame('GFS', 'waves', VIEW, 16))).toBe('23x13');
  });

  it('the clamp sharpen over the 2-degree clip commits the fine tile (before the fix: the 6x5, which still reads too coarse)', () => {
    const ctx = settleWith(CLIP);
    expect(ctx.setMarineData).toHaveBeenCalledTimes(1);
    expect(dims(ctx.setMarineData.mock.calls[0][0])).toBe('23x13');
  });

  it('the clamp sharpen over the 6x5 commits the fine tile (before the fix: nothing committed, the coarse page force-reloaded)', () => {
    const ctx = settleWith(COARSE);
    expect(ctx.setMarineData).toHaveBeenCalledTimes(1);
    expect(dims(ctx.setMarineData.mock.calls[0][0])).toBe('23x13');
  });

  it('with the fine tile drawn the view no longer reads as clamped, so the settle check leaves it alone', () => {
    const ctx = settleWith(FINE);
    expect(ctx.setMarineData).not.toHaveBeenCalled();
    expect(ctx.updateMarineGridRef.current).not.toHaveBeenCalled();
  });

  it('within the chosen entry the nearest frame is still the one served (18 is nearer to 17 than 15)', () => {
    const f = getMarineSeriesFrame('GFS', 'waves', VIEW, 17);
    expect([dims(f), f.grid.hourOffset]).toEqual(['23x13', 18]);
  });

  it('counts the swap for the diagnostics HUD', () => {
    getMarineSeriesFrame('GFS', 'waves', VIEW, 16);
    expect(window.__MARINE_SERIES_DIAG__.finerEntrySwaps).toBe(1);
  });

  it('POSITIVE CONTROL: the kill switch restores the exact-key-first choice', () => {
    window.__RAW_DISABLE_SERIES_FINER_ENTRY__ = true;
    expect(dims(getMarineSeriesFrame('GFS', 'waves', VIEW, 16))).toBe('6x5');
  });
});

describe('POSITIVE CONTROLS: what must not change', () => {
  it('the exact-key entry still wins when it is the finest', async () => {
    await seed(EARLIER_VIEW, COARSE);
    await seed(VIEW, FINE);
    expect(dims(getMarineSeriesFrame('GFS', 'waves', VIEW, 16))).toBe('23x13');
    expect(window.__MARINE_SERIES_DIAG__.finerEntrySwaps).toBeUndefined();
  });

  it('the exact-key entry wins a tie, and a candidate under 10% finer is not worth a swap', async () => {
    const shifted = { cols: 23, rows: 13, bounds: { west: -82.7, south: 26.65, east: -77.16, north: 29.65 } };        // same cells
    const slightlyFiner = { cols: 24, rows: 13, bounds: { west: -82.7, south: 26.65, east: -77.16, north: 29.65 } };  // 4% finer
    await seed(VIEW, FINE);
    await seed(EARLIER_VIEW, shifted);
    expect(getMarineSeriesFrame('GFS', 'waves', VIEW, 16).grid.bounds).toEqual(FINE.bounds);
    _resetMarineSeriesForTest();
    await seed(VIEW, FINE);
    await seed(EARLIER_VIEW, slightlyFiner);
    expect(dims(getMarineSeriesFrame('GFS', 'waves', VIEW, 16))).toBe('23x13');
  });

  it('a region with only the world product still falls back to it', async () => {
    await seed(WIDE_VIEW, WORLD);
    expect(dims(getMarineSeriesFrame('GFS', 'waves', VIEW, 16))).toBe('181x83');
  });

  it('a world entry never replaces a regional exact-key entry, however fine its cells', async () => {
    const fineWorld = { cols: 1441, rows: 661, bounds: WORLD.bounds };            // 0.25 deg cells, finer than the 6x5
    await seed(WIDE_VIEW, fineWorld);
    await seed(VIEW, COARSE);
    expect(dims(getMarineSeriesFrame('GFS', 'waves', VIEW, 16))).toBe('6x5');
  });

  it('nearest hour first: a finer entry does not win by serving a farther hour', async () => {
    await seed(VIEW, COARSE, { hours: [16, 19] });                                  // the exact hour, diff 0
    await seed(EARLIER_VIEW, FINE, { hours: [15, 18] });                            // diff 1
    const f = getMarineSeriesFrame('GFS', 'waves', VIEW, 16);
    expect([dims(f), f.grid.hourOffset]).toEqual(['6x5', 16]);
  });

  it('nearest hour first: a finer entry with no frame inside +/-1.5 h is not considered', async () => {
    await seed(VIEW, COARSE, { hours: [15, 18] });
    await seed(EARLIER_VIEW, FINE, { hours: [21, 24] });
    const f = getMarineSeriesFrame('GFS', 'waves', VIEW, 16);
    expect([dims(f), f.grid.hourOffset]).toEqual(['6x5', 15]);
  });

  it('surf mode keeps the exact surf-flavoured entry: a finer SWELL page carries no rating band', async () => {
    await seed(EARLIER_VIEW, FINE, { surf: false });
    await seed(VIEW, COARSE, { surf: true });
    window.__SURF_MODE__ = true;
    expect(dims(getMarineSeriesFrame('GFS', 'waves', VIEW, 16))).toBe('6x5');
  });

  it('an expired finer entry is not served (the series TTL still applies)', async () => {
    const t0 = Date.now();
    let clock = t0;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    await seed(EARLIER_VIEW, FINE);
    clock = t0 + 4 * 60e3;
    await seed(VIEW, COARSE);
    clock = t0 + 5.5 * 60e3;                                                        // the fine entry is 5.5 min old, the coarse 1.5
    expect(dims(getMarineSeriesFrame('GFS', 'waves', VIEW, 16))).toBe('6x5');
  });

  it('finer means finer on the coarser axis: a tile fine in longitude but 3 degrees per row is not finer than the 6x5', async () => {
    await seed(EARLIER_VIEW, { cols: 46, rows: 1, bounds: FINE.bounds });
    await seed(VIEW, COARSE);
    expect(dims(getMarineSeriesFrame('GFS', 'waves', VIEW, 16))).toBe('6x5');
  });

  it('a wide (non-regional) view keeps its exact-key frame: the swap is for regional views only', async () => {
    // At a zoomed-out view the display gate fades any grid narrower than 340 degrees, so a world hit must not become a regional tile.
    const wideView = { west: -115, south: 5, east: -45, north: 45 };               // 70 degrees: the 'global' key, not regional
    await seed(EARLIER_VIEW, { cols: 321, rows: 201, bounds: { west: -120, south: 0, east: -40, north: 50 } });   // 0.25 deg, 80 wide
    await seed(wideView, WORLD);
    expect(dims(getMarineSeriesFrame('GFS', 'waves', wideView, 16))).toBe('181x83');
  });

  it('another model\'s finer entry is never served', async () => {
    await seed(EARLIER_VIEW, FINE, { model: 'ICON' });
    await seed(VIEW, COARSE);
    expect(dims(getMarineSeriesFrame('GFS', 'waves', VIEW, 16))).toBe('6x5');
  });

  it('a finer entry whose served frame does not itself cover the view is skipped (no swap into a coverage miss)', async () => {
    // Heterogeneous page (#10 Source 3): the entry's FIRST frame covers, the later frame (hour 15) is narrower than the view.
    const narrow = { cols: 23, rows: 13, bounds: { west: -81.5, south: 26.6, east: -77.21, north: 29.6 } };
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ frames: [
      { hour_offset: 12, ...FINE, vectors: vec }, { hour_offset: 15, ...narrow, vectors: vec }] }) }));
    window.__SURF_MODE__ = false;
    await ensureMarineSeries('GFS', 'waves', EARLIER_VIEW, 16, undefined, true);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    await seed(VIEW, COARSE);
    expect(dims(getMarineSeriesFrame('GFS', 'waves', VIEW, 16))).toBe('6x5');
  });
});
