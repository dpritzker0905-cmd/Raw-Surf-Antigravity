import { beginCoarseBaseSnapshot, finishCoarseBaseSnapshot, canReuseCoarseBase, MAX_COARSE_SNAPSHOT_CELLS } from './marineCoarseBaseSnapshot';

const grid = () => ({ cols: 3, rows: 2, bounds: { west: -180, south: -80, east: 180, north: 80 },
  vectors: [-80, 80].flatMap(lat => [-180, 0, 180].map(lng => ({ lng, lat }))),
  __sourceModel: 'GFS', __componentLayer: 'waves', hourOffset: 0, ratingMode: false, is_estimated: false,
  model_run_time: '2026-09-11T12:00:00Z', model_run_time_status: 'known', served_valid_time: '2026-09-12T00:00:00Z',
  upstream_provider: 'noaa', source_dataset: 'ncep_gfswave025', frame_offset_hours: 0, frame_substituted: false });
const fields = () => [...Array.from({ length: 6 }, (_, i) => new Float32Array(6).fill(i + 1)), null, null];
const packed = () => [...Array.from({ length: 4 }, (_, i) => new Uint8Array(24).fill(i + 1)), null];
function encode(g = grid(), f = fields(), p = packed()) {
  return { __key: 'shape', u_waveTexture: {}, coarseSnapshot: finishCoarseBaseSnapshot(beginCoarseBaseSnapshot(g, f), p) };
}
const reuse = (a, b) => canReuseCoarseBase(a, b, 'shape');

it('reuses an independently copied identical encoded field, including the same geometry key', () => {
  expect(reuse(encode(), encode())).toBe(true);
  expect(canReuseCoarseBase(encode(), encode(), 'other-shape')).toBe(false);
});

it.each(Object.entries({ model_run_time: '2026-09-11T18:00:00Z', served_valid_time: '2026-09-12T03:00:00Z',
  model_run_time_status: 'unknown', upstream_provider: 'other', source_dataset: 'other', is_estimated: true,
  __upstreamProvider: 'other', __sourceDataset: 'other', __sourceModel: 'ICON', __componentLayer: 'swell_1',
  hourOffset: 1, ratingMode: true, frame_offset_hours: 1, frame_substituted: true }))('refreshes when %s changes', (key, value) => {
  expect(reuse(encode(), encode({ ...grid(), [key]: value }))).toBe(false);
});

it('ignores ingestion bookkeeping, normalizes equivalent zoned instants and keeps explicit unknowns distinct', () => {
  const g = grid(); g.ingested_at = '2026-09-12T01:00:00Z'; g.model_run_time = '2026-09-11T08:00:00-04:00';
  expect(reuse(encode(), encode(g))).toBe(true);
  expect(reuse(encode(), encode({ ...g, model_run_time: null }))).toBe(false);
  expect(reuse(encode(), encode({ ...g, model_run_time: '2026-09-11T12:00:00' }))).toBe(false);
});

it.each([0, 1, 2, 3, 4, 5, 6, 7])('detects changes in resolved field %i, including masks/confidence and optional fields', i => {
  const f = fields(); if (f[i] === null) f[i] = new Float32Array(6);
  f[i][3] += .01;
  expect(reuse(encode(), encode(grid(), f))).toBe(false);
});

it.each([0, 1, 2, 3, 4])('detects changed packed texture %i despite equal pre-extrapolation fields', i => {
  const p = packed(); if (p[i] === null) p[i] = new Uint8Array(24);
  p[i][3]++;
  expect(reuse(encode(), encode(grid(), fields(), p))).toBe(false);
});

it('copies fields, bytes, coordinates and identity rather than trusting mutable inputs', () => {
  const g = grid(), f = fields(), p = packed(), old = encode(g, f, p);
  g.model_run_time = '2026-09-11T18:00:00Z'; g.vectors[0].lng += 1; f[0][0] = 3; p[0][0] = 9;
  expect(reuse(old, encode())).toBe(true);
  expect(reuse(old, encode(g, f, p))).toBe(false);
});

it('rejects coordinate and bounds changes even when dimensions and pixels are identical', () => {
  const g = grid(); g.vectors[2].lat += .25;
  expect(reuse(encode(), encode(g))).toBe(false);
  const h = grid(); h.bounds.north -= 1;
  expect(reuse(encode(), encode(h))).toBe(false);
});

it('refuses reuse without a complete, authentic snapshot or actual wave texture', () => {
  const a = encode();
  for (const coarseSnapshot of [null, {}, beginCoarseBaseSnapshot(grid(), fields())]) {
    expect(reuse(a, { ...a, coarseSnapshot })).toBe(false);
  }
  expect(reuse({ ...a, u_waveTexture: null }, a)).toBe(false);
  expect(reuse(null, a)).toBe(false);
});

it('disables reuse for regional, oversized, incomplete, nonfinite or invalid inputs', () => {
  const a = grid(); a.bounds.east = 10;
  const b = grid(); b.rows = MAX_COARSE_SNAPSHOT_CELLS;
  const c = grid(); c.vectors.pop();
  const d = grid(); d.vectors[0].lng = NaN;
  for (const g of [null, a, b, c, d, { ...grid(), cols: 2.5 }]) expect(beginCoarseBaseSnapshot(g, fields())).toBeNull();
  const f = fields(); f[0][0] = Infinity;
  expect(beginCoarseBaseSnapshot(grid(), f)).toBeNull();
  expect(beginCoarseBaseSnapshot(grid(), fields().slice(1))).toBeNull();
  expect(finishCoarseBaseSnapshot(beginCoarseBaseSnapshot(grid(), fields()), [])).toBeNull();
});
