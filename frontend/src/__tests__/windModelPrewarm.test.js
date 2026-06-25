/**
 * Cross-model wind prewarm (instant model switches) — DEFAULT OFF.
 *
 * Verifies: off by default; the isPrewarm guard writes ONLY the isolated per-model WIND_CACHE and
 * NEVER clobbers the shared model-stamped windHourlyCache (the marine cache-pollution landmine that
 * got the first marine prewarm reverted); and when enabled it warms the sibling models so a switch
 * is an instant getModelSafeWind hit.
 */
import { fetchBackendWindGrid } from '../components/map/backendWindServiceClient';
import {
  fetchWindData,
  getModelSafeWind,
  getWindHourlyCache,
  prewarmSiblingModelWind,
  _resetWindCachesForTest,
} from '../components/map/windController';

jest.mock('../components/map/backendWindServiceClient', () => ({
  fetchBackendWindGrid: jest.fn(),
}));

const bounds = { west: -81.7, south: 27.8, east: -79.6, north: 28.8 };

function gridFor(model) {
  return {
    vectors: [
      { lat: 28.0, lng: -81.0, u: 1, v: 1, speed: 10 },
      { lat: 28.5, lng: -80.0, u: 1, v: 1, speed: 12 },
    ],
    bounds: { ...bounds },
    cols: 2, rows: 1, stale: false, renderable: true, nonzeroCount: 2,
    source: model, model,
  };
}

async function waitFor(pred, tries = 60) {
  for (let i = 0; i < tries; i++) { if (pred()) return true; await new Promise((r) => setTimeout(r, 0)); }
  return pred();
}
const flush = () => waitFor(() => false, 4);

describe('prewarmSiblingModelWind — cross-model wind prewarm (default off)', () => {
  beforeEach(() => {
    _resetWindCachesForTest();
    delete window.__WIND_MODEL_PREWARM__;
    delete window.isScrubbingTimeline;
    window.__USE_BACKEND_WIND_SERVICE__ = true;
    fetchBackendWindGrid.mockReset();
    fetchBackendWindGrid.mockImplementation((vp, hour, signal, snapped, source, model) =>
      Promise.resolve(gridFor(model)));
  });
  afterEach(() => {
    delete window.__WIND_MODEL_PREWARM__;
    delete window.__USE_BACKEND_WIND_SERVICE__;
    delete window.isScrubbingTimeline;
  });

  it('is a NO-OP by default (flag off): no sibling wind fetch', async () => {
    prewarmSiblingModelWind('GFS', bounds, 0, 3, null);
    await flush();
    expect(fetchBackendWindGrid).not.toHaveBeenCalled();
    expect(getModelSafeWind('EURO', 0, bounds)).toBeNull();
  });

  it('isPrewarm guard: a sibling fetch fills the isolated WIND_CACHE but NEVER clobbers the shared windHourlyCache (no pollution)', async () => {
    // active GFS commit (normal path) stamps the shared cache GFS
    await fetchWindData(bounds, null, 0, false, 3, 'GFS', false);
    expect(getWindHourlyCache().model).toBe('GFS');
    expect(getModelSafeWind('GFS', 0, bounds)).toBeTruthy();

    // sibling EURO prewarm (isPrewarm=true) — must NOT change the shared windHourlyCache model
    await fetchWindData(bounds, null, 0, false, 3, 'EURO', true);
    expect(getWindHourlyCache().model).toBe('GFS');           // ← not polluted to EURO
    expect(getModelSafeWind('EURO', 0, bounds)).toBeTruthy(); // ← but the per-model cache is warm
    expect(getModelSafeWind('GFS', 0, bounds)).toBeTruthy();  // ← active still warm
  });

  it('enabled: warms the sibling models so getModelSafeWind hits (active not refetched, no pollution)', async () => {
    window.__WIND_MODEL_PREWARM__ = true;
    await fetchWindData(bounds, null, 0, false, 3, 'GFS', false); // GFS active + warm
    fetchBackendWindGrid.mockClear();

    prewarmSiblingModelWind('GFS', bounds, 0, 3, null);
    const ok = await waitFor(() => getModelSafeWind('EURO', 0, bounds) && getModelSafeWind('ICON', 0, bounds));
    expect(ok).toBe(true);

    // only the two siblings were fetched, not GFS again
    const modelsFetched = new Set(fetchBackendWindGrid.mock.calls.map((c) => c[5]));
    expect(modelsFetched).toEqual(new Set(['EURO', 'ICON']));
    // shared cache stays GFS despite the background sibling prewarms
    expect(getWindHourlyCache().model).toBe('GFS');
  });

  it('skips during scrub (does not compete with the active scrub)', async () => {
    window.__WIND_MODEL_PREWARM__ = true;
    window.isScrubbingTimeline = true;
    prewarmSiblingModelWind('GFS', bounds, 0, 3, null);
    await flush();
    expect(fetchBackendWindGrid).not.toHaveBeenCalled();
  });
});
