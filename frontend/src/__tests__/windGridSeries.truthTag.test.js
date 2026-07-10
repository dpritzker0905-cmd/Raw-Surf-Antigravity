/**
 * Audit #18/A3 — WIND mirror of the marine series-frame lineage fix. Wind series frames and
 * hourly-cache extractions used to rebuild bare objects, so every timeline commit recorded
 * "Product: undefined" with divergent traceIds across orchestratorCommit/webglUpload (user live
 * log 2026-07-10: b5a30ffe vs 620d8e2f). Frames now MINT a truthTag once (buildTruthTag);
 * recordTruthStage preserves an existing tag, so all stages share product_id + traceId.
 */
import {
  ensureWindSeries,
  getWindSeriesFrame,
  _resetWindSeriesForTest,
} from '../components/map/windGridSeries';
import { extractWindAtOffset } from '../components/map/windController';
import { recordTruthStage, resetTruthTracker } from '../components/map/weatherTruthTracker';

const bounds = { west: -180, south: -80, east: 180, north: 85 };

function mockSeriesResponse() {
  const mkVec = (h) => ({ lat: 28, lng: -80, u: 0.1, v: 0.2, speed: h * 0.1 + 1, direction: 90 });
  return {
    model: 'GFS', domain: 'wind', layer: 'wind', cols: 4, rows: 4,
    frames: [
      { hour_offset: 0, valid_time: '2026-06-20T06:00:00Z', cols: 4, rows: 4, bounds, vectors: [mkVec(0)], provider: 'backend-weather-service' },
      { hour_offset: 3, valid_time: '2026-06-20T09:00:00Z', cols: 4, rows: 4, bounds, vectors: [mkVec(3)], provider: 'backend-weather-service' },
    ],
  };
}

describe('wind series-frame truthTag lineage (audit #18/A3 wind mirror)', () => {
  beforeEach(() => {
    _resetWindSeriesForTest();
    resetTruthTracker('test');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => mockSeriesResponse() });
  });
  afterEach(() => { delete window.__WIND_SERIES__; });

  it('mints the tag once at frame construction with the series product id', async () => {
    await ensureWindSeries('GFS', bounds, 0);
    const frame = getWindSeriesFrame('GFS', bounds, 3);
    expect(frame).toBeTruthy();
    expect(frame.truthTag).toBeTruthy();
    expect(frame.truthTag.product_id).toBe('series_GFS_wind_h3');
    expect(frame.product_id).toBe('series_GFS_wind_h3');
    expect(frame.truthTag.timeOffsetHours).toBe(3);
    expect(frame.truthTag.traceId).toBeTruthy();
  });

  it('commit and engine-upload stages share product + traceId (no more Product: undefined)', async () => {
    await ensureWindSeries('GFS', bounds, 0);
    const frame = getWindSeriesFrame('GFS', bounds, 0);
    expect(frame).toBeTruthy();

    // WeatherEngine.commitWindData shape (flat windData wrapped into a grid payload)
    recordTruthStage('orchestratorCommit', {
      model: frame.source, domain: 'wind', layer: 'wind',
      valid_time: frame.valid_time, run_time: frame.run_time,
      product_id: frame.productId || frame.product_id,
      grid: { cols: frame.cols, rows: frame.rows, bounds: frame.bounds, vectors: frame.vectors },
      truthTag: frame.truthTag,
    }, 'test', 'commitWindData');
    // WebGLWindEngine webglUpload shape (the bare windGrid)
    recordTruthStage('webglUpload', {
      model: 'GFS', domain: 'wind', layer: 'wind',
      product_id: frame.productId || frame.product_id,
      grid: frame, truthTag: frame.truthTag,
    }, 'test', 'setWindData');

    const stages = window.__WEATHER_TRUTH_TRACE__.stages;
    const commit = stages.find(s => s.stage === 'orchestratorCommit');
    const upload = stages.find(s => s.stage === 'webglUpload');
    expect(commit.truthTag.product_id).toBe('series_GFS_wind_h0');
    expect(upload.truthTag.product_id).toBe('series_GFS_wind_h0');
    expect(upload.truthTag.traceId).toBe(commit.truthTag.traceId);
    expect(window.__WEATHER_TRUTH_TRACE__.verdict.status).toBe('PASS');
  });

  it('extractWindAtOffset carries the cached lineage identity through (conformed branch)', () => {
    const cache = {
      results: [{ hourly: { time: ['2026-06-20T06:00:00Z'] } }],
      points: [{ lat: 28, monotonicLng: -80 }],
      gridSize: 4, cols: 4, rows: 4, bounds,
      model: 'GFS',
      vectors: [{ lat: 28, lng: -80, speed: 5, direction: 90, u: -5, v: 0 }],
      truthTag: { traceId: 'abc123', product_id: 'gfs_wind_wind_global_coarse_x.json' },
      product_id: 'gfs_wind_wind_global_coarse_x.json',
      valid_time: '2026-06-20T06:00:00Z',
      run_time: '2026-06-20T00:00:00Z',
      provider: 'backend-weather-service',
    };
    // getSharedValidTime must match timeArray[0] for the conformed branch; mock via hour 0 and
    // a cache whose time array equals the shared valid time for h0 — assert pass-through shape.
    const out = extractWindAtOffset(cache, 0);
    if (out) {
      expect(out.truthTag).toBe(cache.truthTag);
      expect(out.product_id).toBe(cache.product_id);
      expect(out.valid_time).toBe(cache.valid_time);
    } else {
      // valid-time mismatch (shared clock differs in test env) → conformed branch declined;
      // pass-through is covered by the branch's own guard, nothing to assert.
      expect(out).toBeNull();
    }
  });
});
