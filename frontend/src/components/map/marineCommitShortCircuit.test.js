/**
 * §7g-β commit short-circuit goldens (2026-07-14). Every check in
 * shouldShortCircuitSameProductCommit is provability-load-bearing: a wrongly-passed skip pins a
 * stale texture (the exact failure that FALSIFIED the §4.5 encode dedup), a wrongly-failed skip
 * costs one redundant upload. So the suite is dominated by "must NOT skip" cases.
 */
import { shouldShortCircuitSameProductCommit } from './marineCommitShortCircuit';

const RUN = '2026-07-14T06:00:00Z';
const VALID = '2026-07-14T12:00:00Z';
const PID = 'gfs_marine_waves_global_mid_20260714T120000Z.json';

function makeGrid({
  west = -85, south = 20, east = -65, north = 36, cols = 21, rows = 17,
  productId = PID, run_time = RUN, validTime = VALID,
  ratingMode = false, stale = false, model = 'GFS', layer = 'waves',
} = {}) {
  return {
    vectors: new Array(cols * rows).fill({ speed: 1 }),
    bounds: { west, south, east, north },
    cols, rows,
    productId, run_time, validTime,
    ratingMode, stale,
    __sourceModel: model, __componentLayer: layer,
    renderable: true,
  };
}

// Resident: committed + ledger-agreed. Incoming: a smaller clip of the same product
// (same ~1°/cell spacing), fully inside the resident.
function fixture(prevOver = {}, inOver = {}) {
  const prev = { grid: makeGrid(prevOver), hourOffset: 3, __committedSig: 'sig-resident' };
  const incoming = {
    grid: makeGrid({ west: -80, south: 24, east: -70, north: 32, cols: 11, rows: 9, ...inOver }),
    hourOffset: 3,
  };
  return { disabled: false, prev, incoming, lastCommittedSig: 'sig-resident' };
}

describe('shouldShortCircuitSameProductCommit — §7g-β', () => {
  it('SKIPS a contained same-product/run/hour clip (the churn case), with telemetry detail', () => {
    const res = shouldShortCircuitSameProductCommit(fixture());
    expect(res).toBeTruthy();
    expect(res.productId).toBe(PID);
    expect(res.residentDims).toBe('21x17');
    expect(res.incomingDims).toBe('11x9');
  });

  it('kill switch disables the skip', () => {
    expect(shouldShortCircuitSameProductCommit({ ...fixture(), disabled: true })).toBe(false);
  });

  it('does NOT skip when productId differs or is missing on either side', () => {
    expect(shouldShortCircuitSameProductCommit(fixture({}, { productId: 'other_product' }))).toBe(false);
    expect(shouldShortCircuitSameProductCommit(fixture({}, { productId: null }))).toBe(false);
    expect(shouldShortCircuitSameProductCommit(fixture({ productId: null }))).toBe(false);
  });

  it('does NOT skip on a fresher run_time (re-ingested product, same id) — the data-revision check', () => {
    expect(shouldShortCircuitSameProductCommit(
      fixture({}, { run_time: '2026-07-14T12:00:00Z' }))).toBe(false);
  });

  it('does NOT skip when run_time is missing on either side (paths without the carry never skip)', () => {
    expect(shouldShortCircuitSameProductCommit(fixture({}, { run_time: null }))).toBe(false);
    expect(shouldShortCircuitSameProductCommit(fixture({ run_time: null }))).toBe(false);
  });

  it('reads run_time from the wrapper when the grid lacks it (series-frame shape)', () => {
    const f = fixture({ run_time: null });
    f.prev.run_time = RUN;
    expect(shouldShortCircuitSameProductCommit(f)).toBeTruthy();
  });

  it('does NOT skip across hours or validTimes', () => {
    const f = fixture();
    f.incoming.hourOffset = 6;
    expect(shouldShortCircuitSameProductCommit(f)).toBe(false);
    expect(shouldShortCircuitSameProductCommit(
      fixture({}, { validTime: '2026-07-14T15:00:00Z' }))).toBe(false);
  });

  it('does NOT skip on ratingMode or stale-flag mismatch', () => {
    expect(shouldShortCircuitSameProductCommit(fixture({}, { ratingMode: true }))).toBe(false);
    expect(shouldShortCircuitSameProductCommit(fixture({ stale: true }))).toBe(false);
  });

  it('does NOT skip when the incoming clip pokes past the resident (pan off the edge)', () => {
    expect(shouldShortCircuitSameProductCommit(
      fixture({}, { west: -90, east: -70 }))).toBe(false);
  });

  it('does NOT skip a finer-sampled incoming clip (resolver subsampling upgrade)', () => {
    // Same window as the base incoming but ~2× the cell density.
    expect(shouldShortCircuitSameProductCommit(
      fixture({}, { cols: 21, rows: 17 }))).toBe(false);
  });

  it('does NOT skip when the ledger was nulled or diverged (recovery hatches force re-commits)', () => {
    expect(shouldShortCircuitSameProductCommit(
      { ...fixture(), lastCommittedSig: null })).toBe(false);
    expect(shouldShortCircuitSameProductCommit(
      { ...fixture(), lastCommittedSig: 'sig-other' })).toBe(false);
    const f = fixture();
    delete f.prev.__committedSig;
    expect(shouldShortCircuitSameProductCommit(f)).toBe(false);
  });

  it('does NOT skip across model or layer', () => {
    expect(shouldShortCircuitSameProductCommit(fixture({}, { model: 'ICON' }))).toBe(false);
    expect(shouldShortCircuitSameProductCommit(fixture({}, { layer: 'swell_1' }))).toBe(false);
  });

  it('does NOT skip degenerate or empty grids', () => {
    expect(shouldShortCircuitSameProductCommit(fixture({}, { cols: 1, rows: 1 }))).toBe(false);
    const f = fixture();
    f.incoming.grid.vectors = [];
    expect(shouldShortCircuitSameProductCommit(f)).toBe(false);
    expect(shouldShortCircuitSameProductCommit({ disabled: false, prev: null, incoming: f.incoming, lastCommittedSig: 'x' })).toBe(false);
  });

  it('handles antimeridian-wrapped containment (resident wraps, incoming inside the wrap)', () => {
    const res = shouldShortCircuitSameProductCommit(fixture(
      { west: 170, east: -170, cols: 21 },              // 20° wide across the antimeridian
      { west: 175, east: -175, cols: 11, rows: 9 },     // 10° wide, inside it
    ));
    expect(res).toBeTruthy();
  });
});
