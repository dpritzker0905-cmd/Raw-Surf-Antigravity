import {
  _resetStaticFramesForTest, fetchFrameBytes, fetchPriorityOf, prewarmStaticFrames, getPinnedIndex, getPinnedIndexSync, hasPinnedIndex, loadFrameVectors, serveTimeFillAtWorld, setKeyFor,
  staticEligible, staticFramesEnabled, staticSeriesEligible, staticSeriesFrames, staticSetEnabled, tryStaticWorldGrid, STATIC_SETS,
} from './staticFrames';
import { fetchBackendMarineGrid, setCachedManifest } from './backendWeatherServiceClient';
import { fetchBackendCopernicusGrid } from './backendCopernicusServiceClient';
import { loadWorldPageFromStatic, nearestFirst } from './marineSeriesStatic';
import { goldenBuffer } from './staticFrameGolden.fixture';

const BASE = 'https://cdn.test/weather-frames/';
const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const KEY = setKeyFor('GFS', 'waves');

function indexFor(name, valids) {
  return {
    version: 1, encoding_version: 1, transform_version: 1, path: `v1/idx/${name}.json`, run: '2026-10-19T18:00:00Z',
    grid: { cols: 4, rows: 3, bounds: { west: 100, south: -10, east: 107.5, north: 0 } },
    common_meta: { model: 'GFS', provider: 'open-meteo', domain: 'marine', layer: 'waves', is_estimated: false },
    frames: valids.map((vt) => ({ valid_time: vt, is_estimated: false, path: `v1/f/${name}/${vt}.bin`, meta: { product_id: `p_${vt}` } })),
  };
}

function cdn({ latestIndex, indexes, missing = [] }) {
  const calls = [];
  global.fetch = jest.fn(async (url) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets: { [KEY]: { index: latestIndex(), run: 'r' } } });
    for (const idx of indexes) if (url === BASE + idx.path) return ok(idx);
    const m = url.match(/v1\/f\/[^/]+\/(.+)\.bin$/);
    if (m && !missing.includes(m[1])) {
      const buf = goldenBuffer(m[1]);
      return { ok: true, status: 200, arrayBuffer: async () => buf.slice(0) };
    }
    if (url.includes('/api/weather/')) return { ok: true, status: 200, json: async () => ({ grid: { bounds: WORLD, cols: 1, rows: 1, vectors: [{ lat: 0, lng: 0, speed: 1 }] } }) };
    return { ok: false, status: 400, json: async () => ({}) };
  });
  return calls;
}

describe('static frames loader', () => {
  const realFetch = global.fetch;
  let now;
  beforeEach(() => {
    _resetStaticFramesForTest();
    window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
    window.__RAW_STATIC_FRAMES_BASE__ = BASE;
    delete window.__RAW_DISABLE_STATIC_FRAMES__;
    now = Date.parse('2026-10-20T00:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
    window.localStorage.removeItem('__RAW_STATIC_FRAMES_SETS_OFF__');
    delete window.__RAW_DISABLE_STATIC_FRAMES_SETS__;
    delete window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__;
    delete window.__RAW_STATIC_FRAMES_BASE__;
    delete window.__RAW_DISABLE_STATIC_FRAMES__;
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  test('ON by default (owner 2026-10-21); localStorage false turns it off here; the kill switch wins over all', () => {
    window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
    expect(staticFramesEnabled()).toBe(true);
    window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'false');
    expect(staticFramesEnabled()).toBe(false);
    window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
    expect(staticFramesEnabled()).toBe(true);
    window.__RAW_DISABLE_STATIC_FRAMES__ = true;
    expect(staticFramesEnabled()).toBe(false);
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: WORLD })).toBe(false);
    delete window.__RAW_DISABLE_STATIC_FRAMES__;
    delete window.__RAW_STATIC_FRAMES_BASE__;
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: WORLD })).toBe(!!process.env.REACT_APP_SUPABASE_URL); // no CDN: never eligible
  });

  test('the eight world sets, never surf; EURO swells and ICON swell_2 stay on /grid; ICON/EURO world boxes ask /grid', () => {
    for (const [m, l] of [['GFS', 'waves'], ['GFS', 'swell_1'], ['GFS', 'swell_2'], ['GFS', 'wind_waves']]) {
      expect(staticEligible({ model: m, layer: l, bbox: WORLD })).toBe(true);
    }
    // /grid runs the Gulf fill on EURO/ICON world-span grids (coarse_gulf_fill), so their world frame is not what /grid serves
    for (const [m, l] of [['ICON', 'waves'], ['ICON', 'swell_1'], ['ICON', 'wind_waves'], ['EURO', 'waves']]) {
      expect(serveTimeFillAtWorld(m, l)).toBe(true);
      expect(staticEligible({ model: m, layer: l, bbox: WORLD })).toBe(false);
    }
    expect(serveTimeFillAtWorld('GFS', 'waves')).toBe(false);
    window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__ = true;                  // the guard's kill: the pre-fix behaviour
    expect(staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD })).toBe(true);
    delete window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__;
  });

  test('the guard lifts only when /capabilities reports the fill off for that model (MARINE_GULF_FILL_MID=0)', () => {
    const row = (model, fill) => ({ model, domain: 'marine', layer: 'waves', ...(fill === undefined ? {} : { gulf_fill_mid: fill }) });
    try {
      window.__WEATHER_CAPABILITIES__ = [row('GFS'), row('EURO', true), row('ICON', true)];          // today: the fill runs
      expect(staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD })).toBe(false);
      window.__WEATHER_CAPABILITIES__ = [row('GFS'), row('EURO', false), row('ICON', true)];         // EURO off, ICON on
      expect(serveTimeFillAtWorld('EURO', 'waves')).toBe(false);
      expect(staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD })).toBe(true);
      expect(staticEligible({ model: 'ICON', layer: 'waves', bbox: WORLD })).toBe(false);
      window.__WEATHER_CAPABILITIES__ = [row('GFS'), row('EURO'), row('ICON')];                       // an older server: no field
      expect(serveTimeFillAtWorld('EURO', 'waves')).toBe(true);
      window.__WEATHER_CAPABILITIES__ = { not: 'a list' };                                             // unreadable: guard stays
      expect(serveTimeFillAtWorld('ICON', 'swell_1')).toBe(true);
      delete window.__WEATHER_CAPABILITIES__;                                                          // not loaded yet
      expect(serveTimeFillAtWorld('ICON', 'waves')).toBe(true);
    } finally {
      delete window.__WEATHER_CAPABILITIES__;
    }
    expect(STATIC_SETS).toHaveLength(13);   // the eight marine sets + GFS wind (windStaticFrames.js) + GFS/EURO/ICON pressure + GFS air temperature (ownRasterFrames.js), which marine never serves
    expect(staticEligible({ model: 'GFS', layer: 'wind', bbox: WORLD })).toBe(false);
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: WORLD, surf: true })).toBe(false);
    expect(staticEligible({ model: 'EURO', layer: 'swell_1', bbox: WORLD })).toBe(false);
    expect(staticEligible({ model: 'ICON', layer: 'swell_2', bbox: WORLD })).toBe(false);
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: { west: -100, south: 0, east: -60, north: 40 } })).toBe(false);
  });

  test('each set has its own kill (window list or this browser), and the global kill still wins', () => {
    window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = ['ICON/marine/waves/global_mid'];
    expect(staticSetEnabled('ICON/marine/waves/global_mid')).toBe(false);
    expect(staticEligible({ model: 'ICON', layer: 'waves', bbox: WORLD })).toBe(false);
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: WORLD })).toBe(true);
    window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = '*';
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: WORLD })).toBe(false);
    delete window.__RAW_DISABLE_STATIC_FRAMES_SETS__;
    window.localStorage.setItem('__RAW_STATIC_FRAMES_SETS_OFF__', 'EURO/marine/waves/global_mid, GFS/marine/swell_2/global_mid');
    expect(staticSetEnabled('EURO/marine/waves/global_mid')).toBe(false);
    expect(staticSetEnabled('GFS/marine/swell_2/global_mid')).toBe(false);
    expect(staticSetEnabled('GFS/marine/swell_1/global_mid')).toBe(true);
    window.localStorage.removeItem('__RAW_STATIC_FRAMES_SETS_OFF__');
    window.__RAW_DISABLE_STATIC_FRAMES__ = true;
    expect(staticEligible({ model: 'GFS', layer: 'swell_1', bbox: WORLD })).toBe(false);
  });

  test('an ICON world request asks /grid (Gulf fill); with the guard killed it is served from its own set', async () => {
    const idx = indexFor('icon', ['2026-10-20T00:00:00Z']);
    idx.common_meta = { model: 'ICON', provider: 'open-meteo', domain: 'marine', layer: 'waves', upstream_provider: 'dwd', is_estimated: false };
    const iconKey = setKeyFor('ICON', 'waves');
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      const ok = (body) => ({ ok: true, status: 200, json: async () => body });
      if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets: { [iconKey]: { index: idx.path } } });
      if (url === BASE + idx.path) return ok(idx);
      if (url.endsWith('.bin')) { const buf = goldenBuffer('2026-10-20T00:00:00Z'); return { ok: true, status: 200, arrayBuffer: async () => buf.slice(0) }; }
      return { ok: false, status: 400, json: async () => ({}) };
    });
    expect(await tryStaticWorldGrid({ model: 'ICON', layer: 'waves', validTimeStr: '2026-10-20T00:00:00Z', clampedBbox: WORLD })).toBeNull();
    expect(calls).toHaveLength(0);                                         // refused before any CDN request
    window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__ = true;
    const json = await tryStaticWorldGrid({ model: 'ICON', layer: 'waves', validTimeStr: '2026-10-20T00:00:00Z', clampedBbox: WORLD });
    expect(json).toMatchObject({ model: 'ICON', upstream_provider: 'dwd', served_valid_time: '2026-10-20T00:00:00Z' });
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'swell_1', validTimeStr: '2026-10-20T00:00:00Z', clampedBbox: WORLD })).toBeNull();
    expect(window.__RAW_STATIC_FRAMES__.misses.no_index).toBe(1);            // a set not in latest.json: /grid
    // A per-set kill flipped AFTER the pin also hides the pin from the frame store (it reaches sets only through these).
    expect(getPinnedIndexSync(iconKey)).toBe(idx);
    window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = [iconKey];
    expect(getPinnedIndexSync(iconKey)).toBeNull();
    expect(hasPinnedIndex(iconKey)).toBe(false);
    delete window.__RAW_DISABLE_STATIC_FRAMES_SETS__;
    expect(hasPinnedIndex(iconKey)).toBe(true);
    // With the guard on, the frame store never takes an ICON/EURO set (it cannot tell a world view from a crop at its door).
    delete window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__;
    expect(getPinnedIndexSync(iconKey)).toBeNull();
  });

  test('a non-waves set rides both seams since #456 (the conform carries is_valid); the frame store still does not take it', async () => {
    // Before #456 the series conform dropped top-level is_valid and the encoder recovered land from v.waves only, so a swell
    // series frame's land cells (~4,850 of 15,023 in a real world frame) encoded as ocean: #453 held non-waves sets to seam A.
    const idx = indexFor('s1', ['2026-10-20T00:00:00Z']);
    idx.common_meta = { ...idx.common_meta, layer: 'swell_1' };
    const swellKey = setKeyFor('GFS', 'swell_1');
    global.fetch = jest.fn(async (url) => {
      const ok = (body) => ({ ok: true, status: 200, json: async () => body });
      if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets: { [swellKey]: { index: idx.path } } });
      if (url === BASE + idx.path) return ok(idx);
      if (url.endsWith('.bin')) { const buf = goldenBuffer('2026-10-20T00:00:00Z'); return { ok: true, status: 200, arrayBuffer: async () => buf.slice(0) }; }
      return { ok: false, status: 400, json: async () => ({}) };
    });
    const json = await tryStaticWorldGrid({ model: 'GFS', layer: 'swell_1', validTimeStr: '2026-10-20T00:00:00Z', clampedBbox: WORLD });
    expect(json).toMatchObject({ layer: 'swell_1', served_valid_time: '2026-10-20T00:00:00Z' });
    expect(json.grid.vectors.every((v) => 'is_valid' in v)).toBe(true);
    expect(staticEligible({ model: 'GFS', layer: 'swell_1', bbox: WORLD })).toBe(true);
    expect(staticSeriesEligible({ model: 'GFS', layer: 'swell_1', bbox: WORLD })).toBe(true);
    const got = [];
    expect(await staticSeriesFrames({ model: 'GFS', layer: 'swell_1', bbox: WORLD, hours: [0], anchorMs: now,
      onFrames: (frames) => got.push(...frames) })).toEqual([]);
    expect(got).toHaveLength(1);
    expect(got[0].vectors.every((v) => 'is_valid' in v)).toBe(true);   // what the conform now carries to the encoder
    // The waves-only rule comes back with #456's own kill (land would be ocean again) and with this gate's kill.
    window.__RAW_DISABLE_CONFORM_IS_VALID__ = true;
    expect(staticSeriesEligible({ model: 'GFS', layer: 'swell_1', bbox: WORLD })).toBe(false);
    expect(staticSeriesEligible({ model: 'GFS', layer: 'waves', bbox: WORLD })).toBe(true);
    delete window.__RAW_DISABLE_CONFORM_IS_VALID__;
    window.__RAW_DISABLE_STATIC_SERIES_ALL_SETS__ = true;
    expect(staticSeriesEligible({ model: 'GFS', layer: 'swell_1', bbox: WORLD })).toBe(false);
    delete window.__RAW_DISABLE_STATIC_SERIES_ALL_SETS__;
    expect(hasPinnedIndex(swellKey)).toBe(true);
    expect(getPinnedIndexSync(swellKey)).toBeNull();      // the frame store (waves-only packer) still never sees it
  });

  test('serves the /grid JSON from the CDN frame, then from memory', async () => {
    const idx = indexFor('a', ['2026-10-20T00:00:00Z', '2026-10-20T03:00:00Z']);
    const calls = cdn({ latestIndex: () => idx.path, indexes: [idx] });
    const json = await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: '2026-10-20T02:00:00.000Z', clampedBbox: WORLD });
    expect(json.served_valid_time).toBe('2026-10-20T03:00:00Z');
    expect(json.grid.vectors).toHaveLength(12);
    expect(json.static_frame.index).toBe(idx.path);
    await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: '2026-10-20T03:00:00.000Z', clampedBbox: WORLD });
    expect(calls.filter((u) => u.endsWith('.bin'))).toHaveLength(1);
    expect(calls.some((u) => u.includes('/api/'))).toBe(false);
    expect(window.__RAW_STATIC_FRAMES__).toMatchObject({ hits: 2, lruHits: 1, fetches: 1 });
    expect(window.__RAW_STATIC_FRAMES__.pin.index).toBe(idx.path);
  });

  test('a new run never replaces the pin mid-scrub; it is adopted after the scrub idles', async () => {
    const a = indexFor('a', ['2026-10-20T00:00:00Z']);
    const b = indexFor('b', ['2026-10-20T00:00:00Z']);
    let latest = a.path;
    cdn({ latestIndex: () => latest, indexes: [a, b] });
    expect((await getPinnedIndex(KEY)).path).toBe(a.path);
    latest = b.path;
    for (let i = 0; i < 12; i++) {                       // a 2-minute scrub, one request every 10 s
      now += 10000;
      expect((await getPinnedIndex(KEY)).path).toBe(a.path);
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(window.__RAW_STATIC_FRAMES__.newRunWaiting.index).toBe(b.path);
    now += 31000;                                        // idle
    expect((await getPinnedIndex(KEY)).path).toBe(b.path);
  });

  test('a frame gone from the CDN falls back (null) and re-pins on the next request', async () => {
    const a = indexFor('a', ['2026-10-20T00:00:00Z']);
    const b = indexFor('b', ['2026-10-20T00:00:00Z']);
    let latest = a.path;
    cdn({ latestIndex: () => latest, indexes: [a, b], missing: [] });
    await getPinnedIndex(KEY);
    latest = b.path;
    global.fetch.mockImplementationOnce(async () => ({ ok: false, status: 400, json: async () => ({}) }));
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: '2026-10-20T00:00:00Z', clampedBbox: WORLD })).toBeNull();
    expect(window.__RAW_STATIC_FRAMES__.misses.http_400).toBe(1);
    const json = await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: '2026-10-20T00:00:00Z', clampedBbox: WORLD });
    expect(json.static_frame.index).toBe(b.path);
  });

  test('no frame within 3 h and no index both fall back with a recorded reason', async () => {
    const idx = indexFor('a', ['2026-10-20T00:00:00Z']);
    cdn({ latestIndex: () => idx.path, indexes: [idx] });
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: '2026-10-20T04:00:00Z', clampedBbox: WORLD })).toBeNull();
    expect(window.__RAW_STATIC_FRAMES__.misses.no_frame_in_window).toBe(1);
    _resetStaticFramesForTest();
    cdn({ latestIndex: () => null, indexes: [] });
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: '2026-10-20T00:00:00Z', clampedBbox: WORLD })).toBeNull();
    expect(window.__RAW_STATIC_FRAMES__.misses.no_index).toBe(1);
  });

  test('seam A: fetchBackendMarineGrid answers a world box without /grid; the kill switch restores /grid', async () => {
    const idx = indexFor('a', ['2026-10-20T00:00:00Z']);
    const calls = cdn({ latestIndex: () => idx.path, indexes: [idx] });
    setCachedManifest({ products: [{ model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'global_mid', valid_time_start: '2026-10-20T00:00:00Z' }] });
    window.__MOCK_DATE_NOW__ = now;
    try {
      const out = await fetchBackendMarineGrid(WORLD, 0, undefined, WORLD, 'waves', 'GFS');
      expect(out.grid.vectors).toHaveLength(12);
      expect(out.grid.served_valid_time).toBe('2026-10-20T00:00:00Z');
      expect(calls.some((u) => u.includes('/api/weather/grid?'))).toBe(false);
      window.__RAW_DISABLE_STATIC_FRAMES__ = true;
      await fetchBackendMarineGrid(WORLD, 0, undefined, WORLD, 'waves', 'GFS');
      expect(calls.some((u) => u.includes('/api/weather/grid?'))).toBe(true);
    } finally {
      delete window.__MOCK_DATE_NOW__;
    }
  });

  test('seam A for EURO: the Copernicus client serves EURO from frames (guard killed here); the guard and the per-set kill ask /grid', async () => {
    const idx = indexFor('euro', ['2026-10-20T00:00:00Z']);
    idx.common_meta = { ...idx.common_meta, model: 'EURO', upstream_provider: 'ecmwf' };
    const euroKey = setKeyFor('EURO', 'waves');
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      const ok = (body) => ({ ok: true, status: 200, json: async () => body });
      if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets: { [euroKey]: { index: idx.path } } });
      if (url === BASE + idx.path) return ok(idx);
      if (url.endsWith('.bin')) { const buf = goldenBuffer('2026-10-20T00:00:00Z'); return { ok: true, status: 200, arrayBuffer: async () => buf.slice(0) }; }
      return { ok: false, status: 400, json: async () => ({}) };
    });
    setCachedManifest({ products: [{ model: 'EURO', domain: 'marine', layer: 'waves', region_id: 'global_mid', valid_time_start: '2026-10-20T00:00:00Z',
      coverage: { west: -180, south: -80, east: 180, north: 85 } }] });
    window.__MOCK_DATE_NOW__ = now;
    window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__ = true;     // the seam itself; the guard's own refusal is checked below
    try {
      const out = await fetchBackendCopernicusGrid(WORLD, 0, undefined, WORLD, 'test', 'waves');
      expect(out.grid.vectors).toHaveLength(12);
      expect(calls.some((u) => u.includes('/api/weather/grid?'))).toBe(false);
      delete window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__;   // the guard on: a world EURO box asks /grid
      await expect(fetchBackendCopernicusGrid(WORLD, 0, undefined, WORLD, 'test', 'waves')).rejects.toThrow();
      expect(calls.filter((u) => u.includes('/api/weather/grid?model=EURO'))).toHaveLength(1);
      window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__ = true;
      window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = [euroKey];
      await expect(fetchBackendCopernicusGrid(WORLD, 0, undefined, WORLD, 'test', 'waves')).rejects.toThrow();   // the mocked /grid is a 400
      expect(calls.some((u) => u.includes('/api/weather/grid?model=EURO'))).toBe(true);
    } finally {
      delete window.__MOCK_DATE_NOW__;
      delete window.__RAW_DISABLE_STATIC_FRAMES_SETS__;
      delete window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__;
    }
  });

  test('seam B: nearest hours first, a 9-hour window, and no CDN bulk prefetch for background pages', async () => {
    expect(nearestFirst([0, 3, 6, 9, 12], 6)).toEqual([6, 9, 3, 12, 0]);
    const hours = Array.from({ length: 16 }, (_, i) => i * 3);
    const idx = indexFor('a', hours.map((h) => new Date(now + h * 3600000).toISOString().replace('.000Z', 'Z')));
    const calls = cdn({ latestIndex: () => idx.path, indexes: [idx] });
    jest.spyOn(require('./seriesAnchor'), 'seriesAnchorTag').mockReturnValue(`@${new Date(now).toISOString()}`);
    const committed = [];
    const base = { model: 'GFS', layer: 'waves', reqBox: WORLD, surf: false, hours, present: () => new Set(), keepOnly: () => {}, commit: (h) => committed.push(h) };
    expect(await loadWorldPageFromStatic({ ...base, background: true })).toBe(true);
    expect(calls.filter((u) => u.endsWith('.bin'))).toHaveLength(0);
    require('./marineSeriesStatic').noteStaticFocus('GFS', 'waves', 21);
    expect(await loadWorldPageFromStatic({ ...base, background: false })).toBe(true);
    expect(committed.sort((x, y) => x - y)).toEqual([9, 12, 15, 18, 21, 24, 27, 30, 33]);
    expect(calls.filter((u) => u.endsWith('.bin'))).toHaveLength(9);
  });

  test('an unbuilt entry falls back to /grid instead of substituting the frame 3 h away (review finding 2)', async () => {
    const idx = indexFor('g', ['2026-10-20T00:00:00Z', '2026-10-20T03:00:00Z']);
    idx.frames[1] = { valid_time: '2026-10-20T03:00:00Z', is_estimated: false, path: null, unbuilt: 'not_local', source: {} };
    const calls = cdn({ latestIndex: () => idx.path, indexes: [idx] });
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: '2026-10-20T02:00:00Z', clampedBbox: WORLD })).toBeNull();
    expect(window.__RAW_STATIC_FRAMES__.misses.unbuilt_frame).toBe(1);
    expect(calls.filter((u) => u.endsWith('.bin'))).toHaveLength(0);          // the 00Z frame was NOT served for 02Z
    const ok = await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: '2026-10-20T01:00:00Z', clampedBbox: WORLD });
    expect(ok.served_valid_time).toBe('2026-10-20T00:00:00Z');                 // 00Z is the nearest for 01Z: served
  });

  test('seam B leaves an unbuilt hour to the per-hour path', async () => {
    const hours = [0, 3, 6];
    const valids = hours.map((h) => new Date(now + h * 3600000).toISOString().replace('.000Z', 'Z'));
    const idx = indexFor('s', valids);
    idx.frames[1] = { valid_time: valids[1], is_estimated: false, path: null, unbuilt: 'refused', source: {} };
    cdn({ latestIndex: () => idx.path, indexes: [idx] });
    const { staticSeriesFrames } = require('./staticFrames');
    const committed = [];
    const missing = await staticSeriesFrames({ model: 'GFS', layer: 'waves', bbox: WORLD, hours, anchorMs: now, focusHour: 0,
      onFrames: (fr) => fr.forEach((f) => committed.push(f.hour_offset)) });
    expect(missing).toEqual([3]);
    expect(committed.sort((a, b) => a - b)).toEqual([0, 6]);
  });

  test('a shared frame fetch survives one caller aborting, and stops only when every caller has (review finding 3)', async () => {
    const frame = { valid_time: '2026-10-20T00:00:00Z', path: 'v1/f/x/2026-10-20T00:00:00Z.bin' };
    const pending = [];
    global.fetch = jest.fn((url, opts) => new Promise((resolve, reject) => {
      const job = { url, signal: opts && opts.signal, resolve, reject };
      if (job.signal) job.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      pending.push(job);
    }));
    const a = new AbortController();
    const b = new AbortController();
    const pa = loadFrameVectors(KEY, frame, a.signal);
    const pb = loadFrameVectors(KEY, frame, b.signal);
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);                              // one shared fetch
    a.abort();                                                                  // seam A superseded
    expect(await pa).toBeNull();
    expect(pending[0].signal.aborted).toBe(false);                              // B still wants it
    const buf = goldenBuffer('2026-10-20T00:00:00Z');
    pending[0].resolve({ ok: true, status: 200, arrayBuffer: async () => buf });
    const vectors = await pb;
    expect(vectors).toHaveLength(12);
    expect(await loadFrameVectors(KEY, frame)).toBe(vectors);                   // it reached the LRU
    const frame2 = { valid_time: '2026-10-20T00:00:00Z', path: 'v1/f/x/other.bin' };
    const c = new AbortController();
    const d = new AbortController();
    const pc = loadFrameVectors(KEY, frame2, c.signal);
    const pd = loadFrameVectors(KEY, frame2, d.signal);
    await Promise.resolve();
    c.abort();
    expect(pending[1].signal.aborted).toBe(false);
    d.abort();
    expect(pending[1].signal.aborted).toBe(true);                               // nobody left: the fetch stops
    expect(await pc).toBeNull();
    expect(await pd).toBeNull();
  });

  test('a missing latest.json is not re-asked on every step (negative cache, 60 s doubling to 15 min)', async () => {
    const calls = cdn({ latestIndex: () => null, indexes: [] });
    global.fetch.mockImplementation(async (url) => { calls.push(url); return { ok: false, status: 400, json: async () => ({}) }; });
    const ask = () => tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: '2026-10-20T00:00:00Z', clampedBbox: WORLD });
    expect(await ask()).toBeNull();
    now += 10000;
    expect(await ask()).toBeNull();
    now += 10000;
    expect(await ask()).toBeNull();
    expect(calls.filter((u) => u.endsWith('v1/latest.json'))).toHaveLength(1);   // three steps, one 400
    expect(window.__RAW_STATIC_FRAMES__.misses.no_index).toBe(3);
    now += 61000;
    await ask();
    expect(calls.filter((u) => u.endsWith('v1/latest.json'))).toHaveLength(2);   // re-asked after the negative TTL
    now += 61000;
    await ask();
    expect(calls.filter((u) => u.endsWith('v1/latest.json'))).toHaveLength(2);   // backoff: the second miss waits 120 s
    now += 60000;
    await ask();
    expect(calls.filter((u) => u.endsWith('v1/latest.json'))).toHaveLength(3);
  });
});

// FETCH PRIORITY (2026-10-23, skills audit #1). Chrome gives a worker fetch the same scheduling priority as the main thread's
// (trace-verified, Chrome 154); here jsdom has no Worker, so the main-thread fallback carries the same init.
describe('fetch priority on frame fetches', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    _resetStaticFramesForTest();
    window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
    window.__RAW_STATIC_FRAMES_BASE__ = BASE;
  });
  afterEach(() => {
    window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
    delete window.__RAW_STATIC_FRAMES_BASE__;
    delete window.__RAW_DISABLE_FETCH_PRIORITY__;
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });
  const initOf = (url) => (global.fetch.mock.calls.find((c) => String(c[0]).includes(url)) || [])[1] || {};

  it("passes 'high' / 'low' as RequestInit.priority, nothing for the default, and nothing at all under the kill switch", async () => {
    const buf = goldenBuffer('2026-10-20T00:00:00Z');
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buf.slice(0) }));
    await fetchFrameBytes(BASE + 'a.bin', undefined, 'low');
    await fetchFrameBytes(BASE + 'b.bin', undefined, 'high');
    await fetchFrameBytes(BASE + 'c.bin');
    await fetchFrameBytes(BASE + 'd.bin', undefined, 'urgent');          // not a RequestInit.priority value: the default
    expect(initOf('a.bin').priority).toBe('low');
    expect(initOf('b.bin').priority).toBe('high');
    expect('priority' in initOf('c.bin')).toBe(false);
    expect('priority' in initOf('d.bin')).toBe(false);
    expect(initOf('a.bin').credentials).toBe('omit');
    window.__RAW_DISABLE_FETCH_PRIORITY__ = true;
    await fetchFrameBytes(BASE + 'e.bin', undefined, 'low');
    expect('priority' in initOf('e.bin')).toBe(false);
    expect(window.__RAW_STATIC_FRAMES__.byPriority).toEqual({ high: 1, low: 1, auto: 3 });
    expect(fetchPriorityOf('low')).toBeUndefined();                        // still killed
  });

  it("seam A's exact frame (the step on screen) asks 'high'", async () => {
    const idx = indexFor('gfs', ['2026-10-20T00:00:00Z']);
    cdn({ latestIndex: () => idx.path, indexes: [idx] });
    const json = await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: '2026-10-20T00:00:00Z', clampedBbox: WORLD });
    expect(json).toBeTruthy();
    expect(initOf('.bin').priority).toBe('high');
  });

  it("the inline worker's own fetch carries the priority (its REAL source, run in a fake worker scope)", async () => {
    let src = null;
    const RealBlob = global.Blob;
    const hadCreate = URL.createObjectURL;
    const workerFetch = jest.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }));
    global.Blob = function CapturingBlob(parts, opts) { src = parts.join(''); return new RealBlob(parts, opts); };
    URL.createObjectURL = () => 'blob:frames-worker';
    global.Worker = class FakeWorker {
      constructor() {
        const scope = { postMessage: (data) => this.onmessage && this.onmessage({ data }) };
        new Function('self', 'fetch', 'performance', 'AbortController', src)(scope, workerFetch, performance, AbortController);
        this.scope = scope;
      }
      postMessage(m) { this.scope.onmessage({ data: m }); }
      terminate() {}
    };
    try {
      global.fetch = jest.fn();                                              // the main-thread fallback must not run
      expect((await fetchFrameBytes(BASE + 'w1.bin', undefined, 'high')).error).toBeUndefined();
      expect((await fetchFrameBytes(BASE + 'w2.bin')).error).toBeUndefined();
      expect(window.__RAW_STATIC_FRAMES__.worker).toBe('blob');
      expect(workerFetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit', priority: 'high' });
      expect('priority' in workerFetch.mock.calls[1][1]).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.Blob = RealBlob;
      URL.createObjectURL = hadCreate;
      delete global.Worker;
      _resetStaticFramesForTest();
    }
  });
});

// BOOT WARM-UP (2026-10-23, skills audit #2): at MapPage mount the worker, latest.json, the index pin and the current hour's
// frame (vectors built, 'low' priority) start before the map asks; once per page; skipped on Save-Data / 2g, killed by a switch.
describe('prewarmStaticFrames', () => {
  const realFetch = global.fetch;
  let now;
  beforeEach(() => {
    _resetStaticFramesForTest();
    window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
    window.__RAW_STATIC_FRAMES_BASE__ = BASE;
    now = Date.parse('2026-10-20T00:20:00Z');                              // the app's hour 0 rounds to 00Z
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    window.requestIdleCallback = (fn) => setTimeout(fn, 0);
  });
  afterEach(() => {
    window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
    delete window.__RAW_STATIC_FRAMES_BASE__;
    delete window.__RAW_DISABLE_STATIC_FRAMES_PREWARM__;
    delete window.requestIdleCallback;
    Object.defineProperty(window.navigator, 'connection', { configurable: true, value: undefined });
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });
  const idx = () => indexFor('gfs', ['2026-10-19T21:00:00Z', '2026-10-20T00:00:00Z', '2026-10-20T03:00:00Z']);

  it("pins the model's index and loads the current hour's frame at 'low' priority, once per page", async () => {
    const index = idx();
    const calls = cdn({ latestIndex: () => index.path, indexes: [index] });
    const p = prewarmStaticFrames({ model: 'GFS' });
    expect(prewarmStaticFrames({ model: 'GFS' })).toBe(p);                 // once per page
    expect(await p).toBe('2026-10-20T00:00:00Z');
    expect(getPinnedIndexSync(KEY)).toBe(index);
    const frameCalls = global.fetch.mock.calls.filter((c) => String(c[0]).endsWith('.bin'));
    expect(frameCalls.map((c) => c[0])).toEqual([BASE + 'v1/f/gfs/2026-10-20T00:00:00Z.bin']);
    expect(frameCalls[0][1].priority).toBe('low');
    expect(window.__RAW_STATIC_FRAMES__.prewarm).toMatchObject({ model: 'GFS', frame: '2026-10-20T00:00:00Z', skipped: null });
    // seam A then finds the vectors in place: no second frame fetch
    const before = calls.length;
    const json = await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: '2026-10-20T00:00:00Z', clampedBbox: WORLD });
    expect(json).toBeTruthy();
    expect(calls.slice(before).filter((u) => u.endsWith('.bin'))).toEqual([]);
  });

  it.each([
    ['Save-Data', () => Object.defineProperty(window.navigator, 'connection', { configurable: true, value: { saveData: true, effectiveType: '4g' } })],
    ['a 2g link', () => Object.defineProperty(window.navigator, 'connection', { configurable: true, value: { saveData: false, effectiveType: '2g' } })],
    ['the kill switch', () => { window.__RAW_DISABLE_STATIC_FRAMES_PREWARM__ = true; }],
  ])('does nothing on %s', async (_, arrange) => {
    const index = idx();
    cdn({ latestIndex: () => index.path, indexes: [index] });
    arrange();
    expect(prewarmStaticFrames({ model: 'GFS' })).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a model whose world box stays on /grid (EURO since #461) fetches nothing', async () => {
    const index = idx();
    cdn({ latestIndex: () => index.path, indexes: [index] });
    expect(await prewarmStaticFrames({ model: 'EURO' })).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.__RAW_STATIC_FRAMES__.prewarm.skipped).toBe('not_eligible');
  });
});
