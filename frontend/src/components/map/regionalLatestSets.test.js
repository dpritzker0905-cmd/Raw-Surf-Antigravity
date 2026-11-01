/**
 * What the regional tile pick reads from latest.json (#514, 2026-10-24): listed, explicit-empty, absent. An index always wins over
 * `empty`; the reason text decides nothing; a non-object / missing sets map is "absent", never a throw.
 */
import { registerLatestProbes, setIsEmpty, setIsListed } from './regionalLatestSets';
import { _setRegionalCodecForTest, pickRegionalTile, regionalManifestPending, regionalSetKey } from './staticRegional';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';

const KEY = 'GFS/marine/swell_2/us_west_coast_socal';
const EMPTY = { empty: true, reason: 'no stored product for this layer in this box', written_at: '2026-10-24T04:00:00Z', writer: 'publisher' };

describe('setIsListed / setIsEmpty', () => {
  it('listed = an index; empty = empty === true and no index; anything else is absent', () => {
    const latest = { sets: { a: { index: 'v1/a.json', run: 'r' }, b: EMPTY, c: { empty: true, index: 'v1/c.json' }, d: { reason: EMPTY.reason }, e: { empty: 'true' }, f: null } };
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k) => setIsListed(latest, k))).toEqual([true, false, true, false, false, false, false]);
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k) => setIsEmpty(latest, k))).toEqual([false, true, false, false, false, false, false]);
  });
  it('before the first read, or on a malformed latest.json, nothing is listed or empty and nothing throws', () => {
    for (const latest of [null, undefined, {}, { sets: null }, { sets: 'x' }, { version: 1 }]) {
      expect(setIsListed(latest, KEY)).toBe(false);
      expect(setIsEmpty(latest, KEY)).toBe(false);
    }
  });
});

describe('registerLatestProbes feeds the tile pick', () => {
  beforeEach(() => { _setRegionalCodecForTest({ sha12: async () => 'x', gunzip: async (b) => b }); });     // jsdom has no crypto.subtle: the tile pick needs a codec
  afterEach(() => { registerLatestProbes(() => null); delete window.__RAW_DISABLE_REGIONAL_PILOT_FALLBACK__; delete window.__RAW_ENABLE_REGIONAL_BUNDLES__; setCachedManifest(null); _setRegionalCodecForTest(); });
  it('the probe reads the latest.json the accessor returns at call time (empty, then listed, then absent)', () => {
    window.__RAW_ENABLE_REGIONAL_BUNDLES__ = true;
    setCachedManifest(null);
    let latest = { sets: { [KEY]: EMPTY } };
    registerLatestProbes(() => latest);
    const box = { west: -122, south: 32, east: -118, north: 35 };
    expect(regionalSetKey('GFS', 'swell_2', 'us_west_coast_socal')).toBe(KEY);
    window.__RAW_DISABLE_REGIONAL_PILOT_FALLBACK__ = true;                                                // so a read latest.json alone cannot end the wait
    expect(regionalManifestPending({ model: 'GFS', layer: 'swell_2', bbox: box })).toBe(false);         // empty: nothing to wait for
    latest = { sets: { [KEY]: { index: 'v1/s2.json', run: 'r' } } };
    expect(regionalManifestPending({ model: 'GFS', layer: 'swell_2', bbox: box })).toBe(true);           // listed: it still waits for the manifest
    delete window.__RAW_DISABLE_REGIONAL_PILOT_FALLBACK__;
    expect(pickRegionalTile({ model: 'GFS', layer: 'swell_2', bboxStr: '-122,32,-118,35' })).toMatchObject({ id: 'us_west_coast_socal', provisional: true });
    latest = null;                                                                                        // not read yet: it waits
    expect(pickRegionalTile({ model: 'GFS', layer: 'swell_2', bboxStr: '-122,32,-118,35' })).toBeNull();
    expect(regionalManifestPending({ model: 'GFS', layer: 'swell_2', bbox: box })).toBe(true);
  });
});
