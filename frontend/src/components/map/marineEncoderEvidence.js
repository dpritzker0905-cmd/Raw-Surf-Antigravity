// Opt-in copies at the actual encoder boundary, before extrapolation/dilation changes the field.
// Never resolves masks itself or feeds a rendering decision. Missing capture stays explicit.
import { opacityGridIdentity } from './marineOpacityEvidence';
import { copyMarineFrameProvenance } from './marineFrameProvenance';

export const ENCODER_COLUMNS = ['lng', 'lat', 'u', 'v', 'height', 'period', 'ocean', 'confidence', 'motion', 'physicalHeight',
  'topOcean', 'topValid', 'activeOcean', 'activeValid', 'wavesOcean', 'wavesValid'];
const scalar = v => typeof v === 'number' ? (Number.isFinite(v) ? v : null)
  : typeof v === 'string' || typeof v === 'boolean' ? v : null;
const mask = v => v === undefined ? 'missing' : v === null || typeof v === 'boolean' ? v : 'invalid-type';

export function captureMarineEncoderEvidence(grid, standalone, fields) {
  if (typeof window === 'undefined' || window.__RAW_CAPTURE_OPACITY__ !== true) return;
  let store;
  try {
    store = window.__RAW_ENCODER_EVIDENCE__ || (window.__RAW_ENCODER_EVIDENCE__ = {
      schema: 1, stage: 'resolved-before-extrapolation', encodes: [], seen: 0, dropped: 0, cells: 0, errors: 0,
    });
    const seq = ++store.seen;
    if (store.encodes.length >= 64) { store.dropped++; return; }
    const layer = grid.__componentLayer || 'waves';
    const n = grid.cols * grid.rows;
    const snapshot = { seq, at: performance.now(), grid: opacityGridIdentity(grid), standalone,
      identity: Object.fromEntries(Object.entries(copyMarineFrameProvenance(grid)).map(([k, v]) => [k, scalar(v)])),
      route: grid.__fromSeries === true ? 'series' : null, commitLane: scalar(grid.__commitLane),
      hourOffset: scalar(grid.hourOffset), estimated: typeof grid.is_estimated === 'boolean' ? grid.is_estimated : null,
      productId: scalar(grid.productId), vectorCount: grid.vectors.length, cells: n,
      columns: ENCODER_COLUMNS, complete: false, values: null };
    store.encodes.push(snapshot);
    if (!Number.isSafeInteger(n) || n < 1 || n > 100000 - store.cells) { snapshot.reason = 'cell-budget-or-shape'; return; }
    snapshot.values = Array.from({ length: n }, (_, i) => {
      const v = grid.vectors[i], a = v && v[layer], w = v && v.waves;
      return [scalar(v?.lng), scalar(v?.lat), ...fields.map(f => f ? scalar(f[i]) : null),
        mask(v?.isOcean), mask(v?.is_valid), mask(a?.isOcean), mask(a?.is_valid), mask(w?.isOcean), mask(w?.is_valid)];
    });
    snapshot.complete = true;
    store.cells += n;
  } catch (_) { if (store) store.errors++; }
}
