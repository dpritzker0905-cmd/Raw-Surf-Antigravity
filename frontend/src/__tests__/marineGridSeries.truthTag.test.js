/**
 * Audit #18/A3 — series-frame lineage. Series frames are minted with a truthTag (stamped on the
 * GRID, the object the engine sees) so commit and webglUpload record the SAME product_id +
 * traceId. Before the stamp, the engine reconstructed a tag from the bare waveGrid (which has no
 * product_id) → "Product: undefined" + a divergent traceId, and the tracker's same-product
 * previousStages filter never matched series frames (commit→upload divergence undetectable).
 */
import {
  ensureMarineSeries,
  getMarineSeriesFrame,
  _resetMarineSeriesForTest,
} from '../components/map/marineGridSeries';
import { recordTruthStage, resetTruthTracker } from '../components/map/weatherTruthTracker';

const bounds = { west: -81.7, south: 27.8, east: -79.6, north: 28.8 };

function mockSeriesResponse() {
  const mkVec = (h) => ({ lat: 28, lng: -80, u: 0.1, v: 0.2, speed: 1 + h * 0.1, direction: 90, period: 8 });
  return {
    model: 'GFS', domain: 'marine', layer: 'waves', cols: 4, rows: 4,
    frames: [
      { hour_offset: 0, valid_time: '2026-06-20T06:00:00Z', cols: 4, rows: 4, bounds, vectors: [mkVec(0)], provider: 'open-meteo' },
      { hour_offset: 3, valid_time: '2026-06-20T09:00:00Z', cols: 4, rows: 4, bounds, vectors: [mkVec(3)], provider: 'open-meteo' },
    ],
  };
}

describe('series-frame truthTag lineage (audit #18/A3)', () => {
  beforeEach(() => {
    _resetMarineSeriesForTest();
    resetTruthTracker('test');
    window.__MARINE_SERIES__ = true;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => mockSeriesResponse() });
  });
  afterEach(() => { delete window.__MARINE_SERIES__; });

  it('mints the tag once at frame construction, on the grid AND the wrapper', async () => {
    await ensureMarineSeries('GFS', 'waves', bounds);
    const frame = getMarineSeriesFrame('GFS', 'waves', bounds, 3);
    expect(frame).toBeTruthy();

    expect(frame.truthTag).toBeTruthy();
    expect(frame.grid.truthTag).toBe(frame.truthTag); // same object, not a copy
    expect(frame.truthTag.product_id).toBe('series_GFS_waves_h3');
    expect(frame.truthTag.timeOffsetHours).toBe(3);
    expect(frame.truthTag.traceId).toBeTruthy();
    expect(frame.truthTag.dataHash).toBeTruthy();
  });

  it('commit and engine-upload stages record the SAME product + traceId (lineage no longer orphaned)', async () => {
    await ensureMarineSeries('GFS', 'waves', bounds);
    const frame = getMarineSeriesFrame('GFS', 'waves', bounds, 0);
    expect(frame).toBeTruthy();

    // Orchestrator commit shape: full marineData wrapper
    recordTruthStage('orchestratorCommit', frame, 'test', 'commit');
    // Engine upload shape: the bare waveGrid — no product_id of its own, only grid.truthTag
    recordTruthStage('webglUpload', {
      model: 'GFS', domain: 'marine', layer: 'waves',
      grid: frame.grid, truthTag: frame.grid.truthTag,
    }, 'test', 'upload');

    const stages = window.__WEATHER_TRUTH_TRACE__.stages;
    const commit = stages.find(s => s.stage === 'orchestratorCommit');
    const upload = stages.find(s => s.stage === 'webglUpload');
    expect(commit).toBeTruthy();
    expect(upload).toBeTruthy();
    expect(upload.truthTag.product_id).toBe('series_GFS_waves_h0'); // was: undefined
    expect(upload.truthTag.traceId).toBe(commit.truthTag.traceId);   // was: divergent
    expect(window.__WEATHER_TRUTH_TRACE__.verdict.status).toBe('PASS');
  });
});
