/**
 * THE GPU FRAME STORE TAKES THE FILLED EURO/ICON WORLD SET (2026-10-25, the lead: "Accept a EURO/ICON world set only when its index's
 * fill_mode equals /capabilities gulf_fill_mid_mode. Otherwise keep excluding it (fail closed)"). Pins:
 *  - staticWorldFillGuard.filledStoreAccepts: the server, the latest.json record AND the pinned index (index.fill.mode) must agree;
 *  - staticFrames.getPinnedIndexSync: a plain EURO/ICON set is still refused while the guard holds; the filled set only when accepted;
 *  - staticFrames.storeSetKeyFor: the store's set is the filled one while servable, else the plain one (refused: today's behaviour);
 *  - the wiring: the store keeps filled sets apart (their own domain) and never builds a crop window from one.
 */
import fs from 'fs';
import path from 'path';
import { _resetStaticFramesForTest, getPinnedIndex, getPinnedIndexSync, staticEligible, storeCropSetKeyFor, storeSetKeyFor } from './staticFrames';
import { filledStoreAccepts } from './staticWorldFillGuard';

const BASE = 'https://cdn.test/weather-frames/';
const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const FILLED = 'EURO/marine/waves/global_mid_filled';
const PLAIN = 'EURO/marine/waves/global_mid';
const VT = '2026-10-20T00:00:00Z';
const caps = (mode) => [{ model: 'GFS', domain: 'marine', layer: 'waves' },
  { model: 'EURO', domain: 'marine', layer: 'waves', gulf_fill_mid: mode !== 'off', gulf_fill_mid_mode: mode },
  { model: 'ICON', domain: 'marine', layer: 'waves', gulf_fill_mid: mode !== 'off', gulf_fill_mid_mode: mode }];
const indexFor = (name, fill) => ({
  version: 1, encoding_version: 1, transform_version: 1, path: `v1/idx/${name}.json`, run: '2026-10-19T18:00:00Z',
  grid: { cols: 4, rows: 3, bounds: { west: -180, south: -80, east: 180, north: 85 } },
  common_meta: { model: 'EURO', provider: 'test', domain: 'marine', layer: 'waves', is_estimated: false },
  ...(fill ? { fill } : {}),
  frames: [{ valid_time: VT, is_estimated: false, path: `v1/f/${name}/${VT}.bin`, meta: { product_id: `p_${name}` } }],
});
const SETS = { [FILLED]: { index: 'v1/idx/filled.json', run: 'r', fill_mode: 'targeted' }, [PLAIN]: { index: 'v1/idx/plain.json', run: 'r' } };
function cdn(filledIndex) {
  const indexes = [filledIndex, indexFor('plain')];
  global.fetch = jest.fn(async (url) => {
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets: SETS });
    for (const idx of indexes) if (url === BASE + idx.path) return ok(idx);
    return { ok: false, status: 400, json: async () => ({}) };
  });
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const KILLS = ['__RAW_DISABLE_FILLED_WORLD_STORE__', '__WEATHER_CAPABILITIES__', '__RAW_DISABLE_STATIC_FILLED_WORLD__', '__RAW_DISABLE_PLAIN_SET_CROPS__'];

describe('the frame store and the filled EURO/ICON world set', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    _resetStaticFramesForTest();
    window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
    window.__RAW_STATIC_FRAMES_BASE__ = BASE;
    delete window.__RAW_DISABLE_STATIC_FRAMES__;
    jest.spyOn(Date, 'now').mockImplementation(() => Date.parse(VT));
  });
  afterEach(() => {
    window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
    delete window.__RAW_STATIC_FRAMES_BASE__;
    KILLS.forEach((k) => { delete window[k]; });
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  test('the rule: the server, the record and the INDEX must all say the targeted mode (every other case fails closed)', () => {
    const latest = { sets: SETS };
    const baked = indexFor('filled', { mode: 'targeted' });
    window.__WEATHER_CAPABILITIES__ = caps('targeted');
    expect(filledStoreAccepts('EURO', 'waves', FILLED, baked, latest)).toBe(true);
    expect(filledStoreAccepts('EURO', 'waves', FILLED, indexFor('filled'), latest)).toBe(false);                       // no fill block (an older publisher)
    expect(filledStoreAccepts('EURO', 'waves', FILLED, indexFor('filled', { mode: 'legacy' }), latest)).toBe(false);   // baked in another mode
    expect(filledStoreAccepts('EURO', 'waves', FILLED, baked, { sets: { [FILLED]: { index: 'x', run: 'r' } } })).toBe(false);  // record: no mode
    expect(filledStoreAccepts('EURO', 'waves', FILLED, baked, null)).toBe(false);                                      // latest.json not read
    expect(filledStoreAccepts('EURO', 'swell_1', 'EURO/marine/swell_1/global_mid_filled', baked, latest)).toBe(false); // the store holds waves only
    expect(filledStoreAccepts('EURO', 'waves', PLAIN, baked, latest)).toBe(false);                                     // the plain key never
    window.__WEATHER_CAPABILITIES__ = caps('legacy');                                                                  // the box in another mode
    expect(filledStoreAccepts('EURO', 'waves', FILLED, baked, latest)).toBe(false);
    delete window.__WEATHER_CAPABILITIES__;                                                                            // capabilities not loaded
    expect(filledStoreAccepts('EURO', 'waves', FILLED, baked, latest)).toBe(false);
    window.__WEATHER_CAPABILITIES__ = caps('targeted');
    window.__RAW_DISABLE_FILLED_WORLD_STORE__ = true;                                                                  // the kill
    expect(filledStoreAccepts('EURO', 'waves', FILLED, baked, latest)).toBe(false);
  });

  test('pinned: the store reads the filled index, never the plain one; a mode change or the kill takes it away again', async () => {
    window.__WEATHER_CAPABILITIES__ = caps('targeted');
    cdn(indexFor('filled', { mode: 'targeted' }));
    staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD });     // starts the latest.json read (#555)
    await flush();
    expect(await getPinnedIndex(FILLED)).not.toBe(null);
    expect(await getPinnedIndex(PLAIN)).not.toBe(null);
    expect(storeSetKeyFor('EURO', 'waves')).toBe(FILLED);
    expect(storeSetKeyFor('GFS', 'waves')).toBe('GFS/marine/waves/global_mid');
    expect(getPinnedIndexSync(FILLED)).toEqual(expect.objectContaining({ path: 'v1/idx/filled.json' }));
    expect(getPinnedIndexSync(PLAIN)).toBe(null);                       // the plain EURO set: still refused while the guard holds
    window.__WEATHER_CAPABILITIES__ = caps('legacy');                   // the server leaves the targeted mode mid-session
    expect(getPinnedIndexSync(FILLED)).toBe(null);
    expect(storeSetKeyFor('EURO', 'waves')).toBe(PLAIN);                // ... and the plain key it falls back to is refused too
    expect(getPinnedIndexSync(storeSetKeyFor('EURO', 'waves'))).toBe(null);
    window.__WEATHER_CAPABILITIES__ = caps('targeted');
    window.__RAW_DISABLE_FILLED_WORLD_STORE__ = true;                   // positive control for the kill: today's behaviour exactly
    expect(storeSetKeyFor('EURO', 'waves')).toBe(PLAIN);
    expect(getPinnedIndexSync(FILLED)).toBe(null);
  });

  test('a filled index baked without the mode (an older publisher) is refused even when everything else agrees', async () => {
    window.__WEATHER_CAPABILITIES__ = caps('targeted');
    cdn(indexFor('filled'));
    staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD });
    await flush();
    expect(await getPinnedIndex(FILLED)).not.toBe(null);
    expect(getPinnedIndexSync(FILLED)).toBe(null);
  });

  // MID-ZOOM CROPS FROM THE PLAIN SET (2026-10-26): a viewport /grid is never Gulf-filled (coarse_gulf_fill: span < 350), so the plain
  // EURO/ICON index is served to the store as a CROP source (getPinnedIndexSync(key, { crop: true })), never as a world frame.
  test('the plain EURO set is a crop source only: { crop: true } serves it, a world read never does; the kill and a lifted guard end it', async () => {
    window.__WEATHER_CAPABILITIES__ = caps('targeted');
    cdn(indexFor('filled', { mode: 'targeted' }));
    staticEligible({ model: 'EURO', layer: 'waves', bbox: WORLD });
    await flush();
    expect(await getPinnedIndex(PLAIN)).not.toBe(null);
    expect(getPinnedIndexSync(PLAIN)).toBe(null);                                        // a world read: refused, as before
    expect(getPinnedIndexSync(PLAIN, { crop: true })).toEqual(expect.objectContaining({ path: 'v1/idx/plain.json' }));
    expect(storeCropSetKeyFor('EURO', 'waves')).toBe(PLAIN);
    expect(storeCropSetKeyFor('GFS', 'waves')).toBe(null);                              // GFS has one set for both: nothing to choose
    window.__RAW_DISABLE_PLAIN_SET_CROPS__ = true;                                       // the kill: today's behaviour
    expect(getPinnedIndexSync(PLAIN, { crop: true })).toBe(null);
    expect(storeCropSetKeyFor('EURO', 'waves')).toBe(null);
    delete window.__RAW_DISABLE_PLAIN_SET_CROPS__;
    window.__WEATHER_CAPABILITIES__ = caps('off');                                       // the server fills no world grid: the plain set IS the world set
    expect(storeCropSetKeyFor('EURO', 'waves')).toBe(null);
    expect(getPinnedIndexSync(PLAIN)).not.toBe(null);
  });

  test('wiring: the store picks its set through keyFor (filled for a world resident, plain for a clip), keeps a filled set in its own domain, and builds no crop from one', () => {
    const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
    const rt = src('marineFrameStoreRuntime.js');
    expect(rt.match(/storeSetKeyFor\(/g)).toHaveLength(1);             // inside keyFor only
    expect(rt.match(/\bkeyFor\(/g)).toHaveLength(4);                   // warm plan, noteCommitted, noteStep, the show
    expect(rt.match(/getPinnedIndexSync\(k(ey)?, \{ crop: clip \}\)/g)).toHaveLength(4);   // each read says whether it is for a clip
    expect(rt.match(/if \(cropOnly\(info\)\) return (why|miss)\('crop_only_set'\)/g)).toHaveLength(2);   // never a world resident, never a world show
    expect(rt).not.toMatch(/[^e]setKeyFor\(/);                          // no lookup left on the plain key
    expect(rt).toMatch(/domain: filled \? 'world_filled' : 'world'/);
    const cs = src('marineFrameStoreCropShow.js');
    expect(cs).toMatch(/if \(!w \|\| !cropShowOn\(\) \|\| !info \|\| info\.filled\) return null;/);
    expect(cs).toMatch(/const win = cropShowOn\(\) && !info\.filled \? frameWindowOf\(/);
  });
});
