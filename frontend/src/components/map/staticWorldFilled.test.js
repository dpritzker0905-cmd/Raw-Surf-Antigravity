/**
 * The filled EURO/ICON world sets (2026-10-24; backend services/frame_set_fill.py, staticWorldFillGuard.filledWorldSetKey).
 * Pins: a guarded world box reads `<model>/marine/<layer>/global_mid_filled` only while /capabilities reports the TARGETED mode
 * for that model and the set's latest.json record says the same; every other combination keeps the /grid path; crops keep the
 * plain set; the first EURO world ask starts the latest.json read so the next one can be served; the kill restores /grid.
 */
import {
  _resetStaticFramesForTest, getPinnedIndex, staticEligible, staticSetKeyForBox, tryStaticWorldGrid,
} from './staticFrames';
import { filledWorldSetKey } from './staticWorldFillGuard';
import { goldenBuffer } from './staticFrameGolden.fixture';

const BASE = 'https://cdn.test/weather-frames/';
const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const FILLED = 'EURO/marine/waves/global_mid_filled';
const PLAIN = 'EURO/marine/waves/global_mid';
const VT = '2026-10-20T00:00:00Z';

const caps = (mode) => [{ model: 'GFS', domain: 'marine', layer: 'waves' },
  { model: 'EURO', domain: 'marine', layer: 'waves', gulf_fill_mid: mode !== 'off', gulf_fill_mid_mode: mode },
  { model: 'ICON', domain: 'marine', layer: 'waves', gulf_fill_mid: mode !== 'off', gulf_fill_mid_mode: mode }];

function indexFor(name) {
  return {
    version: 1, encoding_version: 1, transform_version: 1, path: `v1/idx/${name}.json`, run: '2026-10-19T18:00:00Z',
    grid: { cols: 4, rows: 3, bounds: { west: 100, south: -10, east: 107.5, north: 0 } },
    common_meta: { model: 'EURO', provider: 'test', domain: 'marine', layer: 'waves', is_estimated: false },
    frames: [{ valid_time: VT, is_estimated: false, path: `v1/f/${name}/${VT}.bin`, meta: { product_id: `p_${name}` } }],
  };
}

function cdn(sets) {
  const calls = [];
  const indexes = [indexFor('filled'), indexFor('plain')];
  global.fetch = jest.fn(async (url) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets });
    for (const idx of indexes) if (url === BASE + idx.path) return ok(idx);
    const m = url.match(/v1\/f\/[^/]+\/(.+)\.bin$/);
    if (m) { const buf = goldenBuffer(m[1]); return { ok: true, status: 200, arrayBuffer: async () => buf.slice(0) }; }
    return { ok: false, status: 400, json: async () => ({}) };
  });
  return calls;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const SETS = { [FILLED]: { index: 'v1/idx/filled.json', run: 'r', fill_mode: 'targeted' }, [PLAIN]: { index: 'v1/idx/plain.json', run: 'r' } };

describe('filled EURO/ICON world sets', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    _resetStaticFramesForTest();
    window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
    window.__RAW_STATIC_FRAMES_BASE__ = BASE;
    delete window.__RAW_DISABLE_STATIC_FRAMES__;      // the test setup kills static frames globally; this suite tests them
    jest.spyOn(Date, 'now').mockImplementation(() => Date.parse(VT));
  });
  afterEach(() => {
    window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
    delete window.__RAW_STATIC_FRAMES_BASE__;
    delete window.__WEATHER_CAPABILITIES__;
    delete window.__RAW_DISABLE_STATIC_FILLED_WORLD__;
    delete window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__;
    delete window.__RAW_DISABLE_STATIC_FRAMES_SETS__;
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  test('the key: only TARGETED on both sides, a live record, a guarded set', () => {
    const latest = { sets: SETS };
    window.__WEATHER_CAPABILITIES__ = caps('targeted');
    expect(filledWorldSetKey('EURO', 'waves', latest)).toBe(FILLED);
    expect(filledWorldSetKey('euro', 'WAVES', latest)).toBe(FILLED);
    expect(filledWorldSetKey('ICON', 'waves', latest)).toBe(null);                                  // no ICON record published
    expect(filledWorldSetKey('GFS', 'waves', latest)).toBe(null);                                   // never guarded
    expect(filledWorldSetKey('EURO', 'waves', null)).toBe(null);                                    // latest.json not read yet
    expect(filledWorldSetKey('EURO', 'waves', { sets: { [FILLED]: { ...SETS[FILLED], fill_mode: 'legacy' } } })).toBe(null);
    expect(filledWorldSetKey('EURO', 'waves', { sets: { [FILLED]: { empty: true, fill_mode_off: 'legacy' } } })).toBe(null);   // retired
    window.__WEATHER_CAPABILITIES__ = caps('legacy');                                                // the box in another mode
    expect(filledWorldSetKey('EURO', 'waves', latest)).toBe(null);
    window.__WEATHER_CAPABILITIES__ = caps('off');                                                   // off: the plain set serves (guard lifts)
    expect(filledWorldSetKey('EURO', 'waves', latest)).toBe(null);
    window.__WEATHER_CAPABILITIES__ = [{ model: 'EURO', domain: 'marine', gulf_fill_mid: true }];  // an older server: no mode field
    expect(filledWorldSetKey('EURO', 'waves', latest)).toBe(null);
    delete window.__WEATHER_CAPABILITIES__;                                                          // not loaded yet
    expect(filledWorldSetKey('EURO', 'waves', latest)).toBe(null);
    window.__WEATHER_CAPABILITIES__ = caps('targeted');
    window.__RAW_DISABLE_STATIC_FILLED_WORLD__ = true;                                               // the kill
    expect(filledWorldSetKey('EURO', 'waves', latest)).toBe(null);
  });

  test('a EURO world box is served from the filled set once latest.json is read, and never from the plain one', async () => {
    window.__WEATHER_CAPABILITIES__ = caps('targeted');
    const calls = cdn(SETS);
    expect(staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD })).toBe(false);              // nothing read yet: /grid ...
    await flush();
    expect(calls).toEqual([BASE + 'v1/latest.json', BASE + 'v1/idx/filled.json']);                  // ... the read started (index preloaded)
    expect(staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD })).toBe(true);
    expect(staticSetKeyForBox({ model: 'EURO', layer: 'waves', bbox: WORLD })).toBe(FILLED);
    const json = await tryStaticWorldGrid({ model: 'EURO', layer: 'waves', validTimeStr: VT, clampedBbox: WORLD });
    expect(json).not.toBe(null);
    expect(json.product_id).toBe('p_filled');
    expect(calls).toContain(BASE + 'v1/idx/filled.json');
    expect(calls).not.toContain(BASE + 'v1/idx/plain.json');
  });

  test('the latest.json read preloads the filled index (no pin), so the first EURO world ask fetches only the frame', async () => {
    window.__WEATHER_CAPABILITIES__ = caps('targeted');
    const calls = cdn(SETS);
    staticEligible({ model: 'GFS', layer: 'waves', bbox: WORLD });        // nothing here reads latest.json for GFS
    staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD });       // the guarded ask starts the read
    await flush(); await flush();
    expect(calls).toEqual([BASE + 'v1/latest.json', BASE + 'v1/idx/filled.json']);   // the index rides the latest.json read
    const before = calls.length;
    const json = await tryStaticWorldGrid({ model: 'EURO', layer: 'waves', validTimeStr: VT, clampedBbox: WORLD });
    expect(json && json.product_id).toBe('p_filled');
    expect(calls.slice(before).filter((u) => u.endsWith('.json'))).toEqual([]);     // no second index read: only the frame
    expect(calls.filter((u) => u.endsWith('idx/filled.json'))).toHaveLength(1);
  });

  test('no preload while the server is in another mode, or with the preload kill', async () => {
    window.__WEATHER_CAPABILITIES__ = caps('legacy');
    let calls = cdn(SETS);
    await getPinnedIndex('GFS/marine/waves/global_mid').catch(() => null);  // a latest.json read for any reason
    await flush();
    expect(calls.filter((u) => u.includes('idx/filled'))).toEqual([]);
    _resetStaticFramesForTest();
    window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
    window.__RAW_STATIC_FRAMES_BASE__ = BASE;
    window.__WEATHER_CAPABILITIES__ = caps('targeted');
    window.__RAW_DISABLE_FILLED_INDEX_PRELOAD__ = true;
    calls = cdn(SETS);
    await getPinnedIndex('GFS/marine/waves/global_mid').catch(() => null);
    await flush();
    expect(calls.filter((u) => u.includes('idx/filled'))).toEqual([]);
    delete window.__RAW_DISABLE_FILLED_INDEX_PRELOAD__;
    _resetStaticFramesForTest();                                            // the filled set's own kill: no preload either
    window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
    window.__RAW_STATIC_FRAMES_BASE__ = BASE;
    window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = [FILLED];
    calls = cdn(SETS);
    await getPinnedIndex('GFS/marine/waves/global_mid').catch(() => null);
    await flush();
    expect(calls.filter((u) => u.includes('idx/filled'))).toEqual([]);
  });

  test('crops keep the plain set; another mode, a per-set kill or the global kill keep world boxes on /grid', async () => {
    window.__WEATHER_CAPABILITIES__ = caps('targeted');
    cdn(SETS);
    staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD });
    await flush();
    expect(staticSetKeyForBox({ model: 'EURO', layer: 'waves', bbox: { west: -100, south: 0, east: -60, north: 40 } })).toBe(PLAIN);
    window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = [FILLED];
    expect(staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD })).toBe(false);
    delete window.__RAW_DISABLE_STATIC_FRAMES_SETS__;
    window.__WEATHER_CAPABILITIES__ = caps('legacy');
    expect(staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD })).toBe(false);
    expect(await tryStaticWorldGrid({ model: 'EURO', layer: 'waves', validTimeStr: VT, clampedBbox: WORLD })).toBe(null);
    window.__WEATHER_CAPABILITIES__ = caps('targeted');
    window.__RAW_DISABLE_STATIC_FILLED_WORLD__ = true;
    expect(staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD })).toBe(false);
    delete window.__RAW_DISABLE_STATIC_FILLED_WORLD__;
    window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__ = true;                                           // the guard's own kill: plain set
    expect(staticSetKeyForBox({ model: 'EURO', layer: 'waves', bbox: WORLD })).toBe(PLAIN);
    expect(staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD })).toBe(true);
  });
});
