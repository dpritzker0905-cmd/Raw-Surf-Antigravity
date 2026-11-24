/**
 * decodedOmBudget.js (2026-11-23): window.__DECODED_OM_TILES__ held 280 MB of a 985 MB retained heap (offline replay), each field
 * twice on the main thread: the decoder's direct store, then its own BroadcastChannel echo's structured clone under the same key.
 */
import fs from 'fs';
import path from 'path';
import { DECODED_OM_MAX, isOwnDecodedOmEcho, trimDecodedOmTiles } from './decodedOmBudget';
import { _resetCacheBudgetForTest } from './cacheBudget';

afterEach(() => { delete window.__RAW_DISABLE_CACHE_BUDGET__; });

describe('one copy per decoded field', () => {
  it('the echo of a field this thread stored at or after the broadcast is skipped', () => {
    const map = new Map([['k', { timestamp: 1000 }]]);
    expect(isOwnDecodedOmEcho(map, { cacheKey: 'k', timestamp: 999 })).toBe(true);
    expect(isOwnDecodedOmEcho(map, { cacheKey: 'k', timestamp: 1000 })).toBe(true);
  });
  it('a newer broadcast (a worker\'s decode, or a re-decode) still lands; so does an unknown key', () => {
    const map = new Map([['k', { timestamp: 1000 }]]);
    expect(isOwnDecodedOmEcho(map, { cacheKey: 'k', timestamp: 1001 })).toBe(false);
    expect(isOwnDecodedOmEcho(map, { cacheKey: 'other', timestamp: 5 })).toBe(false);
    expect(isOwnDecodedOmEcho(null, { cacheKey: 'k' })).toBe(false);
  });
  it('KILL: the echo copy is stored again, as before', () => {
    window.__RAW_DISABLE_CACHE_BUDGET__ = true;
    expect(isOwnDecodedOmEcho(new Map([['k', { timestamp: 1000 }]]), { cacheKey: 'k', timestamp: 999 })).toBe(false);
  });
  it('the protocol\'s listener asks before storing, and both stores trim through one helper (the file only shrank)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'openMeteoProtocol.js'), 'utf8');
    expect(src).toMatch(/payload\.cacheKey && window\.__DECODED_OM_TILES__ && !isOwnDecodedOmEcho\(window\.__DECODED_OM_TILES__, payload\)/);
    expect(src.match(/trimDecodedOmTiles\(window\.__DECODED_OM_TILES__\)/g)).toHaveLength(2);
    expect(src).not.toMatch(/__DECODED_OM_TILES__\.size > 150/);
  });
});

describe('the FIFO stays the inner bound', () => {
  it(`keeps the newest ${DECODED_OM_MAX}`, () => {
    _resetCacheBudgetForTest();
    const map = new Map();
    for (let i = 0; i < DECODED_OM_MAX + 5; i += 1) map.set(`k${i}`, { timestamp: i });
    trimDecodedOmTiles(map);
    expect(map.size).toBe(DECODED_OM_MAX);
    expect(map.has('k0')).toBe(false);
    expect(map.has(`k${DECODED_OM_MAX + 4}`)).toBe(true);
  });
});
