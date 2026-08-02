/**
 * THE PRECONDITION FOR WARMING THE SERIES CACHE ALONG THE ZOOM AXIS (audit v6 §5.1).
 *
 * Measured live 2026-08-02: the FIRST zoom-out of a session costs one blocking `grid_series` fetch
 * (2,449 KB / 8,658 ms at z9->z4); the SECOND costs ZERO. `prewarmGlobalMarineGrid` already warms the
 * single-frame `/api/weather/grid` cache from a zoomed-IN viewport — and reading
 * `__MARINE_CACHE_DIAG__` on a cold first zoom-out returned `{hit: 4}` with ZERO containment misses
 * *beside* a 2,972 KB grid_series. A perfectly warm grid cache next to a 9.6 s gesture can only mean
 * the gesture waits on a DIFFERENT cache: `_seriesCache`, which nothing warms across the zoom axis.
 *
 * The fix is to warm the series at `_GLOBAL_BOUNDS` while the user is still zoomed in. That is only
 * worth building if the entry it writes is the one a zoomed-OUT viewport later READS, and this file
 * pins exactly that — through the module's public surface, never a re-implementation of `pageKey`
 * (which is not exported, and a hand-copied key is how a "warm" cache silently warms nothing).
 *
 * ⚠️ THE LANDMINE THIS ALSO PINS. `viewportKey` collapses a viewport to the shared 'global' key when
 * EITHER span exceeds 15°. For `_GLOBAL_BOUNDS = {-180,-80,180,85}` the LONGITUDE span computes to
 * ZERO, because normLng(-180) and normLng(+180) are both -180. So the collapse survives on the
 * LATITUDE span (165) alone. Narrow that latitude range in a future edit and the global prewarm
 * silently starts writing a 0.5°-snapped key that no zoom-out ever reads — a warm cache that warms
 * nothing, with every test still green. The last case below fails if that ever happens.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null, recordTruthStage: () => {} }));

import { ensureMarineSeries, getMarineSeriesFrame, _resetMarineSeriesForTest } from './marineGridSeries';

// Verbatim from marineController.js:59 — the bounds the existing grid prewarm already uses.
const GLOBAL_BOUNDS = { west: -180, south: -80, east: 180, north: 85 };

// A z4-ish zoom-out viewport: span 60° x 50°, far over the 15° collapse threshold.
const WIDE_ZOOMED_OUT = { west: -100, south: 0, east: -40, north: 50 };
// A second, DIFFERENT wide viewport — a user on another coast entirely.
const WIDE_OTHER_COAST = { west: 100, south: -40, east: 170, north: 10 };
// A z9-ish surf viewport: span 1.25°, under the threshold, so it gets its own snapped key.
const NARROW_SURF = { west: -81.2, south: 27.9, east: -79.95, north: 28.95 };

function globalFramesResponse() {
  const mk = (h) => ({
    hour_offset: h, cols: 5, rows: 5, bounds: GLOBAL_BOUNDS,
    vectors: [{ lat: 0, lng: 0, u: 0, v: -1, speed: 1, direction: 0, period: 8 }],
  });
  return { ok: true, status: 200, json: async () => ({ frames: [mk(0), mk(3), mk(6)] }) };
}

let fetchCount = 0;
async function warmGlobalSeries() {
  fetchCount = 0;
  global.fetch = async () => { fetchCount += 1; return globalFramesResponse(); };
  // Exactly the call the fix adds inside prewarmGlobalMarineGrid: GLOBAL bounds, current page only.
  await ensureMarineSeries('GFS', 'waves', GLOBAL_BOUNDS, 0, undefined, true);
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('warming the series at _GLOBAL_BOUNDS is READ by a zoomed-out viewport (v6 §5.1 precondition)', () => {
  beforeEach(() => {
    window.__RAW_DISABLE_HOUR0_FIRST__ = true;   // isolate the page load from the h0 mini
    window.__MARINE_SERIES__ = true;
    window.__MARINE_SERIES_DIAG__ = { loads: 0, hits: 0, misses: 0 };
    _resetMarineSeriesForTest();
  });
  afterEach(() => {
    delete window.__RAW_DISABLE_HOUR0_FIRST__;
    delete global.fetch;
  });

  it('a zoom-out viewport HITS the entry warmed at GLOBAL bounds — the fix is viable', async () => {
    await warmGlobalSeries();
    expect(fetchCount).toBeGreaterThan(0);              // assert the SETUP happened
    const frame = getMarineSeriesFrame('GFS', 'waves', WIDE_ZOOMED_OUT, 0);
    expect(frame).not.toBeNull();
  });

  it('THE SAFETY INVARIANT: a REGIONAL viewport prefers a covering REGIONAL frame over the global warm', async () => {
    // Written after the first version of this test asserted the WRONG thing. I expected a narrow
    // viewport to MISS the global entry; it does not — `getMarineSeriesFrame`'s containment fallback
    // serves a global frame as a LAST RESORT ("instant + zero backend while the exact view re-warms").
    // That is deliberate and documented at the fallback. What must hold is the ORDERING: once a
    // regional frame that covers the viewport exists, the global one must not win — otherwise warming
    // the global series would clamp close zoom to a 5x5 world grid, which is the coverage-class defect
    // this repo already fought (`fw=360, willSharpen:false`, organic repro 2026-06-28).
    await warmGlobalSeries();
    const REGIONAL = { west: -82, south: 27, east: -79, north: 30 };   // contains NARROW_SURF
    global.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ frames: [0, 3, 6].map((h) => ({
        hour_offset: h, cols: 5, rows: 5, bounds: REGIONAL,
        vectors: [{ lat: 28.5, lng: -80.5, u: 0, v: -1, speed: 2, direction: 0, period: 9 }] })) }),
    });
    await ensureMarineSeries('GFS', 'waves', REGIONAL, 0, undefined, true);
    for (let i = 0; i < 12; i++) await Promise.resolve();

    const frame = getMarineSeriesFrame('GFS', 'waves', NARROW_SURF, 0);
    expect(frame).not.toBeNull();
    // the REGIONAL grid, not the world one — the smallest containing bbox wins
    expect(frame.grid.bounds.west).toBe(REGIONAL.west);
    expect(frame.grid.bounds.west).not.toBe(GLOBAL_BOUNDS.west);
  });

  it('a global-width entry is served to a narrow viewport ONLY as a last resort (documented bridge)', async () => {
    await warmGlobalSeries();
    // Nothing regional cached yet -> the world frame is better than a blank map while the exact
    // view re-warms. Pinned so the ordering test above is read as an ORDERING, not a prohibition.
    const frame = getMarineSeriesFrame('GFS', 'waves', NARROW_SURF, 0);
    expect(frame).not.toBeNull();
    expect(frame.grid.bounds.west).toBe(GLOBAL_BOUNDS.west);
  });

  it('KNOWN-FAILING CONTROL: with nothing warmed at all, the same wide viewport misses', async () => {
    _resetMarineSeriesForTest();
    expect(getMarineSeriesFrame('GFS', 'waves', WIDE_ZOOMED_OUT, 0)).toBeNull();
  });

  it('ONE warm serves EVERY coast — the global key is location-independent', async () => {
    await warmGlobalSeries();
    // Measured live: a global view over Portugal hit the series warmed earlier over Florida.
    expect(getMarineSeriesFrame('GFS', 'waves', WIDE_OTHER_COAST, 0)).not.toBeNull();
  });

  it('the warm is ONE request, not the 48-frame adjacent-page fan-out', async () => {
    await warmGlobalSeries();
    expect(fetchCount).toBe(1);      // currentPageOnly=true is what keeps this a single fetch
  });

  it('LANDMINE: the shared key rests on the LATITUDE span — a lat-thin world strip does not serve a zoom-out', async () => {
    // `viewportKey` collapses to 'global' when EITHER span > 15°. For _GLOBAL_BOUNDS the LONGITUDE
    // span computes to ZERO (normLng(-180) === normLng(+180) === -180), so the collapse survives on
    // the LATITUDE span (165) alone. Narrow that latitude range and the prewarm silently starts
    // writing a key no zoom-out reads. Proven here through bounds the fallback cannot rescue: a
    // lat-thin strip neither shares the key nor CONTAINS the zoom-out viewport.
    const THIN = { west: -180, south: 0, east: 180, north: 10 };
    _resetMarineSeriesForTest();
    global.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ frames: [{ hour_offset: 0, cols: 5, rows: 5, bounds: THIN,
        vectors: [{ lat: 5, lng: 0, u: 0, v: -1, speed: 1, direction: 0, period: 8 }] }] }),
    });
    await ensureMarineSeries('GFS', 'waves', THIN, 0, undefined, true);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(getMarineSeriesFrame('GFS', 'waves', WIDE_ZOOMED_OUT, 0)).toBeNull();
  });
});
