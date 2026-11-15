/**
 * The series decode off the main thread (marineSeriesDecode.js, 2026-11-15). Gate 2 of the pre-registration: what the worker
 * packs and the main thread rebuilds is IDENTICAL to JSON.parse (key order, every number bit-exact, null vs absent). Plus the
 * lazy map's contract, the worker source's self-containment and the main-thread fallback.
 */
import {
  LazySeriesFrames, SERIES_NUM_KEYS, firstFrameBounds, loadSeriesJson, packSeriesFrame, packedBuffers, packedVectorCount,
  seriesMiniFrame, seriesPageFrames, unpackSeriesFrame, _resetSeriesDecodeWorkerForTest,
} from './marineSeriesDecode';
import { frameToMarineData } from './marineSeriesFrame';

const PAGES = require('./__fixtures__/seriesPages.sample.json');   // world / regional / swell_2 slices of offline pages

afterEach(() => {
  _resetSeriesDecodeWorkerForTest();
  delete window.__RAW_DISABLE_SERIES_DECODE_WORKER__;
  delete window.__MARINE_SERIES_DIAG__;
});

function sameCells(a, b) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i += 1) {
    expect(Object.keys(a[i])).toEqual(Object.keys(b[i]));
    for (const k of Object.keys(a[i])) expect(Object.is(a[i][k], b[i][k])).toBe(true);
  }
}

describe('GATE 2: pack then rebuild is identical to JSON.parse', () => {
  test.each(Object.keys(PAGES))('%s page: every frame, key order, every cell (Object.is)', (name) => {
    const text = JSON.stringify(PAGES[name]);
    for (const f of JSON.parse(text).frames) {
      const p = packSeriesFrame(f, SERIES_NUM_KEYS);
      expect(p.cols).toBeTruthy();                                   // these pages pack (no raw fallback)
      const back = unpackSeriesFrame(p);
      expect(JSON.stringify(back)).toBe(JSON.stringify(f));        // key order of frame and cells
      sameCells(back.vectors, f.vectors);
    }
  });

  test('the edge values survive: -0, tiny / huge doubles, null vs an absent key', () => {
    const f = { hour_offset: 3, bounds: { west: 0, south: 0, east: 1, north: 1 }, vectors: [
      { lat: -0, lng: 1e-300, speed: 1.7976931348623157e308, direction: 359.99999999999994, u: -1.5, v: 0.1 + 0.2, period: null, is_valid: true },
      { lat: 5, lng: 6, speed: 0, direction: 0, u: 0, v: 0, period: 12, is_valid: false },
    ], cols: 2 };
    const back = unpackSeriesFrame(packSeriesFrame(f, SERIES_NUM_KEYS));
    sameCells(back.vectors, f.vectors);
    expect(Object.is(back.vectors[0].lat, -0)).toBe(true);
    expect('gust' in back.vectors[0]).toBe(false);                   // absent stays absent
    expect(Object.keys(back)).toEqual(['hour_offset', 'bounds', 'vectors', 'cols']);
  });

  test('anything the columns cannot hold travels raw: an unknown key, a string cell, a different key order', () => {
    const base = { lat: 1, lng: 2, speed: 3, direction: 4, u: 0, v: 0, period: 5, is_valid: true };
    for (const odd of [{ ...base, extra: 1 }, { ...base, speed: '3' }, { lng: 2, lat: 1, speed: 3, direction: 4, u: 0, v: 0, period: 5, is_valid: true }]) {
      const f = { hour_offset: 0, vectors: [base, odd] };
      const p = packSeriesFrame(f, SERIES_NUM_KEYS);
      expect(p.cols).toBeUndefined();
      expect(JSON.stringify(unpackSeriesFrame(p))).toBe(JSON.stringify(f));
    }
  });

  test('the transfer list holds every column buffer once', () => {
    const p = packSeriesFrame(PAGES.regional.frames[0], SERIES_NUM_KEYS);
    const bufs = packedBuffers(p);
    expect(bufs.length).toBe(1 + 2 * SERIES_NUM_KEYS.length);
    expect(new Set(bufs).size).toBe(bufs.length);
  });
});

test('the worker source is self-contained: the stringified pack runs in an empty scope', () => {
  const isolated = new Function('KEYS', 'frame', `var packSeriesFrame = ${packSeriesFrame.toString()}; return packSeriesFrame(frame, KEYS);`);
  const f = JSON.parse(JSON.stringify(PAGES.swell2.frames[0]));
  expect(JSON.stringify(unpackSeriesFrame(isolated(SERIES_NUM_KEYS, f)))).toBe(JSON.stringify(f));
});

describe('LazySeriesFrames: a frame is built on first read, and only then', () => {
  const packedPage = () => PAGES.world.frames.map((f) => packSeriesFrame(JSON.parse(JSON.stringify(f)), SERIES_NUM_KEYS));

  test('size / has / keys / metadata build nothing; get builds that one frame, identical to the eager build', () => {
    const { frames, hours } = seriesPageFrames({ packed: packedPage(), json: null }, 'GFS', 'waves');
    expect(frames).toBeInstanceOf(LazySeriesFrames);
    expect(hours).toEqual(PAGES.world.frames.map((f) => f.hour_offset));
    expect(frames.size).toBe(2);
    expect(frames.has(hours[1])).toBe(true);
    expect([...frames.keys()]).toEqual(hours);
    expect(firstFrameBounds(frames)).toEqual(PAGES.world.frames[0].bounds);
    expect([...frames.metaValues()].map((m) => m.model_run_time_status)).toEqual(PAGES.world.frames.map((f) => f.model_run_time_status || 'missing'));
    expect(frames._packed.size).toBe(2);                            // nothing built yet
    const md = frames.get(hours[0]);
    expect(frames._packed.size).toBe(1);                            // exactly one built
    const eager = frameToMarineData(JSON.parse(JSON.stringify(PAGES.world.frames[0])), 'GFS', 'waves');
    expect(JSON.stringify(md.grid.vectors)).toBe(JSON.stringify(eager.grid.vectors));
    expect(md.grid.bounds).toEqual(eager.grid.bounds);
    expect(frames.get(hours[0])).toBe(md);                          // memoised
    expect(window.__MARINE_SERIES_DIAG__.decodes).toBe(1);
  });

  test('a full iteration builds every frame, so no caller ever sees a packed one', () => {
    const { frames } = seriesPageFrames({ packed: packedPage(), json: null }, 'GFS', 'waves');
    const all = [...frames.values()];
    expect(all.every((md) => md && md.grid && Array.isArray(md.grid.vectors) && md.grid.vectors.length === 200)).toBe(true);
    expect(frames._packed.size).toBe(0);
  });

  test('the main-thread path builds a plain Map now, as before, and counts its decode', () => {
    const json = JSON.parse(JSON.stringify(PAGES.regional));
    const { frames, hours } = seriesPageFrames({ packed: null, json }, 'GFS', 'waves');
    expect(frames).not.toBeInstanceOf(LazySeriesFrames);
    expect(hours.length).toBe(2);
    expect(window.__MARINE_SERIES_DIAG__.decodes).toBe(1);
  });

  test('the mini builds only its one frame', () => {
    const f = seriesMiniFrame({ json: { frames: packedPage() }, packed: packedPage() });
    expect(JSON.stringify(f)).toBe(JSON.stringify(PAGES.world.frames[0]));
    expect(packedVectorCount(packedPage()[0])).toBe(200);
  });
});

describe('FALLBACK: no Worker, or the kill switch: the main thread decodes as before', () => {
  const page = PAGES.regional;
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(page), json: async () => page }));
  });
  afterEach(() => { delete global.fetch; });

  test('jsdom has no Worker: the page is fetched and parsed on the main thread, packed is null', async () => {
    const out = await loadSeriesJson('http://x/grid_series', { signal: new AbortController().signal });
    expect(out.ok).toBe(true);
    expect(out.packed).toBeNull();
    expect(JSON.stringify(out.json)).toBe(JSON.stringify(page));
    expect(window.__MARINE_SERIES_DIAG__.mainPages).toBe(1);
  });

  test('OFF PATH: __RAW_DISABLE_SERIES_DECODE_WORKER__ never builds a worker', async () => {
    window.__RAW_DISABLE_SERIES_DECODE_WORKER__ = true;
    const made = jest.fn();
    global.Worker = function W() { made(); };
    try {
      const out = await loadSeriesJson('http://x/grid_series', {});
      expect(out.packed).toBeNull();
      expect(made).not.toHaveBeenCalled();
    } finally { delete global.Worker; }
  });

  test('a failed response keeps its status (the caller retries on it as before); an aborted signal throws AbortError', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 502 }));
    expect(await loadSeriesJson('http://x', {})).toEqual({ ok: false, status: 502 });
    global.fetch = jest.fn(async () => { const e = new Error('a'); e.name = 'AbortError'; throw e; });
    await expect(loadSeriesJson('http://x', {})).rejects.toMatchObject({ name: 'AbortError' });
  });
});

test('the nearest-frame search builds ONE frame on a lazy page, not every frame it passes on the way (gate 3, 2026-11-15)', () => {
  // eslint-disable-next-line global-require
  const { nearestFrameInEntry } = require('./marineSeriesFinerEntry');
  const base = JSON.parse(JSON.stringify(PAGES.regional.frames[0]));
  const page = Array.from({ length: 12 }, (_, i) => packSeriesFrame({ ...JSON.parse(JSON.stringify(base)), hour_offset: i * 3 }, SERIES_NUM_KEYS));
  const { frames, hours } = seriesPageFrames({ packed: page, json: null }, 'GFS', 'waves');
  const hit = nearestFrameInEntry({ hours, frames }, 30);
  expect(hit.frame.hourOffset).toBe(30);
  expect(frames._packed.size).toBe(11);                             // only h30 was built
});
