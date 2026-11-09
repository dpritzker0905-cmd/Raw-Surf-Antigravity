/**
 * World frame must not replace a same-frame regional resident that covers the live viewport (ICON wind_waves z9, 2026-11-08: a 13x17
 * regional drew at t=0.1 s, the 181x83 world frame replaced it at t=1.6 s and stayed ~17 s). Reducer-level, offline: the REAL
 * commitMarineData runs against a mock state holder. Kills: __RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__ and __RAW_DISABLE_FINER_RESIDENT_HOLD__.
 */
import { commitMarineData } from './useMarineDataFetcherHelpers';

const VEC = [{ lat: 28, lng: -80, speed: 1.2, u: 0.1, v: 0.1, direction: 0, period: 9 }];
const RUN = '2026-11-08T00:00:00Z';
const VALID = '2026-11-08T12:00:00Z';
const WORLD_BOX = { west: -180, south: -90, east: 180, north: 90 };
const TILE = { west: -82, south: 26, east: -78.75, north: 30.25 };   // 13 x 17 at 0.25 deg
const VIEW = { west: -80.9, south: 27.5, east: -78.9, north: 29.5 };
const WIDE = { west: -100, south: 10, east: -60, north: 45 };

const mk = (cols, rows, bounds, extra = {}) => ({
  type: 'FeatureCollection', features: [], hourOffset: 12, run_time: RUN,
  grid: { vectors: VEC, cols, rows, bounds, hourOffset: 12, validTime: VALID, run_time: RUN, renderable: true, __renderable: true,
    __sourceModel: 'ICON', __componentLayer: 'wind_waves', ...extra },
});
const regional = () => mk(13, 17, TILE);
const world = (extra) => mk(181, 83, WORLD_BOX, extra);

function harness(initial) {
  let state = initial;
  const setMarineData = (fn) => { state = typeof fn === 'function' ? fn(state) : fn; };
  const commit = (data, bounds, source = 'activation') => commitMarineData({
    data, bounds, model: 'ICON', layer: 'wind_waves', timeOffset: 12, timeOffsetRef: { current: 12 }, setMarineData,
    lastCommittedSigRef: { current: null }, marineRevision: { current: 0 }, getViewportHash: () => 'h', logPipelineEventHelper: () => {},
    consecutiveFailuresRef: { current: 0 }, isCommittingDataRef: { current: false }, isInternalMapUpdateRef: { current: false },
    internalUpdateTimerRef: { current: null }, locks: {}, source, scheduleSWRRevalidation: () => {}, updateMarineGrid: () => {},
    getBackendCopernicusFlag: () => false, getBackendIconMarineFlag: () => true, getBackendWeatherFlag: () => true,
    _marineDataSignature: (d) => `${d.grid.cols}x${d.grid.rows}:${d.grid.bounds.west}`, getSharedValidTime: () => null,
    updateDeprecationDiag: () => {}, setTimeoutFunc: () => 0, clearTimeoutFunc: () => {},
  });
  return { commit, get dims() { return `${state.grid.cols}x${state.grid.rows}`; } };
}
const mapShowing = (v) => { window.map = { getBounds: () => ({ getWest: () => v.west, getEast: () => v.east, getSouth: () => v.south, getNorth: () => v.north }) }; };

beforeEach(() => {
  delete window.__RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__; delete window.__RAW_DISABLE_FINER_RESIDENT_HOLD__;
  delete window.__MARINE_FINER_HELD__; delete window.map;
});
afterEach(() => { delete window.map; });

test('an activation world fetch (asked for the world box) is held while the regional covers the live z9 viewport', () => {
  mapShowing(VIEW);
  const h = harness(regional());
  h.commit(world(), WORLD_BOX);
  expect(h.dims).toBe('13x17');
  expect(window.__MARINE_FINER_HELD__.count).toBe(1);
});

test('released when the viewport is wider than the regional (zoomed out), so the world field takes over', () => {
  mapShowing(WIDE);
  const h = harness(regional());
  h.commit(world(), WORLD_BOX);
  expect(h.dims).toBe('181x83');
});

test('released when the regional does not cover the live viewport (a pan off the tile)', () => {
  mapShowing({ west: -79, south: 31, east: -77, north: 33 });
  const h = harness(regional());
  h.commit(world(), WORLD_BOX);
  expect(h.dims).toBe('181x83');
});

test('a different run is fresher data and commits', () => {
  mapShowing(VIEW);
  const h = harness(regional());
  h.commit({ ...world({ run_time: '2026-11-08T06:00:00Z' }), run_time: '2026-11-08T06:00:00Z' }, WORLD_BOX);
  expect(h.dims).toBe('181x83');
});

test('kill switches restore the old replacement', () => {
  mapShowing(VIEW);
  window.__RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__ = true;
  let h = harness(regional());
  h.commit(world(), WORLD_BOX);
  expect(h.dims).toBe('181x83');
  delete window.__RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__;
  window.__RAW_DISABLE_FINER_RESIDENT_HOLD__ = true;
  h = harness(regional());
  h.commit(world(), WORLD_BOX);
  expect(h.dims).toBe('181x83');
});

test('a world resident is never held in favour of anything (unchanged rule)', () => {
  mapShowing(VIEW);
  const h = harness(world());
  h.commit(regional(), VIEW);
  expect(h.dims).toBe('13x17');
});
