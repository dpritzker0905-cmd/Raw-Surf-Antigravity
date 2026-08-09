/**
 * R11-01(c) / R11-15 (Report 11.0) — the CANCEL terminal. The 12-stage truth vocabulary was
 * success-shaped: a chain abandoned by a DELIBERATE renderer transition (the WebGL guardrail
 * flipping marine to the raster/canvas fallback) had no terminal, so the absence watchdog
 * reported it 30 s later as "died after <stage>" — a false death observed misdirecting the
 * 2026-08-09 live forensics. cancelTruthChains closes pending chains as CANCELLED:
 * informational (a cancel is not a failure), watchdog-silencing, ring-recorded.
 */
import {
  recordTruthStage,
  resetTruthTracker,
  cancelTruthChains,
  _sweepAbsentChains,
  _getPendingChainsForTest,
  ABSENCE_WINDOW_MS,
} from './weatherTruthTracker';

const bounds = { west: -81, south: 27, east: -80, north: 28 };

function stageData(traceId, product) {
  return {
    model: 'GFS', domain: 'marine', layer: 'waves',
    valid_time: '2026-06-20T06:00:00Z',
    product_id: product,
    grid: { cols: 1, rows: 1, bounds, vectors: [{ lat: 27.5, lng: -80.5, speed: 1, u: 0, v: 1 }] },
    truthTag: {
      traceId, model: 'GFS', domain: 'marine', layer: 'waves',
      valid_time: '2026-06-20T06:00:00Z', product_id: product,
      dataHash: `h_${traceId}`, boundsHash: 'b1',
    },
  };
}

describe('cancelTruthChains — the deliberate-transition terminal', () => {
  beforeEach(() => {
    resetTruthTracker('test');
    delete window.__WEATHER_TRUTH_ABSENT__;
    delete window.__WEATHER_TRUTH_CANCELLED__;
  });

  it('closes a pending chain so the absence watchdog never reports a false death', () => {
    recordTruthStage('backendResponse', stageData('c1', 'p1.json'), 'test', 'f');
    recordTruthStage('orchestratorCommit', stageData('c1', 'p1.json'), 'test', 'f');
    expect(_getPendingChainsForTest().size).toBe(1);

    const n = cancelTruthChains('webgl_marine_fallback: guardrail tripped');
    expect(n).toBe(1);
    expect(_getPendingChainsForTest().size).toBe(0);

    // THE POINT: the watchdog stays silent — this was a cancellation, not a death.
    expect(_sweepAbsentChains(Date.now() + ABSENCE_WINDOW_MS + 1000)).toHaveLength(0);
    expect(window.__WEATHER_TRUTH_ABSENT__).toBeUndefined();
  });

  it('a cancel is informational — verdict.failReasons is untouched', () => {
    recordTruthStage('cacheWrite', stageData('c2', 'p2.json'), 'test', 'f');
    const before = window.__WEATHER_TRUTH_TRACE__.verdict.failReasons.length;
    cancelTruthChains('layer transition');
    expect(window.__WEATHER_TRUTH_TRACE__.verdict.failReasons.length).toBe(before);
  });

  it('records the cancellation in a capped ring with the reason and the last stage', () => {
    recordTruthStage('seriesFrameMint', stageData('c3', 'p3.json'), 'test', 'f');
    cancelTruthChains('test-reason');
    const ring = window.__WEATHER_TRUTH_CANCELLED__;
    expect(ring).toHaveLength(1);
    expect(ring[0].traceId).toBe('c3');
    expect(ring[0].lastStage).toBe('seriesFrameMint');
    expect(ring[0].reason).toBe('test-reason');
  });

  it('returns 0 and stays quiet when nothing is pending', () => {
    expect(cancelTruthChains('noop')).toBe(0);
    expect(window.__WEATHER_TRUTH_CANCELLED__).toBeUndefined();
  });

  it('a completed chain (terminal reached) is not re-cancelled', () => {
    recordTruthStage('backendResponse', stageData('c4', 'p4.json'), 'test', 'f');
    recordTruthStage('webglUpload', stageData('c4', 'p4.json'), 'test', 'f');
    expect(cancelTruthChains('after completion')).toBe(0);
  });
});
