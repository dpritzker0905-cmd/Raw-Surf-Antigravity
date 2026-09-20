/**
 * F-03 (audit 14.0) — the world-grid prewarm must dedupe on the RESOLVED valid_time.
 *
 * THE DEFECT THIS PINS. The in-flight key and the controller result cache were both keyed by
 * `hourOffset`, while the thing fetched is identified by its resolved `valid_time`. Marine frames
 * are 3-hourly, so three consecutive 1-hour wheel steps resolve to ONE valid_time, missed the
 * guard, and each downloaded the same ~2.3 MB world grid again.
 *
 * Measured live 2026-09-20 at z7 (see audit/weather-simulation-14.0): wheel handles 13, 14 and 15
 * all resolved to 2026-09-21T12:00:00.000Z and issued three identical world-grid requests; over a
 * 9-hour scrub that was 9 world fetches / 14,084 KB where 3 were needed.
 *
 * These tests assert on FETCH COUNT, which is the quantity the defect is about. A test that only
 * asserted "a grid was cached" passes in both the broken and the repaired build.
 */
jest.mock('./marineGridSeries', () => ({
  ensureMarineSeries: jest.fn(),
  getMarineSeriesFrame: jest.fn(() => null),   // force the fetch path; series reuse is WP3's test
}));
jest.mock('./backendCopernicusServiceClient', () => ({
  fetchBackendCopernicusGrid: jest.fn(),
}));
jest.mock('./backendWeatherServiceClient', () => ({
  fetchBackendMarineGrid: jest.fn(),
  getSharedValidTime: jest.fn(),
}));

const { fetchBackendMarineGrid, getSharedValidTime } = require('./backendWeatherServiceClient');

// 3-HOURLY resolution: the real marine cadence, and the whole reason an hourOffset key fails.
// ⚠️ This MUST be (re)installed per test, not in the jest.mock factory: CRA's jest config sets
// `resetMocks: true`, which strips mock IMPLEMENTATIONS before every test while leaving the spy in
// place. A factory-supplied implementation therefore silently becomes `() => undefined` — the mock
// still records the call, so it looks wired, and the code under test just sees undefined.
function resolveValidTime(offset) {
  const base = Date.UTC(2026, 8, 20, 21, 0, 0);
  const snapped = Math.floor(Number(offset) / 3) * 3;
  return new Date(base + snapped * 3600000).toISOString();
}
const prewarm = require('./marineGlobalPrewarm');

const ZOOMED_IN = { west: -81.2, south: 27.5, east: -79.7, north: 28.2 };

function worldGrid() {
  return {
    grid: {
      bounds: { west: -180, south: -80, east: 180, north: 85 },
      vectors: [{ lat: 0, lng: 0, speed: 1 }],
    },
  };
}

let cached;

beforeEach(() => {
  jest.clearAllMocks();
  getSharedValidTime.mockImplementation(resolveValidTime);
  // Positive control: if this ever returns undefined the whole suite would pass vacuously by
  // falling back to the old offset key, which is exactly the failure this test exists to catch.
  expect(getSharedValidTime(12, 'waves', 'GFS')).toBe('2026-09-21T09:00:00.000Z');
  prewarm._resetGlobalPrewarmDedupeForTest();
  cached = [];
  prewarm.registerPrewarmDeps({
    getModelSafeMarine: () => null,          // controller cache always cold -> isolate THIS guard
    cacheMarineResult: (m, hour, result, layer) => cached.push({ m, hour, layer }),
    isSiblingPrewarmEnabled: () => true,
  });
  fetchBackendMarineGrid.mockResolvedValue(worldGrid());
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('F-03 world-grid prewarm dedupe', () => {
  // Offsets 12, 13 and 14 all floor to the 12h frame under this fixture's 3-hourly resolver --
  // the same relation the live wheel showed when handles 13/14/15 each resolved to
  // 2026-09-21T12:00:00.000Z. 15 opens the NEXT frame and must fetch again.
  it('fetches the world grid ONCE for three offsets that share one 3-hourly valid_time', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 12, ZOOMED_IN, 'waves');
    await flush();
    prewarm.prewarmGlobalMarineGrid('GFS', 13, ZOOMED_IN, 'waves');
    await flush();
    prewarm.prewarmGlobalMarineGrid('GFS', 14, ZOOMED_IN, 'waves');
    await flush();

    expect(fetchBackendMarineGrid).toHaveBeenCalledTimes(1);   // was 3 before the repair
    // ...and every offset still gets the grid cached under ITS OWN offset, so the zoom-out
    // lookup keyed by offset is unaffected. Dedupe must not become a coverage regression.
    expect(cached.map((c) => c.hour).sort((a, b) => a - b)).toEqual([12, 13, 14]);
  });

  it('DOES fetch again when the offset crosses into the next 3-hourly frame', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 14, ZOOMED_IN, 'waves');
    await flush();
    prewarm.prewarmGlobalMarineGrid('GFS', 15, ZOOMED_IN, 'waves');   // -> next valid_time
    await flush();
    expect(fetchBackendMarineGrid).toHaveBeenCalledTimes(2);
  });

  it('does not share a grid across LAYERS at the same valid_time', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 13, ZOOMED_IN, 'waves');
    await flush();
    prewarm.prewarmGlobalMarineGrid('GFS', 13, ZOOMED_IN, 'swell_1');
    await flush();
    expect(fetchBackendMarineGrid).toHaveBeenCalledTimes(2);
  });

  it('does not share a grid across MODELS at the same valid_time', async () => {
    prewarm.prewarmGlobalMarineGrid('GFS', 13, ZOOMED_IN, 'waves');
    await flush();
    prewarm.prewarmGlobalMarineGrid('ICON', 13, ZOOMED_IN, 'waves');
    await flush();
    expect(fetchBackendMarineGrid).toHaveBeenCalledTimes(2);
  });

  it('an empty world response is NOT remembered, so the next offset retries', async () => {
    fetchBackendMarineGrid.mockResolvedValueOnce({ grid: { bounds: {}, vectors: [] } });
    prewarm.prewarmGlobalMarineGrid('GFS', 13, ZOOMED_IN, 'waves');
    await flush();
    prewarm.prewarmGlobalMarineGrid('GFS', 14, ZOOMED_IN, 'waves');
    await flush();
    expect(fetchBackendMarineGrid).toHaveBeenCalledTimes(2);
  });
});
