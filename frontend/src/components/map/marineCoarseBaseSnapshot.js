// Coarse-cache reuse must describe the encoded textures, not mutable grid objects or shape alone.
// Copies are private and bounded; scratch buffers are overwritten by the very next encode.
import { isCoarseGlobalGrid } from './marineEngineDecisions';

const snapshots = new WeakMap();
export const MAX_COARSE_SNAPSHOT_CELLS = 50000;
const scalar = value => ['string', 'boolean'].includes(typeof value) ||
  (typeof value === 'number' && Number.isFinite(value)) ? value : null;
const time = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : scalar(value);

function identity(grid) {
  // Ingestion is observational bookkeeping; cycle and actual served time are separate axes.
  // Preserve both explicit and adapter source fields so conflicts cannot silently authorize reuse.
  return JSON.stringify([
    grid.__sourceModel || 'GFS', grid.__componentLayer || 'waves', scalar(grid.hourOffset),
    scalar(grid.ratingMode), scalar(grid.is_estimated), scalar(grid.model_run_time_status),
    time(grid.model_run_time), time(grid.served_valid_time),
    scalar(grid.frame_offset_hours), scalar(grid.frame_substituted),
    scalar(grid.upstream_provider), scalar(grid.source_dataset),
    scalar(grid.__upstreamProvider), scalar(grid.__sourceDataset),
  ]);
}

function copyFinite(values, length) {
  if (!ArrayBuffer.isView(values) || typeof values.slice !== 'function' || values.length !== length) return null;
  for (let i = 0; i < length; i++) if (!Number.isFinite(values[i])) return null;
  return values.slice();
}

// Only coarse global encodes participate in this cache. Invalid/oversize inputs disable reuse;
// they do not prevent the existing encoder or last-good replacement policy from operating.
export function beginCoarseBaseSnapshot(grid, fields) {
  if (!grid || !isCoarseGlobalGrid(grid)) return null;
  const { cols, rows, vectors, bounds } = grid;
  const count = cols * rows;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 ||
      count > MAX_COARSE_SNAPSHOT_CELLS || vectors?.length !== count || fields?.length !== 8) return null;
  const extent = [bounds.west, bounds.south, bounds.east, bounds.north];
  if (!extent.every(Number.isFinite)) return null;
  const coordinates = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(vectors[i]?.lng) || !Number.isFinite(vectors[i]?.lat)) return null;
    coordinates[i * 2] = vectors[i].lng; coordinates[i * 2 + 1] = vectors[i].lat;
  }
  const copied = fields.map((values, i) => i >= 6 && values === null ? null : copyFinite(values, count));
  if (copied.some((values, i) => values === null && (i < 6 || fields[i] !== null))) return null;
  const token = Object.freeze({ cells: count });
  snapshots.set(token, { identity: identity(grid), geometry: JSON.stringify([cols, rows, ...extent]),
    coordinates, fields: copied, packed: null });
  return token;
}

// Finalize only after successful upload. Include actual packed bytes, so encoder-policy/geo-data
// changes also defeat reuse even when the pre-extrapolation weather inputs are identical.
export function finishCoarseBaseSnapshot(token, buffers) {
  const snapshot = token && snapshots.get(token);
  if (!snapshot || snapshot.packed || buffers?.length !== 5) return null;
  const copied = buffers.map((values, i) => i === 4 && values === null ? null : copyFinite(values, token.cells * 4));
  if (copied.some((values, i) => values === null && (i < 4 || buffers[i] !== null))) return null;
  snapshot.packed = copied;
  return token;
}

function equalArray(a, b) {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function canReuseCoarseBase(base, encoded, key) {
  if (!base?.u_waveTexture || base.__key !== key) return false;
  const a = base.coarseSnapshot && snapshots.get(base.coarseSnapshot);
  const b = encoded?.coarseSnapshot && snapshots.get(encoded.coarseSnapshot);
  if (!a?.packed || !b?.packed || a.identity !== b.identity || a.geometry !== b.geometry) return false;
  return equalArray(a.coordinates, b.coordinates) &&
    a.fields.every((field, i) => equalArray(field, b.fields[i])) &&
    a.packed.every((bytes, i) => equalArray(bytes, b.packed[i]));
}
