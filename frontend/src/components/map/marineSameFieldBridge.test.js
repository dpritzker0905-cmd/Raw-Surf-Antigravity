import { sameFieldSubcover } from './marineSameFieldBridge';
import { shouldBridgeToCoarseGlobal, shouldRejectSubcoveringRegional, decideMarineCommit } from './marineCommitGate';
import { arbiterDecide } from './marineCommitArbiter';

const wide = [-89, 19, -71, 39], narrow = [-83, 27, -79, 30];
const clone = v => JSON.parse(JSON.stringify(v));
function grid(west, south, east, north, step = 2) {
  const cols = (east - west) / step + 1, rows = (north - south) / step + 1;
  return { cols, rows, bounds: { west, south, east, north }, __sourceModel: 'GFS', __componentLayer: 'waves',
    hourOffset: 0, ratingMode: false, is_estimated: false, __renderable: true,
    model_run_time: '2026-09-10T12:00:00Z', model_run_time_status: 'known', served_valid_time: '2026-09-12T00:00:00Z',
    frame_offset_hours: 0, frame_substituted: false, upstream_provider: 'noaa', source_dataset: 'ncep_gfswave025',
    vectors: Array.from({ length: cols * rows }, (_, i) => ({ lng: west + i % cols * step,
      lat: south + Math.floor(i / cols) * step, u: .2, v: .3, height: 2, period: 8,
      dirConfidence: .9, waves: { is_valid: true } })) };
}
const pair = () => [grid(-84, 26, -76, 32), grid(-180, -78, 180, 84)];
function check(r, g, expected, viewport = wide, win = {}) {
  expect(shouldBridgeToCoarseGlobal(r, g, 5.5, viewport, win)).toBe(expected);
  expect(shouldRejectSubcoveringRegional(g, r, 5.5, viewport, false, win)).toBe(expected);
  for (const arbiter of [false, true]) {
    expect(decideMarineCommit(g, r, 5.5, viewport, { ...win, __RAW_MARINE_ARBITER__: arbiter }).reject).toBe(expected);
  }
  expect(arbiterDecide(g, r, { zoom: 5.5, viewportBounds: viewport }).verdict === 'reject').toBe(expected);
}

it('coordinates both directions and the arbiter, then releases the pending crop on zoom back', () => {
  const [r, g] = pair(); check(r, g, true);
  for (let i = 0; i < 3; i++) check(clone(r), g, true);
  check(r, g, false, narrow);
  expect(decideMarineCommit(r, g, 9, narrow, {}).reject).toBe(true);
});

it.each(Object.entries({ model_run_time: '2026-09-10T18:00:00Z', served_valid_time: '2026-09-12T03:00:00Z',
  model_run_time_status: 'unknown', upstream_provider: 'other', source_dataset: 'other', __sourceModel: 'ICON',
  __componentLayer: 'swell_1', hourOffset: 3, ratingMode: true, is_estimated: true, frame_offset_hours: 1,
  frame_substituted: true, __upstreamProvider: 'conflict', __sourceDataset: 'conflict' }))('does not reject a changed %s', (k, v) => {
  const [r, g] = pair(); r[k] = v; check(r, g, false);
});

it.each(['model_run_time', 'served_valid_time', 'model_run_time_status', 'upstream_provider', 'source_dataset',
  '__sourceModel', '__componentLayer', 'hourOffset', 'ratingMode', 'is_estimated', 'frame_offset_hours', 'frame_substituted'])(
  'does not manufacture missing %s even when both sides omit it', k => {
  const [r, g] = pair(); delete r[k]; delete g[k]; check(r, g, false);
});

it('keeps run and served time separate but accepts equivalent zoned instants and adapter aliases', () => {
  const [r, g] = pair(); r.model_run_time = '2026-09-10T08:00:00-04:00';
  r.__upstreamProvider = r.upstream_provider; delete r.upstream_provider;
  r.__sourceDataset = r.source_dataset; delete r.source_dataset;
  r.ingested_at = '2026-09-12T01:00:00Z'; check(r, g, true);
  r.model_run_time = r.served_valid_time; check(r, g, false);
});

it('rejects ambiguous timestamps and conflicting explicit source fields', () => {
  for (const k of ['model_run_time', 'served_valid_time']) {
    const [r, g] = pair(); r[k] = g[k] = '2026-09-12T00:00:00'; check(r, g, false);
  }
  const [r, g] = pair(); r.upstream_provider = ''; r.__upstreamProvider = 'noaa'; check(r, g, false);
});

it.each(['u', 'v', 'height', 'period', 'dirConfidence'])('detects a one-cell %s perturbation on either grid', k => {
  for (const side of ['regional', 'global']) {
    const [r, g] = pair(); const node = side === 'regional' ? r.vectors[0] : g.vectors.find(v => v.lng === -84 && v.lat === 26);
    node[k] += .1; check(r, g, false);
  }
});

it('shares the real waves validity and confidence alias precedence with the encoder', () => {
  const [r, g] = pair(); r.vectors[0].waves.is_valid = false; check(r, g, false);
  r.vectors[0].isOcean = true; check(r, g, true);
  const v = r.vectors[0]; delete v.dirConfidence; v.waves.dir_confidence = .9; check(r, g, true);
  v.waves.dir_confidence = .8; check(r, g, false);
});

it('reads active sublayer fields and refuses finer grids even with numerically equal samples', () => {
  const [r, g] = pair();
  for (const x of [r, g]) { x.__componentLayer = 'swell_1'; for (const v of x.vectors) v.swell_1 = { ...v }; }
  check(r, g, true); r.vectors[0].swell_1.height = 3; check(r, g, false);
  check(grid(-84, 26, -76, 32, 1), pair()[1], false);
});

it.each(['count', 'bounds', 'duplicate', 'order', 'spacing', 'offset', 'nonfinite', 'outside', 'oversize'])(
  'refuses a malformed or mismatched %s lattice', kind => {
  const [r, g] = pair();
  if (kind === 'count') r.vectors.pop();
  if (kind === 'bounds') r.bounds.east += 1;
  if (kind === 'duplicate') r.vectors[1] = r.vectors[0];
  if (kind === 'order') g.vectors.reverse();
  if (kind === 'spacing') r.rows = 3;
  if (kind === 'offset') { r.bounds.west += .5; r.bounds.east += .5; r.vectors.forEach(v => { v.lng += .5; }); }
  if (kind === 'nonfinite') r.vectors[0].u = NaN;
  if (kind === 'outside') r.bounds.south = -85;
  if (kind === 'oversize') g.rows = 50001; // Keep longitude resolution fixed; isolate the new cap.
  check(r, g, false);
});

it('has no stale grid-identity cache', () => {
  const [r, g] = pair(); check(r, g, true); r.vectors[0].height = 9; check(r, g, false);
  r.vectors[0].height = 2; check(r, g, true); g.model_run_time_status = 'unknown'; check(r, g, false);
});

it('requires the replacement global to cover the viewport too, matching arbiter release priority', () => {
  const [r, g] = pair();
  expect(sameFieldSubcover(r, g, 5.5, [-89, 82, -71, 90])).toBe(false);
  for (const arbiter of [false, true]) expect(decideMarineCommit(g, r, 5.5, [-89, 82, -71, 90],
    { __RAW_MARINE_ARBITER__: arbiter }).reject).toBe(false);
});

it('preserves operator kills in both modes and the shared coverage lever', () => {
  const [r, g] = pair();
  for (const kill of ['__RAW_DISABLE_ZOOMOUT_BRIDGE__', '__RAW_DISABLE_SUBCOVER_REJECT__', '__RAW_DISABLE_NO_DOWNGRADE__']) {
    const win = { [kill]: true };
    expect(shouldBridgeToCoarseGlobal(r, g, 5.5, wide, win)).toBe(false);
    for (const arbiter of [false, true]) expect(decideMarineCommit(g, r, 5.5, wide, { ...win, __RAW_MARINE_ARBITER__: arbiter }).reject).toBe(false);
  }
  expect(shouldBridgeToCoarseGlobal(r, g, 5.5, wide, { __RAW_DOWNGRADE_COVER_FRAC__: .1 })).toBe(false);
  expect(decideMarineCommit(g, r, 5.5, wide, { __RAW_MARINE_ARBITER__: true, __RAW_DOWNGRADE_COVER_FRAC__: .1 }).reject).toBe(false);
});

it('leaves historical wide-world decisions in force without equivalence and fails closed for unknown new-exception inputs', () => {
  const [r, g] = pair(); r.model_run_time_status = 'unknown'; check(r, g, true, [-140, 0, -20, 70]);
  for (const viewport of [null, [0, 0, 0, 0], [NaN, 0, 18, 20]]) expect(sameFieldSubcover(r, g, 5.5, viewport)).toBe(false);
  expect(sameFieldSubcover(...pair(), undefined, wide)).toBe(false);
});
