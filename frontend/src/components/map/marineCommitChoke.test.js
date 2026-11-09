/**
 * The commit choke (marineCommitChoke.js): the live sequence offline. ICON wind_waves, Florida east coast, z9: a 13x17 regional at 0.25 deg
 * is drawn and covers the view; then the 181x83 world frame at 2 deg for the same model, layer and hour arrives through a route that never
 * passes commitMarineData (series_settle, the orchestrator's cachedNow, the 429 cooldown fallback). Real mappers (frameToMarineData, the
 * /grid mapper's field set), the REAL handleCooldownFallback, the REAL stampSeriesCommit; a mock state holder with React's setState
 * semantics. Kills: __RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__ and __RAW_DISABLE_FINER_RESIDENT_HOLD__.
 */
import { guardMarineSetter, chokeMarineCommit } from './marineCommitChoke';
import { frameToMarineData } from './marineSeriesFrame';
import { stampSeriesCommit } from './useMarineScrubSettle';
import { handleCooldownFallback } from './useMarineDataFetcherHelpers';

const VEC = [{ lat: 28, lng: -80, speed: 1.2, u: 0.1, v: 0.1, direction: 0, period: 9 }];
const RUN = '2026-11-09T00:00:00Z';
const VALID = '2026-11-09T05:00:00Z';
const TILE = { west: -82, south: 26, east: -78.75, north: 30.25 };          // 13 x 17 at 0.25 deg
const VIEW = { west: -80.9, south: 27.5, east: -78.9, north: 29.5 };       // z9 Florida east coast
const WIDE = { west: -100, south: 10, east: -60, north: 45 };              // zoomed out (>= 15 deg)
const OFF_TILE = { west: -79, south: 31, east: -77, north: 33 };           // a pan off the tile
const WORLD_B = { west: -180, south: -82, east: 180, north: 82 };          // 181 x 83 at 2 deg

// The /grid mapper's shape (backendWeatherServiceClientHelpers.mapNormalizedGridToWebGL): times on the grid AND the wrapper.
const regional = (over = {}) => ({
  type: 'FeatureCollection', features: [], hourOffset: 0, run_time: RUN, validTime: VALID, valid_time: VALID, served_valid_time: VALID,
  grid: { vectors: VEC, cols: 13, rows: 17, bounds: TILE, hourOffset: 0, validTime: VALID, valid_time: VALID, run_time: RUN,
    served_valid_time: VALID, renderable: true, __renderable: true, __sourceModel: 'ICON', __componentLayer: 'wind_waves',
    ratingMode: false, ...over },
});
// A world page frame through the REAL series mapper (grid_series_helper strftime times).
const worldSeries = (over = {}) => frameToMarineData({
  hour_offset: 0, valid_time: VALID, served_valid_time: VALID, run_time: RUN, cols: 181, rows: 83, bounds: WORLD_B, vectors: VEC,
  provider: 'dwd', rating_mode: false, ...over,
}, 'ICON', 'wind_waves');

function holder(initial) {
  let state = initial;
  const raw = (v) => { state = typeof v === 'function' ? v(state) : v; };
  return { set: guardMarineSetter(raw), get state() { return state; }, get dims() { return state ? `${state.grid.cols}x${state.grid.rows}` : 'EMPTY'; } };
}
const showing = (v) => {
  window.map = { getZoom: () => 9, getBounds: () => ({ getWest: () => v.west, getEast: () => v.east, getSouth: () => v.south, getNorth: () => v.north }) };
};
const engine = () => { window.__MARINE_ENGINE__ = { _waveData: { waveGrid: {} }, _coarseBaseData: null, _pendingCoarseBaseGrid: null }; };

const KEYS = ['__RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__', '__RAW_DISABLE_FINER_RESIDENT_HOLD__', '__RAW_DISABLE_COARSE_BRIDGE__',
  '__MARINE_FINER_HELD__', '__MARINE_WORLD_OVER_REGIONAL__', '__MARINE_ENGINE__', 'map'];
beforeEach(() => { KEYS.forEach((k) => delete window[k]); showing(VIEW); engine(); });
afterAll(() => KEYS.forEach((k) => delete window[k]));

describe('the live sequence: a drawn 13x17 regional covers the z9 view, the 181x83 world frame arrives by a direct route', () => {
  test('series_settle (stamped series frame, never through commitMarineData) is held and counted', () => {
    const h = holder(regional());
    h.set(stampSeriesCommit(worldSeries(), { current: 0 }, 'series_settle'));
    expect(h.dims).toBe('13x17');
    expect(window.__MARINE_FINER_HELD__.count).toBe(1);
    expect(window.__MARINE_FINER_HELD__.last).toMatchObject({ route: 'choke', lane: 'series_settle', world: true, incomingDims: '181x83' });
    expect(window.__MARINE_WORLD_OVER_REGIONAL__).toMatchObject({ held: 1, released: 0 });
  });

  test("the orchestrator's cachedNow direct value is held", () => {
    const h = holder(regional());
    h.set(worldSeries());
    expect(h.dims).toBe('13x17');
    expect(window.__MARINE_FINER_HELD__.count).toBe(1);
  });

  test('a functional updater whose result is the world frame is held', () => {
    const h = holder(regional());
    const world = worldSeries();
    h.set(() => world);
    expect(h.dims).toBe('13x17');
  });

  test('the REAL 429 cooldown fallback (asks for a covering world grid on purpose) is held', () => {
    const h = holder(regional());
    const world = worldSeries();
    handleCooldownFallback({
      mapInstance: window.map, model: 'ICON', layer: 'wind_waves', timeOffset: 0, timeOffsetRef: { current: 0 }, setMarineData: h.set,
      lastCommittedSigRef: { current: null }, marineRevision: { current: 0 }, getViewportHash: () => 'h', logPipelineEventHelper: () => {},
      cooldownRetryRef: { current: null }, consecutiveFailuresRef: { current: 0 }, clearTimeoutFunc: () => {},
      getModelSafeMarine: () => world, _marineDataSignature: (d) => `${d.grid.cols}x${d.grid.rows}`, getSharedValidTime: () => null,
    });
    expect(h.dims).toBe('13x17');
    expect(window.__MARINE_FINER_HELD__.count).toBe(1);
  });

  test('the held world frame is forwarded to the engine as the base-wash seed', () => {
    const h = holder(regional());
    const world = worldSeries();
    h.set(world);
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBe(world.grid);
  });

  test('times spelled differently for the same instant (/grid "+00:00" vs series "Z") are the same frame', () => {
    const h = holder(regional({ validTime: '2026-11-09T05:00:00+00:00', valid_time: '2026-11-09T05:00:00+00:00', run_time: '2026-11-09T00:00:00+00:00' }));
    h.set(worldSeries());
    expect(h.dims).toBe('13x17');
  });
});

describe('kill switches restore the replacement', () => {
  test('__RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__', () => {
    window.__RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__ = true;
    const h = holder(regional());
    h.set(stampSeriesCommit(worldSeries(), { current: 0 }, 'series_settle'));
    expect(h.dims).toBe('181x83');
    expect(window.__MARINE_FINER_HELD__).toBeUndefined();
    expect(window.__MARINE_WORLD_OVER_REGIONAL__.last).toMatchObject({ held: false, reason: 'world_disabled' });
  });
  test('__RAW_DISABLE_FINER_RESIDENT_HOLD__', () => {
    window.__RAW_DISABLE_FINER_RESIDENT_HOLD__ = true;
    const h = holder(regional());
    h.set(worldSeries());
    expect(h.dims).toBe('181x83');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeNull();
  });
});

describe("#749's releases stand at the choke", () => {
  const releasedWith = (resident, incoming, reason) => {
    const h = holder(resident);
    h.set(incoming);
    expect(h.dims).toBe(`${incoming.grid.cols}x${incoming.grid.rows}`);
    if (reason) expect(window.__MARINE_WORLD_OVER_REGIONAL__.last.reason).toBe(reason);
  };
  test('zoomed out: a view of 15 deg or more', () => { showing(WIDE); releasedWith(regional(), worldSeries(), 'wide_view'); });
  test('a pan off the tile', () => { showing(OFF_TILE); releasedWith(regional(), worldSeries(), 'resident_not_covering'); });
  test('a newer run', () => releasedWith(regional(), worldSeries({ run_time: '2026-11-09T06:00:00Z' }), 'run'));
  test('a stale resident', () => releasedWith(regional({ stale: true }), worldSeries(), 'stale'));
  test('another hour (labels and served instants both differ)', () => releasedWith(regional(),
    worldSeries({ hour_offset: 3, valid_time: '2026-11-09T08:00:00Z', served_valid_time: '2026-11-09T08:00:00Z' }), 'served_instant'));
  test('another hour by label only, nothing served on either side', () => releasedWith(regional({ served_valid_time: null }),
    worldSeries({ hour_offset: 3, valid_time: '2026-11-09T08:00:00Z', served_valid_time: null }), 'hour'));
  test('another flavour', () => releasedWith(regional(), worldSeries({ rating_mode: true }), 'flavour'));
  test('another model', () => releasedWith(regional({ __sourceModel: 'GFS' }), worldSeries(), 'model_or_layer'));
});

describe('the served instant is the physical frame', () => {
  test('labels 15 and 16 serving the same instant are one frame: held', () => {
    const h = holder(regional({ hourOffset: 16 }));
    h.set(worldSeries({ hour_offset: 15, valid_time: '2026-11-09T06:00:00Z' }));
    expect(h.dims).toBe('13x17');
    expect(window.__MARINE_FINER_HELD__.last.byServedInstant).toBe(true);
  });
  test('equal labels serving different instants are two frames: released', () => {
    const h = holder(regional());
    h.set(worldSeries({ served_valid_time: '2026-11-09T06:00:00Z' }));
    expect(h.dims).toBe('181x83');
  });
});

describe('never wedges', () => {
  test('a restamp or stale mark of the resident (same grid) always passes', () => {
    const r = regional();
    const h = holder(r);
    h.set((prev) => ({ ...prev, stale: true, grid: prev.grid }));
    expect(h.state.stale).toBe(true);
    h.set((prev) => ({ ...prev, __unsupportedLayerOverride: { model: 'ICON' } }));
    expect(h.state.__unsupportedLayerOverride).toBeTruthy();
  });
  test('an empty engine (nothing drawn) never keeps the undrawn resident', () => {
    window.__MARINE_ENGINE__ = { _waveData: null };
    const h = holder(regional());
    h.set(worldSeries());
    expect(h.dims).toBe('181x83');
  });
  test('no live map: fail open', () => {
    delete window.map;
    const h = holder(regional());
    h.set(worldSeries());
    expect(h.dims).toBe('181x83');
  });
  test('null and first commits pass', () => {
    expect(chokeMarineCommit(regional(), null)).toBeNull();
    const w = worldSeries();
    expect(chokeMarineCommit(null, w)).toBe(w);
  });
  test('a finer regional over the world resident always commits', () => {
    const h = holder(worldSeries());
    h.set(regional());
    expect(h.dims).toBe('13x17');
  });
});
