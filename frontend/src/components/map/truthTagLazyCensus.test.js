// PR D (2026-10-26): the truth tag's vector census (nonzero / validity / min / max) is computed in one pass on first read, not at
// build. The HUD's compare fields (dataHash, boundsHash, product, traceId) are unchanged; the census reads the same values.
import { buildTruthTag, vectorCensus } from './weatherTruthTracker';

const vec = (speed, extra = {}) => ({ lat: 0, lng: 0, speed, direction: 0, u: 0, v: 0, is_valid: true, ...extra });
const payload = (vectors) => ({ model: 'GFS', domain: 'wind', layer: 'wind', valid_time: '2026-10-26T00:00:00Z',
  product_id: 'p', grid: { cols: vectors.length, rows: 1, bounds: { west: 0, south: 0, east: 1, north: 1 }, vectors } });
// (computeJsDataHash, unchanged, needs every vector present, so the build fixtures have no hole; the census alone takes one)
const VECS = [vec(0), vec(3.5), vec(0, { is_valid: false }), vec(12), vec(0, { isOcean: false })];

afterEach(() => { delete window.__RAW_DISABLE_TRUTH_TAG_LAZY_CENSUS__; });

test('one pass reads what the four loops read', () => {
  expect(vectorCensus(VECS)).toEqual({ nonzeroCount: 2, invalidCount: 2, validZeroCount: 1, minSpeed: 0, maxSpeed: 12 });
  expect(vectorCensus([...VECS, null])).toEqual({ nonzeroCount: 2, invalidCount: 2, validZeroCount: 1, minSpeed: 0, maxSpeed: 12 });
  expect(vectorCensus([])).toEqual({ nonzeroCount: 0, invalidCount: 0, validZeroCount: 0, minSpeed: 0, maxSpeed: 0 });
});

test('lazy: no vector is read for the census at build; the first read computes it once', () => {
  const vectors = VECS.slice();
  let reads = 0;
  const watched = new Proxy(vectors, { get(t, k) { if (/^\d+$/.test(String(k))) reads += 1; return t[k]; } });
  const tag = buildTruthTag(payload(watched), 'staticFrame');
  const atBuild = reads;
  expect(tag.maxSpeed).toBe(12);
  const afterFirst = reads;
  expect(afterFirst - atBuild).toBe(vectors.length);          // one pass
  expect([tag.nonzeroCount, tag.invalidCount, tag.validZeroCount, tag.minSpeed]).toEqual([2, 2, 1, 0]);
  expect(reads).toBe(afterFirst);                              // cached
  expect(JSON.parse(JSON.stringify(tag))).toMatchObject({ nonzeroCount: 2, maxSpeed: 12 });
});

test('the HUD compare fields are the same lazy or eager, and so is the census', () => {
  const lazy = buildTruthTag(payload(VECS.slice()), 's');
  window.__RAW_DISABLE_TRUTH_TAG_LAZY_CENSUS__ = true;
  const eager = buildTruthTag(payload(VECS.slice()), 's');
  for (const k of ['dataHash', 'boundsHash', 'traceId', 'product_id', 'model', 'layer', 'valid_time', 'vectorCount']) {
    expect(lazy[k]).toEqual(eager[k]);
  }
  for (const k of ['nonzeroCount', 'invalidCount', 'validZeroCount', 'minSpeed', 'maxSpeed']) expect(lazy[k]).toEqual(eager[k]);
  expect(Object.getOwnPropertyDescriptor(eager, 'maxSpeed').get).toBeUndefined();   // killed: plain values, as before
});
