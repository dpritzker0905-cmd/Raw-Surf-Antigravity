/**
 * The finer-resident hold compares the MODEL CYCLE, not our ingest stamp (2026-11-09, live dev at 59e51fb5): on ICON wind_waves
 * activation the 181x83 world frame (run_time 12:11:11Z) was released over the 13x17 regional grid (run_time 13:23:19Z) with reason
 * "run", although both were model_run_time 00Z, valid 18Z. These pin the rule: a shared zoned cycle decides; otherwise run_time.
 */
import { finerResidentHoldDecision } from './marineFinerResidentHold';

const VEC = [{ lat: 28, lng: -80, speed: 0.4, u: 0.1, v: -0.1, direction: 54, period: 1.45 }];
const VALID = '2026-11-09T18:00:00Z';
const CYCLE = '2026-11-09T00:00:00Z';
const VIEW = { west: -80.9, south: 27.8, east: -80.0, north: 28.8 };          // z9 FL east coast
const REGIONAL_B = { west: -82, south: 26, east: -79, north: 30 };           // the live 13x17 tile
const WORLD_B = { west: -180, south: -80, east: 180, north: 86 };            // the 181x83 world frame

const mk = (cols, rows, bounds, grid = {}, top = {}) => ({
  hourOffset: 0, ...top,
  grid: { vectors: VEC, cols, rows, bounds, hourOffset: 0, validTime: VALID, renderable: true,
    __sourceModel: 'ICON', __componentLayer: 'wind_waves', ...grid },
});
const regional = (grid = {}, top = {}) => mk(13, 17, REGIONAL_B, { run_time: '2026-11-09T13:23:19Z', model_run_time: CYCLE, ...grid }, top);
const world = (grid = {}, top = {}) => mk(181, 83, WORLD_B, { run_time: '2026-11-09T12:11:11Z', model_run_time: CYCLE, ...grid }, top);
const decide = (prev, incoming, extra = {}) => finerResidentHoldDecision({ prev, incoming, viewport: VIEW, liveViewport: VIEW, ...extra });

describe('the hold judges "a new run" by the model cycle, not the ingest stamp', () => {
  test('the live case: same 00Z cycle, two ingest stamps, world over regional at z9 is HELD', () => {
    const d = decide(regional(), world());
    expect(d.hold).toBe(true);
    expect(d.detail).toMatchObject({ world: true, residentDims: '13x17', incomingDims: '181x83' });
  });

  test('a regional re-ingest of the same cycle (same-size clip) is held too', () => {
    expect(decide(regional(), regional({ run_time: '2026-11-09T15:02:44Z' })).hold).toBe(true);
  });

  test('a NEWER cycle releases even when the ingest stamps match', () => {
    const inc = world({ model_run_time: '2026-11-09T06:00:00Z', run_time: '2026-11-09T13:23:19Z' });
    expect(decide(regional(), inc)).toEqual({ hold: false, reason: 'run' });
  });

  test('the cycle is read from truthTag or __readoutModelRun when the grid has no model_run_time', () => {
    const viaTag = world({ model_run_time: undefined, truthTag: { model_run_time: CYCLE } });
    const viaReadout = world({ model_run_time: undefined, __readoutModelRun: CYCLE });
    expect(decide(regional(), viaTag).hold).toBe(true);
    expect(decide(regional(), viaReadout).hold).toBe(true);
    const newerTag = world({ model_run_time: undefined, truthTag: { model_run_time: '2026-11-09T12:00:00Z' } });
    expect(decide(regional(), newerTag)).toEqual({ hold: false, reason: 'run' });
  });

  test('two spellings of one cycle are one cycle', () => {
    expect(decide(regional(), world({ model_run_time: '2026-11-09T00:00:00+00:00' })).hold).toBe(true);
  });

  test('a cycle on ONE side only falls back to run_time (two stamps still release)', () => {
    expect(decide(regional(), world({ model_run_time: undefined }))).toEqual({ hold: false, reason: 'run' });
    expect(decide(regional(), world({ model_run_time: undefined, run_time: '2026-11-09T13:23:19Z' })).hold).toBe(true);
  });

  test('an unzoned or junk cycle is no evidence: run_time decides', () => {
    expect(decide(regional(), world({ model_run_time: '2026-11-09 00:00' }))).toEqual({ hold: false, reason: 'run' });
    expect(decide(regional({ model_run_time: 'unknown' }), world({ model_run_time: 'unknown' }))).toEqual({ hold: false, reason: 'run' });
  });

  test('the cycle alone labels the frame (no run_time, no valid time) and is not "unlabelled"', () => {
    const bare = (d) => ({ ...d, grid: { ...d.grid, run_time: undefined, validTime: undefined } });
    expect(decide(bare(regional()), bare(world())).hold).toBe(true);
  });

  test('every other release still applies on a shared cycle', () => {
    expect(decide(regional(), world({}, {}), { disabledWorld: true })).toEqual({ hold: false, reason: 'world_disabled' });
    expect(decide(regional(), world({ hourOffset: 3 }, { hourOffset: 3 }))).toEqual({ hold: false, reason: 'hour' });
    expect(decide(regional(), world({ stale: true }))).toEqual({ hold: false, reason: 'stale' });
    expect(decide(regional(), world({ __sourceModel: 'GFS' }))).toEqual({ hold: false, reason: 'model_or_layer' });
    expect(decide(regional(), world(), { disabled: true })).toEqual({ hold: false, reason: 'disabled' });
  });
});

// THE /grid COMMIT PATH (2026-11-09, offline scn_ingest_skew_hold.js, both pre-#752 and #752 bundles: FAIL "run"). The marine /grid
// conform carries the cycle only in its frameReceipt, so a /grid-committed regional had no cycle and the rule fell back to the stamps.
// These run the REAL conform, so a fixture cannot drift from what the app commits.
import { mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';

const gridJson = (extra = {}) => {
  const vectors = [];
  for (let r = 0; r < 17; r++) for (let c = 0; c < 13; c++) {
    vectors.push({ lat: 26 + r * 0.25, lng: -82 + c * 0.25, speed: 0.4, u: 0.1, v: -0.1, direction: 54, period: 1.45, is_valid: true });
  }
  return { model: 'ICON', domain: 'marine', layer: 'wind_waves', provider: 'open-meteo', source_dataset: 'dwd_gwam',
    valid_time: VALID, served_valid_time: VALID, run_time: '2026-11-09T13:23:19Z', model_run_time: CYCLE, model_run_time_status: 'known',
    product_id: 'icon_marine_wind_waves_florida_east_coast_20261109T180000Z.json', is_estimated: false,
    grid: { bounds: REGIONAL_B, cols: 13, rows: 17, vectors }, ...extra };
};
const conformed = (extra) => mapNormalizedGridToWebGL(gridJson(extra), null, 0, 'wind_waves', 'ICON');

describe('a /grid-committed regional names its cycle through the conform\'s verified frameReceipt', () => {
  test('the conform drops model_run_time and keeps it in the receipt (the shape this rule must read)', () => {
    const r = conformed();
    expect(r.grid.model_run_time).toBeUndefined();
    expect(r.grid.frameReceipt).toMatchObject({ modelRunTime: '2026-11-09T00:00:00.000Z', modelRunTimeStatus: 'known' });
  });

  test('the live/offline case: /grid regional (receipt cycle) vs series world (model_run_time), same cycle, two stamps: HELD', () => {
    const d = decide(conformed(), world());
    expect(d.hold).toBe(true);
    expect(d.detail).toMatchObject({ world: true, residentDims: '13x17', incomingDims: '181x83' });
  });

  test('a newer cycle in the world frame still releases', () => {
    expect(decide(conformed(), world({ model_run_time: '2026-11-09T06:00:00Z' }))).toEqual({ hold: false, reason: 'run' });
  });

  test('an UNVERIFIED receipt cycle is no evidence: the stamps decide (and differ)', () => {
    for (const status of ['missing', 'conflicting']) {
      expect(decide(conformed({ model_run_time_status: status }), world())).toEqual({ hold: false, reason: 'run' });
    }
  });

  test('with resident-frame diagnostics killed there is no receipt: the old run_time rule, unchanged', () => {
    window.__RAW_DISABLE_RESIDENT_FRAME_DIAGNOSTICS__ = true;
    try { expect(decide(conformed(), world())).toEqual({ hold: false, reason: 'run' }); }
    finally { delete window.__RAW_DISABLE_RESIDENT_FRAME_DIAGNOSTICS__; }
  });
});
