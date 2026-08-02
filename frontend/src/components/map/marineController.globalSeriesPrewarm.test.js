/**
 * IS THE ZOOM-AXIS SERIES WARM ACTUALLY CALLED? (audit v6 §5.1)
 *
 * The companion suite (marineGridSeries.globalPrewarm.test.js) proves the entry a global warm writes
 * is the one a zoom-out READS. This one proves the warm is WIRED — that `prewarmGlobalMarineGrid`
 * really calls `ensureMarineSeries` with `_GLOBAL_BOUNDS`, under the right gate, with the right
 * flags, and that its kill switch kills.
 *
 * Both halves are needed and neither substitutes for the other. This repo's dominant recorded
 * failure is a guard that is green and runs nowhere; its twin is a FIX that is correct and is never
 * called. `prewarmGlobalMarineGrid` itself is the cautionary example — it shipped 2026-07-04 against
 * the literal symptom "the heatmap clears 3-5s on FIRST zoom-out", worked exactly as written, and
 * left the gesture 8.7 s slow because it warmed one of the two caches the gesture consults.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./marineGridSeries', () => ({
  ensureMarineSeries: jest.fn(() => Promise.resolve()),
  getMarineSeriesFrame: jest.fn(() => null),
}));
// ⚠️ Mock ONLY the module under assertion. Two earlier attempts to stub the backend clients failed
// outright and are worth recording: a hand-listed mock of `backendWeatherServiceClient` dropped
// `getBackendWindFlag`, which `backendWindServiceClient` calls at MODULE level via
// `marineController -> windController`; and `jest.requireActual` on the same module hits a circular
// import (`backendWeatherServiceClient` -> `backendWeatherServiceClientPoint` -> back). Letting the
// real modules load and stubbing `fetch` is both simpler and closer to production. The assertion is
// unaffected either way: the series warm sits ABOVE the backend-redirect block, gated only on the
// prewarm switch, the scrub flag, the bounds and the 15-degree test.

import { ensureMarineSeries } from './marineGridSeries';
import { prewarmGlobalMarineGrid } from './marineController';

const GLOBAL_BOUNDS = { west: -180, south: -80, east: 180, north: 85 };
const ZOOMED_IN = { west: -81.2, south: 27.9, east: -79.95, north: 28.95 };   // ~1.25 deg, z9
const ZOOMED_OUT = { west: -100, south: 0, east: -40, north: 50 };            // 60 deg, past the gate

describe('prewarmGlobalMarineGrid warms the SERIES cache, not just the grid cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(() => new Promise(() => {}));   // never settles: isolate the SYNC path
    window.__MARINE_SIBLING_PREWARM__ = true;
    delete window.__RAW_DISABLE_GLOBAL_SERIES_PREWARM__;
    delete window.isScrubbingTimeline;
  });
  afterEach(() => { delete global.fetch; });

  it('calls ensureMarineSeries at GLOBAL bounds while the user is ZOOMED IN', () => {
    prewarmGlobalMarineGrid('GFS', 0, ZOOMED_IN, 'waves');
    expect(ensureMarineSeries).toHaveBeenCalledTimes(1);
    const [model, layer, bounds, hourOffset, signal, currentPageOnly] = ensureMarineSeries.mock.calls[0];
    expect(model).toBe('GFS');
    expect(layer).toBe('waves');
    expect(bounds).toEqual(GLOBAL_BOUNDS);      // the GLOBAL bounds, never the caller's viewport
    expect(hourOffset).toBe(0);
    expect(signal).toBeUndefined();             // no abort signal: it must survive the pan that follows
    expect(currentPageOnly).toBe(true);         // ONE request, not the 48-frame fan-out
  });

  it('KNOWN-FAILING CONTROL: does NOT fire once the viewport is already wide', () => {
    // Past 15 deg the global is already held or in flight — warming again would be pure waste, and
    // without this control the assertion above would pass for a function that fires unconditionally.
    prewarmGlobalMarineGrid('GFS', 0, ZOOMED_OUT, 'waves');
    expect(ensureMarineSeries).not.toHaveBeenCalled();
  });

  it('the kill switch KILLS the series warm and leaves the grid prewarm alone', () => {
    window.__RAW_DISABLE_GLOBAL_SERIES_PREWARM__ = true;
    prewarmGlobalMarineGrid('GFS', 0, ZOOMED_IN, 'waves');
    expect(ensureMarineSeries).not.toHaveBeenCalled();
    // ...and the switch is opt-OUT: only the literal `true` disables it.
    window.__RAW_DISABLE_GLOBAL_SERIES_PREWARM__ = 'yes';
    prewarmGlobalMarineGrid('GFS', 0, ZOOMED_IN, 'waves');
    expect(ensureMarineSeries).toHaveBeenCalledTimes(1);
  });

  it('respects the family prewarm switch and does not compete with an active scrub', () => {
    window.__MARINE_SIBLING_PREWARM__ = false;
    prewarmGlobalMarineGrid('GFS', 0, ZOOMED_IN, 'waves');
    expect(ensureMarineSeries).not.toHaveBeenCalled();

    window.__MARINE_SIBLING_PREWARM__ = true;
    window.isScrubbingTimeline = true;
    prewarmGlobalMarineGrid('GFS', 0, ZOOMED_IN, 'waves');
    expect(ensureMarineSeries).not.toHaveBeenCalled();
  });

  it('carries the CURRENT hour through, so a scrubbed session warms the page it is actually on', () => {
    prewarmGlobalMarineGrid('EURO', 72, ZOOMED_IN, 'swell_1');
    const [model, layer, , hourOffset] = ensureMarineSeries.mock.calls[0];
    expect([model, layer, hourOffset]).toEqual(['EURO', 'swell_1', 72]);
  });
});
