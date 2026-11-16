// THE LATE WASH (2026-11-15, docs/weather-program/log/2026-11-15-claude-marine-late-wash.md): a staged world seed that repairs a
// wash the time rule is refusing is consumed after URGENT_QUIET_MS of no input instead of QUIET_MS.
import { seedRepairsWash } from './marineStaleHour';
import { QUIET_MS, URGENT_KEY_QUIET_MS, URGENT_QUIET_MS, _noteInputForTest, _resetQuietFramesForTest, seedConsumeAllowed } from './marineQuietFrames';

const grid = (iso) => ({ grid: { served_valid_time: iso, cols: 181, rows: 83, bounds: { west: -180, south: -80, east: 180, north: 84 } } });
const T0 = '2026-11-15T21:00:00Z';
const T6 = '2026-11-16T03:00:00Z';

describe('seedRepairsWash', () => {
  test('old-hour base, seed of the resident hour: repairs (the measured late wash)', () => {
    expect(seedRepairsWash(grid(T0), grid(T6), grid(T6))).toBe(true);
  });
  test('no base at all, seed of the resident hour: repairs', () => {
    expect(seedRepairsWash(null, grid(T6), grid(T6))).toBe(true);
  });
  test('base already the resident hour: nothing to repair (the 1 s quiet rule keeps the upload off the scrub)', () => {
    expect(seedRepairsWash(grid(T6), grid(T6), grid(T6))).toBe(false);
  });
  test('a seed of another hour repairs nothing (it would be refused too)', () => {
    expect(seedRepairsWash(grid(T0), grid('2026-11-16T09:00:00Z'), grid(T6))).toBe(false);
  });
  test('unknown times: false (fail to the old behaviour)', () => {
    expect(seedRepairsWash(grid(T0), { grid: {} }, grid(T6))).toBe(false);
    expect(seedRepairsWash(grid(T0), grid(T6), null)).toBe(false);
  });
});

describe('seedConsumeAllowed: urgent waits URGENT_QUIET_MS, anything else QUIET_MS', () => {
  let now;
  beforeEach(() => {
    _resetQuietFramesForTest();
    now = 1000000;
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    _noteInputForTest(now);                                       // a key just landed
  });
  afterEach(() => { jest.restoreAllMocks(); delete window.__RAW_DISABLE_URGENT_WASH_SEED__; delete window.__RAW_DISABLE_QUIET_SEED__; });

  test('inside the burst: never (a held key gets no upload)', () => {
    now += URGENT_QUIET_MS - 1;
    expect(seedConsumeAllowed(5, true)).toBe(false);
  });
  test('URGENT_QUIET_MS after the last key: the repairing seed is consumed, an ordinary one still waits', () => {
    now += URGENT_QUIET_MS;
    expect(seedConsumeAllowed(5, true)).toBe(true);
    expect(seedConsumeAllowed(5, false)).toBe(false);
    now += QUIET_MS;
    expect(seedConsumeAllowed(5, false)).toBe(true);
  });
  test('kill __RAW_DISABLE_URGENT_WASH_SEED__: the urgent seed waits QUIET_MS again', () => {
    window.__RAW_DISABLE_URGENT_WASH_SEED__ = true;
    now += URGENT_QUIET_MS;
    expect(seedConsumeAllowed(5, true)).toBe(false);
    now += QUIET_MS;
    expect(seedConsumeAllowed(5, true)).toBe(true);
  });
  test('a zoom in progress resets the clock for the urgent seed too', () => {
    now += URGENT_QUIET_MS;
    seedConsumeAllowed(5, true);
    expect(seedConsumeAllowed(5.2, true)).toBe(false);
  });
});

describe('no-key guard (section 4 re-run): an urgent seed also waits URGENT_KEY_QUIET_MS after the last KEY', () => {
  let now = 50000;
  beforeEach(() => { _resetQuietFramesForTest(); now = 50000; jest.spyOn(performance, 'now').mockImplementation(() => now); });
  afterEach(() => { jest.restoreAllMocks(); delete window.__RAW_DISABLE_URGENT_WASH_SEED__; });

  test('a scrub key: not at URGENT_QUIET_MS, only at URGENT_KEY_QUIET_MS', () => {
    _noteInputForTest(now, true);
    now += URGENT_QUIET_MS;
    expect(seedConsumeAllowed(5, true)).toBe(false);
    now += URGENT_KEY_QUIET_MS - URGENT_QUIET_MS;
    expect(seedConsumeAllowed(5, true)).toBe(true);
    expect(seedConsumeAllowed(5, false)).toBe(false);          // an ordinary seed still waits QUIET_MS
  });

  test('a pointer (not a key): URGENT_QUIET_MS is enough', () => {
    _noteInputForTest(now, false);
    now += URGENT_QUIET_MS;
    expect(seedConsumeAllowed(5, true)).toBe(true);
  });
});