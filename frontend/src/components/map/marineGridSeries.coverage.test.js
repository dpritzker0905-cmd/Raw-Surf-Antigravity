/**
 * #10 Source 3 — SERVED-FRAME COVERAGE INVARIANT (2026-07-21, VERIFIED against the live backend).
 *
 * A grid_series page CAN hold frames with DIFFERENT bounds. The live EURO endpoint, scrubbed across
 * the 240h native->estimated boundary, returns a WIDER coarse first frame (h228 5x5 [-84,24,-76,32])
 * followed by FINER, NARROWER frames (h240+ 13x17 [-82,26,-79,30]). entry.bounds is the FIRST frame's
 * bounds, so getMarineSeriesFrame's entry-bounds containment (bboxContains) can pass for a viewport the
 * SERVED (later, narrower) frame does NOT cover -> a clamped sub-rectangle. recovery_2b / series_settle
 * commit the frame with no per-frame gate. The choke-point guard rejects a non-covering served frame.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null, recordTruthStage: () => {} }));

import { ensureMarineSeries, getMarineSeriesFrame, _resetMarineSeriesForTest } from './marineGridSeries';

const WIDE = { west: -84, south: 24, east: -76, north: 32 };   // the h0 coarse frame (entry.bounds)
const NARROW = { west: -82, south: 26, east: -79, north: 30 };  // the finer later frames

// Mirror the observed EURO heterogeneous page: first frame WIDE, later frames NARROW.
function heterogeneousResponse() {
  const mk = (h, b) => ({ hour_offset: h, cols: 5, rows: 5, bounds: b,
    vectors: [{ lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2, u: 0, v: -1, speed: 1, direction: 0, period: 8 }] });
  return { ok: true, status: 200, json: async () => ({ frames: [mk(0, WIDE), mk(3, NARROW), mk(6, NARROW)] }) };
}
function homogeneousResponse() {
  const mk = (h) => ({ hour_offset: h, cols: 5, rows: 5, bounds: WIDE,
    vectors: [{ lat: 28, lng: -80, u: 0, v: -1, speed: 1, direction: 0, period: 8 }] });
  return { ok: true, status: 200, json: async () => ({ frames: [mk(0), mk(3), mk(6)] }) };
}

async function seed(resp) {
  global.fetch = async () => resp;
  await ensureMarineSeries('GFS', 'waves', WIDE, 0, undefined, true);
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('getMarineSeriesFrame served-frame coverage invariant (#10 Source 3)', () => {
  beforeEach(() => {
    window.__RAW_DISABLE_HOUR0_FIRST__ = true;
    window.__MARINE_SERIES__ = true;
    window.__MARINE_SERIES_DIAG__ = { loads: 0, hits: 0, misses: 0 };
    _resetMarineSeriesForTest();
  });
  afterEach(() => {
    delete window.__RAW_DISABLE_MARINE_SERIES_FRAME_COVER__;
    delete window.__RAW_DISABLE_MARINE_WARM_COVERAGE__;
    delete global.fetch;
  });

  // A viewport that fits the WIDE first-frame bounds but NOT the NARROW later frames.
  const VP_BETWEEN = { west: -83.5, south: 25, east: -80, north: 31 };
  // A viewport fully inside the NARROW frame (the served frame genuinely covers it).
  const VP_INSIDE = { west: -81.5, south: 27, east: -80, north: 29 };

  it('does NOT return a served frame whose own bounds fail to cover the request (the fix)', async () => {
    await seed(heterogeneousResponse());
    const frame = getMarineSeriesFrame('GFS', 'waves', VP_BETWEEN, 6); // hour 6 -> NARROW frame
    expect(frame).toBeNull();
    expect(window.__MARINE_SERIES_DIAG__.coverMisses).toBeGreaterThanOrEqual(1);
  });

  it('kill switch restores the legacy behaviour (returns the non-covering narrow frame)', async () => {
    await seed(heterogeneousResponse());
    window.__RAW_DISABLE_MARINE_SERIES_FRAME_COVER__ = true;
    const frame = getMarineSeriesFrame('GFS', 'waves', VP_BETWEEN, 6);
    expect(frame).not.toBeNull();
    const fb = frame.grid.bounds;
    expect(fb.west).toBe(NARROW.west); // the narrow (non-covering) frame, legacy
  });

  it('the family master kill switch also disables the guard', async () => {
    await seed(heterogeneousResponse());
    window.__RAW_DISABLE_MARINE_WARM_COVERAGE__ = true;
    const frame = getMarineSeriesFrame('GFS', 'waves', VP_BETWEEN, 6);
    expect(frame).not.toBeNull();
  });

  it('a served frame that DOES cover the viewport is still returned (no over-rejection)', async () => {
    await seed(heterogeneousResponse());
    const frame = getMarineSeriesFrame('GFS', 'waves', VP_INSIDE, 6); // NARROW covers VP_INSIDE
    expect(frame).not.toBeNull();
    expect(frame.grid.bounds.west).toBe(NARROW.west);
  });

  it('a homogeneous page is unaffected — every covered viewport still hits (no regression)', async () => {
    await seed(homogeneousResponse());
    const frame = getMarineSeriesFrame('GFS', 'waves', VP_BETWEEN, 6); // WIDE covers VP_BETWEEN
    expect(frame).not.toBeNull();
    expect(frame.grid.bounds.west).toBe(WIDE.west);
    expect(window.__MARINE_SERIES_DIAG__.coverMisses || 0).toBe(0);
  });
});
