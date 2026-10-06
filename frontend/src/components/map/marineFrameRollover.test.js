import { decideMarineCommit, __resetArbiterGraceForTests } from './marineCommitGate';
import { __resetRatingGraceForTests } from './marineEngineDecisions';

const A = '2026-10-07T15:00:00Z', B = '2026-10-07T18:00:00Z';
const vp = [-81, 27, -79, 29];
const fine = extra => ({ bounds: { west: -82, south: 26, east: -78, north: 30 },
  cols: 17, rows: 17, vectors: [1], hourOffset: 144, served_valid_time: A,
  valid_time: A, __sourceModel: 'GFS', __componentLayer: 'waves', ...extra });
const world = extra => ({ ...fine(), bounds: { west: -180, south: -80, east: 180, north: 85 },
  cols: 37, rows: 17, ...extra });
let oldFlag;
beforeEach(() => {
  oldFlag = process.env.REACT_APP_FORECAST_STATE_IDENTITY;
  process.env.REACT_APP_FORECAST_STATE_IDENTITY = 'true';
  window.__SURF_MODE__ = false;
  delete window.__RAW_DISABLE_FORECAST_STATE_IDENTITY__;
  __resetRatingGraceForTests(); __resetArbiterGraceForTests();
});
afterEach(() => {
  if (oldFlag === undefined) delete process.env.REACT_APP_FORECAST_STATE_IDENTITY;
  else process.env.REACT_APP_FORECAST_STATE_IDENTITY = oldFlag;
  delete window.__SURF_MODE__; delete window.__RAW_DISABLE_FORECAST_STATE_IDENTITY__;
});

describe.each(['guards', 'arbiter'])('%s actual frame rollover', mode => {
  const win = () => ({ __SURF_MODE__: false, __RAW_MARINE_ARBITER__: mode === 'arbiter' });
  const decide = (r, i, z = 8.5, view = vp, w = win(), now = 0) => decideMarineCommit(r, i, z, view, w, now);
  it.each([
    ['same physical frame', {}, true],
    ['hour label only changes', { hourOffset: 145 }, true],
    ['actual time changes with same label', { served_valid_time: B }, false],
    ['requested-time echo only changes', { valid_time: B }, true],
    ['same instant expressed with timezone offset', { served_valid_time: '2026-10-07T16:00:00+01:00' }, true],
    ['missing actual time cannot certify the same frame', { served_valid_time: null }, false],
    ['invalid actual time cannot certify the same frame', { served_valid_time: 'not-a-time' }, false],
    ['timezone-less actual time cannot certify the same frame', { served_valid_time: '2026-10-07T15:00:00' }, false],
    ['diagnostic receipt cannot override actual served time', { served_valid_time: B, frameReceipt: { servedValidTime: A } }, false],
    ['provider null control', { __gridProvider: 'dwd' }, true],
    ['model positive control', { __sourceModel: 'ICON' }, false],
    ['layer positive control', { __componentLayer: 'swell' }, false],
  ])('%s', (_label, delta, hold) => {
    expect(decide(fine(), world(delta)).reject).toBe(hold);
  });
  it('unknown resident time releases even with a matching requested echo', () => {
    expect(decide(fine({ served_valid_time: null }), world()).reject).toBe(false);
  });
  it('diagnostic kill does not change the serving decision', () => {
    window.__RAW_DISABLE_RESIDENT_FRAME_DIAGNOSTICS__ = true;
    try { expect(decide(fine(), world({ served_valid_time: B })).reject).toBe(false); }
    finally { delete window.__RAW_DISABLE_RESIDENT_FRAME_DIAGNOSTICS__; }
  });
  it.each([undefined, '0', 'false'])('legacy behavior is unchanged with flag %s', flag => {
    if (flag === undefined) delete process.env.REACT_APP_FORECAST_STATE_IDENTITY;
    else process.env.REACT_APP_FORECAST_STATE_IDENTITY = flag;
    expect(decide(fine(), world({ served_valid_time: B })).reject).toBe(true);
    expect(decide(fine(), world({ hourOffset: 145 })).reject).toBe(false);
  });
  it('injected operator kill restores the legacy label comparison', () => {
    const w = { ...win(), __RAW_DISABLE_FORECAST_STATE_IDENTITY__: true };
    expect(decide(fine(), world({ served_valid_time: B }), 8.5, vp, w).reject).toBe(true);
    expect(decide(fine(), world({ hourOffset: 145 }), 8.5, vp, w).reject).toBe(false);
  });
  it.each([
    ['same frame', {}, true],
    ['same frame with a different label', { hourOffset: 145 }, true],
    ['new actual frame', { served_valid_time: B }, false],
    ['unknown actual frame', { served_valid_time: null }, false],
  ])('wide subcover guard: %s', (_label, delta, hold) => {
    expect(decide(world(), fine(delta), 3, [-160, -30, 0, 40]).reject).toBe(hold);
  });
  it('rating grace is bounded across label changes for one actual frame', () => {
    window.__SURF_MODE__ = true;
    const w = { ...win(), __SURF_MODE__: true };
    const r = fine({ ratingMode: true, bounds: { west: -80.8, south: 27.2, east: -80.2, north: 27.8 } });
    expect(decide(r, world(), 8.5, vp, w, 1000).reject).toBe(true);
    expect(decide({ ...r, hourOffset: 145 }, world({ hourOffset: 145 }), 8.5, vp, w, 5100).reject).toBe(false);
  });
  it('an actual new frame is not held by rating grace', () => {
    window.__SURF_MODE__ = true;
    const w = { ...win(), __SURF_MODE__: true };
    const r = fine({ ratingMode: true, bounds: { west: -80.8, south: 27.2, east: -80.2, north: 27.8 } });
    expect(decide(r, world(), 8.5, vp, w, 1000).reject).toBe(true);
    expect(decide(r, world({ served_valid_time: B }), 8.5, vp, w, 1500).reject).toBe(false);
  });
});
