import { slotTiming, slotIndexOf, neighbourIndex, slotReady, sourceReady, retainedActiveSlot, planFlip, NO_SLOT } from './rasterFrameSwap';

const KILLS = ['__RAW_DISABLE_RASTER_HARD_CUT__', '__RAW_DISABLE_RASTER_DIRECTIONAL_NEIGHBOUR__', '__RAW_DISABLE_RASTER_INSTANT_FLIP__',
  '__RAW_DISABLE_RASTER_TOGGLE_RETAIN__', '__RAW_RASTER_FRAME_SWAP__'];
afterEach(() => { for (const k of KILLS) delete window[k]; });

const url = (i, v = 'precipitation') => `om://https://openmeteo.s3.amazonaws.com/data_spatial/ncep_gfs013/latest.json?time_step=valid_times_${i}&variable=${v}&contours=true`;
// A MapLibre stand-in: sources by id with url, loaded flag and in-view tile count.
function fakeMap(sources) {
  return {
    getSource: (id) => sources[id] || undefined,
    isSourceLoaded: (id) => !!(sources[id] && sources[id].loaded),
    style: { tileManagers: Object.fromEntries(Object.entries(sources).map(([id, s]) => [id, { _inViewTiles: { getAllTiles: () => new Array(s.tiles || 0).fill({}) } }])) },
  };
}

describe('slotTiming (hard cut)', () => {
  test('on: no opacity transition, no per-tile fade', () => {
    expect(slotTiming(200)).toEqual({ 'raster-fade-duration': 0, 'raster-opacity-transition': { duration: 0, delay: 0 } });
  });
  test('an explicit fade override still wins', () => {
    expect(slotTiming(350, true)['raster-fade-duration']).toBe(350);
  });
  test('killed: the legacy per-layer fade and no transition key (MapLibre default 300 ms)', () => {
    window.__RAW_DISABLE_RASTER_HARD_CUT__ = true;
    expect(slotTiming(200)).toEqual({ 'raster-fade-duration': 200 });
  });
});

describe('neighbourIndex', () => {
  test('forward scrubbing preloads the next hour at EVERY index (parity used to flip every other step)', () => {
    const dirs = {};
    expect(neighbourIndex(11, 100, 10, dirs, 'rain')).toBe(12);
    expect(neighbourIndex(12, 100, 11, dirs, 'rain')).toBe(13);
    expect(neighbourIndex(13, 100, 12, dirs, 'rain')).toBe(14);
  });
  test('scrubbing back preloads the previous hour; a re-resolve at the same hour keeps the direction', () => {
    const dirs = {};
    expect(neighbourIndex(9, 100, 10, dirs, 'rain')).toBe(8);
    expect(neighbourIndex(9, 100, 9, dirs, 'rain')).toBe(8);
  });
  test('default forward; at the end of the axis the other side', () => {
    expect(neighbourIndex(5, 100, null, {}, 'rain')).toBe(6);
    expect(neighbourIndex(99, 100, 98, {}, 'rain')).toBe(98);
    expect(neighbourIndex(0, 100, 1, {}, 'rain')).toBe(1);
  });
  test('directions are per layer', () => {
    const dirs = {};
    neighbourIndex(9, 100, 10, dirs, 'rain');
    expect(neighbourIndex(20, 100, null, dirs, 'fog')).toBe(21);
  });
  test('killed: the legacy parity rule exactly', () => {
    window.__RAW_DISABLE_RASTER_DIRECTIONAL_NEIGHBOUR__ = true;
    expect(neighbourIndex(10, 100, 9, {}, 'rain')).toBe(11);
    expect(neighbourIndex(11, 100, 10, {}, 'rain')).toBe(10);
    expect(neighbourIndex(0, 100, null, {}, 'rain')).toBe(1);
    expect(neighbourIndex(99, 100, 98, {}, 'rain')).toBe(98);
  });
});

describe('slotReady / sourceReady', () => {
  test('ready = this URL, loaded, tiles in view', () => {
    const m = fakeMap({ s: { url: url(3), loaded: true, tiles: 9 } });
    expect(slotReady(m, 's', url(3))).toBe(true);
    expect(slotReady(m, 's', url(4))).toBe(false);
  });
  test('loaded under the new URL but still carrying the OLD tile template (aborted TileJSON): NOT ready', () => {
    const m = fakeMap({ s: { url: url(5), loaded: true, tiles: 9 } });
    m.getSource('s').tiles = [`${url(3)}/{z}/{x}/{y}`];
    expect(slotReady(m, 's', url(5))).toBe(false);
    m.getSource('s').tiles = [`${url(5)}/{z}/{x}/{y}`];
    expect(slotReady(m, 's', url(5))).toBe(true);
  });
  test('a hidden source reads loaded with no tiles: NOT ready', () => {
    const m = fakeMap({ s: { url: url(3), loaded: true, tiles: 0 } });
    expect(sourceReady(m, 's')).toBe(false);
    expect(slotReady(m, 's', url(3))).toBe(false);
  });
  test('killed: the old check (URL + isSourceLoaded) exactly', () => {
    window.__RAW_DISABLE_RASTER_INSTANT_FLIP__ = true;
    expect(slotReady(fakeMap({ s: { url: url(3), loaded: true, tiles: 0 } }), 's', url(3))).toBe(true);
  });
  test('no map / no source: not ready, no throw', () => {
    expect(slotReady(null, 's', url(1))).toBe(false);
    expect(sourceReady(fakeMap({}), 's')).toBe(false);
  });
});

describe('retainedActiveSlot', () => {
  const urls = { 'rain-slot-0': url(1), 'rain-slot-1': url(2), 'rain-slot-2': 'om://transparent-tile' };
  test('a layer switched off with real frames keeps them and its shown slot', () => {
    expect(retainedActiveSlot(urls, 'rain', 1)).toBe(1);
  });
  test('nothing real to keep, or killed: null (reset to transparent as before)', () => {
    expect(retainedActiveSlot({ 'fog-slot-0': 'om://transparent-tile' }, 'fog', 0)).toBeNull();
    window.__RAW_DISABLE_RASTER_TOGGLE_RETAIN__ = true;
    expect(retainedActiveSlot(urls, 'rain', 1)).toBeNull();
  });
});

describe('planFlip', () => {
  const base = { layerKey: 'rain', targetUrl: url(5) };
  test('the asked hour already loaded in another slot: shown in the same commit', () => {
    const m = fakeMap({ 'rain-slot-2-source': { url: url(5), loaded: true, tiles: 9 } });
    expect(planFlip({ ...base, map: m, targetSlot: 2, currentActiveSlot: 1, currentUrls: { 'rain-slot-1': url(4), 'rain-slot-2': url(5) } })).toBe(2);
  });
  test('resident but still loading: left to the transition audit (old hour held)', () => {
    const m = fakeMap({ 'rain-slot-2-source': { url: url(5), loaded: false, tiles: 9 } });
    expect(planFlip({ ...base, map: m, targetSlot: 2, currentActiveSlot: 1, currentUrls: { 'rain-slot-1': url(4), 'rain-slot-2': url(5) } })).toBeNull();
  });
  test('a re-toggled layer whose kept hour is not the asked one shows NO slot until the asked hour is ready', () => {
    const m = fakeMap({});
    expect(planFlip({ ...base, map: m, targetSlot: 0, currentActiveSlot: 1, currentUrls: { 'rain-slot-1': url(2) }, reactivated: true })).toBe(NO_SLOT);
  });
  test('a re-toggled layer whose kept hour IS the asked one: nothing to do (shown at once)', () => {
    expect(planFlip({ ...base, map: fakeMap({}), targetSlot: 1, currentActiveSlot: 1, currentUrls: { 'rain-slot-1': url(5) }, reactivated: true })).toBeNull();
  });
  test('killed instant flip: never flips here', () => {
    window.__RAW_DISABLE_RASTER_INSTANT_FLIP__ = true;
    const m = fakeMap({ 'rain-slot-2-source': { url: url(5), loaded: true, tiles: 9 } });
    expect(planFlip({ ...base, map: m, targetSlot: 2, currentActiveSlot: 1, currentUrls: { 'rain-slot-2': url(5) } })).toBeNull();
  });
});

test('slotIndexOf', () => {
  expect(slotIndexOf(url(42))).toBe(42);
  expect(slotIndexOf('om://transparent-tile')).toBeNull();
  expect(slotIndexOf(undefined)).toBeNull();
});
