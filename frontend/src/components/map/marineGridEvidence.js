import { copyMarineFrameProvenance } from './marineFrameProvenance';

export const GRID_VECTOR_COLUMNS = ['lng', 'lat', 'u', 'v', 'speed', 'height', 'period', 'direction', 'isOcean', 'dirConfidence', 'phys_speed'];
const scalar = value => ['string', 'number', 'boolean'].includes(typeof value) ? value : null;

// Opt-in scalar copies, once per grid object. No raw object/texture retention and no value sampling:
// an incomplete capture is explicitly marked, never presented as a complete field comparison.
export function captureMarineGridEvidence(store, grid, gridId) {
  if (store.gridObjects.has(grid)) return;
  store.gridObjects.add(grid);
  store.gridsSeen++;
  if (store.grids.length >= 32) { store.gridsDropped++; return; }
  const b = grid.bounds;
  const identity = { ...Object.fromEntries(Object.entries(copyMarineFrameProvenance(grid)).map(([key, value]) => [key, scalar(value)])),
    model: scalar(grid.__sourceModel), layer: scalar(grid.__componentLayer),
    provider: scalar(grid.provider), gridProvider: scalar(grid.__gridProvider),
    productId: scalar(grid.productId), hourOffset: scalar(grid.hourOffset),
    valid_time: scalar(grid.valid_time), run_time: scalar(grid.run_time),
    rating: !!grid.ratingMode, estimated: !!grid.is_estimated,
    coverage: scalar(grid.coverage_scope),
  };
  const snapshot = { id: gridId, capturedAt: performance.now(), identity,
    bounds: b ? [b.west, b.south, b.east, b.north] : null,
    cols: grid.cols ?? null, rows: grid.rows ?? null, columns: GRID_VECTOR_COLUMNS,
    complete: false, vectors: null };
  store.grids.push(snapshot);
  if (!Array.isArray(grid.vectors)) { snapshot.reason = 'missing-vectors'; return; }
  snapshot.vectorCount = grid.vectors.length;
  if (grid.vectors.length > 50000 - store.gridVectorsCaptured) {
    snapshot.reason = 'vector-budget'; return;
  }
  snapshot.vectors = grid.vectors.map(vector => GRID_VECTOR_COLUMNS.map(key => scalar(vector && vector[key])));
  snapshot.complete = true;
  store.gridVectorsCaptured += grid.vectors.length;
}
