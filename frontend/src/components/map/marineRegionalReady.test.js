import { act, cleanup, renderHook } from '@testing-library/react';
import { useMarineDataFetcher } from './useMarineDataFetcher';
import { prewarmZoomOutMarineGrid } from './marineController';
import { _cacheMarineResult, getPerModelHourCache } from './marineControllerCache';
import { clampViewportBbox, setCachedManifest } from './backendWeatherServiceClientCoverage';
import { mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';
import { publishMarineRegionalReady } from './marineRegionalReady';

const VIEW = { west: -83.8, south: 26.2, east: -76.2, north: 29.8 };
const PARTIAL = { west: -83, south: 26, east: -79, north: 30 };
const COVER = { west: -84, south: 26, east: -76, north: 32 };
function wire(bounds = COVER) {
  const cols = 5, rows = 4;
  return { model: 'GFS', domain: 'marine', layer: 'waves', region_id: `viewport_${Object.values(bounds).join('_')}`,
    model_run_time: '2026-09-12T06:00:00Z', model_run_time_status: 'known', served_valid_time: '2026-09-13T00:00:00Z',
    frame_substituted: false, upstream_provider: 'noaa', source_dataset: 'regional_ready_control',
    grid: { bounds, cols, rows, vectors: Array.from({ length: cols * rows }, (_, i) => ({
      lng: bounds.west + i % cols * (bounds.east - bounds.west) / (cols - 1),
      lat: bounds.south + Math.floor(i / cols) * (bounds.north - bounds.south) / (rows - 1),
      speed: 2, height: 2, period: 8, direction: 90, is_valid: true })) } };
}
const mapped = w => mapNormalizedGridToWebGL(w, w.grid.bounds, 0, 'waves', 'GFS');
let savedFetch, requests;
beforeEach(() => {
  jest.useFakeTimers('modern'); jest.setSystemTime(new Date('2026-09-13T00:00:00Z'));
  localStorage.clear(); getPerModelHourCache().clear(); delete window.__SURF_MODE__; delete window.isScrubbingTimeline;
  delete window.__MARINE_TRANSITIONING__;
  window.__MARINE_SIBLING_PREWARM__ = false;
  setCachedManifest({ products: [{ model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'control',
    coverage: { west: -180, south: -80, east: 180, north: 85 } }] });
  requests = []; savedFetch = global.fetch;
  global.fetch = jest.fn((url, { signal } = {}) => new Promise(resolve => {
    requests.push({ url, signal, resolve: (data, status = 200) => resolve({ ok: status === 200, status, json: async () => data }) });
  }));
});
afterEach(() => { cleanup(); global.fetch = savedFetch; jest.clearAllTimers(); jest.useRealTimers();
  delete window.__MARINE_SIBLING_PREWARM__; delete window.__SURF_MODE__; delete window.isScrubbingTimeline; delete window.__MARINE_TRANSITIONING__; });
async function tick(ms) { await act(async () => { jest.advanceTimersByTime(ms); }); }
function setup(residentBounds = PARTIAL) {
  const ref = current => ({ current }); let moving = false;
  const map = { getBounds: () => ({ getWest: () => VIEW.west, getEast: () => VIEW.east, getSouth: () => VIEW.south, getNorth: () => VIEW.north }),
    getZoom: () => 6.666, isMoving: () => moving, isZooming: () => moving, on: jest.fn(), off: jest.fn(), once: jest.fn() };
  const model = ref('GFS'), layer = ref('waves'), hour = ref(0);
  const hook = renderHook(() => useMarineDataFetcher({ mapInstance: map, activeLayers: ['waves'], activeMarineLayer: layer.current,
    activeMarineLayerRef: layer, timeOffsetHours: hour.current, timeOffsetRef: hour, activeModel: model.current, activeModelRef: model }));
  hook.result.current.activeMarineLayersRef.current = true;
  const partial = mapped(wire(residentBounds));
  _cacheMarineResult('GFS', 0, partial, 'waves', true, clampViewportBbox(VIEW, 'waves', 'GFS', 'marine').selectedTileId);
  act(() => hook.result.current.enqueueMarineUpdate('moveend'));
  return { ...hook, partial, model, layer, hour, moving: value => { moving = value; } };
}
async function startPrewarm() {
  window.__MARINE_SIBLING_PREWARM__ = true;
  prewarmZoomOutMarineGrid('GFS', 0, PARTIAL, 'waves'); await tick(0);
  expect(requests).toHaveLength(1);
}
test('late anticipation refreshes the same viewport from cache without another gesture or HTTP', async () => {
  const h = setup(); await tick(100);
  expect(h.result.current.marineData.grid.vectors).toBe(h.partial.grid.vectors);
  const hash = h.result.current.marineFetchLocksRef.current.lastHash;
  await startPrewarm(); await tick(1200);
  await act(async () => requests[0].resolve(wire())); await tick(100);
  expect([...getPerModelHourCache().values()].some(e => e.data.grid.bounds.east === COVER.east)).toBe(true);
  expect(h.result.current.marineFetchLocksRef.current.isFetching).toBe(false);
  expect(h.result.current.isCommittingDataRef.current).toBe(false);
  expect(!!window.__MARINE_TRANSITIONING__).toBe(false);
  expect(h.result.current.marineData.grid.bounds).toEqual(COVER);
  expect(h.result.current.marineData.grid.__commitLane).toBe('regional_ready');
  expect(h.result.current.marineFetchLocksRef.current.lastHash).toBe(hash);
  expect(requests).toHaveLength(1);
});
test('503 anticipation preserves the current state and starts no recovery request', async () => {
  const h = setup(); await tick(100); await startPrewarm();
  await act(async () => requests[0].resolve({ error: 'controlled_unavailable' }, 503)); await tick(2000);
  expect(h.result.current.marineData.grid.vectors).toBe(h.partial.grid.vectors);
  expect(requests).toHaveLength(1);
});

test.each([
  ['model', h => { h.model.current = 'ICON'; }],
  ['layer', h => { h.layer.current = 'swell_1'; }],
  ['hour', h => { h.hour.current = 3; }],
  ['surf mode', () => { window.__SURF_MODE__ = true; }],
  ['deactivated overlay', h => { h.result.current.activeMarineLayersRef.current = false; }],
])('completion does not commit after a change of %s', async (_, change) => {
  const h = setup(); await tick(100); await startPrewarm();
  change(h);
  await act(async () => requests[0].resolve(wire())); await tick(1600);
  expect(h.result.current.marineData.grid.vectors).toBe(h.partial.grid.vectors);
  expect(requests).toHaveLength(1);
});

test('an unrated in-flight response cannot enter the surf cache after a toggle', async () => {
  setup(); await tick(100); await startPrewarm(); window.__SURF_MODE__ = true;
  await act(async () => requests[0].resolve(wire())); await tick(100);
  expect([...getPerModelHourCache().keys()].some(k => k.includes('~surf'))).toBe(false);
});

test.each([
  ['motion', (h, on) => h.moving(on)],
  ['foreground fetch lock', (h, on) => { h.result.current.marineFetchLocksRef.current.isFetching = on; }],
  ['commit lock', (h, on) => { h.result.current.isCommittingDataRef.current = on; }],
  ['scrubbing', (h, on) => { window.isScrubbingTimeline = on; }],
  ['transition', (h, on) => { window.__MARINE_TRANSITIONING__ = on; }],
])('defers during %s and refreshes after it settles without fetching', async (_, busy) => {
  const h = setup(); await tick(100); await tick(1700); await startPrewarm(); busy(h, true);
  await act(async () => requests[0].resolve(wire())); await tick(500);
  expect(h.result.current.marineData.grid.vectors).toBe(h.partial.grid.vectors);
  busy(h, false); await tick(200);
  expect(h.result.current.marineData.grid.bounds).toEqual(COVER);
  expect(requests).toHaveLength(1);
});

test('a target change during deferred readiness cancels the pending commit', async () => {
  const h = setup(); await tick(100); await startPrewarm(); h.moving(true);
  await act(async () => requests[0].resolve(wire())); await tick(100);
  h.hour.current = 3; h.moving(false); await tick(200);
  expect(h.result.current.marineData.grid.vectors).toBe(h.partial.grid.vectors);
});

test('unmount cancels a deferred wake and removes its listener', async () => {
  const h = setup(); await tick(100); await startPrewarm(); h.moving(true);
  await act(async () => requests[0].resolve(wire())); await tick(100);
  const revision = h.result.current.marineRevision.current;
  h.unmount(); h.moving(false);
  act(() => publishMarineRegionalReady('GFS', 'waves', 0, false)); await tick(2000);
  expect(h.result.current.marineRevision.current).toBe(revision);
  expect(requests).toHaveLength(1);
});

test('a busy overlay has a bounded 30-second wait, with no fetch or commit afterwards', async () => {
  const h = setup(); await tick(100); await startPrewarm(); h.moving(true);
  await act(async () => requests[0].resolve(wire())); await tick(30100);
  h.moving(false); await tick(500);
  expect(h.result.current.marineData.grid.vectors).toBe(h.partial.grid.vectors);
  expect(requests).toHaveLength(1);
});

test('arrival bursts coalesce, and repeating the hint after coverage is restored does nothing', async () => {
  const h = setup(); await tick(100);
  _cacheMarineResult('GFS', 0, mapped(wire()), 'waves', true);
  const before = h.result.current.marineRevision.current;
  act(() => { for (let i = 0; i < 20; i++) publishMarineRegionalReady('GFS', 'waves', 0, false); });
  await tick(100);
  expect(h.result.current.marineRevision.current).toBe(before + 1);
  const cover = h.result.current.marineData;
  act(() => publishMarineRegionalReady('GFS', 'waves', 0, false)); await tick(200);
  expect(h.result.current.marineData).toBe(cover);
  expect(h.result.current.marineRevision.current).toBe(before + 1);
  expect(requests).toHaveLength(0);
});

test.each(['stale', 'non-renderable', 'world', 'non-covering', 'expired', 'hour', 'provider'])('arrival with %s candidate cannot invalidate current state', async kind => {
  const h = setup(); await tick(100);
  const w = wire(kind === 'world' ? { west: -180, south: -80, east: 180, north: 85 } : kind === 'non-covering' ? { ...COVER, east: -77 } : COVER);
  const d = mapped(w);
  if (kind === 'stale') d.grid.stale = true;
  if (kind === 'non-renderable') d.grid.__renderable = false;
  _cacheMarineResult('GFS', 0, d, 'waves', true);
  const e = [...getPerModelHourCache().values()].find(x => x.data === d);
  if (kind === 'expired') e.timestamp -= 30 * 60 * 1000;
  if (kind === 'hour') d.grid.hourOffset = 3;
  if (kind === 'provider') e.signature.provider = 'changed';
  const ledger = h.result.current.lastCommittedSigRef.current;
  act(() => publishMarineRegionalReady('GFS', 'waves', 0, false)); await tick(200);
  expect(h.result.current.marineData.grid.vectors).toBe(h.partial.grid.vectors);
  expect(h.result.current.lastCommittedSigRef.current).toBe(ledger);
  expect(requests).toHaveLength(0);
});

test('already covering regional data is retained when a wider product arrives', async () => {
  const h = setup(COVER); await tick(100);
  _cacheMarineResult('GFS', 0, mapped(wire({ west: -90, south: 20, east: -70, north: 40 })), 'waves', true);
  act(() => publishMarineRegionalReady('GFS', 'waves', 0, false)); await tick(200);
  expect(h.result.current.marineData.grid.vectors).toBe(h.partial.grid.vectors);
  expect(requests).toHaveLength(0);
});

test('a global state is not re-fed by this partial-regional wakeup', async () => {
  const h = setup(); await tick(100);
  const globalData = mapped(wire({ west: -180, south: -80, east: 180, north: 85 }));
  await act(async () => h.result.current.setMarineData(globalData));
  _cacheMarineResult('GFS', 0, mapped(wire()), 'waves', true);
  const ledger = h.result.current.lastCommittedSigRef.current;
  act(() => publishMarineRegionalReady('GFS', 'waves', 0, false)); await tick(200);
  expect(h.result.current.marineData).toBe(globalData);
  expect(h.result.current.lastCommittedSigRef.current).toBe(ledger);
  expect(requests).toHaveLength(0);
});
