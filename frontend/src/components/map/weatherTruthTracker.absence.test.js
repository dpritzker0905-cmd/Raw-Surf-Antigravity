/**
 * A1 stage-absence watchdog (audit #18, 2026-07-11). The tracker detected divergence but not
 * death: a chain dying after any stage left verdict=PASS — the presentation of this week's
 * wedge/stall classes. A chain must reach a terminal stage within ABSENCE_WINDOW_MS unless a
 * newer chain supersedes its display lane or the tracker resets (transitions).
 */
import {
  recordTruthStage,
  resetTruthTracker,
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

describe('A1 stage-absence watchdog', () => {
  beforeEach(() => {
    resetTruthTracker('test');
    delete window.__WEATHER_TRUTH_ABSENT__;
  });

  it('flags a chain that dies after cacheWrite — once', () => {
    recordTruthStage('backendResponse', stageData('t1', 'p1.json'), 'test', 'f');
    recordTruthStage('cacheWrite', stageData('t1', 'p1.json'), 'test', 'f');
    expect(_getPendingChainsForTest().size).toBe(1);

    const fired = _sweepAbsentChains(Date.now() + ABSENCE_WINDOW_MS + 1000);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toContain('died after cacheWrite');
    expect(fired[0]).toContain('t1');
    expect(window.__WEATHER_TRUTH_TRACE__.verdict.failReasons.some(r => r.includes('ABSENT'))).toBe(true);
    expect(window.__WEATHER_TRUTH_ABSENT__).toHaveLength(1);

    // fire-once: a second sweep reports nothing
    expect(_sweepAbsentChains(Date.now() + 2 * ABSENCE_WINDOW_MS)).toHaveLength(0);
  });

  it('a chain reaching webglUpload is complete — no absence', () => {
    recordTruthStage('backendResponse', stageData('t2', 'p2.json'), 'test', 'f');
    recordTruthStage('orchestratorCommit', stageData('t2', 'p2.json'), 'test', 'f');
    recordTruthStage('webglUpload', stageData('t2', 'p2.json'), 'test', 'f');
    expect(_getPendingChainsForTest().size).toBe(0);
    expect(_sweepAbsentChains(Date.now() + ABSENCE_WINDOW_MS + 1000)).toHaveLength(0);
  });

  it('a newer chain on the same lane SUPERSEDES the old one — no absence for the old', () => {
    recordTruthStage('backendResponse', stageData('t3', 'p3.json'), 'test', 'f');
    // model switch / refetch: new traceId, same display lane
    recordTruthStage('backendResponse', stageData('t4', 'p4.json'), 'test', 'f');
    const pending = _getPendingChainsForTest();
    expect(pending.size).toBe(1);
    expect(Array.from(pending.values())[0].traceId).toBe('t4');
    // t4 completes; nothing is ever absent
    recordTruthStage('webglUpload', stageData('t4', 'p4.json'), 'test', 'f');
    expect(_sweepAbsentChains(Date.now() + ABSENCE_WINDOW_MS + 1000)).toHaveLength(0);
  });

  it('resetTruthTracker clears pending chains (transitions are not deaths)', () => {
    recordTruthStage('cacheWrite', stageData('t5', 'p5.json'), 'test', 'f');
    expect(_getPendingChainsForTest().size).toBe(1);
    resetTruthTracker('model-switch');
    expect(_getPendingChainsForTest().size).toBe(0);
    expect(_sweepAbsentChains(Date.now() + ABSENCE_WINDOW_MS + 1000)).toHaveLength(0);
  });

  it('a fresh chain within the window is NOT flagged', () => {
    recordTruthStage('cacheWrite', stageData('t6', 'p6.json'), 'test', 'f');
    expect(_sweepAbsentChains(Date.now() + 1000)).toHaveLength(0);
    expect(_getPendingChainsForTest().size).toBe(1);
  });
});
