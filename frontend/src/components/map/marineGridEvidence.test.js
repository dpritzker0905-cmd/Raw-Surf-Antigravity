import { captureMarineGridEvidence, GRID_VECTOR_COLUMNS } from './marineGridEvidence';
const store = () => ({ grids: [], gridObjects: new WeakSet(), gridsSeen: 0, gridsDropped: 0, gridVectorsCaptured: 0 });
const grid = () => ({ bounds: { west: 0, south: 0, east: 1, north: 1 }, cols: 2, rows: 2,
  vectors: [ { lng: 0, lat: 0, height: 1, period: 9, direction: 270, isOcean: true } ],
  model_run_time: '2026-09-11T06:00:00Z', served_valid_time: '2026-09-11T12:00:00Z' });

it('copies every value with a schema and stable identity without retaining mutable inputs', () => {
  const s = store(), g = grid();
  captureMarineGridEvidence(s, g, 7);
  const captured = s.grids[0];
  expect(captured.complete).toBe(true);
  expect(captured.columns).toEqual(GRID_VECTOR_COLUMNS);
  expect(captured.id).toBe(7);
  g.vectors[0].height = 99; g.bounds.east = 8; g.model_run_time = 'changed';
  expect(captured.vectors[0][GRID_VECTOR_COLUMNS.indexOf('height')]).toBe(1);
  expect(captured.bounds[2]).toBe(1);
  expect(captured.identity.model_run_time).toBe('2026-09-11T06:00:00Z');
  captureMarineGridEvidence(s, g, 7);
  expect(s.grids).toHaveLength(1);
  expect(s.gridVectorsCaptured).toBe(1);
});
it('marks missing vectors and budget exhaustion as incomplete instead of sampling them', () => {
  const s = store(); s.gridVectorsCaptured = 50000;
  captureMarineGridEvidence(s, grid(), 1);
  expect(s.grids[0]).toMatchObject({ complete: false, reason: 'vector-budget', vectors: null });
  const g = grid(); delete g.vectors;
  captureMarineGridEvidence(s, g, 2);
  expect(s.grids[1]).toMatchObject({ complete: false, reason: 'missing-vectors', vectors: null });
});
it('records dropped grids after the independent grid-count cap', () => {
  const s = store();
  for (let i = 0; i < 35; i++) captureMarineGridEvidence(s, grid(), i);
  expect(s.grids).toHaveLength(32);
  expect(s.gridsSeen).toBe(35);
  expect(s.gridsDropped).toBe(3);
});
it('does not retain malformed structured provenance as a raw object', () => {
  const s = store(), g = grid();
  g.model_run_time = { unexpected: ['large input'] };
  captureMarineGridEvidence(s, g, 1);
  expect(s.grids[0].identity.model_run_time).toBeNull();
});
