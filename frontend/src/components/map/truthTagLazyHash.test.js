// 2026-11-11 (layer animation lane): the truth tag's dataHash and traceId are computed on first read, not at build, so a series
// page that mints 48 tags hashes only the frames that are committed, compared or serialised. Same values lazy or eager.
import { buildTruthTag, computeJsDataHash, computeJsTraceId } from './weatherTruthTracker';

const vec = (speed, extra = {}) => ({ lat: 1.25, lng: -70.5, speed, direction: 0, u: speed, v: 0, is_valid: true, ...extra });
const VECS = [vec(0), vec(3.5), vec(12.25), vec(7, { is_valid: false })];
const payload = (vectors) => ({ model: 'GFS', domain: 'wind', layer: 'wind', valid_time: '2026-11-11T06:00:00Z', product_id: 'p',
  grid: { cols: vectors.length, rows: 1, bounds: { west: 0, south: 0, east: 1, north: 1 }, vectors } });
const watch = (vectors) => {
  const w = { reads: 0 };
  w.vectors = new Proxy(vectors, { get(t, k) { if (/^\d+$/.test(String(k))) w.reads += 1; return t[k]; } });
  return w;
};

afterEach(() => { delete window.__RAW_DISABLE_TRUTH_TAG_LAZY_HASH__; });

test('lazy: building a tag reads no vector; the first read of dataHash walks them once and is cached', () => {
  const w = watch(VECS.slice());
  const tag = buildTruthTag(payload(w.vectors), 'seriesFrameMint');
  expect(w.reads).toBe(0);
  const hash = tag.dataHash;
  expect(w.reads).toBe(VECS.length);
  expect(tag.dataHash).toBe(hash);
  expect(typeof tag.traceId).toBe('string');
  expect(w.reads).toBe(VECS.length);
});

test('48 tags minted, one read: one frame hashed (the series page case)', () => {
  const frames = Array.from({ length: 48 }, () => watch(VECS.map((v) => ({ ...v }))));
  const tags = frames.map((f) => buildTruthTag(payload(f.vectors), 'seriesFrameMint'));
  expect(frames.reduce((n, f) => n + f.reads, 0)).toBe(0);
  expect(tags[7].traceId).toMatch(/^[0-9a-f]{8}$/);
  expect(frames.filter((f) => f.reads > 0)).toHaveLength(1);
});

test('the same values lazy or eager, in the same key order, and the kill restores plain values', () => {
  const lazy = buildTruthTag(payload(VECS.slice()), 's');
  window.__RAW_DISABLE_TRUTH_TAG_LAZY_HASH__ = true;
  const w = watch(VECS.slice());
  const eager = buildTruthTag(payload(w.vectors), 's');
  expect(w.reads).toBe(VECS.length);                                              // killed: hashed at build, as before
  expect(Object.getOwnPropertyDescriptor(eager, 'dataHash').get).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(eager, 'traceId').get).toBeUndefined();
  expect(Object.keys(lazy)).toEqual(Object.keys(eager));
  expect(lazy.dataHash).toBe(eager.dataHash);
  expect(lazy.traceId).toBe(eager.traceId);
  expect(lazy.dataHash).toBe(computeJsDataHash(VECS.slice(), 'wind'));
  expect(lazy.traceId).toBe(computeJsTraceId('GFS', 'wind', 'wind', '2026-11-11T06:00:00Z', '0.00,0.00,1.00,1.00', lazy.dataHash));
  const strip = (t) => { const o = JSON.parse(JSON.stringify(t)); delete o.createdAt; return o; };
  expect(strip(lazy)).toEqual(strip(eager));                                      // a serialised tag is the same record
});

test('a spread copies the values, and both fields stay assignable', () => {
  const tag = buildTruthTag(payload(VECS.slice()), 's');
  const copy = { ...tag, cols: 2 };
  expect(copy.dataHash).toBe(tag.dataHash);
  expect(Object.getOwnPropertyDescriptor(copy, 'dataHash').get).toBeUndefined();
  tag.traceId = 'abc'; tag.dataHash = 'def';
  expect([tag.traceId, tag.dataHash]).toEqual(['abc', 'def']);
});

test('a seeded content hash is still honoured (the static-frame path)', () => {
  const vectors = VECS.slice();
  vectors.__jsDataHash_wind = 'feedbeef';
  expect(buildTruthTag(payload(vectors), 'staticFrame').dataHash).toBe('feedbeef');
});
