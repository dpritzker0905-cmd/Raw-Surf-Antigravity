/**
 * CLI-6 (Fable audit 2026-11-10): the #757 finer-resident hold HELD when only ONE side named its run.
 * `byCycle` needs both cycles; otherwise run_time; and when either run_time was missing the run check was skipped, so the hold
 * passed on a matching valid time alone. An older-cycle finer resident could then be held over an incoming frame whose run is
 * unknown (a newer run, for all the client can tell) until a pan. Release is the safe direction (the commit then shows the incoming
 * frame), so a one-sided-unknown run now releases with reason 'run_unknown'. Both sides unknown is unchanged (valid time and
 * served instant still label the frame). Kill: window.__RAW_DISABLE_HOLD_RUN_UNKNOWN_RELEASE__ = true.
 */
import { finerResidentHoldDecision } from './marineFinerResidentHold';

const VEC = [{ lat: 28, lng: -80, speed: 0.4, u: 0.1, v: -0.1, direction: 54, period: 1.45 }];
const VALID = '2026-11-09T18:00:00Z';
const CYCLE = '2026-11-09T00:00:00Z';
const VIEW = { west: -80.9, south: 27.8, east: -80.0, north: 28.8 };
const REGIONAL_B = { west: -82, south: 26, east: -79, north: 30 };
const WORLD_B = { west: -180, south: -80, east: 180, north: 86 };

const mk = (cols, rows, bounds, grid = {}) => ({
  hourOffset: 0,
  grid: { vectors: VEC, cols, rows, bounds, hourOffset: 0, validTime: VALID, renderable: true,
    __sourceModel: 'ICON', __componentLayer: 'wind_waves', ...grid },
});
const regional = (grid = {}) => mk(13, 17, REGIONAL_B, { run_time: '2026-11-09T13:23:19Z', model_run_time: CYCLE, ...grid });
const world = (grid = {}) => mk(181, 83, WORLD_B, { run_time: '2026-11-09T12:11:11Z', model_run_time: CYCLE, ...grid });
const unlabelledRun = { run_time: undefined, model_run_time: undefined };
const decide = (prev, incoming) => finerResidentHoldDecision({ prev, incoming, viewport: VIEW, liveViewport: VIEW });

afterEach(() => { delete window.__RAW_DISABLE_HOLD_RUN_UNKNOWN_RELEASE__; });

describe('CLI-6: a run known on ONE side only releases the hold', () => {
  test('incoming run unknown, resident run known: release (was: held on valid time alone)', () => {
    expect(decide(regional(), world(unlabelledRun))).toEqual({ hold: false, reason: 'run_unknown' });
  });

  test('resident run unknown, incoming run known: release', () => {
    expect(decide(regional(unlabelledRun), world())).toEqual({ hold: false, reason: 'run_unknown' });
  });

  test('both runs unknown: unchanged (valid time still labels the frame, the #757 hold holds)', () => {
    expect(decide(regional(unlabelledRun), world(unlabelledRun)).hold).toBe(true);
  });

  test('both runs known and equal: unchanged, held', () => {
    expect(decide(regional(), world()).hold).toBe(true);
  });

  test('kill switch: the pre-fix behaviour (held on valid time)', () => {
    window.__RAW_DISABLE_HOLD_RUN_UNKNOWN_RELEASE__ = true;
    expect(decide(regional(), world(unlabelledRun)).hold).toBe(true);
  });
});
