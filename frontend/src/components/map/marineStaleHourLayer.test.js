/**
 * The custom layer's half of the wrong-hour fix (2026-10-01, audit F-21): the selected instant (the readout's own function,
 * memoised) and the per-frame multiplier. See marineStaleHour.test.js for the pure rules.
 */
import { selectedInstantMs, staleWorldDimMult, SELECTED_MEMO_MS, _resetSelectedMemoForTest } from './marineStaleHourLayer';
import { createStaleHourTracker, STALE_WORLD_DIM, STALE_HOLD_MS } from './marineStaleHour';
import * as readout from './forecastReadout';
import * as coverage from './backendWeatherServiceClientCoverage';

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const TILE = { west: -82, south: 26, east: -79, north: 29 };
const ANCHOR = Date.parse('2026-10-01T12:00:00Z');
const WED15 = Date.parse('2026-10-07T15:00:00Z');                    // anchor + 147 h
const engineWith = (g) => ({ _waveData: g ? { waveGrid: g } : null });
const world = (vt, over = {}) => ({ bounds: WORLD, cols: 181, rows: 82, valid_time: vt, ...over });

beforeEach(() => {
  _resetSelectedMemoForTest();
  window.__MOCK_DATE_NOW__ = ANCHOR;                                   // the forecast anchor: no manifest loaded, so the instant is anchor + hour
  window.__RAW_GPU__ = {};
  delete window.isScrubbingTimeline;
  delete window.__RAW_DISABLE_STALE_HOUR_DIM__;
  delete window.__RAW_DISABLE_STALE_RESIDENT_SWAP__;
});
afterEach(() => {
  delete window.__MOCK_DATE_NOW__;
  delete window.__RAW_GPU__;
  jest.restoreAllMocks();
});

describe('selectedInstantMs', () => {
  it('is the readout\'s own instant for the selected hour', () => {
    expect(selectedInstantMs(147, 'waves', 'GFS', 1000)).toBe(WED15);
    expect(selectedInstantMs(147, 'waves', 'GFS', 1000)).toBe(readout.displayedForecastTime(147, 'waves', 'GFS').ms);
  });
  it('is memoised for SELECTED_MEMO_MS per {hour, layer, model} (the manifest scan behind it is far too heavy for every frame)', () => {
    const spy = jest.spyOn(readout, 'displayedForecastTime');
    selectedInstantMs(147, 'waves', 'GFS', 1000);
    selectedInstantMs(147, 'waves', 'GFS', 1000 + SELECTED_MEMO_MS - 1);
    expect(spy).toHaveBeenCalledTimes(1);
    selectedInstantMs(147, 'waves', 'GFS', 1000 + SELECTED_MEMO_MS + 1);                  // expired
    expect(spy).toHaveBeenCalledTimes(2);
    selectedInstantMs(148, 'waves', 'GFS', 1000 + SELECTED_MEMO_MS + 2);                  // another hour
    selectedInstantMs(148, 'swell_1', 'GFS', 1000 + SELECTED_MEMO_MS + 3);                // another layer
    selectedInstantMs(148, 'swell_1', 'ICON', 1000 + SELECTED_MEMO_MS + 4);               // another model
    expect(spy).toHaveBeenCalledTimes(5);
  });
  it('is re-resolved when the manifest changes, even inside the memo window (a snap to a model step can move the instant)', () => {
    const spy = jest.spyOn(readout, 'displayedForecastTime');
    const man = jest.spyOn(coverage, 'getCachedManifest');
    const first = { id: 1 }; const second = { id: 2 };
    man.mockReturnValue(first);
    selectedInstantMs(147, 'waves', 'GFS', 1000);
    man.mockReturnValue(second);
    selectedInstantMs(147, 'waves', 'GFS', 1500);
    expect(spy).toHaveBeenCalledTimes(2);
    selectedInstantMs(147, 'waves', 'GFS', 1600);                                          // the same manifest object again: memoised
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it('is NaN, never a throw, when the readout cannot answer', () => {
    jest.spyOn(readout, 'displayedForecastTime').mockImplementation(() => { throw new Error('no manifest'); });
    expect(selectedInstantMs(147, 'waves', 'GFS', 5000)).toBeNaN();
  });
});

describe('staleWorldDimMult: the multiplier the custom layer applies to this frame', () => {
  const run = (g, { held = STALE_HOLD_MS + 100, hour = 147, layers = ['waves'], model = 'GFS' } = {}) => {
    const tracker = createStaleHourTracker();
    tracker.heldMs(hour, 1000);
    return staleWorldDimMult(engineWith(g), tracker, hour, layers, model, window, 1000 + held);
  };
  it('the page-load world frame while Wednesday is selected, the hour held still: a fraction of strength (the live case)', () => {
    expect(run(world('2026-10-01T12:00:00Z'))).toBe(STALE_WORLD_DIM);
    expect(window.__RAW_GPU__.staleHour).toMatchObject({ why: 'stale_world', stale: true, mult: STALE_WORLD_DIM });
  });
  it('the right-hour world frame, a regional frame and an empty engine: untouched', () => {
    expect(run(world('2026-10-07T15:00:00Z'))).toBe(1);
    expect(run(world('2026-10-01T12:00:00Z', { bounds: TILE }))).toBe(1);
    expect(run(null)).toBe(1);
  });
  it('the hour just moved: untouched, then dimmed once it has held still (a scrub never flickers)', () => {
    const tracker = createStaleHourTracker();
    const eng = engineWith(world('2026-10-01T12:00:00Z'));
    expect(staleWorldDimMult(eng, tracker, 147, ['waves'], 'GFS', window, 1000)).toBe(1);                   // first frame at this hour
    expect(staleWorldDimMult(eng, tracker, 147, ['waves'], 'GFS', window, 1000 + STALE_HOLD_MS - 1)).toBe(1);
    expect(staleWorldDimMult(eng, tracker, 147, ['waves'], 'GFS', window, 1000 + STALE_HOLD_MS + 1)).toBe(STALE_WORLD_DIM);
    expect(staleWorldDimMult(eng, tracker, 148, ['waves'], 'GFS', window, 3000)).toBe(1);                   // moved again: the clock restarts
  });
  it('reads the ACTIVE marine layer from the layer list (a swell layer asks for its own instant)', () => {
    const spy = jest.spyOn(readout, 'displayedForecastTime');
    run(world('2026-10-01T12:00:00Z'), { layers: ['swell_1'] });
    expect(spy.mock.calls[0].slice(0, 2)).toEqual([147, 'swell_1']);
  });
  it('the dim kill switch: the frame is untouched, but the swap still gets its instant (it has its own switch)', () => {
    window.__RAW_DISABLE_STALE_HOUR_DIM__ = true;
    const spy = jest.spyOn(readout, 'displayedForecastTime');
    const eng = engineWith(world('2026-10-01T12:00:00Z'));
    const tracker = createStaleHourTracker();
    tracker.heldMs(147, 1000);
    expect(staleWorldDimMult(eng, tracker, 147, ['waves'], 'GFS', window, 1000 + STALE_HOLD_MS + 100)).toBe(1);
    expect(spy).toHaveBeenCalled();
    expect(eng.__staleSwapMs).toBe(WED15);
  });
  it('both kill switches: untouched, nothing handed to the engine, and the readout is not even consulted', () => {
    window.__RAW_DISABLE_STALE_HOUR_DIM__ = true;
    window.__RAW_DISABLE_STALE_RESIDENT_SWAP__ = true;
    const spy = jest.spyOn(readout, 'displayedForecastTime');
    const eng = engineWith(world('2026-10-01T12:00:00Z'));
    const tracker = createStaleHourTracker();
    tracker.heldMs(147, 1000);
    expect(staleWorldDimMult(eng, tracker, 147, ['waves'], 'GFS', window, 1000 + STALE_HOLD_MS + 100)).toBe(1);
    expect(spy).not.toHaveBeenCalled();
    expect(eng.__staleSwapMs).toBeNull();
  });
  it('hands the engine the selected instant only in the frames the dim acts, and null otherwise (the per-frame bridge reads it)', () => {
    const tracker = createStaleHourTracker();
    const eng = engineWith(world('2026-10-01T12:00:00Z'));
    staleWorldDimMult(eng, tracker, 147, ['waves'], 'GFS', window, 1000);                                  // the hour just arrived: not held yet
    expect(eng.__staleSwapMs).toBeNull();
    staleWorldDimMult(eng, tracker, 147, ['waves'], 'GFS', window, 1000 + STALE_HOLD_MS + 1);
    expect(eng.__staleSwapMs).toBe(WED15);
    expect(window.__RAW_GPU__.staleHour).toMatchObject({ why: 'stale_world', swap: true });
    window.isScrubbingTimeline = true;
    staleWorldDimMult(eng, tracker, 147, ['waves'], 'GFS', window, 4000);
    expect(eng.__staleSwapMs).toBeNull();                                                                  // a scrub in progress: no swap
    window.isScrubbingTimeline = false;
    eng._waveData = { waveGrid: world('2026-10-07T15:00:00Z') };                                           // the right hour is drawn: nothing to swap
    staleWorldDimMult(eng, tracker, 147, ['waves'], 'GFS', window, 5000);
    expect(eng.__staleSwapMs).toBeNull();
    eng.__staleSwapMs = WED15; eng._waveData = null;                                                       // no frame at all: the leftover is cleared
    staleWorldDimMult(eng, tracker, 147, ['waves'], 'GFS', window, 6000);
    expect(eng.__staleSwapMs).toBeNull();
  });
  it('never throws: a frame must always draw', () => {
    const tracker = createStaleHourTracker();
    const hostile = { get _waveData() { throw new Error('torn down'); } };
    expect(staleWorldDimMult(hostile, tracker, 147, ['waves'], 'GFS', window, 1)).toBe(1);
    expect(staleWorldDimMult(null, tracker, 147, null, undefined, window, 1)).toBe(1);
  });
});
