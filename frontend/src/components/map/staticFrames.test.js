import {
  _resetStaticFramesForTest, getPinnedIndex, loadFrameVectors, setKeyFor, staticEligible, staticFramesEnabled, tryStaticWorldGrid,
} from './staticFrames';
import { fetchBackendMarineGrid, setCachedManifest } from './backendWeatherServiceClient';
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

  test('only world GFS waves boxes, never surf (slice 1)', () => {
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: WORLD })).toBe(true);
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: WORLD, surf: true })).toBe(false);
    expect(staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD })).toBe(false);
    expect(staticEligible({ model: 'GFS', layer: 'swell_1', bbox: WORLD })).toBe(false);
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: { west: -100, south: 0, east: -60, north: 40 } })).toBe(false);
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

  test('a missing latest.json is not re-asked on every step (60 s negative cache)', async () => {
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
  });
});
