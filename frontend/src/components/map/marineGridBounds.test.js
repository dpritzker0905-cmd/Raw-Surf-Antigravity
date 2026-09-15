import { trimDeadEdges } from './marineEngineDecisions';
import { alignMarineNodeBounds } from './marineGridBounds';
import fixture from './__fixtures__/marine-boot-grid.json';

const copy = value => JSON.parse(JSON.stringify(value));
const shape = grid => {
  expect(grid.vectors).toHaveLength(grid.cols * grid.rows);
  expect(new Set(grid.vectors.map(v => v.lng)).size).toBe(grid.cols);
  expect(new Set(grid.vectors.map(v => v.lat)).size).toBe(grid.rows);
  expect(grid.bounds).toEqual({ west: grid.vectors[0].lng, south: grid.vectors[0].lat,
    east: grid.vectors[grid.vectors.length - 1].lng, north: grid.vectors[grid.vectors.length - 1].lat });
};

test('captured boot grid keeps its real 64 values on an 8x8 lattice after trim', () => {
  const before = copy(fixture.grid);
  const actual = trimDeadEdges(before, {});
  shape(actual);
  expect([actual.cols, actual.rows]).toEqual([8, 8]);
  expect(actual.vectors).toEqual(fixture.expectedVectors);
  expect(before).toEqual(fixture.grid);
});

test('changing only requested endpoint bounds cannot change the trimmed field', () => {
  const grid = copy(fixture.grid);
  const aligned = { ...grid, bounds: fixture.nodeBounds };
  expect(trimDeadEdges(grid, {})).toEqual(trimDeadEdges(aligned, {}));
});

test('valid regular grids retain no-op identity and all metadata', () => {
  const g = { ...copy(fixture.grid), bounds: fixture.nodeBounds,
    vectors: fixture.grid.vectors.map(v => ({ ...v, speed: 1, isOcean: true })),
    model_run_time: '2026-09-11T06:00:00Z', served_valid_time: '2026-09-11T21:00:00Z' };
  expect(trimDeadEdges(g, {})).toBe(g);
});

test('the trim kill switch retains the unmodified grid', () => {
  const g = copy(fixture.grid);
  expect(trimDeadEdges(g, { __RAW_DISABLE_DEAD_EDGE_TRIM__: true })).toBe(g);
});

test('bounds repair preserves vector references, dimensions and provenance', () => {
  const g = { ...copy(fixture.grid), model_run_time: '2026-09-11T06:00:00Z', source_dataset: 'ncep_gfswave025' };
  const repaired = alignMarineNodeBounds(g);
  expect(repaired).toEqual({ ...g, bounds: fixture.nodeBounds });
  expect(repaired.vectors).toBe(g.vectors);
});

test.each([
  ['missing cell', g => g.vectors.pop()],
  ['duplicate cell', g => { g.vectors[1] = { ...g.vectors[0] }; }],
  ['nonuniform axis', g => { g.vectors[1].lng += 0.01; }],
  ['nonfinite coordinate', g => { g.vectors[1].lat = NaN; }],
  ['wrong row order', g => g.vectors.reverse()],
  ['unknown bounds', g => { g.bounds.east = NaN; }],
  ['fractional dimensions', g => { g.cols = 10.1; }],
])('does not guess a lattice with %s', (_label, mutate) => {
  const g = copy(fixture.grid);
  mutate(g);
  expect(alignMarineNodeBounds(g)).toBe(g);
});

test('wrapped grids retain their existing antimeridian path', () => {
  const g = { cols: 4, rows: 4, bounds: { west: 179, east: -178, south: 0, north: 3.1 },
    vectors: Array.from({ length: 16 }, (_, i) => ({ lng: [179, 180, -179, -178][i % 4], lat: Math.floor(i / 4) })) };
  expect(alignMarineNodeBounds(g)).toBe(g);
});

test('does not reclassify a world grid by inventing or dropping a seam column', () => {
  const g = { cols: 36, rows: 4, bounds: { west: -180, east: 180, south: 0, north: 3 },
    vectors: Array.from({ length: 144 }, (_, i) => ({ lng: -180 + (i % 36) * 10, lat: Math.floor(i / 36) })) };
  expect(alignMarineNodeBounds(g)).toBe(g);
});
