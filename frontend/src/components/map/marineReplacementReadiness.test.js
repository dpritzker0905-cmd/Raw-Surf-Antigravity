import { act, renderHook, cleanup } from '@testing-library/react';
import { useMarineDataFetcher } from './useMarineDataFetcher';
import { fetchMarineData, isContainedInMarineCache } from './marineController';
import { _cacheMarineResult, getPerModelHourCache } from './marineControllerCache';
import { clampViewportBbox, setCachedManifest } from './backendWeatherServiceClientCoverage';
import { mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';

// Transport boundary only: the controller, cache, mapper, demand queue, commit and
// in-flight registry are real. Synthetic regular fields test readiness, not skill.
const VIEW = { west: -83.8, south: 26.2, east: -76.2, north: 29.8 };
const COVER = { west: -84, south: 26, east: -76, north: 32 };
function wire(bounds = COVER, height = 2, hour = 0) {
  const cols = 5, rows = 4;
  return {
    model: 'GFS', domain: 'marine', layer: 'waves', provider: 'open-meteo',
    region_id: `viewport_${Object.values(bounds).join('_')}`, source_dataset: 'readiness_control',
    valid_time: `2026-09-13T0${hour}:00:00Z`, served_valid_time: `2026-09-13T0${hour}:00:00Z`,
    run_time: '2026-09-12T18:00:00Z', frame_substituted: false,
    grid: { bounds, cols, rows, vectors: Array.from({ length: cols * rows }, (_, i) => ({
      lng: bounds.west + (i % cols) * (bounds.east - bounds.west + (bounds.east < bounds.west ? 360 : 0)) / (cols - 1),
      lat: bounds.south + Math.floor(i / cols) * (bounds.north - bounds.south) / (rows - 1),
      speed: height, height, period: 8, direction: 90, is_valid: true,
    })) },
  };
}
const mapped = (w, hour = 0) => mapNormalizedGridToWebGL(w, w.grid.bounds, hour, 'waves', 'GFS');
let requests, savedFetch;
beforeEach(() => {
  jest.useFakeTimers('modern');
  jest.setSystemTime(new Date('2026-09-13T00:00:00Z'));
  localStorage.clear();
  getPerModelHourCache().clear();
  setCachedManifest({ products: [{ model: 'GFS', domain: 'marine', layer: 'waves',
    region_id: 'readiness', coverage: { west: -180, south: -80, east: 180, north: 85 } }] });
  window.__MARINE_SIBLING_PREWARM__ = false; // isolate foreground; native companion covers rendering
  window.__RAW_CAPTURE_OPACITY__ = true;
  delete window.__RAW_DEMAND_EVIDENCE__;
  delete window.__MARINE_FETCH_PENDING__;
  delete window.isScrubbingTimeline;
  delete window.__SURF_MODE__;
  delete window.__MARINE_ENGINE__;
  requests = [];
  savedFetch = global.fetch;
  global.fetch = jest.fn((url, { signal } = {}) => new Promise((resolve, reject) => {
    const request = { url, signal, resolve: data => resolve({ ok: true, status: 200, json: async () => data }), aborted: false };
    signal?.addEventListener('abort', () => { request.aborted = true; reject(new DOMException('Aborted', 'AbortError')); });
    requests.push(request);
  }));
});
afterEach(() => {
  cleanup();
  global.fetch = savedFetch;
  jest.clearAllTimers();
  jest.useRealTimers();
  delete window.__MARINE_SIBLING_PREWARM__;
  delete window.__RAW_CAPTURE_OPACITY__;
});
async function tick(ms) {
  await act(async () => { jest.advanceTimersByTime(ms); });
}
function setup() {
  let bounds = VIEW, moving = false;
  const listeners = new Map();
  const map = {
    getBounds: () => ({ getWest: () => bounds.west, getEast: () => bounds.east,
      getSouth: () => bounds.south, getNorth: () => bounds.north }),
    getZoom: () => 6.666, isMoving: () => moving, isZooming: () => moving,
    on: (event, fn) => listeners.set(event, fn), once: (event, fn) => listeners.set(event, fn),
    off: (event, fn) => { if (listeners.get(event) === fn) listeners.delete(event); },
  };
  const ref = current => ({ current });
  const activeModelRef = ref('GFS'), activeMarineLayerRef = ref('waves'), timeOffsetRef = ref(0);
  const hook = renderHook(() => useMarineDataFetcher({ mapInstance: map, activeLayers: ['waves'],
    activeMarineLayer: 'waves', activeMarineLayerRef, timeOffsetHours: timeOffsetRef.current,
    timeOffsetRef, activeModel: activeModelRef.current, activeModelRef }));
  hook.result.current.activeMarineLayersRef.current = true;
  return { ...hook, timeOffsetRef, setBounds: b => { bounds = b; }, setMoving: v => { moving = v; },
    idle: () => listeners.get('idle')?.(), enqueue: source => act(() => hook.result.current.enqueueMarineUpdate(source)),
  };
}

test('a covering regional cache hit reaches the actual demand commit without waiting for HTTP padding', async () => {
  const cached = mapped(wire());
  _cacheMarineResult('GFS', 0, cached, 'waves'); // served-key only, as zoom-out prewarm writes
  const requestBounds = clampViewportBbox(VIEW, 'waves', 'GFS', 'marine').clampedBbox;
  expect(requestBounds.west).toBeLessThan(COVER.west);
  expect(requestBounds.east).toBeGreaterThan(COVER.east);
  expect(isContainedInMarineCache(VIEW, 'GFS', 0, 'waves')).toBe(true);
  const h = setup();
  h.enqueue('moveend');
  await tick(100);
  expect(requests).toHaveLength(0);
  expect(h.result.current.marineData.grid.vectors).toBe(cached.grid.vectors);
  expect(h.result.current.marineData.grid.served_valid_time).toBe('2026-09-13T00:00:00Z');
  expect(h.result.current.marineFetchLocksRef.current.isFetching).toBe(false);
});

test('cold demand waits for the real response; duplicate demand does not start or abort another fetch', async () => {
  const h = setup();
  h.enqueue('moveend');
  await tick(500);
  expect(requests).toHaveLength(1);
  expect(h.result.current.marineData).toBeNull();
  h.enqueue('moveend'); h.enqueue('clamp_resharpen');
  await tick(1200);
  expect(requests).toHaveLength(1);
  expect(requests[0].aborted).toBe(false);
  await act(async () => requests[0].resolve(wire()));
  expect(h.result.current.marineData.grid.cols).toBe(5);
  expect(h.result.current.marineFetchLocksRef.current.isFetching).toBe(false);
  const events = window.__RAW_DEMAND_EVIDENCE__.events;
  expect(events.filter(e => e.stage === 'dispatch')).toHaveLength(1);
  expect(events.filter(e => e.stage === 'resolved')).toHaveLength(1);
  expect(events.find(e => e.stage === 'dispatch').attempt).toBe(events.find(e => e.stage === 'resolved').attempt);
});

test('an uncovered viewport still fetches even if a nearby regional field is warm', async () => {
  _cacheMarineResult('GFS', 0, mapped(wire()), 'waves');
  const h = setup(); h.setBounds({ ...VIEW, east: -72 });
  h.enqueue('moveend'); await tick(500);
  expect(requests).toHaveLength(1);
  await act(async () => requests[0].resolve(wire({ ...COVER, east: -70 })));
  expect(h.result.current.marineData.grid.bounds.east).toBe(-70);
});

test('forceFetch preserves revalidation even when a regional cache entry covers the viewport', async () => {
  _cacheMarineResult('GFS', 0, mapped(wire()), 'waves');
  const p = fetchMarineData(VIEW, 6.666, undefined, 0, true, 'GFS', 'waves');
  await tick(0);
  expect(requests).toHaveLength(1);
  requests[0].resolve(wire(COVER, 3));
  expect((await p).grid.vectors[0].height).toBe(3);
});

test.each(['stale', 'grid-stale', 'expired', 'hour', 'layer', 'model', 'flavor', 'signature', 'global'])(
  '%s cache entries cannot suppress a fresh foreground fetch', async reason => {
    const cached = mapped(wire(reason === 'global' ? { west: -180, south: -80, east: 180, north: 85 } : COVER));
    if (reason === 'stale') cached.stale = true;
    if (reason === 'grid-stale') cached.grid.stale = true;
    if (reason === 'flavor') window.__SURF_MODE__ = true;
    _cacheMarineResult(reason === 'model' ? 'ICON' : 'GFS', reason === 'hour' ? 3 : 0,
      cached, reason === 'layer' ? 'swell_1' : 'waves');
    delete window.__SURF_MODE__;
    for (const entry of getPerModelHourCache().values()) {
      if (reason === 'expired') entry.timestamp -= 24 * 3600000;
      if (reason === 'signature') entry.signature.cols++;
    }
    const p = fetchMarineData(VIEW, 6.666, undefined, 0, false, 'GFS', 'waves');
    await tick(0);
    expect(requests).toHaveLength(1);
    requests[0].resolve(wire(COVER, 3));
    expect((await p).grid.vectors[0].height).toBe(3);
  }
);

test('motion queues one warm update until idle; the fallback cannot dispatch it twice', async () => {
  const cached = mapped(wire()); _cacheMarineResult('GFS', 0, cached, 'waves');
  const h = setup(); h.setMoving(true);
  h.enqueue('moveend'); await tick(100);
  expect(h.result.current.marineData).toBeNull();
  expect(requests).toHaveLength(0);
  h.setMoving(false); act(() => h.idle()); await tick(0);
  expect(h.result.current.marineData?.grid.vectors).toBe(cached.grid.vectors);
  await tick(1500);
  expect(requests).toHaveLength(0);
  expect(window.__RAW_DEMAND_EVIDENCE__.events.filter(e => e.stage === 'dispatch')).toHaveLength(1);
});

test('a newer hour supersedes the delayed response without aborting its useful cache fill', async () => {
  const h = setup(); h.enqueue('moveend'); await tick(500);
  expect(requests).toHaveLength(1);
  h.timeOffsetRef.current = 1; h.rerender();
  h.enqueue('timeline_scrub'); await tick(200);
  expect(requests).toHaveLength(2);
  expect(requests[0].aborted).toBe(false);
  await act(async () => requests[1].resolve(wire(COVER, 3, 1)));
  expect(h.result.current.marineData.grid.served_valid_time).toBe('2026-09-13T01:00:00Z');
  await act(async () => requests[0].resolve(wire(COVER, 2, 0)));
  expect(h.result.current.marineData.grid.served_valid_time).toBe('2026-09-13T01:00:00Z');
  expect(h.result.current.marineData.grid.vectors[0].height).toBe(3);
  expect(h.result.current.marineFetchLocksRef.current.isFetching).toBe(false);
  expect(window.__MARINE_FETCH_PENDING__).toBeFalsy();
  expect([...getPerModelHourCache().values()].some(e => e.data.grid.served_valid_time === '2026-09-13T00:00:00Z')).toBe(true);
});

test.each([
  [{ west: 170, east: -170 }, { west: 175, east: -175 }, true],
  [{ west: 170, east: -170 }, { west: -179, east: -175 }, true],
  [{ west: 170, east: 179 }, { west: 175, east: -175 }, false],
  [{ west: 170, east: -170 }, { west: -175, east: 175 }, false],
])('cached arc %j covers viewport arc %j: %s', async (outer, inner, covers) => {
  const cached = mapped(wire({ ...COVER, ...outer }));
  _cacheMarineResult('GFS', 0, cached, 'waves');
  const p = fetchMarineData({ ...VIEW, ...inner }, 6.666, undefined, 0, false, 'GFS', 'waves');
  await tick(0);
  expect(requests).toHaveLength(covers ? 0 : 1);
  if (covers) expect(await p).toBe(cached);
  else { requests[0].resolve(wire(COVER, 3)); await p; }
});
